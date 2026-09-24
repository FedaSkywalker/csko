// Procedural low-poly weapon models built from primitives (real-world scale, barrel along -Z).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const M = {};
function mats() {
  if (M.ready) return M;
  const std = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  M.metalDark = std(0x2b2d31, 0.42, 0.65);
  M.metalMid = std(0x4a4d53, 0.45, 0.6);
  M.polymer = std(0x1d1e20, 0.75, 0.1);
  M.wood = std(0x7b4623, 0.6, 0);
  M.olive = std(0x55603f, 0.7, 0.1);
  M.silver = std(0xb4b6bb, 0.28, 0.85);
  M.blade = std(0xc4c8ce, 0.2, 0.9);
  M.lens = std(0x223344, 0.1, 0.5);
  M.he = std(0x4b5a2c, 0.6, 0.2);
  M.flash = std(0x8c9198, 0.5, 0.5);
  M.smoke = std(0x5c6c7a, 0.6, 0.3);
  M.c4 = std(0x8a7d52, 0.8, 0);
  M.red = std(0xaa2222, 0.6, 0);
  M.blue = std(0x2244aa, 0.6, 0);
  M.yellow = std(0xbbaa22, 0.6, 0);
  M.ready = true;
  return M;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cylZ = (r, len, seg = 10) => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  return g;
};

function add(group, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  group.add(m);
  return m;
}

function curvedMag(parent, mat, x, y, z, segs = 3, w = 0.034, h = 0.07, d = 0.062, curve = 0.16) {
  const mag = new THREE.Group();
  mag.position.set(x, y, z);
  let cy = 0, cz = 0, ang = 0.1;
  for (let i = 0; i < segs; i++) {
    const s = add(mag, box(w, h, d), mat, 0, cy - h / 2, cz, ang);
    cy -= Math.cos(ang) * h * 0.92;
    cz -= Math.sin(ang) * h * 0.92;
    ang += curve;
    s.castShadow = true;
  }
  parent.add(mag);
  return mag;
}

function muzzlePoint(group, x, y, z) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  group.add(o);
  group.userData.muzzle = o;
}

