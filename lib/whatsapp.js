const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('baileys');
const qrcode = require('qrcode');
const fs = require('fs');
const logger = require('./logger');

class WhatsAppClient {
  constructor(config = {}) {
    this.config = Object.assign({
      authDir: './auth',
      qrFile: './qr.txt',
      keepaliveInterval: 60_000,
      reinitDelay: 3000,
      maxReconnectAttempts: 10,
      autoReinitAfterLogout: false
    }, config);

    this.sock = null;
    this.isInitializing = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.keepaliveInterval = null;
    this.qrData = null;

    this.stats = {
      totalPings: 0,
      failedPings: 0,
      successfulSends: 0,
      failedSends: 0,
      startTime: Date.now()
    };
  }

  /**
   * Initialize the WhatsApp bot (idempotent)
   */
  async initialize() {
    // Guard: if already initializing or socket already exists and connected, skip
    if (this.isInitializing || (this.sock && this.sock.user)) {
      logger.debugLog('Initialize skipped - already initializing or connected');
      return;
    }

    this.isInitializing = true;
    logger.log('🔄 Initializing WhatsApp bot...');

    try {
      // Hard cleanup if previous socket exists (rare race-case)
      if (this.sock) {
        await this._hardCleanupSocket();
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);
      const { version } = await fetchLatestBaileysVersion();

      // Create socket
      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        qrTimeout: 60_000,
        defaultQueryTimeoutMs: undefined
      });

      // Setup handlers (safe: will remove previous handlers on this.sock)
      this.setupEventHandlers(saveCreds);

