// Pistol: semi-auto 9mm with slide-back animation, two-handed grip, tactical light, ejected casings. Doom II timing (14 tics).
import * as THREE from 'three';
import { Weapon } from './base.js';
import { bus, rand, randInt, TIC } from '../core.js';
import { getKit, Parts, Hand, D2R, smooth, keyframe, viewPointToWorld, camBasis, textDecal, trackFire, dryFire, flashPulse, flashDecay, flashKill , warmup } from './kit_a.js';

const _p = new THREE.Vector3(), _v = new THREE.Vector3();
const K_SLIDE = [[0, 0], [0.032, 0.037], [0.052, 0.037], [0.135, 0]], K_TRIGR = [[0, 0], [0.02, 0.26], [0.10, 0.26], [0.17, 0]], K_TRIGZ = [[0, 0], [0.02, 0.0055], [0.10, 0.0055], [0.17, 0]], K_IDX = [[0, 0], [0.02, 0.22], [0.10, 0.22], [0.17, 0]], K_FLIP = [[0, 0], [0.03, 1], [0.16, 0]];
const CYCLE = 14 * TIC;

export default class Pistol extends Weapon {
  constructor(game) {
    super(game, { id: 'pistol', name: 'PISTOL', slot: 2, ammoType: 'bullets', ammoPerShot: 1, raiseTime: 0.30, lowerTime: 0.2 });
    this.rest.set(0.10, -0.205, -0.31); this.viewYaw = 0.42; this.viewPitch = 0.09;
    this.t = 99; this.refire = 0; this.held = false; this._pf = false; this._edge = false;
    this.slide = 0; this.slideLock = 0; this.trig = 0; this.flashT = 0; this._dbgT = null;
  }

