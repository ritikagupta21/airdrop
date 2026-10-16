// AirDrop-X v2.2 - Multi-Device WebRTC + 1-to-1 / 1-to-N mode + Speed Optimized
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
      // Guest left — notify host and room
      room.guests.delete(socket.id);
      if (room.host) io.to(room.host).emit('peer-left', { peerId: socket.id });
      io.to(roomCode).emit('chat-system-message', {
        text: `Device ${socket.id.substring(0, 4).toUpperCase()} left the session.`,
        type: 'leave',
        peerId: socket.id,
        timestamp: Date.now()
      });
      console.log(`[Guest Left] ${socket.id} left Room ${roomCode}`);
    }
  }
  socket.leave(roomCode);
  socket.currentRoom = null;
}

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('create-room', (data, callback) => {
    // Handle optional data payload
    let mode = 'multi';
    if (typeof data === 'function') { callback = data; }
    else if (data && data.mode) { mode = data.mode; }

    leaveCurrentRoom(socket);
    const roomCode = generateRoomCode();
    socket.join(roomCode);
    rooms.set(roomCode, { host: socket.id, guests: new Set(), mode });
    socket.currentRoom = roomCode;
    console.log(`[Room Created] ${roomCode} by ${socket.id} (mode: ${mode})`);
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
    if (room.mode === 'single' && room.guests.size >= 1 && !room.guests.has(socket.id)) {
      return typeof callback === 'function' && callback({ success: false, message: 'Room is full (1-to-1 mode only).' });
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
    // Notify room in chat
    io.to(code).emit('chat-system-message', {
      text: `Device ${socket.id.substring(0, 4).toUpperCase()} joined the room.`,
      type: 'join',
      peerId: socket.id,
      timestamp: Date.now()
    });
    if (typeof callback === 'function') callback({ success: true, roomCode: code });
  });

  socket.on('leave-room', (callback) => {
    leaveCurrentRoom(socket);
    if (typeof callback === 'function') callback({ success: true });
  });

  // Room Chat Messaging
  socket.on('send-chat', (data, callback) => {
    if (!socket.currentRoom) {
      if (typeof callback === 'function') callback({ success: false, message: 'Not connected to a room.' });
      return;
    }
    const room = rooms.get(socket.currentRoom);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, message: 'Room has expired.' });
      return;
    }
    const text = String((data && data.text) || '').trim();
    if (!text) {
      if (typeof callback === 'function') callback({ success: false, message: 'Message is empty.' });
      return;
    }

    const isHost = room.host === socket.id;
    const defaultName = isHost ? 'Host' : `Device ${socket.id.substring(0, 4).toUpperCase()}`;
    const senderName = (data && data.senderName) ? String(data.senderName).trim().substring(0, 30) : defaultName;

    const messageData = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      roomCode: socket.currentRoom,
      senderId: socket.id,
      senderName,
      isHost,
      text,
      timestamp: Date.now()
    };

    io.to(socket.currentRoom).emit('chat-message', messageData);
    if (typeof callback === 'function') callback({ success: true, message: messageData });
  });

  socket.on('typing', ({ isTyping }) => {
    if (!socket.currentRoom) return;
    const room = rooms.get(socket.currentRoom);
    const isHost = room && room.host === socket.id;
    const senderName = isHost ? 'Host' : `Device ${socket.id.substring(0, 4).toUpperCase()}`;
    socket.to(socket.currentRoom).emit('peer-typing', {
      senderId: socket.id,
      senderName,
      isTyping: !!isTyping
    });
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
