// Box-built third-person soldier with procedural walk/crouch/aim/death animation.
// Each animated limb is one merged, vertex-colored mesh (few draw calls per soldier).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakedWeaponMesh } from './models.js';
import { damp } from './util.js';

const PALETTE = {
  T: { pants: 0x7d6c4e, top: 0x6a5238, vest: 0x46442f, head: 0x2a2724, skin: 0xb08560, gear: 0x2c2a22, boots: 0x2a241c },
  CT: { pants: 0x2e3848, top: 0x34425a, vest: 0x1e2838, head: 0x2b3342, skin: 0xc49a78, gear: 0x151a22, boots: 0x16181c },
};

let bodyMat = null;
const mergedCache = new Map();
const _c = new THREE.Color();

// Collects colored boxes per limb group and bakes them into one mesh per group.
class PartBuilder {
  constructor(team) {
    this.team = team;
    this.groups = new Map();
  }
  box(group, key, w, h, d, color, x = 0, y = 0, z = 0) {
    if (!this.groups.has(group)) this.groups.set(group, { key, parts: [] });
    this.groups.get(group).parts.push({ w, h, d, color, x, y, z });
  }
  finish() {
    bodyMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    for (const [group, { key, parts }] of this.groups) {
      const ck = `${this.team}|${key}`;
      let geo = mergedCache.get(ck);
      if (!geo) {
        const geos = parts.map((p) => {
          const g = new THREE.BoxGeometry(p.w, p.h, p.d);
          g.translate(p.x, p.y, p.z);
          _c.setHex(p.color); // setHex converts sRGB hex into the linear working space
          const n = g.attributes.position.count;
          const col = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
          g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
          return g;
        });
        geo = mergeGeometries(geos, false);
        mergedCache.set(ck, geo);
      }
      const mesh = new THREE.Mesh(geo, bodyMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

const _v = new THREE.Vector3();
const TAG_COLOR = { T: '#f3c552', CT: '#7fb6ff' };

// Name label above a soldier's head (constant screen size). Teammates also get a health bar.
export class NameTag {
  constructor(name, team) {
    this.name = name;
    this.team = team;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 64;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.SpriteMaterial({
      map: this.texture, transparent: true, depthWrite: false, depthTest: true,
      sizeAttenuation: false, fog: false, toneMapped: false,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.scale.set(0.2, 0.05, 1);
    this.sprite.renderOrder = 20;
    this.sprite.visible = false;
    this.drawn = '';
    this.draw(-1);
  }

  label(text) {
    this.name = text;
    this.drawn = '';
  }

  // health < 0 hides the bar.
  draw(health) {
    const key = `${this.name}|${health}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const ctx = this.canvas.getContext('2d');
    const w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    let size = 30;
    ctx.font = `bold ${size}px "Segoe UI", Arial, sans-serif`;
    while (ctx.measureText(this.name).width > w - 12 && size > 14) {
      size -= 2;
      ctx.font = `bold ${size}px "Segoe UI", Arial, sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(this.name, w / 2, 24);
    ctx.fillStyle = TAG_COLOR[this.team] || '#ffffff';
    ctx.fillText(this.name, w / 2, 24);
    if (health >= 0) {
      const bw = 110, bh = 8, bx = (w - bw) / 2, by = 46;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
      ctx.fillStyle = health > 50 ? '#6fdc5c' : health > 25 ? '#f0c040' : '#ff4a3d';
      ctx.fillRect(bx, by, (bw * Math.max(0, Math.min(100, health))) / 100, bh);
    }
    this.texture.needsUpdate = true;
  }
}

export class Character {
  constructor(team, textures) {
    this.team = team;
    this.textures = textures;
    const c = PALETTE[team];
    const B = new PartBuilder(team);
    const root = new THREE.Group();
    this.root = root;

    // Pivots: hips at y=0.9, legs hang from hips.
    this.hips = new THREE.Group();
    this.hips.position.y = 0.9;
    root.add(this.hips);
    B.box(this.hips, 'hips', 0.36, 0.16, 0.22, c.pants, 0, 0.02, 0);

    const leg = (side, name) => {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.1, 0, 0);
      this.hips.add(thigh);
      B.box(thigh, 'thigh', 0.15, 0.46, 0.17, c.pants, 0, -0.23, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.45;
      thigh.add(knee);
      B.box(knee, 'shin', 0.13, 0.44, 0.15, c.pants, 0, -0.22, 0);
      B.box(knee, 'shin', 0.15, 0.1, 0.25, c.boots, 0, -0.41, -0.04);
      return { thigh, knee };
    };
    this.legL = leg(-1);
    this.legR = leg(1);

    // Upper body pivots around the waist so aim pitch bends the torso.
    this.spine = new THREE.Group();
    this.spine.position.y = 0.08;
    this.hips.add(this.spine);
    B.box(this.spine, 'spine', 0.38, 0.52, 0.22, c.top, 0, 0.27, 0);
    B.box(this.spine, 'spine', 0.42, 0.36, 0.28, c.vest, 0, 0.33, 0);
    B.box(this.spine, 'spine', 0.12, 0.1, 0.06, c.gear, -0.1, 0.25, -0.15);
    B.box(this.spine, 'spine', 0.12, 0.1, 0.06, c.gear, 0.1, 0.25, -0.15);

    this.head = new THREE.Group();
    this.head.position.y = 0.5;
    this.spine.add(this.head);
    B.box(this.head, 'head', 0.1, 0.08, 0.1, c.skin, 0, 0.02, 0);
    B.box(this.head, 'head', 0.23, 0.25, 0.24, team === 'T' ? c.head : c.skin, 0, 0.16, 0);
    if (team === 'CT') {
      B.box(this.head, 'head', 0.27, 0.13, 0.29, c.head, 0, 0.3, 0);
      B.box(this.head, 'head', 0.2, 0.05, 0.03, 0x111111, 0, 0.2, -0.125);
    } else {
      B.box(this.head, 'head', 0.2, 0.05, 0.02, c.skin, 0, 0.19, -0.121);
      B.box(this.head, 'head', 0.25, 0.08, 0.26, 0x3b3a36, 0, 0.3, 0);
    }

    const arm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(side * 0.24, 0.47, 0);
      this.spine.add(sh);
      B.box(sh, 'upperArm', 0.11, 0.3, 0.12, c.top, 0, -0.15, 0);
      const el = new THREE.Group();
      el.position.y = -0.29;
      sh.add(el);
      B.box(el, 'foreArm', 0.1, 0.28, 0.1, c.top, 0, -0.14, 0);
      B.box(el, 'foreArm', 0.09, 0.09, 0.1, c.gear, 0, -0.3, 0);
      return { sh, el };
    };
    this.armL = arm(-1);
    this.armR = arm(1);
    B.finish();

    this.weaponMount = new THREE.Group();
    this.weaponMount.position.set(0.1, 0.36, -0.3);
    this.spine.add(this.weaponMount);
    this.weapon = null;
    this.weaponId = null;

    this.tag = null;
    this.walkPhase = Math.random() * 10;
    this.crouchT = 0;
    this.deadT = 0;
    this.deathDir = 1;
    this.kick = 0;
  }

  setName(name) {
    if (!this.tag) {
      this.tag = new NameTag(name, this.team);
      this.root.add(this.tag.sprite);
    } else if (this.tag.name !== name) {
      this.tag.label(name);
    }
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.weapon) this.weaponMount.remove(this.weapon);
    this.weapon = id ? bakedWeaponMesh(id, this.textures) : null;
    if (this.weapon) this.weaponMount.add(this.weapon);
    const pistol = ['glock', 'usp', 'deagle', 'knife', 'he', 'flash', 'smoke', 'c4'].includes(id);
    this.pose = pistol ? 'pistol' : 'rifle';
  }

  muzzleWorld() {
    if (!this.weapon) return null;
    _v.copy(this.weapon.userData.muzzle);
    return this.weapon.localToWorld(_v);
  }

  // state: { pos, yaw, pitch, speed, crouched, alive, onGround, fwdSpeed, sideSpeed }
  update(dt, s) {
    const r = this.root;
    r.position.copy(s.pos);
    r.rotation.y = s.yaw;
    this.crouchT = damp(this.crouchT, s.crouched ? 1 : 0, 14, dt);
    const ct = this.crouchT;
    if (this.tag) this.tag.sprite.position.set(0, 2.12 - ct * 0.5, 0);

    if (!s.alive) {
      this.deadT = Math.min(1, this.deadT + dt * 2.4);
      const e = 1 - (1 - this.deadT) ** 3;
      // Positive X rotation tips the body backwards (up vector toward +Z).
      r.rotation.x = this.deathDir * e * 1.42;
      this.hips.position.y = 0.9 - ct * 0.42 * (1 - e);
      this.hips.rotation.y = 0;
      this.spine.rotation.x = 0;
      this.head.rotation.x = 0.2 * e;
      this.legL.thigh.rotation.x = 0.15 * e;
      this.legR.thigh.rotation.x = -0.1 * e;
      this.legL.knee.rotation.x = -0.2 * e;
      this.legR.knee.rotation.x = 0;
      this.armL.sh.rotation.set(0.3 * e, 0, -1.2 * e);
      this.armR.sh.rotation.set(0.2 * e, 0, 1.3 * e);
      this.armL.el.rotation.set(0, 0, 0);
      this.armR.el.rotation.set(0, 0, 0);
      return;
    }
    this.deadT = 0;
    r.rotation.x = 0;

    const sp = s.speed;
    const moving = sp > 0.3 && s.onGround;
    this.walkPhase += dt * (moving ? 2.1 + sp * 1.25 : 0);
    const amp = moving ? Math.min(1, sp / 5) : 0;
    const sw = Math.sin(this.walkPhase) * amp;
    const dir = s.fwdSpeed < -0.2 ? -1 : 1;

    // Positive X rotation swings a hanging limb forward (toward -Z).
    this.hips.position.y = 0.9 - ct * 0.42 - (moving ? Math.abs(Math.cos(this.walkPhase)) * 0.03 * amp : 0);
    const baseThigh = ct * 1.15;
    const baseKnee = -ct * 1.9;
    this.legL.thigh.rotation.x = baseThigh + sw * 0.7 * dir;
    this.legR.thigh.rotation.x = baseThigh - sw * 0.7 * dir;
    this.legL.knee.rotation.x = baseKnee - Math.max(0, sw * dir) * 0.9;
    this.legR.knee.rotation.x = baseKnee - Math.max(0, -sw * dir) * 0.9;
    this.hips.rotation.y = s.sideSpeed * 0.06;

    // Aim: bend spine with pitch (positive pitch = look up = lean back).
    const pitch = Math.max(-1, Math.min(1, s.pitch));
    this.spine.rotation.x = pitch * 0.75 - ct * 0.25;
    this.head.rotation.x = pitch * 0.25 + ct * 0.2;
    this.kick = damp(this.kick, 0, 18, dt);
    this.weaponMount.rotation.x = this.kick * 0.1 + ct * 0.25;
    if (this.pose === 'rifle') {
      this.armR.sh.rotation.set(1.05, 0, -0.35);
      this.armR.el.rotation.set(0.5, 0, 0);
      this.armL.sh.rotation.set(1.35, 0, 0.6);
      this.armL.el.rotation.set(0.35, 0, -0.3);
      this.weaponMount.position.set(0.1, 0.34, -0.3 + this.kick * 0.06);
    } else {
      this.armR.sh.rotation.set(1.45, 0, -0.25);
      this.armR.el.rotation.set(0.1, 0, 0);
      this.armL.sh.rotation.set(1.4, 0, 0.35);
      this.armL.el.rotation.set(0.1, 0, -0.2);
      this.weaponMount.position.set(0.04, 0.4, -0.5 + this.kick * 0.06);
    }
  }

  fired() {
    this.kick = 1;
  }

  setDeathDirection(fromBehind) {
    this.deathDir = fromBehind ? -1 : 1;
  }
}
