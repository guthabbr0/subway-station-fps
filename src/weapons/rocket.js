// Rocket launcher: 1 rocket / 20 tics, projectile 22 m/s, direct 20*(1d8) + splash 128 @ 4 m.
import * as THREE from 'three';
import { Weapon } from './base.js';
import { TIC, bus, clamp, rand, randInt } from '../core.js';
import * as K from './kitb.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _v = new THREE.Vector3(), _u = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, -1);
const easeOut = (t) => 1 - (1 - t) * (1 - t);

// ---------------------------------------------------------------------------------------------------------------
// In-flight rocket mesh (template cloned + pooled; geometry/materials shared)
// ---------------------------------------------------------------------------------------------------------------
let RK = null; const freeMeshes = []; const activeLoops = new Set(); let hooked = false;

function rocketTemplate() {
  if (RK) return RK;
  const body = new THREE.MeshStandardMaterial({ color: 0xd6d1bd, roughness: 0.45, metalness: 0.35, emissive: 0x1c1710 });
  const nose = new THREE.MeshStandardMaterial({ color: 0xc23a22, roughness: 0.35, metalness: 0.3, emissive: 0x4a0f06 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.6, emissive: 0x0a0a0c });
  const band = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.5, metalness: 0.2, emissive: 0x3a2a00 });
  const b = new K.Builder();
  b.cylZ(body, 0.045, 0.045, 0.36, 0, 0, 0.04, 12);
  b.sph(nose, 0.075, 0, 0, -0.17, 1, 1, 1.1, 14, 10);
  b.cylZ(nose, 0.006, 0.05, 0.1, 0, 0, -0.27, 12);
  b.cylZ(band, 0.0465, 0.0465, 0.03, 0, 0, -0.1, 12);
  b.cylZ(dark, 0.05, 0.062, 0.05, 0, 0, 0.225, 12);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; b.box(dark, 0.006, 0.075, 0.13, Math.cos(a) * 0.075, Math.sin(a) * 0.075, 0.2, 0, 0, a - Math.PI / 2); }
  const tpl = b.build(new THREE.Group());
  const flameA = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.004, 0.62, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.58),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.55, 0.12), transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }));
  const flameB = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.002, 0.4, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.47),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.8, 0.9), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTexture(), color: new THREE.Color(1.8, 0.8, 0.28), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.9 }));
  glow.position.z = 0.3; glow.scale.setScalar(1.0);
  flameA.name = 'flameA'; flameB.name = 'flameB'; glow.name = 'glow';
  tpl.add(flameA, flameB, glow);
  for (const c of tpl.children) c.frustumCulled = false;
  RK = tpl; return RK;
}
function getRocketMesh() { const m = freeMeshes.pop() || rocketTemplate().clone(); m.userData.flameA = m.getObjectByName('flameA'); m.userData.flameB = m.getObjectByName('flameB'); m.userData.glow = m.getObjectByName('glow'); return m; }

