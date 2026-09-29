// Base class for first-person weapons. Subclasses implement buildModel(), think(), animate().
// Viewmodel space: the model lives in game.viewCamera space (camera looks down -Z, +X right, +Y up).
// Build each model so the grip is near the origin and the barrel points toward -Z; set this.muzzle to an Object3D at the muzzle tip.
import * as THREE from 'three';
import { clamp, rand, randInt, TIC } from '../core.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _m = new THREE.Vector3();
const _mi = new THREE.Matrix4();
const _cm = new THREE.Matrix4(), _cr = new THREE.Matrix4(), _ce = new THREE.Euler(), _cp = new THREE.Vector3(), _cq = new THREE.Vector3(), _cd = new THREE.Vector3();
const easeOut = (t) => 1 - (1 - t) * (1 - t);
// Hip fire: the barrel points (almost) straight ahead and converges on the crosshair at this distance (m). The gun sits low and to the right of the view axis, so the
// convergence angle is only ~1 degree: no diagonal "resting on the shoulder" cant.
const HIP_CONVERGE = 10;
// Aim-down-sights recoil factors (see kickBack): viewmodel spring kick x0.7, camera kick x0.6 while fully aimed.
export const ADS_VIEW_RECOIL = 0.7, ADS_CAM_RECOIL = 0.6;

export class Weapon {
  // def: {id, name, slot, ammoType: 'bullets'|'shells'|'rockets'|'cells'|null, ammoPerShot, raiseTime=0.32, lowerTime=0.22}
  constructor(game, def) {
    this.game = game; this.id = def.id; this.name = def.name; this.slot = def.slot;
    this.ammoType = def.ammoType ?? null; this.ammoPerShot = def.ammoPerShot ?? 1;
    this.raiseTime = def.raiseTime ?? 0.32; this.lowerTime = def.lowerTime ?? 0.22;
    this.root = new THREE.Group(); this.root.visible = false;
    this.rest = new THREE.Vector3(0.2, -0.2, -0.32); // resting (hip) position of the root in view space
    this.model = null; this.muzzle = null;
    // Hip / ADS poses. The model's yaw / pitch are derived (see update) and read by the subclasses' animate() as this.viewYaw / this.viewPitch:
    //   hip = a tiny inward convergence (or hipAim = [yaw, pitch] when a subclass overrides it), ads = solved from the sight anchors (see solveAds).
    this.hipAim = null; this.hipYaw = 0; this.hipPitch = 0; this.viewYaw = 0; this.viewPitch = 0;
    // ADS definition (subclass sets it in its constructor, `gun` is the group the points are expressed in):
    //   {fov: world camera FOV while aimed (deg), vfov: viewmodel camera FOV while aimed (deg, omitted = unchanged), depth: distance (m) from the eye to the `rear` point,
    //    rear / front: two points [x, y, z] in gun space that define the line of sight (the view axis) ~ the tops of the rear and front sights, dx / dy: fine offsets (m),
    //    spread: multiplier of the hitscan spread at full ADS}. null = no ADS (fist, chainsaw: RMB does nothing for the fist, the chainsaw uses it to rev the engine).
    this.adsSpec = null; this.adsPose = null; this.adsE = 0; // adsE = eased 0..1 blend, written by the weapon manager every frame
    this.raise = 0; this.dir = -1; this.selected = false;
    this.kickZ = 0; this.kickVZ = 0; this.kickR = 0; this.kickVR = 0; // recoil springs (position z, rotation x)
    this.time = 0; this.cool = 0; // cool = seconds until next shot allowed (weapon-managed)
  }
  init() { this.model = this.buildModel(); if (this.model) this.root.add(this.model); this.root.position.copy(this.rest); this.solvePoses(); }

