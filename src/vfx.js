// vfx.js — every visual effect of the game: tracers, muzzle flashes, impacts, blood/gibs, explosions, plasma/BFG, casings, decals.
// Everything is pooled (instanced batches / ring buffers / typed arrays); no per-shot geometry, materials or lights are created.
// Sub-systems live in src/vfx/*.js:
//   atlas.js      procedural 1024px sprite atlas (glow, smoke, fire, stars, ring, streak, splats, holes, scorch, cracks)
//   particles.js  CPU-simulated instanced billboard batches (additive + alpha), 3 modes: camera billboard / velocity streak / oriented plane
//   decals.js     one instanced draw for holes / blood / scorch, time-faded on the GPU
//   segments.js   GPU time-animated tracer ribbons + CPU-jittered lightning beams
//   chunks.js     instanced rigid chunks (gibs, debris, casings) with spin + bounce
//   lights.js     the fixed pool of 6 PointLights (never added/removed at runtime)
//   flash.js      first-person (viewScene) muzzle flashes for createFlash()
// light() intensity is "nominal": ~1..10 for small flashes (auto-boosted to candela), 30..700 for blasts (used as-is).
import * as THREE from 'three';
import { TAU, clamp } from './core.js';
import { createAtlas, FRAME } from './vfx/atlas.js';
import { BillboardBatch, F_KILL, F_BOUNCE, F_STAIN, F_LIFT, MODE_STREAK, MODE_PLANE, floorY } from './vfx/particles.js';
import { DecalBatch, DECAL_RINGS } from './vfx/decals.js';
import { TracerBatch, BeamBatch } from './vfx/segments.js';
import { ChunkSystem, lumpGeometry, C_TRAIL, C_LIE } from './vfx/chunks.js';
import { LightPool } from './vfx/lights.js';
import { makeFlashFactory } from './vfx/flash.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const rr = (a, b) => a + Math.random() * (b - a);
const UP = new THREE.Vector3(0, 1, 0);
const _t = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _d = new THREE.Vector3(), _lp = new THREE.Vector3(), _pv = new THREE.Vector3(), _col = new THREE.Color();
let RX = 0, RY = 0, RZ = 0;
function rsph() { const z = 2 * Math.random() - 1, a = Math.random() * TAU, s = Math.sqrt(1 - z * z); RX = s * Math.cos(a); RY = z; RZ = s * Math.sin(a); }
function basis(n) { if (Math.abs(n.y) > 0.99) _t.set(1, 0, 0); else _t.set(0, 1, 0); _t.cross(n).normalize(); _b.crossVectors(n, _t); }

const SURF = {
  concrete: { tint: [0.8, 0.77, 0.72], dust: [0.5, 0.48, 0.44], chip: [0.42, 0.4, 0.37], sparks: 2, dustN: 2, chips: 4, hole: 0.13, glint: 0 },
  metal: { tint: [0.72, 0.75, 0.82], dust: [0.4, 0.4, 0.42], chip: [0.5, 0.5, 0.55], sparks: 9, dustN: 1, chips: 0, hole: 0.09, glint: 1 },
  tile: { tint: [0.78, 0.82, 0.8], dust: [0.7, 0.7, 0.68], chip: [0.85, 0.88, 0.85], sparks: 3, dustN: 1, chips: 6, hole: 0.1, glint: 0.5 },
  glass: { tint: [0.85, 0.95, 1.0], dust: [0.5, 0.6, 0.65], chip: [0.7, 0.9, 1.0], sparks: 0, dustN: 0, chips: 0, hole: 0.5, glint: 0 },
  wood: { tint: [0.5, 0.33, 0.2], dust: [0.42, 0.32, 0.22], chip: [0.5, 0.34, 0.18], sparks: 0, dustN: 1, chips: 5, hole: 0.1, glint: 0 },
  train: { tint: [0.62, 0.64, 0.7], dust: [0.4, 0.4, 0.42], chip: [0.55, 0.5, 0.42], sparks: 6, dustN: 1, chips: 3, hole: 0.09, glint: 1 },
};

const EXP = {
  rocket: { fire: 11, f0: [1.1, 0.56, 0.17], f1: [0.4, 0.04, 0.0], smoke: 9, sm0: [0.24, 0.13, 0.07], sm1: [0.1, 0.095, 0.09], smA: 0.85, sparks: 24, debris: 9, lc: [1.0, 0.56, 0.2], li: 130, ring: [1.1, 0.7, 0.35], scorch: 1.3, fuel: 3, gore: 0 },
  barrel: { fire: 16, f0: [1.3, 0.56, 0.16], f1: [0.45, 0.04, 0.0], smoke: 12, sm0: [0.2, 0.11, 0.06], sm1: [0.05, 0.048, 0.045], smA: 0.92, sparks: 34, debris: 13, lc: [1.0, 0.5, 0.15], li: 170, ring: [1.2, 0.65, 0.3], scorch: 1.45, fuel: 5, gore: 0 },
  exploder: { fire: 8, f0: [1.15, 0.5, 0.16], f1: [0.4, 0.04, 0.0], smoke: 6, sm0: [0.22, 0.14, 0.08], sm1: [0.1, 0.09, 0.08], smA: 0.65, sparks: 12, debris: 3, lc: [1.0, 0.55, 0.2], li: 100, ring: [1.0, 0.6, 0.3], scorch: 1.0, fuel: 0, gore: 1 },
};

