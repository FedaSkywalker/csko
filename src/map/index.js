// Loads a map by id: layout + collision world + bot navigation (shared by client, sim and server).
import { buildLayout } from './layout.js';
import { World } from './world.js';
import { NavGrid } from './nav.js';

export function loadMap(id) {
  const layout = buildLayout(id);
  const world = new World(layout);
  const nav = new NavGrid(layout, world);
  return { id: layout.id, layout, world, nav };
}
