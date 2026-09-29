// Pickups: floating procedural models (medkit, armour vest, ammo boxes, miniature Doom II weapons), auto-pickup,
// enemy drops weighted by need, and wave supply drops at station.pickupPoints.
// Rendering: every model is one merged vertex-coloured mesh sharing ONE material (with per-vertex emissive), plus one shared
// additive "fx" mesh (light column + floor pool) and a halo sprite. Nothing is allocated per frame; meshes are pooled per kind.
import * as THREE from 'three';
import { bus, AMMO, WEAPON_IDS, TAU, clamp, rand } from './core.js';
import { buildModel } from './pickups/models.js';

const PICKUP_RADIUS = 1.1;
const DROP_LIFE = 40, BLINK_TIME = 5;      // enemy drops: 40 s, then blink for 5 s, then vanish
const MAX_DROPS = 14, MAX_PERSIST = 32;
const SUPPLY_WEAPONS = { 1: ['shotgun'], 2: ['chainsaw', 'chaingun'], 3: ['ssg'], 4: ['rocket'], 5: ['plasma'], 6: ['bfg'] };
const WEAPON_AMMO = { pistol: 'bullets', shotgun: 'shells', ssg: 'shells', chaingun: 'bullets', rocket: 'rockets', plasma: 'cells', bfg: 'cells' };

// kind -> {amount, audio, fx colour, model size hints}
const DEFS = {
  health: { amount: 25, audio: 'pickupHealth', color: 0x3dffa0, flash: '#3dffa0', hover: 0.62 },
  medkit: { amount: 50, audio: 'pickupHealth', color: 0x3dffa0, flash: '#3dffa0', hover: 0.7 },
  armor: { amount: 50, audio: 'pickupArmor', color: 0x4aa8ff, flash: '#4aa8ff', hover: 0.78 },
  ammo_bullets: { amount: 30, type: 'bullets', audio: 'pickupAmmo', color: 0xffb030, flash: '#ffc860', hover: 0.62 },
  ammo_shells: { amount: 8, type: 'shells', audio: 'pickupAmmo', color: 0xff5a3a, flash: '#ff8a60', hover: 0.62 },
  ammo_rockets: { amount: 5, type: 'rockets', audio: 'pickupAmmo', color: 0xff8a2a, flash: '#ffa050', hover: 0.7 },
  ammo_cells: { amount: 40, type: 'cells', audio: 'pickupAmmo', color: 0x40e8ff, flash: '#70f0ff', hover: 0.64 },
};
for (const id of WEAPON_IDS) DEFS['weapon_' + id] = { weapon: id, audio: 'pickupWeapon', color: id === 'plasma' ? 0x40e8ff : id === 'bfg' ? 0x63ff4d : id === 'rocket' ? 0xffa040 : 0xffe58a, flash: '#fff2b0', hover: 0.86, tilt: 0.22 };
for (const d of Object.values(DEFS)) d.colorObj = new THREE.Color(d.color);
export const PICKUP_KINDS = Object.keys(DEFS);

