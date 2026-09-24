// Map decoration that is not part of the collision grid: silos, pipes, painted signs, distant
// cooling towers, ceiling lamps and point lights. Only built on the client (needs a DOM canvas).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function canvasTex(world, w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  world.ownTextures.push(t);
  return t;
}

function siloTexture(world) {
  return canvasTex(world, 512, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#d9dcdc');
    g.addColorStop(1, '#b9bcbc');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(70,74,78,0.55)';
    for (let y = 0; y < h; y += 46) ctx.fillRect(0, y, w, 3); // welded rings
    for (let x = 0; x < w; x += 64) for (let y = 0; y < h; y += 46) ctx.fillRect(x + ((y / 46) % 2) * 32, y, 2, 46);
    for (let k = 0; k < 40; k++) {
      const x = Math.random() * w, y = Math.random() * h * 0.9;
      const len = 30 + Math.random() * 120;
      const gr = ctx.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, 'rgba(120,70,40,0.35)');
      gr.addColorStop(1, 'rgba(120,70,40,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(x, y, 3 + Math.random() * 4, len);
    }
    ctx.fillStyle = '#b8231c';
    ctx.fillRect(0, h * 0.18, w, 26);
  });
}

function radiationTexture(world) {
  return canvasTex(world, 256, 256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = '#f2c417';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#161616';
    ctx.stroke();
    ctx.fillStyle = '#161616';
    for (let k = 0; k < 3; k++) {
      const a0 = -Math.PI / 2 + k * (Math.PI * 2 / 3) - Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(s / 2 + Math.cos(a0) * 22, s / 2 + Math.sin(a0) * 22);
      ctx.arc(s / 2, s / 2, 96, a0, a0 + Math.PI / 3);
      ctx.arc(s / 2, s / 2, 22, a0 + Math.PI / 3, a0, true);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 15, 0, Math.PI * 2);
    ctx.fill();
  });
}

function textTexture(world, text, w, h) {
  const px = 128;
  return canvasTex(world, Math.round(px * w / h), px, (ctx, cw, ch) => {
    ctx.clearRect(0, 0, cw, ch);
    ctx.font = `bold ${Math.round(ch * 0.78)}px Impact, "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(236,196,40,0.92)';
    ctx.fillText(text, cw / 2, ch / 2 + 4);
  });
}

// Pipe along x or z plus wall brackets, as geometries to merge.
function pipeGeometries(d, out) {
  const len = d.a1 - d.a0;
  const g = new THREE.CylinderGeometry(d.r, d.r, len, 12, 1, true);
  const mid = (d.a0 + d.a1) / 2;
  if (d.axis === 'x') g.rotateZ(Math.PI / 2).translate(mid, d.y, d.z);
  else g.rotateX(Math.PI / 2).translate(d.x, d.y, mid);
  out.push(g);
  for (let a = d.a0 + 1; a < d.a1 - 0.5; a += 4) {
    const b = new THREE.BoxGeometry(0.12, d.r * 2.6, 0.12);
    if (d.axis === 'x') b.translate(a, d.y, d.z); else b.translate(d.x, d.y, a);
    out.push(b);
  }
}

// Merge geometries that may differ in having an index.
function merged(list) {
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  const m = mergeGeometries(flat, false);
  list.forEach((g) => g.dispose());
  flat.forEach((g) => g.dispose());
  return m;
}

// Hyperboloid cooling tower with a plume of steam.
function tower(group, d, world, tex) {
  const pts = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const y = t * d.h;
    const r = d.r * (0.62 + 0.38 * Math.pow(Math.abs(t - 0.72) / 0.72, 1.8) * (t < 0.72 ? 1 : 0.55));
    pts.push(new THREE.Vector2(r, y));
  }
  let map = null;
  if (tex.concrete) {
    map = tex.concrete.map.clone();
    map.repeat.set(12, 5);
    map.needsUpdate = true;
    world.ownTextures.push(map);
  }
  const mat = new THREE.MeshStandardMaterial({ map, color: 0xd0d0cc, roughness: 0.95, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), mat);
  m.position.set(d.x, 0, d.z);
  group.add(m);
  const smoke = new THREE.SpriteMaterial({ map: tex.smoke, color: 0xf4f4f2, transparent: true, opacity: 0.55, depthWrite: false });
  for (let k = 0; k < 4; k++) {
    const s = new THREE.Sprite(smoke);
    const sc = d.r * (1.4 + k * 0.5);
    s.scale.set(sc, sc, 1);
    s.position.set(d.x + k * d.r * 0.35, d.h + d.r * 0.3 + k * d.r * 0.55, d.z - k * d.r * 0.2);
    group.add(s);
  }
}

export function buildDecor(world, tex) {
  const L = world.L;
  const group = new THREE.Group();
  group.name = 'decor';
  const steel = new THREE.MeshStandardMaterial({ color: 0x8c9297, roughness: 0.45, metalness: 0.7 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xf2f6ff });
  const pipes = [];
  const lamps = [];
  let siloMat = null, radMat = null;
  for (const d of L.decor || []) {
    if (d.type === 'silo') {
      siloMat ||= new THREE.MeshStandardMaterial({ map: siloTexture(world), roughness: 0.55, metalness: 0.35 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(d.r, d.r, d.h, 40, 1, true), siloMat);
      body.position.set(d.x, d.y + d.h / 2, d.z);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(d.r, 40, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel);
      dome.scale.y = 0.35;
      dome.position.set(d.x, d.y + d.h, d.z);
      dome.castShadow = true;
      group.add(dome);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r + 0.05, 0.08, 6, 40), steel);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(d.x, d.y + 0.25, d.z);
      group.add(ring);
    } else if (d.type === 'pipe') {
      pipeGeometries(d, pipes);
    } else if (d.type === 'sign') {
      let map, w, h;
      if (d.kind === 'radiation') {
        radMat ||= radiationTexture(world);
        map = radMat;
        w = h = d.size;
      } else {
        map = textTexture(world, d.text, d.w, d.h);
        w = d.w;
        h = d.h;
      }
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
        map, transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1,
      }));
      m.position.set(d.x, d.y, d.z);
      m.rotation.y = d.rotY;
      group.add(m);
    } else if (d.type === 'tower') {
      tower(group, d, world, tex);
    } else if (d.type === 'lamp') {
      lamps.push(new THREE.BoxGeometry(d.w, 0.07, d.d).translate(d.x, d.y, d.z));
    }
  }
  if (pipes.length) {
    const m = new THREE.Mesh(merged(pipes), steel);
    m.castShadow = true;
    group.add(m);
  }
  if (lamps.length) group.add(new THREE.Mesh(merged(lamps), lampMat));
  for (const l of L.lights || []) {
    const p = new THREE.PointLight(l.color, l.intensity, l.distance, 1.4);
    p.position.set(l.x, l.y, l.z);
    group.add(p);
  }
  world.group.add(group);
}
