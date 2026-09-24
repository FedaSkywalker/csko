import './style.css';
import { Game } from './game.js';
import { TEAM_NAME } from './config.js';
import { MAPS, validMap } from './map/layout.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const DEFAULTS = {
  name: 'You', map: 'dustline', team: 'CT', teamSize: 5, difficulty: 'normal', winsNeeded: 8, quality: 'high',
  sensitivity: 2.0, fov: 74, volume: 0.7, voice: true, dialect: 1, nameTags: 'all',
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('browserstrike.settings') || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings() {
  try { localStorage.setItem('browserstrike.settings', JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

const settings = loadSettings();
if (params.has('map')) settings.map = params.get('map');
settings.map = validMap(settings.map);
let game;
try {
  game = new Game($('game'), { settings, test: TEST });
} catch (err) {
  $('loading').innerHTML = `<div class="loading-text">WebGL could not start: ${esc(err.message)}</div>`;
  throw err;
}
$('loading').classList.add('hidden');

// ------------------------------------------------------------ menu wiring
function bindSeg(key) {
  const seg = document.querySelector(`.seg[data-opt="${key}"]`);
  const buttons = [...seg.querySelectorAll('button')];
  const refresh = () => buttons.forEach((b) => b.classList.toggle('on', String(settings[key]) === b.dataset.val));
  buttons.forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.val;
    settings[key] = /^\d+$/.test(v) ? Number(v) : v;
    refresh();
    saveSettings();
    game.audio.play('ui');
    if (key === 'dialect' || key === 'nameTags') game.applySettings({ [key]: settings[key] });
    if (key === 'map') showMenuMap();
  }));
  refresh();
}
['map', 'team', 'teamSize', 'difficulty', 'winsNeeded', 'quality', 'dialect', 'nameTags'].forEach(bindSeg);

// The menu flyover shows the selected map.
function showMenuMap() {
  if (game.state === 'menu') game.loadMap(settings.map);
  $('mapName').textContent = MAPS.find((m) => m.id === settings.map)?.name || settings.map;
}
showMenuMap();

function bindRange(ids, key, fmt, onChange) {
  const inputs = ids.map(([inp]) => $(inp));
  const labels = ids.map(([, lab]) => $(lab));
  const sync = () => {
    inputs.forEach((i) => { i.value = settings[key]; });
    labels.forEach((l) => { l.textContent = fmt(settings[key]); });
  };
  inputs.forEach((i) => i.addEventListener('input', () => {
    settings[key] = Number(i.value);
    sync();
    saveSettings();
    onChange?.();
  }));
  sync();
}
bindRange([['sensInput', 'sensVal'], ['sensInput2', 'sensVal2']], 'sensitivity', (v) => v.toFixed(2), () => game.applySettings({ sensitivity: settings.sensitivity }));
bindRange([['fovInput', 'fovVal'], ['fovInput2', 'fovVal2']], 'fov', (v) => `${v}°`, () => game.applySettings({ fov: settings.fov }));
bindRange([['volInput', 'volVal'], ['volInput2', 'volVal2']], 'volume', (v) => `${Math.round(v * 100)}%`, () => game.applySettings({ volume: settings.volume }));
$('voiceInput').checked = settings.voice;
$('voiceInput').addEventListener('change', () => { settings.voice = $('voiceInput').checked; saveSettings(); game.applySettings({ voice: settings.voice }); });
$('nameInput').value = settings.name;
$('nameInput').addEventListener('input', () => { settings.name = $('nameInput').value.trim().slice(0, 16) || 'You'; saveSettings(); });

function show(id, v) { $(id).classList.toggle('hidden', !v); }

function enterGame() {
  show('menu', false);
  show('matchover', false);
  show('pause', false);
  game.hud.show(true);
  game.input.clearEdges();
  if (!TEST) game.input.requestLock();
}

function startMatch() {
  document.activeElement?.blur?.();
  game.audio.init();
  game.applySettings({ ...settings });
  game.startLocal({
    map: settings.map, team: settings.team, teamSize: settings.teamSize, difficulty: settings.difficulty,
    winsNeeded: settings.winsNeeded, playerName: settings.name,
  });
  enterGame();
}

