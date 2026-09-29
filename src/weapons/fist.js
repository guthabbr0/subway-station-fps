// Fists: two gloved, knuckle-plated fists in a boxing guard. Alternating jab/cross, 14-tic cycle, 2 m melee cone.
import * as THREE from 'three';
import { Weapon } from './base.js';
import { bus, randInt, TIC } from '../core.js';
import { getKit, Hand, POSES, keyframe, smooth, trackFire, warmup } from './kit_a.js';
import { solidMeleeProbe as meleeProbe } from './chainsaw/los.js'; // fists must not reach enemies behind thin solids

const K_DRIVE = [[0, 0], [2.2, -0.6], [4.6, 1], [8, 0.4], [14, 0]];
const CYCLE = 14 * TIC;
const _v = new THREE.Vector3();

// keyframe tables (times in tics) for the RIGHT fist; the left fist mirrors x / yaw / roll.
//        guard              windup             thrust (impact)     follow             back to guard
const T = [0, 2.2, 4.6, 7.5, 14];
const RK = {
  x: [0.105, 0.125, 0.030, 0.035, 0.105],
  y: [0.000, -0.035, 0.020, 0.015, 0.000],
  z: [-0.050, 0.030, -0.300, -0.280, -0.050],
  rx: [0.72, 0.90, 0.30, 0.34, 0.72],
  ry: [0.28, 0.55, 0.06, 0.08, 0.28],
  rz: [-1.00, -1.40, -0.30, -0.36, -1.00],
};
const KEYS = {}; for (const k of Object.keys(RK)) KEYS[k] = T.map((t, i) => [t, RK[k][i]]);
const at = (k, t) => keyframe(KEYS[k], t, smooth);

export default class Fist extends Weapon {
  constructor(game) {
    super(game, { id: 'fist', name: 'FISTS', slot: 1, ammoType: null, ammoPerShot: 0, raiseTime: 0.26, lowerTime: 0.18 });
    this.rest.set(0.0, -0.09, -0.25);
    this.t = 99; this.side = 0; this.struck = true; this.punchSide = 0; this._pf = false; this._edge = false; this._dbgT = null;
  }

  buildModel() {
    const kit = getKit(this.game);
    const model = new THREE.Group(); model.scale.setScalar(1.22); this.hands = [];
    for (const side of ['R', 'L']) {
      const hand = new Hand(kit, { side, pose: POSES.fist, freeze: true, knuckleStuds: true, sleeveLen: 0.55 });
      const piv = new THREE.Group(); piv.rotation.order = 'YXZ';
      piv.add(hand.group); model.add(piv);
      // fist origin sits at the wrist; shift so the pivot is near the knuckles / palm centre
      hand.group.position.set(0, 0, 0.05);
      this.hands.push({ hand, piv, sign: side === 'R' ? 1 : -1 });
    }
    // blood/tape accents on the knuckle studs are baked into the materials
    return model;
  }

  debugAt(t, side = 0) { this._dbgT = t; if (t !== null) this.punchSide = side; }

  update(dt, ctx) { if (!this.game.__waWarm) warmup(this.game); trackFire(this, ctx); super.update(dt, ctx); }
  onSelect() { this.t = 99; this.struck = true; }

  think(dt, ctx) {
    if (this._dbgT !== null || this.cool > 0 || !ctx.fire) return;
    this.punchSide = this.side; this.side ^= 1;
    this.t = 0; this.struck = false; this.cool = CYCLE;
    this.game.audio.play('punch');
  }

  strike() {
    const g = this.game, pr = meleeProbe(g, 2.0, 0.34);
    bus.emit('weapon:fire', { id: this.id });
    this.kickBack(0.02, 0.04, 0.006, 0.006);
    if (pr.kind === 'enemy') {
      const dmg = 2 * randInt(1, 10);
      g.enemies.damage(pr.enemy, dmg, { point: pr.point.clone(), dir: pr.dir.clone(), type: 'fist', source: 'player', part: pr.part, knock: 3.2, dist: pr.dist });
      g.vfx.impact(pr.point, pr.normal, 'flesh');
      g.vfx.blood(pr.point, pr.dir, 0.5 + dmg / 20);
      g.audio.play('punchHit', pr.point);
      g.player.shake(0.25 + dmg / 80);
      this.kickBack(0.015, 0.03, 0.010, 0.012);
      // small lunge toward the target
      if (pr.dist > 0.9 && g.player.grounded !== false) { _v.copy(pr.dir); _v.y = 0; if (_v.lengthSq() > 1e-4) g.player.impulse(_v.normalize().multiplyScalar(1.4)); }
    } else if (pr.kind === 'world') {
      g.audio.play('impactConcrete', pr.point, { volume: 0.5, rate: 1.4 });
      g.player.shake(0.12);
    }
  }

  animate(dt, ctx) {
    const dbg = this._dbgT !== null;
    if (dbg) this.t = this._dbgT; else this.t += dt;
    const tt = this.t / TIC, tm = this.time, r = this.raise;
    if (!this.struck && tt >= 4.4) { this.struck = true; this.strike(); }
    for (let i = 0; i < 2; i++) {
      const h = this.hands[i], sg = h.sign, punching = (this.punchSide === (i === 0 ? 0 : 1)) && tt < 14.0;
      // idle: gentle guard bob (opposite phase for each hand)
      const bob = Math.sin(tm * 1.9 + i * 2.2) * 0.006, sway = Math.sin(tm * 1.3 + i * 1.1) * 0.004;
      let x, y, z, rx, ry, rz;
      if (punching) { x = at('x', tt); y = at('y', tt); z = at('z', tt); rx = at('rx', tt); ry = at('ry', tt); rz = at('rz', tt); }
      else { x = RK.x[0]; y = RK.y[0] + bob; z = RK.z[0] + sway * 0.6; rx = RK.rx[0] + bob * 2; ry = RK.ry[0]; rz = RK.rz[0]; }
      // the off hand tucks in slightly while the other punches
      if (!punching && tt < 14) { const k = Math.sin(Math.min(1, tt / 14) * Math.PI); z += 0.035 * k; y -= 0.012 * k; }
      h.piv.position.set(x * sg, y, z);
      h.piv.rotation.set(rx, ry * sg, rz * sg);
    }
    // whole-model punch drive (shoulder roll) + raise tilt
    const drive = keyframe(K_DRIVE, tt, smooth) * (tt < 14 ? 1 : 0);
    const s = this.punchSide === 0 ? 1 : -1;
    this.model.position.set(-drive * 0.02 * s, 0, 0);
    this.model.rotation.set(-(1 - r) * 0.5, -drive * 0.05 * s, drive * 0.03 * s);
  }
}
