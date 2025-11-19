const fs = require('fs');
const path = require('path');
const { createStream } = require('rotating-file-stream');

const logsDir = path.join(__dirname, '../logs');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create rotating streams for different log types
const appLogStream = createStream('app.log', {
  interval: '1d',
  path: logsDir,
  maxFiles: 1, // Keep only 24 hours (1 day)
  compress: 'gzip'
});

const sendLogStream = createStream('send.log', {
  interval: '1d',
  path: logsDir,
  maxFiles: 1, // Keep only 24 hours (1 day)
  compress: 'gzip'
});

const errorLogStream = createStream('errors.log', {
  interval: '1d',
  path: logsDir,
  maxFiles: 1, // Keep only 24 hours (1 day)
  compress: 'gzip'
});

// Format timestamp
function timestamp() {
  return new Date().toISOString();
}

// Logger class
class Logger {
  constructor() {
    this.debug = process.env.DEBUG === 'true';
    this.lastKeepaliveLog = 0;
    this.keepaliveLogInterval = 30000; // Log keepalive every 30 seconds (2 times per minute)
  }

  log(message, ...args) {
    const logMessage = `[${timestamp()}] [INFO] ${message} ${args.length ? JSON.stringify(args) : ''}\n`;
    console.log(logMessage.trim());
    appLogStream.write(logMessage);
  }

  error(message, ...args) {
    const logMessage = `[${timestamp()}] [ERROR] ${message} ${args.length ? JSON.stringify(args) : ''}\n`;
    console.error(logMessage.trim());
    errorLogStream.write(logMessage);
  }

  send(message, data = {}) {
    const logMessage = `[${timestamp()}] ${message} ${JSON.stringify(data)}\n`;
    if (this.debug) {
      console.log(logMessage.trim());
    }
    sendLogStream.write(logMessage);
  }

  debugLog(message, ...args) {
    if (this.debug) {
      const logMessage = `[${timestamp()}] [DEBUG] ${message} ${args.length ? JSON.stringify(args) : ''}\n`;
      console.log(logMessage.trim());
      appLogStream.write(logMessage);
    }
  }

  keepaliveLog(message, ...args) {
    // Log keepalive messages only twice per minute (every 30 seconds)
    const now = Date.now();
    if (now - this.lastKeepaliveLog >= this.keepaliveLogInterval) {
      const logMessage = `[${timestamp()}] [INFO] ${message} ${args.length ? JSON.stringify(args) : ''}\n`;
      console.log(logMessage.trim());
      appLogStream.write(logMessage);
      this.lastKeepaliveLog = now;
    }
  }
}

module.exports = new Logger();
