// UI State Management
let isConnected = false;
let updateInterval = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadStatus();
  startAutoUpdate();
  
  // Add event listeners
  document.getElementById('sendForm').addEventListener('submit', sendMessage);
  document.getElementById('pingBtn').addEventListener('click', sendPing);
  document.getElementById('logoutBtn').addEventListener('click', logout);
});

// Start automatic status updates
function startAutoUpdate() {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
  updateInterval = setInterval(loadStatus, 3000); // Update every 3 seconds
}

// Load current status
async function loadStatus() {
  try {
    const [statusRes, statsRes] = await Promise.all([
      fetch('/status'),
      fetch('/ping-stats')
    ]);

    const status = await statusRes.json();
    const stats = await statsRes.json();

    updateUI(status, stats);
  } catch (err) {
    console.error('Failed to load status:', err);
    showError('Failed to connect to server');
  }
}

// Update UI with current status
function updateUI(status, stats) {
  const now = new Date().toLocaleTimeString();
  document.getElementById('lastUpdate').textContent = `Updated: ${now}`;

  // Update connection status
  isConnected = status.connected;
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const phoneInfo = document.getElementById('phoneInfo');
  const qrSection = document.getElementById('qrSection');
  const disconnectedMessage = document.getElementById('disconnectedMessage');

  if (isConnected) {
    statusIndicator.className = 'status-indicator status-connected pulse';
    statusText.textContent = 'Connected';
    phoneInfo.classList.remove('d-none');
    qrSection.classList.add('d-none');
    disconnectedMessage.classList.add('d-none');
    
    // Show phone number in the status area
    if (status.phoneNumber) {
      document.getElementById('connectedPhone').textContent = status.phoneNumber;
    }
  } else {
    statusIndicator.className = 'status-indicator status-disconnected pulse';
    statusText.textContent = 'Not Connected';
    phoneInfo.classList.add('d-none');
    
    // Load QR code if available
    loadQR();
  }

  // Update statistics
  document.getElementById('statUptime').textContent = stats.uptimeHuman || '—';
  document.getElementById('statPings').textContent = stats.totalPings || 0;
  document.getElementById('statSends').textContent = stats.successfulSends || 0;
  document.getElementById('statFailed').textContent = (stats.failedPings || 0) + (stats.failedSends || 0);
}

// Load QR code
async function loadQR() {
  try {
    const response = await fetch('/qr');
    const qrData = await response.text();

    const qrSection = document.getElementById('qrSection');
    const qrCode = document.getElementById('qrCode');
    const disconnectedMessage = document.getElementById('disconnectedMessage');

    if (qrData && qrData.startsWith('data:')) {
      qrCode.innerHTML = `<img src="${qrData}" alt="QR Code" class="img-fluid" />`;
      qrSection.classList.remove('d-none');
      disconnectedMessage.classList.add('d-none');
    } else {
      qrCode.innerHTML = '';
      qrSection.classList.add('d-none');
      disconnectedMessage.classList.remove('d-none');
    }
  } catch (err) {
    console.error('Failed to load QR:', err);
  }
}

// Send keepalive ping
async function sendPing() {
  const resultDiv = document.getElementById('actionResult');
  resultDiv.className = 'alert alert-info mt-3';
  resultDiv.textContent = 'Sending ping...';
  resultDiv.classList.remove('d-none');

  try {
    const response = await fetch('/ping');
    const data = await response.json();

    if (response.ok) {
      resultDiv.className = 'alert alert-success mt-3';
      resultDiv.textContent = `✅ ${data.message || 'Ping successful'}`;
    } else {
      resultDiv.className = 'alert alert-danger mt-3';
      resultDiv.textContent = `❌ ${data.message || 'Ping failed'}`;
    }

    // Refresh status
    setTimeout(loadStatus, 500);
  } catch (err) {
    resultDiv.className = 'alert alert-danger mt-3';
    resultDiv.textContent = `❌ Failed to send ping: ${err.message}`;
  }

  // Auto-hide after 5 seconds
  setTimeout(() => {
    resultDiv.classList.add('d-none');
  }, 5000);
}

// Logout session
async function logout() {
  if (!confirm('Are you sure you want to logout? You will need to scan the QR code again.')) {
    return;
  }

  const resultDiv = document.getElementById('actionResult');
  resultDiv.className = 'alert alert-info mt-3';
  resultDiv.textContent = 'Logging out...';
  resultDiv.classList.remove('d-none');

  try {
    const response = await fetch('/logout', { method: 'POST' });
    const data = await response.json();

    if (response.ok) {
      resultDiv.className = 'alert alert-success mt-3';
      resultDiv.textContent = `✅ ${data.message || 'Logged out successfully'}`;
      
      // Reset UI
      isConnected = false;
      document.getElementById('phoneInfo').classList.add('d-none');
      
      // Refresh status after short delay
      setTimeout(loadStatus, 2000);
    } else {
      resultDiv.className = 'alert alert-danger mt-3';
      resultDiv.textContent = `❌ ${data.message || 'Logout failed'}`;
    }
  } catch (err) {
    resultDiv.className = 'alert alert-danger mt-3';
    resultDiv.textContent = `❌ Failed to logout: ${err.message}`;
  }

  // Auto-hide after 5 seconds
  setTimeout(() => {
    resultDiv.classList.add('d-none');
  }, 5000);
}

// Send message
async function sendMessage(event) {
  event.preventDefault();

  const phoneNumber = document.getElementById('phoneNumber').value.trim();
  const message = document.getElementById('message').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  const resultDiv = document.getElementById('sendResult');

  if (!phoneNumber || !message || !apiKey) {
    showSendResult('⚠️ Please fill all fields', 'warning');
    return;
  }

  resultDiv.className = 'alert alert-info mt-3';
  resultDiv.textContent = 'Sending message...';
  resultDiv.classList.remove('d-none');

  try {
    const response = await fetch('/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber, message, apiKey })
    });

    const data = await response.json();

    if (response.ok && data.status) {
      showSendResult(`✅ ${data.message || 'Message sent successfully'}`, 'success');
      
      // Clear form
      document.getElementById('message').value = '';
      
      // Refresh stats
      setTimeout(loadStatus, 500);
    } else {
      showSendResult(`❌ ${data.message || 'Failed to send message'}`, 'danger');
    }
  } catch (err) {
    showSendResult(`❌ Failed to send message: ${err.message}`, 'danger');
  }
}

// Show send result
function showSendResult(message, type) {
  const resultDiv = document.getElementById('sendResult');
  resultDiv.className = `alert alert-${type} mt-3`;
  resultDiv.textContent = message;
  resultDiv.classList.remove('d-none');

  // Auto-hide after 5 seconds
  setTimeout(() => {
    resultDiv.classList.add('d-none');
  }, 5000);
}

// Show error
function showError(message) {
  const statusText = document.getElementById('statusText');
  statusText.textContent = `Error: ${message}`;
}
