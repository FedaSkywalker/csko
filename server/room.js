// One game room = one match. Runs the authoritative simulation at 64 ticks per second, receives
// player commands over WebSocket and sends every player a snapshot per tick.
import { Sim } from '../src/sim.js';
import { DT, NET_PROTOCOL } from '../src/config.js';
import { encodeEvent, snapshotCommon, snapshotPrivate, rosterList, decodeCmd } from '../src/netcodec.js';
import { validMap } from '../src/map/layout.js';

const STARVE_LIMIT = 8;
const MAX_QUEUE = 16;
export const MAX_HUMANS = 10;
const DIFFICULTIES = ['easy', 'normal', 'hard'];
const clampInt = (v, lo, hi, def) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
};

function cleanName(n) {
  const s = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return s || 'Player';
}

export class GameRoom {
  // conn objects passed in: { id, send(string), close(code?, reason?) }
  constructor(id, { debug = false } = {}) {
    this.id = id;
    this.sim = null;
    this.clients = new Map(); // connection id -> client state
    this.running = false;
    this.events = [];
    this.rosterDirty = false;
    this.restartAt = 0;
    this.cfg = { teamSize: 5, difficulty: 'normal', winsNeeded: 8, map: 'dustline' };
    this.timer = null;
    this.debug = debug;
  }

  get empty() {
    return this.clients.size === 0;
  }

  _ensureSim() {
    if (this.sim) return this.sim;
    const sim = new Sim({ authority: true, map: this.cfg.map });
    sim.lagComp = true;
    sim.onEmit = (name, data) => {
      if (name === 'roster') { this.rosterDirty = true; return; }
      this.events.push(encodeEvent(name, data));
    };
    sim.events.on('matchOver', () => { this.restartAt = sim.time + 12; });
    this.sim = sim;
    return sim;
  }

  // ------------------------------------------------------------ connections
  onConnect(conn) {
    this.clients.set(conn.id, { conn, agent: null, queue: [], last: null, starved: 0, ack: 0 });
  }

  onMessage(message, conn) {
    const c = this.clients.get(conn.id);
    if (!c) return;
    let m;
    try { m = JSON.parse(message); } catch { return; }
    try { this._handle(c, m); } catch (e) { console.error(`[${this.id}] message error`, e); }
  }

  onClose(conn) {
    this._leave(conn.id);
  }

  // Room status for GET /api/room/<name>.
  status() {
    const sim = this.sim;
    return {
      protocol: NET_PROTOCOL,
      room: this.id,
      running: this.running,
      cfg: this.cfg,
      map: this.cfg.map,
      players: sim ? sim.humans().map((a) => ({ name: a.name, team: a.team, alive: a.alive })) : [],
      round: sim ? sim.round.round : 0,
      score: sim ? sim.round.score : { T: 0, CT: 0 },
    };
  }

  _send(c, obj) {
    c.conn.send(JSON.stringify(obj));
  }

  _broadcastJoined(obj) {
    const s = JSON.stringify(obj);
    for (const c of this.clients.values()) if (c.agent) c.conn.send(s);
  }

  _uniqueName(base) {
    const taken = new Set(this.sim.agents.map((a) => a.name));
    if (!taken.has(base)) return base;
    for (let i = 2; i < 100; i++) if (!taken.has(`${base} (${i})`)) return `${base} (${i})`;
    return `${base} ${Date.now() % 1000}`;
  }

  _pickTeam(pref) {
    if (pref === 'T' || pref === 'CT') return pref;
    const humans = { T: 0, CT: 0 };
    for (const a of this.sim.humans()) humans[a.team]++;
    if (humans.T !== humans.CT) return humans.T < humans.CT ? 'T' : 'CT';
    return Math.random() < 0.5 ? 'T' : 'CT';
  }

  _reject(c, msg) {
    this._send(c, { t: 'error', msg });
    c.conn.close(1008, msg.slice(0, 120));
  }

