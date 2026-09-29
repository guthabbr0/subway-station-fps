// Weapon manager: inventory, ammo, switching, viewmodel sway. Individual weapons live in src/weapons/<id>.js
// (default export: class extending Weapon from ./weapons/base.js).
import * as THREE from 'three';
import { AMMO, WEAPON_SLOTS, WEAPON_IDS, bus, clamp, damp } from './core.js';

export function create(game) {
  const W = {
    list: {}, // id -> Weapon instance
    owned: new Set(), ammo: { bullets: 0, shells: 0, rockets: 0, cells: 0 }, current: null, pending: null, last: null,
    holder: new THREE.Group(),
  };
  const sway = { x: 0, y: 0, bobT: 0 };

  W.init = async () => {
    game.viewCamera.add(W.holder);
    for (const id of WEAPON_IDS) {
      try {
        const mod = await import(`./weapons/${id}.js`);
        const w = new mod.default(game); w.init(); W.list[id] = w; W.holder.add(w.root);
      } catch (e) { console.warn(`[weapons] ${id} unavailable:`, e.message); }
    }
    W.reset();
    bus.on('player:dead', () => { W.pending = null; W.current?.deselect(); }); // the weapon drops out of view when the player dies
  };

  W.reset = (opts = {}) => {
    W.current?.onDeselect?.(); // e.g. stop a running chainsaw engine
    W.owned.clear(); W.ammo = { bullets: 50, shells: 0, rockets: 0, cells: 0 };
    for (const w of Object.values(W.list)) { w.root.visible = false; w.raise = 0; w.dir = -1; w.selected = false; }
    W.give('fist'); W.give('pistol', false);
    if (opts.all || game.arsenalAll) { for (const id of WEAPON_IDS) W.give(id, false); W.ammo = { bullets: 100, shells: 30, rockets: 20, cells: 200 }; }
    W.current = null; W.pending = null; W.last = null; W._prevFire = false;
    W.forceSelect(W.owned.has('shotgun') ? 'shotgun' : 'pistol');
  };

  W.has = (id) => W.owned.has(id);
  W.give = (id, withAmmo = true) => {
    if (!W.list[id]) return false;
    const fresh = !W.owned.has(id); W.owned.add(id);
    if (withAmmo) { const w = W.list[id]; const g = { pistol: 0, shotgun: 8, ssg: 8, chaingun: 20, rocket: 2, plasma: 40, bfg: 40 }[id] || 0; if (w.ammoType && g) W.addAmmo(w.ammoType, g); }
    if (fresh && withAmmo) W.select(id);
    return fresh;
  };
  W.addAmmo = (type, n) => { const before = W.ammo[type]; W.ammo[type] = Math.min(AMMO[type].max, before + n); return W.ammo[type] - before; };
  W.consumeAmmo = (type, n = 1) => { if (W.ammo[type] < n) return false; W.ammo[type] -= n; return true; };

  W.forceSelect = (id) => {
    const w = W.list[id]; if (!w) return;
    if (W.current) { W.current.onDeselect?.(); W.current.root.visible = false; W.current.raise = 0; W.current.dir = -1; W.current.selected = false; }
    W.current = w; w.raise = 0; w.select(); W.pending = null; bus.emit('weapon:switch', { id });
  };
  W.select = (id) => {
    if (!W.owned.has(id) || !W.list[id]) return;
    if (W.current && W.current.id === id && !W.pending) return;
    W.pending = id;
  };
  W.selectSlot = (n) => {
    const ids = WEAPON_SLOTS[n - 1].filter((id) => W.owned.has(id) && W.list[id]); if (!ids.length) return;
    const cur = W.pending || W.current?.id, i = ids.indexOf(cur);
    W.select(i >= 0 ? ids[(i + 1) % ids.length] : ids[ids.length - 1]);
  };
  W.cycle = (d) => {
    const ids = WEAPON_IDS.filter((id) => W.owned.has(id) && W.list[id]); const cur = W.pending || W.current?.id;
    W.select(ids[(ids.indexOf(cur) + d + ids.length) % ids.length]);
  };
  // Best weapon that has ammo (used when the current one runs dry).
  W.autoSwitch = () => {
    // Doom II's P_CheckAmmo preference order (plasma > SSG > chaingun > shotgun > pistol > chainsaw > rocket > BFG > fist)
    const order = ['plasma', 'ssg', 'chaingun', 'shotgun', 'pistol', 'chainsaw', 'rocket', 'bfg', 'fist'];
    for (const id of order) if (W.owned.has(id) && W.list[id]?.hasAmmo()) { W.select(id); return; }
  };

  W.update = (dt) => {
    const inp = game.input, p = game.player;
    if (game.state === 'playing' && p.alive) {
      for (let n = 1; n <= 7; n++) if (inp.pressed('Digit' + n)) W.selectSlot(n);
      if (inp.wheel) W.cycle(inp.wheel > 0 ? 1 : -1);
      if (inp.pressed('KeyQ') && W.last) W.select(W.last);
    }
    if (W.pending && W.current) {
      if (W.current.dir > 0 && W.current.canSwitch()) { W.last = W.current.id; W.current.deselect(); }
      if (W.current.isLowered()) { const id = W.pending; W.pending = null; W.current = W.list[id]; W.current.select(); game.audio.play('weaponSwap'); bus.emit('weapon:switch', { id }); }
    }
    const playing = game.state === 'playing' && p.alive;
    const down = playing && inp.mouse[0], edge = down && !W._prevFire; W._prevFire = down;
    const ctx = { fire: down, firePressed: edge, alt: playing && inp.mouse[2], time: game.time };
    W.current?.update(dt, ctx);
    for (const w of Object.values(W.list)) {
      if (w === W.current) continue;
      if (w.selected) w.update(dt, ctx); // finish lowering
      else if (w.cool > 0) w.cool = Math.max(0, w.cool - dt); // a holstered weapon keeps cooling down (no stale cooldown after switching back)
    }
    // sway + bob
    const speed = Math.hypot(p.vel.x, p.vel.z);
    sway.bobT += dt * (2 + speed * 1.1) * (p.grounded ? 1 : 0);
    const amp = clamp(speed / 6, 0, 1);
    sway.x = damp(sway.x, clamp(-inp.mouseDX * 0.0006, -0.03, 0.03), 12, dt);
    sway.y = damp(sway.y, clamp(inp.mouseDY * 0.0006, -0.03, 0.03), 12, dt);
    W.holder.position.set(sway.x + Math.sin(sway.bobT) * 0.012 * amp, sway.y + Math.abs(Math.cos(sway.bobT)) * -0.012 * amp, 0);
  };
  return W;
}
