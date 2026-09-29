// Chaingun: 6-barrel rotary gun, belt-fed. 1 bullet / 4 tics, 5/10/15 dmg, first shot accurate then +-5.6deg spread.
import * as THREE from 'three';
import { Weapon } from './base.js';
import { TIC, bus, damp, rand, randInt } from '../core.js';
import * as K from './kitb.js';

const _o = new THREE.Vector3(), _v = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const SPIN_MAX = 24; // rad/s
const BELT_N = 9;
const P0 = new THREE.Vector3(-0.122, 0.03, 0.06), P1 = new THREE.Vector3(-0.13, 0.072, 0.05), P2 = new THREE.Vector3(-0.056, 0.036, 0.04);
const _dummy = new THREE.Object3D();

export default class Chaingun extends Weapon {
  constructor(game) {
    super(game, { id: 'chaingun', name: 'CHAINGUN', slot: 4, ammoType: 'bullets', ammoPerShot: 1, raiseTime: 0.36, lowerTime: 0.26 });
    this.rest.set(0.19, -0.125, -0.63);
    this.nextShot = 0; this.spin = 0; this.spinAngle = 0; this.refire = 0; this.emptyT = 0; this.heat = 0; this.hot = 0; this.beltPos = 0; this.beltTarget = 0; this.smokeT = 0;
  }

  init() { super.init(); this.root.rotation.y = 0.3; }

