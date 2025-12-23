# cPanel Installation & Configuration Guide

This guide explains how to install and run the WhatsApp Bot on cPanel shared hosting.

## Prerequisites

- cPanel account with Node.js support (version 14+ recommended)
- SSH access (optional but helpful for debugging)
- Basic knowledge of cPanel file manager

## Step 1: Upload Files

1. **Download or clone** this repository
2. **Upload** all files to your cPanel account via:
   - FTP/SFTP client (FileZilla, WinSCP, etc.)
   - cPanel File Manager
3. **Recommended location**: `/home/yourusername/whatsapp-bot/`

## Step 2: Install Dependencies

### Using cPanel Terminal (Recommended)

1. Navigate to **Advanced → Terminal** in cPanel
2. Change to your application directory:
   ```bash
   cd ~/whatsapp-bot
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

### Using SSH

If you have SSH access:
```bash
ssh yourusername@yourserver.com
cd ~/whatsapp-bot
npm install
```

## Step 3: Configure Environment Variables

1. **Copy** the example environment file:
   ```bash
   cp config/example.env .env
   ```

2. **Edit** the `.env` file with your settings:
   ```env
   PORT=3000
   SESSION_ID=session1
   API_KEY=your-very-secure-api-key-change-this
   AUTH_DIR=./auth_session1
   QR_FILE=./qr.txt
   KEEPALIVE_INTERVAL=60000
   REINIT_DELAY=3000
   MAX_RECONNECT_ATTEMPTS=10
   DEBUG=false
   APP_VERSION=2.0.0
   ```

   **Important:**
   - Change `API_KEY` to a strong, random string
   - `PORT` may need to be assigned by cPanel (check Node.js app settings)
   - Keep `AUTH_DIR` and `QR_FILE` paths relative

## Step 4: Set Directory Permissions

Ensure the application can write to necessary directories:

```bash
chmod 755 ~/whatsapp-bot
chmod 755 ~/whatsapp-bot/logs
chmod 755 ~/whatsapp-bot/config
chmod 755 ~/whatsapp-bot/public
```

The application will create `auth_*` directories automatically.

## Step 5: Setup Node.js Application in cPanel

1. Navigate to **Software → Setup Node.js App** in cPanel
2. Click **Create Application**
3. Configure:
   - **Node.js version**: 14.x or higher (18.x recommended)
   - **Application mode**: Production
   - **Application root**: `/home/yourusername/whatsapp-bot`
   - **Application URL**: Choose your domain/subdomain
   - **Application startup file**: `index.js`
   - **Environment variables**: Add from your `.env` file
4. Click **Create**

### Important Environment Variables to Set in cPanel

Add these in the Node.js App environment variables section:
```
API_KEY=your-secure-api-key
SESSION_ID=session1
PORT=3000 (or as assigned by cPanel)
```

## Step 6: Start the Application

1. In the Node.js App interface, click **Start**
2. Verify the app is running (status should show "Running")
3. Access your application at: `http://yourdomain.com` or `http://yourdomain.com:port`

## Step 7: Access the Dashboard

1. Open your browser and navigate to your application URL
2. You should see the WhatsApp Bot Manager dashboard
3. **Scan the QR code** with WhatsApp:
   - Open WhatsApp on your phone
   - Go to **Settings → Linked Devices**
   - Tap **Link a Device**
   - Scan the QR code displayed

## Step 8: Setup Cron Job for Keepalive (Recommended)

To keep your WhatsApp session alive, set up a cron job:

1. Navigate to **Advanced → Cron Jobs** in cPanel
2. Add a new cron job:
   - **Minute**: `*/5` (every 5 minutes)
   - **Hour**: `*`
   - **Day**: `*`
   - **Month**: `*`
   - **Weekday**: `*`
   - **Command**: 
     ```bash
     wget -qO- http://localhost:3000/ping > /dev/null 2>&1
     ```
     OR if wget doesn't work:
     ```bash
     curl -s http://localhost:3000/ping > /dev/null 2>&1
     ```

**Note**: Replace `localhost:3000` with your actual domain and port.

### Alternative: Using External Cron Service

