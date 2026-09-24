// Synthesized sound effects (WebAudio) with simple 3D positioning, distance filtering and occlusion.

const TAU = Math.PI * 2;
const alpha = (fc, sr) => 1 - Math.exp((-TAU * fc) / sr);

function gunshot(p) {
  return (d, n, sr) => {
    let lp1 = 0, lp2 = 0, lp3 = 0, ph = 0;
    const a1 = alpha(p.bodyLp, sr), a2 = alpha(p.tailLp, sr), a3 = alpha(4500, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = Math.random() * 2 - 1;
      lp1 += a1 * (w - lp1);
      lp2 += a2 * (w - lp2);
      lp3 += a3 * (w - lp3);
      const crack = (w - lp3) * Math.exp(-t / 0.006) * p.crack;
      const body = lp1 * Math.exp(-t / p.bodyDecay) * p.body * 3;
      const f = p.f1 + (p.f0 - p.f1) * Math.exp(-t / 0.03);
      ph += (TAU * f) / sr;
      const thump = Math.sin(ph) * Math.exp(-t / p.thumpDecay) * p.thump;
      const tail = lp2 * Math.exp(-t / p.tailDecay) * p.tail * 4;
      const atk = Math.min(1, i / (sr * 0.0008));
      d[i] = Math.tanh((crack + body + thump + tail) * 1.5) * atk;
    }
  };
}

function noiseBurst({ lp = 3000, hp = 200, decay = 0.02, delay = 0, gain = 1 }) {
  return (d, n, sr) => {
    let l = 0, h = 0;
    const al = alpha(lp, sr), ah = alpha(hp, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr - delay;
      const w = Math.random() * 2 - 1;
      l += al * (w - l);
      h += ah * (l - h);
      if (t < 0) continue;
      d[i] += (l - h) * Math.exp(-t / decay) * gain * 3;
    }
  };
}

function tone({ f0, f1 = f0, decay = 0.1, delay = 0, gain = 1, type = 'sine', attack = 0.002 }) {
  return (d, n, sr) => {
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr - delay;
      if (t < 0) continue;
      const f = f1 + (f0 - f1) * Math.exp(-t / Math.max(decay, 0.001) * 1.5);
      ph += (TAU * f) / sr;
      let s = Math.sin(ph);
      if (type === 'square') s = Math.sin(ph) + Math.sin(ph * 3) / 3 + Math.sin(ph * 5) / 5;
      const env = Math.min(1, t / attack) * Math.exp(-t / decay);
      d[i] += s * env * gain;
    }
  };
}

function combine(...fns) {
  return (d, n, sr) => { for (const f of fns) f(d, n, sr); };
}

