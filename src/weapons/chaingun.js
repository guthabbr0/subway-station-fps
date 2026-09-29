// Chaingun: belt-fed six-barrel rotary. 1 bullet / 4 tics (8.75/s), 5/10/15 dmg, first shot accurate then +-5.6deg spread.
// Model: painted receiver + motor housing, perforated barrel shroud around a spinning rotor (6 barrels, 3 clamps), link belt of visible brass/copper rounds
// feeding from an ammo box, carry handle, pistol grip + foregrip (kit_a gloved hands), LCD + heat LED, barrels glowing from heat, alternating muzzle flash.
import * as THREE from 'three';
import { Weapon } from './base.js';
import { TIC, bus, clamp, damp, rand, randInt } from '../core.js';
import * as K from './kitb.js';
import { warmup, viewPointToWorld, camBasis, keyframe, smooth } from './kit_a.js';

const _o = new THREE.Vector3(), _v = new THREE.Vector3();
const Y0 = 0.03;                 // barrel axis height in gun space
const SPIN_MAX = 12;             // rad/s at full speed
const BELT_N = 12, PITCH = 0.0162;
const PATH = [[-0.106, 0.026, 0.112], [-0.106, 0.070, 0.108], [-0.095, 0.091, 0.088], [-0.082, 0.083, 0.062], [-0.078, 0.073, 0.040], [-0.078, 0.071, 0.010], [-0.078, 0.071, -0.024], [-0.078, 0.071, -0.060]];
const _dummy = new THREE.Object3D();
const K_TRIG = [[0, 0], [0.02, 1], [0.12, 1], [0.2, 0]];

export default class Chaingun extends Weapon {
  constructor(game) {
    super(game, { id: 'chaingun', name: 'CHAINGUN', slot: 4, ammoType: 'bullets', ammoPerShot: 1, raiseTime: 0.36, lowerTime: 0.26 });
    this.rest.set(0.14, -0.15, -0.70);
    // ADS: over the carry handle, the crosshair on the centre of the barrel cluster / shroud rim
    this.adsSpec = { fov: 60, vfov: 60, depth: 0.6, rear: [0, 0.20, 0.13], front: [0, 0.05, -0.668], spread: 0.45 };
    this.nextShot = 0; this.spin = 0; this.spinAngle = 0; this.refire = 0; this.emptyT = 0; this.heat = 0; this.hot = 0; this.beltPos = 0; this.beltTarget = 0; this.smokeT = 0;
    this.trigT = 9; this.side = 1; this.ammoShown = -1; this._dbg = null;
  }