If cPanel cron doesn't work, use external services like:
- [cron-job.org](https://cron-job.org)
- [UptimeRobot](https://uptimerobot.com)

Set them to ping: `http://yourdomain.com/ping` every 5 minutes

## Step 9: Test the API

Test your installation using curl or Postman:

### Test Ping
```bash
curl http://yourdomain.com/ping
```

### Test Send Message
```bash
curl -X POST http://yourdomain.com/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "923001234567",
    "message": "Hello from cPanel!",
    "apiKey": "your-api-key"
  }'
```

## Troubleshooting

### Application Won't Start

1. **Check Node.js version**: Ensure you're using Node.js 14 or higher
2. **Check logs**: 
   - View cPanel Node.js app logs
   - Check `~/whatsapp-bot/logs/errors.log`
3. **Verify permissions**: Ensure directories are writable
4. **Check dependencies**: Run `npm install` again

### QR Code Not Showing

1. **Clear browser cache** and refresh
2. **Check file permissions** on `qr.txt`
3. **Restart the application** from cPanel
4. **Check logs** for errors: `~/whatsapp-bot/logs/app.log`

### Session Disconnects Frequently

1. **Enable keepalive cron**: Follow Step 8
2. **Check network**: Ensure stable internet connection
3. **Increase reconnect attempts**: Edit `.env`:
   ```env
   MAX_RECONNECT_ATTEMPTS=20
   ```
4. **Check Baileys version**: Update to latest if needed

### "Unauthorized" Error

1. **Verify API key**: Check it matches in `.env` and your requests
2. **Check environment**: Ensure `.env` is loaded properly
3. **Restart application** after changing API key

### Port Already in Use

1. **Check cPanel assigned port**: Use the port provided by cPanel
2. **Update .env**: Set `PORT` to match cPanel's assignment
3. **Restart application**

## File Permissions Reference

```
drwxr-xr-x  whatsapp-bot/           (755)
drwxr-xr-x  whatsapp-bot/logs/      (755)
drwxr-xr-x  whatsapp-bot/config/    (755)
drwxr-xr-x  whatsapp-bot/lib/       (755)
drwxr-xr-x  whatsapp-bot/public/    (755)
-rw-r--r--  whatsapp-bot/.env       (644)
-rw-r--r--  whatsapp-bot/index.js   (644)
```

## Security Best Practices

1. **Never commit `.env`** to version control
2. **Use strong API keys**: At least 32 random characters
3. **Enable rate limiting**: Already configured (60 req/min)
4. **Update regularly**: Keep Baileys and dependencies updated
5. **Monitor logs**: Regularly check for suspicious activity
6. **Restrict access**: Use `.htaccess` if needed
7. **Use HTTPS**: Configure SSL certificate in cPanel

## Monitoring

### Check Application Status
```bash
curl http://yourdomain.com/health
```

### Check Statistics
```bash
curl http://yourdomain.com/ping-stats
```

### View Logs
```bash
# Via SSH
tail -f ~/whatsapp-bot/logs/app.log
tail -f ~/whatsapp-bot/logs/errors.log
tail -f ~/whatsapp-bot/logs/send.log
```

## Updating the Application

1. **Backup** your `.env` and `auth_*` folders
2. **Stop** the Node.js application in cPanel
3. **Upload** new files (don't overwrite `.env` or `auth_*`)
4. **Run** `npm install` to update dependencies
5. **Start** the application

## Support & Resources

- **GitHub Issues**: Report bugs and feature requests
- **Baileys Documentation**: [GitHub](https://github.com/WhiskeySockets/Baileys)
- **cPanel Documentation**: Check your hosting provider's docs

## Common Commands

```bash
# Install dependencies
npm install

# Start manually (for testing)
node index.js

# Check Node.js version
node --version

# View running processes
ps aux | grep node

# Kill a process (if needed)
kill -9 <PID>
```

## Notes

- **Shared hosting limitations**: Some features may be restricted
- **Keep alive is crucial**: Set up cron job to prevent disconnections
- **Resource limits**: Monitor CPU/RAM usage in cPanel
- **Session persistence**: `auth_*` folder contains your session - keep it safe
- **One session only**: This app supports one WhatsApp connection at a time

---

**Need help?** Open an issue on GitHub or contact your hosting support for cPanel-specific questions.
