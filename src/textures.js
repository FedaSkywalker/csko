// Procedural textures (no external assets). Each surface gets a color map and a normal map
// derived from a synthetic height field.
import * as THREE from 'three';
import { makeRng, clamp } from './util.js';

function noiseField(size, cells, rng) {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const iy = Math.floor(fy);
    let ty = fy - iy;
    ty = ty * ty * (3 - 2 * ty);
    const y0 = (iy % cells) * cells;
    const y1 = ((iy + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const ix = Math.floor(fx);
      let tx = fx - ix;
      tx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cells;
      const x1 = (ix + 1) % cells;
      const a = lat[y0 + x0] + (lat[y0 + x1] - lat[y0 + x0]) * tx;
      const b = lat[y1 + x0] + (lat[y1 + x1] - lat[y1 + x0]) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}

function fbm(size, baseCells, octaves, rng, persistence = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const n = noiseField(size, Math.min(cells, size), rng);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= persistence;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

class Surface {
  constructor(size) {
    this.size = size;
    this.r = new Float32Array(size * size);
    this.g = new Float32Array(size * size);
    this.b = new Float32Array(size * size);
    this.h = new Float32Array(size * size);
  }
  set(i, r, g, b, h) {
    this.r[i] = r; this.g[i] = g; this.b[i] = b;
    if (h !== undefined) this.h[i] = h;
  }
  mul(i, k) { this.r[i] *= k; this.g[i] *= k; this.b[i] *= k; }
  colorTexture() {
    const s = this.size;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(s, s);
    const d = img.data;
    for (let i = 0; i < s * s; i++) {
      d[i * 4] = clamp(this.r[i], 0, 255);
      d[i * 4 + 1] = clamp(this.g[i], 0, 255);
      d[i * 4 + 2] = clamp(this.b[i], 0, 255);
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  normalTexture(strength) {
    const s = this.size;
    const H = this.h;
    const data = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) {
      const yu = ((y - 1 + s) % s) * s;
      const yd = ((y + 1) % s) * s;
      const yr = y * s;
      for (let x = 0; x < s; x++) {
        const xl = (x - 1 + s) % s;
        const xr = (x + 1) % s;
        const nx = -(H[yr + xr] - H[yr + xl]) * strength;
        const ny = (H[yd + x] - H[yu + x]) * strength;
        const inv = 1 / Math.hypot(nx, ny, 1);
        // DataTexture rows are bottom-up, so flip the row index to match the canvas color map.
        const o = ((s - 1 - y) * s + x) * 4;
        data[o] = (nx * inv * 0.5 + 0.5) * 255;
        data[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
        data[o + 2] = (inv * 0.5 + 0.5) * 255;
        data[o + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }
}

// Split a row of length total into random pieces that exactly tile.
function splitRow(total, minW, maxW, rng) {
  const widths = [];
  let sum = 0;
  while (sum < total) {
    const w = minW + rng() * (maxW - minW);
    widths.push(w);
    sum += w;
  }
  const k = total / sum;
  return widths.map((w) => w * k);
}

function blockPattern(S, surf, rng, opts) {
  const { rows, minW, maxW, mortar, base, mortarColor, vary } = opts;
  const rowH = S / rows;
  const fine = fbm(S, 64, 3, rng);
  const blockId = new Int32Array(S * S);
  for (let r = 0; r < rows; r++) {
    const widths = splitRow(S, minW, maxW, rng);
    const offset = Math.floor(rng() * S);
    let x0 = 0;
    widths.forEach((w, bi) => {
      const bright = 1 - vary / 2 + rng() * vary;
      const warm = (rng() - 0.5) * 10;
      const id = r * 100 + bi;
      const y0 = Math.floor(r * rowH);
      const y1 = Math.floor((r + 1) * rowH);
      for (let y = y0; y < y1; y++) {
        for (let xx = Math.floor(x0); xx < Math.floor(x0 + w); xx++) {
          const x = (xx + offset) % S;
          const i = y * S + x;
          const ex = Math.min(xx - x0, x0 + w - xx);
          const ey = Math.min(y - y0, y1 - y);
          const e = Math.min(ex, ey);
          blockId[i] = id;
          if (e < mortar) {
            surf.set(i, mortarColor[0], mortarColor[1], mortarColor[2], 0.15 + fine[i] * 0.1);
          } else {
            const bevel = clamp((e - mortar) / 4, 0, 1);
            const n = fine[i];
            surf.set(i, (base[0] + warm) * bright * (0.9 + n * 0.2), base[1] * bright * (0.9 + n * 0.2), (base[2] - warm) * bright * (0.9 + n * 0.2), 0.6 + bevel * 0.35 + n * 0.12);
          }
        }
      }
      x0 += w;
    });
  }
  return blockId;
}

function addPlaster(S, surf, rng, mask, threshold, color) {
  const fine = fbm(S, 32, 4, rng);
  const soft = 0.035;
  for (let i = 0; i < S * S; i++) {
    const m = mask[i];
    if (m <= threshold - soft) continue;
    const n = fine[i];
    const pr = color[0] * (0.93 + n * 0.12), pg = color[1] * (0.93 + n * 0.12), pb = color[2] * (0.93 + n * 0.12);
    const ph = 1.05 + n * 0.05;
    if (m >= threshold + soft) {
      surf.set(i, pr, pg, pb, ph);
    } else {
      // Feathered, slightly shaded edge where plaster has flaked off.
      const t = (m - (threshold - soft)) / (2 * soft);
      const k = t * t * (3 - 2 * t);
      const shade = 0.9 + 0.1 * k;
      surf.set(i, (surf.r[i] * (1 - k) + pr * k) * shade, (surf.g[i] * (1 - k) + pg * k) * shade, (surf.b[i] * (1 - k) + pb * k) * shade, surf.h[i] * (1 - k) + ph * k);
    }
  }
}

function grime(S, surf, rng, amount, cells = 6) {
  const n = fbm(S, cells, 5, rng);
  for (let i = 0; i < S * S; i++) surf.mul(i, 1 - amount + amount * 2 * n[i] * 0.9);
}

function makeSandstone(rng) {
  const S = 512;
  const surf = new Surface(S);
  blockPattern(S, surf, rng, {
    rows: 10, minW: 90, maxW: 170, mortar: 2.5,
    base: [206, 172, 124], mortarColor: [150, 124, 90], vary: 0.16,
  });
  addPlaster(S, surf, rng, fbm(S, 2, 4, rng), 0.6, [214, 188, 146]);
  grime(S, surf, rng, 0.1, 3);
  return surf;
}

function makePlaster(rng) {
  const S = 512;
  const surf = new Surface(S);
  blockPattern(S, surf, rng, {
    rows: 12, minW: 70, maxW: 130, mortar: 2,
    base: [188, 150, 108], mortarColor: [130, 104, 76], vary: 0.2,
  });
  addPlaster(S, surf, rng, fbm(S, 3, 4, rng).map((v) => 1 - v), 0.36, [224, 206, 172]);
  // Cracks
  for (let c = 0; c < 9; c++) {
    let x = rng() * S, y = rng() * S;
    let ang = rng() * Math.PI * 2;
    const len = 40 + rng() * 120;
    for (let k = 0; k < len; k++) {
      ang += (rng() - 0.5) * 0.6;
      x += Math.cos(ang);
      y += Math.sin(ang);
      const i = ((Math.floor(y) + S) % S) * S + ((Math.floor(x) + S) % S);
      surf.mul(i, 0.7);
      surf.h[i] -= 0.25;
    }
  }
  grime(S, surf, rng, 0.1);
  return surf;
}

function makeSand(rng) {
  const S = 512;
  const surf = new Surface(S);
  const n1 = fbm(S, 6, 5, rng);
  const n2 = fbm(S, 48, 3, rng);
  for (let i = 0; i < S * S; i++) {
    const k = 0.84 + n1[i] * 0.22 + n2[i] * 0.08;
    surf.set(i, 200 * k, 168 * k, 118 * k, n1[i] * 0.4 + n2[i] * 0.5);
  }
  for (let p = 0; p < 900; p++) {
    const cx = rng() * S, cy = rng() * S, r = 0.8 + rng() * 3.2;
    const shade = 0.72 + rng() * 0.45;
    for (let y = -4; y <= 4; y++) {
      for (let x = -4; x <= 4; x++) {
        const d = Math.hypot(x, y * 1.2) / r;
        if (d > 1) continue;
        const i = ((Math.floor(cy + y) + S) % S) * S + ((Math.floor(cx + x) + S) % S);
        surf.mul(i, shade);
        surf.h[i] += (1 - d) * 0.8;
      }
    }
  }
  return surf;
}

function makeStoneFloor(rng) {
  const S = 512;
  const surf = new Surface(S);
  blockPattern(S, surf, rng, {
    rows: 5, minW: 80, maxW: 170, mortar: 3.5,
    base: [184, 168, 138], mortarColor: [120, 105, 82], vary: 0.22,
  });
  grime(S, surf, rng, 0.14, 5);
  return surf;
}

function makeCrate(rng) {
  const S = 256;
  const surf = new Surface(S);
  const grain = fbm(S, 16, 3, rng);
  const border = 30;
  const planks = 5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const inFrame = x < border || x >= S - border || y < border || y >= S - border;
      let r, g, b, h;
      // Diagonal brace from bottom-left to top-right.
      const dd = Math.abs((x - (S - y))) / Math.SQRT2;
      const inBrace = !inFrame && dd < 20;
      if (inFrame) {
        const horiz = y < border || y >= S - border;
        const t = horiz ? x : y;
        const gr = Math.sin(t * 0.09 + grain[i] * 9) * 0.5 + 0.5;
        const k = 0.78 + gr * 0.12;
        r = 150 * k; g = 106 * k; b = 60 * k;
        const edge = Math.min(x, y, S - 1 - x, S - 1 - y, Math.abs(x - border), Math.abs(y - border), Math.abs(S - border - x), Math.abs(S - border - y));
        h = 1 - (edge < 2 ? 0.3 : 0);
      } else if (inBrace) {
        const gr = Math.sin((x + y) * 0.07 + grain[i] * 8) * 0.5 + 0.5;
        const k = 0.8 + gr * 0.12;
        r = 156 * k; g = 112 * k; b = 64 * k;
        h = dd > 17 ? 0.7 : 0.9;
      } else {
        const pw = (S - border * 2) / planks;
        const px = (x - border) % pw;
        const pid = Math.floor((x - border) / pw);
        const gr = Math.sin(y * 0.05 + pid * 3 + grain[i] * 12) * 0.5 + 0.5;
        const k = (0.86 + ((pid * 37) % 7) * 0.025) * (0.85 + gr * 0.15);
        r = 176 * k; g = 130 * k; b = 78 * k;
        h = px < 2 || px > pw - 2 ? 0.35 : 0.65;
        if (px < 2 || px > pw - 2) { r *= 0.55; g *= 0.55; b *= 0.55; }
      }
      surf.set(i, r, g, b, h);
    }
  }
  // Nails
  const nail = (cx, cy) => {
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      if (x * x + y * y > 9) continue;
      const i = (cy + y) * S + (cx + x);
      surf.set(i, 60, 55, 50, 1.1);
    }
  };
  [[14, 14], [S - 15, 14], [14, S - 15], [S - 15, S - 15], [S / 2, 14], [S / 2, S - 15], [14, S / 2], [S - 15, S / 2]].forEach(([x, y]) => nail(x | 0, y | 0));
  grime(S, surf, rng, 0.1, 4);
  return surf;
}

function makeMetal(rng) {
  const S = 256;
  const surf = new Surface(S);
  const n = fbm(S, 8, 4, rng);
  const rust = fbm(S, 5, 4, rng);
  for (let i = 0; i < S * S; i++) {
    const k = 0.85 + n[i] * 0.2;
    let r = 74 * k, g = 100 * k, b = 118 * k;
    if (rust[i] > 0.62) {
      const t = clamp((rust[i] - 0.62) * 8, 0, 1);
      r = r * (1 - t) + 128 * t * k; g = g * (1 - t) + 74 * t * k; b = b * (1 - t) + 44 * t * k;
    }
    surf.set(i, r, g, b, 0.5 + n[i] * 0.1 - (rust[i] > 0.62 ? 0.05 : 0));
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (x % 128 < 3 || y % 128 < 3) { const i = y * S + x; surf.mul(i, 0.6); surf.h[i] = 0.2; }
  }
  for (let s = 0; s < 60; s++) {
    let x = rng() * S, y = rng() * S;
    const a = rng() * Math.PI;
    const len = 10 + rng() * 40;
    for (let k = 0; k < len; k++) {
      x += Math.cos(a); y += Math.sin(a);
      const i = ((Math.floor(y) + S) % S) * S + ((Math.floor(x) + S) % S);
      surf.mul(i, 1.35);
    }
  }
  return surf;
}

function makeShutter(rng) {
  const S = 256;
  const surf = new Surface(S);
  const grain = fbm(S, 12, 3, rng);
  const peel = fbm(S, 6, 4, rng);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const frame = x < 18 || x >= S - 18 || y < 18 || y >= S - 18 || Math.abs(x - S / 2) < 6;
      let r = 52, g = 104, b = 108;
      if (peel[i] > 0.6) { r = 150; g = 112; b = 70; }
      const k = 0.85 + grain[i] * 0.2;
      let h = 1;
      if (!frame) {
        const slat = (y - 18) % 20;
        h = 0.4 + (slat / 20) * 0.5;
        const shade = slat < 3 ? 0.35 : 0.75 + (slat / 20) * 0.3;
        r *= shade; g *= shade; b *= shade;
      }
      surf.set(i, r * k, g * k, b * k, h);
    }
  }
  return surf;
}

// Poured concrete: 2 m form panels with seams, tie holes and water streaks.
function makeConcrete(rng) {
  const S = 512;
  const surf = new Surface(S);
  const n1 = fbm(S, 8, 5, rng);
  const n2 = fbm(S, 64, 2, rng);
  const streak = fbm(S, 24, 3, rng);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const k = 0.82 + n1[i] * 0.22 + n2[i] * 0.08;
      // vertical rain streaks
      const st = Math.max(0, streak[(x % S)] - 0.55) * 0.9 * (0.6 + 0.4 * Math.sin(x * 0.37));
      const kk = k * (1 - st * 0.35);
      surf.set(i, 158 * kk, 157 * kk, 152 * kk, 0.55 + n2[i] * 0.2);
      const sx = x % 256, sy = y % 256;
      if (sx < 2 || sy < 2) { surf.mul(i, 0.72); surf.h[i] = 0.2; }
    }
  }
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      for (const [hx, hy] of [[64, 64], [192, 64], [64, 192], [192, 192]]) {
        const cx = px * 256 + hx, cy = py * 256 + hy;
        for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
          const d = Math.hypot(x, y);
          if (d > 4) continue;
          const i = (cy + y) * S + (cx + x);
          surf.mul(i, 0.55 + d * 0.08);
          surf.h[i] = 0.1 + d * 0.1;
        }
      }
    }
  }
  grime(S, surf, rng, 0.12, 4);
  return surf;
}

