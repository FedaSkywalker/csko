// Turns a column layout into merged collision boxes and a handful of batched meshes.
import * as THREE from 'three';
import { MAT, LOOK } from './materials.js';
import { rayAABB, hash2 } from '../util.js';
import { buildDecor } from './decor.js';

const BUCKET = 4;
const _ray = { axis: -1, tmax: 0 };
const WALL_MATS = new Set([MAT.WALL, MAT.WALL2, MAT.CONCRETE]);

class GeoBuilder {
  constructor(rgba = false) {
    this.rgba = rgba;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.index = [];
  }
  quad(v, n, uv, cols) {
    const base = this.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      this.pos.push(v[k][0], v[k][1], v[k][2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.uv.push(uv[k][0], uv[k][1]);
      const c = cols[k];
      if (this.rgba) this.col.push(c[0], c[1], c[2], c[3]);
      else this.col.push(c, c, c);
    }
    this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // Horizontal quad facing up; fixes winding automatically.
  flat(p, cols) {
    const ax = p[1][0] - p[0][0], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], bz = p[2][2] - p[0][2];
    const ny = az * bx - ax * bz;
    if (ny < 0) {
      p = [p[0], p[3], p[2], p[1]];
      cols = [cols[0], cols[3], cols[2], cols[1]];
    }
    this.quad(p, [0, 1, 0], p.map((q) => [q[0] * 0.25, -q[2] * 0.25]), cols);
  }
  get empty() { return this.pos.length === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, this.rgba ? 4 : 3));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Emits an axis-aligned box with world-space (or per-face) UVs and a fake AO gradient at its base.
// `topGb` sends the top face to another builder (e.g. asphalt on top of a concrete slab).
export function emitBox(gb, x0, y0, z0, x1, y1, z1, o = {}) {
  const s = o.scale ?? 0.25;
  const local = !!o.localUV;
  const tint = o.tint ?? 1;
  const aoOn = o.ao !== false;
  const bottomTint = o.bottomTint ?? tint;
  const cb = aoOn ? 0.55 * tint : tint;
  const ys = aoOn ? Math.min(y0 + 0.9, y1) : y1;

  const side = (ax, az, bx, bz, n, ua, ub) => {
    const vv = (y) => (local ? (y - y0) / (y1 - y0) : y * s);
    if (aoOn && ys < y1 - 1e-4) {
      gb.quad([[ax, y0, az], [bx, y0, bz], [bx, ys, bz], [ax, ys, az]], n,
        [[ua, vv(y0)], [ub, vv(y0)], [ub, vv(ys)], [ua, vv(ys)]], [cb, cb, tint, tint]);
      gb.quad([[ax, ys, az], [bx, ys, bz], [bx, y1, bz], [ax, y1, az]], n,
        [[ua, vv(ys)], [ub, vv(ys)], [ub, vv(y1)], [ua, vv(y1)]], [tint, tint, tint, tint]);
    } else {
      const c0 = aoOn ? cb : tint;
      gb.quad([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], n,
        [[ua, vv(y0)], [ub, vv(y0)], [ub, vv(y1)], [ua, vv(y1)]], [c0, c0, tint, tint]);
    }
  };
  const U = (a, b) => (local ? [0, 1] : [a * s, b * s]);
  let u;
  u = U(-z1, -z0); side(x1, z1, x1, z0, [1, 0, 0], u[0], u[1]);
  u = U(z0, z1); side(x0, z0, x0, z1, [-1, 0, 0], u[0], u[1]);
  u = U(x0, x1); side(x0, z1, x1, z1, [0, 0, 1], u[0], u[1]);
  u = U(-x1, -x0); side(x1, z0, x0, z0, [0, 0, -1], u[0], u[1]);
  if (o.top !== false) {
    const tg = o.topGb || gb;
    const uvTop = local ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[x0 * s, -z1 * s], [x1 * s, -z1 * s], [x1 * s, -z0 * s], [x0 * s, -z0 * s]];
    const tt = o.topTint ?? tint;
    tg.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], uvTop, [tt, tt, tt, tt]);
  }
  if (y0 > 0.001 && o.bottom !== false) {
    const uvB = local ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[x0 * s, z0 * s], [x1 * s, z0 * s], [x1 * s, z1 * s], [x0 * s, z1 * s]];
    const bt = bottomTint;
    gb.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], uvB, [bt, bt, bt, bt]);
  }
}

