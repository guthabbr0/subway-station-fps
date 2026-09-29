// CHAINSAW - the flagship melee weapon. Files: this one (fire logic, lunge, animation, integration) + chainsaw/{model,chain,fx,blood,paint,engine}.js
//   gameplay : Doom II chainsaw, better. 4 tics (4/35 s) per attack while fire is held, 2*(1d10) damage, 2.05 m reach, no ammo. Sawing a target drags you
//              in and swings the view onto it (stops a body-length short of the target, never through enemies / walls / the platform edge; running away or
//              turning the mouse overrides it); enemies.js decides on gibs (it shreds ~60% of saw kills); secondary fire (right mouse) revs the engine.
//              RIGHT MOUSE therefore has NO aim-down-sights here (adsSpec = null: the aim manager in weapons.js ignores weapons without one, and the chainsaw keeps ctx.alt for the rev).
//              hip pose: the saw points (almost) straight ahead, lower right (saw.rotation = 8 deg inward, a touch of pitch so the guide bar stays readable from behind).
//   viewmodel: two-handed orange/black two-stroke saw, real instanced chain that motion-blurs with engine rpm, tremor scaled by rpm + load, pull-cord start
//              (left hand yanks the starter, the saw jerks, the engine catches with a shudder and a puff), exhaust smoke, oil fling, sparks on masonry/metal,
//              blood that accumulates on the bar / chain / gloves and slowly wipes off, gore flecks flung at the lens.
//   audio    : game.audio.chainsaw (RPM-driven engine) through ./chainsaw/engine.js: start once the saw is 40% raised (so the cord yanks are seen), throttle on
//              fire, load + bite per tooth, stop (and release the trigger) on deselect / death / reset / pause. Falls back to the legacy sawStart / sawIdle / sawFull / sawHit sounds when the audio module has no engine.
//   debug    : weapon.dbg = {c:[x,y,z], yaw, pitch, dist} orbits a debug camera around the saw (screenshots); set to null to return to the normal view.
import * as THREE from 'three';
import { Weapon } from './base.js';
import { bus, clamp, randInt, TIC } from '../core.js';
import { getKit, trackFire, flashPulse, flashDecay, flashKill, warmup } from './kit_a.js';
import { solidMeleeProbe } from './chainsaw/los.js';
import { buildSaw, gripPose } from './chainsaw/model.js';
import { SawFX } from './chainsaw/fx.js';
import { SawEngine } from './chainsaw/engine.js';
import { makeBloodUniforms } from './chainsaw/blood.js';
import { BAR } from './chainsaw/chain.js';

