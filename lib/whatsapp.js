const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('baileys');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class WhatsAppClient {
  constructor(config) {
    this.config = config;
    this.sock = null;
    this.isInitializing = false;
    this.reconnectAttempts = 0;
    this.lastDisconnectReason = null;
    this.keepaliveInterval = null;
    this.qrData = null;
    
    // Stats tracking
    this.stats = {
      totalPings: 0,
      failedPings: 0,
      successfulSends: 0,
      failedSends: 0,
      startTime: Date.now()
    };
  }

  /**
   * Initialize the WhatsApp bot
   */
  async initialize() {
    if (this.isInitializing) {
      logger.debugLog('Initialization already in progress, skipping...');
      return;
    }

    this.isInitializing = true;
    logger.log('🔄 Initializing WhatsApp bot...');

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        qrTimeout: 60_000,
        defaultQueryTimeoutMs: undefined,
      });

      // Setup event handlers
      this.setupEventHandlers(saveCreds);

      logger.log('✅ WhatsApp client initialized');
    } catch (err) {
      logger.error('❌ Failed to initialize bot:', err.message);
      this.isInitializing = false;
      
      // Schedule retry
      this.scheduleReconnect();
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Setup event handlers for the socket
   */
  setupEventHandlers(saveCreds) {
    // Handle connection updates
    this.sock.ev.on('connection.update', async (update) => {
      await this.handleConnectionUpdate(update, saveCreds);
    });

    // Handle credentials update
    this.sock.ev.on('creds.update', saveCreds);

    // Auto reject calls
    this.sock.ev.on('call', async (calls) => {
      for (const call of calls) {
        if (call.status === 'offer') {
          logger.log(`📞 Incoming call from ${call.from}, rejecting...`);
          try {
            await this.sock.rejectCall(call.id, call.from);
            logger.log('❌ Call rejected');
          } catch (err) {
            logger.error('⚠️ Failed to reject call:', err.message);
          }
        }
      }
    });
  }

  /**
   * Handle connection updates (QR, open, close)
   */
  async handleConnectionUpdate({ connection, lastDisconnect, qr }, saveCreds) {
    // Handle QR code
    if (qr) {
      logger.log('📱 QR Code received, generating...');
      try {
        this.qrData = await qrcode.toDataURL(qr);
        fs.writeFileSync(this.config.qrFile, this.qrData);
        logger.log('✅ QR code saved');
      } catch (err) {
        logger.error('❌ Failed to generate QR code:', err.message);
      }
    }

    // Handle successful connection
    if (connection === 'open') {
      logger.log('✅ WhatsApp connected successfully');
      this.qrData = null;
      
      // Clear QR file
      try {
        fs.writeFileSync(this.config.qrFile, '');
      } catch (err) {
        logger.error('⚠️ Failed to clear QR file:', err.message);
      }

      // Save credentials
      await saveCreds();

      // Reset reconnect attempts
      this.reconnectAttempts = 0;
      
      // Start internal keepalive
      this.startKeepalive();
    }

    // Handle disconnection
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      this.lastDisconnectReason = statusCode;

      logger.log(`❌ Connection closed (status: ${statusCode}). Should reconnect: ${shouldReconnect}`);

      // Stop keepalive
      this.stopKeepalive();

      if (statusCode === DisconnectReason.loggedOut) {
        logger.log('🧹 Logged out - clearing session...');
        await this.clearSession();
      }

      // Schedule reconnect if needed
      if (shouldReconnect) {
        this.scheduleReconnect();
      } else {
        // For logged out case, still allow re-init after clearing
        setTimeout(() => {
          logger.log('🔄 Re-initializing after logout...');
          this.initialize();
        }, this.config.reinitDelay);
      }
    }
  }

  /**
   * Schedule reconnect with exponential backoff
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.error(`⛔ Max reconnect attempts (${this.config.maxReconnectAttempts}) reached. Stopping automatic reconnection.`);
      logger.log('💡 Use external /ping endpoint to trigger manual reconnection.');
      return;
    }

    this.reconnectAttempts++;
    
    // Exponential backoff: 3s, 6s, 12s, 24s, 48s, ... capped at 60s
    const delay = Math.min(
      this.config.reinitDelay * Math.pow(2, this.reconnectAttempts - 1),
      60000
    );

    logger.log(`⏳ Scheduling reconnect attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts} in ${delay}ms...`);

    setTimeout(() => {
      this.initialize();
    }, delay);
  }

  /**
   * Start internal keepalive (send presence updates)
   */
  startKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
    }

    this.keepaliveInterval = setInterval(() => {
      if (this.sock?.user) {
        this.sock.sendPresenceUpdate('available').catch((err) => {
          logger.debugLog('⚠️ Internal keepalive failed:', err.message);
        });
        logger.debugLog('💓 Internal keepalive ping sent');
      }
    }, this.config.keepaliveInterval);

    logger.log(`💚 Internal keepalive started (interval: ${this.config.keepaliveInterval}ms)`);
  }

  /**
   * Stop internal keepalive
   */
  stopKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
      logger.debugLog('🛑 Internal keepalive stopped');
    }
  }

  /**
   * External keepalive (called by /ping endpoint)
   */
  async externalKeepalive() {
    if (!this.sock?.user) {
      this.stats.failedPings++;
      throw new Error('WhatsApp not connected');
    }

    try {
      await this.sock.sendPresenceUpdate('available');
      this.stats.totalPings++;
      logger.log(`💚 External ping processed (Total: ${this.stats.totalPings})`);
      
      // If we had failed reconnects, reset the counter on successful ping
      if (this.reconnectAttempts > 0) {
        logger.log(`♻️ Resetting reconnect attempts counter from ${this.reconnectAttempts} to 0`);
        this.reconnectAttempts = 0;
      }
      
      return {
        status: 'alive',
        message: 'Session kept alive',
        connected: true,
        phoneNumber: this.sock.user.id,
        timestamp: new Date().toISOString(),
        totalPings: this.stats.totalPings,
        failedPings: this.stats.failedPings
      };
    } catch (err) {
      this.stats.failedPings++;
      logger.error('❌ External ping error:', err.message);
      throw err;
    }
  }

  /**
   * Send message with retry logic
   */
  async sendMessage(phoneNumber, message) {
    if (!this.sock?.user) {
      throw new Error('WhatsApp is not connected');
    }

    const jid = this.normalizePhoneNumber(phoneNumber);
    
    const result = await this.retryWithBackoff(async () => {
      return await this.sock.sendMessage(jid, { text: message });
    });

    if (result.success) {
      this.stats.successfulSends++;
      logger.send('Message sent successfully', { 
        to: jid, 
        attempts: result.attempts 
      });
    } else {
      this.stats.failedSends++;
      logger.send('Message failed', { 
        to: jid, 
        attempts: result.attempts,
        error: result.error?.message 
      });
    }

    return result;
  }

  /**
   * Send media with retry logic
   */
  async sendMedia(phoneNumber, buffer, mimetype, caption, fileName) {
    if (!this.sock?.user) {
      throw new Error('WhatsApp is not connected');
    }

    const jid = this.normalizePhoneNumber(phoneNumber);
    
    let msgContent;
    if (mimetype.startsWith('image/')) {
      msgContent = { image: buffer, mimetype, caption: caption || '' };
    } else if (mimetype.startsWith('video/')) {
      msgContent = { video: buffer, mimetype, caption: caption || '' };
    } else if (mimetype.startsWith('audio/')) {
      msgContent = { audio: buffer, mimetype, ptt: false };
    } else {
      msgContent = { document: buffer, mimetype, fileName: fileName || 'file' };
    }

    const result = await this.retryWithBackoff(async () => {
      return await this.sock.sendMessage(jid, msgContent);
    });

    if (result.success) {
      this.stats.successfulSends++;
      logger.send('Media sent successfully', { 
        to: jid, 
        type: mimetype,
        attempts: result.attempts 
      });
    } else {
      this.stats.failedSends++;
      logger.send('Media failed', { 
        to: jid, 
        type: mimetype,
        attempts: result.attempts,
        error: result.error?.message 
      });
    }

    return result;
  }

  /**
   * Retry with exponential backoff and jitter
   */
  async retryWithBackoff(fn, maxRetries = 3, maxDuration = 15000) {
    let lastError;
    let totalWaitTime = 0;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debugLog(`📤 Attempt ${attempt}/${maxRetries}...`);
        const result = await fn();
        logger.debugLog(`✅ Success on attempt ${attempt}`);
        return { success: true, result, attempts: attempt };
      } catch (err) {
        lastError = err;
        logger.debugLog(`❌ Attempt ${attempt} failed:`, err.message);

        // Check if error is retryable
        if (!this.isRetryableError(err) || attempt === maxRetries) {
          break;
        }

        // Calculate delay with exponential backoff and jitter
        const baseDelay = 1000 * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 500; // 0-500ms jitter
        const waitTime = Math.min(baseDelay + jitter, 5000);

        if (totalWaitTime + waitTime > maxDuration) {
          logger.debugLog(`⏱️ Max retry duration (${maxDuration}ms) reached`);
          break;
        }

        totalWaitTime += waitTime;
        logger.debugLog(`⏳ Waiting ${Math.round(waitTime)}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    return { success: false, error: lastError, attempts: maxRetries };
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(err) {
    const errorMsg = err?.message?.toLowerCase() || '';
    const nonRetryableKeywords = [
      'unauthorized',
      'invalid',
      'malformed',
      'forbidden',
      'not found',
      'logged out'
    ];

    return !nonRetryableKeywords.some(keyword => errorMsg.includes(keyword));
  }

  /**
   * Normalize phone number to JID format
   */
  normalizePhoneNumber(phoneNumber) {
    const cleaned = phoneNumber.replace(/\D/g, '');
    
    // Validate phone number length (basic check)
    if (cleaned.length < 10 || cleaned.length > 15) {
      throw new Error('Invalid phone number length');
    }

    return cleaned.includes('@s.whatsapp.net') 
      ? cleaned 
      : `${cleaned}@s.whatsapp.net`;
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      connected: !!this.sock?.user,
      phoneNumber: this.sock?.user?.id || null,
      lastDisconnectReason: this.lastDisconnectReason,
      reconnectAttempts: this.reconnectAttempts,
      qrAvailable: !!this.qrData
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    return {
      connected: !!this.sock?.user,
      totalPings: this.stats.totalPings,
      failedPings: this.stats.failedPings,
      successfulPings: this.stats.totalPings - this.stats.failedPings,
      successfulSends: this.stats.successfulSends,
      failedSends: this.stats.failedSends,
      uptime: Math.floor(uptime / 1000), // in seconds
      uptimeHuman: this.formatUptime(uptime)
    };
  }

  /**
   * Format uptime in human-readable format
   */
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Get QR code data
   */
  getQR() {
    if (this.qrData) {
      return this.qrData;
    }
    
    // Try reading from file as fallback
    try {
      if (fs.existsSync(this.config.qrFile)) {
        const data = fs.readFileSync(this.config.qrFile, 'utf-8');
        return data || null;
      }
    } catch (err) {
      logger.error('Failed to read QR file:', err.message);
    }
    
    return null;
  }

  /**
   * Logout and clear session
   */
  async logout() {
    logger.log('🚪 Logging out...');

    // Stop keepalive
    this.stopKeepalive();

    // Try graceful logout
    if (this.sock) {
      try {
        await this.sock.logout();
        logger.log('✅ Graceful logout successful');
      } catch (err) {
        logger.error('⚠️ Graceful logout failed:', err.message);
      }
      this.sock = null;
    }

    // Clear session
    await this.clearSession();

    // Schedule re-initialization
    setTimeout(() => {
      logger.log('🔄 Re-initializing after logout...');
      this.initialize();
    }, this.config.reinitDelay);
  }

  /**
   * Clear session files
   */
  async clearSession() {
    try {
      // Remove auth directory
      if (fs.existsSync(this.config.authDir)) {
        fs.rmSync(this.config.authDir, { recursive: true, force: true });
        logger.log('🧹 Auth directory cleared');
      }

      // Clear QR file
      fs.writeFileSync(this.config.qrFile, '');
      this.qrData = null;
      logger.log('🧹 QR file cleared');
    } catch (err) {
      logger.error('⚠️ Failed to clear session:', err.message);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    logger.log('🛑 Shutting down gracefully...');

    // Stop keepalive
    this.stopKeepalive();

    // Close socket
    if (this.sock) {
      try {
        await this.sock.end();
        logger.log('✅ Socket closed');
      } catch (err) {
        logger.error('⚠️ Failed to close socket:', err.message);
      }
    }

    logger.log('👋 Shutdown complete');
  }
}

module.exports = WhatsAppClient;