function greedy(W, D, include, key, emit) {
  const used = new Uint8Array(W * D);
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      if (used[i] || !include(i)) continue;
      const k = key(i);
      let w = 1;
      while (x + w < W) {
        const j = i + w;
        if (used[j] || !include(j) || key(j) !== k) break;
        w++;
      }
      let d = 1;
      outer: while (z + d < D) {
        for (let a = 0; a < w; a++) {
          const j = (z + d) * W + x + a;
          if (used[j] || !include(j) || key(j) !== k) break outer;
        }
        d++;
      }
      for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) used[(z + b) * W + x + a] = 1;
      emit(x, z, w, d, i);
    }
  }
}

// Texture name -> [roughness, metalness]
const PBR = {
  sand: [0.97, 0], crate: [0.85, 0], metal: [0.55, 0.25], concrete: [0.92, 0], asphalt: [0.96, 0],
  tiles: [0.55, 0], containerRed: [0.62, 0.3], containerBlue: [0.62, 0.3], shutter: [0.8, 0], grate: [0.5, 0.55],
};

export class World {
  constructor(layout) {
    this.L = layout;
    this.cols = layout.cols;
    this.boxes = [];
    this.group = new THREE.Group();
    this.group.name = 'world';
    this.ownTextures = [];
    this._buildBoxes();
    this._buildGrid();
    this.solidCols = this._foldProps();
  }

  _addBox(x0, y0, z0, x1, y1, z1, mat, kind) {
    const b = { min: [x0, y0, z0], max: [x1, y1, z1], mat, kind, id: this.boxes.length };
    this.boxes.push(b);
    return b;
  }

