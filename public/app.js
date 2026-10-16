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
    const modeSelect = document.getElementById('select-room-mode');
    const mode = modeSelect ? modeSelect.value : 'multi';
    socket.emit('create-room', { mode }, (res) => {
      if (res && res.success) {
        currentRoomCode = res.roomCode;
        generatedCodeEl.textContent = currentRoomCode;
        const subtitleText = mode === 'single' 
          ? `Share code ${currentRoomCode} — waiting for 1 device.` 
          : `Share code ${currentRoomCode} — multiple devices can join!`;
        updatePeerStatus('waiting', 'Awaiting Receivers', subtitleText);
        connectionBadge.textContent = 'Room Active';
        connectionBadge.className = 'badge badge-outline';
        connectedSection.classList.remove('hidden');
        btnDisconnectPeer.classList.remove('hidden');
        updateChatRoom(currentRoomCode, true);
        appendSystemMessage(`Room #${currentRoomCode} created. Share code to start chatting & transferring files.`);
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
        updateChatRoom(currentRoomCode, true);
        appendSystemMessage(`Joined Room #${currentRoomCode}. You can now send messages and links!`);
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
      updateChatRoom(null, false);
      appendSystemMessage('Session closed.');
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

  // ═══════════════════════════════════════════════════════════════
  //  AirDrop-X Instant Room Chat & Link Sharing Module
  // ═══════════════════════════════════════════════════════════════

  // Chat DOM elements
  const navChatBtn            = document.getElementById('nav-chat-btn');
  const navChatBadge          = document.getElementById('nav-chat-badge');
  const btnShortcutOpenChat   = document.getElementById('btn-shortcut-open-chat');
  const shortcutChatBadge     = document.getElementById('shortcut-chat-badge');
  const chatLauncherBtn       = document.getElementById('chat-launcher-btn');
  const chatUnreadBadge       = document.getElementById('chat-unread-badge');
  const chatWindowPanel       = document.getElementById('chat-window-panel');
  const chatStatusDot         = document.getElementById('chat-status-dot');
  const chatRoomBadge         = document.getElementById('chat-room-badge');
  const chatSubtitle          = document.getElementById('chat-subtitle');
  const btnToggleSound        = document.getElementById('btn-toggle-sound');
  const soundIcon             = document.getElementById('sound-icon');
  const btnClearChat          = document.getElementById('btn-clear-chat');
  const btnCloseChat          = document.getElementById('btn-close-chat');
  const btnQuickUrl           = document.getElementById('btn-quick-url');
  const btnPasteClipboard     = document.getElementById('btn-paste-clipboard');
  const btnShareSampleLink    = document.getElementById('btn-share-sample-link');
  const chatMessagesContainer = document.getElementById('chat-messages-container');
  const chatEmptyState        = document.getElementById('chat-empty-state');
  const chatTypingIndicator   = document.getElementById('chat-typing-indicator');
  const chatTypingText        = document.getElementById('chat-typing-text');
  const btnToggleEmoji        = document.getElementById('btn-toggle-emoji');
  const chatEmojiDrawer       = document.getElementById('chat-emoji-drawer');
  const chatInputForm         = document.getElementById('chat-input-form');
  const chatInputField        = document.getElementById('chat-input-field');

  let isChatOpen = false;
  let unreadCount = 0;
  let soundEnabled = true;
  let typingTimeout = null;
  let lastTypingTime = 0;

  function updateUnreadBadges() {
    if (unreadCount > 0) {
      const displayCount = unreadCount > 99 ? '99+' : String(unreadCount);
      if (chatUnreadBadge) {
        chatUnreadBadge.textContent = displayCount;
        chatUnreadBadge.classList.remove('hidden');
      }
      if (navChatBadge) {
        navChatBadge.textContent = displayCount;
        navChatBadge.classList.remove('hidden');
      }
      if (shortcutChatBadge) {
        shortcutChatBadge.textContent = displayCount;
        shortcutChatBadge.classList.remove('hidden');
      }
    } else {
      if (chatUnreadBadge) chatUnreadBadge.classList.add('hidden');
      if (navChatBadge) navChatBadge.classList.add('hidden');
      if (shortcutChatBadge) shortcutChatBadge.classList.add('hidden');
    }
  }

  function openChat() {
    if (!chatWindowPanel) return;
    chatWindowPanel.classList.remove('hidden');
    if (chatLauncherBtn) chatLauncherBtn.classList.add('is-open');
    isChatOpen = true;
    unreadCount = 0;
    updateUnreadBadges();
    scrollChatToBottom();
    if (chatInputField) chatInputField.focus();
  }

  function closeChat() {
    if (!chatWindowPanel) return;
    chatWindowPanel.classList.add('hidden');
    if (chatLauncherBtn) chatLauncherBtn.classList.remove('is-open');
    if (chatEmojiDrawer) chatEmojiDrawer.classList.add('hidden');
    isChatOpen = false;
  }

  function toggleChat() {
    if (isChatOpen) closeChat();
    else openChat();
  }

  function updateChatRoom(code, isConnected) {
    if (code) {
      if (chatRoomBadge) chatRoomBadge.textContent = '#' + code;
      if (chatSubtitle) chatSubtitle.textContent = isConnected ? `Active in Room #${code}` : `Room #${code} ready`;
      if (chatStatusDot) chatStatusDot.className = 'chat-status-dot connected';
    } else {
      if (chatRoomBadge) chatRoomBadge.textContent = 'No Room';
      if (chatSubtitle) chatSubtitle.textContent = 'Pair devices to start chatting';
      if (chatStatusDot) chatStatusDot.className = 'chat-status-dot disconnected';
    }
  }

  function playNotificationChime() {
    if (!soundEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch (_) {}
  }

  const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|www\.[^\s<]+[^<.,:;"')\]\s])/gi;

  function extractUrls(text) {
    if (!text) return [];
    const matches = text.match(URL_REGEX);
    if (!matches) return [];
    const unique = [...new Set(matches)];
    return unique.map(url => {
      let clean = url.trim();
      let href = clean;
      if (!href.startsWith('http://') && !href.startsWith('https://')) {
        href = 'https://' + href;
      }
      return { raw: url, href: href };
    });
  }

  function getIconForUrl(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (host.includes('youtube.com') || host.includes('youtu.be')) return { icon: 'ri-youtube-fill', cls: 'icon-yt' };
      if (host.includes('github.com')) return { icon: 'ri-github-fill', cls: 'icon-gh' };
      if (host.includes('drive.google.com') || host.includes('docs.google.com')) return { icon: 'ri-google-drive-fill', cls: 'icon-gd' };
      if (host.includes('twitter.com') || host.includes('x.com')) return { icon: 'ri-twitter-x-fill', cls: 'icon-tw' };
      if (host.includes('instagram.com')) return { icon: 'ri-instagram-line', cls: 'icon-ig' };
      if (host.includes('linkedin.com')) return { icon: 'ri-linkedin-box-fill', cls: 'icon-li' };
      if (host.includes('discord.com') || host.includes('discord.gg')) return { icon: 'ri-discord-fill', cls: 'icon-dc' };
      if (host.includes('figma.com')) return { icon: 'ri-figma-line', cls: 'icon-figma' };
      return { icon: 'ri-global-line', cls: 'icon-web' };
    } catch (_) {
      return { icon: 'ri-global-line', cls: 'icon-web' };
    }
  }

  function getDomainFromUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch (_) {
      return 'Web Link';
    }
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatMessageText(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(URL_REGEX, (match) => {
      let href = match;
      if (!href.startsWith('http://') && !href.startsWith('https://')) {
        href = 'https://' + href;
      }
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="chat-inline-link" title="Open Link">${match} <i class="ri-external-link-line"></i></a>`;
    });
  }

  function scrollChatToBottom() {
    if (chatMessagesContainer) {
      chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
  }

  function appendChatMessage(data, isOutgoing) {
    if (chatEmptyState) chatEmptyState.classList.add('hidden');

    const timeStr = new Date(data.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const row = document.createElement('div');
    row.className = `chat-msg-row ${isOutgoing ? 'outgoing' : 'incoming'}`;

    const urls = extractUrls(data.text);
    let linkCardsHtml = '';

    if (urls.length > 0) {
      linkCardsHtml = urls.map(u => {
        const meta = getIconForUrl(u.href);
        const domain = getDomainFromUrl(u.href);
        return `
          <div class="chat-rich-link-card">
            <div class="link-card-header">
              <div class="link-icon-box ${meta.cls}">
                <i class="${meta.icon}"></i>
              </div>
              <div class="link-meta">
                <span class="link-domain">${escapeHtml(domain)}</span>
                <span class="link-full-url" title="${escapeHtml(u.href)}">${escapeHtml(u.href)}</span>
              </div>
            </div>
            <div class="link-card-actions">
              <a href="${escapeHtml(u.href)}" target="_blank" rel="noopener noreferrer" class="btn-link-action btn-link-open" title="Open link in new tab">
                <i class="ri-external-link-line"></i> Open Link
              </a>
              <button type="button" class="btn-link-action btn-link-copy" data-url="${escapeHtml(u.href)}" title="Copy link to clipboard">
                <i class="ri-file-copy-line"></i> Copy
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    const senderHtml = isOutgoing ? '' : `<div class="chat-msg-sender">${escapeHtml(data.senderName || 'Peer')}</div>`;

    row.innerHTML = `
      ${senderHtml}
      <div class="chat-msg-bubble">
        <div class="chat-msg-content">${formatMessageText(data.text)}</div>
        ${linkCardsHtml}
        <div class="chat-msg-meta">
          <span>${timeStr}</span>
          ${isOutgoing ? '<i class="ri-check-double-line"></i>' : ''}
        </div>
      </div>
    `;

    row.querySelectorAll('.btn-link-copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const urlToCopy = btn.getAttribute('data-url');
        if (urlToCopy) {
          navigator.clipboard.writeText(urlToCopy).then(() => {
            btn.innerHTML = '<i class="ri-check-line"></i> Copied!';
            setTimeout(() => {
              btn.innerHTML = '<i class="ri-file-copy-line"></i> Copy';
            }, 2000);
          }).catch(() => {});
        }
      });
    });

    chatMessagesContainer.appendChild(row);
    scrollChatToBottom();
  }

  function appendSystemMessage(text) {
    if (!chatMessagesContainer) return;
    if (chatEmptyState) chatEmptyState.classList.add('hidden');
    const row = document.createElement('div');
    row.className = 'chat-msg-row system';
    row.innerHTML = `<div class="chat-system-pill">${escapeHtml(text)}</div>`;
    chatMessagesContainer.appendChild(row);
    scrollChatToBottom();
  }

  // Socket chat listeners
  socket.on('chat-message', (data) => {
    const isOutgoing = data.senderId === socket.id;
    appendChatMessage(data, isOutgoing);

    if (!isOutgoing) {
      if (!isChatOpen) {
        unreadCount++;
        updateUnreadBadges();
      }
      playNotificationChime();
    }
  });

  socket.on('chat-system-message', (data) => {
    if (data && data.text) {
      appendSystemMessage(data.text);
    }
  });

  socket.on('peer-typing', ({ senderName, isTyping }) => {
    if (!chatTypingIndicator || !chatTypingText) return;
    if (isTyping) {
      chatTypingText.textContent = `${senderName || 'Someone'} is typing...`;
      chatTypingIndicator.classList.remove('hidden');
      scrollChatToBottom();
    } else {
      chatTypingIndicator.classList.add('hidden');
    }
  });

  // Controls & Button bindings
  if (chatLauncherBtn) chatLauncherBtn.addEventListener('click', toggleChat);
  if (btnCloseChat) btnCloseChat.addEventListener('click', closeChat);
  if (navChatBtn) navChatBtn.addEventListener('click', openChat);
  if (btnShortcutOpenChat) btnShortcutOpenChat.addEventListener('click', openChat);

  if (btnToggleSound) {
    btnToggleSound.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      if (soundIcon) {
        soundIcon.className = soundEnabled ? 'ri-volume-up-line' : 'ri-volume-mute-line';
      }
      btnToggleSound.title = soundEnabled ? 'Mute Sound' : 'Unmute Sound';
    });
  }

  if (btnClearChat) {
    btnClearChat.addEventListener('click', () => {
      if (chatMessagesContainer) {
        chatMessagesContainer.querySelectorAll('.chat-msg-row').forEach(el => el.remove());
        if (chatEmptyState) chatEmptyState.classList.remove('hidden');
      }
    });
  }

  if (btnQuickUrl) {
    btnQuickUrl.addEventListener('click', () => {
      if (!chatInputField) return;
      if (!chatInputField.value.startsWith('http://') && !chatInputField.value.startsWith('https://')) {
        chatInputField.value = 'https://' + chatInputField.value;
      }
      chatInputField.focus();
    });
  }

  if (btnPasteClipboard) {
    btnPasteClipboard.addEventListener('click', async () => {
      if (!chatInputField) return;
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          chatInputField.value = text.trim();
          chatInputField.focus();
        }
      } catch (_) {
        chatInputField.focus();
      }
    });
  }

  if (btnShareSampleLink) {
    btnShareSampleLink.addEventListener('click', () => {
      if (!chatInputField) return;
      const samples = [
        'https://www.youtube.com',
        'https://github.com',
        'https://drive.google.com',
        'https://en.wikipedia.org'
      ];
      const randomSample = samples[Math.floor(Math.random() * samples.length)];
      chatInputField.value = randomSample;
      chatInputField.focus();
    });
  }

  if (btnToggleEmoji && chatEmojiDrawer) {
    btnToggleEmoji.addEventListener('click', (e) => {
      e.stopPropagation();
      chatEmojiDrawer.classList.toggle('hidden');
    });

    chatEmojiDrawer.querySelectorAll('.emoji-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const emoji = chip.getAttribute('data-emoji');
        if (emoji && chatInputField) {
          chatInputField.value += emoji;
          chatInputField.focus();
        }
        chatEmojiDrawer.classList.add('hidden');
      });
    });

    document.addEventListener('click', (e) => {
      if (!chatEmojiDrawer.contains(e.target) && e.target !== btnToggleEmoji) {
        chatEmojiDrawer.classList.add('hidden');
      }
    });
  }

  // Input typing indicator & sending
  if (chatInputField) {
    chatInputField.addEventListener('input', () => {
      if (!currentRoomCode) return;
      const now = Date.now();
      if (now - lastTypingTime > 1500) {
        socket.emit('typing', { isTyping: true });
        lastTypingTime = now;
      }
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        socket.emit('typing', { isTyping: false });
      }, 1800);
    });
  }

  if (chatInputForm) {
    chatInputForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!chatInputField) return;
      const text = chatInputField.value.trim();
      if (!text) return;

      if (!currentRoomCode) {
        showError('Please generate or join a room code before sending messages.');
        return;
      }

      const myName = rtcManager.isHost ? 'Host' : `Device ${socket.id ? socket.id.substring(0, 4).toUpperCase() : 'Guest'}`;

      socket.emit('send-chat', { text, senderName: myName }, (res) => {
        if (!res || !res.success) {
          showError((res && res.message) || 'Failed to send message.');
        }
      });

      socket.emit('typing', { isTyping: false });
      clearTimeout(typingTimeout);
      chatInputField.value = '';
      chatInputField.focus();
    });
  }
});
