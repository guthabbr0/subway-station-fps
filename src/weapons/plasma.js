// Plasma rifle: 1 cell / 3 tics (~11.7/s) while held, 20-tic cooldown after release, 5*(1d8) dmg, bolts 27 m/s.
// Model: pale ceramic-armour receiver on a dark chassis, translucent canister with six pulsing energy cells (one per 50 rounds), a stack of six glowing
// coil rings on a conductor rod converging into prongs + a glowing emitter, louvred heat sink with glowing slits (cool blue -> hot amber), side vents and
// steam ports that vent after release, reflex sight, LCD, pistol grip + foregrip (kit_a gloved hands). Crackling arcs jump between the coils while firing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Weapon } from './base.js';
import { TIC, bus, clamp, rand, randInt } from '../core.js';
import * as K from './kitb.js';
import { warmup, flashPulse, flashDecay, flashKill } from './kit_a.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Color();
const FWD = new THREE.Vector3(0, 0, -1);
const AY = 0.02;                                   // barrel axis height
const COIL_Z = [-0.235, -0.290, -0.345, -0.400, -0.455, -0.510], COIL_R = [0.046, 0.044, 0.042, 0.040, 0.038, 0.036], NCOIL = 6;
const NCELL = 6, CELL_Z0 = 0.0, CELL_DZ = 0.022, CY = 0.116, SIGHT_Y = 0.20;
const COOL = new THREE.Color(0.10, 0.42, 1.25), HOT = new THREE.Color(1.8, 0.7, 0.18);
const _dummy = new THREE.Object3D();

// ---------------------------------------------------------------------------------------------------------------
// World plasma bolt (template built + shader-warmed in init(), then cloned + pooled)
// ---------------------------------------------------------------------------------------------------------------
let BOLT = null; const freeBolts = [];
function boltTemplate(game) {
  if (BOLT) return BOLT;
  const g = new THREE.Group();
  const streakMat = new THREE.MeshBasicMaterial({ map: K.streakTexture(), color: new THREE.Color(0.35, 0.85, 2.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false });
  const geo = new THREE.PlaneGeometry(0.12, 1.5).rotateX(-Math.PI / 2).translate(0, 0, 0.75);
  const s1 = new THREE.Mesh(geo, streakMat), s2 = new THREE.Mesh(geo, streakMat); s2.rotation.z = Math.PI / 2;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(0.25, 0.6, 2.0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.85 })); halo.scale.setScalar(0.75);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(1.8, 2.4, 3.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); core.scale.setScalar(0.3);
  halo.name = 'halo'; core.name = 'core';
  g.add(s1, s2, halo, core); for (const c of g.children) c.frustumCulled = false;
  BOLT = g; K.park(game, BOLT.clone());
  return g;
}
function getBolt() { const m = freeBolts.pop() || BOLT.clone(); m.userData.halo = m.getObjectByName('halo'); return m; }

