// BFG 9000: 40 cells, 20-tic charge, slow 27 m/s green ball, detonation = splash + 40-ray spray of green beams
// fanned +-45deg around the player's view yaw (auto-aim at the first visible enemy per ray).
// Model: army-green armour on a black chassis, a caged emitter dish around a gyroscopic core (3 spinning rings, energy shells, crackling arcs), two glass
// tanks of bubbling green coolant, glowing heat-sink fins + rear louvres, LCD, kit_a gloved hands. Charge: rings spin up, core swells, arcs crackle, coolant
// boils, the whole gun pulls in and shudders, a green light washes the hands and a screen-edge glow + chromatic aberration build. Release: flare, huge
// recoil, steam bursts from the vents, everything cools. Detonation: shock shell, edge flash, chroma spike, camera shake, 40-ray beam spray.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Weapon } from './base.js';
import { TIC, bus, clamp, rand, randInt } from '../core.js';
import * as K from './kitb.js';
import { warmup, flashPulse, flashDecay, flashKill } from './kit_a.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _v = new THREE.Vector3(), _u = new THREE.Vector3();
const _f = new THREE.Vector3(), _org = new THREE.Vector3(), _dir = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const CHROMA = 0.0006;
const CHARGE_T = 20 * TIC, TOTAL_T = 60 * TIC;
const Y0 = 0.03, CORE_Z = -0.42;
const easeOut = (t) => 1 - (1 - t) * (1 - t);

// ---------------------------------------------------------------------------------------------------------------
// Global BFG screen / world effects: viewScene edge glow (built once, lives on the view camera so it outlives the weapon), detonation shock shells
// ---------------------------------------------------------------------------------------------------------------
function makeFx(game) {
  if (game.__bfgFx) return game.__bfgFx;
  const fx = { glow: 0, edge: 0, t: -1, shocks: [], gm: null, edgeMesh: null };
  const mat = K.additiveMat(K.vignetteTexture(), 0.3, 2.0, 0.4, { depthTest: false, opacity: 1 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); m.position.z = -0.3; m.renderOrder = 1000; m.frustumCulled = false; m.visible = false;
  game.viewCamera.add(m); fx.edgeMesh = m; fx.edgeMat = mat;
  const eT = K.energyTexture(6, { w: 256, h: 128, blobs: 190, arcs: 18 });
  for (let i = 0; i < 2; i++) {
    const sm = new THREE.MeshBasicMaterial({ map: eT, color: new THREE.Color(0.3, 1.6, 0.4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    const s = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), sm); s.visible = false; s.frustumCulled = false; s.renderOrder = 5;
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(0.5, 2.4, 0.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0 })); fl.visible = false; fl.frustumCulled = false;
    game.scene.add(s, fl); fx.shocks.push({ s, sm, fl, t: 9, ik: 1 });
  }
  fx.tick = (dt) => { // edge glow decays; shock shells expand
    fx.edge = Math.max(0, fx.edge - dt * 1.6);
    const v = Math.min(1, fx.glow + fx.edge);
    fx.edgeMesh.visible = v > 0.01;
    if (fx.edgeMesh.visible) { const vc = game.viewCamera, h = 2 * 0.3 * Math.tan(vc.fov * Math.PI / 360) * 1.06; fx.edgeMesh.scale.set(h * vc.aspect, h, 1); fx.edgeMat.opacity = v * (0.85 + 0.15 * Math.sin(game.time * 40)); }
    for (const sh of fx.shocks) {
      if (sh.t > 0.7) continue; sh.t += dt; const k = Math.min(1, sh.t / 0.5), e = easeOut(k);
      const r = 0.6 + e * 8.5; sh.s.scale.set(r, r * 0.92, r); sh.s.rotation.y += dt * 1.5; sh.s.rotation.x += dt * 0.9;
      sh.sm.opacity = (1 - k) * (1 - k) * 0.62 * sh.ik; sh.sm.map.offset.x += dt * 0.6;
      const fk = Math.min(1, sh.t / 0.36); sh.fl.material.opacity = (1 - fk) * (1 - fk) * 0.6 * sh.ik; sh.fl.scale.setScalar(2.5 + fk * 10);
      if (sh.t >= 0.7 || k >= 1 && sh.fl.material.opacity < 0.01) { sh.s.visible = false; sh.fl.visible = false; sh.t = 9; }
    }
  };
  fx.detonate = (pos) => {
    const sh = fx.shocks.find((x) => x.t > 0.7) || fx.shocks[0];
    const dcam = game.camera ? game.camera.position.distanceTo(pos) : 20; sh.ik = clamp(dcam / 9, 0.3, 1);
    sh.t = 0; sh.s.position.copy(pos); sh.fl.position.copy(pos); sh.s.visible = true; sh.fl.visible = true; sh.s.scale.setScalar(0.6);
    fx.edge = Math.max(fx.edge, 0.9 * (0.5 + 0.5 * sh.ik));
    if (game.fx) game.fx.chroma = Math.max(game.fx.chroma, 0.0075);
  };
  // tick lazily from anywhere (weapon animate, spray scheduler): advances only when game.time moved, so several callers per frame are fine
  fx.lastT = -1; fx.update = () => { const t = game.time, dt = fx.lastT < 0 ? 0 : t - fx.lastT; fx.lastT = t; if (dt > 0) fx.tick(Math.min(dt, 0.1)); else if (fx.lastT < 0) fx.tick(0); };
  game.__bfgFx = fx;
  return fx;
}

