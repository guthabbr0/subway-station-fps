// BFG 9000: 40 cells, 20-tic charge, slow 27 m/s green ball, detonation = splash + 40-ray spray of green beams
// fanned +-45deg around the player's view yaw (auto-aim at the first visible enemy per ray).
import * as THREE from 'three';
import { Weapon } from './base.js';
import { TIC, bus, clamp, rand, randInt } from '../core.js';
import * as K from './kitb.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _v = new THREE.Vector3(), _u = new THREE.Vector3();
const _f = new THREE.Vector3(), _org = new THREE.Vector3(), _dir = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, -1), UP = new THREE.Vector3(0, 1, 0);
const CHROMA = 0.0006;
const CHARGE_T = 20 * TIC, TOTAL_T = 60 * TIC;

// ---------------------------------------------------------------------------------------------------------------
// In-flight BFG ball (template cloned + pooled)
// ---------------------------------------------------------------------------------------------------------------
let BALL = null; const freeBalls = [];
function ballTemplate() {
  if (BALL) return BALL;
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.25, 0.3), toneMapped: false, fog: false })); core.name = 'core';
  const white = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 1.6, 0.9), toneMapped: false, fog: false })); white.name = 'white';
  const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 1.2, 0.22), wireframe: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })); cage.name = 'cage';
  const cage2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.58, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.9, 0.2), wireframe: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })); cage2.name = 'cage2';
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(0.1, 1.0, 0.18), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.7 })); halo.name = 'halo';
  const halo2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(0.05, 0.7, 0.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.35 })); halo2.name = 'halo2';
  // orbiting sparkles (one Points object)
  const N = 34, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const r = 0.5 + Math.random() * 0.7, a = Math.random() * 6.283, b = Math.acos(2 * Math.random() - 1); pos[i * 3] = Math.sin(b) * Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(b) * Math.sin(a) * r; pos[i * 3 + 2] = Math.cos(b) * r; }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sparks = new THREE.Points(pg, new THREE.PointsMaterial({ map: K.sparkTexture(), size: 0.3, color: new THREE.Color(0.3, 1.5, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false, toneMapped: false })); sparks.name = 'sparks';
  g.add(core, white, cage, cage2, halo, halo2, sparks); for (const c of g.children) c.frustumCulled = false;
  BALL = g; return g;
}
function getBall() {
  const m = freeBalls.pop() || ballTemplate().clone();
  const u = m.userData; for (const n of ['core', 'white', 'cage', 'cage2', 'halo', 'halo2', 'sparks']) u[n] = m.getObjectByName(n);
  return m;
}

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
    // rays that find nothing still crackle out into the room (decoration, every 5th ray)
    if (i % 5 === 2) {
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
  if (!events.length) return;
  const run = (ev) => {
    if (ev.done) return; ev.done = true;
    if (ev.fixed) { G.vfx.bfgBeam(ev.from, ev.to); return; }
    const en = ev.enemy;
    ev.to.set(en.pos.x, en.pos.y + en.height * (0.62 + ev.dy * 0.6), en.pos.z);
    G.vfx.bfgBeam(ev.from, ev.to);
    if (en.alive) {
      _u.copy(ev.to).sub(ev.from).normalize();
      G.enemies.damage(en, ev.dmg, { point: ev.to.clone(), dir: _u.clone(), type: 'bfg', source: 'player', part: 'torso', knock: 5 });
    }
  };
  G.projectiles.spawn({
    pos: ballPos, dir: UP, speed: 0, life: 0.25, owner: 'player', data: { events },
    onUpdate: (p) => { for (const ev of events) if (!ev.done && p.age >= ev.t) run(ev); },
    onExpire: () => { for (const ev of events) run(ev); },
  });
}

