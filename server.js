// Don't Scream - oda kodu aktarici (relay) sunucusu.
// Oyuncular buraya WebSocket ile baglanir; sunucu sadece mesajlari odadaki diger oyunculara iletir.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 5;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Dont Scream relay calisiyor. Oda sayisi: ' + rooms.size);
});
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
const rooms = new Map(); // kod -> { players: Map(id -> ws), started: false }
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (let n = 0; n < 50; n++) {
    let c = '';
    for (let i = 0; i < 5; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj, exceptId) {
  for (const [id, w] of room.players) if (id !== exceptId) send(w, obj);
}
function leave(ws) {
  const room = ws.room;
  if (!room) return;
  room.players.delete(ws.pid);
  if (ws.pid === 1) { // oda kurucu ayrildi: oda kapanir
    broadcast(room, { t: 'closed' });
    for (const w of room.players.values()) { w.room = null; }
    rooms.delete(ws.code);
  } else {
    broadcast(room, { t: 'peer_left', id: ws.pid });
    if (room.players.size === 0) rooms.delete(ws.code);
  }
  ws.room = null;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.room = null; ws.pid = 0; ws.code = '';
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    const name = String(m.name || 'Oyuncu').slice(0, 14);
    if (m.t === 'create') {
      if (ws.room) leave(ws);
      const code = newCode();
      if (!code) return send(ws, { t: 'error', msg: 'Oda acilamadi.' });
      const room = { players: new Map(), started: false, names: new Map() };
      ws.pid = 1; ws.code = code; ws.room = room; ws.pname = name;
      room.players.set(1, ws);
      rooms.set(code, room);
      send(ws, { t: 'created', code, id: 1 });
    } else if (m.t === 'join') {
      if (ws.room) leave(ws);
      const code = String(m.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: 'Bu kodda oda yok.' });
      if (room.started) return send(ws, { t: 'error', msg: 'Oyun zaten basladi.' });
      if (room.players.size >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'Oda dolu (en fazla ' + MAX_PLAYERS + ' kisi).' });
      let id = 2;
      while (room.players.has(id)) id++;
      ws.pid = id; ws.code = code; ws.room = room; ws.pname = name;
      room.players.set(id, ws);
      const list = [...room.players].map(([pid, w]) => ({ id: pid, name: w.pname }));
      send(ws, { t: 'joined', code, id, players: list });
      broadcast(room, { t: 'peer_joined', id, name }, id);
    } else if (m.t === 'start') {
      const room = ws.room;
      if (!room || ws.pid !== 1) return;
      room.started = true;
      broadcast(room, { t: 'start', seed: Math.floor(Math.random() * 1e9) });
    } else if (m.t === 'msg') {
      const room = ws.room;
      if (!room) return;
      const out = { t: 'msg', from: ws.pid, d: m.d };
      const to = Number(m.to || 0);
      if (to === 0) broadcast(room, out, ws.pid);
      else if (room.players.has(to)) send(room.players.get(to), out);
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

// olu baglantilari temizle
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log('Relay hazir, port ' + PORT));
