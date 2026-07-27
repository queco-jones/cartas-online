const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cards = require('./cards.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

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

function buildPublicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    phase: room.phase,
    judgeId: room.judgeId,
    blackCard: room.currentBlack,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
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
    if (room.whiteDeck.length === 0) {
      room.whiteDeck = shuffle(cards.white);
    }
    player.hand.push(room.whiteDeck.pop());
  }
}

function startRound(room) {
  room.phase = 'playing';
  room.submissions = [];
  room.roundWinnerId = null;
  room.winningCard = null;

  if (room.blackDeck.length === 0) {
    room.blackDeck = shuffle(cards.black);
  }
  room.currentBlack = room.blackDeck.pop();

  for (const player of room.players) {
    refillHand(room, player);
  }
}

function advanceJudge(room) {
  const currentIndex = room.players.findIndex((p) => p.id === room.judgeId);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % room.players.length;
  room.judgeId = room.players[nextIndex]?.id || null;
}

function getRoomBySocket(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}

io.on('connection', (socket) => {
  socket.on('create-room', ({ name }, callback) => {
    const code = makeRoomCode();
    const player = { id: socket.id, name: sanitizeName(name), score: 0, hand: [] };
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

  socket.on('join-room', ({ code, name }, callback) => {
    const normalizedCode = String(code || '').trim().toUpperCase();
    const room = rooms.get(normalizedCode);

    if (!room) return callback?.({ ok: false, error: 'La sala no existe.' });
    if (room.started) return callback?.({ ok: false, error: 'La partida ya ha empezado.' });
    if (room.players.length >= 12) return callback?.({ ok: false, error: 'La sala está llena.' });

    room.players.push({ id: socket.id, name: sanitizeName(name), score: 0, hand: [] });
    socket.join(normalizedCode);
    socket.data.roomCode = normalizedCode;
    callback?.({ ok: true, code: normalizedCode });
    emitRoom(room);
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

    const expected = room.players.length - 1;
    if (room.submissions.length === expected) {
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
    const room = getRoomBySocket(socket);
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== socket.id);
    room.submissions = room.submissions.filter((s) => s.playerId !== socket.id);

    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }

    if (room.hostId === socket.id) room.hostId = room.players[0].id;
    if (room.judgeId === socket.id) room.judgeId = room.players[0].id;

    if (room.started && room.players.length < 3) {
      room.started = false;
      room.phase = 'lobby';
      room.currentBlack = null;
      room.submissions = [];
    }

    emitRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
});
