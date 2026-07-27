const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const BUNDLED_BASE_PATH = path.join(__dirname, 'cards.json');
const BASE_PATH = path.join(DATA_DIR, 'cards.json');
const AI_CARDS_PATH = path.join(DATA_DIR, 'ai-generated-cards.json');
const AI_CARD_WEIGHT = Math.max(2, Math.min(8, Number.parseInt(process.env.AI_CARD_WEIGHT, 10) || 4));
const CUSTOM_PATH = path.join(DATA_DIR, 'custom-cards.json');
const FLAGGED_PATH = path.join(DATA_DIR, 'flagged-cards.json');
const DELETED_PATH = path.join(DATA_DIR, 'deleted-cards.json');
const ANALYTICS_PATH = path.join(DATA_DIR, 'game-analytics.json');
const AI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || '';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_CARDS_PATH = process.env.GITHUB_CARDS_PATH || 'cards.json';

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); }
function normalizeWhite(deck) { return [...new Set((Array.isArray(deck) ? deck : []).map(v => String(v || '').trim()).filter(Boolean))]; }
function normalizeBlack(deck) {
  const seen = new Set(); const out = [];
  for (const card of Array.isArray(deck) ? deck : []) {
    const text = String(typeof card === 'object' ? card?.text : card || '').trim();
    if (!text || seen.has(text)) continue;
    const detected = (text.match(/____/g) || []).length || 1;
    const pick = Math.max(1, Math.min(3, Number(typeof card === 'object' ? card.pick : detected) || detected));
    seen.add(text); out.push({ text, pick });
  }
  return out;
}

if (!fs.existsSync(BASE_PATH)) {
  const bundled = readJson(BUNDLED_BASE_PATH, { black: [], white: [] });
  writeJson(BASE_PATH, bundled);
}
let custom = readJson(CUSTOM_PATH, { black: [], white: [] });
let aiGenerated = readJson(AI_CARDS_PATH, { black: [], white: [] });
let flagged = readJson(FLAGGED_PATH, []);
let deleted = readJson(DELETED_PATH, { black: [], white: [] });
let analytics = readJson(ANALYTICS_PATH, { games: [] });
let cards;
let aiBlackTexts = new Set();
let aiWhiteTexts = new Set();
function reloadCards() {
  const base = readJson(BASE_PATH, readJson(BUNDLED_BASE_PATH, { black: [], white: [] }));
  custom = readJson(CUSTOM_PATH, custom || { black: [], white: [] });
  aiGenerated = readJson(AI_CARDS_PATH, aiGenerated || { black: [], white: [] });
  deleted = readJson(DELETED_PATH, deleted || { black: [], white: [] });
  const embeddedAi = base._aiGenerated || {};
  aiBlackTexts = new Set(normalizeBlack([...(embeddedAi.black || []), ...(aiGenerated.black || [])]).map(c => c.text));
  aiWhiteTexts = new Set(normalizeWhite([...(embeddedAi.white || []), ...(aiGenerated.white || [])]));
  const deletedBlack = new Set(normalizeWhite(deleted.black));
  const deletedWhite = new Set(normalizeWhite(deleted.white));
  cards = {
    black: normalizeBlack([...(base.black || []), ...(custom.black || [])]).filter(c => !deletedBlack.has(c.text)),
    white: normalizeWhite([...(base.white || []), ...(custom.white || [])]).filter(c => !deletedWhite.has(c))
  };
  if (!cards.black.length || cards.white.length < 20) throw new Error('Mazo insuficiente.');
}
reloadCards();
console.log(`Mazo cargado: ${cards.black.length} negras y ${cards.white.length} blancas.`);

