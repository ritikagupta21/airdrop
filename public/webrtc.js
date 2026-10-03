/**
 * AirDrop-X v2.1 - High-Speed WebRTC Multi-Peer Engine
 * Optimized: 256KB chunks, 16MB pipeline buffer, parallel sends
 */

const CHUNK_SIZE = 256 * 1024;          // 256 KB chunks (4x bigger = 4x faster)
const BUFFER_THRESHOLD = 16 * 1024 * 1024; // 16 MB pipeline buffer before backpressure

const STUN_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};
const LAN_CONFIG = { iceServers: [] };

class WebRTCManager {
  constructor(socket) {
    this.socket = socket;
    this.peers = new Map(); // peerId -> PeerState
    this.networkMode = 'auto';
    this.isHost = false;

    // Callbacks
    this.onPeerStateChange = null;
    this.onPeerProgress = null;
    this.onPeerComplete = null;
    this.onFileMetadata = null;
    this.onError = null;
    this.onSessionTerminated = null;

    // Sender state
    this.currentFile = null;
    this.isSending = false;
    this.sendOffset = 0;
    this.sendStartTime = 0;
    this.activeReceivers = new Set();
    this._reading = false;

    this._setupSocketListeners();
  }

  setNetworkMode(mode) { this.networkMode = mode; }
  _iceConfig() { return this.networkMode === 'lan' ? LAN_CONFIG : STUN_CONFIG; }

  _setupSocketListeners() {
    this.socket.on('signal', async ({ sender, signalData }) => {
      await this._handleSignal(sender, signalData);
    });

    this.socket.on('peer-joined', async ({ peerId }) => {
      console.log('[RTC] Peer joined:', peerId);
      this.isHost = true;
      await this._initiateConnection(peerId);
    });

    this.socket.on('peer-left', ({ peerId }) => {
      console.log('[RTC] Peer left:', peerId);
      this._removePeer(peerId);
      if (this.onPeerStateChange) this.onPeerStateChange(peerId, 'disconnected');
    });

    this.socket.on('session-terminated', () => {
      this.cleanup();
      if (this.onSessionTerminated) this.onSessionTerminated();
    });
  }

