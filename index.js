// Load environment variables
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// Import custom modules
const WhatsAppClient = require('./lib/whatsapp');
const logger = require('./lib/logger');

// Configuration
const config = {
  port: process.env.PORT || 3000,
  sessionId: process.env.SESSION_ID || 'session1',
  apiKey: process.env.API_KEY || '123456',
  authDir: process.env.AUTH_DIR || path.join(__dirname, `auth_${process.env.SESSION_ID || 'session1'}`),
  qrFile: process.env.QR_FILE || path.join(__dirname, 'qr.txt'),
  keepaliveInterval: parseInt(process.env.KEEPALIVE_INTERVAL) || 60000,
  reinitDelay: parseInt(process.env.REINIT_DELAY) || 3000,
  maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS) || 10,
  appVersion: process.env.APP_VERSION || '2.0.0'
};

// Initialize Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  message: { status: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.log(message.trim())
  }
}));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize WhatsApp client
const waClient = new WhatsAppClient(config);

// Middleware to validate API key
function validateApiKey(req, res, next) {
  const apiKey = req.body.apiKey || req.query.apiKey;
  
  if (!apiKey || apiKey !== config.apiKey) {
    return res.status(401).json({ 
      status: false, 
      message: 'Unauthorized - Invalid API key' 
    });
  }
  
  next();
}

// --- API Endpoints ---

// Health check endpoint
app.get('/health', (req, res) => {
  const status = waClient.getStatus();
  res.json({
    status: 'running',
    connected: status.connected,
    uptime: process.uptime(),
    pid: process.pid,
    version: config.appVersion
  });
});

// Get QR code
app.get('/qr', (req, res) => {
  const qrData = waClient.getQR();
  
  if (qrData && qrData.startsWith('data:')) {
    res.send(qrData);
  } else {
    res.send('QR not available');
  }
});

// Get connection status
app.get('/status', (req, res) => {
  const status = waClient.getStatus();
  res.json({ 
    connected: status.connected,
    phoneNumber: status.phoneNumber
  });
});

// External keepalive ping
app.get('/ping', async (req, res) => {
  try {
    const result = await waClient.externalKeepalive();
    res.json(result);
  } catch (err) {
    logger.error('Ping endpoint error:', err.message);
    res.status(503).json({
      status: 'error',
      message: err.message,
      connected: false,
      timestamp: new Date().toISOString(),
      totalPings: waClient.stats.totalPings,
      failedPings: waClient.stats.failedPings
    });
  }
});

// Get ping and send statistics
app.get('/ping-stats', (req, res) => {
  const stats = waClient.getStats();
  res.json(stats);
});

// Send message endpoint
app.post('/send-message', validateApiKey, async (req, res) => {
  const { phoneNumber, message } = req.body;

  if (!phoneNumber || !message) {
    return res.status(400).json({ 
      status: false, 
      message: 'Missing phone number or message' 
    });
  }

  try {
    const result = await waClient.sendMessage(phoneNumber, message);
    
    if (result.success) {
      return res.json({
        status: true,
        message: 'Message sent successfully',
        attempts: result.attempts,
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(500).json({
        status: false,
        message: 'Failed to send message after multiple attempts',
        attempts: result.attempts,
        error: result.error?.message || result.error?.toString()
      });
    }
  } catch (err) {
    logger.error('Send message endpoint error:', err.message);
    return res.status(500).json({
      status: false,
      message: err.message,
      error: err.toString()
    });
  }
});

// Send media endpoint
app.post('/send-media', validateApiKey, async (req, res) => {
  const { phoneNumber, mediaUrl, caption } = req.body;

  if (!phoneNumber || !mediaUrl) {
    return res.status(400).json({ 
      status: false, 
      message: 'Missing phone number or mediaUrl' 
    });
  }

  try {
    // Fetch media from URL
    const response = await axios.get(mediaUrl, { 
      responseType: 'arraybuffer',
      timeout: 30000
    });
    
    const mimeType = response.headers['content-type'] || 'application/octet-stream';
    const buffer = Buffer.from(response.data);
    
    // Extract filename from URL
    const fileName = mediaUrl.split('/').pop().split('?')[0] || 'file';

    const result = await waClient.sendMedia(phoneNumber, buffer, mimeType, caption, fileName);

    if (result.success) {
      return res.json({
        status: true,
        message: 'Media sent successfully',
        attempts: result.attempts,
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(500).json({
        status: false,
        message: 'Failed to send media after multiple attempts',
        attempts: result.attempts,
        error: result.error?.message || result.error?.toString()
      });
    }
  } catch (err) {
    logger.error('Send media endpoint error:', err.message);
    return res.status(500).json({
      status: false,
      message: 'Failed to process media',
      error: err.toString()
    });
  }
});

// Logout endpoint
app.post('/logout', async (req, res) => {
  try {
    await waClient.logout();
    res.json({ 
      status: true, 
      message: 'Logged out successfully. Please refresh to scan a new QR.' 
    });
  } catch (err) {
    logger.error('Logout endpoint error:', err.message);
    res.status(500).json({ 
      status: false, 
      message: 'Logout failed', 
      error: err.toString() 
    });
  }
});

// Test endpoint (for backward compatibility)
app.get('/test', async (req, res) => {
  const status = waClient.getStatus();
  
  if (!status.connected) {
    return res.status(503).json({ 
      status: false, 
      message: 'WhatsApp not connected' 
    });
  }

  const testNumber = '923483469617@s.whatsapp.net';

  try {
    const result = await waClient.sendMessage(testNumber, 'test');
    
    if (result.success) {
      return res.json({
        status: true,
        message: 'Test message sent',
        attempts: result.attempts
      });
    } else {
      return res.status(500).json({
        status: false,
        message: 'Test message failed',
        attempts: result.attempts,
        error: result.error?.message || result.error?.toString()
      });
    }
  } catch (err) {
    logger.error('Test endpoint error:', err.message);
    return res.status(500).json({
      status: false,
      message: 'Test message failed',
      error: err.toString()
    });
  }
});

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  logger.log('🛑 SIGINT received, shutting down gracefully...');
  await waClient.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.log('🛑 SIGTERM received, shutting down gracefully...');
  await waClient.shutdown();
  process.exit(0);
});

// Start the server
const server = app.listen(config.port, () => {
  logger.log(`🚀 WhatsApp Bot Server started`);
  logger.log(`📡 Port: ${config.port}`);
  logger.log(`🔐 API Key: ${config.apiKey.substring(0, 3)}***`);
  logger.log(`📂 Session: ${config.sessionId}`);
  logger.log(`🌐 Dashboard: http://localhost:${config.port}`);
  logger.log(`📋 Version: ${config.appVersion}`);
  
  // Initialize WhatsApp bot
  waClient.initialize();
});