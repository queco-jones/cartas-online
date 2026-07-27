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
const BASE_PATH = path.join(__dirname, 'cards.json');
const CUSTOM_PATH = path.join(DATA_DIR, 'custom-cards.json');
const FLAGGED_PATH = path.join(DATA_DIR, 'flagged-cards.json');
const DELETED_PATH = path.join(DATA_DIR, 'deleted-cards.json');

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); }
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

let custom = readJson(CUSTOM_PATH, { black: [], white: [] });
let flagged = readJson(FLAGGED_PATH, []);
let deleted = readJson(DELETED_PATH, { black: [], white: [] });
let cards;
function reloadCards() {
  const base = readJson(BASE_PATH, { black: [], white: [] });
  custom = readJson(CUSTOM_PATH, custom || { black: [], white: [] });
  deleted = readJson(DELETED_PATH, deleted || { black: [], white: [] });
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
function shuffle(a) { const x=[...a]; for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];} return x; }
function makeRoomCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let c;do{c=Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');}while(rooms.has(c));return c;}
function sanitizeName(v){return String(v||'').trim().slice(0,24)||'Jugador';}
function sanitizeAvatar(v){v=String(v||'');return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)&&v.length<=180000?v:'';}
function sanitizeKey(v){v=String(v||'').trim();return /^[a-zA-Z0-9_-]{12,80}$/.test(v)?v:'';}
function getRoom(socket){return socket.data.roomCode?rooms.get(socket.data.roomCode):null;}
function refillHand(room,p){while(p.hand.length<10){if(!room.whiteDeck.length)room.whiteDeck=shuffle(cards.white.filter(c=>!room.removedWhite.has(c))); if(!room.whiteDeck.length)break; p.hand.push(room.whiteDeck.pop());}}
function restoreSubmissions(room){for(const s of room.submissions){const p=room.players.find(x=>x.id===s.playerId);if(p)p.hand.push(...s.cards.filter(c=>!room.removedWhite.has(c)));}room.submissions=[];for(const p of room.players)refillHand(room,p);}
function drawBlack(room){if(!room.blackDeck.length)room.blackDeck=shuffle(cards.black.filter(c=>!room.removedBlack.has(c.text)));return room.blackDeck.pop()||{text:'Sin preguntas disponibles.',pick:1};}
function startRound(room){room.phase='playing';room.submissions=[];room.roundWinnerId=null;room.winningCards=null;room.currentBlack=drawBlack(room);for(const p of room.players)refillHand(room,p);}
function advanceJudge(room){const i=room.players.findIndex(p=>p.id===room.judgeId);room.judgeId=room.players[(i<0?0:(i+1)%room.players.length)]?.id||null;}
function publicVote(room){if(!room.vote)return null;return {id:room.vote.id,type:room.vote.type,text:room.vote.text,yes:room.vote.yes.size,no:room.vote.no.size,total:room.players.length,needed:Math.floor(room.players.length/2)+1,hasVoted:[...room.vote.yes,...room.vote.no]};}
function publicRoom(room){return {code:room.code,hostId:room.hostId,started:room.started,phase:room.phase,judgeId:room.judgeId,blackCard:room.currentBlack?.text||null,cardsRequired:room.currentBlack?.pick||1,deckStats:{black:cards.black.length,white:cards.white.length},players:room.players.map(p=>({id:p.id,name:p.name,avatar:p.avatar,score:p.score,cardCount:p.hand.length,hasPlayed:room.submissions.some(s=>s.playerId===p.id)})),submissions:room.phase==='judging'?room.submissions.map(s=>({submissionId:s.id,cards:s.cards})):[],roundWinnerId:room.roundWinnerId||null,winningCards:room.winningCards||null,vote:publicVote(room)};}
function emitRoom(room){io.to(room.code).emit('room-state',publicRoom(room));for(const p of room.players)io.to(p.id).emit('private-state',{hand:p.hand,isHost:p.id===room.hostId,isJudge:p.id===room.judgeId});}
function reconcile(room){if(!room.players.length){rooms.delete(room.code);return;}if(!room.players.some(p=>p.id===room.hostId))room.hostId=room.players[0].id;if(!room.players.some(p=>p.id===room.judgeId))room.judgeId=room.players[0].id;if(room.started&&room.players.length<3){room.started=false;room.phase='lobby';room.judgeId=null;room.currentBlack=null;room.submissions=[];}emitRoom(room);}
function leaveRoom(socket,replaced=false){const room=getRoom(socket);if(!room)return;room.players=room.players.filter(p=>p.id!==socket.id);room.submissions=room.submissions.filter(s=>s.playerId!==socket.id);if(room.vote){room.vote.yes.delete(socket.id);room.vote.no.delete(socket.id);}socket.leave(room.code);socket.data.roomCode=null;reconcile(room);if(replaced)socket.emit('session-replaced');}
function claim(socket,key){key=sanitizeKey(key);if(!key)return null;const old=activeProfiles.get(key);if(old&&old!==socket.id){const s=io.sockets.sockets.get(old);if(s)leaveRoom(s,true);}activeProfiles.set(key,socket.id);socket.data.playerKey=key;return key;}
function persistFlag(type,text){if(!flagged.some(x=>x.type===type&&x.text===text)){flagged.push({type,text,reportedAt:new Date().toISOString()});writeJson(FLAGGED_PATH,flagged);}}
function removeFromRoom(room,type,text){
  if(type==='black'){
    room.removedBlack.add(text);room.blackDeck=room.blackDeck.filter(c=>c.text!==text);
    if(room.currentBlack?.text===text){restoreSubmissions(room);room.currentBlack=drawBlack(room);room.phase='playing';room.roundWinnerId=null;room.winningCards=null;}
  } else {
    room.removedWhite.add(text);room.whiteDeck=room.whiteDeck.filter(c=>c!==text);
    for(const p of room.players){p.hand=p.hand.filter(c=>c!==text);refillHand(room,p);}
    room.submissions=room.submissions.map(s=>({...s,cards:s.cards.filter(c=>c!==text)})).filter(s=>s.cards.length===(room.currentBlack?.pick||1));
    if(room.phase==='judging'&&room.submissions.length<room.players.length-1)room.phase='playing';
  }
}
function resolveVote(room){const needed=Math.floor(room.players.length/2)+1;if(room.vote.yes.size>=needed){removeFromRoom(room,room.vote.type,room.vote.text);persistFlag(room.vote.type,room.vote.text);io.to(room.code).emit('toast','La carta se ha retirado de esta partida.');room.vote=null;}else if(room.vote.no.size>=needed||room.vote.yes.size+room.vote.no.size>=room.players.length){io.to(room.code).emit('toast','La votación no ha salido adelante.');room.vote=null;}emitRoom(room);}