const GUNS = {
  ak: { crack: 0.9, body: 1.0, bodyLp: 2200, bodyDecay: 0.05, thump: 0.9, f0: 160, f1: 55, thumpDecay: 0.09, tail: 0.35, tailLp: 700, tailDecay: 0.22, dur: 0.75 },
  m4: { crack: 0.8, body: 0.9, bodyLp: 2800, bodyDecay: 0.04, thump: 0.7, f0: 180, f1: 65, thumpDecay: 0.07, tail: 0.3, tailLp: 900, tailDecay: 0.18, dur: 0.65 },
  awp: { crack: 1.0, body: 1.0, bodyLp: 1800, bodyDecay: 0.08, thump: 1.0, f0: 120, f1: 40, thumpDecay: 0.16, tail: 0.5, tailLp: 500, tailDecay: 0.5, dur: 1.5 },
  glock: { crack: 0.9, body: 0.7, bodyLp: 3500, bodyDecay: 0.03, thump: 0.5, f0: 220, f1: 90, thumpDecay: 0.05, tail: 0.2, tailLp: 1200, tailDecay: 0.12, dur: 0.45 },
  usp: { crack: 0.12, body: 0.55, bodyLp: 1400, bodyDecay: 0.025, thump: 0.4, f0: 200, f1: 100, thumpDecay: 0.03, tail: 0.05, tailLp: 800, tailDecay: 0.06, dur: 0.25 },
  deagle: { crack: 1.0, body: 1.0, bodyLp: 2000, bodyDecay: 0.06, thump: 1.0, f0: 140, f1: 50, thumpDecay: 0.11, tail: 0.4, tailLp: 700, tailDecay: 0.3, dur: 0.9 },
  smg: { crack: 0.18, body: 0.6, bodyLp: 1600, bodyDecay: 0.03, thump: 0.45, f0: 180, f1: 90, thumpDecay: 0.035, tail: 0.08, tailLp: 900, tailDecay: 0.08, dur: 0.3 },
};

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.volume = 0.7;
    this.voice = true;
    this.lang = 'en-US';
    this.lp = { x: 0, y: 0, z: 0 };
    this.occlusion = null; // (x,y,z) => boolean blocked
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    this._generate();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  _buf(dur, fn, peak = 0.9) {
    const sr = this.ctx.sampleRate;
    const n = Math.max(1, Math.floor(dur * sr));
    const b = this.ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    fn(d, n, sr);
    let m = 0;
    for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(d[i]));
    if (m > 0) for (let i = 0; i < n; i++) d[i] *= peak / m;
    // Fade the last few ms to avoid clicks.
    const fade = Math.min(n, Math.floor(sr * 0.005));
    for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
    return b;
  }

  _generate() {
    const B = this.buffers;
    for (const [k, p] of Object.entries(GUNS)) B['shot_' + k] = this._buf(p.dur, gunshot(p));
    B.step = [0, 1, 2, 3].map((k) => this._buf(0.14, combine(
      noiseBurst({ lp: 1800 + k * 250, hp: 250, decay: 0.012 }),
      noiseBurst({ lp: 1400 + k * 200, hp: 200, decay: 0.018, delay: 0.035 + k * 0.004, gain: 0.7 }),
    ), 0.6));
    B.land = this._buf(0.25, combine(noiseBurst({ lp: 900, hp: 60, decay: 0.05 }), tone({ f0: 90, f1: 50, decay: 0.06, gain: 0.8 })), 0.7);
    B.knife_swing = this._buf(0.28, (d, n, sr) => {
      let l = 0, h = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const w = Math.random() * 2 - 1;
        const fc = 500 + t * 3000;
        l += alpha(fc, sr) * (w - l);
        h += alpha(fc * 0.4, sr) * (l - h);
        d[i] = (l - h) * Math.sin(Math.PI * t) ** 2 * 3;
      }
    }, 0.5);
    B.knife_hit = this._buf(0.25, combine(noiseBurst({ lp: 3500, hp: 600, decay: 0.02 }), tone({ f0: 1100, decay: 0.05, gain: 0.4 })), 0.8);
    B.knife_flesh = this._buf(0.2, combine(noiseBurst({ lp: 900, hp: 100, decay: 0.04 }), tone({ f0: 140, f1: 70, decay: 0.05, gain: 0.8 })), 0.8);
    B.hit_body = this._buf(0.18, combine(tone({ f0: 120, f1: 60, decay: 0.05, gain: 1 }), noiseBurst({ lp: 1400, hp: 100, decay: 0.03, gain: 0.8 })), 0.8);
    B.hit_head = this._buf(0.45, combine(
      tone({ f0: 2150, decay: 0.12, gain: 0.8 }), tone({ f0: 3280, decay: 0.09, gain: 0.5 }), tone({ f0: 5230, decay: 0.05, gain: 0.3 }),
      noiseBurst({ lp: 6000, hp: 2000, decay: 0.004, gain: 0.7 }),
    ), 0.8);
    B.hit_armor = this._buf(0.2, combine(tone({ f0: 900, decay: 0.03, gain: 0.5 }), noiseBurst({ lp: 2600, hp: 300, decay: 0.03 })), 0.8);
    B.impact = [0, 1, 2].map((k) => this._buf(0.14, combine(
      noiseBurst({ lp: 5000, hp: 1400 + k * 300, decay: 0.008 }),
      noiseBurst({ lp: 1500, hp: 200, decay: 0.03, gain: 0.5 }),
    ), 0.5));
    B.impact_metal = this._buf(0.3, combine(tone({ f0: 2600, f1: 1900, decay: 0.08, gain: 0.5 }), noiseBurst({ lp: 6000, hp: 1500, decay: 0.01 })), 0.5);
    B.impact_wood = this._buf(0.15, combine(noiseBurst({ lp: 1800, hp: 300, decay: 0.02 }), tone({ f0: 320, f1: 200, decay: 0.03, gain: 0.5 })), 0.55);
    B.dry = this._buf(0.06, noiseBurst({ lp: 7000, hp: 3000, decay: 0.003 }), 0.4);
    B.mag_out = this._buf(0.3, combine(noiseBurst({ lp: 6000, hp: 2000, decay: 0.004 }), noiseBurst({ lp: 2200, hp: 400, decay: 0.05, delay: 0.03, gain: 0.4 })), 0.5);
    B.mag_in = this._buf(0.25, combine(noiseBurst({ lp: 6000, hp: 1500, decay: 0.005 }), noiseBurst({ lp: 6000, hp: 1500, decay: 0.006, delay: 0.07 }), tone({ f0: 1500, decay: 0.03, gain: 0.3, delay: 0.07 })), 0.55);
    B.bolt = this._buf(0.35, combine(noiseBurst({ lp: 7000, hp: 1800, decay: 0.006 }), tone({ f0: 1800, decay: 0.03, gain: 0.3 }), noiseBurst({ lp: 7000, hp: 1800, decay: 0.008, delay: 0.13 }), tone({ f0: 1650, decay: 0.04, gain: 0.35, delay: 0.13 })), 0.6);
    B.draw = this._buf(0.25, combine(noiseBurst({ lp: 5000, hp: 1500, decay: 0.01 }), noiseBurst({ lp: 4000, hp: 1200, decay: 0.01, delay: 0.08, gain: 0.6 })), 0.35);
    B.pickup = this._buf(0.25, combine(noiseBurst({ lp: 5000, hp: 1500, decay: 0.01 }), tone({ f0: 1400, decay: 0.04, gain: 0.3, delay: 0.05 })), 0.5);
    B.bomb_beep = this._buf(0.14, combine(tone({ f0: 1760, decay: 0.06, gain: 1 }), tone({ f0: 3520, decay: 0.04, gain: 0.3 })), 0.6);
    B.key_beep = this._buf(0.1, tone({ f0: 1200, decay: 0.04, gain: 1 }), 0.5);
    B.defuse_tick = this._buf(0.08, combine(noiseBurst({ lp: 6000, hp: 2500, decay: 0.004 }), tone({ f0: 800, decay: 0.02, gain: 0.3 })), 0.4);
    B.explosion = this._buf(3.0, (d, n, sr) => {
      let l = 0, ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const w = Math.random() * 2 - 1;
        const fc = 150 + 3200 * Math.exp(-t / 0.25);
        l += alpha(fc, sr) * (w - l);
        const f = 26 + 40 * Math.exp(-t / 0.2);
        ph += (TAU * f) / sr;
        const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.7);
        d[i] = Math.tanh((l * 4 + Math.sin(ph) * 1.2 * Math.exp(-t / 0.5)) * env * 1.8);
      }
    }, 1.0);
    B.he_explode = this._buf(1.6, (d, n, sr) => {
      let l = 0, ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const w = Math.random() * 2 - 1;
        const fc = 200 + 4000 * Math.exp(-t / 0.12);
        l += alpha(fc, sr) * (w - l);
        const f = 40 + 60 * Math.exp(-t / 0.1);
        ph += (TAU * f) / sr;
        const env = Math.min(1, t / 0.002) * Math.exp(-t / 0.35);
        d[i] = Math.tanh((l * 4 + Math.sin(ph) * Math.exp(-t / 0.25)) * env * 1.6);
      }
    }, 0.95);
    B.flash_bang = this._buf(0.8, combine(noiseBurst({ lp: 8000, hp: 800, decay: 0.03, gain: 1.4 }), noiseBurst({ lp: 1500, hp: 60, decay: 0.12 }), tone({ f0: 90, f1: 40, decay: 0.1, gain: 0.7 })), 0.95);
    B.tinnitus = this._buf(3.5, (d, n, sr) => {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += (TAU * 3400) / sr;
        d[i] = Math.sin(ph) * Math.min(1, t / 0.05) * Math.max(0, 1 - t / 3.5) ** 2;
      }
    }, 0.25);
    B.smoke_pop = this._buf(3.0, (d, n, sr) => {
      let l = 0, h = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const w = Math.random() * 2 - 1;
        l += alpha(6000, sr) * (w - l);
        h += alpha(1500, sr) * (l - h);
        d[i] = (l - h) * Math.min(1, t / 0.05) * Math.max(0, 1 - t / 3) * 3;
      }
    }, 0.5);
    B.bounce = this._buf(0.12, combine(tone({ f0: 1400, decay: 0.03, gain: 0.6 }), tone({ f0: 2300, decay: 0.02, gain: 0.4 }), noiseBurst({ lp: 5000, hp: 1000, decay: 0.004 })), 0.45);
    B.pin = this._buf(0.3, combine(noiseBurst({ lp: 7000, hp: 2500, decay: 0.005 }), tone({ f0: 2600, decay: 0.08, gain: 0.3 })), 0.45);
    B.throw = this._buf(0.25, (d, n, sr) => {
      let l = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const w = Math.random() * 2 - 1;
        l += alpha(800 + t * 1600, sr) * (w - l);
        d[i] = l * Math.sin(Math.PI * t) ** 2;
      }
    }, 0.35);
    B.eat = this._buf(0.65, combine(
      noiseBurst({ lp: 2600, hp: 500, decay: 0.025 }),
      noiseBurst({ lp: 2400, hp: 450, decay: 0.03, delay: 0.14 }),
      noiseBurst({ lp: 2200, hp: 400, decay: 0.03, delay: 0.3 }),
      tone({ f0: 190, f1: 130, decay: 0.12, gain: 0.25, delay: 0.45 }),
    ), 0.6);
    B.buy = this._buf(0.5, combine(tone({ f0: 1320, decay: 0.12, gain: 0.6 }), tone({ f0: 1760, decay: 0.2, gain: 0.7, delay: 0.07 }), noiseBurst({ lp: 6000, hp: 2000, decay: 0.006 })), 0.45);
    B.ui = this._buf(0.04, noiseBurst({ lp: 6000, hp: 1500, decay: 0.004 }), 0.3);
    B.denied = this._buf(0.2, tone({ f0: 180, decay: 0.12, gain: 1, type: 'square' }), 0.3);
    const arp = (notes, step, type) => combine(...notes.map((f, k) => tone({ f0: f, decay: 0.28, delay: k * step, gain: 0.6, type })));
    B.round_win = this._buf(1.2, arp([523, 659, 784, 1047], 0.11, 'square'), 0.35);
    B.round_lose = this._buf(1.2, arp([440, 349, 294, 220], 0.13, 'square'), 0.35);
    B.round_start = this._buf(0.6, arp([392, 523], 0.12, 'square'), 0.3);
  }

  setListener(pos, fwd) {
    if (!this.ctx) return;
    this.lp.x = pos.x; this.lp.y = pos.y; this.lp.z = pos.z;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  // opts: { pos:{x,y,z}, volume, rate, vary, ref, maxDist, occlude }
  play(name, opts = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    let buf = this.buffers[name];
    if (!buf) return;
    if (Array.isArray(buf)) buf = buf[Math.floor(Math.random() * buf.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const vary = opts.vary ?? 0.05;
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() - 0.5) * 2 * vary);
    const g = ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    src.connect(g);
    if (opts.pos) {
      const p = opts.pos;
      const dist = Math.hypot(p.x - this.lp.x, p.y - this.lp.y, p.z - this.lp.z);
      if (dist > (opts.maxDist ?? 140)) return;
      let cutoff = Math.max(1200, 20000 * Math.pow(0.5, dist / 22));
      if (opts.occlude !== false && this.occlusion && dist > 2 && this.occlusion(p.x, p.y, p.z)) cutoff = Math.min(cutoff, 750);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      const pan = ctx.createPanner();
      pan.panningModel = opts.hrtf ? 'HRTF' : 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = opts.ref ?? 4;
      pan.rolloffFactor = opts.rolloff ?? 1.2;
      pan.maxDistance = 10000;
      if (pan.positionX) {
        pan.positionX.value = p.x; pan.positionY.value = p.y; pan.positionZ.value = p.z;
      } else {
        pan.setPosition(p.x, p.y, p.z);
      }
      g.connect(f);
      f.connect(pan);
      pan.connect(this.master);
    } else {
      g.connect(this.master);
    }
    src.start();
    return src;
  }

  // Speech synthesis (announcer + bot trash talk). Non-priority lines are dropped while speaking.
  say(text, opts = {}) {
    if (!this.voice || !text || typeof speechSynthesis === 'undefined') return false;
    try {
      const s = speechSynthesis;
      if (opts.priority) s.cancel();
      else if (s.pending) return false; // allow one line queued behind the current one
      const u = new SpeechSynthesisUtterance(text);
      const v = this._pickVoice();
      if (v) u.voice = v;
      u.lang = v?.lang || this.lang;
      u.rate = opts.rate ?? 1.05;
      u.pitch = opts.pitch ?? 0.8;
      u.volume = Math.min(1, this.volume * 1.3);
      s.speak(u);
      return true;
    } catch {
      return false;
    }
  }

  _pickVoice() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;
    const want = this.lang.slice(0, 2).toLowerCase();
    const by = (pre) => voices.find((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith(pre));
    return by(want) || (want === 'sk' ? by('cs') : null) || null;
  }
}