  buildModel() {
    const kit = getKit(this.game), M = kit.M;
    const model = new THREE.Group(); model.scale.setScalar(1.2); this.gun = new THREE.Group(); model.add(this.gun);
    this.gun.position.set(0, 0.04, -0.03); // grip centre near the origin
    const F = new Parts(), S = new Parts();

    // ---- frame (polymer) : side profile extruded across the width
    F.profile(M.poly, [
      [-0.142, 0.047, 0.002], [-0.142, 0.026, 0.002], [-0.082, 0.026], [-0.080, 0.004, 0.006], [-0.073, -0.014, 0.010], [-0.030, -0.014, 0.010],
      [-0.011, 0.008, 0.004], [0.027, -0.108, 0.004], [0.070, -0.095, 0.006], [0.037, 0.024, 0.009], [0.036, 0.044, 0.005], [0.030, 0.047, 0.002],
    ], 0.0245, [0, 0, 0], null, 0.0012);
    // grip side panels (stippled) - tilted with the grip
    for (const s of [-1, 1]) {
      F.box(M.stipple, [0.0016, 0.086, 0.046], [s * 0.0128, -0.038, 0.048], [-0.32, 0, 0], 0.0008);
      F.box(M.stipple, [0.0016, 0.028, 0.030], [s * 0.0128, -0.008, 0.062], [-0.32, 0, 0], 0.0008);
      for (const [y, z] of [[-0.070, 0.036], [-0.020, 0.060]]) F.cyl(M.steel, 0.0026, 0.0026, 0.0026, 'x', [s * 0.0141, y, z], null, 10);
    }
    // finger-groove ridges on the front strap
    for (let i = 0; i < 3; i++) F.box(M.stipple, [0.024, 0.0045, 0.006], [0, -0.030 - i * 0.026, 0.010 + i * 0.0085], [-0.32, 0, 0], 0.002);
    // magazine base plate + release
    F.box(M.dark, [0.0275, 0.009, 0.056], [0.0505, -0.105, 0], [-0.32, 0, 0], 0.003);
    F.box(M.steel, [0.0295, 0.003, 0.058], [0.0505 + 0.0012, -0.1105, 0], [-0.32, 0, 0], 0.001);
    F.cyl(M.dark, 0.0045, 0.0045, 0.0028, 'x', [0.0135, 0.010, -0.010], null, 12);
    // lanyard loop
    F.torus(M.steel, 0.0052, 0.0011, [0.0, -0.098, 0.074], [0, Math.PI / 2, -0.32], 14);
    // trigger guard reinforcement + accessory rail slots
    F.box(M.poly, [0.0225, 0.0065, 0.048], [0, -0.0135, -0.052], null, 0.003);
    for (let i = 0; i < 4; i++) F.box(M.dark, [0.0232, 0.0022, 0.0034], [0, 0.0262, -0.118 + i * 0.0072], null, 0.0006);
    // tactical light under the dust cover
    F.box(M.black, [0.0285, 0.024, 0.048], [0, 0.011, -0.116], null, 0.006);
    F.cyl(M.dark, 0.0105, 0.0112, 0.006, 'z', [0, 0.011, -0.143], null, 16);
    F.cyl(M.glass, 0.0088, 0.0088, 0.003, 'z', [0, 0.011, -0.1455], null, 16);
    F.box(M.trim, [0.0032, 0.006, 0.012], [0.0146, 0.016, -0.118], null, 0.001);
    F.box(M.dark, [0.030, 0.003, 0.010], [0, 0.0235, -0.094], null, 0.001);
    // small levers (left side): slide stop + takedown
    F.box(M.steel, [0.0038, 0.0058, 0.032], [-0.0142, 0.031, -0.014], [0, 0, 0], 0.0015);
    F.box(M.steel, [0.0032, 0.012, 0.018], [-0.0138, 0.033, -0.066], [0, 0, 0.0], 0.0015);
    F.cyl(M.steel, 0.004, 0.004, 0.004, 'x', [-0.0148, 0.033, -0.066], null, 10);
    // labels on the frame
    const lab = textDecal(['SZ-9  AUTOMATIC'], 0.052, 0.008, { px: 256, color: 'rgba(230,230,220,0.75)', size: 0.9 }); lab.position.set(-0.01285, 0.0345, -0.09); lab.rotation.y = -Math.PI / 2; this.gun.add(lab);

    // ---- trigger (separate so it can pull)
    this.trigger = new THREE.Group(); this.trigger.position.set(0, 0.012, -0.034);
    const Tp = new Parts();
    Tp.box(M.dark, [0.0085, 0.030, 0.006], [0, -0.014, 0], [0.30, 0, 0], 0.0025);
    Tp.box(M.steel, [0.0038, 0.014, 0.0035], [0, -0.010, -0.0035], [0.30, 0, 0], 0.001);
    this.trigger.add(Tp.build('trig')); this.gun.add(this.trigger);

    // ---- slide group
    S.box(M.blued, [0.0285, 0.0345, 0.192], [0, 0.0625, -0.054], null, 0.0055);
    S.box(M.dark, [0.021, 0.0035, 0.170], [0, 0.0800, -0.062], null, 0.0012);        // top flat / rib
    S.box(M.blued, [0.0272, 0.010, 0.030], [0, 0.0435, -0.150], null, 0.003);        // front nose lip
    // serrations (rear + front), both sides
    for (const s of [-1, 1]) {
      for (let i = 0; i < 8; i++) S.box(M.dark, [0.0010, 0.022, 0.0013], [s * 0.0142, 0.0625, 0.0435 - i * 0.0036], null, 0.0003);
      for (let i = 0; i < 4; i++) S.box(M.dark, [0.0010, 0.020, 0.0013], [s * 0.0142, 0.0625, -0.128 - i * 0.0036], null, 0.0003);
    }
    // ejection port on the right side
    S.box(M.black, [0.0022, 0.0165, 0.046], [0.0137, 0.0700, -0.052], null, 0.002);
    S.box(M.brass, [0.0024, 0.0074, 0.034], [0.0139, 0.0668, -0.056], null, 0.002);
    S.box(M.chrome, [0.0026, 0.0045, 0.020], [0.0139, 0.0755, -0.020], null, 0.001);   // extractor
    // sights (three-dot)
    for (const s of [-1, 1]) { S.box(M.black, [0.0068, 0.0075, 0.0085], [s * 0.0068, 0.0838, 0.0305], null, 0.0012); S.box(M.white, [0.0026, 0.0026, 0.0008], [s * 0.0068, 0.0838, 0.0350], null, 0.0004); }
    S.box(M.black, [0.0052, 0.0095, 0.011], [0, 0.0846, -0.142], null, 0.0012);
    S.box(M.white, [0.0028, 0.0028, 0.0008], [0, 0.0862, -0.1478], null, 0.0004);
    // barrel visible at the muzzle
    S.cyl(M.steel, 0.0068, 0.0068, 0.010, 'z', [0, 0.0625, -0.1465], null, 16);
    S.cyl(M.black, 0.0046, 0.0046, 0.0104, 'z', [0, 0.0625, -0.1470], null, 12);
    // recoil-spring guide rod + engraved markings
    S.cyl(M.chrome, 0.0018, 0.0018, 0.014, 'z', [0, 0.0455, -0.150], null, 8);
    this.slideG = new THREE.Group(); this.slideG.add(S.build('slide')); this.gun.add(this.slideG);
    for (const [sx, txt] of [[-1, 'SZ-9  ·  9x19mm'], [1, 'STATION ZERO SECURITY']]) {
      const d = textDecal([txt], 0.085, 0.0075, { px: 384, color: 'rgba(225,225,215,0.7)', size: 0.86 });
      d.position.set(sx * 0.01446, 0.0705, -0.086); d.rotation.y = sx < 0 ? -Math.PI / 2 : Math.PI / 2; this.slideG.add(d);
    }

    // ---- muzzle & ejection port anchors
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.0625, -0.152); this.gun.add(this.muzzle);
    this.port = new THREE.Object3D(); this.port.position.set(0.02, 0.07, -0.03); this.gun.add(this.port);
    this.flash = this.game.vfx.createFlash('pistol'); this.muzzle.add(this.flash.object3d);