export default class PlasmaRifle extends Weapon {
  constructor(game) {
    super(game, { id: 'plasma', name: 'PLASMA RIFLE', slot: 6, ammoType: 'cells', ammoPerShot: 1, raiseTime: 0.34, lowerTime: 0.24 });
    this.rest.set(0.13, -0.135, -0.72);
    // ADS: through the reflex sight window, dot collimated parallel to the barrel
    this.adsSpec = { fov: 60, vfov: 60, depth: 0.55, rear: [0, 0.202, -0.118], front: [0, 0.202, -0.60], spread: 1 };
    this.chain = false; this.nextShot = 0; this.emptyT = 0; this.heat = 0; this.pulse = 0; this.pulseT = 0; this.steamT = 0; this.cooling = 0; this.ammoShown = -1; this.shots = 0; this.trig = 0; this.trigT = 9; this.arcT = 0; this._dbg = null;
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
    const g = this.game, kit = K.getKit(g), HR = K.getHero(g), M = kit.M, H = HR.H, model = new THREE.Group();
    this.gun = new THREE.Group(); model.add(this.gun);
    const G = this.gun, B = new K.HParts(), F = new K.HParts(), pl = H.plate, pd = H.plateDark;

    // ================================================================ receiver (armour shell over a dark chassis) ===========================
    B.profile(pl, [[0.150, 0.050, 0.012], [0.055, 0.083, 0.008], [-0.100, 0.083, 0.006], [-0.165, 0.048, 0.008], [-0.165, -0.035, 0.008], [0.0, -0.046, 0.010], [0.150, -0.020, 0.012]], 0.078, [0, 0, 0], null, 0.002);
    B.box(pd, [0.052, 0.022, 0.20], [0, -0.056, -0.02], null, 0.004);
    for (const sx of [-1, 1]) {
      B.box(pd, [0.003, 0.030, 0.17], [sx * 0.0405, 0.002, -0.03], null, 0.001);                    // dark flank accent
      B.box(M.steel, [0.0022, 0.004, 0.11], [sx * 0.0402, 0.036, -0.05], null, 0);
      for (const [y, z] of [[0.052, 0.12], [-0.026, 0.12], [0.052, -0.14], [-0.026, -0.14]]) B.screw(M.steel, M.black, 0.0042, [sx * 0.0397, y, z], 'x');
    }
    B.box(M.dark, [0.032, 0.008, 0.21], [0, 0.0875, -0.10], null, 0.002);                           // top rail
    for (let i = 0; i < 12; i++) B.box(M.steel, [0.034, 0.004, 0.010], [0, 0.0925, -0.20 + i * 0.0175], null, 0.0006);
    // rear heat-sink block: louvres + glowing slits face the player
    B.box(pd, [0.070, 0.076, 0.052], [0, 0.020, 0.172], null, 0.006);
    for (let i = 0; i < 6; i++) B.box(M.dark, [0.074, 0.0052, 0.010], [0, -0.006 + i * 0.0125, 0.2005], null, 0.001);
    // coil root + conductor rod + bobbins + retaining rods
    B.cyl(pd, 0.036, 0.040, 0.06, 'z', [0, AY, -0.195], null, 24); B.cyl(M.steel, 0.042, 0.042, 0.006, 'z', [0, AY, -0.229], null, 24);
    for (let i = 0; i < NCOIL; i++) {
      B.cyl(pd, COIL_R[i] - 0.012, COIL_R[i] - 0.012, 0.024, 'z', [0, AY, COIL_Z[i]], null, 20);                                   // bobbin core
      B.cyl(pd, COIL_R[i] + 0.004, COIL_R[i] + 0.004, 0.010, 'z', [0, AY, COIL_Z[i] + 0.0205], null, 24);                          // insulator disc (dark) behind each ring
      B.cyl(M.steel, COIL_R[i] + 0.006, COIL_R[i] + 0.006, 0.003, 'z', [0, AY, COIL_Z[i] + 0.0265], null, 24);
    }
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; B.cyl(M.steel, 0.0028, 0.0028, 0.30, 'z', [Math.cos(a) * 0.0305, AY + Math.sin(a) * 0.0305, -0.37], null, 8); }
    // prongs + emitter housing
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
      B.tube(M.steel, [[c * 0.040, AY + s * 0.040, -0.500], [c * 0.046, AY + s * 0.046, -0.535], [c * 0.030, AY + s * 0.030, -0.575], [c * 0.013, AY + s * 0.013, -0.610]], 0.0046, [0, 0, 0], 10);
    }
    B.cyl(M.dark, 0.026, 0.032, 0.034, 'z', [0, AY, -0.548], null, 20); B.cyl(M.steel, 0.030, 0.030, 0.006, 'z', [0, AY, -0.5675], null, 20);
    B.cyl(M.dark, 0.014, 0.020, 0.022, 'z', [0, AY, -0.585], null, 16);
    // side heat-vent frames + steam ports
    for (const sx of [-1, 1]) {
      B.box(M.dark, [0.004, 0.036, 0.100], [sx * 0.0405, 0.008, -0.075], null, 0.001);
      B.cyl(M.steel, 0.0068, 0.0092, 0.016, 'y', [sx * 0.031, 0.089, 0.098], [0, 0, -sx * 0.45], 12); B.cyl(M.black, 0.0046, 0.0046, 0.002, 'y', [sx * 0.0338, 0.0975, 0.098], [0, 0, -sx * 0.45], 10);
    }
    // cell canister brackets + caps (glass + cells added below)
    for (const z of [-0.026, 0.115]) B.box(M.dark, [0.030, 0.030, 0.012], [0, 0.098, z], null, 0.003);
    B.cyl(M.dark, 0.0285, 0.0285, 0.010, 'z', [0, CY, -0.040], null, 20); B.cyl(M.dark, 0.0285, 0.0285, 0.010, 'z', [0, CY, 0.130], null, 20); B.torus(M.steel, 0.0285, 0.0022, [0, CY, 0.1355], null, 20);
    B.cyl(M.steel, 0.0040, 0.0040, 0.16, 'z', [0, CY, 0.045], null, 8);
    B.torus(M.dark, 0.0265, 0.003, [0, CY, 0.045], null, 24); B.box(H.cyanVC, [0.006, 0.0022, 0.03], [0, CY + 0.0292, 0.045], null, 0);
    // reflex sight: raised on a pedestal so its window (y = SIGHT_Y) clears the cell canister behind it: this is the ADS sight line (the eye looks through the window at the dot)
    B.box(M.dark, [0.018, 0.048, 0.040], [0, 0.0945 + 0.024, -0.105], null, 0.003);                       // pedestal on the top rail
    B.box(M.dark, [0.030, 0.008, 0.052], [0, SIGHT_Y - 0.019, -0.105], null, 0.002);
    for (const sx of [-1, 1]) B.box(M.dark, [0.004, 0.030, 0.040], [sx * 0.0135, SIGHT_Y, -0.105], null, 0.002);
    B.box(M.dark, [0.030, 0.005, 0.044], [0, SIGHT_Y + 0.017, -0.105], null, 0.002);
    B.torus(M.dark, 0.0165, 0.0024, [0, SIGHT_Y, -0.1295], null, 20);                                     // lens frame (open window: the glass plane below is translucent)

    // ================================================================ grips ==================================================================
    F.box(pd, [0.048, 0.024, 0.110], [0, -0.058, 0.070], null, 0.005);                           // trigger housing
    F.box(M.rubber, [0.036, 0.118, 0.052], [0, -0.112, 0.078], [-0.30, 0, 0], 0.006);
    F.box(M.stipple, [0.0018, 0.090, 0.040], [0.0186, -0.108, 0.076], [-0.30, 0, 0], 0.0006); F.box(M.stipple, [0.0018, 0.090, 0.040], [-0.0186, -0.108, 0.076], [-0.30, 0, 0], 0.0006);
    F.box(M.steel, [0.034, 0.006, 0.048], [0, -0.171, 0.100], [-0.30, 0, 0], 0.002);
    F.torus(M.blued, 0.024, 0.0034, [0, -0.043, 0.006], [0, Math.PI / 2, 0], 24, [1.5, 1, 1]);
    F.box(pd, [0.030, 0.030, 0.056], [0, -0.058, -0.13], null, 0.004);                          // foregrip mount
    F.cyl(M.rubber, 0.0198, 0.0192, 0.112, 'y', [0, -0.118, -0.13], null, 16);
    for (let i = 0; i < 5; i++) F.torus(M.black, 0.0199, 0.0014, [0, -0.083 - i * 0.019, -0.13], [Math.PI / 2, 0, 0], 16);
    F.cyl(M.dark, 0.0215, 0.0215, 0.008, 'y', [0, -0.178, -0.13], null, 16);
    this.handR = K.gripHand(kit, 'R', G, F, [0.0395, -0.076, 0.086], [0.30, 0, -Math.PI / 2], K.POSE_TRIGGER);
    this.idxF = this.handR.find('index');
    this.handL = K.gripHand(kit, 'L', G, F, [-0.038, -0.118, -0.106], [0.0, 0, Math.PI / 2], K.POSE_GRIP);
    this.bodyG = B.build('body'); G.add(this.bodyG);
    this.frameG = F.build('frame'); G.add(this.frameG);
    this.trigger = new THREE.Group(); this.trigger.position.set(0, -0.046, 0.006); G.add(this.trigger);
    { const T = new K.HParts(); T.box(M.blued, [0.007, 0.028, 0.006], [0, -0.013, 0], [0.25, 0, 0], 0.002); T.box(M.steel, [0.004, 0.012, 0.004], [0, -0.010, -0.003], [0.25, 0, 0], 0.001); this.trigger.add(T.build('trig')); }

    // ================================================================ glowing parts =========================================================
    // coils: one instanced torus per ring, each with its own (HDR) instance colour
    this.rodMat = K.glowBasic(0.12, 0.5, 1.5); this.rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.40, 10).rotateX(Math.PI / 2), this.rodMat); this.rod.position.set(0, AY, -0.40); this.rod.frustumCulled = false; G.add(this.rod);
    this.coilMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.coils = new THREE.InstancedMesh(new THREE.TorusGeometry(0.04, 0.0075, 8, 32).scale(1, 1, 0.75), this.coilMat, NCOIL); this.coils.frustumCulled = false;
    for (let i = 0; i < NCOIL; i++) { _dummy.position.set(0, AY, COIL_Z[i]); _dummy.rotation.set(0, 0, 0); _dummy.scale.setScalar(COIL_R[i] / 0.04); _dummy.updateMatrix(); this.coils.setMatrixAt(i, _dummy.matrix); this.coils.setColorAt(i, COOL); }
    G.add(this.coils);
    // energy cells inside the glass canister
    this.cellMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.cells = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0185, 0.0185, 0.016, 16).rotateX(Math.PI / 2), this.cellMat, NCELL); this.cells.frustumCulled = false;
    for (let i = 0; i < NCELL; i++) { _dummy.position.set(0, CY, CELL_Z0 + i * CELL_DZ + 0.0); _dummy.rotation.set(0, 0, 0); _dummy.scale.setScalar(1); _dummy.updateMatrix(); this.cells.setMatrixAt(i, _dummy.matrix); this.cells.setColorAt(i, COOL); }
    G.add(this.cells);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.0265, 0.0265, 0.16, 24, 1, true).rotateX(Math.PI / 2), H.glass); glass.position.set(0, CY, 0.045); glass.renderOrder = 4; glass.frustumCulled = false; G.add(glass);
    // vents (glowing grilles) + accent pinstripes + rear slits
    this.ventMat = new THREE.MeshBasicMaterial({ map: K.grilleTexture({ slots: 5 }), color: COOL.clone(), toneMapped: false });
    { const gs = []; for (const sx of [-1, 1]) for (const z of [-0.097, -0.053]) { const pg = new THREE.PlaneGeometry(0.040, 0.030); pg.rotateY(sx < 0 ? -Math.PI / 2 : Math.PI / 2); pg.translate(sx * 0.0428, 0.008, z); gs.push(pg); }
      const vm = new THREE.Mesh(mergeGeometries(gs, false), this.ventMat); vm.frustumCulled = false; G.add(vm); }
    this.accentMat = K.glowBasic(0.12, 0.6, 1.8);
    { const A = new K.HParts(); for (const sx of [-1, 1]) { A.box(this.accentMat, [0.0016, 0.0035, 0.17], [sx * 0.0412, 0.020, -0.03], null, 0); A.box(this.accentMat, [0.0016, 0.0035, 0.17], [sx * 0.0412, -0.028, -0.03], null, 0); }
      A.box(this.accentMat, [0.030, 0.0026, 0.0026], [0, 0.0885, -0.20], null, 0);
      for (let i = 0; i < 5; i++) A.box(this.accentMat, [0.062, 0.0032, 0.0012], [0, 0.00025 + 0.0125 * i, 0.1988], null, 0);
      this.accentG = A.build('accent'); G.add(this.accentG); }
    this.tipMat = K.glowBasic(1.0, 2.0, 3.0);
    this.tip = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 12, 8), this.tipMat); this.tip.position.set(0, AY, -0.598); this.tip.frustumCulled = false; G.add(this.tip);
    this.tipGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(0.3, 0.9, 2.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.7, depthTest: false })); this.tipGlow.position.copy(this.tip.position); this.tipGlow.scale.setScalar(0.08); this.tipGlow.renderOrder = 5; this.tipGlow.frustumCulled = false; G.add(this.tipGlow);
    this.dotMat = K.glowBasic(0.3, 2.0, 2.6); const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 6, 5), this.dotMat); dot.position.set(0, SIGHT_Y + 0.002, -0.118); dot.frustumCulled = false; G.add(dot);
    const rgl = new THREE.Mesh(new THREE.PlaneGeometry(0.024, 0.024), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.3, 0.42), transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false })); rgl.position.set(0, SIGHT_Y + 0.001, -0.1245); rgl.rotation.x = 0.0; rgl.frustumCulled = false; rgl.renderOrder = 4; G.add(rgl);
    // arcs between the coil rings
    this.arcs = new K.Arcs(G, 5, 4, K.additiveMat(K.beamTexture(), 0.5, 1.5, 3.4, { side: THREE.DoubleSide }));

    // LCD + decals
    this.lcd = new K.LCD(160, 64, (ctx, w, h, key, n, heat) => {
      ctx.fillStyle = '#02080d'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#31d4ff'; ctx.font = 'bold 20px monospace'; ctx.fillText('CELLS', 8, 22);
      ctx.font = 'bold 40px monospace'; ctx.fillText(String(n).padStart(3, '0'), 8, 58); ctx.strokeStyle = 'rgba(49,212,255,0.5)'; ctx.strokeRect(2, 2, w - 4, h - 4);
      ctx.font = 'bold 13px monospace'; ctx.fillText('TEMP', 96, 22); ctx.strokeRect(96, 30, 54, 12); ctx.fillStyle = heat > 0.55 ? '#ffa030' : '#31d4ff'; ctx.fillRect(98, 32, 50 * heat, 8);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    });
    const lp = new THREE.Mesh(new THREE.PlaneGeometry(0.052, 0.021), this.lcd.mat); lp.rotation.y = -Math.PI / 2; lp.position.set(-0.0438, 0.030, 0.090); lp.frustumCulled = false; G.add(lp);
    { const lb = new K.HParts(); lb.box(M.black, [0.004, 0.026, 0.058], [-0.0415, 0.030, 0.090], null, 0.001); this.frameG.add(lb.build('lcdBox')); }
    const D = new K.DecalSheet(g, 1024, 512);
    const rMain = D.text(512, 96, ['PLS-6  PLASMA RIFLE', 'STATION ZERO ORDNANCE'], { color: 'rgba(18,30,58,0.92)', size: 0.5 });
    const rWarn = D.text(288, 56, ['HIGH ENERGY', 'DO NOT STARE INTO EMITTER'], { color: 'rgba(20,20,16,0.95)', bg: 'rgba(222,176,30,0.95)', border: 'rgba(20,20,16,0.95)', size: 0.5, bw: 4 });
    const rSer = D.text(200, 36, 'SN 6-0471-C', { color: 'rgba(200,214,232,0.8)', size: 0.7, weight: 'normal' });
    const rCel = D.text(160, 34, '● CELL LEVEL', { color: 'rgba(30,50,90,0.9)', size: 0.66 });
    D.plane(rMain, 0.120, 0.023, [-0.0392, 0.056, -0.055], 'x-');
    D.plane(rWarn, 0.066, 0.0125, [-0.0392, -0.030, -0.075], 'x-');
    D.plane(rSer, 0.044, 0.0085, [-0.0392, -0.030, 0.052], 'x-');
    D.plane(rCel, 0.040, 0.0085, [-0.0392, -0.030, 0.118], 'x-');
    this.decals = D.build('decals'); G.add(this.decals);

    // ================================================================ muzzle, flash, puffs ==================================================
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, AY, -0.606); G.add(this.muzzle);
    this.flash = g.vfx.createFlash('plasma'); this.muzzle.add(this.flash.object3d);
    this.steam = new K.Puffs(model, 14, K.smokeTexture(), { color: 0xcfe6ff, drag: 1.6 });
    this.sparks = new K.Puffs(model, 6, K.glowTexture(), { additive: true, color: new THREE.Color(0.4, 0.9, 2.2), drag: 4 });
    return model;
  }

  init() {
    super.init();
    boltTemplate(this.game);                                  // bolt prototype (+ parked copy for the boot warm-up)
  }

  debugAt(spec) { this._dbg = spec; if (spec) { if (spec.heat !== undefined) this.heat = spec.heat; if (spec.pulse !== undefined) this.pulse = spec.pulse; } }
  update(dt, ctx) { if (!this.game.__waWarm) warmup(this.game); super.update(dt, ctx); }
  onSelect() { this.chain = false; this.emptyT = 0; this.nextShot = 0; this.steam.clear(); this.sparks.clear(); this._dbg = null; this.flash.object3d.visible = false; }
  onDeselect() { flashKill(this.game); }

  think(dt, ctx) {
    if (this.time < this.nextShot || this._dbg) return;
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
    if ((this.shots & 1) === 0) flashPulse(g, this.muzzle, 0.9, 0x5aa8ff);
    this.kickBack(0.014, 0.02, 0.0026, 0.004);
    g.player.shake?.(0.05);
    this.heat = Math.min(1, this.heat + 0.05); this.pulse = 1; this.pulseT = 0; this.trigT = 0; this.arcT = 0.06;
    this.sparks.emit(0, AY, -0.61, rand(-0.05, 0.05), rand(-0.05, 0.05), -0.4, 0.09, 0.05, 0.18, 0.9);
    bus.emit('weapon:fire', { id: 'plasma' });
    if (!this.hasAmmo()) g.weapons.autoSwitch();
  }

  animate(dt, ctx) {
    const g = this.game, t = this.time, dbg = this._dbg;
    this.emptyT = Math.max(0, this.emptyT - dt);
    const firing = !dbg && this.chain && this.ready;
    // heat: rises with sustained fire, bleeds off afterwards
    if (!dbg || dbg.heat === undefined) this.heat = firing ? this.heat : Math.max(0, this.heat - dt * (this.cooling > 0 ? 0.55 : 0.9));
    if (this.cooling > 0) this.cooling = this.time < this.nextShot ? this.cooling : Math.max(0, this.cooling - dt * 0.7);
    this.pulseT += dt; if (!dbg || dbg.pulse === undefined) this.pulse = Math.max(0, this.pulse - dt * 9);
    const h = this.heat;
    // coils: idle shimmer + ripple travelling towards the muzzle at each shot + heat tint (per-instance HDR colour)
    for (let i = 0; i < NCOIL; i++) {
      const ripple = Math.max(0, 1 - Math.abs(this.pulseT * 60 - i * 2.2) / 3) * (this.shots > 0 ? 1 : 0) * (this.pulseT < 0.2 ? 1 : 0);
      const idle = 0.75 + 0.3 * Math.sin(t * 5 + i * 1.3);
      const k = Math.min(2.0, 0.3 + idle * 0.5 + ripple * 1.6 + h * 0.9 + (firing ? 0.4 : 0));
      _c.copy(COOL).lerp(HOT, clamp(h * 1.15 - i * 0.04, 0, 1)).multiplyScalar(k * 0.8); this.coils.setColorAt(i, _c);
    }
    this.coils.instanceColor.needsUpdate = true;
    this.rodMat.color.copy(COOL).lerp(HOT, clamp(h * 1.2, 0, 1)).multiplyScalar(0.28 + 0.12 * Math.sin(t * 6) + this.pulse * 0.7 + h * 0.5);
    _c.copy(COOL).lerp(HOT, clamp(h * 1.4, 0, 1)); this.ventMat.color.copy(_c).multiplyScalar(0.55 + 0.9 * h + 0.25 * Math.sin(t * 7));
    this.accentMat.color.setRGB(0.12, 0.6, 1.8).multiplyScalar(0.6 + 0.18 * Math.sin(t * 3) + this.pulse * 1.5 + h * 0.6);
    this.tipMat.color.setRGB(1.0, 2.0, 3.0).multiplyScalar(0.7 + this.pulse * 1.8 + (firing ? 0.5 : 0));
    this.tipGlow.material.opacity = 0.35 + this.pulse * 0.6 + (firing ? 0.15 : 0); this.tipGlow.scale.setScalar(0.07 + this.pulse * 0.10 + 0.01 * Math.sin(t * 9));
    // energy cells: one per 50 cells of ammo, a bright wave runs rear -> front at each shot; partial cell dims
    const n = g.weapons.ammo.cells;
    for (let i = 0; i < NCELL; i++) {
      const fill = clamp(n / 50 - i, 0, 1), wave = Math.max(0, 1 - Math.abs(this.pulseT * 40 - i * 1.2) / 2.2) * (this.pulseT < 0.3 ? 1 : 0) * this.pulse;
      const b = fill * (0.75 + 0.30 * Math.sin(t * 6 + i * 1.7)) + wave * 2.2 + fill * h * 0.5;
      _c.copy(COOL).lerp(HOT, clamp(h * 0.8, 0, 1)).multiplyScalar(0.06 + b * 0.75); this.cells.setColorAt(i, _c);
    }
    this.cells.instanceColor.needsUpdate = true;
    this.dotMat.color.setRGB(0.3, 2.0, 2.6).multiplyScalar(0.8 + 0.2 * Math.sin(t * 4));
    const h8 = Math.round(h * 8); if (n !== this.ammoShown || h8 !== this.heatShown) { this.ammoShown = n; this.heatShown = h8; this.lcd.set(n * 10 + h8, n, h8 / 8); }
    // arcs jump between coil rings while a shot is fresh or the rifle is very hot
    this.arcT = Math.max(0, this.arcT - dt);
    if (this.arcT > 0 || h > 0.75) {
      for (let i = 0; i < 5; i++) {
        if (Math.random() < 0.55) { const a0 = rand(0, 6.28), a1 = a0 + rand(-0.6, 0.6), R0 = COIL_R[i] + 0.006, R1 = COIL_R[i + 1] + 0.006; this.arcs.set(i, Math.cos(a0) * R0, AY + Math.sin(a0) * R0, COIL_Z[i], Math.cos(a1) * R1, AY + Math.sin(a1) * R1, COIL_Z[i + 1], 0.008, 0.0022); } else this.arcs.hide(i);
      }
      this.arcs.flush();
    } else this.arcs.hideAll();
    // steam venting while cooling: from the side vents and the two steam ports
    if ((h > 0.18 && !firing) && (this.steamT -= dt) <= 0) {
      this.steamT = 0.045; const a = 0.32 * clamp(h * 1.6, 0, 1);
      this.steam.emit(-0.046, 0.008 + rand(-0.02, 0.03), rand(-0.1, 0.02), rand(-0.12, -0.03), rand(0.07, 0.16), rand(0.02, 0.1), rand(0.8, 1.2), 0.03, rand(0.14, 0.24), a, rand(-1, 1));
      const sx = Math.random() < 0.5 ? -1 : 1;
      this.steam.emit(sx * 0.034, 0.099, 0.098, sx * rand(0.03, 0.1), rand(0.10, 0.22), rand(0.02, 0.08), rand(0.9, 1.3), 0.025, rand(0.16, 0.26), 0.85 * a, rand(-1, 1));
    }
    // trigger + hands + pose
    this.trigT += dt; const tg = firing || this.trigT < 0.1 ? 1 : 0; this.trig += (tg - this.trig) * Math.min(1, dt * 30);
    this.trigger.rotation.x = -this.trig * 0.25; this.trigger.position.z = 0.006 + this.trig * 0.004;
    const idx = this.idxF; if (idx) { idx.joints[0].rotation.x = -(0.55 + this.trig * 0.22); idx.joints[1].rotation.x = -(0.65 + this.trig * 0.5); }
    const vc = g.viewCamera; this.handR.pointArm(vc, 0.30, -0.80, 0.55); this.handL.pointArm(vc, -0.50, -0.80, 0.30);
    const j = firing ? 0.0007 : 0;
    this.model.position.set(Math.cos(t * 1.1) * 0.0007 + (Math.random() - 0.5) * j, Math.sin(t * 1.7) * 0.0009 + (Math.random() - 0.5) * j, 0);
    this.model.rotation.set(-(1 - this.raise) * 0.4 + Math.sin(t * 1.3) * 0.002 + this.viewPitch, this.viewYaw, -(1 - this.raise) * 0.12);
    if (!dbg) { this.flash.update(dt); flashDecay(g, dt); }
    this.steam.update(dt); this.sparks.update(dt);
  }
}