export default class BFG9000 extends Weapon {
  constructor(game) {
    super(game, { id: 'bfg', name: 'BFG 9000', slot: 7, ammoType: 'cells', ammoPerShot: 40, raiseTime: 0.46, lowerTime: 0.3 });
    this.rest.set(0.18, -0.09, -0.72);
    this.state = 'idle'; this.st = 99; this.charge = 0; this.flare = 0; this.chromaOn = false; this.emptyT = 0; this.steamT = 0; this.ammoKey = '';
    const G = game;
    this.cbHit = (p, hit) => this.detonate(p, hit.point, hit.normal, hit.kind === 'enemy' ? hit.enemy : null);
    this.cbExpire = (p) => this.detonate(p, p.pos, null, null);
    this.cbUpdate = (p, dt) => {
      const d = p.data, m = p.mesh, u = m.userData, t = p.age;
      const grow = clamp(0.25 + t * 1.6, 0.25, 1);
      m.rotation.x += dt * 2.1; m.rotation.y += dt * 1.6;
      u.cage.rotation.x -= dt * 3.4; u.cage.rotation.z += dt * 2.6; u.cage2.rotation.y += dt * 4.2; u.cage2.rotation.x -= dt * 1.7;
      u.sparks.rotation.y += dt * 3.2; u.sparks.rotation.z -= dt * 2.3;
      const pulse = 1 + 0.12 * Math.sin(t * 22) + (Math.random() - 0.5) * 0.12;
      u.core.scale.setScalar(pulse * grow); u.white.scale.setScalar((1 + 0.2 * Math.random()) * grow);
      u.cage.scale.setScalar(grow); u.cage2.scale.setScalar(grow * (0.95 + 0.1 * Math.random()));
      u.halo.scale.setScalar((1.9 + Math.random() * 0.3) * grow); u.halo2.scale.setScalar((3.6 + Math.random() * 0.5) * grow);
      if ((d.tt -= dt) <= 0) { d.tt = 0.03; G.vfx.trail(p.pos, 'bfg'); }
      if ((d.lt -= dt) <= 0) { d.lt = 0.16; G.vfx.light(p.pos, 0x50ff48, 5, 0.24, 18); }
    };
  }

  detonate(p, point, normal, enemy) {
    const G = this.game;
    _e.copy(point); if (normal) _e.addScaledVector(normal, 0.3);
    const pos = _e.clone();
    if (p.mesh) freeBalls.push(p.mesh);
    if (enemy && enemy.alive) G.enemies.damage(enemy, 100 * randInt(1, 8), { point: point.clone(), dir: p.dir.clone(), type: 'bfg', source: 'player', part: 'torso', dist: p.age * p.speed });
    G.vfx.bfgExplosion(pos);
    G.audio.play('bfgHit', pos);
    G.combat.explosion(pos, 6, 100, { owner: 'player', kind: 'bfg', fx: false });
    G.hud?.flash?.('#7dff6a', 0.6, 0.5);
    G.player.shake?.(1.2);
    bfgSpray(G, pos);
  }

