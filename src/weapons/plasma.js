// Plasma rifle: 1 cell / 3 tics (~11.7/s) while held, 20-tic cooldown after release, 5*(1d8) dmg, bolts 27 m/s.
import * as THREE from 'three';
import { Weapon } from './base.js';
import { TIC, bus, clamp, rand, randInt } from '../core.js';
import * as K from './kitb.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _u = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, -1);
const NCOIL = 5;
const COOL = new THREE.Color(0.12, 0.5, 1.5), HOT = new THREE.Color(2.0, 0.75, 0.2), _c = new THREE.Color();

// ---------------------------------------------------------------------------------------------------------------
// World plasma bolt (template cloned + pooled)
// ---------------------------------------------------------------------------------------------------------------
let BOLT = null; const freeBolts = [];
function boltTemplate() {
  if (BOLT) return BOLT;
  const g = new THREE.Group();
  const streakMat = new THREE.MeshBasicMaterial({ map: K.streakTexture(), color: new THREE.Color(0.35, 0.85, 2.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false });
  const geo = new THREE.PlaneGeometry(0.12, 1.5).rotateX(-Math.PI / 2).translate(0, 0, 0.75);
  const s1 = new THREE.Mesh(geo, streakMat), s2 = new THREE.Mesh(geo, streakMat); s2.rotation.z = Math.PI / 2;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(0.25, 0.6, 2.0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.85 })); halo.scale.setScalar(0.75);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(1.8, 2.4, 3.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); core.scale.setScalar(0.3);
  halo.name = 'halo'; core.name = 'core';
  g.add(s1, s2, halo, core); for (const c of g.children) c.frustumCulled = false;
  BOLT = g; return g;
}
function getBolt() { const m = freeBolts.pop() || boltTemplate().clone(); m.userData.halo = m.getObjectByName('halo'); return m; }

export default class PlasmaRifle extends Weapon {
  constructor(game) {
    super(game, { id: 'plasma', name: 'PLASMA RIFLE', slot: 6, ammoType: 'cells', ammoPerShot: 1, raiseTime: 0.34, lowerTime: 0.24 });
    this.rest.set(0.18, -0.115, -0.63);
    this.chain = false; this.nextShot = 0; this.emptyT = 0; this.heat = 0; this.pulse = 0; this.pulseT = 0; this.steamT = 0; this.cooling = 0; this.ammoShown = -1; this.shots = 0;
    const G = game;
    this.cbHit = (p, hit) => {
      if (hit.kind === 'enemy') G.enemies.damage(hit.enemy, 5 * randInt(1, 8), { point: hit.point.clone(), dir: p.dir.clone(), type: 'plasma', source: 'player', part: hit.part, dist: p.age * p.speed });
      _v.copy(hit.point); if (hit.normal) _v.addScaledVector(hit.normal, 0.05);
      G.vfx.plasmaImpact(_v.clone(), hit.normal ? hit.normal.clone() : p.dir.clone().negate());
      G.audio.play('plasmaHit', hit.point);
      if (p.mesh) freeBolts.push(p.mesh);
    };
    this.cbExpire = (p) => { if (p.mesh) freeBolts.push(p.mesh); };
    this.cbUpdate = (p, dt) => {
      const d = p.data;
      p.mesh.userData.halo.scale.setScalar(0.62 + Math.random() * 0.25);
      if ((d.tt -= dt) <= 0) { d.tt = 0.04; G.vfx.trail(p.pos, 'plasma'); }
    };
  }

