document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  const rtcManager = new WebRTCManager(socket);

  let selectedFile = null;
  let currentRoomCode = null;
  let deviceUIList = new Map();

  const navStatusDot = document.getElementById('nav-status-dot');
  const navStatusText = document.getElementById('nav-status-text');
  const connectionBadge = document.getElementById('connection-badge');
  const btnDisconnectPeer = document.getElementById('btn-disconnect-peer');
  const errorAlertBox = document.getElementById('error-alert-box');
  const errorAlertText = document.getElementById('error-alert-text');
  const btnCloseError = document.getElementById('btn-close-error');
  
  const tabCreate = document.getElementById('tab-create');
  const tabJoin = document.getElementById('tab-join');
  const viewCreate = document.getElementById('view-create');
  const viewJoin = document.getElementById('view-join');
  const btnGenerateCode = document.getElementById('btn-generate-code');
  const generatedCodeEl = document.getElementById('generated-code');
  const inputRoomCode = document.getElementById('input-room-code');
  const btnJoinRoom = document.getElementById('btn-join-room');

  const peerStatusTitle = document.getElementById('peer-status-title');
  const peerStatusDesc = document.getElementById('peer-status-desc');
  const peerStatusBox = document.getElementById('peer-status-box');

  const connectedDevicesSection = document.getElementById('connected-devices-section');
  const deviceList = document.getElementById('device-list');
  const deviceCount = document.getElementById('device-count');
  const btnSelectAll = document.getElementById('btn-select-all');

  const selectedFileBanner = document.getElementById('selected-file-banner');
  const selectedFileNameEl = document.getElementById('selected-file-name');
  const selectedFileSizeEl = document.getElementById('selected-file-size');
  const fileInput = document.getElementById('file-input');
  const btnBrowse = document.getElementById('btn-browse');
  const dropzone = document.getElementById('dropzone');
  
  const btnSendSelected = document.getElementById('btn-send-selected');
  const btnSendAll = document.getElementById('btn-send-all');
  
  const completionCard = document.getElementById('completion-card');
  const completionTitle = document.getElementById('completion-title');
  const completionDesc = document.getElementById('completion-desc');

  function showError(msg) {
    if (!msg) { errorAlertBox.classList.add('hidden'); return; }
    errorAlertText.textContent = msg;
    errorAlertBox.classList.remove('hidden');
  }
  function hideError() { errorAlertBox.classList.add('hidden'); }
  if (btnCloseError) btnCloseError.addEventListener('click', hideError);

  socket.on('connect', () => {
    navStatusDot.className = 'status-indicator-dot connected';
    navStatusText.textContent = 'Server Online';
  });

  tabCreate.addEventListener('click', () => {
    tabCreate.classList.add('active'); tabJoin.classList.remove('active');
    viewCreate.classList.add('active'); viewJoin.classList.remove('active');
  });

  tabJoin.addEventListener('click', () => {
    tabJoin.classList.add('active'); tabCreate.classList.remove('active');
    viewJoin.classList.add('active'); viewCreate.classList.remove('active');
  });

  btnGenerateCode.addEventListener('click', () => {
    hideError();
    rtcManager.cleanup();
    socket.emit('create-room', (res) => {
      if (res && res.success) {
        currentRoomCode = res.roomCode;
        generatedCodeEl.textContent = currentRoomCode;
        peerStatusTitle.textContent = 'Awaiting Receivers';
        peerStatusDesc.textContent = `Share code ${currentRoomCode}. Multiple devices can join!`;
        connectionBadge.textContent = 'Room Code Active';
        connectedDevicesSection.classList.remove('hidden');
        btnDisconnectPeer.classList.remove('hidden');
        deviceList.innerHTML = '';
        deviceUIList.clear();
        updateDeviceCount();
      }
    });
  });
  btnGenerateCode.click(); // Auto generate

  btnJoinRoom.addEventListener('click', () => {
    const code = inputRoomCode.value.trim();
    if(code.length !== 6) return showError('Invalid 6-digit code');
    rtcManager.cleanup();
    socket.emit('join-room', { roomCode: code }, (res) => {
      if (res && res.success) {
        currentRoomCode = code;
        peerStatusTitle.textContent = 'Joined Session';
        peerStatusDesc.textContent = `Waiting for host to send files...`;
        connectedDevicesSection.classList.add('hidden'); // Guests dont see other guests in UI for now
        btnDisconnectPeer.classList.remove('hidden');
      } else {
        showError(res.message);
      }
    });
  });

  btnDisconnectPeer.addEventListener('click', () => {
    socket.emit('leave-room', () => {
      rtcManager.cleanup();
      deviceList.innerHTML = '';
      deviceUIList.clear();
      connectedDevicesSection.classList.add('hidden');
      btnDisconnectPeer.classList.add('hidden');
      peerStatusTitle.textContent = 'Disconnected';
      peerStatusDesc.textContent = 'Session closed.';
    });
  });

  function updateDeviceCount() {
    deviceCount.textContent = deviceUIList.size;
    checkSendButtonState();
  }

  rtcManager.onPeerStateChange = (peerId, state) => {
    if (rtcManager.isHost) {
      if (state === 'connected' && !deviceUIList.has(peerId)) {
        // Add to UI
        const div = document.createElement('div');
        div.className = 'device-item';
        div.innerHTML = `
          <div class="device-item-top">
            <div class="device-item-left">
              <input type="checkbox" class="device-checkbox" value="${peerId}" checked>
              <div>
                <div class="device-name">Device ${peerId.substring(0,4)}</div>
                <div class="device-status" id="status-${peerId}">Connected</div>
              </div>
            </div>
          </div>
          <div class="device-progress-bar" id="progbar-${peerId}">
            <div class="device-progress-fill" id="progfill-${peerId}"></div>
          </div>
        `;
        deviceList.appendChild(div);
        deviceUIList.set(peerId, div);
        
        div.querySelector('.device-checkbox').addEventListener('change', checkSendButtonState);
        updateDeviceCount();
      } else if (state === 'disconnected' && deviceUIList.has(peerId)) {
        deviceUIList.get(peerId).remove();
        deviceUIList.delete(peerId);
        updateDeviceCount();
      }
    } else {
       // Receiver UI
       if(state === 'connected') {
         peerStatusTitle.textContent = 'Connected to Host';
         peerStatusDesc.textContent = 'Ready to receive files.';
       }
    }
    checkSendButtonState();
  };

  btnSelectAll.addEventListener('click', () => {
    document.querySelectorAll('.device-checkbox').forEach(cb => cb.checked = true);
    checkSendButtonState();
  });

  // Sending Logic
  function getSelectedPeers() {
    return Array.from(document.querySelectorAll('.device-checkbox:checked')).map(cb => cb.value);
  }

  function checkSendButtonState() {
    const selected = getSelectedPeers().length;
    const total = deviceUIList.size;
    
    if (selectedFile && selected > 0) {
      btnSendSelected.disabled = false;
    } else {
      btnSendSelected.disabled = true;
    }

    if (selectedFile && total > 0) {
      btnSendAll.disabled = false;
    } else {
      btnSendAll.disabled = true;
    }
  }

  btnBrowse.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      selectedFile = e.target.files[0];
      selectedFileNameEl.textContent = selectedFile.name;
      selectedFileBanner.classList.remove('hidden');
      checkSendButtonState();
    }
  });

  btnSendSelected.addEventListener('click', () => {
    const peers = getSelectedPeers();
    rtcManager.sendFile(selectedFile, peers);
  });

  btnSendAll.addEventListener('click', () => {
    btnSelectAll.click();
    rtcManager.sendFile(selectedFile, Array.from(deviceUIList.keys()));
  });

  rtcManager.onPeerProgress = (peerId, stats) => {
    if (rtcManager.isHost) {
      const progBar = document.getElementById(`progbar-${peerId}`);
      const progFill = document.getElementById(`progfill-${peerId}`);
      const statusEl = document.getElementById(`status-${peerId}`);
      if (progBar) {
        progBar.style.display = 'block';
        progFill.style.width = `${stats.percentage}%`;
        statusEl.textContent = `${stats.percentage}% (${stats.speedMBps.toFixed(1)} MB/s)`;
      }
    } else {
      // Single receiver progress
      completionCard.classList.remove('hidden');
      completionTitle.textContent = 'Receiving...';
      completionDesc.textContent = `${stats.percentage}% (${stats.speedMBps.toFixed(1)} MB/s)`;
    }
  };

  rtcManager.onPeerComplete = (peerId, result) => {
    if (rtcManager.isHost) {
      const statusEl = document.getElementById(`status-${peerId}`);
      if (statusEl) statusEl.textContent = '100% - Done ✓';
    } else {
      completionTitle.textContent = 'Download Complete!';
      completionDesc.innerHTML = `<a href="${result.downloadUrl}" download="${result.fileName}" class="btn btn-success">Download File</a>`;
    }
  };
  
  rtcManager.onSessionTerminated = () => {
      btnDisconnectPeer.click();
      showError("Host terminated the session.");
  };

});
