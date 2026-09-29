// Pump-action shotgun: walnut furniture, blued receiver, sliding checkered fore-end. Doom II timing: 37 tics per shot
// (fire -> pump back [shotgunPump, casing ejected] -> pump forward -> ready). 7 pellets x 5/10/15, +-5.6 deg horizontal spread.
import * as THREE from 'three';
import { Weapon } from './base.js';
import { bus, rand, randInt, TIC } from '../core.js';
import { getKit, Parts, Hand, D2R, smooth, keyframe, viewPointToWorld, camBasis, textDecal, trackFire, dryFire, flashPulse, flashDecay, flashKill , warmup } from './kit_a.js';

const _p = new THREE.Vector3(), _v = new THREE.Vector3();
const K_TRIG = [[0, 0], [1.5, 1], [6, 1], [10, 0]], K_FLIP = [[0, 0], [1.2, 1], [9, 0.25], [16, 0]];
const CYCLE = 37 * TIC;
const PUMP_KEYS = [[0, 0], [11, 0], [18.5, 1], [21.5, 1], [27.5, 0], [37, 0]]; // tics -> pump travel fraction
const PUMP_TRAVEL = 0.088;

export default class Shotgun extends Weapon {
  constructor(game) {
    super(game, { id: 'shotgun', name: 'SHOTGUN', slot: 3, ammoType: 'shells', ammoPerShot: 1, raiseTime: 0.36, lowerTime: 0.22 });
    this.rest.set(0.20, -0.24, -0.55); this.viewYaw = 0.62; this.viewPitch = 0.08;
    this.t = 99; this.held = false; this._pf = false; this._edge = false; this._dbgT = null; this.pumpDone = true; this.ejected = true; this.pumpSnd = true; this.pump = 0;
  }

