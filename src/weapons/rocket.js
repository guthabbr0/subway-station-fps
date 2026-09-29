// Rocket launcher: 1 rocket / 20 tics, projectile 22 m/s, direct 20*(1d8) + splash 128 @ 4 m.
// Model: olive-drab tube with a flared blast venturi (you look straight into it: throat ring + the rocket's tail fins), peep/blade sights, rail, carry handle,
// fire-control unit with LCD, pistol grip + foregrip (kit_a gloved hands) and the loaded rocket (red ogive warhead) sitting in the muzzle.
// Firing: heavy recoil, backblast plume + smoke out of the venturi, hot throat glow, smoke wisps curling from the muzzle, rocket slides back in.
import * as THREE from 'three';
import { Weapon } from './base.js';
import { TIC, bus, clamp, rand, randInt } from '../core.js';
import * as K from './kitb.js';
import { warmup, keyframe, smooth, flashPulse, flashDecay, flashKill } from './kit_a.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, -1);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const TY = 0.015;                       // tube axis height in gun space
const D_MUZ = 0.56;                     // tube muzzle (forward distance), rear lip at -0.17
const K_DIP = [[0, 0], [0.05, 1], [0.30, -0.35], [0.7, 0.0]];   // tube dip after the shot (fraction of 0.035 rad / 0.02 m)

// ---------------------------------------------------------------------------------------------------------------
// In-flight rocket mesh (template built + shader-warmed in init(), then cloned + pooled; geometry/materials shared)
// ---------------------------------------------------------------------------------------------------------------
let RK = null; const freeMeshes = []; const activeLoops = new Set(); let hooked = false;

function rocketTemplate(game) {
  if (RK) return RK;
  const HR = K.getHero(game), H = HR.H, M = HR.M;
  const body = H.rocketBody.clone(); body.emissive = new THREE.Color(0x1c1710);   // the world lights are dim: a hint of self-illumination keeps the round readable
  const head = H.rocketHead.clone(); head.emissive = new THREE.Color(0x3a0c06);
  body.userData.uv = head.userData.uv = 3.4;
  const P = new K.HParts();
  P.cyl(body, 0.045, 0.045, 0.34, 'z', [0, 0, 0.07], null, 16);
  P.lathe2(head, [[0, 0.10], [0.047, 0.10], [0.061, 0.125], [0.077, 0.16], [0.080, 0.20], [0.071, 0.24], [0.05, 0.275], [0.025, 0.30], [0.007, 0.32], [0, 0.32]], [0, 0, 0], null, 20);
  P.cyl(H.yellowVC, 0.0475, 0.0475, 0.016, 'z', [0, 0, -0.108], null, 16);
  P.lathe2(H.steelVC, [[0.018, -0.27], [0.026, -0.245], [0.034, -0.225], [0.03, -0.20]], [0, 0, 0], null, 14);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; P.box(M.dark, [0.006, 0.062, 0.14], [Math.cos(a) * 0.066, Math.sin(a) * 0.066, 0.17], [0, 0, a - Math.PI / 2], 0); P.box(H.redVC, [0.0065, 0.018, 0.05], [Math.cos(a) * 0.092, Math.sin(a) * 0.092, 0.215], [0, 0, a - Math.PI / 2], 0); }
  P.sphere(M.steel, 0.007, [0, 0, -0.325], null, [1, 1, 1.4], 8);
  const tpl = P.build('rocket');
  const flameA = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.004, 0.62, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.58),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.55, 0.12), transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }));
  const flameB = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.002, 0.4, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.47),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.8, 0.9), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(1.8, 0.8, 0.28), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.9 }));
  glow.position.z = 0.3; glow.scale.setScalar(1.0);
  flameA.name = 'flameA'; flameB.name = 'flameB'; glow.name = 'glow';
  tpl.add(flameA, flameB, glow);
  for (const c of tpl.children) c.frustumCulled = false;
  RK = tpl;
  K.park(game, RK.clone());                            // spare copy parked in the scene: the boot warm-up compiles every program the first shot needs
  return RK;
}
function getRocketMesh() { const m = freeMeshes.pop() || RK.clone(); m.userData.flameA = m.getObjectByName('flameA'); m.userData.flameB = m.getObjectByName('flameB'); m.userData.glow = m.getObjectByName('glow'); return m; }

