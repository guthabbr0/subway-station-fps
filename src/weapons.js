// Weapon manager: inventory, ammo, switching, viewmodel sway. Individual weapons live in src/weapons/<id>.js
// (default export: class extending Weapon from ./weapons/base.js).
import * as THREE from 'three';
import { AMMO, WEAPON_SLOTS, WEAPON_IDS, bus, clamp, damp } from './core.js';

// ---- aim down sights ---------------------------------------------------------------------------------------------------------------------
// RIGHT MOUSE aims every gun (the chainsaw keeps RMB for revving the engine, the fists have nothing to aim). Default = hold RMB; toggle mode (?ads=toggle, or V flips it and the choice is
// remembered in localStorage) makes each RMB press flip the aim. State machine (all in this file, consumed by player.js for FOV / speed / sensitivity, by weapons/base.js for the pose,
// spread and recoil, by hud.js for the crosshair):
//   W.adsHeld  the player's armed request (RMB held / toggle latched / setAds(true)) and the weapon can aim; W.ads 0..1 is the eased blend that follows it.
//   Aim engages only while the weapon is fully raised, nothing is pending and the player is alive and playing. Every cancel (weapon switch, sprint, death, pause, menu) drops the request
//   and it stays dropped until the next RMB press (hold mode: also until RMB is released), so a cancelled aim can never come back on its own.
//   Sprint and aim cancel each other, the LAST input wins: pressing sprint while aimed cancels the aim (player.js calls cancelAds('sprint')); pressing RMB while sprinting aims and
//   stops the sprint (player.js never sprints while adsHeld).
const ADS_IN = 0.14, ADS_OUT = 0.11;         // seconds for a full blend in / out (rate limited, then smoothstep-eased)
const ADS_SWAY = 0.35, ADS_BOB = 0.25;       // viewmodel sway / bob multipliers at full ADS
const smoothstep = (t) => t * t * (3 - 2 * t);
const STORE_KEY = 'doomed.adsMode';
function readMode(params) {
  const q = params?.get('ads'); if (q === 'toggle' || q === 'hold') return q;
  try { const v = localStorage.getItem(STORE_KEY); if (v === 'toggle' || v === 'hold') return v; } catch (e) { /* storage blocked (private window, sandboxed frame): default */ }
  return 'hold';
}
function saveMode(m) { try { localStorage.setItem(STORE_KEY, m); } catch (e) { /* ignore */ } }

