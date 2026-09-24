// Bot AI: perception (FOV + line of sight + smoke), reaction time, imperfect aim, burst control,
// objective behaviour (routes, holds, plant, retake/defuse), buying and a little utility usage.
import * as THREE from 'three';
import { DIFFICULTY, WEAPONS, DEG, ROUND } from './config.js';
import { wrapAngle, rand, randInt, choose, anglesFromDir } from './util.js';
import { makeCmd } from './agent.js';
import { NADE_SPEED, NADE_GRAVITY } from './grenades.js';
import { inZone } from './map/layout.js';

const _eye = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _ap = new THREE.Vector3();

// Is height y on (or next to) the floor band of a site? Sites without a band match everywhere.
const inBand = (site, y) => (site.y0 === undefined || y >= site.y0 - 0.5) && (site.y1 === undefined || y < site.y1 + 0.5);

export class BotBrain {
  constructor(game, agent, difficulty, index) {
    this.game = game;
    this.agent = agent;
    this.index = index;
    this.cmd = makeCmd();
    this.setDifficulty(difficulty);
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.desYaw = 0;
    this.desPitch = 0;
    this.path = null;
    this.pathIdx = 0;
    this.goalKey = '';
    this.repathAt = 0;
    this.skipCheck = 0;
    this.task = null;
    this.target = null;
    this.targetVisible = false;
    this.lastSeen = -10;
    this.lastSeenPos = new THREE.Vector3();
    this.reactionEnd = 0;
    this.aimErrYaw = 0;
    this.aimErrPitch = 0;
    this.aimHead = false;
    this.nextPerceive = Math.random() * 0.1;
    this.nextStrategy = 0;
    this.burstLeft = 0;
    this.burstPauseUntil = 0;
    this.nextTap = 0;
    this.scopeAt = 0;
    this.strafeDir = 1;
    this.strafeUntil = 0;
    this.crouchUntil = 0;
    this.stuckCheckAt = 0;
    this.stuckPos = new THREE.Vector3();
    this.stuckCount = 0;
    this.detour = null;
    this.jumpNext = false;
    this.wantsMove = false;
    this.heard = null;
    this.nade = null;
    this.usedNade = false;
    this.idleYaw = 0;
  }

  setDifficulty(name) {
    this.diffName = name;
    this.diff = DIFFICULTY[name] || DIFFICULTY.normal;
    this.recoilComp = this.diff.recoilComp;
  }

  onRoundStart() {
    const a = this.agent;
    this.aimYaw = this.desYaw = this.idleYaw = a.yaw;
    this.aimPitch = this.desPitch = 0;
    this.target = null;
    this.targetVisible = false;
    this.lastSeen = -10;
    this.path = null;
    this.goalKey = '';
    this.heard = null;
    this.nade = null;
    this.usedNade = false;
    this.detour = null;
    this.burstLeft = 0;
    this.burstPauseUntil = 0;
    this.strafeUntil = 0;
    this.crouchUntil = 0;
    this.stuckCount = 0;
    this.buy();
    this.plan();
  }