  buildModel() {
    const g = this.game, kit = K.getKit(g), HR = K.getHero(g), M = kit.M, H = HR.H, model = new THREE.Group();
    this.gun = new THREE.Group(); model.add(this.gun); this.gun.position.set(0, 0.0, 0);
    const B = new K.HParts(), F = new K.HParts(), G = this.gun;   // B = body, F = frame parts that also receive the baked hands
    const gm = H.gunmetal, ol = H.olive;

    // ================================================================ receiver ==============================================================
    B.box(gm, [0.088, 0.120, 0.300], [0, 0.015, -0.015], null, 0.010);
    B.box(M.dark, [0.076, 0.016, 0.215], [0, 0.0865, 0.010], null, 0.006);                      // top cover
    B.box(M.steel, [0.052, 0.005, 0.190], [0, 0.0955, 0.012], null, 0.002);                      // brushed top plate
    for (let i = 0; i < 7; i++) B.box(M.dark, [0.056, 0.0028, 0.0035], [0, 0.0985, -0.062 + i * 0.0225], null, 0);   // cover ribs
    B.box(M.dark, [0.022, 0.010, 0.014], [0, 0.088, -0.104], null, 0.002); B.box(M.steel, [0.012, 0.004, 0.006], [0, 0.0945, -0.104], null, 0.001);   // front cover latch
    for (const sx of [-1, 1]) {
      B.box(M.dark, [0.005, 0.088, 0.242], [sx * 0.0465, 0.010, 0.004], null, 0.002);            // side plates
      for (const [y, z] of [[0.045, 0.108], [-0.020, 0.108], [0.045, -0.100], [-0.020, -0.100]]) B.screw(M.steel, M.black, 0.0052, [sx * 0.0500, y, z], 'x');
      B.box(M.steel, [0.0022, 0.004, 0.10], [sx * 0.0492, 0.056, 0.006], null, 0);
    }
    B.box(M.dark, [0.092, 0.116, 0.016], [0, 0.015, 0.1465], null, 0.004);                      // rear plate
    B.cyl(M.steel, 0.0225, 0.0225, 0.014, 'z', [0, 0.012, 0.160], null, 16);                      // buffer cap
    B.cyl(M.black, 0.011, 0.011, 0.002, 'z', [0, 0.012, 0.1675], null, 12);
    B.boltCircle(M.steel, 0, 0.012, 0.155, 0.033, 6, 0.0032, 0.004, 0.3, 8);
    for (const sx of [-1, 1]) { for (let i = 0; i < 3; i++) B.box(M.black, [0.018, 0.0055, 0.0035], [sx * 0.031, 0.048 - i * 0.0125, 0.1545], null, 0.0006); B.screw(M.steel, M.black, 0.0046, [sx * 0.040, -0.030, 0.1548], 'z'); B.screw(M.steel, M.black, 0.0046, [sx * 0.040, 0.058, 0.1548], 'z'); }
    B.box(M.steel, [0.028, 0.004, 0.006], [0, 0.066, 0.1545], null, 0.001);                       // rear latch bar
    B.cyl(M.steel, 0.0065, 0.0065, 0.086, 'x', [0, 0.0665, 0.1235], null, 10);                       // top cover hinge barrel
    B.box(M.dark, [0.014, 0.010, 0.012], [0.024, -0.026, 0.1545], null, 0.001);                    // (rear) sling stud
    // ejection port (right) with spring dust cover
    B.box(M.black, [0.004, 0.030, 0.070], [0.0468, 0.030, 0.030], null, 0.001);
    B.box(M.steel, [0.0032, 0.007, 0.058], [0.0490, 0.049, 0.030], null, 0.001);
    B.box(M.dark, [0.0030, 0.026, 0.010], [0.0498, 0.028, 0.068], [0, 0, 0.35], 0.001);
    // feed tray + cover (left) that swallows the end of the belt
    B.box(M.dark, [0.062, 0.007, 0.166], [-0.079, 0.0605, 0.028], null, 0.002);
    B.box(gm, [0.060, 0.036, 0.052], [-0.075, 0.074, -0.034], null, 0.006);
    B.box(M.steel, [0.030, 0.004, 0.040], [-0.086, 0.0935, -0.034], null, 0.001);
    B.box(M.black, [0.004, 0.010, 0.046], [-0.1045, 0.071, -0.034], null, 0.001);
    B.cyl(M.steel, 0.0048, 0.0048, 0.006, 'y', [-0.052, 0.098, -0.034], null, 10);               // cover latch pin
    // bracket + ammo box (left, rear)
    B.box(M.dark, [0.034, 0.050, 0.090], [-0.064, -0.012, 0.085], null, 0.004);
    B.box(ol, [0.062, 0.096, 0.112], [-0.108, 0.004, 0.084], null, 0.006);
    B.box(M.dark, [0.066, 0.008, 0.116], [-0.108, 0.052, 0.084], null, 0.003);                   // lid rim
    B.box(M.dark, [0.056, 0.005, 0.030], [-0.108, 0.0575, 0.100], null, 0.002);                  // belt slot cover
    for (const z of [0.040, 0.128]) { B.box(M.steel, [0.004, 0.030, 0.012], [-0.1405, 0.030, z], null, 0.002); B.cyl(M.steel, 0.0032, 0.0032, 0.006, 'x', [-0.1425, 0.036, z], null, 8); }
    B.box(M.dark, [0.004, 0.012, 0.040], [-0.1405, -0.036, 0.084], null, 0.002);                 // handle plate
    B.boltCircle(M.steel, -0.108, 0.004, 0.141, 0.042, 4, 0.004, 0.006, 0.78, 8);
    // selector switch + safety (left, rear) + LED
    B.cyl(M.steel, 0.0085, 0.0085, 0.006, 'x', [-0.0505, 0.006, 0.112], null, 14);
    B.box(M.rubber, [0.008, 0.004, 0.026], [-0.0555, 0.006, 0.112], [0, 0, 0.5], 0.001);
    B.box(H.redVC, [0.004, 0.004, 0.004], [-0.0505, 0.020, 0.112], null, 0);

    // ================================================================ motor / gear housing ==================================================
    B.lathe2(gm, [[0, 0.165], [0.064, 0.165], [0.064, 0.176], [0.0605, 0.176], [0.0605, 0.262], [0.0655, 0.262], [0.0655, 0.278], [0.0585, 0.278], [0.0585, 0.288], [0.0, 0.288]], [0, Y0, 0], null, 32);
    for (let i = 0; i < 5; i++) B.torus(M.steel, 0.0612, 0.0028, [0, Y0, -0.193 - i * 0.0125], null, 32);
    B.boltCircle(M.steel, 0, Y0, -0.2795, 0.0605, 12, 0.0033, 0.005, 0.1, 8);
    B.cyl(H.hazardN, 0.0618, 0.0618, 0.028, 'z', [0, Y0, -0.237], null, 32);                          // hazard band
    B.cyl(M.dark, 0.036, 0.036, 0.006, 'z', [0, Y0, -0.291], null, 24);                            // rotor bearing plate
    // gear-reduction pod + cooling slots (left) and cable socket (top)
    B.cyl(gm, 0.030, 0.030, 0.030, 'x', [-0.060, Y0 - 0.004, -0.205], null, 20);
    B.cyl(M.steel, 0.020, 0.020, 0.006, 'x', [-0.078, Y0 - 0.004, -0.205], null, 16);
    for (let i = 0; i < 6; i++) B.box(M.black, [0.004, 0.024, 0.006], [-0.0625, Y0 + 0.030, -0.236 - i * 0.0075], null, 0.0005);
    B.cyl(M.dark, 0.014, 0.014, 0.022, 'y', [0.016, Y0 + 0.064, -0.170], null, 14);
    B.torus(M.brass, 0.0128, 0.002, [0.016, Y0 + 0.0755, -0.170], [Math.PI / 2, 0, 0], 14);

    // ================================================================ shroud (perforated, rotor visible through it) =========================
    this.shroudTex = K.perforatedTexture({ w: 256, h: 128, seed: 4, pitchX: 16, pitchY: 16, rad: 4.8 }); this.shroudTex.repeat.set(3, 2);
    const shroudMat = new THREE.MeshStandardMaterial({ map: this.shroudTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.75, envMap: HR.env, envMapIntensity: 1.3 }); shroudMat.userData.native = true;
    B.cyl(shroudMat, 0.0545, 0.0545, 0.205, 'z', [0, Y0, -0.3895], null, 40, true);
    B.torus(M.steel, 0.0548, 0.0036, [0, Y0, -0.2905], null, 36); B.torus(M.steel, 0.0548, 0.0036, [0, Y0, -0.4885], null, 36);
    B.torus(M.dark, 0.0548, 0.0030, [0, Y0, -0.390], null, 36);
    B.cyl(M.steel, 0.0585, 0.0585, 0.008, 'z', [0, Y0, -0.4925], null, 36);                       // front lip
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; B.box(M.dark, [0.006, 0.006, 0.20], [Math.cos(a) * 0.0545, Y0 + Math.sin(a) * 0.0545, -0.3895], [0, 0, a], 0.001); }   // longitudinal ribs

