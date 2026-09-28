const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Store room metadata: roomId -> Set of socket IDs
const rooms = new Map();

// Helper to generate a random 6-digit room code
function generateRoomCode() {
  let code;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(code));
  return code;
}

// Helper to safely remove a socket from its current room
function leaveCurrentRoom(socket) {
  if (socket.currentRoom) {
    const roomCode = socket.currentRoom;
    const room = rooms.get(roomCode);
    if (room) {
      room.delete(socket.id);
      socket.to(roomCode).emit('peer-left', { peerId: socket.id });
      if (room.size === 0) {
        rooms.delete(roomCode);
        console.log(`[Room Cleaned] Room ${roomCode} deleted (empty).`);
      }
    }
    socket.leave(roomCode);
    socket.currentRoom = null;
  }
}

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Create a new room code
  socket.on('create-room', (callback) => {
    // Leave previous room if any
    leaveCurrentRoom(socket);

    const roomCode = generateRoomCode();
    socket.join(roomCode);
    rooms.set(roomCode, new Set([socket.id]));
    socket.currentRoom = roomCode;

    console.log(`[Room Created] Room: ${roomCode} by Socket: ${socket.id}`);
    
    const response = { success: true, roomCode };
    if (typeof callback === 'function') {
      callback(response);
    } else {
      socket.emit('room-created', response);
    }
  });

  // Join an existing room code
  socket.on('join-room', ({ roomCode }, callback) => {
    const code = String(roomCode || '').trim();

    if (!code || code.length !== 6 || isNaN(code)) {
      const err = { success: false, message: 'Please enter a valid 6-digit room code.' };
      if (typeof callback === 'function') return callback(err);
      return socket.emit('join-error', err);
    }

    const room = rooms.get(code);

    if (!room) {
      const err = { success: false, message: 'Room code does not exist or has expired.' };
      if (typeof callback === 'function') return callback(err);
      return socket.emit('join-error', err);
    }

    if (room.has(socket.id)) {
      const res = { success: true, roomCode: code };
      if (typeof callback === 'function') return callback(res);
      return socket.emit('room-joined', res);
    }

    if (room.size >= 2) {
      const err = { success: false, message: 'Room is full. Maximum 2 devices allowed per room code.' };
      if (typeof callback === 'function') return callback(err);
      return socket.emit('join-error', err);
    }

    // Leave previous room if any
    leaveCurrentRoom(socket);

    socket.join(code);
    room.add(socket.id);
    socket.currentRoom = code;

    console.log(`[Room Joined] Socket: ${socket.id} joined Room: ${code}`);

    // Notify existing peer in room
    socket.to(code).emit('peer-joined', { peerId: socket.id });

    const response = { success: true, roomCode: code };
    if (typeof callback === 'function') {
      callback(response);
    } else {
      socket.emit('room-joined', response);
    }
  });

  // Explicit leave room event
  socket.on('leave-room', (callback) => {
    leaveCurrentRoom(socket);
    if (typeof callback === 'function') {
      callback({ success: true });
    }
  });

  // WebRTC Signaling Relay
  socket.on('signal', ({ target, signalData }) => {
    if (socket.currentRoom) {
      socket.to(socket.currentRoom).emit('signal', {
        sender: socket.id,
        signalData
      });
    }
  });

  // File metadata notification relay
  socket.on('file-metadata', (metadata) => {
    if (socket.currentRoom) {
      socket.to(socket.currentRoom).emit('file-metadata', metadata);
    }
  });

  // Transfer cancellation relay
  socket.on('cancel-transfer', () => {
    if (socket.currentRoom) {
      socket.to(socket.currentRoom).emit('transfer-cancelled');
    }
  });

  // Handle Disconnect
  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
    leaveCurrentRoom(socket);
  });
});

server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 AirDrop-X Server running on http://localhost:${PORT}`);
  console.log(`==================================================`);
});