  // Position of `obj` in root space at the rest pose (every ancestor's local transform up to, excluding, this.root; the model has not been animated yet).
  rootPos(obj, out) {
    _cm.identity();
    for (let o = obj; o && o !== this.root; o = o.parent) { o.updateMatrix(); _cm.premultiply(o.matrix); }
    return out.setFromMatrixPosition(_cm);
  }
  // Hip convergence + ADS pose. Called once after the model exists (rest transforms: model.rotation is identity).
  solvePoses() {
    if (this.hipAim) { this.hipYaw = this.hipAim[0]; this.hipPitch = this.hipAim[1]; }
    else if (this.muzzle && this.model) {
      this.rootPos(this.muzzle, _cp); const x = this.rest.x + _cp.x, y = this.rest.y + _cp.y;
      this.hipYaw = Math.atan2(x, HIP_CONVERGE); this.hipPitch = Math.atan2(-y, HIP_CONVERGE); // +yaw swings -Z toward -X (toward the view axis), +pitch lifts the muzzle
    }
    this.viewYaw = this.hipYaw; this.viewPitch = this.hipPitch;
    this.adsPose = this.solveAds();
  }
  // ADS pose: rotate the model so the sight line (rear -> front) runs along -Z, then translate so it passes through the eye (view-space origin, which is the screen centre
  // and therefore the crosshair) with the `rear` point `depth` metres in front of the eye. The model's Euler order is XYZ (R = Rx(pitch) * Ry(yaw)), the same the subclasses use.
  solveAds() {
    const s = this.adsSpec; if (!s || !s.rear || !s.front || !this.model) return null;
    // the model's own pose (yaw / pitch / breathing offsets) is what we are solving for: evaluate the rest transforms (also correct when called again at run time, e.g. by tools)
    const mp = this.model.position.clone(), mr = this.model.rotation.clone(); this.model.position.set(0, 0, 0); this.model.rotation.set(0, 0, 0);
    this.gun.updateMatrix(); this.model.updateMatrix();
    _cm.multiplyMatrices(this.model.matrix, this.gun.matrix);
    this.model.position.copy(mp); this.model.rotation.copy(mr);
    const pr = _cq.set(s.rear[0], s.rear[1], s.rear[2]).applyMatrix4(_cm).clone(), pf = _cp.set(s.front[0], s.front[1], s.front[2]).applyMatrix4(_cm);
    const d = _cd.subVectors(pf, pr).normalize();
    const yaw = Math.atan2(d.x, -d.z), L = Math.hypot(d.x, d.z), pitch = Math.atan2(-d.y, L);
    _ce.set(pitch, yaw, 0, 'XYZ'); _cr.makeRotationFromEuler(_ce);
    pr.applyMatrix4(_cr);
    return { x: -pr.x + (s.dx || 0), y: -pr.y + (s.dy || 0), z: -(s.depth ?? 0.3) - pr.z, yaw, pitch };
  }
  buildModel() { return new THREE.Group(); }
  think(dt, ctx) {} // fire logic; only called when fully raised
  animate(dt, ctx) {} // pose parts each frame (also called while raising/lowering)

  select() { this.selected = true; this.dir = 1; this.root.visible = true; this.onSelect?.(); }
  deselect() { this.dir = -1; this.onDeselect?.(); }
  isLowered() { return this.dir < 0 && this.raise <= 0.001; }
  get ready() { return this.dir > 0 && this.raise >= 0.999; }
  // Busy weapons (mid-animation) may refuse to be lowered; the manager waits until canSwitch() is true.
  canSwitch() { return true; }

  update(dt, ctx) {
    // cooldown with carry-over: when the timer runs out mid-frame, the leftover part of the frame is credited to the next cooldown
    // (otherwise every cycle is up to one frame too long: pistol 14 -> 14.6 tics at 60 fps, 15.2 at 30 fps)
    const c0 = this.cool; this.time += dt; this.cool = c0 - dt < 1e-6 ? 0 : c0 - dt;
    const over = c0 > 0 && this.cool === 0 ? Math.min(dt, dt - c0) : 0;
    this.raise = clamp(this.raise + this.dir * dt / (this.dir > 0 ? this.raiseTime : this.lowerTime), 0, 1);
    if (this.dir < 0 && this.raise <= 0) { this.root.visible = false; this.selected = false; }
    // recoil springs
    const k = 180, c = 16;
    this.kickVZ += (-k * this.kickZ - c * this.kickVZ) * dt; this.kickZ += this.kickVZ * dt;
    this.kickVR += (-k * this.kickR - c * this.kickVR) * dt; this.kickR += this.kickVR * dt;
    // hip <-> ADS blend (adsE is eased by the weapon manager); animate() reads this.viewYaw / this.viewPitch
    const e = this.adsE, ap = e > 0 ? this.adsPose : null;
    let px = this.rest.x, py = this.rest.y, pz = this.rest.z, vy = this.hipYaw, vp = this.hipPitch;
    if (ap) { px += (ap.x - px) * e; py += (ap.y - py) * e; pz += (ap.z - pz) * e; vy += (ap.yaw - vy) * e; vp += (ap.pitch - vp) * e; }
    this.viewYaw = vy; this.viewPitch = vp;
    this.root.position.set(px, py - (1 - easeOut(this.raise)) * 0.6, pz + this.kickZ);
    this.root.rotation.x = this.kickR;
    if (this.ready) { this.think(dt, ctx); if (over > 0 && c0 > 0 && this.cool > 0) this.cool = Math.max(0, this.cool - over); }
    this.animate(dt, ctx);
  }

  hasAmmo(n = this.ammoPerShot) { return !this.ammoType || this.game.weapons.ammo[this.ammoType] >= n; }
  consume(n = this.ammoPerShot) { return !this.ammoType || this.game.weapons.consumeAmmo(this.ammoType, n); }

