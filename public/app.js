/**
 * AirDrop-X - Main Client Application Logic & UI Manager
 * Connects Socket.io, WebRTC Manager, and HTML UI components.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Socket.io Connection
  const socket = io();
  const rtcManager = new WebRTCManager(socket);

  // App State
  let selectedFile = null;
  let currentRoomCode = null;

  // DOM Elements - Nav & Status
  const navStatusDot = document.getElementById('nav-status-dot');
  const navStatusText = document.getElementById('nav-status-text');
  const connectionBadge = document.getElementById('connection-badge');
  const btnDisconnectPeer = document.getElementById('btn-disconnect-peer');

  // DOM Elements - Inline Error Box & Network Mode
  const errorAlertBox = document.getElementById('error-alert-box');
  const errorAlertText = document.getElementById('error-alert-text');
  const btnCloseError = document.getElementById('btn-close-error');
  const selectNetworkMode = document.getElementById('select-network-mode');

  // DOM Elements - Pairing Tabs
  const tabCreate = document.getElementById('tab-create');
  const tabJoin = document.getElementById('tab-join');
  const viewCreate = document.getElementById('view-create');
  const viewJoin = document.getElementById('view-join');
  
  const generatedCodeEl = document.getElementById('generated-code');
  const btnGenerateCode = document.getElementById('btn-generate-code');
  const btnCopyCode = document.getElementById('btn-copy-code');
  const inputRoomCode = document.getElementById('input-room-code');
  const btnJoinRoom = document.getElementById('btn-join-room');

  // DOM Elements - Peer Status
  const peerIconWrapper = document.getElementById('peer-icon-wrapper');
  const peerStatusIcon = document.getElementById('peer-status-icon');
  const peerStatusTitle = document.getElementById('peer-status-title');
  const peerStatusDesc = document.getElementById('peer-status-desc');

  // DOM Elements - Selected File Header Banner
  const selectedFileBanner = document.getElementById('selected-file-banner');
  const selectedFileNameEl = document.getElementById('selected-file-name');
  const selectedFileSizeEl = document.getElementById('selected-file-size');
  const selectedFileTypeEl = document.getElementById('selected-file-type');
  const selectedFileIcon = document.getElementById('selected-file-icon');
  const btnClearFile = document.getElementById('btn-clear-file');

  // DOM Elements - Drag & Drop Upload
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const btnBrowse = document.getElementById('btn-browse');
  const btnSampleFile = document.getElementById('btn-sample-file');

  // DOM Elements - Transfer & Progress
  const btnSendFile = document.getElementById('btn-send-file');
  const progressPanel = document.getElementById('progress-panel');
  const progressStatusText = document.getElementById('progress-status-text');
  const progressPercentage = document.getElementById('progress-percentage');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const transferSpeedEl = document.getElementById('transfer-speed');
  const transferBytesEl = document.getElementById('transfer-bytes');
  const transferEtaEl = document.getElementById('transfer-eta');
  const btnCancelTransfer = document.getElementById('btn-cancel-transfer');

  // DOM Elements - Completion Card
  const completionCard = document.getElementById('completion-card');
  const completionTitle = document.getElementById('completion-title');
  const completionDesc = document.getElementById('completion-desc');
  const downloadActionBox = document.getElementById('download-action-box');
  const btnDownloadFile = document.getElementById('btn-download-file');
  const btnResetTransfer = document.getElementById('btn-reset-transfer');

  // Helper: Show & Hide Inline Errors
  function showError(msg) {
    if (!msg) {
      errorAlertBox.classList.add('hidden');
      return;
    }
    errorAlertText.textContent = msg;
    errorAlertBox.classList.remove('hidden');
  }

  function hideError() {
    errorAlertBox.classList.add('hidden');
  }

  if (btnCloseError) {
    btnCloseError.addEventListener('click', hideError);
  }

  // Helper: Format Bytes to Human Readable string (KB, MB, GB)
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Helper: Get File Type Icon
  function getFileIconClass(fileName, mimeType) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    if (['pdf'].includes(ext)) return 'ri-file-pdf-2-line';
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) return 'ri-image-line';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return 'ri-video-line';
    if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return 'ri-music-2-line';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'iso'].includes(ext)) return 'ri-folder-zip-line';
    if (['doc', 'docx', 'txt', 'rtf', 'md'].includes(ext)) return 'ri-file-text-line';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'ri-file-excel-line';
    if (['ppt', 'pptx'].includes(ext)) return 'ri-file-ppt-line';
    return 'ri-file-3-line';
  }

  // --- Network Mode Change Listener ---
  selectNetworkMode.addEventListener('change', (e) => {
    const mode = e.target.value;
    rtcManager.setNetworkMode(mode);
  });

  // --- Socket Connection Events ---
  socket.on('connect', () => {
    console.log('[Socket] Connected to server. Socket ID:', socket.id);
    updateNavStatus('connected', 'Server Online');
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Disconnected from server');
    updateNavStatus('disconnected', 'Disconnected');
    updatePeerStatus('disconnected', 'Disconnected', 'Lost connection to signaling server.');
  });

  // --- Connection & Pairing Logic ---

  // Create Code Tab Switch
  tabCreate.addEventListener('click', () => {
    hideError();
    tabCreate.classList.add('active');
    tabJoin.classList.remove('active');
    viewCreate.classList.add('active');
    viewJoin.classList.remove('active');
  });

  // Join Code Tab Switch
  tabJoin.addEventListener('click', () => {
    hideError();
    tabJoin.classList.add('active');
    tabCreate.classList.remove('active');
    viewJoin.classList.add('active');
    viewCreate.classList.remove('active');
  });

  // Generate Room Code Button
  btnGenerateCode.addEventListener('click', () => {
    hideError();
    rtcManager.cleanup();
    socket.emit('create-room', (res) => {
      if (res && res.success) {
        currentRoomCode = res.roomCode;
        generatedCodeEl.textContent = currentRoomCode;
        updatePeerStatus('waiting', 'Awaiting Remote Peer', `Share 6-digit code ${currentRoomCode} with the receiving device.`);
        connectionBadge.textContent = 'Room Code Active';
        connectionBadge.className = 'badge badge-outline';
        btnDisconnectPeer.classList.add('hidden');
      } else {
        showError('Failed to generate room code.');
      }
    });
  });

  // Auto-generate room code on startup
  btnGenerateCode.click();

  // Copy Room Code Button
  btnCopyCode.addEventListener('click', () => {
    if (currentRoomCode && currentRoomCode !== '------') {
      navigator.clipboard.writeText(currentRoomCode).then(() => {
        btnCopyCode.innerHTML = '<i class="ri-check-line"></i>';
        setTimeout(() => {
          btnCopyCode.innerHTML = '<i class="ri-file-copy-line"></i>';
        }, 2000);
      }).catch(err => {
        console.warn('Clipboard write failed:', err);
      });
    }
  });

  // Join Room Button
  btnJoinRoom.addEventListener('click', () => {
    hideError();
    const code = inputRoomCode.value.trim();
    if (code.length !== 6 || isNaN(code)) {
      showError('Please enter a valid 6-digit room code.');
      return;
    }

    rtcManager.cleanup();
    socket.emit('join-room', { roomCode: code }, (res) => {
      if (res && res.success) {
        currentRoomCode = code;
        updatePeerStatus('waiting', 'Joining Device...', `Connecting to room ${code}...`);
      } else {
        showError(res ? res.message : 'Failed to join room.');
      }
    });
  });

  // Allow Enter key in join room code input
  inputRoomCode.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      btnJoinRoom.click();
    }
  });

  // Disconnect Peer Session Button
  btnDisconnectPeer.addEventListener('click', () => {
    hideError();
    socket.emit('leave-room', () => {
      rtcManager.cleanup();
      currentRoomCode = null;
      btnDisconnectPeer.classList.add('hidden');
      updateNavStatus('connected', 'Server Online');
      updatePeerStatus('disconnected', 'Disconnected', 'Session closed. Click Generate New Code or Join Device to pair again.');
      clearSelectedFile();
      progressPanel.classList.add('hidden');
      completionCard.classList.add('hidden');
      dropzone.classList.remove('hidden');
    });
  });

  // --- UI Update Helpers ---

  function updateNavStatus(status, text) {
    navStatusDot.className = `status-indicator-dot ${status}`;
    navStatusText.textContent = text;
  }

  function updatePeerStatus(status, title, desc) {
    peerIconWrapper.className = `peer-status-icon-wrapper ${status}`;
    peerStatusTitle.textContent = title;
    peerStatusDesc.textContent = desc;

    if (status === 'connected') {
      peerStatusIcon.className = 'ri-shield-check-line';
      connectionBadge.textContent = 'P2P Connected';
      connectionBadge.className = 'badge badge-success';
      btnDisconnectPeer.classList.remove('hidden');
    } else if (status === 'waiting') {
      peerStatusIcon.className = 'ri-radar-line';
      btnDisconnectPeer.classList.add('hidden');
    } else {
      peerStatusIcon.className = 'ri-error-warning-line';
      connectionBadge.textContent = 'Disconnected';
      connectionBadge.className = 'badge badge-outline';
      btnDisconnectPeer.classList.add('hidden');
    }

    // Enable / Disable Send Button based on connection and selected file
    checkSendButtonState();
  }

  // --- WebRTC Manager Event Listeners ---

  rtcManager.onConnectionStateChange = (state, customMsg) => {
    console.log('[App] WebRTC State Changed:', state);
    if (state === 'connected') {
      updateNavStatus('connected', 'P2P Connected');
      updatePeerStatus('connected', 'Peer Connected', 'Direct WebRTC DataChannel established.');
      hideError();
    } else if (state === 'connecting') {
      updatePeerStatus('waiting', 'Establishing Handshake...', 'Exchanging WebRTC SDP Offers & ICE Candidates.');
    } else {
      updateNavStatus('connected', 'Server Online');
      updatePeerStatus('disconnected', 'Disconnected', customMsg || 'No active WebRTC peer connection.');
    }
  };

  rtcManager.onFileMetadataReceived = (metadata) => {
    hideError();
    dropzone.classList.add('hidden');
    progressPanel.classList.remove('hidden');
    completionCard.classList.add('hidden');
    progressStatusText.textContent = `Receiving file: ${metadata.name}`;
  };

  rtcManager.onProgressUpdate = (stats) => {
    progressPanel.classList.remove('hidden');
    progressPercentage.textContent = `${stats.percentage}%`;
    progressBarFill.style.width = `${stats.percentage}%`;
    transferSpeedEl.textContent = `${stats.speedMBps.toFixed(2)} MB/s`;
    transferBytesEl.textContent = `${formatBytes(stats.transferredBytes)} / ${formatBytes(stats.totalBytes)}`;
    transferEtaEl.textContent = `${stats.etaSeconds}s`;

    if (stats.direction === 'sending') {
      progressStatusText.textContent = `Sending file via WebRTC (${stats.percentage}%)...`;
    } else {
      progressStatusText.textContent = `Receiving file via WebRTC (${stats.percentage}%)...`;
    }
  };

  rtcManager.onFileTransferComplete = (result) => {
    progressPanel.classList.add('hidden');
    completionCard.classList.remove('hidden');

    if (result.role === 'receiver') {
      completionTitle.textContent = 'File Transfer Completed!';
      completionDesc.textContent = `Successfully received "${result.fileName}" (${formatBytes(result.fileSize)}) at avg ${result.avgSpeedMBps.toFixed(2)} MB/s! File integrity verified.`;
      downloadActionBox.classList.remove('hidden');
      btnDownloadFile.href = result.downloadUrl;
      btnDownloadFile.download = result.fileName;
    } else {
      completionTitle.textContent = 'File Sent Successfully!';
      completionDesc.textContent = `"${result.fileName}" (${formatBytes(result.fileSize)}) was transmitted directly to the connected device.`;
      downloadActionBox.classList.add('hidden');
    }
  };

  rtcManager.onError = (msg) => {
    showError(`Transfer Error: ${msg}`);
    progressPanel.classList.add('hidden');
    dropzone.classList.remove('hidden');
  };

  // --- Selected File Management & Display ---

  function displaySelectedFile(file) {
    selectedFile = file;
    
    selectedFileNameEl.textContent = file.name;
    selectedFileSizeEl.textContent = formatBytes(file.size);
    selectedFileTypeEl.textContent = file.type || 'Binary Document';
    selectedFileIcon.className = getFileIconClass(file.name, file.type);

    selectedFileBanner.classList.remove('hidden');
    checkSendButtonState();
  }

  function clearSelectedFile() {
    selectedFile = null;
    fileInput.value = '';
    selectedFileBanner.classList.add('hidden');
    checkSendButtonState();
  }

  btnClearFile.addEventListener('click', clearSelectedFile);

  function checkSendButtonState() {
    const isConnected = rtcManager.dataChannel && rtcManager.dataChannel.readyState === 'open';
    if (selectedFile && isConnected) {
      btnSendFile.disabled = false;
    } else {
      btnSendFile.disabled = true;
    }
  }

  // --- File Drag & Drop Handlers ---

  btnBrowse.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      displaySelectedFile(e.target.files[0]);
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      displaySelectedFile(e.dataTransfer.files[0]);
    }
  });

  // Quick Demo Sample File Loader
  btnSampleFile.addEventListener('click', () => {
    const sampleSize = Math.round(12.4 * 1024 * 1024);
    const sampleText = "AirDrop-X Secure P2P File Transfer Demo Content. ".repeat(100);
    const blob = new Blob([sampleText.repeat(Math.ceil(sampleSize / sampleText.length))], { type: 'application/pdf' });
    const mockFile = new File([blob], 'Demo_Project_Presentation.pdf', { type: 'application/pdf' });
    
    displaySelectedFile(mockFile);
  });

  // --- Send File Event Handler ---
  btnSendFile.addEventListener('click', () => {
    if (!selectedFile) return;

    hideError();
    progressPanel.classList.remove('hidden');
    completionCard.classList.add('hidden');
    progressStatusText.textContent = `Preparing WebRTC stream...`;

    rtcManager.sendFile(selectedFile);
  });

  // Cancel Transfer Event
  btnCancelTransfer.addEventListener('click', () => {
    rtcManager.cancelTransfer();
    progressPanel.classList.add('hidden');
    checkSendButtonState();
  });

  // Transfer Another File Reset Button
  btnResetTransfer.addEventListener('click', () => {
    completionCard.classList.add('hidden');
    progressPanel.classList.add('hidden');
    dropzone.classList.remove('hidden');
    clearSelectedFile();
  });

  // Mobile Menu Toggle
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const navLinks = document.querySelector('.nav-links');

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
      if (navLinks.style.display === 'flex') {
        navLinks.style.display = 'none';
      } else {
        navLinks.style.display = 'flex';
        navLinks.style.flexDirection = 'column';
        navLinks.style.position = 'absolute';
        navLinks.style.top = '75px';
        navLinks.style.left = '0';
        navLinks.style.right = '0';
        navLinks.style.background = '#07090E';
        navLinks.style.padding = '1.5rem';
        navLinks.style.borderBottom = '1px solid var(--border-color)';
      }
    });
  }
});

