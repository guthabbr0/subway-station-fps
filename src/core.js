// Shared primitives: constants, event bus, pool, collision world, input.
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const TIC = 1 / 35; // Doom tic length in seconds

// World layout. Units are metres, +Y up. y=0 is the platform floor.
// Platform runs along X. Track A is on the +Z side, track B on the -Z side.
// Trains run along X (track A: enters from -X heading +X, track B: enters from +X heading -X).
export const LAYOUT = {
  platform: { x0: -32, x1: 32, halfW: 5, y: 0 },
  trackZ: { A: 6.6, B: -6.6 },
  gauge: 1.435,
  bedY: -1.25, // ballast top
  railTopY: -1.1,
  wallZ: 11.5, // outer tile walls at z = +-wallZ
  ceilingY: 7,
  tunnelX: 32, // portal wall position (|x|); tunnels continue outward to |x|=140
  tunnelEndX: 140,
  train: { width: 2.8, height: 3.6, carLen: 15.2, cars: 3, stopX: 0 },
};

export const AMMO = {
  bullets: { max: 200 },
  shells: { max: 50 },
  rockets: { max: 50 },
  cells: { max: 300 },
};
// Slot layout follows Doom II: 1 fist/chainsaw, 2 pistol, 3 shotgun/ssg, 4 chaingun, 5 rocket, 6 plasma, 7 bfg.
export const WEAPON_SLOTS = [
  ['fist', 'chainsaw'],
  ['pistol'],
  ['shotgun', 'ssg'],
  ['chaingun'],
  ['rocket'],
  ['plasma'],
  ['bfg'],
];
export const WEAPON_IDS = WEAPON_SLOTS.flat();

// Canonical audio names. audio.js implements every one; other modules use only these.
export const AUDIO_NAMES = [
  // weapons
  'punch', 'punchHit', 'sawStart', 'sawIdle', 'sawFull', 'sawHit', 'pistol', 'shotgun', 'shotgunPump', 'ssg', 'ssgOpen', 'ssgLoad', 'ssgClose',
  'chaingun', 'rocketFire', 'rocketFly', 'explosion', 'plasma', 'plasmaHit', 'bfgCharge', 'bfgFire', 'bfgHit', 'weaponSwap', 'empty', 'shellDrop', 'casing',
  // impacts
  'impactConcrete', 'impactMetal', 'impactFlesh', 'ricochet',
  // enemies
  'zombieIdle', 'zombieAlert', 'zombieAttack', 'zombiePain', 'zombieDeath', 'runnerScream', 'bruteRoar', 'bruteStep', 'spit', 'spitHit', 'exploderBurst', 'tyrantRoar', 'enemyShot', 'gib', 'zombieStep',
  // player
  'step', 'jump', 'land', 'hurt', 'playerDeath', 'pickup', 'pickupAmmo', 'pickupWeapon', 'pickupHealth', 'pickupArmor',
  // train / station
  'trainRumble', 'trainBrake', 'trainDoorChime', 'trainDoorOpen', 'trainDoorClose', 'trainHorn', 'trainDepart', 'trainPass', 'drip', 'stationChime', 'stationHum', 'ventHiss',
  // ui
  'waveStart', 'waveClear', 'uiClick', 'gameOver',
];

export const bus = {
  _m: new Map(),
  on(e, f) { (this._m.get(e) || this._m.set(e, []).get(e)).push(f); return () => this.off(e, f); },
  off(e, f) { const a = this._m.get(e); if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); } },
  emit(e, d) { const a = this._m.get(e); if (a) for (const f of a.slice()) f(d); },
};

export class Pool {
  constructor(factory, reset = () => {}) { this.factory = factory; this.reset = reset; this.free = []; }
  get() { const o = this.free.pop() || this.factory(); this.reset(o); return o; }
  release(o) { this.free.push(o); }
}

const _v = (a) => (a && a.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));

// Static collision + raycast world made of AABBs, floors and a ceiling plane.
export class World {
  constructor() { this.boxes = []; this.floors = []; this.ceilingY = LAYOUT.ceilingY; this._id = 1; }
  // opts: {tag, solid=true (blocks movement), hitscan=true (blocks rays/projectiles), walkable=false (top surface can be stood on), surface='concrete'|'metal'|'tile'|'glass'|'wood'|'train'}
  addBox(min, max, opts = {}) {
    const b = { id: this._id++, min: _v(min), max: _v(max), tag: opts.tag || 'wall', solid: opts.solid !== false, hitscan: opts.hitscan !== false, walkable: !!opts.walkable, surface: opts.surface || 'concrete', enabled: true };
    this.boxes.push(b); return b;
  }
  removeBox(b) { const i = this.boxes.indexOf(b); if (i >= 0) this.boxes.splice(i, 1); }
  addFloor(x0, x1, z0, z1, y, opts = {}) { const f = { x0, x1, z0, z1, y, surface: opts.surface || 'tile' }; this.floors.push(f); return f; }

