// Map registry. A layout describes one map: solid column spans (`cols`), extra box props, spawns,
// bomb sites, buy zones, callout zones, radar levels and AI knowledge (routes, holds, guards).
// Coordinates: x grows east, z grows south (north = -Z, where yaw 0 looks), y is up.
// Rectangles may carry y0/y1 to restrict them to one floor of a multi-level map.
import { MAT } from './materials.js';
import { buildDustline } from './maps/dustline.js';
import { buildNuke } from './maps/nuke.js';

export { MAT };

const BUILDERS = { dustline: buildDustline, nuke: buildNuke };
export const MAPS = [
  { id: 'dustline', name: 'Dustline' },
  { id: 'nuke', name: 'Nukeline' },
];
export const MAP_IDS = MAPS.map((m) => m.id);
export const DEFAULT_MAP = 'dustline';

export function validMap(id) {
  return MAP_IDS.includes(id) ? id : DEFAULT_MAP;
}

export function buildLayout(id = DEFAULT_MAP) {
  const L = BUILDERS[validMap(id)]();
  const W = L.width;
  L.idx = (x, z) => z * W + x;
  L.inBounds = (x, z) => x >= 0 && z >= 0 && x < W && z < L.depth;
  // Spawns without an explicit height stand on the lowest floor of their cell.
  for (const team of ['T', 'CT']) {
    for (const sp of L.spawns[team]) if (sp.y === undefined) sp.y = L.cols.floorAt(sp.x, sp.z);
  }
  for (const s of Object.values(L.sites)) if (s.cy === undefined) s.cy = s.y0 !== undefined ? s.y0 + 1 : L.cols.floorAt(s.cx, s.cz);
  L.navLinks ||= [];
  L.decor ||= [];
  L.lights ||= [];
  return L;
}

export function inRect(r, x, z) {
  return x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1;
}

// Rectangle test that also honours the optional y0/y1 floor band.
export function inZone(r, x, y, z) {
  if (!inRect(r, x, z)) return false;
  if (y === undefined) return true;
  return (r.y0 === undefined || y >= r.y0) && (r.y1 === undefined || y < r.y1);
}

// Which radar level (index into layout.levels) a height belongs to.
export function levelAt(L, y) {
  const lv = L.levels;
  for (let i = 0; i < lv.length; i++) if (y >= lv[i].y0 && y < lv[i].y1) return i;
  return 0;
}