  // ------------------------------------------------------------ economy
  buy() {
    const a = this.agent;
    const g = this.game;
    const shop = (id) => g.shop.buy(a, id, true);
    const round = g.round.round;
    const rifle = a.team === 'T' ? 'ak47' : 'm4a1';
    const mates = g.agents.filter((x) => x.team === a.team);
    const teamAvg = mates.reduce((s, x) => s + x.money, 0) / Math.max(1, mates.length);
    if (round === 1) {
      const r = Math.random();
      if (r < 0.45) shop('kevlar');
      else if (r < 0.7) shop('deagle');
      else { shop('flash'); shop('he'); }
      if (a.team === 'CT' && Math.random() < 0.3) shop('defuser');
    } else {
      // Eco rounds save money for a full buy next round instead of burning it on armor and nades.
      let saving = false;
      if (!a.primary) {
        const riflePrice = WEAPONS[rifle].price;
        const eco = teamAvg < 2400 && a.money < riflePrice + 650;
        if (a.money >= riflePrice + 1000 || (a.money >= riflePrice + 400 && !eco)) {
          const hasAwp = mates.some((x) => x.primary?.def.id === 'awp');
          if (a.money >= 5750 && !hasAwp && Math.random() < 0.22) shop('awp');
          else shop(rifle);
        } else if (!eco && a.money >= 2200) {
          shop('mp5');
        } else if (eco) {
          saving = true;
        } else if (a.money >= 1400 && Math.random() < 0.45) {
          shop('deagle');
        }
      }
      if (saving) {
        if (a.money >= 2600 && Math.random() < 0.35) shop('kevlar');
      } else {
        if (a.money >= 1000 && (!a.helmet || a.armor < 100)) shop('helmet');
        else if (a.money >= 650 && a.armor < 100) shop('kevlar');
        if (a.money >= 300 && Math.random() < 0.55) shop('smoke');
        if (a.money >= 200 && Math.random() < 0.65) shop('flash');
        if (a.money >= 300 && Math.random() < 0.45) shop('he');
        if (a.team === 'CT' && !a.defuser && a.money >= 400 && Math.random() < 0.6) shop('defuser');
      }
    }
    a.switchTo(a.bestSlot(), g.time, true);
  }

  plan() {
    const a = this.agent;
    const g = this.game;
    const R = g.round;
    const AI = g.layout.ai;
    if (a.team === 'T') {
      let routeName = R.tPlan.route;
      if (this.index % 3 === 2 && Math.random() < 0.45) {
        const alts = Object.keys(AI.routes).filter((r) => AI.routes[r].site === R.tPlan.site && r !== routeName);
        if (alts.length) routeName = choose(alts);
      }
      const route = AI.routes[routeName];
      const wait = R.phase === 'freeze' ? Math.max(0, R.timer) : 0;
      this.task = { type: 'route', points: route.points, idx: 0, site: R.tPlan.site, startAt: g.time + wait + rand(0, 2.5) };
    } else {
      const asg = R.ctAssign.get(a) || { site: 'A', hold: AI.holds.A[0] };
      this.task = { type: 'hold', site: asg.site, hold: asg.hold };
    }
  }

  // ------------------------------------------------------------ main loop
  think(dt, time) {
    const a = this.agent;
    const c = this.cmd;
    c.forward = 0; c.side = 0; c.jump = false; c.crouch = false; c.walk = false;
    c.fire = false; c.fire2 = false; c.reload = false; c.use = false; c.drop = false;
    c.slot = 0; c.nextWeapon = 0; c.lastWeapon = false;
    if (!a.alive) return c;
    this.wantsMove = false;
    if (time >= this.nextPerceive) {
      this.nextPerceive = time + 0.09 + Math.random() * 0.04;
      this.perceive(time);
    }
    if (time >= this.nextStrategy) {
      this.nextStrategy = time + 0.5;
      this.strategy(time);
    }
    const engaged = this.target && this.target.alive && (this.targetVisible || time - this.lastSeen < 2.5);
    if (this.nade) this.doNade(dt, time);
    else if (engaged) this.combat(dt, time);
    else this.navigate(dt, time);

    if (!engaged && !this.nade && this.agent.current?.def.mag) {
      const w = this.agent.current;
      if (w.mag < w.def.mag * 0.4 && w.reserve > 0 && time - this.lastSeen > 2) c.reload = true;
    }
    if (this.jumpNext) { c.jump = true; this.jumpNext = false; }
    if (time < this.crouchUntil) c.crouch = true;
    this.checkStuck(time);
    this.turn(dt);
    c.yaw = this.aimYaw;
    c.pitch = this.aimPitch;
    return c;
  }

  turn(dt) {
    const max = this.diff.turnSpeed * DEG * dt;
    const k = Math.min(1, 15 * dt);
    const dy = wrapAngle(this.desYaw - this.aimYaw);
    const sy = Math.max(-max, Math.min(max, dy * k + Math.sign(dy) * Math.min(Math.abs(dy), 0.15 * DEG)));
    this.aimYaw = wrapAngle(this.aimYaw + sy);
    const dp = this.desPitch - this.aimPitch;
    const sp = Math.max(-max, Math.min(max, dp * k + Math.sign(dp) * Math.min(Math.abs(dp), 0.15 * DEG)));
    this.aimPitch = Math.max(-1.4, Math.min(1.4, this.aimPitch + sp));
  }

