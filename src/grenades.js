// Thrown grenades: bouncing physics, HE / flash / smoke detonation, smoke vision blocking (simulation only).
import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { clamp, segPointDist2 } from './util.js';

export const NADE_GRAVITY = 18;
export const NADE_SPEED = 20;
const RADIUS = 0.07;
const _boxes = [];
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class Grenades {
  constructor(game) {
    this.game = game;
    this.list = []; // { nid, type, owner, pos, vel, age, fuse, rest, lastBounce }
    this.smokes = []; // { x, y, z, start, end }
    this.nextId = 1;
  }

  throw(agent, type, under) {
    const g = this.game;
    const eye = agent.eyePos(new THREE.Vector3());
    const f = agent.forward(new THREE.Vector3());
    const speed = under ? 8 : NADE_SPEED;
    const v = agent.body.vel;
    const pos = eye.clone().addScaledVector(f, 0.25);
    if (!g.world.lineClear(eye.x, eye.y, eye.z, pos.x, pos.y, pos.z)) pos.copy(eye);
    const vel = new THREE.Vector3(f.x * speed + v.x * 0.8, f.y * speed + (under ? 1.2 : 1.6) + v.y * 0.4, f.z * speed + v.z * 0.8);
    this.list.push({ nid: this.nextId++, type, owner: agent, pos, vel, age: 0, fuse: type === 'smoke' ? 1.6 : 1.55, rest: false, lastBounce: 0 });
    g.emit('grenadeThrown', { agent, id: type });
  }

  tick(dt) {
    const g = this.game;
    const world = g.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const n = this.list[i];
      n.age += dt;
      if (!n.rest) {
        const sub = 4;
        const h = dt / sub;
        for (let s = 0; s < sub; s++) {
          n.vel.y -= NADE_GRAVITY * h;
          let px = n.pos.x + n.vel.x * h, py = n.pos.y + n.vel.y * h, pz = n.pos.z + n.vel.z * h;
          world.query(px - RADIUS, py - RADIUS, pz - RADIUS, px + RADIUS, py + RADIUS, pz + RADIUS, _boxes);
          for (const b of _boxes) {
            const ex0 = b.min[0] - RADIUS, ex1 = b.max[0] + RADIUS;
            const ey0 = b.min[1] - RADIUS, ey1 = b.max[1] + RADIUS;
            const ez0 = b.min[2] - RADIUS, ez1 = b.max[2] + RADIUS;
            if (px <= ex0 || px >= ex1 || py <= ey0 || py >= ey1 || pz <= ez0 || pz >= ez1) continue;
            // Resolve along the axis of least penetration.
            const pen = [px - ex0, ex1 - px, py - ey0, ey1 - py, pz - ez0, ez1 - pz];
            let k = 0;
            for (let j = 1; j < 6; j++) if (pen[j] < pen[k]) k = j;
            const axis = k >> 1;
            const sign = k & 1 ? 1 : -1;
            if (axis === 0) px = sign > 0 ? ex1 + 1e-4 : ex0 - 1e-4;
            else if (axis === 1) py = sign > 0 ? ey1 + 1e-4 : ey0 - 1e-4;
            else pz = sign > 0 ? ez1 + 1e-4 : ez0 - 1e-4;
            const vn = axis === 0 ? n.vel.x : axis === 1 ? n.vel.y : n.vel.z;
            if (vn * sign < 0) {
              const e = 0.42;
              if (axis === 0) n.vel.x = -vn * e; else if (axis === 1) n.vel.y = -vn * e; else n.vel.z = -vn * e;
              const fr = 0.72;
              if (axis !== 0) n.vel.x *= fr;
              if (axis !== 1) n.vel.y *= fr;
              if (axis !== 2) n.vel.z *= fr;
              if (Math.abs(vn) > 2 && n.age - n.lastBounce > 0.08) {
                n.lastBounce = n.age;
                g.fx('bounce', { x: px, y: py, z: pz });
              }
            }
            if (axis === 1 && sign > 0 && Math.hypot(n.vel.x, n.vel.y, n.vel.z) < 0.5) {
              n.rest = true;
              n.vel.set(0, 0, 0);
            }
          }
          n.pos.set(px, py, pz);
          if (n.rest) break;
        }
        if (n.pos.y < -3) { n.pos.y = 0.1; n.rest = true; }
      }
      const speed = n.vel.length();
      const ready = n.type === 'smoke' ? (n.age > n.fuse && speed < 1) || n.age > 5 : n.age > n.fuse;
      if (ready) {
        this.detonate(n);
        this.list.splice(i, 1);
      }
    }
    const t = g.time;
    for (let i = this.smokes.length - 1; i >= 0; i--) if (t > this.smokes[i].end) this.smokes.splice(i, 1);
  }

  detonate(n) {
    const g = this.game;
    const { x, y, z } = n.pos;
    const owner = n.owner && g.byId?.has(n.owner.id) ? n.owner : null;
    if (n.type === 'he') {
      g.fx('explosion', { x, y, z, big: false });
      g.combat.explosion(x, y, z, 8.5, 98, owner, WEAPONS.he, { los: true });
      g.shake(x, y, z, 8, 0.5);
    } else if (n.type === 'flash') {
      g.fx('flashbang', { x, y, z });
      this._blind(n, owner);
    } else if (n.type === 'smoke') {
      g.fx('smoke', { x, y, z });
      this.smokes.push({ x, y: y + 1.2, z, start: g.time, end: g.time + 18.5 });
    }
  }

  _blind(n, owner) {
    const g = this.game;
    const p = n.pos;
    for (const a of g.agents) {
      if (!a.alive) continue;
      const eye = a.eyePos(_v);
      const dist = eye.distanceTo(p);
      if (dist > 32) continue;
      if (!g.world.lineClear(p.x, p.y + 0.1, p.z, eye.x, eye.y, eye.z)) continue;
      if (this.smokeBlocks(p.x, p.y, p.z, eye.x, eye.y, eye.z)) continue;
      const f = a.forward(_w);
      const tx = p.x - eye.x, ty = p.y - eye.y, tz = p.z - eye.z;
      const len = Math.hypot(tx, ty, tz) || 1;
      const dot = (f.x * tx + f.y * ty + f.z * tz) / len;
      let k = dot > 0.55 ? 1 : dot > 0 ? 0.35 + dot * 1.2 : dot > -0.5 ? 0.22 : 0.1;
      k *= clamp(1 - (dist - 5) / 27, 0.12, 1);
      const dur = 0.35 + 4.6 * k;
      if (g.time + dur > a.blindUntil) {
        a.blindUntil = g.time + dur;
        a.blindDuration = dur;
        a.blindAmount = k;
      }
      g.emit('flashed', { agent: a, amount: k, duration: dur, by: owner });
    }
  }

  smokeRadius(s, t) {
    const age = t - s.start;
    const grow = clamp(age / 1.4, 0, 1);
    const fade = clamp((s.end - t) / 2.5, 0, 1);
    return 3.7 * grow * (0.4 + 0.6 * fade);
  }

  smokeBlocks(ax, ay, az, bx, by, bz) {
    const t = this.game.time;
    for (const s of this.smokes) {
      const r = this.smokeRadius(s, t) * 0.9;
      if (r < 0.5) continue;
      if (segPointDist2(ax, ay, az, bx, by, bz, s.x, s.y, s.z) < r * r) return true;
    }
    return false;
  }

  // 0..1 density at a point (camera inside smoke).
  smokeDensity(x, y, z) {
    const t = this.game.time;
    let d = 0;
    for (const s of this.smokes) {
      const r = this.smokeRadius(s, t);
      if (r < 0.3) continue;
      const dist = Math.hypot(x - s.x, (y - s.y) * 1.3, z - s.z);
      d = Math.max(d, clamp(1.15 - dist / r, 0, 1));
    }
    return d;
  }

  clear() {
    this.list.length = 0;
    this.smokes.length = 0;
  }
}