export function create(game) {
  const list = [];
  const pool = {};            // kind -> [free node]
  const geos = {};            // kind -> BufferGeometry (lazy)
  const root = new THREE.Group(); root.name = 'pickups';
  let clock = 0, pity = 0, seeded = false;

  // ---- shared render resources --------------------------------------------------------------
  const pulse = { value: 1 };
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.22 });
  bodyMat.onBeforeCompile = (sh) => {
    sh.uniforms.uPulse = pulse;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aEmit;\nvarying float vEmit;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmit = aEmit;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEmit;\nuniform float uPulse;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat rim = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 3.0);\ntotalEmissiveRadiance += diffuseColor.rgb * (0.22 + vEmit * uPulse * 0.72 + rim * 0.55);');
  };
  bodyMat.customProgramCacheKey = () => 'pickupBody';

  // floor pool + soft light column, white with alpha in the vertex colours, tinted by the material colour
  const fxGeo = (() => {
    const pos = [], col = [], idx = [];
    const seg = 28;
    pos.push(0, 0.03, 0); col.push(1, 1, 1, 0.42);                                    // pool centre
    for (let i = 0; i < seg; i++) { const a = i / seg * TAU; pos.push(Math.cos(a) * 0.62, 0.03, Math.sin(a) * 0.62); col.push(1, 1, 1, 0); }
    for (let i = 0; i < seg; i++) idx.push(0, 1 + i, 1 + (i + 1) % seg);
    const base = pos.length / 3, H = 1.8, R0 = 0.3, R1 = 0.12;
    for (let i = 0; i <= seg; i++) { const a = i / seg * TAU, c = Math.cos(a), s = Math.sin(a); pos.push(c * R0, 0.03, s * R0, c * R1, H, s * R1); col.push(1, 1, 1, 0.14, 1, 1, 1, 0); }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx);
    g.computeBoundingSphere(); return g;
  })();
  const fxMats = {}, haloMats = {};
  const haloTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(0.6, 'rgba(255,255,255,0.1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const fxMat = (hex) => fxMats[hex] || (fxMats[hex] = new THREE.MeshBasicMaterial({ color: hex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  const haloMat = (hex) => haloMats[hex] || (haloMats[hex] = new THREE.SpriteMaterial({ map: haloTex, color: hex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));

  function getNode(kind) {
    const free = pool[kind]; if (free && free.length) return free.pop();
    const def = DEFS[kind];
    const geo = geos[kind] || (geos[kind] = buildModel(kind));
    if (!def.hoverSet) { def.hoverSet = true; const sz = geo.boundingBox.getSize(_sz); def.hover = 0.3 + Math.max(sz.y, def.tilt ? sz.x * Math.sin(def.tilt + 0.05) : 0, 0.3) * 0.5 + (def.tilt ? 0.06 : 0); }
    const model = new THREE.Mesh(geo, bodyMat); model.rotation.order = 'YXZ';
    const fx = new THREE.Mesh(fxGeo, fxMat(def.color)); fx.renderOrder = 2;
    const halo = new THREE.Sprite(haloMat(def.color)); halo.renderOrder = 3;
    const node = new THREE.Group(); node.add(fx, model, halo);
    return { node, model, fx, halo };
  }
  function releaseNode(p) {
    root.remove(p.node); (pool[p.kind] || (pool[p.kind] = [])).push(p);
  }

  // ---- placement helpers --------------------------------------------------------------------
  const _t = new THREE.Vector3(), _sz = new THREE.Vector3();
  function settle(v, out) {
    out.copy(v);
    const w = game.world;
    if (w) {
      w.collide(out, 0.3, 1.0, 0.1);
      const g = w.groundAt(out.x, out.z, out.y, 0.6); if (g > -900) out.y = g;
    }
    return out;
  }

  // ---- public: spawn ------------------------------------------------------------------------
  // opts: {persist=false, life, delay=0 (materialise after N s), pop=false (hop out of a corpse), amount, exact=false (skip collision settle)}
  function spawn(kind, at, opts = {}) {
    const def = DEFS[kind];
    if (!def) { console.warn('[pickups] unknown kind', kind); return null; }
    const n = getNode(kind);
    const p = n; p.kind = kind; p.def = def;
    if (!p.pos) p.pos = new THREE.Vector3();
    if (opts.exact) p.pos.copy(at); else settle(at, p.pos);
    p.persist = !!opts.persist; p.life = opts.life ?? (p.persist ? Infinity : DROP_LIFE);
    p.amount = opts.amount ?? def.amount;
    p.t = 0; p.delay = opts.delay || 0; p.pop = !!opts.pop; p.phase = rand(0, TAU); p.state = p.delay > 0 || opts.materialize ? 'spawn' : 'idle'; p.s = p.state === 'spawn' ? 0 : 1;
    p.starter = !!opts.starter; p.flashed = false; p.collectT = 0; p.dead = false; p.spin = rand(0.9, 1.3) * (Math.random() < 0.5 ? 1 : -1) * 0.9;
    p.node.position.copy(p.pos); p.node.visible = true; p.model.visible = true; p.fx.visible = true; p.halo.visible = true;
    p.node.scale.setScalar(1); p.fx.scale.set(1, 1, 1); p.halo.scale.setScalar(1.4);
    p.model.rotation.set(0, p.phase, 0);
    p.model.scale.setScalar(p.s || 0.001);
    root.add(p.node); list.push(p);
    // cap persistent pile-up: drop the oldest persistent pickup
    if (list.length > MAX_PERSIST + MAX_DROPS) { const old = list.find((q) => q.persist && q !== p); if (old) remove(old); }
    return p;
  }

  function remove(p) {
    const i = list.indexOf(p); if (i >= 0) list.splice(i, 1);
    p.dead = true; releaseNode(p);
  }

  // ---- collection ---------------------------------------------------------------------------
  // Returns the gained amount (>0) if the pickup was consumed, 0 if the player can't use it right now.
  function tryCollect(p) {
    const P = game.player, W = game.weapons, def = p.def;
    if (def.type) { // ammo
      if (!W || W.ammo[def.type] >= AMMO[def.type].max) return 0;
      return W.addAmmo(def.type, p.amount) || 0;
    }
    if (def.weapon) {
      if (!W) return 0;
      const id = def.weapon, had = W.has(id), type = WEAPON_AMMO[id] || W.list[id]?.ammoType;
      if (had && type && W.ammo[type] >= AMMO[type].max) return 0;
      if (had && !type) return 0;                        // nothing to gain from a second fist/saw
      const before = type ? W.ammo[type] : 0;
      if (W.list[id]) W.give(id); else if (type) W.addAmmo(type, { shotgun: 8, ssg: 8, chaingun: 20, rocket: 2, plasma: 40, bfg: 40 }[id] || 0);
      if (had && id === 'pistol' && type) W.addAmmo(type, 20);   // give() grants no bullets for the pistol
      const gained = type ? W.ammo[type] - before : 0;
      if (had) return gained > 0 ? gained : 0;
      return Math.max(1, gained);
    }
    if (kindIsHealth(p.kind)) {
      if (P.health >= P.maxHealth) return 0;
      const b = P.health; P.heal(p.amount); return P.health - b;
    }
    if (p.kind === 'armor') {
      if (P.armor >= 100) return 0;
      const b = P.armor; P.addArmor(p.amount); return P.armor - b;
    }
    return 0;
  }
  const kindIsHealth = (k) => k === 'health' || k === 'medkit';

  function collect(p, gained) {
    p.state = 'collect'; p.collectT = 0;
    bus.emit('pickup', { kind: p.kind, amount: gained });
    game.audio?.play(p.def.audio || 'pickup');
    game.hud?.flash?.(p.def.flash, p.def.weapon ? 0.22 : 0.13, 0.28);
  }

  // ---- update -------------------------------------------------------------------------------
  const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  function update(dt) {
    clock += dt;
    pulse.value = 0.9 + 0.1 * Math.sin(clock * 3.4);
    const P = game.player, canTake = game.state === 'playing' && P?.alive;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.t += dt;
      const def = p.def, model = p.model, hover = def.hover;
      // -- state machine --
      if (p.state === 'spawn') {
        if (p.t < p.delay) { p.node.visible = false; continue; }
        p.node.visible = true;
        const k = clamp((p.t - p.delay) / 0.55, 0, 1);
        p.s = easeOutBack(k); p.fx.scale.set(1, k, 1);
        if (!p.flashed) { p.flashed = true; if (def.weapon) game.vfx?.light?.(_t.copy(p.pos).setY(p.pos.y + 1), def.colorObj, 1.4, 0.6, 9); }
        if (k >= 1) { p.state = 'idle'; p.s = 1; p.fx.scale.set(1, 1, 1); p.t = p.delay + 0.55; }
      } else if (p.state === 'collect') {
        p.collectT += dt;
        const k = p.collectT / 0.28;
        if (k >= 1) { remove(p); continue; }
        p.s = 1 + k * 0.5 - k * k * 1.5; p.halo.material.opacity = 0.55; p.fx.scale.set(1 + k, 1 - k, 1 + k);
        model.position.y = hover + k * 1.1; model.rotation.y += dt * 14;
        model.scale.setScalar(Math.max(0.001, p.s)); p.halo.scale.setScalar(1.4 + k * 2.5);
        continue;
      } else {
        // -- lifetime / blink --
        if (p.life !== Infinity) {
          const left = p.life - (p.t - p.delay);
          if (left < -BLINK_TIME) { remove(p); continue; }
          if (left < 0) { const f = 4 + (-left / BLINK_TIME) * 9; const vis = Math.sin((p.t) * f * TAU) > -0.1; p.model.visible = vis; p.fx.visible = vis; p.halo.visible = vis; }
        }
      }
      // -- animation --
      let y = hover + Math.sin(p.t * 2.3 + p.phase) * 0.07;
      if (p.pop) { const k = Math.min(p.t, 0.6); y += Math.max(0, 4.2 * k * (0.6 - k)) * 1.6; }
      model.position.y = y;
      model.rotation.y += dt * p.spin;
      if (def.tilt) { model.rotation.z = def.tilt * 0.55 + Math.sin(p.t * 1.7 + p.phase) * 0.05; model.rotation.x = Math.sin(p.t * 1.3 + p.phase) * 0.07; } else { model.rotation.x = Math.sin(p.t * 1.5 + p.phase) * 0.06; model.rotation.z = 0; }
      model.scale.setScalar(Math.max(0.001, p.s));
      const halo = p.halo; halo.position.y = y; halo.scale.setScalar(1.35 + Math.sin(p.t * 3 + p.phase) * 0.12);
      if (p.state === 'idle') halo.material.opacity = 0.55;
      // -- auto pickup --
      if (canTake && p.state === 'idle') {
        const dx = P.pos.x - p.pos.x, dz = P.pos.z - p.pos.z;
        if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS && Math.abs(P.pos.y + 0.9 - (p.pos.y + hover)) < 1.7) {
          const gained = tryCollect(p);
          if (gained > 0) collect(p, gained);
        }
      }
    }
  }

  // ---- enemy drops --------------------------------------------------------------------------
  const _d = new THREE.Vector3();
  function ownedAmmoNeed() { // -> [{type, need 0..1}] for ammo types the player can actually fire
    const W = game.weapons, out = [];
    if (!W) return out;
    const seen = {};
    for (const id of Object.keys(WEAPON_AMMO)) {
      const t = WEAPON_AMMO[id]; if (seen[t] || !W.has(id)) continue; seen[t] = true;
      const need = 1 - W.ammo[t] / AMMO[t].max; if (need > 0.03) out.push({ type: t, need });
    }
    return out;
  }
  function chooseDropKind() {
    const P = game.player; const cand = [];
    const hpNeed = 1 - P.health / P.maxHealth;
    if (P.health < P.maxHealth) { cand.push(['health', 1 + hpNeed * 3]); if (P.health < 45) cand.push(['medkit', 1.5 + (45 - P.health) / 8]); }
    if (P.armor < 100) cand.push(['armor', 0.3 + (1 - P.armor / 100) * 0.35]);
    for (const a of ownedAmmoNeed()) cand.push(['ammo_' + a.type, 0.7 + a.need * 3.2]);
    let sum = 0; for (const c of cand) sum += c[1];
    if (sum <= 0) return null;
    let r = Math.random() * sum; for (const c of cand) { r -= c[1]; if (r <= 0) return c[0]; }
    return cand[cand.length - 1][0];
  }
  const TYPE_CHANCE = { runner: 0.85, exploder: 0.45, trooper: 1.15, spitter: 1.05, brute: 2.6, tyrant: 9 };

  function dropFromEnemy(enemy) {
    const P = game.player; if (!enemy || !P || !P.alive || game.state !== 'playing') return;
    let active = 0; for (const p of list) if (!p.persist) active++;
    if (active >= MAX_DROPS) return;
    let chance = 0.2 * (TYPE_CHANCE[enemy.type] ?? 1) + pity;
    if (P.health < 35) chance *= 1.5;
    if (ownedAmmoNeed().some((a) => a.need > 0.8)) chance *= 1.25;
    chance = Math.min(0.92, chance);
    if (Math.random() > chance) { pity = Math.min(0.2, pity + 0.03); return; }
    const count = enemy.type === 'tyrant' ? 3 : enemy.type === 'brute' && Math.random() < 0.5 ? 2 : 1;
    let dropped = 0;
    for (let i = 0; i < count; i++) {
      const kind = i === 0 && enemy.type === 'tyrant' ? (P.health < 100 ? 'medkit' : 'armor') : chooseDropKind();
      if (!kind) continue;
      _d.set(enemy.pos.x + (count > 1 ? rand(-0.9, 0.9) : rand(-0.25, 0.25)), enemy.pos.y, enemy.pos.z + (count > 1 ? rand(-0.9, 0.9) : rand(-0.25, 0.25)));
      spawn(kind, _d, { pop: true }); dropped++;
    }
    if (dropped) pity = 0;
  }

  // ---- supply drops -------------------------------------------------------------------------
  function shuffled(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const _jit = new THREE.Vector3();
  let fallbackPts = null;
  // station.pickupPoints normally has >= 10 points; if it is missing/tiny (stub station) scatter along the platform instead
  function usablePoints() {
    const pts = game.station?.pickupPoints;
    if (pts && pts.length >= 3) return pts;
    if (!fallbackPts) { fallbackPts = []; for (let x = -26; x <= 26; x += 6.5) fallbackPts.push(new THREE.Vector3(x, 0, (fallbackPts.length % 2 ? 1 : -1) * 1.8)); }
    return fallbackPts;
  }
  function supplyDrop(wave = 1) {
    const pts = usablePoints();
    if (!pts.length) return [];
    const W = game.weapons, all = !!game.arsenalAll;
    // a fresh drop replaces the leftovers of earlier ones (uncollected weapons stay until somebody takes them): keeps the platform readable and the draw calls flat
    for (const q of list) if (q.persist && !q.starter && !q.def.weapon && q.state !== 'collect' && !q.dead) { q.state = 'collect'; q.collectT = 0; q.persist = false; }
    const items = []; // [kind]
    // guaranteed weapon progression (catch-up for anything earlier that is still missing)
    const incoming = new Set();
    if (!all) for (let w = 1; w <= Math.min(wave, 6); w++) for (const id of SUPPLY_WEAPONS[w] || []) {
      if (W?.has(id) || list.some((p) => p.kind === 'weapon_' + id)) continue;
      items.push('weapon_' + id); incoming.add(id);
    }
    const has = (id) => W?.has(id) || incoming.has(id) || all;
    const P = game.player;
    items.push('medkit');
    const smalls = 1 + (wave >= 3 ? 1 : 0) + (P && P.health < 50 ? 1 : 0);
    for (let i = 0; i < smalls; i++) items.push('health');
    if (wave >= 2) items.push('armor'); if (wave >= 5) items.push('armor');
    const bul = 1 + (wave >= 4 ? 1 : 0), she = has('shotgun') || has('ssg') ? 1 + Math.floor(wave / 4) : 0;
    const roc = has('rocket') ? 1 + Math.floor(wave / 5) : 0, cel = has('plasma') || has('bfg') ? 1 + Math.floor(wave / 4) : 0;
    for (let i = 0; i < bul; i++) items.push('ammo_bullets');
    for (let i = 0; i < she; i++) items.push('ammo_shells');
    for (let i = 0; i < roc; i++) items.push('ammo_rockets');
    for (let i = 0; i < cel; i++) items.push('ammo_cells');
    // pick spread-out points, preferring ones with nothing already lying there
    const order = shuffled(pts), out = [];
    let ptI = 0;
    items.forEach((kind, i) => {
      let at = null;
      for (let tries = 0; tries < order.length; tries++) {
        const c = order[(ptI + tries) % order.length];
        if (!list.some((q) => Math.abs(q.pos.x - c.x) < 1.3 && Math.abs(q.pos.z - c.z) < 1.3)) { at = c; ptI = (ptI + tries + 1) % order.length; break; }
      }
      if (!at) { at = order[ptI++ % order.length]; _jit.set(at.x + rand(-1.2, 1.2), at.y, at.z + rand(-1.2, 1.2)); at = _jit; }
      out.push(spawn(kind, at, { persist: true, delay: 0.1 + i * 0.16 }));
    });
    return out;
  }

  // ---- lifecycle ----------------------------------------------------------------------------
  function clear() { for (let i = list.length - 1; i >= 0; i--) remove(list[i]); }
  function reset() { clear(); pity = 0; seeded = false; }

  bus.on('enemy:killed', (e) => { try { dropFromEnemy(e.enemy); } catch (err) { console.warn('[pickups] drop failed', err); } });
  // a few starter pickups so the first fight isn't empty-handed
  bus.on('game:start', () => {
    if (seeded) return; seeded = true;
    const pts = usablePoints(); if (!pts.length) return;
    const o = shuffled(pts);
    ['ammo_bullets', 'health', 'armor'].forEach((k, i) => spawn(k, o[i % o.length], { persist: true, materialize: true, delay: 0.3 + i * 0.2, starter: true }));
  });

  return {
    list, root, spawn, remove, clear, reset, update, dropFromEnemy, supplyDrop, kinds: PICKUP_KINDS,
    init() { game.scene.add(root); },
  };
}
