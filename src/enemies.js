// Enemy manager: spawning, pooling, hit detection (per-limb spheres), damage/death/gibs, corpses, projectiles, shockwaves.
// Models live in src/enemies/{models,textures,rig,anim}.js, behaviour in src/enemies/ai.js, tuning in src/enemies/types.js.
import * as THREE from 'three';
import { bus, LAYOUT, clamp, rand, randInt, pick } from './core.js';
import { DEFS, TYPE_NAMES } from './enemies/types.js';
import { CH, acquireRig, releaseRig, getTemplate, setFlash, freezeRig, hideHead, prebuild, shared, poolStats } from './enemies/rig.js';
import { OUTFITS, makeBlobTexture } from './enemies/textures.js';
import { animate, poseDeath, DEATH_DUR } from './enemies/anim.js';
import { createAI } from './enemies/ai.js';
import { createNav } from './enemies/nav.js';

const V3 = THREE.Vector3;
const MAX_CORPSES = 24;
const _a = new V3(), _b = new V3(), _c = new V3(), _ap = new V3(), _d = new V3();
const UP = new V3(0, 1, 0);
const SP = new Float32Array(13 * 4); // hit sphere scratch: x,y,z,r per sphere
const SPART = ['head', 'torso', 'torso', 'torso', 'torso', 'limb', 'limb', 'limb', 'limb', 'limb', 'limb', 'limb', 'limb'];
const SND_LIMIT = { idle: 0.22, step: 0.05, alert: 0.1, attack: 0.09, pain: 0.07, death: 0.04 };
const OPT_TRACER = { style: 'trooper' };
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832; return d; };

