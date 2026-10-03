// AirDrop-X v2.1 - Multi-Device WebRTC + Light Theme UI
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// rooms: roomCode -> { host: socketId, guests: Set<socketId> }
const rooms = new Map();

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(code));
  return code;
}

function leaveCurrentRoom(socket) {
  if (!socket.currentRoom) return;
  const roomCode = socket.currentRoom;
  const room = rooms.get(roomCode);
  if (room) {
    if (room.host === socket.id) {
      // Host left — end session for all guests
      socket.to(roomCode).emit('session-terminated');
      rooms.delete(roomCode);
      console.log(`[Room Terminated] Host left. Room ${roomCode} deleted.`);
    } else {
      // Guest left — notify host only
      room.guests.delete(socket.id);
      if (room.host) io.to(room.host).emit('peer-left', { peerId: socket.id });
      console.log(`[Guest Left] ${socket.id} left Room ${roomCode}`);
    }
  }
  socket.leave(roomCode);
  socket.currentRoom = null;
}

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('create-room', (callback) => {
    leaveCurrentRoom(socket);
    const roomCode = generateRoomCode();
    socket.join(roomCode);
    rooms.set(roomCode, { host: socket.id, guests: new Set() });
    socket.currentRoom = roomCode;
    console.log(`[Room Created] ${roomCode} by ${socket.id}`);
    if (typeof callback === 'function') callback({ success: true, roomCode });
  });

  socket.on('join-room', ({ roomCode }, callback) => {
    const code = String(roomCode || '').trim();
    if (!code || code.length !== 6 || isNaN(code)) {
      return typeof callback === 'function' && callback({ success: false, message: 'Invalid 6-digit code.' });
    }
    const room = rooms.get(code);
    if (!room) {
      return typeof callback === 'function' && callback({ success: false, message: 'Room does not exist or has expired.' });
    }
    if (room.host === socket.id || room.guests.has(socket.id)) {
      return typeof callback === 'function' && callback({ success: true, roomCode: code });
    }
    leaveCurrentRoom(socket);
    socket.join(code);
    room.guests.add(socket.id);
    socket.currentRoom = code;
    console.log(`[Guest Joined] ${socket.id} joined Room ${code}`);
    // Notify host
    io.to(room.host).emit('peer-joined', { peerId: socket.id });
    if (typeof callback === 'function') callback({ success: true, roomCode: code });
  });

  socket.on('leave-room', (callback) => {
    leaveCurrentRoom(socket);
    if (typeof callback === 'function') callback({ success: true });
  });

  // WebRTC signaling — route directly to target peer
  socket.on('signal', ({ target, signalData }) => {
    if (target) {
      io.to(target).emit('signal', { sender: socket.id, signalData });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    leaveCurrentRoom(socket);
  });
});

server.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`🚀 AirDrop-X running on http://localhost:${PORT}`);
  console.log(`================================================`);
});
