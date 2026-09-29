// Enemy behaviour: steering (whisker obstacle avoidance + wall slide via world.collide), melee/ranged/charge/prime/stomp state machines.
// States: emerge | chase | windup | strike | recover | stagger | aim | shoot | charge | prime | dying | dead | gone
import * as THREE from 'three';
import { clamp, rand, randInt } from '../core.js';

const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832; return d; };

export function createAI(game, M, nav) {
  const P = { x: 0, y: 0, z: 0, r: 0.35, alive: false, vx: 0, vz: 0 };
  const _p = new THREE.Vector3(), _v = new THREE.Vector3();

  function begin() {
    const p = game.player;
    if (p) { P.x = p.pos.x; P.y = p.pos.y; P.z = p.pos.z; P.r = p.radius || 0.35; P.alive = p.alive !== false; P.vx = p.vel ? p.vel.x : 0; P.vz = p.vel ? p.vel.z : 0; }
    else P.alive = false;
  }
  function setState(e, s, dur = 0, atk) { e.state = s; e.t = 0; e.dur = dur; e.didHit = false; if (atk !== undefined) e.atk = atk; }

  // -------------------------------------------------------------------------------------------- steering
  function whisker(e, ux, uz, speed) {
    const look = e.radius + 0.55 + speed * 0.28;
    _p.set(e.pos.x + ux * look, e.pos.y, e.pos.z + uz * look);
    const sx = _p.x, sz = _p.z;
    if (game.world.collide(_p, e.radius, e.height)) {
      let px = _p.x - sx, pz = _p.z - sz; const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
      let tx = -pz * e.side, tz = px * e.side;
      if (tx * ux + tz * uz < -0.1) { e.side = -e.side; tx = -tx; tz = -tz; }
      e.avx = px * 0.7 + tx * 1.5; e.avz = pz * 0.7 + tz * 1.5;
    } else { e.avx *= 0.4; e.avz *= 0.4; if (Math.abs(e.avx) + Math.abs(e.avz) < 0.03) { e.avx = 0; e.avz = 0; } }
  }
  function steer(e, dt, speed, tx, tz, keepFacing, planned) {
    let ux = tx - e.pos.x, uz = tz - e.pos.z; const d = Math.hypot(ux, uz);
    if (d < 1e-3) { e.wx = 0; e.wz = 0; return; }
    ux /= d; uz /= d;
    if (planned) { e.avx = 0; e.avz = 0; } // waypoints from the nav grid already clear the static geometry: whiskers would only fight the route
    else { e.whisk -= dt; if (e.whisk <= 0) { e.whisk = 0.1 + Math.random() * 0.05; whisker(e, ux, uz, speed); } }
    ux += e.avx; uz += e.avz; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
    e.wx = ux * speed; e.wz = uz * speed;
    if (!keepFacing) e.faceYaw = Math.atan2(ux, uz);
  }
  function chase(e, dt, speed) {
    const stop = e.radius + P.r + (P.alive ? 0.08 : 1.6);
    if (e.dist <= stop) { e.wx = 0; e.wz = 0; e.faceYaw = e.bearing; return; }
    let tx = P.x, tz = P.z, planned = false;
    const wp = nav && !e.noclip ? nav.waypoint(e.radius, e.pos.x, e.pos.z, P.x, P.z, game.time) : null;
    if (wp) { tx = wp.x; tz = wp.z; planned = true; } // a prop / stair block is in the way: follow the flow field around it
    else if (e.type === 'runner' && e.dist > 3.5) { // frantic weaving
      const w = Math.sin(e.animT * 2.9 + e.seed * 9) * Math.min(2.2, e.dist * 0.22), nx = -(P.z - e.pos.z) / e.dist, nz = (P.x - e.pos.x) / e.dist;
      tx += nx * w; tz += nz * w;
    }
    steer(e, dt, speed, tx, tz, false, planned);
    // stuck detection -> switch wall-slide side and shove sideways
    e.stuckChk -= dt;
    if (e.stuckChk <= 0) {
      e.stuckChk = 0.7;
      if (e.speedNow < speed * 0.22 && e.dist > stop + 0.8 && !e.noclip) {
        e.side = -e.side; e.kx += -Math.cos(e.yaw) * e.side * 1.4; e.kz += Math.sin(e.yaw) * e.side * 1.4;
        // still not moving after several shoves: is it wedged in a gap narrower than its body (knockback / crowd push)? put it on the nearest free floor
        if ((e.stuckN = (e.stuckN || 0) + 1) >= 4 && nav) { const r = nav.rescue(e.radius, e.pos.x, e.pos.z, P.x, P.z, game.time); if (r) { e.pos.x = r.x; e.pos.z = r.z; e.kx = e.kz = 0; e.rescued = (e.rescued || 0) + 1; } e.stuckN = 0; }
      } else e.stuckN = 0;
    }
  }
  function face(e, mul = 1) { e.faceYaw = e.bearing; e.turnMul = mul; }

  // -------------------------------------------------------------------------------------------- combat helpers
  function meleeHit(e, m, extra = 0.35) {
    if (!P.alive) return false;
    const dx = P.x - e.pos.x, dz = P.z - e.pos.z, dist = Math.hypot(dx, dz) || 1e-3;
    if (dist > m.range + extra || Math.abs(P.y - e.pos.y) > 2.2) return false;
    if ((Math.sin(e.yaw) * dx + Math.cos(e.yaw) * dz) / dist < m.arc) return false;
    M.hurtPlayer(e, m.dmg * (0.85 + Math.random() * 0.3), 'melee');
    const p = game.player;
    if (m.knock && p) p.impulse(_v.set(dx / dist * m.knock, 0.6, dz / dist * m.knock));
    if (m.shake && p) p.shake(m.shake);
    return true;
  }
  function meleeStates(e, dt, m) {
    switch (e.state) {
      case 'windup':
        face(e, 1.6); e.wx = Math.sin(e.yaw) * 0.4; e.wz = Math.cos(e.yaw) * 0.4;
        if (e.t >= e.dur) { setState(e, 'strike', m.strike); if (m.lunge) { e.kx += Math.sin(e.yaw) * m.lunge; e.kz += Math.cos(e.yaw) * m.lunge; } }
        return true;
      case 'strike':
        if (m.lunge) { e.turnMul = 0.2; if (!e.didHit && e.t > 0.04 && meleeHit(e, m, 0.2)) e.didHit = true; }
        else if (!e.didHit && e.t >= e.dur * 0.4) { e.didHit = true; meleeHit(e, m); }
        if (e.t >= e.dur) setState(e, 'recover', m.recover);
        return true;
      case 'recover':
        e.turnMul = 0.8; face(e, 0.8);
        if (e.t >= e.dur) { setState(e, 'chase'); e.atk = null; e.cool = m.cooldown * rand(0.9, 1.25); }
        return true;
    }
    return false;
  }
  function beginMelee(e, m, pre = 0) {
    if (!P.alive || e.cool > 0 || e.dist > m.range + pre || Math.abs(P.y - e.pos.y) > 1.8) return false;
    M.sfx(e, 'attack'); setState(e, 'windup', m.windup * rand(0.9, 1.1), m.atk); return true;
  }

  // -------------------------------------------------------------------------------------------- behaviours
  function shambler(e, dt) {
    const m = e.def.melee;
    if (e.state === 'chase') { chase(e, dt, e.speed); beginMelee(e, m); }
    else meleeStates(e, dt, m);
  }
  function runner(e, dt) {
    const m = e.def.melee;
    if (e.state === 'chase') { chase(e, dt, e.speed); beginMelee(e, m, 1.9); }
    else meleeStates(e, dt, m);
  }

  function ranged(e, dt) {
    const d = e.def, r = d.ranged;
    if (d.melee && e.atk === d.melee.atk && meleeStates(e, dt, d.melee)) return;
    switch (e.state) {
      case 'chase': {
        e.losT -= dt; if (e.losT <= 0) { e.losT = 0.25 + Math.random() * 0.12; e.los = M.lineOfSight(e); }
        e.strafeT -= dt; if (e.strafeT <= 0) { e.strafeT = rand(1.4, 3.6); e.strafe = -e.strafe; }
        const spd = e.speed, dx = P.x - e.pos.x, dz = P.z - e.pos.z, dd = e.dist;
        if (!P.alive) { chase(e, dt, spd * 0.6); break; }
        if (dd > r.max || !e.los) chase(e, dt, spd);
        else if (dd < r.min && e.corner < 0.9) { // too close: back away (until cornered)
          steer(e, dt, spd * 0.85, e.pos.x - dx / dd * 3 + (dz / dd) * e.strafe * 1.5, e.pos.z - dz / dd * 3 - (dx / dd) * e.strafe * 1.5, true); e.faceYaw = e.bearing;
          if (e.speedNow < 0.3) e.corner += dt; else e.corner = Math.max(0, e.corner - dt);
          if (e.corner >= 0.9) { e.strafe = -e.strafe; e.cornerT = 2.5; }
        }
        else {
          if (e.corner >= 0.9) { e.cornerT -= dt; if (e.cornerT <= 0) e.corner = 0; }
          steer(e, dt, spd * 0.5, e.pos.x + (dz / dd) * e.strafe * 3, e.pos.z - (dx / dd) * e.strafe * 3, true); e.faceYaw = e.bearing;
        }
        if (d.melee && beginMelee(e, d.melee)) break;
        if (e.los && dd <= r.max * 1.12 && dd >= 2.5 && e.cool <= 0) { setState(e, 'aim', r.telegraph * rand(0.9, 1.15), r.atk); e.wx = 0; e.wz = 0; }
        break;
      }
      case 'aim':
        face(e, 3); if (!P.alive) { setState(e, 'chase'); e.atk = null; break; }
        if (e.t >= e.dur) { e.burstLeft = randInt(r.burst[0], r.burst[1]); e.nextShot = 0; setState(e, 'shoot', 6); }
        break;
      case 'shoot':
        face(e, 4); e.nextShot -= dt;
        if (e.nextShot <= 0) {
          if (e.type === 'trooper') M.fireRifle(e, rand(r.dmg[0], r.dmg[1]), r.spread); else M.spit(e);
          e.burstLeft--; e.nextShot = r.burstGap || 0.1;
          if (e.burstLeft <= 0) { setState(e, 'recover', 0.3 + Math.random() * 0.2); e.cool = rand(r.cooldown[0], r.cooldown[1]); }
        }
        break;
      case 'recover':
        face(e, 2); if (e.t >= e.dur) { setState(e, 'chase'); e.atk = null; }
        break;
    }
  }

  function brute(e, dt) {
    const d = e.def, m = d.melee, c = d.charge;
    e.chargeCd -= dt;
    switch (e.state) {
      case 'chase':
        chase(e, dt, e.speed);
        if (P.alive && e.chargeCd <= 0 && e.dist >= c.min && e.dist <= c.max && e.speedNow > 0.4) { setState(e, 'windup', c.windup, 'charge'); e.chargeMode = true; M.sfx(e, 'alert', true); game.player?.shake(0.35); break; }
        beginMelee(e, m); if (e.state === 'windup') e.chargeMode = false;
        break;
      case 'windup':
        if (e.chargeMode) {
          face(e, 0.8);
          if (e.t >= e.dur) { e.cdx = Math.sin(e.yaw); e.cdz = Math.cos(e.yaw); e.chargeHit = false; setState(e, 'charge', c.time, 'charge'); }
        } else meleeStates(e, dt, m);
        break;
      case 'charge': {
        const cur = Math.atan2(e.cdx, e.cdz), df = angDiff(e.bearing, cur), na = cur + clamp(df, -0.9 * dt, 0.9 * dt);
        e.cdx = Math.sin(na); e.cdz = Math.cos(na); e.wx = e.cdx * c.speed; e.wz = e.cdz * c.speed; e.faceYaw = na; e.turnMul = 2.5;
        if (!e.chargeHit && P.alive && e.dist <= e.radius + P.r + 0.95 && Math.abs(P.y - e.pos.y) < 2) {
          e.chargeHit = true; M.hurtPlayer(e, c.dmg, 'melee');
          const p = game.player; if (p) { p.impulse(_v.set(e.cdx * c.knock, 3.2, e.cdz * c.knock)); p.shake(1.1); }
          M.sfx(e, 'attack', true); setState(e, 'recover', 0.9, 'charge'); e.chargeCd = c.cooldown; break;
        }
        if (e.t > 0.45 && e.speedNow < c.speed * 0.3) { // ran into a wall: crash
          game.player?.shake(clamp(0.9 * (1 - e.dist / 30), 0, 0.9)); M.play('explosion', e.pos.x, 1, e.pos.z, 0.35, 0.7);
          setState(e, 'stagger', 1.0); e.atk = null; e.chargeCd = c.cooldown; e.react = 1; break;
        }
        if (e.t >= e.dur) { setState(e, 'recover', 0.8, 'charge'); e.chargeCd = c.cooldown; }
        break;
      }
      case 'strike': case 'recover':
        if (e.atk === 'charge') { face(e, 0.5); if (e.t >= e.dur) { setState(e, 'chase'); e.atk = null; e.cool = 0.6; } }
        else meleeStates(e, dt, m);
        break;
    }
  }

  function exploder(e, dt) {
    const pr = e.def.prime;
    if (e.state === 'chase') {
      chase(e, dt, e.speed);
      if (P.alive && e.dist <= pr.range) { setState(e, 'prime', pr.time, 'prime'); M.sfx(e, 'attack', true); e.primeGlow = 1; }
    } else if (e.state === 'prime') {
      face(e, 1.5);
      if (P.alive && e.dist > e.radius + P.r + 0.3) steer(e, dt, e.speed * 0.55, P.x, P.z); // keep waddling toward the victim
      if (Math.floor(e.t * 6) !== Math.floor((e.t - dt) * 6) && e.t < e.dur) M.sfx(e, 'idle', true);
      if (e.t >= e.dur) M.burst(e);
    }
  }

  function tyrant(e, dt) {
    const d = e.def, cl = d.claw, st = d.stomp;
    switch (e.state) {
      case 'chase': {
        chase(e, dt, e.speed);
        if (!P.alive || e.cool > 0) break;
        if (e.next === 'claw' && e.dist <= cl.range * 0.92) { M.sfx(e, 'attack', true); setState(e, 'windup', cl.windup, 'claw'); e.cur = cl; }
        else if (e.next === 'stomp' && e.dist <= st.range) { M.sfx(e, 'alert', true); game.player?.shake(0.3); setState(e, 'windup', st.windup, 'stomp'); e.cur = st; }
        else if (e.next === 'claw' && e.dist > 9 && Math.random() < dt * 0.25) e.next = 'stomp'; // don't chase forever without doing something scary
        break;
      }
      case 'windup':
        face(e, 1.3); e.wx = 0; e.wz = 0;
        if (e.t >= e.dur) {
          setState(e, 'strike', e.cur.strike);
          if (e.atk === 'stomp') { M.shockwave(e, e.cur); e.didHit = true; }
        }
        break;
      case 'strike':
        e.turnMul = 0.3;
        if (e.atk === 'claw' && !e.didHit && e.t >= e.dur * 0.4) { e.didHit = true; meleeHit(e, cl, 0.6); game.player?.shake(0.25); }
        if (e.t >= e.dur) setState(e, 'recover', e.cur.recover);
        break;
      case 'recover':
        face(e, 0.6);
        if (e.t >= e.dur) { setState(e, 'chase'); e.next = e.atk === 'claw' ? 'stomp' : 'claw'; e.atk = null; e.cool = e.cur.cooldown; }
        break;
    }
  }
  const BEHAVE = { shambler, runner, trooper: ranged, spitter: ranged, brute, exploder, tyrant };

  // -------------------------------------------------------------------------------------------- per-frame
  function think(e, dt) {
    const dx = P.x - e.pos.x, dz = P.z - e.pos.z, dist = Math.hypot(dx, dz) || 1e-3;
    e.dist = dist; e.bearing = Math.atan2(dx, dz); e.hasTarget = P.alive;
    e.t += dt; e.cool -= dt; e.painCd -= dt;
    e.lookRel = angDiff(e.bearing, e.yaw);
    e.wx = 0; e.wz = 0; e.turnMul = 1;
    if (!e.alerted) { e.alertT -= dt; if (e.alertT <= 0) { e.alerted = true; if (e.state !== 'emerge' || dist < 40) M.sfx(e, 'alert'); if (e.type === 'tyrant') game.player?.shake(0.6); } }
    else { e.idleT -= dt; if (e.idleT <= 0) { e.idleT = rand(2.8, 7); if (dist < 30 && P.alive) M.sfx(e, 'idle'); } }
    stepSound(e, dt);
    if (e.state === 'emerge') {
      e.turnMul = 4; e.wz = e.emergeDir * Math.min(e.speed, 2.4); e.wx = 0; e.faceYaw = e.emergeDir > 0 ? 0 : Math.PI;
      if (Math.abs(e.pos.z) <= 4.5 || e.t > e.dur) {
        if (Math.abs(e.pos.z) > 4.5) e.pos.z = Math.sign(e.pos.z) * 4.5;
        e.noclip = false; setState(e, 'chase'); e.atk = null;
      }
    } else if (e.state === 'stagger') {
      face(e, 0.5);
      if (e.t >= e.dur) { setState(e, 'chase'); e.atk = null; }
    } else BEHAVE[e.type](e, dt);
  }

  function stepSound(e, dt) {
    if (!e.def.snd.step || e.speedNow < 0.6) return;
    e.stepAcc += e.speedNow * dt;
    const stride = 0.5 / e.def.anim.cyc;
    if (e.stepAcc < stride) return;
    e.stepAcc -= stride;
    const d = Math.hypot(e.pos.x - P.x, e.pos.z - P.z), heavy = e.def.mass >= 3;
    if (heavy) { M.sfx(e, 'step'); if (d < 26) game.player?.shake(clamp((e.type === 'tyrant' ? 0.75 : 0.5) * (1 - d / 26), 0, 0.8)); }
    else if (d < 9 && Math.random() < 0.5) M.sfx(e, 'step');
  }

  // emissive pulses (eyes / pustules / lantern), exploder swell
  function glow(e, dt) {
    const g = e.rig.glow, t = e.animT, d = e.def; let k = 0.92 + 0.18 * Math.sin(t * 4 + e.seed * 9);
    switch (e.type) {
      case 'exploder': {
        k = 0.85 + 0.25 * Math.sin(t * 3 + e.seed * 6);
        if (e.state === 'prime') { const u = clamp(e.t / e.dur, 0, 1); k = 1.3 + 1.6 * u + 0.7 * Math.sin(t * (16 + 34 * u)); e.rig.spine.scale.setScalar(1 + 0.14 * u + 0.025 * Math.sin(t * 30)); e.swelled = true; }
        else if (e.swelled) { e.rig.spine.scale.setScalar(1); e.swelled = false; }
        break;
      }
      case 'trooper': k = e.state === 'aim' ? 1 + 1.6 * clamp(e.t / e.dur, 0, 1) : e.state === 'shoot' ? 2.6 : 0.95; break;
      case 'spitter': k = 0.95 + 0.2 * Math.sin(t * 2.2 + e.seed * 5) + (e.state === 'aim' ? 1.3 * clamp(e.t / e.dur, 0, 1) : 0) + (e.state === 'shoot' ? 1.4 : 0); break;
      case 'tyrant': k = 0.92 + 0.12 * Math.sin(t * 9) + 0.08 * Math.sin(t * 23 + 1) + (e.state === 'windup' ? 0.4 : 0); break;
      case 'brute': k = e.state === 'windup' || e.state === 'charge' ? 1.7 : 0.95; break;
    }
    g.color.setScalar(d.glow * k);
  }

  return { begin, think, glow, setState };
}
