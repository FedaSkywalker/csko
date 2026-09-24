// Bot navigation on multi-level maps. Every walkable surface of a 1 m column is a node (so a cell
// can hold a bombsite floor and another floor stacked above it). Nodes link to their 8 neighbours
// when the height difference is walkable (step up, short drop), plus explicit one-way drop links
// (hatches, vents). A* over that graph, then line-of-walk smoothing that stays on one floor.
import { MOVE } from '../config.js';

const STEP = MOVE.stepHeight;
const MAX_DROP = 1.5;
const CLEAR = 2.0; // headroom needed to stand on a surface
const BODY = MOVE.standHeight;
const SQRT2 = Math.SQRT2;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

class MinHeap {
  constructor(cap) {
    this.items = new Int32Array(cap);
    this.prio = new Float64Array(cap);
    this.size = 0;
  }
  clear() { this.size = 0; }
  push(item, p) {
    if (this.size >= this.items.length) {
      const ni = new Int32Array(this.items.length * 2);
      ni.set(this.items);
      const np = new Float64Array(this.prio.length * 2);
      np.set(this.prio);
      this.items = ni;
      this.prio = np;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= p) break;
      this.items[i] = this.items[parent];
      this.prio[i] = this.prio[parent];
      i = parent;
    }
    this.items[i] = item;
    this.prio[i] = p;
  }
  pop() {
    const top = this.items[0];
    const lastItem = this.items[--this.size];
    const lastP = this.prio[this.size];
    let i = 0;
    const n = this.size;
    while (true) {
      let c = i * 2 + 1;
      if (c >= n) break;
      if (c + 1 < n && this.prio[c + 1] < this.prio[c]) c++;
      if (this.prio[c] >= lastP) break;
      this.items[i] = this.items[c];
      this.prio[i] = this.prio[c];
      i = c;
    }
    this.items[i] = lastItem;
    this.prio[i] = lastP;
    return top;
  }
}

export class NavGrid {
  constructor(layout, world) {
    this.L = layout;
    const S = world.solidCols;
    const W = (this.W = S.W);
    const D = (this.D = S.D);
    const N = W * D;

    // Nodes, sorted by height inside each cell.
    const first = new Int32Array(N + 1);
    const ys = [], ceils = [], cells = [];
    for (let i = 0; i < N; i++) {
      first[i] = ys.length;
      for (const s of S.surfaces(i, CLEAR)) {
        ys.push(s.y);
        ceils.push(s.ceil);
        cells.push(i);
      }
    }
    first[N] = ys.length;
    const M = (this.count = ys.length);
    this.first = first;
    this.y = Float32Array.from(ys);
    this.ceil = Float32Array.from(ceils);
    this.cell = Int32Array.from(cells);

    // Walking links to the 8 neighbours.
    this.adj = new Int32Array(M * 8).fill(-1);
    for (let n = 0; n < M; n++) {
      const i = this.cell[n];
      const x = i % W, z = (i / W) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DIRS[k][0], nz = z + DIRS[k][1];
        if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
        const m = this._stepTo(n, nz * W + nx);
        if (m < 0) continue;
        if (k >= 4 && (this._level(z * W + nx, this.y[n]) < 0 || this._level(nz * W + x, this.y[n]) < 0)) continue;
        this.adj[n * 8 + k] = m;
      }
    }

    // One-way drop links authored by the map (hatch, vents).
    this.extra = new Map();
    for (const l of layout.navLinks || []) {
      const a = this.nodeAt(l.from[0], l.from[1], l.from[2]);
      const b = this.nodeAt(l.to[0], l.to[1], l.to[2]);
      if (a < 0 || b < 0 || a === b) continue;
      if (!this.extra.has(a)) this.extra.set(a, []);
      this.extra.get(a).push(b);
    }

    // Only surfaces reachable from the spawns count (drops wall tops, crate tops, roofs).
    this.reach = new Uint8Array(M);
    const stack = [];
    for (const team of ['T', 'CT']) {
      for (const sp of layout.spawns[team]) {
        const n = this.nodeAt(sp.x, sp.y ?? 0, sp.z);
        if (n >= 0 && !this.reach[n]) { this.reach[n] = 1; stack.push(n); }
      }
    }
    while (stack.length) {
      const n = stack.pop();
      for (let k = 0; k < 8; k++) {
        const m = this.adj[n * 8 + k];
        if (m >= 0 && !this.reach[m]) { this.reach[m] = 1; stack.push(m); }
      }
      const ex = this.extra.get(n);
      if (ex) for (const m of ex) if (!this.reach[m]) { this.reach[m] = 1; stack.push(m); }
    }

