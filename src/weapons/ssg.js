// Super shotgun: engraved side-by-side double with external hammers, walnut furniture and a top lever. Doom II timing: 57 tics per shot
// (fire -> barrels break open [ssgOpen] -> spent hulls fly out -> left hand fetches + loads 2 shells [ssgLoad] -> snap shut [ssgClose]).
// 2 shells, 20 pellets x 5/10/15, +-11.2 deg horizontal / +-7 deg vertical spread.
import * as THREE from 'three';
import { Weapon } from './base.js';
import { bus, rand, randInt, TIC } from '../core.js';
import { getKit, Parts, Hand, D2R, smooth, keyframe, viewPointToWorld, camBasis, textDecal, trackFire, dryFire, flashPulse, flashDecay, flashKill , warmup } from './kit_a.js';

const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _hp = new THREE.Vector3();
const CYCLE = 57 * TIC;
const PIV = [0, 0.022, -0.100];                 // hinge pin (gun space)
const OPEN = -0.56;                             // barrel break angle (rad, muzzle down)
const bp = (x, y, z) => [x - PIV[0], y - PIV[1], z - PIV[2]];
// timelines in tics
const K_BARREL = [[0, 0], [10, 0], [16.5, 1], [38, 1], [43, 0], [57, 0]];   // open fraction
const K_AWAY = [[0, 0], [16, 0], [22, 1], [25, 1], [29.5, 0], [32.5, 0], [36, 1], [38, 1], [42, 0], [57, 0]];
const K_LOAD = [[0, 0], [25, 0], [29.5, 1], [32.5, 1], [35.5, 0], [57, 0]];
const K_HAM = [[0, 1], [0.8, 1], [1.8, 0], [12, 0], [15.5, 1], [57, 1]];       // hammer cock fraction (1 = cocked)
const K_LEVER = [[0, 0], [8, 0], [11, 1], [40, 1], [42.5, 0], [57, 0]];
const K_TRIG = [[0, 0], [1, 1], [7, 1], [12, 0]], K_FLIP = [[0, 0], [1.4, 1], [10, 0.2], [18, 0]];
const HOLD = [0.0, -0.002, -0.238], LOADP = [-0.006, 0.100, -0.030], AWAY = [-0.17, -0.26, -0.12];

export default class SuperShotgun extends Weapon {
  constructor(game) {
    super(game, { id: 'ssg', name: 'SUPER SHOTGUN', slot: 3, ammoType: 'shells', ammoPerShot: 2, raiseTime: 0.40, lowerTime: 0.24 });
    this.rest.set(0.12, -0.235, -0.55);
    // ADS: down the rib between the barrels, brass bead at the muzzle end (the two hammers frame the view)
    this.adsSpec = { fov: 62, vfov: 62, depth: 0.36, rear: [0, 0.14, 0.10], front: [0, 0.0662, -0.628], spread: 0.6 };
    this.t = 99; this._pf = false; this._edge = false; this._dbgT = null; this.held = false;
    this.ev = { open: true, eject: true, load: true, close: true, fresh: false };
  }

