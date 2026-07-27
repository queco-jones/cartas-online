const socket = io();

const els = {
  home: document.getElementById('home'),
  game: document.getElementById('game'),
  name: document.getElementById('name'),
  roomCode: document.getElementById('roomCode'),
  createBtn: document.getElementById('createBtn'),
  joinBtn: document.getElementById('joinBtn'),
  homeError: document.getElementById('homeError'),
  codeText: document.getElementById('codeText'),
  copyBtn: document.getElementById('copyBtn'),
  players: document.getElementById('players'),
  startBtn: document.getElementById('startBtn'),
  nextBtn: document.getElementById('nextBtn'),
  gameError: document.getElementById('gameError'),
  lobby: document.getElementById('lobby'),
  round: document.getElementById('round'),
  blackCard: document.getElementById('blackCard'),
  statusText: document.getElementById('statusText'),
  submissions: document.getElementById('submissions'),
  hand: document.getElementById('hand')
};

let roomState = null;
let privateState = { hand: [], isHost: false, isJudge: false };
let myId = null;

socket.on('connect', () => { myId = socket.id; });

function showGame(code) {
  els.home.classList.add('hidden');
  els.game.classList.remove('hidden');
  els.codeText.textContent = code;
}

function sendWithError(event, data, target) {
  socket.emit(event, data, (result) => {
    target.textContent = result?.ok ? '' : (result?.error || 'Ha ocurrido un error.');
  });
}

els.createBtn.addEventListener('click', () => {
  els.homeError.textContent = '';
  socket.emit('create-room', { name: els.name.value }, (result) => {
    if (!result?.ok) return els.homeError.textContent = result?.error || 'No se pudo crear la sala.';
    showGame(result.code);
  });
});

els.joinBtn.addEventListener('click', () => {
  els.homeError.textContent = '';
  socket.emit('join-room', { code: els.roomCode.value, name: els.name.value }, (result) => {
    if (!result?.ok) return els.homeError.textContent = result?.error || 'No se pudo entrar.';
    showGame(result.code);
  });
});

els.roomCode.addEventListener('input', () => {
  els.roomCode.value = els.roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

els.copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(roomState?.code || '');
  const old = els.copyBtn.textContent;
  els.copyBtn.textContent = 'Copiado';
  setTimeout(() => { els.copyBtn.textContent = old; }, 1200);
});

els.startBtn.addEventListener('click', () => sendWithError('start-game', {}, els.gameError));
els.nextBtn.addEventListener('click', () => sendWithError('next-round', {}, els.gameError));

socket.on('private-state', (state) => {
  privateState = state;
  render();
});

socket.on('room-state', (state) => {
  roomState = state;
  render();
});

function renderPlayers() {
  els.players.innerHTML = '';
  for (const player of roomState.players) {
    const row = document.createElement('div');
    row.className = 'player-row';

    const left = document.createElement('div');
    left.innerHTML = `<span class="player-name"></span>`;
    left.querySelector('.player-name').textContent = player.name;

    if (player.id === roomState.hostId) left.insertAdjacentHTML('beforeend', '<span class="badge">Host</span>');
    if (player.id === roomState.judgeId && roomState.started) left.insertAdjacentHTML('beforeend', '<span class="badge">Juez</span>');
    if (player.hasPlayed && roomState.phase === 'playing') left.insertAdjacentHTML('beforeend', '<span class="badge">Listo</span>');

    const right = document.createElement('div');
    right.className = 'score';
    right.textContent = `${player.score} punto${player.score === 1 ? '' : 's'}`;

    row.append(left, right);
    els.players.appendChild(row);
  }
}

function renderHand() {
  els.hand.innerHTML = '';

  if (roomState.phase !== 'playing' || privateState.isJudge) return;

  const me = roomState.players.find((p) => p.id === myId);
  const alreadyPlayed = Boolean(me?.hasPlayed);

  privateState.hand.forEach((card, index) => {
    const button = document.createElement('button');
    button.className = 'white-card';
    button.textContent = card;
    button.disabled = alreadyPlayed;
    button.addEventListener('click', () => {
      sendWithError('play-card', { cardIndex: index }, els.gameError);
    });
    els.hand.appendChild(button);
  });
}

function renderSubmissions() {
  els.submissions.innerHTML = '';
  if (roomState.phase !== 'judging') return;

  for (const submission of roomState.submissions) {
    const button = document.createElement('button');
    button.className = 'white-card';
    button.textContent = submission.card;
    button.disabled = !privateState.isJudge;
    button.addEventListener('click', () => {
      sendWithError('choose-winner', { submissionId: submission.submissionId }, els.gameError);
    });
    els.submissions.appendChild(button);
  }
}

function renderStatus() {
  const me = roomState.players.find((p) => p.id === myId);

  if (roomState.phase === 'playing') {
    if (privateState.isJudge) {
      els.statusText.textContent = 'Eres el juez. Espera a que respondan los demás.';
    } else if (me?.hasPlayed) {
      els.statusText.textContent = 'Carta enviada. Esperando al resto.';
    } else {
      els.statusText.textContent = 'Elige una carta de tu mano.';
    }
  } else if (roomState.phase === 'judging') {
    els.statusText.textContent = privateState.isJudge
      ? 'Elige la respuesta ganadora.'
      : 'El juez está eligiendo la mejor respuesta.';
  } else if (roomState.phase === 'round-end') {
    const winner = roomState.players.find((p) => p.id === roomState.roundWinnerId);
    els.statusText.textContent = `Ha ganado ${winner?.name || 'un jugador'} con: “${roomState.winningCard}”`;
  }
}

function render() {
  if (!roomState) return;

  renderPlayers();

  els.startBtn.classList.toggle('hidden', !(privateState.isHost && !roomState.started));
  els.startBtn.disabled = roomState.players.length < 3;
  els.nextBtn.classList.toggle('hidden', !(privateState.isHost && roomState.phase === 'round-end'));

  els.lobby.classList.toggle('hidden', roomState.started);
  els.round.classList.toggle('hidden', !roomState.started);

  if (roomState.started) {
    els.blackCard.textContent = roomState.blackCard || '';
    renderStatus();
    renderSubmissions();
    renderHand();
  }
}
