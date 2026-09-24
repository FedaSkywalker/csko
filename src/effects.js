// Visual effects: billboard particles, bullet decals, tracers, muzzle/explosion light flashes.
import * as THREE from 'three';
import { MAT } from './map/layout.js';
import { LOOK, METALLIC } from './map/materials.js';

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute float iSize;
attribute vec4 iColor;
attribute float iRot;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = uv;
  vColor = iColor;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iRot), s = sin(iRot);
  vec2 p = position.xy;
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  mv.xy += p * iSize;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.004) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

class ParticleSystem {
  constructor(max, texture, additive) {
    this.max = max;
    this.count = 0;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (const a of [this.aPos, this.aSize, this.aColor, this.aRot]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iSize', this.aSize);
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iRot', this.aRot);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 4 : 3;
    // CPU-side particle state
    const F = (n = 1) => new Float32Array(max * n);
    this.p = F(3); this.v = F(3); this.age = F(); this.life = F(); this.s0 = F(); this.s1 = F();
    this.c = F(3); this.a0 = F(); this.rot = F(); this.rotV = F(); this.grav = F(); this.drag = F();
    this.fadeIn = F(); this.fadeOut = F();
  }

  emit(o) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.p[i * 3] = o.x; this.p[i * 3 + 1] = o.y; this.p[i * 3 + 2] = o.z;
    this.v[i * 3] = o.vx || 0; this.v[i * 3 + 1] = o.vy || 0; this.v[i * 3 + 2] = o.vz || 0;
    this.age[i] = 0;
    this.life[i] = o.life || 1;
    this.s0[i] = o.size ?? 0.2;
    this.s1[i] = o.sizeEnd ?? this.s0[i];
    this.c[i * 3] = o.r ?? 1; this.c[i * 3 + 1] = o.g ?? 1; this.c[i * 3 + 2] = o.b ?? 1;
    this.a0[i] = o.a ?? 1;
    this.rot[i] = o.rot ?? Math.random() * Math.PI * 2;
    this.rotV[i] = o.rotV || 0;
    this.grav[i] = o.gravity || 0;
    this.drag[i] = o.drag || 0;
    this.fadeIn[i] = o.fadeIn || 0;
    this.fadeOut[i] = o.fadeOut || this.life[i];
  }

  _copy(dst, src) {
    for (let k = 0; k < 3; k++) {
      this.p[dst * 3 + k] = this.p[src * 3 + k];
      this.v[dst * 3 + k] = this.v[src * 3 + k];
      this.c[dst * 3 + k] = this.c[src * 3 + k];
    }
    this.age[dst] = this.age[src]; this.life[dst] = this.life[src];
    this.s0[dst] = this.s0[src]; this.s1[dst] = this.s1[src]; this.a0[dst] = this.a0[src];
    this.rot[dst] = this.rot[src]; this.rotV[dst] = this.rotV[src];
    this.grav[dst] = this.grav[src]; this.drag[dst] = this.drag[src];
    this.fadeIn[dst] = this.fadeIn[src]; this.fadeOut[dst] = this.fadeOut[src];
  }

  update(dt) {
    let i = 0;
    const P = this.aPos.array, S = this.aSize.array, C = this.aColor.array, R = this.aRot.array;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.count--;
        if (i !== this.count) this._copy(i, this.count);
        continue;
      }
      const dr = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= dr; this.v[i * 3 + 1] *= dr; this.v[i * 3 + 2] *= dr;
      this.v[i * 3 + 1] -= this.grav[i] * dt;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.rot[i] += this.rotV[i] * dt;
      const t = this.age[i] / this.life[i];
      const remain = this.life[i] - this.age[i];
      let a = this.a0[i] * Math.min(1, remain / this.fadeOut[i]);
      if (this.fadeIn[i] > 0) a *= Math.min(1, this.age[i] / this.fadeIn[i]);
      P[i * 3] = this.p[i * 3]; P[i * 3 + 1] = this.p[i * 3 + 1]; P[i * 3 + 2] = this.p[i * 3 + 2];
      S[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      C[i * 4] = this.c[i * 3]; C[i * 4 + 1] = this.c[i * 3 + 1]; C[i * 4 + 2] = this.c[i * 3 + 2]; C[i * 4 + 3] = a;
      R[i] = this.rot[i];
      i++;
    }
    this.geo.instanceCount = this.count;
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aRot.needsUpdate = true;
  }

  clear() { this.count = 0; this.geo.instanceCount = 0; }
}