  buildModel() {
    const kit = getKit(this.game), M = kit.M;
    const model = new THREE.Group(); this.gun = new THREE.Group(); model.add(this.gun);
    this.gun.position.set(0, 0.004, -0.10);
    const R = new Parts(), F = new Parts(), BR = new Parts(), FE = new Parts();

    // ---- receiver / action (engraved case-hardened steel)
    R.box(M.engraved, [0.060, 0.062, 0.112], [0, 0.030, -0.040], null, 0.010);
    R.box(M.engraved, [0.036, 0.012, 0.150], [0, 0.062, -0.032], null, 0.005);                       // top strap / tang
    R.box(M.dark, [0.014, 0.0040, 0.064], [0, 0.0692, 0.006], null, 0.001);                          // rear tang plate
    for (const sx of [-1, 1]) {
      R.cyl(M.steel, 0.0072, 0.0072, 0.005, 'x', [sx * 0.0305, 0.024, -0.070], null, 16);            // side screw discs
      R.cyl(M.dark, 0.0032, 0.0032, 0.0052, 'x', [sx * 0.0306, 0.024, -0.070], null, 8);
      R.cyl(M.brass, 0.0055, 0.0055, 0.0045, 'x', [sx * 0.0304, 0.044, -0.004], null, 12);           // brass pin caps
      R.box(M.dark, [0.0030, 0.032, 0.010], [sx * 0.0300, 0.036, -0.093], null, 0.001);              // action-face seam
    }
    R.box(M.black, [0.050, 0.004, 0.006], [0, 0.0625, -0.098], null, 0.001);                          // breech-face slot
    // trigger guard (oval loop) + trigger
    R.torus(M.blued, 0.024, 0.0034, [0, -0.010, 0.020], [0, Math.PI / 2, 0], 26, [1.45, 1.0, 1]);
    R.box(M.blued, [0.0068, 0.012, 0.030], [0, 0.003, 0.014], null, 0.003);
    R.cyl(M.steel, 0.0036, 0.0036, 0.052, 'x', [0, 0.024, 0.043], null, 10);                          // rear action pin
    this.recv = R.build('action'); this.gun.add(this.recv);
    const rl = textDecal(['SZ-2  SUPER  12/70'], 0.066, 0.009, { px: 384, color: 'rgba(30,26,20,0.9)', size: 0.86, font: 'Georgia, serif', weight: 'bold' });
    rl.position.set(-0.0308, 0.046, -0.040); rl.rotation.y = -Math.PI / 2; this.gun.add(rl);

    // ---- stock (walnut, pistol wrist, steel grip cap)
    F.profile(M.wood, [[0.016, 0.060, 0.004], [0.120, 0.060, 0.010], [0.260, 0.052, 0.012], [0.310, 0.045, 0.006], [0.327, -0.085, 0.008], [0.300, -0.093, 0.006], [0.200, -0.056, 0.040], [0.134, -0.084, 0.030], [0.088, -0.062, 0.020], [0.074, -0.020, 0.010], [0.016, 0.004, 0.004]], 0.040, [0, 0, 0], null, 0.003);
    F.box(M.check, [0.0022, 0.080, 0.046], [0.0196, -0.026, 0.106], [-0.15, 0, 0], 0.001);
    F.box(M.check, [0.0022, 0.080, 0.046], [-0.0196, -0.026, 0.106], [-0.15, 0, 0], 0.001);
    F.box(M.steel, [0.034, 0.005, 0.040], [0, -0.085, 0.122], null, 0.002);
    F.box(M.rubber, [0.044, 0.142, 0.016], [0, -0.016, 0.324], null, 0.005);
    F.torus(M.brass, 0.0060, 0.0016, [0, -0.090, 0.212], [0, Math.PI / 2, 0], 14);
    F.box(M.brass, [0.030, 0.0026, 0.026], [0, 0.0612, 0.050], null, 0.001);                          // stock inlay

    // ---- hammers (external, cocked) + top lever
    const hp = new Parts();
    hp.profile(M.blued, [[0.004, 0.0, 0.002], [0.004, 0.022, 0.003], [0.014, 0.030, 0.002], [0.016, 0.024, 0.001], [0.006, 0.012, 0.001], [-0.004, 0.0, 0.002]], 0.0058, [0, 0, 0], null, 0.0008);
    this.hammers = [-1, 1].map((sx) => { const g = new THREE.Group(); g.position.set(sx * 0.0195, 0.0645, 0.008); g.add(hp.build('hammer' + sx)); this.gun.add(g); return g; });
    const lp = new Parts();
    lp.box(M.blued, [0.0100, 0.0050, 0.062], [0, 0, -0.030], null, 0.002); lp.cyl(M.blued, 0.0074, 0.0074, 0.0052, 'y', [0, 0, 0.004], null, 12); lp.box(M.steel, [0.0080, 0.0030, 0.014], [0, 0.0022, -0.056], null, 0.001);
    this.lever = new THREE.Group(); this.lever.position.set(0, 0.0722, 0.024); this.lever.add(lp.build('lever')); this.gun.add(this.lever);

    // ---- barrels + fore-end (one group hinged on the pin)
    for (const sx of [-1, 1]) {
      BR.cyl(M.blued, 0.0128, 0.0128, 0.545, 'z', bp(sx * 0.0150, 0.042, -0.3725), null, 22);
      BR.cyl(M.steel, 0.0138, 0.0138, 0.016, 'z', bp(sx * 0.0150, 0.042, -0.6375), null, 22);        // muzzle collar
      BR.cyl(M.black, 0.0107, 0.0107, 0.0046, 'z', bp(sx * 0.0150, 0.042, -0.6448), null, 16);       // bore
      BR.cyl(M.black, 0.0112, 0.0112, 0.0022, 'z', bp(sx * 0.0150, 0.042, -0.0992), null, 16);       // chamber face
    }
    BR.box(M.dark, [0.0075, 0.0068, 0.520], bp(0, 0.0555, -0.382), null, 0.0015);                      // rib between the barrels
    for (let i = 0; i < 18; i++) BR.box(M.black, [0.0050, 0.0070, 0.0040], bp(0, 0.0558, -0.14 - i * 0.026), null, 0.0004);
    BR.sphere(M.brass, 0.0042, bp(0, 0.0620, -0.628), null, null, 10);
    BR.sphere(M.white, 0.0020, bp(0, 0.0596, -0.420), null, null, 8);
    BR.box(M.blued, [0.062, 0.032, 0.034], bp(0, 0.036, -0.116), null, 0.005);                         // barrel lump / breech block
    BR.cyl(M.steel, 0.0052, 0.0052, 0.066, 'x', bp(0, 0.022, -0.100), null, 12);                        // hinge pin
    BR.torus(M.steel, 0.0070, 0.0018, bp(0, 0.030, -0.575), [0, Math.PI / 2, 0], 14);                  // barrel band ring
    BR.box(M.dark, [0.060, 0.050, 0.012], bp(0, 0.036, -0.575), null, 0.004);                          // barrel band
    // fore-end beavertail (wood + checkering + latch)
    FE.box(M.wood, [0.060, 0.034, 0.205], bp(0, 0.0125, -0.2375), null, 0.012);
    FE.box(M.check, [0.0020, 0.020, 0.150], bp(0.0308, 0.0125, -0.235), null, 0.001);
    FE.box(M.check, [0.0020, 0.020, 0.150], bp(-0.0308, 0.0125, -0.235), null, 0.001);
    FE.box(M.check, [0.032, 0.0020, 0.140], bp(0, -0.0052, -0.235), null, 0.001);
    FE.box(M.dark, [0.062, 0.036, 0.008], bp(0, 0.0125, -0.3400), null, 0.003);
    FE.cyl(M.steel, 0.0072, 0.0072, 0.005, 'y', bp(0, -0.0068, -0.318), null, 12);
    this.barrelsG = new THREE.Group(); this.barrelsG.position.set(PIV[0], PIV[1], PIV[2]);
    this.barrelsG.add(BR.build('barrels')); this.barrelsG.add(FE.build('foreend')); this.gun.add(this.barrelsG);
    // chamber hulls: spent (visible after the shot until they pop out) and fresh (after loading)
    const mkHulls = (matHull) => {
      const H = new Parts();
      for (const sx of [-1, 1]) { H.cyl(matHull, 0.0122, 0.0122, 0.034, 'z', bp(sx * 0.0150, 0.042, -0.0835), null, 16); H.cyl(M.brass, 0.0134, 0.0134, 0.0055, 'z', bp(sx * 0.0150, 0.042, -0.0655), null, 16); H.cyl(M.dark, 0.0036, 0.0036, 0.0016, 'z', bp(sx * 0.0150, 0.042, -0.0625), null, 8); }
      return H.build('hulls');
    };
    this.hullsSpent = mkHulls(M.shellSpent); this.hullsFresh = mkHulls(M.shellRed);
    this.barrelsG.add(this.hullsSpent); this.barrelsG.add(this.hullsFresh); this.hullsSpent.visible = false; this.hullsFresh.visible = false;
    this.chamber = [-1, 1].map((sx) => { const o = new THREE.Object3D(); o.position.set(...bp(sx * 0.0150, 0.042, -0.070)); this.barrelsG.add(o); return o; });
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(...bp(0, 0.042, -0.652)); this.barrelsG.add(this.muzzle);
    this.flash = this.game.vfx.createFlash('ssg'); this.muzzle.add(this.flash.object3d);

    // ---- hands: right on the wrist, left under the fore-end (detaches to fetch shells)
    this.handR = new Hand(kit, { side: 'R', freeze: true, keep: ['index'],
      pose: { i: [0.55, 0.65, 0.5], m: [1.4, 1.5, 0.95], r: [1.44, 1.52, 0.95], p: [1.4, 1.55, 0.9], t: { yaw: 0.10, pitch: -0.95, roll: 0.15, c: [0.10, 0.25, 0.30] } } });
    this.idxF = this.handR.find('index');
    this.handR.place([0.036, -0.022, 0.104], [0.14, 0.0, -1.5708]); this.gun.add(this.handR.group); this.handR.bake(F, this.gun); this.stock = F.build('stock'); this.gun.add(this.stock);
    this.handL = new Hand(kit, { side: 'L', freeze: true,
      pose: { i: [1.15, 1.35, 0.9], m: [1.2, 1.4, 0.95], r: [1.22, 1.4, 0.95], p: [1.2, 1.4, 0.9], t: { yaw: 0.25, pitch: -0.2, roll: 0.55, c: [0.15, 0.3, 0.3] } } });
    this.gun.add(this.handL.group);
    // shells carried in the left hand
    const S = new Parts();
    for (const sx of [-1, 1]) { S.cyl(M.shellRed, 0.0118, 0.0118, 0.050, 'z', [sx * 0.0135, 0, 0], null, 14); S.cyl(M.brass, 0.0128, 0.0128, 0.016, 'z', [sx * 0.0135, 0, 0.032], null, 14); }
    this.handShells = S.build('handShells'); this.handShells.visible = false; this.gun.add(this.handShells);

    // ---- trigger + lanyard
    this.trigger = new THREE.Group(); this.trigger.position.set(0, 0.004, 0.030);
    const Tp = new Parts(); Tp.box(M.steel, [0.0064, 0.024, 0.0052], [0, -0.009, 0], [0.22, 0, 0], 0.002); this.trigger.add(Tp.build('trig')); this.gun.add(this.trigger);
    this.port = new THREE.Object3D(); this.port.position.set(0, 0.05, -0.02); this.gun.add(this.port);
    return model;
  }

