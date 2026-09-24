// Authoritative game simulation with no DOM or rendering. The browser runs it for single-player,
// the PartyKit room runs it for multiplayer. Presentation code listens to `events`
// (gameplay events plus 'fx' for effects/sounds).
import { ECON, BOT_NAMES, DEG } from './config.js';
import { inZone } from './map/layout.js';
import { loadMap } from './map/index.js';
import { Agent } from './agent.js';
import { BotBrain } from './bot.js';
import { Combat } from './combat.js';
import { Drops } from './drops.js';
import { Grenades } from './grenades.js';
import { RoundManager } from './round.js';
import { Shop } from './shop.js';
import { Pickups } from './pickups.js';
import { moveAxis } from './physics.js';
import { Emitter, shuffle, choose, clamp, wrapAngle } from './util.js';

const TEAMS = ['T', 'CT'];

export class Sim {
  // map: result of loadMap() (layout + world + nav), or a map id to load.
  constructor({ authority = true, map = 'dustline' } = {}) {
    this.authority = authority;
    this.events = new Emitter();
    this.onEmit = null; // server hook: receives every emitted event
    this.replaying = false; // mutes emits during client-side prediction replays
    this.time = 0;
    const m = typeof map === 'string' ? loadMap(map) : map;
    this.mapId = m.id;
    this.layout = m.layout;
    this.world = m.world;
    this.nav = m.nav;
    this.combat = new Combat(this);
    this.drops = new Drops(this);
    this.grenades = new Grenades(this);
    this.round = new RoundManager(this);
    this.shop = new Shop(this);
    this.pickups = new Pickups(this);
    this.agents = [];
    this.byId = new Map();
    this.nextId = 1;
    this.intel = { T: [], CT: [] };
    this.settings = { teamSize: 5, difficulty: 'normal', winsNeeded: 8 };
    this.botNames = [];
    this.chatNext = { all: 0, T: 0, CT: 0 };
    this.pendingChat = [];
    this.calloutAt = new Map();
    this.lowTimeSaid = false;
    this.nextTaunt = 0;
    this.nextSpot = 0;
    this.lagComp = false;
    this.botsPaused = false;
    this.history = [];
    if (authority) this._bindAI();
  }

  emit(name, data) {
    if (this.replaying) return;
    this.events.emit(name, data);
    if (this.onEmit) this.onEmit(name, data);
  }

  fx(type, data) {
    this.emit('fx', { type, ...data });
  }

  shake(x, y, z, radius, amount) {
    this.fx('shake', { x, y, z, radius, amount });
  }

  // ------------------------------------------------------------ roster
  botName() {
    if (!this.botNames.length) this.botNames = shuffle(BOT_NAMES.slice());
    const used = new Set(this.agents.map((a) => a.name));
    while (this.botNames.length) {
      const n = this.botNames.pop();
      if (!used.has(n)) return n;
    }
    return `Bot ${this.nextId}`;
  }

  addAgent({ id, name, team, isBot }) {
    const agent = new Agent(this, { id: id ?? this.nextId++, name, team, isBot });
    if (id !== undefined) this.nextId = Math.max(this.nextId, id + 1);
    agent.isHuman = !isBot;
    agent.resetLoadout();
    agent.alive = false;
    if (isBot && this.authority) {
      const idx = this.agents.filter((a) => a.isBot && a.team === team).length;
      agent.brain = new BotBrain(this, agent, this.settings.difficulty, idx);
    }
    this.agents.push(agent);
    this.byId.set(agent.id, agent);
    this.emit('roster', {});
    return agent;
  }

  removeAgent(agent) {
    if (!this.byId.has(agent.id)) return;
    if (agent.alive && this.authority) {
      this.drops.dropOnDeath(agent);
      agent.alive = false;
    }
    if (this.round.bomb.carrier === agent) this.round.bomb.carrier = null;
    this.agents = this.agents.filter((a) => a !== agent);
    this.byId.delete(agent.id);
    this.emit('roster', {});
  }

  humans() {
    return this.agents.filter((a) => !a.isBot);
  }

  // Keep every team at teamSize by adding/removing bots. Alive bots are only removed when allowed.
  balanceBots(allowRemoveAlive) {
    for (const team of TEAMS) {
      const members = this.agents.filter((a) => a.team === team);
      const humans = members.filter((a) => !a.isBot).length;
      const bots = members.filter((a) => a.isBot).sort((a, b) => Number(a.alive) - Number(b.alive));
      const want = Math.max(0, this.settings.teamSize - humans);
      let extra = bots.length - want;
      for (const b of bots) {
        if (extra <= 0) break;
        if (b.alive && !allowRemoveAlive) continue;
        this.removeAgent(b);
        extra--;
      }
      const have = this.agents.filter((a) => a.team === team && a.isBot).length;
      for (let i = have; i < want; i++) this.addAgent({ name: this.botName(), team, isBot: true });
    }
  }