    // ================================================================ top handle, sights ====================================================
    for (const z of [0.070, -0.110]) { B.box(M.dark, [0.016, 0.052, 0.020], [0, 0.113, z], null, 0.003); B.box(M.steel, [0.020, 0.006, 0.026], [0, 0.093, z], null, 0.002); }
    B.cyl(M.rubber, 0.0135, 0.0135, 0.150, 'z', [0, 0.143, -0.020], null, 14);
    for (let i = 0; i < 6; i++) B.torus(M.black, 0.0138, 0.0016, [0, 0.143, -0.078 + i * 0.0225], null, 14);
    B.cyl(M.steel, 0.0128, 0.0128, 0.010, 'z', [0, 0.143, -0.100], null, 14); B.cyl(M.steel, 0.0128, 0.0128, 0.010, 'z', [0, 0.143, 0.060], null, 14);
    B.box(M.black, [0.030, 0.016, 0.022], [0, 0.1035, 0.128], null, 0.003); B.box(M.steel, [0.004, 0.022, 0.006], [0, 0.118, 0.134], null, 0.001);   // rear sight
    B.box(M.dark, [0.020, 0.006, 0.030], [0, 0.100, -0.150], null, 0.002);                       // heat-shield rail stub

    // ================================================================ grips =================================================================
    F.box(M.rubber, [0.036, 0.118, 0.052], [0, -0.112, 0.078], [-0.30, 0, 0], 0.006);
    F.box(M.stipple, [0.0018, 0.090, 0.040], [0.0186, -0.108, 0.076], [-0.30, 0, 0], 0.0006); F.box(M.stipple, [0.0018, 0.090, 0.040], [-0.0186, -0.108, 0.076], [-0.30, 0, 0], 0.0006);
    F.box(M.dark, [0.042, 0.020, 0.062], [0, -0.052, 0.062], null, 0.004);                       // fire-control housing
    F.box(M.steel, [0.034, 0.006, 0.048], [0, -0.171, 0.100], [-0.30, 0, 0], 0.002);             // grip cap
    F.torus(M.blued, 0.024, 0.0034, [0, -0.043, 0.006], [0, Math.PI / 2, 0], 24, [1.5, 1, 1]);    // trigger guard loop
    F.box(M.dark, [0.010, 0.014, 0.030], [0, -0.058, 0.032], null, 0.002);
    F.box(M.dark, [0.030, 0.030, 0.050], [0, -0.055, -0.185], null, 0.004);                      // foregrip mount
    F.torus(M.steel, 0.0625, 0.005, [0, Y0, -0.2145], null, 32);
    F.cyl(M.rubber, 0.0198, 0.0192, 0.112, 'y', [0, -0.118, -0.185], null, 16);
    for (let i = 0; i < 5; i++) F.torus(M.black, 0.0199, 0.0014, [0, -0.083 - i * 0.019, -0.185], [Math.PI / 2, 0, 0], 16);
    F.cyl(M.dark, 0.0215, 0.0215, 0.008, 'y', [0, -0.178, -0.185], null, 16);
    F.cyl(M.dark, 0.0225, 0.0225, 0.006, 'y', [0, -0.064, -0.185], null, 16);

