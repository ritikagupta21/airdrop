/**
 * AirDrop-X v2.1 - Main Client Application Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  const rtcManager = new WebRTCManager(socket);

  let selectedFile = null;
  let currentRoomCode = null;
  let deviceUIList = new Map(); // peerId -> DOM element

  // ── DOM refs ──────────────────────────────────────────────────
  const navStatusDot       = document.getElementById('nav-status-dot');
  const navStatusText      = document.getElementById('nav-status-text');
  const connectionBadge    = document.getElementById('connection-badge');
  const btnDisconnectPeer  = document.getElementById('btn-disconnect-peer');
  const errorAlertBox      = document.getElementById('error-alert-box');
  const errorAlertText     = document.getElementById('error-alert-text');
  const btnCloseError      = document.getElementById('btn-close-error');
  const selectNetworkMode  = document.getElementById('select-network-mode');

  const tabCreate          = document.getElementById('tab-create');
  const tabJoin            = document.getElementById('tab-join');
  const viewCreate         = document.getElementById('view-create');
  const viewJoin           = document.getElementById('view-join');
  const btnGenerateCode    = document.getElementById('btn-generate-code');
  const generatedCodeEl    = document.getElementById('generated-code');
  const btnCopyCode        = document.getElementById('btn-copy-code');
  const inputRoomCode      = document.getElementById('input-room-code');
  const btnJoinRoom        = document.getElementById('btn-join-room');

  const peerIconWrapper    = document.getElementById('peer-icon-wrapper');
  const peerStatusIcon     = document.getElementById('peer-status-icon');
  const peerStatusTitle    = document.getElementById('peer-status-title');
  const peerStatusDesc     = document.getElementById('peer-status-desc');

  const connectedSection   = document.getElementById('connected-devices-section');
  const deviceListEl       = document.getElementById('device-list');
  const deviceCountEl      = document.getElementById('device-count');
  const btnSelectAll       = document.getElementById('btn-select-all');

  const selectedFileBanner = document.getElementById('selected-file-banner');
  const selectedFileNameEl = document.getElementById('selected-file-name');
  const selectedFileSizeEl = document.getElementById('selected-file-size');
  const selectedFileTypeEl = document.getElementById('selected-file-type');
  const selectedFileIcon   = document.getElementById('selected-file-icon');
  const btnClearFile       = document.getElementById('btn-clear-file');

  const dropzone           = document.getElementById('dropzone');
  const fileInput          = document.getElementById('file-input');
  const btnBrowse          = document.getElementById('btn-browse');
  const btnSampleFile      = document.getElementById('btn-sample-file');

  const btnSendSelected    = document.getElementById('btn-send-selected');
  const btnSendAll         = document.getElementById('btn-send-all');

  const progressPanel      = document.getElementById('progress-panel');
  const progressStatusText = document.getElementById('progress-status-text');
  const progressPercentage = document.getElementById('progress-percentage');
  const progressBarFill    = document.getElementById('progress-bar-fill');
  const transferSpeedEl    = document.getElementById('transfer-speed');
  const transferBytesEl    = document.getElementById('transfer-bytes');
  const transferEtaEl      = document.getElementById('transfer-eta');
  const btnCancelTransfer  = document.getElementById('btn-cancel-transfer');

  const completionCard     = document.getElementById('completion-card');
  const completionTitle    = document.getElementById('completion-title');
  const completionDesc     = document.getElementById('completion-desc');
  const downloadActionBox  = document.getElementById('download-action-box');
  const btnDownloadFile    = document.getElementById('btn-download-file');
  const btnResetTransfer   = document.getElementById('btn-reset-transfer');

  // ── Helpers ───────────────────────────────────────────────────
  function showError(msg) {
    errorAlertText.textContent = msg;
    errorAlertBox.classList.remove('hidden');
  }
  function hideError() { errorAlertBox.classList.add('hidden'); }
  btnCloseError && btnCloseError.addEventListener('click', hideError);

  function formatBytes(b) {
    if (!b) return '0 B';
    const k = 1024, s = ['B','KB','MB','GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return (b / Math.pow(k, i)).toFixed(2) + ' ' + s[i];
  }

  function getFileIcon(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    if (['pdf'].includes(ext)) return 'ri-file-pdf-2-line';
    if (['jpg','jpeg','png','gif','svg','webp'].includes(ext)) return 'ri-image-line';
    if (['mp4','mkv','avi','mov','webm'].includes(ext)) return 'ri-video-line';
    if (['mp3','wav','flac','aac','ogg'].includes(ext)) return 'ri-music-2-line';
    if (['zip','rar','7z','tar','gz'].includes(ext)) return 'ri-folder-zip-line';
    if (['doc','docx','txt','md'].includes(ext)) return 'ri-file-text-line';
    if (['xls','xlsx','csv'].includes(ext)) return 'ri-file-excel-line';
    return 'ri-file-3-line';
  }

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
    } else if (status === 'waiting') {
      peerStatusIcon.className = 'ri-radar-line';
    } else {
      peerStatusIcon.className = 'ri-error-warning-line';
      connectionBadge.textContent = 'Disconnected';
      connectionBadge.className = 'badge badge-outline';
    }
    checkSendButtons();
  }

  // ── Network mode ──────────────────────────────────────────────
  selectNetworkMode.addEventListener('change', (e) => {
    rtcManager.setNetworkMode(e.target.value);
  });

  // ── Socket events ─────────────────────────────────────────────
  socket.on('connect', () => updateNavStatus('connected', 'Server Online'));
  socket.on('disconnect', () => {
    updateNavStatus('disconnected', 'Disconnected');
    updatePeerStatus('disconnected', 'Disconnected', 'Lost connection to signaling server.');
  });

  // ── Tabs ──────────────────────────────────────────────────────
  tabCreate.addEventListener('click', () => {
    hideError();
    tabCreate.classList.add('active'); tabJoin.classList.remove('active');
    viewCreate.classList.add('active'); viewJoin.classList.remove('active');
  });
  tabJoin.addEventListener('click', () => {
    hideError();
    tabJoin.classList.add('active'); tabCreate.classList.remove('active');
    viewJoin.classList.add('active'); viewCreate.classList.remove('active');
  });

  // ── Generate code ─────────────────────────────────────────────
  btnGenerateCode.addEventListener('click', () => {
    hideError();
    rtcManager.cleanup();
    clearDeviceList();
    socket.emit('create-room', (res) => {
      if (res && res.success) {
        currentRoomCode = res.roomCode;
        generatedCodeEl.textContent = currentRoomCode;
        updatePeerStatus('waiting', 'Awaiting Receivers', `Share code ${currentRoomCode} — multiple devices can join!`);
        connectionBadge.textContent = 'Room Active';
        connectionBadge.className = 'badge badge-outline';
        connectedSection.classList.remove('hidden');
        btnDisconnectPeer.classList.remove('hidden');
      } else {
        showError('Failed to generate room code.');
      }
    });
  });
  btnGenerateCode.click(); // auto-generate on load

  // ── Copy code ─────────────────────────────────────────────────
  btnCopyCode.addEventListener('click', () => {
    if (currentRoomCode && currentRoomCode !== '------') {
      navigator.clipboard.writeText(currentRoomCode).then(() => {
        btnCopyCode.innerHTML = '<i class="ri-check-line"></i>';
        setTimeout(() => { btnCopyCode.innerHTML = '<i class="ri-file-copy-line"></i>'; }, 2000);
      }).catch(() => {});
    }
  });

  // ── Join room ─────────────────────────────────────────────────
  btnJoinRoom.addEventListener('click', () => {
    hideError();
    const code = inputRoomCode.value.trim();
    if (code.length !== 6 || isNaN(code)) {
      showError('Please enter a valid 6-digit code.');
      return;
    }
    rtcManager.cleanup();
    socket.emit('join-room', { roomCode: code }, (res) => {
      if (res && res.success) {
        currentRoomCode = code;
        updatePeerStatus('waiting', 'Joining...', `Connecting to session ${code}...`);
        connectedSection.classList.add('hidden');
        btnDisconnectPeer.classList.remove('hidden');
      } else {
        showError(res ? res.message : 'Failed to join room.');
      }
    });
  });

  inputRoomCode.addEventListener('keyup', (e) => { if (e.key === 'Enter') btnJoinRoom.click(); });

  // ── Disconnect ────────────────────────────────────────────────
  btnDisconnectPeer.addEventListener('click', () => {
    hideError();
    socket.emit('leave-room', () => {
      rtcManager.cleanup();
      currentRoomCode = null;
      clearDeviceList();
      connectedSection.classList.add('hidden');
      btnDisconnectPeer.classList.add('hidden');
      updateNavStatus('connected', 'Server Online');
      updatePeerStatus('disconnected', 'Disconnected', 'Session closed. Generate or join a new session.');
      clearSelectedFile();
      progressPanel.classList.add('hidden');
      completionCard.classList.add('hidden');
      dropzone.classList.remove('hidden');
    });
  });

  // ── Connected Devices ─────────────────────────────────────────
  function clearDeviceList() {
    deviceListEl.innerHTML = '';
    deviceUIList.clear();
    deviceCountEl.textContent = '0';
    checkSendButtons();
  }

  function updateDeviceCount() {
    deviceCountEl.textContent = deviceUIList.size;
    checkSendButtons();
  }

  btnSelectAll.addEventListener('click', () => {
    document.querySelectorAll('.device-checkbox').forEach(cb => cb.checked = true);
    checkSendButtons();
  });

  function getSelectedPeers() {
    return [...document.querySelectorAll('.device-checkbox:checked')].map(cb => cb.value);
  }

  // ── WebRTC callbacks ──────────────────────────────────────────
  rtcManager.onPeerStateChange = (peerId, state) => {
    if (rtcManager.isHost) {
      if (state === 'connected' && !deviceUIList.has(peerId)) {
        const shortId = peerId.substring(0, 6).toUpperCase();
        const div = document.createElement('div');
        div.className = 'device-item';
        div.innerHTML = `
          <div class="device-item-top">
            <div class="device-item-left">
              <input type="checkbox" class="device-checkbox" value="${peerId}" checked>
              <div>
                <div class="device-name"><i class="ri-smartphone-line"></i> Device ${shortId}</div>
                <div class="device-status" id="dstatus-${peerId}">✓ Connected</div>
              </div>
            </div>
          </div>
          <div class="device-progress-bar" id="dprogbar-${peerId}">
            <div class="device-progress-fill" id="dprogfill-${peerId}"></div>
          </div>
          <div class="device-progress-label hidden" id="dproglabel-${peerId}"></div>
        `;
        deviceListEl.appendChild(div);
        deviceUIList.set(peerId, div);
        div.querySelector('.device-checkbox').addEventListener('change', checkSendButtons);
        updateDeviceCount();
        updateNavStatus('connected', `${deviceUIList.size} Device(s) Connected`);
      } else if ((state === 'disconnected' || state === 'failed' || state === 'closed') && deviceUIList.has(peerId)) {
        deviceUIList.get(peerId).remove();
        deviceUIList.delete(peerId);
        updateDeviceCount();
        updateNavStatus('connected', deviceUIList.size > 0 ? `${deviceUIList.size} Device(s) Connected` : 'Server Online');
      }
    } else {
      // Receiver
      if (state === 'connected') {
        updateNavStatus('connected', 'P2P Connected');
        updatePeerStatus('connected', 'Connected to Host', 'WebRTC DataChannel established. Ready to receive.');
        hideError();
      } else if (state === 'disconnected' || state === 'failed') {
        updateNavStatus('connected', 'Server Online');
        updatePeerStatus('disconnected', 'Disconnected', 'Connection to host lost.');
      }
    }
    checkSendButtons();
  };

  rtcManager.onFileMetadata = (meta) => {
    hideError();
    dropzone.classList.add('hidden');
    progressPanel.classList.remove('hidden');
    completionCard.classList.add('hidden');
    progressStatusText.textContent = `Receiving: ${meta.name}`;
  };

  rtcManager.onPeerProgress = (peerId, stats) => {
    if (rtcManager.isHost) {
      // Per-device progress bar
      const bar = document.getElementById(`dprogbar-${peerId}`);
      const fill = document.getElementById(`dprogfill-${peerId}`);
      const label = document.getElementById(`dproglabel-${peerId}`);
      const status = document.getElementById(`dstatus-${peerId}`);
      if (bar) {
        bar.style.display = 'block';
        fill.style.width = `${stats.percentage}%`;
        if (label) {
          label.classList.remove('hidden');
          label.textContent = `${stats.percentage}% · ${stats.speedMBps.toFixed(1)} MB/s · ${formatBytes(stats.transferred)} / ${formatBytes(stats.total)}`;
        }
        if (status) status.textContent = `Sending ${stats.percentage}%...`;
      }
      // Also update global progress bar for overall view
      progressPanel.classList.remove('hidden');
      progressPercentage.textContent = `${stats.percentage}%`;
      progressBarFill.style.width = `${stats.percentage}%`;
      transferSpeedEl.textContent = `${stats.speedMBps.toFixed(2)} MB/s`;
      transferBytesEl.textContent = `${formatBytes(stats.transferred)} / ${formatBytes(stats.total)}`;
      transferEtaEl.textContent = stats.eta ? `${stats.eta}s` : '...';
      progressStatusText.textContent = `Sending ${stats.percentage}%...`;
    } else {
      // Receiver
      progressPanel.classList.remove('hidden');
      completionCard.classList.add('hidden');
      progressPercentage.textContent = `${stats.percentage}%`;
      progressBarFill.style.width = `${stats.percentage}%`;
      transferSpeedEl.textContent = `${stats.speedMBps.toFixed(2)} MB/s`;
      transferBytesEl.textContent = `${formatBytes(stats.transferred)} / ${formatBytes(stats.total)}`;
      progressStatusText.textContent = `Receiving ${stats.percentage}%...`;
    }
  };

  rtcManager.onPeerComplete = (peerId, result) => {
    if (rtcManager.isHost) {
      const status = document.getElementById(`dstatus-${peerId}`);
      const label = document.getElementById(`dproglabel-${peerId}`);
      if (status) status.textContent = '✓ Transfer Complete';
      if (label) label.textContent = `Done · Avg ${result.speedMBps.toFixed(2)} MB/s`;
      // Check if ALL active transfers are done
      progressPanel.classList.add('hidden');
      completionCard.classList.remove('hidden');
      completionTitle.textContent = 'File Sent Successfully!';
      completionDesc.textContent = `"${selectedFile ? selectedFile.name : 'File'}" was transmitted to all selected devices.`;
      downloadActionBox.classList.add('hidden');
    } else {
      // Receiver — show download
      progressPanel.classList.add('hidden');
      completionCard.classList.remove('hidden');
      completionTitle.textContent = 'Transfer Complete!';
      completionDesc.textContent = `"${result.fileName}" received at avg ${result.speedMBps.toFixed(2)} MB/s.`;
      downloadActionBox.classList.remove('hidden');
      btnDownloadFile.href = result.downloadUrl;
      btnDownloadFile.download = result.fileName;
    }
  };

  rtcManager.onError = (msg) => {
    showError(msg);
    progressPanel.classList.add('hidden');
    dropzone.classList.remove('hidden');
    checkSendButtons();
  };

  rtcManager.onSessionTerminated = () => {
    btnDisconnectPeer.click();
    showError('Host ended the session.');
  };

  // ── File selection ────────────────────────────────────────────
  function displaySelectedFile(file) {
    selectedFile = file;
    selectedFileNameEl.textContent = file.name;
    selectedFileSizeEl.textContent = formatBytes(file.size);
    selectedFileTypeEl.textContent = file.type || 'Binary File';
    selectedFileIcon.className = getFileIcon(file.name);
    selectedFileBanner.classList.remove('hidden');
    checkSendButtons();
  }

  function clearSelectedFile() {
    selectedFile = null;
    fileInput.value = '';
    selectedFileBanner.classList.add('hidden');
    checkSendButtons();
  }

  btnClearFile.addEventListener('click', clearSelectedFile);

  function checkSendButtons() {
    const hasFile = !!selectedFile;
    const selected = getSelectedPeers().length;
    const total = deviceUIList.size;
    btnSendSelected.disabled = !(hasFile && selected > 0);
    btnSendAll.disabled = !(hasFile && total > 0);
  }

  // ── Drag & Drop ───────────────────────────────────────────────
  btnBrowse.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener('click', (e) => {
    if (e.target === btnBrowse || btnBrowse.contains(e.target)) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) displaySelectedFile(e.target.files[0]);
  });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) displaySelectedFile(e.dataTransfer.files[0]);
  });

  // ── Sample file ───────────────────────────────────────────────
  btnSampleFile.addEventListener('click', () => {
    const size = Math.round(12.4 * 1024 * 1024);
    const text = 'AirDrop-X Demo Content. '.repeat(500);
    const blob = new Blob([text.repeat(Math.ceil(size / text.length))], { type: 'application/pdf' });
    displaySelectedFile(new File([blob], 'Demo_Project_Presentation.pdf', { type: 'application/pdf' }));
  });

  // ── Send buttons ──────────────────────────────────────────────
  btnSendSelected.addEventListener('click', () => {
    if (!selectedFile) return;
    const peers = getSelectedPeers();
    if (peers.length === 0) { showError('Please select at least one device.'); return; }
    hideError();
    progressPanel.classList.remove('hidden');
    completionCard.classList.add('hidden');
    progressStatusText.textContent = 'Preparing transfer...';
    rtcManager.sendFile(selectedFile, peers);
  });

  btnSendAll.addEventListener('click', () => {
    if (!selectedFile) return;
    document.querySelectorAll('.device-checkbox').forEach(cb => cb.checked = true);
    const peers = [...deviceUIList.keys()];
    if (peers.length === 0) { showError('No devices connected.'); return; }
    hideError();
    progressPanel.classList.remove('hidden');
    completionCard.classList.add('hidden');
    progressStatusText.textContent = 'Preparing transfer...';
    rtcManager.sendFile(selectedFile, peers);
  });

  btnCancelTransfer.addEventListener('click', () => {
    rtcManager.cancelTransfer();
    progressPanel.classList.add('hidden');
    dropzone.classList.remove('hidden');
    checkSendButtons();
  });

  btnResetTransfer.addEventListener('click', () => {
    completionCard.classList.add('hidden');
    progressPanel.classList.add('hidden');
    dropzone.classList.remove('hidden');
    clearSelectedFile();
    // Reset device status
    deviceUIList.forEach((_, peerId) => {
      const status = document.getElementById(`dstatus-${peerId}`);
      const bar = document.getElementById(`dprogbar-${peerId}`);
      const fill = document.getElementById(`dprogfill-${peerId}`);
      const label = document.getElementById(`dproglabel-${peerId}`);
      if (status) status.textContent = '✓ Connected';
      if (bar) bar.style.display = 'none';
      if (fill) fill.style.width = '0%';
      if (label) { label.textContent = ''; label.classList.add('hidden'); }
    });
  });

  // ── Mobile menu ───────────────────────────────────────────────
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const navLinks = document.querySelector('.nav-links');
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
      const isOpen = navLinks.style.display === 'flex';
      navLinks.style.display = isOpen ? 'none' : 'flex';
      if (!isOpen) {
        navLinks.style.flexDirection = 'column';
        navLinks.style.position = 'absolute';
        navLinks.style.top = '75px';
        navLinks.style.left = '0';
        navLinks.style.right = '0';
        navLinks.style.background = 'var(--bg-secondary)';
        navLinks.style.padding = '1.5rem';
        navLinks.style.borderBottom = '1px solid var(--border-color)';
        navLinks.style.zIndex = '999';
      }
    });
  }
});