    // ---- hands: right (firing) grip + left support hand
    const ki = kit;
    this.handR = new Hand(ki, { side: 'R', freeze: true, keep: ['index'], knuckleStuds: false,
      pose: { i: [0.6, 0.75, 0.55], m: [1.42, 1.50, 0.95], r: [1.46, 1.55, 0.95], p: [1.44, 1.55, 0.9], t: { yaw: 0.10, pitch: -0.95, roll: 0.15, c: [0.10, 0.25, 0.30] } } });
    this.idxF = this.handR.find('index');
    this.handR.place([0.036, -0.030, 0.050], [0.32, 0.0, -1.5708]); this.gun.add(this.handR.group);
    this.handL = new Hand(ki, { side: 'L', freeze: true,
      pose: { i: [1.30, 1.45, 0.9], m: [1.42, 1.5, 0.95], r: [1.46, 1.55, 0.95], p: [1.44, 1.55, 0.9], t: { yaw: 0.10, pitch: -0.55, roll: 0.15, c: [0.10, 0.20, 0.20] } } });
    this.handL.place([-0.038, -0.062, 0.010], [0.32, 0.0, 1.5708]); this.gun.add(this.handL.group);
    this.handR.bake(F, this.gun); this.handL.bake(F, this.gun);
    this.frameG = F.build('frame'); this.gun.add(this.frameG);
    return model;
  }

  debugAt(t) { this._dbgT = t; }

  update(dt, ctx) { if (!this.game.__waWarm) warmup(this.game); trackFire(this, ctx); super.update(dt, ctx); }

  onSelect() { this.t = 99; this.refire = 0; this.held = false; }
  onDeselect() { flashKill(this.game); }

  think(dt, ctx) {
    if (this.cool > 0 || this._dbgT !== null) return;
    if (!ctx.fire) { this.refire = 0; return; }
    if (dryFire(this, ctx)) return;
    this.shoot();
  }

  shoot() {
    const g = this.game;
    this.consume(1);
    const accurate = !this.held; this.held = true;
    this.refire = accurate ? 0 : this.refire + 1;
    this.cool = CYCLE; this.t = 0; this.flashT = 0;
    g.audio.play('pistol');
    this.fireBullets({ count: 1, spreadH: accurate ? 0 : 5.6 * D2R, spreadV: accurate ? 0 : 0.35 * D2R, tracer: 'bullet', damage: () => 5 * randInt(1, 3), range: 90 });
    this.flash.fire(0.75);
    g.vfx.light(this.muzzleWorld(_p), 0xffc36a, 3.2, 0.08, 9); flashPulse(g, this.muzzle, 0.55);
    this.kickBack(0.026, 0.045, 0.011 + Math.random() * 0.004, 0.0015);
    this.ejectCasing();
    bus.emit('weapon:fire', { id: this.id });
  }

  ejectCasing() {
    const g = this.game, b = camBasis(g);
    viewPointToWorld(g, this.port, _p);
    _v.set(0, 0, 0).addScaledVector(b.right, 1.5 + rand(0, 1)).addScaledVector(b.up, 1.4 + rand(0, 0.9)).addScaledVector(b.fwd, -0.3 + rand(-0.2, 0.3));
    g.vfx.shell(_p, _v, 'bullet');
  }

  animate(dt, ctx) {
    const dbg = this._dbgT !== null;
    if (dbg) this.t = this._dbgT; else this.t += dt;
    const t = this.t;
    if (!dbg) { this.flash.update(dt); flashDecay(this.game, dt); }
    // slide: quick back, hold, return; stays locked open when the magazine is empty
    let slide = keyframe(K_SLIDE, t, smooth);
    if (t > 0.13 && !this.hasAmmo() && this.selected) slide = 0.033;
    this.slideG.position.z = this.slideG.position.z + (slide - this.slideG.position.z) * (dbg ? 1 : Math.min(1, dt * 60));
    this.trigger.rotation.x = -keyframe(K_TRIGR, t, smooth);
    this.trigger.position.z = -0.034 + keyframe(K_TRIGZ, t, smooth);
    const idx = this.idxF; if (idx) { const c = keyframe(K_IDX, t, smooth); idx.joints[0].rotation.x = -(0.55 + c); idx.joints[1].rotation.x = -(0.7 + c * 0.6); }
    const vc = this.game.viewCamera; this.handR.pointArm(vc, 0.30, -0.80, 0.55); this.handL.pointArm(vc, -0.30, -0.80, 0.55);
    // idle breathing + raise tilt
    const tm = this.time, r = this.raise;
    this.model.position.set(Math.sin(tm * 1.1) * 0.0008, Math.sin(tm * 1.7) * 0.0012, 0);
    this.model.rotation.set(-(1 - r) * 0.35 + Math.sin(tm * 1.3) * 0.0015 + this.viewPitch, this.viewYaw, -(1 - r) * 0.1);
    // recoil muzzle-flip on top of the spring
    const flip = keyframe(K_FLIP, t, smooth);
    this.gun.rotation.x = flip * 0.045; this.gun.position.z = -0.03 + flip * 0.012;
  }
}