    // ================================================================ hands (right: trigger, left: foregrip) =================================
    this.handR = K.gripHand(kit, 'R', G, F, [0.0395, -0.076, 0.086], [0.30, 0, -Math.PI / 2], K.POSE_TRIGGER, { sleeveLen: 0.6 });
    this.idxF = this.handR.find('index');
    this.handL = K.gripHand(kit, 'L', G, F, [-0.038, -0.118, -0.161], [0.0, 0, Math.PI / 2], K.POSE_GRIP, { sleeveLen: 0.6 });
    this.bodyG = B.build('body'); G.add(this.bodyG);
    this.frameG = F.build('frame'); G.add(this.frameG);

    // trigger (animated)
    this.trigger = new THREE.Group(); this.trigger.position.set(0, -0.046, 0.006); G.add(this.trigger);
    { const T = new K.HParts(); T.box(M.blued, [0.007, 0.028, 0.006], [0, -0.013, 0], [0.25, 0, 0], 0.002); T.box(M.steel, [0.004, 0.012, 0.004], [0, -0.010, -0.003], [0.25, 0, 0], 0.001); this.trigger.add(T.build('trig')); }

    // ================================================================ decals ================================================================
    const D = new K.DecalSheet(g, 1024, 512);
    const rHead = D.text(512, 96, ['M-9  CHAINGUN', '5.56 x 45 · BELT FED · STATION ZERO ARMORY'], { color: 'rgba(238,232,206,0.9)', size: 0.5 });
    const rWarn = D.text(320, 64, ['CAUTION', 'ROTATING BARRELS'], { color: 'rgba(24,22,16,0.95)', bg: 'rgba(218,170,30,0.94)', border: 'rgba(24,22,16,0.9)', size: 0.5, bw: 4 });
    const rBox = D.text(384, 160, ['CAL 5.56 x 45', 'LOT 44-B  ·  200 RDS', 'KEEP DRY'], { color: 'rgba(240,226,150,0.92)', size: 0.55, border: 'rgba(240,226,150,0.8)', bw: 4 });
    const rSer = D.text(200, 40, 'SN 09-5521-A', { color: 'rgba(230,230,220,0.75)', size: 0.7, weight: 'normal' });
    const rPlate = D.text(240, 104, ['M-9', 'CHAINGUN', 'CAL 5.56 · 8.75 RPS'], { color: 'rgba(230,226,204,0.85)', size: 0.62, border: 'rgba(230,226,204,0.6)', bw: 3 });
    const rHot = D.text(256, 48, 'HOT  ·  DO NOT TOUCH', { color: 'rgba(232,90,40,0.95)', size: 0.6 });
    D.plane(rHead, 0.130, 0.032, [-0.0502, 0.030, -0.066], 'x-');
    D.plane(rSer, 0.044, 0.008, [-0.0502, -0.024, -0.100], 'x-');
    D.plane(rPlate, 0.048, 0.021, [0, 0.055, 0.1554], 'z+');
    D.wrap(rWarn, 0.0623, 0.62, 0.062, -0.225, 0.0, 0, Y0);
    D.plane(rBox, 0.092, 0.038, [-0.1395, 0.002, 0.084], 'x-');
    D.plane(rHot, 0.070, 0.013, [0, 0.0982, 0.030], 'y+');
    this.decals = D.build('decals'); G.add(this.decals);

