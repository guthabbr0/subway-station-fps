// Player controller: snappy Doom-ish movement with a touch of inertia, head bob, sprint FOV kick, strafe roll,
// crouch, jump, footsteps, camera recoil (spring) + trauma shake, damage with armour, and a death camera.
// Yaw convention (three.js): camera.rotation.y = yaw, forward = (-sin(yaw), 0, -cos(yaw)), right = (cos(yaw), 0, -sin(yaw)).
import * as THREE from 'three';
import { bus, LAYOUT, clamp, lerp, damp } from './core.js';

// ---- tuning ---------------------------------------------------------------------------------
const WALK = 6.4, SPRINT = 9.8, CROUCH_SPEED = 3.2; // m/s
const GROUND_ACCEL = 64, GROUND_DECEL = 46;          // m/s^2 (velocity chases the wish velocity -> ~0.1 s to full speed)
const AIR_ACCEL = 11, AIR_DRAG = 0.35;
const GRAVITY = 24, JUMP_V = 6.9;                    // apex ~0.99 m
const STAND_H = 1.75, CROUCH_H = 1.2, EYE_DROP = 0.15;
const STEP = 0.45, AIR_STEP = 0.06, SNAP_DOWN = 0.42;
const SAFE_Z = LAYOUT.platform.halfW - 0.3, SAFE_X = LAYOUT.platform.x1 - 0.3; // the platform is closed by the edge barrier (|z| = halfW) and the end walls
const SENS = 0.0022, PITCH_MAX = 1.5;
const BASE_FOV_FALLBACK = 75;
const easeOutBounce = (t) => {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
  if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
  t -= 2.625 / 2.75; return 7.5625 * t * t + 0.984375;
};