  debugAt(t) { this._dbgT = t; if (t !== null) this.ev = { open: true, eject: true, load: true, close: true, fresh: false }; }
  update(dt, ctx) { if (!this.game.__waWarm) warmup(this.game); trackFire(this, ctx); super.update(dt, ctx); }
  onSelect() { this.t = 99; this.ev = { open: true, eject: true, load: true, close: true, fresh: false }; }
  onDeselect() { flashKill(this.game); }
  canSwitch() { return this.t > 0.5; }

  think(dt, ctx) {
    if (this.cool > 0 || this._dbgT !== null || !ctx.fire) return;
    if (dryFire(this, ctx)) return;
    this.shoot();
  }

  shoot() {
    const g = this.game;
    this.consume(2); this.held = true;
    this.cool = CYCLE; this.t = 0; this.ev = { open: false, eject: false, load: false, close: false, fresh: false };
    g.audio.play('ssg');
    this.fireBullets({ count: 20, spreadH: 11.2 * D2R, spreadV: 7 * D2R, tracer: 'shotgun', damageType: 'shotgun', damage: () => 5 * randInt(1, 3), range: 60 });
    this.flash.fire(1.35);
    g.vfx.light(this.muzzleWorld(_p), 0xffa84a, 8, 0.11, 14); flashPulse(g, this.muzzle, 1.9);
    this.kickBack(0.085, 0.10, 0.07, 0.010);
    g.player.shake?.(0.75);
    bus.emit('weapon:fire', { id: this.id });
  }

