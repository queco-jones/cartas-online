const socket = io();

const els = {
  home: document.getElementById('home'), game: document.getElementById('game'),
  name: document.getElementById('name'), roomCode: document.getElementById('roomCode'),
  createBtn: document.getElementById('createBtn'), joinBtn: document.getElementById('joinBtn'),
  homeError: document.getElementById('homeError'), codeText: document.getElementById('codeText'),
  copyBtn: document.getElementById('copyBtn'), leaveBtn: document.getElementById('leaveBtn'),
  players: document.getElementById('players'), startBtn: document.getElementById('startBtn'),
  nextBtn: document.getElementById('nextBtn'), gameError: document.getElementById('gameError'),
  lobby: document.getElementById('lobby'), round: document.getElementById('round'),
  blackCard: document.getElementById('blackCard'), statusText: document.getElementById('statusText'),
  submissions: document.getElementById('submissions'), hand: document.getElementById('hand'),
  confirmArea: document.getElementById('confirmArea'), confirmBtn: document.getElementById('confirmBtn'),
  cancelBtn: document.getElementById('cancelBtn'), themeBtn: document.getElementById('themeBtn'),
  deckStats: document.getElementById('deckStats'), avatarPicker: document.getElementById('avatarPicker'),
  avatarInput: document.getElementById('avatarInput'), avatarPreview: document.getElementById('avatarPreview'),
  avatarInitial: document.getElementById('avatarInitial'), profileBtn: document.getElementById('profileBtn'),
  profileModal: document.getElementById('profileModal'), closeProfileBtn: document.getElementById('closeProfileBtn'),
  saveProfileBtn: document.getElementById('saveProfileBtn'), profileError: document.getElementById('profileError'),
  homeProfile: document.getElementById('homeProfile')
};

let roomState = null;
let privateState = { hand: [], isHost: false, isJudge: false };
let myId = null;
let selectedCardIndex = null;
let selectedSubmissionId = null;
let lastPhase = null;

const PROFILE_KEY = 'cartas-online-profile-v1';
const PLAYER_KEY = 'cartas-online-player-key-v1';
let profile = loadProfile();
let playerKey = localStorage.getItem(PLAYER_KEY);
if (!playerKey) {
  playerKey = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g, '');
  localStorage.setItem(PLAYER_KEY, playerKey);
}

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
    return { name: String(saved.name || '').slice(0, 24), avatar: String(saved.avatar || '') };
  } catch {
    return { name: '', avatar: '' };
  }
}

function saveProfileLocal() {
  profile.name = els.name.value.trim().slice(0, 24);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  updateProfilePreview();
  renderHomeProfile();
}

function updateProfilePreview() {
  const name = els.name.value.trim();
  els.avatarInitial.textContent = (name[0] || '?').toUpperCase();
  if (profile.avatar) {
    els.avatarPreview.src = profile.avatar;
    els.avatarPreview.classList.remove('hidden');
    els.avatarInitial.classList.add('hidden');
  } else {
    els.avatarPreview.removeAttribute('src');
    els.avatarPreview.classList.add('hidden');
    els.avatarInitial.classList.remove('hidden');
  }
}

function renderHomeProfile() {
  els.homeProfile.innerHTML = '';
  const avatar = document.createElement('div');
  avatar.className = 'player-avatar home-avatar';
  if (profile.avatar) {
    const img = document.createElement('img');
    img.src = profile.avatar;
    img.alt = '';
    avatar.appendChild(img);
  } else {
    avatar.textContent = (profile.name[0] || '?').toUpperCase();
  }
  const info = document.createElement('div');
  info.className = 'profile-fields';
  const label = document.createElement('strong');
  label.textContent = profile.name || 'Configura tu perfil';
  const text = document.createElement('small');
  text.textContent = 'Nombre y foto guardados en este navegador.';
  const button = document.createElement('button');
  button.className = 'small';
  button.textContent = profile.name ? 'Editar' : 'Crear perfil';
  button.addEventListener('click', openProfileModal);
  info.append(label, text);
  els.homeProfile.append(avatar, info, button);
}

function openProfileModal() {
  els.name.value = profile.name;
  updateProfilePreview();
  els.profileError.textContent = '';
  els.profileModal.classList.remove('hidden');
  setTimeout(() => els.name.focus(), 0);
}

