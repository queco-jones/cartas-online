const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const rawCards = require('./cards.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const activeProfiles = new Map(); // playerKey -> socket.id

function normalizeDeck(deck) {
  if (!Array.isArray(deck)) return [];
  return [...new Set(deck.map((card) => String(card || '').trim()).filter(Boolean))];
}

const cards = {
  black: normalizeDeck(rawCards.black),
  white: normalizeDeck(rawCards.white)
};

if (cards.black.length === 0 || cards.white.length < 20) {
  throw new Error(`Mazo insuficiente: ${cards.black.length} negras y ${cards.white.length} blancas.`);
}

console.log(`Mazo cargado: ${cards.black.length} cartas negras y ${cards.white.length} cartas blancas.`);
app.use(express.static(path.join(__dirname, 'public')));

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sanitizeName(name) {
  return String(name || '').trim().slice(0, 24) || 'Jugador';
}

function sanitizeAvatar(avatar) {
  const value = String(avatar || '');
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return '';
  return value.length <= 180000 ? value : '';
}

function sanitizePlayerKey(key) {
  const value = String(key || '').trim();
  return /^[a-zA-Z0-9_-]{12,80}$/.test(value) ? value : '';
}

function buildPublicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    phase: room.phase,
    judgeId: room.judgeId,
    blackCard: room.currentBlack,
    deckStats: { black: cards.black.length, white: cards.white.length },
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      cardCount: p.hand.length,
      hasPlayed: room.submissions.some((s) => s.playerId === p.id)
    })),
    submissions: room.phase === 'judging'
      ? room.submissions.map((s) => ({ submissionId: s.id, card: s.card }))
      : [],
    roundWinnerId: room.roundWinnerId || null,
    winningCard: room.winningCard || null
  };
}

function emitRoom(room) {
  io.to(room.code).emit('room-state', buildPublicRoom(room));
  for (const player of room.players) {
    io.to(player.id).emit('private-state', {
      hand: player.hand,
      isHost: player.id === room.hostId,
      isJudge: player.id === room.judgeId
    });
  }
}

function refillHand(room, player) {
  while (player.hand.length < 10) {
    if (room.whiteDeck.length === 0) room.whiteDeck = shuffle(cards.white);
    player.hand.push(room.whiteDeck.pop());
  }
}

function startRound(room) {
  room.phase = 'playing';
  room.submissions = [];
  room.roundWinnerId = null;
  room.winningCard = null;
  if (room.blackDeck.length === 0) room.blackDeck = shuffle(cards.black);
  room.currentBlack = room.blackDeck.pop();
  for (const player of room.players) refillHand(room, player);
}

function advanceJudge(room) {
  const currentIndex = room.players.findIndex((p) => p.id === room.judgeId);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % room.players.length;
  room.judgeId = room.players[nextIndex]?.id || null;
}

function getRoomBySocket(socket) {
  return socket.data.roomCode ? rooms.get(socket.data.roomCode) : null;
}

function reconcileRoom(room) {
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  if (!room.players.some((p) => p.id === room.hostId)) room.hostId = room.players[0].id;
  if (!room.players.some((p) => p.id === room.judgeId)) room.judgeId = room.players[0].id;

  if (room.started && room.players.length < 3) {
    room.started = false;
    room.phase = 'lobby';
    room.judgeId = null;
    room.currentBlack = null;
    room.submissions = [];
    emitRoom(room);
    return;
  }

  if (room.started && room.phase === 'playing') {
    const expected = room.players.length - 1;
    if (expected > 0 && room.submissions.length >= expected) {
      room.submissions = shuffle(room.submissions.slice(0, expected));
      room.phase = 'judging';
    }
  }

  emitRoom(room);
}

function leaveCurrentRoom(socket, reason = 'left') {
  const room = getRoomBySocket(socket);
  if (!room) return;

  room.players = room.players.filter((p) => p.id !== socket.id);
  room.submissions = room.submissions.filter((s) => s.playerId !== socket.id);
  socket.leave(room.code);
  socket.data.roomCode = null;
  reconcileRoom(room);

  if (reason === 'replaced') socket.emit('session-replaced');
}

function claimProfile(socket, playerKey) {
  const key = sanitizePlayerKey(playerKey);
  if (!key) return null;

  const previousSocketId = activeProfiles.get(key);
  if (previousSocketId && previousSocketId !== socket.id) {
    const previousSocket = io.sockets.sockets.get(previousSocketId);
    if (previousSocket) leaveCurrentRoom(previousSocket, 'replaced');
  }

  activeProfiles.set(key, socket.id);
  socket.data.playerKey = key;
  return key;
}