const builders = {
  ak47(g, m) {
    add(g, box(0.05, 0.07, 0.34), m.metalDark, 0, 0.02, -0.08);
    add(g, box(0.046, 0.022, 0.28), m.metalMid, 0, 0.066, -0.06);
    add(g, cylZ(0.011, 0.42), m.metalDark, 0, 0.035, -0.46);
    add(g, cylZ(0.012, 0.22), m.metalMid, 0, 0.066, -0.34);
    add(g, box(0.058, 0.052, 0.2), m.wood, 0, 0.022, -0.33);
    add(g, box(0.05, 0.03, 0.16), m.wood, 0, 0.068, -0.33);
    add(g, box(0.01, 0.05, 0.012), m.metalDark, 0, 0.06, -0.62);
    add(g, cylZ(0.016, 0.05), m.metalDark, 0, 0.035, -0.69);
    add(g, box(0.022, 0.02, 0.04), m.metalDark, 0, 0.085, -0.2);
    add(g, box(0.045, 0.07, 0.3), m.wood, 0, 0.0, 0.24, -0.08);
    add(g, box(0.048, 0.13, 0.03), m.wood, 0, -0.03, 0.39, -0.08);
    add(g, box(0.034, 0.1, 0.045), m.wood, 0, -0.05, 0.05, 0.35);
    add(g, box(0.008, 0.01, 0.06), m.metalDark, 0, -0.03, -0.02);
    g.userData.mag = curvedMag(g, m.metalDark, 0, -0.012, -0.11);
    muzzlePoint(g, 0, 0.035, -0.72);
  },
  m4a1(g, m) {
    add(g, box(0.05, 0.06, 0.26), m.polymer, 0, 0.03, -0.05);
    add(g, box(0.045, 0.05, 0.18), m.metalDark, 0, -0.02, -0.03);
    add(g, box(0.022, 0.018, 0.24), m.metalDark, 0, 0.068, -0.06);
    add(g, box(0.062, 0.062, 0.25), m.polymer, 0, 0.03, -0.3);
    add(g, cylZ(0.01, 0.2), m.metalDark, 0, 0.03, -0.5);
    add(g, cylZ(0.019, 0.2), m.metalMid, 0, 0.03, -0.66);
    add(g, box(0.012, 0.05, 0.015), m.metalDark, 0, 0.075, -0.42);
    add(g, cylZ(0.014, 0.2), m.metalDark, 0, 0.03, 0.15);
    add(g, box(0.042, 0.055, 0.2), m.polymer, 0, 0.012, 0.22);
    add(g, box(0.046, 0.12, 0.04), m.polymer, 0, -0.02, 0.32);
    add(g, box(0.032, 0.09, 0.04), m.polymer, 0, -0.06, 0.05, 0.3);
    const mag = new THREE.Group();
    mag.position.set(0, -0.03, -0.07);
    add(mag, box(0.03, 0.14, 0.065), m.metalDark, 0, -0.07, 0, 0.12);
    g.add(mag);
    g.userData.mag = mag;
    muzzlePoint(g, 0, 0.03, -0.77);
  },
  awp(g, m) {
    add(g, box(0.062, 0.08, 0.7), m.olive, 0, 0.0, 0.0);
    add(g, box(0.056, 0.15, 0.22), m.olive, 0, -0.03, 0.42);
    add(g, cylZ(0.013, 0.55), m.metalDark, 0, 0.03, -0.62);
    add(g, cylZ(0.021, 0.07), m.metalDark, 0, 0.03, -0.92);
    add(g, cylZ(0.022, 0.34), m.polymer, 0, 0.11, -0.05);
    add(g, cylZ(0.03, 0.07), m.polymer, 0, 0.11, -0.25);
    add(g, cylZ(0.028, 0.06), m.polymer, 0, 0.11, 0.14);
    add(g, box(0.02, 0.05, 0.02), m.metalDark, 0, 0.065, -0.14);
    add(g, box(0.02, 0.05, 0.02), m.metalDark, 0, 0.065, 0.05);
    add(g, box(0.06, 0.012, 0.012), m.metalDark, 0.035, 0.03, 0.12);
    add(g, new THREE.SphereGeometry(0.014, 8, 6), m.metalDark, 0.07, 0.03, 0.12);
    const lens = add(g, new THREE.CircleGeometry(0.026, 16), m.lens, 0, 0.11, 0.171);
    lens.rotation.y = 0;
    const mag = new THREE.Group();
    mag.position.set(0, -0.04, -0.05);
    add(mag, box(0.04, 0.07, 0.09), m.metalDark, 0, -0.035, 0);
    g.add(mag);
    g.userData.mag = mag;
    muzzlePoint(g, 0, 0.03, -0.96);
  },
  mp5(g, m) {
    add(g, box(0.05, 0.07, 0.3), m.polymer, 0, 0.02, -0.02);
    add(g, cylZ(0.024, 0.28), m.metalDark, 0, 0.03, -0.3);
    add(g, box(0.056, 0.05, 0.12), m.polymer, 0, 0.0, -0.17);
    add(g, box(0.03, 0.05, 0.2), m.metalDark, 0, 0.0, 0.22);
    add(g, box(0.04, 0.11, 0.03), m.polymer, 0, -0.02, 0.32);
    add(g, box(0.03, 0.09, 0.04), m.polymer, 0, -0.06, 0.07, 0.3);
    add(g, box(0.02, 0.025, 0.05), m.metalDark, 0, 0.07, 0.02);
    g.userData.mag = curvedMag(g, m.metalDark, 0, -0.012, -0.08, 3, 0.028, 0.055, 0.045, 0.1);
    muzzlePoint(g, 0, 0.03, -0.45);
  },
  glock(g, m) {
    add(g, box(0.028, 0.035, 0.19), m.polymer, 0, 0.035, -0.05);
    add(g, box(0.026, 0.02, 0.16), m.polymer, 0, 0.008, -0.04);
    add(g, box(0.028, 0.1, 0.045), m.polymer, 0, -0.045, 0.03, 0.3);
    add(g, box(0.006, 0.012, 0.03), m.metalDark, 0, -0.005, -0.03);
    const mag = new THREE.Group();
    mag.position.set(0, -0.09, 0.045);
    add(mag, box(0.026, 0.02, 0.04), m.polymer, 0, 0, 0, 0.3);
    g.add(mag);
    g.userData.mag = mag;
    muzzlePoint(g, 0, 0.035, -0.15);
  },
  usp(g, m) {
    add(g, box(0.03, 0.037, 0.2), m.metalDark, 0, 0.036, -0.05);
    add(g, box(0.028, 0.02, 0.17), m.polymer, 0, 0.008, -0.04);
    add(g, cylZ(0.016, 0.16), m.metalMid, 0, 0.036, -0.23);
    add(g, box(0.03, 0.1, 0.046), m.polymer, 0, -0.045, 0.03, 0.3);
    const mag = new THREE.Group();
    mag.position.set(0, -0.09, 0.045);
    add(mag, box(0.028, 0.02, 0.04), m.polymer, 0, 0, 0, 0.3);
    g.add(mag);
    g.userData.mag = mag;
    muzzlePoint(g, 0, 0.036, -0.32);
  },
  deagle(g, m) {
    add(g, box(0.034, 0.045, 0.26), m.silver, 0, 0.042, -0.07);
    add(g, box(0.03, 0.025, 0.2), m.silver, 0, 0.008, -0.05);
    add(g, box(0.012, 0.012, 0.24), m.silver, 0, 0.07, -0.08);
    add(g, box(0.034, 0.11, 0.05), m.polymer, 0, -0.05, 0.035, 0.28);
    const mag = new THREE.Group();
    mag.position.set(0, -0.1, 0.05);
    add(mag, box(0.03, 0.02, 0.045), m.metalDark, 0, 0, 0, 0.28);
    g.add(mag);
    g.userData.mag = mag;
    muzzlePoint(g, 0, 0.045, -0.2);
  },
  knife(g, m) {
    add(g, box(0.026, 0.032, 0.11), m.polymer, 0, 0, 0.035);
    add(g, box(0.05, 0.012, 0.012), m.metalDark, 0, 0.004, -0.024);
    const s = new THREE.Shape();
    s.moveTo(0, -0.012);
    s.lineTo(0.13, -0.012);
    s.quadraticCurveTo(0.17, -0.006, 0.185, 0.018);
    s.lineTo(0.12, 0.022);
    s.lineTo(0, 0.022);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.001, bevelSegments: 1 });
    geo.translate(0, 0, -0.002);
    geo.rotateY(Math.PI / 2);
    add(g, geo, m.blade, 0, 0.0, -0.03);
    muzzlePoint(g, 0, 0.0, -0.2);
  },
  he(g, m) {
    const s = add(g, new THREE.SphereGeometry(0.034, 12, 10), m.he, 0, 0, 0);
    s.scale.set(1, 1.18, 1);
    add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.025, 8), m.metalMid, 0, 0.045, 0);
    add(g, box(0.012, 0.07, 0.006), m.metalMid, 0.016, 0.02, 0, 0, 0, -0.2);
  },
  flash(g, m) {
    add(g, new THREE.CylinderGeometry(0.028, 0.028, 0.1, 12), m.flash, 0, 0, 0);
    add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.025, 8), m.metalMid, 0, 0.062, 0);
    add(g, box(0.012, 0.08, 0.006), m.metalMid, 0.02, 0.02, 0, 0, 0, -0.12);
  },
  smoke(g, m) {
    add(g, new THREE.CylinderGeometry(0.031, 0.031, 0.11, 12), m.smoke, 0, 0, 0);
    add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.025, 8), m.metalMid, 0, 0.067, 0);
    add(g, box(0.012, 0.08, 0.006), m.metalMid, 0.022, 0.02, 0, 0, 0, -0.12);
  },
  c4(g, m, tex) {
    add(g, box(0.2, 0.06, 0.13), m.c4, 0, 0, 0);
    for (let i = 0; i < 3; i++) add(g, new THREE.CylinderGeometry(0.018, 0.018, 0.2, 8), m.c4, 0, 0.035, -0.04 + i * 0.04, 0, 0, Math.PI / 2);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.08), new THREE.MeshStandardMaterial({ map: tex?.keypad || null, roughness: 0.6 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0.03, 0.056, 0);
    g.add(pad);
    add(g, box(0.18, 0.006, 0.006), m.red, 0, 0.056, 0.05);
    add(g, box(0.18, 0.006, 0.006), m.blue, 0, 0.056, -0.05);
    add(g, box(0.006, 0.006, 0.1), m.yellow, -0.07, 0.056, 0);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    led.position.set(-0.03, 0.062, 0.03);
    g.add(led);
    g.userData.led = led;
  },
};