  // Greedy-merge identical spans of neighbouring columns into boxes.
  _buildBoxes() {
    const C = this.cols;
    const W = C.W, D = C.D;
    const used = C.cols.map((l) => new Uint8Array(l.length));
    const find = (j, s) => {
      const l = C.cols[j];
      for (let k = 0; k < l.length; k++) {
        const t = l[k];
        if (!used[j][k] && t[0] === s[0] && t[1] === s[1] && t[2] === s[2]) return k;
      }
      return -1;
    };
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const i = z * W + x;
        const list = C.cols[i];
        for (let k = 0; k < list.length; k++) {
          if (used[i][k]) continue;
          const s = list[k];
          let w = 1;
          while (x + w < W && find(i + w, s) >= 0) w++;
          let d = 1;
          outer: while (z + d < D) {
            for (let a = 0; a < w; a++) if (find((z + d) * W + x + a, s) < 0) break outer;
            d++;
          }
          for (let b = 0; b < d; b++) {
            for (let a = 0; a < w; a++) {
              const j = (z + b) * W + x + a;
              used[j][find(j, s)] = 1;
            }
          }
          // Resting on the ground or on another span: draw like a wall (AO, no bottom face).
          const grounded = s[0] < 0.001 || (k > 0 && Math.abs(list[k - 1][1] - s[0]) < 1e-6);
          this._addBox(x, s[0], z, x + w, s[1], z + d, s[2], grounded ? 'solid' : 'hang');
        }
      }
    }
    for (const p of this.L.props) {
      const b = this._addBox(p.min[0], p.min[1], p.min[2], p.max[0], p.max[1], p.max[2], p.mat, 'prop');
      b.invisible = !!p.invisible;
    }
    this.ground = { min: [-50, -4, -50], max: [W + 50, 0, D + 50], mat: this.L.groundMat ?? MAT.FLOOR, kind: 'ground', id: -1 };
  }

  // Columns with the props folded in: what navigation, AO and the radar treat as solid.
  _foldProps() {
    const S = this.cols.clone();
    const e = 0.05;
    for (const p of this.L.props) S.solid(p.min[0] + e, p.min[2] + e, p.max[0] - e, p.max[2] - e, p.min[1], p.max[1], p.mat);
    return S;
  }

  _buildGrid() {
    const L = this.L;
    this.gw = Math.ceil(L.width / BUCKET);
    this.gd = Math.ceil(L.depth / BUCKET);
    this.buckets = Array.from({ length: this.gw * this.gd }, () => []);
    this.mark = new Uint32Array(this.boxes.length);
    this.stamp = 0;
    for (const b of this.boxes) {
      const gx0 = Math.max(0, Math.floor(b.min[0] / BUCKET));
      const gz0 = Math.max(0, Math.floor(b.min[2] / BUCKET));
      const gx1 = Math.min(this.gw - 1, Math.floor((b.max[0] - 1e-6) / BUCKET));
      const gz1 = Math.min(this.gd - 1, Math.floor((b.max[2] - 1e-6) / BUCKET));
      for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) this.buckets[gz * this.gw + gx].push(b);
    }
  }

  // Collect boxes overlapping the given AABB (open intervals).
  query(minx, miny, minz, maxx, maxy, maxz, out) {
    out.length = 0;
    const st = ++this.stamp;
    const gx0 = Math.max(0, Math.floor(minx / BUCKET));
    const gz0 = Math.max(0, Math.floor(minz / BUCKET));
    const gx1 = Math.min(this.gw - 1, Math.floor(maxx / BUCKET));
    const gz1 = Math.min(this.gd - 1, Math.floor(maxz / BUCKET));
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const list = this.buckets[gz * this.gw + gx];
        for (let k = 0; k < list.length; k++) {
          const b = list[k];
          if (this.mark[b.id] === st) continue;
          this.mark[b.id] = st;
          if (b.min[0] < maxx && b.max[0] > minx && b.min[1] < maxy && b.max[1] > miny && b.min[2] < maxz && b.max[2] > minz) out.push(b);
        }
      }
    }
    const g = this.ground;
    if (miny < g.max[1]) out.push(g);
    return out;
  }

  overlaps(minx, miny, minz, maxx, maxy, maxz) {
    const tmp = this._tmp || (this._tmp = []);
    return this.query(minx, miny, minz, maxx, maxy, maxz, tmp).length > 0;
  }

  // Ray against world geometry. dir must be normalized. Returns hit object or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, hit = {}) {
    let best = maxDist;
    let bestBox = null;
    let bestAxis = -1;
    if (dy < 0 && oy >= 0) {
      const t = -oy / dy;
      if (t < best) { best = t; bestBox = this.ground; bestAxis = 1; }
    } else if (oy < 0) {
      best = 0; bestBox = this.ground; bestAxis = 1;
    }
    const st = ++this.stamp;
    let gx = Math.floor(ox / BUCKET);
    let gz = Math.floor(oz / BUCKET);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    let tMaxX = Math.abs(dx) > 1e-12 ? ((dx > 0 ? (gx + 1) * BUCKET : gx * BUCKET) - ox) / dx : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-12 ? ((dz > 0 ? (gz + 1) * BUCKET : gz * BUCKET) - oz) / dz : Infinity;
    const tDX = Math.abs(dx) > 1e-12 ? BUCKET / Math.abs(dx) : Infinity;
    const tDZ = Math.abs(dz) > 1e-12 ? BUCKET / Math.abs(dz) : Infinity;
    for (let guard = 0; guard < 512; guard++) {
      if (gx >= 0 && gz >= 0 && gx < this.gw && gz < this.gd) {
        const list = this.buckets[gz * this.gw + gx];
        for (let k = 0; k < list.length; k++) {
          const b = list[k];
          if (this.mark[b.id] === st) continue;
          this.mark[b.id] = st;
          const t = rayAABB(ox, oy, oz, dx, dy, dz, b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2], best, _ray);
          if (t >= 0 && t < best) { best = t; bestBox = b; bestAxis = _ray.axis; }
        }
      } else if ((gx < 0 && stepX < 0) || (gz < 0 && stepZ < 0) || (gx >= this.gw && stepX > 0) || (gz >= this.gd && stepZ > 0)) {
        break;
      }
      const tNext = Math.min(tMaxX, tMaxZ);
      if (best <= tNext || tNext > maxDist) break;
      if (tMaxX < tMaxZ) { gx += stepX; tMaxX += tDX; } else { gz += stepZ; tMaxZ += tDZ; }
    }
    if (!bestBox) return null;
    hit.t = best;
    hit.box = bestBox;
    hit.x = ox + dx * best;
    hit.y = oy + dy * best;
    hit.z = oz + dz * best;
    hit.nx = 0; hit.ny = 0; hit.nz = 0;
    if (bestAxis === 0) hit.nx = dx > 0 ? -1 : 1;
    else if (bestAxis === 1) hit.ny = dy > 0 ? -1 : 1;
    else if (bestAxis === 2) hit.nz = dz > 0 ? -1 : 1;
    else { hit.nx = -dx; hit.ny = -dy; hit.nz = -dz; }
    return hit;
  }

  // True when nothing blocks the straight segment a->b.
  lineClear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return true;
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.01, this._lineHit || (this._lineHit = {})) === null;
  }

  // Height of the top-most walkable surface at a column below `fromY`.
  groundHeight(x, z, fromY = 50) {
    const hit = this.raycast(x, fromY, z, 0, -1, 0, fromY + 5, this._gHit || (this._gHit = {}));
    return hit ? hit.y : 0;
  }

  // Is there a roof or floor slab above this point (indoors / underground)?
  coveredAt(x, y, z) {
    return this.cols.coveredAbove(this.cols.cellAt(x, z), y, 40);
  }

  // ------------------------------------------------------------------ rendering
  buildMeshes(tex, nav) {
    const L = this.L;
    const C = this.cols;
    const W = C.W, D = C.D;
    const mats = {};
    const matFor = (name) => {
      if (!mats[name]) {
        const t = tex[name] || tex.sandstone;
        const [rough, metal] = PBR[name] || [0.93, 0];
        mats[name] = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: rough, metalness: metal, vertexColors: true });
      }
      return mats[name];
    };
    this.materials = mats;
    const builders = {};
    const gbFor = (name) => (builders[name] ||= new GeoBuilder());

    for (const b of this.boxes) {
      if (b.kind === 'prop' && b.invisible) continue;
      const look = LOOK[b.mat] || LOOK[MAT.WALL];
      const [x0, y0, z0] = b.min;
      const [x1, y1, z1] = b.max;
      const tint = 0.92 + hash2(Math.floor(x0 * 3), Math.floor(z0 * 7)) * 0.12;
      const gb = gbFor(look.side);
      const topGb = look.top !== look.side ? gbFor(look.top) : null;
      if (b.kind === 'prop') {
        if (look.local) emitBox(gb, x0, y0, z0, x1, y1, z1, { localUV: true, tint: tint * 0.95 });
        else emitBox(gb, x0, y0, z0, x1, y1, z1, { scale: look.scale, tint, topGb });
      } else if (b.kind === 'solid') {
        emitBox(gb, x0, y0, z0, x1, y1, z1, { scale: look.scale, tint, ao: y1 - y0 > 0.4, bottom: false, topGb });
      } else {
        emitBox(gb, x0, y0, z0, x1, y1, z1, { scale: look.scale, tint, ao: false, bottomTint: look.under ?? 0.45, topGb });
      }
    }

    // Ground (y = 0): one quad per merged open area, darker when covered.
    const ground = new GeoBuilder();
    const gTex = (LOOK[L.groundMat ?? MAT.FLOOR] || LOOK[MAT.FLOOR]).top;
    greedy(W, D, (i) => { const l = C.cols[i]; return !(l.length && l[0][0] < 0.001); },
      (i) => (C.coveredAbove(i, 0, 40) ? 1 : 0), (x, z, w, d, i) => {
        const c = C.coveredAbove(i, 0, 40) ? 0.6 : 1;
        const s = 0.25;
        ground.quad([[x, 0, z + d], [x + w, 0, z + d], [x + w, 0, z], [x, 0, z]], [0, 1, 0],
          [[x * s, -(z + d) * s], [(x + w) * s, -(z + d) * s], [(x + w) * s, -z * s], [x * s, -z * s]], [c, c, c, c]);
      });
    if (!ground.empty) (builders[`ground:${gTex}`] = ground).isGround = gTex;

    for (const [name, gb] of Object.entries(builders)) {
      const mesh = new THREE.Mesh(gb.build(), matFor(gb.isGround || name));
      mesh.castShadow = !gb.isGround;
      mesh.receiveShadow = true;
      mesh.name = gb.isGround ? 'ground' : `world-${name}`;
      this.group.add(mesh);
    }

    if (nav) this._buildAO(nav);
    if (L.windows !== false && nav) this._buildWindows(L.windows === 'glass' ? this._glassMaterial() : matFor('shutter'), nav);
    this._buildSiteLetters(tex);
    buildDecor(this, tex);
  }

  _buildAO(nav) {
    const S = this.solidCols;
    const W = S.W, D = S.D;
    const gb = new GeoBuilder(true);
    const occ = (x, z, y) => {
      if (x < 0 || z < 0 || x >= W || z >= D) return true;
      return !S.isFree(z * W + x, y + 0.3, y + 1.2);
    };
    const A = 0.42;
    const w = 0.6;
    for (let n = 0; n < nav.count; n++) {
      if (!nav.reach[n]) continue;
      const i = nav.cell[n];
      const x = i % W, z = (i / W) | 0;
      const fy = nav.y[n];
      const y = fy + 0.012;
      const e = [0, 0, 0, A];
      const o = [0, 0, 0, 0];
      if (occ(x - 1, z, fy)) gb.flat([[x, y, z], [x, y, z + 1], [x + w, y, z + 1], [x + w, y, z]], [e, e, o, o]);
      if (occ(x + 1, z, fy)) gb.flat([[x + 1, y, z], [x + 1, y, z + 1], [x + 1 - w, y, z + 1], [x + 1 - w, y, z]], [e, e, o, o]);
      if (occ(x, z - 1, fy)) gb.flat([[x, y, z], [x + 1, y, z], [x + 1, y, z + w], [x, y, z + w]], [e, e, o, o]);
      if (occ(x, z + 1, fy)) gb.flat([[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z + 1 - w], [x, y, z + 1 - w]], [e, e, o, o]);
    }
    if (gb.empty) return;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, vertexColors: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(gb.build(), mat);
    mesh.renderOrder = 1;
    mesh.name = 'ao';
    this.group.add(mesh);
  }

  _glassMaterial() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#9aa3a8';
    ctx.fillRect(0, 0, 128, 128);
    for (let r = 0; r < 2; r++) {
      for (let k = 0; k < 3; k++) {
        const g = ctx.createLinearGradient(0, r * 64, 0, r * 64 + 60);
        g.addColorStop(0, '#2c3a44');
        g.addColorStop(1, '#4d6270');
        ctx.fillStyle = g;
        ctx.fillRect(6 + k * 41, 6 + r * 61, 34, 55);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.ownTextures.push(t);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.25, metalness: 0.5 });
  }

  // Shuttered windows on tall walls facing open ground.
  _buildWindows(material, nav) {
    const C = this.cols;
    const W = C.W, D = C.D;
    const gb = new GeoBuilder();
    const placed = [];
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    // Floor height of an open-air walkable cell, or -1.
    const skyFloor = (x, z) => {
      if (x < 0 || z < 0 || x >= W || z >= D) return -1;
      const n = nav.topNode(z * W + x);
      if (n < 0 || nav.ceil[n] < 1e5) return -1;
      return nav.y[n];
    };
    const wallOk = (x, z, fy) => {
      if (x < 0 || z < 0 || x >= W || z >= D) return false;
      for (const s of C.cols[z * W + x]) if (WALL_MATS.has(s[2]) && s[0] <= fy + 2.8 && s[1] >= fy + 5.5) return true;
      return false;
    };
    for (let z = 1; z < D - 1; z++) {
      for (let x = 1; x < W - 1; x++) {
        for (let di = 0; di < 4; di++) {
          const [dx, dz] = dirs[di];
          const fy = skyFloor(x + dx, z + dz);
          if (fy < 0 || !wallOk(x, z, fy)) continue;
          if (hash2(x * 7 + di * 131, z * 13 + 5) > 0.06) continue;
          const tx = dz !== 0 ? 1 : 0, tz = dx !== 0 ? 1 : 0;
          if (!wallOk(x + tx, z + tz, fy) || Math.abs(skyFloor(x + tx + dx, z + tz + dz) - fy) > 0.01) continue;
          const cx = dz !== 0 ? x + 1 : (dx > 0 ? x + 1 : x);
          const cz = dx !== 0 ? z + 1 : (dz > 0 ? z + 1 : z);
          if (placed.some((p) => Math.hypot(p[0] - cx, p[1] - cz) < 5)) continue;
          placed.push([cx, cz]);
          const y0 = fy + 2.9, y1 = fy + 4.4, hw = 0.6, t = 0.07;
          if (dz !== 0) {
            const fz = dz > 0 ? z + 1 : z;
            const zz0 = dz > 0 ? fz - 0.02 : fz - t, zz1 = dz > 0 ? fz + t : fz + 0.02;
            emitBox(gb, cx - hw, y0, zz0, cx + hw, y1, zz1, { localUV: true, ao: false });
          } else {
            const fx = dx > 0 ? x + 1 : x;
            const xx0 = dx > 0 ? fx - 0.02 : fx - t, xx1 = dx > 0 ? fx + t : fx + 0.02;
            emitBox(gb, xx0, y0, cz - hw, xx1, y1, cz + hw, { localUV: true, ao: false });
          }
        }
      }
    }
    if (gb.empty) return;
    const mesh = new THREE.Mesh(gb.build(), material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'windows';
    this.group.add(mesh);
  }

  _buildSiteLetters(tex) {
    for (const l of this.L.letters || []) {
      const t = l.letter === 'A' ? tex.letterA : tex.letterB;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(l.size || 2.8, l.size || 2.8), new THREE.MeshStandardMaterial({
        map: t, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1,
      }));
      m.position.set(l.x, l.y, l.z);
      m.rotation.y = l.rotY;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  // Free GPU resources (shared textures stay alive).
  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    for (const t of this.ownTextures) t.dispose();
    this.ownTextures.length = 0;
  }
}
