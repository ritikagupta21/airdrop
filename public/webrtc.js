/**
 * AirDrop-X - WebRTC P2P DataChannel Engine
 * Handles Peer Connections, STUN/LAN NAT Traversal, 64 KB Chunking, Backpressure, and File Assembly
 */

const CHUNK_SIZE = 64 * 1024; // 64 KB exact chunk size

const STUN_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

const LAN_CONFIG = {
  iceServers: [] // Empty iceServers forces WebRTC to use local host candidates instantly (offline LAN / Wi-Fi / Hotspot)
};

class WebRTCManager {
  constructor(socket) {
    this.socket = socket;
    this.peerConnection = null;
    this.dataChannel = null;
    this.isInitiator = false;
    this.connectedPeerId = null;
    this.networkMode = 'auto'; // 'auto', 'stun', 'lan'

    // Queue for ICE candidates received before remote description is set
    this.iceCandidateQueue = [];

    // Callbacks for UI updates
    this.onConnectionStateChange = null;
    this.onProgressUpdate = null;
    this.onFileTransferComplete = null;
    this.onFileMetadataReceived = null;
    this.onError = null;

    // File transfer state (Sending)
    this.currentFile = null;
    this.isSending = false;
    this.isReadingChunk = false;
    this.sendOffset = 0;
    this.sendStartTime = 0;

    // File transfer state (Receiving)
    this.receivingMetadata = null;
    this.receivedChunks = [];
    this.receivedBytes = 0;
    this.receiveStartTime = 0;

    this._setupSocketListeners();
  }

  setNetworkMode(mode) {
    console.log(`[WebRTC] Setting network mode to: ${mode}`);
    this.networkMode = mode;
  }

  getIceConfig() {
    if (this.networkMode === 'lan') {
      return LAN_CONFIG;
    }
    return STUN_CONFIG;
  }

  // Socket signaling events
  _setupSocketListeners() {
    this.socket.on('signal', async ({ sender, signalData }) => {
      this.connectedPeerId = sender;
      await this._handleSignalData(signalData);
    });

    this.socket.on('peer-joined', async ({ peerId }) => {
      console.log('[WebRTC] Peer joined room:', peerId);
      this.connectedPeerId = peerId;
      this.isInitiator = true;
      // Start WebRTC connection (Offer)
      await this.initiateConnection();
    });

    this.socket.on('peer-left', () => {
      console.log('[WebRTC] Peer left room.');
      this.cleanup();
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange('disconnected', 'Remote peer disconnected');
      }
    });