  ejectHulls() {
    const g = this.game, b = camBasis(g);
    for (let i = 0; i < 2; i++) {
      viewPointToWorld(g, this.chamber[i], _p);
      _v.set(0, 0, 0).addScaledVector(b.right, (i ? 1.6 : 0.3) + rand(-0.4, 0.4)).addScaledVector(b.up, 2.4 + rand(0, 0.8)).addScaledVector(b.fwd, 0.3 + rand(-0.4, 0.4));
      g.vfx.shell(_p, _v, 'shotgun');
    }
  }

  animate(dt, ctx) {
    const dbg = this._dbgT !== null;
    if (dbg) this.t = this._dbgT; else this.t += dt;
    const tt = this.t / TIC, tm = this.time, r = this.raise, ev = this.ev;
    if (!dbg) { this.flash.update(dt); flashDecay(this.game, dt); }
    // event-driven audio / effects tied to the animation clock
    if (!ev.open && tt >= 10) { ev.open = true; this.game.audio.play('ssgOpen'); }
    if (!ev.eject && tt >= 16) { ev.eject = true; this.ejectHulls(); }
    if (!ev.load && tt >= 30) { ev.load = true; ev.fresh = true; this.game.audio.play('ssgLoad'); }
    if (!ev.close && tt >= 41) { ev.close = true; this.game.audio.play('ssgClose'); this.kickBack(0.012, 0.03, 0.004, 0); }
    const open = keyframe(K_BARREL, tt, smooth);
    const ang = OPEN * open;
    this.barrelsG.rotation.x = ang;
    this.hullsSpent.visible = tt >= 10.5 && tt < 16.2 && open > 0.05 && this.t < 3;
    this.hullsFresh.visible = ev.fresh && tt >= 30 && tt < 42.5 && open > 0.05;
    // hammers + lever
    const ham = keyframe(K_HAM, tt, smooth);
    for (const h of this.hammers) h.rotation.x = 0.62 * ham;
    this.lever.rotation.y = -0.55 * keyframe(K_LEVER, tt, smooth);
    // trigger
    const trig = keyframe(K_TRIG, tt, smooth);
    this.trigger.rotation.x = -trig * 0.25; this.trigger.position.z = 0.030 + trig * 0.004;
    const idx = this.idxF; if (idx) { idx.joints[0].rotation.x = -(0.55 + trig * 0.22); idx.joints[1].rotation.x = -(0.65 + trig * 0.5); }
    // left hand: holds the fore-end (follows the hinge), leaves to fetch shells, cups them into the open chambers, returns
    let wA = keyframe(K_AWAY, tt, smooth), wL = keyframe(K_LOAD, tt, smooth); const sum = wA + wL; if (sum > 1) { wA /= sum; wL /= sum; }
    const wH = 1 - wA - wL;
    // hold position rotated about the hinge by the current barrel angle
    const c = Math.cos(ang), s = Math.sin(ang), hy = HOLD[1] - PIV[1], hz = HOLD[2] - PIV[2];
    const hx0 = HOLD[0], hy0 = PIV[1] + hy * c - hz * s, hz0 = PIV[2] + hy * s + hz * c;
    const px = hx0 * wH + AWAY[0] * wA + LOADP[0] * wL, py = hy0 * wH + AWAY[1] * wA + LOADP[1] * wL, pz = hz0 * wH + AWAY[2] * wA + LOADP[2] * wL;
    const rx = ang * wH + (-0.25) * wA + (OPEN * 1.0 - 0.5) * wL;
    this.handL.placeN(px, py, pz, rx, -1.15 + 0.2 * wL, 3.1416 - 0.5 * wL);
    this.handShells.visible = tt >= 21 && tt < 30.2;
    if (this.handShells.visible) { this.handShells.position.set(px + 0.0, py + 0.03, pz - 0.035 + wL * -0.02); this.handShells.rotation.set(OPEN * 0.9 * (wL + 0.2), 0, 0); }
    const vc = this.game.viewCamera; this.handR.pointArm(vc, 0.30, -0.80, 0.55); this.handL.pointArm(vc, -0.45, -0.80, 0.40);
    // recoil flip, break-open tilt (gun rolls so the breech faces the player), breathing, raise
    const flip = keyframe(K_FLIP, tt, smooth);
    const tilt = open;
    const rk = this.recoilK; // x0.7 while aimed
    this.gun.rotation.set(flip * 0.07 * rk + tilt * 0.26, tilt * 0.05, -tilt * 0.24);
    this.gun.position.set(-tilt * 0.015, 0.004 - tilt * 0.03, -0.10 + flip * 0.03 * rk + tilt * 0.03);
    this.model.position.set(Math.sin(tm * 1.1) * 0.0009, Math.sin(tm * 1.6) * 0.0014, 0);
    this.model.rotation.set(-(1 - r) * 0.4 + Math.sin(tm * 1.3) * 0.002 + this.viewPitch, this.viewYaw, -(1 - r) * 0.12);
  }
}