  buildModel() {
    const g = this.game, M = K.getMats(g), root = new THREE.Group();
    const paint = K.paintMat(g, '#56657d', 61, { metalness: 0.55, roughness: 0.45 }), paintDark = K.paintMat(g, '#2b3242', 62, { metalness: 0.55, roughness: 0.45 });
    const glass = K.glassMat(g, 0x88ccff, 0.28);
    // per-weapon animated materials
    this.coilMats = []; for (let i = 0; i < NCOIL; i++) this.coilMats.push(new THREE.MeshStandardMaterial({ color: 0x0a1a2a, emissive: COOL.clone(), emissiveIntensity: 1, metalness: 0.6, roughness: 0.3, envMap: M.env }));
    this.ventMat = K.glowBasic(0.12, 0.5, 1.5); this.ventMat.color.copy(COOL);
    this.accentMat = K.glowBasic(0.12, 0.6, 1.8);
    this.cellMat = K.glowBasic(0.3, 1.2, 2.6, { transparent: true, opacity: 0.9 });
    this.tipMat = K.glowBasic(1.0, 2.0, 3.0);

    const b = new K.Builder();
    // ---- main body ---------------------------------------------------------------------------------------------
    b.box(paint, 0.082, 0.09, 0.3, 0, 0, 0.0);
    b.box(M.steel, 0.07, 0.014, 0.26, 0, 0.052, -0.01);
    b.box(paintDark, 0.07, 0.034, 0.22, 0, -0.06, -0.04);
    b.box(paintDark, 0.062, 0.078, 0.05, 0, 0.004, 0.16);
    b.box(M.darkSteel, 0.088, 0.02, 0.05, 0, 0.036, -0.155); b.box(M.darkSteel, 0.088, 0.02, 0.05, 0, -0.036, -0.155);
    for (let i = 0; i < 6; i++) b.box(M.darkSteel, 0.06, 0.016, 0.004, 0, 0.066, 0.085 + i * 0.0105);                 // heat-sink fins (rear top)
    for (const sx of [-1, 1]) for (const z of [-0.12, 0.13]) for (const y of [-0.028, 0.028]) b.cylX(M.steel, 0.0038, 0.004, sx * 0.0425, y, z, 8);
    // ---- emitter ------------------------------------------------------------------------------------------------
    b.cylZ(M.darkSteel, 0.034, 0.038, 0.06, 0, 0, -0.205, 18);
    b.cylZ(M.steel, 0.0135, 0.016, 0.36, 0, 0, -0.38, 14);
    b.cylZ(M.darkSteel, 0.038, 0.032, 0.03, 0, 0, -0.56, 18);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; _v.set(Math.cos(a) * 0.06, Math.sin(a) * 0.06, -0.2); _u.set(Math.cos(a) * 0.042, Math.sin(a) * 0.042, -0.545); b.limb(M.steel, 0.0042, _v, _u, 6); }
    for (const z of [-0.23, -0.395, -0.53]) b.cylZ(M.darkSteel, 0.02, 0.02, 0.012, 0, 0, z, 12);
    // ---- energy-cell cradle (top) --------------------------------------------------------------------------------
    b.cylZ(M.darkSteel, 0.032, 0.032, 0.014, 0, 0.098, -0.115, 16); b.cylZ(M.darkSteel, 0.032, 0.032, 0.014, 0, 0.098, 0.055, 16);
    b.box(M.darkSteel, 0.024, 0.044, 0.014, 0, 0.076, -0.06); b.box(M.darkSteel, 0.024, 0.044, 0.014, 0, 0.076, 0.0);
    // ---- grips ---------------------------------------------------------------------------------------------------
    b.box(M.rubber, 0.04, 0.115, 0.05, 0, -0.125, 0.07, -0.25, 0, 0);
    b.box(M.darkSteel, 0.05, 0.02, 0.07, 0, -0.085, 0.05);
    b.box(M.darkSteel, 0.006, 0.006, 0.05, 0, -0.088, 0.0); b.box(M.darkSteel, 0.006, 0.034, 0.006, 0, -0.072, -0.024);
    b.box(M.steel, 0.006, 0.02, 0.008, 0, -0.072, 0.03, 0.3, 0, 0);
    b.box(M.darkSteel, 0.034, 0.03, 0.06, 0, -0.088, -0.12);
    b.cyl(M.rubber, 0.0185, 0.0175, 0.095, 0, -0.152, -0.12, 0, 0, 0, 12);
    b.cyl(M.darkSteel, 0.02, 0.02, 0.008, 0, -0.203, -0.12, 0, 0, 0, 12);
    b.build(root);
    // ---- glowing parts -------------------------------------------------------------------------------------------
    const rings = [[-0.25, 0.05], [-0.31, 0.046], [-0.37, 0.042], [-0.43, 0.038], [-0.49, 0.034]];
    this.coils = rings.map(([z, R], i) => { const m = new THREE.Mesh(new THREE.TorusGeometry(R, 0.0088, 8, 28), this.coilMats[i]); m.position.z = z; m.frustumCulled = false; root.add(m); return m; });
    const vb = new K.Builder(), ab = new K.Builder();
    for (let i = 0; i < 6; i++) vb.box(this.ventMat, 0.003, 0.02, 0.011, -0.0425, 0.0, -0.1 + i * 0.028);
    for (let i = 0; i < 6; i++) vb.box(this.ventMat, 0.003, 0.02, 0.011, 0.0425, 0.0, -0.1 + i * 0.028);
    ab.box(this.accentMat, 0.002, 0.004, 0.26, -0.0432, 0.034, -0.02); ab.box(this.accentMat, 0.002, 0.004, 0.26, -0.0432, -0.034, -0.02);
    ab.box(this.accentMat, 0.05, 0.003, 0.003, 0, 0.0605, -0.128);
    vb.build(root); ab.build(root);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.013, 12, 8), this.tipMat); tip.position.z = -0.578; root.add(tip); this.tip = tip;
    // cell canister
    const glassM = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.155, 20, 1, true).rotateX(Math.PI / 2), glass); glassM.position.set(0, 0.098, -0.03); glassM.renderOrder = 4; root.add(glassM);
    this.cell = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.15, 14).rotateX(Math.PI / 2), this.cellMat); this.cell.position.set(0, 0.098, -0.03); root.add(this.cell);
    // LCD readout (top rear, angled toward the player) + heat bar
    this.lcd = new K.LCD(128, 64, (ctx, w, h, n) => {
      ctx.fillStyle = '#02080d'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#31d4ff'; ctx.font = 'bold 20px monospace'; ctx.fillText('CELLS', 8, 22);
      ctx.font = 'bold 40px monospace'; ctx.fillText(String(n).padStart(3, '0'), 8, 58); ctx.strokeStyle = 'rgba(49,212,255,0.5)'; ctx.strokeRect(2, 2, w - 4, h - 4);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    });
    const lp = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.025), this.lcd.mat); lp.rotation.y = -Math.PI / 2; lp.position.set(-0.0428, 0.012, 0.112); root.add(lp);
    const lb = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.032, 0.058), M.black); lb.position.set(-0.0415, 0.012, 0.112); root.add(lb);
    const st = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.03), new THREE.MeshStandardMaterial({ map: K.stencilTexture(['PLS-6  PLASMA'], { w: 384, h: 96, size: 44, color: '#bfe8ff' }), transparent: true, roughness: 0.8, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    st.rotation.y = -Math.PI / 2; st.position.set(-0.0428, -0.03, 0.045); root.add(st);

    // ---- muzzle/flash ---------------------------------------------------------------------------------------------
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0, -0.6); root.add(this.muzzle);
    this.flash = g.vfx.createFlash('plasma'); this.muzzle.add(this.flash.object3d);
    // ---- hands ----------------------------------------------------------------------------------------------------
    const rh = K.buildHand(M, { R: 0.02, trigger: true }); K.poseHand(rh, new THREE.Vector3(0.006, -0.125, 0.07), _v.set(0.5, -0.36, 0.8), _u.set(0, -0.96, 0.27), false); root.add(rh);
    const lh = K.buildHand(M, { R: 0.0185 }); K.poseHand(lh, new THREE.Vector3(0, -0.152, -0.12), _v.set(-0.42, -0.42, 0.8), _u.set(0, 1, 0), true); root.add(lh);
    this.hands = [rh, lh];
    this.steam = new K.Puffs(this.root, 14, K.smokeTexture(), { color: 0xcfe6ff, drag: 1.6 });
    this.sparks = new K.Puffs(this.root, 6, K.glowTexture(), { additive: true, color: new THREE.Color(0.4, 0.9, 2.2), drag: 4 });
    return root;
  }

  init() { super.init(); this.root.rotation.y = 0.28; }

  onSelect() { this.chain = false; this.emptyT = 0; this.nextShot = 0; this.steam.clear(); this.sparks.clear(); }

  think(dt, ctx) {
    if (this.time < this.nextShot) return;
    if (ctx.fire) {
      if (!this.hasAmmo()) {
        if (this.emptyT <= 0) { this.game.audio.play('empty'); this.emptyT = 0.45; this.game.weapons.autoSwitch(); }
        this.chain = false; return;
      }
      this.shoot();
    } else if (this.chain) { this.chain = false; this.nextShot = this.time + 20 * TIC; this.cooling = 1; }
  }

  shoot() {
    const g = this.game;
    const iv = 3 * TIC; this.nextShot = (this.time - this.nextShot < iv) ? this.nextShot + iv : this.time + iv;
    this.consume(); this.chain = true; this.shots++;
    this.muzzleWorld(_o);
    const eye = g.player.eye; if (!K.clearPath(g, eye, _o)) _o.copy(eye);
    K.aimDir(g, _o, _d);
    if (_o.equals(eye)) _o.addScaledVector(_d, 0.2);
    const mesh = getBolt(); mesh.quaternion.setFromUnitVectors(FWD, _d);
    g.projectiles.spawn({ mesh, pos: _o, dir: _d, speed: 27, radius: 0.1, life: 3, owner: 'player', onHit: this.cbHit, onUpdate: this.cbUpdate, onExpire: this.cbExpire, data: { tt: 0.02 } });
    g.audio.play('plasma');
    this.flash.object3d.rotation.z = rand(0, 6.28); this.flash.fire(rand(0.9, 1.15));
    this.muzzleWorld(_o); if ((this.shots & 1) === 0) g.vfx.light(_o, 0x5aa8ff, 2.2, 0.07, 10);
    this.kickBack(0.014, 0.02, 0.0026, 0.004);
    g.player.shake?.(0.05);
    this.heat = Math.min(1, this.heat + 0.05); this.pulse = 1; this.pulseT = 0;
    this.sparks.emit(0, 0, -0.6, rand(-0.05, 0.05), rand(-0.05, 0.05), -0.4, 0.09, 0.05, 0.18, 0.9);
    bus.emit('weapon:fire', { id: 'plasma' });
    if (!this.hasAmmo()) g.weapons.autoSwitch();
  }

  animate(dt, ctx) {
    const g = this.game, t = this.time;
    this.emptyT = Math.max(0, this.emptyT - dt);
    const firing = this.chain && this.ready;
    // heat: rises with sustained fire, bleeds off afterwards
    this.heat = firing ? this.heat : Math.max(0, this.heat - dt * (this.cooling > 0 ? 0.55 : 0.9));
    if (this.cooling > 0) this.cooling = this.time < this.nextShot ? this.cooling : Math.max(0, this.cooling - dt * 0.7);
    this.pulseT += dt; this.pulse = Math.max(0, this.pulse - dt * 9);
    const h = this.heat;
    // coil glow: idle shimmer + ripple travelling towards the muzzle at each shot + heat tint
    for (let i = 0; i < NCOIL; i++) {
      const ripple = Math.max(0, 1 - Math.abs(this.pulseT * 60 - i * 2.2) / 3) * (this.shots > 0 ? 1 : 0) * (this.pulseT < 0.2 ? 1 : 0);
      const idle = 0.75 + 0.3 * Math.sin(t * 5 + i * 1.3);
      const m = this.coilMats[i]; m.emissiveIntensity = idle + ripple * 4 + h * 2.2 + (firing ? 1.2 : 0);
      _c.copy(COOL).lerp(HOT, clamp(h * 1.15 - i * 0.04, 0, 1)); m.emissive.copy(_c);
    }
    _c.copy(COOL).lerp(HOT, clamp(h * 1.4, 0, 1)); this.ventMat.color.copy(_c).multiplyScalar(0.55 + 0.9 * h + 0.25 * Math.sin(t * 7));
    this.accentMat.color.setRGB(0.12, 0.6, 1.8).multiplyScalar(0.6 + 0.6 * Math.sin(t * 3) * 0.3 + this.pulse * 1.5);
    this.tipMat.color.setRGB(1.0, 2.0, 3.0).multiplyScalar(0.7 + this.pulse * 1.8 + (firing ? 0.5 : 0));
    // cell canister: brightness/size follows ammo
    const n = g.weapons.ammo.cells, lvl = clamp(n / 200, 0.12, 1);
    this.cell.scale.set(0.5 + 0.5 * lvl, 0.5 + 0.5 * lvl, 1);
    this.cellMat.color.setRGB(0.3, 1.2, 2.6).multiplyScalar(0.75 + 0.35 * Math.sin(t * 9) + this.pulse * 0.9);
    if (n !== this.ammoShown) { this.ammoShown = n; this.lcd.set(n, n); }
    // steam venting while cooling
    if ((h > 0.18 && !firing) && (this.steamT -= dt) <= 0) {
      this.steamT = 0.045;
      this.steam.emit(-0.046, rand(-0.02, 0.03), rand(-0.1, 0.1), rand(-0.12, -0.03), rand(0.07, 0.16), rand(0.02, 0.1), rand(0.8, 1.2), 0.03, rand(0.14, 0.24), 0.32 * clamp(h * 1.6, 0, 1), rand(-1, 1));
      this.steam.emit(rand(-0.03, 0.03), 0.07, rand(0.08, 0.16), rand(-0.05, 0.05), rand(0.08, 0.16), rand(0.02, 0.08), 0.9, 0.03, 0.18, 0.26 * clamp(h * 1.6, 0, 1), rand(-1, 1));
    }
    // weapon micro-shake while firing
    const j = firing ? 0.0007 : 0;
    this.model.position.set(Math.cos(t * 1.1) * 0.0007 + (Math.random() - 0.5) * j, Math.sin(t * 1.7) * 0.0009 + (Math.random() - 0.5) * j, 0);
    this.flash.update(dt); this.steam.update(dt); this.sparks.update(dt);
  }
}