  buildModel() {
    const g = this.game, M = K.getMats(g), root = new THREE.Group();
    const paint = K.paintMat(g, '#62735a', 71, { metalness: 0.5, roughness: 0.55 }), paintDark = K.paintMat(g, '#34403a', 72, { metalness: 0.5, roughness: 0.55 });
    const glass = K.glassMat(g, 0x88ffa0, 0.25);
    this.coreMat = K.glowBasic(0.6, 2.4, 0.8); this.ringMat = K.glowBasic(0.3, 1.8, 0.5); this.tankMat = K.glowBasic(0.2, 1.4, 0.4, { transparent: true, opacity: 0.92 });
    this.accentMat = K.glowBasic(0.25, 1.5, 0.4); this.ventMat = K.glowBasic(0.2, 1.3, 0.35);
    const b = new K.Builder();
    // ---- main body -----------------------------------------------------------------------------------------------
    b.box(paint, 0.14, 0.12, 0.28, 0, 0, 0.0);
    b.box(paintDark, 0.1, 0.045, 0.2, 0, 0.082, -0.02);
    b.box(paintDark, 0.11, 0.05, 0.2, 0, -0.085, -0.04);
    b.box(paintDark, 0.11, 0.09, 0.05, 0, 0.0, 0.155);
    for (let i = 0; i < 4; i++) b.box(M.steel, 0.112, 0.006, 0.052, 0, -0.03 + i * 0.02, 0.155);
    b.box(M.darkSteel, 0.146, 0.03, 0.06, 0, 0.045, -0.13); b.box(M.darkSteel, 0.146, 0.03, 0.06, 0, -0.045, -0.13);
    for (let i = 0; i < 8; i++) b.box(M.steel, 0.092, 0.024, 0.005, 0, 0.112, -0.115 + i * 0.022);              // top heat-sink fins
    for (const sx of [-1, 1]) for (const z of [-0.08, 0.1]) for (const y of [-0.035, 0.035]) b.cylX(M.steel, 0.0045, 0.005, sx * 0.0705, y, z, 8);
    b.box(M.darkSteel, 0.016, 0.03, 0.05, 0, 0.09, 0.09);
    // ---- emitter housing + cage -----------------------------------------------------------------------------------
    b.cylZ(M.darkSteel, 0.08, 0.086, 0.06, 0, 0, -0.18, 24);
    b.cylZ(M.steel, 0.088, 0.088, 0.012, 0, 0, -0.215, 24);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      _v.set(Math.cos(a) * 0.066, Math.sin(a) * 0.066, -0.22); _u.set(Math.cos(a) * 0.118, Math.sin(a) * 0.118, -0.5); b.limb(M.darkSteel, 0.0085, _v, _u, 6);
    }
    for (const [z, R] of [[-0.29, 0.079], [-0.37, 0.093], [-0.44, 0.107], [-0.5, 0.118]]) b.tor(M.steel, R, 0.0085, 0, 0, z, 0, 0, 0, 28, 6);
    // ---- tanks (left/right) ------------------------------------------------------------------------------------------
    for (const sx of [-1, 1]) {
      const x = sx * 0.128;
      b.cylZ(M.darkSteel, 0.034, 0.034, 0.014, x, 0.0, -0.115, 16); b.cylZ(M.darkSteel, 0.034, 0.034, 0.014, x, 0.0, 0.085, 16);
      for (const z of [-0.075, -0.015, 0.045]) b.tor(M.steel, 0.032, 0.0045, x, 0.0, z, 0, 0, 0, 18, 5);
      b.cylX(M.darkSteel, 0.011, 0.06, sx * 0.1, 0.0, -0.05, 8); b.cylX(M.darkSteel, 0.011, 0.06, sx * 0.1, 0.0, 0.03, 8);
    }
    // ---- grips ---------------------------------------------------------------------------------------------------
    b.box(M.rubber, 0.044, 0.13, 0.055, 0, -0.17, 0.085, -0.25, 0, 0);
    b.box(M.darkSteel, 0.06, 0.03, 0.09, 0, -0.118, 0.065);
    b.box(M.darkSteel, 0.006, 0.006, 0.06, 0, -0.13, 0.0); b.box(M.darkSteel, 0.006, 0.038, 0.006, 0, -0.112, -0.03);
    b.box(M.steel, 0.006, 0.02, 0.008, 0, -0.112, 0.03, 0.3, 0, 0);
    b.box(M.darkSteel, 0.05, 0.03, 0.07, 0, -0.125, -0.13);
    b.cyl(M.rubber, 0.021, 0.02, 0.1, 0, -0.19, -0.13, 0, 0, 0, 12);
    b.cyl(M.darkSteel, 0.023, 0.023, 0.008, 0, -0.243, -0.13, 0, 0, 0, 12);
    // hazard band on the housing
    b.cylZ(M.hazard, 0.0865, 0.0865, 0.02, 0, 0, -0.16, 24);
    b.build(root);
    // ---- glowing hardware ------------------------------------------------------------------------------------------
    const tb = new K.Builder(), ab = new K.Builder(), vb = new K.Builder();
    for (const sx of [-1, 1]) tb.cylZ(this.tankMat, 0.022, 0.022, 0.185, sx * 0.128, 0.0, -0.015, 14);
    ab.box(this.accentMat, 0.002, 0.005, 0.22, -0.0708, -0.038, -0.02); ab.box(this.accentMat, 0.002, 0.005, 0.22, -0.0708, 0.05, -0.02);
    ab.box(this.accentMat, 0.002, 0.005, 0.22, 0.0708, -0.038, -0.02);
    for (let i = 0; i < 8; i++) vb.box(this.ventMat, 0.004, 0.024, 0.008, -0.0555, -0.085, -0.13 + i * 0.022);
    for (let i = 0; i < 8; i++) vb.box(this.ventMat, 0.004, 0.024, 0.008, 0.0555, -0.085, -0.13 + i * 0.022);
    tb.build(root); ab.build(root); vb.build(root);
    // core + orbiting rings inside the cage
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.042, 18, 12), this.coreMat); this.core.position.z = -0.365; root.add(this.core);
    this.rings = [0, 1].map((i) => { const m = new THREE.Mesh(new THREE.TorusGeometry(0.062 + i * 0.012, 0.0036, 6, 28), this.ringMat); m.position.z = -0.365; m.rotation.set(i * 1.2, 0.3 * i, 0); root.add(m); return m; });
    this.coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(0.25, 1.6, 0.35), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.8 }));
    this.coreGlow.position.z = -0.365; this.coreGlow.scale.setScalar(0.25); root.add(this.coreGlow);
    // charge lightning: crossed streak planes around the core, re-randomised each frame while charging
    const bmat = new THREE.MeshBasicMaterial({ map: K.streakTexture(), color: new THREE.Color(0.5, 2.6, 0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    const bgeo = new THREE.PlaneGeometry(0.02, 0.22).translate(0, 0.11, 0);
    this.bolts = new THREE.Group(); this.bolts.position.z = -0.365;
    for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(bgeo, bmat); m.frustumCulled = false; this.bolts.add(m); }
    this.bolts.visible = false; root.add(this.bolts);
    // LCD
    this.lcd = new K.LCD(128, 64, (ctx, w, h, key, n, c) => {
      ctx.fillStyle = '#020a03'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#4dff6a'; ctx.font = 'bold 18px monospace'; ctx.fillText(c > 0 ? 'CHARGING' : 'CELLS', 8, 20);
      ctx.font = 'bold 34px monospace'; ctx.fillText(String(n).padStart(3, '0'), 8, 54);
      ctx.strokeStyle = 'rgba(77,255,106,0.6)'; ctx.strokeRect(2, 2, w - 4, h - 4); ctx.fillStyle = 'rgba(77,255,106,0.85)'; ctx.fillRect(74, 36, 46 * c, 16); ctx.strokeRect(74, 36, 46, 16);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    });
    const lb = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.044, 0.084), M.black); lb.position.set(-0.0735, 0.028, 0.085); root.add(lb);
    const lp = new THREE.Mesh(new THREE.PlaneGeometry(0.076, 0.038), this.lcd.mat); lp.rotation.y = -Math.PI / 2; lp.position.set(-0.0778, 0.028, 0.085); root.add(lp);
    const st = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.04), new THREE.MeshStandardMaterial({ map: K.stencilTexture(['BFG 9000'], { w: 384, h: 96, size: 60, color: '#c8ffb0' }), transparent: true, roughness: 0.8, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    st.rotation.y = -Math.PI / 2; st.position.set(-0.0708, 0.02, -0.06); root.add(st);

    // ---- muzzle / flash -------------------------------------------------------------------------------------------
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0, -0.52); root.add(this.muzzle);
    this.flash = g.vfx.createFlash('bfg'); this.muzzle.add(this.flash.object3d);
    // ---- hands ----------------------------------------------------------------------------------------------------
    const rh = K.buildHand(M, { R: 0.022, trigger: true }); K.poseHand(rh, new THREE.Vector3(0.008, -0.17, 0.085), _v.set(0.5, -0.36, 0.8), _u.set(0, -0.96, 0.27), false); root.add(rh);
    const lh = K.buildHand(M, { R: 0.02 }); K.poseHand(lh, new THREE.Vector3(0, -0.19, -0.13), _v.set(-0.42, -0.42, 0.8), _u.set(0, 1, 0), true); root.add(lh);
    this.hands = [rh, lh];
    this.steam = new K.Puffs(this.root, 14, K.smokeTexture(), { color: 0xc8ffd0, drag: 1.8 });
    this.sparks = new K.Puffs(this.root, 8, K.sparkTexture(), { additive: true, color: new THREE.Color(0.6, 2.2, 0.8), drag: 3 });
    return root;
  }

  init() { super.init(); this.root.rotation.y = 0.28; }

  setChroma(v) { const fx = this.game.fx; if (fx) fx.chroma = v; }
  onSelect() { this.steam.clear(); this.sparks.clear(); this.state = 'idle'; this.st = 99; this.charge = 0; this.emptyT = 0; this.setChroma(CHROMA); }
  onDeselect() { this.setChroma(CHROMA); }
  canSwitch() { return this.state === 'idle' || (this.state === 'recover' && this.st > 0.3); }

  think(dt, ctx) {
    if (this.state !== 'idle' || !ctx.fire || this.cool > 0) return;
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
    this.state = 'recover'; this.st = 0; this.flare = 1;
    this.muzzleWorld(_o);
    const eye = g.player.eye; if (!K.clearPath(g, eye, _o)) _o.copy(eye);
    K.aimDir(g, _o, _d);
    if (_o.equals(eye)) _o.addScaledVector(_d, 0.3);
    const mesh = getBall(); mesh.quaternion.identity(); mesh.scale.setScalar(1.35);
    g.projectiles.spawn({ mesh, pos: _o, dir: _d, speed: 27, radius: 0.35, life: 6, owner: 'player', onHit: this.cbHit, onUpdate: this.cbUpdate, onExpire: this.cbExpire, data: { tt: 0, lt: 0.05 } });
    g.audio.play('bfgFire');
    this.flash.object3d.rotation.z = rand(0, 6.28); this.flash.fire(1.6);
    this.muzzleWorld(_o); g.vfx.light(_o, 0x5cff50, 4.5, 0.3, 18);
    this.kickBack(0.13, 0.13, 0.06, 0.02);
    g.player.shake?.(0.7);
    g.hud?.flash?.('#7dff6a', 0.32, 0.22);
    for (let i = 0; i < 6; i++) this.sparks.emit(rand(-0.05, 0.05), rand(-0.05, 0.05), -0.5, rand(-0.6, 0.6), rand(-0.6, 0.6), rand(-1.2, -0.3), rand(0.25, 0.5), 0.05, rand(0.1, 0.2), 0.9);
    for (let i = 0; i < 5; i++) this.steam.emit(rand(-0.04, 0.04), rand(-0.03, 0.06), -0.4, rand(-0.2, 0.2), rand(-0.05, 0.25), rand(-0.9, -0.2), rand(0.7, 1.1), 0.08, rand(0.3, 0.5), 0.45, rand(-1, 1));
    bus.emit('weapon:fire', { id: 'bfg' });
    if (!this.hasAmmo()) g.weapons.autoSwitch();
  }

  animate(dt, ctx) {
    const g = this.game, t = this.time;
    this.emptyT = Math.max(0, this.emptyT - dt);
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
    const c = this.charge, cc = c * c;
    // screen aberration builds with the charge
    if (c > 0) { this.setChroma(CHROMA + cc * 0.0045); this.chromaOn = true; } else if (this.chromaOn) { this.setChroma(CHROMA); this.chromaOn = false; }
    // core/cage animation
    const idle = 0.9 + 0.25 * Math.sin(t * 3.1);
    const glow = idle + c * 3.5 + this.flare * 3;
    this.coreMat.color.setRGB(0.6, 2.4, 0.8).multiplyScalar(0.6 + glow * 0.55);
    this.ringMat.color.setRGB(0.3, 1.8, 0.5).multiplyScalar(0.5 + glow * 0.6);
    this.tankMat.color.setRGB(0.2, 1.4, 0.4).multiplyScalar(0.55 + 0.25 * Math.sin(t * 2 + 1) + c * 2.2 + this.flare * 2);
    this.accentMat.color.setRGB(0.25, 1.5, 0.4).multiplyScalar(0.6 + c * 1.6 + this.flare);
    this.ventMat.color.setRGB(0.2, 1.3, 0.35).multiplyScalar(0.5 + c * 2.4 + this.flare * 1.5 + 0.2 * Math.sin(t * 6));
    const cs = 0.85 + c * 0.9 + this.flare * 0.5 + 0.06 * Math.sin(t * 9);
    this.core.scale.setScalar(cs);
    this.coreGlow.scale.setScalar(0.22 + c * 0.42 + this.flare * 0.3 + 0.02 * Math.sin(t * 7)); this.coreGlow.material.opacity = 0.55 + c * 0.4;
    this.rings[0].rotation.x += dt * (1.5 + 16 * c); this.rings[0].rotation.y += dt * (0.8 + 9 * c);
    this.rings[1].rotation.z -= dt * (1.2 + 14 * c); this.rings[1].rotation.x += dt * (0.5 + 7 * c);
    // lightning
    const showBolts = this.state === 'charge' && c > 0.12;
    this.bolts.visible = showBolts;
    if (showBolts) {
      for (const m of this.bolts.children) {
        m.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)); const s = rand(0.3, 1.0) * (0.4 + c); m.scale.set(1, s, 1); m.visible = Math.random() < 0.45 + 0.5 * c;
      }
    }
    // viewmodel: shudder + pull-in during the charge
    const j = 0.0022 * cc + 0.0006 * c;
    this.model.position.set(Math.cos(t * 1.1) * 0.0008 + (Math.random() - 0.5) * 2 * j, Math.sin(t * 1.7) * 0.001 + (Math.random() - 0.5) * 2 * j, 0.02 * c + (Math.random() - 0.5) * 2 * j);
    this.model.rotation.z = (Math.random() - 0.5) * 0.02 * cc;
    // steam from the heat fins after a shot
    if (this.state === 'recover' && this.st < 1.0 && (this.steamT -= dt) <= 0) {
      this.steamT = 0.05;
      this.steam.emit(rand(-0.04, 0.04), 0.125, rand(-0.11, 0.05), rand(-0.03, 0.03), rand(0.1, 0.2), rand(0.02, 0.1), rand(0.8, 1.2), 0.04, rand(0.15, 0.26), 0.28, rand(-1, 1));
    }
    // ammo LCD
    const n = g.weapons.ammo.cells, cb = Math.round(c * 8); const key = n + '|' + cb;
    if (key !== this.ammoKey) { this.ammoKey = key; this.lcd.set(key, n, cb / 8); }
    this.flash.update(dt); this.steam.update(dt); this.sparks.update(dt);
  }
}