    // ================================================================ rotor: 6 barrels + clamps + shaft =====================================
    const ringsTex = K.ringsTexture(9); ringsTex.repeat.set(1, 3);
    this.barrelMat = new THREE.MeshStandardMaterial({ map: ringsTex, roughness: 0.4, metalness: 0.92, envMap: HR.env, envMapIntensity: 1.5, emissive: new THREE.Color(1.0, 0.42, 0.10), emissiveMap: K.heatGradient(), emissiveIntensity: 0 });
    this.barrelMat.userData.native = true;
    const Rr = new K.HParts(), BR = 0.030;
    this.rotor = new THREE.Group(); this.rotor.position.set(0, Y0, 0); G.add(this.rotor);
    Rr.cyl(M.steel, 0.012, 0.014, 0.40, 'z', [0, 0, -0.485], null, 16);                                    // central shaft
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2, x = Math.cos(a) * BR, y = Math.sin(a) * BR;
      Rr.cyl(this.barrelMat, 0.0113, 0.0118, 0.385, 'z', [x, y, -0.4725], null, 12);
      Rr.cyl(M.dark, 0.0146, 0.0146, 0.016, 'z', [x, y, -0.6575], null, 12);                                // muzzle rim
      Rr.cyl(M.black, 0.0088, 0.0088, 0.0022, 'z', [x, y, -0.6660], null, 10);                             // bore
      Rr.cyl(M.steel, 0.0130, 0.0130, 0.008, 'z', [x, y, -0.5100], null, 12);
      Rr.cyl(M.steel, 0.0130, 0.0130, 0.006, 'z', [x, y, -0.6000], null, 12);
    }
    for (const [z, R, w] of [[-0.300, 0.046, 0.016], [-0.395, 0.046, 0.014], [-0.560, 0.049, 0.018]]) {
      Rr.cyl(M.dark, R, R, w, 'z', [0, 0, z], null, 24);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; Rr.cyl(M.steel, 0.0175, 0.0175, w + 0.002, 'z', [Math.cos(a) * BR, Math.sin(a) * BR, z], null, 12); }
      for (let i = 0; i < 6; i++) { const a = (i + 0.5) / 6 * Math.PI * 2; Rr.box(M.black, [0.008, 0.006, w + 0.001], [Math.cos(a) * 0.043, Math.sin(a) * 0.043, z], [0, 0, a], 0); }
    }
    Rr.torus(M.steel, 0.049, 0.005, [0, 0, -0.5695], null, 28);
    this.rotor.add(Rr.build('rotor'));
    this.blurMat = new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const blur = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.24, 24, 1, true).rotateX(Math.PI / 2), this.blurMat); blur.position.set(0, Y0, -0.545); blur.frustumCulled = false; G.add(blur);

    // ================================================================ ammo belt (instanced rounds + links) ===================================
    const RP = new K.HParts();
    RP.cyl(H.brassBright, 0.0056, 0.0060, 0.028, 'x', [-0.007, 0, 0], null, 10); RP.cyl(H.brassBright, 0.0066, 0.0066, 0.003, 'x', [-0.021, 0, 0], null, 10);
    RP.cyl(H.copper, 0.0013, 0.0052, 0.017, 'x', [0.0155, 0, 0], null, 10);
    RP.torus(H.steelVC, 0.0064, 0.0012, [-0.004, 0, 0], [0, Math.PI / 2, 0], 10); RP.torus(H.steelVC, 0.0064, 0.0012, [0.004, 0, 0], [0, Math.PI / 2, 0], 10);
    RP.box(H.steelVC, [0.0075, 0.0022, PITCH], [0, 0.0070, 0], null, 0);
    this.belt = new THREE.InstancedMesh(RP.geometry(M.vcMetal), M.vcMetal, BELT_N); this.belt.frustumCulled = false; G.add(this.belt);
    // arc-length lookup of the belt path
    const curve = new THREE.CatmullRomCurve3(PATH.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.5), NS = 96; this.pathLen = curve.getLength(); this.pathPts = new Float32Array((NS + 1) * 4);
    for (let i = 0; i <= NS; i++) { const u = i / NS, p = curve.getPointAt(u), t = curve.getTangentAt(u); this.pathPts.set([p.x, p.y, p.z, Math.atan2(-Math.sign(t.z || -1) * t.y, Math.abs(t.z) + 1e-6)], i * 4); }
    this.NS = NS; this.updateBelt();

    // ================================================================ LCD + LEDs ============================================================
    this.lcd = new K.LCD(192, 72, (ctx, w, h, key, n, hot) => {
      ctx.fillStyle = '#0a0503'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ffa41a'; ctx.font = 'bold 20px monospace'; ctx.fillText('BULLETS', 8, 20);
      ctx.font = 'bold 40px monospace'; ctx.fillText(String(n).padStart(3, '0'), 8, 62);
      ctx.strokeStyle = 'rgba(255,164,26,0.55)'; ctx.strokeRect(2, 2, w - 4, h - 4);
      ctx.fillText('', 0, 0); ctx.font = 'bold 14px monospace'; ctx.fillStyle = 'rgba(255,164,26,0.85)'; ctx.fillText('HEAT', 116, 20);
      ctx.strokeRect(116, 30, 68, 14); ctx.fillStyle = hot > 0.6 ? '#ff3a1a' : '#ffa41a'; ctx.fillRect(118, 32, 64 * hot, 10);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    });
    const lcdBox = new K.HParts(); lcdBox.box(M.black, [0.064, 0.005, 0.034], [0, 0.0985, 0.104], [0.0, 0, 0], 0.002); this.frameG.add(lcdBox.build('lcdBox'));
    this.lcdPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.056, 0.022), this.lcd.mat); this.lcdPlane.rotation.x = -Math.PI / 2; this.lcdPlane.position.set(0, 0.1017, 0.104); this.lcdPlane.frustumCulled = false; G.add(this.lcdPlane);
    this.ledMat = K.glowBasic(0.1, 0.1, 0.1); this.led = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 6), this.ledMat); this.led.position.set(-0.0508, 0.046, 0.115); this.led.frustumCulled = false; G.add(this.led);

    // ================================================================ muzzle, flash, ejection ================================================
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, Y0, -0.668); G.add(this.muzzle);
    this.flash = g.vfx.createFlash('chaingun'); this.muzzle.add(this.flash.object3d);
    this.port = new THREE.Object3D(); this.port.position.set(0.05, 0.03, 0.03); G.add(this.port);
    this.puffs = new K.Puffs(model, 10, K.smokeTexture(), { color: 0x9a9a9a, drag: 1.8 });
    this.sparks = new K.Puffs(model, 6, K.glowTexture(), { additive: true, color: new THREE.Color(2.0, 1.1, 0.4), drag: 4 });
    return model;
  }

  updateBelt() {
    const P = this.pathPts, NS = this.NS, total = this.pathLen;
    for (let i = 0; i < BELT_N; i++) {
      let s = (i + this.beltPos) * PITCH; s = ((s % (BELT_N * PITCH)) + BELT_N * PITCH) % (BELT_N * PITCH);
      if (s > total) { _dummy.position.set(0, -5, 0); _dummy.scale.setScalar(0.0001); _dummy.rotation.set(0, 0, 0); }
      else {
        const f = s / total * NS, k = Math.min(NS - 1, Math.floor(f)), t = f - k, a = k * 4, b = a + 4;
        _dummy.position.set(P[a] + (P[b] - P[a]) * t, P[a + 1] + (P[b + 1] - P[a + 1]) * t, P[a + 2] + (P[b + 2] - P[a + 2]) * t);
        _dummy.rotation.set(P[a + 3] + (P[b + 3] - P[a + 3]) * t, 0, 0); _dummy.scale.setScalar(1);
      }
      _dummy.updateMatrix(); this.belt.setMatrixAt(i, _dummy.matrix);
    }
    this.belt.instanceMatrix.needsUpdate = true;
  }

  debugAt(spec) { this._dbg = spec; if (spec) { if (spec.hot !== undefined) this.hot = spec.hot; if (spec.spin !== undefined) this.spin = spec.spin * SPIN_MAX; } }
  update(dt, ctx) { if (!this.game.__waWarm) warmup(this.game); super.update(dt, ctx); }
  onSelect() { this.refire = 0; this.emptyT = 0; this.nextShot = 0; this.puffs.clear(); this.sparks.clear(); this.flash.object3d.visible = false; this._dbg = null; }

  think(dt, ctx) {
    if (!ctx.fire) { this.refire = 0; return; }
    if (this.time < this.nextShot || this._dbg) return;
    if (!this.hasAmmo()) {
      if (this.emptyT <= 0) { this.game.audio.play('empty'); this.emptyT = 0.45; this.game.weapons.autoSwitch(); }
      return;
    }
    this.shoot();
  }

  shoot() {
    const g = this.game;
    const iv = 4 * TIC; this.nextShot = (this.time - this.nextShot < iv) ? this.nextShot + iv : this.time + iv;   // exact 8.75/s cadence across frame quantisation
    this.consume();
    const first = this.refire === 0; this.refire++;
    this.fireBullets({ count: 1, spreadH: first ? 0 : 5.6 * K.DEG, spreadV: 0, damage: () => 5 * randInt(1, 3), tracer: 'chaingun', damageType: 'bullet' });
    g.audio.play('chaingun');
    // alternating flash: the "firing" barrel swaps sides, the star rotates
    this.side = -this.side; this.flash.object3d.position.set(this.side * 0.02, 0.012 * this.side, 0); this.flash.object3d.rotation.z = rand(0, 6.28); this.flash.fire(rand(0.9, 1.25));
    this.muzzleWorld(_o); g.vfx.light(_o, 0xffc27a, 2.4, 0.07);
    // casing: out of the right port
    viewPointToWorld(g, this.port, _o);
    const b = camBasis(g);
    _v.set(0, 0, 0).addScaledVector(b.right, rand(1.5, 2.6)).addScaledVector(b.up, rand(1.1, 2.1));
    _v.x += g.player.vel?.x * 0.5 || 0; _v.z += g.player.vel?.z * 0.5 || 0;
    g.vfx.shell(_o, _v, 'bullet');
    // recoil / feel
    this.kickBack(0.02, 0.026, 0.0055, 0.0045);
    g.player.shake?.(0.16);
    this.beltTarget += 1; this.trigT = 0;
    this.hot = Math.min(1, this.hot + 0.012);
    this.sparks.emit(this.side * 0.02, Y0 + 0.01 * this.side, -0.67, rand(-0.05, 0.05), rand(-0.02, 0.06), rand(-0.5, -0.2), 0.07, 0.04, 0.14, 0.8);
    bus.emit('weapon:fire', { id: 'chaingun' });
    if (!this.hasAmmo()) g.weapons.autoSwitch();
  }

  animate(dt, ctx) {
    const dbg = this._dbg;
    this.emptyT = Math.max(0, this.emptyT - dt);
    const firing = !dbg && !!ctx.fire && this.ready && this.hasAmmo();
    if (!dbg || dbg.spin === undefined) {
      const target = firing ? SPIN_MAX : 0;
      if (this.spin < target) this.spin = Math.min(target, this.spin + 62 * dt); else this.spin = Math.max(target, this.spin - 9 * dt);
    }
    this.spinAngle += this.spin * dt; this.rotor.rotation.z = this.spinAngle;
    const sp = this.spin / SPIN_MAX;
    this.blurMat.opacity = sp * sp * 0.22;
    this.heat = damp(this.heat, (dbg && dbg.spin !== undefined ? sp : firing && this.spin > 5 ? 1 : 0), firing ? 20 : 7, dt);
    if (!dbg || dbg.hot === undefined) this.hot = firing ? this.hot : Math.max(0, this.hot - dt * 0.16);
    this.barrelMat.emissiveIntensity = this.hot * this.hot * 2.6;
    // vibration of the whole gun grows with spin
    const j = this.heat * 0.0016, t = this.time;
    this.model.position.set(Math.cos(t * 1.1) * 0.0007 + (Math.random() - 0.5) * 2 * j, Math.sin(t * 1.7) * 0.0009 + (Math.random() - 0.5) * 2 * j, (Math.random() - 0.5) * 2 * j);
    this.model.rotation.set(-(1 - this.raise) * 0.4 + Math.sin(t * 1.3) * 0.0018 + this.viewPitch, this.viewYaw, -(1 - this.raise) * 0.12 + (Math.random() - 0.5) * this.heat * 0.008);
    // trigger + trigger finger
    this.trigT += dt; const tg = firing || this.trigT < 0.12 ? 1 : 0; this.trig = damp(this.trig || 0, tg, 30, dt);
    this.trigger.rotation.x = -this.trig * 0.25; this.trigger.position.z = 0.006 + this.trig * 0.004;
    const idx = this.idxF; if (idx) { idx.joints[0].rotation.x = -(0.55 + this.trig * 0.22); idx.joints[1].rotation.x = -(0.65 + this.trig * 0.5); }
    const vc = this.game.viewCamera; this.handR.pointArm(vc, 0.30, -0.80, 0.55); this.handL.pointArm(vc, -0.50, -0.80, 0.30);
    // ammo belt feeds one round per shot
    this.beltPos = damp(this.beltPos, this.beltTarget, 30, dt);
    if (this.beltTarget > BELT_N * 4) { this.beltTarget -= BELT_N * 4; this.beltPos -= BELT_N * 4; }
    this.updateBelt();
    // heat LED + LCD
    const n = this.game.weapons.ammo.bullets, h8 = Math.round(this.hot * 8), key = n * 10 + h8; if (key !== this.ammoShown) { this.ammoShown = key; this.lcd.set(key, n, h8 / 8); }
    this.ledMat.color.setRGB(0.2 + this.hot * 2.6, 0.05 + 0.3 * (1 - this.hot), 0.02).multiplyScalar(this.hot > 0.05 ? 1 : 0.35);
    // hot barrels smoke
    if (this.hot > 0.35 && (this.smokeT -= dt) <= 0) {
      this.smokeT = 0.05; this.puffs.emit(rand(-0.04, 0.04), Y0 + rand(-0.04, 0.04), -0.66, rand(-0.02, 0.02), rand(0.06, 0.14), rand(-0.25, -0.1), 0.9, 0.03, 0.16, 0.22 * this.hot, rand(-1, 1));
    }
    if (!dbg) this.flash.update(dt);
    this.puffs.update(dt); this.sparks.update(dt);
  }
}
