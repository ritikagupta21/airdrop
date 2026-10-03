const CHUNK_SIZE = 64 * 1024;

const STUN_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const LAN_CONFIG = {
  iceServers: []
};

class WebRTCManager {
  constructor(socket) {
    this.socket = socket;
    
    // Map of peerId -> { peerConnection, dataChannel, iceCandidateQueue, state, transferState }
    this.peers = new Map();
    
    this.networkMode = 'auto'; // 'auto' (stun) or 'lan'
    this.isHost = false; // Sender is Host
    
    // Callbacks
    this.onPeerStateChange = null; // (peerId, state)
    this.onPeerProgress = null; // (peerId, stats)
    this.onPeerComplete = null; // (peerId, result)
    this.onFileMetadata = null; // (metadata) for receiver
    this.onError = null;
    this.onSessionTerminated = null;

    // Sender state
    this.currentFile = null;
    this.isSending = false;
    this.sendOffset = 0;
    this.sendStartTime = 0;
    this.activeReceivers = new Set(); // peerIds to send to

    this._setupSocketListeners();
  }

  setNetworkMode(mode) {
    this.networkMode = mode;
  }

  getIceConfig() {
    return this.networkMode === 'lan' ? LAN_CONFIG : STUN_CONFIG;
  }

  _setupSocketListeners() {
    this.socket.on('signal', async ({ sender, signalData }) => {
      await this._handleSignalData(sender, signalData);
    });

    this.socket.on('peer-joined', async ({ peerId }) => {
      console.log('[WebRTC] Peer joined:', peerId);
      this.isHost = true;
      await this.initiateConnection(peerId);
    });

    this.socket.on('peer-left', ({ peerId }) => {
      console.log('[WebRTC] Peer left:', peerId);
      this._removePeer(peerId);
      if (this.onPeerStateChange) {
        this.onPeerStateChange(peerId, 'disconnected');
      }
    });

    this.socket.on('session-terminated', () => {
      console.log('[WebRTC] Session terminated by host');
      this.cleanup();
      if (this.onSessionTerminated) {
        this.onSessionTerminated();
      }
    });
  }