    this.socket.on('transfer-cancelled', () => {
      this._resetTransferState();
      if (this.onError) {
        this.onError('Transfer was cancelled by the remote peer.');
      }
    });
  }

  // Initialize RTCPeerConnection
  _createPeerConnection() {
    if (this.peerConnection) return;

    const config = this.getIceConfig();
    console.log('[WebRTC] Creating RTCPeerConnection with config:', config);
    this.peerConnection = new RTCPeerConnection(config);
    this.iceCandidateQueue = [];

    // ICE Candidate gathering
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal', {
          target: this.connectedPeerId,
          signalData: { candidate: event.candidate }
        });
      }
    };

    // Connection state logging
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log('[WebRTC] Connection state change:', state);
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(state);
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection.iceConnectionState;
      console.log('[WebRTC] ICE Connection state change:', state);
      if (state === 'failed' || state === 'disconnected') {
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange('disconnected', 'ICE Connection failed or lost');
        }
      }
    };

    // Listen for DataChannel created by Remote Peer (Receiver side)
    this.peerConnection.ondatachannel = (event) => {
      console.log('[WebRTC] Remote DataChannel received');
      this.dataChannel = event.channel;
      this._setupDataChannelEvents();
    };
  }

  // Initiator creates SDP Offer
  async initiateConnection() {
    this._createPeerConnection();

    // Create DataChannel (Sender side)
    console.log('[WebRTC] Creating DataChannel "fileTransfer"');
    this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
      ordered: true
    });
    this._setupDataChannelEvents();

    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      this.socket.emit('signal', {
        target: this.connectedPeerId,
        signalData: { sdp: this.peerConnection.localDescription }
      });
    } catch (err) {
      console.error('[WebRTC] Error creating offer:', err);
      if (this.onError) this.onError('Failed to initiate WebRTC offer: ' + err.message);
    }
  }

  // Handle incoming signaling data (Offer / Answer / ICE Candidate)
  async _handleSignalData(data) {
    if (data.sdp) {
      if (!this.peerConnection) {
        this._createPeerConnection();
      }

      try {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        console.log('[WebRTC] Remote description set (', data.sdp.type, ')');

        // Process any queued ICE candidates that arrived before remote description
        await this._drainIceCandidateQueue();

        if (data.sdp.type === 'offer') {
          const answer = await this.peerConnection.createAnswer();
          await this.peerConnection.setLocalDescription(answer);

          this.socket.emit('signal', {
            target: this.connectedPeerId,
            signalData: { sdp: this.peerConnection.localDescription }
          });
        }
      } catch (err) {
        console.error('[WebRTC] Error setting remote description:', err);
      }
    } else if (data.candidate) {
      if (this.peerConnection && this.peerConnection.remoteDescription) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
          console.log('[WebRTC] Added ICE Candidate');
        } catch (err) {
          console.warn('[WebRTC] Error adding ICE Candidate:', err);
        }
      } else {
        console.log('[WebRTC] Queued ICE candidate (remote description not set yet)');
        this.iceCandidateQueue.push(data.candidate);
      }
    }
  }

  async _drainIceCandidateQueue() {
    while (this.iceCandidateQueue.length > 0) {
      const cand = this.iceCandidateQueue.shift();
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(cand));
        console.log('[WebRTC] Added queued ICE Candidate');
      } catch (err) {
        console.warn('[WebRTC] Error adding queued ICE Candidate:', err);
      }
    }
  }

  // Setup DataChannel Event Listeners
  _setupDataChannelEvents() {
    if (!this.dataChannel) return;

    this.dataChannel.binaryType = 'arraybuffer';
    // Backpressure threshold: 256 KB
    this.dataChannel.bufferedAmountLowThreshold = 256 * 1024;

    this.dataChannel.onopen = () => {
      console.log('[WebRTC DataChannel] State: OPEN');
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange('connected');
      }
    };

    if (this.dataChannel.readyState === 'open') {
      console.log('[WebRTC DataChannel] State is already OPEN');
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange('connected');
      }
    }

    this.dataChannel.onclose = () => {
      console.log('[WebRTC DataChannel] State: CLOSED');
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange('disconnected');
      }
    };

    this.dataChannel.onerror = (error) => {
      console.error('[WebRTC DataChannel Error]', error);
      if (this.onError) {
        this.onError('DataChannel Error occurred.');
      }
    };

    // Handle Incoming Data Messages (Metadata or File Chunks)
    this.dataChannel.onmessage = (event) => {
      this._handleDataChannelMessage(event.data);
    };

    // Backpressure management for sender
    this.dataChannel.onbufferedamountlow = () => {
      if (this.isSending) {
        this._readAndSendNextChunk();
      }
    };
  }

  // Handle Incoming DataChannel Message
  _handleDataChannelMessage(data) {
    if (typeof data === 'string') {
      // JSON Metadata received
      try {
        const metadata = JSON.parse(data);
        if (metadata.type === 'file-header') {
          console.log('[WebRTC] Received File Header:', metadata);
          this.receivingMetadata = metadata;
          this.receivedChunks = [];
          this.receivedBytes = 0;
          this.receiveStartTime = performance.now();

          if (this.onFileMetadataReceived) {
            this.onFileMetadataReceived(metadata);
          }
        }
      } catch (e) {
        console.error('[WebRTC] Error parsing JSON metadata:', e);
      }
    } else if (data instanceof ArrayBuffer) {
      // Raw 64 KB ArrayBuffer Chunk received
      if (!this.receivingMetadata) return;

      this.receivedChunks.push(data);
      this.receivedBytes += data.byteLength;

      const totalSize = this.receivingMetadata.size;
      const percentage = Math.min(100, Math.round((this.receivedBytes / totalSize) * 100));
      const elapsedTime = (performance.now() - this.receiveStartTime) / 1000;
      const safeElapsed = Math.max(elapsedTime, 0.05);
      const speedMBps = (this.receivedBytes / (1024 * 1024)) / safeElapsed;
      const remainingBytes = totalSize - this.receivedBytes;
      const etaSeconds = speedMBps > 0 ? (remainingBytes / (1024 * 1024)) / speedMBps : 0;

      if (this.onProgressUpdate) {
        this.onProgressUpdate({
          percentage,
          transferredBytes: this.receivedBytes,
          totalBytes: totalSize,
          speedMBps,
          etaSeconds: Math.ceil(etaSeconds),
          direction: 'receiving'
        });
      }

      // Check if file transfer is complete
      if (this.receivedBytes >= totalSize) {
        console.log('[WebRTC] File Transfer Completed! Verifying integrity...');
        
        if (this.receivedBytes !== totalSize) {
          console.error(`[WebRTC] Size mismatch! Expected ${totalSize}, got ${this.receivedBytes}`);
          if (this.onError) {
            this.onError(`File corrupted in transit. Expected ${totalSize} bytes, received ${this.receivedBytes} bytes.`);
          }
          this._resetTransferState();
          return;
        }

        const blob = new Blob(this.receivedChunks, { type: this.receivingMetadata.mimeType || 'application/octet-stream' });
        const downloadUrl = URL.createObjectURL(blob);

        if (this.onFileTransferComplete) {
          this.onFileTransferComplete({
            role: 'receiver',
            fileName: this.receivingMetadata.name,
            fileSize: this.receivingMetadata.size,
            downloadUrl,
            avgSpeedMBps: speedMBps
          });
        }

        this._resetTransferState();
      }
    }
  }

  // Send Selected File via WebRTC DataChannel using 64 KB chunks
  sendFile(file) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      if (this.onError) this.onError('WebRTC DataChannel is not connected. Pair devices first.');
      return;
    }

    this.currentFile = file;
    this.isSending = true;
    this.isReadingChunk = false;
    this.sendOffset = 0;
    this.sendStartTime = performance.now();

    // 1. Send File Metadata Header
    const header = {
      type: 'file-header',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream'
    };

    console.log('[WebRTC] Sending file header:', header);
    this.dataChannel.send(JSON.stringify(header));

    // 2. Start streaming 64 KB chunks
    this._readAndSendNextChunk();
  }

  // Slices file into 64 KB chunks and sends over DataChannel sequentially with backpressure handling
  _readAndSendNextChunk() {
    if (!this.isSending || !this.currentFile || this.isReadingChunk) return;

    if (this.sendOffset >= this.currentFile.size) {
      return;
    }

    // Check if buffer is full (Backpressure handling)
    if (this.dataChannel.bufferedAmount > this.dataChannel.bufferedAmountLowThreshold) {
      // Wait for onbufferedamountlow event to trigger
      return;
    }

    this.isReadingChunk = true;
    const slice = this.currentFile.slice(this.sendOffset, this.sendOffset + CHUNK_SIZE);
    const reader = new FileReader();

    reader.onload = (e) => {
      this.isReadingChunk = false;
      if (!this.isSending) return;

      try {
        const chunk = e.target.result;
        this.dataChannel.send(chunk);
        this.sendOffset += slice.size;

        const totalSize = this.currentFile.size;
        const percentage = Math.min(100, Math.round((this.sendOffset / totalSize) * 100));
        const elapsedTime = (performance.now() - this.sendStartTime) / 1000;
        const safeElapsed = Math.max(elapsedTime, 0.05);
        const speedMBps = (this.sendOffset / (1024 * 1024)) / safeElapsed;
        const remainingBytes = totalSize - this.sendOffset;
        const etaSeconds = speedMBps > 0 ? (remainingBytes / (1024 * 1024)) / speedMBps : 0;

        if (this.onProgressUpdate) {
          this.onProgressUpdate({
            percentage,
            transferredBytes: this.sendOffset,
            totalBytes: totalSize,
            speedMBps,
            etaSeconds: Math.ceil(etaSeconds),
            direction: 'sending'
          });
        }

        if (this.sendOffset >= totalSize) {
          console.log('[WebRTC] Sender finished file stream.');
          if (this.onFileTransferComplete) {
            this.onFileTransferComplete({
              role: 'sender',
              fileName: this.currentFile.name,
              fileSize: this.currentFile.size,
              avgSpeedMBps: speedMBps
            });
          }
          this._resetTransferState();
        } else {
          // Send next chunk
          this._readAndSendNextChunk();
        }
      } catch (err) {
        console.error('[WebRTC] Error sending chunk:', err);
        if (this.onError) this.onError('Failed to send file chunk: ' + err.message);
        this._resetTransferState();
      }
    };

    reader.onerror = (err) => {
      this.isReadingChunk = false;
      console.error('[WebRTC] FileReader error:', err);
      if (this.onError) this.onError('Error reading file from disk.');
      this._resetTransferState();
    };

    reader.readAsArrayBuffer(slice);
  }

  cancelTransfer() {
    this.socket.emit('cancel-transfer');
    this._resetTransferState();
  }

  _resetTransferState() {
    this.isSending = false;
    this.isReadingChunk = false;
    this.currentFile = null;
    this.sendOffset = 0;
    this.receivingMetadata = null;
    this.receivedChunks = [];
    this.receivedBytes = 0;
  }

  cleanup() {
    this._resetTransferState();
    this.iceCandidateQueue = [];

    if (this.dataChannel) {
      try { this.dataChannel.close(); } catch (e) {}
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      try { this.peerConnection.close(); } catch (e) {}
      this.peerConnection = null;
    }

    this.connectedPeerId = null;
    this.isInitiator = false;
  }
}

window.WebRTCManager = WebRTCManager;