app.use(express.static(path.join(__dirname, 'public')));
const rooms = new Map();
const activeProfiles = new Map();
const HUMOR_GENRES = ['absurdo','negro','sexual','político','cotidiano','surrealista','incómodo','referencia cultural'];
function shuffle(a) { const x=[...a]; for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];} return x; }
function weightedShuffle(items, weightFor) {
  return [...items].map(item => ({ item, key: Math.pow(Math.random(), 1 / Math.max(1, weightFor(item))) }))
    .sort((a,b)=>a.key-b.key).map(entry=>entry.item);
}
function isAiBlack(card){return aiBlackTexts.has(card.text);}
function isAiWhite(card){return aiWhiteTexts.has(card);}
function makeBlackDeck(room){return weightedShuffle(cards.black.filter(c=>!room.removedBlack.has(c.text)),c=>isAiBlack(c)?AI_CARD_WEIGHT:1);}
function makeWhiteDeck(room){return weightedShuffle(cards.white.filter(c=>!room.removedWhite.has(c)),c=>isAiWhite(c)?AI_CARD_WEIGHT:1);}
function makeRoomCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let c;do{c=Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');}while(rooms.has(c));return c;}
function sanitizeName(v){return String(v||'').trim().slice(0,24)||'Jugador';}
function sanitizeAvatar(v){v=String(v||'');return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)&&v.length<=180000?v:'';}
function sanitizeKey(v){v=String(v||'').trim();return /^[a-zA-Z0-9_-]{12,80}$/.test(v)?v:'';}
function sanitizeRounds(v){return Math.max(3,Math.min(50,Number.parseInt(v,10)||10));}
function sanitizeGameMode(v){return v==='chaos'?'chaos':'original';}
function getRoom(socket){return socket.data.roomCode?rooms.get(socket.data.roomCode):null;}
function refillHand(room,p){while(p.hand.length<10){if(!room.whiteDeck.length)room.whiteDeck=makeWhiteDeck(room); if(!room.whiteDeck.length)break; p.hand.push(room.whiteDeck.pop());}}
function restoreSubmissions(room){for(const s of room.submissions){const p=room.players.find(x=>x.id===s.playerId);if(p)p.hand.push(...s.cards.filter(c=>!room.removedWhite.has(c)));}room.submissions=[];for(const p of room.players)refillHand(room,p);}
function drawBlack(room){if(!room.blackDeck.length)room.blackDeck=makeBlackDeck(room);return room.blackDeck.pop()||{text:'Sin preguntas disponibles.',pick:1};}
function resetStats(room){room.stats={whiteUses:{},winningWhiteUses:{},blackUses:{},genres:{},ratings:[],rounds:[]};}
function count(map,key,n=1){map[key]=(map[key]||0)+n;}
function startRound(room){room.phase='playing';room.submissions=[];room.roundVotes={};room.roundWinnerId=null;room.winningCards=null;room.roundTie=false;room.surveys={};room.currentBlack=drawBlack(room);count(room.stats.blackUses,room.currentBlack.text);for(const p of room.players)refillHand(room,p);}
function advanceJudge(room){const i=room.players.findIndex(p=>p.id===room.judgeId);room.judgeId=room.players[(i<0?0:(i+1)%room.players.length)]?.id||null;}
function publicVote(room){if(!room.vote)return null;return {id:room.vote.id,type:room.vote.type,text:room.vote.text,yes:room.vote.yes.size,no:room.vote.no.size,total:room.players.length,needed:Math.floor(room.players.length/2)+1,hasVoted:[...room.vote.yes,...room.vote.no]};}
function isSurveyRound(room){return room.roundNumber>0&&room.roundNumber%5===0;}
function surveyRequiredIds(room){if(!isSurveyRound(room))return [];return room.submissions.map(s=>s.playerId).filter(id=>room.players.some(p=>p.id===id));}
function expectedSubmissions(room){return room.gameMode==='chaos'?room.players.length:Math.max(0,room.players.length-1);}
function finishRound(room,winnerSubmission=null,tied=false){
  room.roundTie=Boolean(tied);room.surveys={};
  if(winnerSubmission){const winner=room.players.find(p=>p.id===winnerSubmission.playerId);if(winner){winner.score++;winnerSubmission.cards.forEach(c=>count(room.stats.winningWhiteUses,c));room.roundWinnerId=winner.id;room.winningCards=[...winnerSubmission.cards];}}
  else{room.roundWinnerId=null;room.winningCards=null;}
  room.stats.rounds.push({round:room.roundNumber,black:room.currentBlack.text,winner:room.roundWinnerId?room.players.find(p=>p.id===room.roundWinnerId)?.name:null,winningCards:room.winningCards?[...room.winningCards]:[],tie:Boolean(tied),submissions:room.submissions.map(s=>({player:room.players.find(p=>p.id===s.playerId)?.name||'Jugador',cards:[...s.cards],votes:Object.values(room.roundVotes||{}).filter(id=>id===s.id).length}))});
  room.phase=isSurveyRound(room)?'round-survey':'round-result';
}
function resolveChaosRound(room){
  if(room.gameMode!=='chaos'||room.phase!=='voting')return;
  const eligible=room.players.filter(p=>room.submissions.some(s=>s.playerId===p.id));
  if(Object.keys(room.roundVotes||{}).length<eligible.length)return;
  const totals=new Map(room.submissions.map(s=>[s.id,0]));for(const id of Object.values(room.roundVotes||{}))totals.set(id,(totals.get(id)||0)+1);
  const max=Math.max(0,...totals.values());const leaders=room.submissions.filter(s=>(totals.get(s.id)||0)===max);
  finishRound(room,leaders.length===1?leaders[0]:null,leaders.length!==1);
}
function buildRanking(room){return [...room.players].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).map((p,i)=>({place:i+1,id:p.id,name:p.name,avatar:p.avatar,score:p.score}));}
function topEntries(map,limit=8){return Object.entries(map||{}).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([text,count])=>({text,count}));}
function buildSummary(room){
  const avg=room.stats.ratings.length?room.stats.ratings.reduce((a,b)=>a+b,0)/room.stats.ratings.length:0;
  return {ranking:buildRanking(room),roundsPlayed:room.roundNumber,maxRounds:room.maxRounds,topPlayedAnswers:topEntries(room.stats.whiteUses,10),topWinningAnswers:topEntries(room.stats.winningWhiteUses,10),topGenres:topEntries(room.stats.genres,8),averageRating:Number(avg.toFixed(1)),generatedCards:room.generatedCards||null,aiStatus:room.aiStatus||'idle'};
}
function publicRoom(room){
  const showSubmissions=['judging','voting','round-result','round-survey'].includes(room.phase);
  const revealOwners=['round-result','round-survey'].includes(room.phase);
  return {code:room.code,hostId:room.hostId,started:room.started,phase:room.phase,gameMode:room.gameMode,gameModeName:room.gameMode==='chaos'?'Modo Caos':'Original',judgeId:room.gameMode==='original'?room.judgeId:null,blackCard:room.currentBlack?.text||null,cardsRequired:room.currentBlack?.pick||1,deckStats:{black:cards.black.length,white:cards.white.length},roundNumber:room.roundNumber,maxRounds:room.maxRounds,players:room.players.map(p=>({id:p.id,name:p.name,avatar:p.avatar,score:p.score,cardCount:p.hand.length,hasPlayed:room.submissions.some(s=>s.playerId===p.id),hasVoted:Boolean(room.roundVotes?.[p.id]),surveyDone:Boolean(room.surveys?.[p.id])})),submissions:showSubmissions?room.submissions.map(s=>({submissionId:s.id,cards:s.cards,playerId:revealOwners?s.playerId:undefined,playerName:revealOwners?room.players.find(p=>p.id===s.playerId)?.name:undefined,votes:revealOwners?Object.values(room.roundVotes||{}).filter(id=>id===s.id).length:undefined})):[],roundWinnerId:room.roundWinnerId||null,winningCards:room.winningCards||null,roundTie:Boolean(room.roundTie),vote:publicVote(room),survey:{active:isSurveyRound(room)&&room.phase==='round-survey',requiredIds:surveyRequiredIds(room),submittedIds:Object.keys(room.surveys||{})},gameSummary:room.phase==='game-over'?buildSummary(room):null};
}
function emitRoom(room){io.to(room.code).emit('room-state',publicRoom(room));for(const p of room.players){const own=room.submissions.find(s=>s.playerId===p.id);io.to(p.id).emit('private-state',{hand:p.hand,isHost:p.id===room.hostId,isJudge:room.gameMode==='original'&&p.id===room.judgeId,ownSubmissionId:own?.id||null});}}
function reconcile(room){if(!room.players.length){rooms.delete(room.code);return;}if(!room.players.some(p=>p.id===room.hostId))room.hostId=room.players[0].id;if(room.gameMode==='original'&&room.judgeId&&!room.players.some(p=>p.id===room.judgeId))room.judgeId=room.players[0].id;if(room.started&&room.players.length<3){room.started=false;room.phase='lobby';room.judgeId=null;room.currentBlack=null;room.submissions=[];}emitRoom(room);}
function leaveRoom(socket,replaced=false){const room=getRoom(socket);if(!room)return;const removedSubmissionIds=new Set(room.submissions.filter(s=>s.playerId===socket.id).map(s=>s.id));room.players=room.players.filter(p=>p.id!==socket.id);room.submissions=room.submissions.filter(s=>s.playerId!==socket.id);if(room.surveys)delete room.surveys[socket.id];if(room.roundVotes){delete room.roundVotes[socket.id];for(const [voter,submissionId] of Object.entries(room.roundVotes)){if(removedSubmissionIds.has(submissionId))delete room.roundVotes[voter];}}if(room.vote){room.vote.yes.delete(socket.id);room.vote.no.delete(socket.id);}socket.leave(room.code);socket.data.roomCode=null;if(room.gameMode==='chaos'&&room.phase==='voting')resolveChaosRound(room);reconcile(room);if(replaced)socket.emit('session-replaced');}
function claim(socket,key){key=sanitizeKey(key);if(!key)return null;const old=activeProfiles.get(key);if(old&&old!==socket.id){const s=io.sockets.sockets.get(old);if(s)leaveRoom(s,true);}activeProfiles.set(key,socket.id);socket.data.playerKey=key;return key;}
function persistFlag(type,text){if(!flagged.some(x=>x.type===type&&x.text===text)){flagged.push({type,text,reportedAt:new Date().toISOString()});writeJson(FLAGGED_PATH,flagged);}}
function removeFromRoom(room,type,text){if(type==='black'){room.removedBlack.add(text);room.blackDeck=room.blackDeck.filter(c=>c.text!==text);if(room.currentBlack?.text===text){restoreSubmissions(room);room.currentBlack=drawBlack(room);room.phase='playing';room.roundWinnerId=null;room.winningCards=null;}}else{room.removedWhite.add(text);room.whiteDeck=room.whiteDeck.filter(c=>c!==text);for(const p of room.players){p.hand=p.hand.filter(c=>c!==text);refillHand(room,p);}room.submissions=room.submissions.map(s=>({...s,cards:s.cards.filter(c=>c!==text)})).filter(s=>s.cards.length===(room.currentBlack?.pick||1));if(['judging','voting'].includes(room.phase)&&room.submissions.length<expectedSubmissions(room))room.phase='playing';}}
function resolveVote(room){const needed=Math.floor(room.players.length/2)+1;if(room.vote.yes.size>=needed){removeFromRoom(room,room.vote.type,room.vote.text);persistFlag(room.vote.type,room.vote.text);io.to(room.code).emit('toast','La carta se ha retirado de esta partida.');room.vote=null;}else if(room.vote.no.size>=needed||room.vote.yes.size+room.vote.no.size>=room.players.length){io.to(room.code).emit('toast','La votación no ha salido adelante.');room.vote=null;}emitRoom(room);}

function githubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'cartas-online-server'
  };
}
function githubContentsUrl() {
  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY debe tener el formato usuario/repositorio.');
  const encodedPath = GITHUB_CARDS_PATH.split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
}
async function saveCardsPermanentlyOnGithub(newBlack, newWhite) {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    throw new Error('Falta configurar GITHUB_TOKEN y GITHUB_REPOSITORY en Render.');
  }
  const url = githubContentsUrl();
  const getResponse = await fetch(`${url}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, { headers: githubHeaders() });
  if (!getResponse.ok) {
    const body = await getResponse.text();
    throw new Error(`GitHub no pudo leer ${GITHUB_CARDS_PATH} (${getResponse.status}): ${body.slice(0, 300)}`);
  }
  const currentFile = await getResponse.json();
  const currentText = Buffer.from(String(currentFile.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
  const current = JSON.parse(currentText);
  current.black = normalizeBlack([...(current.black || []), ...newBlack]);
  current.white = normalizeWhite([...(current.white || []), ...newWhite]);
  current._aiGenerated = {
    black: normalizeBlack([...(current._aiGenerated?.black || []), ...newBlack]),
    white: normalizeWhite([...(current._aiGenerated?.white || []), ...newWhite])
  };
  const content = Buffer.from(`${JSON.stringify(current, null, 2)}\n`, 'utf8').toString('base64');
  const putResponse = await fetch(url, {
    method: 'PUT',
    headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Añadir ${newBlack.length + newWhite.length} cartas generadas por IA`,
      content,
      sha: currentFile.sha,
      branch: GITHUB_BRANCH
    })
  });
  if (!putResponse.ok) {
    const body = await putResponse.text();
    throw new Error(`GitHub no pudo actualizar ${GITHUB_CARDS_PATH} (${putResponse.status}): ${body.slice(0, 300)}`);
  }
  return current;
}