function makeAsphalt(rng) {
  const S = 512;
  const surf = new Surface(S);
  const n1 = fbm(S, 6, 5, rng);
  const n2 = fbm(S, 96, 2, rng);
  for (let i = 0; i < S * S; i++) {
    const k = 0.78 + n1[i] * 0.3 + (n2[i] - 0.5) * 0.25;
    surf.set(i, 78 * k, 78 * k, 80 * k, n2[i] * 0.6 + n1[i] * 0.2);
  }
  for (let p = 0; p < 2600; p++) {
    const i = Math.floor(rng() * S * S);
    const b = 1.25 + rng() * 0.5;
    surf.mul(i, b);
    surf.h[i] += 0.3;
  }
  for (let c = 0; c < 7; c++) {
    let x = rng() * S, y = rng() * S;
    let ang = rng() * Math.PI * 2;
    const len = 60 + rng() * 160;
    for (let k = 0; k < len; k++) {
      ang += (rng() - 0.5) * 0.5;
      x += Math.cos(ang);
      y += Math.sin(ang);
      const i = ((Math.floor(y) + S) % S) * S + ((Math.floor(x) + S) % S);
      surf.mul(i, 0.55);
      surf.h[i] -= 0.35;
    }
  }
  return surf;
}

// Industrial floor tiles, 0.5 m.
function makeTiles(rng) {
  const S = 512;
  const surf = new Surface(S);
  const fine = fbm(S, 48, 3, rng);
  const T = 64;
  const shade = [];
  for (let k = 0; k < 64; k++) shade.push(0.9 + rng() * 0.12);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const tx = Math.floor(x / T), ty = Math.floor(y / T);
      const k = shade[(tx * 7 + ty * 3) % 64] * (0.94 + fine[i] * 0.1);
      const gx = x % T, gy = y % T;
      const grout = gx < 2 || gy < 2;
      if (grout) surf.set(i, 92, 92, 90, 0.2);
      else {
        const bevel = Math.min(gx - 2, gy - 2, T - 1 - gx, T - 1 - gy);
        surf.set(i, 176 * k, 178 * k, 176 * k, 0.7 + Math.min(1, bevel / 3) * 0.25);
      }
    }
  }
  grime(S, surf, rng, 0.16, 5);
  return surf;
}