  buildModel() {
    const g = this.game, M = K.getMats(g), root = new THREE.Group();
    const paint = K.paintMat(g, '#77855a', 41), paintDark = K.paintMat(g, '#4a5340', 42);
    this.barrelMat = M.darkSteel.clone(); this.barrelMat.color.set(0x6b727c); this.barrelMat.emissive = new THREE.Color(0xff4a10); this.barrelMat.emissiveIntensity = 0;
    const b = new K.Builder();

    // ---- receiver ------------------------------------------------------------------------------------------------
    b.box(paint, 0.112, 0.1, 0.23, 0, -0.005, 0.015);
    b.box(M.steel, 0.104, 0.018, 0.17, 0, 0.052, 0.03);
    b.box(M.darkSteel, 0.006, 0.07, 0.15, -0.058, -0.005, 0.035);
    b.box(M.darkSteel, 0.006, 0.07, 0.15, 0.058, -0.005, 0.035);
    for (const sx of [-1, 1]) for (const zz of [-0.03, 0.1]) for (const yy of [-0.03, 0.02]) b.cylX(M.steel, 0.0052, 0.005, sx * 0.0625, yy, zz, 8);
    b.box(M.darkSteel, 0.1, 0.09, 0.02, 0, -0.005, 0.14);                          // rear plate
    b.cylZ(M.steel, 0.018, 0.018, 0.012, 0, -0.005, 0.156, 12);
    b.box(M.black, 0.004, 0.032, 0.06, 0.0585, 0.012, 0.03);                    // ejection port (right)
    b.box(M.steel, 0.004, 0.004, 0.06, 0.0595, 0.029, 0.03);
    // ---- drive housing --------------------------------------------------------------------------------------------
    b.cylZ(paint, 0.058, 0.06, 0.1, 0, 0, -0.15, 20);
    b.cylZ(M.darkSteel, 0.066, 0.066, 0.012, 0, 0, -0.106, 20);
    b.cylZ(M.darkSteel, 0.066, 0.066, 0.012, 0, 0, -0.196, 20);
    for (let i = 0; i < 6; i++) b.box(M.black, 0.003, 0.02, 0.012, -0.0615, 0.0, -0.13 - i * 0.012, 0, 0, 0); // vents (left)
    for (let i = 0; i < 4; i++) b.cylZ(M.steel, 0.0625, 0.0625, 0.004, 0, 0, -0.122 - i * 0.02, 20);
    // ---- top handle, sights ---------------------------------------------------------------------------------------
    b.box(M.darkSteel, 0.014, 0.05, 0.014, 0, 0.086, 0.07); b.box(M.darkSteel, 0.014, 0.05, 0.014, 0, 0.086, -0.05);
    b.cylZ(M.rubber, 0.0135, 0.0135, 0.15, 0, 0.114, 0.01, 12);
    b.box(M.black, 0.03, 0.014, 0.02, 0, 0.066, 0.135); b.box(M.steel, 0.004, 0.02, 0.006, 0, 0.078, 0.14);
    // ---- feed tray + ammo box (left) ------------------------------------------------------------------------------
    b.box(M.steel, 0.05, 0.026, 0.1, -0.08, 0.026, 0.035); b.box(M.darkSteel, 0.05, 0.006, 0.106, -0.08, 0.042, 0.035);
    b.box(paintDark, 0.062, 0.075, 0.11, -0.122, -0.012, 0.07);
    b.box(M.darkSteel, 0.066, 0.008, 0.114, -0.122, 0.027, 0.07);
    for (let i = 0; i < 3; i++) b.box(M.darkSteel, 0.002, 0.065, 0.008, -0.1535, -0.012, 0.03 + i * 0.04);
    b.box(M.steel, 0.012, 0.02, 0.03, -0.155, 0.01, 0.07); b.box(M.rubber, 0.03, 0.01, 0.05, -0.122, 0.034, 0.1);
    b.box(M.darkSteel, 0.006, 0.05, 0.04, -0.094, -0.012, 0.03);
    // ---- pistol grip + trigger guard ------------------------------------------------------------------------------
    b.box(M.rubber, 0.04, 0.115, 0.05, 0, -0.12, 0.06, -0.25, 0, 0);
    b.box(M.darkSteel, 0.044, 0.02, 0.06, 0, -0.058, 0.055);
    b.box(M.darkSteel, 0.006, 0.006, 0.046, 0, -0.07, 0.01); b.box(M.darkSteel, 0.006, 0.03, 0.006, 0, -0.056, -0.012);
    b.box(M.steel, 0.006, 0.02, 0.008, 0, -0.056, 0.03, 0.3, 0, 0);
    // ---- foregrip -------------------------------------------------------------------------------------------------
    b.box(M.darkSteel, 0.03, 0.02, 0.04, 0, -0.068, -0.15);
    b.cyl(M.rubber, 0.0185, 0.0175, 0.1, 0, -0.14, -0.15, 0, 0, 0, 12);
    b.cyl(M.darkSteel, 0.02, 0.02, 0.008, 0, -0.192, -0.15, 0, 0, 0, 12);
    // ---- label decal-ish plates ------------------------------------------------------------------------------------
    const bodyMesh = b.build(new THREE.Group()); root.add(bodyMesh);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.05), new THREE.MeshStandardMaterial({ map: K.stencilTexture(['CHAINGUN', 'M-9 · 5.56'], { w: 256, h: 128, size: 36 }), transparent: true, roughness: 0.8, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    label.rotation.y = -Math.PI / 2; label.position.set(-0.0612, 0.0, 0.03); root.add(label);
    const hazard = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.03), new THREE.MeshStandardMaterial({ map: K.stencilTexture(['CAUTION', 'HOT BARRELS'], { w: 256, h: 96, size: 30, color: '#ffd24a' }), transparent: true, roughness: 0.8, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    hazard.rotation.x = -Math.PI / 2; hazard.rotation.z = 0; hazard.position.set(0, 0.0615, 0.03); root.add(hazard);

    // ---- rotating barrel cluster ---------------------------------------------------------------------------------
    const bb = new K.Builder(); this.barrels = new THREE.Group(); const BM = this.barrelMat;
    bb.cylZ(M.steel, 0.018, 0.02, 0.54, 0, 0, -0.42, 10);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2, x = Math.cos(a) * 0.04, y = Math.sin(a) * 0.04;
      bb.cylZ(BM, 0.0138, 0.0144, 0.46, x, y, -0.43, 10);
      bb.cylZ(M.steel, 0.0168, 0.0168, 0.022, x, y, -0.652, 10);
      bb.cylZ(M.black, 0.0092, 0.0092, 0.002, x, y, -0.6635, 10);
      bb.cylZ(M.steel, 0.0158, 0.0158, 0.008, x, y, -0.5, 10); // barrel band
    }
    for (const z of [-0.235, -0.4, -0.6]) {
      bb.cylZ(M.darkSteel, 0.022, 0.022, 0.016, 0, 0, z, 12);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.52; bb.box(M.darkSteel, 0.03, 0.01, 0.014, Math.cos(a) * 0.03, Math.sin(a) * 0.03, z, 0, 0, a); }
      bb.tor(M.steel, 0.057, 0.0065, 0, 0, z, 0, 0, 0, 24, 6);
    }
    bb.build(this.barrels); root.add(this.barrels);
    this.blurMat = new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const blur = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.4, 24, 1, true), this.blurMat); blur.rotation.x = Math.PI / 2; blur.position.z = -0.44; blur.frustumCulled = false; root.add(blur);
    // fixed front bearing ring
    const fb = new K.Builder(); fb.tor(M.steel, 0.066, 0.009, 0, 0, -0.208, 0, 0, 0, 24, 6); fb.build(root);

    // ---- muzzle + flash + ejection port -------------------------------------------------------------------------
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0, -0.665); root.add(this.muzzle);
    this.flash = g.vfx.createFlash('chaingun'); this.muzzle.add(this.flash.object3d);
    this.port = new THREE.Object3D(); this.port.position.set(0.062, 0.012, 0.03); root.add(this.port);

    // ---- ammo belt (instanced) ----------------------------------------------------------------------------------
    const brassG = new THREE.CylinderGeometry(0.0062, 0.0062, 0.03, 8).rotateX(-Math.PI / 2);
    const tipG = new THREE.CylinderGeometry(0.0016, 0.0062, 0.014, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.022);
    const linkG = new THREE.BoxGeometry(0.0158, 0.004, 0.014).translate(0, 0, 0.004);
    this.beltMeshes = [new THREE.InstancedMesh(brassG, M.brass, BELT_N), new THREE.InstancedMesh(tipG, M.copper, BELT_N), new THREE.InstancedMesh(linkG, M.darkSteel, BELT_N)];
    for (const m of this.beltMeshes) { m.frustumCulled = false; root.add(m); }
    this.updateBelt();

    // ---- hands ----------------------------------------------------------------------------------------------------
    const rh = K.buildHand(M, { R: 0.02, trigger: true }); K.poseHand(rh, new THREE.Vector3(0.006, -0.118, 0.06), _v.set(0.5, -0.36, 0.8), _u.set(0, -0.96, 0.27), false); root.add(rh);
    const lh = K.buildHand(M, { R: 0.0185 }); K.poseHand(lh, new THREE.Vector3(0, -0.14, -0.15), _v.set(-0.42, -0.42, 0.8), _u.set(0, 1, 0), true); root.add(lh);
    this.hands = [rh, lh];

    // ---- puffs (barrel smoke) ------------------------------------------------------------------------------------
    this.puffs = new K.Puffs(this.root, 10, K.smokeTexture(), { color: 0x9a9a9a, drag: 1.8 });
    return root;
  }

  updateBelt() {
    const n = BELT_N;
    for (let i = 0; i < n; i++) {
      const t = (((i / n) + this.beltPos) % 1 + 1) % 1, u = 1 - t;
      const x = u * u * P0.x + 2 * u * t * P1.x + t * t * P2.x, y = u * u * P0.y + 2 * u * t * P1.y + t * t * P2.y, z = P0.z;
      const tx = 2 * u * (P1.x - P0.x) + 2 * t * (P2.x - P1.x), ty = 2 * u * (P1.y - P0.y) + 2 * t * (P2.y - P1.y);
      const s = Math.max(0.001, Math.min(1, t * 9, u * 9));
      _dummy.position.set(x, y, z); _dummy.rotation.set(0, 0, Math.atan2(ty, tx)); _dummy.scale.set(s, s, s); _dummy.updateMatrix();
      for (const m of this.beltMeshes) m.setMatrixAt(i, _dummy.matrix);
    }
    for (const m of this.beltMeshes) m.instanceMatrix.needsUpdate = true;
  }

  onSelect() { this.refire = 0; this.emptyT = 0; this.nextShot = 0; this.puffs.clear(); }

  think(dt, ctx) {
    if (!ctx.fire) { this.refire = 0; return; }
    if (this.time < this.nextShot) return;
    if (!this.hasAmmo()) {
      if (this.emptyT <= 0) { this.game.audio.play('empty'); this.emptyT = 0.45; this.game.weapons.autoSwitch(); }
      return;
    }
    this.shoot();
  }

  shoot() {
    const g = this.game;
    const iv = 4 * TIC; this.nextShot = (this.time - this.nextShot < iv) ? this.nextShot + iv : this.time + iv;   // keeps the exact 8.75/s cadence across frame quantisation
    this.consume();
    const first = this.refire === 0; this.refire++;
    this.fireBullets({ count: 1, spreadH: first ? 0 : 5.6 * K.DEG, spreadV: 0, damage: () => 5 * randInt(1, 3), tracer: 'chaingun', damageType: 'bullet' });
    g.audio.play('chaingun');
    // flash, light
    this.flash.object3d.rotation.z = rand(0, 6.28); this.flash.fire(rand(0.9, 1.25));
    this.muzzleWorld(_o); g.vfx.light(_o, 0xffc27a, 2.4, 0.07);
    // casing
    K.viewToWorld(g, this.port, _o);
    K.camBasis(g, _r, _u);
    _v.copy(_r).multiplyScalar(rand(1.5, 2.6)).addScaledVector(_u, rand(1.1, 2.1));
    _v.x += g.player.vel?.x * 0.5 || 0; _v.z += g.player.vel?.z * 0.5 || 0;
    g.vfx.shell(_o, _v, 'bullet');
    // recoil / feel
    this.kickBack(0.02, 0.026, 0.0055, 0.0045);
    g.player.shake?.(0.16);
    this.beltTarget += 1 / BELT_N;
    this.hot = Math.min(1, this.hot + 0.012);
    bus.emit('weapon:fire', { id: 'chaingun' });
    if (!this.hasAmmo()) g.weapons.autoSwitch();
  }

  animate(dt, ctx) {
    this.emptyT = Math.max(0, this.emptyT - dt);
    const firing = !!ctx.fire && this.ready && this.hasAmmo();
    const target = firing ? SPIN_MAX : 0;
    if (this.spin < target) this.spin = Math.min(target, this.spin + 110 * dt); else this.spin = Math.max(target, this.spin - 14 * dt);
    this.spinAngle += this.spin * dt; this.barrels.rotation.z = this.spinAngle;
    const sp = this.spin / SPIN_MAX;
    this.blurMat.opacity = sp * sp * 0.32;
    this.heat = damp(this.heat, firing && this.spin > 8 ? 1 : 0, firing ? 20 : 7, dt);
    this.hot = firing ? this.hot : Math.max(0, this.hot - dt * 0.16);
    this.barrelMat.emissiveIntensity = this.hot * this.hot * 2.2;
    // vibration
    const j = this.heat * 0.0016;
    const t = this.time;
    this.model.position.set(Math.cos(t * 1.1) * 0.0007 + (Math.random() - 0.5) * 2 * j, Math.sin(t * 1.7) * 0.0009 + (Math.random() - 0.5) * 2 * j, (Math.random() - 0.5) * 2 * j);
    this.model.rotation.z = (Math.random() - 0.5) * this.heat * 0.008;
    // ammo belt feeds one round per shot
    this.beltPos = damp(this.beltPos, this.beltTarget, 24, dt);
    if (this.beltTarget > 50) { this.beltTarget -= 50; this.beltPos -= 50; }
    this.updateBelt();
    // hot barrels smoke
    if (this.hot > 0.35 && (this.smokeT -= dt) <= 0) {
      this.smokeT = 0.05; this.puffs.emit(rand(-0.03, 0.03), rand(-0.03, 0.03), -0.66, rand(-0.02, 0.02), rand(0.06, 0.14), rand(-0.25, -0.1), 0.9, 0.03, 0.16, 0.22 * this.hot, rand(-1, 1));
    }
    this.flash.update(dt); this.puffs.update(dt);
  }
}