export default class RocketLauncher extends Weapon {
  constructor(game) {
    super(game, { id: 'rocket', name: 'ROCKET LAUNCHER', slot: 5, ammoType: 'rockets', ammoPerShot: 1, raiseTime: 0.4, lowerTime: 0.28 });
    this.rest.set(0.115, -0.135, -0.72); this.viewYaw = 0.20; this.viewPitch = 0.05;
    this.state = 'idle'; this.st = 99; this.emptyT = 0; this.rocketOn = true; this.smokeT = 0; this.smokeLeft = 0; this.ammoShown = -1; this.trigT = 9; this.trig = 0; this.heatV = 0; this._dbg = null;
    if (!hooked) { hooked = true; bus.on('game:start', () => { for (const l of activeLoops) l.stop(0.02); activeLoops.clear(); }); }
    const G = game;
    // projectile callbacks (closures over game, created once)
    this.cbHit = (p, hit) => {
      if (hit.kind === 'enemy') {
        G.enemies.damage(hit.enemy, 20 * randInt(1, 8), { point: hit.point.clone(), dir: p.dir.clone(), type: 'explosion', source: 'player', part: hit.part, dist: p.age * p.speed });
      }
      this.detonate(p, hit.point, hit.normal);
    };
    this.cbExpire = (p) => this.detonate(p, p.pos, null);
    this.cbUpdate = (p, dt) => {
      const d = p.data, m = p.mesh;
      d.spin += dt * 7; m.rotateZ(dt * 7);
      const f = 0.8 + Math.random() * 0.45; m.userData.flameA.scale.set(1, 1, f); m.userData.flameB.scale.set(1, 1, 0.8 + Math.random() * 0.5);
      m.userData.glow.scale.setScalar(0.8 + Math.random() * 0.35);
      if ((d.tt -= dt) <= 0) { d.tt = 0.022; G.vfx.trail(p.pos, 'rocket'); }
      if ((d.lt -= dt) <= 0) { d.lt = 0.11; G.vfx.light(p.pos, 0xff8a30, 4, 0.16, 11); }
      d.loop?.set({ pos: p.pos });
    };
  }

  detonate(p, point, normal) {
    const G = this.game, d = p.data;
    if (d.loop) { d.loop.stop(0.05); activeLoops.delete(d.loop); d.loop = null; }
    _e.copy(point); if (normal) _e.addScaledVector(normal, 0.15);
    if (p.mesh) freeMeshes.push(p.mesh);
    G.combat.explosion(_e.clone(), 4, 128, { owner: 'player', kind: 'rocket' });
  }

