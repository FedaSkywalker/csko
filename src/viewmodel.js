// First-person weapon + arms, rendered in its own scene on top of the world (never clips walls).
import * as THREE from 'three';
import { buildWeaponModel } from './models.js';
import { damp, clamp } from './util.js';

const smooth = (a, b, t) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

const BASE = {
  rifle: { pos: [0.1, -0.118, -0.24], rot: [0, 0.035, 0] },
  smg: { pos: [0.1, -0.11, -0.25], rot: [0, 0.035, 0] },
  sniper: { pos: [0.12, -0.14, -0.21], rot: [0, 0.03, 0] },
  pistol: { pos: [0.12, -0.125, -0.37], rot: [0, 0.05, 0] },
  melee: { pos: [0.13, -0.12, -0.3], rot: [0.2, 0.7, -0.2] },
  grenade: { pos: [0.12, -0.12, -0.27], rot: [0.1, -0.2, 0] },
  bomb: { pos: [0.02, -0.2, -0.34], rot: [0.75, 0, 0] },
};

const SLEEVE = { T: 0x6b5638, CT: 0x2c3b55 };
const GLOVE = { T: 0x3b3326, CT: 0x23262c };

export class ViewModel {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(56, 1, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x8a7050, 1.2);
    this.sun = new THREE.DirectionalLight(0xfff0dd, 2.2);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    this.cache = new Map();
    this.current = null;
    this.def = null;
    this.team = 'CT';