// Corrugated shipping-container steel.
function makeContainer(rng, base) {
  const S = 256;
  const surf = new Surface(S);
  const n = fbm(S, 8, 4, rng);
  const rust = fbm(S, 6, 4, rng);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const ridge = Math.sin((x / 16) * Math.PI * 2);
      const k = (0.85 + n[i] * 0.2) * (0.86 + ridge * 0.12);
      let r = base[0] * k, g = base[1] * k, b = base[2] * k;
      const edge = Math.min(y, S - 1 - y) / S;
      const rr = rust[i] + (edge < 0.08 ? 0.2 : 0);
      if (rr > 0.66) {
        const t = clamp((rr - 0.66) * 6, 0, 1);
        r = r * (1 - t) + 110 * t * k; g = g * (1 - t) + 62 * t * k; b = b * (1 - t) + 36 * t * k;
      }
      surf.set(i, r, g, b, 0.5 + ridge * 0.35);
    }
  }
  grime(S, surf, rng, 0.1, 4);
  return surf;
}

// Diamond-plate steel for catwalks and railings.
function makeGrate(rng) {
  const S = 256;
  const surf = new Surface(S);
  const n = fbm(S, 8, 4, rng);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const k = 0.8 + n[i] * 0.25;
      surf.set(i, 118 * k, 121 * k, 124 * k, 0.4);
    }
  }
  // Staggered raised diamonds (lugs).
  const step = 32;
  for (let gy = 0; gy < S / step; gy++) {
    for (let gx = 0; gx < S / step; gx++) {
      const cx = gx * step + (gy % 2) * (step / 2), cy = gy * step + step / 2;
      const ang = (gx + gy) % 2 ? Math.PI / 4 : -Math.PI / 4;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let y = -12; y <= 12; y++) {
        for (let x = -12; x <= 12; x++) {
          const u = x * ca + y * sa, v = -x * sa + y * ca;
          const d = Math.abs(u) / 11 + Math.abs(v) / 3;
          if (d > 1) continue;
          const i = ((cy + y + S) % S) * S + ((cx + x + S) % S);
          surf.h[i] = 0.4 + (1 - d) * 0.6;
          surf.mul(i, 1.1 + (1 - d) * 0.15);
        }
      }
    }
  }
  grime(S, surf, rng, 0.12, 4);
  return surf;
}