  // Called by the round manager right before agents are respawned.
  beforeRoundStart() {
    for (const a of this.agents) {
      if (a.pendingTeam && a.pendingTeam !== a.team) {
        a.team = a.pendingTeam;
        a.alive = false; // forces a fresh (team-correct) loadout
        this.emit('roster', {});
      }
      a.pendingTeam = null;
    }
    this.balanceBots(true);
  }

  startMatch({ teamSize = 5, difficulty = 'normal', winsNeeded = 8 } = {}) {
    this.settings = { teamSize, difficulty, winsNeeded };
    for (const a of [...this.agents]) if (a.isBot) this.removeAgent(a);
    this.balanceBots(true);
    for (const a of this.agents) if (a.brain) a.brain.setDifficulty(difficulty);
    this.intel.T.length = 0;
    this.intel.CT.length = 0;
    this.pendingChat.length = 0;
    this.round.startMatch(winsNeeded);
  }

  // Human joining a running match: spawns right away during freeze time, else spectates until next round.
  addHuman(name, team) {
    const agent = this.addAgent({ name, team, isBot: false });
    agent.money = ECON.startMoney;
    if (this.round.phase === 'freeze') {
      this.balanceBots(true);
      this.round.spawnAgent(agent, true);
    }
    return agent;
  }

  respawnSafe(agent) {
    const sp = this.layout.spawns[agent.team][0];
    agent.body.pos.set(sp.x, sp.y + 0.01, sp.z);
    agent.prevPos.copy(agent.body.pos);
    agent.body.vel.set(0, 0, 0);
  }

  zoneName(x, z, y) {
    let best = '';
    let area = Infinity;
    for (const zn of this.layout.zones) {
      if (!inZone(zn, x, y, z)) continue;
      const a = (zn.x1 - zn.x0) * (zn.z1 - zn.z0);
      if (a < area) { area = a; best = zn.name; }
    }
    return best;
  }

  spot(agent, time = this.time) {
    agent.spottedUntil = time + 1.3;
  }

  reportEnemy(team, enemy, time, reporter = null) {
    this.spot(enemy, time);
    const list = this.intel[team];
    list.push({ enemy, x: enemy.pos.x, y: enemy.pos.y, z: enemy.pos.z, time });
    if (list.length > 80) list.splice(0, list.length - 80);
    if (reporter?.isBot && (this.calloutAt.get(enemy) || -99) < time - 9) {
      this.calloutAt.set(enemy, time);
      const z = this.zoneName(enemy.pos.x, enemy.pos.z, enemy.pos.y);
      if (z) this.botSay(reporter, 'spot', { z }, { team: true, chance: 0.75, speak: 0.6 });
    }
  }

  // ------------------------------------------------------------ chat
  botSay(agent, kind, vars = {}, { team = false, chance = 1, speak = 0.4, force = false, dead } = {}) {
    if (!this.authority || !agent?.isBot) return;
    if (Math.random() > chance) return;
    const key = team ? agent.team : 'all';
    if (!force && this.time < this.chatNext[key]) return;
    this.chatNext[key] = this.time + 0.6;
    this.emit('chat', { agent, kind, vars, team, dead: dead ?? !agent.alive, speak });
  }

  botSayLater(delay, agent, kind, vars, opts) {
    if (agent) this.pendingChat.push({ at: this.time + delay, agent, kind, vars, opts });
  }