  // ------------------------------------------------------------ perception
  perceive(time) {
    const a = this.agent;
    const g = this.game;
    if (time < a.blindUntil && a.blindAmount > 0.3) {
      this.targetVisible = false;
      return;
    }
    const eye = a.eyePos(_eye);
    let best = null;
    let bestScore = Infinity;
    for (const e of g.agents) {
      if (!e.alive || e.team === a.team) continue;
      const dx = e.pos.x - eye.x, dz = e.pos.z - eye.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 100) continue;
      const ang = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - this.aimYaw));
      const tracking = e === this.target && time - this.lastSeen < 1.5;
      if (!tracking && ang > 78 * DEG && dist > 3.5) continue;
      const head = e.headPos(_t1);
      let vis = g.world.lineClear(eye.x, eye.y, eye.z, head.x, head.y, head.z)
        && !g.grenades.smokeBlocks(eye.x, eye.y, eye.z, head.x, head.y, head.z);
      let part = 'head';
      if (!vis) {
        const chest = e.chestPos(_t2);
        vis = g.world.lineClear(eye.x, eye.y, eye.z, chest.x, chest.y, chest.z)
          && !g.grenades.smokeBlocks(eye.x, eye.y, eye.z, chest.x, chest.y, chest.z);
        part = 'chest';
      }
      if (!vis) continue;
      g.reportEnemy(a.team, e, time, a);
      const score = dist + (e === this.target ? -12 : 0) + ang * 6;
      if (score < bestScore) {
        bestScore = score;
        best = e;
        this.visPart = part;
      }
    }
    if (best) {
      if (best !== this.target || time - this.lastSeen > 1.5) this.acquire(best, time);
      this.lastSeen = time;
      this.lastSeenPos.copy(best.pos);
      this.targetVisible = true;
      if (this.visPart === 'chest' && this.aimHead && Math.random() < 0.5) this.aimHead = false;
    } else {
      this.targetVisible = false;
      if (this.target && (!this.target.alive || time - this.lastSeen > 4)) this.target = null;
    }
  }

  acquire(e, time) {
    const d = this.diff;
    const alerted = this.target === e;
    this.target = e;
    const dist = e.pos.distanceTo(this.agent.pos);
    this.reactionEnd = time + d.reaction * rand(0.8, 1.3) * (alerted ? 0.6 : 1) * (1 + dist / 90);
    const mag = d.aimError * rand(0.6, 1.25) * DEG * (1 + Math.min(1.5, e.speed2D() / 5)) * (1 + dist / 45);
    const th = Math.random() * Math.PI * 2;
    this.aimErrYaw = Math.cos(th) * mag;
    this.aimErrPitch = Math.sin(th) * mag * 0.6;
    this.aimHead = Math.random() < d.headChance * Math.max(0.15, 1 - dist / 70);
    this.burstLeft = 0;
    this.nade = null;
  }

  hear(x, y, z, time) {
    if (this.targetVisible) return;
    this.heard = { x, y, z, time };
  }

  onDamaged(attacker, time) {
    if (!attacker || attacker.team === this.agent.team) return;
    this.heard = { x: attacker.pos.x, y: attacker.pos.y, z: attacker.pos.z, time };
    if (!this.targetVisible) {
      this.target = attacker;
      this.lastSeen = time - 0.4;
      this.lastSeenPos.copy(attacker.pos);
    }
  }

  onShot(time) {
    const def = this.agent.currentDef;
    if (def.auto) {
      this.burstLeft--;
      if (this.burstLeft <= 0) {
        this.burstPauseUntil = time + rand(0.22, 0.45);
        if (Math.random() < this.diff.strafe) {
          this.strafeDir = Math.random() < 0.5 ? -1 : 1;
          this.strafeUntil = time + rand(0.2, 0.4);
        }
      }
    } else if (Math.random() < this.diff.strafe * 0.6) {
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      this.strafeUntil = time + rand(0.15, 0.3);
    }
  }

  // ------------------------------------------------------------ strategy
  strategy(time) {
    const a = this.agent;
    const g = this.game;
    const R = g.round;
    const b = R.bomb;
    const AI = g.layout.ai;
    if (R.phase !== 'live') return;
    const t = this.task;
    if (b.state === 'planted') {
      const inBlast = a.pos.distanceTo(b.pos) < ROUND.bombRadius + 2;
      const need = a.defuser ? ROUND.defuseKitTime : ROUND.defuseTime;
      const flee = inBlast && (a.team === 'T' ? b.timer < 7 : b.timer < need + 0.4 && !a.defusing);
      if (flee) {
        if (t?.type !== 'flee') this.task = { type: 'flee' };
      } else if (a.team === 'CT' && t?.type !== 'retake') {
        this.task = { type: 'retake' };
      } else if (a.team === 'T' && t?.type !== 'postplant' && t?.type !== 'flee') {
        const spots = AI.guards[b.site] || [];
        this.task = { type: 'postplant', spot: spots.length ? spots[this.index % spots.length] : null };
      }
      return;
    }
    // Hurt and nothing to shoot at: grab a fried cheese at the Turkish Kebab.
    if (t?.type === 'eat') {
      if (!t.item.available || a.health >= 100 || this.target) {
        this.task = t.prev || null;
        if (!this.task) this.plan();
      }
      return;
    }
    if (a.health < 50 && !this.target && !['plant', 'getBomb', 'flee'].includes(t?.type)) {
      const it = g.pickups?.nearestAvailable(a.pos.x, a.pos.z, a.pos.y);
      if (it && Math.hypot(it.x - a.pos.x, it.z - a.pos.z, (it.y - 1 - a.pos.y) * 4) < 45) {
        this.task = { type: 'eat', item: it, prev: t };
        return;
      }
    }
    if (a.team === 'T') {
      if (b.state === 'dropped' && b.item && t?.type !== 'getBomb') {
        let nearest = null, nd = Infinity;
        for (const m of g.agents) {
          if (!m.alive || m.team !== 'T' || !m.isBot) continue;
          const d = m.pos.distanceTo(b.item.pos);
          if (d < nd) { nd = d; nearest = m; }
        }
        if (nearest === a) this.task = { type: 'getBomb', prev: t };
      }
      if (t?.type === 'getBomb' && a.hasBomb) {
        this.task = { type: 'route', points: [], idx: 0, site: R.tPlan.site, startAt: 0 };
      }
      if (t?.type === 'getBomb' && b.state !== 'dropped' && !a.hasBomb) this.task = t.prev || null;
      if (t?.type === 'route' && R.timer < 45) t.startAt = 0;
      if (!this.task) this.plan();
    } else if (t?.type === 'hold' && !this.target) {
      const recent = g.intel.CT.filter((r) => time - r.time < 5);
      if (recent.length) {
        // A site counts as hit when enemies show up in its approach zones (maps can list them),
        // otherwise within 28 m of the site on its floor.
        const near = (name, r) => {
          const zones = AI.approach?.[name];
          if (zones) return zones.some((z) => inZone(z, r.x, r.y, r.z));
          const st = g.layout.sites[name];
          return Math.hypot(r.x - st.cx, r.z - st.cz) < 28 && inBand(st, r.y);
        };
        const seen = new Set();
        let nearA = 0, nearB = 0;
        for (const r of recent) {
          if (seen.has(r.enemy)) continue;
          seen.add(r.enemy);
          if (near('A', r)) nearA++;
          if (near('B', r)) nearB++;
        }
        const hot = nearA >= 2 ? 'A' : nearB >= 2 ? 'B' : null;
        if (hot && hot !== t.site && !t.rotated && Math.random() < 0.7) {
          this.task = { type: 'hold', site: hot, hold: choose(AI.holds[hot]), rotated: true };
        }
      }
    }
  }

  // ------------------------------------------------------------ navigation
  navigate(dt, time) {
    const a = this.agent;
    const g = this.game;
    const R = g.round;
    const c = this.cmd;
    const t = this.task;
    if (this.detour) {
      if (this.moveTo(this.detour.x, this.detour.z, time, 0.8, this.detour.y) || time > this.detour.until) this.detour = null;
      return;
    }
    if (!t) { this.lookIdle(time); return; }
    switch (t.type) {
      case 'route': {
        if (time < t.startAt) { this.lookIdle(time); break; }
        if (t.idx < t.points.length) {
          const p = t.points[t.idx];
          if (this.moveTo(p[0], p[1], time, 2.2, p[2])) {
            t.idx++;
            if (t.idx === t.points.length) this.maybeEntryNade(t.site, time);
          }
        } else {
          const site = g.layout.sites[t.site];
          if (a.hasBomb) {
            const sp = g.nav.randomPointIn({ x0: site.x0 + 3, z0: site.z0 + 3, x1: site.x1 - 3, z1: site.z1 - 3, y0: site.y0, y1: site.y1 })
              || { x: site.cx, y: site.cy, z: site.cz };
            this.task = { type: 'plant', site: t.site, spot: sp };
          } else {
            const spots = g.layout.ai.guards[t.site];
            this.task = { type: 'guard', site: t.site, spot: spots[this.index % spots.length] };
          }
        }
        break;
      }
      case 'plant': {
        if (!a.hasBomb) {
          const spots = g.layout.ai.guards[t.site];
          this.task = { type: 'guard', site: t.site, spot: spots[this.index % spots.length] };
          break;
        }
        if (this.moveTo(t.spot.x, t.spot.z, time, 0.8, t.spot.y)) {
          if (R.canPlant(a)) {
            if (a.slot !== 5) c.slot = 5;
            else c.fire = true;
            this.desPitch = -0.7;
          } else {
            const site = g.layout.sites[t.site];
            t.spot = g.nav.randomPointIn({ x0: site.cx - 3, z0: site.cz - 3, x1: site.cx + 3, z1: site.cz + 3, y0: site.y0, y1: site.y1 })
              || { x: site.cx + rand(-2, 2), y: site.cy, z: site.cz + rand(-2, 2) };
          }
        }
        break;
      }
      case 'guard':
      case 'postplant': {
        const spot = t.spot;
        if (spot) {
          if (this.moveTo(spot.pos[0], spot.pos[1], time, 1.0, spot.pos[2])) this.holdLook(spot.look, time);
        } else if (R.bomb.state === 'planted') {
          if (this.moveTo(R.bomb.pos.x + 3, R.bomb.pos.z + 3, time, 1.5, R.bomb.pos.y)) this.lookIdle(time);
        }
        break;
      }
      case 'hold': {
        const h = t.hold;
        if (this.moveTo(h.pos[0], h.pos[1], time, 0.9, h.pos[2])) this.holdLook(h.look, time);
        break;
      }
      case 'retake': {
        const b = R.bomb;
        if (b.state !== 'planted') break;
        if (this.moveTo(b.pos.x, b.pos.z, time, 0.9, b.pos.y)) {
          c.use = true;
          this.desPitch = -0.9;
        }
        break;
      }
      case 'eat': {
        this.moveTo(t.item.x, t.item.z, time, 0.3, t.item.y - 1);
        break;
      }
      case 'flee': {
        const sp = g.layout.spawns[a.team][this.index % 5];
        if (this.moveTo(sp.x, sp.z, time, 2, sp.y)) this.lookIdle(time);
        break;
      }
      case 'getBomb': {
        const it = R.bomb.item;
        if (!it) { this.task = t.prev || null; break; }
        this.moveTo(it.pos.x, it.pos.z, time, 0.2, it.pos.y);
        break;
      }
      case 'hunt': {
        if (this.moveTo(t.x, t.z, time, 1.5, t.y)) {
          t.arrived = t.arrived || time;
          this.lookIdle(time);
          if (time - t.arrived > 3) this.task = t.prev || null;
        }
        break;
      }
      default:
        break;
    }
    if (this.heard && time - this.heard.time < 2.5 && !this.targetVisible) {
      const e = this.agent.eyePos(_eye);
      const ang = anglesFromDir(this.heard.x - e.x, this.heard.y + 1.2 - e.y, this.heard.z - e.z);
      this.desYaw = ang.yaw;
      this.desPitch = ang.pitch * 0.5;
    }
  }

  holdLook(look, time) {
    const a = this.agent;
    const dx = look[0] - a.pos.x, dz = look[1] - a.pos.z;
    const yaw = Math.atan2(-dx, -dz);
    this.desYaw = yaw + Math.sin(time * 0.6 + this.index * 1.7) * 0.22;
    // Looking at another floor (e.g. down from a catwalk): aim at chest height there.
    this.desPitch = look[2] === undefined ? -0.02 : Math.atan2(look[2] + 1.3 - (a.pos.y + a.viewEye), Math.hypot(dx, dz));
    this.idleYaw = yaw;
  }

  lookIdle(time) {
    this.desYaw = this.idleYaw + Math.sin(time * 0.45 + this.index) * 0.7;
    this.desPitch = 0;
  }

  // Walk toward (x, z) on the floor at height y (optional). Returns true on arrival.
  moveTo(x, z, time, arrive = 1, y) {
    const a = this.agent;
    const g = this.game;
    const dx = x - a.pos.x, dz = z - a.pos.z;
    const sameFloor = y === undefined || Math.abs(a.pos.y - y) < 1.3;
    if (dx * dx + dz * dz < arrive * arrive && sameFloor) {
      this.path = null;
      return true;
    }
    const key = `${Math.round(x * 2)}|${Math.round(z * 2)}|${y === undefined ? '' : Math.round(y)}`;
    if (!this.path || this.goalKey !== key || time > this.repathAt) {
      this.path = g.nav.findPath(a.pos.x, a.pos.y, a.pos.z, x, y ?? a.pos.y, z);
      this.pathIdx = 0;
      this.goalKey = key;
      this.repathAt = time + 5 + Math.random() * 2;
      if (!this.path) {
        this.steer(x, z);
        return false;
      }
    }
    const path = this.path;
    while (this.pathIdx < path.length - 1) {
      const p = path[this.pathIdx];
      if (Math.hypot(p.x - a.pos.x, p.z - a.pos.z) < 0.7 && Math.abs(p.y - a.pos.y) < 1.3) this.pathIdx++;
      else break;
    }
    if (++this.skipCheck % 4 === 0 && this.pathIdx < path.length - 1 && a.body.onGround) {
      const n = path[this.pathIdx + 1];
      if (g.nav.lineWalkable(a.pos.x, a.pos.y, a.pos.z, n.x, n.z, n.y)) this.pathIdx++;
    }
    const p = path[this.pathIdx];
    if (this.pathIdx === path.length - 1 && Math.hypot(p.x - a.pos.x, p.z - a.pos.z) < 0.6) this.steer(x, z);
    else this.steer(p.x, p.z);
    return false;
  }

  steer(x, z) {
    const a = this.agent;
    const c = this.cmd;
    const dx = x - a.pos.x, dz = z - a.pos.z;
    const moveYaw = Math.atan2(-dx, -dz);
    const rel = wrapAngle(moveYaw - this.aimYaw);
    c.forward = Math.cos(rel);
    c.side = -Math.sin(rel);
    this.wantsMove = true;
    if (!this.targetVisible) {
      this.desYaw = moveYaw;
      this.desPitch = 0;
      this.idleYaw = moveYaw;
    }
  }

  checkStuck(time) {
    if (time < this.stuckCheckAt) return;
    this.stuckCheckAt = time + 0.75;
    const a = this.agent;
    const moved = Math.hypot(a.pos.x - this.stuckPos.x, a.pos.z - this.stuckPos.z);
    this.stuckPos.copy(a.pos);
    if (this.wantsMove && moved < 0.3 && this.game.round.phase === 'live') {
      this.stuckCount++;
      if (this.stuckCount === 1) this.jumpNext = true;
      else if (this.stuckCount === 2) this.path = null;
      else if (this.stuckCount >= 3) {
        this.path = null;
        this.stuckCount = 0;
        const p = this.game.nav.randomPointIn({ x0: a.pos.x - 4, z0: a.pos.z - 4, x1: a.pos.x + 4, z1: a.pos.z + 4, y0: a.pos.y - 1, y1: a.pos.y + 1 });
        if (p) this.detour = { x: p.x, y: p.y, z: p.z, until: time + 2.5 };
      }
    } else {
      this.stuckCount = 0;
    }
  }

  // ------------------------------------------------------------ combat
  combat(dt, time) {
    const a = this.agent;
    const t = this.target;
    const d = this.diff;
    const c = this.cmd;
    const eye = a.eyePos(_eye);
    const def = a.currentDef;
    const visible = this.targetVisible;

    if (def.kind === 'melee' || def.kind === 'grenade' || def.kind === 'bomb') {
      const best = a.bestSlot();
      if (best !== a.slot) c.slot = best;
    }
    const w = a.current;
    const distT = t.pos.distanceTo(a.pos);
    if (w?.def.mag && w.mag === 0 && !a.reloading) {
      if (a.slot === 1 && a.inv[2] && a.inv[2].mag > 0 && visible && distT < 15) c.slot = 2;
      else if (w.reserve > 0) c.reload = true;
      else if (a.inv[2] && a.slot !== 2 && a.inv[2].mag + a.inv[2].reserve > 0) c.slot = 2;
      else c.slot = 3;
    }

    if (!visible) {
      const e = this.lastSeenPos;
      const ang = anglesFromDir(e.x - eye.x, e.y + 1.3 - eye.y, e.z - eye.z);
      this.desYaw = ang.yaw;
      this.desPitch = ang.pitch;
      const since = time - this.lastSeen;
      const holding = ['hold', 'postplant', 'guard', 'plant'].includes(this.task?.type);
      if (!this.usedNade && since > 0.8 && since < 4 && distT > 7 && distT < 22 && Math.abs(e.y - a.pos.y) < 1.5) {
        const id = a.grenades.includes('he') ? 'he' : a.grenades.includes('flash') ? 'flash' : null;
        if (id && Math.random() < 0.35) {
          this.nade = { id, x: e.x, z: e.z, stage: 0 };
          this.usedNade = true;
          return;
        }
      }
      if (since > 0.8 && !holding) this.moveTo(e.x, e.z, time, 1.5, e.y);
      return;
    }

    if (a.bestSlot() === 3) {
      // Knife rush
      this.moveTo(t.pos.x, t.pos.z, time, 1.0, t.pos.y);
      const ang = anglesFromDir(t.pos.x - eye.x, t.pos.y + 1.2 - eye.y, t.pos.z - eye.z);
      this.desYaw = ang.yaw;
      this.desPitch = ang.pitch;
      if (distT < 2.0) c.fire = true;
      return;
    }

    const aimP = this.aimHead ? t.headPos(_ap) : t.chestPos(_ap);
    const dx = aimP.x - eye.x, dy = aimP.y - eye.y, dz = aimP.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    const ang = anglesFromDir(dx, dy, dz);
    const decay = Math.pow(0.5, dt / d.errorHalfLife);
    this.aimErrYaw *= decay;
    this.aimErrPitch *= decay;
    const tsp = t.speed2D();
    if (tsp > 2) {
      this.aimErrYaw += (Math.random() - 0.5) * tsp * 0.004 * dt * 60 * DEG;
      this.aimErrPitch += (Math.random() - 0.5) * tsp * 0.002 * dt * 60 * DEG;
    }
    // Persistent hand wobble: constant angular error, so it matters more at long range.
    const wob = d.wobble * DEG;
    const ph = time * 1.7 + this.index * 3.1;
    this.desYaw = ang.yaw + this.aimErrYaw + Math.sin(ph) * wob + Math.sin(ph * 2.3 + 1.3) * wob * 0.5;
    this.desPitch = ang.pitch + this.aimErrPitch + Math.sin(ph * 1.3 + 0.7) * wob * 0.6;

    if (time < this.reactionEnd) return;

    const maxRange = def.kind === 'pistol' ? (def.id === 'deagle' ? 55 : 38) : def.kind === 'smg' ? 45 : 250;
    if (dist > maxRange) {
      this.moveTo(t.pos.x, t.pos.z, time, maxRange * 0.7, t.pos.y);
      return;
    }

    if (def.kind === 'sniper' && a.ws.scoped === 0 && !a.ws.fire2Held && !a.reloading && time > this.scopeAt) {
      c.fire2 = true;
      this.scopeAt = time + 0.4;
      return;
    }
    if (time < this.strafeUntil) c.side = this.strafeDir;

    const yawErr = Math.abs(wrapAngle(this.desYaw - this.aimYaw));
    const pitchErr = Math.abs(this.desPitch - this.aimPitch);
    const tol = (def.kind === 'sniper' ? 0.8 : 1.8) * DEG;
    if (yawErr > tol || pitchErr > tol) return;
    const moving = a.speed2D() > def.speed * 0.36;
    const spray = dist < d.sprayDist;
    if (moving && def.kind !== 'smg' && def.kind !== 'pistol' && !spray) return;
    this.fireControl(time, dist, def);
  }

  fireControl(time, dist, def) {
    const c = this.cmd;
    const a = this.agent;
    if (def.auto) {
      if (time < this.burstPauseUntil || time < this.strafeUntil) return;
      if (this.burstLeft <= 0) {
        const m = this.diff.burstMul;
        this.burstLeft = dist < this.diff.sprayDist ? 30 : dist < 20 ? Math.round(randInt(3, 6) * m) : Math.max(1, Math.round(randInt(1, 3) * m));
        if (dist > 12 && dist < 35 && Math.random() < 0.35) this.crouchUntil = time + 1.0;
      }
      c.fire = true;
    } else {
      if (a.ws.triggerHeld) return;
      if (time < this.nextTap) return;
      c.fire = true;
      this.nextTap = time + (def.kind === 'sniper' ? 0.15 : def.id === 'deagle' ? rand(0.4, 0.65) : rand(0.2, 0.34) / this.diff.burstMul);
    }
  }

  // ------------------------------------------------------------ utility
  maybeEntryNade(siteName, time) {
    const a = this.agent;
    const g = this.game;
    const site = g.layout.sites[siteName];
    if (a.grenades.includes('smoke') && Math.random() < 0.55) {
      const guard = g.layout.ai.guards[siteName][0];
      this.nade = { id: 'smoke', x: (guard.look[0] + site.cx) / 2, z: (guard.look[1] + site.cz) / 2, stage: 0 };
    } else if (a.grenades.includes('flash') && Math.random() < 0.6) {
      this.nade = { id: 'flash', x: site.cx, z: site.cz, stage: 0 };
    }
    void time;
  }

  doNade(dt, time) {
    const n = this.nade;
    const a = this.agent;
    const c = this.cmd;
    if (n.stage < 2 && !a.grenades.includes(n.id)) { this.nade = null; return; }
    if (n.stage === 0) {
      const idx = a.grenades.indexOf(n.id);
      if (a.slot !== 4) { a.grenadeIdx = idx; c.slot = 4; }
      else if (a.grenades[a.grenadeIdx] !== n.id) { a.grenadeIdx = idx; a.switchTo(4, time, true); }
      n.stage = 1;
      n.until = time + 2;
    }
    const eye = a.eyePos(_eye);
    const dx = n.x - eye.x, dz = n.z - eye.z;
    const D = Math.hypot(dx, dz);
    const s = Math.min(1, (D * NADE_GRAVITY) / (NADE_SPEED * NADE_SPEED));
    this.desYaw = Math.atan2(-dx, -dz);
    this.desPitch = 0.5 * Math.asin(s) - 0.02;
    if (n.stage === 1) {
      const ready = a.slot === 4 && a.currentDef.id === n.id && time >= a.ws.drawEnd
        && Math.abs(wrapAngle(this.desYaw - this.aimYaw)) < 3 * DEG && Math.abs(this.desPitch - this.aimPitch) < 3 * DEG;
      if (ready) { c.fire = true; n.stage = 2; } else if (time > n.until) this.nade = null;
    } else if (n.stage === 2) {
      c.fire = true;
      n.stage = 3;
    } else {
      this.nade = null;
    }
  }
}