function persistGame(room){analytics.games.push({endedAt:new Date().toISOString(),roomCode:room.code,summary:buildSummary(room),stats:room.stats});analytics.games=analytics.games.slice(-100);writeJson(ANALYTICS_PATH,analytics);}
async function generateAiCards(room){
  if(!process.env.OPENAI_API_KEY){console.warn('[IA] OPENAI_API_KEY no configurada.');room.aiStatus='disabled';emitRoom(room);return;}
  room.aiStatus='generating';room.aiError=null;emitRoom(room);
  const winningRounds=(room.stats.rounds||[]).map(r=>({round:r.round,question:r.black,winningAnswers:r.winningCards}));
  const data={
    roundsPlayed:room.roundNumber,
    winningRounds,
    topWinningAnswers:topEntries(room.stats.winningWhiteUses,30),
    allPlayedAnswers:topEntries(room.stats.whiteUses,50),
    surveyGenres:topEntries(room.stats.genres,8),
    averageRating:buildSummary(room).averageRating
  };
  console.log(`[IA] Enviando solicitud para la sala ${room.code}. Rondas ganadoras incluidas: ${winningRounds.length}. Modelo: ${AI_MODEL}`);
  try{
    const OpenAI=(await import('openai')).default;
    const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY,timeout:60000,maxRetries:2});
    const completion=await client.chat.completions.create({
      model:AI_MODEL,
      response_format:{type:'json_object'},
      messages:[
        {role:'system',content:'Eres diseñador de un juego de cartas de humor adulto entre amigos. Devuelve exclusivamente JSON válido con la forma {"black":[],"white":[]}. Genera contenido original en español de España. No copies ni reformules los ejemplos. Mantén humor negro, absurdo, incómodo, satírico y surrealista, sin sexualizar menores ni dirigir odio degradante contra grupos protegidos.'},
        {role:'user',content:`Analiza especialmente la respuesta ganadora de TODAS las rondas y los patrones que se repiten. Datos: ${JSON.stringify(data)}. Genera exactamente 8 cartas negras y 16 cartas blancas acordes al humor que realmente gana. Cada carta negra debe contener entre uno y tres huecos escritos exactamente como ____. No incluyas explicaciones.`}
      ]
    });
    const raw=completion.choices?.[0]?.message?.content||'';
    if(!raw)throw new Error('La API devolvió una respuesta vacía.');
    const generated=JSON.parse(raw);
    const newBlack=normalizeBlack(generated.black||[]);const newWhite=normalizeWhite(generated.white||[]);
    if(newBlack.length!==8||newWhite.length!==16)throw new Error(`Cantidad incorrecta: ${newBlack.length} negras y ${newWhite.length} blancas.`);
    const general=readJson(BASE_PATH,readJson(BUNDLED_BASE_PATH,{black:[],white:[]}));
    general.black=normalizeBlack([...(general.black||[]),...newBlack]);
    general.white=normalizeWhite([...(general.white||[]),...newWhite]);
    general._aiGenerated={
      black:normalizeBlack([...(general._aiGenerated?.black||[]),...newBlack]),
      white:normalizeWhite([...(general._aiGenerated?.white||[]),...newWhite])
    };
    writeJson(BASE_PATH,general);
    aiGenerated.black=normalizeBlack([...(aiGenerated.black||[]),...newBlack]);
    aiGenerated.white=normalizeWhite([...(aiGenerated.white||[]),...newWhite]);
    writeJson(AI_CARDS_PATH,aiGenerated);
    reloadCards();
    room.generatedCards={black:newBlack.map(c=>({text:c.text,pick:c.pick})),white:[...newWhite]};
    room.aiStatus='saving';emitRoom(room);
    console.log(`[GitHub] Guardando cartas de la sala ${room.code} en ${GITHUB_REPOSITORY}/${GITHUB_CARDS_PATH}...`);
    await saveCardsPermanentlyOnGithub(newBlack,newWhite);
    room.aiStatus='done';
    console.log(`[IA] Generación completada y guardada en GitHub para ${room.code}: ${newBlack.length} negras y ${newWhite.length} blancas.`);
  }catch(error){
    const details=error?.response?.data||error?.error||error?.message||String(error);
    console.error('[IA] Error generando cartas:',details);
    room.aiStatus='error';room.aiError=typeof details==='string'?details:JSON.stringify(details);
  }
  emitRoom(room);
}
function finishGame(room){room.phase='game-over';room.generatedCards=null;room.aiStatus='idle';persistGame(room);emitRoom(room);generateAiCards(room);}
function createRoomObject(code,socket,key,name,avatar,maxRounds,gameMode){const room={code,hostId:socket.id,players:[{id:socket.id,playerKey:key,name:sanitizeName(name),avatar:sanitizeAvatar(avatar),score:0,hand:[]}],started:false,phase:'lobby',gameMode:sanitizeGameMode(gameMode),judgeId:null,currentBlack:null,submissions:[],roundVotes:{},blackDeck:[],whiteDeck:[],roundWinnerId:null,winningCards:null,roundTie:false,removedBlack:new Set(),removedWhite:new Set(),vote:null,maxRounds:sanitizeRounds(maxRounds),roundNumber:0,surveys:{},generatedCards:null,aiStatus:'idle'};resetStats(room);return room;}

