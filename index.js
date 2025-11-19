const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("baileys");

const express = require("express");
const qrcode = require("qrcode");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(__dirname));

let sock;
let isInitializing = false;
const SESSION_ID = "session1";
const authDir = path.join(__dirname, `auth_info_${SESSION_ID}`);

// ✅ SESSION TRACKING
let lastPingTime = null;
let totalPings = 0;
let failedPings = 0;

// ✅ RETRY CONFIGURATION
const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelays: [1000, 2000, 4000],
  maxRetryDuration: 15000,
};

// ✅ RETRY HELPER FUNCTION
async function retryWithBackoff(fn, context = {}) {
  let lastError;
  let totalWaitTime = 0;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      console.log(`📤 Attempt ${attempt}/${RETRY_CONFIG.maxRetries} to send message...`);
      const result = await fn();
      console.log(`✅ Message sent successfully on attempt ${attempt}`);
      return { success: true, result, attempts: attempt };
    } catch (err) {
      lastError = err;
      console.error(`❌ Attempt ${attempt} failed:`, err.message);

      if (!isRetryableError(err) || attempt === RETRY_CONFIG.maxRetries) {
        break;
      }

      const waitTime = RETRY_CONFIG.retryDelays[attempt - 1] || 4000;

      if (totalWaitTime + waitTime > RETRY_CONFIG.maxRetryDuration) {
        console.log(`⏱️ Max retry duration (${RETRY_CONFIG.maxRetryDuration}ms) reached`);
        break;
      }

      totalWaitTime += waitTime;
      console.log(`⏳ Waiting ${waitTime}ms before retry ${attempt + 1}...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  return { success: false, error: lastError, attempts: RETRY_CONFIG.maxRetries };
}

// ✅ CHECK IF ERROR IS RETRYABLE
function isRetryableError(err) {
  const errorMsg = err?.message?.toLowerCase() || "";
  const nonRetryableErrors = [
    "unauthorized",
    "invalid",
    "malformed",
    "forbidden",
    "not found",
  ];

  return !nonRetryableErrors.some(e => errorMsg.includes(e));
}

async function initializeBot() {
  if (isInitializing) return;
  isInitializing = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      qrTimeout: 60_000,
      qrRetries: Infinity,
    });

    // Auto reject calls
    sock.ev.on("call", async (calls) => {
      for (const c of calls) {
        if (c.status === "offer") {
          console.log(`📞 Incoming call from ${c.from}, rejecting…`);
          try {
            await sock.rejectCall(c.id, c.from);
            console.log("❌ Call rejected");
          } catch (err) {
            console.error("⚠️ Failed to reject call:", err);
          }
        }
      }
    });

    // Connection & QR handling
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        const qrImage = await qrcode.toDataURL(qr);
        fs.writeFileSync("qr.txt", qrImage);
      }

      if (connection === "open") {
        console.log("✅ WhatsApp connected");
        fs.writeFileSync("qr.txt", "");
        await saveCreds();
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        console.log(`❌ Disconnected (status ${statusCode}). Reconnect?`, !isLoggedOut);

        if (isLoggedOut) {
          console.log("🧹 Clearing session and resetting...");
          try {
            fs.rmSync(authDir, { recursive: true, force: true });
            fs.writeFileSync("qr.txt", "");
          } catch (err) {
            console.error("⚠️ Failed to clean up session:", err);
          }
        }

        setTimeout(() => {
          console.log("🔄 Reinitializing bot...");
          initializeBot();
        }, 3000);
      }
    });

    sock.ev.on("creds.update", saveCreds);

    // Keep alive (Internal - every 60 seconds)
    setInterval(() => {
      if (sock?.user) {
        sock.sendPresenceUpdate("available").catch(() => {});
        console.log("💓 Internal keep-alive ping sent");
      }
    }, 60000);

  } catch (err) {
    console.error("❌ Failed to initialize bot:", err);
    isInitializing = false;
  } finally {
    isInitializing = false;
  }
}

// --- API Endpoints ---

app.get("/qr", (req, res) => {
  if (fs.existsSync("qr.txt")) {
    res.send(fs.readFileSync("qr.txt", "utf-8"));
  } else {
    res.send("QR not available");
  }
});

app.get("/status", (req, res) => {
  res.json({ connected: !!sock?.user });
});

// ✅ NEW: PING ENDPOINT (For Cron/External Keep-Alive)
app.get("/ping", async (req, res) => {
  if (!sock?.user) {
    failedPings++;
    return res.status(503).json({
      status: "error",
      message: "WhatsApp not connected",
      connected: false,
      timestamp: new Date().toISOString(),
      totalPings,
      failedPings,
    });
  }

  try {
    await sock.sendPresenceUpdate("available");
    lastPingTime = new Date();
    totalPings++;
    
    console.log(`💚 External ping received and processed (Total: ${totalPings})`);
    
    res.json({
      status: "alive",
      message: "Session kept alive",
      connected: true,
      phoneNumber: sock.user.id,
      timestamp: new Date().toISOString(),
      lastPingTime: lastPingTime.toISOString(),
      totalPings,
      failedPings,
    });
  } catch (err) {
    failedPings++;
    console.error("❌ Ping error:", err.message);
    
    res.status(500).json({
      status: "error",
      message: "Ping failed",
      connected: false,
      error: err.toString(),
      timestamp: new Date().toISOString(),
      totalPings,
      failedPings,
    });
  }
});

// ✅ NEW: PING STATS ENDPOINT
app.get("/ping-stats", (req, res) => {
  res.json({
    connected: !!sock?.user,
    totalPings,
    failedPings,
    successfulPings: totalPings - failedPings,
    lastPingTime: lastPingTime?.toISOString() || "Never",
    timestamp: new Date().toISOString(),
  });
});

// ✅ SEND MESSAGE WITH RETRY
app.post("/send-message", async (req, res) => {
  const { phoneNumber, message, apiKey } = req.body;

  if (apiKey !== "123456") {
    return res.status(401).json({ status: false, message: "Unauthorized" });
  }

  if (!sock?.user) {
    return res.status(503).json({ status: false, message: "WhatsApp is not connected" });
  }

  if (!phoneNumber || !message) {
    return res.status(400).json({ status: false, message: "Missing phone number or message" });
  }

  const cleaned = phoneNumber.replace(/\D/g, "");
  const fullNumber = cleaned.includes("@s.whatsapp.net")
    ? cleaned
    : `${cleaned}@s.whatsapp.net`;

  const result = await retryWithBackoff(async () => {
    return await sock.sendMessage(fullNumber, { text: message });
  });

  if (result.success) {
    return res.json({
      status: true,
      message: "Message sent successfully",
      attempts: result.attempts,
      timestamp: new Date().toISOString(),
    });
  } else {
    console.error("Send error after retries:", result.error);
    return res.status(500).json({
      status: false,
      message: "Failed to send message after multiple attempts",
      attempts: result.attempts,
      error: result.error?.toString(),
    });
  }
});

// ✅ SEND MEDIA WITH RETRY
app.post("/send-media", async (req, res) => {
  const { phoneNumber, mediaUrl, caption, apiKey } = req.body;

  if (apiKey !== "123456") {
    return res.status(401).json({ status: false, message: "Unauthorized" });
  }

  if (!sock?.user) {
    return res.status(503).json({ status: false, message: "WhatsApp is not connected" });
  }

  if (!phoneNumber || !mediaUrl) {
    return res.status(400).json({ status: false, message: "Missing phone number or mediaUrl" });
  }

  const cleaned = phoneNumber.replace(/\D/g, "");
  const fullNumber = cleaned.includes("@s.whatsapp.net")
    ? cleaned
    : `${cleaned}@s.whatsapp.net`;

  try {
    const response = await axios.get(mediaUrl, { responseType: "arraybuffer" });
    const mimeType = response.headers["content-type"] || "application/octet-stream";
    const buffer = Buffer.from(response.data);

    let msgContent;
    if (mimeType.startsWith("image/")) {
      msgContent = { image: buffer, mimetype: mimeType, caption: caption || "" };
    } else if (mimeType.startsWith("video/")) {
      msgContent = { video: buffer, mimetype: mimeType, caption: caption || "" };
    } else if (mimeType.startsWith("audio/")) {
      msgContent = { audio: buffer, mimetype: mimeType, ptt: false };
    } else {
      msgContent = { document: buffer, mimetype: mimeType, fileName: "file" };
    }

    const result = await retryWithBackoff(async () => {
      return await sock.sendMessage(fullNumber, msgContent);
    });

    if (result.success) {
      return res.json({
        status: true,
        message: "Media sent successfully",
        attempts: result.attempts,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.error("Send media error after retries:", result.error);
      return res.status(500).json({
        status: false,
        message: "Failed to send media after multiple attempts",
        attempts: result.attempts,
        error: result.error?.toString(),
      });
    }
  } catch (err) {
    console.error("Media fetch/send error:", err);
    res.status(500).json({
      status: false,
      message: "Failed to process media",
      error: err.toString(),
    });
  }
});

app.post("/logout", async (req, res) => {
  try {
    if (sock) {
      try {
        await sock.logout();
      } catch (err) {
        console.error("⚠️ Failed graceful logout:", err.message);
      }
      sock = null;
    }

    try {
      fs.rmSync(authDir, { recursive: true, force: true });
      fs.writeFileSync("qr.txt", "");
      console.log("🧹 Session cleared successfully");
    } catch (err) {
      console.error("⚠️ Error clearing session:", err);
    }

    res.json({ status: true, message: "Logged out successfully. Please refresh to scan a new QR." });

    setTimeout(() => {
      initializeBot();
    }, 2000);
  } catch (err) {
    res.status(500).json({ status: false, message: "Logout failed", error: err.toString() });
  }
});

app.get("/test", async (req, res) => {
  if (!sock || !sock.user) {
    return res.status(503).json({ status: false, message: "WhatsApp not connected" });
  }

  const testNumber = "923483469617@s.whatsapp.net";

  const result = await retryWithBackoff(async () => {
    return await sock.sendMessage(testNumber, { text: "test" });
  });

  if (result.success) {
    console.log("✅ Test message sent successfully");
    return res.json({
      status: true,
      message: "Test message sent",
      attempts: result.attempts,
    });
  } else {
    console.error("⚠️ Failed to send test message:", result.error);
    return res.status(500).json({
      status: false,
      message: "Test message failed",
      attempts: result.attempts,
      error: result.error?.message || result.error?.toString(),
    });
  }
});

initializeBot();
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));