  buildModel() {
    const kit = getKit(this.game), M = kit.M;
    const model = new THREE.Group(); this.gun = new THREE.Group(); model.add(this.gun);
    this.gun.position.set(0, 0.004, -0.10);
    const F = new Parts(), R = new Parts(), PU = new Parts();

    // ---- receiver (blued steel) + fittings
    R.box(M.blued, [0.038, 0.056, 0.205], [0, 0.030, -0.033], null, 0.008);
    R.box(M.dark, [0.026, 0.0022, 0.170], [0, 0.0592, -0.040], null, 0.0008);                         // matte top strap
    for (let i = 0; i < 9; i++) R.box(M.black, [0.020, 0.0016, 0.0016], [0, 0.0594, -0.118 + i * 0.0032], null, 0.0004);   // rear-of-barrel serrations
    R.box(M.black, [0.0026, 0.0225, 0.056], [0.0192, 0.0400, -0.046], null, 0.002);                    // ejection port (right)
    R.box(M.black, [0.030, 0.0026, 0.060], [0, 0.0012, -0.062], null, 0.001);                          // loading port (bottom)
    R.box(M.steel, [0.0032, 0.0078, 0.052], [-0.0192, 0.0200, -0.018], null, 0.0012);                  // slide release (left)
    R.box(M.chrome, [0.0026, 0.0060, 0.010], [-0.0196, 0.0200, 0.010], null, 0.001);
    // barrel + rib + beads
    R.cyl(M.dark, 0.0128, 0.0128, 0.590, 'z', [0, 0.048, -0.430], null, 20);
    R.cyl(M.blued, 0.0142, 0.0142, 0.030, 'z', [0, 0.048, -0.140], null, 20);                          // barrel chamber
    R.box(M.dark, [0.0072, 0.0052, 0.520], [0, 0.0625, -0.450], null, 0.0015);                          // vent rib
    for (let i = 0; i < 20; i++) R.box(M.black, [0.0048, 0.0056, 0.0044], [0, 0.0630, -0.200 - i * 0.024], null, 0.0004);
    R.sphere(M.brass, 0.0038, [0, 0.0672, -0.708], null, null, 10);
    R.sphere(M.white, 0.0022, [0, 0.0664, -0.500], null, null, 8);
    R.cyl(M.chrome, 0.0128, 0.0146, 0.018, 'z', [0, 0.048, -0.716], null, 20);                          // muzzle brake ring
    R.cyl(M.black, 0.0106, 0.0106, 0.004, 'z', [0, 0.048, -0.7225], null, 16);                          // bore
    // magazine tube + cap + barrel band + swivel
    R.cyl(M.steel, 0.0118, 0.0118, 0.470, 'z', [0, 0.0175, -0.375], null, 18);
    R.cyl(M.dark, 0.0138, 0.0138, 0.022, 'z', [0, 0.0175, -0.612], null, 18);
    R.box(M.dark, [0.030, 0.058, 0.014], [0, 0.033, -0.595], null, 0.004);
    R.torus(M.steel, 0.0068, 0.0016, [0, -0.008, -0.595], [0, Math.PI / 2, 0], 14);
    // trigger group
    for (const [sz, p, r] of [[[0.0065, 0.030, 0.0065], [0, -0.0165, -0.020], [0.10, 0, 0]], [[0.0065, 0.0065, 0.080], [0, -0.0325, 0.022], null], [[0.0065, 0.030, 0.0065], [0, -0.0165, 0.064], [-0.05, 0, 0]]]) R.box(M.blued, sz, p, r, 0.0025);
    R.cyl(M.steel, 0.0045, 0.0045, 0.022, 'x', [0, -0.012, 0.070], null, 10);                             // cross-bolt safety
    R.sphere(M.trim, 0.0052, [0.0125, -0.012, 0.070], null, null, 8);
    // hinge screws
    for (const sx of [-1, 1]) for (const [y, z] of [[0.055, -0.115], [0.008, 0.045]]) R.cyl(M.steel, 0.0032, 0.0032, 0.0034, 'x', [sx * 0.0192, y, z], null, 8);
    this.recv = R.build('receiver'); this.gun.add(this.recv);
    const rl = textDecal(['SZ-12  PUMP  12GA'], 0.090, 0.012, { px: 384, color: 'rgba(230,230,220,0.72)', size: 0.86 }); rl.position.set(-0.01925, 0.034, -0.075); rl.rotation.y = -Math.PI / 2; this.gun.add(rl);

    // ---- wood stock with wrist + butt pad + shell cuff
    F.profile(M.wood, [[0.062, 0.058, 0.004], [0.250, 0.055, 0.012], [0.310, 0.046, 0.006], [0.326, -0.082, 0.008], [0.300, -0.090, 0.006], [0.185, -0.052, 0.04], [0.124, -0.066, 0.024], [0.084, -0.046, 0.012], [0.062, 0.020, 0.004]], 0.036, [0, 0, 0], null, 0.003);
    F.box(M.check, [0.0022, 0.086, 0.048], [0.0175, -0.014, 0.100], [-0.12, 0, 0], 0.001);                // wrist checkering (both sides)
    F.box(M.check, [0.0022, 0.086, 0.048], [-0.0175, -0.014, 0.100], [-0.12, 0, 0], 0.001);
    F.box(M.rubber, [0.040, 0.142, 0.016], [0, -0.016, 0.322], [0.0, 0, 0], 0.005);                     // recoil pad
    F.box(M.dark, [0.034, 0.010, 0.0052], [0, 0.058, 0.076], null, 0.001);
    F.torus(M.steel, 0.0068, 0.0018, [0, -0.086, 0.245], [0, Math.PI / 2, 0], 14);                        // sling swivel
    // shell carrier cuff (left of the stock): nylon band + 4 shells
    F.box(M.black, [0.0050, 0.062, 0.100], [-0.0205, 0.020, 0.235], [0, 0, 0], 0.002);
    for (let i = 0; i < 4; i++) { const z = 0.198 + i * 0.024; F.cyl(M.shellRed, 0.0103, 0.0103, 0.018, 'x', [-0.0295, 0.028, z], null, 12); F.cyl(M.brass, 0.0106, 0.0106, 0.0045, 'x', [-0.0388, 0.028, z], null, 12); }

    // ---- pump group (slides on the magazine tube): wood fore-end, checkering, action bars, left hand
    PU.box(M.wood, [0.050, 0.043, 0.190], [0, 0.0145, -0.290], null, 0.014);
    PU.box(M.check, [0.0020, 0.026, 0.140], [0.0255, 0.0135, -0.292], null, 0.001);
    PU.box(M.check, [0.0020, 0.026, 0.140], [-0.0255, 0.0135, -0.292], null, 0.001);
    PU.box(M.check, [0.030, 0.0020, 0.130], [0, -0.0074, -0.292], null, 0.001);
    PU.box(M.dark, [0.052, 0.045, 0.0075], [0, 0.0145, -0.1975], null, 0.003);                           // rear cap
    PU.box(M.dark, [0.052, 0.045, 0.0075], [0, 0.0145, -0.3825], null, 0.003);                           // front cap
    for (const sx of [-1, 1]) PU.box(M.steel, [0.0034, 0.0042, 0.200], [sx * 0.0195, 0.034, -0.10], null, 0.001);
    this.pumpG = new THREE.Group(); this.gun.add(this.pumpG);
    // bolt (visible through the ejection port)
    const Bp = new Parts(); Bp.box(M.chrome, [0.0072, 0.0132, 0.044], [0, 0, 0], null, 0.002); Bp.box(M.dark, [0.0074, 0.0032, 0.010], [0, 0.0022, -0.012], null, 0.001);
    this.bolt = Bp.build('bolt'); this.bolt.position.set(0.0173, 0.0395, -0.062); this.gun.add(this.bolt);
    this.trigger = new THREE.Group(); this.trigger.position.set(0, -0.004, 0.024);
    const Tp = new Parts(); Tp.box(M.steel, [0.0060, 0.024, 0.0050], [0, -0.010, 0], [0.22, 0, 0], 0.002); this.trigger.add(Tp.build('trig')); this.gun.add(this.trigger);

    // ---- anchors
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.048, -0.728); this.gun.add(this.muzzle);
    this.port = new THREE.Object3D(); this.port.position.set(0.024, 0.040, -0.045); this.gun.add(this.port);
    this.flash = this.game.vfx.createFlash('shotgun'); this.muzzle.add(this.flash.object3d);