export function buildWeaponModel(id, tex) {
  const m = mats();
  const g = new THREE.Group();
  g.name = `weapon-${id}`;
  const b = builders[id];
  if (b) b(g, m, tex);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return g;
}

// Collapse a model into a single vertex-colored mesh (one draw call) for third-person use.
const bakedCache = new Map();
const bakedMat = () => M.baked || (M.baked = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }));

export function bakedWeaponGeometry(id, tex) {
  if (bakedCache.has(id)) return bakedCache.get(id);
  const g = buildWeaponModel(id, tex);
  g.updateMatrixWorld(true);
  const geos = [];
  g.traverse((o) => {
    if (!o.isMesh) return;
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    const c = o.material.color || new THREE.Color(0x888888);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geos.push(geo);
  });
  const merged = geos.length ? mergeGeometries(geos, false) : new THREE.BufferGeometry();
  const muzzle = g.userData.muzzle ? g.userData.muzzle.position.clone() : new THREE.Vector3(0, 0, -0.3);
  const res = { geometry: merged, muzzle };
  bakedCache.set(id, res);
  return res;
}

export function bakedWeaponMesh(id, tex) {
  const { geometry, muzzle } = bakedWeaponGeometry(id, tex);
  const mesh = new THREE.Mesh(geometry, bakedMat());
  mesh.castShadow = true;
  mesh.userData.muzzle = muzzle;
  return mesh;
}