  _handle(c, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') {
      if (c.agent) return;
      if (m.v !== NET_PROTOCOL) {
        this._reject(c, `Version mismatch (server ${NET_PROTOCOL}, client ${m.v}). Reload the page.`);
        return;
      }
      if (this.sim && this.sim.humans().length >= MAX_HUMANS) {
        this._reject(c, `Room "${this.id}" is full (${MAX_HUMANS} players).`);
        return;
      }
      if (!this.running) {
        // The first player in an empty room decides the map and the match settings.
        const cfg = m.cfg || {};
        this.cfg = {
          teamSize: clampInt(cfg.teamSize, 1, 5, 5),
          difficulty: DIFFICULTIES.includes(cfg.difficulty) ? cfg.difficulty : 'normal',
          winsNeeded: clampInt(cfg.winsNeeded, 1, 30, 8),
          map: validMap(cfg.map),
        };
        if (this.sim && this.sim.mapId !== this.cfg.map) this.sim = null;
      }
      const sim = this._ensureSim();
      const name = this._uniqueName(cleanName(m.name));
      const team = this._pickTeam(m.team);
      if (!this.running) {
        sim.settings = { teamSize: this.cfg.teamSize, difficulty: this.cfg.difficulty, winsNeeded: this.cfg.winsNeeded };
        c.agent = sim.addAgent({ name, team, isBot: false });
        sim.startMatch(this.cfg);
        this.running = true;
        this.restartAt = 0;
        this._startLoop();
      } else {
        c.agent = sim.addHuman(name, team);
      }
      this._send(c, { t: 'welcome', id: c.agent.id, cfg: this.cfg, map: this.cfg.map, room: this.id, time: sim.time });
      this._send(c, { t: 'roster', list: rosterList(sim) });
      this.rosterDirty = true;
      return;
    }
    if (!c.agent) return;
    const sim = this.sim;
    switch (m.t) {
      case 'c':
        c.queue.push(decodeCmd(m));
        if (c.queue.length > MAX_QUEUE) c.queue.splice(0, c.queue.length - MAX_QUEUE);
        break;
      case 'b':
        if (typeof m.id === 'string') sim.shop.buy(c.agent, m.id);
        break;
      case 'team':
        if (m.team === 'T' || m.team === 'CT') c.agent.pendingTeam = m.team;
        break;
      case 'chat':
        sim.humanChat(c.agent, m.text, !!m.team);
        break;
      case 'dbg':
        if (this.debug) this._debug(c, m);
        break;
      default:
        break;
    }
  }

  // Test hooks, only when the server runs with BS_DEBUG=1.
  _debug(c, m) {
    const sim = this.sim;
    const a = m.id != null ? sim.byId.get(m.id) : c.agent;
    if (m.op === 'bots') sim.botsPaused = !!m.paused;
    if (m.op === 'live') { sim.round.phase = 'live'; sim.round.timer = 100; sim.round.liveStart = sim.time - 30; }
    if (!a) return;
    if (m.op === 'tp') { a.body.pos.set(m.x, m.y, m.z); a.prevPos.copy(a.body.pos); a.body.vel.set(0, 0, 0); a.alive = true; if (a.health <= 0) a.health = 100; }
    if (m.op === 'give') a.giveWeapon(m.w, sim.time, true);
    if (m.op === 'hp') { a.health = m.v; a.armor = 0; }
    if (m.op === 'kill') a.takeDamage(1000, null, null, { armorPen: 1, name: 'debug' }, null);
  }

  _leave(id) {
    const c = this.clients.get(id);
    if (!c) return;
    this.clients.delete(id);
    if (!c.agent || !this.sim) return;
    this.sim.removeAgent(c.agent);
    c.agent = null;
    this.rosterDirty = true;
    if (!this.sim.humans().length) this.stop();
  }

  // Last player left (or the server shuts down): stop the loop and drop the match.
  stop() {
    this._stopLoop();
    this.running = false;
    this.sim = null;
    this.events = [];
  }

  // ------------------------------------------------------------ game loop
  _useCmd(c, cmd) {
    c.last = cmd;
    c.ack = cmd.seq;
    c.agent.viewTime = cmd.vt;
  }

  // Commands are simulated as they arrive (a burst is processed in one tick), so the server replays
  // exactly what the client predicted. A client that stops sending is frozen for a few ticks, then
  // gets neutral commands (stops moving and shooting, gravity keeps working).
  _feed(c) {
    const a = c.agent;
    if (c.queue.length) {
      c.starved = 0;
      while (c.queue.length > 1) {
        const extra = c.queue.shift();
        this._useCmd(c, extra);
        if (a.alive) a.tick(extra, DT, this.sim.time);
      }
      const cmd = c.queue.shift();
      this._useCmd(c, cmd);
      a.pendingCmd = cmd;
      return;
    }
    c.starved++;
    if (c.starved <= STARVE_LIMIT) {
      a.pendingCmd = null;
      return;
    }
    const idle = decodeCmd({});
    idle.yaw = c.last ? c.last.yaw : a.yaw;
    idle.pitch = c.last ? c.last.pitch : a.pitch;
    a.pendingCmd = idle;
  }

  _step() {
    const sim = this.sim;
    if (!this.running || !sim) return;
    for (const c of this.clients.values()) if (c.agent) this._feed(c);
    try {
      sim.tick(DT);
      if (this.restartAt && sim.time >= this.restartAt) {
        this.restartAt = 0;
        sim.startMatch(this.cfg);
      }
    } catch (e) {
      console.error(`[${this.id}] tick error`, e);
    }
    if (this.rosterDirty) {
      this.rosterDirty = false;
      this._broadcastJoined({ t: 'roster', list: rosterList(sim) });
    }
    const common = JSON.stringify(snapshotCommon(sim, this.events)).slice(1);
    this.events = [];
    for (const c of this.clients.values()) {
      if (!c.agent) continue;
      const head = `{"t":"s","ack":${c.ack},"q":${c.queue.length},"st":${c.starved > 0 ? 1 : 0},"me":${JSON.stringify(snapshotPrivate(c.agent))},`;
      c.conn.send(head + common);
    }
  }

  // Tick against the wall clock and catch up if the timer fires late.
  _startLoop() {
    if (this.timer) return;
    this.t0 = Date.now();
    this.ticks = 0;
    this.timer = setInterval(() => {
      const now = (Date.now() - this.t0) / 1000;
      let n = 0;
      while ((this.ticks + 1) * DT <= now && n < 5) {
        this._step();
        this.ticks++;
        n++;
      }
      if ((this.ticks + 1) * DT <= now) this.ticks = Math.floor(now / DT);
    }, 5);
  }

  _stopLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
