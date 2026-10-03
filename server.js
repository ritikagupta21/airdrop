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

app.use(express.static(path.join(__dirname, 'public')));

// Store room metadata: roomId -> { host: socketId, guests: Set([socketId]) }
const rooms = new Map();

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(code));
  return code;
}

function leaveCurrentRoom(socket) {
  if (socket.currentRoom) {
    const roomCode = socket.currentRoom;
    const room = rooms.get(roomCode);
    
    if (room) {
      if (room.host === socket.id) {
        // Host left -> Terminate session for all
        socket.to(roomCode).emit('session-terminated');
        rooms.delete(roomCode);
        console.log(`[Room Terminated] Host left, room ${roomCode} deleted.`);
      } else {
        // Guest left
        room.guests.delete(socket.id);
        // Notify host
        if (room.host) {
          io.to(room.host).emit('peer-left', { peerId: socket.id });
        }
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
    leaveCurrentRoom(socket);

    const roomCode = generateRoomCode();
    socket.join(roomCode);
    rooms.set(roomCode, { host: socket.id, guests: new Set() });
    socket.currentRoom = roomCode;

    console.log(`[Room Created] Room: ${roomCode} by Host: ${socket.id}`);
    
    if (typeof callback === 'function') {
      callback({ success: true, roomCode });
    }
  });

  // Join an existing room code
  socket.on('join-room', ({ roomCode }, callback) => {
    const code = String(roomCode || '').trim();

    if (!code || code.length !== 6 || isNaN(code)) {
      if (typeof callback === 'function') return callback({ success: false, message: 'Invalid room code.' });
      return;
    }

    const room = rooms.get(code);

    if (!room) {
      if (typeof callback === 'function') return callback({ success: false, message: 'Room code does not exist or has expired.' });
      return;
    }

    if (room.host === socket.id || room.guests.has(socket.id)) {
      if (typeof callback === 'function') return callback({ success: true, roomCode: code });
      return;
    }

    leaveCurrentRoom(socket);

    socket.join(code);
    room.guests.add(socket.id);
    socket.currentRoom = code;

    console.log(`[Room Joined] Guest: ${socket.id} joined Room: ${code}`);

    // Notify the HOST that a new peer joined
    io.to(room.host).emit('peer-joined', { peerId: socket.id });

    if (typeof callback === 'function') {
      callback({ success: true, roomCode: code });
    }
  });

  // Explicit leave room
  socket.on('leave-room', (callback) => {
    leaveCurrentRoom(socket);
    if (typeof callback === 'function') {
      callback({ success: true });
    }
  });

  // WebRTC Signaling Relay
  socket.on('signal', ({ target, signalData }) => {
    // Route signal exactly to the target socket
    io.to(target).emit('signal', {
      sender: socket.id,
      signalData
    });
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