function serverTarget(addr, room) {
  const host = (addr || location.host).replace(/^(https?|wss?):\/\//, '').replace(/\/.*$/, '');
  return { host, room, protocol: location.protocol === 'https:' ? 'wss' : 'ws' };
}

function cleanRoom(r) {
  return String(r || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'dustline';
}

async function joinRoom(addr = $('serverInput').value.trim() || location.host, room = $('roomInput').value) {
  document.activeElement?.blur?.();
  room = cleanRoom(room);
  $('roomInput').value = room;
  settings.server = addr;
  settings.room = room;
  saveSettings();
  $('lanMsg').textContent = `Connecting to room "${room}" on ${addr}…`;
  game.audio.init();
  game.applySettings({ ...settings });
  try {
    await game.startNet(serverTarget(addr, room), {
      playerName: settings.name, team: settings.team, map: settings.map,
      teamSize: settings.teamSize, difficulty: settings.difficulty, winsNeeded: settings.winsNeeded,
    });
    $('lanMsg').textContent = '';
    enterGame();
  } catch (err) {
    $('lanMsg').textContent = `${err.message} Is the server running (npm start) and reachable at ${addr}?`;
  }
}

$('playBtn').addEventListener('click', startMatch);
$('againBtn').addEventListener('click', startMatch);
// The page is served by the game server (or the Vite proxy), so its own host is the right default.
$('serverInput').value = location.host;
$('roomInput').value = settings.room || 'dustline';
$('joinBtn').addEventListener('click', () => joinRoom());
for (const id of ['serverInput', 'roomInput']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
$('teamT').addEventListener('click', () => { game.requestTeam('T'); $('pauseLockMsg').textContent = 'You switch to the Terrorists next round.'; });
$('teamCT').addEventListener('click', () => { game.requestTeam('CT'); $('pauseLockMsg').textContent = 'You switch to the Counter-Terrorists next round.'; });
game.onDisconnect = (reason) => {
  toMenu();
  $('lanMsg').textContent = reason || 'Disconnected from the server.';
};
game.onMatchStart = () => {
  if (game.mode === 'net') show('matchover', false);
};
$('menuBtn').addEventListener('click', toMenu);
$('quitBtn').addEventListener('click', toMenu);
$('resumeBtn').addEventListener('click', () => {
  document.activeElement?.blur?.();
  game.audio.init();
  game.input.requestLock();
});
$('game').addEventListener('click', () => {
  if (game.state === 'paused' || (game.state === 'playing' && !game.input.locked && !TEST)) game.input.requestLock();
});

function toMenu() {
  game.endSession();
  showMenuMap();
  game.input.exitLock();
  game.hud.show(false);
  game.hud.closeBuy();
  show('pause', false);
  show('matchover', false);
  show('menu', true);
}

game.input.onLockChange = (locked) => {
  $('pauseLockMsg').textContent = '';
  $('lockMsg').textContent = '';
  if (locked) {
    game.input.clearEdges();
    if (game.state === 'paused') game.state = 'playing';
    show('pause', false);
  } else if (game.state === 'playing') {
    game.state = 'paused';
    game.hud.closeBuy();
    game.hud.closeChat();
    $('pauseNote').textContent = game.mode === 'net' ? 'Multiplayer keeps running while you are paused. Your player stands still.' : '';
    show('pause', true);
  }
};
game.input.onLockError = () => {
  const msg = 'Mouse lock was refused by the browser — click again in a second.';
  $('pauseLockMsg').textContent = msg;
  $('lockMsg').textContent = msg;
  if (game.state === 'playing') {
    game.state = 'paused';
    show('pause', true);
  }
};

game.onMatchOver = (winner) => {
  const R = game.round;
  $('moTitle').textContent = `${TEAM_NAME[winner]} win the match`;
  $('moScore').innerHTML = `<span class="t">${R.score.T}</span> : <span class="ct">${R.score.CT}</span>`;
  const rows = [...game.agents].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map((a) =>
    `<tr class="${a === game.player ? 'me' : ''}"><td><span class="${a.team === 'T' ? 't' : 'ct'}">${esc(a.name)}</span></td><td>${a.kills}</td><td>${a.assists}</td><td>${a.deaths}</td><td>${a.kills ? Math.round((a.headshots / a.kills) * 100) : 0}%</td><td>${a.mvps}</td></tr>`).join('');
  $('moTable').innerHTML = `<table><tr><th>Player</th><th>K</th><th>A</th><th>D</th><th>HS</th><th>MVP</th></tr>${rows}</table>`;
  const net = game.mode === 'net';
  $('againBtn').classList.toggle('hidden', net);
  $('menuBtn').textContent = net ? 'Leave server' : 'Menu';
  $('moNote').textContent = net ? `Room "${game.roomName}": the next match starts automatically in a few seconds.` : '';
  show('matchover', true);
  if (!net) game.hud.show(false);
};

// ------------------------------------------------------------ main loop
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;
  game.frame(dt);
}
requestAnimationFrame(loop);

window.game = game; // handy for debugging from the console

if (TEST) {
  const team = params.get('team') || 'CT';
  settings.team = team;
  settings.teamSize = Number(params.get('size') || 5);
  if (params.has('join')) {
    settings.name = params.get('name') || 'Tester';
    joinRoom(params.get('join') || location.host, params.get('room') || 'test');
  } else {
    startMatch();
  }
}
