// Client: renderer, scenes, camera, input, audio, HUD. Drives a local Sim (single-player) or mirrors
// a remote Sim from a server room (multiplayer), predicting the local player's movement.
import * as THREE from 'three';
import { DT, DEG, WEAPONS, NET_INTERP } from './config.js';
import { validMap, DEFAULT_MAP } from './map/layout.js';
import { METALLIC, WOODEN } from './map/materials.js';
import { loadMap } from './map/index.js';
import { createTextures } from './textures.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { makeCmd, recoilAt } from './agent.js';
import { Sim } from './sim.js';
import { Character } from './characters.js';
import { ViewModel } from './viewmodel.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { PropViews } from './views.js';
import { buildRestaurant } from './restaurant.js';
import { NetClient } from './net.js';
import { decodeEvent, encodeCmd, resolveDef } from './netcodec.js';
import { clamp, dirFromAngles, damp, wrapAngle } from './util.js';
import { line, announcer } from './dialect.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _hit = {};

// Sky, fog and light colors per map style.
const ATMOSPHERE = {
  desert: {
    fog: [0xdccbaa, 80, 280], top: 0x3a78c9, horizon: 0xeadcc0, ground: 0xa89070, sunColor: 0xfff1cc,
    hemi: [0xc4dcff, 0xb39572, 0.55], sun: [0xfff0d8, 3.1], exposure: 1.05, env: 0.55, sunDir: [0.5, 0.78, 0.32],
  },
  industrial: {
    fog: [0xc3ccd4, 90, 330], top: 0x4a7cbd, horizon: 0xdce4ea, ground: 0x878c91, sunColor: 0xfff5e2,
    hemi: [0xd0e0ff, 0x84888c, 0.62], sun: [0xfff3e4, 2.9], exposure: 1.0, env: 0.6, sunDir: [0.42, 0.8, 0.43],
  },
};