io.on('connection', (socket) => {
  socket.on('create-room', ({ name, avatar, playerKey }, callback) => {
    const key = claimProfile(socket, playerKey);
    if (!key) return callback?.({ ok: false, error: 'No se pudo identificar este navegador.' });

    leaveCurrentRoom(socket);
    const code = makeRoomCode();
    const player = { id: socket.id, playerKey: key, name: sanitizeName(name), avatar: sanitizeAvatar(avatar), score: 0, hand: [] };
    const room = {
      code,
      hostId: socket.id,
      players: [player],
      started: false,
      phase: 'lobby',
      judgeId: null,
      currentBlack: null,
      submissions: [],
      blackDeck: shuffle(cards.black),
      whiteDeck: shuffle(cards.white),
      roundWinnerId: null,
      winningCard: null
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    callback?.({ ok: true, code });
    emitRoom(room);
  });

  socket.on('join-room', ({ code, name, avatar, playerKey }, callback) => {
    const normalizedCode = String(code || '').trim().toUpperCase();
    const room = rooms.get(normalizedCode);
    if (!room) return callback?.({ ok: false, error: 'La sala no existe.' });
    if (room.started) return callback?.({ ok: false, error: 'La partida ya ha empezado.' });

    const key = claimProfile(socket, playerKey);
    if (!key) return callback?.({ ok: false, error: 'No se pudo identificar este navegador.' });

    leaveCurrentRoom(socket);
    if (room.players.length >= 12) return callback?.({ ok: false, error: 'La sala está llena.' });

    room.players.push({ id: socket.id, playerKey: key, name: sanitizeName(name), avatar: sanitizeAvatar(avatar), score: 0, hand: [] });
    socket.join(normalizedCode);
    socket.data.roomCode = normalizedCode;
    callback?.({ ok: true, code: normalizedCode });
    emitRoom(room);
  });

  socket.on('update-profile', ({ name, avatar }, callback) => {
    const room = getRoomBySocket(socket);
    if (!room) return callback?.({ ok: false, error: 'No estás dentro de una sala.' });
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return callback?.({ ok: false, error: 'Jugador no encontrado.' });
    player.name = sanitizeName(name);
    player.avatar = sanitizeAvatar(avatar);
    callback?.({ ok: true });
    emitRoom(room);
  });

  socket.on('leave-room', (_data, callback) => {
    leaveCurrentRoom(socket);
    callback?.({ ok: true });
  });

  socket.on('start-game', (_data, callback) => {
    const room = getRoomBySocket(socket);
    if (!room) return callback?.({ ok: false, error: 'Sala no encontrada.' });
    if (room.hostId !== socket.id) return callback?.({ ok: false, error: 'Solo puede iniciar el anfitrión.' });
    if (room.players.length < 3) return callback?.({ ok: false, error: 'Se necesitan al menos 3 jugadores.' });
    room.started = true;
    room.judgeId = room.players[0].id;
    startRound(room);
    callback?.({ ok: true });
    emitRoom(room);
  });

  socket.on('play-card', ({ cardIndex }, callback) => {
    const room = getRoomBySocket(socket);
    if (!room || room.phase !== 'playing') return callback?.({ ok: false, error: 'No puedes jugar ahora.' });
    if (room.judgeId === socket.id) return callback?.({ ok: false, error: 'El juez no juega carta.' });
    if (room.submissions.some((s) => s.playerId === socket.id)) return callback?.({ ok: false, error: 'Ya has jugado.' });

    const player = room.players.find((p) => p.id === socket.id);
    const index = Number(cardIndex);
    if (!player || !Number.isInteger(index) || index < 0 || index >= player.hand.length) {
      return callback?.({ ok: false, error: 'Carta no válida.' });
    }

    const [card] = player.hand.splice(index, 1);
    room.submissions.push({ id: `${socket.id}-${Date.now()}`, playerId: socket.id, card });
    if (room.submissions.length === room.players.length - 1) {
      room.submissions = shuffle(room.submissions);
      room.phase = 'judging';
    }
    callback?.({ ok: true });
    emitRoom(room);
  });

  socket.on('choose-winner', ({ submissionId }, callback) => {
    const room = getRoomBySocket(socket);
    if (!room || room.phase !== 'judging') return callback?.({ ok: false, error: 'No toca elegir ganador.' });
    if (room.judgeId !== socket.id) return callback?.({ ok: false, error: 'Solo puede elegir el juez.' });
    const submission = room.submissions.find((s) => s.id === submissionId);
    const winner = room.players.find((p) => p.id === submission?.playerId);
    if (!submission || !winner) return callback?.({ ok: false, error: 'Respuesta no válida.' });
    winner.score += 1;
    room.roundWinnerId = winner.id;
    room.winningCard = submission.card;
    room.phase = 'round-end';
    callback?.({ ok: true });
    emitRoom(room);
  });

  socket.on('next-round', (_data, callback) => {
    const room = getRoomBySocket(socket);
    if (!room) return callback?.({ ok: false, error: 'Sala no encontrada.' });
    if (room.hostId !== socket.id) return callback?.({ ok: false, error: 'Solo puede continuar el anfitrión.' });
    if (room.phase !== 'round-end') return callback?.({ ok: false, error: 'La ronda aún no ha terminado.' });
    advanceJudge(room);
    startRound(room);
    callback?.({ ok: true });
    emitRoom(room);
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
    const key = socket.data.playerKey;
    if (key && activeProfiles.get(key) === socket.id) activeProfiles.delete(key);
  });
});

server.listen(PORT, () => console.log(`Servidor iniciado en el puerto ${PORT}`));