const SURFACE_COLOR = Object.fromEntries(Object.entries(LOOK).map(([m, l]) => [m, l.impact]));

export class Effects {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    const tex = game.textures;
    const dot = softDot();
    this.add = new ParticleSystem(1500, dot, true);
    this.alpha = new ParticleSystem(2500, tex.smoke, false);
    scene.add(this.alpha.mesh, this.add.mesh);

    // Bullet decals (instanced ring buffer).
    this.maxDecals = 320;
    this.decals = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        map: tex.bulletHole, transparent: true, depthWrite: false, roughness: 1,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }),
      this.maxDecals,
    );
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 2;
    this.decalIdx = 0;
    scene.add(this.decals);

    // Tracers
    this.maxTracers = 64;
    const tg = new THREE.BufferGeometry();
    this.tPos = new Float32Array(this.maxTracers * 6);
    this.tCol = new Float32Array(this.maxTracers * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo = tg;
    this.tracerLines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    this.tracerLines.frustumCulled = false;
    this.tracerLines.renderOrder = 5;
    scene.add(this.tracerLines);
    this.tracers = [];

    // Pooled lights for flashes (kept in the scene so shaders never recompile).
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffc070, 0, 9, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ light: l, t: 0, dur: 0.06, peak: 0 });
    }
    this.lightIdx = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._z = new THREE.Vector3(0, 0, 1);
  }

  flash(x, y, z, intensity = 6, dur = 0.06, color = 0xffc070, distance = 9) {
    const L = this.lights[this.lightIdx];
    this.lightIdx = (this.lightIdx + 1) % this.lights.length;
    L.light.position.set(x, y, z);
    L.light.color.setHex(color);
    L.light.distance = distance;
    L.t = dur;
    L.dur = dur;
    L.peak = intensity;
    L.light.intensity = intensity;
  }

  decal(x, y, z, nx, ny, nz, size = 0.1) {
    const n = this._n.set(nx, ny, nz).normalize();
    this._q.setFromUnitVectors(this._z, n);
    this._q2.setFromAxisAngle(this._z, Math.random() * Math.PI * 2);
    this._q.multiply(this._q2);
    this._p.set(x + nx * 0.004, y + ny * 0.004, z + nz * 0.004);
    this._s.set(size, size, size);
    this._m.compose(this._p, this._q, this._s);
    this.decals.setMatrixAt(this.decalIdx, this._m);
    this.decalIdx = (this.decalIdx + 1) % this.maxDecals;
    this.decals.count = Math.max(this.decals.count, this.decalIdx === 0 ? this.maxDecals : this.decalIdx);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  impact(x, y, z, nx, ny, nz, mat, exit = false, knife = false) {
    const col = SURFACE_COLOR[mat] || SURFACE_COLOR[MAT.WALL];
    if (!knife) this.decal(x, y, z, nx, ny, nz, METALLIC.has(mat) ? 0.07 : 0.1);
    const n = knife ? 3 : 6;
    for (let i = 0; i < n; i++) {
      this.alpha.emit({
        x: x + nx * 0.05, y: y + ny * 0.05, z: z + nz * 0.05,
        vx: nx * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.8,
        vy: ny * (0.6 + Math.random()) + Math.random() * 0.6,
        vz: nz * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.8,
        life: 0.5 + Math.random() * 0.6, size: 0.12, sizeEnd: 0.55 + Math.random() * 0.3,
        r: col[0], g: col[1], b: col[2], a: 0.55, drag: 3, gravity: -0.2,
      });
    }
    for (let i = 0; i < 5; i++) {
      this.alpha.emit({
        x, y, z,
        vx: nx * 2 + (Math.random() - 0.5) * 3, vy: ny * 2 + Math.random() * 2.5, vz: nz * 2 + (Math.random() - 0.5) * 3,
        life: 0.5 + Math.random() * 0.4, size: 0.035, r: col[0] * 0.6, g: col[1] * 0.6, b: col[2] * 0.6, a: 1, gravity: 12,
      });
    }
    if (METALLIC.has(mat) || (!exit && Math.random() < 0.25)) {
      for (let i = 0; i < 8; i++) {
        this.add.emit({
          x, y, z,
          vx: nx * 3 + (Math.random() - 0.5) * 6, vy: ny * 3 + Math.random() * 4, vz: nz * 3 + (Math.random() - 0.5) * 6,
          life: 0.12 + Math.random() * 0.2, size: 0.05, r: 1, g: 0.75, b: 0.35, a: 1, gravity: 14,
        });
      }
    }
  }

  blood(x, y, z, dx, dy, dz, head) {
    const n = head ? 16 : 9;
    for (let i = 0; i < n; i++) {
      this.alpha.emit({
        x, y, z,
        vx: dx * (1 + Math.random() * 2) + (Math.random() - 0.5) * 1.5,
        vy: dy * 2 + Math.random() * 1.2,
        vz: dz * (1 + Math.random() * 2) + (Math.random() - 0.5) * 1.5,
        life: 0.35 + Math.random() * 0.35, size: head ? 0.14 : 0.1, sizeEnd: head ? 0.45 : 0.3,
        r: 0.45, g: 0.02, b: 0.02, a: 0.85, gravity: 5, drag: 2,
      });
    }
  }

  muzzle(x, y, z, big = false) {
    this.add.emit({ x, y, z, life: 0.05, size: big ? 0.6 : 0.4, sizeEnd: big ? 0.8 : 0.55, r: 1, g: 0.8, b: 0.45, a: 1 });
    this.alpha.emit({ x, y, z, vy: 0.5, life: 0.5, size: 0.15, sizeEnd: 0.6, r: 0.7, g: 0.7, b: 0.7, a: 0.25, drag: 2 });
    this.flash(x, y, z, big ? 10 : 6, 0.05);
  }

  tracer(shooter, origin, ex, ey, ez, def) {
    if (def.kind === 'melee') return;
    const g = this.game;
    let sx, sy, sz;
    if (shooter === g.player && !g.spectating) {
      if (Math.random() < 0.5) return;
      const cam = g.camera;
      const r = this._p.set(1, 0, 0).applyQuaternion(cam.quaternion);
      const u = this._n.set(0, 1, 0).applyQuaternion(cam.quaternion);
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      sx = origin.x + r.x * 0.12 - u.x * 0.1 + f.x * 0.7;
      sy = origin.y + r.y * 0.12 - u.y * 0.1 + f.y * 0.7;
      sz = origin.z + r.z * 0.12 - u.z * 0.1 + f.z * 0.7;
    } else {
      const m = shooter.model?.muzzleWorld?.();
      if (m) { sx = m.x; sy = m.y; sz = m.z; } else { sx = origin.x; sy = origin.y - 0.1; sz = origin.z; }
    }
    const len = Math.hypot(ex - sx, ey - sy, ez - sz);
    if (len < 2) return;
    if (this.tracers.length >= this.maxTracers) this.tracers.shift();
    this.tracers.push({ sx, sy, sz, dx: (ex - sx) / len, dy: (ey - sy) / len, dz: (ez - sz) / len, len, d: 0, speed: 380 });
  }

  update(dt) {
    this.add.update(dt);
    this.alpha.update(dt);
    // tracers
    let k = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.d += t.speed * dt;
      if (t.d - 3 > t.len) this.tracers.splice(i, 1);
    }
    for (const t of this.tracers) {
      const a = Math.min(t.d, t.len), b = Math.max(0, Math.min(t.d - 3, t.len));
      const o = k * 6;
      this.tPos[o] = t.sx + t.dx * b; this.tPos[o + 1] = t.sy + t.dy * b; this.tPos[o + 2] = t.sz + t.dz * b;
      this.tPos[o + 3] = t.sx + t.dx * a; this.tPos[o + 4] = t.sy + t.dy * a; this.tPos[o + 5] = t.sz + t.dz * a;
      this.tCol[o] = 0.25; this.tCol[o + 1] = 0.2; this.tCol[o + 2] = 0.1;
      this.tCol[o + 3] = 1.0; this.tCol[o + 4] = 0.85; this.tCol[o + 5] = 0.5;
      k++;
    }
    this.tracerGeo.setDrawRange(0, k * 2);
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;
    for (const L of this.lights) {
      if (L.t > 0) {
        L.t -= dt;
        L.light.intensity = Math.max(0, L.peak * (L.t / L.dur));
      } else L.light.intensity = 0;
    }
  }

  explosion(x, y, z, big = false) {
    const s = big ? 2.2 : 1;
    for (let i = 0; i < 40 * s; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = (3 + Math.random() * 7) * s;
      this.add.emit({
        x, y: y + 0.3, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp,
        life: 0.25 + Math.random() * 0.45, size: 0.8 * s, sizeEnd: 2.4 * s, r: 1, g: 0.55 + Math.random() * 0.2, b: 0.15, a: 0.9, drag: 4,
      });
    }
    for (let i = 0; i < 26 * s; i++) {
      const a = Math.random() * Math.PI * 2, sp = (1 + Math.random() * 3) * s;
      this.alpha.emit({
        x: x + (Math.random() - 0.5), y: y + 0.5 + Math.random(), z: z + (Math.random() - 0.5),
        vx: Math.cos(a) * sp, vy: 1 + Math.random() * 2 * s, vz: Math.sin(a) * sp,
        life: 1.8 + Math.random() * 2 * s, size: 1.4 * s, sizeEnd: 4.5 * s, r: 0.28, g: 0.26, b: 0.24, a: 0.7, drag: 1.5, fadeIn: 0.1,
      });
    }
    for (let i = 0; i < 30; i++) {
      this.add.emit({
        x, y: y + 0.2, z, vx: (Math.random() - 0.5) * 18 * s, vy: Math.random() * 12 * s, vz: (Math.random() - 0.5) * 18 * s,
        life: 0.4 + Math.random() * 0.6, size: 0.07, r: 1, g: 0.7, b: 0.3, a: 1, gravity: 16,
      });
    }
    this.flash(x, y + 1, z, big ? 120 : 45, big ? 0.6 : 0.3, 0xffa040, big ? 60 : 22);
  }

  smokeCloud(x, y, z, duration) {
    for (let i = 0; i < 44; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      const sp = 1.5 + r * 5.5;
      this.alpha.emit({
        x, y: y + 0.4 + Math.random() * 0.6, z,
        vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 2.4, vz: Math.sin(a) * sp,
        life: duration + Math.random() * 1.5, size: 1.6, sizeEnd: 4.2 + Math.random() * 1.6,
        r: 0.78, g: 0.78, b: 0.8, a: 0.9, drag: 1.6, fadeIn: 0.6, fadeOut: 3, rotV: (Math.random() - 0.5) * 0.2,
      });
    }
  }

  clear() {
    this.add.clear();
    this.alpha.clear();
    this.decals.count = 0;
    this.decalIdx = 0;
    this.tracers.length = 0;
  }
}
