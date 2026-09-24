// "Dustline" – a desert map loosely inspired by classic bomb-defusal layouts.
// Authored on a 1 m grid by carving floors out of solid wall, plus explicit crate props.
// Coordinates: x grows east, z grows south (north = -Z, where yaw 0 looks).
import { hash2 } from '../../util.js';
import { MAT } from '../materials.js';
import { Columns } from '../columns.js';

const W = 100;
const D = 110;
const WALL_HEIGHTS = [6, 7, 7.5, 8.5, 9.5];

function wallHeight(x, z) {
  if (x < 2 || z < 2 || x >= W - 2 || z >= D - 2) return 10;
  const r = hash2(Math.floor(x / 12), Math.floor(z / 12));
  return WALL_HEIGHTS[Math.floor(r * WALL_HEIGHTS.length)];
}

function wallMat(x, z) {
  return hash2(Math.floor(x / 12) + 71, Math.floor(z / 12) + 13) < 0.35 ? MAT.WALL2 : MAT.WALL;
}

export function buildDustline() {
  const N = W * D;
  const h = new Float32Array(N);
  const ceil = new Float32Array(N);
  const roof = new Float32Array(N);
  const mat = new Uint8Array(N);
  const solid = new Uint8Array(N);
  const blocked = new Uint8Array(N); // nav blockers (crates/props)
  const props = [];

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      solid[i] = 1;
      h[i] = wallHeight(x, z);
      mat[i] = wallMat(x, z);
    }
  }

  const each = (x0, z0, x1, z1, fn) => {
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) fn(z * W + x, x, z);
  };

  // Carve walkable floor. height > 0 makes a stone platform.
  function floor(x0, z0, x1, z1, height = 0, opts = {}) {
    each(x0, z0, x1, z1, (i) => {
      solid[i] = 0;
      h[i] = height;
      mat[i] = height > 0 ? (opts.mat ?? MAT.STONE) : MAT.FLOOR;
      ceil[i] = opts.ceil || 0;
      roof[i] = opts.roof || 0;
    });
  }

  function wall(x0, z0, x1, z1, height, m) {
    each(x0, z0, x1, z1, (i, x, z) => {
      solid[i] = 1;
      h[i] = height ?? wallHeight(x, z);
      mat[i] = m ?? wallMat(x, z);
      ceil[i] = 0;
      roof[i] = 0;
    });
  }

  // Linear stairs along an axis: first row gets hStart, last row gets hEnd.
  function stairs(x0, z0, x1, z1, axis, hStart, hEnd, opts = {}) {
    const n = axis === 'x' ? x1 - x0 : z1 - z0;
    each(x0, z0, x1, z1, (i, x, z) => {
      const k = axis === 'x' ? x - x0 : z - z0;
      const t = n > 1 ? k / (n - 1) : 0;
      solid[i] = 0;
      h[i] = hStart + (hEnd - hStart) * t;
      mat[i] = MAT.STONE;
      ceil[i] = opts.ceil || 0;
      roof[i] = opts.roof || 0;
    });
  }

  const floorHeight = (x, z) => h[Math.floor(z) * W + Math.floor(x)];

  // Crate prop (cube). Stacks on whatever floor/prop top is given as y0.
  function crate(x, z, size = 1, y0) {
    const base = y0 ?? floorHeight(x, z);
    props.push({ min: [x + 0.02, base, z + 0.02], max: [x + size - 0.02, base + size, z + size - 0.02], mat: MAT.CRATE });
    each(x, z, x + size, z + size, (i) => { blocked[i] = 1; });
    return base + size;
  }

  function block(x0, z0, x1, z1, height, m, y0) {
    const base = y0 ?? floorHeight(x0, z0);
    props.push({ min: [x0, base, z0], max: [x1, base + height, z1], mat: m });
    each(Math.floor(x0), Math.floor(z0), Math.ceil(x1), Math.ceil(z1), (i) => { blocked[i] = 1; });
  }

  // ---------------- T side ----------------
  floor(36, 90, 66, 106); // T spawn
  floor(46, 82, 53, 90); // top mid connector ("suicide")
  wall(46, 92, 53, 95); // blocks the mid sightline into T spawn

  // ---------------- Mid ----------------
  floor(44, 32, 54, 84);
  wall(44, 64, 46, 68); // side notch
  wall(52, 38, 54, 42);
  floor(47, 28, 51, 32); // mid doors
  floor(38, 20, 60, 28); // CT mid
  wall(45, 20, 53, 23); // building blocking the mid-doors sightline into CT spawn

  // ---------------- Turkish Kebab (restaurant off mid, fried cheese heals) ----------------
  floor(55, 55, 62, 62, 0, { ceil: 3.3, roof: 4.8 }); // dining room
  floor(54, 56, 55, 60, 0, { ceil: 3.3, roof: 4.8 }); // entrance from mid

  // ---------------- CT spawn ----------------
  floor(40, 4, 62, 20);

  // ---------------- A side ----------------
  floor(66, 88, 82, 100); // outside long
  floor(72, 78, 76, 88, 0, { ceil: 3.4, roof: 6 }); // long doors (covered passage)
  floor(70, 62, 96, 78); // long corner
  floor(82, 28, 96, 62); // long A
  stairs(82, 24, 96, 28, 'z', 0.8, 0.2); // ramp up to site
  floor(66, 4, 96, 24, 1.0); // A site platform
  wall(92, 4, 96, 8, 7); // goose corner
  wall(72, 19, 75, 20, 2.1); // low cover wall on site
  stairs(62, 8, 66, 16, 'x', 0.2, 0.8); // CT ramp
  floor(62, 16, 66, 22, 1.0); // short landing
  floor(54, 44, 58, 50); // lower catwalk
  stairs(58, 44, 62, 50, 'x', 0.25, 1.0);
  floor(62, 22, 66, 50, 1.25); // catwalk

  // ---------------- B side ----------------
  floor(4, 6, 32, 38); // B site
  floor(4, 6, 14, 14, 1.0); // B platform
  stairs(4, 14, 14, 17, 'z', 0.75, 0.25);
  wall(15, 26, 17, 28); // pillar
  floor(32, 20, 38, 26); // B doors
  floor(20, 38, 24, 44, 0, { ceil: 3.2, roof: 4.5 }); // tunnel exit
  floor(16, 44, 28, 64, 0, { ceil: 3.5, roof: 5 }); // B tunnels
  wall(21, 52, 23, 54);
  floor(21, 64, 27, 92, 0, { ceil: 3.5, roof: 5 }); // upper tunnels N-S
  floor(21, 92, 36, 100, 0, { ceil: 3.5, roof: 5 }); // upper tunnels E-W
  floor(27, 70, 44, 76, 0, { ceil: 3.2, roof: 4.5 }); // lower tunnels

  // ---------------- Props ----------------
  crate(38, 91, 2); crate(40, 91, 1); crate(63, 103, 2); crate(62, 104, 1);
  crate(36, 104, 1); crate(58, 91, 1);
  crate(48, 60, 2); crate(50, 61, 1); // mid box
  crate(79, 97, 2); crate(78, 98, 1);
  crate(92, 64, 2); crate(91, 66, 1);
  block(86, 32, 89.6, 34, 1.3, MAT.METAL); // wrecked car
  const a1 = crate(76, 10, 2); crate(78, 11, 1); crate(77, 10, 1, a1);
  crate(88, 15, 1); crate(70, 6, 2);
  crate(42, 5, 2); crate(58, 17, 1); crate(40, 21, 1);
  const b1 = crate(18, 14, 2); crate(20, 15, 1); crate(18, 14, 1, b1);
  crate(10, 24, 1); crate(11, 24, 1);
  crate(24, 30, 2); crate(26, 11, 1); crate(27, 11, 1);
  crate(22, 80, 1);
  crate(33, 72, 1);
  // Kebab counter: collision only, the restaurant decor draws it.
  props.push({ min: [60.2, 0, 55.2], max: [61.95, 1.05, 61.8], mat: MAT.WOOD, invisible: true });
  each(60, 55, 62, 62, (i) => { blocked[i] = 1; });
  // Tables: collision only, the restaurant decor draws them.
  const table = (x0, z0) => {
    props.push({ min: [x0, 0, z0], max: [x0 + 1, 0.76, z0 + 1], mat: MAT.WOOD, invisible: true });
    each(Math.floor(x0), Math.floor(z0), Math.ceil(x0 + 1), Math.ceil(z0 + 1), (i) => { blocked[i] = 1; });
  };
  table(55.3, 60.5);
  table(57.5, 60.5);

  const spawns = {
    T: [[43.5, 97.5], [47.5, 98.5], [51.5, 97.5], [55.5, 98.5], [59.5, 97.5]].map(([x, z]) => ({ x, z, yaw: 0 })),
    CT: [[44.5, 10.5], [48.5, 9.5], [52.5, 10.5], [56.5, 9.5], [50.5, 14.5]].map(([x, z]) => ({ x, z, yaw: Math.PI })),
  };

  const sites = {
    A: { name: 'A', x0: 72, z0: 6, x1: 92, z1: 21, cx: 82, cz: 13 },
    B: { name: 'B', x0: 6, z0: 8, x1: 29, z1: 33, cx: 17, cz: 21 },
  };

  const buyZones = {
    T: { x0: 36, z0: 88, x1: 66, z1: 106 },
    CT: { x0: 38, z0: 4, x1: 62, z1: 22 },
  };

  const zones = [
    { name: 'T Spawn', x0: 36, z0: 90, x1: 66, z1: 106 },
    { name: 'Top Mid', x0: 46, z0: 82, x1: 53, z1: 90 },
    { name: 'Mid', x0: 44, z0: 32, x1: 54, z1: 84 },
    { name: 'Mid Doors', x0: 47, z0: 28, x1: 51, z1: 32 },
    { name: 'CT Mid', x0: 38, z0: 20, x1: 60, z1: 28 },
    { name: 'CT Spawn', x0: 40, z0: 4, x1: 62, z1: 20 },
    { name: 'B Doors', x0: 32, z0: 20, x1: 38, z1: 26 },
    { name: 'B Site', x0: 4, z0: 6, x1: 32, z1: 38 },
    { name: 'B Tunnels', x0: 16, z0: 38, x1: 28, z1: 64 },
    { name: 'Upper Tunnels', x0: 21, z0: 64, x1: 36, z1: 100 },
    { name: 'Lower Tunnels', x0: 27, z0: 70, x1: 44, z1: 76 },
    { name: 'Outside Long', x0: 66, z0: 88, x1: 82, z1: 100 },
    { name: 'Long Doors', x0: 72, z0: 78, x1: 76, z1: 88 },
    { name: 'Long A', x0: 70, z0: 24, x1: 96, z1: 78 },
    { name: 'A Site', x0: 66, z0: 4, x1: 96, z1: 24 },
    { name: 'Catwalk', x0: 54, z0: 22, x1: 66, z1: 50 },
    { name: 'CT Ramp', x0: 62, z0: 4, x1: 66, z1: 22 },
    { name: 'Turkish Kebab', x0: 54, z0: 55, x1: 62, z1: 62 },
  ];

  const restaurant = {
    sign: { x: 53.95, y: 3.95, z: 58, w: 4.4, h: 1.15 },
    spit: { x: 61.25, y: 1.05, z: 59.6 },
    counter: { x0: 60.2, z0: 55.2, x1: 61.95, z1: 61.8, h: 1.05 },
    tables: [[55.3, 60.5], [57.5, 60.5]],
    light: { x: 57.5, y: 2.9, z: 58.5 },
    board: { x: 61.94, y: 2.15, z: 57.6 },
    baseY: 0,
  };
  // Fried cheese spawns here (counter and first table).
  const pickupSpots = [
    { type: 'cheese', x: 60.75, y: 1.06, z: 57.2 },
    { type: 'cheese', x: 55.8, y: 0.77, z: 61.0 },
  ];

  // AI knowledge: attack routes, CT holds, T post-plant guard spots.
  const ai = {
    routes: {
      long: { site: 'A', points: [[74, 94], [74, 83], [80, 70], [89, 46], [86, 27]] },
      short: { site: 'A', points: [[49.5, 86], [49, 66], [55.5, 47], [64, 36], [64, 24]] },
      tunnels: { site: 'B', points: [[30, 96], [24, 84], [24, 70], [22, 56], [22, 42]] },
      midb: { site: 'B', points: [[49.5, 86], [48, 74], [36, 73], [24, 72], [22, 56], [22, 42]] },
      midct: { site: 'B', points: [[49.5, 86], [49, 50], [49, 30], [44, 24], [35, 23]] },
    },
    holds: {
      A: [
        { pos: [86, 12], look: [89, 40] },
        { pos: [70.5, 14], look: [64, 30] },
        { pos: [80, 6.5], look: [87, 30] },
        { pos: [67, 11], look: [64, 26] },
      ],
      B: [
        { pos: [9, 10], look: [22, 40] },
        { pos: [28, 16], look: [22, 40] },
        { pos: [13, 30], look: [22, 42] },
        { pos: [27, 27], look: [21, 40] },
      ],
      mid: [
        { pos: [43.5, 25.5], look: [48.5, 40] },
        { pos: [55, 25.5], look: [49, 42] },
      ],
    },
    guards: {
      A: [
        { pos: [84, 8], look: [62, 12] },
        { pos: [74, 16], look: [64, 30] },
        { pos: [88, 18], look: [89, 40] },
      ],
      B: [
        { pos: [20, 18], look: [35, 23] },
        { pos: [10, 28], look: [22, 40] },
        { pos: [26, 20], look: [36, 23] },
      ],
    },
  };

  return {
    id: 'dustline', name: 'Dustline',
    width: W, depth: D, cols: columnsFromGrid(W, D, h, ceil, roof, solid, mat), props,
    // Legacy single-floor grids (kept for tools and tests).
    h, ceil, roof, mat, solid, blocked,
    spawns, sites, buyZones, zones, ai, restaurant, pickupSpots,
    levels: [{ name: '', y0: -100, y1: 100 }],
    letters: [
      { letter: 'A', x: 95.97, y: 3.6, z: 12, rotY: -Math.PI / 2 },
      { letter: 'B', x: 4.03, y: 2.8, z: 26, rotY: Math.PI / 2 },
    ],
    groundMat: MAT.FLOOR,
    windows: true,
    atmosphere: 'desert',
  };
}

// Single-floor grid (floor height + optional roof slab per cell) to column spans.
function columnsFromGrid(W, D, h, ceil, roof, solid, mat) {
  const C = new Columns(W, D);
  for (let i = 0; i < W * D; i++) {
    const l = C.cols[i];
    if (solid[i]) l.push([0, h[i], mat[i]]);
    else if (h[i] > 0.001) l.push([0, h[i], MAT.STONE]);
    if (!solid[i] && ceil[i] > 0) l.push([ceil[i], roof[i], MAT.WALL]);
  }
  return C;
}
