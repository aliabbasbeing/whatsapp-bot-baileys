# WhatsApp Bot with Baileys - Enhanced Edition

A robust, production-ready WhatsApp bot built with Baileys library, featuring enhanced session management, modern UI, and comprehensive monitoring capabilities.

![WhatsApp Bot UI](https://github.com/user-attachments/assets/db837bfa-0a01-4f88-a3ef-68623c7eca57)

## ✨ Features

### Core Functionality
- 🔄 **Robust Session Management** - Automatic reconnection with exponential backoff
- 📱 **QR Code Authentication** - File-based auth state with multi-file support
- 💚 **Internal & External Keepalive** - Prevents session disconnections
- 🔁 **Smart Retry Logic** - Exponential backoff with jitter for message sending
- 🛡️ **Security Hardened** - Helmet, rate limiting, API key authentication
- 📊 **Comprehensive Monitoring** - Real-time statistics and logging
- 🎨 **Modern UI Dashboard** - Beautiful, responsive web interface

### API Endpoints (Backward Compatible)
- `POST /send-message` - Send text messages
- `POST /send-media` - Send images, videos, audio, documents
- `GET /ping` - External keepalive endpoint (cron-friendly)
- `GET /ping-stats` - Get detailed statistics
- `GET /status` - Connection status
- `GET /qr` - Get QR code for authentication
- `POST /logout` - Logout and clear session
- `GET /test` - Send test message
- `GET /health` - Health check endpoint

### New Features in v2.0
- ✅ Modular architecture (lib/, public/, config/)
- ✅ Rotating log files (app.log, send.log, errors.log)
- ✅ Environment-based configuration
- ✅ Graceful shutdown handlers
- ✅ Enhanced error classification
- ✅ Session lifecycle management
- ✅ Modern responsive dashboard
- ✅ Real-time status updates
- ✅ cPanel deployment guide

## 📋 Prerequisites

- **Node.js** 14.x or higher (18.x recommended)
- **npm** or **yarn**
- **WhatsApp** account
- Basic knowledge of Node.js and REST APIs

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/aliabbasbeing/whatsapp-bot-baileys.git
cd whatsapp-bot-baileys
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
cp config/example.env .env
```

Edit `.env` and set your configuration:

```env
PORT=3000
SESSION_ID=session1
API_KEY=your-secure-api-key-here
AUTH_DIR=./auth_session1
QR_FILE=./qr.txt
KEEPALIVE_INTERVAL=60000
REINIT_DELAY=3000
MAX_RECONNECT_ATTEMPTS=10
DEBUG=false
APP_VERSION=2.0.0
```

⚠️ **Important:** Change `API_KEY` to a strong, random string!

### 4. Start the Application

```bash
npm start
# or
node index.js
```

### 5. Scan QR Code

1. Open your browser: `http://localhost:3000`
2. Scan the QR code with WhatsApp:
   - Open WhatsApp on your phone
   - Go to **Settings → Linked Devices**
   - Tap **Link a Device**
   - Scan the displayed QR code

## 📁 Project Structure

```
whatsapp-bot-baileys/
├── index.js              # Main entry point
├── lib/
│   ├── whatsapp.js       # WhatsApp client with session management
│   └── logger.js         # Rotating file logger
├── public/
│   ├── index.html        # Modern UI dashboard
│   └── app.js            # Client-side JavaScript
├── config/
│   └── example.env       # Environment variables template
├── logs/                 # Auto-generated log files
│   ├── app.log
│   ├── send.log
│   └── errors.log
├── auth_session1/        # Auto-generated auth state
├── package.json
├── .env                  # Your configuration (not in git)
├── .gitignore
├── README.md             # This file
└── README-cpanel.md      # cPanel deployment guide
```

## 🔧 Configuration

All configuration is done via environment variables in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `SESSION_ID` | session1 | Unique session identifier |
| `API_KEY` | 123456 | API authentication key |
| `AUTH_DIR` | ./auth_session1 | Auth state directory |
| `QR_FILE` | ./qr.txt | QR code file path |
| `KEEPALIVE_INTERVAL` | 60000 | Internal keepalive interval (ms) |
| `REINIT_DELAY` | 3000 | Reconnect delay (ms) |
| `MAX_RECONNECT_ATTEMPTS` | 10 | Max auto-reconnect attempts |
| `DEBUG` | false | Enable debug logging |
| `APP_VERSION` | 2.0.0 | Application version |

## 📡 API Usage

### Send Text Message

```bash
curl -X POST http://localhost:3000/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "923001234567",
    "message": "Hello from WhatsApp Bot!",
    "apiKey": "your-api-key"
  }'
```

**Response:**
```json
{
  "status": true,
  "message": "Message sent successfully",
  "attempts": 1,
  "timestamp": "2025-11-19T20:00:00.000Z"
}
```

### Send Media (Image/Video/Document)

```bash
curl -X POST http://localhost:3000/send-media \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "923001234567",
    "mediaUrl": "https://example.com/image.jpg",
    "caption": "Check this out!",
    "apiKey": "your-api-key"
  }'
```

### Keepalive Ping

```bash
curl http://localhost:3000/ping
```

**Response:**
```json
{
  "status": "alive",
  "message": "Session kept alive",
  "connected": true,
  "phoneNumber": "923001234567@s.whatsapp.net",
  "timestamp": "2025-11-19T20:00:00.000Z",
  "totalPings": 42,
  "failedPings": 0
}
```

### Get Statistics

```bash
curl http://localhost:3000/ping-stats
```

**Response:**
```json
{
  "connected": true,
  "totalPings": 42,
  "failedPings": 0,
  "successfulPings": 42,
  "successfulSends": 100,
  "failedSends": 2,
  "uptime": 3600,
  "uptimeHuman": "1h 0m"
}
```

### Health Check

```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "running",
  "connected": true,
  "uptime": 3600.5,
  "pid": 12345,
  "version": "2.0.0"
}
```

## 🔐 Security

### API Key Authentication

All write endpoints require API key authentication:
- Include `apiKey` in request body (JSON)
- Or include as query parameter: `?apiKey=your-key`

### Rate Limiting

- **60 requests per minute** per IP address
- Configurable in `index.js`

### Security Headers

- Helmet.js for HTTP security headers
- CSP (Content Security Policy)
- XSS protection
- HSTS (HTTP Strict Transport Security)

### Best Practices

1. ✅ Use strong API keys (32+ characters)
2. ✅ Keep `.env` file secure (never commit)
3. ✅ Use HTTPS in production
4. ✅ Regularly update dependencies
5. ✅ Monitor logs for suspicious activity
6. ✅ Backup auth state regularly

## 📊 Monitoring & Logs

### Log Files

Logs are automatically rotated daily and compressed:

- `logs/app.log` - General application logs
- `logs/send.log` - Message sending logs
- `logs/errors.log` - Error logs

Maximum 7 days of logs are kept.

### Enable Debug Mode

```env
DEBUG=true
```

### View Logs in Real-time

```bash
tail -f logs/app.log
tail -f logs/send.log
tail -f logs/errors.log
```

## 🌐 Deployment

### Local Development

```bash
npm start
```

### Production with PM2

```bash
npm install -g pm2
pm2 start index.js --name whatsapp-bot
pm2 save
pm2 startup
```

### cPanel Shared Hosting

See **[README-cpanel.md](README-cpanel.md)** for detailed cPanel deployment instructions.

### Docker (Optional)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
```

## ⏰ Keepalive with Cron

To prevent session disconnections, set up a cron job:

### Linux/macOS

```bash
crontab -e
```

Add:
```cron
*/5 * * * * wget -qO- http://localhost:3000/ping >/dev/null 2>&1
```

### cPanel

1. Go to **Advanced → Cron Jobs**
2. Add new cron job:
   - **Minute:** `*/5`
   - **Command:** `wget -qO- http://yourdomain.com/ping >/dev/null 2>&1`

### External Services

Use services like:
- [cron-job.org](https://cron-job.org)
- [UptimeRobot](https://uptimerobot.com)

Configure to ping: `http://yourdomain.com/ping` every 5 minutes

## 🔄 Session Management

### Reconnection Strategy

- Automatic reconnection with exponential backoff
- Delays: 3s, 6s, 12s, 24s, 48s, ... (max 60s)
- Max 10 automatic attempts (configurable)
- External `/ping` can trigger additional attempts

### Logout & Clear Session

```bash
curl -X POST http://localhost:3000/logout
```

This will:
1. Close the WhatsApp connection
2. Clear auth state
3. Remove QR code
4. Re-initialize for new QR scan

### Session Persistence

Auth state is stored in `auth_session1/` directory:
- Keep this folder safe
- Backup regularly
- Don't commit to git

## 🐛 Troubleshooting

### QR Code Not Appearing

1. Check if server is running: `curl http://localhost:3000/health`
2. Check logs: `tail -f logs/app.log`
3. Clear session: `POST /logout`
4. Restart server

### Session Disconnects

1. Enable keepalive cron job (every 5 min)
2. Check network connectivity
3. Increase `MAX_RECONNECT_ATTEMPTS`
4. Check Baileys version compatibility

### "Unauthorized" Error

1. Verify API key in `.env`
2. Check API key in request
3. Restart server after changing `.env`

### Port Already in Use

```bash
# Find process
lsof -i :3000
# Kill process
kill -9 <PID>
```

Or change `PORT` in `.env`

## 🧪 Testing

### Manual Testing

1. Start server
2. Open UI: `http://localhost:3000`
3. Scan QR code
4. Test endpoints with curl/Postman

### Test Checklist

- [ ] Server starts without errors
- [ ] UI loads correctly
- [ ] QR code displays
- [ ] Scan and connect to WhatsApp
- [ ] Send test message via UI
- [ ] Send message via API
- [ ] Send media via API
- [ ] Ping endpoint works
- [ ] Logout and reconnect
- [ ] Session persists after restart

## 📚 API Reference

### Error Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request (missing parameters) |
| 401 | Unauthorized (invalid API key) |
| 429 | Too Many Requests (rate limit) |
| 500 | Server Error |
| 503 | Service Unavailable (not connected) |

### Error Response Format

```json
{
  "status": false,
  "message": "Error description",
  "error": "Detailed error message"
}
```

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is open source and available under the MIT License.

## 🙏 Acknowledgments

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API
- [Express](https://expressjs.com/) - Web framework
- [Bootstrap](https://getbootstrap.com/) - UI framework

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/aliabbasbeing/whatsapp-bot-baileys/issues)
- **Discussions:** [GitHub Discussions](https://github.com/aliabbasbeing/whatsapp-bot-baileys/discussions)

## 🔗 Links

- [Baileys Documentation](https://github.com/WhiskeySockets/Baileys)
- [cPanel Deployment Guide](README-cpanel.md)
- [Express Documentation](https://expressjs.com/)

---

**Made with ❤️ using Baileys**
