// A combatant (player or bot): CS-style movement, inventory, weapon handling, damage.
import * as THREE from 'three';
import { MOVE, WEAPONS, RECOIL, HITGROUP, ROUND, ECON, DEG } from './config.js';
import { Body, moveBody, bodyFits } from './physics.js';
import { clamp, dirFromAngles, rayAABB } from './util.js';

const HB_STAND = [
  { group: 'head', min: [-0.13, 1.49, -0.16], max: [0.13, 1.78, 0.12] },
  { group: 'chest', min: [-0.24, 1.12, -0.16], max: [0.24, 1.49, 0.14] },
  { group: 'stomach', min: [-0.2, 0.86, -0.15], max: [0.2, 1.12, 0.13] },
  { group: 'legs', min: [-0.21, 0.0, -0.15], max: [0.21, 0.86, 0.15] },
];
const HB_CROUCH = [
  { group: 'head', min: [-0.13, 0.92, -0.2], max: [0.13, 1.19, 0.08] },
  { group: 'chest', min: [-0.24, 0.64, -0.2], max: [0.24, 0.92, 0.1] },
  { group: 'stomach', min: [-0.2, 0.46, -0.18], max: [0.2, 0.64, 0.1] },
  { group: 'legs', min: [-0.22, 0.0, -0.3], max: [0.22, 0.46, 0.2] },
];

const RELOAD_SOUNDS = {
  rifle: [[0.22, 'mag_out'], [0.62, 'mag_in'], [0.86, 'bolt']],
  smg: [[0.22, 'mag_out'], [0.6, 'mag_in'], [0.85, 'bolt']],
  sniper: [[0.2, 'bolt'], [0.4, 'mag_out'], [0.7, 'mag_in'], [0.9, 'bolt']],
  pistol: [[0.25, 'mag_out'], [0.6, 'mag_in'], [0.85, 'bolt']],
};

export function makeCmd() {
  return {
    forward: 0, side: 0, jump: false, crouch: false, walk: false,
    fire: false, fire2: false, reload: false, use: false, drop: false, inspect: false,
    slot: 0, nextWeapon: 0, lastWeapon: false, yaw: 0, pitch: 0,
  };
}

