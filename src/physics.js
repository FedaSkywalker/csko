// AABB character mover: swept per-axis collision, step-up for stairs, ground snapping.
import * as THREE from 'three';
import { MOVE } from './config.js';

const SKIN = 0.001;
const TOL = 1e-4;
const _boxes = [];
const AX = ['x', 'y', 'z'];

export class Body {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.halfW = MOVE.halfWidth;
    this.height = MOVE.standHeight;
    this.onGround = false;
  }
}

// Moves the body along one axis as far as possible. Returns the distance actually moved.
export function moveAxis(world, body, axis, delta) {
  if (delta === 0) return 0;
  const p = body.pos;
  const hw = body.halfW;
  const amin = [p.x - hw, p.y, p.z - hw];
  const amax = [p.x + hw, p.y + body.height, p.z + hw];
  const qmin = amin.slice();
  const qmax = amax.slice();
  if (delta > 0) qmax[axis] += delta; else qmin[axis] += delta;
  world.query(qmin[0] - SKIN, qmin[1] - SKIN, qmin[2] - SKIN, qmax[0] + SKIN, qmax[1] + SKIN, qmax[2] + SKIN, _boxes);
  let allowed = delta;
  for (let k = 0; k < _boxes.length; k++) {
    const b = _boxes[k];
    let ok = true;
    for (let o = 0; o < 3; o++) {
      if (o === axis) continue;
      if (!(b.min[o] < amax[o] - 1e-5 && b.max[o] > amin[o] + 1e-5)) { ok = false; break; }
    }
    if (!ok) continue;
    if (delta > 0) {
      const d = b.min[axis] - amax[axis];
      if (d >= -TOL && d - SKIN < allowed) allowed = Math.max(0, d - SKIN);
    } else {
      const d = b.max[axis] - amin[axis];
      if (d <= TOL && d + SKIN > allowed) allowed = Math.min(0, d + SKIN);
    }
  }
  p[AX[axis]] += allowed;
  return allowed;
}

export function bodyFits(world, body, x, y, z, height) {
  const hw = body.halfW;
  return !world.overlaps(x - hw + 1e-4, y + 1e-4, z - hw + 1e-4, x + hw - 1e-4, y + height - 1e-4, z + hw - 1e-4);
}

// Integrates velocity with collisions. Sets body.onGround.
export function moveBody(world, body, dt) {
  const v = body.vel;
  const p = body.pos;
  let dx = v.x * dt;
  let dz = v.z * dt;
  const dy = v.y * dt;
  const sx = p.x, sy = p.y, sz = p.z;
  const wasOnGround = body.onGround;

  // Sub-step fast horizontal motion to avoid tunnelling through thin props.
  let mx = 0, mz = 0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.25));
  for (let s = 0; s < steps; s++) {
    mx += moveAxis(world, body, 0, dx / steps);
    mz += moveAxis(world, body, 2, dz / steps);
  }
  const blockedX = Math.abs(mx - dx) > 1e-6;
  const blockedZ = Math.abs(mz - dz) > 1e-6;

  if ((blockedX || blockedZ) && wasOnGround) {
    const ax = p.x, ay = p.y, az = p.z;
    const distA = (ax - sx) ** 2 + (az - sz) ** 2;
    p.set(sx, sy, sz);
    const up = moveAxis(world, body, 1, MOVE.stepHeight);
    const bx = moveAxis(world, body, 0, dx);
    const bz = moveAxis(world, body, 2, dz);
    const down = moveAxis(world, body, 1, -(up + 0.02));
    const landed = Math.abs(down) < up + 0.02 - 1e-6;
    const distB = (p.x - sx) ** 2 + (p.z - sz) ** 2;
    if (landed && distB > distA + 1e-8) {
      mx = bx;
      mz = bz;
    } else {
      p.set(ax, ay, az);
    }
  }
  if (Math.abs(mx - dx) > 1e-6) v.x = 0;
  if (Math.abs(mz - dz) > 1e-6) v.z = 0;

  const my = moveAxis(world, body, 1, dy);
  const blockedY = Math.abs(my - dy) > 1e-7;
  body.onGround = blockedY && dy < 0;
  if (blockedY) v.y = 0;

  // Stick to stairs when walking down.
  if (!body.onGround && wasOnGround && v.y <= 0) {
    const snap = moveAxis(world, body, 1, -MOVE.stepHeight);
    if (Math.abs(snap) < MOVE.stepHeight - 1e-6) {
      body.onGround = true;
      v.y = 0;
    } else {
      p.y -= snap;
    }
  }
}
