// CHAINSAW - the flagship melee weapon. Files: this one (fire logic, lunge, animation, integration) + chainsaw/{model,chain,fx,blood,paint,engine}.js
//   gameplay : Doom II chainsaw, better. 4 tics (4/35 s) per attack while fire is held, 2*(1d10) damage, 2.05 m reach, no ammo. Sawing a target drags you
//              in and swings the view onto it (never through enemies / walls / the platform edge; running away or turning the mouse overrides it); killing
//              blows frequently shred the victim into gibs; secondary fire (right mouse) revs the engine.
//   viewmodel: two-handed orange/black two-stroke saw, real instanced chain that motion-blurs with engine rpm, tremor scaled by rpm + load, pull-cord start
//              (left hand yanks the starter, the saw jerks, the engine catches with a shudder and a puff), exhaust smoke, oil fling, sparks on masonry/metal,
//              blood that accumulates on the bar / chain / gloves and slowly wipes off, gore flecks flung at the lens.
//   audio    : game.audio.chainsaw (RPM-driven engine) through ./chainsaw/engine.js: start on select, throttle on fire, load + bite per tooth, stop on
//              deselect / death / pause. Falls back to the legacy sawStart / sawIdle / sawFull / sawHit sounds when the audio module has no engine.
//   debug    : weapon.dbg = {c:[x,y,z], yaw, pitch, dist} orbits a debug camera around the saw (screenshots); set to null to return to the normal view.
import * as THREE from 'three';
import { Weapon } from './base.js';
import { bus, clamp, randInt, TIC } from '../core.js';
import { getKit, meleeProbe, trackFire, flashPulse, flashDecay, flashKill, warmup } from './kit_a.js';
import { buildSaw, gripPose } from './chainsaw/model.js';
import { SawFX } from './chainsaw/fx.js';
import { SawEngine } from './chainsaw/engine.js';
import { makeBloodUniforms } from './chainsaw/blood.js';
import { BAR } from './chainsaw/chain.js';

