// "Nukeline" – an industrial two-floor map in the spirit of the classic nuclear plant layout:
// bombsite A inside the reactor hall on the main floor, bombsite B directly underneath it.
// Main floor at y = 5 (yard, spawns, lobby, A), lower floor at y = 0 (B, ramp bottom, secret, decon).
// Ways down to B: ramp (T side), secret stairs from the yard, decon stairs (CT side), and one-way
// drops through the hatch and the vent in A's floor.
import { hash2 } from '../../util.js';
import { MAT } from '../materials.js';
import { Columns, SKY } from '../columns.js';

const W = 116;
const D = 100;
const MAIN = 5;
const HEIGHTS = [13.5, 14, 15, 16];

export function buildNuke() {
  const C = new Columns(W, D);
  const wallH = (x, z) => {
    if (x < 2 || z < 2 || x >= W - 2 || z >= D - 2) return 18;
    return HEIGHTS[Math.floor(hash2(Math.floor(x / 10) + 5, Math.floor(z / 10) + 9) * HEIGHTS.length)];
  };
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) C.cols[z * W + x].push([0, wallH(x, z), MAT.CONCRETE]);
  const props = [];

  // Open-air area standing on the ground slab.
  const outdoor = (x0, z0, x1, z1, y = MAIN) => {
    C.air(x0, z0, x1, z1, y, SKY);
    C.paint(x0, z0, x1, z1, 0, y, MAT.GROUND);
  };
  // Roofed room on the main floor (tiled floor, the wall above the ceiling is the roof).
  const room = (x0, z0, x1, z1, ceil, floorMat = MAT.FLOOR_IN) => {
    C.air(x0, z0, x1, z1, MAIN, ceil);
    C.paint(x0, z0, x1, z1, 0, MAIN, floorMat);
  };
  // Room on the lower floor (y = 0).
  const lower = (x0, z0, x1, z1, ceil) => C.air(x0, z0, x1, z1, 0, ceil);
  const box = (x0, z0, x1, z1, y0, h, mat, invisible = false) => {
    props.push({ min: [x0, y0, z0], max: [x1, y0 + h, z1], mat, invisible });
  };
  const crate = (x, z, size, y0) => {
    props.push({ min: [x + 0.02, y0, z + 0.02], max: [x + size - 0.02, y0 + size, z + size - 0.02], mat: MAT.CRATE });
    return y0 + size;
  };
  const container = (x0, z0, x1, z1, y0, mat) => box(x0, z0, x1, z1, y0, 2.6, mat);

  // ---------------- Main floor: outside ----------------
  outdoor(12, 4, 110, 26); // the yard
  outdoor(4, 78, 26, 96); // T spawn
  outdoor(4, 44, 26, 78); // T outside (spawn -> lobby / yard)
  outdoor(12, 26, 20, 44); // T outside ("T red")
  outdoor(94, 34, 110, 78); // CT spawn
  outdoor(102, 26, 110, 34); // garage: yard <-> CT spawn

  // ---------------- Main floor: buildings ----------------
  room(28, 42, 44, 62, 9.5); // lobby
  room(26, 50, 28, 56, 8.5); // T spawn -> lobby door
  room(40, 36, 47, 42, 8.5); // squeaky room (L-shaped: lobby corner -> north -> east door)
  room(47, 37, 48, 40, 8); // squeaky door into A
  room(50, 27, 56, 33, 9); // hut: yard -> A, doors offset so the yard can't see into A
  room(54, 26, 56, 27, 8); // hut door from the yard
  room(50, 33, 53, 34, 8); // hut door into A
  room(63, 26, 69, 33, 10); // main: yard -> A
  room(64, 33, 68, 34, 9); // main door into A
  room(48, 34, 84, 62, 12); // A site hall
  room(84, 34, 94, 38, 9); // mini: A <-> CT spawn
  room(86, 40, 90, 60, 12); // heaven stairwell
  room(90, 56, 94, 60, 8.5); // stairwell -> CT spawn door
  room(32, 62, 36, 66, 9.5); // lobby -> ramp
  room(86, 64, 94, 68, 9.5); // CT spawn -> decon

  // Skylights in the A hall roof.
  C.air(56, 41, 74, 44, 12, SKY);
  C.air(56, 51, 74, 54, 12, SKY);

  // Heaven: grated catwalk along the east wall of A, stairs up from the CT side.
  C.solid(78, 36, 84, 60, 8.2, 8.6, MAT.GRATE);
  C.air(84, 40, 86, 43, 8.6, 11.4); // opening from the stairwell landing
  C.solid(86, 40, 90, 43, MAIN, 8.6, MAT.CONCRETE); // landing
  C.stairs(86, 43, 90, 57, 'z', 8.35, 5.25, { base: MAIN, mat: MAT.CONCRETE });
  for (const [z0, z1] of [[36, 44], [46, 54], [56, 60]]) box(78, z0, 78.1, z1, 8.6, 1.0, MAT.GRATE);
  box(78, 36, 84, 36.1, 8.6, 1.0, MAT.GRATE);
  box(78, 59.9, 84, 60, 8.6, 1.0, MAT.GRATE);

  // Turkish Kebab kiosk in the yard (same interior as on Dustline).
  C.solid(41, 3, 50, 12, MAIN, 9.8, MAT.CONCRETE);
  C.air(42, 4, 49, 11, MAIN, 8.3);
  C.air(41, 5, 42, 9, MAIN, 8.3);
  C.paint(41, 4, 49, 11, 0, MAIN, MAT.FLOOR_IN);

  // ---------------- Halls spanning both floors ----------------
  // Ramp: lobby (main floor) down to B.
  C.air(32, 66, 60, 74, 0, 9.5);
  C.solid(32, 66, 36, 74, 0, MAIN, MAT.FLOOR_IN);
  C.stairs(36, 66, 56, 74, 'x', 4.75, 0, { mat: MAT.CONCRETE });
  // Decon: CT spawn down to B.
  C.air(66, 64, 86, 68, 0, 9.5);
  C.solid(84, 64, 86, 68, 0, MAIN, MAT.FLOOR_IN);
  C.stairs(72, 64, 84, 68, 'x', 5 / 13, 60 / 13, { mat: MAT.CONCRETE });

  // ---------------- Lower floor ----------------
  lower(52, 36, 78, 60, 4.2); // B site, right under A
  for (const [x, z] of [[58, 42], [68, 42], [58, 52], [68, 52]]) C.solid(x, z, x + 2, z + 2, 0, 4.2, MAT.CONCRETE); // pillars
  lower(56, 60, 60, 66, 3.6); // ramp -> B
  lower(68, 60, 72, 64, 3.6); // decon -> B
  lower(84, 26, 89, 44, 3.4); // secret tunnel (north-south, under mini)
  lower(78, 40, 84, 44, 3.4); // secret tunnel -> B
  // CT stairs: from CT spawn's west wall down under the heaven stairwell into B's east side.
  C.air(84, 45, 94, 48, 0, 3.4);
  const ctRows = C.stairs(84, 45, 94, 48, 'x', 0, 4.5, { mat: MAT.CONCRETE });
  for (let k = 0; k < ctRows.length; k++) C.air(84 + k, 45, 85 + k, 48, ctRows[k], Math.max(3.4, ctRows[k] + 2.5));
  lower(78, 45, 84, 48, 3.4);
  // Secret stairs: an open trench in the yard going down to the tunnel.
  C.air(84, 8, 89, 26, 0, SKY);
  C.stairs(84, 8, 89, 28, 'z', 4.75, 0, { mat: MAT.CONCRETE });
  C.solid(83, 10, 84, 26, 0, MAIN + 1, MAT.CONCRETE); // railing walls
  C.solid(89, 8, 90, 26, 0, MAIN + 1, MAT.CONCRETE);

  // Hatch and vent: holes in A's floor down to B.
  C.air(60, 48, 62, 50, 4.2, MAIN);
  C.solid(72, 35, 76, 36, MAIN, 7.5, MAT.CONCRETE);
  C.solid(72, 36, 73, 39, MAIN, 7.5, MAT.CONCRETE);
  C.solid(75, 36, 76, 39, MAIN, 7.5, MAT.CONCRETE);
  C.air(73, 36, 75, 38, 4.2, MAIN);

  // ---------------- Props ----------------
  // Yard
  container(34, 18, 40, 20.4, MAIN, MAT.CONTAINER);
  container(22, 10, 24.4, 16, MAIN, MAT.CONTAINER);
  container(74, 6, 80, 8.4, MAIN, MAT.CONTAINER2);
  container(94, 16, 100, 18.4, MAIN, MAT.CONTAINER);
  container(94, 16, 100, 18.4, MAIN + 2.6, MAT.CONTAINER2);
  container(90, 5, 92.4, 11, MAIN, MAT.CONTAINER2);
  crate(48, 20, 1, MAIN); crate(57, 23, 1, MAIN); crate(93, 22, 2, MAIN); crate(28, 6, 2, MAIN); crate(30, 7, 1, MAIN);
  crate(78, 22, 1, MAIN); crate(79, 22, 1, MAIN); crate(103, 8, 2, MAIN);
  // Silos: round tanks drawn by the decor, collision approximated by three boxes.
  const silos = [[58, 13, 3.3], [68, 13, 3.3]];
  for (const [cx, cz, r] of silos) {
    const a = r * 0.414, b = r * 0.71;
    box(cx - r, cz - a, cx + r, cz + a, MAIN, 14, MAT.METAL, true);
    box(cx - a, cz - r, cx + a, cz + r, MAIN, 14, MAT.METAL, true);
    box(cx - b, cz - b, cx + b, cz + b, MAIN, 14, MAT.METAL, true);
  }
  // T spawn, CT spawn, lobby
  crate(8, 60, 2, MAIN); crate(10, 61, 1, MAIN); crate(22, 70, 2, MAIN); crate(6, 47, 1, MAIN);
  container(102, 60, 108, 62.4, MAIN, MAT.CONTAINER); crate(97, 70, 2, MAIN); crate(99, 71, 1, MAIN);
  crate(30, 44, 1, MAIN); const lb = crate(41, 58, 2, MAIN); crate(41, 58, 1, lb);
  // A site
  const a1 = crate(62, 40, 2, MAIN); crate(62.5, 40.5, 1, a1);
  const a2 = crate(50, 37, 2, MAIN); crate(50.5, 37.5, 1, a2); // blocks the long view out of squeaky
  crate(70, 48, 2, MAIN);
  crate(56, 54, 2, MAIN);
  crate(74, 57, 1, MAIN); crate(75, 57, 1, MAIN);
  crate(66, 58, 1, MAIN);
  // B site
  crate(53, 37, 2, 0);
  const b1 = crate(76, 57, 2, 0); crate(76.5, 57.5, 1, b1);
  crate(63, 58, 1, 0);
  const b2 = crate(54, 50, 1, 0); crate(54, 50, 1, b2);
  crate(76, 40, 1, 0);
  box(72, 47, 73.2, 48.2, 0, 1.2, MAT.METAL); // toxic barrels
  box(64, 38, 65.2, 39.2, 0, 1.2, MAT.METAL);
  // Kebab counter and tables: collision only, the restaurant decor draws them.
  box(47.2, 4.2, 48.95, 10.8, MAIN, 1.05, MAT.WOOD, true);
  for (const [x0, z0] of [[42.3, 9.5], [44.5, 9.5]]) box(x0, z0, x0 + 1, z0 + 1, MAIN, 0.76, MAT.WOOD, true);

  const spawns = {
    T: [[10, 88], [14, 90], [18, 88], [22, 90], [16, 85]].map(([x, z]) => ({ x, y: MAIN, z, yaw: 0 })),
    CT: [[97, 40], [100, 42], [97, 45], [100, 48], [97, 51]].map(([x, z]) => ({ x, y: MAIN, z, yaw: Math.PI / 2 })),
  };

  const sites = {
    A: { name: 'A', x0: 54, z0: 40, x1: 78, z1: 58, cx: 66, cz: 49, cy: MAIN, y0: 3, y1: 12 },
    B: { name: 'B', x0: 54, z0: 38, x1: 76, z1: 58, cx: 64, cz: 48, cy: 0, y0: -1, y1: 3 },
  };

  const buyZones = {
    T: { x0: 4, z0: 78, x1: 26, z1: 96 },
    CT: { x0: 94, z0: 34, x1: 110, z1: 78 },
  };

  const zones = [
    { name: 'T Spawn', x0: 4, z0: 78, x1: 26, z1: 96 },
    { name: 'T Outside', x0: 4, z0: 44, x1: 26, z1: 78 },
    { name: 'T Outside', x0: 12, z0: 4, x1: 44, z1: 44 },
    { name: 'Silo', x0: 44, z0: 4, x1: 74, z1: 26 },
    { name: 'Outside', x0: 74, z0: 4, x1: 110, z1: 26 },
    { name: 'Garage', x0: 102, z0: 26, x1: 110, z1: 34 },
    { name: 'Turkish Kebab', x0: 41, z0: 4, x1: 49, z1: 11 },
    { name: 'Lobby', x0: 26, z0: 42, x1: 44, z1: 66 },
    { name: 'Squeaky', x0: 40, z0: 36, x1: 48, z1: 42 },
    { name: 'Hut', x0: 50, z0: 26, x1: 56, z1: 34 },
    { name: 'Main', x0: 63, z0: 26, x1: 69, z1: 34 },
    { name: 'A Site', x0: 48, z0: 34, x1: 84, z1: 62, y0: 3 },
    { name: 'Heaven', x0: 78, z0: 36, x1: 90, z1: 60, y0: 7.5 },
    { name: 'Hell', x0: 78, z0: 36, x1: 84, z1: 60, y0: 3, y1: 7.5 },
    { name: 'Vents', x0: 72, z0: 35, x1: 76, z1: 39, y0: 3 },
    { name: 'Mini', x0: 84, z0: 34, x1: 94, z1: 38 },
    { name: 'Heaven Stairs', x0: 86, z0: 40, x1: 94, z1: 60, y0: 3, y1: 7.5 },
    { name: 'CT Spawn', x0: 94, z0: 34, x1: 110, z1: 78, y0: 3 },
    { name: 'Ramp', x0: 32, z0: 62, x1: 60, z1: 74 },
    { name: 'Ramp', x0: 56, z0: 60, x1: 60, z1: 62, y1: 3 },
    { name: 'Decon', x0: 66, z0: 62, x1: 94, z1: 68 },
    { name: 'Decon', x0: 68, z0: 60, x1: 72, z1: 62, y1: 3 },
    { name: 'B Site', x0: 52, z0: 36, x1: 78, z1: 60, y1: 3 },
    { name: 'Secret', x0: 78, z0: 26, x1: 89, z1: 44, y1: 3 },
    { name: 'CT Stairs', x0: 78, z0: 45, x1: 94, z1: 48, y1: 4.9 },
    { name: 'Secret', x0: 83, z0: 8, x1: 90, z1: 28 },
  ];

  const restaurant = {
    baseY: MAIN,
    sign: { x: 40.95, y: 8.95, z: 7, w: 4.4, h: 1.15 },
    spit: { x: 48.25, y: 6.05, z: 8.6 },
    counter: { x0: 47.2, z0: 4.2, x1: 48.95, z1: 10.8, h: 1.05 },
    tables: [[42.3, 9.5], [44.5, 9.5]],
    light: { x: 44.5, y: 7.9, z: 7.5 },
    board: { x: 48.94, y: 7.15, z: 6.6 },
  };
  const pickupSpots = [
    { type: 'cheese', x: 47.75, y: 6.06, z: 6.2 },
    { type: 'cheese', x: 42.8, y: 5.77, z: 10.0 },
  ];

  // AI knowledge. Points are [x, z, y].
  const ai = {
    // Where seeing enemies means a site is being hit (CT bots rotate on it).
    approach: {
      A: [
        { x0: 48, z0: 26, x1: 84, z1: 62, y0: 3 }, // A hall, hut, main
        { x0: 38, z0: 36, x1: 48, z1: 46, y0: 3 }, // squeaky and the lobby corner in front of it
      ],
      B: [
        { x0: 44, z0: 36, x1: 80, z1: 74, y1: 3 }, // B, lower ramp, decon bottom
        { x0: 32, z0: 62, x1: 60, z1: 74 }, // ramp hall
        { x0: 78, z0: 26, x1: 90, z1: 44, y1: 3 }, // secret tunnel
        { x0: 83, z0: 14, x1: 90, z1: 28 }, // secret stairs
      ],
    },
    routes: {
      hut: { site: 'A', points: [[16, 48, 5], [16, 34, 5], [20, 18, 5], [36, 22, 5], [55, 23, 5], [53, 30, 5], [51.5, 36, 5]] },
      squeaky: { site: 'A', points: [[20, 54, 5], [27, 53, 5], [40, 46, 5], [43, 39, 5], [51, 39.5, 5]] },
      main: { site: 'A', points: [[16, 48, 5], [16, 30, 5], [26, 22, 5], [48, 23, 5], [60, 22, 5], [66, 24, 5], [66, 31, 5], [66, 38, 5]] },
      ramp: { site: 'B', points: [[20, 54, 5], [27, 53, 5], [34, 56, 5], [34, 64, 5], [58, 70, 0], [58, 63, 0], [58, 57, 0]] },
      secret: { site: 'B', points: [[16, 48, 5], [16, 30, 5], [30, 11, 5], [72, 22, 5], [80, 12, 5], [86.5, 9, 5], [86.5, 30, 0], [86.5, 42, 0], [80, 42, 0], [75, 44, 0]] },
    },
    holds: {
      // Close angles next to the doors come first: attackers only see them once they step through.
      A: [
        { pos: [79.6, 48, 8.6], look: [54, 38, 5] }, // heaven
        { pos: [51.5, 43.5, 5], look: [47.5, 38.5, 5] }, // beside the squeaky door, also sees the hut door
        { pos: [71.5, 37.5, 5], look: [66, 34, 5] }, // beside the main door
        { pos: [80, 46, 5], look: [52, 38, 5] }, // hell
      ],
      B: [
        { pos: [62.5, 56.5, 0], look: [58, 60.5, 0] }, // beside the ramp door
        { pos: [73.5, 37.5, 0], look: [78, 42, 0] }, // beside the secret door
        { pos: [56, 40, 0], look: [68, 52, 0] },
        { pos: [74, 55, 0], look: [58, 62, 0] },
      ],
      mid: [
        { pos: [91, 36, 5], look: [70, 46, 5] },
        { pos: [106, 30, 5], look: [80, 14, 5] },
      ],
    },
    guards: {
      A: [
        { pos: [52, 40, 5], look: [80, 50, 5] },
        { pos: [58, 45, 5], look: [84, 36, 5] },
        { pos: [73, 60, 5], look: [84, 36, 5] },
      ],
      B: [
        { pos: [55, 57, 0], look: [78, 42, 0] },
        { pos: [75, 42, 0], look: [58, 60, 0] },
        { pos: [65, 56, 0], look: [70, 62, 0] },
      ],
    },
  };

  // One-way drops for the bots: hatch (from both sides) and vent.
  const navLinks = [
    { from: [59.5, MAIN, 49], to: [60.5, 0, 49] },
    { from: [62.5, MAIN, 49], to: [61.5, 0, 49] },
    { from: [73.5, MAIN, 38.5], to: [74, 0, 36.9] },
  ];

  const decor = [
    ...silos.map(([x, z, r]) => ({ type: 'silo', x, z, r, y: MAIN, h: 14 })),
    { type: 'pipe', axis: 'x', a0: 20, a1: 102, z: 25.55, y: 10.8, r: 0.32 },
    { type: 'pipe', axis: 'x', a0: 14, a1: 40.6, z: 4.5, y: 8.2, r: 0.4 },
    { type: 'pipe', axis: 'x', a0: 50.4, a1: 108, z: 4.5, y: 8.2, r: 0.4 },
    { type: 'pipe', axis: 'z', a0: 36.5, a1: 59.5, x: 52.5, y: 3.7, r: 0.22 },
    { type: 'sign', kind: 'radiation', x: 59.5, y: 9, z: 25.97, rotY: Math.PI, size: 2.4 },
    { type: 'sign', kind: 'radiation', x: 65, y: 2.5, z: 36.03, rotY: 0, size: 1.4 },
    { type: 'sign', kind: 'radiation', x: 109.97, y: 8, z: 50, rotY: -Math.PI / 2, size: 1.8 },
    { type: 'sign', kind: 'text', text: 'NUKELINE', x: 80, y: 11, z: 4.03, rotY: 0, w: 14, h: 2.4 },
    { type: 'sign', kind: 'text', text: 'B ↓', x: 32.03, y: 7.5, z: 70, rotY: Math.PI / 2, w: 2.6, h: 1.3 },
    { type: 'tower', x: 40, z: -70, r: 22, h: 70 },
    { type: 'tower', x: 95, z: -85, r: 20, h: 62 },
    { type: 'lamp', x: 62, y: 4.15, z: 47, w: 3, d: 0.4 },
    { type: 'lamp', x: 70, y: 4.15, z: 50, w: 3, d: 0.4 },
    { type: 'lamp', x: 46, y: 9.45, z: 70, w: 3, d: 0.4 },
    { type: 'lamp', x: 76, y: 9.45, z: 66, w: 3, d: 0.4 },
    { type: 'lamp', x: 86.5, y: 3.35, z: 36, w: 0.4, d: 3 },
    { type: 'lamp', x: 36, y: 9.45, z: 52, w: 3, d: 0.4 },
  ];
  const lights = [
    { x: 62, y: 3.7, z: 47, color: 0xdfe8ff, intensity: 14, distance: 16 },
    { x: 70, y: 3.7, z: 50, color: 0xdfe8ff, intensity: 14, distance: 16 },
    { x: 64, y: 10.5, z: 48, color: 0xfff1dc, intensity: 24, distance: 30 },
    { x: 46, y: 8.8, z: 70, color: 0xdfe8ff, intensity: 16, distance: 20 },
    { x: 36, y: 8.8, z: 52, color: 0xdfe8ff, intensity: 14, distance: 18 },
  ];

  return {
    id: 'nuke', name: 'Nukeline',
    width: W, depth: D, cols: C, props,
    spawns, sites, buyZones, zones, ai, navLinks, restaurant, pickupSpots,
    levels: [
      { name: 'UPPER', y0: 3, y1: 100 },
      { name: 'LOWER', y0: -100, y1: 3 },
    ],
    letters: [
      { letter: 'A', x: 48.03, y: 7.4, z: 52, rotY: Math.PI / 2, size: 3.2 },
      { letter: 'B', x: 52.03, y: 2.2, z: 46, rotY: Math.PI / 2, size: 2.4 },
    ],
    groundMat: MAT.CONCRETE,
    windows: 'glass',
    decor,
    lights,
    atmosphere: 'industrial',
  };
}