  humanChat(agent, text, team) {
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!t || !agent) return;
    this.emit('chat', { agent, text: t, team: !!team, dead: !agent.alive, human: true });
    // Somebody always has a smart answer.
    const bots = this.agents.filter((a) => a.isBot && (team ? a.team === agent.team : true));
    if (bots.length) this.botSayLater(1.3, choose(bots), 'reply', { h: agent.name }, { chance: 0.65, speak: 0.8, team: !!team });
  }

  _randomBot(team, alive = true) {
    const list = this.agents.filter((a) => a.isBot && (!team || a.team === team) && (!alive || a.alive));
    return list.length ? choose(list) : null;
  }

  // AI reactions and bot trash talk, driven by the sim's own events.
  _bindAI() {
    const ev = this.events;
    ev.on('shot', ({ agent, def, origin }) => {
      const quiet = def.sound === 'usp' || def.sound === 'smg';
      const hearDist = quiet ? 14 : 55;
      for (const b of this.agents) {
        if (!b.brain || !b.alive || b.team === agent.team) continue;
        if (b.pos.distanceTo(origin) < hearDist) b.brain.hear(origin.x, origin.y, origin.z, this.time);
      }
      if (!quiet) this.spot(agent);
      if (agent.brain) agent.brain.onShot(this.time);
    });
    ev.on('step', ({ agent }) => {
      for (const b of this.agents) {
        if (!b.brain || !b.alive || b.team === agent.team) continue;
        if (b.pos.distanceTo(agent.pos) < 16) b.brain.hear(agent.pos.x, agent.pos.y, agent.pos.z, this.time);
      }
    });
    ev.on('damage', ({ victim, attacker }) => {
      if (victim.brain) victim.brain.onDamaged(attacker, this.time);
      if (victim.isBot && victim.alive && attacker && attacker.team !== victim.team) {
        this.botSay(victim, 'hurt', { a: attacker.name }, { chance: 0.3, speak: 0.65 });
      }
    });
    ev.on('kill', (e) => {
      const { victim, killer } = e;
      if (!killer || killer === victim || killer.team === victim.team || this.round.phase !== 'live') return;
      const vsHuman = !victim.isBot;
      if (killer.isBot) {
        this.botSay(killer, e.headshot ? 'headshot' : 'kill', { v: victim.name }, { chance: vsHuman ? 1 : 0.7, speak: vsHuman ? 1 : 0.6, force: vsHuman });
        if (killer.roundKills >= 3) this.botSayLater(0.9, killer, 'multi', {}, { chance: 0.9, speak: 0.9, force: true });
      }
      if (victim.isBot) this.botSayLater(1.4, victim, 'death', { k: killer.name }, { chance: 0.7, speak: 0.6, dead: true });
      const mates = this.agents.filter((a) => a.alive && a.team === victim.team);
      if (mates.length === 1 && mates[0].isBot) this.botSayLater(2.2, mates[0], 'lastAlive', {}, { chance: 0.85, speak: 0.8 });
    });
    ev.on('reload', ({ agent }) => this.botSay(agent, 'reload', {}, { team: true, chance: 0.2, speak: 0.45 }));
    ev.on('eat', ({ agent }) => this.botSay(agent, 'eat', {}, { chance: 0.8, speak: 0.8 }));
    ev.on('throw', ({ agent, id }) => this.botSay(agent, id, {}, { team: true, chance: 0.85, speak: 0.6 }));
    ev.on('defuseStart', ({ agent }) => this.botSay(agent, 'defuseStart', {}, { team: true, chance: 0.8, speak: 0.7 }));
    ev.on('flashed', ({ agent, amount }) => { if (amount > 0.6) this.botSay(agent, 'flashed', {}, { chance: 0.6, speak: 0.6 }); });
    ev.on('bombDropped', () => {
      if (this.round.phase === 'live') this.botSayLater(0.6, this._randomBot('T'), 'bombDropped', {}, { team: true, chance: 0.7 });
    });
    ev.on('roundStart', () => {
      this.lowTimeSaid = false;
      this.pendingChat.length = 0;
      this.calloutAt.clear();
      this.botSayLater(1.0, this._randomBot('T'), 'buy', {}, { team: true, chance: 0.75, speak: 0.7 });
      this.botSayLater(1.9, this._randomBot('CT'), 'buy', {}, { team: true, chance: 0.75, speak: 0.7 });
    });
    ev.on('roundLive', () => {
      this.nextTaunt = this.time + 6 + Math.random() * 6;
      this.botSayLater(1.5, this._randomBot('T'), 'planT', { s: this.round.tPlan.site }, { team: true, chance: 0.85, speak: 0.6 });
      const ct = this._randomBot('CT');
      const asg = ct && this.round.ctAssign.get(ct);
      if (asg && asg.site !== 'mid') this.botSayLater(1.6, ct, 'planCT', { s: asg.site }, { team: true, chance: 0.6, speak: 0.5 });
    });
    ev.on('bombPlanted', ({ agent }) => {
      this.botSayLater(2.5, agent, 'plant', {}, { team: true, chance: 0.85, speak: 0.7 });
      this.botSayLater(3.6, this._randomBot('CT'), 'bombCT', {}, { team: true, chance: 0.8, speak: 0.7 });
    });
    ev.on('bombDefused', ({ agent }) => this.botSayLater(1.2, agent, 'defused', {}, { chance: 0.8, speak: 0.5, force: true }));
    ev.on('roundEnd', ({ winner }) => {
      this.botSayLater(2.2, this._randomBot(winner, false), 'win', {}, { chance: 0.9, speak: 0.8 });
      this.botSayLater(3.6, this._randomBot(winner === 'T' ? 'CT' : 'T', false), 'lose', {}, { chance: 0.85, speak: 0.8 });
    });
  }

  _chatTick() {
    for (let i = this.pendingChat.length - 1; i >= 0; i--) {
      const c = this.pendingChat[i];
      if (this.time < c.at) continue;
      this.pendingChat.splice(i, 1);
      if (this.byId.has(c.agent.id)) this.botSay(c.agent, c.kind, c.vars, c.opts);
    }
    const R = this.round;
    // Idle trash talk every now and then.
    if (R.phase === 'live' && this.nextTaunt && this.time >= this.nextTaunt) {
      this.nextTaunt = this.time + 9 + Math.random() * 12;
      this.botSay(this._randomBot(null), 'taunt', {}, { chance: 0.9, speak: 0.85 });
    }
    if (!this.lowTimeSaid && R.phase === 'live' && R.bomb.state !== 'planted' && R.timer < 25) {
      this.lowTimeSaid = true;
      this.botSay(this._randomBot('T'), 'lowTime', {}, { team: true, chance: 0.9, speak: 0.6 });
    }
  }

  // ------------------------------------------------------------ simulation
  tick(dt) {
    this.time += dt;
    for (const a of this.agents) {
      if (!a.alive) continue;
      if (a.brain) {
        if (!this.botsPaused) a.tick(a.brain.think(dt, this.time), dt, this.time);
      } else if (a.pendingCmd) a.tick(a.pendingCmd, dt, this.time);
    }
    this._separate();
    this.drops.tick(dt);
    this.grenades.tick(dt);
    this.pickups.tick();
    this.round.tick(dt);
    if (this.time >= this.nextSpot) {
      this.nextSpot = this.time + 0.2;
      this._humanSpotting();
    }
    this._chatTick();
    if (this.lagComp) this._recordHistory();
  }

  _separate() {
    const list = this.agents;
    const minD = 0.64;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD || Math.abs(b.pos.y - a.pos.y) > 1.6) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = d2 > 1e-6 ? dx / d : 1, nz = d2 > 1e-6 ? dz / d : 0;
        const push = (minD - d) * 0.5;
        moveAxis(this.world, a.body, 0, -nx * push);
        moveAxis(this.world, a.body, 2, -nz * push);
        moveAxis(this.world, b.body, 0, nx * push);
        moveAxis(this.world, b.body, 2, nz * push);
      }
    }
  }

  // Humans reveal the enemies they can see on their team's radar.
  _humanSpotting() {
    for (const p of this.agents) {
      if (p.isBot || !p.alive) continue;
      const eye = p.eyePos();
      const ex = eye.x, ey = eye.y, ez = eye.z;
      for (const e of this.agents) {
        if (!e.alive || e.team === p.team) continue;
        const dx = e.pos.x - ex, dz = e.pos.z - ez;
        if (Math.abs(wrapAngle(Math.atan2(-dx, -dz) - p.yaw)) > 60 * DEG) continue;
        const h = e.headPos(this._tmpV || (this._tmpV = eye.clone()));
        if (this.world.lineClear(ex, ey, ez, h.x, h.y, h.z) && !this.grenades.smokeBlocks(ex, ey, ez, h.x, h.y, h.z)) {
          this.reportEnemy(p.team, e, this.time, p);
        }
      }
    }
  }

  // ------------------------------------------------------------ lag compensation
  _recordHistory() {
    const states = new Map();
    for (const a of this.agents) states.set(a, [a.body.pos.x, a.body.pos.y, a.body.pos.z, a.yaw, a.crouched, a.alive]);
    this.history.push({ t: this.time, states });
    while (this.history.length > 48) this.history.shift();
  }

  // Move every other agent to where `shooter` saw them (its interpolated view time). Returns undo data.
  rewindFor(shooter) {
    if (!this.lagComp || !shooter || shooter.isBot || shooter.viewTime == null || !this.history.length) return null;
    const t = clamp(shooter.viewTime, this.time - 0.2, this.time);
    if (this.time - t < 0.004) return null;
    let a = null, b = null;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].t <= t) { a = this.history[i]; b = this.history[i + 1] || a; break; }
    }
    if (!a) return null;
    const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    const saved = [];
    for (const agent of this.agents) {
      if (agent === shooter || !agent.alive) continue;
      const sa = a.states.get(agent);
      if (!sa || !sa[5]) continue;
      const sb = b.states.get(agent) || sa;
      saved.push([agent, agent.body.pos.x, agent.body.pos.y, agent.body.pos.z, agent.yaw, agent.crouched]);
      agent.body.pos.set(sa[0] + (sb[0] - sa[0]) * f, sa[1] + (sb[1] - sa[1]) * f, sa[2] + (sb[2] - sa[2]) * f);
      agent.yaw = sa[3];
      agent.crouched = f < 0.5 ? sa[4] : sb[4];
    }
    return saved;
  }

  restore(saved) {
    if (!saved) return;
    for (const [agent, x, y, z, yaw, crouched] of saved) {
      agent.body.pos.set(x, y, z);
      agent.yaw = yaw;
      agent.crouched = crouched;
    }
  }
}
