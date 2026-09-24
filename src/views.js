// Client-side meshes for simulation objects without their own renderer: dropped weapons,
// flying grenades and the planted bomb. Synced every frame from the (local or mirrored) sim.
import * as THREE from 'three';
import { bakedWeaponMesh, buildWeaponModel } from './models.js';
import { buildCheeseMesh } from './restaurant.js';
import { NameTag } from './characters.js';

export class PropViews {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'props';
    game.scene.add(this.group);
    this.drops = new Map();
    this.nades = new Map();
    this.bomb = null;
    this.ledUntil = 0;
    this.cheese = new Map();
  }

  // Fried cheese plates (with a floating label) wherever a pickup is available.
  _updatePickups(sim) {
    const t = this.game.realTime;
    for (const it of sim.pickups?.items || []) {
      let v = this.cheese.get(it.id);
      if (!v) {
        const mesh = buildCheeseMesh();
        const tag = new NameTag(this.game.ann.cheese, 'T');
        tag.sprite.position.set(0, 0.45, 0);
        tag.sprite.scale.set(0.16, 0.04, 1);
        mesh.add(tag.sprite);
        v = { mesh, tag };
        this.cheese.set(it.id, v);
        this.group.add(mesh);
      }
      v.mesh.visible = it.available;
      if (!it.available) continue;
      if (v.tag.name !== this.game.ann.cheese) v.tag.label(this.game.ann.cheese);
      v.tag.draw(-1);
      v.tag.sprite.visible = this.game.camera.position.distanceTo(v.mesh.position) < 14;
      v.mesh.position.set(it.x, it.y + Math.sin(t * 2 + it.id) * 0.015, it.z);
      v.mesh.rotation.y = t * 0.4 + it.id;
    }
  }

  _dropMesh(def) {
    const tex = this.game.textures;
    const mesh = def.id === 'c4' ? buildWeaponModel('c4', tex) : bakedWeaponMesh(def.id, tex);
    const holder = new THREE.Group();
    holder.add(mesh);
    if (def.kind !== 'grenade' && def.id !== 'c4') mesh.rotation.z = Math.PI / 2;
    return holder;
  }

  blink() {
    this.ledUntil = this.game.realTime + 0.08;
  }

  clear() {
    for (const m of this.drops.values()) this.group.remove(m);
    for (const m of this.nades.values()) this.group.remove(m);
    this.drops.clear();
    this.nades.clear();
    if (this.bomb) this.group.remove(this.bomb);
    this.bomb = null;
    for (const v of this.cheese.values()) v.mesh.visible = false;
  }

  update(dt) {
    const sim = this.game.sim;
    if (!sim) { this.clear(); return; }

    const seen = new Set();
    for (const it of sim.drops.items) {
      seen.add(it.id);
      let m = this.drops.get(it.id);
      if (!m) {
        m = this._dropMesh(it.def);
        this.drops.set(it.id, m);
        this.group.add(m);
      }
      m.position.copy(it.pos);
      m.rotation.y = it.yaw;
    }
    for (const [id, m] of this.drops) if (!seen.has(id)) { this.group.remove(m); this.drops.delete(id); }

    seen.clear();
    for (const n of sim.grenades.list) {
      seen.add(n.nid);
      let m = this.nades.get(n.nid);
      if (!m) {
        m = bakedWeaponMesh(n.type, this.game.textures);
        this.nades.set(n.nid, m);
        this.group.add(m);
      }
      if (m.position.distanceToSquared(n.pos) > 1e-6) {
        m.rotation.x += dt * 9;
        m.rotation.z += dt * 5;
      }
      m.position.copy(n.pos);
    }
    for (const [id, m] of this.nades) if (!seen.has(id)) { this.group.remove(m); this.nades.delete(id); }
    this._updatePickups(sim);

    const b = sim.round.bomb;
    if (b.state === 'planted' || b.state === 'defused') {
      if (!this.bomb) {
        this.bomb = buildWeaponModel('c4', this.game.textures);
        this.group.add(this.bomb);
      }
      this.bomb.position.set(b.pos.x, b.pos.y + 0.03, b.pos.z);
      this.bomb.rotation.y = b.yaw || 0;
      const led = this.bomb.userData.led;
      if (led) led.visible = b.state === 'planted' && this.game.realTime < this.ledUntil;
    } else if (this.bomb) {
      this.group.remove(this.bomb);
      this.bomb = null;
    }
  }
}