export default class RocketLauncher extends Weapon {
  constructor(game) {
    super(game, { id: 'rocket', name: 'ROCKET LAUNCHER', slot: 5, ammoType: 'rockets', ammoPerShot: 1, raiseTime: 0.4, lowerTime: 0.28 });
    this.rest.set(0.17, -0.12, -0.68);
    this.state = 'idle'; this.st = 99; this.emptyT = 0; this.rocketOn = true; this.smokeT = 0; this.smokeLeft = 0; this.ammoShown = -1;
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
    const g = this.game, M = K.getMats(g), root = new THREE.Group();
    const paint = K.paintMat(g, '#6f7b52', 51), paintDark = K.paintMat(g, '#3d4536', 52);
    const b = new K.Builder();
    // ---- launch tube ---------------------------------------------------------------------------------------------
    b.cylZ(paint, 0.062, 0.062, 0.56, 0, 0, -0.24, 28);
    b.cylZ(paintDark, 0.066, 0.066, 0.1, 0, 0, 0.09, 28);
    b.cylZ(M.darkSteel, 0.066, 0.075, 0.024, 0, 0, 0.152, 28);                     // rear blast flare
    b.cylZ(M.darkSteel, 0.07, 0.066, 0.034, 0, 0, -0.525, 28);                    // muzzle collar
    b.cylZ(M.steel, 0.074, 0.074, 0.008, 0, 0, -0.545, 28);
    b.cylZ(M.hazard, 0.0642, 0.0642, 0.05, 0, 0, -0.44, 28);
    b.cylZ(M.hazard, 0.0642, 0.0642, 0.05, 0, 0, -0.08, 28);
    for (const z of [-0.5, -0.33, -0.2, 0.035, 0.12]) b.cylZ(M.darkSteel, 0.0668, 0.0668, 0.014, 0, 0, z, 28);
    for (const z of [-0.36, -0.27]) b.cylZ(M.steel, 0.0655, 0.0655, 0.006, 0, 0, z, 28);
    b.tor(M.steel, 0.07, 0.007, 0, 0, 0.164, 0, 0, 0, 28, 6); b.cylZ(M.black, 0.058, 0.058, 0.004, 0, 0, 0.1655, 24);       // open rear of the tube
    b.tor(M.darkSteel, 0.05, 0.004, 0, 0, 0.1675, 0, 0, 0, 24, 5);
    // ---- rails, sights, carry handle --------------------------------------------------------------------------------
    b.box(M.darkSteel, 0.03, 0.012, 0.44, 0, 0.067, -0.15);
    for (let i = 0; i < 10; i++) b.box(M.steel, 0.032, 0.004, 0.012, 0, 0.075, -0.34 + i * 0.038);
    b.box(M.darkSteel, 0.014, 0.05, 0.014, 0, 0.098, 0.02); b.box(M.darkSteel, 0.014, 0.05, 0.014, 0, 0.098, -0.11);
    b.cylZ(M.rubber, 0.013, 0.013, 0.17, 0, 0.126, -0.045, 12);
    b.tor(M.black, 0.017, 0.004, 0, 0.098, 0.095, 0, 0, 0, 14, 5); b.box(M.darkSteel, 0.008, 0.032, 0.008, 0, 0.078, 0.095);   // rear peep sight
    b.box(M.darkSteel, 0.006, 0.03, 0.008, 0, 0.086, -0.5); b.tor(M.darkSteel, 0.016, 0.003, 0, 0.1, -0.5, 0, 0, 0, 14, 4);       // front sight
    // ---- grips, trigger --------------------------------------------------------------------------------------------
    b.box(M.rubber, 0.04, 0.115, 0.05, 0, -0.125, 0.06, -0.25, 0, 0);
    b.box(M.darkSteel, 0.05, 0.03, 0.09, 0, -0.07, 0.05);
    b.box(M.darkSteel, 0.006, 0.006, 0.05, 0, -0.078, -0.005); b.box(M.darkSteel, 0.006, 0.034, 0.006, 0, -0.06, -0.028);
    b.box(M.steel, 0.006, 0.02, 0.008, 0, -0.06, 0.02, 0.3, 0, 0);
    b.box(M.darkSteel, 0.04, 0.03, 0.06, 0, -0.07, -0.22);
    b.cyl(M.rubber, 0.0185, 0.0175, 0.1, 0, -0.14, -0.22, 0, 0, 0, 12);
    b.cyl(M.darkSteel, 0.02, 0.02, 0.008, 0, -0.192, -0.22, 0, 0, 0, 12);
    // ---- left flank hardware: battery, LCD housing, sling loops, vents ---------------------------------------------
    b.box(paintDark, 0.022, 0.05, 0.07, -0.076, -0.03, 0.06);
    b.box(M.black, 0.004, 0.012, 0.03, -0.0885, -0.03, 0.06);
    b.box(M.darkSteel, 0.016, 0.052, 0.088, -0.07, 0.012, -0.04);
    b.tor(M.steel, 0.012, 0.0028, -0.066, -0.02, 0.11, 0, Math.PI / 2, 0, 10, 4); b.tor(M.steel, 0.012, 0.0028, -0.066, -0.02, -0.38, 0, Math.PI / 2, 0, 10, 4);
    for (let i = 0; i < 6; i++) b.box(M.black, 0.003, 0.014, 0.006, -0.0628, -0.024, -0.29 + i * 0.011);
    for (const sx of [-1, 1]) for (const z of [-0.05, 0.1]) b.cylX(M.steel, 0.005, 0.005, sx * 0.0655, 0.03, z, 8);
    b.build(root);
    // stencils + LCD
    const stencilMat = (lines, o) => new THREE.MeshStandardMaterial({ map: K.stencilTexture(lines, o), transparent: true, roughness: 0.8, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const st = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.056), stencilMat(['RL-9 LAUNCHER', 'CAUTION BACKBLAST'], { w: 384, h: 140, size: 40, color: '#eae4c8' }));
    st.rotation.y = -Math.PI / 2; st.position.set(-0.0628, 0.006, -0.24); root.add(st);
    const st2 = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.028), stencilMat(['HE-4  ×1'], { w: 256, h: 96, size: 44, color: '#ffce3a' }));
    st2.rotation.x = -Math.PI / 2; st2.position.set(0, 0.0632, -0.15); root.add(st2);
    this.lcd = new K.LCD(128, 64, (ctx, w, h, n) => {
      ctx.fillStyle = '#0a0703'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ffa41a'; ctx.font = 'bold 22px monospace'; ctx.fillText('RKT', 8, 22);
      ctx.font = 'bold 40px monospace'; ctx.fillText(String(n).padStart(2, '0'), 42, 58); ctx.strokeStyle = 'rgba(255,164,26,0.5)'; ctx.strokeRect(2, 2, w - 4, h - 4);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    });
    const lcdPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.058, 0.03), this.lcd.mat); lcdPlane.rotation.y = -Math.PI / 2; lcdPlane.position.set(-0.0782, 0.012, -0.04); root.add(lcdPlane);
    // status LEDs
    const led = (x, y, z, c) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 6), K.glowBasic(...c)); m.position.set(x, y, z); root.add(m); return m; };
    this.ledReady = led(-0.0792, 0.034, -0.07, [0.2, 2.4, 0.4]); this.ledBusy = led(-0.0792, 0.034, -0.055, [2.6, 0.3, 0.1]);

    // ---- the rocket sitting in the muzzle -------------------------------------------------------------------------
    const rb = new K.Builder();
    const rbody = new THREE.MeshStandardMaterial({ color: 0xdcd6c2, roughness: 0.4, metalness: 0.4, envMap: M.env, envMapIntensity: 1.2 });
    const rnose = new THREE.MeshStandardMaterial({ color: 0xd2442a, roughness: 0.28, metalness: 0.35, envMap: M.env, envMapIntensity: 1.4, emissive: 0x2a0602 });
    const rband = new THREE.MeshStandardMaterial({ color: 0xe6b422, roughness: 0.45, metalness: 0.3 });
    rb.cylZ(rbody, 0.042, 0.042, 0.26, 0, 0, -0.42, 20);
    rb.cylZ(rband, 0.0435, 0.0435, 0.022, 0, 0, -0.52, 20);
    rb.cylZ(rnose, 0.05, 0.043, 0.04, 0, 0, -0.54, 20);
    rb.sph(rnose, 0.082, 0, 0, -0.6, 1, 1, 1.05, 24, 14);
    rb.cylZ(rnose, 0.006, 0.05, 0.085, 0, 0, -0.69, 20);
    rb.tor(rband, 0.078, 0.005, 0, 0, -0.585, 0, 0, 0, 24, 6);
    rb.sph(M.steel, 0.008, 0, 0, -0.735, 1, 1, 1, 8, 6);
    this.rocket = rb.build(new THREE.Group()); root.add(this.rocket);

    // ---- muzzle, flash, puffs --------------------------------------------------------------------------------------
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0, -0.74); root.add(this.muzzle);
    this.flash = g.vfx.createFlash('rocket'); this.muzzle.add(this.flash.object3d);
    // ---- hands ---------------------------------------------------------------------------------------------------
    const rh = K.buildHand(M, { R: 0.02, trigger: true }); K.poseHand(rh, new THREE.Vector3(0.006, -0.125, 0.06), _v.set(0.5, -0.36, 0.8), _u.set(0, -0.96, 0.27), false); root.add(rh);
    const lh = K.buildHand(M, { R: 0.0185 }); K.poseHand(lh, new THREE.Vector3(0, -0.14, -0.22), _v.set(-0.42, -0.42, 0.8), _u.set(0, 1, 0), true); root.add(lh);
    this.hands = [rh, lh];
    this.smoke = new K.Puffs(this.root, 16, K.smokeTexture(), { color: 0xb8b4ac, drag: 2.2 });
    this.fire = new K.Puffs(this.root, 4, K.glowTexture(), { additive: true, color: new THREE.Color(1.6, 0.8, 0.3), drag: 3 });
    return root;
  }

  init() { super.init(); this.root.rotation.y = 0.28; }

  onSelect() { this.smoke.clear(); this.fire.clear(); this.smokeLeft = 0; this.state = 'idle'; this.st = 99; this.emptyT = 0; this.rocketOn = this.hasAmmo(); this.rocket.visible = this.rocketOn; this.rocket.position.z = 0; }
  canSwitch() { return this.state === 'idle' || this.st > 0.22; }

  think(dt, ctx) {
    if (!ctx.fire || this.cool > 0 || this.state !== 'idle') return;
    if (!this.hasAmmo()) {
      if (this.emptyT <= 0) { this.game.audio.play('empty'); this.emptyT = 0.5; this.game.weapons.autoSwitch(); }
      return;
    }
    this.shoot();
  }

  shoot() {
    const g = this.game;
    this.consume();
    this.state = 'fire'; this.st = 0; this.cool = 20 * TIC; this.rocketOn = false;
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
    this.kickBack(0.09, 0.10, 0.034, 0.012);
    g.player.shake?.(0.4);
    g.hud?.flash?.('#ffb060', 0.14, 0.12);
    this.blast();
    bus.emit('weapon:fire', { id: 'rocket' });
    if (!this.hasAmmo()) g.weapons.autoSwitch();
  }

  // muzzle smoke + backblast wash in view space
  blast() {
    for (let i = 0; i < 5; i++) this.smoke.emit(rand(-0.02, 0.02), rand(-0.02, 0.02), -0.7, rand(-0.18, 0.18), rand(-0.05, 0.25), rand(-1.4, -0.4), rand(0.7, 1.1), 0.08, rand(0.3, 0.5), 0.55, rand(-1, 1));
    for (let i = 0; i < 5; i++) this.smoke.emit(rand(-0.04, 0.04), rand(-0.02, 0.05), 0.16, rand(-0.5, 0.5), rand(-0.1, 0.45), rand(0.15, 0.5), rand(0.45, 0.7), 0.1, rand(0.35, 0.6), 0.4, rand(-1.5, 1.5));
    this.fire.emit(0, 0, -0.74, 0, 0, -0.2, 0.16, 0.2, 0.5, 0.9);
    this.smokeLeft = 0.9;
  }

  animate(dt, ctx) {
    this.emptyT = Math.max(0, this.emptyT - dt);
    this.st += dt;
    if (this.state === 'fire' && this.st > 0.2) { this.state = 'reload'; this.st = 0; this.rocketOn = this.hasAmmo(); }
    if (this.state === 'reload') {
      const k = clamp(this.st / 0.3, 0, 1);
      this.rocket.position.z = (1 - easeOut(k)) * 0.2;
      if (k >= 1) { this.state = 'idle'; this.rocket.position.z = 0; }
    }
    this.rocket.visible = this.rocketOn && (this.state !== 'reload' || this.rocket.position.z < 0.19);
    // lingering smoke curling from the muzzle
    if (this.smokeLeft > 0) {
      this.smokeLeft -= dt;
      if ((this.smokeT -= dt) <= 0) { this.smokeT = 0.06; this.smoke.emit(rand(-0.02, 0.02), rand(-0.02, 0.02), -0.7, rand(-0.02, 0.02), rand(0.05, 0.14), rand(-0.2, -0.05), 1.1, 0.05, 0.22, 0.28 * clamp(this.smokeLeft / 0.5, 0, 1), rand(-0.5, 0.5)); }
    }
    this.model.position.set(Math.cos(this.time * 1.1) * 0.0008, Math.sin(this.time * 1.7) * 0.001, 0);
    // ammo display + LEDs
    const n = this.game.weapons.ammo.rockets; if (n !== this.ammoShown) { this.ammoShown = n; this.lcd.set(n, n); }
    const busy = this.state !== 'idle' || this.cool > 0;
    this.ledReady.visible = !busy && n > 0; this.ledBusy.visible = busy || n <= 0;
    this.flash.update(dt); this.smoke.update(dt); this.fire.update(dt);
  }
}
