// Global tunables. Units: meters, seconds, degrees where noted.

export const TICK_RATE = 64;
export const DT = 1 / TICK_RATE;
export const DEG = Math.PI / 180;

// Multiplayer: bump NET_PROTOCOL whenever the wire format changes.
export const NET_PROTOCOL = 3;
// How far in the past remote players are rendered (seconds), so there are always two snapshots to blend.
export const NET_INTERP = 0.07;

export const MOVE = {
  gravity: 20,
  jumpSpeed: 6.8,
  friction: 5.2,
  stopSpeed: 2.0,
  accelerate: 5.5,
  airAccelerate: 12,
  airWishCap: 0.76,
  stepHeight: 0.55,
  walkMul: 0.52,
  crouchMul: 0.34,
  halfWidth: 0.3,
  standHeight: 1.8,
  crouchHeight: 1.2,
  standEye: 1.64,
  crouchEye: 1.06,
  crouchShift: 0.6,
};

export const TEAMS = ['T', 'CT'];
export const TEAM_NAME = { T: 'Terrorists', CT: 'Counter-Terrorists' };
export const TEAM_SHORT = { T: 'T', CT: 'CT' };
export const enemyOf = (team) => (team === 'T' ? 'CT' : 'T');

export const ECON = {
  startMoney: 800,
  maxMoney: 16000,
  winElim: 3250,
  winTime: 3250,
  winBomb: 3500,
  winDefuse: 3500,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 3400,
  plantTeamBonus: 800,
  plantBonus: 300,
  defuseBonus: 300,
};

export const ROUND = {
  freezeTime: 6,
  roundTime: 115,
  buyTime: 20,
  endDelay: 6,
  bombTimer: 40,
  plantTime: 3.2,
  defuseTime: 10,
  defuseKitTime: 5,
  bombRadius: 28,
  bombDamage: 500,
};

// Spray patterns: cumulative [yaw-right, pitch-up] offsets in degrees per bullet index.
export const RECOIL = {
  ak: [[0, 0], [0.02, 0.42], [-0.06, 0.98], [0.1, 1.62], [0.22, 2.32], [0.08, 3.02], [-0.18, 3.68], [-0.1, 4.28], [0.3, 4.78], [0.78, 5.16], [1.36, 5.42], [1.86, 5.6], [2.12, 5.76], [1.9, 5.88], [1.24, 5.98], [0.46, 6.06], [-0.42, 6.12], [-1.26, 6.16], [-1.98, 6.22], [-2.46, 6.26], [-2.4, 6.32], [-1.86, 6.38], [-1.1, 6.42], [-0.3, 6.46], [0.5, 6.5], [1.14, 6.52], [1.56, 6.56], [1.4, 6.6], [0.9, 6.62], [0.46, 6.66]],
  m4: [[0, 0], [0, 0.34], [-0.04, 0.8], [0.06, 1.32], [0.14, 1.86], [0.04, 2.4], [-0.14, 2.9], [-0.3, 3.34], [-0.12, 3.7], [0.3, 3.98], [0.74, 4.18], [1.06, 4.32], [1.14, 4.44], [0.86, 4.54], [0.34, 4.62], [-0.24, 4.68], [-0.8, 4.74], [-1.2, 4.78], [-1.32, 4.82], [-1.06, 4.86], [-0.56, 4.9], [0.02, 4.94], [0.56, 4.96], [0.94, 5.0], [1.02, 5.02], [0.74, 5.04], [0.3, 5.06], [-0.12, 5.08], [-0.4, 5.1], [-0.5, 5.12]],
  smg: [[0, 0], [0.02, 0.28], [-0.04, 0.6], [0.06, 0.9], [0.1, 1.18], [-0.06, 1.42], [-0.2, 1.62], [-0.08, 1.78], [0.16, 1.92], [0.36, 2.02], [0.4, 2.1], [0.2, 2.16], [-0.1, 2.22], [-0.36, 2.26], [-0.46, 2.3], [-0.3, 2.34], [0, 2.38], [0.3, 2.4], [0.46, 2.42], [0.36, 2.44], [0.06, 2.46], [-0.24, 2.48], [-0.4, 2.5], [-0.3, 2.52], [0, 2.54], [0.26, 2.56], [0.36, 2.58], [0.2, 2.6], [-0.06, 2.62], [-0.2, 2.64]],
  pistol: [[0, 0], [0.06, 0.8], [-0.1, 1.5], [0.12, 2.1], [-0.06, 2.6], [0.1, 3.0], [0, 3.3], [-0.12, 3.55], [0.1, 3.75], [0, 3.9], [-0.08, 4.0], [0.08, 4.1], [0, 4.2], [-0.06, 4.3], [0.06, 4.4], [0, 4.5], [0, 4.6], [0, 4.7], [0, 4.8], [0, 4.9]],
  deagle: [[0, 0], [0.12, 2.2], [-0.24, 4.0], [0.3, 5.4], [-0.1, 6.4], [0.22, 7.0], [0, 7.4]],
  awp: [[0, 0]],
};