export function create(game) {
  const list = [];
  const lastSnd = {};
  const corpses = []; // dead (non-gibbed) enemies in order of death
  let nextId = 1, frame = 0, ready = false;
  const rings = [], shocks = [], spitPool = [];
  let spitTex = null, ringTex = null;
  const SLOTS = 64, freeSlots = [];
  let shadowInst = null, poolInst = null;
  const _m4 = new THREE.Matrix4(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);

  const M = { list, debugFreeze: false };
  const nav = createNav(game);
  const ai = createAI(game, M, nav);
  M.nav = nav;

  // ---------------------------------------------------------------------------------------------- init / assets
  M.init = async () => {
    const t0 = performance.now();
    nav.init(); M.navMs = performance.now() - t0; // needs the station colliders (station.init runs first)
    for (const t of TYPE_NAMES) prebuild(getTemplate(t));
    ready = true;
    ringTex = makeBlobTexture('ring'); spitTex = makeBlobTexture('glow');
    const sh = shared();
    shadowInst = new THREE.InstancedMesh(sh.plane, sh.shadowMat, SLOTS); poolInst = new THREE.InstancedMesh(sh.plane, sh.poolMat, SLOTS);
    for (const im of [shadowInst, poolInst]) { im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; game.scene.add(im); }
    shadowInst.renderOrder = 1; poolInst.renderOrder = 2;
    for (let i = SLOTS - 1; i >= 0; i--) { freeSlots.push(i); shadowInst.setMatrixAt(i, _zero); poolInst.setMatrixAt(i, _zero); }
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: ringTex, color: 0xffb060, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false }));
      m.visible = false; m.position.y = 0.06; m.frustumCulled = false; game.scene.add(m); rings.push({ mesh: m, t: 0, dur: 0.5, r: 8, on: false });
    }
    try { // upload every head / forearm variant geometry now (they were uploaded lazily on first use: a variable amount of GPU-side work in the middle of a wave)
      const r = game.renderer, tmp = new THREE.Scene(), mat = new THREE.MeshBasicMaterial(), rt = new THREE.WebGLRenderTarget(4, 4);
      for (const t of TYPE_NAMES) for (const g of Object.values(getTemplate(t).merged)) { const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.scale.setScalar(1e-4); tmp.add(m); }
      const prev = r.getRenderTarget(); r.setRenderTarget(rt); r.render(tmp, game.camera); r.setRenderTarget(prev); rt.dispose(); mat.dispose();
    } catch (e) { console.warn('[enemies] geometry pre-upload skipped', e); }
    try { // upload textures + compile shaders now so the first spawn of each type does not hitch
      const r = game.renderer, tmp = new THREE.Group();
      for (const t of TYPE_NAMES) { const tpl = getTemplate(t); for (const o of tpl.outfits) r.initTexture(o.map); }
      const probe = acquireRig('shambler', DEFS.shambler, { outfit: 0, head: 0, farm: 0 }); tmp.add(probe.root); probe.root.position.set(0, -50, 0);
      const probe2 = acquireRig('exploder', DEFS.exploder, { outfit: 0, head: 0, farm: 0 }); tmp.add(probe2.root); probe2.root.position.set(0, -50, 0);
      game.scene.add(tmp); r.compile(game.scene, game.camera); game.scene.remove(tmp);
      releaseRig('shambler', probe); releaseRig('exploder', probe2);
    } catch (e) { console.warn('[enemies] precompile skipped', e); }
    ready = true; M.initMs = performance.now() - t0;
  };

  M.reset = () => { M.clear(); nextId = 1; for (const k in lastSnd) delete lastSnd[k]; };
  M.clear = () => {
    for (const e of list) dispose(e);
    list.length = 0; corpses.length = 0; shocks.length = 0;
    if (shadowInst) { freeSlots.length = 0; for (let i = SLOTS - 1; i >= 0; i--) { freeSlots.push(i); shadowInst.setMatrixAt(i, _zero); poolInst.setMatrixAt(i, _zero); } shadowInst.instanceMatrix.needsUpdate = true; poolInst.instanceMatrix.needsUpdate = true; }
    for (const r of rings) { r.on = false; r.mesh.visible = false; }
  };
  M.aliveCount = () => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i].alive) n++; return n; };

  function dispose(e) {
    if (e.slot >= 0 && shadowInst) { shadowInst.setMatrixAt(e.slot, _zero); poolInst.setMatrixAt(e.slot, _zero); shadowInst.instanceMatrix.needsUpdate = true; poolInst.instanceMatrix.needsUpdate = true; freeSlots.push(e.slot); e.slot = -1; }
    if (e.rig) { releaseRig(e.type, e.rig); e.rig = null; }
  }
  function putShadow(e, on) {
    if (e.slot < 0) return;
    if (!on) { shadowInst.setMatrixAt(e.slot, _zero); shadowInst.instanceMatrix.needsUpdate = true; return; }
    const r = e.def.radius * 2.7 * (e.sc / e.def.scale);
    _m4.makeScale(r, 1, r); _m4.setPosition(e.pos.x, e.pos.y + 0.022, e.pos.z); shadowInst.setMatrixAt(e.slot, _m4); shadowInst.instanceMatrix.needsUpdate = true;
  }
  function putPool(e, size) {
    if (e.slot < 0) return;
    _m4.makeRotationY(e.yaw + 1.3); _m4.scale(_d.set(size, 1, size)); _m4.setPosition(e.pos.x, e.pos.y + 0.03, e.pos.z); poolInst.setMatrixAt(e.slot, _m4); poolInst.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------------------------- helpers shared with the AI
  M.sfx = (e, key, force) => {
    const s = e.def.snd?.[key]; const a = game.audio; if (!s || !a) return;
    const now = game.time, nm = s[0];
    if (!force && now - (lastSnd[nm + key] ?? -9) < (SND_LIMIT[key] ?? 0.05)) return;
    lastSnd[nm + key] = now;
    _ap.set(e.pos.x, e.pos.y + e.height * 0.75, e.pos.z);
    a.play(nm, _ap, { volume: s[2], rate: s[1] });
  };
  M.play = (name, x, y, z, volume = 1, rate = 1) => { const a = game.audio; if (!a) return; _ap.set(x, y, z); a.play(name, _ap, { volume, rate }); };
  M.hurtPlayer = (e, dmg, type, src) => {
    const p = game.player; if (!p || !p.alive) return false;
    p.damage(dmg, { from: (src || e.pos).clone(), type });
    return true;
  };
  M.lineOfSight = (e) => {
    const p = game.player; if (!p || !game.combat) return true;
    _a.set(e.pos.x, e.pos.y + e.height * 0.78, e.pos.z); _b.set(p.pos.x, p.pos.y + p.height * 0.75, p.pos.z);
    return game.combat.lineClear(_a, _b);
  };
  M.muzzleWorld = (e, out) => {
    if (e.rig?.muzzle) { e.rig.muzzle.updateWorldMatrix(true, false); return out.setFromMatrixPosition(e.rig.muzzle.matrixWorld); }
    return out.set(e.pos.x, e.pos.y + e.height * 0.8, e.pos.z);
  };

  // hitscan shot at the player from the trooper's rifle: visible tracer + muzzle flash, damage if the ray passes through the player capsule
  M.fireRifle = (e, dmg, spread) => {
    const p = game.player; if (!p) return;
    const o = M.muzzleWorld(e, _c);
    _d.set(p.pos.x, p.pos.y + p.height * 0.62, p.pos.z);
    // light target lead so moving players still get hit sometimes
    _d.x += p.vel.x * 0.08; _d.z += p.vel.z * 0.08;
    _d.sub(o); const dist = _d.length(); _d.multiplyScalar(1 / (dist || 1));
    const sp = spread + dist * 0.0012 + Math.hypot(p.vel.x, p.vel.z) * 0.004;
    _d.x += (rand() - rand()) * sp; _d.y += (rand() - rand()) * sp * 0.7; _d.z += (rand() - rand()) * sp; _d.normalize();
    const origin = _c.clone(), dir = _d.clone();
    const w = game.world.raycast(origin, dir, 90);
    const tw = w ? w.dist : 90;
    // ray vs player's vertical cylinder
    let hit = false, th = 0;
    if (p.alive) {
      const ox = origin.x - p.pos.x, oz = origin.z - p.pos.z, r = p.radius + 0.12;
      const A = dir.x * dir.x + dir.z * dir.z, B = ox * dir.x + oz * dir.z, C = ox * ox + oz * oz - r * r;
      if (A > 1e-6) { const disc = B * B - A * C; if (disc >= 0) { th = (-B - Math.sqrt(disc)) / A; const y = origin.y + dir.y * th; if (th > 0 && th < tw && y > p.pos.y - 0.05 && y < p.pos.y + p.height + 0.05) hit = true; } }
    }
    const end = hit ? _b.copy(origin).addScaledVector(dir, th) : _b.copy(origin).addScaledVector(dir, tw);
    game.vfx?.tracer(origin, end, OPT_TRACER);
    game.vfx?.muzzleFlash(origin, dir, 'trooper');
    M.sfx(e, 'attack', true);
    if (hit) M.hurtPlayer(e, dmg, 'bullet', origin);
    else if (w) { game.vfx?.impact(w.point, w.normal, w.surface); if (Math.random() < 0.35) game.audio?.play('ricochet', w.point); }
    e.kick = 1;
  };

  // spitter acid glob
  function getSpitMesh() {
    let m = spitPool.pop();
    if (!m) {
      m = new THREE.Group();
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), new THREE.MeshBasicMaterial({ color: 0x55ee22 })); core.material.color.multiplyScalar(1.15);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: spitTex, color: 0x33ff11, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5, fog: false }));
      halo.scale.setScalar(0.62); m.add(core, halo); m.userData.core = core;
    }
    m.visible = true; return m;
  }
  M.spit = (e) => {
    const p = game.player; if (!p || !game.projectiles) return;
    M.muzzleWorld(e, _a); _a.set(e.pos.x + Math.sin(e.yaw) * 0.45 * e.sc, e.pos.y + 1.45 * e.sc, e.pos.z + Math.cos(e.yaw) * 0.45 * e.sc);
    const dx = p.pos.x + p.vel.x * 0.25 - _a.x, dz = p.pos.z + p.vel.z * 0.25 - _a.z, dy = p.pos.y + p.height * 0.6 - _a.y;
    const dist = Math.hypot(dx, dz), speed = clamp(12 + dist * 0.5, 13, 20), g = 5.5, tt = Math.max(0.2, dist / speed);
    _d.set(dx / tt, dy / tt + 0.5 * g * tt, dz / tt);
    const spd = _d.length(); _d.multiplyScalar(1 / spd);
    const mesh = getSpitMesh();
    game.projectiles.spawn({
      mesh, pos: _a, dir: _d, speed: spd, radius: 0.22, gravity: g, life: 4, owner: 'enemy', data: { t: 0 },
      onUpdate(pr, dt) { pr.data.t += dt; if (pr.data.t > 0.03) { pr.data.t = 0; game.vfx?.trail(pr.pos, 'spit'); } const s = 1 + Math.sin(pr.age * 22) * 0.15; mesh.userData.core.scale.setScalar(s); },
      onHit(pr, hit) {
        if (hit.kind === 'player') M.hurtPlayer(e, 25, 'spit', pr.pos);
        else if (p.alive) { const d = Math.hypot(hit.point.x - p.pos.x, hit.point.z - p.pos.z, (hit.point.y - p.pos.y - 0.8) * 0.6); if (d < 1.7) M.hurtPlayer(e, 12, 'spit', pr.pos); }
        splat(hit.point, hit.normal); spitPool.push(mesh); mesh.visible = false;
      },
      onExpire(pr) { splat(pr.pos, UP); spitPool.push(mesh); mesh.visible = false; },
    });
    M.sfx(e, 'attack', true); game.audio?.play('spit', _a);
    e.kick = 1;
  };
  function splat(pt, n) {
    const v = game.vfx; if (!v) return;
    v.impact(pt, n, 'concrete');
    for (let i = 0; i < 7; i++) { _b.set(pt.x + (Math.random() - 0.5) * 0.8, pt.y + Math.random() * 0.4, pt.z + (Math.random() - 0.5) * 0.8); v.trail(_b, 'spit'); }
    v.light(pt, 0x66ff33, 2.2, 0.25, 7);
    game.audio?.play('spitHit', pt);
  }

  // tyrant stomp: visual ring now, damage arrives with the expanding front (jump to avoid it)
  M.shockwave = (e, s) => {
    const r = rings.find((q) => !q.on) || rings[0];
    r.on = true; r.t = 0; r.dur = 0.55; r.r = s.radius; r.mesh.position.set(e.pos.x, 0.06, e.pos.z); r.mesh.visible = true; r.mesh.material.opacity = 0.9;
    shocks.push({ x: e.pos.x, z: e.pos.z, t: 0, radius: s.radius, dmg: s.dmg, hit: false, e });
    game.vfx?.light(e.pos, 0xffc080, 2.2, 0.3, 14);
    for (let i = 0; i < 5; i++) { const a = i / 5 * 6.283; _b.set(e.pos.x + Math.cos(a) * 1.6, 0.02, e.pos.z + Math.sin(a) * 1.6); game.vfx?.impact(_b, UP, 'concrete'); }
    game.player?.shake(clamp(1.1 * (1 - Math.hypot(e.pos.x - game.player.pos.x, e.pos.z - game.player.pos.z) / 30), 0.1, 1.2));
    game.audio?.play('explosion', e.pos, { volume: 0.6, rate: 0.6 });
  };

  // exploder burst: it dies, gibs and detonates
  M.burst = (e) => {
    if (!e.alive) return;
    kill(e, { type: 'explosion', source: 'enemy', point: _a.set(e.pos.x, e.pos.y + e.height * 0.55, e.pos.z), dir: UP, self: true }, 9999);
  };

  // ---------------------------------------------------------------------------------------------- spawn
  M.spawn = (type, pos, opts = {}) => {
    const def = DEFS[type] || DEFS.shambler; if (!DEFS[type]) type = 'shambler';
    const outfits = OUTFITS[type].length;
    const variant = { outfit: randInt(0, outfits - 1), head: randInt(0, 7), farm: randInt(0, 7) };
    if (type === 'shambler' || type === 'runner') { // hooded head variant (index 3) only goes with the hoodie outfit
      const hoodie = variant.outfit === 2; variant.head = hoodie && Math.random() < 0.7 ? 3 : variant.head % 3;
    }
    const rig = acquireRig(type, def, variant);
    const vari = 0.94 + Math.random() * 0.13;
    const hpMul = opts.hpMul ?? 1, speedMul = opts.speedMul ?? 1;
    const e = {
      id: nextId++, type, def, rig, mesh: rig.root, pos: new V3(pos.x, pos.y || 0, pos.z), vel: new V3(),
      sc: def.scale * vari, radius: def.radius * (def.mass >= 3 ? 1 : vari), height: def.height * vari, // big enemies keep a fixed radius so the nav grid can size their path
      hp: def.hp * hpMul, maxHp: def.hp * hpMul, alive: true,
      speedMul, speed: def.speed * speedMul * (0.93 + Math.random() * 0.14), seed: Math.random(),
      yaw: Math.random() * 6.283, state: 'chase', t: 0, dur: 0, atk: null, cool: rand(0.3, 1.2), painCd: 0, flash: 0, react: 0, reactSide: 1,
      P: new Float32Array(CH.N), hl: new V3(0, -0.4, 0.2), hr: new V3(0, -0.4, 0.2), phase: Math.random() * 6.283, speedNow: 0, animT: Math.random() * 20, lookRel: 0, lean: 0,
      hunch: (Math.random() - 0.3) * 0.14, hasTarget: true, kx: 0, kz: 0, wx: 0, wz: 0, sepx: 0, sepz: 0, noclip: false, faceYaw: 0, avx: 0, avz: 0, whisk: Math.random() * 0.2, side: Math.random() < 0.5 ? -1 : 1,
      idleT: rand(1.5, 6), stepAcc: 0, kick: 0, animAcc: 0, dist: 99, bearing: 0, los: true, losT: 0, strafe: Math.random() < 0.5 ? -1 : 1, strafeT: rand(1, 3), chargeCd: rand(2, 5), next: 'claw',
      corner: 0, cornerT: 0, stuckT: 0, lastX: pos.x, lastZ: pos.z, stuckChk: 0, primeGlow: 0, hitGrace: 0, dkind: 'back', dtime: 0, ddur: 1, dside: 1, deadT: 0, sink: 0, poolR: def.radius / def.scale * 3.6, poolDone: false, born: game.time,
    };
    e.P[CH.HX] = def.anim.hipLean; e.P[CH.SX] = def.anim.spine;
    e.slot = freeSlots.length ? freeSlots.pop() : -1;
    if (opts.emerge) {
      const s = e.pos.z >= 0 ? 1 : -1; e.pos.z += s * 1.2; e.noclip = true; e.state = 'emerge'; e.emergeDir = -s; e.yaw = e.emergeDir > 0 ? 0 : Math.PI;
      e.t = 0; e.dur = 3.2;
    } else { e.state = 'chase'; }
    e.faceYaw = e.yaw;
    rig.root.position.copy(e.pos); rig.root.rotation.set(0, e.yaw, 0); rig.root.scale.setScalar(e.sc);
    game.scene.add(rig.root);
    list.push(e);
    e.alertT = rand(0.1, 0.7); e.alerted = false;
    bus.emit('enemy:spawn', { enemy: e });
    return e;
  };

  // ---------------------------------------------------------------------------------------------- hit detection
  // Fill SP with the enemy's hit spheres in world space. Returns the count.
  function spheres(e) {
    const D = e.rig.D, h = e.def.hit, sc = e.sc, P = e.P, Lr = P[CH.HX] + P[CH.SX], cl = Math.cos(Lr), sl = Math.sin(Lr);
    const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
    const oy = D.hipY + P[CH.HY] + D.waist * 0.9;
    const put = (i, x, y, z, r) => { // spine-space point -> world
      const yy = y * cl - z * sl + oy, zz = y * sl + z * cl;
      SP[i * 4] = e.pos.x + (x * cy + zz * sy) * sc; SP[i * 4 + 1] = e.pos.y + yy * sc; SP[i * 4 + 2] = e.pos.z + (-x * sy + zz * cy) * sc; SP[i * 4 + 3] = r * sc;
    };
    const putL = (i, x, y, z, r) => { SP[i * 4] = e.pos.x + (x * cy + z * sy) * sc; SP[i * 4 + 1] = e.pos.y + y * sc; SP[i * 4 + 2] = e.pos.z + (-x * sy + z * cy) * sc; SP[i * 4 + 3] = r * sc; };
    const T = D.torso;
    put(0, 0, T + D.headY, 0.02, h.head);
    put(1, 0, T * 0.2, 0.0, h.torso); put(2, 0, T * 0.55, 0.0, h.torso); put(3, 0, T * 0.9, 0.0, h.torso * 0.95);
    if (h.belly) put(4, 0, h.belly[0], h.belly[1], h.belly[2]); else put(4, 0, T * 0.4, 0, h.torso * 0.6);
    const hl = e.hl, hr = e.hr, hy = D.shY;
    put(5, D.shX + hl.x * 0.5, hy + hl.y * 0.5, hl.z * 0.5, h.arm); put(6, D.shX + hl.x, hy + hl.y, hl.z, h.arm);
    put(7, -D.shX + hr.x * 0.5, hy + hr.y * 0.5, hr.z * 0.5, h.arm); put(8, -D.shX + hr.x, hy + hr.y, hr.z, h.arm);
    const hipY = D.hipY + P[CH.HY];
    putL(9, D.hipX, hipY - D.thigh * 0.5, 0, h.thigh); putL(10, -D.hipX, hipY - D.thigh * 0.5, 0, h.thigh);
    putL(11, D.hipX, hipY - D.thigh - D.shin * 0.5, 0, h.shin); putL(12, -D.hipX, hipY - D.thigh - D.shin * 0.5, 0, h.shin);
  }
  // enemy centre from the sphere set (for gibs / aim points)
  M.chest = (e, out) => { spheres(e); return out.set(SP[8], SP[9], SP[10]); };
  M.head = (e, out) => { spheres(e); return out.set(SP[0], SP[1], SP[2]); };

  M.raycast = (origin, dir, maxDist = 100, extraRadius = 0) => {
    let best = null, bestT = maxDist, bi = -1;
    const ox = origin.x, oy = origin.y, oz = origin.z, dx = dir.x, dy = dir.y, dz = dir.z;
    for (let n = 0; n < list.length; n++) {
      const e = list[n]; if (!e.alive) continue;
      // broad phase: bounding sphere around the body
      const bx = e.pos.x - ox, by = e.pos.y + e.height * 0.5 - oy, bz = e.pos.z - oz;
      const R = e.height * 0.5 + 0.6 * e.sc + extraRadius, bb = bx * dx + by * dy + bz * dz;
      if (bb + R < 0 || bb - R > bestT) continue;
      const d2 = bx * bx + by * by + bz * bz - bb * bb; if (d2 > R * R) continue;
      spheres(e);
      for (let i = 0; i < 13; i++) {
        const r = SP[i * 4 + 3] + extraRadius; if (r <= 0) continue;
        const cx = SP[i * 4] - ox, cy = SP[i * 4 + 1] - oy, cz = SP[i * 4 + 2] - oz;
        const b = cx * dx + cy * dy + cz * dz; if (b + r < 0) continue;
        const c2 = cx * cx + cy * cy + cz * cz - r * r; const disc = b * b - c2; if (disc < 0) continue;
        let t = b - Math.sqrt(disc); if (t < 0) t = 0;
        if (t < bestT) { bestT = t; best = e; bi = i; _a.set(SP[i * 4], SP[i * 4 + 1], SP[i * 4 + 2]); }
      }
    }
    if (!best) return null;
    const point = new V3(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT);
    const normal = point.clone().sub(_a); if (normal.lengthSq() < 1e-8) normal.copy(dir).negate(); normal.normalize();
    return { enemy: best, dist: bestT, point, normal, part: SPART[bi] };
  };

  // ---------------------------------------------------------------------------------------------- damage / death
  M.damage = (e, amount, o = {}) => {
    if (!e || !e.alive) return false;
    const type = o.type || 'bullet', source = o.source || 'player';
    if (source === 'enemy' && amount >= 1e5) { quietRemove(e, o); return true; }
    const part = o.part || 'torso';
    let dmg = amount * (part === 'head' ? 2 : 1);
    if (source === 'enemy' && type === 'explosion') dmg *= e.type === 'exploder' ? 1 : 0.6; // enemy blasts hurt other enemies a little less
    e.hp -= dmg;
    const killed = e.hp <= 0;
    bus.emit('enemy:hit', { enemy: e, amount: dmg, part, killed, source, type });
    // feedback
    e.flash = 0.075;
    if (game.vfx) {
      const pt = o.point || M.chest(e, _a);
      _d.copy(o.dir || UP);
      game.vfx.blood(pt, _d, clamp(dmg / 25, 0.3, 2.6));
    }
    if (game.audio && (type === 'bullet' || type === 'shotgun' || type === 'plasma' || type === 'saw' || type === 'fist' || type === 'melee') && game.time - (e.lastFleshSnd ?? -9) > 0.07) { e.lastFleshSnd = game.time; const q = o.point || e.pos; _ap.set(q.x, q.y, q.z); game.audio.play('impactFlesh', _ap, { volume: killed ? 1 : 0.7 }); }
    const dir = o.dir;
    // knockback (horizontal)
    let knock = o.knock ?? 0;
    if (type === 'bullet' || type === 'shotgun') knock += Math.min(4, dmg * 0.05) * (type === 'shotgun' ? 1.6 : 1);
    else if (type === 'plasma') knock += 0.4; else if (type === 'saw') knock += Math.min(1.2, 0.3 + dmg * 0.02); else if (type === 'fist' || type === 'melee') knock += Math.min(5, 1 + dmg * 0.08);
    if (knock > 0 && dir) {
      const hl = Math.hypot(dir.x, dir.z) || 1, k = knock / (e.def.knockRes * (e.def.mass > 3 ? 1.5 : 1));
      e.kx += dir.x / hl * k; e.kz += dir.z / hl * k;
    }
    if (killed) { kill(e, o, dmg); return true; }
    // pain
    e.react = Math.max(e.react, 0.6); e.reactSide = Math.random() < 0.5 ? -1 : 1;
    const d = e.def, st = e.state;
    if (d.pain > 0 && e.painCd <= 0 && (st === 'chase' || st === 'windup' || st === 'aim' || st === 'recover' || st === 'emerge') && Math.random() < d.pain * clamp(0.3 + dmg / 18, 0, 1)) {
      if (st === 'emerge') { e.react = 1; }
      else {
        ai.setState(e, 'stagger', d.painTime * rand(0.8, 1.2)); e.atk = null; e.painCd = 0.5 + d.painTime; e.cool = Math.max(e.cool, 0.35);
        e.react = 1; M.sfx(e, 'pain');
      }
    } else if (Math.random() < 0.25) M.sfx(e, 'pain');
    return false;
  };

  function quietRemove(e, o) {
    e.alive = false; e.hp = -1e6; e.state = 'gone'; e.deadT = 0; e.rig.root.visible = false; putShadow(e, false);
    bus.emit('enemy:killed', { enemy: e, gibbed: false, type: e.type, source: 'enemy', point: e.pos.clone() });
  }

  function kill(e, o, dmg) {
    e.alive = false;
    const type = o.type || 'bullet';
    const gib = e.type === 'exploder' || type === 'explosion' || type === 'bfg' || (type === 'shotgun' && (o.dist ?? 99) < 4.2) || (type === 'saw' && Math.random() < 0.6) || e.hp <= -e.maxHp * 0.5;
    const pt = new V3().copy(o.point || M.chest(e, _b));
    bus.emit('enemy:killed', { enemy: e, gibbed: gib, type: e.type, source: o.source || 'player', point: pt });
    e.vel.set(0, 0, 0);
    if (e.type === 'exploder') {
      const c = M.chest(e, _c);
      game.combat?.explosion(c, e.def.burst.radius, e.def.burst.dmg, { owner: o.source === 'player' ? 'player' : 'enemy', kind: 'exploder', selfScale: 1 }); // shot exploders credit their chain kills to the player, full blast damage either way
      game.audio?.play('exploderBurst', c);
    }
    if (gib) {
      const c = M.chest(e, _c), amount = e.type === 'tyrant' ? 4.5 : e.type === 'brute' ? 2.8 : e.type === 'exploder' ? 2.2 : 1;
      _d.copy(o.dir || UP);
      game.vfx?.gib(c, _d, amount);
      if (e.type !== 'exploder') game.audio?.play('gib', c);
      e.state = 'gone'; e.deadT = 0; e.rig.root.visible = false; e.ddur = 0.05; putShadow(e, false);
      return;
    }
    // ---- ragdoll-ish death animation
    M.sfx(e, 'death', true);
    const f = _c.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)), dir = o.dir;
    const fromFront = dir ? (dir.x * f.x + dir.z * f.z) < 0 : true;
    const big = e.def.mass >= 3;
    e.dkind = big ? (Math.random() < 0.7 ? 'crumple' : 'back') : Math.random() < 0.18 ? 'crumple' : fromFront ? 'back' : 'front';
    if (e.state === 'windup' || e.state === 'strike') e.dkind = Math.random() < 0.5 ? 'crumple' : e.dkind;
    e.dside = Math.random() < 0.5 ? -1 : 1; e.dtime = 0; e.ddur = DEATH_DUR[e.dkind] * rand(0.9, 1.15) * (big ? 1.5 : 1);
    e.state = 'dying'; e.atk = null; e.hasTarget = false;
    if (dir) { const hl = Math.hypot(dir.x, dir.z) || 1; e.kx += dir.x / hl * 1.6; e.kz += dir.z / hl * 1.6; }
    // decapitation on strong headshots
    if (o.part === 'head' && (dmg >= 30 || Math.random() < 0.3) && e.type !== 'brute' && e.type !== 'tyrant') {
      hideHead(e.rig); M.head(e, _c); _d.copy(o.dir || UP);
      game.vfx?.gib(_c, _d, 0.45); game.vfx?.blood(_c, _d, 2.4);
    }
    if (o.dir && (type === 'shotgun' || type === 'explosion')) game.vfx?.blood(M.chest(e, _c), o.dir, 1.5);
  }

  function growPool(e) {
    const pk = clamp((e.dtime - e.ddur * 0.35) / 3.0, 0, 1);
    if (pk > 0 && (pk < 1 || !e.poolDone)) { putPool(e, e.poolR * e.sc * (0.2 + 0.8 * pk * (2 - pk))); if (pk >= 1) e.poolDone = true; }
  }

  // ---------------------------------------------------------------------------------------------- movement integration
  const world = () => game.world;
  function integrate(e, dt) {
    const a = 1 - Math.exp(-e.def.accel * dt);
    e.vel.x += (e.wx - e.vel.x) * a; e.vel.z += (e.wz - e.vel.z) * a;
    const ox = e.pos.x, oz = e.pos.z;
    const dx = (e.vel.x + e.kx + e.sepx) * dt, dz = (e.vel.z + e.kz + e.sepz) * dt;
    const kd = Math.exp(-4.5 * dt); e.kx *= kd; e.kz *= kd;
    if (!e.noclip) {
      // fast movers (charges, knockback, big frame times) advance in <= 0.2 m sub-steps so they cannot skip through the 0.4 m edge barrier
      const n = Math.min(8, Math.ceil(Math.hypot(dx, dz) / 0.2)) || 1;
      for (let i = 0; i < n; i++) { e.pos.x += dx / n; e.pos.z += dz / n; world().collide(e.pos, e.radius, e.height); }
      const lz = LAYOUT.platform.halfW - e.radius * 0.9, lx = LAYOUT.platform.x1 - e.radius * 0.9; // the platform is closed: never let a centre end up past the edge barrier / end wall
      if (e.pos.z > lz || e.pos.z < -lz) { e.pos.z = clamp(e.pos.z, -lz, lz); e.kz = 0; }
      if (e.pos.x > lx || e.pos.x < -lx) { e.pos.x = clamp(e.pos.x, -lx, lx); e.kx = 0; }
      const gy = world().groundAt(e.pos.x, e.pos.z, e.pos.y, 0.5);
      if (gy > -900) e.pos.y += (gy - e.pos.y) * Math.min(1, dt * 14);
    } else { e.pos.x += dx; e.pos.z += dz; }
    const mx = e.pos.x - ox, mz = e.pos.z - oz;
    const sp = Math.hypot(mx, mz) / Math.max(dt, 1e-4);
    e.speedNow += (Math.min(sp, e.speed * 2.5) - e.speedNow) * Math.min(1, dt * 10);
    // turn toward faceYaw
    const rate = (e.turnMul ?? 1) * e.def.turn;
    const dy = angDiff(e.faceYaw, e.yaw), step = rate * dt;
    e.yaw += Math.abs(dy) < step ? dy : Math.sign(dy) * step;
    if (e.yaw > 6.2832) e.yaw -= 6.2832; else if (e.yaw < 0) e.yaw += 6.2832;
  }
  M.integrate = integrate;

  // ---------------------------------------------------------------------------------------------- update
  M.update = (dt) => {
    if (!ready) return;
    frame++;
    const cam = game.camera.position, cme = game.camera.matrixWorld.elements;
    let fx = -cme[8], fz = -cme[10]; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    ai.begin(dt);
    // separation (soft push apart)
    const n = list.length;
    for (let i = 0; i < n; i++) { list[i].sepx = 0; list[i].sepz = 0; }
    for (let i = 0; i < n; i++) {
      const A = list[i]; if (!A.alive || A.noclip) continue;
      for (let j = i + 1; j < n; j++) {
        const B = list[j]; if (!B.alive || B.noclip) continue;
        const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z, rr = (A.radius + B.radius) * 0.92;
        if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
        const d2 = dx * dx + dz * dz; if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.001, pen = (rr - d) / rr, nx = dx / d, nz = dz / d;
        const wa = B.def.mass / (A.def.mass + B.def.mass), wb = 1 - wa, push = pen * 4.2;
        A.sepx -= nx * push * wa * 2; A.sepz -= nz * push * wa * 2; B.sepx += nx * push * wb * 2; B.sepz += nz * push * wb * 2;
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i], rig = e.rig;
      try {
      if (e.state === 'gone') { e.deadT += dt; if (e.deadT > 0.1) { dispose(e); list.splice(i, 1); } continue; }
      if (e.alive) {
        if (!M.debugFreeze) ai.think(e, dt); else { e.wx = e.wz = 0; }
        if (!e.alive) { rig.root.position.set(e.pos.x, e.pos.y, e.pos.z); continue; } // died during its own think (exploder burst)
        integrate(e, dt);
        // flash / glow
        if (e.flash > 0) { e.flash -= dt; setFlash(rig, e.flash > 0); }
        ai.glow(e, dt);
        const cdx = e.pos.x - cam.x, cdz = e.pos.z - cam.z, cd2 = cdx * cdx + cdz * cdz;
        // animation LOD: far away or well outside the view cone -> pose only every 3rd/4th frame (the damped pose catches up when they re-enter view)
        const step = cd2 > 2500 ? 3 : cd2 > 20 && (cdx * fx + cdz * fz) < 0.2 * Math.sqrt(cd2) ? 4 : 1;
        if (step > 1) { e.animAcc += dt; if ((frame + e.id) % step === 0) { animate(e, e.animAcc); e.animAcc = 0; } }
        else { animate(e, dt + e.animAcc); e.animAcc = 0; }
        e.kick *= Math.exp(-14 * dt);
        putShadow(e, true);
      } else if (e.state === 'dying') {
        // slide with knockback, fall
        e.pos.x += e.kx * dt; e.pos.z += e.kz * dt; const kd = Math.exp(-5 * dt); e.kx *= kd; e.kz *= kd;
        world().collide(e.pos, e.radius * 0.7, 0.6);
        if (e.flash > 0) { e.flash -= dt; setFlash(rig, e.flash > 0); }
        e.speedNow *= 0.9; rig.glow.color.multiplyScalar(Math.exp(-2.5 * dt));
        const done = poseDeath(e, dt);
        growPool(e);
        if (done) { e.state = 'dead'; e.deadT = 0; corpses.push(e); putShadow(e, false); setFlash(rig, false); if (corpses.length > MAX_CORPSES) { const old = corpses.shift(); old.sink = 0.001; old.sinking = true; freezeRig(old.rig, false); } }
      } else if (e.state === 'dead') {
        e.deadT += dt; e.dtime += dt; growPool(e);
        if (e.sinking) { e.sink += dt * 0.6; rig.root.position.y = e.pos.y - e.sink * 1.4; if (e.sink >= 1) { dispose(e); list.splice(i, 1); continue; } }
        else if (e.deadT < 0.05) freezeRig(rig, true);
      }
      rig.root.position.set(e.pos.x, e.sinking ? rig.root.position.y : e.pos.y, e.pos.z); rig.root.rotation.y = e.yaw; rig.root.scale.setScalar(e.sc);
      } catch (err) { // never let one broken enemy take the whole game loop down
        if (!M.errored) { M.errored = true; console.error('[enemies] update failed, removing enemy', e.type, err); }
        try { if (e.alive) quietRemove(e); dispose(e); } catch (e2) { /* ignore */ }
        list.splice(i, 1);
      }
    }
    // shockwave rings + delayed shock damage
    for (const r of rings) if (r.on) {
      r.t += dt; const u = r.t / r.dur; if (u >= 1) { r.on = false; r.mesh.visible = false; continue; }
      const k = 1 - (1 - u) * (1 - u), s = 1 + k * r.r * 2; r.mesh.scale.set(s, 1, s); r.mesh.material.opacity = 0.9 * (1 - u);
    }
    for (let i = shocks.length - 1; i >= 0; i--) {
      const s = shocks[i]; s.t += dt; const front = s.t * 24, p = game.player;
      if (!s.hit && p && p.alive) {
        const d = Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
        if (front >= d && d < s.radius) { s.hit = true; if (p.pos.y < 0.35 && p.grounded !== false) { const k = 1 - d / s.radius * 0.6; M.hurtPlayer(s.e, s.dmg * k, 'shockwave', _a.set(s.x, 0, s.z)); _b.set(p.pos.x - s.x, 0.25, p.pos.z - s.z).normalize().multiplyScalar(7 * k); p.impulse(_b); } }
      }
      if (s.t > s.radius / 24 + 0.1) shocks.splice(i, 1);
    }
  };

  // debug: current hit spheres as [x, y, z, r, part]
  M.debugSpheres = (e) => { spheres(e); const o = []; for (let i = 0; i < 13; i++) o.push([SP[i * 4], SP[i * 4 + 1], SP[i * 4 + 2], SP[i * 4 + 3], SPART[i]]); return o; };
  // quiet removal (no death animation / gibs, still emits enemy:killed so wave bookkeeping stays consistent)
  M.remove = (e) => { if (e && e.alive) quietRemove(e); };
  M.debugList = () => list.map((e) => `${e.id}:${e.type}:${e.state}`);
  M.poolStats = poolStats; // idle rigs per type (tests: rig pool growth is bounded by peak concurrency)
  return M;
}