      logger.log('✅ WhatsApp client initialized');
    } catch (err) {
      logger.error('❌ Failed to initialize bot:', err?.message || err);
      // schedule reconnect with backoff
      this.isInitializing = false;
      this.scheduleReconnect();
      return;
    }

    // success - clear flags
    this.isInitializing = false;
  }

  /**
   * Attach event handlers for current socket safely
   */
  setupEventHandlers(saveCreds) {
    if (!this.sock) return;

    // Ensure no duplicate listeners on the same socket
    try {
      this.sock.ev.removeAllListeners();
    } catch (e) {
      // ignore
    }

    // Connection updates
    this.sock.ev.on('connection.update', async (update) => {
      try {
        await this.handleConnectionUpdate(update, saveCreds);
      } catch (err) {
        logger.error('Error in connection.update handler:', err?.message || err);
      }
    });

    // Save credentials when updated
    this.sock.ev.on('creds.update', saveCreds);

    // Auto reject calls
    this.sock.ev.on('call', async (calls) => {
      for (const call of calls) {
        if (call?.status === 'offer') {
          logger.log(`📞 Incoming call from ${call.from}, rejecting...`);
          try {
            await this.sock.rejectCall(call.id, call.from);
            logger.log('❌ Call rejected');
          } catch (err) {
            logger.error('⚠️ Failed to reject call:', err?.message || err);
          }
        }
      }
    });
  }

  /**
   * Handle connection updates (QR, open, close)
   */
  async handleConnectionUpdate({ connection, lastDisconnect, qr }, saveCreds) {
    // QR handling
    if (qr) {
      logger.log('📱 QR Code received, generating...');
      try {
        this.qrData = await qrcode.toDataURL(qr);
        fs.writeFileSync(this.config.qrFile, this.qrData);
        logger.log('✅ QR code saved');
      } catch (err) {
        logger.error('❌ Failed to generate QR code:', err?.message || err);
      }
    }

    // Connected
    if (connection === 'open') {
      logger.log('✅ WhatsApp connected successfully');
      this.qrData = null;
      try { fs.writeFileSync(this.config.qrFile, ''); } catch (e) {}
      if (saveCreds) {
        try { await saveCreds(); } catch (e) { logger.debugLog('saveCreds failed:', e?.message || e); }
      }
      this.reconnectAttempts = 0;
      this.startKeepalive();
      // If there was a reconnect timer, clear it
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    }

    // Disconnected
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      this.lastDisconnectReason = statusCode;

      logger.log(`❌ Connection closed (status: ${statusCode}). Should reconnect: ${shouldReconnect}`);

      // Hard cleanup of old socket (remove listeners, close ws)
      await this._hardCleanupSocket();

      // Stop keepalive
      this.stopKeepalive();

      // If logged out, clear session files
      if (statusCode === DisconnectReason.loggedOut) {
        logger.log('🧹 Logged out - clearing session...');
        await this.clearSession();
      }

      // Schedule reconnect only if allowed
      if (shouldReconnect) {
        this.scheduleReconnect();
      } else {
        // logged out - optionally reinitialize (configurable)
        if (this.config.autoReinitAfterLogout) {
          this.reconnectAttempts = 0;
          this.scheduleReconnect(true); // immediate-ish
        }
      }
    }
  }

  /**
   * Hard cleanup of socket resources
   */
  async _hardCleanupSocket() {
    if (!this.sock) return;

    try {
      // remove listeners
      try { this.sock.ev.removeAllListeners(); } catch (e) {}
      // close underlying ws if present
      try { this.sock.ws?.close?.(); } catch (e) {}
      // try graceful end if available
      try { await this.sock.end?.(); } catch (e) {}
    } catch (err) {
      // don't let cleanup errors crash the flow
      logger.debugLog('Socket hard cleanup error:', err?.message || err);
    } finally {
      this.sock = null;
      this.isInitializing = false;
    }
  }

  /**
   * Schedule reconnect with exponential backoff.
   * If immediate === true, use reinitDelay only (no exponential growth).
   */
  scheduleReconnect(immediate = false) {
    // If already at max attempts, stop automatic reconnect
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.error(`⛔ Max reconnect attempts (${this.config.maxReconnectAttempts}) reached.`);
      logger.log('💡 Use external /ping endpoint to trigger manual reconnection.');
      return;
    }

    // Clear existing timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectAttempts++;

    let delay;
    if (immediate) {
      delay = this.config.reinitDelay;
    } else {
      // exponential backoff with cap
      delay = Math.min(this.config.reinitDelay * Math.pow(2, this.reconnectAttempts - 1), 60_000);
    }

    logger.log(`⏳ Scheduling reconnect attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // guard again to prevent overlapping in case something else initialized
      if (this.isInitializing || (this.sock && this.sock.user)) {
        logger.debugLog('Reconnect skipped - already initializing or connected');
        return;
      }
      this.initialize();
    }, delay);
  }

  /**
   * Start internal keepalive (single interval)
   */
  startKeepalive() {
    // ensure single interval
    if (this.keepaliveInterval) return;

    this.keepaliveInterval = setInterval(() => {
      if (this.sock?.user) {
        this.sock.sendPresenceUpdate('available').catch((err) => {
          logger.debugLog('⚠️ Internal keepalive failed:', err?.message || err);
        });
        logger.keepaliveLog && logger.keepaliveLog('💓 Internal keepalive ping sent');
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
   * External keepalive (called by /ping)
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

      // Reset reconnect attempts after a successful ping
      if (this.reconnectAttempts > 0) this.reconnectAttempts = 0;

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
      logger.error('❌ External ping error:', err?.message || err);
      throw err;
    }
  }

  /**
   * Send a text message (with retry wrapper)
   */
  async sendMessage(phoneNumber, message) {
    if (!this.sock?.user) throw new Error('WhatsApp is not connected');

    const jid = this.normalizePhoneNumber(phoneNumber);

    const result = await this.retryWithBackoff(async () => {
      return await this.sock.sendMessage(jid, { text: message });
    });

    if (result.success) {
      this.stats.successfulSends++;
      logger.send && logger.send('Message sent successfully', { to: jid, attempts: result.attempts });
    } else {
      this.stats.failedSends++;
      logger.send && logger.send('Message failed', { to: jid, attempts: result.attempts, error: result.error?.message });
    }

    return result;
  }

  /**
   * Send media (with retry wrapper)
   */
  async sendMedia(phoneNumber, buffer, mimetype, caption, fileName) {
    if (!this.sock?.user) throw new Error('WhatsApp is not connected');

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
      logger.send && logger.send('Media sent successfully', { to: jid, type: mimetype, attempts: result.attempts });
    } else {
      this.stats.failedSends++;
      logger.send && logger.send('Media failed', { to: jid, type: mimetype, attempts: result.attempts, error: result.error?.message });
    }

    return result;
  }

  /**
   * Retry helper (exponential backoff + jitter)
   */
  async retryWithBackoff(fn, maxRetries = 3, maxDuration = 15_000) {
    let lastError;
    let totalWaitTime = 0;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debugLog && logger.debugLog(`📤 Attempt ${attempt}/${maxRetries}...`);
        const result = await fn();
        logger.debugLog && logger.debugLog(`✅ Success on attempt ${attempt}`);
        return { success: true, result, attempts: attempt };
      } catch (err) {
        lastError = err;
        logger.debugLog && logger.debugLog(`❌ Attempt ${attempt} failed: ${err?.message || err}`);

        if (!this.isRetryableError(err) || attempt === maxRetries) break;

        const baseDelay = 1000 * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 500;
        const waitTime = Math.min(baseDelay + jitter, 5000);

        if (totalWaitTime + waitTime > maxDuration) {
          logger.debugLog && logger.debugLog(`⏱️ Max retry duration (${maxDuration}ms) reached`);
          break;
        }

        totalWaitTime += waitTime;
        await new Promise(r => setTimeout(r, waitTime));
      }
    }

    return { success: false, error: lastError, attempts: maxRetries };
  }

  isRetryableError(err) {
    const errorMsg = (err?.message || '').toLowerCase();
    const nonRetryable = ['unauthorized', 'invalid', 'malformed', 'forbidden', 'not found', 'logged out'];
    return !nonRetryable.some(k => errorMsg.includes(k));
  }

  normalizePhoneNumber(phoneNumber) {
    const cleaned = phoneNumber.toString().replace(/\D/g, '');
    if (cleaned.length < 9 || cleaned.length > 15) {
      throw new Error('Invalid phone number length');
    }
    return cleaned.includes('@s.whatsapp.net') ? cleaned : `${cleaned}@s.whatsapp.net`;
  }

  getStatus() {
    return {
      connected: !!this.sock?.user,
      phoneNumber: this.sock?.user?.id || null,
      lastDisconnectReason: this.lastDisconnectReason,
      reconnectAttempts: this.reconnectAttempts,
      qrAvailable: !!this.qrData
    };
  }

  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    return {
      connected: !!this.sock?.user,
      totalPings: this.stats.totalPings,
      failedPings: this.stats.failedPings,
      successfulPings: this.stats.totalPings - this.stats.failedPings,
      successfulSends: this.stats.successfulSends,
      failedSends: this.stats.failedSends,
      uptime: Math.floor(uptime / 1000),
      uptimeHuman: this.formatUptime(uptime)
    };
  }

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

  getQR() {
    if (this.qrData) return this.qrData;
    try {
      if (fs.existsSync(this.config.qrFile)) {
        const d = fs.readFileSync(this.config.qrFile, 'utf-8');
        return d || null;
      }
    } catch (err) {
      logger.error('Failed to read QR file:', err?.message || err);
    }
    return null;
  }

  async logout() {
    logger.log('🚪 Logging out...');

    // Stop keepalive
    this.stopKeepalive();

    // Attempt graceful logout and hard cleanup
    if (this.sock) {
      try {
        await this.sock.logout();
        logger.log('✅ Graceful logout successful');
      } catch (err) {
        logger.error('⚠️ Graceful logout failed:', err?.message || err);
      }
      await this._hardCleanupSocket();
    }

    // Clear session files
    await this.clearSession();

    // Optionally reinitialize after logout (controlled by config)
    if (this.config.autoReinitAfterLogout) {
      this.reconnectAttempts = 0;
      this.scheduleReconnect(true);
    }
  }

  async clearSession() {
    try {
      if (fs.existsSync(this.config.authDir)) {
        fs.rmSync(this.config.authDir, { recursive: true, force: true });
        logger.log('🧹 Auth directory cleared');
      }
      try { fs.writeFileSync(this.config.qrFile, ''); } catch (e) {}
      this.qrData = null;
    } catch (err) {
      logger.error('⚠️ Failed to clear session:', err?.message || err);
    }
  }

  async shutdown() {
    logger.log('🛑 Shutting down gracefully...');

    // Stop keepalive
    this.stopKeepalive();

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Hard cleanup socket
    await this._hardCleanupSocket();

    logger.log('👋 Shutdown complete');
  }
}

module.exports = WhatsAppClient;