export function create(game) {
  const scene = game.scene;
  const atlas = createAtlas(game.renderer);
  const uTime = { value: 0 };
  let T = 0, stainBudget = 8, impactBudget = 20, lastShellSnd = -1;

  const add = new BillboardBatch(scene, { atlas, additive: true, capacity: 1800, renderOrder: 4 });
  const alp = new BillboardBatch(scene, { atlas, additive: false, capacity: 1800, renderOrder: 2 });
  const decals = new DecalBatch(scene, atlas, uTime);
  const tracers = new TracerBatch(scene, uTime);
  const beams = new BeamBatch(scene, 40);
  const lights = new LightPool(scene, 6);
  const createFlash = makeFlashFactory(atlas);

  // ---- chunk systems -------------------------------------------------------------------------------------------------------
  const gibMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0, emissive: 0x1a0304 });
  const debrisMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.75, emissive: 0x2a1a05 });
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.1, vertexColors: true, emissive: 0x150303 });
  const colorize = (g, r, gg, b) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gg; a[i * 3 + 2] = b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const shellGeo = mergeGeometries([
    colorize(new THREE.CylinderGeometry(0.0125, 0.0125, 0.05, 10).translate(0, 0.012, 0), 0.8, 0.06, 0.05),
    colorize(new THREE.CylinderGeometry(0.0135, 0.0135, 0.022, 10).translate(0, -0.024, 0), 0.95, 0.68, 0.3),
  ]);
  const gibs = new ChunkSystem(scene, lumpGeometry('lump', 3, 0.5), gibMat, 72);
  const debris = new ChunkSystem(scene, lumpGeometry('rock', 7, 0.6), debrisMat, 96);
  const casings = new ChunkSystem(scene, new THREE.CylinderGeometry(0.0085, 0.0095, 0.05, 8), brassMat, 64);
  const shells = new ChunkSystem(scene, shellGeo, shellMat, 32);

  // ---- emit helpers --------------------------------------------------------------------------------------------------------
  // additive billboard puff
  function addP(frame, x, y, z, vx, vy, vz, s0, s1, life, r0, g0, b0, a0, r1, g1, b1, a1, drag = 0, grav = 0, delay = 0, apow = 1.4, spow = 2) {
    const p = add.begin(); p.frame = frame; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.s0 = s0; p.s1 = s1; p.life = life;
    p.r0 = r0; p.g0 = g0; p.b0 = b0; p.a0 = a0; p.r1 = r1; p.g1 = g1; p.b1 = b1; p.a1 = a1; p.drag = drag; p.grav = grav; p.delay = delay; p.apow = apow; p.spow = spow;
    p.rot = Math.random() * TAU; p.rotV = (Math.random() - 0.5) * 2; add.emit();
  }
  // alpha smoke/dust/blood puff
  function smokeP(frame, x, y, z, vx, vy, vz, s0, s1, life, r0, g0, b0, a0, r1, g1, b1, delay = 0, grav = -0.4, drag = 1.2, flags = 0, apow = 1.6) {
    const p = alp.begin(); p.frame = frame; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.s0 = s0; p.s1 = s1; p.life = life;
    p.r0 = r0; p.g0 = g0; p.b0 = b0; p.a0 = a0; p.r1 = r1; p.g1 = g1; p.b1 = b1; p.a1 = 0; p.drag = drag; p.grav = grav; p.delay = delay; p.apow = apow; p.flags = flags;
    p.fadeIn = 0.05; p.rot = Math.random() * TAU; p.rotV = (Math.random() - 0.5) * 1.2; alp.emit();
  }
  // velocity-aligned streak (b = add for sparks, alp for blood drops)
  function streakP(b, x, y, z, vx, vy, vz, life, len, wid, stretch, r0, g0, b0, r1, g1, b1, grav = 9.8, flags = F_BOUNCE, bounce = 0.35, a0 = 1, apow = 2) {
    const p = b.begin(); p.mode = MODE_STREAK; p.frame = FRAME.STREAK; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.s0 = len; p.s1 = len * 0.6; p.sy0 = wid; p.sy1 = wid * 0.7; p.stretch = stretch; p.life = life; p.spow = 1; p.r0 = r0; p.g0 = g0; p.b0 = b0; p.a0 = a0; p.r1 = r1; p.g1 = g1; p.b1 = b1; p.a1 = 0;
    p.apow = apow; p.grav = grav; p.drag = 0.35; p.flags = flags; p.bounce = bounce; b.emit();
  }
  function planeP(b, frame, x, y, z, nx, ny, nz, s0, s1, life, r0, g0, b0, a0, r1, g1, b1, apow = 1.5) {
    const p = b.begin(); p.mode = MODE_PLANE; p.frame = frame; p.x = x; p.y = y; p.z = z; p.dx = nx; p.dy = ny; p.dz = nz; p.s0 = s0; p.s1 = s1; p.life = life;
    p.r0 = r0; p.g0 = g0; p.b0 = b0; p.a0 = a0; p.r1 = r1; p.g1 = g1; p.b1 = b1; p.a1 = 0; p.apow = apow; p.rot = Math.random() * TAU; p.rotV = (Math.random() - 0.5) * 0.6; b.emit();
  }
  const decalAdd = (ring, x, y, z, nx, ny, nz, size, frame, r, g, b, a, life, fade) => decals.add(ring, T, x, y, z, nx, ny, nz, size, frame, r, g, b, a, life, fade, Math.random() * TAU);
  const fireFrame = () => (Math.random() < 0.5 ? FRAME.FIRE1 : FRAME.FIRE2);
  const smokeFrame = () => (Math.random() < 0.5 ? FRAME.SMOKE1 : FRAME.SMOKE2);

  // ---- blood stains from droplets landing / chunk bounces -----------------------------------------------------------------------
  alp.onStain = (x, fy, z, s) => {
    if (stainBudget <= 0 || Math.random() < 0.4) return; stainBudget--;
    decalAdd(DECAL_RINGS.blood, x, fy + 0.002, z, 0, 1, 0, 0.12 + s * 1.7 + Math.random() * 0.1, Math.random() < 0.5 ? FRAME.SPLAT1 : FRAME.SPLAT2, 0.1, 0.003, 0.005, 0.92, 22 + Math.random() * 8, 9);
  };
  gibs.onBounce = (i, x, y, z, sp, first) => {
    if (sp < 1.2) return;
    const n = sp > 4 ? 3 : 2;
    for (let k = 0; k < n; k++) { rsph(); streakP(alp, x, y + 0.03, z, RX * sp * 0.4, Math.abs(RY) * sp * 0.5 + 0.5, RZ * sp * 0.4, rr(0.4, 0.8), 0.06, 0.02, 0.03, 0.14, 0.004, 0.006, 0.07, 0.002, 0.004, 11, F_KILL | F_STAIN, 0, 0.95, 1); }
    if (stainBudget > 0 && Math.random() < 0.7) { stainBudget--; decalAdd(DECAL_RINGS.blood, x, floorY(x, z) + 0.002, z, 0, 1, 0, 0.3 + Math.random() * 0.25, Math.random() < 0.5 ? FRAME.SPLAT1 : FRAME.SPLAT2, 0.105, 0.003, 0.005, 0.95, 26, 9); }
  };
  gibs.onTrail = (x, y, z, vx, vy, vz) => { rsph(); streakP(alp, x, y, z, vx * 0.3 + RX * 0.6, vy * 0.2 + RY * 0.6, vz * 0.3 + RZ * 0.6, rr(0.5, 0.9), 0.05, 0.018, 0.025, 0.14, 0.004, 0.006, 0.07, 0.002, 0.004, 11, F_KILL | F_STAIN, 0, 0.95, 1); };
  casings.onBounce = shells.onBounce = (i, x, y, z, sp) => {
    if (sp > 0.9 && T - lastShellSnd > 0.05) { lastShellSnd = T; game.audio?.play?.('shellDrop', _pv.set(x, y, z), { volume: 0.18 + Math.min(0.15, sp * 0.03), pitchVar: 0.18 }); }
  };

  // ==== the API ====================================================================================================================
  const V = {
    // ------------------------------------------------------------------------------------------------ tracers / lights / flashes
    tracer(from, to, o) { tracers.add(T, from.x, from.y, from.z, to.x, to.y, to.z, o?.style || 'bullet'); },

    light(pos, color, intensity, dur, distance = 12) { return lights.claim(pos, color, intensity, dur, distance); },

    createFlash,

    muzzleFlash(pos, dir, style = 'enemy') {
      const big = style === 'shotgun' || style === 'ssg' || style === 'rocket' ? 1.25 : 1, hot = style === 'plasma' ? 0 : 1;
      const cr = hot ? 3.4 : 0.8, cg = hot ? 1.8 : 1.6, cb = hot ? 0.65 : 3.8;
      const rot = Math.random() * TAU;
      let p = add.begin(); p.frame = FRAME.STAR; p.x = pos.x + dir.x * 0.08; p.y = pos.y + dir.y * 0.08; p.z = pos.z + dir.z * 0.08; p.s0 = 0.85 * big; p.s1 = 0.6 * big; p.life = 0.075; p.rot = rot;
      p.r0 = cr; p.g0 = cg; p.b0 = cb; p.a0 = 1; p.r1 = cr; p.g1 = cg; p.b1 = cb; p.a1 = 0; p.apow = 1.6; add.emit();
      p = add.begin(); p.frame = FRAME.BURST; p.x = pos.x + dir.x * 0.12; p.y = pos.y + dir.y * 0.12; p.z = pos.z + dir.z * 0.12; p.s0 = 0.7 * big; p.s1 = 0.5 * big; p.life = 0.06; p.rot = rot + 0.7;
      p.r0 = cr; p.g0 = cg; p.b0 = cb; p.a0 = 0.9; p.r1 = cr; p.g1 = cg; p.b1 = cb; p.a1 = 0; add.emit();
      addP(FRAME.HOT, pos.x, pos.y, pos.z, 0, 0, 0, 0.42 * big, 0.3 * big, 0.06, 4.5, 3.6, 2.2, 1, 3, 1.6, 0.6, 0, 0, 0, 0, 1.5, 1);
      p = add.begin(); p.mode = MODE_STREAK; p.frame = FRAME.STREAK; p.x = pos.x + dir.x * 0.85 * big; p.y = pos.y + dir.y * 0.85 * big; p.z = pos.z + dir.z * 0.85 * big; p.vx = dir.x; p.vy = dir.y; p.vz = dir.z;
      p.s0 = p.s1 = 1.1 * big; p.sy0 = p.sy1 = 0.26 * big; p.life = 0.06; p.spow = 1; p.r0 = cr; p.g0 = cg; p.b0 = cb; p.a0 = 0.9; p.r1 = cr; p.g1 = cg; p.b1 = cb; p.a1 = 0; add.emit();
      lights.claim(pos, hot ? 0xff9a40 : 0x5f9bff, 26, 0.08, 10);
    },

    // ------------------------------------------------------------------------------------------------ impacts
    impact(point, normal, surface = 'concrete') {
      if (surface === 'flesh') { fleshImpact(point, normal); return; }
      const S = SURF[surface] || SURF.concrete, n = normal || UP, px = point.x, py = point.y, pz = point.z;
      // decal (skipped on the moving train, where world-space holes would hang in mid-air)
      if (surface === 'train') { /* no hole */ }
      else if (surface === 'glass') decalAdd(DECAL_RINGS.hole, px, py, pz, n.x, n.y, n.z, rr(0.3, 0.5), FRAME.CRACK, S.tint[0], S.tint[1], S.tint[2], 0.8, 50, 8);
      else decalAdd(DECAL_RINGS.hole, px, py, pz, n.x, n.y, n.z, S.hole * rr(0.85, 1.25), FRAME.HOLE, S.tint[0], S.tint[1], S.tint[2], 1, 45, 8);
      if (surface === 'tile' && Math.random() < 0.3) decalAdd(DECAL_RINGS.hole, px, py, pz, n.x, n.y, n.z, rr(0.2, 0.34), FRAME.CRACK, 0.75, 0.8, 0.78, 0.55, 45, 8);
      const rich = impactBudget > 0; impactBudget -= 1;
      if (!rich) { if (S.dustN) smokeP(smokeFrame(), px + n.x * 0.03, py + n.y * 0.03, pz + n.z * 0.03, n.x * 0.5, n.y * 0.5 + 0.2, n.z * 0.5, 0.06, 0.24, 0.45, S.dust[0], S.dust[1], S.dust[2], 0.45, S.dust[0], S.dust[1], S.dust[2], 0, -0.3, 3); return; }
      basis(n);
      for (let i = 0; i < S.dustN; i++) {
        const a = rr(-1, 1), b = rr(-1, 1), sp = rr(0.3, 1.1);
        smokeP(smokeFrame(), px + n.x * 0.03, py + n.y * 0.03, pz + n.z * 0.03, (n.x + _t.x * a + _b.x * b * 0.6) * sp, (n.y + _t.y * a + _b.y * b * 0.6) * sp + 0.15, (n.z + _t.z * a + _b.z * b * 0.6) * sp, 0.07, rr(0.26, 0.42), rr(0.45, 0.8), S.dust[0], S.dust[1], S.dust[2], 0.5, S.dust[0] * 0.9, S.dust[1] * 0.9, S.dust[2] * 0.9, 0, -0.3, 3.2);
      }
      for (let i = 0; i < S.chips; i++) {
        const a = rr(-1, 1), b = rr(-1, 1), sp = rr(1.2, 4);
        const p = alp.begin(); p.frame = FRAME.DISK; p.x = px + n.x * 0.02; p.y = py + n.y * 0.02; p.z = pz + n.z * 0.02;
        p.vx = (n.x + _t.x * a * 0.9 + _b.x * b * 0.9) * sp; p.vy = (n.y + _t.y * a * 0.9 + _b.y * b * 0.9) * sp + 0.6; p.vz = (n.z + _t.z * a * 0.9 + _b.z * b * 0.9) * sp;
        p.s0 = p.s1 = rr(0.012, 0.026); p.life = rr(0.5, 0.95); p.grav = 9.8; p.drag = 0.3; p.flags = F_BOUNCE; p.bounce = 0.35;
        p.r0 = p.r1 = S.chip[0]; p.g0 = p.g1 = S.chip[1]; p.b0 = p.b1 = S.chip[2]; p.a0 = 1; p.a1 = 0; p.apow = 5; alp.emit();
      }
      for (let i = 0; i < S.sparks; i++) {
        const a = rr(-1, 1), b = rr(-1, 1), sp = rr(2.5, 8);
        streakP(add, px + n.x * 0.02, py + n.y * 0.02, pz + n.z * 0.02, (n.x + _t.x * a * 0.9 + _b.x * b * 0.9) * sp, (n.y + _t.y * a * 0.9 + _b.y * b * 0.9) * sp + 0.5, (n.z + _t.z * a * 0.9 + _b.z * b * 0.9) * sp,
          rr(0.16, 0.38), 0.05, 0.013, 0.028, 3.2, 2.2, 0.9, 1.2, 0.3, 0.05, 9.8, F_BOUNCE, 0.3);
      }
      if (S.glint > 0 && Math.random() < S.glint) {
        addP(FRAME.BURST, px + n.x * 0.05, py + n.y * 0.05, pz + n.z * 0.05, 0, 0, 0, 0.3, 0.12, 0.07, 3, 2.4, 1.4, 1, 1.5, 1, 0.5, 0, 0, 0, 0, 1.3, 1);
      }
      if (surface === 'glass') {
        for (let i = 0; i < 6; i++) { const a = rr(-1, 1), b = rr(-1, 1), sp = rr(0.8, 3); addP(FRAME.DISK, px + n.x * 0.03, py + n.y * 0.03, pz + n.z * 0.03, (n.x + _t.x * a + _b.x * b) * sp, (n.y + _t.y * a + _b.y * b) * sp, (n.z + _t.z * a + _b.z * b) * sp, 0.03, 0.015, rr(0.4, 0.8), 1.3, 1.9, 2.4, 1, 0.6, 1, 1.3, 0, 0.2, 9.8, 0, 2, 1); }
      }
    },

    // ------------------------------------------------------------------------------------------------ gore
    blood(point, dir, amount = 1) {
      const d = dir && dir.lengthSq() > 1e-6 ? _d.copy(dir).normalize() : _d.set(0, 1, 0);
      const cnt = clamp(Math.round(4 + amount * 7), 4, 46), px = point.x, py = point.y, pz = point.z;
      for (let i = 0; i < cnt; i++) {
        rsph(); const sp = rr(1.5, 4.5 + 2.5 * amount), fwd = Math.random() < 0.72 ? 1 : -0.35;
        streakP(alp, px, py, pz, d.x * sp * fwd + RX * sp * 0.55, d.y * sp * fwd + RY * sp * 0.55 + rr(0.3, 1.5), d.z * sp * fwd + RZ * sp * 0.55,
          rr(0.7, 1.5), 0.07 + Math.random() * 0.05, 0.016 + Math.random() * 0.012, 0.03, 0.14, 0.004, 0.006, 0.07, 0.002, 0.004, 11, F_KILL | F_STAIN, 0, 0.95, 1);
      }
      const nm = 1 + Math.ceil(amount * 1.5);
      for (let i = 0; i < nm; i++) { rsph(); smokeP(smokeFrame(), px + RX * 0.08, py + RY * 0.08, pz + RZ * 0.08, d.x * rr(0.4, 2) + RX * 0.5, d.y * rr(0.4, 2) + RY * 0.5, d.z * rr(0.4, 2) + RZ * 0.5, 0.12, 0.5 + amount * 0.16, rr(0.35, 0.65), 0.14, 0.004, 0.007, 0.55, 0.07, 0.002, 0.004, 0, -0.3, 3.2); }
      const fy = floorY(px, pz);
      if (py - fy < 0.9 && stainBudget > 0 && Math.random() < 0.8) { stainBudget--; decalAdd(DECAL_RINGS.blood, px + rr(-0.1, 0.1), fy + 0.002, pz + rr(-0.1, 0.1), 0, 1, 0, 0.35 + amount * 0.3, Math.random() < 0.5 ? FRAME.SPLAT1 : FRAME.SPLAT2, 0.1, 0.003, 0.005, 0.92, 26, 9); }
    },

    gib(point, dir, amount = 1) {
      const d = dir && dir.lengthSq() > 1e-6 ? _d.copy(dir).normalize() : _d.set(0, 1, 0);
      const px = point.x, py = point.y, pz = point.z, cnt = clamp(Math.round(3 + amount * 4), 3, 14);
      for (let i = 0; i < cnt; i++) {
        rsph(); const roll = Math.random(), sp = rr(2.5, 5.5 + 3 * amount);
        let sx, sy, sz, cr, cg, cb;
        if (roll < 0.16) { sx = 0.035; sy = rr(0.12, 0.2); sz = 0.032; const v = rr(0.75, 1); cr = 0.8 * v; cg = 0.72 * v; cb = 0.55 * v; }
        else if (roll < 0.36) { sx = rr(0.05, 0.1); sy = rr(0.04, 0.08); sz = rr(0.05, 0.12); cr = rr(0.4, 0.6); cg = rr(0.03, 0.06); cb = rr(0.04, 0.07); }
        else { sx = rr(0.07, 0.17); sy = rr(0.05, 0.11); sz = rr(0.07, 0.15); const v = rr(0.6, 1); cr = 0.28 * v; cg = 0.02 * v; cb = 0.028 * v; }
        gibs.emit(px + RX * 0.15, py + Math.abs(RY) * 0.15, pz + RZ * 0.15, d.x * sp * 0.6 + RX * sp * 0.8, d.y * sp * 0.4 + Math.abs(RY) * sp * 0.8 + rr(1.5, 4.5), d.z * sp * 0.6 + RZ * sp * 0.8,
          sx, sy, sz, rr(-14, 14), rr(-14, 14), rr(-14, 14), rr(12, 16), 13, 0.34, Math.min(sx, sy, sz) * 0.5, cr, cg, cb, C_TRAIL);
      }
      const nb = 3 + Math.round(amount * 1.5);
      for (let i = 0; i < nb; i++) { rsph(); smokeP(smokeFrame(), px + RX * 0.2, py + RY * 0.2 + 0.1, pz + RZ * 0.2, d.x * 0.8 + RX * 1.4, d.y * 0.8 + RY * 1.2 + 0.3, d.z * 0.8 + RZ * 1.4, 0.35, 1.0 + amount * 0.35, rr(0.45, 0.85), 0.15, 0.004, 0.006, 0.72, 0.07, 0.002, 0.004, rr(0, 0.05), -0.2, 3, 0, 1.4); }
      V.blood(point, d, amount * 2.2);
      const fy = floorY(px, pz);
      if (py - fy < 2) { for (let i = 0; i < 3; i++) { if (stainBudget <= 0) break; stainBudget--; decalAdd(DECAL_RINGS.blood, px + rr(-0.9, 0.9) * (i ? 1 : 0.2), fy + 0.002, pz + rr(-0.9, 0.9) * (i ? 1 : 0.2), 0, 1, 0, (i ? 0.4 : 1.0) + amount * 0.35, Math.random() < 0.5 ? FRAME.SPLAT1 : FRAME.SPLAT2, 0.1, 0.003, 0.005, 0.95, 32, 10); } }
    },

    // ------------------------------------------------------------------------------------------------ explosions
    explosion(pos, radius = 4, kind = 'rocket') {
      if (kind === 'bfg') { bfgBlast(pos, radius / 6); return; }
      const K = EXP[kind] || EXP.rocket, r = Math.max(0.8, radius), px = pos.x, py = pos.y, pz = pos.z, s = r / 4;
      const fy = floorY(px, pz), near = py - fy < r * 0.85, cy = Math.max(py, fy + r * 0.24);
      // additive intensities are damped when the blast is right in front of the camera (avoids a full-screen white-out)
      const dcam = game.camera ? Math.hypot(px - game.camera.position.x, py - game.camera.position.y, pz - game.camera.position.z) : 20, ik = clamp(dcam / 10, 0.4, 1);
      // hot core + warm halo
      addP(FRAME.HOT, px, cy, pz, 0, 0, 0, r * 0.5, r * 1.15, 0.14, 2.2 * ik, 1.6 * ik, 0.85 * ik, 1, 0.9 * ik, 0.45 * ik, 0.16 * ik, 0, 0, 0, 0, 1.2, 2);
      addP(FRAME.GLOW, px, cy, pz, 0, 0, 0, r * 1.4, r * 2.2, 0.28, 0.5 * ik, 0.23 * ik, 0.07 * ik, 0.5, 0.15 * ik, 0.05 * ik, 0.015, 0, 0, 0, 0, 1.0, 2);
      // fireballs
      for (let i = 0; i < K.fire; i++) {
        rsph(); const rr_ = r * 0.42 * Math.cbrt(Math.random()), sp = r * rr(0.6, 1.8), k = rr(0.8, 1.2) * ik;
        addP(fireFrame(), px + RX * rr_, Math.max(cy + RY * rr_ * 0.8, fy + r * 0.15), pz + RZ * rr_, RX * sp, RY * sp * 0.7 + r * rr(0.2, 1.0), RZ * sp, r * rr(0.38, 0.65), r * rr(0.9, 1.5), rr(0.4, 0.8),
          K.f0[0] * k, K.f0[1] * k, K.f0[2] * k, 1, K.f1[0], K.f1[1], K.f1[2], 0, 2.4, -r * 0.4, Math.random() * 0.08, 1.5, 2);
      }
      // sparks
      for (let i = 0; i < K.sparks; i++) { rsph(); const sp = rr(6, 10 + r * 3); streakP(add, px, cy, pz, RX * sp, Math.abs(RY) * sp * 0.9 + 3, RZ * sp, rr(0.5, 1.3), 0.1, 0.03, 0.038, 3.6, 2.7, 1.1, 1.2, 0.25, 0.03, 9.8, F_BOUNCE, 0.35); }
      // rings
      addP(FRAME.RING, px, cy, pz, 0, 0, 0, r * 0.3, r * 2.1, 0.26, K.ring[0], K.ring[1], K.ring[2], 0.7, 0.3, 0.15, 0.04, 0, 0, 0, 0, 1.4, 0.7);
      if (near) planeP(add, FRAME.RING, px, fy + 0.06, pz, 0, 1, 0, r * 0.5, r * 3.4, 0.45, K.ring[0], K.ring[1], K.ring[2], 0.55, 0.3, 0.15, 0.04, 1.3);
      // smoke
      for (let i = 0; i < K.smoke; i++) {
        rsph(); const rr_ = r * 0.35 * Math.cbrt(Math.random());
        smokeP(smokeFrame(), px + RX * rr_, Math.max(cy + RY * rr_, fy + r * 0.25), pz + RZ * rr_, RX * rr(0.4, 2.2) * s, Math.abs(RY) * 1.5 * s + rr(0.8, 2.6), RZ * rr(0.4, 2.2) * s, r * rr(0.4, 0.6), r * rr(1.3, 2.0), rr(2.2, 4.4),
          K.sm0[0], K.sm0[1], K.sm0[2], K.smA * rr(0.7, 1), K.sm1[0], K.sm1[1], K.sm1[2], 0.04 + Math.random() * 0.25, -0.5, 1.1, F_LIFT, 1.8);
      }
      // ground dust ring
      if (near) for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + Math.random() * 0.5, sp = r * rr(1.5, 2.4);
        smokeP(smokeFrame(), px + Math.cos(a) * 0.5, fy + 0.3, pz + Math.sin(a) * 0.5, Math.cos(a) * sp, 0.2, Math.sin(a) * sp, r * 0.2, r * rr(0.55, 0.75), rr(0.8, 1.4), 0.5, 0.46, 0.42, 0.5, 0.42, 0.4, 0.38, Math.random() * 0.06, 0, 2.6, F_LIFT, 1.5);
      }
      // debris
      for (let i = 0; i < K.debris; i++) {
        rsph(); const sp = rr(4, 8 + r * 2), sz = rr(0.06, 0.2), v = rr(0.07, 0.16);
        debris.emit(px + RX * 0.3, cy, pz + RZ * 0.3, RX * sp, Math.abs(RY) * sp + rr(2, 6), RZ * sp, sz, sz * rr(0.6, 1.2), sz * rr(0.7, 1.3), rr(-16, 16), rr(-16, 16), rr(-16, 16), rr(3, 5), 14, 0.38, sz * 0.4, v * 1.2, v, v * 0.9, 0);
      }
      // burning fuel / lingering flames
      for (let i = 0; i < K.fuel; i++) { const a = Math.random() * TAU, rr_ = r * 0.35 * Math.sqrt(Math.random()); addP(fireFrame(), px + Math.cos(a) * rr_, fy + 0.35, pz + Math.sin(a) * rr_, 0, rr(0.8, 2), 0, r * 0.22, r * 0.1, rr(1.2, 2.4), 2.6, 1.3, 0.4, 0.9, 0.4, 0.05, 0, 0, 0.3, -0.5, rr(0.1, 0.5), 0.8, 1); }
      // gore for the exploder: bile + meat
      if (K.gore) {
        for (let i = 0; i < 8; i++) { rsph(); const sp = rr(1.5, 4.5); addP(FRAME.FIRE1, px, cy, pz, RX * sp, Math.abs(RY) * sp + 1, RZ * sp, r * 0.2, r * 0.5, rr(0.5, 0.9), 1.6, 2.1, 0.25, 0.9, 0.3, 0.6, 0.05, 0, 2.2, 3, rr(0, 0.1), 1.3, 2); }
        _n.set(0, 1, 0); V.gib(pos, _n, 2.4);
      }
      if (near) decalAdd(DECAL_RINGS.scorch, px, fy + 0.003, pz, 0, 1, 0, r * K.scorch * rr(0.9, 1.1), FRAME.SCORCH, 1, 1, 1, 0.9, 80, 16);
      lights.claim(_lp.set(px, Math.max(py, fy + 0.6) + 0.5, pz), _col.setRGB(K.lc[0], K.lc[1], K.lc[2]), K.li, 0.55, r * 4 + 10);
    },

    bfgExplosion(pos) { bfgBlast(pos, 1); },

    plasmaImpact(pos, normal) {
      const n = normal || UP, px = pos.x, py = pos.y, pz = pos.z;
      addP(FRAME.GLOW, px + n.x * 0.08, py + n.y * 0.08, pz + n.z * 0.08, 0, 0, 0, 0.35, 1.1, 0.16, 1.4, 2.6, 5, 1, 0.3, 0.7, 2.2, 0, 0, 0, 0, 1.3, 2);
      addP(FRAME.BURST, px + n.x * 0.12, py + n.y * 0.12, pz + n.z * 0.12, 0, 0, 0, 1.0, 0.6, 0.11, 2.4, 3.6, 6, 1, 0.8, 1.6, 4, 0, 0, 0, 0, 1.4, 1);
      addP(FRAME.HOT, px + n.x * 0.06, py + n.y * 0.06, pz + n.z * 0.06, 0, 0, 0, 0.45, 0.2, 0.08, 4, 5, 6, 1, 1, 2, 4, 0, 0, 0, 0, 1.4, 1);
      planeP(add, FRAME.RING, px + n.x * 0.03, py + n.y * 0.03, pz + n.z * 0.03, n.x, n.y, n.z, 0.15, 1.5, 0.26, 0.5, 1.3, 3.4, 0.95, 0.1, 0.35, 1.2, 1.3);
      basis(n);
      for (let i = 0; i < 12; i++) {
        const a = rr(-1, 1), b = rr(-1, 1), sp = rr(2.5, 9);
        streakP(add, px + n.x * 0.04, py + n.y * 0.04, pz + n.z * 0.04, (n.x + _t.x * a * 1.1 + _b.x * b * 1.1) * sp, (n.y + _t.y * a * 1.1 + _b.y * b * 1.1) * sp, (n.z + _t.z * a * 1.1 + _b.z * b * 1.1) * sp, rr(0.15, 0.4), 0.06, 0.014, 0.03, 0.9, 1.8, 4, 0.2, 0.4, 1.4, 5, F_BOUNCE, 0.3);
      }
      for (let i = 0; i < 2; i++) { rsph(); const l = rr(0.5, 1.1); beams.add(px, py, pz, px + (n.x * 0.5 + RX) * l, py + (n.y * 0.5 + RY) * l, pz + (n.z * 0.5 + RZ) * l, 0.16, 0.035, 0.4, 0.75, 1.0, 3.2, 0.12); }
      if (Math.abs(n.y) > 0.5) smokeP(smokeFrame(), px, py + n.y * 0.05, pz, 0, 0.5, 0, 0.1, 0.55, 0.5, 0.25, 0.3, 0.4, 0.3, 0.12, 0.13, 0.16, 0, -0.3, 2);
      decalAdd(DECAL_RINGS.scorch, px, py, pz, n.x, n.y, n.z, rr(0.3, 0.45), FRAME.SCORCH, 0.85, 0.9, 1.0, 0.85, 22, 6);
      lights.claim(_lp.set(px + n.x * 0.4, py + n.y * 0.4, pz + n.z * 0.4), 0x5aa0ff, 42, 0.17, 9);
    },

    bfgBeam(from, to) {
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      beams.add(from.x, from.y, from.z, to.x, to.y, to.z, 0.32, 0.1, 0.35, 1.0, 0.3, 3.4, clamp(L * 0.045, 0.25, 1.5));
      // strike glow + sparks where it lands
      addP(FRAME.GLOW, to.x, to.y, to.z, 0, 0, 0, 0.5, 1.5, 0.28, 0.6, 2.6, 0.5, 1, 0.1, 0.6, 0.1, 0, 0, 0, 0, 1.3, 2);
      addP(FRAME.BURST, to.x, to.y, to.z, 0, 0, 0, 0.9, 0.5, 0.14, 1.2, 3.2, 1.0, 1, 0.2, 1, 0.2, 0, 0, 0, 0, 1.4, 1);
      for (let i = 0; i < 4; i++) { rsph(); const sp = rr(2, 6); streakP(add, to.x, to.y, to.z, RX * sp, Math.abs(RY) * sp + 1, RZ * sp, rr(0.25, 0.6), 0.06, 0.016, 0.03, 1.0, 3.2, 0.7, 0.1, 0.8, 0.1, 9.8, F_BOUNCE, 0.3); }
    },

    // ------------------------------------------------------------------------------------------------ projectile trails
    trail(pos, kind = 'rocket') {
      const x = pos.x, y = pos.y, z = pos.z;
      switch (kind) {
        case 'plasma':
          addP(FRAME.GLOW, x, y, z, 0, 0, 0, 0.22, 0.03, 0.2, 0.5, 1.2, 3.4, 1, 0.05, 0.2, 0.8, 0, 0, 0, 0, 1.4, 1);
          if (Math.random() < 0.5) { rsph(); addP(FRAME.BURST, x + RX * 0.12, y + RY * 0.12, z + RZ * 0.12, RX * 0.6, RY * 0.6, RZ * 0.6, 0.16, 0.02, rr(0.15, 0.3), 1.5, 2.5, 5, 1, 0.2, 0.5, 1.5, 0, 0.5, 0, 0, 1.3, 1); }
          break;
        case 'bfg':
          addP(FRAME.GLOW, x, y, z, 0, 0, 0, 0.9, 0.15, 0.4, 0.7, 3, 0.7, 0.9, 0.05, 0.6, 0.05, 0, 0, 0, 0, 1.3, 1);
          for (let i = 0; i < 2; i++) { rsph(); addP(FRAME.BURST, x + RX * 0.35, y + RY * 0.35, z + RZ * 0.35, RX * 0.8, RY * 0.8 + 0.3, RZ * 0.8, 0.28, 0.03, rr(0.35, 0.7), 1.2, 3.5, 1.0, 1, 0.1, 1, 0.1, 0, 0.6, 0, 0, 1.3, 1); }
          if (Math.random() < 0.3) { rsph(); streakP(add, x, y, z, RX * 3, RY * 3, RZ * 3, rr(0.2, 0.4), 0.06, 0.016, 0.03, 1.0, 3.2, 0.7, 0.1, 0.8, 0.1, 6, 0, 0); }
          break;
        case 'spit':
          addP(FRAME.GLOW, x, y, z, 0, 0, 0, 0.3, 0.05, 0.28, 0.5, 2.2, 0.25, 1, 0.1, 0.6, 0.05, 0, 0, 0, 0, 1.3, 1);
          if (Math.random() < 0.45) { rsph(); streakP(add, x, y, z, RX * 0.8, RY * 0.4 - 0.5, RZ * 0.8, rr(0.3, 0.6), 0.05, 0.02, 0.02, 0.6, 2.0, 0.2, 0.1, 0.6, 0.05, 9.8, F_BOUNCE, 0.1); }
          break;
        default: { // rocket
          rsph();
          smokeP(smokeFrame(), x + RX * 0.05, y + RY * 0.05, z + RZ * 0.05, RX * 0.25, RY * 0.25 + 0.15, RZ * 0.25, 0.2, rr(0.75, 1.0), rr(0.9, 1.4), 0.62, 0.6, 0.57, 0.5, 0.2, 0.2, 0.2, 0, -0.15, 0.9, 0, 1.4);
          addP(FRAME.FIRE1, x, y, z, 0, 0, 0, 0.34, 0.08, 0.12, 2.6, 1.3, 0.4, 1, 0.5, 0.1, 0, 0, 0, 0, 0, 1.2, 1);
          if (Math.random() < 0.35) streakP(add, x, y, z, RX * 1.5, RY * 1.5 + 0.5, RZ * 1.5, rr(0.2, 0.5), 0.05, 0.014, 0.03, 3, 1.8, 0.6, 1, 0.2, 0.03, 9.8, F_BOUNCE, 0.3);
        }
      }
    },

    // ------------------------------------------------------------------------------------------------ casings
    shell(pos, vel, kind = 'bullet') {
      const sys = kind === 'shotgun' ? shells : casings;
      if (kind === 'shotgun') sys.emit(pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, 1, 1, 1, rr(-18, 18), rr(-18, 18), rr(-18, 18), 6, 9.8, 0.42, 0.0135, 1, 1, 1, C_LIE);
      else sys.emit(pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, 1, 1, 1, rr(-30, 30), rr(-30, 30), rr(-30, 30), 5, 9.8, 0.45, 0.009, 0.95, 0.68, 0.28, C_LIE);
    },

    // ------------------------------------------------------------------------------------------------ decals
    decal(point, normal, kind = 'hole', size = 0.15) {
      const n = normal || UP;
      if (kind === 'blood') decalAdd(DECAL_RINGS.blood, point.x, point.y, point.z, n.x, n.y, n.z, size, Math.random() < 0.5 ? FRAME.SPLAT1 : FRAME.SPLAT2, 0.1, 0.003, 0.005, 0.92, 26, 9);
      else if (kind === 'scorch') decalAdd(DECAL_RINGS.scorch, point.x, point.y, point.z, n.x, n.y, n.z, size, FRAME.SCORCH, 1, 1, 1, 0.9, 80, 16);
      else decalAdd(DECAL_RINGS.hole, point.x, point.y, point.z, n.x, n.y, n.z, size, FRAME.HOLE, 0.78, 0.76, 0.72, 1, 45, 8);
    },

    // ------------------------------------------------------------------------------------------------ per-frame
    // quality controller (perf.js): particle + decal budgets, 1 = full
    setBudget(fx = 1, dec = 1) { add.setBudget(fx); alp.setBudget(fx); decals.setBudget(dec); },

    update(dt) {
      if (!(dt >= 0)) dt = 0; else if (dt > 0.25) dt = 0.25; // a NaN / huge step would poison T (every GPU-animated tracer / decal reads uTime) for the rest of the session
      T += dt; uTime.value = T; stainBudget = 8; impactBudget = Math.min(20, impactBudget + dt * 60);
      lights.update(dt);
      add.update(dt); alp.update(dt);
      gibs.update(dt); debris.update(dt); casings.update(dt); shells.update(dt);
      beams.update(dt); tracers.flush(); decals.flush();
    },

    reset() {
      T = 0; uTime.value = 0; stainBudget = 8; impactBudget = 20;
      add.clear(); alp.clear(); gibs.clear(); debris.clear(); casings.clear(); shells.clear(); beams.clear(); tracers.clear(); decals.clear(); decals.flush(); tracers.flush(); lights.reset();
    },

    _atlas: atlas, _dbg: { add, alp, decals, tracers, beams, gibs, debris, casings, shells, lights },
    // debug: active counts
    stats() { return { add: add.n, alpha: alp.n, gibs: gibs.n, debris: debris.n, casings: casings.n, shells: shells.n, lights: lights.lights.map((l) => +l.intensity.toFixed(1)) }; },
  };

  // ---- bigger recipes that need V ------------------------------------------------------------------------------------------------
  function fleshImpact(point, normal) {
    const n = normal || UP, px = point.x, py = point.y, pz = point.z;
    if (impactBudget <= 0) { impactBudget -= 0.5; smokeP(smokeFrame(), px, py, pz, n.x * 0.6, n.y * 0.6, n.z * 0.6, 0.08, 0.34, 0.4, 0.14, 0.004, 0.006, 0.5, 0.07, 0.002, 0.004, 0, -0.3, 3.2); return; }
    impactBudget -= 1;
    smokeP(smokeFrame(), px + n.x * 0.04, py + n.y * 0.04, pz + n.z * 0.04, n.x * 0.9, n.y * 0.9 + 0.1, n.z * 0.9, 0.1, 0.44, rr(0.35, 0.6), 0.15, 0.004, 0.007, 0.6, 0.07, 0.002, 0.004, 0, -0.3, 3.2);
    basis(n);
    for (let i = 0; i < 4; i++) {
      const a = rr(-1, 1), b = rr(-1, 1), sp = rr(1.5, 4.5);
      streakP(alp, px, py, pz, (n.x + _t.x * a + _b.x * b) * sp, (n.y + _t.y * a + _b.y * b) * sp + 0.8, (n.z + _t.z * a + _b.z * b) * sp, rr(0.5, 1.0), 0.06, 0.016, 0.028, 0.14, 0.004, 0.006, 0.07, 0.002, 0.004, 11, F_KILL | F_STAIN, 0, 0.95, 1);
    }
  }

  function bfgBlast(pos, s) {
    const px = pos.x, py = pos.y, pz = pos.z, fy = floorY(px, pz), near = py - fy < 5 * s;
    const dcam = game.camera ? Math.hypot(px - game.camera.position.x, py - game.camera.position.y, pz - game.camera.position.z) : 30, ik = clamp(dcam / 16, 0.4, 1);
    // white-green core flash and lingering glow
    addP(FRAME.HOT, px, py, pz, 0, 0, 0, 3 * s, 7 * s, 0.28, 0.9 * ik, 2.0 * ik, 0.9 * ik, 1, 0.3 * ik, 1.2 * ik, 0.3 * ik, 0, 0, 0, 0, 1.2, 2);
    addP(FRAME.GLOW, px, py, pz, 0, 0, 0, 8 * s, 12 * s, 1.5, 0.25 * ik, 1.1 * ik, 0.25 * ik, 0.5, 0.03, 0.3, 0.03, 0, 0, 0, 0, 1.5, 1.4);
    addP(FRAME.GLOW, px, py, pz, 0, 0, 0, 14 * s, 22 * s, 0.6, 0.15 * ik, 0.8 * ik, 0.15 * ik, 0.55, 0.01, 0.2, 0.01, 0, 0, 0, 0, 1.3, 2);
    // toxic fireballs
    for (let i = 0; i < 12; i++) {
      rsph(); const sp = rr(3, 9) * s, k = rr(0.8, 1.2) * ik;
      addP(fireFrame(), px + RX * 1.2 * s, py + RY * 1.2 * s, pz + RZ * 1.2 * s, RX * sp, RY * sp, RZ * sp, rr(2.5, 4) * s, rr(5, 8) * s, rr(0.6, 1.1), 0.12 * k, 0.75 * k, 0.16 * k, 1, 0.01, 0.3, 0.04, 0, 1.6, -0.5, Math.random() * 0.12, 1.5, 2);
    }
    // shock rings
    addP(FRAME.RING, px, py, pz, 0, 0, 0, 2 * s, 17 * s, 0.55, 0.5, 2.6, 0.5, 1, 0.05, 0.6, 0.05, 0, 0, 0, 0, 1.3, 0.8);
    addP(FRAME.RING, px, py, pz, 0, 0, 0, 1 * s, 11 * s, 0.4, 1.4, 3.5, 1.2, 0.8, 0.1, 0.8, 0.1, 0, 0, 0.08, 1.3, 0.8);
    if (near) planeP(add, FRAME.RING, px, fy + 0.07, pz, 0, 1, 0, 2 * s, 20 * s, 0.7, 0.4, 2.2, 0.4, 0.9, 0.05, 0.5, 0.05, 1.3);
    // lightning
    for (let i = 0; i < 9; i++) { rsph(); const l = rr(3, 7) * s; beams.add(px, py, pz, px + RX * l, py + RY * l, pz + RZ * l, rr(0.25, 0.45), 0.12, 0.35, 1.0, 0.3, 3.6, 0.5 * s + 0.3); }
    // sparks + motes
    for (let i = 0; i < 44; i++) { rsph(); const sp = rr(8, 26) * s; streakP(add, px, py, pz, RX * sp, RY * sp + 2, RZ * sp, rr(0.6, 1.5), 0.12, 0.035, 0.04, 1.0, 3.4, 0.7, 0.1, 0.9, 0.1, 4, F_BOUNCE, 0.4); }
    for (let i = 0; i < 26; i++) { rsph(); addP(FRAME.BURST, px + RX * 2 * s, py + RY * 2 * s, pz + RZ * 2 * s, RX * 2.5 * s, Math.abs(RY) * 2 + 0.5, RZ * 2.5 * s, rr(0.3, 0.7), rr(0.1, 0.25), rr(1.4, 2.6), 1.2, 3.4, 1.0, 1, 0.1, 1, 0.1, 0, 1.2, -0.3, Math.random() * 0.2, 1.4, 1); }
    // smoke + debris
    for (let i = 0; i < 8; i++) { rsph(); smokeP(smokeFrame(), px + RX * 2 * s, py + RY * 2 * s, pz + RZ * 2 * s, RX * 3 * s, Math.abs(RY) * 2 + 1, RZ * 3 * s, 2.5 * s, rr(6, 9) * s, rr(2.5, 4), 0.2, 0.5, 0.22, 0.7, 0.12, 0.2, 0.13, rr(0, 0.25), -0.4, 1.4, 0, 1.8); }
    for (let i = 0; i < 12; i++) { rsph(); const sp = rr(5, 14) * s, sz = rr(0.08, 0.24), v = rr(0.07, 0.15); debris.emit(px + RX * s, py, pz + RZ * s, RX * sp, Math.abs(RY) * sp + 3, RZ * sp, sz, sz * rr(0.6, 1.2), sz * rr(0.7, 1.3), rr(-18, 18), rr(-18, 18), rr(-18, 18), rr(3, 5), 14, 0.38, sz * 0.4, v, v * 1.2, v, 0); }
    if (near) decalAdd(DECAL_RINGS.scorch, px, fy + 0.003, pz, 0, 1, 0, 9 * s, FRAME.SCORCH, 0.75, 1, 0.8, 0.95, 90, 18);
    lights.claim(_lp.set(px, py + 0.5, pz), 0x66ff59, 400, 0.9, 36);
  }

  V.init = () => {};
  return V;
}