  // Highest standable surface at (x,z) that is <= y+step. Returns -1000 when there is none.
  groundAt(x, z, y, step = 0.5) {
    let best = -1000;
    for (const f of this.floors) if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1 && f.y <= y + step && f.y > best) best = f.y;
    for (const b of this.boxes) {
      if (!b.enabled || !b.walkable) continue;
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.max.y <= y + step && b.max.y > best) best = b.max.y;
    }
    return best;
  }

  // Push a vertical capsule (feet position `pos`, mutated in place) out of solid boxes on the XZ plane. Returns true if pushed.
  collide(pos, radius, height, step = 0.45) {
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.boxes) {
        if (!b.enabled || !b.solid) continue;
        if (b.max.y <= pos.y + step || b.min.y >= pos.y + height) continue;
        const cx = clamp(pos.x, b.min.x, b.max.x), cz = clamp(pos.z, b.min.z, b.max.z);
        let dx = pos.x - cx, dz = pos.z - cz; const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        hit = true;
        if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (radius - d) / d; pos.x += dx * k; pos.z += dz * k; }
        else { // centre inside box: exit along the shallowest axis
          const l = pos.x - b.min.x, r = b.max.x - pos.x, n = pos.z - b.min.z, f = b.max.z - pos.z, m = Math.min(l, r, n, f);
          if (m === l) pos.x = b.min.x - radius; else if (m === r) pos.x = b.max.x + radius; else if (m === n) pos.z = b.min.z - radius; else pos.z = b.max.z + radius;
        }
      }
    }
    return hit;
  }

  // Nearest static hit along a ray. Returns {dist, point, normal, box|null, surface} or null.
  raycast(origin, dir, maxDist = 200) {
    let bestT = maxDist, bnAx = -1, bnSgn = 0, bb = null, surf = 'concrete', found = false;
    const ox = origin.x, oy = origin.y, oz = origin.z, dx = dir.x, dy = dir.y, dz = dir.z;
    const idx = 1 / (dx || 1e-12), idy = 1 / (dy || 1e-12), idz = 1 / (dz || 1e-12);
    for (const b of this.boxes) {
      if (!b.enabled || !b.hitscan) continue;
      let t1 = (b.min.x - ox) * idx, t2 = (b.max.x - ox) * idx, tn = Math.min(t1, t2), tf = Math.max(t1, t2), ax = 0, sgn = t1 < t2 ? -1 : 1;
      t1 = (b.min.y - oy) * idy; t2 = (b.max.y - oy) * idy;
      let a = Math.min(t1, t2), f = Math.max(t1, t2);
      if (a > tn) { tn = a; ax = 1; sgn = t1 < t2 ? -1 : 1; } if (f < tf) tf = f;
      t1 = (b.min.z - oz) * idz; t2 = (b.max.z - oz) * idz; a = Math.min(t1, t2); f = Math.max(t1, t2);
      if (a > tn) { tn = a; ax = 2; sgn = t1 < t2 ? -1 : 1; } if (f < tf) tf = f;
      if (tn > tf || tf < 0 || tn < 0 || tn >= bestT) continue; // origin inside a box is ignored
      bestT = tn; bb = b; surf = b.surface; found = true; bnAx = ax; bnSgn = sgn;
    }
    if (dy < -1e-6) for (const fl of this.floors) {
      const t = (fl.y - oy) / dy; if (t < 0 || t >= bestT) continue;
      const x = ox + dx * t, z = oz + dz * t;
      if (x >= fl.x0 && x <= fl.x1 && z >= fl.z0 && z <= fl.z1) { bestT = t; bb = null; surf = fl.surface; found = true; bnAx = 1; bnSgn = 1; }
    }
    if (dy > 1e-6) { const t = (this.ceilingY - oy) / dy; if (t >= 0 && t < bestT) { bestT = t; bb = null; surf = 'concrete'; found = true; bnAx = 1; bnSgn = -1; } }
    if (!found) return null;
    const bn = new THREE.Vector3(bnAx === 0 ? bnSgn : 0, bnAx === 1 ? bnSgn : 0, bnAx === 2 ? bnSgn : 0);
    return { dist: bestT, point: new THREE.Vector3(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT), normal: bn, box: bb, surface: surf };
  }
}

