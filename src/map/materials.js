// Surface materials shared by collision (bullet penetration, impact sounds) and rendering.
export const MAT = {
  FLOOR: 0, WALL: 1, WALL2: 2, STONE: 3, CRATE: 4, METAL: 5, WOOD: 6,
  CONCRETE: 7, // industrial walls
  GROUND: 8, // outdoor ground slab: concrete sides, asphalt top
  FLOOR_IN: 9, // indoor floor slab: concrete sides, tiled top
  CONTAINER: 10, // red shipping container
  CONTAINER2: 11, // blue shipping container
  GRATE: 12, // metal catwalks and railings
};

// How each material is drawn: texture for the sides and the top face, world UV scale, and whether
// the top gets its own texture. `under` is the brightness of ceilings (bottom faces), `impact` the
// dust color of bullet hits.
export const LOOK = {
  [MAT.FLOOR]: { side: 'sand', top: 'sand', scale: 1 / 4, impact: [0.78, 0.66, 0.48] },
  [MAT.WALL]: { side: 'sandstone', top: 'sandstone', scale: 1 / 4, impact: [0.8, 0.68, 0.5] },
  [MAT.WALL2]: { side: 'plaster', top: 'plaster', scale: 1 / 4, impact: [0.86, 0.8, 0.68] },
  [MAT.STONE]: { side: 'stone', top: 'stone', scale: 1 / 3, impact: [0.72, 0.66, 0.56] },
  [MAT.CRATE]: { side: 'crate', top: 'crate', scale: 1, local: true, impact: [0.55, 0.38, 0.2] },
  [MAT.METAL]: { side: 'metal', top: 'metal', scale: 1 / 2, impact: [0.4, 0.45, 0.5] },
  [MAT.WOOD]: { side: 'crate', top: 'crate', scale: 1, impact: [0.55, 0.38, 0.2] },
  [MAT.CONCRETE]: { side: 'concrete', top: 'concrete', scale: 1 / 4, under: 0.8, impact: [0.62, 0.62, 0.6] },
  [MAT.GROUND]: { side: 'concrete', top: 'asphalt', scale: 1 / 4, under: 0.8, impact: [0.45, 0.44, 0.42] },
  [MAT.FLOOR_IN]: { side: 'concrete', top: 'tiles', scale: 1 / 4, under: 0.8, impact: [0.7, 0.7, 0.68] },
  [MAT.CONTAINER]: { side: 'containerRed', top: 'containerRed', scale: 1 / 3, impact: [0.5, 0.3, 0.25] },
  [MAT.CONTAINER2]: { side: 'containerBlue', top: 'containerBlue', scale: 1 / 3, impact: [0.3, 0.4, 0.5] },
  [MAT.GRATE]: { side: 'grate', top: 'grate', scale: 1 / 2, impact: [0.4, 0.45, 0.5] },
};

export const METALLIC = new Set([MAT.METAL, MAT.CONTAINER, MAT.CONTAINER2, MAT.GRATE]);
export const WOODEN = new Set([MAT.CRATE, MAT.WOOD]);
