// Weapons lying on the ground: dropping, simple physics, auto/manual pickup (simulation only).
import * as THREE from 'three';
import { WEAPONS } from './config.js';

const _v = new THREE.Vector3();

export class Drops {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.nextId = 1;
  }

  spawn(w, x, y, z, vx = 0, vy = 0, vz = 0, dropper = null) {
    const def = w.def;
    const item = {
      id: this.nextId++,
      def, mag: w.mag ?? 0, reserve: w.reserve ?? 0,
      pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(vx, vy, vz),
      yaw: Math.random() * Math.PI * 2, rest: false, dropper, noPickupUntil: this.game.time + 0.8,
    };
    this.items.push(item);
    if (def.id === 'c4') this.game.round.onBombDropped(item);
    return item;
  }

  spawnFromAgent(agent, w) {
    const eye = agent.eyePos(new THREE.Vector3());
    const f = agent.forward(new THREE.Vector3());
    const v = agent.body.vel;
    return this.spawn(w, eye.x + f.x * 0.4, eye.y - 0.3, eye.z + f.z * 0.4, f.x * 3.5 + v.x, 1.5 + f.y * 2, f.z * 3.5 + v.z, agent);
  }

  dropOnDeath(agent) {
    const p = agent.pos;
    const w = agent.inv[1] || agent.inv[2];
    if (w) {
      this.spawn(w, p.x, p.y + 1.0, p.z, (Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2, agent);
      if (agent.inv[1] === w) agent.inv[1] = null; else agent.inv[2] = null;
    }
    if (agent.inv[5]) {
      const bomb = agent.inv[5];
      agent.inv[5] = null;
      this.spawn(bomb, p.x, p.y + 0.9, p.z, (Math.random() - 0.5) * 1.5, 1, (Math.random() - 0.5) * 1.5, agent);
    }
  }

  tick(dt) {
    const world = this.game.world;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.rest) {
        it.vel.y -= 20 * dt;
        const nx = it.pos.x + it.vel.x * dt, ny = it.pos.y + it.vel.y * dt, nz = it.pos.z + it.vel.z * dt;
        const r = 0.08;
        if (world.overlaps(nx - r, it.pos.y - r + 0.05, nz - r, nx + r, it.pos.y + r + 0.05, nz + r)) {
          it.vel.x *= -0.2;
          it.vel.z *= -0.2;
        } else {
          it.pos.x = nx;
          it.pos.z = nz;
        }
        if (world.overlaps(it.pos.x - r, ny - 0.02, it.pos.z - r, it.pos.x + r, ny + 0.02, it.pos.z + r) && it.vel.y < 0) {
          it.pos.y = world.groundHeight(it.pos.x, it.pos.z, it.pos.y + 0.3) + 0.03;
          it.rest = true;
          it.vel.set(0, 0, 0);
        } else {
          it.pos.y = ny;
        }
        if (it.pos.y < -2) { it.pos.y = 0.05; it.rest = true; }
      }
      // Auto pickup when walking over.
      for (const a of this.game.agents) {
        if (!a.alive) continue;
        if (a === it.dropper && this.game.time < it.noPickupUntil) continue;
        const dx = a.pos.x - it.pos.x, dz = a.pos.z - it.pos.z;
        if (dx * dx + dz * dz > 0.8 || Math.abs(a.pos.y - it.pos.y) > 1.3) continue;
        if (this._canAutoPick(a, it)) { this.pick(a, it); break; }
      }
    }
  }

  _canAutoPick(a, it) {
    const def = it.def;
    if (def.id === 'c4') return a.team === 'T' && !a.inv[5];
    if (def.kind === 'grenade') return a.grenades.filter((g) => g === def.id).length < def.max && a.grenades.length < 4;
    return !a.inv[def.slot];
  }

  nearest(agent, maxDist = 1.8) {
    let best = null, bestD = maxDist * maxDist;
    const eye = agent.eyePos(_v);
    for (const it of this.items) {
      const dx = eye.x - it.pos.x, dz = eye.z - it.pos.z, dy = (agent.pos.y - it.pos.y);
      const d = dx * dx + dz * dz;
      if (d < bestD && Math.abs(dy) < 1.5) {
        if (it.def.id === 'c4' && agent.team !== 'T') continue;
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  tryPickup(agent) {
    const it = this.nearest(agent);
    if (!it) return false;
    const def = it.def;
    if (def.kind === 'grenade' || def.id === 'c4') {
      if (!this._canAutoPick(agent, it)) return false;
      this.pick(agent, it);
      return true;
    }
    const existing = agent.inv[def.slot];
    if (existing) {
      agent.inv[def.slot] = null;
      this.spawnFromAgent(agent, existing);
    }
    this.pick(agent, it, true);
    return true;
  }

  pick(agent, it, select = false) {
    const def = it.def;
    const time = this.game.time;
    if (def.id === 'c4') {
      agent.inv[5] = { def: WEAPONS.c4 };
      this.game.round.onBombPicked(agent);
    } else if (def.kind === 'grenade') {
      agent.grenades.push(def.id);
    } else {
      agent.inv[def.slot] = { def, mag: it.mag, reserve: it.reserve };
      const better = def.slot < agent.slot && agent.slot !== 4;
      if (select || better || agent.slot === def.slot) agent.switchTo(def.slot, time, true);
    }
    this.remove(it);
    this.game.emit('pickup', { agent, def });
  }

  remove(it) {
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
  }

  clear() {
    this.items.length = 0;
  }
}