// ---- keyboard / mouse -------------------------------------------------------------------------------------------------------------
// Keys the page must own while the pointer is locked: without preventDefault they scroll the page, move focus (Tab), navigate history (Backspace,
// Alt+Left/Right) or open browser UI (F1 help, F10 menu bar, a bare Alt press). NOT in this list on purpose: F5 (reload), F11 (fullscreen), F12 (devtools),
// F3 / F4 / F6 (the perf overlay and the debug bisect keys), Escape (releases the pointer lock).
const NAV_KEYS = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'PageUp', 'PageDown', 'Home', 'End', 'ContextMenu', 'F1', 'F2', 'F7', 'F8', 'F9', 'F10', 'AltLeft', 'AltRight']);
// Ctrl+<key> page shortcuts that are safe (and useful) to swallow while playing: save, print, find, view-source, bookmark, select-all, history, open, address bar...
// NOT swallowed: Ctrl+R / F5 (reload), Ctrl+Shift+I/J/C (devtools), Ctrl +/-/0 (zoom). Ctrl+W / T / N / Q / Tab / PageUp / PageDown / 1..9 are reserved by the browser:
// a page can never intercept them, see LeaveGuard below.
const CTRL_SWALLOW = new Set(['KeyS', 'KeyP', 'KeyF', 'KeyG', 'KeyU', 'KeyD', 'KeyA', 'KeyH', 'KeyO', 'KeyE', 'KeyK', 'KeyL', 'KeyB', 'KeyY', 'KeyJ']);
const CHORD_KEYS = new Set(['ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);

export class Input {
  constructor(el) {
    this.keys = new Set(); this.pressedKeys = new Set(); this.mouse = [false, false, false];
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; this.locked = false; this.el = el;
    this.frameHooks = []; // called once per frame from endFrame() in EVERY game state (menu / playing / paused / dead): modules that must stay in sync with the state machine register here
    addEventListener('keydown', (e) => {
      const chord = e.ctrlKey || e.metaKey;
      if (this.locked && (NAV_KEYS.has(e.code) || (chord && !e.shiftKey && CTRL_SWALLOW.has(e.code)) || (e.altKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')))) e.preventDefault();
      // Ctrl / Cmd are not game keys (crouch is C): a key pressed WITH Ctrl held is a browser shortcut (Ctrl+W closes the tab, Ctrl+T / Ctrl+N open one) and must never move the player
      if (chord || CHORD_KEYS.has(e.code)) return;
      if (!e.repeat) this.pressedKeys.add(e.code); this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    // middle click (autoscroll) and the two side buttons of gaming mice (history back / forward) are swallowed while playing
    const side = (e) => { if (this.locked && (e.button === 1 || e.button === 3 || e.button === 4)) e.preventDefault(); };
    addEventListener('mousedown', (e) => { if (this.locked) this.mouse[e.button] = true; side(e); });
    addEventListener('mouseup', (e) => { this.mouse[e.button] = false; side(e); });
    addEventListener('auxclick', side);
    addEventListener('mousemove', (e) => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
    addEventListener('wheel', (e) => { if (this.locked && !e.ctrlKey && !e.metaKey) this.wheel += Math.sign(e.deltaY); }, { passive: true }); // Ctrl + wheel is the browser's page zoom, not a weapon switch
    addEventListener('contextmenu', (e) => e.preventDefault());
    const release = () => { this.keys.clear(); this.mouse.fill(false); };
    addEventListener('blur', release);
    document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  }
  down(code) { return this.keys.has(code); }
  pressed(code) { return this.pressedKeys.has(code); }
  endFrame() { this.pressedKeys.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; for (let i = 0; i < this.frameHooks.length; i++) this.frameHooks[i](); }
}

// Leave-page guard. A page CANNOT block Ctrl+W / Ctrl+T / Ctrl+N / Ctrl+Tab / Alt+F4 (the browser handles them before any script sees the key), and losing pointer lock for a
// millisecond while spamming keys is enough to hit one by accident. The only mechanism a page has is a 'beforeunload' handler: while the game is being played (or is paused) the browser
// then asks "Leave site?" before it closes the tab / reloads / navigates, and one Enter / Esc press undoes the mistake. It is installed ONLY while game.state is 'playing' or 'paused'
// (never on the menu / game-over overlay, so leaving from there is instant) and never in the headless test modes (?manual / ?nolock), which must be able to close the page without a dialog.
// Chrome shows the prompt only after the page had a user gesture: the player has always clicked "Enter the station" by then.
export class LeaveGuard {
  constructor(game) {
    this.game = game; this.on = false; this.force = null; // force: true / false overrides the test-mode rule (used by tools/weapon-audit to exercise the handler)
    this.released = false; // release(): the game is about to reload / navigate on purpose (e.g. after a lost GPU context): no prompt
    this.handler = (e) => { e.preventDefault(); e.returnValue = 'Leave the station? Your run will be lost.'; return e.returnValue; };
  }
  release() { this.released = true; this.sync(); }
  wanted() {
    const g = this.game;
    if (this.released) return false;
    if (this.force !== null) return !!this.force && (g.state === 'playing' || g.state === 'paused');
    if (g.testMode || g.manual || g.params?.has('nolock') || g.params?.has('manual') || g.params?.has('noguard')) return false;
    return g.state === 'playing' || g.state === 'paused';
  }
  sync() {
    const want = this.wanted();
    if (want === this.on) return;
    this.on = want;
    if (want) addEventListener('beforeunload', this.handler); else removeEventListener('beforeunload', this.handler);
  }
}