function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function bulletHole() {
  return canvasTex(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(10,8,6,1)');
    g.addColorStop(0.22, 'rgba(20,16,12,0.95)');
    g.addColorStop(0.32, 'rgba(60,50,40,0.7)');
    g.addColorStop(0.6, 'rgba(90,76,60,0.25)');
    g.addColorStop(1, 'rgba(90,76,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(30,24,18,0.6)';
    ctx.lineWidth = 1;
    for (let k = 0; k < 7; k++) {
      const a = Math.random() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(s / 2 + Math.cos(a) * 6, s / 2 + Math.sin(a) * 6);
      ctx.lineTo(s / 2 + Math.cos(a) * (12 + Math.random() * 12), s / 2 + Math.sin(a) * (12 + Math.random() * 12));
      ctx.stroke();
    }
  });
}

function muzzleFlash() {
  return canvasTex(128, (ctx, s) => {
    ctx.translate(s / 2, s / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
    g.addColorStop(0, 'rgba(255,250,220,1)');
    g.addColorStop(0.15, 'rgba(255,220,120,0.95)');
    g.addColorStop(0.45, 'rgba(255,140,40,0.45)');
    g.addColorStop(1, 'rgba(255,90,10,0)');
    ctx.fillStyle = g;
    for (let k = 0; k < 7; k++) {
      ctx.rotate((Math.PI * 2) / 7);
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(0, -s / 2 * (0.7 + Math.random() * 0.3));
      ctx.lineTo(7, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
  });
}

function smokeTex(rng) {
  const S = 128;
  const n = fbm(S, 4, 4, rng);
  return canvasTex(S, (ctx) => {
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const d = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
      const a = clamp((1 - d) * 1.6, 0, 1) * (0.55 + n[i] * 0.6);
      img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = clamp(a * a * 255, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
  }, false);
}

function siteLetter(letter) {
  return canvasTex(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.font = 'bold 200px Impact, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(200,60,30,0.85)';
    ctx.fillText(letter, s / 2, s / 2 + 10);
    // drips
    ctx.fillStyle = 'rgba(190,55,28,0.7)';
    for (let k = 0; k < 6; k++) {
      const x = s * 0.3 + Math.random() * s * 0.4;
      ctx.fillRect(x, s * 0.72, 3, 10 + Math.random() * 40);
    }
  });
}

function keypad() {
  return canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#6f8f3f';
    ctx.fillRect(10, 8, s - 20, 26);
    ctx.fillStyle = '#122';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('7355608', 18, 28);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
      ctx.fillStyle = '#bbb';
      ctx.fillRect(18 + c * 32, 44 + r * 20, 24, 14);
    }
  });
}

