// game.train — the metro train: arrival through the tunnel, braking, dwell with sliding doors, departure.
// Geometry lives in src/train/*.js; this file owns the state machine, motion, doors, lights, audio, hit boxes and events.
import * as THREE from 'three';
import { LAYOUT, bus, clamp, damp, rand } from './core.js';
import { buildTrain } from './train/build.js';
import * as K from './train/consts.js';

// ---- timeline constants ----------------------------------------------------------------------------
const H = K.TRAIN_HALF; // nose distance from the train centre (22.5)
const MOUTH = LAYOUT.tunnelX; // portal x (|x|)
const P_MOUTH = -(MOUTH + H); // centre progress when the nose crosses the portal
const NOSE_START = -92; // nose x at the beginning of the approach (deep in the tunnel)
const P_START = NOSE_START - H;
const D_BRAKE = -P_MOUTH; // braking distance from the portal to the stop
const T_BRAKE = 9.0; // portal -> stopped
const V0 = (2.5 * D_BRAKE) / T_BRAKE; // speed at the portal (~15 m/s)
const T_RUN = (P_MOUTH - P_START) / V0; // constant-speed approach time
const ACCEL = 4.5, VMAX = 28; // departure
const P_GONE = MOUTH + H + 4; // tail 4 m inside the tunnel -> "out of the station"
const P_HIDE = 135 + H;
const P_SAFE = MOUTH + H + 52; // a departed train this far into the tunnel can be swapped out unseen (fog)
const DOOR_OPEN_T = 1.3, DOOR_CLOSE_T = 1.6;
const NDOORS = K.CAR_COUNT * 2;
const Y_STEAM = -0.45;

const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