    // ---- hands
    this.handR = new Hand(kit, { side: 'R', freeze: true, keep: ['index'],
      pose: { i: [0.55, 0.65, 0.5], m: [1.38, 1.48, 0.95], r: [1.42, 1.52, 0.95], p: [1.4, 1.55, 0.9], t: { yaw: 0.10, pitch: -0.95, roll: 0.15, c: [0.10, 0.25, 0.30] } } });
    this.idxF = this.handR.find('index');
    this.handR.place([0.036, -0.018, 0.096], [0.12, 0.0, -1.5708]); this.gun.add(this.handR.group);
    this.handL = new Hand(kit, { side: 'L', freeze: true,
      pose: { i: [1.15, 1.35, 0.9], m: [1.2, 1.4, 0.95], r: [1.22, 1.4, 0.95], p: [1.2, 1.4, 0.9], t: { yaw: 0.25, pitch: -0.2, roll: 0.55, c: [0.15, 0.3, 0.3] } } });
    this.handL.place([0.0, -0.014, -0.292], [0.0, -1.15, 3.1416]); this.pumpG.add(this.handL.group);
    this.handR.bake(F, this.gun); this.handL.bake(PU, this.pumpG);
    this.stock = F.build('stock'); this.gun.add(this.stock); this.pumpG.add(PU.build('pump'));
    return model;
  }

  debugAt(t) { this._dbgT = t; }
  update(dt, ctx) { if (!this.game.__waWarm) warmup(this.game); trackFire(this, ctx); super.update(dt, ctx); }
  onSelect() { this.t = 99; this.pumpDone = true; this.ejected = true; this.pumpSnd = true; }
  onDeselect() { flashKill(this.game); }
  canSwitch() { return this.t > 0.30; }

  think(dt, ctx) {
    if (this.cool > 0 || this._dbgT !== null) return;
    if (!ctx.fire) return;
    if (dryFire(this, ctx)) return;
    this.shoot();
  }

  shoot() {
    const g = this.game;
    this.consume(1); this.held = true;
    this.cool = CYCLE; this.t = 0; this.pumpDone = false; this.ejected = false; this.pumpSnd = false;
    g.audio.play('shotgun');
    this.fireBullets({ count: 7, spreadH: 5.6 * D2R, spreadV: 0.45 * D2R, tracer: 'shotgun', damageType: 'shotgun', damage: () => 5 * randInt(1, 3), range: 70 });
    this.flash.fire(1);
    g.vfx.light(this.muzzleWorld(_p), 0xffb45a, 5, 0.09, 12); flashPulse(g, this.muzzle, 1.1);
    this.kickBack(0.05, 0.06, 0.035, 0.005);
    g.player.shake?.(0.35);
    bus.emit('weapon:fire', { id: this.id });
  }

  eject() {
    const g = this.game, b = camBasis(g);
    viewPointToWorld(g, this.port, _p);
    _v.set(0, 0, 0).addScaledVector(b.right, 1.9 + rand(0, 0.8)).addScaledVector(b.up, 1.6 + rand(0, 0.8)).addScaledVector(b.fwd, -0.4 + rand(-0.3, 0.3));
    g.vfx.shell(_p, _v, 'shotgun');
  }

  animate(dt, ctx) {
    const dbg = this._dbgT !== null;
    if (dbg) this.t = this._dbgT; else this.t += dt;
    const t = this.t, tt = t / TIC, tm = this.time, r = this.raise;
    if (!dbg) { this.flash.update(dt); flashDecay(this.game, dt); }
    // pump sound / ejection are event-driven off the animation clock
    if (!this.pumpSnd && tt >= 11) { this.pumpSnd = true; this.game.audio.play('shotgunPump'); }
    if (!this.ejected && tt >= 18.5) { this.ejected = true; this.eject(); }
    const pump = keyframe(PUMP_KEYS, tt, smooth);
    this.pump = pump;
    this.pumpG.position.z = pump * PUMP_TRAVEL;
    this.bolt.position.z = -0.062 + pump * PUMP_TRAVEL * 0.95;
    // shot -> trigger pull + muzzle flip; pump stroke -> small dip of the muzzle
    const trig = keyframe(K_TRIG, tt, smooth);
    this.trigger.rotation.x = -trig * 0.25; this.trigger.position.z = 0.024 + trig * 0.004;
    const idx = this.idxF; if (idx) { idx.joints[0].rotation.x = -(0.55 + trig * 0.22); idx.joints[1].rotation.x = -(0.65 + trig * 0.5); }
    const flip = keyframe(K_FLIP, tt, smooth);
    this.gun.rotation.set(flip * 0.05 + Math.sin(pump * Math.PI) * 0.012, 0, 0);
    this.gun.position.set(0, 0.004, -0.10 + flip * 0.02 + pump * 0.004);
    const vc = this.game.viewCamera; this.handR.pointArm(vc, 0.30, -0.80, 0.55); this.handL.pointArm(vc, -0.45, -0.80, 0.40);
    // breathing + raise tilt
    this.model.position.set(Math.sin(tm * 1.1) * 0.0009, Math.sin(tm * 1.6) * 0.0014, 0);
    this.model.rotation.set(-(1 - r) * 0.4 + Math.sin(tm * 1.3) * 0.002 + this.viewPitch, this.viewYaw, -(1 - r) * 0.12);
  }
}
