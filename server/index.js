// Browser Strike server: serves the built game (dist/) and runs the game rooms over WebSocket.
//   npm run build && npm start        env: PORT (3000), HOST (0.0.0.0), MAX_ROOMS (32), BS_DEBUG=1 (test hooks)
// Rooms:  ws(s)://<host>/ws/<room>
// Status: GET /api/health, GET /api/rooms, GET /api/room/<room>
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameRoom } from './room.js';
import { NET_PROTOCOL } from '../src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 32;
const DEBUG = process.env.BS_DEBUG === '1';
const ROOM_RE = /^[a-z0-9_-]{1,32}$/;
const MAX_BUFFERED = 1 << 20; // a client this far behind can't keep up: drop it
const HEARTBEAT_MS = 20000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// ------------------------------------------------------------ static files
// The build is small, so it is read into memory once (with gzip copies). Only files that exist
// in dist/ can ever be served.
const files = new Map();

function loadDist() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error(`No build found in ${DIST}. Run "npm run build" first.`);
    process.exit(1);
  }
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const url = '/' + path.relative(DIST, p).split(path.sep).join('/');
      const body = fs.readFileSync(p);
      const type = MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
      const gz = /^(text\/|application\/json|image\/svg)/.test(type) && body.length > 1024 ? zlib.gzipSync(body, { level: 9 }) : null;
      files.set(url, { type, body, gz, immutable: url.startsWith('/assets/') });
    }
  };
  walk(DIST);
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// ------------------------------------------------------------ rooms
const rooms = new Map();
let nextConnId = 1;

function roomStatus(name) {
  return (rooms.get(name) || new GameRoom(name)).status();
}

function handleHttp(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { p = ''; }
  if (p === '/api/health') return sendJson(res, 200, { ok: true, protocol: NET_PROTOCOL, rooms: rooms.size });
  if (p === '/api/rooms') {
    return sendJson(res, 200, [...rooms.values()].filter((r) => r.running).map((r) => {
      const s = r.status();
      return { room: s.room, map: s.map, players: s.players.length, round: s.round, score: s.score };
    }));
  }
  const m = p.match(/^\/api\/room\/([^/]+)$/);
  if (m) return ROOM_RE.test(m[1]) ? sendJson(res, 200, roomStatus(m[1])) : sendJson(res, 400, { error: 'Bad room name.' });

  let f = files.get(p === '/' ? '/index.html' : p);
  if (!f && !path.extname(p) && !p.startsWith('/api/')) f = files.get('/index.html'); // single-page app
  if (!f) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = gz ? f.gz : f.body;
  const headers = {
    'Content-Type': f.type,
    'Content-Length': body.length,
    'Cache-Control': f.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Accept-Encoding',
  };
  if (gz) headers['Content-Encoding'] = 'gzip';
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function onSocket(ws, name) {
  // Without an error listener a bad frame or an oversized message would crash the whole process.
  ws.on('error', (e) => console.warn(`[${name}] socket error: ${e.message}`));
  const refuse = (msg) => {
    ws.send(JSON.stringify({ t: 'error', msg }));
    ws.close(1008, msg.slice(0, 120));
  };
  if (!ROOM_RE.test(name)) { refuse('Bad room name.'); return; }
  let room = rooms.get(name);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) { refuse(`The server is full (${MAX_ROOMS} rooms). Try again later.`); return; }
    room = new GameRoom(name, { debug: DEBUG });
    rooms.set(name, room);
  }
  const conn = {
    id: nextConnId++,
    send(s) {
      if (ws.readyState !== ws.OPEN) return;
      // Snapshots carry the events, so a lagging client can't just skip some: drop it instead.
      if (ws.bufferedAmount > MAX_BUFFERED) { ws.terminate(); return; }
      ws.send(s);
    },
    close(code, reason) {
      try { ws.close(code, reason); } catch { ws.terminate(); }
    },
  };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  room.onConnect(conn);
  ws.on('message', (data, isBinary) => {
    if (!isBinary) room.onMessage(data.toString(), conn);
  });
  ws.on('close', () => {
    room.onClose(conn);
    if (room.empty && rooms.get(name) === room) {
      room.stop();
      rooms.delete(name);
    }
  });
}

// ------------------------------------------------------------ server
loadDist();
const server = http.createServer(handleHttp);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  let name = null;
  try {
    const m = new URL(req.url, 'http://x').pathname.match(/^\/ws\/([^/]+)$/);
    if (m) name = decodeURIComponent(m[1]);
  } catch { /* malformed URL */ }
  if (name === null) {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, name));
});

// Half-open connections (a player's Wi-Fi died) never fire 'close' on their own.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Start with PORT=<other port>.`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Browser Strike server on http://${shown}:${PORT}${DEBUG ? '  (BS_DEBUG test hooks ON)' : ''}`);
  if (HOST === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  on your network: http://${a.address}:${PORT}`);
    }
  }
});

function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  clearInterval(heartbeat);
  for (const ws of wss.clients) {
    try { ws.close(1001, 'The server shut down.'); } catch { /* already gone */ }
  }
  for (const room of rooms.values()) room.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