export function createTextures(renderer) {
  const rng = makeRng(1337);
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const out = {};
  const finish = (surf, strength) => {
    const map = surf.colorTexture();
    const normal = surf.normalTexture(strength);
    for (const t of [map, normal]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
    }
    return { map, normal };
  };
  const surfaces = {
    sandstone: [makeSandstone(rng), 4],
    plaster: [makePlaster(rng), 3],
    sand: [makeSand(rng), 3],
    stone: [makeStoneFloor(rng), 4],
    crate: [makeCrate(rng), 3],
    metal: [makeMetal(rng), 3],
    shutter: [makeShutter(rng), 3],
  };
  for (const [name, [surf, strength]] of Object.entries(surfaces)) out[name] = finish(surf, strength);
  // Surfaces only some maps use are generated on first access.
  const lazy = {
    concrete: () => finish(makeConcrete(makeRng(501)), 3),
    asphalt: () => finish(makeAsphalt(makeRng(502)), 2.5),
    tiles: () => finish(makeTiles(makeRng(503)), 3),
    containerRed: () => finish(makeContainer(makeRng(504), [150, 52, 38]), 3),
    containerBlue: () => finish(makeContainer(makeRng(505), [44, 86, 132]), 3),
    grate: () => finish(makeGrate(makeRng(506)), 3),
  };
  for (const [name, make] of Object.entries(lazy)) {
    let v = null;
    Object.defineProperty(out, name, { enumerable: true, get: () => (v ||= make()) });
  }
  out.bulletHole = bulletHole();
  out.muzzle = muzzleFlash();
  out.smoke = smokeTex(rng);
  out.letterA = siteLetter('A');
  out.letterB = siteLetter('B');
  out.keypad = keypad();
  return out;
}