io.on('connection',socket=>{
  socket.on('create-room',({name,avatar,playerKey},cb)=>{const key=claim(socket,playerKey);if(!key)return cb?.({ok:false,error:'No se pudo identificar este navegador.'});leaveRoom(socket);const code=makeRoomCode();const room={code,hostId:socket.id,players:[{id:socket.id,playerKey:key,name:sanitizeName(name),avatar:sanitizeAvatar(avatar),score:0,hand:[]}],started:false,phase:'lobby',judgeId:null,currentBlack:null,submissions:[],blackDeck:shuffle(cards.black),whiteDeck:shuffle(cards.white),roundWinnerId:null,winningCards:null,removedBlack:new Set(),removedWhite:new Set(),vote:null};rooms.set(code,room);socket.join(code);socket.data.roomCode=code;cb?.({ok:true,code});emitRoom(room);});
  socket.on('join-room',({code,name,avatar,playerKey},cb)=>{code=String(code||'').trim().toUpperCase();const room=rooms.get(code);if(!room)return cb?.({ok:false,error:'La sala no existe.'});if(room.started)return cb?.({ok:false,error:'La partida ya ha empezado.'});const key=claim(socket,playerKey);if(!key)return cb?.({ok:false,error:'No se pudo identificar este navegador.'});leaveRoom(socket);if(room.players.length>=12)return cb?.({ok:false,error:'La sala está llena.'});room.players.push({id:socket.id,playerKey:key,name:sanitizeName(name),avatar:sanitizeAvatar(avatar),score:0,hand:[]});socket.join(code);socket.data.roomCode=code;cb?.({ok:true,code});emitRoom(room);});
  socket.on('update-profile',({name,avatar},cb)=>{const room=getRoom(socket),p=room?.players.find(x=>x.id===socket.id);if(!p)return cb?.({ok:false,error:'No estás en una sala.'});p.name=sanitizeName(name);p.avatar=sanitizeAvatar(avatar);cb?.({ok:true});emitRoom(room);});
  socket.on('leave-room',(_d,cb)=>{leaveRoom(socket);cb?.({ok:true});});
  socket.on('start-game',(_d,cb)=>{const room=getRoom(socket);if(!room)return cb?.({ok:false,error:'Sala no encontrada.'});if(room.hostId!==socket.id)return cb?.({ok:false,error:'Solo puede iniciar el anfitrión.'});if(room.players.length<3)return cb?.({ok:false,error:'Se necesitan al menos 3 jugadores.'});room.started=true;room.judgeId=room.players[0].id;startRound(room);cb?.({ok:true});emitRoom(room);});
  socket.on('play-card',({cardIndices},cb)=>{const room=getRoom(socket);if(!room||room.phase!=='playing')return cb?.({ok:false,error:'No puedes jugar ahora.'});if(room.judgeId===socket.id)return cb?.({ok:false,error:'El juez no juega.'});if(room.submissions.some(s=>s.playerId===socket.id))return cb?.({ok:false,error:'Ya has jugado.'});const p=room.players.find(x=>x.id===socket.id),required=room.currentBlack?.pick||1,idx=[...new Set((Array.isArray(cardIndices)?cardIndices:[]).map(Number))];if(!p||idx.length!==required||idx.some(i=>!Number.isInteger(i)||i<0||i>=p.hand.length))return cb?.({ok:false,error:`Debes seleccionar exactamente ${required} carta${required===1?'':'s'}.`});const chosen=idx.map(i=>p.hand[i]);[...idx].sort((a,b)=>b-a).forEach(i=>p.hand.splice(i,1));room.submissions.push({id:`${socket.id}-${Date.now()}`,playerId:socket.id,cards:chosen});refillHand(room,p);if(room.submissions.length===room.players.length-1){room.submissions=shuffle(room.submissions);room.phase='judging';}cb?.({ok:true});emitRoom(room);});
  socket.on('choose-winner',({submissionId},cb)=>{const room=getRoom(socket);if(!room||room.phase!=='judging'||room.judgeId!==socket.id)return cb?.({ok:false,error:'No puedes elegir ahora.'});const s=room.submissions.find(x=>x.id===submissionId),w=room.players.find(p=>p.id===s?.playerId);if(!s||!w)return cb?.({ok:false,error:'Respuesta no válida.'});w.score++;room.roundWinnerId=w.id;room.winningCards=s.cards;room.phase='round-end';cb?.({ok:true});emitRoom(room);});
  socket.on('next-round',(_d,cb)=>{const room=getRoom(socket);if(!room||room.hostId!==socket.id||room.phase!=='round-end')return cb?.({ok:false,error:'No puedes continuar ahora.'});advanceJudge(room);startRound(room);cb?.({ok:true});emitRoom(room);});
  socket.on('start-delete-vote',({type,text},cb)=>{const room=getRoom(socket);type=type==='black'?'black':'white';text=String(text||'').trim();if(!room||!text)return cb?.({ok:false,error:'Carta no válida.'});if(room.vote)return cb?.({ok:false,error:'Ya hay una votación activa.'});const allowed=type==='black'?room.currentBlack?.text===text:room.players.some(p=>p.hand.includes(text))||room.submissions.some(s=>s.cards.includes(text));if(!allowed)return cb?.({ok:false,error:'Esa carta no está disponible para votar.'});room.vote={id:Date.now().toString(36),type,text,yes:new Set([socket.id]),no:new Set()};cb?.({ok:true});resolveVote(room);});
  socket.on('cast-delete-vote',({voteId,choice},cb)=>{const room=getRoom(socket);if(!room?.vote||room.vote.id!==voteId)return cb?.({ok:false,error:'La votación ya no está activa.'});room.vote.yes.delete(socket.id);room.vote.no.delete(socket.id);(choice==='yes'?room.vote.yes:room.vote.no).add(socket.id);cb?.({ok:true});resolveVote(room);});
  socket.on('add-custom-card',({type,text},cb)=>{type=type==='black'?'black':'white';text=String(text||'').trim().slice(0,300);if(!text)return cb?.({ok:false,error:'Escribe el texto de la carta.'});if(type==='black'){const pick=(text.match(/____/g)||[]).length||1;custom.black=normalizeBlack([...(custom.black||[]),{text,pick}]);}else custom.white=normalizeWhite([...(custom.white||[]),text]);writeJson(CUSTOM_PATH,custom);reloadCards();for(const room of rooms.values()){if(type==='black')room.blackDeck.push(...cards.black.filter(c=>c.text===text));else room.whiteDeck.push(text);emitRoom(room);}cb?.({ok:true,stats:{black:cards.black.length,white:cards.white.length}});});
  socket.on('get-control-data',(_d,cb)=>cb?.({ok:true,flagged,stats:{black:cards.black.length,white:cards.white.length}}));
  socket.on('delete-flagged-card',({type,text},cb)=>{type=type==='black'?'black':'white';text=String(text||'').trim();deleted[type]=normalizeWhite([...(deleted[type]||[]),text]);flagged=flagged.filter(x=>!(x.type===type&&x.text===text));writeJson(DELETED_PATH,deleted);writeJson(FLAGGED_PATH,flagged);reloadCards();for(const room of rooms.values()){removeFromRoom(room,type,text);emitRoom(room);}cb?.({ok:true,flagged,stats:{black:cards.black.length,white:cards.white.length}});});
  socket.on('disconnect',()=>{leaveRoom(socket);const k=socket.data.playerKey;if(k&&activeProfiles.get(k)===socket.id)activeProfiles.delete(k);});
});
server.listen(PORT,()=>console.log(`Servidor iniciado en el puerto ${PORT}`));