  buildModel() {
    const g = this.game, kit = K.getKit(g), HR = K.getHero(g), M = kit.M, H = HR.H, model = new THREE.Group();
    this.gun = new THREE.Group(); model.add(this.gun);
    const G = this.gun, B = new K.HParts(), F = new K.HParts(), ol = H.olive, gm = H.gunmetal;

    // ================================================================ launch tube (one lathe: inner bore, flared venturi, outer skin, muzzle bell) ===
    B.lathe2(ol, [[0.072, -0.17], [0.079, -0.17], [0.0745, -0.16, 1], [0.068, -0.13, 1], [0.0625, -0.095, 1], [0.0595, -0.06],
      [0.0595, 0.50], [0.0625, 0.525, 1], [0.066, 0.548, 1], [0.066, D_MUZ], [0.052, D_MUZ]], [0, TY, 0], null, 40);
    B.lathe2(M.dark, [[0.052, 0.40], [0.052, -0.06, 1], [0.062, -0.12, 1], [0.072, -0.17]], [0, TY, 0], null, 40);   // inner wall: bore + flared venturi (the rocket sits inside)
    B.lathe2(M.dark, [[0.052, D_MUZ], [0.052, 0.40]], [0, TY, 0], null, 40);                                         // dark bore behind the muzzle
    B.cyl(M.black, 0.052, 0.052, 0.004, 'z', [0, TY, -0.40], null, 24);                     // bore cap (dark)
    B.torus(M.steel, 0.0505, 0.0045, [0, TY, 0.03], null, 40);                                // throat ring seen from behind
    B.torus(M.dark, 0.0535, 0.003, [0, TY, -0.03], null, 40);
    for (const d of [0.47]) B.torus(M.dark, 0.0598, 0.0028, [0, TY, -d], null, 44);   // weld bead
    B.cyl(M.steel, 0.0632, 0.0632, 0.030, 'z', [0, TY, -0.085], null, 40);                    // grip collar
    B.cyl(M.steel, 0.0632, 0.0632, 0.030, 'z', [0, TY, -0.215], null, 40);                    // foregrip collar
    B.cyl(M.dark, 0.0625, 0.0625, 0.018, 'z', [0, TY, -0.435], null, 40);
    B.cyl(H.yellowVC, 0.0606, 0.0606, 0.010, 'z', [0, TY, -0.49], null, 44);                  // HE marking band
    B.boltCircle(M.steel, 0, TY, -(D_MUZ + 0.0005), 0.059, 12, 0.0028, 0.003, 0.2, 8);
    B.boltCircle(M.steel, 0, TY, 0.1715, 0.0755, 14, 0.0028, 0.003, 0.1, 8);
    for (const sx of [-1, 1]) { B.torus(M.steel, 0.0120, 0.0028, [sx * 0.0665, TY - 0.012, 0.135], [0, Math.PI / 2, 0], 12); B.cyl(M.dark, 0.006, 0.006, 0.016, 'x', [sx * 0.0638, TY - 0.012, 0.135], null, 10); }   // sling loops

    // ================================================================ rail, sights, carry handle ============================================
    B.box(M.dark, [0.032, 0.008, 0.36], [0, TY + 0.0635, -0.12], null, 0.002);
    for (let i = 0; i < 14; i++) B.box(M.steel, [0.034, 0.004, 0.011], [0, TY + 0.0685, -0.28 + i * 0.026], null, 0.0006);
    B.box(M.dark, [0.026, 0.010, 0.05], [0, TY + 0.073, 0.03], null, 0.002);                   // rear sight base
    B.box(M.dark, [0.008, 0.044, 0.010], [0, TY + 0.098, 0.03], null, 0.001);
    B.torus(M.black, 0.0125, 0.0034, [0, TY + 0.128, 0.03], null, 20); B.torus(M.steel, 0.0135, 0.0012, [0, TY + 0.128, 0.0275], null, 20);
    B.box(M.dark, [0.014, 0.012, 0.030], [0, TY + 0.073, -0.46], null, 0.002);                 // front sight
    B.box(M.dark, [0.005, 0.038, 0.007], [0, TY + 0.096, -0.46], null, 0.001);
    B.torus(M.dark, 0.0135, 0.0026, [0, TY + 0.112, -0.46], null, 20); B.box(H.yellowVC, [0.003, 0.010, 0.003], [0, TY + 0.113, -0.4635], null, 0);
    for (const z of [-0.09, -0.24]) { B.box(M.dark, [0.014, 0.052, 0.016], [0, TY + 0.101, z], null, 0.003); B.box(M.steel, [0.020, 0.005, 0.022], [0, TY + 0.076, z], null, 0.002); }
    B.cyl(M.rubber, 0.0128, 0.0128, 0.165, 'z', [0, TY + 0.130, -0.165], null, 14);
    for (let i = 0; i < 6; i++) B.torus(M.black, 0.0131, 0.0015, [0, TY + 0.130, -0.100 - i * 0.026], null, 14);
    B.cyl(M.steel, 0.0122, 0.0122, 0.008, 'z', [0, TY + 0.130, -0.085], null, 14); B.cyl(M.steel, 0.0122, 0.0122, 0.008, 'z', [0, TY + 0.130, -0.245], null, 14);

    // ================================================================ fire-control unit, battery (left flank) ================================
    B.box(gm, [0.040, 0.066, 0.120], [-0.085, TY + 0.004, -0.030], null, 0.006);
    B.box(M.dark, [0.030, 0.050, 0.010], [-0.066, TY + 0.004, -0.030], null, 0.002);
    B.torus(M.steel, 0.0625, 0.0038, [0, TY, -0.030], null, 40); B.torus(M.steel, 0.0625, 0.0038, [0, TY, -0.010], null, 40);
    for (const [y, z] of [[0.030, -0.078], [-0.022, -0.078], [0.030, 0.018], [-0.022, 0.018]]) B.screw(M.steel, M.black, 0.0042, [-0.1055, TY + y * 0.85, z], 'x');
    B.cyl(M.dark, 0.0145, 0.0145, 0.070, 'z', [-0.066, TY - 0.040, 0.112], null, 14); B.cyl(M.brass, 0.0110, 0.0110, 0.006, 'z', [-0.066, TY - 0.040, 0.150], null, 12);
    B.tube(M.rubber, [[-0.085, TY - 0.024, -0.09], [-0.09, TY - 0.03, -0.14], [-0.06, TY - 0.045, -0.16], [-0.04, TY - 0.04, -0.14]], 0.0036, [0, 0, 0], 12);   // signal cable
    for (let i = 0; i < 6; i++) B.box(M.black, [0.004, 0.012, 0.0055], [-0.0605, TY - 0.028, -0.32 + i * 0.011], null, 0.0004);   // tube vent slots

    // ================================================================ grips + trigger group ================================================
    F.box(M.dark, [0.046, 0.030, 0.116], [0, -0.056, 0.052], null, 0.006);                       // fire-control housing under the tube
    F.box(M.rubber, [0.036, 0.118, 0.052], [0, -0.126, 0.086], [-0.30, 0, 0], 0.006);
    F.box(M.stipple, [0.0018, 0.090, 0.040], [0.0186, -0.122, 0.084], [-0.30, 0, 0], 0.0006); F.box(M.stipple, [0.0018, 0.090, 0.040], [-0.0186, -0.122, 0.084], [-0.30, 0, 0], 0.0006);
    F.box(M.steel, [0.034, 0.006, 0.048], [0, -0.185, 0.108], [-0.30, 0, 0], 0.002);
    F.torus(M.blued, 0.024, 0.0034, [0, -0.052, 0.020], [0, Math.PI / 2, 0], 24, [1.5, 1, 1]);
    F.box(M.dark, [0.030, 0.034, 0.050], [0, -0.058, -0.20], null, 0.004);                       // foregrip mount
    F.cyl(M.rubber, 0.0198, 0.0192, 0.112, 'y', [0, -0.128, -0.20], null, 16);
    for (let i = 0; i < 5; i++) F.torus(M.black, 0.0199, 0.0014, [0, -0.093 - i * 0.019, -0.20], [Math.PI / 2, 0, 0], 16);
    F.cyl(M.dark, 0.0215, 0.0215, 0.008, 'y', [0, -0.188, -0.20], null, 16);
    this.handR = K.gripHand(kit, 'R', G, F, [0.0395, -0.090, 0.094], [0.30, 0, -Math.PI / 2], K.POSE_TRIGGER);
    this.idxF = this.handR.find('index');
    this.handL = K.gripHand(kit, 'L', G, F, [-0.038, -0.128, -0.176], [0.0, 0, Math.PI / 2], K.POSE_GRIP);
    this.bodyG = B.build('body'); G.add(this.bodyG);
    this.frameG = F.build('frame'); G.add(this.frameG);
    this.trigger = new THREE.Group(); this.trigger.position.set(0, -0.058, 0.014); G.add(this.trigger);
    { const T = new K.HParts(); T.box(M.blued, [0.007, 0.028, 0.006], [0, -0.013, 0], [0.25, 0, 0], 0.002); T.box(M.steel, [0.004, 0.012, 0.004], [0, -0.010, -0.003], [0.25, 0, 0], 0.001); this.trigger.add(T.build('trig')); }

    // ================================================================ stencils (one atlas, one draw call) ====================================
    const D = new K.DecalSheet(g, 1024, 512);
    const rMain = D.text(640, 112, ['LAUNCHER, ROCKET  RL-9', '66 mm HE-4 · SINGLE ROUND · REUSABLE'], { color: 'rgba(236,230,204,0.92)', size: 0.52 });
    const rBack = D.text(360, 84, ['DANGER', 'BACKBLAST AREA 30 m'], { color: 'rgba(22,20,14,0.95)', bg: 'rgba(222,176,30,0.95)', border: 'rgba(22,20,14,0.95)', size: 0.5, bw: 5 });
    const rFcu = D.text(200, 44, 'FCU-4  ARMED', { color: 'rgba(210,214,200,0.85)', size: 0.66 });
    const rTop = D.text(200, 44, 'FRONT ▶  TOWARD ENEMY', { color: 'rgba(236,230,204,0.85)', size: 0.6, weight: 'normal' });
    D.wrap(rMain, 0.0603, 0.62, 0.20, -0.33, 0.0, 0, TY);
    D.wrap(rBack, 0.0603, 0.70, 0.11, -0.005, 0.0, 0, TY);
    D.plane(rFcu, 0.040, 0.009, [-0.1057, TY - 0.026, -0.030], 'x-');
    D.plane(rTop, 0.075, 0.017, [0, TY + 0.0680, -0.055], 'y+');
    this.decals = D.build('decals'); G.add(this.decals);

    // LCD + LEDs on the fire-control unit
    this.lcd = new K.LCD(128, 64, (ctx, w, h, n) => {
      ctx.fillStyle = '#0a0703'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ffa41a'; ctx.font = 'bold 22px monospace'; ctx.fillText('RKT', 8, 22);
      ctx.font = 'bold 40px monospace'; ctx.fillText(String(n).padStart(2, '0'), 42, 58); ctx.strokeStyle = 'rgba(255,164,26,0.5)'; ctx.strokeRect(2, 2, w - 4, h - 4);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    });
    const lcdPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.056, 0.028), this.lcd.mat); lcdPlane.rotation.y = -Math.PI / 2; lcdPlane.position.set(-0.1057, TY + 0.014, -0.030); lcdPlane.frustumCulled = false; G.add(lcdPlane);
    const led = (x, y, z, c) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 6), K.glowBasic(...c)); m.position.set(x, y, z); m.frustumCulled = false; G.add(m); return m; };
    this.ledReady = led(-0.1062, TY - 0.008, -0.055, [0.2, 2.4, 0.4]); this.ledBusy = led(-0.1062, TY - 0.008, -0.036, [2.6, 0.3, 0.1]);

    // ================================================================ the loaded rocket (warhead outside the muzzle, fins inside the venturi) ==========
    const RP = new K.HParts();
    RP.cyl(H.rocketBody, 0.0425, 0.0425, 0.56, 'z', [0, TY, -0.35], null, 20);                    // body inside the tube
    RP.cyl(H.yellowVC, 0.0435, 0.0435, 0.016, 'z', [0, TY, -0.605], null, 20);                    // band
    RP.lathe2(H.rocketHead, [[0.0, 0.612], [0.0435, 0.612], [0.056, 0.635], [0.072, 0.665], [0.078, 0.705], [0.070, 0.745], [0.052, 0.780], [0.028, 0.808], [0.008, 0.828], [0, 0.828]], [0, TY, 0], null, 28);
    RP.torus(H.redVC, 0.0745, 0.0028, [0, TY, -0.668], null, 28);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; RP.box(M.dark, [0.004, 0.020, 0.044], [Math.cos(a) * 0.050, TY + Math.sin(a) * 0.050, -0.588], [0, 0, a - Math.PI / 2], 0); }   // stabiliser fins folded along the neck
    RP.sphere(M.steel, 0.0072, [0, TY, -0.832], null, [1, 1, 1.5], 8);
    RP.cyl(M.steel, 0.0105, 0.0105, 0.022, 'z', [0, TY, -0.60], null, 10);
    RP.lathe2(H.steelVC, [[0.018, 0.02], [0.028, 0.045], [0.036, 0.075], [0.031, 0.095]], [0, TY, 0], null, 16);          // tail nozzle (looks deep into the venturi)
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; RP.box(M.dark, [0.005, 0.030, 0.13], [Math.cos(a) * 0.034, TY + Math.sin(a) * 0.034, -0.085], [0, 0, a - Math.PI / 2], 0); RP.box(H.redVC, [0.0055, 0.010, 0.04], [Math.cos(a) * 0.046, TY + Math.sin(a) * 0.046, -0.06], [0, 0, a - Math.PI / 2], 0); }
    this.rocket = RP.build('rocket'); G.add(this.rocket);

    // exhaust: throat glow, backblast plume
    this.throatMat = K.glowBasic(1.2, 0.5, 0.12, { transparent: true, opacity: 0 });
    this.throat = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.006, 6, 32), this.throatMat); this.throat.position.set(0, TY, 0.07); this.throat.frustumCulled = false; this.throat.visible = false; G.add(this.throat);

    // ================================================================ muzzle, flash, puffs ============================================================
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, TY, -0.842); G.add(this.muzzle);
    this.flash = g.vfx.createFlash('rocket'); this.muzzle.add(this.flash.object3d);
    this.smoke = new K.Puffs(model, 16, K.smokeTexture(), { color: 0xb8b4ac, drag: 2.2 });
    this.fire = new K.Puffs(model, 4, K.glowTexture(), { additive: true, color: new THREE.Color(1.6, 0.8, 0.3), drag: 3 });
    return model;
  }

  init() {
    super.init();
    rocketTemplate(this.game);                               // world rocket prototype (+ parked copy for the boot warm-up: no first-shot hitch)
  }

  debugAt(spec) { this._dbg = spec; if (spec && spec.t !== undefined) { this.st = spec.t; this.state = spec.t < 0 ? 'idle' : 'fire'; this.rocketOn = spec.t < 0; } }
  update(dt, ctx) { if (!this.game.__waWarm) warmup(this.game); super.update(dt, ctx); }
  onSelect() { this.smoke.clear(); this.fire.clear(); this.smokeLeft = 0; this.state = 'idle'; this.st = 99; this.emptyT = 0; this.rocketOn = this.hasAmmo(); this.rocket.visible = this.rocketOn; this.rocket.position.z = 0; this.heatV = 0; this._dbg = null; this.flash.object3d.visible = false; }
  onDeselect() { flashKill(this.game); }
  canSwitch() { return this.state === 'idle' || this.st > 0.22; }

  think(dt, ctx) {
    if (!ctx.fire || this.cool > 0 || this.state !== 'idle' || this._dbg) return;
    if (!this.hasAmmo()) {
      if (this.emptyT <= 0) { this.game.audio.play('empty'); this.emptyT = 0.5; this.game.weapons.autoSwitch(); }
      return;
    }
    this.shoot();
  }

  shoot() {
    const g = this.game;
    this.consume();
    this.state = 'fire'; this.st = 0; this.cool = 20 * TIC; this.rocketOn = false; this.trigT = 0; this.heatV = 1;
    // spawn the projectile from the muzzle towards whatever the crosshair is on
    this.muzzleWorld(_o);
    const eye = g.player.eye;
    if (!K.clearPath(g, eye, _o)) { _o.copy(eye); }
    K.aimDir(g, _o, _d);
    if (_o.equals(eye)) _o.addScaledVector(_d, 0.2);
    const mesh = getRocketMesh(); mesh.quaternion.setFromUnitVectors(FWD, _d);
    const p = g.projectiles.spawn({ mesh, pos: _o, dir: _d, speed: 22, radius: 0.15, life: 6, owner: 'player', onHit: this.cbHit, onUpdate: this.cbUpdate, onExpire: this.cbExpire, data: { tt: 0, lt: 0.05, spin: 0, loop: null } });
    p.data.loop = g.audio.loop('rocketFly', { volume: 0.7, rate: 1, pos: p.pos }); if (p.data.loop) activeLoops.add(p.data.loop);
    // sound, flash, light, recoil
    g.audio.play('rocketFire');
    this.flash.object3d.rotation.z = rand(0, 6.28); this.flash.fire(1.2);
    this.muzzleWorld(_o); g.vfx.light(_o, 0xffa040, 3.4, 0.1, 14);
    flashPulse(g, this.muzzle, 1.8, 0xffa040);
    this.kickBack(0.09, 0.10, 0.034, 0.012);
    g.player.shake?.(0.4);
    g.hud?.flash?.('#ffb060', 0.14, 0.12);
    this.blast();
    bus.emit('weapon:fire', { id: 'rocket' });
    if (!this.hasAmmo()) g.weapons.autoSwitch();
  }

  // muzzle smoke + backblast wash (gun space)
  blast() {
    for (let i = 0; i < 5; i++) this.smoke.emit(rand(-0.02, 0.02), TY + rand(-0.02, 0.02), -(D_MUZ + 0.02), rand(-0.18, 0.18), rand(-0.05, 0.25), rand(-1.4, -0.4), rand(0.7, 1.1), 0.08, rand(0.3, 0.5), 0.55, rand(-1, 1));
    for (let i = 0; i < 6; i++) this.smoke.emit(rand(-0.04, 0.04), TY + rand(-0.03, 0.05), 0.20, rand(-0.6, 0.6), rand(-0.1, 0.5), rand(0.25, 0.9), rand(0.45, 0.8), 0.10, rand(0.35, 0.6), 0.42, rand(-1.5, 1.5));
    this.fire.emit(0, TY, 0.20, 0, 0, 0.30, 0.10, 0.14, 0.34, 0.75);
    this.fire.emit(rand(-0.01, 0.01), TY, 0.27, 0, 0, 0.9, 0.12, 0.10, 0.42, 0.45);
    this.fire.emit(0, TY, -(D_MUZ + 0.06), 0, 0, -0.2, 0.16, 0.2, 0.5, 0.9);
    this.smokeLeft = 0.9;
  }

  animate(dt, ctx) {
    const dbg = this._dbg, t = this.time;
    this.emptyT = Math.max(0, this.emptyT - dt);
    if (!dbg) this.st += dt;
    if (this.state === 'fire' && this.st > 0.2) { this.state = 'reload'; this.st = 0; this.rocketOn = this.hasAmmo(); }
    if (this.state === 'reload') {
      const k = clamp(this.st / 0.26, 0, 1);
      this.rocket.position.z = -(1 - easeOut(k)) * 0.16;
      if (k >= 1) { this.state = 'idle'; this.rocket.position.z = 0; if (!dbg) this.kickBack(0.014, 0.02, 0, 0); }
    }
    this.rocket.visible = this.rocketOn;
    // recoil dip of the tube on top of the spring, then settle
    const since = this.state === 'fire' ? this.st : this.state === 'reload' ? 0.2 + this.st : 9;
    const dip = keyframe(K_DIP, since, smooth);
    this.gun.rotation.x = dip * 0.035; this.gun.position.z = dip * 0.02;
    // hot throat + lingering smoke
    this.heatV = Math.max(0, this.heatV - dt * 1.3); this.throat.visible = this.heatV > 0.02; this.throatMat.opacity = Math.min(1, this.heatV * 1.4); this.throatMat.color.setRGB(1.6 * this.heatV + 0.2, 0.55 * this.heatV, 0.1 * this.heatV);
    if (this.smokeLeft > 0) {
      this.smokeLeft -= dt;
      if ((this.smokeT -= dt) <= 0) {
        this.smokeT = 0.06;
        this.smoke.emit(rand(-0.02, 0.02), TY + rand(-0.02, 0.02), -(D_MUZ + 0.02), rand(-0.02, 0.02), rand(0.05, 0.14), rand(-0.2, -0.05), 1.1, 0.05, 0.22, 0.28 * clamp(this.smokeLeft / 0.5, 0, 1), rand(-0.5, 0.5));
        if (this.smokeLeft > 0.3) this.smoke.emit(rand(-0.03, 0.03), TY + rand(-0.02, 0.03), 0.18, rand(-0.05, 0.05), rand(0.04, 0.12), rand(0.05, 0.2), 1.0, 0.05, 0.2, 0.2 * clamp(this.smokeLeft / 0.5, 0, 1), rand(-0.5, 0.5));
      }
    }
    // trigger + hands + model pose
    this.trigT += dt; const tg = this.trigT < 0.16 ? 1 : 0; this.trig += (tg - this.trig) * Math.min(1, dt * 30);
    this.trigger.rotation.x = -this.trig * 0.25; this.trigger.position.z = 0.014 + this.trig * 0.004;
    const idx = this.idxF; if (idx) { idx.joints[0].rotation.x = -(0.55 + this.trig * 0.22); idx.joints[1].rotation.x = -(0.65 + this.trig * 0.5); }
    const vc = this.game.viewCamera; this.handR.pointArm(vc, 0.30, -0.80, 0.55); this.handL.pointArm(vc, -0.50, -0.80, 0.30);
    this.model.position.set(Math.cos(t * 1.1) * 0.0008, Math.sin(t * 1.7) * 0.001, 0);
    this.model.rotation.set(-(1 - this.raise) * 0.4 + Math.sin(t * 1.3) * 0.002 + this.viewPitch, this.viewYaw, -(1 - this.raise) * 0.12);
    // ammo display + LEDs
    const n = this.game.weapons.ammo.rockets; if (n !== this.ammoShown) { this.ammoShown = n; this.lcd.set(n, n); }
    const busy = this.state !== 'idle' || this.cool > 0;
    this.ledReady.visible = !busy && n > 0; this.ledBusy.visible = busy || n <= 0;
    if (!dbg) { this.flash.update(dt); flashDecay(this.game, dt); }
    this.smoke.update(dt); this.fire.update(dt);
  }
}