  _createPeerState(peerId) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);

    const pc = new RTCPeerConnection(this._iceConfig());
    const state = {
      id: peerId, pc, dc: null, iceQueue: [],
      // receiver
      meta: null, chunks: [], received: 0, receiveStart: 0
    };
    this.peers.set(peerId, state);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit('signal', { target: peerId, signalData: { candidate: e.candidate } });
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      console.log(`[RTC] ${peerId} -> ${s}`);
      if (this.onPeerStateChange) this.onPeerStateChange(peerId, s);
    };

    // Receiver side: datachannel arrives via this
    pc.ondatachannel = (e) => {
      state.dc = e.channel;
      this._setupDC(state);
    };

    return state;
  }

  async _initiateConnection(peerId) {
    const state = this._createPeerState(peerId);
    state.dc = state.pc.createDataChannel('fileTransfer', { ordered: true });
    this._setupDC(state);
    try {
      const offer = await state.pc.createOffer();
      await state.pc.setLocalDescription(offer);
      this.socket.emit('signal', { target: peerId, signalData: { sdp: state.pc.localDescription } });
    } catch (e) { console.error('[RTC] Offer error', e); }
  }

  async _handleSignal(senderId, data) {
    const state = this._createPeerState(senderId);
    const pc = state.pc;
    if (data.sdp) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        for (const c of state.iceQueue) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
        }
        state.iceQueue = [];
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.socket.emit('signal', { target: senderId, signalData: { sdp: pc.localDescription } });
        }
      } catch (e) { console.error('[RTC] SDP error', e); }
    } else if (data.candidate) {
      if (pc.remoteDescription) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (_) {}
      } else {
        state.iceQueue.push(data.candidate);
      }
    }
  }

  _setupDC(state) {
    const dc = state.dc;
    if (!dc) return;
    dc.binaryType = 'arraybuffer';
    // Large buffer = higher throughput pipeline
    dc.bufferedAmountLowThreshold = BUFFER_THRESHOLD / 2;

    dc.onopen = () => {
      console.log(`[DC] OPEN with ${state.id}`);
      if (this.onPeerStateChange) this.onPeerStateChange(state.id, 'connected');
    };
    if (dc.readyState === 'open') {
      if (this.onPeerStateChange) this.onPeerStateChange(state.id, 'connected');
    }
    dc.onclose = () => {
      if (this.onPeerStateChange) this.onPeerStateChange(state.id, 'disconnected');
    };
    dc.onerror = (e) => {
      console.error('[DC] Error', e);
      if (this.onError) this.onError('DataChannel error with peer ' + state.id);
    };
    dc.onmessage = (e) => this._handleMessage(state, e.data);

    // Resume pumping when buffer drains
    dc.onbufferedamountlow = () => {
      if (this.isSending && !this._reading) this._pump();
    };
  }

  _handleMessage(state, data) {
    if (typeof data === 'string') {
      try {
        const meta = JSON.parse(data);
        if (meta.type === 'file-header') {
          state.meta = meta;
          state.chunks = [];
          state.received = 0;
          state.receiveStart = performance.now();
          if (this.onFileMetadata) this.onFileMetadata(meta);
        }
      } catch (_) {}
    } else if (data instanceof ArrayBuffer) {
      if (!state.meta) return;
      state.chunks.push(data);
      state.received += data.byteLength;

      const pct = Math.min(100, Math.round((state.received / state.meta.size) * 100));
      const elapsed = Math.max((performance.now() - state.receiveStart) / 1000, 0.05);
      const speedMBps = (state.received / (1024 * 1024)) / elapsed;

      if (this.onPeerProgress) {
        this.onPeerProgress(state.id, { percentage: pct, speedMBps, transferred: state.received, total: state.meta.size });
      }

      if (state.received >= state.meta.size) {
        const blob = new Blob(state.chunks, { type: state.meta.mimeType || 'application/octet-stream' });
        const downloadUrl = URL.createObjectURL(blob);
        if (this.onPeerComplete) {
          this.onPeerComplete(state.id, { fileName: state.meta.name, fileSize: state.meta.size, downloadUrl, speedMBps });
        }
        state.meta = null; state.chunks = []; state.received = 0;
      }
    }
  }

  sendFile(file, selectedPeerIds) {
    if (!file || !selectedPeerIds || selectedPeerIds.length === 0) {
      if (this.onError) this.onError('No file or devices selected.');
      return;
    }

    this.currentFile = file;
    this.activeReceivers = new Set();
    this.isSending = true;
    this._reading = false;
    this.sendOffset = 0;
    this.sendStartTime = performance.now();

    const header = JSON.stringify({
      type: 'file-header',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream'
    });

    for (const peerId of selectedPeerIds) {
      const s = this.peers.get(peerId);
      if (s && s.dc && s.dc.readyState === 'open') {
        s.dc.send(header);
        this.activeReceivers.add(peerId);
      }
    }

    if (this.activeReceivers.size === 0) {
      this.isSending = false;
      if (this.onError) this.onError('No connected devices to send to.');
      return;
    }

    // Start high-speed pump
    this._pump();
  }

  // High-speed pipeline pump: fills the buffer as fast as possible
  _pump() {
    if (!this.isSending || !this.currentFile || this._reading) return;
    if (this.sendOffset >= this.currentFile.size) return;

    // Remove dead peers
    for (const peerId of this.activeReceivers) {
      const s = this.peers.get(peerId);
      if (!s || !s.dc || s.dc.readyState !== 'open') {
        this.activeReceivers.delete(peerId);
      }
    }
    if (this.activeReceivers.size === 0) { this.isSending = false; return; }

    // Check if ALL receivers have buffer room
    for (const peerId of this.activeReceivers) {
      const s = this.peers.get(peerId);
      if (s && s.dc && s.dc.bufferedAmount >= BUFFER_THRESHOLD) return; // wait for drain
    }

    this._reading = true;
    const slice = this.currentFile.slice(this.sendOffset, this.sendOffset + CHUNK_SIZE);
    const reader = new FileReader();

    reader.onload = (e) => {
      this._reading = false;
      if (!this.isSending) return;

      const chunk = e.target.result;
      for (const peerId of this.activeReceivers) {
        const s = this.peers.get(peerId);
        if (s && s.dc && s.dc.readyState === 'open') {
          try { s.dc.send(chunk); } catch (_) {}
        }
      }

      this.sendOffset += slice.size;
      const pct = Math.min(100, Math.round((this.sendOffset / this.currentFile.size) * 100));
      const elapsed = Math.max((performance.now() - this.sendStartTime) / 1000, 0.05);
      const speedMBps = (this.sendOffset / (1024 * 1024)) / elapsed;
      const remaining = this.currentFile.size - this.sendOffset;
      const eta = speedMBps > 0 ? Math.ceil((remaining / (1024 * 1024)) / speedMBps) : 0;

      for (const peerId of this.activeReceivers) {
        if (this.onPeerProgress) {
          this.onPeerProgress(peerId, { percentage: pct, speedMBps, transferred: this.sendOffset, total: this.currentFile.size, eta });
        }
      }

      if (this.sendOffset >= this.currentFile.size) {
        // Done!
        this.isSending = false;
        for (const peerId of this.activeReceivers) {
          if (this.onPeerComplete) this.onPeerComplete(peerId, { speedMBps });
        }
        this.activeReceivers.clear();
      } else {
        // Immediately pump next chunk (no delay)
        this._pump();
      }
    };

    reader.onerror = () => {
      this._reading = false;
      if (this.onError) this.onError('Error reading file from disk.');
      this.isSending = false;
    };

    reader.readAsArrayBuffer(slice);
  }

  cancelTransfer() {
    this.isSending = false;
    this._reading = false;
    this.currentFile = null;
    this.sendOffset = 0;
    this.activeReceivers.clear();
  }

  _removePeer(peerId) {
    const s = this.peers.get(peerId);
    if (s) {
      try { s.dc && s.dc.close(); } catch (_) {}
      try { s.pc && s.pc.close(); } catch (_) {}
      this.peers.delete(peerId);
      this.activeReceivers.delete(peerId);
    }
  }

  cleanup() {
    this.cancelTransfer();
    for (const peerId of [...this.peers.keys()]) this._removePeer(peerId);
    this.isHost = false;
  }
}

window.WebRTCManager = WebRTCManager;