  // Viewmodel + camera recoil. z: metres pushed back, rot: radians of muzzle-up rotation, pitch/yaw: camera kick in radians.
  // While aimed the viewmodel kicks x0.7 and the camera x0.6 (steadier sights).
  kickBack(z = 0.06, rot = 0.1, pitch = 0.008, yaw = 0) {
    const e = this.adsE, vk = 1 - (1 - ADS_VIEW_RECOIL) * e, ck = 1 - (1 - ADS_CAM_RECOIL) * e;
    this.kickVZ += z * vk * 40; this.kickVR += rot * vk * 40; // +rotation.x tips the barrel (-Z) UP: recoil = muzzle rise
    this.game.player?.kick(pitch * ck, yaw * ck * (Math.random() - 0.5) * 2);
  }
  // scale for a weapon's own animated recoil flips (gun.rotation.x = flip * ...) so they follow the same ADS damping as the springs
  get recoilK() { return 1 - (1 - ADS_VIEW_RECOIL) * this.adsE; }

  // World-space point that matches where the viewmodel muzzle appears on screen (viewCamera has a different FOV from the world camera).
  muzzleWorld(out = new THREE.Vector3()) {
    const g = this.game, cam = g.camera;
    if (!this.muzzle) return out.copy(g.player.eye);
    this.muzzle.updateWorldMatrix(true, false);
    _m.setFromMatrixPosition(this.muzzle.matrixWorld);
    _u.copy(_m).applyMatrix4(_mi.copy(g.viewCamera.matrixWorld).invert()); // view-space (fresh inverse: three only refreshes it at render time)
    const depth = -_u.z;
    _u.copy(_m).project(g.viewCamera); // ndc
    _r.set(_u.x, _u.y, 0.5).unproject(cam).sub(cam.position).normalize();
    cam.getWorldDirection(_f);
    const c = Math.max(0.2, _r.dot(_f));
    return out.copy(cam.position).addScaledVector(_r, depth / c);
  }

  // Fire hitscan bullets. Applies damage, impacts, tracers, audio for impacts. Returns number of enemies hit.
  // o: {count=1, spreadH=0, spreadV=0 (radians, triangular distribution), damage:()=>number, range=64, tracer='bullet', damageType='bullet', tracerChance=1}
  fireBullets(o = {}) {
    const g = this.game, ray = g.player.getAimRay();
    const count = o.count ?? 1, range = o.range ?? 64, dmg = o.damage || (() => 5 * randInt(1, 3));
    // aimed shots are tighter (adsSpec.spread at full ADS); a perfectly accurate first shot (spread 0) stays perfectly accurate
    const sk = this.adsSpec && this.adsSpec.spread != null ? 1 + (this.adsSpec.spread - 1) * this.adsE : 1, sH = (o.spreadH || 0) * sk, sV = (o.spreadV || 0) * sk;
    this.muzzleWorld(_o); // must run BEFORE the spread basis is built: muzzleWorld() uses the shared _r/_u scratch vectors
    _r.crossVectors(ray.dir, _u.set(0, 1, 0)).normalize(); _u.crossVectors(_r, ray.dir).normalize();
    const mDist = ray.origin.distanceTo(_o); // muzzle depth: a hit closer than this (point blank / wall in your face) must not start its tracer behind the target
    let hits = 0;
    for (let i = 0; i < count; i++) {
      _d.copy(ray.dir).addScaledVector(_r, (rand() - rand()) * Math.tan(sH)).addScaledVector(_u, (rand() - rand()) * Math.tan(sV)).normalize();
      const hit = g.combat.castRay(ray.origin, _d, range);
      const end = hit ? hit.point : new THREE.Vector3().copy(ray.origin).addScaledVector(_d, range);
      if (o.tracer !== false && Math.random() < (o.tracerChance ?? 1)) g.vfx.tracer(hit && hit.dist < mDist ? ray.origin : _o, end, { style: o.tracer || 'bullet' });
      if (!hit) continue;
      if (hit.kind === 'enemy') {
        hits++;
        g.enemies.damage(hit.enemy, dmg(), { point: hit.point.clone(), dir: _d.clone(), type: o.damageType || 'bullet', source: 'player', part: hit.part, dist: hit.dist });
        g.vfx.impact(hit.point, hit.normal, 'flesh');
      } else {
        g.vfx.impact(hit.point, hit.normal, hit.surface);
        if (i < 3 || Math.random() < 0.25) { const metal = hit.surface === 'metal' || hit.surface === 'train'; g.audio.play(metal ? (Math.random() < 0.3 ? 'ricochet' : 'impactMetal') : 'impactConcrete', hit.point); }
      }
    }
    return hits;
  }
}
export { TIC };
