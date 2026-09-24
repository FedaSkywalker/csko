// Purchasing for both the player buy menu and bots.
import { WEAPONS, GEAR, BUY_MENU } from './config.js';

export function resolveItem(entry, team) {
  return typeof entry === 'string' ? entry : entry[team];
}

export function itemInfo(id) {
  if (WEAPONS[id]) return { id, name: WEAPONS[id].name, price: WEAPONS[id].price, def: WEAPONS[id] };
  if (GEAR[id]) return { id, name: GEAR[id].name, price: GEAR[id].price, gear: GEAR[id] };
  return null;
}

export class Shop {
  constructor(game) {
    this.game = game;
  }

  priceFor(agent, id) {
    if (id === 'helmet') return agent.armor >= 100 ? 350 : 1000;
    const info = itemInfo(id);
    return info ? info.price : Infinity;
  }

  // Returns a reason string when the purchase is impossible, or null when allowed.
  check(agent, id) {
    const g = this.game;
    if (!g.round.canBuy(agent)) return 'Not in buy zone / buy time over';
    const info = itemInfo(id);
    if (!info) return 'Unknown item';
    const price = this.priceFor(agent, id);
    if (agent.money < price) return 'Not enough money';
    if (id === 'kevlar' && agent.armor >= 100) return 'Already have armor';
    if (id === 'helmet' && agent.armor >= 100 && agent.helmet) return 'Already have armor';
    if (id === 'defuser') {
      if (agent.team !== 'CT') return 'CT only';
      if (agent.defuser) return 'Already have a kit';
    }
    const def = info.def;
    if (def) {
      if (def.team && def.team !== agent.team) return 'Wrong team';
      if (def.kind === 'grenade') {
        const count = agent.grenades.filter((x) => x === id).length;
        if (count >= def.max || agent.grenades.length >= 4) return 'Cannot carry more';
      } else if (agent.inv[def.slot] && agent.inv[def.slot].def.id === id) {
        return 'Already have it';
      }
    }
    return null;
  }

  buy(agent, id, silent = false) {
    const why = this.check(agent, id);
    if (why) {
      if (!silent) this.game.emit('buyFail', { agent, id, reason: why });
      return false;
    }
    const price = this.priceFor(agent, id);
    agent.money -= price;
    if (id === 'kevlar') {
      agent.armor = 100;
    } else if (id === 'helmet') {
      agent.armor = 100;
      agent.helmet = true;
    } else if (id === 'defuser') {
      agent.defuser = true;
    } else {
      const def = WEAPONS[id];
      if (def.kind !== 'grenade' && agent.inv[def.slot]) {
        const old = agent.inv[def.slot];
        agent.inv[def.slot] = null;
        this.game.drops.spawnFromAgent(agent, old);
      }
      agent.giveWeapon(id, this.game.time, def.kind !== 'grenade');
    }
    this.game.emit('buy', { agent, id, silent });
    return true;
  }

  menuFor(team) {
    return BUY_MENU.map((cat) => ({
      name: cat.name,
      items: cat.items.map((e) => resolveItem(e, team)).filter((id) => {
        const info = itemInfo(id);
        if (!info) return false;
        if (info.def?.team && info.def.team !== team) return false;
        if (info.gear?.team && info.gear.team !== team) return false;
        return true;
      }),
    }));
  }
}
