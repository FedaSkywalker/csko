// Health pickups: fried cheese ("vyprážaný syr") served at the Turkish Kebab restaurant.
export const CHEESE_HEAL = 50;
export const CHEESE_RESPAWN = 25;
const RADIUS = 1.5;

export class Pickups {
  constructor(game) {
    this.game = game;
    this.items = (game.layout.pickupSpots || []).map((s, i) => ({
      id: i, type: s.type, x: s.x, y: s.y, z: s.z, available: true, respawnAt: 0,
    }));
  }

  reset() {
    for (const it of this.items) {
      it.available = true;
      it.respawnAt = 0;
    }
  }

  // Distance with floors weighted in, so a bot on another level doesn't count as "close".
  nearestAvailable(x, z, y) {
    let best = null, bestD = Infinity;
    for (const it of this.items) {
      if (!it.available) continue;
      const d = Math.hypot(it.x - x, it.z - z, y === undefined ? 0 : (it.y - 1 - y) * 4);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  tick() {
    const g = this.game;
    for (const it of this.items) {
      if (!it.available) {
        if (g.time >= it.respawnAt) it.available = true;
        continue;
      }
      for (const a of g.agents) {
        if (!a.alive || a.health >= 100) continue;
        if (Math.hypot(a.pos.x - it.x, a.pos.z - it.z) > RADIUS || Math.abs(a.pos.y + 0.9 - it.y) > 1.6) continue;
        const before = a.health;
        a.health = Math.min(100, a.health + CHEESE_HEAL);
        it.available = false;
        it.respawnAt = g.time + CHEESE_RESPAWN;
        g.emit('eat', { agent: a, id: it.id, amount: a.health - before, x: it.x, y: it.y, z: it.z });
        break;
      }
    }
  }
}