    // Penalize nodes hugging walls or ledges so bots walk mid-corridor.
    this.cost = new Float32Array(M);
    for (let n = 0; n < M; n++) {
      if (!this.reach[n]) continue;
      const i = this.cell[n];
      const x = i % W, z = (i / W) | 0;
      let near = 3;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dz) continue;
          const nx = x + dx, nz = z + dz;
          const blocked = nx < 0 || nz < 0 || nx >= W || nz >= D || this._level(nz * W + nx, this.y[n], true) < 0;
          if (blocked) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dz)));
        }
      }
      this.cost[n] = 1 + (near === 1 ? 2.5 : near === 2 ? 0.6 : 0);
    }

    this.g = new Float32Array(M);
    this.parent = new Int32Array(M);
    this.seen = new Uint32Array(M);
    this.closed = new Uint32Array(M);
    this.sid = 0;
    this.heap = new MinHeap(1024);
  }

  // Node of cell j that node n can walk onto (step up, or drop a little), or -1.
  _stepTo(n, j) {
    const y = this.y[n], c = this.ceil[n];
    let best = -1, bd = Infinity;
    for (let m = this.first[j]; m < this.first[j + 1]; m++) {
      const dy = this.y[m] - y;
      if (dy > STEP || dy < -MAX_DROP) continue;
      if (dy > 0 && this.y[m] + BODY > c) continue; // no room to step up under our own ceiling
      if (dy < 0 && y + BODY > this.ceil[m]) continue; // no room to walk over into the lower cell
      const a = Math.abs(dy);
      if (a < bd) { bd = a; best = m; }
    }
    return best;
  }

  // Node of cell j at about height y (within a step), or -1.
  _level(j, y, reachOnly = false) {
    for (let m = this.first[j]; m < this.first[j + 1]; m++) {
      if (Math.abs(this.y[m] - y) <= STEP && (!reachOnly || this.reach[m])) return m;
    }
    return -1;
  }

  cellOf(x, z) {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.D) return -1;
    return cz * this.W + cx;
  }

  // The surface under a point: highest node at or a bit above y (feet may sink into stairs).
  nodeAt(x, y, z) {
    const i = this.cellOf(x, z);
    if (i < 0) return -1;
    const a = this.first[i], b = this.first[i + 1];
    if (a === b) return -1;
    let best = a;
    for (let m = a; m < b; m++) if (this.y[m] <= y + 0.6) best = m;
    return best;
  }

  // Highest reachable node of a cell, or -1.
  topNode(i) {
    for (let m = this.first[i + 1] - 1; m >= this.first[i]; m--) if (this.reach[m]) return m;
    return -1;
  }

  isWalkable(x, z, y) {
    const n = y === undefined ? this.topNode(this.cellOf(x, z)) : this.nodeAt(x, y, z);
    return n >= 0 && !!this.reach[n];
  }

  // Closest reachable node, preferring the same floor as y.
  nearest(x, y, z, maxR = 8) {
    const n = this.nodeAt(x, y, z);
    if (n >= 0 && this.reach[n] && Math.abs(this.y[n] - y) < 2.5) return n;
    const cx = Math.floor(x), cz = Math.floor(z);
    let best = -1, bestS = Infinity;
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= this.W || nz >= this.D) continue;
          const i = nz * this.W + nx;
          for (let m = this.first[i]; m < this.first[i + 1]; m++) {
            if (!this.reach[m]) continue;
            const dy = (this.y[m] - y) * 2;
            const s = dx * dx + dz * dz + dy * dy;
            if (s < bestS) { bestS = s; best = m; }
          }
        }
      }
      if (best >= 0 && bestS <= (r + 1) * (r + 1)) return best;
    }
    return best;
  }

  nearestWalkable(x, z, maxR = 8, y = 0) {
    return this.nearest(x, y, z, maxR);
  }

  center(n) {
    const i = this.cell[n];
    return { x: (i % this.W) + 0.5, y: this.y[n], z: ((i / this.W) | 0) + 0.5 };
  }

  findPath(sx, sy, sz, tx, ty, tz) {
    const s = this.nearest(sx, sy, sz);
    const t = this.nearest(tx, ty ?? sy, tz);
    if (s < 0 || t < 0) return null;
    if (s === t) return [this.center(t)];
    const W = this.W;
    const id = ++this.sid;
    const heap = this.heap;
    heap.clear();
    const tc = this.cell[t];
    const txc = tc % W, tzc = (tc / W) | 0;
    const heur = (n) => {
      const c = this.cell[n];
      const dx = Math.abs((c % W) - txc), dz = Math.abs(((c / W) | 0) - tzc);
      return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz);
    };
    const relax = (cur, m, step) => {
      if (this.closed[m] === id) return;
      const ng = this.g[cur] + step * this.cost[m];
      if (this.seen[m] !== id || ng < this.g[m]) {
        this.seen[m] = id;
        this.g[m] = ng;
        this.parent[m] = cur;
        heap.push(m, ng + heur(m));
      }
    };
    this.g[s] = 0;
    this.seen[s] = id;
    this.parent[s] = -1;
    heap.push(s, heur(s));
    let found = false;
    let expansions = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === id) continue;
      this.closed[cur] = id;
      if (cur === t) { found = true; break; }
      if (++expansions > 30000) break;
      for (let k = 0; k < 8; k++) {
        const m = this.adj[cur * 8 + k];
        if (m >= 0) relax(cur, m, k >= 4 ? SQRT2 : 1);
      }
      const ex = this.extra.get(cur);
      if (ex) {
        const c = this.cell[cur];
        for (const m of ex) {
          const mc = this.cell[m];
          const dx = Math.abs((mc % W) - (c % W)), dz = Math.abs(((mc / W) | 0) - ((c / W) | 0));
          relax(cur, m, Math.max(1, dx + dz + (SQRT2 - 2) * Math.min(dx, dz)) + 1);
        }
      }
    }
    if (!found) return null;
    const nodes = [];
    for (let c = t; c !== -1; c = this.parent[c]) nodes.push(c);
    nodes.reverse();
    return this.smooth(nodes.map((n) => this.center(n)));
  }

  // Can an agent at (ax, ay, az) walk straight to (bx, bz) without clipping walls, climbing more
  // than a step or dropping off a ledge? Stays on one floor; `by` must match where it ends up.
  lineWalkable(ax, ay, az, bx, bz, by) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 0.25));
    const r = 0.42;
    const start = this.nodeAt(ax, ay, az);
    if (start < 0 || !this.reach[start]) return false;
    let hy = this.y[start];
    let cell = this.cell[start];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = ax + dx * t, z = az + dz * t;
      const c = this.cellOf(x, z);
      if (c < 0) return false;
      if (c !== cell) {
        let m = -1, bd = Infinity;
        for (let k = this.first[c]; k < this.first[c + 1]; k++) {
          if (!this.reach[k]) continue;
          const d = this.y[k] - hy;
          if (d > STEP || d < -0.3) continue; // don't smooth across drops, follow stairs instead
          if (Math.abs(d) < bd) { bd = Math.abs(d); m = k; }
        }
        if (m < 0) return false;
        hy = this.y[m];
        cell = c;
      }
      for (let k = 0; k < 4; k++) {
        const cc = this.cellOf(x + (k & 1 ? r : -r), z + (k & 2 ? r : -r));
        if (cc < 0 || this._level(cc, hy, true) < 0) return false;
      }
    }
    return by === undefined || Math.abs(hy - by) < 0.6;
  }

  smooth(points) {
    if (points.length <= 2) return points;
    const out = [points[0]];
    let i = 0;
    while (i < points.length - 1) {
      let j = Math.min(points.length - 1, i + 40);
      const a = points[i];
      while (j > i + 1 && !this.lineWalkable(a.x, a.y, a.z, points[j].x, points[j].z, points[j].y)) j--;
      out.push(points[j]);
      i = j;
    }
    return out;
  }

  // Random open (not wall-hugging) reachable spot inside a rectangle, honouring its y0/y1 band.
  randomPointIn(rect, tries = 30) {
    for (let k = 0; k < tries; k++) {
      const x = rect.x0 + Math.random() * (rect.x1 - rect.x0);
      const z = rect.z0 + Math.random() * (rect.z1 - rect.z0);
      const c = this.cellOf(x, z);
      if (c < 0) continue;
      for (let m = this.first[c]; m < this.first[c + 1]; m++) {
        if (!this.reach[m] || this.cost[m] > 1.7) continue;
        const y = this.y[m];
        if (rect.y0 !== undefined && y < rect.y0) continue;
        if (rect.y1 !== undefined && y >= rect.y1) continue;
        return this.center(m);
      }
    }
    return null;
  }
}