    const flashMat = new THREE.MeshBasicMaterial({
      map: game.textures.muzzle, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMat);
    this.flash.visible = false;
    this.flashSide = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.08), flashMat);
    this.flashSide.visible = false;
    this.flashT = 0;

    this.kick = 0;
    this.drawT = 1;
    this.drawDur = 0.5;
    this.reloadT = -1;
    this.reloadDur = 1;
    this.knifeT = -1;
    this.knifeDur = 0.4;
    this.knifeHeavy = false;
    this.inspectT = -1;
    this.swayX = 0;
    this.swayY = 0;
    this.bobT = 0;
    this.bobAmp = 0;
    this.landDip = 0;
    this.pinT = 0;
    this.visible = true;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  _build(id, team) {
    const key = `${id}|${team}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const holder = new THREE.Group();
    const model = buildWeaponModel(id, this.game.textures);
    holder.add(model);
    model.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    const sleeve = new THREE.MeshStandardMaterial({ color: SLEEVE[team], roughness: 0.9 });
    const glove = new THREE.MeshStandardMaterial({ color: GLOVE[team], roughness: 0.75 });
    const arm = (hand, elbowOffset, handSize = [0.072, 0.085, 0.1]) => {
      const g = new THREE.Group();
      const hm = new THREE.Mesh(new THREE.BoxGeometry(...handSize), glove);
      hm.position.set(...hand);
      g.add(hm);
      const start = new THREE.Vector3(...hand);
      const end = new THREE.Vector3(hand[0] + elbowOffset[0], hand[1] + elbowOffset[1], hand[2] + elbowOffset[2]);
      const len = start.distanceTo(end);
      const fm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, len), sleeve);
      fm.position.copy(start).add(end).multiplyScalar(0.5);
      fm.lookAt(end);
      g.add(fm);
      holder.add(g);
    };
    const R = [0.055, 0.07, 0.075];
    const Lh = [0.06, 0.055, 0.09];
    switch (id) {
      case 'ak47': case 'm4a1': case 'mp5':
        arm([0.0, -0.055, 0.05], [0.07, -0.26, 0.2], R);
        arm([-0.005, -0.012, id === 'mp5' ? -0.17 : -0.3], [-0.11, -0.28, 0.22], Lh);
        break;
      case 'awp':
        arm([0.0, -0.06, 0.36], [0.07, -0.26, 0.2], R);
        arm([-0.005, -0.035, -0.12], [-0.11, -0.28, 0.22], Lh);
        break;
      case 'glock': case 'usp': case 'deagle':
        arm([0.0, -0.055, 0.04], [0.07, -0.26, 0.2], R);
        arm([-0.022, -0.075, 0.035], [-0.13, -0.25, 0.2], [0.045, 0.06, 0.07]);
        break;
      case 'knife':
        arm([0.0, 0.0, 0.035], [0.06, -0.26, 0.18], [0.05, 0.055, 0.08]);
        break;
      case 'he': case 'flash': case 'smoke':
        arm([0.0, -0.035, 0.02], [0.06, -0.26, 0.18], [0.06, 0.06, 0.07]);
        break;
      case 'c4':
        arm([0.1, -0.02, 0.02], [0.12, -0.24, 0.26], [0.07, 0.05, 0.09]);
        arm([-0.1, -0.02, 0.02], [-0.12, -0.24, 0.26], [0.07, 0.05, 0.09]);
        break;
      default:
        break;
    }
    const entry = { holder, model, magBase: model.userData.mag ? model.userData.mag.position.clone() : null };
    this.cache.set(key, entry);
    return entry;
  }

  setWeapon(def, team, drawDur) {
    this.team = team;
    const entry = this._build(def.id, team);
    if (this.current !== entry) {
      if (this.current) this.pivot.remove(this.current.holder);
      this.pivot.add(entry.holder);
      this.current = entry;
      const muzzle = entry.model.userData.muzzle;
      if (muzzle) {
        muzzle.add(this.flash);
        muzzle.add(this.flashSide);
        this.flashSide.rotation.y = Math.PI / 2;
      }
    }
    this.def = def;
    this.drawT = 0;
    this.drawDur = drawDur || def.draw || 0.5;
    this.reloadT = -1;
    this.knifeT = -1;
    this.inspectT = -1;
    if (entry.magBase) entry.model.userData.mag.position.copy(entry.magBase);
  }

  onFire(def) {
    const k = { rifle: 0.55, smg: 0.4, sniper: 1, pistol: 0.75 }[def.kind] ?? 0.5;
    this.kick = Math.min(1.4, this.kick + k * (def.id === 'deagle' ? 1.5 : 1));
    this.inspectT = -1;
    if (def.id !== 'usp' && def.id !== 'mp5') {
      this.flashT = 0.045;
      this.flash.rotation.z = Math.random() * Math.PI;
      const s = 0.8 + Math.random() * 0.5;
      this.flash.scale.set(s, s, s);
      this.flash.visible = true;
      this.flashSide.visible = true;
    }
  }

  onReload(dur) { this.reloadT = 0; this.reloadDur = dur; this.inspectT = -1; }
  onKnife(heavy) { this.knifeT = 0; this.knifeHeavy = heavy; this.knifeDur = heavy ? 0.7 : 0.38; this.inspectT = -1; }
  onLand(speed) { this.landDip = Math.min(1, speed / 12); }
  onInspect() { if (this.reloadT < 0 && this.drawT >= 1) this.inspectT = 0; }

  // Transform the world sun direction into camera space so gun shading matches the scene.
  updateLighting(worldCamera, sunDir, covered) {
    const inv = worldCamera.quaternion.clone().invert();
    const d = sunDir.clone().applyQuaternion(inv);
    this.sun.position.copy(d.multiplyScalar(5));
    this.sun.intensity = damp(this.sun.intensity, covered ? 0.25 : 2.2, 6, 1 / 60);
    this.hemi.intensity = damp(this.hemi.intensity, covered ? 0.55 : 1.2, 6, 1 / 60);
  }

  update(dt, st) {
    if (!this.current || !this.def) return;
    const def = this.def;
    const base = BASE[def.kind] || BASE.rifle;
    const p = this.pivot;
    let px = base.pos[0], py = base.pos[1], pz = base.pos[2];
    let rx = base.rot[0], ry = base.rot[1], rz = base.rot[2];

    // Bob & sway
    const sp = st.onGround ? Math.min(1, st.speed / 6) : 0;
    this.bobAmp = damp(this.bobAmp, sp, 8, dt);
    this.bobT += dt * (4 + st.speed * 1.3);
    px += Math.sin(this.bobT) * 0.009 * this.bobAmp;
    py -= Math.abs(Math.cos(this.bobT)) * 0.011 * this.bobAmp;
    rz += Math.sin(this.bobT) * 0.012 * this.bobAmp;
    this.swayX = damp(this.swayX, clamp(-st.mouseDX * 0.0009, -0.06, 0.06), 9, dt);
    this.swayY = damp(this.swayY, clamp(-st.mouseDY * 0.0009, -0.05, 0.05), 9, dt);
    ry += this.swayX;
    rx += this.swayY;
    px += this.swayX * 0.12;
    py += this.swayY * 0.08;
    if (!st.onGround) py += 0.012;
    this.landDip = damp(this.landDip, 0, 7, dt);
    py -= this.landDip * 0.035;
    if (st.crouched) { py += 0.006; px -= 0.004; }

    // Recoil
    this.kick = damp(this.kick, 0, def.kind === 'sniper' ? 7 : 15, dt);
    pz += this.kick * (def.kind === 'pistol' ? 0.035 : 0.045);
    rx += this.kick * (def.kind === 'pistol' ? 0.16 : 0.08);
    py += this.kick * 0.006;

    // Draw
    if (this.drawT < 1) {
      this.drawT = Math.min(1, this.drawT + dt / this.drawDur);
      const e = 1 - (1 - this.drawT) ** 3;
      py -= (1 - e) * 0.22;
      rx -= (1 - e) * 0.9;
      rz += (1 - e) * 0.3;
    }

    // Reload
    const mag = this.current.model.userData.mag;
    if (this.reloadT >= 0) {
      this.reloadT += dt / this.reloadDur;
      const t = this.reloadT;
      const tilt = smooth(0, 0.15, t) - smooth(0.82, 1, t);
      rz += tilt * 0.45;
      rx += tilt * 0.18;
      py -= tilt * 0.03;
      px -= tilt * 0.02;
      if (mag && this.current.magBase) {
        const out = smooth(0.18, 0.36, t) - smooth(0.5, 0.68, t);
        mag.position.copy(this.current.magBase);
        mag.position.y -= out * 0.3;
        mag.position.z += out * 0.05;
      }
      const jerk = smooth(0.82, 0.86, t) - smooth(0.86, 0.95, t);
      pz += jerk * 0.03;
      rx -= jerk * 0.05;
      if (this.reloadT >= 1) {
        this.reloadT = -1;
        if (mag && this.current.magBase) mag.position.copy(this.current.magBase);
      }
    }

    // Knife swings
    if (this.knifeT >= 0) {
      this.knifeT += dt / this.knifeDur;
      const t = this.knifeT;
      if (this.knifeHeavy) {
        const w = smooth(0, 0.35, t) - smooth(0.55, 1, t);
        pz -= w * 0.16;
        py += w * 0.04;
        px -= w * 0.05;
        rx -= w * 0.9;
      } else {
        const w = Math.sin(clamp(t, 0, 1) * Math.PI);
        px -= w * 0.12;
        py += w * 0.03;
        rz -= w * 0.9;
        ry += w * 0.7;
      }
      if (t >= 1) this.knifeT = -1;
    }

    // Grenade: pin pulled pose
    this.pinT = damp(this.pinT, st.pinPulled ? 1 : 0, 10, dt);
    py += this.pinT * 0.05;
    pz += this.pinT * 0.06;
    rx -= this.pinT * 0.35;

    // Bomb planting jitter
    if (st.planting) {
      py += Math.sin(st.time * 30) * 0.003;
      rx += 0.1;
    }

    // Inspect
    if (this.inspectT >= 0) {
      this.inspectT += dt / 2.6;
      const w = smooth(0, 0.2, this.inspectT) - smooth(0.8, 1, this.inspectT);
      ry += w * (0.9 + Math.sin(this.inspectT * 6) * 0.15);
      rz += w * 0.5;
      px -= w * 0.05;
      py += w * 0.02;
      if (this.inspectT >= 1) this.inspectT = -1;
    }

    p.position.set(px, py, pz);
    p.rotation.set(rx, ry, rz);

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flash.visible = false; this.flashSide.visible = false; }
    }
    this.root.visible = this.visible;
  }
}
