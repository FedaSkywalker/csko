// Match/round flow: freeze time, round timer, bomb plant/defuse, economy, win conditions.
import * as THREE from 'three';
import { ROUND, ECON, WEAPONS, MOVE, enemyOf } from './config.js';
import { inRect, inZone } from './map/layout.js';
import { shuffle, choose } from './util.js';

export const BOMB_DEF = { id: 'c4', name: 'C4', armorPen: 1, reward: 0 };

export class RoundManager {
  constructor(game) {
    this.game = game;
    this.phase = 'idle';
    this.round = 0;
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    this.timer = 0;
    this.liveStart = 0;
    this.winsNeeded = 8;
    this.matchWinner = null;
    this.lastWinner = null;
    this.lastReason = '';
    this.tPlan = { route: 'long', site: 'A' };
    this.ctAssign = new Map();
    this.bomb = { state: 'none', carrier: null, item: null, pos: new THREE.Vector3(), timer: 0, site: null, planter: null, defuser: null, beepAcc: 0, wasPlanted: false };
  }

  startMatch(winsNeeded) {
    this.winsNeeded = winsNeeded;
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    this.round = 0;
    this.matchWinner = null;
    for (const a of this.game.agents) {
      a.money = ECON.startMoney;
      a.kills = a.deaths = a.assists = a.headshots = a.mvps = 0;
      a.damageDealt = 0;
      a.alive = false; // forces a fresh loadout on the first round
    }
    this.game.emit('matchStart', {});
    this.startRound();
  }

  // Put an agent at a spawn point with full health. `fresh` resets the loadout.
  spawnAgent(agent, fresh, sp) {
    const g = this.game;
    const L = g.layout;
    if (!sp) {
      const taken = g.agents.filter((a) => a.alive && a !== agent && a.team === agent.team).length;
      const list = L.spawns[agent.team];
      sp = { ...list[taken % list.length] };
      if (taken >= list.length) sp.x += 1.2 * Math.floor(taken / list.length);
    }
    if (fresh) agent.resetLoadout();
    agent.inv[5] = null;
    agent.alive = true;
    agent.health = 100;
    agent.refillAmmo();
    agent.body.pos.set(sp.x, sp.y + 0.002, sp.z);
    agent.prevPos.copy(agent.body.pos);
    agent.body.vel.set(0, 0, 0);
    agent.body.height = MOVE.standHeight;
    agent.body.onGround = true;
    agent.crouched = false;
    agent.viewEye = MOVE.standEye;
    agent.jumpHeld = false;
    agent.jumpBuf = 0;
    agent.yaw = sp.yaw;
    agent.pitch = 0;
    agent.ws = agent._freshWeaponState();
    agent.slot = agent.bestSlot();
    agent.lastSlot = agent.inv[2] ? 2 : 3;
    agent.planting = false;
    agent.defusing = false;
    agent.blindUntil = 0;
    agent.roundKills = 0;
    agent.damagedBy.clear();
    agent.lastAttacker = null;
    agent.spawnSeq = (agent.spawnSeq || 0) + 1;
    g.emit('draw', { agent, def: agent.currentDef });
    g.emit('spawn', { agent });
  }

  startRound() {
    const g = this.game;
    this.round++;
    this.phase = 'freeze';
    this.timer = ROUND.freezeTime;
    g.beforeRoundStart?.();
    g.drops.clear();
    g.grenades.clear();
    g.pickups?.reset();
    const b = this.bomb;
    b.state = 'none';
    b.carrier = null;
    b.item = null;
    b.planter = null;
    b.site = null;
    b.wasPlanted = false;
    b.defuser = null;

    const L = g.layout;
    for (const team of ['T', 'CT']) {
      const spawns = shuffle(L.spawns[team].slice());
      const members = g.agents.filter((a) => a.team === team);
      members.forEach((a, i) => {
        const sp = { ...spawns[i % spawns.length] };
        if (i >= spawns.length) sp.x += 1.2 * Math.floor(i / spawns.length);
        const survived = a.alive && this.round > 1;
        this.spawnAgent(a, !survived, sp);
      });
    }
    // Bomb goes to a random terrorist.
    const ts = g.agents.filter((a) => a.team === 'T');
    if (ts.length) this.giveBomb(choose(ts));

    // Attack plan for T bots and site assignment for CT bots.
    const routes = Object.keys(L.ai.routes);
    const route = choose(routes);
    this.tPlan = { route, site: L.ai.routes[route].site };
    this.ctAssign.clear();
    const cts = shuffle(g.agents.filter((a) => a.team === 'CT' && a.isBot));
    const siteOrder = L.ai.ctSites || ['A', 'B', 'mid', 'A', 'B'];
    const used = { A: 0, B: 0, mid: 0 };
    cts.forEach((a, i) => {
      const site = siteOrder[i % siteOrder.length];
      const holds = L.ai.holds[site];
      this.ctAssign.set(a, { site, hold: holds[used[site]++ % holds.length] });
    });

    for (const a of g.agents) if (a.brain) a.brain.onRoundStart();
    g.emit('roundStart', { round: this.round });
  }