export class Game {
  constructor(canvas, { settings, test = false }) {
    this.canvas = canvas;
    this.settings = settings;
    this.testMode = test;
    this.autoStep = !test;
    this.realTime = 0;
    this.acc = 0;
    this.state = 'menu';
    this.mode = 'none'; // 'local' | 'net'

    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: test });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.quality === 'low' ? 1 : 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.autoClear = false;
    r.info.autoReset = false;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xdccbaa, 80, 280);
    this.camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.05, 900);
    this.camera.rotation.order = 'YXZ';

    this.textures = createTextures(r);
    this.sunDir = new THREE.Vector3(0.5, 0.78, 0.32).normalize();
    this._setupLights();
    this._setupSky();
    this.map = null;
    this.world = null;
    this.restaurant = null;
    this.loadMap(settings.map || DEFAULT_MAP);

    this.input = new Input(canvas);
    this.audio = new AudioSys();
    this.audio.setVolume(settings.volume);
    this.audio.voice = settings.voice;
    this.ann = announcer(!!settings.dialect);
    this.audio.lang = this.ann.lang;
    this.audio.occlusion = (x, y, z) => {
      const c = this.camera.position;
      return !this.world.lineClear(c.x, c.y, c.z, x, y + 0.5, z);
    };
    this.sim = null;
    this.player = null;
    this.models = new Set();
    this.effects = new Effects(this);
    this.views = new PropViews(this);
    this.viewmodel = new ViewModel(this);
    this.viewmodel.scene.environment = this.envTexture;
    this.hud = new HUD(this);

    this.pcmd = makeCmd();
    this.viewYaw = 0;
    this.viewPitch = 0;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.spectating = false;
    this.spectateTarget = null;
    this.spectateAt = 0;
    this.deathInfo = '';
    this.shakeAmt = 0;
    this.crosshairAgent = null;
    this.speakNext = 0;
    this.onMatchOver = null;
    this.onMatchStart = null;
    this.onDisconnect = null;

    // Network state
    this.net = null;
    this.netId = null;
    this.cmdSeq = 0;
    this.pending = [];
    this.timeOffset = null;
    this.tickScale = 1;
    this.predOffset = new THREE.Vector3();
    this.netStats = { predErr: 0, snaps: 0, q: 0 };

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // Sim accessors used by HUD, effects and tests.
  get agents() { return this.sim ? this.sim.agents : []; }
  get round() { return this.sim.round; }
  get drops() { return this.sim.drops; }
  get grenades() { return this.sim.grenades; }
  get shop() { return this.sim.shop; }
  get events() { return this.sim.events; }
  get time() { return this.sim ? this.sim.time : 0; }
  zoneName(x, z, y) { return this.sim ? this.sim.zoneName(x, z, y) : ''; }

  // Switch the rendered map (world meshes, decor, restaurant, radar, atmosphere). The same map
  // object (layout + collision + nav) is handed to every Sim created afterwards.
  loadMap(id) {
    id = validMap(id);
    if (this.map && this.map.id === id) return this.map;
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
    if (this.restaurant) {
      this.scene.remove(this.restaurant.group);
      this.restaurant.group.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
      });
      this.restaurant = null;
    }
    const m = loadMap(id);
    this.map = m;
    this.layout = m.layout;
    this.world = m.world;
    m.world.buildMeshes(this.textures, m.nav);
    this.scene.add(m.world.group);
    this.restaurant = buildRestaurant(this);
    this._applyAtmosphere(ATMOSPHERE[m.layout.atmosphere] || ATMOSPHERE.desert);
    this.hud?.buildRadar();
    return m;
  }

  // ------------------------------------------------------------ setup
  _setupLights() {
    this.hemi = new THREE.HemisphereLight(0xc4dcff, 0xb39572, 0.55);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 3.1);
    sun.castShadow = true;
    const hi = this.settings.quality !== 'low';
    sun.shadow.mapSize.set(hi ? 4096 : 2048, hi ? 4096 : 2048);
    const sc = sun.shadow.camera;
    sc.left = -88; sc.right = 88; sc.top = 88; sc.bottom = -88;
    sc.near = 20; sc.far = 320;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 1.5;
    this.scene.add(sun, sun.target);
    this.sun = sun;
  }

  _skyMaterial() {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x3a78c9) },
        horizon: { value: new THREE.Color(0xeadcc0) },
        ground: { value: new THREE.Color(0xa89070) },
        sunDir: { value: this.sunDir },
        sunColor: { value: new THREE.Color(0xfff1cc) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunColor;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(horizon, top, pow(h, 0.5));
          if (d.y < 0.0) col = mix(horizon, ground, clamp(-d.y * 4.0, 0.0, 1.0));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.08);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
  }

  _setupSky() {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), this._skyMaterial());
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  _setSkyColors(mat, a) {
    const u = mat.uniforms;
    u.top.value.setHex(a.top);
    u.horizon.value.setHex(a.horizon);
    u.ground.value.setHex(a.ground);
    u.sunColor.value.setHex(a.sunColor);
  }

  // Colors, fog, lights and the sky-based environment map of the current map.
  _applyAtmosphere(a) {
    this.sunDir.set(...a.sunDir).normalize();
    this.scene.fog.color.setHex(a.fog[0]);
    this.scene.fog.near = a.fog[1];
    this.scene.fog.far = a.fog[2];
    this._setSkyColors(this.sky.material, a);
    this.hemi.color.setHex(a.hemi[0]);
    this.hemi.groundColor.setHex(a.hemi[1]);
    this.hemi.intensity = a.hemi[2];
    this.sun.color.setHex(a.sun[0]);
    this.sun.intensity = a.sun[1];
    this.renderer.toneMappingExposure = a.exposure;
    const L = this.layout;
    const center = new THREE.Vector3(L.width / 2, 0, L.depth / 2);
    this.sun.position.copy(center).addScaledVector(this.sunDir, 150);
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();

    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const skyMat = this._skyMaterial();
    this._setSkyColors(skyMat, a);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat);
    envScene.add(ball);
    const rt = pm.fromScene(envScene, 0.04, 0.1, 200);
    ball.geometry.dispose();
    skyMat.dispose();
    pm.dispose();
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = a.env;
    this.envTexture = rt.texture;
    if (this.viewmodel) this.viewmodel.scene.environment = rt.texture;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodel?.resize(w / h);
  }

  applySettings(s) {
    this.settings = { ...this.settings, ...s };
    this.audio.setVolume(this.settings.volume);
    this.audio.voice = this.settings.voice;
    this.ann = announcer(!!this.settings.dialect);
    this.audio.lang = this.ann.lang;
    if (this.mode === 'local' && s.difficulty) for (const a of this.agents) if (a.brain) a.brain.setDifficulty(s.difficulty);
  }

  // ------------------------------------------------------------ session
  _newSim(authority) {
    for (const m of this.models) this.scene.remove(m.root);
    this.models.clear();
    this.views.clear();
    this.effects.clear();
    this.sim = new Sim({ authority, map: this.map });
    this._bindEvents(this.sim.events);
    this.player = null;
    this.spectating = false;
    this.spectateTarget = null;
    this.deathInfo = '';
    this.acc = 0;
  }

  startLocal(opts) {
    this.disconnect();
    if (opts.map) this.loadMap(opts.map);
    this._newSim(true);
    this.mode = 'local';
    this.autoStep = !this.testMode;
    const team = opts.team === 'auto' ? (Math.random() < 0.5 ? 'T' : 'CT') : opts.team;
    this.player = this.sim.addAgent({ name: opts.playerName || 'You', team, isBot: false });
    this.sim.startMatch({ teamSize: opts.teamSize, difficulty: opts.difficulty, winsNeeded: opts.winsNeeded });
    this.viewYaw = this.player.yaw;
    this.viewPitch = 0;
    this.state = 'playing';
  }

  // Kept for the automated tests.
  setupMatch(opts) {
    this.startLocal(opts);
  }

  // target: { host, room, protocol } of a server room.
  async startNet(target, opts) {
    this.disconnect();
    this._newSim(false);
    this.mode = 'net';
    this.netId = null;
    this.cmdSeq = 0;
    this.pending = [];
    this.timeOffset = null;
    this.tickScale = 1;
    this.predOffset.set(0, 0, 0);
    this.netStats = { predErr: 0, maxPredErr: 0, snaps: 0, q: 0 };
    this.net = new NetClient({
      onMessage: (m) => this._onNetMessage(m),
      onClose: (e) => this._onNetClose(e),
    });
    try {
      const welcome = await this.net.connect(target, {
        name: opts.playerName || 'Player',
        team: opts.team || 'auto',
        cfg: { teamSize: opts.teamSize, difficulty: opts.difficulty, winsNeeded: opts.winsNeeded, map: opts.map },
      });
      this.roomName = welcome.room || target.room;
      this.netId = welcome.id;
      this.serverInfo = welcome.cfg || {};
      this.player = this.sim.byId.get(this.netId) || null;
      this.state = 'playing';
      return welcome;
    } catch (err) {
      this.disconnect();
      throw err;
    }
  }

  // Back to the menu: drop the session's models and props so the menu flyover shows an empty map.
  endSession() {
    this.disconnect();
    for (const m of this.models) this.scene.remove(m.root);
    this.models.clear();
    this.views.clear();
    this.effects.clear();
    this.sim = null;
    this.player = null;
    this.mode = 'none';
    this.state = 'menu';
  }

  disconnect() {
    if (this.net) {
      this.net.close();
      this.net = null;
    }
    if (this.mode === 'net') {
      this.mode = 'none';
      this.state = 'menu';
    }
  }

  _onNetClose(e) {
    this.net = null;
    this.mode = 'none';
    this.state = 'menu';
    if (this.onDisconnect) this.onDisconnect(e?.reason || 'Connection to the server was lost.');
  }

  serverNow() {
    return this.timeOffset == null ? this.time : performance.now() / 1000 + this.timeOffset;
  }

  // ------------------------------------------------------------ requests (local or remote)
  requestBuy(id) {
    if (this.mode === 'net') this.net?.send({ t: 'b', id });
    else if (this.sim && this.player) this.sim.shop.buy(this.player, id);
  }

  requestTeam(team) {
    if (this.mode === 'net') this.net?.send({ t: 'team', team });
    else if (this.player) this.player.pendingTeam = team;
  }

  sendChat(text, team) {
    if (this.mode === 'net') this.net?.send({ t: 'chat', text, team: team ? 1 : 0 });
    else if (this.sim && this.player) this.sim.humanChat(this.player, text, team);
  }

  // ------------------------------------------------------------ network mirror
  _onNetMessage(m) {
    switch (m.t) {
      case 'welcome':
        // The room's map was picked by its first player: switch before any roster or snapshot arrives.
        if (m.map && m.map !== this.map.id) {
          this.loadMap(m.map);
          this._newSim(false);
        }
        break;
      case 'roster': this._applyRoster(m.list); break;
      case 's': this._applySnapshot(m); break;
      case 'kick': if (this.onDisconnect) this.onDisconnect(m.msg); break;
      default: break;
    }
  }

  _applyRoster(list) {
    const sim = this.sim;
    const ids = new Set();
    for (const [id, name, team, isBot] of list) {
      ids.add(id);
      let a = sim.byId.get(id);
      if (!a) {
        a = sim.addAgent({ id, name, team, isBot: !!isBot });
        a.netHist = [];
      }
      a.name = name;
      if (a.team !== team) {
        a.team = team;
        a.resetLoadout();
      }
    }
    for (const a of [...sim.agents]) if (!ids.has(a.id)) sim.removeAgent(a);
    if (this.netId != null) this.player = sim.byId.get(this.netId) || this.player;
    this._syncModels();
  }

  _applySnapshot(m) {
    const sim = this.sim;
    if (!sim || !m.r) return;
    this.netStats.snaps++;
    this.netStats.q = m.q;
    const wall = performance.now() / 1000;
    const off = m.time - wall;
    if (this.timeOffset == null || Math.abs(off - this.timeOffset) > 0.25) this.timeOffset = off;
    else this.timeOffset += (off - this.timeOffset) * 0.05;
    sim.time = m.time;

    const R = sim.round;
    const r = m.r;
    R.phase = r[0]; R.round = r[1]; R.timer = r[2]; R.liveStart = r[3];
    R.score.T = r[4]; R.score.CT = r[5]; R.winsNeeded = r[6];
    R.matchWinner = r[7] || null; R.lastWinner = r[8] || null; R.lastReason = r[9]; R.tPlan.site = r[10];

    // Drops and grenades (reuse objects by id so meshes stay attached).
    const oldDrops = new Map(sim.drops.items.map((it) => [it.id, it]));
    sim.drops.items = m.d.map(([id, defId, x, y, z, yaw]) => {
      const it = oldDrops.get(id) || { id, def: WEAPONS[defId], pos: new THREE.Vector3() };
      it.pos.set(x, y, z);
      it.yaw = yaw;
      return it;
    });
    const oldNades = new Map(sim.grenades.list.map((n) => [n.nid, n]));
    sim.grenades.list = m.n.map(([nid, type, x, y, z]) => {
      const n = oldNades.get(nid) || { nid, type, pos: new THREE.Vector3() };
      n.pos.set(x, y, z);
      return n;
    });
    sim.grenades.smokes = m.sm.map(([x, y, z, start, end]) => ({ x, y, z, start, end }));
    if (m.pk) m.pk.forEach((v, i) => { const it = sim.pickups.items[i]; if (it) it.available = !!v; });

    const b = R.bomb;
    const bb = m.b;
    b.state = bb[0];
    b.pos.set(bb[1], bb[2], bb[3]);
    b.timer = bb[4];
    b.site = bb[5] || null;
    b.carrier = sim.byId.get(bb[6]) || null;
    b.item = bb[7] >= 0 ? sim.drops.items.find((it) => it.id === bb[7]) || null : null;
    b.yaw = bb[8];

    for (const arr of m.a) {
      const a = sim.byId.get(arr[0]);
      if (a) this._applyPublic(a, arr, m.time);
    }
    if (m.me && this.player) this._applyPrivate(this.player, m.me, m.ack);

    for (const e of m.e || []) {
      try {
        const d = decodeEvent(sim, e);
        if (d) sim.events.emit(d.name, d.data);
      } catch (err) {
        console.warn('bad network event', e?.n, err);
      }
    }
  }

  _applyPublic(a, arr, t) {
    const flags = arr[6];
    const wasAlive = a.alive;
    a.alive = !!(flags & 1);
    a.planting = !!(flags & 8);
    a.defusing = !!(flags & 16);
    a.inv[5] = flags & 32 ? a.inv[5] || { def: WEAPONS.c4 } : null;
    a.defuser = !!(flags & 64);
    a.helmet = !!(flags & 128);
    a.spottedUntil = flags & 256 ? this.sim.time + 0.3 : 0;
    a.health = arr[10];
    a.armor = arr[11];
    a.money = arr[12];
    a.kills = arr[13]; a.deaths = arr[14]; a.assists = arr[15]; a.headshots = arr[16]; a.mvps = arr[17];
    if (a === this.player) {
      a.netYaw = arr[4];
      return;
    }
    a.crouched = !!(flags & 2);
    a.body.onGround = !!(flags & 4);
    a.ws.scoped = flags & 512 ? 1 : 0;
    a.viewEye = arr[20];
    // Loadout as far as others can see it (for spectating and third-person weapons).
    const wid = arr[7];
    const def = WEAPONS[wid] || WEAPONS.knife;
    a.inv[1] = arr[21] ? { def: WEAPONS[arr[21]], mag: 0, reserve: 0 } : null;
    a.inv[2] = arr[22] ? { def: WEAPONS[arr[22]], mag: 0, reserve: 0 } : null;
    if (!a.inv[3]) a.inv[3] = { def: WEAPONS.knife, mag: 0, reserve: 0 };
    a.grenades = arr[23] ? arr[23].split(',') : [];
    a.slot = def.slot;
    if (def.slot === 4) a.grenadeIdx = Math.max(0, a.grenades.indexOf(wid));
    else if (a.inv[def.slot]) { a.inv[def.slot].mag = arr[8]; a.inv[def.slot].reserve = arr[9]; }
    a.model?.setWeapon(def.id);
    const s = { t, x: arr[1], y: arr[2], z: arr[3], yaw: arr[4], pitch: arr[5], vx: arr[18], vz: arr[19] };
    if (!a.netHist) a.netHist = [];
    if (a.alive && !wasAlive) a.netHist.length = 0; // respawn: don't slide from the corpse
    a.netHist.push(s);
    if (a.netHist.length > 40) a.netHist.shift();
  }

  _applyPrivate(p, me, ack) {
    p.inv = { 1: null, 2: null, 3: null, 5: null };
    for (const [s, id, mag, reserve] of me.inv) p.inv[s] = { def: WEAPONS[id], mag, reserve };
    p.grenades = me.g;
    p.grenadeIdx = me.gi;
    p.slot = me.sl;
    p.lastSlot = me.ls;
    const ws = p.ws;
    [ws.nextFire, ws.reloadEnd, ws.reloadStart, ws.drawEnd, ws.recoil, ws.bloom, ws.lastShot, ws.scoped] = me.ws;
    ws.pinPulled = !!me.ws[8];
    p.kick = me.k;
    p.punch = me.pu;
    p.plantProgress = me.pp;
    p.defuseProgress = me.dp;
    [p.blindUntil, p.blindAmount, p.blindDuration] = me.bl;

    if (!p.alive) {
      p.applyMovementState(me.mv);
      p.prevPos.copy(p.body.pos);
      this.pending.length = 0;
      return;
    }
    // Reconcile: take the server's movement state for the last acked command, replay the rest.
    const before = _v2.copy(p.body.pos);
    p.applyMovementState(me.mv);
    while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();
    if (this.pending.length) {
      this.sim.replaying = true;
      for (const c of this.pending) p.predictMove(c, DT);
      this.sim.replaying = false;
    } else {
      p.prevPos.copy(p.body.pos);
    }
    const err = before.distanceTo(p.body.pos);
    this.netStats.predErr = err;
    this.netStats.maxPredErr = Math.max(this.netStats.maxPredErr || 0, err);
    if (err > 0.0005 && err < 2) this.predOffset.add(before.sub(p.body.pos));
    else if (err >= 2) {
      this.predOffset.set(0, 0, 0);
      p.prevPos.copy(p.body.pos);
    }
  }

  _interpolateRemotes() {
    const rt = this.serverNow() - NET_INTERP;
    this.renderServerTime = rt;
    for (const a of this.agents) {
      if (a === this.player) continue;
      const h = a.netHist;
      if (!h || !h.length) continue;
      let s0 = h[h.length - 1], s1 = null;
      for (let i = h.length - 1; i >= 0; i--) {
        if (h[i].t <= rt) { s0 = h[i]; s1 = h[i + 1] || null; break; }
        if (i === 0) { s0 = h[0]; s1 = null; }
      }
      if (s1) {
        const f = clamp((rt - s0.t) / Math.max(1e-4, s1.t - s0.t), 0, 1);
        a.body.pos.set(s0.x + (s1.x - s0.x) * f, s0.y + (s1.y - s0.y) * f, s0.z + (s1.z - s0.z) * f);
        a.yaw = s0.yaw + wrapAngle(s1.yaw - s0.yaw) * f;
        a.pitch = s0.pitch + (s1.pitch - s0.pitch) * f;
      } else {
        a.body.pos.set(s0.x, s0.y, s0.z);
        a.yaw = s0.yaw;
        a.pitch = s0.pitch;
      }
      a.body.vel.set(s0.vx, 0, s0.vz);
      a.prevPos.copy(a.body.pos);
    }
  }

  _syncModels() {
    const keep = new Set();
    for (const a of this.agents) {
      if (!a.model || a.model.team !== a.team) {
        if (a.model) this.scene.remove(a.model.root);
        a.model = new Character(a.team, this.textures);
        a.model.setWeapon(a.currentDef.id);
        this.scene.add(a.model.root);
      }
      keep.add(a.model);
    }
    for (const m of this.models) if (!keep.has(m)) this.scene.remove(m.root);
    this.models = keep;
  }

  shake(x, y, z, radius, amount) {
    const c = this.camera.position;
    const d = Math.hypot(c.x - x, c.y - y, c.z - z);
    if (d < radius * 2) this.shakeAmt = Math.max(this.shakeAmt, amount * clamp(1 - d / (radius * 2), 0, 1));
  }

  get viewAgent() {
    return this.spectating ? this.spectateTarget : this.player;
  }

  // ------------------------------------------------------------ presentation events
  _bindEvents(ev) {
    const au = this.audio;
    const isMe = (a) => a && a === this.player && !this.spectating;
    const predicted = (d) => this.mode === 'net' && d.$net && d.agent === this.player;
    ev.on('roster', () => this._syncModels());
    ev.on('shot', ({ agent, def, origin }) => {
      const quiet = def.sound === 'usp' || def.sound === 'smg';
      if (isMe(agent)) {
        au.play('shot_' + def.sound, { volume: quiet ? 0.5 : 0.85, vary: 0.04 });
        this.viewmodel.onFire(def);
        if (!quiet) this.effects.flash(origin.x, origin.y, origin.z, 4, 0.05);
      } else {
        au.play('shot_' + def.sound, { pos: origin, volume: quiet ? 0.55 : 1, ref: quiet ? 3 : 9, rolloff: 1, maxDist: quiet ? 50 : 200 });
        agent.model?.fired();
        const m = agent.model?.muzzleWorld();
        if (m && !quiet) this.effects.muzzle(m.x, m.y, m.z, def.kind === 'sniper');
      }
    });
    ev.on('dryfire', ({ agent }) => { if (isMe(agent)) au.play('dry', { volume: 0.5 }); });
    ev.on('reload', ({ agent, duration }) => { if (isMe(agent)) this.viewmodel.onReload(duration); });
    ev.on('reloadSound', ({ agent, name }) => {
      if (isMe(agent)) au.play(name, { volume: 0.55 });
      else au.play(name, { pos: agent.pos, volume: 0.35, ref: 2, maxDist: 25 });
    });
    ev.on('draw', ({ agent, def }) => {
      if (agent === this.player) {
        this.viewmodel.setWeapon(def, agent.team, def.draw);
        if (this.state === 'playing') au.play('draw', { volume: 0.35 });
      }
      agent.model?.setWeapon(def.id);
    });
    ev.on('knife', ({ agent, heavy, hit }) => {
      const opts = isMe(agent) ? { volume: 0.7 } : { pos: agent.pos, volume: 0.6, ref: 3, maxDist: 30 };
      au.play('knife_swing', opts);
      if (hit === 'flesh') au.play('knife_flesh', opts);
      else if (hit === 'wall') au.play('knife_hit', opts);
      if (isMe(agent)) this.viewmodel.onKnife(heavy);
      else agent.model?.fired();
    });
    ev.on('step', (d) => {
      if (predicted(d)) return;
      if (isMe(d.agent)) au.play('step', { volume: 0.22, vary: 0.1 });
      else au.play('step', { pos: d.agent.pos, volume: 1.1, ref: 3.5, rolloff: 1.5, hrtf: true, maxDist: 38, vary: 0.1 });
    });
    ev.on('land', (d) => {
      if (predicted(d)) return;
      if (isMe(d.agent)) { au.play('land', { volume: 0.4 }); this.viewmodel.onLand(d.speed); } else au.play('land', { pos: d.agent.pos, volume: 0.6, ref: 3, maxDist: 30 });
    });
    ev.on('jump', (d) => {
      if (predicted(d)) return;
      if (!isMe(d.agent)) au.play('step', { pos: d.agent.pos, volume: 0.7, ref: 3, maxDist: 30 });
    });
    ev.on('fx', (f) => this._fx(f));
    ev.on('damage', (e) => {
      const { victim, attacker, group, armored } = e;
      const snd = group === 'head' ? 'hit_head' : armored ? 'hit_armor' : 'hit_body';
      if (victim === this.player) {
        this.hud.onPlayerDamaged(e);
        au.play(snd, { volume: 0.75 });
      } else if (attacker && attacker === this.player) {
        au.play(snd, { volume: group === 'head' ? 0.55 : 0.4 });
      } else {
        au.play(snd, { pos: victim.pos, volume: 0.5, ref: 3, maxDist: 40 });
      }
    });
    ev.on('kill', (e) => {
      this.hud.addKill(e);
      const { victim, killer } = e;
      if (victim.model && killer) {
        const f = dirFromAngles(victim.yaw, 0, _v);
        const inFront = f.x * (killer.pos.x - victim.pos.x) + f.z * (killer.pos.z - victim.pos.z) > 0;
        victim.model.setDeathDirection(!inFront);
      }
      if (victim === this.player) this._onPlayerDeath(e);
      if (this.spectating && victim === this.spectateTarget) this.spectateAt = this.realTime + 1.2;
    });
    ev.on('chat', (c) => {
      const { agent, team } = c;
      if (!agent || !this.player) return;
      if (team && agent.team !== this.player.team) return;
      let msg = c.text;
      if (!c.human) {
        if (!this.settings.dialect) return;
        msg = line(c.kind, c.vars || {});
      }
      if (!msg) return;
      this.hud.addChat(agent, msg, { dead: c.dead, team });
      if (!c.human && this.realTime >= this.speakNext && Math.random() < (c.speak || 0)) {
        const pitch = 0.62 + ((agent.id * 0.137) % 0.55);
        const rate = 1.02 + ((agent.id * 0.071) % 0.22);
        if (au.say(msg, { pitch, rate })) this.speakNext = this.realTime + 1.0;
      }
    });
    ev.on('eat', ({ agent, amount, x, y, z }) => {
      au.play('eat', agent === this.player ? { volume: 0.8 } : { pos: { x, y, z }, volume: 0.9, ref: 3, maxDist: 30 });
      if (agent === this.player) {
        this.hud.center('', this.ann.ate(Math.round(amount)), 1.8);
        au.say(this.ann.sayAte());
      }
    });
    ev.on('buy', ({ agent }) => { if (agent === this.player) au.play('buy', { volume: 0.5 }); });
    ev.on('buyFail', ({ agent, reason }) => {
      if (agent === this.player) { au.play('denied', { volume: 0.35 }); this.hud.center('', this.ann.buyFail(reason), 1.3); }
    });
    ev.on('pickup', ({ agent }) => { if (isMe(agent)) au.play('pickup', { volume: 0.6 }); });
    ev.on('pin', ({ agent }) => { if (isMe(agent)) au.play('pin', { volume: 0.5 }); });
    ev.on('throw', ({ agent, id }) => {
      if (isMe(agent)) {
        au.play('throw', { volume: 0.5 });
        au.say(this.ann.sayNade[id]);
      } else au.play('throw', { pos: agent.pos, volume: 0.5, ref: 3, maxDist: 25 });
    });
    ev.on('scope', ({ agent }) => { if (isMe(agent)) au.play('ui', { volume: 0.25 }); });
    ev.on('plantBeep', ({ agent }) => au.play('key_beep', { pos: agent.pos, volume: 0.6, ref: 3, maxDist: 40 }));
    ev.on('defuseStart', ({ agent }) => au.play('defuse_tick', { pos: agent.pos, volume: 0.8, ref: 3 }));
    ev.on('flashed', ({ agent, amount }) => { if (agent === this.player && amount > 0.35) au.play('tinnitus', { volume: amount }); });
    ev.on('spawn', ({ agent }) => {
      if (agent !== this.player) return;
      this.viewYaw = this.mode === 'net' ? agent.netYaw ?? agent.yaw : agent.yaw;
      this.viewPitch = 0;
      this.spectating = false;
      this.spectateTarget = null;
      this.deathInfo = '';
      this.predOffset.set(0, 0, 0);
    });
    ev.on('matchStart', () => { if (this.onMatchStart) this.onMatchStart(); });
    ev.on('roundStart', ({ round }) => {
      this.spectating = !this.player?.alive && this.mode === 'net' ? this.spectating : false;
      if (this.player?.alive) {
        this.spectateTarget = null;
        this.deathInfo = '';
        this.viewYaw = this.mode === 'net' ? this.player.netYaw ?? this.player.yaw : this.player.yaw;
        this.viewPitch = 0;
      }
      this.hud.closeBuy();
      this.effects.clear();
      for (const a of this.agents) if (a.model) a.model.deadT = 0;
      const A = this.ann;
      const last = this.round.score.T + this.round.score.CT;
      const sub = this.player && this.round.canBuy(this.player) ? A.buyPhase : '';
      this.hud.center(last === 0 ? A.matchStart() : A.round(round), sub, 3.5);
      if (this.state === 'playing') au.play('round_start', { volume: 0.4 });
    });
    ev.on('roundLive', () => this.hud.center('', this.ann.go(), 1.3));
    ev.on('bombPlanted', ({ site }) => {
      this.hud.center(this.ann.planted, this.ann.plantedSub(site), 3, 'red');
      au.say(this.ann.sayPlanted(), { priority: true });
      this.speakNext = this.realTime + 3;
    });
    ev.on('bombDefused', () => {
      au.say(this.ann.sayDefused(), { priority: true });
      this.speakNext = this.realTime + 3;
    });
    ev.on('roundEnd', ({ winner, reason, mvp }) => {
      const A = this.ann;
      const mvpLine = mvp ? `<div class="mvp">★ ${A.mvp}: ${esc(mvp.name)}</div>` : '';
      this.hud.center(A.win(winner), (A.reasons[reason] || '') + mvpLine, 5.5, winner === 'T' ? 't' : 'ct');
      au.play(this.player && winner === this.player.team ? 'round_win' : 'round_lose', { volume: 0.45 });
      au.say(A.sayWin(winner), { priority: true });
      this.speakNext = this.realTime + 3;
    });
    ev.on('matchOver', ({ winner }) => {
      if (this.mode === 'local') {
        this.state = 'matchover';
        this.input.exitLock();
      }
      if (this.onMatchOver) this.onMatchOver(winner);
    });
  }

  _fx(f) {
    const au = this.audio;
    const pos = { x: f.x, y: f.y, z: f.z };
    switch (f.type) {
      case 'impact':
        this.effects.impact(f.x, f.y, f.z, f.nx, f.ny, f.nz, f.mat, !!f.exit, !!f.knife);
        if (!f.knife && !f.exit) au.play(METALLIC.has(f.mat) ? 'impact_metal' : WOODEN.has(f.mat) ? 'impact_wood' : 'impact', { pos, volume: 0.45, ref: 2, maxDist: 45, occlude: false });
        break;
      case 'blood':
        this.effects.blood(f.x, f.y, f.z, f.dx, f.dy, f.dz, !!f.head);
        break;
      case 'tracer':
        if (f.shooter) this.effects.tracer(f.shooter, { x: f.ox, y: f.oy, z: f.oz }, f.ex, f.ey, f.ez, resolveDef(f.def) || WEAPONS.knife);
        break;
      case 'explosion':
        this.effects.explosion(f.x, f.y, f.z, !!f.big);
        if (f.big) au.play('explosion', { pos, volume: 1, ref: 25, rolloff: 0.5, occlude: false });
        else au.play('he_explode', { pos, volume: 1, ref: 10, rolloff: 0.8 });
        break;
      case 'flashbang':
        this.effects.flash(f.x, f.y + 0.2, f.z, 60, 0.25, 0xffffff, 25);
        au.play('flash_bang', { pos, volume: 1, ref: 8, rolloff: 0.8 });
        break;
      case 'smoke':
        this.effects.smokeCloud(f.x, f.y, f.z, 17);
        au.play('smoke_pop', { pos, volume: 0.9, ref: 6 });
        break;
      case 'bounce':
        au.play('bounce', { pos, volume: 0.6, ref: 3 });
        break;
      case 'bombBeep':
        au.play('bomb_beep', { pos, volume: 0.8, ref: 6, rolloff: 0.9, occlude: false });
        this.views.blink();
        break;
      case 'shake':
        this.shake(f.x, f.y, f.z, f.radius, f.amount);
        break;
      default:
        break;
    }
  }

  _onPlayerDeath(e) {
    const { killer, def, headshot } = e;
    this.deathInfo = killer && killer !== this.player
      ? this.ann.killedBy(`<b class="${killer.team === 'T' ? 't' : 'ct'}">${esc(killer.name)}</b>`, esc(def?.name || ''), headshot)
      : this.ann.died;
    this.deathKiller = killer;
    this.spectateAt = this.realTime + 2.2;
    this.deathCamPos = this.camera.position.clone();
    this.hud.closeBuy();
  }

  _pickSpectate(dir = 1) {
    const p = this.player;
    const mates = this.agents.filter((a) => a.alive && a !== p && a.team === p?.team);
    const pool = mates.length ? mates : this.agents.filter((a) => a.alive && a !== p);
    if (!pool.length) { this.spectateTarget = null; return; }
    let i = pool.indexOf(this.spectateTarget);
    i = i < 0 ? 0 : (i + dir + pool.length) % pool.length;
    this.spectateTarget = pool[i];
  }

  // ------------------------------------------------------------ input
  _handleKeys() {
    const i = this.input;
    const p = this.player;
    if (i.hit('Backquote') || i.hit('F1')) this.hud.showNet = !this.hud.showNet;
    if (!this.hud.chatOpen && (i.hit('KeyY') || i.hit('KeyU'))) this.hud.openChat(i.hit('KeyU'));
    this.hud.showScores = i.down('Tab') || this.round.phase === 'matchover';
    if (!p) return;
    if (i.hit('KeyB')) {
      if (this.hud.buyOpen) this.hud.closeBuy();
      else if (p.alive && this.round.canBuy(p)) this.hud.openBuy();
      else if (p.alive) this.hud.center('', this.round.buyTimeLeft() > 0 ? this.ann.notBuyZone : this.ann.buyExpired, 1.4);
    }
    if (this.hud.buyOpen) {
      for (let d = 0; d <= 9; d++) if (i.hit(`Digit${d}`) || i.hit(`Numpad${d}`)) this.hud.buyKey(d);
    }
    if (!p.alive && this.spectating) {
      if (i.clicked[0]) this._pickSpectate(1);
      if (i.clicked[2]) this._pickSpectate(-1);
    }
  }

  _playerCmd() {
    const i = this.input;
    const c = this.pcmd;
    c.forward = (i.down('KeyW') || i.down('ArrowUp') ? 1 : 0) - (i.down('KeyS') || i.down('ArrowDown') ? 1 : 0);
    c.side = (i.down('KeyD') || i.down('ArrowRight') ? 1 : 0) - (i.down('KeyA') || i.down('ArrowLeft') ? 1 : 0);
    c.jump = i.down('Space');
    c.crouch = i.down('ControlLeft') || i.down('ControlRight') || i.down('KeyC');
    c.walk = i.down('ShiftLeft') || i.down('ShiftRight');
    c.fire = i.buttons[0];
    c.fire2 = i.buttons[2];
    c.reload = i.hit('KeyR');
    c.use = i.down('KeyE');
    c.drop = i.hit('KeyG');
    c.slot = 0;
    if (!this.hud.buyOpen) for (let d = 1; d <= 5; d++) if (i.hit(`Digit${d}`)) c.slot = d;
    c.nextWeapon = i.consumeWheel();
    c.lastWeapon = i.hit('KeyQ');
    if (i.hit('KeyF')) this.viewmodel.onInspect();
    c.yaw = this.viewYaw;
    c.pitch = this.viewPitch;
    if (!this.player?.alive || (this.mode === 'net' && (this.state !== 'playing' || (!i.locked && !this.testMode)))) {
      c.forward = 0; c.side = 0; c.jump = false; c.crouch = false; c.walk = false;
      c.fire = false; c.fire2 = false; c.reload = false; c.use = false; c.drop = false;
      c.slot = 0; c.nextWeapon = 0; c.lastWeapon = false;
    }
    return c;
  }

  _applyMouse() {
    const m = this.input.consumeMouse();
    this.mouseDX = m.dx;
    this.mouseDY = m.dy;
    if (!this.player?.alive || this.spectating || this.state !== 'playing') return;
    let sens = this.settings.sensitivity * 0.022 * DEG;
    const p = this.player;
    if (p.ws.scoped > 0) sens *= this.camera.fov / this.settings.fov;
    this.viewYaw -= m.dx * sens;
    this.viewPitch = clamp(this.viewPitch - m.dy * sens, -89 * DEG, 89 * DEG);
  }

  // ------------------------------------------------------------ simulation
  tick(dt) {
    if (this.mode === 'net') { this.netTick(dt); return; }
    if (!this.sim) return;
    this._handleKeys();
    const p = this.player;
    const cmd = this._playerCmd();
    p.pendingCmd = p.alive ? cmd : null;
    this.sim.tick(dt);
    this.input.endTick();
  }

  netTick(dt) {
    const p = this.player;
    if (!this.sim || !this.net || !p) {
      this.input.endTick();
      return;
    }
    this._handleKeys();
    const cmd = this._playerCmd();
    const seq = ++this.cmdSeq;
    this.net.send(encodeCmd(cmd, seq, this.serverNow() - NET_INTERP));
    if (p.alive) {
      const c = { ...cmd, seq };
      p.predictMove(c, dt);
      this.pending.push(c);
      if (this.pending.length > 120) this.pending.shift();
    }
    this.input.endTick();
  }

  step(n = 1) {
    for (let k = 0; k < n; k++) this.tick(DT);
  }

  // ------------------------------------------------------------ frame
  frame(dt) {
    this.realTime += dt;
    const net = this.mode === 'net';
    if (net || this.state === 'playing') {
      this._applyMouse();
      if (this.autoStep || net) {
        this.acc += dt / (net ? this.tickScale : 1);
        let n = 0;
        while (this.acc >= DT && n < 10) {
          this.tick(DT);
          this.acc -= DT;
          n++;
        }
        if (n >= 10) this.acc = 0;
      }
      const p = this.player;
      if (p && p.alive && this.spectating) {
        this.spectating = false;
        this.spectateTarget = null;
      }
      if (p && !p.alive && !this.spectating && this.realTime > this.spectateAt) {
        this.spectating = true;
        this._pickSpectate(0);
      }
      if (p && this.spectating && (!this.spectateTarget || !this.spectateTarget.alive || !this.sim.byId.has(this.spectateTarget.id)) && this.realTime > this.spectateAt) {
        this._pickSpectate(1);
        this.spectateAt = this.realTime + 1;
      }
    } else {
      this.input.consumeMouse();
    }
    this.render(this.autoStep || net ? this.acc / DT : 1, dt);
  }

  _updateCamera(alpha, dt) {
    const cam = this.camera;
    const p = this.player;
    if (this.state === 'menu' || !p) {
      const t = this.realTime * 0.05;
      const cx = this.layout.width / 2, cz = this.layout.depth / 2;
      const floor = this.layout.levels.length > 1 ? 5 : 0;
      cam.position.set(cx + Math.cos(t) * 52, 34 + floor, cz + Math.sin(t) * 52);
      cam.lookAt(cx, floor, cz);
      cam.rotation.order = 'YXZ';
      return;
    }
    let fov = this.settings.fov;
    if (!this.spectating && p.alive) {
      _v.lerpVectors(p.prevPos, p.body.pos, alpha);
      this.predOffset.multiplyScalar(Math.exp(-16 * dt));
      cam.position.set(_v.x + this.predOffset.x, _v.y + p.viewEye + this.predOffset.y, _v.z + this.predOffset.z);
      const def = p.currentDef;
      const pat = def.recoil ? recoilAt(def.recoil, p.ws.recoil) : [0, 0];
      const pitchPunch = (pat[1] * 0.45 + p.kick * 0.55 + p.punch * 0.5) * DEG;
      const yawPunch = -pat[0] * 0.45 * DEG;
      cam.rotation.set(this.viewPitch + pitchPunch, this.viewYaw + yawPunch, 0);
      if (p.ws.scoped > 0 && def.zoom) fov = this.settings.fov * (def.zoom[p.ws.scoped - 1] / 90);
    } else if (!this.spectating) {
      // Death cam: stay put and turn toward the killer.
      const k = this.deathKiller;
      cam.position.y = damp(cam.position.y, (this.deathCamPos?.y ?? cam.position.y) - 1.1, 3, dt);
      if (k && k !== p) {
        const tx = k.pos.x - cam.position.x, ty = k.pos.y + 1.4 - cam.position.y, tz = k.pos.z - cam.position.z;
        const yaw = Math.atan2(-tx, -tz), pitch = Math.atan2(ty, Math.hypot(tx, tz));
        const dy = Math.atan2(Math.sin(yaw - cam.rotation.y), Math.cos(yaw - cam.rotation.y));
        cam.rotation.set(damp(cam.rotation.x, pitch, 3, dt), cam.rotation.y + dy * (1 - Math.exp(-3 * dt)), 0);
      }
    } else if (this.spectateTarget) {
      const t = this.spectateTarget;
      _v.lerpVectors(t.prevPos, t.body.pos, alpha);
      const head = _v2.set(_v.x, _v.y + t.viewEye + 0.15, _v.z);
      const yaw = t.brain ? t.brain.aimYaw : t.yaw;
      const back = dirFromAngles(yaw, -0.25, new THREE.Vector3()).multiplyScalar(-1);
      const want = 2.8;
      const hit = this.world.raycast(head.x, head.y, head.z, back.x, back.y, back.z, want, _hit);
      const d = hit ? Math.max(0.3, hit.t - 0.25) : want;
      cam.position.set(head.x + back.x * d, head.y + back.y * d + 0.25, head.z + back.z * d);
      cam.rotation.set(-0.12, yaw, 0);
    } else {
      const cx = this.layout.width / 2, cz = this.layout.depth / 2;
      cam.position.set(cx, 70, cz + 40);
      cam.lookAt(cx, 0, cz);
    }
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.04;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.5;
      this.shakeAmt = damp(this.shakeAmt, 0, 3.5, dt);
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = Math.abs(cam.fov - fov) < 0.2 ? fov : damp(cam.fov, fov, 22, dt);
      cam.updateProjectionMatrix();
    }
  }

  // Names above heads: teammates always (through walls, with health), enemies only when in sight.
  _updateNameTags() {
    const p = this.player;
    const mode = this.settings.nameTags || 'all';
    const cam = this.camera.position;
    const now = this.realTime;
    const viewer = this.spectating ? this.spectateTarget : p;
    const h = this._tagV || (this._tagV = new THREE.Vector3());
    for (const a of this.agents) {
      const m = a.model;
      if (!m) continue;
      if (!m.tag || m.tag.name !== a.name) m.setName(a.name);
      const tag = m.tag;
      let show = mode !== 'off' && this.state !== 'menu' && a.alive && a !== viewer && !!p;
      const friend = !!p && a.team === p.team;
      if (show && !friend) {
        if (mode === 'team' || cam.distanceTo(a.pos) > 55) show = false;
        else {
          if (!a.tagCheckAt || now > a.tagCheckAt) {
            a.tagCheckAt = now + 0.12;
            a.headPos(h);
            a.tagLos = this.world.lineClear(cam.x, cam.y, cam.z, h.x, h.y + 0.25, h.z)
              && !this.grenades.smokeBlocks(cam.x, cam.y, cam.z, h.x, h.y, h.z);
          }
          show = !!a.tagLos;
        }
      }
      tag.sprite.visible = show;
      if (!show) continue;
      tag.material.depthTest = !friend;
      tag.draw(friend ? Math.round(a.health) : -1);
    }
  }

  _updateCrosshairTarget() {
    const p = this.player;
    this.crosshairAgent = null;
    if (!p?.alive || this.spectating) return;
    const cam = this.camera.position;
    const f = _v.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const wh = this.world.raycast(cam.x, cam.y, cam.z, f.x, f.y, f.z, 80, _hit);
    let best = wh ? wh.t : 80;
    for (const a of this.agents) {
      if (a === p || !a.alive) continue;
      const r = a.rayHit(cam.x, cam.y, cam.z, f.x, f.y, f.z, best);
      if (r) { best = r.t; this.crosshairAgent = a; }
    }
    if (this.crosshairAgent && this.grenades.smokeBlocks(cam.x, cam.y, cam.z, cam.x + f.x * best, cam.y + f.y * best, cam.z + f.z * best)) this.crosshairAgent = null;
  }

  render(alpha, dt) {
    if (this.mode === 'net' && this.sim) this._interpolateRemotes();
    this._updateCamera(alpha, dt);
    const cam = this.camera;
    this.sky.position.copy(cam.position);
    const p = this.player;

    for (const a of this.agents) {
      if (!a.model) continue;
      const hidePlayer = a === p && (a.alive || !this.spectating) && this.state !== 'menu';
      a.model.root.visible = !hidePlayer;
      if (!a.model.root.visible) continue;
      _v.lerpVectors(a.prevPos, a.body.pos, a.alive ? alpha : 1);
      const vel = a.body.vel;
      const yaw = a.alive ? (a.brain ? a.brain.aimYaw : a.yaw) : a.model.root.rotation.y;
      const fs = -Math.sin(yaw) * vel.x - Math.cos(yaw) * vel.z;
      const ss = Math.cos(yaw) * vel.x - Math.sin(yaw) * vel.z;
      a.model.update(dt, {
        pos: _v, yaw, pitch: a.pitch, speed: a.speed2D(), crouched: a.crouched, alive: a.alive,
        onGround: a.body.onGround, fwdSpeed: fs, sideSpeed: ss,
      });
    }
    this.views.update(dt);
    this._updateNameTags();
    if (this.restaurant) this.restaurant.spit.rotation.y += dt * 0.7;

    const vm = this.viewmodel;
    const showVm = this.state !== 'menu' && p && p.alive && !this.spectating && p.ws.scoped === 0;
    vm.visible = !!showVm;
    if (p) {
      const covered = this.world.coveredAt(cam.position.x, cam.position.y, cam.position.z);
      vm.updateLighting(cam, this.sunDir, covered);
      vm.update(dt, {
        speed: p.speed2D(), onGround: p.body.onGround, crouched: p.crouched, mouseDX: this.mouseDX, mouseDY: this.mouseDY,
        pinPulled: p.ws.pinPulled, planting: p.planting, time: this.realTime,
      });
    }
    this.effects.update(dt);
    if (this.state !== 'menu' && this.sim) this._updateCrosshairTarget();
    const f = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.audio.setListener(cam.position, f);

    const r = this.renderer;
    r.info.reset();
    r.clear();
    r.render(this.scene, cam);
    if (showVm) {
      r.clearDepth();
      r.render(vm.scene, vm.camera);
    }
    if (this.state !== 'menu' && p && this.sim) this.hud.update(dt);
  }
}