const HIT_S = 4 * TIC, RANGE = 2.05, WORLD_REACH = 1.5, START_RAISE = 0.4;   // START_RAISE: the starter cord is pulled once the saw is 40% raised (the hands only come into view late in the raise)
const LUNGE_SPEED = 2.6, LUNGE_GAP = 0.30, LUNGE_MIN = 1.06, TURN_RATE = 1.5;   // the drag never brings the player closer than LUNGE_MIN (centre to centre) to its target
// vfx.impact() draws a bullet-hole decal for every surface except 'train' (the moving train must not get world-space holes). A saw gouges, it does not drill,
// so hard surfaces use that no-decal path for the sparks / chips / dust and get a scorch scrape from vfx.decal() instead. (No dedicated flag exists in vfx.js: see report.)
const NO_HOLE = 'train';

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _vi = new THREE.Matrix4(), _qa = new THREE.Quaternion(), _h = new THREE.Vector3(), _hy = new THREE.Vector3();
const g_shake = (g, v) => g.player?.shake?.(v);
const _dmg = { point: null, dir: null, type: 'saw', source: 'player', part: 'torso', dist: 0 };   // one options object for every enemies.damage() call (no per-tick garbage)
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
    this.aimR = [0.35, -0.75, 0.55]; this.aimL = [-0.25, -0.86, 0.44];
    this.revCd = 0; this.revT = 0; this._altPrev = false; this.idleT = 2;
    this.puffAcc = 0; this.hazeAcc = 0; this.oilAcc = 0; this.dripAcc = 0; this.dbg = null;
    this._scarT = this._holeT = -9; this._scarX = this._scarY = this._scarZ = 0;
    bus.on('game:start', () => { this.bloodLevel = 0; this.fresh = 1; this.fx?.clear(); if (this.game.weapons?.current !== this) this.engine.stop(); });
    bus.on('player:dead', () => { this.engine.stop(); this.releaseTrigger(); });
    bus.on('enemy:killed', (ev) => { if (ev.enemy === this._cutTarget) this._lastKill = ev; });
  }

  // ------------------------------------------------------------------------------------------------------------------------------ build
  buildModel() {
    const g = this.game, kit = getKit(g), model = new THREE.Group();
    this.S = buildSaw(g, kit, this.U);
    const S = this.S; this.saw = S.saw; this.chain = S.chain; this.handR = S.handR; this.handL = S.handL; this.idxF = S.idxF; this.trigger = S.trigger; this.cord = S.cord; this.pts = S.pts;
    model.add(S.saw); this.saw.rotation.set(0.10, 0.14, 0); // straight ahead: the bar points along the view axis (no cant), RMB revs the engine (no ADS)
    for (const h of [S.handL, S.handR]) h.arm.scale.set(0.7, 0.7, 1);
    this.muzzle = S.pts.nose;
    this.fx = new SawFX(g);
    this.engine.warm();
    this._contact = new THREE.Object3D(); this.saw.add(this._contact);
    // left-hand poses (grip centre + orientation, saw-local): A = overhand on the front handle, B = gripping the pull cord
    this.lhA = { T: new THREE.Vector3(-0.030, 0.2035, -0.150), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, -0.35, -0.6, 'YXZ')) };
    this.lhB = { q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0.60, 0.2, 'YXZ')) };
    return model;
  }

  // ------------------------------------------------------------------------------------------------------------------------------ select / audio gating
  _canRun() { const g = this.game; return g.state === 'playing' && g.player.alive && g.weapons.current === this && this.selected && this.dir > 0; }
  onSelect() {
    this.releaseTrigger(); this.selT = 0; this.hitT = 0.05; this.lhL = 0; this.revCd = 0; this._scarT = this._holeT = -9;
    this.fx?.clear();                                                   // particles only age while this weapon is up: never resume a half-faded splat from the last fight
    this.engine.pull = 0;                                               // the engine is started by _gate() once the saw is far enough up for the pull-cord yanks to be seen
  }
  // let go of everything the trigger was doing (deselect / pause / death): no held throttle, no cutting load, no lunge target
  releaseTrigger() { this.firing = false; this.inFlesh = false; this.relT = 0; this.revT = 0; this.lockT = 0; this.target = null; this.loadV = 0; }
  onDeselect() {
    this.releaseTrigger();
    this.engine.stop(); flashKill(this.game);
  }
  _gate() { const want = this._canRun(); if (want && !this.engine.on) { if (this.raise >= START_RAISE) { this.engine.start(); this.selT = Math.min(this.selT, 0.1); } } else if (!want && this.engine.on) { this.engine.stop(); this.releaseTrigger(); } }

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

  _probe() { return solidMeleeProbe(this.game, RANGE, 0.42); }     // kit_a's melee probe + a line-of-sight check (chainsaw/los.js): nothing is cut through a thin solid

  cut() {
    const g = this.game, p = g.player, E = this.engine, fx = this.fx;
    const pr = this._probe();
    bus.emit('weapon:fire', { id: this.id });
    this._viewInv();
    this.tickKick = 1; this._tickN++;
    if (pr.kind === 'enemy') {
      const e = pr.enemy, part = pr.part || 'torso';
      const amt = 2 * randInt(1, 10);                                  // Doom: 2*(1d10), handed over untouched: enemies.js doubles headshots, adds the saw's small knock and decides on gibs itself
      this._lastKill = null; this._cutTarget = e;
      _dmg.point = pr.point; _dmg.dir = pr.dir; _dmg.part = part; _dmg.dist = pr.dist;
      const killed = g.enemies.damage(e, amt, _dmg);
      _dmg.point = _dmg.dir = null;
      const gibbed = !!(this._lastKill && this._lastKill.gibbed); this._cutTarget = null;
      // enemies.js flashes a hit target for 75 ms, which at 8.75 ticks/s keeps the whole body glowing orange: a sawed victim only pulses
      if (!killed && e.flash > 0.03) e.flash = 0.03;
      // ---- audio + engine load
      const grab = !this.inFlesh; this.inFlesh = true;                // first tooth into meat after air / wall: the saw catches
      const str = grab ? 1 : clamp(0.62 + amt / 55 + (killed ? 0.1 : 0), 0.6, 1);
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
      const sf = pr.surface, soft = sf === 'wood' || sf === 'glass', metal = sf === 'metal' || sf === 'train', now = g.time;
      this.inFlesh = false; E.setLoad(0.5); E.bite(metal ? 0.85 : 0.6, soft ? 'wood' : 'metal', pr.point); this.loadV = 0.55;
      if (soft) { if (now - this._holeT > 0.4) { this._holeT = now; g.vfx?.impact?.(pr.point, pr.normal, sf); } }       // chips fly; the pooled decal it leaves is a fair gouge in wood / glass
      else {
        g.vfx?.impact?.(pr.point, pr.normal, NO_HOLE);
        const moved = Math.abs(pr.point.x - this._scarX) + Math.abs(pr.point.y - this._scarY) + Math.abs(pr.point.z - this._scarZ);
        if ((now - this._scarT > 0.28 && moved > 0.1) || now - this._scarT > 1.2) {                                       // a dark scrape wherever the tooth has travelled, never a bullet hole
          this._scarT = now; this._scarX = pr.point.x; this._scarY = pr.point.y; this._scarZ = pr.point.z;
          g.vfx?.decal?.(pr.point, pr.normal, 'scorch', 0.13 + Math.random() * 0.1);
        }
      }
      if (this._tickN & 1) g.audio?.play?.(metal ? 'impactMetal' : 'impactConcrete', pr.point, { volume: 0.35, rate: 1.6 });
      this._barPoint(0.75 + Math.random() * 0.25, _p);
      if (!soft) fx.sparks(_p.x, _p.y, _p.z, -0.15, 0.55, 1.0, metal ? 20 : 14, metal ? 1.2 : 0.9);
      else fx.sparks(_p.x, _p.y, _p.z, -0.1, 0.5, 1.0, 5, 0.6);
      flashPulse(g, this.muzzle, soft ? 0.25 : 0.55, soft ? 0xffb060 : 0xffc880);
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
    const stopD = Math.max(LUNGE_MIN, e.radius + p.radius + LUNGE_GAP), away = (p.vel.x * dx + p.vel.z * dz) / dist;         // running away (>1.5 m/s) cancels the drag
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