export function recoilAt(name, idx) {
  const p = RECOIL[name] || RECOIL.awp;
  const i = Math.floor(idx);
  const f = idx - i;
  const a = p[Math.min(i, p.length - 1)];
  const b = p[Math.min(i + 1, p.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Agent {
  constructor(game, { id, name, team, isBot }) {
    this.game = game;
    this.id = id;
    this.name = name;
    this.team = team;
    this.isBot = isBot;
    this.body = new Body();
    this.prevPos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.crouched = false;
    this.viewEye = MOVE.standEye;
    this.health = 100;
    this.armor = 0;
    this.helmet = false;
    this.defuser = false;
    this.alive = true;
    this.money = ECON.startMoney;
    this.kills = 0;
    this.deaths = 0;
    this.assists = 0;
    this.headshots = 0;
    this.mvps = 0;
    this.roundKills = 0;
    this.damageDealt = 0;
    this.inv = { 1: null, 2: null, 3: null, 5: null };
    this.grenades = [];
    this.grenadeIdx = 0;
    this.slot = 3;
    this.lastSlot = 3;
    this.ws = this._freshWeaponState();
    this.kick = 0;
    this.punch = 0;
    this.planting = false;
    this.plantProgress = 0;
    this.defusing = false;
    this.defuseProgress = 0;
    this.jumpHeld = false;
    this.jumpBuf = 0;
    this.pendingCmd = null;
    this.viewTime = null;
    this.pendingTeam = null;
    this.isHuman = !isBot;
    this.stepDist = 0;
    this.lastDamageTime = -10;
    this.lastAttacker = null;
    this.damagedBy = new Map();
    this.blindUntil = 0;
    this.blindAmount = 0;
    this.blindDuration = 0;
    this.lastStepTime = 0;
    this.model = null;
    this.brain = null;
    this.spectateYaw = 0;
  }

  _freshWeaponState() {
    return {
      nextFire: 0, reloadEnd: 0, reloadStart: 0, reloadPlayed: 0, drawEnd: 0,
      recoil: 0, bloom: 0, lastShot: -10, scoped: 0, scopeResume: 0, rescopeAt: 0,
      triggerHeld: false, fire2Held: false, useHeld: false, pinPulled: false, throwUnder: false,
    };
  }

  get pos() { return this.body.pos; }

  get current() {
    if (this.slot === 4) {
      const id = this.grenades[this.grenadeIdx];
      return id ? { def: WEAPONS[id] } : this.inv[3];
    }
    return this.inv[this.slot] || this.inv[3];
  }

  get currentDef() {
    const c = this.current;
    return c ? c.def : WEAPONS.knife;
  }

  get primary() { return this.inv[1]; }
  get secondary() { return this.inv[2]; }
  get hasBomb() { return !!this.inv[5]; }

  eyePos(out = _eye) {
    return out.set(this.body.pos.x, this.body.pos.y + this.viewEye, this.body.pos.z);
  }

  forward(out = _dir) {
    return dirFromAngles(this.yaw, this.pitch, out);
  }

  speed2D() {
    return Math.hypot(this.body.vel.x, this.body.vel.z);
  }

  maxSpeed() {
    const def = this.currentDef;
    if (def.kind === 'sniper' && this.ws.scoped > 0) return def.scopedSpeed;
    return def.speed;
  }

  // ------------------------------------------------------------ inventory
  makeWeapon(id) {
    const def = WEAPONS[id];
    return { def, mag: def.mag || 0, reserve: def.reserve || 0 };
  }

  giveWeapon(id, time = this.game.time, select = true) {
    const def = WEAPONS[id];
    if (!def) return false;
    if (def.kind === 'grenade') {
      const count = this.grenades.filter((g) => g === id).length;
      if (count >= def.max || this.grenades.length >= 4) return false;
      this.grenades.push(id);
      return true;
    }
    this.inv[def.slot] = this.makeWeapon(id);
    if (select) this.switchTo(def.slot, time, true);
    return true;
  }

  resetLoadout() {
    this.inv = { 1: null, 2: null, 3: this.makeWeapon('knife'), 5: null };
    this.inv[2] = this.makeWeapon(this.team === 'T' ? 'glock' : 'usp');
    this.grenades = [];
    this.armor = 0;
    this.helmet = false;
    this.defuser = false;
  }

  refillAmmo() {
    for (const s of [1, 2]) {
      const w = this.inv[s];
      if (w) { w.mag = w.def.mag; w.reserve = w.def.reserve; }
    }
  }

  bestSlot() {
    if (this.inv[1]) return 1;
    if (this.inv[2]) return 2;
    return 3;
  }

  switchTo(slot, time = this.game.time, force = false) {
    if (slot === 4) {
      if (!this.grenades.length) return;
      if (this.slot === 4 && !force) {
        this.grenadeIdx = (this.grenadeIdx + 1) % this.grenades.length;
      } else {
        this.grenadeIdx = Math.min(this.grenadeIdx, this.grenades.length - 1);
      }
    } else {
      if (!this.inv[slot]) return;
      if (slot === this.slot && !force) return;
    }
    if (slot !== this.slot) this.lastSlot = this.slot;
    this.slot = slot;
    const ws = this.ws;
    ws.reloadEnd = 0;
    ws.scoped = 0;
    ws.rescopeAt = 0;
    ws.pinPulled = false;
    const def = this.currentDef;
    ws.drawEnd = time + (def.draw || 0.5);
    ws.nextFire = Math.max(ws.nextFire, ws.drawEnd);
    this.planting = false;
    this.plantProgress = 0;
    this.game.emit('draw', { agent: this, def });
  }

  cycleWeapon(dir, time) {
    const order = [1, 2, 3, 4, 5].filter((s) => (s === 4 ? this.grenades.length > 0 : !!this.inv[s]));
    if (!order.length) return;
    let i = order.indexOf(this.slot);
    i = (i + dir + order.length) % order.length;
    this.switchTo(order[i], time);
  }

  dropCurrent(time) {
    const slot = this.slot;
    if (slot === 3) return;
    if (slot === 4) {
      const id = this.grenades[this.grenadeIdx];
      if (!id) return;
      this.grenades.splice(this.grenadeIdx, 1);
      this.game.drops.spawnFromAgent(this, { def: WEAPONS[id] });
    } else {
      const w = this.inv[slot];
      if (!w) return;
      this.inv[slot] = null;
      this.game.drops.spawnFromAgent(this, w);
    }
    this.switchTo(this.bestSlot(), time, true);
  }

  // ------------------------------------------------------------ simulation
  get frozen() {
    const ph = this.game.round.phase;
    return ph === 'freeze' || ph === 'idle' || ph === 'matchover';
  }

  tick(cmd, dt, time) {
    if (!this.alive) return;
    this._movementStep(cmd, dt);
    this._tickWeapons(cmd, dt, time, this.frozen);
    this.kick *= Math.exp(-14 * dt);
    this.punch *= Math.exp(-10 * dt);
  }

  // Movement only; used by the client to predict its own player between server snapshots.
  predictMove(cmd, dt) {
    if (!this.alive) return;
    this._movementStep(cmd, dt);
  }

  _movementStep(cmd, dt) {
    this.prevPos.copy(this.body.pos);
    this.yaw = cmd.yaw;
    this.pitch = clamp(cmd.pitch, -89 * DEG, 89 * DEG);
    this._updateCrouch(cmd.crouch);
    const frozen = this.frozen;
    let fwd = cmd.forward, side = cmd.side;
    if (frozen || this.planting || this.defusing) { fwd = 0; side = 0; }
    this._move(fwd, side, cmd.jump && !frozen && !this.planting && !this.defusing, cmd.walk, dt);
    const eyeTarget = this.crouched ? MOVE.crouchEye : MOVE.standEye;
    const de = eyeTarget - this.viewEye;
    this.viewEye += Math.sign(de) * Math.min(Math.abs(de), 4.2 * dt);
    this._footsteps(dt);
  }

  // Compact movement state for network reconciliation.
  movementState() {
    const b = this.body;
    return [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.onGround ? 1 : 0, this.crouched ? 1 : 0,
      b.height, this.viewEye, this.jumpHeld ? 1 : 0, this.jumpBuf, this.stepDist];
  }

  applyMovementState(m) {
    const b = this.body;
    b.pos.set(m[0], m[1], m[2]);
    b.vel.set(m[3], m[4], m[5]);
    b.onGround = !!m[6];
    this.crouched = !!m[7];
    b.height = m[8];
    this.viewEye = m[9];
    this.jumpHeld = !!m[10];
    this.jumpBuf = m[11];
    this.stepDist = m[12];
  }

  _updateCrouch(want) {
    const b = this.body;
    const world = this.game.world;
    if (want && !this.crouched) {
      if (b.onGround) {
        b.height = MOVE.crouchHeight;
      } else {
        b.pos.y += MOVE.crouchShift;
        this.prevPos.y += MOVE.crouchShift;
        this.viewEye -= MOVE.crouchShift;
        b.height = MOVE.crouchHeight;
      }
      this.crouched = true;
    } else if (!want && this.crouched) {
      const p = b.pos;
      if (b.onGround) {
        if (bodyFits(world, b, p.x, p.y, p.z, MOVE.standHeight)) {
          b.height = MOVE.standHeight;
          this.crouched = false;
        }
      } else if (bodyFits(world, b, p.x, p.y - MOVE.crouchShift, p.z, MOVE.standHeight)) {
        p.y -= MOVE.crouchShift;
        this.prevPos.y -= MOVE.crouchShift;
        this.viewEye += MOVE.crouchShift;
        b.height = MOVE.standHeight;
        this.crouched = false;
      } else if (bodyFits(world, b, p.x, p.y, p.z, MOVE.standHeight)) {
        b.height = MOVE.standHeight;
        this.crouched = false;
      }
    }
  }

  _move(fwd, side, jump, walk, dt) {
    const b = this.body;
    const v = b.vel;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * fwd + cy * side;
    let wz = -cy * fwd - sy * side;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-4) { wx /= wl; wz /= wl; }
    let wish = wl > 1e-4 ? this.maxSpeed() : 0;
    if (walk) wish *= MOVE.walkMul;
    if (this.crouched && b.onGround) wish *= MOVE.crouchMul;

    // Jump buffer counts ticks (not time) so client prediction replays it identically.
    if (jump && !this.jumpHeld) this.jumpBuf = 8;
    this.jumpHeld = jump;

    if (b.onGround) {
      if (this.jumpBuf > 0) {
        this.jumpBuf = 0;
        v.y = MOVE.jumpSpeed;
        b.onGround = false;
        this.game.emit('jump', { agent: this });
      } else {
        const sp = Math.hypot(v.x, v.z);
        if (sp > 0.001) {
          const control = sp < MOVE.stopSpeed ? MOVE.stopSpeed : sp;
          const ns = Math.max(sp - control * MOVE.friction * dt, 0) / sp;
          v.x *= ns;
          v.z *= ns;
        } else {
          v.x = 0;
          v.z = 0;
        }
      }
    }
    if (this.jumpBuf > 0) this.jumpBuf--;
    if (b.onGround) {
      const cur = v.x * wx + v.z * wz;
      const add = wish - cur;
      if (add > 0 && wish > 0) {
        const acc = Math.min(MOVE.accelerate * dt * wish, add);
        v.x += acc * wx;
        v.z += acc * wz;
      }
    } else if (wish > 0) {
      const cap = Math.min(wish, MOVE.airWishCap);
      const cur = v.x * wx + v.z * wz;
      const add = cap - cur;
      if (add > 0) {
        const acc = Math.min(MOVE.airAccelerate * wish * dt, add);
        v.x += acc * wx;
        v.z += acc * wz;
      }
    }
    v.y -= MOVE.gravity * dt;
    if (v.y < -40) v.y = -40;
    const wasGround = b.onGround;
    const vy = v.y;
    moveBody(this.game.world, b, dt);
    if (!wasGround && b.onGround && vy < -5.5) this.game.emit('land', { agent: this, speed: -vy });
    // Safety: never fall out of the world.
    if (b.pos.y < -5) this.game.respawnSafe(this);
  }

  _footsteps(dt) {
    const b = this.body;
    if (!b.onGround) return;
    const sp = this.speed2D();
    if (sp < 3.3) { this.stepDist = Math.min(this.stepDist, 1.2); return; }
    this.stepDist += sp * dt;
    if (this.stepDist > 2.1) {
      this.stepDist = 0;
      this.game.emit('step', { agent: this });
    }
  }

  // ------------------------------------------------------------ weapons
  _tickWeapons(cmd, dt, time, frozen) {
    const ws = this.ws;
    if (cmd.slot) this.switchTo(cmd.slot, time);
    else if (cmd.nextWeapon) this.cycleWeapon(cmd.nextWeapon, time);
    else if (cmd.lastWeapon) this.switchTo(this.lastSlot, time);
    if (cmd.drop && !frozen) this.dropCurrent(time);

    const cur = this.current;
    const def = this.currentDef;

    if (ws.reloadEnd > 0) {
      const frac = 1 - (ws.reloadEnd - time) / def.reload;
      const list = RELOAD_SOUNDS[def.kind] || RELOAD_SOUNDS.rifle;
      while (ws.reloadPlayed < list.length && frac >= list[ws.reloadPlayed][0]) {
        this.game.emit('reloadSound', { agent: this, name: list[ws.reloadPlayed][1] });
        ws.reloadPlayed++;
      }
      if (time >= ws.reloadEnd) this._finishReload();
    }
    if (ws.rescopeAt > 0 && time >= ws.rescopeAt) {
      if (def.kind === 'sniper' && ws.reloadEnd === 0 && cur.mag > 0) ws.scoped = ws.scopeResume;
      ws.rescopeAt = 0;
    }
    if (def.recoil && time - ws.lastShot > def.interval + 0.03) {
      ws.recoil = Math.max(0, ws.recoil - def.recoilRecover * dt);
    }
    if (def.spread) ws.bloom = Math.max(0, ws.bloom - def.spread.recover * dt);

    if (cmd.reload) this.startReload(time);

    // Use key: defuse, plant shortcut, pickup.
    if (cmd.use && !frozen) {
      const round = this.game.round;
      if (this.team === 'CT' && round.canDefuse(this)) {
        if (!this.defusing) {
          this.defusing = true;
          this.defuseProgress = 0;
          this.game.emit('defuseStart', { agent: this });
        }
        this.defuseProgress += dt;
        if (this.defuseProgress >= (this.defuser ? ROUND.defuseKitTime : ROUND.defuseTime)) {
          round.defuseBomb(this);
          this.defusing = false;
        }
      } else if (this.hasBomb && def.kind !== 'bomb' && round.canPlant(this)) {
        this.switchTo(5, time);
      } else if (!ws.useHeld) {
        this.game.drops.tryPickup(this);
      }
    } else if (this.defusing) {
      this.defusing = false;
      this.defuseProgress = 0;
    }
    ws.useHeld = cmd.use;

    if (!frozen || def.kind === 'melee') {
      switch (def.kind) {
        case 'melee': if (!frozen) this._tickKnife(cmd, time); break;
        case 'grenade': this._tickGrenade(cmd, time); break;
        case 'bomb': this._tickBomb(cmd, dt, time); break;
        default: this._tickGun(cmd, time);
      }
    }
    ws.triggerHeld = cmd.fire;
    ws.fire2Held = cmd.fire2;
  }

  startReload(time) {
    const w = this.current;
    const ws = this.ws;
    if (!w || !w.def.mag || ws.reloadEnd > 0) return;
    if (w.mag >= w.def.mag || w.reserve <= 0) return;
    ws.reloadStart = time;
    ws.reloadEnd = time + w.def.reload;
    ws.reloadPlayed = 0;
    ws.scoped = 0;
    ws.rescopeAt = 0;
    this.game.emit('reload', { agent: this, def: w.def, duration: w.def.reload });
  }

  _finishReload() {
    const w = this.current;
    this.ws.reloadEnd = 0;
    if (!w || !w.def.mag) return;
    const take = Math.min(w.def.mag - w.mag, w.reserve);
    w.mag += take;
    w.reserve -= take;
  }

  get reloading() { return this.ws.reloadEnd > 0; }

  _tickGun(cmd, time) {
    const w = this.current;
    const def = w.def;
    const ws = this.ws;
    if (cmd.fire2 && !ws.fire2Held && def.zoom && ws.reloadEnd === 0 && time >= ws.drawEnd) {
      ws.scoped = (ws.scoped + 1) % (def.zoom.length + 1);
      ws.rescopeAt = 0;
      this.game.emit('scope', { agent: this, level: ws.scoped });
    }
    if (!cmd.fire) return;
    if (!def.auto && ws.triggerHeld) return;
    if (time < ws.nextFire || time < ws.drawEnd || ws.reloadEnd > 0) return;
    if (w.mag <= 0) {
      if (!ws.triggerHeld) {
        this.game.emit('dryfire', { agent: this });
        ws.nextFire = time + 0.25;
      }
      if (w.reserve > 0) this.startReload(time);
      return;
    }
    w.mag--;
    ws.nextFire = time + def.interval;
    this._fireBullet(def, time);
  }

  inaccuracy() {
    const def = this.currentDef;
    const s = def.spread;
    if (!s) return 0;
    const b = this.body;
    let r = this.crouched && b.onGround ? s.crouch : s.stand;
    if (def.kind === 'sniper' && this.ws.scoped === 0) r += s.unscoped;
    const maxSp = def.speed;
    const f = clamp((this.speed2D() - maxSp * 0.34) / (maxSp * 0.66), 0, 1);
    r += s.move * f;
    if (!b.onGround) r += s.air;
    r += this.ws.bloom;
    return r;
  }

  _fireBullet(def, time) {
    const ws = this.ws;
    const eye = this.eyePos(new THREE.Vector3());
    const pat = recoilAt(def.recoil, ws.recoil);
    const comp = this.brain ? this.brain.recoilComp : 0;
    let yawOff = -pat[0] * DEG * (1 - comp);
    let pitchOff = pat[1] * DEG * (1 - comp);
    const spread = this.inaccuracy() * DEG;
    const r = spread * Math.sqrt(Math.random());
    const th = Math.random() * Math.PI * 2;
    yawOff += r * Math.cos(th);
    pitchOff += r * Math.sin(th);
    const dir = dirFromAngles(this.yaw + yawOff, this.pitch + pitchOff, new THREE.Vector3());
    ws.recoil = Math.min(ws.recoil + 1, (RECOIL[def.recoil]?.length || 1) + 4);
    ws.bloom += def.spread.shot;
    ws.lastShot = time;
    this.kick += def.kick;
    if (def.kind === 'sniper' && ws.scoped > 0) {
      ws.scopeResume = ws.scoped;
      ws.scoped = 0;
      ws.rescopeAt = time + def.interval * 0.85;
    }
    this.game.emit('shot', { agent: this, def, origin: eye, dir });
    this.game.combat.fire(this, eye, dir, def);
  }

  _tickKnife(cmd, time) {
    const ws = this.ws;
    if (time < ws.nextFire || time < ws.drawEnd) return;
    const def = WEAPONS.knife;
    if (cmd.fire) {
      ws.nextFire = time + def.interval;
      this.game.combat.knife(this, false);
    } else if (cmd.fire2) {
      ws.nextFire = time + def.interval2;
      this.game.combat.knife(this, true);
    }
  }

  _tickGrenade(cmd, time) {
    const ws = this.ws;
    if (time < ws.drawEnd) return;
    if ((cmd.fire || cmd.fire2) && !ws.pinPulled) {
      ws.pinPulled = true;
      ws.throwUnder = !cmd.fire;
      this.game.emit('pin', { agent: this });
    } else if (ws.pinPulled && !cmd.fire && !cmd.fire2) {
      const id = this.grenades[this.grenadeIdx];
      ws.pinPulled = false;
      if (!id) return;
      this.grenades.splice(this.grenadeIdx, 1);
      this.game.grenades.throw(this, id, ws.throwUnder);
      this.game.emit('throw', { agent: this, id });
      if (this.grenades.length) {
        this.grenadeIdx = Math.min(this.grenadeIdx, this.grenades.length - 1);
        this.switchTo(4, time, true);
      } else {
        this.switchTo(this.lastSlot !== 4 && (this.lastSlot === 3 || this.inv[this.lastSlot]) ? this.lastSlot : this.bestSlot(), time, true);
      }
    }
  }

  _tickBomb(cmd, dt, time) {
    const round = this.game.round;
    if ((cmd.fire || cmd.use) && time >= this.ws.drawEnd && round.canPlant(this)) {
      if (!this.planting) {
        this.planting = true;
        this.plantProgress = 0;
        this.game.emit('plantStart', { agent: this });
      }
      const before = this.plantProgress;
      this.plantProgress += dt;
      if (Math.floor(before / 0.45) !== Math.floor(this.plantProgress / 0.45)) this.game.emit('plantBeep', { agent: this });
      if (this.plantProgress >= ROUND.plantTime) {
        this.planting = false;
        this.plantProgress = 0;
        round.plantBomb(this);
      }
    } else {
      this.planting = false;
      this.plantProgress = 0;
    }
  }

  // ------------------------------------------------------------ damage
  takeDamage(amount, attacker, group, def, dir) {
    if (!this.alive) return 0;
    const hg = group ? HITGROUP[group] : null;
    let dmg = amount * (hg ? hg.mult : 1);
    let armored = false;
    const protectedHit = group ? group !== 'legs' && (group !== 'head' || this.helmet) : true;
    if (this.armor > 0 && protectedHit) {
      const pen = def?.armorPen ?? 0.5;
      let hp = dmg * pen;
      let ap = (dmg - hp) * 0.5;
      if (ap > this.armor) {
        ap = this.armor;
        hp = dmg - ap * 2;
      }
      this.armor = Math.max(0, Math.round(this.armor - ap));
      dmg = hp;
      armored = true;
    }
    dmg = Math.max(1, Math.round(dmg));
    const dealt = Math.min(dmg, this.health);
    this.health -= dmg;
    this.lastAttacker = attacker;
    this.lastDamageTime = this.game.time;
    this.body.vel.x *= 0.55;
    this.body.vel.z *= 0.55;
    this.punch += group === 'head' ? 3 : 1.4;
    if (attacker && attacker !== this) {
      this.damagedBy.set(attacker, (this.damagedBy.get(attacker) || 0) + dealt);
      if (attacker.team !== this.team) attacker.damageDealt += dealt;
    }
    this.game.emit('damage', { victim: this, attacker, amount: dealt, group, def, dir, armored });
    if (this.health <= 0) {
      this.health = 0;
      this.die(attacker, def, group === 'head');
    }
    return dealt;
  }

  die(killer, def, headshot) {
    if (!this.alive) return;
    this.alive = false;
    this.deaths++;
    this.planting = false;
    this.defusing = false;
    this.ws.scoped = 0;
    this.game.drops.dropOnDeath(this);
    if (killer && killer !== this && killer.team !== this.team) {
      killer.kills++;
      killer.roundKills++;
      if (headshot) killer.headshots++;
      killer.money = Math.min(ECON.maxMoney, killer.money + (def?.reward ?? 300));
    }
    for (const [a, d] of this.damagedBy) {
      if (a !== killer && a.team !== this.team && d >= 40) a.assists++;
    }
    this.game.emit('kill', { victim: this, killer, def, headshot });
  }

  // Ray vs hitboxes (in the agent's yaw-aligned local frame).
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    if (!this.alive) return null;
    const p = this.body.pos;
    const rx = ox - p.x, ry = oy - p.y, rz = oz - p.z;
    // Quick reject: distance from ray to the agent's vertical axis.
    const t0 = Math.max(0, -(rx * dx + rz * dz) / Math.max(1e-6, dx * dx + dz * dz));
    const cx = rx + dx * t0, cz = rz + dz * t0;
    if (cx * cx + cz * cz > 1.0) return null;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const lx = rx * c - rz * s, lz = rx * s + rz * c;
    const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
    const boxes = this.crouched ? HB_CROUCH : HB_STAND;
    let best = null;
    let bestT = maxT;
    for (const hb of boxes) {
      const t = rayAABB(lx, ry, lz, ldx, dy, ldz, hb.min[0], hb.min[1], hb.min[2], hb.max[0], hb.max[1], hb.max[2], bestT);
      if (t >= 0 && t < bestT) { bestT = t; best = hb.group; }
    }
    return best ? { t: bestT, group: best } : null;
  }

  headPos(out) {
    const p = this.body.pos;
    return out.set(p.x, p.y + (this.crouched ? 1.05 : 1.63), p.z);
  }

  chestPos(out) {
    const p = this.body.pos;
    return out.set(p.x, p.y + (this.crouched ? 0.8 : 1.3), p.z);
  }
}
