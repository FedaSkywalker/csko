// Hitscan bullets (with crate penetration), knife attacks and explosion damage.
import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { MAT } from './map/layout.js';
import { rayAABB, dirFromAngles } from './util.js';

const PENETRATION = { ak47: 1.1, m4a1: 1.0, awp: 2.1, deagle: 1.1, glock: 0.4, usp: 0.5, mp5: 0.6 };
const KNIFE_DEF = { ...WEAPONS.knife, armorPen: 0.85 };
const _hit = {};
const _ray = { axis: -1, tmax: 0 };
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Combat {
  constructor(game) {
    this.game = game;
  }

  // Returns the end point of the bullet path. Human shooters are lag-compensated on the server.
  fire(shooter, origin, dir, def) {
    const saved = this.game.rewindFor(shooter);
    try {
      return this._fire(shooter, origin, dir, def);
    } finally {
      this.game.restore(saved);
    }
  }

  _fire(shooter, origin, dir, def) {
    const g = this.game;
    const world = g.world;
    let ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    let dmgScale = 1;
    let traveled = 0;
    let pens = 0;
    const range = 240;
    let ex = ox + dx * range, ey = oy + dy * range, ez = oz + dz * range;
    for (let guard = 0; guard < 3; guard++) {
      const remaining = range - traveled;
      const wh = world.raycast(ox, oy, oz, dx, dy, dz, remaining, _hit);
      const maxT = wh ? wh.t : remaining;
      let best = null, bestT = maxT, bestGroup = null;
      for (const a of g.agents) {
        if (a === shooter || !a.alive || a.team === shooter.team) continue;
        const r = a.rayHit(ox, oy, oz, dx, dy, dz, bestT);
        if (r) { best = a; bestT = r.t; bestGroup = r.group; }
      }
      if (best) {
        const dist = traveled + bestT;
        const dmg = def.damage * Math.pow(def.rangeMod, dist / 12.7) * dmgScale;
        ex = ox + dx * bestT; ey = oy + dy * bestT; ez = oz + dz * bestT;
        g.fx('blood', { x: ex, y: ey, z: ez, dx, dy, dz, head: bestGroup === 'head' });
        best.takeDamage(dmg, shooter, bestGroup, def, dir);
        break;
      }
      if (!wh) break;
      ex = wh.x; ey = wh.y; ez = wh.z;
      const mat = wh.box.mat;
      g.fx('impact', { x: ex, y: ey, z: ez, nx: wh.nx, ny: wh.ny, nz: wh.nz, mat });
      const pen = PENETRATION[def.id] || 0;
      if (pens === 0 && mat === MAT.CRATE && pen > 0) {
        const b = wh.box;
        rayAABB(ex + dx * 0.002, ey + dy * 0.002, ez + dz * 0.002, dx, dy, dz, b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2], 10, _ray);
        const thick = _ray.tmax + 0.002;
        if (thick <= pen) {
          dmgScale *= Math.max(0.15, 0.8 - thick * 0.3);
          traveled += wh.t + thick;
          ox = ex + dx * (thick + 0.01);
          oy = ey + dy * (thick + 0.01);
          oz = ez + dz * (thick + 0.01);
          pens++;
          g.fx('impact', { x: ox - dx * 0.01, y: oy - dy * 0.01, z: oz - dz * 0.01, nx: dx, ny: dy, nz: dz, mat, exit: true });
          ex = ox + dx * (range - traveled); ey = oy + dy * (range - traveled); ez = oz + dz * (range - traveled);
          continue;
        }
      }
      break;
    }
    g.fx('tracer', { shooter, ox: origin.x, oy: origin.y, oz: origin.z, ex, ey, ez, def: def.id });
    return _v.set(ex, ey, ez);
  }

  knife(agent, heavy) {
    const saved = this.game.rewindFor(agent);
    try {
      this._knife(agent, heavy);
    } finally {
      this.game.restore(saved);
    }
  }

  _knife(agent, heavy) {
    const g = this.game;
    const eye = agent.eyePos(new THREE.Vector3());
    const range = heavy ? 1.6 : 1.9;
    let target = null, group = null, hitDir = null;
    // A small fan of rays makes melee forgiving.
    const offsets = [[0, 0], [0.1, 0], [-0.1, 0], [0, -0.12], [0, 0.1]];
    const dir = new THREE.Vector3();
    let wall = null;
    for (const [oy, op] of offsets) {
      dirFromAngles(agent.yaw + oy, agent.pitch + op, dir);
      const wh = g.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, range, {});
      if (wh && !wall) wall = wh;
      const maxT = wh ? wh.t : range;
      for (const a of g.agents) {
        if (a === agent || !a.alive || a.team === agent.team) continue;
        const r = a.rayHit(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, maxT);
        if (r) { target = a; group = r.group; hitDir = dir.clone(); break; }
      }
      if (target) break;
    }
    if (target) {
      const vf = dirFromAngles(target.yaw, 0, _v2);
      const toAtt = _v.set(agent.pos.x - target.pos.x, 0, agent.pos.z - target.pos.z).normalize();
      const backstab = vf.x * toAtt.x + vf.z * toAtt.z < -0.35;
      const dmg = heavy ? (backstab ? 180 : 65) : (backstab ? 90 : 40);
      const p = target.chestPos(new THREE.Vector3());
      g.fx('blood', { x: p.x, y: p.y, z: p.z, dx: hitDir.x, dy: hitDir.y, dz: hitDir.z, head: false });
      target.takeDamage(dmg, agent, null, KNIFE_DEF, hitDir);
      g.emit('knife', { agent, heavy, hit: 'flesh', group });
    } else if (wall) {
      g.fx('impact', { x: wall.x, y: wall.y, z: wall.z, nx: wall.nx, ny: wall.ny, nz: wall.nz, mat: wall.box.mat, knife: true });
      g.emit('knife', { agent, heavy, hit: 'wall' });
    } else {
      g.emit('knife', { agent, heavy, hit: null });
    }
  }

  // Radius damage. `friendly` controls whether teammates of the attacker get hurt.
  explosion(x, y, z, radius, maxDmg, attacker, def, { los = true, friendly = false, falloff = 1 } = {}) {
    const g = this.game;
    const c = new THREE.Vector3();
    for (const a of g.agents) {
      if (!a.alive) continue;
      if (!friendly && attacker && a !== attacker && a.team === attacker.team) continue;
      a.chestPos(c);
      const d = Math.hypot(c.x - x, c.y - y, c.z - z);
      if (d > radius) continue;
      if (los) {
        const h = a.headPos(new THREE.Vector3());
        if (!g.world.lineClear(x, y + 0.15, z, c.x, c.y, c.z) && !g.world.lineClear(x, y + 0.15, z, h.x, h.y, h.z)) continue;
      }
      let dmg = maxDmg * Math.pow(1 - d / radius, falloff);
      if (a === attacker) dmg *= 0.5;
      if (dmg < 1) continue;
      const dir = new THREE.Vector3(c.x - x, c.y - y, c.z - z).normalize();
      a.takeDamage(dmg, attacker, null, def, dir);
    }
  }
}