  _createPeer(peerId) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);

    const config = this.getIceConfig();
    const pc = new RTCPeerConnection(config);
    
    const peerState = {
      id: peerId,
      peerConnection: pc,
      dataChannel: null,
      iceCandidateQueue: [],
      state: 'connecting',
      
      // Receiver state
      receivingMetadata: null,
      receivedChunks: [],
      receivedBytes: 0,
      receiveStartTime: 0
    };
    
    this.peers.set(peerId, peerState);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal', {
          target: peerId,
          signalData: { candidate: event.candidate }
        });
      }
    };

    pc.onconnectionstatechange = () => {
      peerState.state = pc.connectionState;
      console.log(`[WebRTC] Peer ${peerId} state:`, pc.connectionState);
      if (this.onPeerStateChange) {
        this.onPeerStateChange(peerId, pc.connectionState);
      }
    };

    // Receiver side DataChannel
    pc.ondatachannel = (event) => {
      peerState.dataChannel = event.channel;
      this._setupDataChannel(peerState);
    };

    return peerState;
  }

  async initiateConnection(peerId) {
    const peerState = this._createPeer(peerId);
    
    // Sender side DataChannel
    peerState.dataChannel = peerState.peerConnection.createDataChannel('fileTransfer', { ordered: true });
    this._setupDataChannel(peerState);

    try {
      const offer = await peerState.peerConnection.createOffer();
      await peerState.peerConnection.setLocalDescription(offer);
      
      this.socket.emit('signal', {
        target: peerId,
        signalData: { sdp: peerState.peerConnection.localDescription }
      });
    } catch (err) {
      console.error('[WebRTC] Offer error:', err);
    }
  }

  async _handleSignalData(senderId, data) {
    const peerState = this.peers.has(senderId) ? this.peers.get(senderId) : this._createPeer(senderId);
    const pc = peerState.peerConnection;

    if (data.sdp) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await this._drainIceQueue(peerState);

        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.socket.emit('signal', {
            target: senderId,
            signalData: { sdp: pc.localDescription }
          });
        }
      } catch (e) {
        console.error('Remote desc error', e);
      }
    } else if (data.candidate) {
      if (pc.remoteDescription) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(e){}
      } else {
        peerState.iceCandidateQueue.push(data.candidate);
      }
    }
  }

  async _drainIceQueue(peerState) {
    while (peerState.iceCandidateQueue.length > 0) {
      const c = peerState.iceCandidateQueue.shift();
      try { await peerState.peerConnection.addIceCandidate(new RTCIceCandidate(c)); } catch(e){}
    }
  }

  _setupDataChannel(peerState) {
    const dc = peerState.dataChannel;
    if (!dc) return;

    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 256 * 1024; // 256KB backpressure

    dc.onopen = () => {
      peerState.state = 'connected';
      if (this.onPeerStateChange) this.onPeerStateChange(peerState.id, 'connected');
    };
    
    if (dc.readyState === 'open') {
      peerState.state = 'connected';
      if (this.onPeerStateChange) this.onPeerStateChange(peerState.id, 'connected');
    }

    dc.onclose = () => {
      peerState.state = 'disconnected';
      if (this.onPeerStateChange) this.onPeerStateChange(peerState.id, 'disconnected');
    };

    dc.onmessage = (e) => this._handleMessage(peerState, e.data);

    dc.onbufferedamountlow = () => {
      if (this.isSending) this._sendNextChunk();
    };
  }

  _handleMessage(peerState, data) {
    if (typeof data === 'string') {
      try {
        const meta = JSON.parse(data);
        if (meta.type === 'file-header') {
          peerState.receivingMetadata = meta;
          peerState.receivedChunks = [];
          peerState.receivedBytes = 0;
          peerState.receiveStartTime = performance.now();
          if (this.onFileMetadata) this.onFileMetadata(meta);
        }
      } catch (e) {}
    } else if (data instanceof ArrayBuffer) {
      if (!peerState.receivingMetadata) return;
      
      peerState.receivedChunks.push(data);
      peerState.receivedBytes += data.byteLength;
      
      const total = peerState.receivingMetadata.size;
      const pct = Math.min(100, Math.round((peerState.receivedBytes / total) * 100));
      const elapsed = Math.max((performance.now() - peerState.receiveStartTime)/1000, 0.05);
      const speed = (peerState.receivedBytes / (1024*1024)) / elapsed;
      
      if (this.onPeerProgress) {
        this.onPeerProgress(peerState.id, {
          percentage: pct, speedMBps: speed, transferred: peerState.receivedBytes, total
        });
      }

      if (peerState.receivedBytes >= total) {
        const blob = new Blob(peerState.receivedChunks, { type: peerState.receivingMetadata.mimeType || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        if (this.onPeerComplete) {
          this.onPeerComplete(peerState.id, {
            fileName: peerState.receivingMetadata.name,
            fileSize: total,
            downloadUrl: url,
            speedMBps: speed
          });
        }
      }
    }
  }

  sendFile(file, selectedPeerIds) {
    this.currentFile = file;
    this.activeReceivers = new Set(selectedPeerIds);
    this.isSending = true;
    this.sendOffset = 0;
    this.sendStartTime = performance.now();

    const header = JSON.stringify({
      type: 'file-header',
      name: file.name,
      size: file.size,
      mimeType: file.type
    });

    for (let peerId of this.activeReceivers) {
      const p = this.peers.get(peerId);
      if (p && p.dataChannel && p.dataChannel.readyState === 'open') {
        p.dataChannel.send(header);
      } else {
        this.activeReceivers.delete(peerId); // Remove invalid
      }
    }

    if (this.activeReceivers.size === 0) {
      if (this.onError) this.onError('No active connections selected to send to.');
      this.isSending = false;
      return;
    }

    this._sendNextChunk();
  }

  _sendNextChunk() {
    if (!this.isSending || !this.currentFile) return;
    if (this.sendOffset >= this.currentFile.size) return;

    // Check backpressure for ALL active receivers
    let shouldWait = false;
    for (let peerId of this.activeReceivers) {
      const p = this.peers.get(peerId);
      if (p && p.dataChannel && p.dataChannel.readyState === 'open') {
        if (p.dataChannel.bufferedAmount > p.dataChannel.bufferedAmountLowThreshold) {
          shouldWait = true;
          break;
        }
      } else {
        this.activeReceivers.delete(peerId); // Drop if closed during transfer
      }
    }

    if (shouldWait || this.activeReceivers.size === 0) return; // Wait for drain or abort

    const slice = this.currentFile.slice(this.sendOffset, this.sendOffset + CHUNK_SIZE);
    const reader = new FileReader();

    reader.onload = (e) => {
      if (!this.isSending) return;
      const chunk = e.target.result;
      
      for (let peerId of this.activeReceivers) {
        const p = this.peers.get(peerId);
        if (p && p.dataChannel && p.dataChannel.readyState === 'open') {
          try { p.dataChannel.send(chunk); } catch(err){}
        }
      }
      
      this.sendOffset += slice.size;
      const pct = Math.min(100, Math.round((this.sendOffset / this.currentFile.size) * 100));
      const elapsed = Math.max((performance.now() - this.sendStartTime)/1000, 0.05);
      const speed = (this.sendOffset / (1024*1024)) / elapsed;

      // Report progress to UI for ALL receivers
      for (let peerId of this.activeReceivers) {
        if (this.onPeerProgress) {
          this.onPeerProgress(peerId, {
            percentage: pct, speedMBps: speed, transferred: this.sendOffset, total: this.currentFile.size
          });
        }
      }

      if (this.sendOffset >= this.currentFile.size) {
        this.isSending = false;
        for (let peerId of this.activeReceivers) {
          if (this.onPeerComplete) this.onPeerComplete(peerId, { speedMBps: speed });
        }
      } else {
        this._sendNextChunk();
      }
    };
    reader.readAsArrayBuffer(slice);
  }

  _removePeer(peerId) {
    const p = this.peers.get(peerId);
    if (p) {
      if (p.dataChannel) try { p.dataChannel.close(); } catch(e){}
      if (p.peerConnection) try { p.peerConnection.close(); } catch(e){}
      this.peers.delete(peerId);
      this.activeReceivers.delete(peerId);
    }
  }

  cleanup() {
    this.isSending = false;
    for (let peerId of this.peers.keys()) {
      this._removePeer(peerId);
    }
    this.isHost = false;
  }
}
window.WebRTCManager = WebRTCManager;