const HIT_S = 4 * TIC, RANGE = 2.05, WORLD_REACH = 1.5;
const GIB_CHANCE = { shambler: 0.62, runner: 0.72, trooper: 0.58, spitter: 0.62, exploder: 1, brute: 0.3, tyrant: 0.12 };
const LUNGE_SPEED = 2.6, LUNGE_GAP = 0.30, TURN_RATE = 1.5;

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _vi = new THREE.Matrix4(), _qa = new THREE.Quaternion(), _h = new THREE.Vector3(), _hy = new THREE.Vector3();
const g_shake = (g, v) => g.player?.shake?.(v);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export default class Chainsaw extends Weapon {
  constructor(game) {
    super(game, { id: 'chainsaw', name: 'CHAINSAW', slot: 1, ammoType: null, ammoPerShot: 0, raiseTime: 0.30, lowerTime: 0.22 });
    this.rest.set(0.16, -0.215, -0.60);
    this.U = makeBloodUniforms(); this.bloodLevel = 0; this.fresh = 1;
    this.engine = new SawEngine(game, this);
    // gameplay state
    this.hitT = 0; this.firing = false; this.inFlesh = false; this.relT = 0; this.lockT = 0; this.target = null; this._lastKill = null; this._cutTarget = null; this._tickN = 0;
    // animation state
    this.trig = 0; this.selT = 0; this.tickKick = 0; this.catchKick = 0; this.loadV = 0; this.lhL = 0; this.shudder = 0.3; this.rollKick = 0; this.jerk = 0;
    this.aimR = [0.35, -0.75, 0.55]; this.aimL = [-0.50, -0.75, 0.45];
    this.revCd = 0; this.revT = 0; this._altPrev = false; this.idleT = 2;
    this.puffAcc = 0; this.hazeAcc = 0; this.oilAcc = 0; this.dripAcc = 0; this.dbg = null;
    bus.on('game:start', () => { this.bloodLevel = 0; this.fresh = 1; this.fx?.clear(); if (this.game.weapons?.current !== this) this.engine.stop(); });
    bus.on('player:dead', () => { this.engine.stop(); this.firing = false; });
    bus.on('enemy:killed', (ev) => { if (ev.enemy === this._cutTarget) this._lastKill = ev; });
  }

  // ------------------------------------------------------------------------------------------------------------------------------ build
  buildModel() {
    const g = this.game, kit = getKit(g), model = new THREE.Group();
    this.S = buildSaw(g, kit, this.U);
    const S = this.S; this.saw = S.saw; this.chain = S.chain; this.handR = S.handR; this.handL = S.handL; this.idxF = S.idxF; this.trigger = S.trigger; this.cord = S.cord; this.pts = S.pts;
    model.add(S.saw); this.saw.rotation.set(0.16, 0.62, -0.08);
    for (const h of [S.handL, S.handR]) h.arm.scale.set(0.8, 0.8, 1);
    this.muzzle = S.pts.nose;
    this.fx = new SawFX(g);
    this.engine.warm();
    this._contact = new THREE.Object3D(); this.saw.add(this._contact);
    // left-hand poses (grip centre + orientation, saw-local): A = overhand on the front handle, B = gripping the pull cord
    this.lhA = { T: new THREE.Vector3(-0.030, 0.2035, -0.150), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(1.0, -0.8, -0.5, 'YXZ')) };
    this.lhB = { q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0.60, 0.2, 'YXZ')) };
    return model;
  }

  // ------------------------------------------------------------------------------------------------------------------------------ select / audio gating
  _canRun() { const g = this.game; return g.state === 'playing' && g.player.alive && g.weapons.current === this && this.selected && this.dir > 0; }
  onSelect() {
    this.selT = 0; this.firing = false; this.inFlesh = false; this.relT = 0; this.lockT = 0; this.target = null; this.hitT = 0.05; this.loadV = 0; this.lhL = 0; this.revT = 0; this.revCd = 0;
    this.engine.pull = 0;
    if (this._canRun()) this.engine.start();
  }
  onDeselect() {
    this.firing = false; this.lockT = 0; this.target = null; this.loadV = 0;
    this.engine.stop(); flashKill(this.game);
  }
  _gate() { const want = this._canRun(); if (want && !this.engine.on) { this.engine.start(); this.selT = Math.min(this.selT, 0.1); } else if (!want && this.engine.on) { this.engine.stop(); this.firing = false; } }

  update(dt, ctx) {
    if (!this.game.__waWarm) warmup(this.game);
    trackFire(this, ctx);
    this._gate();
    super.update(dt, ctx);
    this.fx.group.visible = this.root.visible;
  }

  // ------------------------------------------------------------------------------------------------------------------------------ fire logic
  think(dt, ctx) {
    const E = this.engine, fire = !!ctx.fire;
    this.hitT -= dt; if (this.hitT < -0.06) this.hitT = -0.06;
    // secondary fire: rev the engine (throttle blip - chain blurs, smoke pops, trigger squeezes) for showing off
    this.revCd = Math.max(0, this.revCd - dt); const altEdge = !!ctx.alt && !this._altPrev; this._altPrev = !!ctx.alt;
    if (altEdge && !fire && this.revCd <= 0 && E.mode === 2) { E.rev(1); this.revCd = 0.75; this.revT = 0.55; this._puffBurst(5, 1.2); this.jerk = 0.7; g_shake(this.game, 0.12); }
    if (fire) {
      if (!this.firing) { this.firing = true; this.relT = 0; this.inFlesh = false; E.setThrottle(1); this._puffBurst(4, 1.0); this.jerk = 0.5; }
      let n = 0;
      while (this.hitT <= 0 && n++ < 2) { this.hitT += HIT_S; this.cut(); }
    } else if (this.firing) {
      this.firing = false; this.lockT = 0; this.target = null;
      E.setThrottle(0.15); E.setLoad(0); this.relT = 0.55; this.loadV = 0; this.inFlesh = false; if (E.rpmN > 0.5) this._puffBurst(3, 0.8);
    }
  }

  // world-space view-model helpers
  _viewInv() { _vi.copy(this.game.viewCamera.matrixWorld).invert(); }   // main.js syncViewCam() refreshed matrixWorld at the start of this simulation step
  _toView(obj, out) { obj.updateWorldMatrix(true, false); return out.setFromMatrixPosition(obj.matrixWorld).applyMatrix4(_vi); }
  _dirView(obj, x, y, z, out) { return out.set(x, y, z).transformDirection(obj.matrixWorld).transformDirection(_vi); }
  // a point on the bar (fraction 0 = root .. 1 = nose), top edge, in view space
  _barPoint(f, out) {
    const z = BAR.ZR - 0.06 + (BAR.ZT - (BAR.ZR - 0.06)) * f; this._contact.position.set(BAR.X, BAR.Y + BAR.R + 0.003, z);
    return this._toView(this._contact, out);
  }

  // kit_a's melee probe forgives 0.3-0.42 m of slop so enemies pressed against a wall can be hit; that also lets a tooth reach an enemy standing just BEHIND a thin
  // solid (a column). Re-check the eye -> chest line against the solid world boxes and demote the hit to a world contact when something is in the way.
  _blocked(o, e) {
    const tx = e.pos.x, ty = e.pos.y + (e.height || 1.7) * 0.6, tz = e.pos.z, dx = tx - o.x, dy = ty - o.y, dz = tz - o.z;
    for (const b of this.game.world.boxes) {
      if (!b.enabled || !b.solid || b.hitscan === false || b.surface === 'train') continue;
      if (tx >= b.min.x && tx <= b.max.x && ty >= b.min.y && ty <= b.max.y && tz >= b.min.z && tz <= b.max.z) continue;
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-9) { if (o.x < b.min.x || o.x > b.max.x) continue; } else { let a = (b.min.x - o.x) / dx, c = (b.max.x - o.x) / dx; if (a > c) { const q = a; a = c; c = q; } if (a > t0) t0 = a; if (c < t1) t1 = c; }
      if (t0 > t1) continue;
      if (Math.abs(dy) < 1e-9) { if (o.y < b.min.y || o.y > b.max.y) continue; } else { let a = (b.min.y - o.y) / dy, c = (b.max.y - o.y) / dy; if (a > c) { const q = a; a = c; c = q; } if (a > t0) t0 = a; if (c < t1) t1 = c; }
      if (t0 > t1) continue;
      if (Math.abs(dz) < 1e-9) { if (o.z < b.min.z || o.z > b.max.z) continue; } else { let a = (b.min.z - o.z) / dz, c = (b.max.z - o.z) / dz; if (a > c) { const q = a; a = c; c = q; } if (a > t0) t0 = a; if (c < t1) t1 = c; }
      if (t0 <= t1 && t0 < 0.96) return true;
    }
    return false;
  }
  _probe() {
    const g = this.game, pr = meleeProbe(g, RANGE, 0.42), ray = g.player.getAimRay();
    if (pr.kind === 'enemy' && this._blocked(ray.origin, pr.enemy)) {
      const wr = g.world.raycast(ray.origin, ray.dir, RANGE);
      if (wr) { pr.kind = 'world'; pr.enemy = null; pr.dist = wr.dist; pr.surface = wr.surface; pr.point.copy(wr.point); pr.normal.copy(wr.normal); } else { pr.kind = null; pr.enemy = null; pr.dist = RANGE; }
    }
    return pr;
  }

  cut() {
    const g = this.game, p = g.player, E = this.engine, fx = this.fx;
    const pr = this._probe();
    bus.emit('weapon:fire', { id: this.id });
    this._viewInv();
    this.tickKick = 1; this._tickN++;
    if (pr.kind === 'enemy') {
      const e = pr.enemy, part = pr.part || 'torso', mult = part === 'head' ? 2 : 1;
      let amt = 2 * randInt(1, 10);                                    // Doom: 2*(1d10)
      const would = e.hp - amt * mult <= 0;
      if (would && Math.random() < (GIB_CHANCE[e.type] ?? 0.5)) amt = (e.hp + e.maxHp * 0.5 + 1) / mult;   // overkill -> enemies.js turns it into gibs
      const knockBase = Math.min(5, 1 + amt * mult * 0.08);            // enemies.js adds this for 'saw'; cancel most of it: the saw holds them, it does not fling them
      this._lastKill = null; this._cutTarget = e;
      const killed = g.enemies.damage(e, amt, { point: pr.point.clone(), dir: pr.dir.clone(), type: 'saw', source: 'player', part, knock: 0.35 - knockBase, dist: pr.dist });
      const gibbed = !!(this._lastKill && this._lastKill.gibbed); this._cutTarget = null;
      const dmg = Math.min(20, 2 * Math.max(1, Math.round(amt / 2)));
      // ---- audio + engine load
      const grab = !this.inFlesh; this.inFlesh = true;                // first tooth into meat after air / wall: the saw catches
      const str = grab ? 1 : clamp(0.62 + dmg / 55 + (killed ? 0.1 : 0), 0.6, 1);
      const heavy = (e.def?.mass ?? 1) >= 3;                            // brutes / tyrants: the teeth really bog down
      E.setLoad(heavy ? 1 : 0.86); E.bite(str, 'flesh', pr.point); this.loadV = 1;
      // ---- blood on the tool
      this.bloodLevel = Math.min(1, this.bloodLevel + (killed ? (gibbed ? 0.17 : 0.11) : 0.03)); this.fresh = Math.min(1, this.fresh + 0.4);
      // ---- world blood: spray back toward the player
      _d.copy(pr.dir).negate(); _d.y += 0.35; _d.x += (Math.random() - 0.5) * 0.6; _d.z += (Math.random() - 0.5) * 0.6;
      g.vfx?.blood?.(pr.point, _d, killed ? 1.6 : 0.65);
      if (this._tickN & 1) g.vfx?.impact?.(pr.point, pr.normal, 'flesh');
      // ---- view-space gore
      this._barPoint(0.55 + Math.random() * 0.45, _p);
      fx.gore(_p.x, _p.y, _p.z, 0.15, 0.35, 1.0, killed ? 15 : 7, killed ? 1.25 : 0.9);
      if (killed) { fx.chunks(_p.x, _p.y, _p.z, 0.1, 0.3, 1, gibbed ? 8 : 3); fx.mist(_p.x, _p.y, _p.z, 0.2, 0.3, 1, gibbed ? 5 : 3); fx.lens(gibbed ? 4 : 2, 1); }
      else if (Math.random() < 0.22) fx.lens(1, 0.6);
      flashPulse(g, this.muzzle, killed ? 0.7 : 0.4, 0xff4a2a);
      // ---- camera / screen
      p.shake((killed ? (gibbed ? 0.75 : 0.6) : grab ? 0.55 : 0.4) + (heavy ? 0.15 : 0));
      if (grab) { this.kickBack(0.022, 0.04, 0.005, 0.01); this.jerk = 1; } else this.kickBack(heavy ? 0.012 : 0.007, heavy ? 0.024 : 0.014, 0.0012, 0.004);
      if (killed) g.hud?.flash?.('#b00c0c', gibbed ? 0.40 : 0.24, gibbed ? 0.42 : 0.30); else if ((this._tickN % 3) === 0) g.hud?.flash?.('#8a0808', 0.06, 0.13);
      g.fx.chroma = Math.max(g.fx.chroma, killed ? 0.0034 : 0.0018);                // chromatic-aberration pulse per tooth: the whole view shudders
      // ---- lunge lock
      if (!killed) { this.target = e; this.lockT = 0.45; } else { this.lockT = Math.min(this.lockT, 0.1); }
    } else if (pr.kind === 'world' && pr.dist <= WORLD_REACH) {
      const sf = pr.surface, wood = sf === 'wood' || sf === 'glass', metal = sf === 'metal' || sf === 'train';
      this.inFlesh = false; E.setLoad(0.5); E.bite(metal ? 0.85 : 0.6, wood ? 'wood' : 'metal', pr.point); this.loadV = 0.55;
      g.vfx?.impact?.(pr.point, pr.normal, (this._tickN & 3) === 0 ? sf : 'train');   // 'train' = sparks + chips without a bullet-hole decal: a saw gouges, it does not drill
      if (this._tickN & 1) g.audio?.play?.(metal ? 'impactMetal' : 'impactConcrete', pr.point, { volume: 0.35, rate: 1.6 });
      this._barPoint(0.75 + Math.random() * 0.25, _p);
      if (!wood) fx.sparks(_p.x, _p.y, _p.z, -0.15, 0.55, 1.0, metal ? 20 : 14, metal ? 1.2 : 0.9);
      else fx.sparks(_p.x, _p.y, _p.z, -0.1, 0.5, 1.0, 5, 0.6);
      flashPulse(g, this.muzzle, wood ? 0.25 : 0.55, wood ? 0xffb060 : 0xffc880);
      p.shake(0.34); this.kickBack(0.012, 0.035, 0.003, 0.008); this.rollKick = 1;
      this.lockT = 0; this.target = null;
    } else {
      this.inFlesh = false; E.setLoad(0); this.loadV = 0; this.target = null; this.lockT = 0;
    }
  }

  // Doom's grab: while a target is being sawed, the view swings onto it and you are dragged in (stops at arm's length, never through it).
  _lunge(dt) {
    const e = this.target; if (!e || !e.alive || this.lockT <= 0) return;
    this.lockT -= dt;
    const g = this.game, p = g.player, dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 1e-3) return;
    const yawT = Math.atan2(-dx, -dz), dy = angDiff(yawT, p.yaw);
    const mdx = Math.abs(g.input?.mouseDX || 0), assist = mdx > 40 ? 0 : 1 - mdx / 40;               // the player's own mouse turn always wins
    if (Math.abs(dy) < 1.05 && Math.abs(dy) > 0.012) p.yaw += clamp(dy * Math.min(1, dt * 6), -TURN_RATE * dt, TURN_RATE * dt) * assist;
    const stopD = e.radius + p.radius + LUNGE_GAP, away = (p.vel.x * dx + p.vel.z * dz) / dist;         // running away (>1.5 m/s) cancels the drag
    if (dist > stopD && p.grounded && p.alive && away > -1.5) {
      const step = Math.min(dist - stopD, LUNGE_SPEED * dt), nx = p.pos.x + dx / dist * step, nz = p.pos.z + dz / dist * step;
      if (g.world.groundAt(nx, nz, p.pos.y, 0.45) > -900) {
        const ox = p.pos.x, oz = p.pos.z; p.pos.x = nx; p.pos.z = nz;
        g.world.collide(p.pos, p.radius, p.height, 0.45);          // walls, columns, the platform-edge barrier
        // never end up deeper inside the enemy than we started
        const ndx = e.pos.x - p.pos.x, ndz = e.pos.z - p.pos.z;
        if (Math.hypot(ndx, ndz) < Math.min(dist, stopD) - 0.02) { p.pos.x = ox; p.pos.z = oz; }
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------------ animation
  animate(dt, ctx) {
    const g = this.game, E = this.engine, tm = this.time, r = this.raise, S = this.S, vc = g.viewCamera;
    const alive = g.player.alive; this.selT += dt;
    // ---- engine state
    E.update(dt);
    if (this.relT > 0) { this.relT -= dt; if (this.relT <= 0 && !this.firing && E.on) E.setThrottle(0); }
    if (this.firing) this._lunge(dt);
    const rpmN = E.rpmN, cs = E.chainSpeed, catchNow = E.consumeCatch();
    this.loadV = this.firing ? Math.max(0, this.loadV - dt * 1.6) : 0;           // each cutting tick re-arms it; it sags if the teeth stop biting
    // ---- blood
    this.bloodLevel = Math.max(0, this.bloodLevel - dt * 0.008); this.fresh = Math.max(0, this.fresh - dt / 28);
    this.U.uBlood.value = this.bloodLevel; this.U.uFresh.value = this.fresh; this.U.uTime.value = tm;
    // ---- chain
    this.chain.update(cs, dt, tm);
    // ---- transients
    this.tickKick = Math.max(0, this.tickKick - dt * 9); this.jerk = Math.max(0, this.jerk - dt * 5); this.rollKick = Math.max(0, this.rollKick - dt * 6);
    if (catchNow) { this.catchKick = 1; this._catchFx(); }
    this.catchKick = Math.max(0, this.catchKick - dt * 2.6);
    flashDecay(g, dt);

    // ---- vibration: high-frequency shudder (idle -> full) + low growl wobble that grows with load, + rev torque
    const load = this.firing ? this.loadV : 0, run = E.mode === 2 ? 1 : E.mode === 1 ? 0.3 : E.mode === 3 ? clamp(E.rpm / 3000, 0, 1) * 0.6 : 0;
    const hfA = run * (0.30 + 0.70 * rpmN) * (1 + 0.5 * load) + this.catchKick * 1.6;
    const growl = (0.5 + 0.5 * Math.sin(tm * (36 + 26 * load))) * load;
    const s1 = Math.sin(tm * 131.7) + Math.sin(tm * 89.3 + 1.7) + Math.sin(tm * 211.1 + 0.6), s2 = Math.sin(tm * 117.3 + 0.4) + Math.sin(tm * 73.1 + 2.2) + Math.sin(tm * 173.9), s3 = Math.sin(tm * 97.1 + 2.1) + Math.sin(tm * 151.3 + 0.9);
    const jx = s1 * 0.00085 * hfA, jy = s2 * 0.00085 * hfA, jr = s3 * 0.0034 * hfA, jp = s2 * 0.0026 * hfA;
    const push = load * (0.014 + Math.sin(tm * 48) * 0.004) + this.tickKick * 0.006 * (0.4 + load);
    const idle = alive ? 1 : 0;
    const sway = Math.sin(tm * 1.3) * 0.0016 * idle, sway2 = Math.sin(tm * 0.9 + 1) * 0.0012 * idle;
    const rr = 1 - r;                                                      // raise: tip leads up with a small overshoot; lowering: the tip drops away
    const rise = this.dir < 0 ? -rr * 0.30 : rr * 0.42 - Math.sin(Math.min(1, r) * Math.PI) * 0.03 * (r < 1 ? 1 : 0);
    const yank = E.mode === 1 ? E.pull : 0;                                // each pull of the starter rope tugs the whole saw toward the operator
    this.model.position.set(jx + sway + growl * 0.003 * Math.sin(tm * 9) + yank * 0.005, jy + sway2 - this.jerk * 0.006 + yank * 0.004, push * 0.7 + this.catchKick * 0.010 + yank * 0.016);
    this.model.rotation.set(rise + yank * 0.03 + jp + (load > 0 ? 0.018 + growl * 0.012 : 0) - this.tickKick * 0.006 + this.rollKick * 0.02 + this.catchKick * 0.02,
      Math.sin(tm * 33) * 0.004 * load + growl * 0.006 * Math.sin(tm * 7) + yank * 0.035, jr + growl * 0.02 * Math.sin(tm * 11) - rr * 0.10 + this.catchKick * Math.sin(tm * 60) * 0.02 + this.tickKick * 0.006 * Math.sin(this._tickN * 2.3));
    // debug orbit camera (tools / screenshots only): dbg = {c:[x,y,z] saw-local look-at point, yaw, pitch, dist}
    if (this.dbg) {
      const d = this.dbg; if (!this._dbgSaved) this._dbgSaved = this.saw.rotation.clone();
      this.saw.rotation.set(0, 0, 0); this.model.rotation.set(d.pitch || 0, d.yaw || 0, 0);
      _h.set(d.c[0], d.c[1], d.c[2]).applyEuler(this.model.rotation);
      this.model.position.set(-this.root.position.x - _h.x, -this.root.position.y - _h.y, -(d.dist || 0.5) - this.root.position.z - _h.z);
    } else if (this._dbgSaved) { this.saw.rotation.copy(this._dbgSaved); this._dbgSaved = null; }

    // ---- trigger + right index finger
    this.revT = Math.max(0, this.revT - dt);
    this.trig += ((this.firing ? 1 : this.revT > 0 ? 0.85 : (E.mode === 2 ? 0.12 : 0)) - this.trig) * Math.min(1, dt * 30);
    this.trigger.rotation.x = -this.trig * 0.42;
    const idx = this.idxF; if (idx) { idx.joints[0].rotation.x = -(0.50 + this.trig * 0.28); idx.joints[1].rotation.x = -(0.62 + this.trig * 0.32); }

    // ---- pull cord: rope + T handle follow the engine's crank pulses; the left hand leaves the front handle to yank it
    const cr = S.cord, cranking = E.mode === 1;
    this.lhL += ((cranking ? 1 : 0) - this.lhL) * Math.min(1, dt * (cranking ? 16 : 11));
    const pl = cranking ? E.pull : 0;
    _h.copy(cr.dir).multiplyScalar(pl * 0.27).add(cr.rest);
    cr.handle.position.copy(_h); cr.handle.rotation.set(0.3 * pl, 0.4 * pl, 0.2);
    _d.subVectors(_h, cr.eye); const rl = _d.length(); cr.rope.position.copy(cr.eye).addScaledVector(_d, 0.5); cr.rope.scale.set(1, Math.max(0.01, rl), 1); _d.divideScalar(Math.max(rl, 1e-4)); cr.rope.quaternion.setFromUnitVectors(_hy.set(0, 1, 0), _d);
    // left hand: blend between the front-handle grip (A) and the cord grip (B); the pivot is the wrist frame, so solve wrist = grip centre - R * GRIP
    const L = this.lhL; _p.copy(_h).add(_hy.set(-0.004, -0.002, 0.004));   // cord grip centre ~ handle centre
    _v.copy(this.lhA.T).lerp(_p, L); _qa.copy(this.lhA.q).slerp(this.lhB.q, L);
    gripPose(_v, _qa, this.S.lhPivot.position); this.S.lhPivot.quaternion.copy(_qa);
    // arms follow the hands
    this.handR.pointArm(vc, this.aimR[0], this.aimR[1], this.aimR[2]); this.handL.pointArm(vc, this.aimL[0] + 0.4 * L, this.aimL[1] + 0.1 * L, this.aimL[2] + 0.5 * L);

    // ---- fx emitters (view space)
    this._viewInv();
    const fx = this.fx, pts = this.pts, rpmT = E.mode === 2 || E.mode === 1 || (E.mode === 3 && E.rpm > 800) ? 1 : 0;
    if (r > 0.5 && rpmT) {
      // exhaust smoke
      this.puffAcc += dt * ((E.mode === 1 ? 9 : 3.5) + 26 * rpmN * rpmN + 5 * load) * rpmT;
      if (this.puffAcc >= 1) { this._toView(pts.exhaust, _p); this._dirView(pts.exhaust, -0.30, 1.0, 0.15, _d); const pw = 0.35 + rpmN * 0.9; while (this.puffAcc >= 1) { this.puffAcc -= 1; fx.puff(_p.x, _p.y, _p.z, _d.x, _d.y, _d.z, pw); } }
      this.hazeAcc += dt * (1.6 + 2.6 * rpmN) * rpmT;
      if (this.hazeAcc >= 1) { this._toView(pts.haze, _p); this._dirView(pts.haze, 0, 1, 0.3, _d); while (this.hazeAcc >= 1) { this.hazeAcc -= 1; fx.haze(_p.x, _p.y, _p.z, _d.x, _d.y, _d.z); } }
    }
    if (cs > 3) {   // chain oil fling
      this.oilAcc += dt * (8 + 60 * (cs / 24) + 25 * load);
      if (this.oilAcc >= 1) { this._toView(pts.noseTop, _p); this._dirView(pts.noseTop, -0.25, 0.55, -1, _d); while (this.oilAcc >= 1) { this.oilAcc -= 1; fx.oil(_p.x, _p.y, _p.z, _d.x, _d.y, _d.z, 0.9 + 1.3 * (cs / 24)); } }
    }
    if (this.bloodLevel > 0.12 && r > 0.6) {   // drips off the bar
      this.dripAcc += dt * 7 * this.bloodLevel * (0.3 + 0.7 * this.fresh);
      if (this.dripAcc >= 1) { this.dripAcc = 0; this._barPoint(0.3 + Math.random() * 0.7, _p); _p.y -= 0.05; fx.drip(_p.x, _p.y, _p.z, this.fresh); }
    }
    // idle life: the carb hunts - every couple of seconds the engine coughs a small puff and the saw twitches
    if (E.mode === 2 && !this.firing && rpmN < 0.25 && r > 0.9 && (this.idleT -= dt) <= 0) { this.idleT = 1.4 + Math.random() * 2.6; this._puffBurst(2, 0.55); this.jerk = Math.max(this.jerk, 0.3); }
    fx.update(dt);
    // camera rattle while the trigger is held
    if (this.firing && alive) g.player.shake(0.05 + 0.11 * rpmN + 0.18 * load);
  }

  _puffBurst(n, power) {
    const fx = this.fx, pts = this.pts; this._viewInv();
    this._toView(pts.exhaust, _p); this._dirView(pts.exhaust, -0.30, 1.0, 0.15, _d);
    for (let i = 0; i < n; i++) fx.puff(_p.x, _p.y, _p.z, _d.x + (Math.random() - 0.5) * 0.4, _d.y + (Math.random() - 0.3) * 0.4, _d.z, power);
  }
  _catchFx() { this._puffBurst(12, 1.4); this.game.player.shake(0.22); }
}
