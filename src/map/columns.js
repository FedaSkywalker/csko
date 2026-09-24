// Column map: every 1 m cell holds a sorted list of solid vertical spans [y0, y1, mat].
// Floors are the tops of spans (or the ground at y = 0), so maps can have rooms stacked on top of
// each other (e.g. a bombsite directly above another one).
export const SKY = 60;

function mergeList(list) {
  list.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const s of list) {
    if (s[1] - s[0] < 1e-6) continue;
    const last = out[out.length - 1];
    if (last && last[2] === s[2] && Math.abs(last[1] - s[0]) < 1e-6) last[1] = s[1];
    else out.push([s[0], s[1], s[2]]);
  }
  return out;
}

function cutList(list, y0, y1) {
  const out = [];
  for (const s of list) {
    if (s[1] <= y0 || s[0] >= y1) { out.push(s); continue; }
    if (s[0] < y0) out.push([s[0], y0, s[2]]);
    if (s[1] > y1) out.push([y1, s[1], s[2]]);
  }
  return out;
}

export class Columns {
  constructor(W, D) {
    this.W = W;
    this.D = D;
    this.cols = new Array(W * D);
    for (let i = 0; i < this.cols.length; i++) this.cols[i] = [];
  }

  idx(x, z) { return z * this.W + x; }

  inBounds(x, z) { return x >= 0 && z >= 0 && x < this.W && z < this.D; }

  cellAt(x, z) {
    const cx = Math.floor(x), cz = Math.floor(z);
    return this.inBounds(cx, cz) ? cz * this.W + cx : -1;
  }

  each(x0, z0, x1, z1, fn) {
    const ax = Math.max(0, Math.floor(x0)), az = Math.max(0, Math.floor(z0));
    const bx = Math.min(this.W, Math.ceil(x1)), bz = Math.min(this.D, Math.ceil(z1));
    for (let z = az; z < bz; z++) for (let x = ax; x < bx; x++) fn(z * this.W + x, x, z);
  }

  // Add solid (overrides whatever was there in that height range).
  solid(x0, z0, x1, z1, y0, y1, mat) {
    this.each(x0, z0, x1, z1, (i) => {
      const l = cutList(this.cols[i], y0, y1);
      l.push([y0, y1, mat]);
      this.cols[i] = mergeList(l);
    });
  }

  // Remove solid in a height range (carve rooms, doors, holes).
  air(x0, z0, x1, z1, y0, y1 = SKY) {
    this.each(x0, z0, x1, z1, (i) => { this.cols[i] = cutList(this.cols[i], y0, y1); });
  }

  // Change the material of existing solid in a height range.
  paint(x0, z0, x1, z1, y0, y1, mat) {
    this.each(x0, z0, x1, z1, (i) => {
      const out = [];
      for (const s of this.cols[i]) {
        if (s[1] <= y0 || s[0] >= y1) { out.push(s); continue; }
        if (s[0] < y0) out.push([s[0], y0, s[2]]);
        out.push([Math.max(s[0], y0), Math.min(s[1], y1), mat]);
        if (s[1] > y1) out.push([y1, s[1], s[2]]);
      }
      this.cols[i] = mergeList(out);
    });
  }

  // Stairs/ramp: along `axis` the floor goes linearly from hStart (first row) to hEnd (last row).
  // Each row becomes solid from `base` up to its floor height; `headroom` (optional) clears the air above.
  stairs(x0, z0, x1, z1, axis, hStart, hEnd, { base = 0, headroom = 0, mat } = {}) {
    const n = axis === 'x' ? x1 - x0 : z1 - z0;
    const rows = [];
    for (let k = 0; k < n; k++) rows.push(hStart + (hEnd - hStart) * (n > 1 ? k / (n - 1) : 0));
    this.each(x0, z0, x1, z1, (i, x, z) => {
      const h = rows[axis === 'x' ? x - x0 : z - z0];
      let l = cutList(this.cols[i], base, headroom ? h + headroom : h);
      if (h > base) l.push([base, h, mat]);
      this.cols[i] = mergeList(l);
    });
    return rows;
  }

  clone() {
    const c = new Columns(this.W, this.D);
    for (let i = 0; i < this.cols.length; i++) c.cols[i] = this.cols[i].map((s) => s.slice());
    return c;
  }

  // Walkable surfaces of a cell: tops of spans (or the ground) with at least `clear` metres of headroom.
  surfaces(i, clear = 1.85) {
    const list = this.cols[i];
    const out = [];
    const first = list.length ? list[0][0] : Infinity;
    if (first >= clear && !(list.length && list[0][0] <= 0)) out.push({ y: 0, ceil: first, mat: -1 });
    for (let k = 0; k < list.length; k++) {
      const top = list[k][1];
      const next = k + 1 < list.length ? list[k + 1][0] : Infinity;
      if (next - top >= clear) out.push({ y: top, ceil: next, mat: list[k][2] });
    }
    return out;
  }

  isFree(i, y0, y1) {
    for (const s of this.cols[i]) if (s[0] < y1 && s[1] > y0) return false;
    return true;
  }

  // Is there anything overhead between y and y + range (roofed / indoor)?
  coveredAbove(i, y, range = 12) {
    if (i < 0) return false;
    for (const s of this.cols[i]) if (s[0] >= y && s[0] < y + range) return true;
    return false;
  }

  // Floor height under a point: the highest surface at or below y (or the lowest surface).
  floorAt(x, z, y) {
    const i = this.cellAt(x, z);
    if (i < 0) return 0;
    const surf = this.surfaces(i);
    if (!surf.length) return 0;
    if (y === undefined) return surf[0].y;
    let best = surf[0].y;
    for (const s of surf) if (s.y <= y + 0.6) best = s.y;
    return best;
  }
}