io.on('connection',socket=>{
  socket.on('create-room',({name,avatar,playerKey,maxRounds,gameMode},cb)=>{const key=claim(socket,playerKey);if(!key)return cb?.({ok:false,error:'No se pudo identificar este navegador.'});leaveRoom(socket);const code=makeRoomCode();const room=createRoomObject(code,socket,key,name,avatar,maxRounds,gameMode);rooms.set(code,room);socket.join(code);socket.data.roomCode=code;cb?.({ok:true,code});emitRoom(room);});
  socket.on('join-room',({code,name,avatar,playerKey},cb)=>{code=String(code||'').trim().toUpperCase();const room=rooms.get(code);if(!room)return cb?.({ok:false,error:'La sala no existe.'});if(room.started&&room.phase!=='game-over')return cb?.({ok:false,error:'La partida ya ha empezado.'});const key=claim(socket,playerKey);if(!key)return cb?.({ok:false,error:'No se pudo identificar este navegador.'});leaveRoom(socket);if(room.players.length>=12)return cb?.({ok:false,error:'La sala está llena.'});room.players.push({id:socket.id,playerKey:key,name:sanitizeName(name),avatar:sanitizeAvatar(avatar),score:0,hand:[]});socket.join(code);socket.data.roomCode=code;cb?.({ok:true,code});emitRoom(room);});
  socket.on('update-profile',({name,avatar},cb)=>{const room=getRoom(socket),p=room?.players.find(x=>x.id===socket.id);if(!p)return cb?.({ok:false,error:'No estás en una sala.'});p.name=sanitizeName(name);p.avatar=sanitizeAvatar(avatar);cb?.({ok:true});emitRoom(room);});
  socket.on('leave-room',(_d,cb)=>{leaveRoom(socket);cb?.({ok:true});});
  socket.on('start-game',(_d,cb)=>{const room=getRoom(socket);if(!room)return cb?.({ok:false,error:'Sala no encontrada.'});if(room.hostId!==socket.id)return cb?.({ok:false,error:'Solo puede iniciar el anfitrión.'});if(room.players.length<3)return cb?.({ok:false,error:'Se necesitan al menos 3 jugadores.'});room.started=true;room.roundNumber=1;room.players.forEach(p=>{p.score=0;p.hand=[];});room.blackDeck=makeBlackDeck(room);room.whiteDeck=makeWhiteDeck(room);resetStats(room);room.judgeId=room.gameMode==='original'?room.players[0].id:null;startRound(room);cb?.({ok:true});emitRoom(room);});
  socket.on('play-card',({cardIndices},cb)=>{const room=getRoom(socket);if(!room||room.phase!=='playing')return cb?.({ok:false,error:'No puedes jugar ahora.'});if(room.gameMode==='original'&&room.judgeId===socket.id)return cb?.({ok:false,error:'El juez no juega.'});if(room.submissions.some(s=>s.playerId===socket.id))return cb?.({ok:false,error:'Ya has jugado.'});const p=room.players.find(x=>x.id===socket.id),required=room.currentBlack?.pick||1,idx=[...new Set((Array.isArray(cardIndices)?cardIndices:[]).map(Number))];if(!p||idx.length!==required||idx.some(i=>!Number.isInteger(i)||i<0||i>=p.hand.length))return cb?.({ok:false,error:`Debes seleccionar exactamente ${required} carta${required===1?'':'s'}.`});const chosen=idx.map(i=>p.hand[i]);chosen.forEach(c=>count(room.stats.whiteUses,c));[...idx].sort((a,b)=>b-a).forEach(i=>p.hand.splice(i,1));room.submissions.push({id:`s-${Date.now()}-${Math.random().toString(36).slice(2)}`,playerId:socket.id,cards:chosen});refillHand(room,p);if(room.submissions.length===expectedSubmissions(room)){room.submissions=shuffle(room.submissions);room.phase=room.gameMode==='chaos'?'voting':'judging';}cb?.({ok:true});emitRoom(room);});
  socket.on('choose-winner',({submissionId},cb)=>{const room=getRoom(socket);if(!room||room.gameMode!=='original'||room.phase!=='judging'||room.judgeId!==socket.id)return cb?.({ok:false,error:'No puedes elegir ahora.'});const submission=room.submissions.find(x=>x.id===submissionId);if(!submission)return cb?.({ok:false,error:'Respuesta no válida.'});finishRound(room,submission,false);cb?.({ok:true});emitRoom(room);});
  socket.on('cast-round-vote',({submissionId},cb)=>{const room=getRoom(socket);if(!room||room.gameMode!=='chaos'||room.phase!=='voting')return cb?.({ok:false,error:'No hay una votación de ronda activa.'});const submission=room.submissions.find(s=>s.id===submissionId);if(!submission)return cb?.({ok:false,error:'Respuesta no válida.'});if(submission.playerId===socket.id)return cb?.({ok:false,error:'No puedes votar tu propia respuesta.'});if(room.roundVotes[socket.id])return cb?.({ok:false,error:'Ya has votado en esta ronda.'});room.roundVotes[socket.id]=submissionId;cb?.({ok:true});resolveChaosRound(room);emitRoom(room);});
  socket.on('submit-round-survey',({genre,rating},cb)=>{const room=getRoom(socket);if(!room||room.phase!=='round-survey')return cb?.({ok:false,error:'No hay encuesta activa.'});if(!surveyRequiredIds(room).includes(socket.id))return cb?.({ok:false,error:'Esta encuesta es para quienes jugaron esta ronda.'});genre=String(genre||'').toLowerCase();rating=Math.max(1,Math.min(5,Number(rating)||0));if(!HUMOR_GENRES.includes(genre)||!rating)return cb?.({ok:false,error:'Completa las dos preguntas.'});if(room.surveys[socket.id])return cb?.({ok:false,error:'Ya has respondido.'});room.surveys[socket.id]={genre,rating};count(room.stats.genres,genre);room.stats.ratings.push(rating);cb?.({ok:true});emitRoom(room);});
  socket.on('next-round',(_d,cb)=>{const room=getRoom(socket);if(!room||room.hostId!==socket.id||!['round-result','round-survey'].includes(room.phase))return cb?.({ok:false,error:'No puedes continuar ahora.'});const pending=room.phase==='round-survey'?surveyRequiredIds(room).filter(id=>!room.surveys[id]):[];if(pending.length)return cb?.({ok:false,error:`Faltan ${pending.length} encuesta${pending.length===1?'':'s'} por responder.`});if(room.roundNumber>=room.maxRounds){finishGame(room);return cb?.({ok:true,finished:true});}room.roundNumber++;if(room.gameMode==='original')advanceJudge(room);startRound(room);cb?.({ok:true});emitRoom(room);});
  socket.on('play-again',(_d,cb)=>{const room=getRoom(socket);if(!room||room.hostId!==socket.id||room.phase!=='game-over')return cb?.({ok:false,error:'No puedes reiniciar ahora.'});room.started=true;room.roundNumber=1;room.players.forEach(p=>{p.score=0;p.hand=[];});room.blackDeck=makeBlackDeck(room);room.whiteDeck=makeWhiteDeck(room);resetStats(room);room.judgeId=room.gameMode==='original'?(room.players[0]?.id||null):null;startRound(room);cb?.({ok:true});emitRoom(room);});
  socket.on('start-delete-vote',({type,text},cb)=>{const room=getRoom(socket);type=type==='black'?'black':'white';text=String(text||'').trim();if(!room||!text)return cb?.({ok:false,error:'Carta no válida.'});if(room.vote)return cb?.({ok:false,error:'Ya hay una votación activa.'});const allowed=type==='black'?room.currentBlack?.text===text:room.players.some(p=>p.hand.includes(text))||room.submissions.some(s=>s.cards.includes(text));if(!allowed)return cb?.({ok:false,error:'Esa carta no está disponible para votar.'});room.vote={id:Date.now().toString(36),type,text,yes:new Set([socket.id]),no:new Set()};cb?.({ok:true});resolveVote(room);});
  socket.on('cast-delete-vote',({voteId,choice},cb)=>{const room=getRoom(socket);if(!room?.vote||room.vote.id!==voteId)return cb?.({ok:false,error:'La votación ya no está activa.'});room.vote.yes.delete(socket.id);room.vote.no.delete(socket.id);(choice==='yes'?room.vote.yes:room.vote.no).add(socket.id);cb?.({ok:true});resolveVote(room);});
  socket.on('add-custom-card',({type,text},cb)=>{type=type==='black'?'black':'white';text=String(text||'').trim().slice(0,300);if(!text)return cb?.({ok:false,error:'Escribe el texto de la carta.'});if(type==='black'){const pick=(text.match(/____/g)||[]).length||1;custom.black=normalizeBlack([...(custom.black||[]),{text,pick}]);}else custom.white=normalizeWhite([...(custom.white||[]),text]);writeJson(CUSTOM_PATH,custom);reloadCards();for(const room of rooms.values()){if(type==='black')room.blackDeck.push(...cards.black.filter(c=>c.text===text));else room.whiteDeck.push(text);emitRoom(room);}cb?.({ok:true,stats:{black:cards.black.length,white:cards.white.length}});});
  socket.on('get-control-data',(_d,cb)=>cb?.({ok:true,flagged,stats:{black:cards.black.length,white:cards.white.length}}));
  socket.on('delete-flagged-card',({type,text},cb)=>{type=type==='black'?'black':'white';text=String(text||'').trim();deleted[type]=normalizeWhite([...(deleted[type]||[]),text]);flagged=flagged.filter(x=>!(x.type===type&&x.text===text));writeJson(DELETED_PATH,deleted);writeJson(FLAGGED_PATH,flagged);reloadCards();for(const room of rooms.values()){removeFromRoom(room,type,text);emitRoom(room);}cb?.({ok:true,flagged,stats:{black:cards.black.length,white:cards.white.length}});});
  socket.on('disconnect',()=>{leaveRoom(socket);const k=socket.data.playerKey;if(k&&activeProfiles.get(k)===socket.id)activeProfiles.delete(k);});
});
server.listen(PORT,()=>console.log(`Servidor iniciado en el puerto ${PORT}`));