// ---------------------------------------------------------------------------------------------------------------
// In-flight BFG ball (built + shader-warmed in init(), pooled)
// ---------------------------------------------------------------------------------------------------------------
const freeBalls = [], allBalls = []; let BA = null, hooked = false;
// geometries + materials shared by every ball (only the sparkle material and the arc ribbons are per-ball)
function ballAssets(game) {
  if (BA) return BA;
  const eT = K.energyTexture(5, { w: 256, h: 128, blobs: 170, arcs: 16 });
  const add = (o) => ({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, ...o });
  const N = 34, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const r = 0.5 + Math.random() * 0.7, a = Math.random() * 6.283, b = Math.acos(2 * Math.random() - 1); pos[i * 3] = Math.sin(b) * Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(b) * Math.sin(a) * r; pos[i * 3 + 2] = Math.cos(b) * r; }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  BA = {
    gCore: new THREE.SphereGeometry(0.25, 18, 12), gWhite: new THREE.SphereGeometry(0.11, 12, 8), gShell: new THREE.SphereGeometry(0.34, 20, 14), gCage: new THREE.IcosahedronGeometry(0.4, 1), gCage2: new THREE.IcosahedronGeometry(0.58, 0), gSparks: pg,
    mCore: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.25, 0.3), toneMapped: false, fog: false }), mWhite: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 1.6, 0.9), toneMapped: false, fog: false }),
    mShell: new THREE.MeshBasicMaterial(add({ map: eT, color: new THREE.Color(0.25, 1.5, 0.35), opacity: 0.75 })),
    mCage: new THREE.MeshBasicMaterial(add({ color: new THREE.Color(0.12, 1.2, 0.22), wireframe: true, opacity: 0.8 })), mCage2: new THREE.MeshBasicMaterial(add({ color: new THREE.Color(0.1, 0.9, 0.2), wireframe: true, opacity: 0.5 })),
    mHalo: new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(0.1, 1.0, 0.18), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.7 }),
    mHalo2: new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(0.05, 0.7, 0.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.35 }),
    mArcs: K.additiveMat(K.beamTexture(), 0.4, 2.2, 0.6, { side: THREE.DoubleSide }),
  };
  return BA;
}
function makeBall(game, register = true) {
  const A = ballAssets(game), g = new THREE.Group();
  const core = new THREE.Mesh(A.gCore, A.mCore), white = new THREE.Mesh(A.gWhite, A.mWhite), shell = new THREE.Mesh(A.gShell, A.mShell), cage = new THREE.Mesh(A.gCage, A.mCage), cage2 = new THREE.Mesh(A.gCage2, A.mCage2);
  const halo = new THREE.Sprite(A.mHalo), halo2 = new THREE.Sprite(A.mHalo2);
  const sparks = new THREE.Points(A.gSparks, new THREE.PointsMaterial({ map: K.sparkTexture(), size: 0.3, color: new THREE.Color(0.3, 1.5, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false, toneMapped: false }));
  const arcs = new K.Arcs(g, 7, 5, A.mArcs);
  g.add(core, white, shell, cage, cage2, halo, halo2, sparks);
  const u = g.userData; u.core = core; u.white = white; u.shell = shell; u.cage = cage; u.cage2 = cage2; u.halo = halo; u.halo2 = halo2; u.sparks = sparks; u.arcs = arcs;
  for (const c of g.children) c.frustumCulled = false;
  if (register) allBalls.push(g);
  return g;
}
function getBall(game) { return freeBalls.pop() || makeBall(game); }
function resetBalls() { freeBalls.length = 0; for (const b of allBalls) { b.parent?.remove(b); b.userData.arcs.hideAll(); freeBalls.push(b); } }

// ---------------------------------------------------------------------------------------------------------------
// The spray: 40 rays across +-45deg of the player's view yaw; each hits the first visible enemy along it.
// Damage/beams are applied on a tiny scheduler (a zero-speed projectile) so they play out even if the weapon is swapped.
// ---------------------------------------------------------------------------------------------------------------
function dmgRay() { return 15 * randInt(1, 8); } // 15..120 per ray

function bfgSpray(G, ballPos) {
  G.camera.getWorldDirection(_f);
  const yaw = Math.atan2(-_f.x, -_f.z);
  _org.copy(G.player.eye); _org.y -= 0.3;
  const counts = new Map(), events = [];
  for (let i = 0; i < 40; i++) {
    const a = yaw + (-45 + (i + 0.5) * (90 / 40)) * K.DEG;
    _dir.set(-Math.sin(a), 0, -Math.cos(a));
    const e = G.enemies?.raycast(_org, _dir, 32, 0.5);
    const blocked = e && e.enemy ? G.world.raycast(_org, _dir, e.dist) : null; // wall in the way
    if (e && e.enemy && !blocked) { counts.set(e.enemy, (counts.get(e.enemy) || 0) + 1); continue; }
    // rays that find nothing still crackle out into the room (decoration, every 3rd ray)
    if (i % 3 === 1) {
      const w = G.world.raycast(_org, _dir, 32), d = w ? w.dist : 14 + Math.random() * 16;
      events.push({ t: rand(0.0, 0.15), done: false, fixed: true, enemy: null, dmg: 0, dy: 0, from: ballPos.clone(), to: new THREE.Vector3(_org.x + _dir.x * d, w ? w.point.y : _org.y + rand(-1, 0.3), _org.z + _dir.z * d) });
    }
  }
  const DY = [0, 0.22, -0.28];
  for (const [enemy, n] of counts) {
    const nev = Math.min(n, 3);
    let left = n;
    for (let k = 0; k < nev; k++) {
      const share = k === nev - 1 ? left : Math.max(1, Math.round(n / nev)); left -= share;
      let dmg = 0; for (let j = 0; j < share; j++) dmg += dmgRay();
      events.push({ t: rand(0.0, 0.15), done: false, enemy, dmg, dy: DY[k], from: ballPos.clone(), to: new THREE.Vector3() });
    }
  }
  let shook = false;
  const run = (ev) => {
    if (ev.done) return; ev.done = true;
    if (ev.fixed) { G.vfx.bfgBeam(ev.from, ev.to); return; }
    const en = ev.enemy;
    ev.to.set(en.pos.x, en.pos.y + en.height * (0.62 + ev.dy * 0.6), en.pos.z);
    G.vfx.bfgBeam(ev.from, ev.to);
    if (en.alive) {
      _u.copy(ev.to).sub(ev.from).normalize();
      G.enemies.damage(en, ev.dmg, { point: ev.to.clone(), dir: _u.clone(), type: 'bfg', source: 'player', part: 'torso', knock: 5 });
      if (!shook) { shook = true; G.player.shake?.(0.55); }   // the first beam that lands rattles the camera a second time
    }
  };
  const fx = G.__bfgFx;
  G.projectiles.spawn({
    pos: ballPos, dir: UP, speed: 0, life: 0.7, owner: 'player', data: { events },
    onUpdate: (p) => { for (const ev of events) if (!ev.done && p.age >= ev.t) run(ev); fx?.update(); },
    onExpire: () => { for (const ev of events) run(ev); fx?.update(); },
  });
}

export default class BFG9000 extends Weapon {
  constructor(game) {
    super(game, { id: 'bfg', name: 'BFG 9000', slot: 7, ammoType: 'cells', ammoPerShot: 40, raiseTime: 0.46, lowerTime: 0.3 });
    this.rest.set(0.13, -0.14, -0.74); this.viewYaw = 0.32; this.viewPitch = 0.05;
    this.state = 'idle'; this.st = 99; this.charge = 0; this.flare = 0; this.chromaOn = false; this.emptyT = 0; this.steamT = 0; this.ammoKey = -1; this.trig = 0; this._dbg = null; this.vent = 0;
    const G = game;
    if (!hooked) { hooked = true; bus.on('game:start', () => { resetBalls(); const fx = G.__bfgFx; if (fx) { fx.glow = 0; fx.edge = 0; fx.edgeMesh.visible = false; for (const sh of fx.shocks) { sh.t = 9; sh.s.visible = false; sh.fl.visible = false; } } }); }
    this.cbHit = (p, hit) => this.detonate(p, hit.point, hit.normal, hit.kind === 'enemy' ? hit.enemy : null);
    this.cbExpire = (p) => this.detonate(p, p.pos, null, null);
    this.cbUpdate = (p, dt) => {
      const d = p.data, m = p.mesh, u = m.userData, t = p.age;
      const grow = clamp(0.25 + t * 1.6, 0.25, 1);
      m.rotation.x += dt * 2.1; m.rotation.y += dt * 1.6;
      u.cage.rotation.x -= dt * 3.4; u.cage.rotation.z += dt * 2.6; u.cage2.rotation.y += dt * 4.2; u.cage2.rotation.x -= dt * 1.7;
      u.sparks.rotation.y += dt * 3.2; u.sparks.rotation.z -= dt * 2.3; u.sparks.material.size = 0.3 * grow;
      u.shell.rotation.y += dt * 2.4; u.shell.material.map.offset.x = (u.shell.material.map.offset.x + dt * 0.5) % 1;
      const pulse = 1 + 0.12 * Math.sin(t * 22) + (Math.random() - 0.5) * 0.12;
      u.core.scale.setScalar(pulse * grow); u.white.scale.setScalar((1 + 0.2 * Math.random()) * grow); u.shell.scale.setScalar((1.0 + 0.1 * Math.random()) * grow);
      u.cage.scale.setScalar(grow); u.cage2.scale.setScalar(grow * (0.95 + 0.1 * Math.random()));
      u.halo.scale.setScalar((1.9 + Math.random() * 0.3) * grow); u.halo2.scale.setScalar((3.6 + Math.random() * 0.5) * grow);
      // lightning crawling over the surface
      for (let i = 0; i < 7; i++) {
        if (Math.random() < 0.6) { const a = rand(0, 6.28), b = Math.acos(rand(-1, 1)), R0 = 0.28 * grow, R1 = rand(0.55, 0.85) * grow, c = Math.random() < 0.5 ? 1 : -1; u.arcs.set(i, Math.sin(b) * Math.cos(a) * R0, Math.cos(b) * R0, Math.sin(b) * Math.sin(a) * R0, Math.sin(b + 0.5 * c) * Math.cos(a + 0.7) * R1, Math.cos(b + 0.5 * c) * R1, Math.sin(b + 0.5 * c) * Math.sin(a + 0.7) * R1, 0.06 * grow, 0.018 * grow); } else u.arcs.hide(i);
      }
      u.arcs.flush();
      if ((d.tt -= dt) <= 0) { d.tt = 0.03; G.vfx.trail(p.pos, 'bfg'); }
      if ((d.lt -= dt) <= 0) { d.lt = 0.16; G.vfx.light(p.pos, 0x50ff48, 5, 0.24, 18); }
    };
  }

  detonate(p, point, normal, enemy) {
    const G = this.game;
    _e.copy(point); if (normal) _e.addScaledVector(normal, 0.3);
    const pos = _e.clone();
    if (p.mesh) { p.mesh.userData.arcs.hideAll(); if (!freeBalls.includes(p.mesh)) freeBalls.push(p.mesh); }
    if (enemy && enemy.alive) G.enemies.damage(enemy, 100 * randInt(1, 8), { point: point.clone(), dir: p.dir.clone(), type: 'bfg', source: 'player', part: 'torso', dist: p.age * p.speed });
    G.vfx.bfgExplosion(pos);
    G.audio.play('bfgHit', pos);
    G.combat.explosion(pos, 6, 100, { owner: 'player', kind: 'bfg', fx: false });
    G.hud?.flash?.('#7dff6a', 0.6, 0.5);
    G.player.shake?.(1.2);
    G.__bfgFx?.detonate(pos);
    bfgSpray(G, pos);
  }

  buildModel() {
    const g = this.game, kit = K.getKit(g), HR = K.getHero(g), M = kit.M, H = HR.H, model = new THREE.Group();
    this.gun = new THREE.Group(); model.add(this.gun); this.gun.scale.setScalar(1.1);
    const G = this.gun, B = new K.HParts(), F = new K.HParts(), gr = H.bfgGreen, bk = H.bfgBlack;
    // glowing materials (animated in animate())
    this.coreMat = K.glowBasic(0.6, 2.4, 0.8); this.ringMat = K.glowBasic(0.3, 1.8, 0.5); this.accentMat = K.glowBasic(0.25, 1.5, 0.4);
    this.ventMat = new THREE.MeshBasicMaterial({ map: K.grilleTexture({ slots: 4 }), color: new THREE.Color(0.2, 1.3, 0.35), toneMapped: false });
    this.shellMat = new THREE.MeshBasicMaterial({ map: K.energyTexture(11, { w: 256, h: 128, blobs: 160, arcs: 14 }), color: new THREE.Color(0.2, 1.4, 0.3), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    this.liquidTex = K.liquidTexture(); this.liquidTex.repeat.set(1, 1);
    this.liquidMat = new THREE.MeshBasicMaterial({ map: this.liquidTex, color: new THREE.Color(0.25, 0.75, 0.3), toneMapped: false }); this.liquidMat.userData.native = true;

    // ================================================================ body =================================================================
    B.profile(gr, [[0.165, 0.055, 0.014], [0.10, 0.088, 0.010], [-0.075, 0.088, 0.010], [-0.155, 0.062, 0.010], [-0.155, -0.048, 0.010], [0.0, -0.058, 0.012], [0.165, -0.034, 0.014]], 0.140, [0, 0, 0], null, 0.003);
    B.box(bk, [0.120, 0.030, 0.262], [0, -0.072, 0.02], null, 0.006);
    B.box(bk, [0.100, 0.020, 0.250], [0, 0.098, 0.03], null, 0.006);
    for (const sx of [-1, 1]) {
      B.box(bk, [0.004, 0.058, 0.190], [sx * 0.0715, 0.036, 0.022], null, 0.002);
      B.box(M.steel, [0.0025, 0.004, 0.14], [sx * 0.0728, 0.070, 0.022], null, 0);
      for (const [y, z] of [[0.070, 0.105], [-0.002, 0.105], [0.070, -0.055], [-0.002, -0.055]]) B.screw(M.steel, M.black, 0.0050, [sx * 0.0740, y, z], 'x');
      B.box(M.dark, [0.030, 0.026, 0.060], [sx * 0.086, -0.030, 0.052], null, 0.004); B.box(M.dark, [0.030, 0.026, 0.060], [sx * 0.086, -0.030, -0.070], null, 0.004);   // tank brackets
      B.cyl(M.steel, 0.0048, 0.0048, 0.22, 'z', [sx * 0.0775, 0.0805, 0.02], null, 10);   // conduit along the flank
      for (const z of [-0.06, 0.02, 0.10]) B.box(M.dark, [0.010, 0.012, 0.012], [sx * 0.0755, 0.0795, z], null, 0.001);
    }
    // rear: cooling louvres + cap
    B.box(bk, [0.13, 0.11, 0.024], [0, 0.020, 0.176], null, 0.006);
    for (let i = 0; i < 4; i++) B.box(M.dark, [0.132, 0.008, 0.012], [0, -0.022 + i * 0.026, 0.192], null, 0.001);
    B.cyl(M.steel, 0.020, 0.020, 0.010, 'z', [0, 0.020, 0.194], null, 16); B.cyl(M.black, 0.010, 0.010, 0.002, 'z', [0, 0.020, 0.2], null, 12);
    // top heat-sink fins (glow strips added below)
    for (let i = 0; i < 9; i++) B.box(M.dark, [0.092, 0.026, 0.0045], [0, 0.122, -0.030 + i * 0.0125], null, 0.001);
    B.box(bk, [0.070, 0.010, 0.020], [0, 0.109, 0.110], null, 0.002);

    // ================================================================ emitter housing + cage ===============================================
    B.lathe2(bk, [[0, 0.150], [0.086, 0.150], [0.093, 0.172], [0.093, 0.232], [0.101, 0.232], [0.101, 0.252], [0.092, 0.252], [0.092, 0.262], [0.080, 0.262], [0.080, 0.150]], [0, Y0, 0], null, 40);
    B.cyl(H.hazardN, 0.0942, 0.0942, 0.032, 'z', [0, Y0, -0.202], null, 40);
    B.boltCircle(M.steel, 0, Y0, -0.2525, 0.096, 16, 0.0042, 0.005, 0.1, 8);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; B.box(M.dark, [0.014, 0.010, 0.030], [Math.cos(a) * 0.076, Y0 + Math.sin(a) * 0.076, -0.27], [0, 0, a], 0.001); }   // rib roots
    const ribs = new K.HParts(), glowRibs = new K.HParts();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8, c = Math.cos(a), s = Math.sin(a), P = [[0.084, -0.268], [0.106, -0.335], [0.122, -0.42], [0.118, -0.505], [0.098, -0.575]];
      ribs.tube(M.dark, P.map(([r, z]) => [c * r, Y0 + s * r, z]), 0.0092, [0, 0, 0], 20);
      glowRibs.tube(this.accentMat, P.map(([r, z]) => [c * (r + 0.0088), Y0 + s * (r + 0.0088), z]), 0.0026, [0, 0, 0], 20);
    }
    for (const [z, R] of [[-0.335, 0.106], [-0.42, 0.122], [-0.505, 0.118]]) ribs.torus(M.steel, R, 0.0072, [0, Y0, z], null, 40);
    ribs.torus(M.dark, 0.097, 0.0115, [0, Y0, -0.577], null, 40); glowRibs.torus(this.accentMat, 0.089, 0.0042, [0, Y0, -0.585], null, 40);
    B.boltCircle(M.steel, 0, Y0, -0.5875, 0.099, 12, 0.0042, 0.004, 0.2, 8);
    // tanks (glass shells + bubbling coolant) and hoses
    const glassP = new K.HParts(), liqP = new K.HParts();
    for (const sx of [-1, 1]) {
      glassP.cyl(H.glass, 0.036, 0.036, 0.205, 'z', [sx * 0.120, -0.030, -0.010], null, 24);
      liqP.cyl(this.liquidMat, 0.0305, 0.0305, 0.200, 'z', [sx * 0.120, -0.030, -0.010], null, 22);
      B.cyl(M.dark, 0.0385, 0.0385, 0.012, 'z', [sx * 0.120, -0.030, -0.1145], null, 24); B.cyl(M.dark, 0.0385, 0.0385, 0.012, 'z', [sx * 0.120, -0.030, 0.0945], null, 24); B.torus(M.steel, 0.0335, 0.0032, [sx * 0.120, -0.030, 0.1015], null, 20);
      B.cyl(M.dark, 0.0345, 0.0345, 0.006, 'z', [sx * 0.120, -0.030, -0.1235], null, 20);
      for (const z of [-0.06, 0.04]) B.torus(M.steel, 0.0368, 0.0032, [sx * 0.120, -0.030, z], null, 24);
      B.tube(M.rubber, [[sx * 0.120, -0.030, -0.128], [sx * 0.118, -0.012, -0.160], [sx * 0.100, 0.004, -0.195], [sx * 0.088, Y0 - 0.010, -0.235]], 0.0075, [0, 0, 0], 16);
    }

    // ================================================================ grips ==================================================================
    F.box(bk, [0.062, 0.030, 0.120], [0, -0.092, 0.060], null, 0.005);
    F.box(M.rubber, [0.044, 0.130, 0.056], [0, -0.155, 0.092], [-0.30, 0, 0], 0.007);
    F.box(M.stipple, [0.0018, 0.100, 0.044], [0.0226, -0.150, 0.090], [-0.30, 0, 0], 0.0006); F.box(M.stipple, [0.0018, 0.100, 0.044], [-0.0226, -0.150, 0.090], [-0.30, 0, 0], 0.0006);
    F.box(M.steel, [0.040, 0.006, 0.052], [0, -0.222, 0.116], [-0.30, 0, 0], 0.002);
    F.torus(M.blued, 0.026, 0.0036, [0, -0.080, 0.008], [0, Math.PI / 2, 0], 24, [1.5, 1, 1]);
    F.box(bk, [0.036, 0.032, 0.054], [0, -0.084, -0.20], null, 0.004);
    F.cyl(M.rubber, 0.0225, 0.0215, 0.122, 'y', [0, -0.155, -0.20], null, 16);
    for (let i = 0; i < 5; i++) F.torus(M.black, 0.0226, 0.0015, [0, -0.115 - i * 0.021, -0.20], [Math.PI / 2, 0, 0], 16);
    F.cyl(M.dark, 0.0245, 0.0245, 0.008, 'y', [0, -0.219, -0.20], null, 16);
    this.handR = K.gripHand(kit, 'R', G, F, [0.0435, -0.112, 0.096], [0.30, 0, -Math.PI / 2], K.POSE_TRIGGER);
    this.idxF = this.handR.find('index');
    this.handL = K.gripHand(kit, 'L', G, F, [-0.041, -0.155, -0.176], [0.0, 0, Math.PI / 2], K.POSE_GRIP);
    this.bodyG = B.build('body'); G.add(this.bodyG);
    this.frameG = F.build('frame'); G.add(this.frameG);
    this.cageG = ribs.build('cage'); G.add(this.cageG); this.cageGlow = glowRibs.build('cageGlow'); G.add(this.cageGlow);
    this.tanksG = glassP.build('tanks'); this.tanksG.children.forEach((m) => { m.renderOrder = 4; }); G.add(this.tanksG); this.liquidG = liqP.build('coolant'); G.add(this.liquidG);
    this.trigger = new THREE.Group(); this.trigger.position.set(0, -0.084, 0.012); G.add(this.trigger);
    { const T = new K.HParts(); T.box(M.blued, [0.008, 0.032, 0.007], [0, -0.015, 0], [0.25, 0, 0], 0.002); T.box(M.steel, [0.005, 0.014, 0.005], [0, -0.012, -0.004], [0.25, 0, 0], 0.001); this.trigger.add(T.build('trig')); }

    // ================================================================ glowing hardware ======================================================
    { const A = new K.HParts();
      for (let i = 0; i < 8; i++) A.box(this.accentMat, [0.088, 0.004, 0.0075], [0, 0.1085 + 0.0, -0.0248 + i * 0.0125], null, 0);   // strips between the fins
      for (const sx of [-1, 1]) { A.box(this.accentMat, [0.0016, 0.005, 0.15], [sx * 0.0728, 0.048, 0.022], null, 0); A.box(this.accentMat, [0.0016, 0.005, 0.15], [sx * 0.0728, 0.008, 0.022], null, 0); }
      this.accentG = A.build('accent'); G.add(this.accentG); }
    { const gs = []; for (let i = 0; i < 3; i++) { const pg = new THREE.PlaneGeometry(0.122, 0.012); pg.translate(0, -0.009 + i * 0.026, 0.1892); gs.push(pg); }   // louvre glow slits (rear), one mesh
      const vm = new THREE.Mesh(mergeGeometries(gs, false), this.ventMat); vm.frustumCulled = false; G.add(vm); }
    // core + gyroscopic rings + energy shells inside the cage
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.040, 18, 12), this.coreMat); this.core.position.set(0, Y0, CORE_Z); G.add(this.core);
    this.white = new THREE.Mesh(new THREE.SphereGeometry(0.020, 12, 8), K.glowBasic(1.6, 2.4, 1.6)); this.white.position.copy(this.core.position); G.add(this.white);
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(0.062, 20, 14), this.shellMat); this.shell.position.copy(this.core.position); this.shell.renderOrder = 5; G.add(this.shell);
    this.rings = [0, 1, 2].map((i) => { const grp = new THREE.Group(); grp.position.copy(this.core.position); grp.rotation.set(i * 1.1, 0.4 * i, 0.5 * i); const m = new THREE.Mesh(new THREE.TorusGeometry(0.062 + i * 0.015, 0.0042, 6, 36), this.ringMat); m.frustumCulled = false; grp.add(m); G.add(grp); return grp; });
    this.coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(0.25, 1.6, 0.35), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.8, depthTest: false }));
    this.coreGlow.position.copy(this.core.position); this.coreGlow.scale.setScalar(0.25); this.coreGlow.renderOrder = 5; this.coreGlow.frustumCulled = false; G.add(this.coreGlow);
    // charge lightning: ribbon arcs from the core to the cage ribs + rib to rib
    this.arcs = new K.Arcs(G, 12, 5, K.additiveMat(K.beamTexture(), 0.4, 2.4, 0.7, { side: THREE.DoubleSide }));

    // LCD + decals
    this.lcd = new K.LCD(160, 72, (ctx, w, h, key, n, c) => {
      ctx.fillStyle = '#020a03'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#4dff6a'; ctx.font = 'bold 20px monospace'; ctx.fillText(c > 0 ? 'CHARGING' : 'CELLS', 8, 22);
      ctx.font = 'bold 36px monospace'; ctx.fillText(String(n).padStart(3, '0'), 8, 62);
      ctx.strokeStyle = 'rgba(77,255,106,0.6)'; ctx.strokeRect(2, 2, w - 4, h - 4); ctx.fillStyle = 'rgba(77,255,106,0.85)'; ctx.fillRect(84, 40, 66 * c, 22); ctx.strokeRect(84, 40, 66, 22);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    });
    const lb = new K.HParts(); lb.box(M.black, [0.005, 0.040, 0.078], [-0.0745, 0.062, 0.090], null, 0.002); this.frameG.add(lb.build('lcdBox'));
    const lp = new THREE.Mesh(new THREE.PlaneGeometry(0.070, 0.031), this.lcd.mat); lp.rotation.y = -Math.PI / 2; lp.position.set(-0.0775, 0.062, 0.090); lp.frustumCulled = false; G.add(lp);
    const D = new K.DecalSheet(g, 1024, 512);
    const rMain = D.text(640, 160, ['BFG 9000', 'BIO-FIELD GENERATOR · CLASS IX'], { color: 'rgba(200,255,176,0.92)', size: 0.6 });
    const rWarn = D.text(400, 84, ['DANGER', 'IONISING DISCHARGE · KEEP CLEAR'], { color: 'rgba(16,20,12,0.95)', bg: 'rgba(222,176,30,0.95)', border: 'rgba(16,20,12,0.95)', size: 0.5, bw: 5 });
    const rSer = D.text(220, 40, 'SN 9-0000-Ω', { color: 'rgba(200,255,176,0.75)', size: 0.7, weight: 'normal' });
    const rCell = D.text(240, 48, '40 CELLS / DISCHARGE', { color: 'rgba(120,255,140,0.9)', size: 0.66 });
    D.plane(rMain, 0.120, 0.030, [-0.0741, 0.030, -0.030], 'x-');
    D.plane(rWarn, 0.074, 0.0155, [-0.0741, 0.0, 0.085], 'x-');
    D.plane(rSer, 0.040, 0.0075, [-0.0741, 0.0, -0.100], 'x-');
    D.plane(rCell, 0.048, 0.0095, [0, 0.1083, 0.140], 'y+');
    this.decals = D.build('decals'); G.add(this.decals);

    // ================================================================ muzzle / puffs ========================================================
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, Y0, -0.60); G.add(this.muzzle);
    this.flash = g.vfx.createFlash('bfg'); this.muzzle.add(this.flash.object3d);
    this.steam = new K.Puffs(model, 16, K.smokeTexture(), { color: 0xc8ffd0, drag: 1.8 });
    this.sparks = new K.Puffs(model, 8, K.glowTexture(), { additive: true, color: new THREE.Color(0.6, 2.2, 0.8), drag: 3 });
    return model;
  }

  init() {
    super.init();
    const G = this.game; makeFx(G);
    for (let i = 0; i < 3; i++) freeBalls.push(makeBall(G));            // ball prototypes
    K.park(G, makeBall(G, false));                                             // parked spare: the boot warm-up compiles the ball's programs (additive shells, arcs, sprites, points, wireframes)
  }

  debugAt(spec) { this._dbg = spec; if (spec) { if (spec.charge !== undefined) this.charge = spec.charge; if (spec.flare !== undefined) this.flare = spec.flare; if (spec.vent !== undefined) this.vent = spec.vent; } }
  update(dt, ctx) { if (!this.game.__waWarm) warmup(this.game); super.update(dt, ctx); }
  setChroma(v) { const fx = this.game.fx; if (fx) fx.chroma = v; }
  onSelect() { this.steam.clear(); this.sparks.clear(); this.state = 'idle'; this.st = 99; this.charge = 0; this.emptyT = 0; this.setChroma(CHROMA); this._dbg = null; this.flash.object3d.visible = false; this.arcs.hideAll(); }
  onDeselect() { this.setChroma(CHROMA); flashKill(this.game); if (this.game.__bfgFx) this.game.__bfgFx.glow = 0; }
  canSwitch() { return this.state === 'idle' || (this.state === 'recover' && this.st > 0.3); }

  think(dt, ctx) {
    if (this.state !== 'idle' || !ctx.fire || this.cool > 0 || this._dbg) return;
    const g = this.game;
    if (!this.hasAmmo()) {
      if (this.emptyT <= 0) { g.audio.play('empty'); this.emptyT = 0.5; g.weapons.autoSwitch(); }
      return;
    }
    this.state = 'charge'; this.st = 0;
    g.audio.play('bfgCharge');
    g.hud?.flash?.('#7dff6a', 0.22, 0.75);
    g.player.shake?.(0.22);
  }

  launch() {
    const g = this.game;
    if (!this.consume()) { this.state = 'idle'; return; }
    this.state = 'recover'; this.st = 0; this.flare = 1; this.vent = 1;
    this.muzzleWorld(_o);
    const eye = g.player.eye; if (!K.clearPath(g, eye, _o)) _o.copy(eye);
    K.aimDir(g, _o, _d);
    if (_o.equals(eye)) _o.addScaledVector(_d, 0.3);
    const mesh = getBall(g); mesh.quaternion.identity(); mesh.scale.setScalar(1.35);
    g.projectiles.spawn({ mesh, pos: _o, dir: _d, speed: 27, radius: 0.35, life: 6, owner: 'player', onHit: this.cbHit, onUpdate: this.cbUpdate, onExpire: this.cbExpire, data: { tt: 0, lt: 0.05 } });
    g.audio.play('bfgFire');
    this.flash.object3d.rotation.z = rand(0, 6.28); this.flash.fire(1.6);
    this.muzzleWorld(_o); g.vfx.light(_o, 0x5cff50, 4.5, 0.3, 18);
    flashPulse(g, this.core, 2.6, 0x60ff60);
    this.kickBack(0.13, 0.13, 0.06, 0.02);
    g.player.shake?.(0.7);
    g.hud?.flash?.('#7dff6a', 0.32, 0.22);
    if (g.__bfgFx) g.__bfgFx.edge = Math.max(g.__bfgFx.edge, 0.55);
    for (let i = 0; i < 8; i++) this.sparks.emit(rand(-0.06, 0.06), Y0 + rand(-0.06, 0.06), -0.6, rand(-0.7, 0.7), rand(-0.7, 0.7), rand(-1.4, -0.3), rand(0.22, 0.45), 0.02, rand(0.035, 0.07), 0.9);
    for (let i = 0; i < 6; i++) this.steam.emit(rand(-0.04, 0.04), Y0 + rand(-0.03, 0.06), -0.45, rand(-0.2, 0.2), rand(-0.05, 0.25), rand(-0.9, -0.2), rand(0.7, 1.1), 0.08, rand(0.3, 0.5), 0.45, rand(-1, 1));
    bus.emit('weapon:fire', { id: 'bfg' });
    if (!this.hasAmmo()) g.weapons.autoSwitch();
  }

  animate(dt, ctx) {
    const g = this.game, t = this.time, dbg = this._dbg;
    this.emptyT = Math.max(0, this.emptyT - dt);
    if (!dbg) {
      this.st += dt;
      if (this.state === 'charge') {
        this.charge = clamp(this.st / CHARGE_T, 0, 1);
        if (!g.player.alive) { this.state = 'idle'; this.charge = 0; } // died mid-charge: no shot
        else if (this.st >= CHARGE_T) { this.launch(); }
      } else if (this.state === 'recover') {
        this.charge = Math.max(0, 1 - this.st / 0.4);
        if (this.st >= TOTAL_T - CHARGE_T) { this.state = 'idle'; }
      } else this.charge = Math.max(0, this.charge - dt * 4);
      this.flare = Math.max(0, this.flare - dt * 2.2);
      this.vent = Math.max(0, this.vent - dt * 0.85);
    }
    const c = this.charge, cc = c * c, fx = g.__bfgFx;
    // screen aberration + edge glow build with the charge
    if (c > 0) { this.setChroma(Math.max(g.fx?.chroma ?? 0, CHROMA + cc * 0.0040)); this.chromaOn = true; } else if (this.chromaOn) { this.chromaOn = false; }
    if (fx) { fx.glow = this.state === 'charge' || (dbg && dbg.charge !== undefined) ? Math.min(0.62, cc * 0.7 + c * 0.1) : 0; fx.update(); }
    // glow levels
    const idle = 0.9 + 0.25 * Math.sin(t * 3.1), glow = idle + c * 3.5 + this.flare * 3;
    this.coreMat.color.setRGB(0.6, 2.4, 0.8).multiplyScalar(0.6 + glow * 0.55);
    this.ringMat.color.setRGB(0.3, 1.8, 0.5).multiplyScalar(0.5 + glow * 0.6);
    this.accentMat.color.setRGB(0.25, 1.5, 0.4).multiplyScalar(0.55 + c * 1.6 + this.flare * 1.1 + this.vent * 0.8 + 0.12 * Math.sin(t * 5));
    this.ventMat.color.setRGB(0.2, 1.3, 0.35).multiplyScalar(0.5 + c * 2.4 + this.flare * 1.5 + this.vent * 1.2 + 0.2 * Math.sin(t * 6));
    this.liquidMat.color.setRGB(0.22, 0.75, 0.28).multiplyScalar(0.7 + c * 1.8 + this.flare * 0.9 + 0.12 * Math.sin(t * 2 + 1));
    this.liquidTex.offset.x = (this.liquidTex.offset.x + dt * (0.12 + c * 1.2 + this.flare * 0.5)) % 1;
    const cs = 0.85 + c * 0.95 + this.flare * 0.5 + 0.06 * Math.sin(t * 9);
    this.core.scale.setScalar(cs); this.white.scale.setScalar(cs * (0.8 + 0.3 * Math.sin(t * 13 + 1)) * (1 + c));
    this.shell.scale.setScalar(0.9 + c * 0.9 + this.flare * 0.5); this.shellMat.opacity = 0.35 + c * 0.5 + this.flare * 0.3; this.shellMat.map.offset.x = (this.shellMat.map.offset.x + dt * (0.15 + c * 1.2)) % 1; this.shell.rotation.y += dt * (0.8 + c * 6);
    this.coreGlow.scale.setScalar(0.24 + c * 0.44 + this.flare * 0.32 + 0.02 * Math.sin(t * 7)); this.coreGlow.material.opacity = 0.55 + c * 0.4;
    const sp0 = 1.5 + 16 * c + this.flare * 6, sp1 = 1.2 + 14 * c + this.flare * 5, sp2 = 0.9 + 12 * c;
    this.rings[0].rotation.x += dt * sp0; this.rings[0].rotation.y += dt * sp0 * 0.55; this.rings[1].rotation.z -= dt * sp1; this.rings[1].rotation.x += dt * sp1 * 0.5; this.rings[2].rotation.y += dt * sp2; this.rings[2].rotation.z += dt * sp2 * 0.7;
    // crackling arcs: core -> cage ribs (and rib -> rib) while charging, a burst out of the dish at launch
    const arcAmt = this.state === 'charge' || (dbg && dbg.charge !== undefined) ? c : this.flare * 0.9;
    if (arcAmt > 0.08) {
      const nOn = Math.round(3 + arcAmt * 9);
      for (let i = 0; i < 12; i++) {
        if (i < nOn && Math.random() < 0.35 + 0.6 * arcAmt) {
          const a = rand(0, 6.283), R = rand(0.09, 0.122), zc = rand(-0.5, -0.34);
          if (i % 3 === 2) { const a2 = a + rand(-0.9, 0.9); this.arcs.set(i, Math.cos(a) * R, Y0 + Math.sin(a) * R, zc, Math.cos(a2) * R, Y0 + Math.sin(a2) * R, zc + rand(-0.06, 0.06), 0.014, 0.0035 * (0.6 + arcAmt)); }
          else this.arcs.set(i, 0, Y0, CORE_Z, Math.cos(a) * R, Y0 + Math.sin(a) * R, zc, 0.022 * (0.6 + arcAmt), 0.0035 * (0.6 + arcAmt));
        } else this.arcs.hide(i);
      }
      this.arcs.flush();
    } else this.arcs.hideAll();
    // green light washing over the gun and hands while charging / at the flare
    if (!dbg) { const L = g.__kitA?.light; if (L && (c > 0.02 || this.flare > 0.02)) { flashPulse(g, this.core, (c * 1.4 + this.flare * 2.4) * (0.85 + 0.15 * Math.sin(t * 45)), 0x50ff60); } else flashDecay(g, dt); }
    // trigger + hands + pose: pulled in and shuddering during the charge
    const tg = this.state === 'charge' ? 1 : 0; this.trig += (tg - this.trig) * Math.min(1, dt * 30);
    this.trigger.rotation.x = -this.trig * 0.25; this.trigger.position.z = 0.012 + this.trig * 0.004;
    const idx = this.idxF; if (idx) { idx.joints[0].rotation.x = -(0.55 + this.trig * 0.22); idx.joints[1].rotation.x = -(0.65 + this.trig * 0.5); }
    const vc = g.viewCamera; this.handR.pointArm(vc, 0.30, -0.80, 0.55); this.handL.pointArm(vc, -0.52, -0.80, 0.30);
    const j = 0.0022 * cc + 0.0006 * c;
    this.model.position.set(Math.cos(t * 1.1) * 0.0008 + (Math.random() - 0.5) * 2 * j, Math.sin(t * 1.7) * 0.001 + (Math.random() - 0.5) * 2 * j, 0.02 * c + (Math.random() - 0.5) * 2 * j);
    this.model.rotation.set(-(1 - this.raise) * 0.4 + Math.sin(t * 1.3) * 0.002 + this.viewPitch, this.viewYaw, -(1 - this.raise) * 0.12 + (Math.random() - 0.5) * 0.02 * cc);
    // venting: steam bursts from the fins, the side louvres and the dish after release
    if ((this.vent > 0.08) && (this.steamT -= dt) <= 0) {
      this.steamT = 0.035 + (1 - this.vent) * 0.06;
      this.steam.emit(rand(-0.04, 0.04), 0.135, rand(-0.02, 0.10), rand(-0.03, 0.03), rand(0.12, 0.26), rand(0.02, 0.1), rand(0.8, 1.2), 0.04, rand(0.16, 0.28), 0.32 * this.vent, rand(-1, 1));
      if (Math.random() < 0.6) this.steam.emit(rand(-1, 1) < 0 ? -0.09 : 0.09, 0.02, rand(0.0, 0.16), rand(-0.1, 0.1) + 0.0, rand(0.05, 0.16), rand(0.05, 0.2), rand(0.7, 1.0), 0.04, rand(0.14, 0.24), 0.26 * this.vent, rand(-1, 1));
    }
    // ammo LCD
    const n = g.weapons.ammo.cells, cb = Math.round(c * 8), key = n * 10 + cb;
    if (key !== this.ammoKey) { this.ammoKey = key; this.lcd.set(key, n, cb / 8); }
    if (!dbg) this.flash.update(dt);
    this.steam.update(dt); this.sparks.update(dt);
  }
}