export function create(game) {
  const pos = new THREE.Vector3(), vel = new THREE.Vector3(), _eye = new THREE.Vector3();
  const ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3() };
  const _tmp = new THREE.Vector3();

  // camera-effect state (all scalars: no per-frame allocations)
  let clock = 0, trauma = 0, shakeT = Math.random() * 100;
  let kp = 0, kpv = 0, ky = 0, kyv = 0;             // recoil springs (pitch / yaw offsets)
  let roll = 0, hitRoll = 0, hitRollV = 0;          // strafe roll / damage roll spring
  let dip = 0, dipV = 0;                            // landing dip spring
  let camSmooth = 0;                                // stair smoothing offset
  let bobPhase = 0, bobAmp = 0, lastStepIdx = 0, footSide = 0;
  let fovOff = 0, BASE_FOV = BASE_FOV_FALLBACK;
  let jumpBuf = 0, coyote = 0, jumpHeld = false, jumpCut = false, embedT = 0;
  let crouchT = 0;                                  // 0 standing .. 1 crouched (smoothed)
  let lastHurtSnd = -1, lastDamageAt = -10;
  // death camera
  let deathT = 0, deathStartEye = 1.6, deathRoll = 1.2, deathPitch = 0.4, deathYawTo = null;

  const P = {
    pos, vel,
    get eye() { return _eye; },
    yaw: 0, pitch: 0, radius: 0.35, height: STAND_H,
    health: 100, armor: 0, maxHealth: 100, alive: true, grounded: true,
    crouching: false, sprinting: false, speed: 0, eyeHeight: STAND_H - EYE_DROP, rescues: 0, // rescues: times the embedded-in-solid recovery had to move the player (should stay 0)
  };

  const world = () => game.world;

  // Lowest solid box above the feet that overlaps the player's circle (or the world ceiling).
  function ceilingAbove(x, z, yFeet) {
    let best = world().ceilingY;
    const r2 = P.radius * P.radius;
    for (const b of world().boxes) {
      if (!b.enabled || !b.solid || b.min.y < yFeet + 0.3 || b.min.y >= best) continue;
      const cx = clamp(x, b.min.x, b.max.x), cz = clamp(z, b.min.z, b.max.z);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r2) best = b.min.y;
    }
    return best;
  }

  function placeOnGround(x, z) {
    const g = world().groundAt(x, z, 3, 3.5);
    pos.set(x, g > -900 ? g : 0, z);
  }

  // ---- public API -----------------------------------------------------------------------------
  P.damage = (amount, o = {}) => {
    if (!P.alive || !(amount > 0)) return 0;
    if (game.debug?.god) return 0;
    const a = Math.max(1, Math.round(amount));
    // Doom armour: absorbs 1/3 (worn) up to 1/2 (full)
    let saved = 0;
    if (P.armor > 0) { saved = Math.min(P.armor, Math.floor(a * (1 / 3 + (P.armor / 100) * (1 / 6)))); P.armor -= saved; }
    const taken = a - saved;
    P.health = Math.max(0, P.health - taken);
    lastDamageAt = clock;
    bus.emit('player:hurt', { amount: a, from: o.from, type: o.type });
    game.fx.damage = Math.min(0.85, Math.max(game.fx.damage, 0.15 + a / 80));
    if (P.health > 0 && clock - lastHurtSnd > 0.16) { lastHurtSnd = clock; game.audio?.play('hurt', undefined, { volume: clamp(0.55 + a / 50, 0.55, 1) }); }
    game.hud?.flash?.('#ff2a1a', clamp(0.08 + a / 160, 0.08, 0.3), 0.3);
    // flinch: pitch jolt + roll away from the attacker
    const s = clamp(a / 30, 0.25, 1.4);
    kpv -= 0.9 * s; // downward jolt (spring impulse)
    const from = o.from?.isVector3 ? o.from : o.from?.pos;
    let side = Math.random() < 0.5 ? -1 : 1;
    if (from) {
      const dx = from.x - pos.x, dz = from.z - pos.z, d = Math.hypot(dx, dz) || 1;
      side = (dx * Math.cos(P.yaw) - dz * Math.sin(P.yaw)) / d;
    }
    hitRollV += side * 0.9 * s;
    shake(clamp(0.18 + a / 90, 0.18, 0.7));
    if (P.health <= 0) die(from);
    return taken;
  };

  function die(from) {
    P.alive = false; P.health = 0;
    deathT = 0; deathStartEye = P.height - EYE_DROP;
    const sgn = Math.random() < 0.5 ? -1 : 1;
    deathRoll = sgn * (1.05 + Math.random() * 0.35); deathPitch = 0.25 + Math.random() * 0.4;
    deathYawTo = null;
    if (from) { const dx = from.x - pos.x, dz = from.z - pos.z; if (dx * dx + dz * dz > 0.01) deathYawTo = Math.atan2(-dx, -dz); }
    P.sprinting = false; P.crouching = true;
    game.audio?.play('playerDeath');
    bus.emit('player:dead');
  }

  P.heal = (n) => { const b = P.health; if (P.alive) P.health = Math.min(P.maxHealth, P.health + n); return P.health - b; };
  P.addArmor = (n) => { const b = P.armor; P.armor = Math.min(100, P.armor + n); return P.armor - b; };
  P.impulse = (v) => {
    vel.add(v);
    const h = Math.hypot(vel.x, vel.z); if (h > 18) { vel.x *= 18 / h; vel.z *= 18 / h; }
    if (vel.y > 0.1) P.grounded = false;
  };
  P.kick = (pitchRad = 0, yawRad = 0) => {
    // impulse into a critically-damped spring (k=150): peak offset ~= requested angle, back to the aim point in ~0.4 s
    kpv += pitchRad * 35; kyv += yawRad * 35;
  };
  function shake(amount) { trauma = Math.min(1.5, Math.max(trauma, amount)); }
  P.shake = shake;
  P.getAimRay = () => {
    ray.origin.copy(game.camera.position);
    ray.dir.set(0, 0, -1).applyQuaternion(game.camera.quaternion);
    return ray;
  };
  // nearest spot on the platform where the player's circle overlaps no solid (teleport targets inside props / off the platform end up here)
  const _fs = new THREE.Vector3();
  function freeSpot(x, z) {
    for (let r = 0; r <= 8; r += 0.25) for (let a = 0; a < 6.2832; a += r === 0 ? 7 : 0.393) {
      const tx = clamp(x + Math.cos(a) * r, -SAFE_X, SAFE_X), tz = clamp(z + Math.sin(a) * r, -SAFE_Z, SAFE_Z);
      _fs.set(tx, 0.05, tz); if (!world().collide(_fs, P.radius - 0.002, P.height, STEP)) return [tx, tz];
    }
    return [x, z];
  }
  P.teleport = (x, z, yaw = 0) => {
    const [fx, fz] = freeSpot(x, z); // never leave the player embedded in a prop or outside the platform
    placeOnGround(fx, fz); vel.set(0, 0, 0); P.yaw = yaw; P.grounded = true; camSmooth = 0;
  };

  P.reset = () => {
    P.health = 100; P.armor = 0; P.alive = true; P.grounded = true; P.crouching = false; P.sprinting = false;
    P.height = STAND_H; P.pitch = 0; P.speed = 0; crouchT = 0;
    trauma = 0; kp = kpv = ky = kyv = 0; roll = hitRoll = hitRollV = 0; dip = dipV = 0; camSmooth = 0;
    bobPhase = bobAmp = 0; lastStepIdx = 0; fovOff = 0; embedT = 0; jumpBuf = coyote = 0; jumpHeld = jumpCut = false; deathT = 0; deathYawTo = null;
    vel.set(0, 0, 0);
    const s = game.station?.playerSpawn;
    if (s) { pos.set(s.x, s.y || 0, s.z); const g = world().groundAt(s.x, s.z, (s.y || 0) + 1, 1.2); if (g > -900) pos.y = g; } else pos.set(-8, 0, 0);
    // face the platform centre (or along +X when spawned dead-centre)
    const dx = -pos.x, dz = -pos.z;
    P.yaw = dx * dx + dz * dz > 1 ? Math.atan2(-dx, -dz) : -Math.PI / 2;
    BASE_FOV = BASE_FOV_FALLBACK;
    game.camera.rotation.order = 'YXZ';
    if (game.camera.fov !== BASE_FOV) { game.camera.fov = BASE_FOV; game.camera.updateProjectionMatrix(); }
    applyCamera(0, 0, 0);
  };

  P.init = () => { game.camera.rotation.order = 'YXZ'; if (game.camera.fov) BASE_FOV = game.camera.fov; };

  // ---- camera composition ---------------------------------------------------------------------
  const nz = (a, b) => Math.sin(shakeT * a + b) * 0.6 + Math.sin(shakeT * a * 1.73 + b * 2.1) * 0.4;
  let curFov = 0;
  function applyCamera(dt, bobX, bobY, bobRoll = 0, bobPitch = 0) {
    const cam = game.camera;
    // shake
    const amp = trauma > 0 ? Math.pow(trauma, 1.5) : 0;
    let shp = 0, shy = 0, shr = 0, shx = 0, shy2 = 0;
    if (amp > 0.0005) { shp = amp * 0.03 * nz(23.1, 1); shy = amp * 0.03 * nz(19.7, 5); shr = amp * 0.05 * nz(17.3, 9); shx = amp * 0.05 * nz(29.0, 3); shy2 = amp * 0.05 * nz(31.0, 7); }
    // eye height (death: fall to the floor with a bounce)
    const baseEye = P.height - EYE_DROP;
    let eyeY = baseEye, deathE = 0;
    if (!P.alive) { deathE = clamp(deathT / 0.85, 0, 1); eyeY = lerp(deathStartEye, 0.22, easeOutBounce(deathE)); }
    P.eyeHeight = eyeY;
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    cam.position.set(pos.x + cy * bobX + shx * cy, pos.y + eyeY + bobY + dip + camSmooth + shy2, pos.z - sy * bobX - shx * sy);
    const pitch = clamp(P.pitch + kp + shp + bobPitch + (P.alive ? 0 : deathPitch * deathE), -1.55, 1.55);
    const yaw = P.yaw + ky + shy;
    const rl = roll + hitRoll + shr + bobRoll + (P.alive ? 0 : deathRoll * deathE);
    cam.rotation.set(pitch, yaw, rl, 'YXZ');
    // fov
    const fov = BASE_FOV + fovOff - (P.alive ? 0 : 9 * deathE);
    if (Math.abs(fov - curFov) > 0.02) { curFov = fov; cam.fov = fov; cam.updateProjectionMatrix(); }
    _eye.copy(cam.position);
  }

  // ---- main update ----------------------------------------------------------------------------
  P.update = (dt) => {
    dt = Math.min(dt, 0.05); if (!(dt > 0)) dt = 0.0001;
    clock += dt; shakeT += dt;
    const inp = game.input;
    const acting = game.state === 'playing' && P.alive;

    // -- look --
    if (acting) {
      const dx = clamp(inp.mouseDX, -400, 400), dy = clamp(inp.mouseDY, -400, 400);
      P.yaw -= dx * SENS; P.pitch = clamp(P.pitch - dy * SENS, -PITCH_MAX, PITCH_MAX);
    } else if (!P.alive && deathYawTo !== null) {
      // turn slowly to face what killed us
      let d = deathYawTo - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); P.yaw += d * Math.min(1, dt * 2.2);
    }
    if (P.yaw > Math.PI * 4 || P.yaw < -Math.PI * 4) P.yaw = Math.atan2(Math.sin(P.yaw), Math.cos(P.yaw));

    // -- input -> wish vector --
    let ix = 0, iz = 0, wantCrouch = false, wantSprint = false, jumpPressed = false;
    if (acting) {
      if (inp.down('KeyW') || inp.down('ArrowUp')) iz += 1;
      if (inp.down('KeyS') || inp.down('ArrowDown')) iz -= 1;
      if (inp.down('KeyD') || inp.down('ArrowRight')) ix += 1;
      if (inp.down('KeyA') || inp.down('ArrowLeft')) ix -= 1;
      wantCrouch = inp.down('KeyC') || inp.down('ControlLeft') || inp.down('ControlRight');
      wantSprint = (inp.down('ShiftLeft') || inp.down('ShiftRight')) && iz > 0;
      jumpPressed = inp.pressed('Space');
      jumpHeld = inp.down('Space');
    } else jumpHeld = false;
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    let wx = -sy * iz + cy * ix, wz = -cy * iz - sy * ix;
    const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }

    // -- crouch (with headroom check when standing back up) --
    let crouching = wantCrouch;
    if (!wantCrouch && P.crouching && P.alive) {
      const room = ceilingAbove(pos.x, pos.z, pos.y) - pos.y;
      if (room < STAND_H + 0.02) crouching = true;
    }
    if (!P.alive) crouching = true;
    P.crouching = crouching;
    crouchT = damp(crouchT, crouching ? 1 : 0, 15, dt);
    P.height = lerp(STAND_H, CROUCH_H, crouchT);
    const sprinting = wantSprint && !crouching && P.alive;
    P.sprinting = sprinting;
    const maxSpd = crouching ? CROUCH_SPEED : sprinting ? SPRINT : WALK;

    // -- jump buffering / coyote --
    if (jumpPressed) jumpBuf = 0.12; else jumpBuf = Math.max(0, jumpBuf - dt);
    if (P.grounded) coyote = 0.08; else coyote = Math.max(0, coyote - dt);
    if (jumpBuf > 0 && coyote > 0 && acting) {
      vel.y = crouching ? JUMP_V * 0.82 : JUMP_V; P.grounded = false; jumpBuf = 0; coyote = 0; jumpCut = false; camSmooth = 0;
      game.audio?.play('jump', undefined, { volume: 0.5 });
    }
    // variable jump height: releasing space early trims the rise
    if (!P.grounded && vel.y > 2.6 && !jumpHeld && !jumpCut && acting) { vel.y *= 0.55; jumpCut = true; }

    // -- horizontal velocity --
    if (P.grounded) {
      const tx = wx * maxSpd, tz = wz * maxSpd;
      const ddx = tx - vel.x, ddz = tz - vel.z, dl = Math.hypot(ddx, ddz);
      const rate = (wl > 0.01 ? GROUND_ACCEL : GROUND_DECEL) * dt;
      if (dl <= rate) { vel.x = tx; vel.z = tz; } else { vel.x += ddx / dl * rate; vel.z += ddz / dl * rate; }
    } else {
      if (wl > 0.01) { const cur = vel.x * wx + vel.z * wz, add = clamp(maxSpd - cur, 0, AIR_ACCEL * dt); vel.x += wx * add; vel.z += wz * add; }
      const drag = Math.max(0, 1 - AIR_DRAG * dt); vel.x *= drag; vel.z *= drag;
    }

    // -- integrate in sub-steps (collision + ground) --
    const w = world();
    const hs = Math.hypot(vel.x, vel.z);
    const n = clamp(Math.ceil(hs * dt / 0.16), 1, 6), h = dt / n;
    const wasGrounded = P.grounded;
    for (let i = 0; i < n; i++) {
      const oy = pos.y;
      pos.x += vel.x * h; pos.z += vel.z * h;
      if (!P.grounded) {
        vel.y -= GRAVITY * h; pos.y += vel.y * h;
        if (vel.y > 0) { // head bump
          const cyl = ceilingAbove(pos.x, pos.z, oy);
          if (pos.y + P.height > cyl) { pos.y = cyl - P.height; if (vel.y > 1.5) dipV -= vel.y * 0.25; vel.y = 0; }
        }
      }
      const px = pos.x, pz = pos.z;
      if (w.collide(pos, P.radius, P.height, P.grounded ? STEP : AIR_STEP)) { // airborne: no auto-step, so a jump cannot slip through the top of a knee-high prop
        const ddx = pos.x - px, ddz = pos.z - pz, dl = Math.hypot(ddx, ddz);
        if (dl > 1e-5) { const nx = ddx / dl, nz2 = ddz / dl, vn = vel.x * nx + vel.z * nz2; if (vn < 0) { vel.x -= nx * vn; vel.z -= nz2 * vn; } }
      }
      const prevY = pos.y;
      const gy = w.groundAt(pos.x, pos.z, pos.y, P.grounded ? STEP : 0.06 + Math.max(0, -vel.y) * h);
      if (P.grounded) {
        if (gy > -900 && pos.y - gy <= SNAP_DOWN) { pos.y = gy; camSmooth += prevY - gy; }
        else P.grounded = false; // walked off an edge
      } else if (vel.y <= 0 && gy > -900 && pos.y <= gy + 0.001) {
        const vy = vel.y; pos.y = gy; vel.y = 0; P.grounded = true;
        if (vy < -2.5) {
          game.audio?.play('land', undefined, { volume: clamp(-vy / 9, 0.3, 1) });
          dipV -= Math.min(-vy * 0.5, 3.6);
          if (vy < -9) shake(clamp(-vy / 20, 0.15, 0.5));
        }
        lastStepIdx = Math.floor(bobPhase + 0.5);
      }
    }
    if (P.grounded && !wasGrounded) jumpCut = false;
    camSmooth = damp(camSmooth, 0, 14, dt); if (Math.abs(camSmooth) < 1e-4) camSmooth = 0;
    if (pos.y < -40 || !Number.isFinite(pos.x + pos.y + pos.z)) { // fell out of the world: back to spawn
      const s = game.station?.playerSpawn; placeOnGround(s ? s.x : -8, s ? s.z : 0); vel.set(0, 0, 0); P.grounded = true;
    }
    if (pos.y + P.height > w.ceilingY) { pos.y = w.ceilingY - P.height; if (vel.y > 0) vel.y = 0; }
    // slipped below the platform plane while still over it (embedded frame, wall clamp): put the feet back on the floor instead of falling forever
    if (pos.y < -0.25 && pos.x >= LAYOUT.platform.x0 && pos.x <= LAYOUT.platform.x1 && pos.z >= -LAYOUT.platform.halfW && pos.z <= LAYOUT.platform.halfW) { const g0 = w.groundAt(pos.x, pos.z, 0.5, 0.5); pos.y = g0 > -900 ? g0 : 0; vel.y = 0; P.grounded = true; }

    // -- soft collision with living enemies (can't walk through the horde) --
    const en = game.enemies?.list;
    if (en && P.alive) {
      let sx = 0, sz = 0;
      for (let i = 0; i < en.length; i++) {
        const e = en[i];
        if (!e.alive || e.noPlayerCollide) continue;
        if (e.pos.y > pos.y + P.height - 0.2 || e.pos.y + (e.height || 1.7) < pos.y + 0.3) continue;
        const dx = pos.x - e.pos.x, dz = pos.z - e.pos.z, rr = P.radius + (e.radius || 0.4) * 0.85, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2);
        if (d > 1e-4) { const push = Math.min(rr - d, 0.25) * 0.75 / d; sx += dx * push; sz += dz * push; }
        else sx += 0.02;
      }
      // a crowd pushing from one side must never squeeze the player through a thin barrier (world.collide would throw a centre that is past the
      // middle of a 0.4 m wall out on the far side): cap the total shove per frame well below half the barrier thickness
      const sl = Math.hypot(sx, sz); if (sl > 0.12) { sx *= 0.12 / sl; sz *= 0.12 / sl; }
      pos.x += sx; pos.z += sz;
      w.collide(pos, P.radius, P.height, P.grounded ? STEP : AIR_STEP); // same step rule as the movement sub-steps (a mismatch lets a shove sink the player into a knee-high prop mid-jump)
    }
    // last line of defence: nothing (crowd shove, knockback, a bad frame time) may ever carry the player off the platform
    if (pos.z > SAFE_Z || pos.z < -SAFE_Z || pos.x > SAFE_X || pos.x < -SAFE_X) {
      pos.z = clamp(pos.z, -SAFE_Z, SAFE_Z); pos.x = clamp(pos.x, -SAFE_X, SAFE_X); vel.x *= 0.3; vel.z *= 0.3;
    }

    // embedded in a solid for several frames in a row (blast + prop, bad frame): the collision resolver cannot get out on its own -> nearest free floor spot
    _fs.copy(pos);
    if (w.collide(_fs, P.radius - 0.03, P.height, P.grounded ? STEP : AIR_STEP) && _fs.distanceToSquared(pos) > 0.0025) {
      if (++embedT > 4) { const [fx, fz] = freeSpot(pos.x, pos.z), g0 = w.groundAt(fx, fz, pos.y, 0.5); pos.set(fx, g0 > -900 ? Math.max(g0, 0) : 0, fz); vel.set(0, 0, 0); P.grounded = true; embedT = 0; P.rescues++; }
    } else embedT = 0;
    P.speed = Math.hypot(vel.x, vel.z);

    // -- head bob & footsteps --
    const moving = P.grounded && P.speed > 1.0 && P.alive;
    const stride = crouching ? 1.7 : sprinting ? 2.7 : 2.35;
    if (moving) {
      bobPhase += P.speed * dt / stride;
      const idx = Math.floor(bobPhase + 0.5);
      if (idx !== lastStepIdx) {
        lastStepIdx = idx; footSide ^= 1;
        game.audio?.play('step', undefined, { volume: crouching ? 0.22 : sprinting ? 0.62 : 0.42, rate: footSide ? 0.94 : 1.06 });
      }
    }
    const bobTarget = moving ? clamp(P.speed / WALK, 0.3, 1.5) * (crouching ? 0.6 : 1) : 0;
    bobAmp = damp(bobAmp, bobTarget, moving ? 9 : 7, dt);
    const ph = bobPhase * Math.PI * 2;
    const bobY = Math.cos(ph) * 0.03 * bobAmp + Math.sin(clock * 1.7) * 0.0035 * (1 - clamp(bobAmp, 0, 1));
    const bobX = Math.sin(ph * 0.5) * 0.02 * bobAmp;
    const bobRoll = Math.sin(ph * 0.5) * 0.007 * bobAmp;
    const bobPitch = Math.sin(ph) * 0.004 * bobAmp + Math.sin(clock * 1.1) * 0.0012 * (1 - clamp(bobAmp, 0, 1));

    // -- springs: recoil, landing dip, roll --
    const k = 150, c = 24.5;
    // (damping is applied implicitly so the springs stay smooth even at 8-20 fps)
    kpv = (kpv - k * kp * dt) / (1 + c * dt); kp += kpv * dt; kp = clamp(kp, -0.4, 0.4);
    kyv = (kyv - k * ky * dt) / (1 + c * dt); ky += kyv * dt; ky = clamp(ky, -0.3, 0.3);
    dipV = (dipV - 200 * dip * dt) / (1 + 28 * dt); dip += dipV * dt; dip = clamp(dip, -0.35, 0.12);
    hitRollV = (hitRollV - 170 * hitRoll * dt) / (1 + 20 * dt); hitRoll += hitRollV * dt; hitRoll = clamp(hitRoll, -0.25, 0.25);
    const strafeV = (vel.x * cy - vel.z * sy) / WALK; // velocity along camera-right
    roll = damp(roll, P.alive ? clamp(-strafeV, -1.3, 1.3) * 0.032 : 0, 9, dt);
    trauma = Math.max(0, trauma - dt * 1.5);

    // -- fov kick --
    const fovT = sprinting && P.speed > WALK * 1.15 ? 10 : P.speed > WALK * 1.2 ? 4 : 0;
    fovOff = damp(fovOff, fovT, 7, dt);

    if (!P.alive) deathT += dt;
    applyCamera(dt, bobX, bobY, bobRoll, bobPitch);
  };

  return P;
}