function closeProfileModal() {
  els.profileModal.classList.add('hidden');
}

function goHome(message = '') {
  roomState = null;
  privateState = { hand: [], isHost: false, isJudge: false };
  selectedCardIndex = null;
  selectedSubmissionId = null;
  lastPhase = null;
  els.game.classList.add('hidden');
  els.home.classList.remove('hidden');
  els.homeError.textContent = message;
  renderHomeProfile();
}

els.name.value = profile.name;
updateProfilePreview();
renderHomeProfile();

els.avatarPicker.addEventListener('click', () => els.avatarInput.click());
els.avatarInput.addEventListener('change', () => {
  const file = els.avatarInput.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    els.profileError.textContent = 'La imagen debe pesar menos de 2 MB.';
    els.avatarInput.value = '';
    return;
  }
  const img = new Image();
  const reader = new FileReader();
  reader.onload = () => {
    img.onload = () => {
      const size = 160;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      profile.avatar = canvas.toDataURL('image/jpeg', 0.78);
      updateProfilePreview();
      els.avatarInput.value = '';
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

els.profileBtn.addEventListener('click', openProfileModal);
els.closeProfileBtn.addEventListener('click', closeProfileModal);
els.profileModal.addEventListener('click', (event) => {
  if (event.target === els.profileModal) closeProfileModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.profileModal.classList.contains('hidden')) closeProfileModal();
});

els.saveProfileBtn.addEventListener('click', () => {
  if (!els.name.value.trim()) {
    els.profileError.textContent = 'Escribe un nombre.';
    return;
  }
  saveProfileLocal();
  if (roomState) {
    socket.emit('update-profile', { name: profile.name, avatar: profile.avatar }, (result) => {
      if (!result?.ok) {
        els.profileError.textContent = result?.error || 'No se pudo guardar el perfil.';
        return;
      }
      closeProfileModal();
    });
  } else {
    closeProfileModal();
  }
});

socket.on('connect', () => { myId = socket.id; });
socket.on('session-replaced', () => {
  goHome('Esta sesión se cerró porque el mismo perfil entró desde otra pestaña o sala.');
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.themeBtn.textContent = theme === 'dark' ? 'Modo claro' : 'Modo oscuro';
  localStorage.setItem('theme', theme);
}
applyTheme(localStorage.getItem('theme') || 'light');
els.themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

function showGame(code) {
  els.home.classList.add('hidden');
  els.game.classList.remove('hidden');
  els.codeText.textContent = code;
}

function sendWithError(event, data, target, onSuccess) {
  socket.emit(event, data, (result) => {
    target.textContent = result?.ok ? '' : (result?.error || 'Ha ocurrido un error.');
    if (result?.ok) onSuccess?.();
  });
}

function ensureProfile() {
  if (!profile.name.trim()) {
    openProfileModal();
    els.profileError.textContent = 'Crea tu perfil antes de entrar.';
    return false;
  }
  return true;
}

els.createBtn.addEventListener('click', () => {
  els.homeError.textContent = '';
  if (!ensureProfile()) return;
  socket.emit('create-room', { name: profile.name, avatar: profile.avatar, playerKey }, (result) => {
    if (!result?.ok) return els.homeError.textContent = result?.error || 'No se pudo crear la sala.';
    showGame(result.code);
  });
});

els.joinBtn.addEventListener('click', () => {
  els.homeError.textContent = '';
  if (!ensureProfile()) return;
  socket.emit('join-room', { code: els.roomCode.value, name: profile.name, avatar: profile.avatar, playerKey }, (result) => {
    if (!result?.ok) return els.homeError.textContent = result?.error || 'No se pudo entrar.';
    showGame(result.code);
  });
});

els.leaveBtn.addEventListener('click', () => {
  socket.emit('leave-room', {}, () => goHome('Has salido de la partida.'));
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
els.cancelBtn.addEventListener('click', () => {
  selectedCardIndex = null;
  selectedSubmissionId = null;
  render();
});

els.confirmBtn.addEventListener('click', () => {
  if (roomState.phase === 'playing' && selectedCardIndex !== null) {
    sendWithError('play-card', { cardIndex: selectedCardIndex }, els.gameError, () => {
      selectedCardIndex = null;
      render();
    });
  } else if (roomState.phase === 'judging' && selectedSubmissionId) {
    sendWithError('choose-winner', { submissionId: selectedSubmissionId }, els.gameError, () => {
      selectedSubmissionId = null;
      render();
    });
  }
});

socket.on('private-state', (state) => { privateState = state; render(); });
socket.on('room-state', (state) => {
  if (lastPhase !== state.phase) {
    selectedCardIndex = null;
    selectedSubmissionId = null;
    lastPhase = state.phase;
  }
  roomState = state;
  render();
});

function renderPlayers() {
  els.players.innerHTML = '';
  for (const player of roomState.players) {
    const row = document.createElement('div');
    row.className = 'player-row';
    const left = document.createElement('div');
    left.className = 'player-identity';
    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    if (player.avatar) {
      const img = document.createElement('img');
      img.src = player.avatar;
      img.alt = '';
      avatar.appendChild(img);
    } else {
      avatar.textContent = (player.name[0] || '?').toUpperCase();
    }
    const details = document.createElement('div');
    details.innerHTML = '<span class="player-name"></span>';
    details.querySelector('.player-name').textContent = player.name;
    left.append(avatar, details);
    if (player.id === roomState.hostId) details.insertAdjacentHTML('beforeend', '<span class="badge">Host</span>');
    if (player.id === roomState.judgeId && roomState.started) details.insertAdjacentHTML('beforeend', '<span class="badge">Juez</span>');
    if (player.hasPlayed && roomState.phase === 'playing') details.insertAdjacentHTML('beforeend', '<span class="badge">Listo</span>');
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
    button.className = `white-card${selectedCardIndex === index ? ' selected' : ''}`;
    button.textContent = card;
    button.disabled = alreadyPlayed;
    button.addEventListener('click', () => { selectedCardIndex = index; render(); });
    els.hand.appendChild(button);
  });
}

function renderSubmissions() {
  els.submissions.innerHTML = '';
  if (roomState.phase !== 'judging') return;
  for (const submission of roomState.submissions) {
    const button = document.createElement('button');
    button.className = `white-card${selectedSubmissionId === submission.submissionId ? ' selected' : ''}`;
    button.textContent = submission.card;
    button.disabled = !privateState.isJudge;
    button.addEventListener('click', () => { selectedSubmissionId = submission.submissionId; render(); });
    els.submissions.appendChild(button);
  }
}

function renderConfirmArea() {
  const me = roomState.players.find((p) => p.id === myId);
  const canPlayerConfirm = roomState.phase === 'playing' && !privateState.isJudge && !me?.hasPlayed;
  const canJudgeConfirm = roomState.phase === 'judging' && privateState.isJudge;
  const visible = canPlayerConfirm || canJudgeConfirm;
  els.confirmArea.classList.toggle('hidden', !visible);
  els.confirmBtn.disabled = canPlayerConfirm ? selectedCardIndex === null : selectedSubmissionId === null;
  els.confirmBtn.textContent = canJudgeConfirm ? 'Confirmar ganador' : 'Confirmar carta';
}

function renderStatus() {
  const me = roomState.players.find((p) => p.id === myId);
  if (roomState.phase === 'playing') {
    if (privateState.isJudge) els.statusText.textContent = 'Eres el juez. Espera a que respondan los demás.';
    else if (me?.hasPlayed) els.statusText.textContent = 'Carta enviada. Esperando al resto.';
    else els.statusText.textContent = selectedCardIndex === null ? 'Elige una carta de tu mano.' : 'Carta seleccionada. Confírmala para enviarla.';
  } else if (roomState.phase === 'judging') {
    els.statusText.textContent = privateState.isJudge
      ? (selectedSubmissionId ? 'Respuesta seleccionada. Confirma el ganador.' : 'Elige la respuesta ganadora.')
      : 'El juez está eligiendo la mejor respuesta.';
  } else if (roomState.phase === 'round-end') {
    const winner = roomState.players.find((p) => p.id === roomState.roundWinnerId);
    els.statusText.textContent = `Ha ganado ${winner?.name || 'un jugador'} con: “${roomState.winningCard}”`;
  }
}

function render() {
  if (!roomState) return;
  renderPlayers();
  els.deckStats.textContent = `Mazo cargado: ${roomState.deckStats?.black ?? 0} negras y ${roomState.deckStats?.white ?? 0} blancas.`;
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
    renderConfirmArea();
  }
}
