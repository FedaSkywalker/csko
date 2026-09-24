// Wire format shared by the Node server and the browser client (plain JSON, ids instead of objects).
import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { makeCmd } from './agent.js';

const AGENT_KEYS = new Set(['agent', 'victim', 'killer', 'attacker', 'shooter', 'by', 'mvp']);
const REQUIRED = new Set(['agent', 'victim', 'shooter']);
const VEC_KEYS = new Set(['origin', 'dir']);
const r3 = (v) => Math.round(v * 1000) / 1000;
const r5 = (v) => Math.round(v * 100000) / 100000;

export function encodeEvent(name, data) {
  const o = { n: name };
  for (const k in data) {
    const v = data[k];
    if (v === undefined || k === 'item') continue;
    if (v === null) o[k] = null;
    else if (AGENT_KEYS.has(k)) o[k] = v.id;
    else if (k === 'def') o[k] = typeof v === 'string' ? v : { id: v.id, name: v.name };
    else if (VEC_KEYS.has(k)) o[k] = [r3(v.x), r3(v.y), r3(v.z)];
    else if (typeof v === 'number') o[k] = r3(v);
    else o[k] = v;
  }
  return o;
}

export function resolveDef(d) {
  if (!d) return null;
  if (typeof d === 'string') return WEAPONS[d] || { id: d, name: d };
  const base = WEAPONS[d.id];
  if (base && base.name === d.name) return base;
  return { ...(base || {}), id: d.id, name: d.name };
}

// Returns { name, data } or null when the event refers to an agent the client doesn't know yet.
export function decodeEvent(sim, o) {
  const data = { $net: true };
  for (const k in o) {
    if (k === 'n') continue;
    const v = o[k];
    if (AGENT_KEYS.has(k)) {
      const a = v == null ? null : sim.byId.get(v) || null;
      if (!a && v != null && REQUIRED.has(k)) return null;
      data[k] = a;
    } else if (k === 'def') {
      data[k] = typeof v === 'string' ? v : resolveDef(v);
    } else if (VEC_KEYS.has(k)) {
      data[k] = Array.isArray(v) ? new THREE.Vector3(v[0], v[1], v[2]) : null;
    } else data[k] = v;
  }
  return { name: o.n, data };
}

export function rosterList(sim) {
  return sim.agents.map((a) => [a.id, a.name, a.team, a.isBot ? 1 : 0]);
}

export function agentPublic(a, time) {
  const def = a.currentDef;
  const cur = a.current;
  const p = a.body.pos, v = a.body.vel;
  const flags = (a.alive ? 1 : 0) | (a.crouched ? 2 : 0) | (a.body.onGround ? 4 : 0) | (a.planting ? 8 : 0)
    | (a.defusing ? 16 : 0) | (a.hasBomb ? 32 : 0) | (a.defuser ? 64 : 0) | (a.helmet ? 128 : 0)
    | ((a.spottedUntil || 0) > time ? 256 : 0) | (a.ws.scoped ? 512 : 0);
  return [
    a.id, r3(p.x), r3(p.y), r3(p.z), r3(a.yaw), r3(a.pitch), flags, def.id, cur?.mag ?? 0, cur?.reserve ?? 0,
    Math.max(0, Math.round(a.health)), Math.round(a.armor), a.money, a.kills, a.deaths, a.assists, a.headshots, a.mvps,
    r3(v.x), r3(v.z), r3(a.viewEye), a.inv[1]?.def.id || '', a.inv[2]?.def.id || '', a.grenades.join(','),
  ];
}

export function snapshotCommon(sim, events) {
  const R = sim.round;
  const b = R.bomb;
  return {
    time: r5(sim.time),
    r: [R.phase, R.round, r3(R.timer), r3(R.liveStart), R.score.T, R.score.CT, R.winsNeeded, R.matchWinner || '', R.lastWinner || '', R.lastReason || '', R.tPlan?.site || 'A'],
    b: [b.state, r3(b.pos.x), r3(b.pos.y), r3(b.pos.z), r3(b.timer), b.site || '', b.carrier?.id ?? -1, b.item?.id ?? -1, r3(b.yaw || 0)],
    a: sim.agents.map((a) => agentPublic(a, sim.time)),
    d: sim.drops.items.map((it) => [it.id, it.def.id, r3(it.pos.x), r3(it.pos.y), r3(it.pos.z), r3(it.yaw)]),
    n: sim.grenades.list.map((g) => [g.nid, g.type, r3(g.pos.x), r3(g.pos.y), r3(g.pos.z)]),
    sm: sim.grenades.smokes.map((s) => [r3(s.x), r3(s.y), r3(s.z), r3(s.start), r3(s.end)]),
    pk: sim.pickups.items.map((it) => (it.available ? 1 : 0)),
    e: events,
  };
}

export function snapshotPrivate(a) {
  if (!a) return null;
  const ws = a.ws;
  const inv = [];
  for (const s of [1, 2, 3, 5]) {
    const w = a.inv[s];
    if (w) inv.push([s, w.def.id, w.mag ?? 0, w.reserve ?? 0]);
  }
  return {
    mv: a.movementState().map(r5),
    inv,
    g: a.grenades,
    gi: a.grenadeIdx,
    sl: a.slot,
    ls: a.lastSlot,
    ws: [r5(ws.nextFire), r5(ws.reloadEnd), r5(ws.reloadStart), r5(ws.drawEnd), r3(ws.recoil), r3(ws.bloom), r5(ws.lastShot), ws.scoped, ws.pinPulled ? 1 : 0],
    k: r3(a.kick),
    pu: r3(a.punch),
    pp: r3(a.plantProgress),
    dp: r3(a.defuseProgress),
    bl: [r5(a.blindUntil), r3(a.blindAmount), r3(a.blindDuration)],
  };
}

// Compact client command.
export function encodeCmd(c, seq, vt) {
  return {
    t: 'c', q: seq, f: c.forward, s: c.side, j: c.jump ? 1 : 0, c: c.crouch ? 1 : 0, w: c.walk ? 1 : 0,
    a: c.fire ? 1 : 0, b: c.fire2 ? 1 : 0, r: c.reload ? 1 : 0, u: c.use ? 1 : 0, d: c.drop ? 1 : 0,
    sl: c.slot, nw: c.nextWeapon, lw: c.lastWeapon ? 1 : 0, y: r5(c.yaw), p: r5(c.pitch), vt: r5(vt),
  };
}

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

export function decodeCmd(m) {
  const c = makeCmd();
  c.seq = Math.floor(num(m.q, 0, 1e12));
  c.forward = num(m.f, -1, 1);
  c.side = num(m.s, -1, 1);
  c.jump = !!m.j;
  c.crouch = !!m.c;
  c.walk = !!m.w;
  c.fire = !!m.a;
  c.fire2 = !!m.b;
  c.reload = !!m.r;
  c.use = !!m.u;
  c.drop = !!m.d;
  c.slot = Math.floor(num(m.sl, 0, 5));
  c.nextWeapon = Math.sign(num(m.nw, -9, 9));
  c.lastWeapon = !!m.lw;
  c.yaw = num(m.y, -1e6, 1e6);
  c.pitch = num(m.p, -1.6, 1.6);
  c.vt = num(m.vt, 0, 1e9);
  return c;
}