export function create(game) {
  const W = {
    list: {}, // id -> Weapon instance
    owned: new Set(), ammo: { bullets: 0, shells: 0, rockets: 0, cells: 0 }, current: null, pending: null, last: null,
    holder: new THREE.Group(),
    ads: 0, adsLin: 0, adsHeld: false, adsOn: false, adsMode: readMode(game.params), adsFov: 75, adsViewFov: 0, // adsFov / adsViewFov: the current weapon's aimed FOVs (world / viewmodel camera)
  };
  const sway = { x: 0, y: 0, bobT: 0 };
  const A = { rmb: false, latch: false, api: false, supp: false, dbg: null, frame: 0, done: -1, hinted: false }; // frame / done: stepAds runs once per frame (frame is bumped by the input frame hook)

  W.init = async () => {
    game.viewCamera.add(W.holder);
    for (const id of WEAPON_IDS) {
      try {
        const mod = await import(`./weapons/${id}.js`);
        const w = new mod.default(game); w.init(); W.list[id] = w; W.holder.add(w.root);
      } catch (e) { console.warn(`[weapons] ${id} unavailable:`, e.message); }
    }
    W.reset();
    bus.on('player:dead', () => { W.pending = null; W.cancelAds('dead'); W.current?.deselect(); }); // the weapon drops out of view when the player dies
    bus.on('game:start', () => { // one-time control hint (not in the headless test modes)
      if (A.hinted || game.testMode) return; A.hinted = true;
      game.hud?.toast?.('RMB aim   ·   V hold / toggle', { key: 'adshint', color: 'var(--amber)', life: 4.5 });
    });
    // every frame in every game state (menu / paused ...): aiming must not survive a pause or the menu (W.update / player.update do not run then)
    game.input.frameHooks.push(() => { A.frame++; if (game.state !== 'playing' && game.state !== 'dead' && (W.adsHeld || W.ads > 0 || A.api || A.latch)) W.resetAds(); });
  };

  W.reset = (opts = {}) => {
    W.current?.onDeselect?.(); // e.g. stop a running chainsaw engine
    W.owned.clear(); W.ammo = { bullets: 50, shells: 0, rockets: 0, cells: 0 };
    for (const w of Object.values(W.list)) { w.root.visible = false; w.raise = 0; w.dir = -1; w.selected = false; }
    W.give('fist'); W.give('pistol', false);
    if (opts.all || game.arsenalAll) { for (const id of WEAPON_IDS) W.give(id, false); W.ammo = { bullets: 100, shells: 30, rockets: 20, cells: 200 }; }
    W.current = null; W.pending = null; W.last = null; W._prevFire = false; W.resetAds();
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
    W.resetAds();
    if (W.current) { W.current.onDeselect?.(); W.current.root.visible = false; W.current.raise = 0; W.current.dir = -1; W.current.selected = false; }
    W.current = w; w.raise = 0; w.select(); W.pending = null; bus.emit('weapon:switch', { id });
  };
  W.select = (id) => {
    if (!W.owned.has(id) || !W.list[id]) return;
    if (W.current && W.current.id === id && !W.pending) return;
    W.cancelAds('switch');
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

  // ---- ADS manager -----------------------------------------------------------------------------------------------------------------
  const canAds = () => !!(W.current && W.current.adsSpec && W.current.adsPose);
  const wish = () => (W.adsMode === 'toggle' ? A.latch : A.rmb) || A.api;
  const clearAll = () => { W.ads = 0; W.adsLin = 0; W.adsHeld = false; A.rmb = false; A.latch = false; A.api = false; A.supp = false; for (const w of Object.values(W.list)) w.adsE = 0; setOn(false); };
  function setOn(on) { if (on !== W.adsOn) { W.adsOn = on; bus.emit('player:ads', { on, t: game.time }); } }
  // drop the request; it stays dropped until the next RMB press (see the header comment). reason: 'switch' | 'sprint' | 'dead' | 'pause' | ... (informational)
  W.cancelAds = (reason = 'cancel') => { A.api = false; A.latch = false; A.supp = wish() || W.adsHeld || A.rmb; W.adsHeld = false; W.adsCancel = reason; };
  // immediate, no easing (new game, forced weapon selection, pause, menu)
  W.resetAds = () => { clearAll(); W.adsCancel = 'reset'; };
  // API for scripts / tests: setAds(true) aims as if RMB were held until setAds(false) or a cancel; toggleAds() flips it
  W.setAds = (on) => { if (on) { A.api = true; A.supp = false; } else W.cancelAds('api'); stepRequest(); };
  // screenshots / tools: freeze the aim blend at e (0 hip .. 1 aimed; null = back to normal). The pose, FOV and crosshair follow; every weapon's own debugAt(t) still works on top of it.
  W.debugAds = (e) => { A.dbg = e === null || e === undefined ? null : Math.min(1, Math.max(0, +e)); if (A.dbg === null) W.resetAds(); };
  W.toggleAds = () => { W.setAds(!W.adsHeld); return W.adsHeld; };
  W.setAdsMode = (m) => { if (m !== 'hold' && m !== 'toggle') return; if (m !== W.adsMode) { W.adsMode = m; W.cancelAds('mode'); A.supp = false; A.latch = false; } saveMode(m); };
  W.toggleAdsMode = () => {
    W.setAdsMode(W.adsMode === 'hold' ? 'toggle' : 'hold');
    game.hud?.toast?.(W.adsMode === 'toggle' ? 'Aim: TOGGLE (press RMB to aim / release)' : 'Aim: HOLD (hold RMB)', { key: 'adsmode', color: 'var(--amber)', life: 2.2 });
  };
  // the request part: RMB edges / latch / API -> W.adsHeld
  function stepRequest() {
    const inp = game.input, p = game.player, playing = game.state === 'playing' && p.alive;
    const rmb = playing && !!inp.mouse[2], edge = rmb && !A.rmb; A.rmb = rmb;
    if (edge) { A.supp = false; if (W.adsMode === 'toggle') A.latch = !A.latch; }
    if (!(W.adsMode === 'toggle' ? A.latch : rmb) && !A.api) A.supp = false; // the request ended: a new one is armed again
    W.adsHeld = playing && canAds() && wish() && !A.supp;
  }
  // the blend part. Idempotent per frame: player.update() calls it first (zero-lag FOV), W.update() calls it if the player has not.
  W.stepAds = (dt) => {
    if (A.done === A.frame) return; A.done = A.frame;
    const cur = W.current, p = game.player;
    stepRequest();
    const fullyUp = !!cur && cur.ready && !W.pending && cur.dir > 0;
    const on = W.adsHeld && fullyUp && !p.sprinting && game.state === 'playing' && p.alive;
    const t = on ? 1 : 0;
    W.adsLin = t > W.adsLin ? Math.min(t, W.adsLin + dt / ADS_IN) : Math.max(t, W.adsLin - dt / ADS_OUT);
    W.ads = smoothstep(W.adsLin);
    if (A.dbg !== null) { W.adsLin = A.dbg; W.ads = A.dbg; } // screenshot / tool override (debugAds)
    setOn(on);
    if (cur) { cur.adsE = W.ads; W.adsFov = cur.adsSpec?.fov ?? W.adsFov; W.adsViewFov = cur.adsSpec?.vfov ?? 0; }
  };

  W.update = (dt) => {
    const inp = game.input, p = game.player;
    W.stepAds(dt);
    if (game.state === 'playing' && p.alive) {
      for (let n = 1; n <= 7; n++) if (inp.pressed('Digit' + n)) W.selectSlot(n);
      if (inp.wheel) W.cycle(inp.wheel > 0 ? 1 : -1);
      if (inp.pressed('KeyQ') && W.last) W.select(W.last);
      if (inp.pressed('KeyV')) W.toggleAdsMode();
    }
    if (W.pending && W.current) {
      if (W.current.dir > 0 && W.current.canSwitch()) { W.last = W.current.id; W.current.deselect(); }
      if (W.current.isLowered()) { const id = W.pending; W.pending = null; W.current = W.list[id]; W.current.select(); game.audio.play('weaponSwap'); bus.emit('weapon:switch', { id }); }
    }
    const playing = game.state === 'playing' && p.alive;
    const down = playing && inp.mouse[0], edge = down && !W._prevFire; W._prevFire = down;
    const ctx = { fire: down, firePressed: edge, alt: playing && inp.mouse[2], time: game.time };
    if (W.current) W.current.adsE = W.ads; // (a weapon switch cancels the aim first, so this is ~0 by the time another weapon becomes current)
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
    const sk = 1 - (1 - ADS_SWAY) * W.ads, bk = 1 - (1 - ADS_BOB) * W.ads; // steadier sights while aimed
    W.holder.position.set(sway.x * sk + Math.sin(sway.bobT) * 0.012 * amp * bk, sway.y * sk + Math.abs(Math.cos(sway.bobT)) * -0.012 * amp * bk, 0);
  };
  return W;
}
