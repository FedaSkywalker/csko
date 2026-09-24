// DOM heads-up display: vitals, ammo, timer, radar, kill feed, scoreboard, buy menu, overlays.
import { TEAM_NAME, WEAPONS, DEG, ROUND } from './config.js';
import { itemInfo } from './shop.js';
import { formatTime, clamp, wrapAngle } from './util.js';
import { levelAt } from './map/layout.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  hs: '<svg class="ico hs" viewBox="0 0 24 24"><circle cx="12" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 1v5M12 14v5M3 10h5M16 10h5" stroke="currentColor" stroke-width="2.4"/></svg>',
  wall: '<svg class="ico" viewBox="0 0 24 24"><path d="M3 5h18M3 12h18M3 19h18M8 5v7M16 5v7M12 12v7" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  skull: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14z" fill="currentColor"/><circle cx="9" cy="11" r="2" fill="#000"/><circle cx="15" cy="11" r="2" fill="#000"/></svg>',
  bomb: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="11" rx="1" fill="currentColor"/><rect x="12" y="9" width="7" height="4" fill="#300"/><path d="M6 7V4h4" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  kit: '<svg class="ico" viewBox="0 0 24 24"><path d="M4 8h16v10H4z" fill="currentColor"/><path d="M9 8V5h6v3" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
};

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {};
    for (const id of ['hud', 'crosshair', 'scope', 'flashOverlay', 'smokeOverlay', 'hurt', 'dmgArc', 'radar', 'location',
      'scoreT', 'scoreCT', 'aliveT', 'aliveCT', 'timer', 'killfeed', 'hp', 'armor', 'armorIcon', 'money', 'moneyDelta',
      'weaponName', 'mag', 'reserve', 'ammo', 'inventory', 'centerMsg', 'centerTitle', 'centerSub', 'hint', 'progress',
      'progressLabel', 'progressFill', 'targetName', 'spectate', 'netgraph', 'buymenu', 'scoreboard', 'roundNo', 'bottomLeft',
      'bottomRight', 'deathInfo', 'chat', 'chatInputWrap', 'chatInput', 'chatPrefix']) {
      this.el[id] = $(id);
    }
    this.chLines = this.el.crosshair.querySelectorAll('.ch');
    this.cache = {};
    this.hurt = 0;
    this.dmgArc = 0;
    this.dmgAngle = 0;
    this.centerUntil = 0;
    this.feed = [];
    this.chat = [];
    this.buyOpen = false;
    this.buyCat = -1;
    this.showScores = false;
    this.showNet = false;
    this.fps = 60;
    this.moneyShown = null;
    this.chatOpen = false;
    this.chatTeam = false;
    this.buildRadar();
    this.el.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.el.chatInput.value.trim();
        if (text) this.game.sendChat(text, this.chatTeam);
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      }
    });
  }

  openChat(team) {
    this.chatOpen = true;
    this.chatTeam = team;
    this.el.chatPrefix.textContent = team ? 'TEAM' : 'ALL';
    this.el.chatPrefix.classList.toggle('team', team);
    this.el.chatInput.value = '';
    this.el.chatInputWrap.classList.remove('hidden');
    setTimeout(() => this.el.chatInput.focus(), 0);
  }

  closeChat() {
    this.chatOpen = false;
    this.el.chatInput.blur();
    this.el.chatInputWrap.classList.add('hidden');
  }

  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  // ------------------------------------------------------------ radar
  // One image per radar level (multi-floor maps get an upper and a lower picture).
  buildRadar() {
    const g = this.game;
    const L = g.layout;
    const nav = g.map.nav;
    const S = g.world.solidCols;
    const C = g.world.cols;
    const W = L.width, D = L.depth;
    const Sc = 3;
    const inLevel = (lv, y) => y >= lv.y0 && y < lv.y1;
    const nodeIn = (i, lv) => {
      let n = -1;
      for (let m = nav.first[i]; m < nav.first[i + 1]; m++) if (nav.reach[m] && inLevel(lv, nav.y[m])) n = m;
      return n;
    };
    this.radarLevels = L.levels.map((lv) => {
      const floor = lv.floor ?? Math.max(0, lv.y0);
      const c = document.createElement('canvas');
      c.width = W * Sc;
      c.height = D * Sc;
      const ctx = c.getContext('2d');
      const node = new Int32Array(W * D);
      for (let i = 0; i < W * D; i++) node[i] = nodeIn(i, lv);
      for (let z = 0; z < D; z++) {
        for (let x = 0; x < W; x++) {
          const i = z * W + x;
          const n = node[i];
          let col = null;
          if (n >= 0) {
            const rel = nav.y[n] - floor;
            let r = 150, gg = 140, b = 122;
            if (Math.abs(rel) > 0.05) {
              r = Math.min(255, 170 + rel * 25); gg = Math.min(255, 160 + rel * 22); b = Math.min(255, 140 + rel * 18);
              if (rel < 0) { r = 150 + rel * 12; gg = 140 + rel * 12; b = 122 + rel * 12; }
            }
            if (nav.ceil[n] < 1e5) { r *= 0.63; gg *= 0.66; b *= 0.7; }
            col = `rgba(${r | 0},${gg | 0},${b | 0},0.92)`;
          } else {
            // Not walkable on this level: wall edge, prop, low wall or a drop to another floor.
            let fy = null;
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx, nz = z + dz;
              if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
              const m = node[nz * W + nx];
              if (m >= 0) { fy = nav.y[m]; break; }
            }
            if (fy !== null) {
              if (S.isFree(i, fy - 0.4, fy + 1.2)) col = 'rgba(10,10,12,0.75)';
              else if (C.isFree(i, fy + 0.3, fy + 1.5)) col = 'rgba(95,75,50,0.95)';
              else if (S.isFree(i, fy + 2.6, fy + 4)) col = 'rgba(120,110,95,0.95)';
              else col = 'rgba(20,20,20,0.9)';
            }
          }
          if (col) {
            ctx.fillStyle = col;
            ctx.fillRect(x * Sc, z * Sc, Sc, Sc);
          }
        }
      }
      for (const st of Object.values(L.sites)) {
        if (st.y0 !== undefined && !inLevel(lv, st.cy)) continue;
        ctx.fillStyle = 'rgba(200,60,40,0.18)';
        ctx.fillRect(st.x0 * Sc, st.z0 * Sc, (st.x1 - st.x0) * Sc, (st.z1 - st.z0) * Sc);
        ctx.fillStyle = 'rgba(230,80,50,0.9)';
        ctx.font = `bold ${10 * Sc}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(st.name, st.cx * Sc, st.cz * Sc);
      }
      return { img: c, name: lv.name };
    });
    this.radarImg = this.radarLevels[0].img;
    this.radarScale = Sc;
    this.radarCtx = this.el.radar.getContext('2d');
  }

  _drawRadar(view, yaw) {
    const g = this.game;
    const ctx = this.radarCtx;
    const W = this.el.radar.width, H = this.el.radar.height;
    const S = this.radarScale;
    const zoom = 1.25;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    ctx.clip();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(yaw);
    ctx.scale(zoom, zoom);
    const L = g.layout;
    const level = levelAt(L, view.y + 0.2);
    const multi = this.radarLevels.length > 1;
    ctx.drawImage(this.radarLevels[level].img, -view.x * S, -view.z * S);
    const me = g.player;
    const t = g.time;
    // Things on another floor are drawn faded.
    const other = (y) => multi && levelAt(L, y + 0.2) !== level;
    const dot = (x, z, color, r = 3.2, ring = false, y = view.y) => {
      const px = (x - view.x) * S, pz = (z - view.z) * S;
      ctx.globalAlpha = other(y) ? 0.4 : 1;
      ctx.beginPath();
      ctx.arc(px, pz, r * 1.1, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (ring) { ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); }
      ctx.globalAlpha = 1;
    };
    const b = g.round.bomb;
    const bombKnown = me.team === 'T' || b.state === 'planted';
    if (bombKnown) {
      let bp = null;
      if (b.state === 'planted') bp = b.pos;
      else if (b.state === 'dropped' && b.item) bp = b.item.pos;
      if (bp) {
        const px = (bp.x - view.x) * S, pz = (bp.z - view.z) * S;
        ctx.globalAlpha = other(bp.y) ? 0.45 : 1;
        ctx.fillStyle = b.state === 'planted' && Math.sin(t * 10) > 0 ? '#ff3020' : '#ffa020';
        ctx.fillRect(px - 4, pz - 3, 8, 6);
        ctx.globalAlpha = 1;
      }
    }
    for (const it of g.sim?.pickups?.items || []) {
      if (!it.available || other(it.y - 1)) continue;
      const px = (it.x - view.x) * S, pz = (it.z - view.z) * S;
      ctx.fillStyle = '#ff9a2e';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.fillRect(px - 3, pz - 3, 6, 6);
      ctx.strokeRect(px - 3, pz - 3, 6, 6);
    }
    for (const a of g.agents) {
      if (!a.alive || a === view.agent) continue;
      if (a.team === me.team) {
        dot(a.pos.x, a.pos.z, a.team === 'T' ? '#f0c040' : '#58a8ff', 3.2, me.team === 'T' && a.hasBomb, a.pos.y);
      } else if (a.spottedUntil > t) {
        dot(a.pos.x, a.pos.z, '#ff3b30', 3.4, false, a.pos.y);
      }
    }
    ctx.restore();
    // Viewer arrow
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (multi) {
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(this.radarLevels[level].name, W / 2, H - 12);
    }
  }

  // ------------------------------------------------------------ events
  center(title, sub = '', dur = 3, cls = '') {
    this.el.centerTitle.textContent = title;
    this.el.centerSub.innerHTML = sub;
    this.el.centerMsg.className = `show ${cls}`;
    this.centerUntil = this.game.realTime + dur;
  }

  addKill(e) {
    const { victim, killer, def, headshot } = e;
    const me = this.game.player;
    const div = document.createElement('div');
    div.className = 'kf' + (victim === me || killer === me ? ' me' : '');
    const nameSpan = (a) => `<span class="n ${a.team === 'T' ? 't' : 'ct'}">${esc(a.name)}</span>`;
    let html = '';
    if (killer && killer !== victim) html += nameSpan(killer);
    html += `<span class="w">${esc(def?.name || 'World')}</span>`;
    if (headshot) html += ICON.hs;
    html += nameSpan(victim);
    div.innerHTML = html;
    this.el.killfeed.appendChild(div);
    this.feed.push({ div, until: this.game.realTime + 7 });
    while (this.feed.length > 6) this.feed.shift().div.remove();
  }

  addChat(agent, text, { dead = false, team = false } = {}) {
    const div = document.createElement('div');
    div.className = 'chat';
    div.innerHTML = `${dead ? '<span class="dead">*MERTVY*</span>' : ''}${team ? '<span class="tm">(tim)</span>' : ''}<span class="cn ${agent.team === 'T' ? 't' : 'ct'}">${esc(agent.name)}</span>: ${esc(text)}`;
    this.el.chat.appendChild(div);
    this.chat.push({ div, until: this.game.realTime + 9 });
    while (this.chat.length > 7) this.chat.shift().div.remove();
  }

  onPlayerDamaged(e) {
    const p = this.game.player;
    this.hurt = Math.min(1, this.hurt + e.amount / 45);
    if (e.attacker && e.attacker !== p) {
      const dx = e.attacker.pos.x - p.pos.x, dz = e.attacker.pos.z - p.pos.z;
      const ang = Math.atan2(-dx, -dz);
      this.dmgAngle = -wrapAngle(ang - p.yaw);
      this.dmgArc = 1;
    }
  }

  // ------------------------------------------------------------ buy menu
  openBuy() {
    this.buyOpen = true;
    this.buyCat = -1;
    this.renderBuy();
  }

  closeBuy() {
    this.buyOpen = false;
    this.el.buymenu.classList.add('hidden');
  }

  buyKey(n) {
    const g = this.game;
    const menu = g.shop.menuFor(g.player.team);
    if (this.buyCat < 0) {
      if (n === 0) { this.closeBuy(); return; }
      if (n >= 1 && n <= menu.length) { this.buyCat = n - 1; g.audio.play('ui'); }
    } else {
      if (n === 0) { this.buyCat = -1; g.audio.play('ui'); } else {
        const id = menu[this.buyCat].items[n - 1];
        if (id) g.requestBuy(id);
      }
    }
    this.renderBuy();
  }

  renderBuy() {
    const g = this.game;
    const p = g.player;
    const menu = g.shop.menuFor(p.team);
    let html = `<div class="bm-head"><span>BUY MENU</span><span class="bm-money">$${p.money}</span><span class="bm-time">${formatTime(g.round.buyTimeLeft())}</span></div>`;
    if (this.buyCat < 0) {
      menu.forEach((cat, i) => { html += `<div class="bm-row"><span class="k">${i + 1}</span>${esc(cat.name)}</div>`; });
      html += '<div class="bm-row dim"><span class="k">0</span>Close</div>';
    } else {
      const cat = menu[this.buyCat];
      html += `<div class="bm-cat">${esc(cat.name)}</div>`;
      cat.items.forEach((id, i) => {
        const info = itemInfo(id);
        const why = g.shop.check(p, id);
        const price = g.shop.priceFor(p, id);
        html += `<div class="bm-row ${why ? 'dim' : ''}"><span class="k">${i + 1}</span>${esc(info.name)}<span class="p">$${price}</span></div>`;
      });
      html += '<div class="bm-row dim"><span class="k">0</span>Back</div>';
    }
    html += '<div class="bm-foot">Number keys to buy · B to close</div>';
    this.el.buymenu.innerHTML = html;
    this.el.buymenu.classList.remove('hidden');
  }

  // ------------------------------------------------------------ scoreboard
  renderScoreboard() {
    const g = this.game;
    const me = g.player;
    const row = (a) => {
      const hs = a.kills ? Math.round((a.headshots / a.kills) * 100) : 0;
      const own = a.team === me.team;
      const bomb = own && a.team === 'T' && a.hasBomb ? ICON.bomb : '';
      const kit = own && a.defuser ? ICON.kit : '';
      const tag = a.isBot ? '<span class="bot">BOT</span> ' : '';
      return `<tr class="${a.alive ? '' : 'dead'} ${a === me ? 'me' : ''}"><td class="nm">${tag}${esc(a.name)} ${bomb}${kit}</td><td>${own ? '$' + a.money : ''}</td><td>${a.kills}</td><td>${a.assists}</td><td>${a.deaths}</td><td>${hs}%</td><td>${a.mvps ? '★' + a.mvps : ''}</td></tr>`;
    };
    const table = (team) => {
      const list = g.agents.filter((a) => a.team === team).sort((x, y) => y.kills - x.kills || x.deaths - y.deaths);
      return `<div class="sb-team ${team === 'T' ? 't' : 'ct'}"><div class="sb-title"><span>${TEAM_NAME[team]}</span><span class="sb-score">${g.round.score[team]}</span></div>
        <table><tr class="hdr"><th class="nm">Player</th><th>Money</th><th>K</th><th>A</th><th>D</th><th>HS</th><th>MVP</th></tr>${list.map(row).join('')}</table></div>`;
    };
    const where = g.mode === 'net' ? `Room ${esc(g.roomName || '')}` : 'Offline';
    const html = `<div class="sb-head">Dustline · ${where} · Round ${g.round.round} · First to ${g.round.winsNeeded}</div>${table('CT')}${table('T')}`;
    if (this.cache.sb !== html) {
      this.cache.sb = html;
      this.el.scoreboard.innerHTML = html;
    }
  }

  // ------------------------------------------------------------ frame update
  update(dt) {
    const g = this.game;
    const R = g.round;
    const p = g.player;
    const view = g.spectating && g.spectateTarget ? g.spectateTarget : p;
    const now = g.realTime;

    // Top bar
    this.set('scoreT', this.el.scoreT, String(R.score.T));
    this.set('scoreCT', this.el.scoreCT, String(R.score.CT));
    this.set('aliveT', this.el.aliveT, '▮'.repeat(R.aliveCount('T')));
    this.set('aliveCT', this.el.aliveCT, '▮'.repeat(R.aliveCount('CT')));
    const planted = R.bomb.state === 'planted' && R.phase === 'live';
    const timerText = planted ? 'C4' : formatTime(R.timeLeft());
    this.set('timer', this.el.timer, timerText);
    this.el.timer.classList.toggle('bomb', planted);
    this.el.timer.classList.toggle('freeze', R.phase === 'freeze');
    this.set('roundNo', this.el.roundNo, `Round ${R.round}`);

    // Vitals and ammo of the viewed agent
    this.set('hp', this.el.hp, String(view.health));
    this.el.bottomLeft.classList.toggle('low', view.health <= 25);
    this.set('armor', this.el.armor, String(view.armor));
    this.set('armorIcon', this.el.armorIcon, view.helmet ? 'Ⓗ' : '◈');
    if (this.moneyShown === null || view !== this.lastView) this.moneyShown = view.money;
    this.lastView = view;
    if (this.moneyShown !== view.money) {
      const d = view.money - this.moneyShown;
      this.el.moneyDelta.textContent = (d > 0 ? '+$' : '-$') + Math.abs(d);
      this.el.moneyDelta.className = d > 0 ? 'show plus' : 'show minus';
      this.moneyDeltaUntil = now + 1.8;
      this.moneyShown = view.money;
    }
    if (this.moneyDeltaUntil && now > this.moneyDeltaUntil) { this.el.moneyDelta.className = ''; this.moneyDeltaUntil = 0; }
    this.set('money', this.el.money, `$${view.money}`);
    this.el.money.classList.toggle('canbuy', !g.spectating && R.canBuy(p));
    const def = view.currentDef;
    const w = view.current;
    this.set('weaponName', this.el.weaponName, def.name);
    if (def.mag) {
      this.set('mag', this.el.mag, String(w.mag));
      this.set('reserve', this.el.reserve, String(w.reserve));
      this.el.ammo.style.visibility = 'visible';
      this.el.ammo.classList.toggle('low', w.mag <= Math.ceil(def.mag * 0.2));
    } else if (def.kind === 'grenade') {
      this.set('mag', this.el.mag, String(view.grenades.filter((x) => x === def.id).length));
      this.set('reserve', this.el.reserve, '');
      this.el.ammo.style.visibility = 'visible';
      this.el.ammo.classList.remove('low');
    } else {
      this.el.ammo.style.visibility = 'hidden';
    }

    // Inventory list (like the CS weapon strip)
    const inv = [];
    for (const s of [1, 2, 3]) if (view.inv[s]) inv.push([s, view.inv[s].def.name, view.slot === s]);
    if (view.grenades.length) inv.push([4, view.grenades.map((id) => WEAPONS[id].name.split(' ')[0]).join(' · '), view.slot === 4]);
    if (view.inv[5]) inv.push([5, 'C4', view.slot === 5]);
    const invHtml = inv.map(([s, n, on]) => `<div class="inv ${on ? 'on' : ''}"><span class="k">${s}</span>${esc(n)}</div>`).join('');
    this.set('inv', this.el.inventory, invHtml, 'innerHTML');

    // Crosshair / scope
    const scoped = view.ws.scoped > 0 && view.alive;
    this.el.scope.classList.toggle('show', scoped);
    const showCh = !scoped && view.alive && !g.spectating && def.kind !== 'sniper';
    this.el.crosshair.style.display = showCh ? 'block' : (def.kind === 'sniper' && !scoped && !g.spectating ? 'block' : 'none');
    if (showCh || (def.kind === 'sniper' && !scoped)) {
      const inacc = def.kind === 'melee' || def.kind === 'grenade' || def.kind === 'bomb' ? 0.3 : view.inaccuracy();
      const hpx = window.innerHeight / 2;
      const gap = 3 + (Math.tan(inacc * DEG) / Math.tan((g.camera.fov * DEG) / 2)) * hpx;
      const gp = Math.min(80, gap).toFixed(1);
      if (this.cache.chgapApplied !== gp) {
        this.cache.chgapApplied = gp;
        this.el.crosshair.style.setProperty('--gap', `${gp}px`);
      }
    }

    // Overlays
    const blindLeft = view.blindUntil - g.time;
    let flash = 0;
    if (blindLeft > 0 && view.alive) {
      const fadeTime = Math.min(2.2, view.blindDuration * 0.7);
      flash = clamp(blindLeft / fadeTime, 0, 1) * clamp(0.35 + view.blindAmount * 0.75, 0, 1);
    }
    this.el.flashOverlay.style.opacity = flash.toFixed(3);
    const cam = g.camera.position;
    const smoke = g.grenades.smokeDensity(cam.x, cam.y, cam.z);
    this.el.smokeOverlay.style.opacity = (smoke * 0.97).toFixed(3);
    this.hurt = Math.max(0, this.hurt - dt * 1.6);
    this.el.hurt.style.opacity = this.hurt.toFixed(3);
    this.dmgArc = Math.max(0, this.dmgArc - dt * 1.2);
    this.el.dmgArc.style.opacity = this.dmgArc.toFixed(3);
    this.el.dmgArc.style.transform = `translate(-50%,-50%) rotate(${this.dmgAngle}rad)`;

    // Kill feed expiry
    while (this.feed.length && this.feed[0].until < now) this.feed.shift().div.remove();
    while (this.chat.length && this.chat[0].until < now) this.chat.shift().div.remove();

    // Center message
    if (this.centerUntil && now > this.centerUntil) {
      this.el.centerMsg.className = '';
      this.centerUntil = 0;
    }

    // Hints and progress
    let hint = '';
    let prog = null;
    if (!g.spectating && p.alive) {
      if (p.planting) prog = ['Planting bomb…', p.plantProgress / ROUND.plantTime];
      else if (p.defusing) prog = [p.defuser ? 'Defusing (kit)…' : 'Defusing…', p.defuseProgress / (p.defuser ? ROUND.defuseKitTime : ROUND.defuseTime)];
      if (R.canDefuse(p) && !p.defusing) hint = 'Hold <b>E</b> to defuse the bomb';
      else if (p.hasBomb && R.canPlant(p) && !p.planting) hint = 'Hold <b>E</b> (or select C4 <b>5</b> and hold <b>LMB</b>) to plant';
      else if (R.canBuy(p) && !this.buyOpen && R.phase === 'freeze') hint = 'Press <b>B</b> to open the buy menu';
      else {
        const it = g.drops.nearest(p, 1.6);
        if (it) hint = `Press <b>E</b> to pick up ${esc(it.def.name)}`;
      }
      if (p.hasBomb && !hint && R.phase === 'live' && R.bomb.state === 'carried') hint = 'You carry the <b>C4</b> — plant it on site A or B';
    }
    this.set('hint', this.el.hint, hint, 'innerHTML');
    if (prog) {
      this.el.progress.classList.add('show');
      this.set('progLabel', this.el.progressLabel, prog[0]);
      this.el.progressFill.style.width = `${clamp(prog[1], 0, 1) * 100}%`;
    } else this.el.progress.classList.remove('show');

    // Spectator info
    if (g.spectating) {
      const tgt = g.spectateTarget;
      const txt = tgt ? `Spectating <b class="${tgt.team === 'T' ? 't' : 'ct'}">${esc(tgt.name)}</b> · LMB/RMB to switch` : 'Free camera';
      this.set('spec', this.el.spectate, txt, 'innerHTML');
      this.el.spectate.classList.add('show');
    } else this.el.spectate.classList.remove('show');
    this.set('deathInfo', this.el.deathInfo, g.deathInfo || '', 'innerHTML');
    this.el.deathInfo.classList.toggle('show', !!g.deathInfo && g.spectating);

    // Target under crosshair
    const tn = g.crosshairAgent;
    if (tn) {
      const friend = tn.team === p.team;
      this.set('tn', this.el.targetName, `<span class="${friend ? 'friend' : 'enemy'}">${friend ? 'Friend' : 'Enemy'}: ${esc(tn.name)}${friend ? ` · ${tn.health} HP` : ''}</span>`, 'innerHTML');
    } else this.set('tn', this.el.targetName, '', 'innerHTML');

    // Location
    const loc = g.zoneName(view.pos.x, view.pos.z, view.pos.y);
    this.set('loc', this.el.location, loc);

    this._drawRadar({ x: view.pos.x, y: view.pos.y, z: view.pos.z, agent: view }, view === p ? g.viewYaw : view.yaw);

    if (this.showScores) { this.renderScoreboard(); this.el.scoreboard.classList.remove('hidden'); } else this.el.scoreboard.classList.add('hidden');
    if (this.buyOpen) {
      if (!R.canBuy(p)) this.closeBuy();
      else if (this.cache.buyMoney !== p.money || Math.floor(R.buyTimeLeft()) !== this.cache.buyT) {
        this.cache.buyMoney = p.money;
        this.cache.buyT = Math.floor(R.buyTimeLeft());
        this.renderBuy();
      }
    }

    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    if (this.showNet) {
      const info = g.renderer.info;
      const ns = g.mode === 'net' ? `  net q${g.netStats.q} err ${(g.netStats.predErr * 100).toFixed(1)}cm` : '';
      this.el.netgraph.textContent = `fps ${this.fps.toFixed(0)}  calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k  tick 64  pos ${p.pos.x.toFixed(1)} ${p.pos.y.toFixed(2)} ${p.pos.z.toFixed(1)}  spd ${(p.speed2D() * 39.37).toFixed(0)}u/s${ns}`;
      this.el.netgraph.style.display = 'block';
    } else this.el.netgraph.style.display = 'none';
  }
}
