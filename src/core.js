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

export class Input {
  constructor(el) {
    this.keys = new Set(); this.pressedKeys = new Set(); this.mouse = [false, false, false];
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; this.locked = false; this.el = el;
    addEventListener('keydown', (e) => { if (!e.repeat) this.pressedKeys.add(e.code); this.keys.add(e.code); if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code) && this.locked) e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('mousedown', (e) => { if (this.locked) this.mouse[e.button] = true; });
    addEventListener('mouseup', (e) => { this.mouse[e.button] = false; });
    addEventListener('mousemove', (e) => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('blur', () => { this.keys.clear(); this.mouse.fill(false); });
  }
  down(code) { return this.keys.has(code); }
  pressed(code) { return this.pressedKeys.has(code); }
  endFrame() { this.pressedKeys.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; }
}
