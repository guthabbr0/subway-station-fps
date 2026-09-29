// Base class for first-person weapons. Subclasses implement buildModel(), think(), animate().
// Viewmodel space: the model lives in game.viewCamera space (camera looks down -Z, +X right, +Y up).
// Build each model so the grip is near the origin and the barrel points toward -Z; set this.muzzle to an Object3D at the muzzle tip.
import * as THREE from 'three';
import { clamp, rand, randInt, TIC } from '../core.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _m = new THREE.Vector3();
const _mi = new THREE.Matrix4();
const easeOut = (t) => 1 - (1 - t) * (1 - t);

export class Weapon {
  // def: {id, name, slot, ammoType: 'bullets'|'shells'|'rockets'|'cells'|null, ammoPerShot, raiseTime=0.32, lowerTime=0.22}
  constructor(game, def) {
    this.game = game; this.id = def.id; this.name = def.name; this.slot = def.slot;
    this.ammoType = def.ammoType ?? null; this.ammoPerShot = def.ammoPerShot ?? 1;
    this.raiseTime = def.raiseTime ?? 0.32; this.lowerTime = def.lowerTime ?? 0.22;
    this.root = new THREE.Group(); this.root.visible = false;
    this.rest = new THREE.Vector3(0.2, -0.2, -0.32); // resting position of the root in view space
    this.model = null; this.muzzle = null;
    this.raise = 0; this.dir = -1; this.selected = false;
    this.kickZ = 0; this.kickVZ = 0; this.kickR = 0; this.kickVR = 0; // recoil springs (position z, rotation x)
    this.time = 0; this.cool = 0; // cool = seconds until next shot allowed (weapon-managed)
  }
  init() { this.model = this.buildModel(); if (this.model) this.root.add(this.model); this.root.position.copy(this.rest); }
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
    this.root.position.set(this.rest.x, this.rest.y - (1 - easeOut(this.raise)) * 0.6, this.rest.z + this.kickZ);
    this.root.rotation.x = this.kickR;
    if (this.ready) { this.think(dt, ctx); if (over > 0 && c0 > 0 && this.cool > 0) this.cool = Math.max(0, this.cool - over); }
    this.animate(dt, ctx);
  }

  hasAmmo(n = this.ammoPerShot) { return !this.ammoType || this.game.weapons.ammo[this.ammoType] >= n; }
  consume(n = this.ammoPerShot) { return !this.ammoType || this.game.weapons.consumeAmmo(this.ammoType, n); }

  // Viewmodel + camera recoil. z: metres pushed back, rot: radians of muzzle-up rotation, pitch/yaw: camera kick in radians.
  kickBack(z = 0.06, rot = 0.1, pitch = 0.008, yaw = 0) {
    this.kickVZ += z * 40; this.kickVR += rot * 40; // +rotation.x tips the barrel (-Z) UP: recoil = muzzle rise
    this.game.player?.kick(pitch, yaw * (Math.random() - 0.5) * 2);
  }

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
    this.muzzleWorld(_o); // must run BEFORE the spread basis is built: muzzleWorld() uses the shared _r/_u scratch vectors
    _r.crossVectors(ray.dir, _u.set(0, 1, 0)).normalize(); _u.crossVectors(_r, ray.dir).normalize();
    const mDist = ray.origin.distanceTo(_o); // muzzle depth: a hit closer than this (point blank / wall in your face) must not start its tracer behind the target
    let hits = 0;
    for (let i = 0; i < count; i++) {
      _d.copy(ray.dir).addScaledVector(_r, (rand() - rand()) * Math.tan(o.spreadH || 0)).addScaledVector(_u, (rand() - rand()) * Math.tan(o.spreadV || 0)).normalize();
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