// kind: melee | pistol | smg | rifle | sniper | grenade | bomb
export const WEAPONS = {
  knife: {
    id: 'knife', name: 'Knife', slot: 3, kind: 'melee', price: 0, speed: 6.35,
    damage: 40, damage2: 65, range: 1.9, interval: 0.42, interval2: 1.0, reward: 1500, draw: 0.5,
  },
  glock: {
    id: 'glock', name: 'Glock-18', slot: 2, kind: 'pistol', team: 'T', price: 200, speed: 6.1,
    damage: 28, armorPen: 0.47, rangeMod: 0.9, interval: 0.15, auto: false, mag: 20, reserve: 120,
    reload: 2.2, draw: 0.6, recoil: 'pistol', recoilRecover: 7, kick: 0.6, reward: 300, sound: 'glock',
    spread: { stand: 0.45, crouch: 0.35, move: 1.6, air: 5, shot: 0.55, recover: 3.5 },
  },
  usp: {
    id: 'usp', name: 'USP-S', slot: 2, kind: 'pistol', team: 'CT', price: 200, speed: 6.1,
    damage: 35, armorPen: 0.505, rangeMod: 0.99, interval: 0.17, auto: false, mag: 12, reserve: 24,
    reload: 2.2, draw: 0.6, recoil: 'pistol', recoilRecover: 7, kick: 0.7, reward: 300, sound: 'usp',
    spread: { stand: 0.3, crouch: 0.22, move: 1.4, air: 5, shot: 0.6, recover: 3.5 },
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle', slot: 2, kind: 'pistol', price: 700, speed: 5.84,
    damage: 63, armorPen: 0.932, rangeMod: 0.81, interval: 0.225, auto: false, mag: 7, reserve: 35,
    reload: 2.2, draw: 0.7, recoil: 'deagle', recoilRecover: 4, kick: 2.4, reward: 300, sound: 'deagle',
    spread: { stand: 0.35, crouch: 0.25, move: 3, air: 7, shot: 2.4, recover: 3.2 },
  },
  mp5: {
    id: 'mp5', name: 'MP5-SD', slot: 1, kind: 'smg', price: 1500, speed: 5.97,
    damage: 27, armorPen: 0.625, rangeMod: 0.85, interval: 0.075, auto: true, mag: 30, reserve: 120,
    reload: 2.6, draw: 0.8, recoil: 'smg', recoilRecover: 16, kick: 0.3, reward: 600, sound: 'smg',
    spread: { stand: 0.55, crouch: 0.45, move: 1.2, air: 4, shot: 0.22, recover: 3 },
  },
  ak47: {
    id: 'ak47', name: 'AK-47', slot: 1, kind: 'rifle', team: 'T', price: 2700, speed: 5.46,
    damage: 36, armorPen: 0.775, rangeMod: 0.98, interval: 0.1, auto: true, mag: 30, reserve: 90,
    reload: 2.45, draw: 0.9, recoil: 'ak', recoilRecover: 13, kick: 0.55, reward: 300, sound: 'ak',
    spread: { stand: 0.2, crouch: 0.13, move: 4.5, air: 9, shot: 0.32, recover: 2.8 },
  },
  m4a1: {
    id: 'm4a1', name: 'M4A1', slot: 1, kind: 'rifle', team: 'CT', price: 3100, speed: 5.72,
    damage: 33, armorPen: 0.7, rangeMod: 0.97, interval: 0.09, auto: true, mag: 30, reserve: 90,
    reload: 3.1, draw: 0.9, recoil: 'm4', recoilRecover: 14, kick: 0.45, reward: 300, sound: 'm4',
    spread: { stand: 0.17, crouch: 0.11, move: 3.8, air: 8, shot: 0.28, recover: 2.8 },
  },
  awp: {
    id: 'awp', name: 'AWP', slot: 1, kind: 'sniper', price: 4750, speed: 5.33, scopedSpeed: 2.54,
    damage: 115, armorPen: 0.975, rangeMod: 0.99, interval: 1.46, auto: false, mag: 10, reserve: 30,
    reload: 3.7, draw: 1.1, recoil: 'awp', recoilRecover: 5, kick: 3.5, reward: 100, sound: 'awp',
    zoom: [40, 15],
    spread: { stand: 0.02, crouch: 0.015, move: 6, air: 12, shot: 0, recover: 5, unscoped: 7 },
  },
  he: { id: 'he', name: 'HE Grenade', slot: 4, kind: 'grenade', price: 300, speed: 6.1, max: 1, reward: 300, draw: 0.5 },
  flash: { id: 'flash', name: 'Flashbang', slot: 4, kind: 'grenade', price: 200, speed: 6.1, max: 2, reward: 300, draw: 0.5 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', slot: 4, kind: 'grenade', price: 300, speed: 6.1, max: 1, reward: 300, draw: 0.5 },
  c4: { id: 'c4', name: 'C4 Explosive', slot: 5, kind: 'bomb', price: 0, speed: 6.35, draw: 0.6 },
};

export const GEAR = {
  kevlar: { id: 'kevlar', name: 'Kevlar Vest', price: 650 },
  helmet: { id: 'helmet', name: 'Kevlar + Helmet', price: 1000 },
  defuser: { id: 'defuser', name: 'Defuse Kit', price: 400, team: 'CT' },
};

// Numeric buy menu (CS 1.6 style). 'team' entries resolve per side.
export const BUY_MENU = [
  { name: 'Pistols', items: [{ T: 'glock', CT: 'usp' }, 'deagle'] },
  { name: 'SMGs', items: ['mp5'] },
  { name: 'Rifles', items: [{ T: 'ak47', CT: 'm4a1' }, 'awp'] },
  { name: 'Gear', items: ['kevlar', 'helmet', 'defuser'] },
  { name: 'Grenades', items: ['he', 'flash', 'smoke'] },
];

export const HITGROUP = {
  head: { mult: 4, armored: 'helmet' },
  chest: { mult: 1, armored: 'kevlar' },
  stomach: { mult: 1.25, armored: 'kevlar' },
  legs: { mult: 0.75, armored: null },
};

export const DIFFICULTY = {
  easy: { reaction: 0.62, aimError: 6, errorHalfLife: 0.6, wobble: 1.1, turnSpeed: 200, headChance: 0.1, recoilComp: 0.35, burstMul: 0.7, strafe: 0.1, sprayDist: 6 },
  normal: { reaction: 0.38, aimError: 3.6, errorHalfLife: 0.4, wobble: 0.6, turnSpeed: 330, headChance: 0.25, recoilComp: 0.6, burstMul: 1, strafe: 0.35, sprayDist: 9 },
  hard: { reaction: 0.24, aimError: 2.2, errorHalfLife: 0.26, wobble: 0.32, turnSpeed: 520, headChance: 0.42, recoilComp: 0.82, burstMul: 1.3, strafe: 0.6, sprayDist: 12 },
};

export const BOT_NAMES = [
  'Jožko', 'Fero', 'Ďuro', 'Vasiľ', 'Paľo', 'Mišo', 'Tibi', 'Laci', 'Zoli', 'Janko',
  'Imro', 'Štefo', 'Andrej', 'Miro', 'Peťo', 'Rudo', 'Marek', 'Dano', 'Igor', 'Karči',
];