  giveBomb(agent) {
    agent.inv[5] = { def: WEAPONS.c4 };
    this.bomb.state = 'carried';
    this.bomb.carrier = agent;
    this.bomb.item = null;
  }

  onBombDropped(item) {
    this.bomb.state = 'dropped';
    this.bomb.item = item;
    this.bomb.carrier = null;
    this.game.emit('bombDropped', {});
  }

  onBombPicked(agent) {
    this.bomb.state = 'carried';
    this.bomb.carrier = agent;
    this.bomb.item = null;
    this.game.emit('bombPicked', { agent });
  }

  aliveCount(team) {
    let n = 0;
    for (const a of this.game.agents) if (a.alive && a.team === team) n++;
    return n;
  }

  tick(dt) {
    const g = this.game;
    switch (this.phase) {
      case 'freeze':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'live';
          this.timer = ROUND.roundTime;
          this.liveStart = g.time;
          g.emit('roundLive', {});
        }
        break;
      case 'live': {
        const b = this.bomb;
        if (b.state === 'planted') {
          b.timer -= dt;
          const interval = Math.max(0.12, 1.0 * (b.timer / ROUND.bombTimer) + 0.08);
          b.beepAcc += dt;
          if (b.beepAcc >= interval) {
            b.beepAcc = 0;
            g.fx('bombBeep', { x: b.pos.x, y: b.pos.y, z: b.pos.z });
          }
          if (b.timer <= 0) { this.explode(); break; }
        } else {
          this.timer -= dt;
          if (this.timer <= 0) { this.endRound('CT', 'time'); break; }
        }
        const aliveT = this.aliveCount('T');
        const aliveCT = this.aliveCount('CT');
        if (aliveCT === 0 && g.agents.some((a) => a.team === 'CT')) this.endRound('T', 'elim');
        else if (aliveT === 0 && b.state !== 'planted' && g.agents.some((a) => a.team === 'T')) this.endRound('CT', 'elim');
        break;
      }
      case 'over':
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.matchWinner) {
            this.phase = 'matchover';
            g.emit('matchOver', { winner: this.matchWinner });
          } else {
            this.startRound();
          }
        }
        break;
      default:
        break;
    }
  }

  endRound(winner, reason) {
    if (this.phase !== 'live') return;
    const g = this.game;
    this.phase = 'over';
    this.timer = ROUND.endDelay;
    this.score[winner]++;
    this.lastWinner = winner;
    this.lastReason = reason;
    const loser = enemyOf(winner);
    const winAmt = reason === 'bomb' ? ECON.winBomb : reason === 'defuse' ? ECON.winDefuse : reason === 'time' ? ECON.winTime : ECON.winElim;
    const lossAmt = Math.min(ECON.lossMax, ECON.lossBase + ECON.lossStep * this.lossStreak[loser]);
    for (const a of g.agents) {
      if (a.team === winner) {
        a.money += winAmt;
      } else {
        let amt = lossAmt;
        if (loser === 'T' && this.bomb.wasPlanted) amt += ECON.plantTeamBonus;
        if (loser === 'T' && reason === 'time' && a.alive) amt = 0;
        a.money += amt;
      }
      a.money = Math.min(ECON.maxMoney, a.money);
    }
    this.lossStreak[loser] = Math.min(this.lossStreak[loser] + 1, 4);
    this.lossStreak[winner] = Math.max(0, this.lossStreak[winner] - 1);

    // MVP: planter/defuser bonus, otherwise most kills on the winning side.
    let mvp = null;
    if (reason === 'defuse') mvp = this.bomb.defuser;
    else if (reason === 'bomb') mvp = this.bomb.planter;
    if (!mvp || !g.byId?.has(mvp.id)) {
      mvp = null;
      let best = -1;
      for (const a of g.agents) {
        if (a.team !== winner) continue;
        const s = a.roundKills * 10 + (a.alive ? 1 : 0);
        if (s > best) { best = s; mvp = a; }
      }
    }
    if (mvp) mvp.mvps++;
    if (this.score[winner] >= this.winsNeeded) this.matchWinner = winner;
    g.emit('roundEnd', { winner, reason, mvp });
  }

  explode() {
    const g = this.game;
    const b = this.bomb;
    b.state = 'exploded';
    this.endRound('T', 'bomb');
    g.fx('explosion', { x: b.pos.x, y: b.pos.y, z: b.pos.z, big: true });
    const planter = b.planter && g.byId?.has(b.planter.id) ? b.planter : null;
    g.combat.explosion(b.pos.x, b.pos.y + 0.5, b.pos.z, ROUND.bombRadius, ROUND.bombDamage, planter, BOMB_DEF, { los: false, friendly: true, falloff: 1.6 });
    g.shake(b.pos.x, b.pos.y, b.pos.z, 30, 1.4);
  }

  siteAt(x, z, y) {
    const s = this.game.layout.sites;
    if (inZone(s.A, x, y, z)) return 'A';
    if (inZone(s.B, x, y, z)) return 'B';
    return null;
  }

  inBuyZone(agent) {
    return inRect(this.game.layout.buyZones[agent.team], agent.pos.x, agent.pos.z);
  }

  canBuy(agent) {
    if (!agent.alive) return false;
    if (this.phase === 'freeze') return this.inBuyZone(agent);
    if (this.phase === 'live' && this.game.time - this.liveStart < ROUND.buyTime) return this.inBuyZone(agent);
    return false;
  }

  buyTimeLeft() {
    if (this.phase === 'freeze') return this.timer + ROUND.buyTime;
    if (this.phase === 'live') return Math.max(0, ROUND.buyTime - (this.game.time - this.liveStart));
    return 0;
  }

  canPlant(agent) {
    return this.phase === 'live' && agent.alive && agent.team === 'T' && agent.hasBomb
      && this.bomb.state === 'carried' && agent.body.onGround && !!this.siteAt(agent.pos.x, agent.pos.z, agent.pos.y);
  }

  plantBomb(agent) {
    const g = this.game;
    const b = this.bomb;
    b.state = 'planted';
    b.wasPlanted = true;
    b.pos.set(agent.pos.x, agent.pos.y + 0.03, agent.pos.z);
    b.yaw = agent.yaw;
    b.site = this.siteAt(agent.pos.x, agent.pos.z, agent.pos.y);
    b.timer = ROUND.bombTimer;
    b.planter = agent;
    b.carrier = null;
    b.beepAcc = 0;
    agent.inv[5] = null;
    agent.money = Math.min(ECON.maxMoney, agent.money + ECON.plantBonus);
    agent.switchTo(agent.bestSlot(), g.time, true);
    g.emit('bombPlanted', { agent, site: b.site });
  }

  canDefuse(agent) {
    const b = this.bomb;
    if (this.phase !== 'live' || b.state !== 'planted' || !agent.alive || agent.team !== 'CT') return false;
    const dx = agent.pos.x - b.pos.x, dz = agent.pos.z - b.pos.z;
    return dx * dx + dz * dz < 1.7 * 1.7 && Math.abs(agent.pos.y - b.pos.y) < 1.6;
  }

  defuseBomb(agent) {
    const b = this.bomb;
    b.state = 'defused';
    b.defuser = agent;
    agent.money = Math.min(ECON.maxMoney, agent.money + ECON.defuseBonus);
    this.game.emit('bombDefused', { agent });
    this.endRound('CT', 'defuse');
  }

  timeLeft() {
    if (this.phase === 'freeze' || this.phase === 'over') return this.timer;
    if (this.phase === 'live') return this.bomb.state === 'planted' ? this.bomb.timer : this.timer;
    return 0;
  }
}