export function create(game) {
  let B = null; // built scene objects
  let phase = 'idle'; // idle | run | settle | chime | opening | open | dchime | closing | closed | accel | ghost
  let gen = 0; // bumps on reset() so stale promises never resolve
  let s = 1; // track sign: A = +1 (heading +X), B = -1 (heading -X)
  let p = 0, speed = 0, accelNow = 0; // centre progress along heading (0 at the stop), speed, signed accel
  let t = 0, ph = 0, time = 0; // approach clock, phase clock, free clock
  let arriveRes = null, arrivePromise = null, departRes = null, departPromise = null, wantDepart = false;
  let wheelAng = 0, lightT = 0;
  let flags = {};
  const doors = Array.from({ length: NDOORS }, () => ({ amt: 0, tgt: 0, delay: 0, e: 0 }));
  const fl = Array.from({ length: K.CAR_COUNT }, () => ({ v: 1, target: 1, t: rand(0, 1) }));
  const rumblePos = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpE = new THREE.Euler(), colTmp = new THREE.Color();
  const rp = { volume: 0, rate: 1, pos: rumblePos };
  let warm = 0, pendingTrack = null;
  let rumble = null, headK = 0, sign = { t: 1, burst: 0 }, boxes = [], steam = null, shakeT = 0;

  const api = {
    state: 'away', track: 'A',

    async init() {
      B = buildTrain();
      B.root.visible = false;
      game.scene.add(B.root);
      buildBoxes(); buildSteam();
      this._hide();
      // pre-warm: draw every train material for a few frames (below the floor, culling off) so the first arrival does not hitch on shader compiles
      warm = 3; B.root.visible = true; B.root.position.set(0, -60, 0); B.beam.visible = B.groundPool.visible = true; steam.pts.visible = true;
      B.root.traverse((o) => { o.userData._fc = o.frustumCulled; o.frustumCulled = false; });
      steam.pts.frustumCulled = false;
    },

    reset() {
      gen++; pendingTrack = null;
      arriveRes = arrivePromise = departRes = departPromise = null; wantDepart = false;
      this._hide();
    },

    // ---- public: arrival -------------------------------------------------------------------------
    arrive(track = 'A') {
      if (!B) return Promise.resolve();
      const same = (track === 'B' ? 'B' : 'A') === this.track;
      if (same && arrivePromise && (this.state === 'arriving' || this.state === 'stopped')) return arrivePromise;
      if (same && this.state === 'stopped' && phase === 'open') return Promise.resolve();
      if (this.state !== 'away') { const g = gen; return this.depart().then(() => (g === gen ? this.arrive(track) : new Promise(() => {}))); }
      if (phase === 'ghost') { // the previous train is still visible in the tunnel: start once it is far enough away
        pendingTrack = track === 'B' ? 'B' : 'A';
        if (!arrivePromise) { const g = gen; arrivePromise = new Promise((res) => { arriveRes = () => { if (g === gen) res(); }; }); }
        return arrivePromise;
      }
      return startArrival(track === 'B' ? 'B' : 'A');
    },

    // ---- public: departure -----------------------------------------------------------------------
    depart() {
      if (!B || this.state === 'away') return Promise.resolve();
      if (this.state === 'departing') return departPromise;
      if (!departPromise) { const g = gen; departPromise = new Promise((res) => { departRes = () => { if (g === gen) res(); }; }); }
      if (phase === 'open') beginDepart(); else wantDepart = true;
      return departPromise;
    },

    // 6 points on the platform floor ~0.5 m outside each door (z = +-4.3), sorted by x.
    doorPoints() {
      const sg = this.track === 'B' ? -1 : 1, pts = [];
      for (let i = 0; i < K.CAR_COUNT; i++) for (const d of K.DOOR_U) pts.push(new THREE.Vector3(sg * (K.carU(i) + d) + LAYOUT.train.stopX, 0, sg * 4.3));
      return pts.sort((a, b) => a.x - b.x);
    },

    // test helper: advance the simulation without rendering
    fastForward(sec, step = 0.05) { for (let a = 0; a < sec; a += step) this.update(step); },

    _hide() {
      phase = 'idle'; this.state = 'away'; speed = 0; accelNow = 0;
      if (B) B.root.visible = warm > 0;
      rumble?.stop?.(0.15); rumble = null;
      for (const b of boxes) b.box.enabled = false;
      if (steam) { steam.life.fill(0); steam.col.fill(0); steam.pts.visible = warm > 0; }
    },

    update(dt) {
      if (warm > 0) {
        if (--warm === 0) { B.root.traverse((o) => { if (o.userData._fc !== undefined) o.frustumCulled = o.userData._fc; }); if (phase === 'idle') { B.root.visible = false; B.root.position.set(0, -60, 0); } B.beam.visible = B.groundPool.visible = false; steam.pts.visible = false; }
        return;
      }
      if (!B || phase === 'idle') return;
      time += dt; ph += dt;
      stepMotion(dt);
      if (phase === 'idle') return;
      applyTransform(dt);
      stepDoors(dt);
      stepLights(dt);
      stepAudio(dt);
      stepFx(dt);
      updateBoxes();
    },
  };

  function startArrival(track) {
    api.track = track; s = track === 'A' ? 1 : -1;
    api.state = 'arriving'; phase = 'run'; t = 0; ph = 0; p = P_START; speed = V0; flags = {}; wheelAng = 0; lightT = 0; wantDepart = false; pendingTrack = null;
    for (const d of doors) { d.amt = 0; d.tgt = 0; d.e = 0; d.delay = 0; }
    B.root.visible = true;
    applyTransform(0); applyDoors(); updateBoxes();
    rumble?.stop?.(0.1);
    rumble = game.audio?.loop?.('trainRumble', { volume: 0.05, rate: 0.75, pos: rumblePos }) || null;
    bus.emit('train:arriving', { track });
    if (!arrivePromise) { const g = gen; arrivePromise = new Promise((res) => { arriveRes = () => { if (g === gen) res(); }; }); }
    return arrivePromise;
  }

  // ---- world hit boxes (hitscan only, follow the train) ----------------------------------------------
  function buildBoxes() {
    const add = (u0, u1, y0, y1, z0, z1, door = -1) => {
      const box = game.world.addBox([0, y0, 0], [1, y1, 1], { tag: 'train', solid: false, hitscan: true, surface: 'train' });
      box.enabled = false; boxes.push({ box, u0, u1, y0, y1, z0, z1, door });
    };
    for (let i = 0; i < K.CAR_COUNT; i++) {
      const c = K.carU(i), h = K.HALF;
      add(c - h, c + h, -0.4, 3.66, 1.3, 1.4); // far wall
      add(c - h, c + h, 3.3, 3.66, -1.4, 1.4); // roof
      add(c - h, c + h, -0.55, 0.02, -1.4, 1.4); // floor / underframe
      add(c + h - 0.2, c + h, 0.02, 3.4, -1.4, 1.4); add(c - h, c - h + 0.2, 0.02, 3.4, -1.4, 1.4); // end walls
      add(c - h, c + h, -0.4, 0, -1.4, -1.3); // near sill
      add(c - h, c + h, 2.2, 3.4, -1.4, -1.3); // near header
      add(c - h, c - 5.1, 0, 2.2, -1.4, -1.3); add(c - 3.7, c + 3.7, 0, 2.2, -1.4, -1.3); add(c + 5.1, c + h, 0, 2.2, -1.4, -1.3); // near pillars/windows
      K.DOOR_U.forEach((d, j) => add(c + d - 0.7, c + d + 0.7, 0, 2.2, -1.46, -1.3, i * 2 + j)); // doors (toggle)
    }
  }
  function updateBoxes() {
    const zc = LAYOUT.trackZ[api.track] ?? 6.6, x0 = s * p + LAYOUT.train.stopX;
    for (const b of boxes) {
      const xa = x0 + s * b.u0, xb = x0 + s * b.u1, za = zc + s * b.z0, zb = zc + s * b.z1;
      const mn = Math.min(xa, xb), mx = Math.max(xa, xb);
      const bx = b.box; bx.min.x = mn; bx.max.x = mx; bx.min.z = Math.min(za, zb); bx.max.z = Math.max(za, zb); bx.min.y = b.y0; bx.max.y = b.y1;
      bx.enabled = mx > -MOUTH - 1 && mn < MOUTH + 1 && (b.door < 0 || doors[b.door].e < 0.5);
    }
  }

  // ---- motion ------------------------------------------------------------------------------------------
  function stepMotion(dt) {
    const p0 = p;
    if (phase === 'run') {
      t += dt;
      if (t < T_RUN) { p = P_START + V0 * t; speed = V0; accelNow = 0; }
      else {
        const u = (t - T_RUN) / T_BRAKE;
        if (u >= 1) { p = 0; speed = 0; accelNow = 0; onStopped(); }
        else { p = -D_BRAKE * Math.pow(1 - u, 2.5); speed = V0 * Math.pow(1 - u, 1.5); accelNow = -(1.5 * V0 / T_BRAKE) * Math.pow(1 - u, 0.5); }
      }
      // one-shot events on the approach (only while still approaching; onStopped() resets the flags)
      if (phase === 'run') {
        if (!flags.horn && t > T_RUN * 0.42) { flags.horn = true; game.audio?.play?.('trainHorn', noseWorld(tmpV), { volume: 1 }); }
        if (!flags.pass && t >= T_RUN) { flags.pass = true; game.audio?.play?.('trainPass', noseWorld(tmpV), { volume: 1 }); jolt(0.35); gust(); }
        if (!flags.brake && t >= T_RUN + 0.5) { flags.brake = true; game.audio?.play?.('trainBrake', centreWorld(tmpV), { volume: 1 }); }
      }
    } else if (phase === 'accel') {
      speed = Math.min(VMAX, speed + ACCEL * dt); accelNow = speed < VMAX ? ACCEL : 0; p += speed * dt;
      if (!flags.gone && p >= P_GONE) { flags.gone = true; finishDeparture(); }
      if (p >= P_HIDE) api._hide();
    } else if (phase === 'ghost') {
      speed = Math.min(VMAX, speed + ACCEL * dt); p += speed * dt; accelNow = 0;
      if (pendingTrack && p >= P_SAFE) { const tr = pendingTrack; api._hide(); startArrival(tr); return; }
      if (p >= P_HIDE) api._hide();
    } else { speed = 0; accelNow = 0; }
    wheelAng += (p - p0) / K.WHEEL_R;

    // phase machine for the dwell
    if (phase === 'settle') {
      if (!flags.hiss) { flags.hiss = true; game.audio?.play?.('ventHiss', centreWorld(tmpV, 1.0), { volume: 0.9 }); steamBurst(1); jolt(0.25); }
      if (ph > 0.45) { phase = 'chime'; ph = 0; game.audio?.play?.('trainDoorChime', centreWorld(tmpV, 2.4), { volume: 1 }); }
    } else if (phase === 'chime') {
      if (ph > 0.75) {
        phase = 'opening'; ph = 0; flags.opened = false;
        for (const d of doors) { d.tgt = 1; d.delay = rand(0, 0.3); }
        for (let i = 0; i < K.CAR_COUNT; i++) game.audio?.play?.('trainDoorOpen', carWorld(tmpV, i), { volume: 0.9 });
        steamBurst(2); doorPuffs();
      }
    } else if (phase === 'opening') {
      if (allDoors(1)) {
        phase = 'open'; ph = 0; api.state = 'stopped';
        bus.emit('train:doorsOpen', { track: api.track });
        arriveRes?.(); arriveRes = null; arrivePromise = null;
        if (wantDepart) beginDepart();
      }
    } else if (phase === 'dchime') {
      if (ph > 1.0) {
        phase = 'closing'; ph = 0;
        for (const d of doors) { d.tgt = 0; d.delay = rand(0, 0.3); }
        for (let i = 0; i < K.CAR_COUNT; i++) game.audio?.play?.('trainDoorClose', carWorld(tmpV, i), { volume: 0.9 });
      }
    } else if (phase === 'closing') {
      if (allDoors(0)) { phase = 'closed'; ph = 0; bus.emit('train:doorsClosed', { track: api.track }); steamBurst(1); }
    } else if (phase === 'closed') {
      if (ph > 0.6) {
        phase = 'accel'; ph = 0; api.state = 'departing'; flags = {}; speed = 0;
        game.audio?.play?.('trainDepart', centreWorld(tmpV, 1.0), { volume: 1 });
        game.audio?.play?.('trainHorn', noseWorld(tmpV), { volume: 0.8 });
      }
    }
  }

  function allDoors(v) { for (let i = 0; i < NDOORS; i++) if (doors[i].amt !== v) return false; return true; }
  function onStopped() {
    phase = 'settle'; ph = 0; api.state = 'stopped'; flags = {};
    bus.emit('train:stopped', { track: api.track });
  }
  function beginDepart() {
    wantDepart = false; phase = 'dchime'; ph = 0; flags = {};
    game.audio?.play?.('trainDoorChime', centreWorld(tmpV, 2.4), { volume: 1 });
  }
  function finishDeparture() {
    bus.emit('train:departed', { track: api.track });
    api.state = 'away'; phase = 'ghost'; speed = Math.max(speed, 0);
    const r = departRes; departRes = departPromise = null; wantDepart = false; r?.();
  }

  // ---- positions for sounds / effects ------------------------------------------------------------------
  function noseWorld(v) { return v.set(s * (p + H) + LAYOUT.train.stopX, 1.6, LAYOUT.trackZ[api.track]); }
  function centreWorld(v, y = 1.6) { return v.set(s * p + LAYOUT.train.stopX, y, LAYOUT.trackZ[api.track] - s * 1.0); }
  function carWorld(v, i) { return v.set(s * (p + K.carU(i)) + LAYOUT.train.stopX, 1.6, LAYOUT.trackZ[api.track] - s * 1.0); }
  function jolt(k) {
    const pl = game.player; if (!pl?.shake) return;
    const cx = game.camera.position.x, cz = game.camera.position.z, nx = s * (p + H), d = Math.hypot(clamp(cx, s * (p - H), nx) - cx, cz - LAYOUT.trackZ[api.track]);
    pl.shake(clamp(k * (1 - d / 40), 0, 1));
  }

  // ---- transform: root placement, sway, wheels, leaves ---------------------------------------------------
  function applyTransform(dt) {
    const r = B.root;
    r.position.set(s * p + LAYOUT.train.stopX, 0, LAYOUT.trackZ[api.track]); r.rotation.y = s > 0 ? 0 : Math.PI;
    const mv = clamp(speed / 12, 0, 1), settle = phase === 'settle' ? Math.exp(-3.2 * ph) * Math.cos(10 * ph) : 0;
    B.body.position.y = Math.sin(time * 9.3) * 0.004 * mv + Math.sin(time * 15.7) * 0.0025 * mv;
    B.body.rotation.x = Math.sin(time * 5.1) * 0.0035 * mv + Math.sin(time * 11.3) * 0.0015 * mv;
    B.body.rotation.z = clamp(accelNow * 0.0012, -0.004, 0.004) - 0.0018 * settle + Math.sin(time * 7.4) * 0.0012 * mv;
    B.body.rotation.y = Math.sin(time * 3.3) * 0.0015 * mv;
    // wheelsets
    if (dt > 0 || !flags.wheelInit) {
      flags.wheelInit = true;
      for (let k = 0; k < B.wheelU.length; k++) {
        tmpE.set(0, 0, -(wheelAng + k * 1.7)); tmpQ.setFromEuler(tmpE); tmpP.set(B.wheelU[k], K.AXLE_Y, 0); tmpS.set(1, 1, 1);
        tmpM.compose(tmpP, tmpQ, tmpS); B.wheels.setMatrixAt(k, tmpM);
      }
      B.wheels.instanceMatrix.needsUpdate = true;
    }
  }

  // ---- doors -----------------------------------------------------------------------------------------------
  function stepDoors(dt) {
    let moving = false;
    for (const d of doors) {
      if (d.amt === d.tgt) continue;
      moving = true;
      if (d.delay > 0) { d.delay -= dt; continue; }
      const rate = d.tgt > d.amt ? 1 / DOOR_OPEN_T : 1 / DOOR_CLOSE_T;
      d.amt = d.tgt > d.amt ? Math.min(1, d.amt + rate * dt) : Math.max(0, d.amt - rate * dt);
    }
    if (moving) applyDoors();
  }
  function applyDoors() {
    for (let di = 0; di < NDOORS; di++) {
      const d = doors[di]; d.e = sm(d.amt);
      const car = di >> 1, j = di & 1, uAbs = K.carU(car) + K.DOOR_U[j], sl = K.LEAF_SLIDE * d.e;
      for (let k = 0; k < 2; k++) {
        tmpP.set(uAbs + (k === 0 ? -0.35 - sl : 0.35 + sl), 0, -K.HW); tmpQ.identity(); tmpS.set(1, 1, 1);
        tmpM.compose(tmpP, tmpQ, tmpS); B.leafMesh.setMatrixAt(di * 2 + k, tmpM); B.leafGlass.setMatrixAt(di * 2 + k, tmpM);
      }
    }
    B.leafMesh.instanceMatrix.needsUpdate = true; B.leafGlass.instanceMatrix.needsUpdate = true;
  }

  // ---- lights: interior flicker, headlamps, glows, door lamps, spill pools, LED signs --------------------------
  function stepLights(dt) {
    lightT += dt;
    const ramp = sm(lightT / 1.4), stopped = api.state === 'stopped', flick = stopped && (phase === 'opening' || phase === 'open' || phase === 'chime' || phase === 'dchime');
    for (let c = 0; c < K.CAR_COUNT; c++) {
      const f = fl[c]; f.t -= dt;
      if (f.t <= 0) {
        if (flick) {
          const rr = Math.random(), heavy = c === 1 ? 1.4 : 1;
          if (rr < 0.45 / heavy) { f.target = 1; f.t = rand(0.06, 0.5); } else if (rr < 0.85) { f.target = rand(0.3, 0.75); f.t = rand(0.03, 0.14); } else { f.target = 0.04; f.t = rand(0.04, 0.12); }
        } else { f.target = Math.random() < (speed > 5 ? 0.06 : 0.03) ? rand(0.4, 0.8) : 1; f.t = rand(0.25, 1.4); }
      }
      f.v = damp(f.v, f.target, 55, dt);
      const L = f.v * ramp;
      B.M.int[c].color.setScalar(0.5 + 0.5 * L); B.M.intDec[c].color.setScalar(0.5 + 0.5 * L); B.M.strip[c].color.setScalar(0.08 + 2.15 * L);
    }
    // headlamps / tail lamps
    const headT = api.state === 'arriving' ? 1 : api.state === 'departing' || phase === 'ghost' ? 0.6 : 0.16;
    headK = damp(headK, headT, 4, dt);
    B.M.lampHead.color.setRGB(3 * headK * ramp + 0.06, 2.85 * headK * ramp + 0.06, 2.5 * headK * ramp + 0.05);
    B.M.lampTail.color.setRGB(2.4 * (0.35 + 0.4 * headK) * ramp + 0.05, 0.12 * ramp + 0.01, 0.08 * ramp + 0.01);
    const moving = speed > 0.5 && (api.state === 'arriving' || api.state === 'departing' || phase === 'ghost' || phase === 'run');
    B.beam.visible = B.groundPool.visible = moving && headK > 0.3;
    // one pooled point light follows the nose (vfx.light refreshes a nearby light of the same hue instead of claiming new ones)
    if (moving && headK > 0.3 && ramp > 0.3) game.vfx?.light?.(tmpV.set(s * (p + H + 5) + LAYOUT.train.stopX, 1.7, LAYOUT.trackZ[api.track]), 0xfff0d8, 110 * headK * ramp, 0.14, 34);
    if (B.beam.visible) { B.beam.material.color.setScalar(clamp(headK, 0, 1) * ramp); B.groundPool.material.color.setRGB(0.42 * headK * ramp, 0.4 * headK * ramp, 0.32 * headK * ramp); }
    const cam = game.camera.position;
    for (const g of B.headGlow) { glowScale(g, cam, 0.7 + headK * 0.7, 0.085, 13, 2.0, 11, headK * ramp); }
    for (const g of B.tailGlow) { glowScale(g, cam, 0.55, 0.03, 4, 0.3, 4, (0.35 + 0.4 * headK) * ramp); }
    // door lamps: blink while chiming / opening / closing
    const blink = phase === 'chime' || phase === 'opening' || phase === 'dchime' || phase === 'closing';
    const on = blink ? (Math.sin(time * 15) > 0 ? 1 : 0.06) : 0.03;
    B.M.lampDoor.color.setRGB(3.2 * on + 0.03, 1.5 * on + 0.02, 0.25 * on + 0.005);
    // spill pools on the platform in front of open doors
    let anyPool = false;
    for (let di = 0; di < NDOORS; di++) {
      const d = doors[di], car = di >> 1, k = d.e * (0.3 + 0.7 * fl[car].v) * ramp * 0.8;
      colTmp.setRGB(k, k, k); B.pools.setColorAt(di, colTmp); if (d.e > 0 || flags.poolOn) anyPool = true;
    }
    if (anyPool || phase === 'closing' || phase === 'closed') { B.pools.instanceColor.needsUpdate = true; flags.poolOn = anyPool; }
    // LED signs: steady with occasional glitch bursts
    sign.t -= dt;
    if (sign.t <= 0) {
      if (sign.burst > 0) { sign.burst--; B.T.signFront.draw(sign.burst > 0 ? rand(0.3, 1) : 0); sign.t = rand(0.07, 0.2); if (sign.burst === 0) sign.t = rand(2.5, 6); }
      else { sign.burst = 2 + Math.floor(rand(0, 4)); sign.t = 0.05; }
    }
    const sk = 1.15 + 0.5 * fl[K.CAR_COUNT - 1].v; B.M.sign.color.setScalar(sk * ramp * (Math.random() < 0.012 ? 0.15 : 1));
    B.M.led.color.setScalar((1.2 + 0.4 * fl[1].v) * ramp);
  }
  function glowScale(sp, cam, base, perM, max, minD, fadeD, k) {
    sp.getWorldPosition(tmpV); const d = tmpV.distanceTo(cam), sz = clamp(base + d * perM, base, max);
    sp.scale.set(sz * 2, sz, 1); sp.material.opacity = clamp(k, 0, 1) * sm((d - minD) / fadeD) * 0.9; sp.visible = sp.material.opacity > 0.01;
  }

  // ---- audio: rumble loop follows the nearest point of the train ------------------------------------------------
  function stepAudio(dt) {
    if (!rumble) return;
    const cx = game.camera.position.x, lo = s * (p - H) + LAYOUT.train.stopX, hi = s * (p + H) + LAYOUT.train.stopX;
    rumblePos.set(clamp(cx, Math.min(lo, hi), Math.max(lo, hi)), 1.2, LAYOUT.trackZ[api.track]);
    const v = clamp(speed / V0, 0, 1.6);
    let vol, rate;
    if (api.state === 'arriving') { const app = phase === 'run' && t < T_RUN ? clamp(t / T_RUN, 0, 1) : 1; vol = (0.18 + 0.82 * app) * (0.35 + 0.65 * Math.min(1, v * 1.2)); rate = 0.72 + 0.32 * v + 0.1 * (phase === 'run' && t < T_RUN ? t / T_RUN : 1); }
    else if (api.state === 'departing' || phase === 'ghost') { vol = 0.25 + 0.75 * clamp(speed / 14, 0, 1); rate = 0.75 + 0.5 * clamp(speed / VMAX, 0, 1); }
    else { vol = phase === 'settle' ? 0.32 * Math.exp(-ph * 1.2) + 0.1 : 0.1; rate = 0.62; }
    rp.volume = vol; rp.rate = rate; rumble.set?.(rp);
  }

  // ---- particles: brake steam / dust puffs --------------------------------------------------------------------
  function buildSteam() {
    const N = 96, geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({ size: 1.5, map: B.T.glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 9; pts.visible = false; pts.userData.layer = 'train'; game.scene.add(pts);
    steam = { N, pos, col, geo, pts, vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), bright: new Float32Array(N), next: 0, active: 0 };
  }
  function emit(x, y, z, vx, vy, vz, life, bright) {
    const S = steam, i = S.next; S.next = (S.next + 1) % S.N;
    S.pos[i * 3] = x; S.pos[i * 3 + 1] = y; S.pos[i * 3 + 2] = z; S.vel[i * 3] = vx; S.vel[i * 3 + 1] = vy; S.vel[i * 3 + 2] = vz; S.life[i] = S.max[i] = life; S.bright[i] = bright; S.pts.visible = true;
  }
  function steamBurst(kind) {
    const zc = LAYOUT.trackZ[api.track], x0 = s * p + LAYOUT.train.stopX;
    for (let i = 0; i < K.CAR_COUNT; i++) for (const b of [-1, 1]) {
      const bx = x0 + s * (K.carU(i) + b * K.BOGIE_U), n = kind === 1 ? 4 : 2;
      for (let k = 0; k < n; k++) emit(bx + rand(-1.2, 1.2), Y_STEAM + rand(-0.2, 0.2), zc - s * (1.25 + rand(0, 0.2)), rand(-0.4, 0.4), rand(0.3, 0.9), -s * rand(0.5, 1.4), rand(1.8, 3.2), kind === 1 ? 0.22 : 0.15);
    }
  }
  function gust() {
    const zc = LAYOUT.trackZ[api.track];
    for (let k = 0; k < 26; k++) emit(s * -(MOUTH - 1.5 - rand(0, 8)), rand(0.1, 2.3), zc - s * rand(1.6, 5.4), s * rand(3, 8), rand(-0.1, 0.4), -s * rand(0, 1.2), rand(1.4, 2.6), 0.07);
  }
  function doorPuffs() {
    const zc = LAYOUT.trackZ[api.track], x0 = s * p + LAYOUT.train.stopX;
    for (let i = 0; i < K.CAR_COUNT; i++) for (const d of K.DOOR_U) for (let k = 0; k < 3; k++) emit(x0 + s * (K.carU(i) + d) + rand(-0.6, 0.6), rand(0.15, 0.9), zc - s * 1.55, rand(-0.15, 0.15), rand(0.05, 0.3), -s * rand(0.5, 1.3), rand(1.0, 1.9), 0.2);
  }
  function stepFx(dt) {
    const S = steam; if (!S || !S.pts.visible) return;
    let alive = 0;
    for (let i = 0; i < S.N; i++) {
      if (S.life[i] <= 0) { S.col[i * 3] = S.col[i * 3 + 1] = S.col[i * 3 + 2] = 0; continue; }
      S.life[i] -= dt; alive++;
      const k = S.life[i] / S.max[i], drag = Math.exp(-0.9 * dt);
      S.vel[i * 3] *= drag; S.vel[i * 3 + 1] = S.vel[i * 3 + 1] * drag + 0.25 * dt; S.vel[i * 3 + 2] *= drag;
      S.pos[i * 3] += S.vel[i * 3] * dt; S.pos[i * 3 + 1] += S.vel[i * 3 + 1] * dt; S.pos[i * 3 + 2] += S.vel[i * 3 + 2] * dt;
      const b = S.bright[i] * Math.min(1, (1 - k) * 5) * k;
      S.col[i * 3] = b * 0.85; S.col[i * 3 + 1] = b * 0.9; S.col[i * 3 + 2] = b;
    }
    S.geo.attributes.position.needsUpdate = true; S.geo.attributes.color.needsUpdate = true;
    if (!alive) S.pts.visible = false;
  }

  return api;
}
