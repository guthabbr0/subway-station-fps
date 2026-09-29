// Wave director: drives the whole game loop.
//   wave 1: shamblers already on the platform -> clear -> supply drop -> breather -> train arrives (alternating tracks)
//   -> doors open -> staggered exits -> fight -> clear -> train departs -> next wave ...
// Everything timer-based runs off the dt passed to update() (main.js does not call update while paused), and every
// asynchronous callback (train promises) only flips a flag that update() consumes, guarded by a token so a reset()/debugStart()
// can never leak a stale callback into the new run.
import { bus, clamp, rand } from './core.js';

// ---- balance (pure functions, exported so they can be unit-tested outside the browser) ------------------------------------
export const POINTS = { shambler: 100, runner: 150, trooper: 200, spitter: 250, exploder: 250, brute: 800, tyrant: 5000 };
export const HEAD_BONUS = { shambler: 50, runner: 75, trooper: 100, spitter: 100, exploder: 50, brute: 200, tyrant: 500 };
const UNLOCK = { runner: 2, trooper: 3, spitter: 4, exploder: 4, brute: 5 };

export const waveCount = (n) => (n <= 1 ? 5 : 4 + Math.round(2.2 * n));
export const hpMulFor = (n) => 1 + 0.08 * (n - 1);
export const speedMulFor = (n) => Math.min(1.5, 1 + 0.03 * (n - 1));
export const hordeChance = (n) => (n < 6 ? 0 : Math.min(0.4, 0.2 + 0.025 * (n - 6)));
export const isBossWave = (n) => n >= 10 && n % 5 === 0;

function typeWeights(n) {
  const w = { shambler: Math.max(3, 9 - 0.4 * n) };
  if (n >= 2) w.runner = 2.5 + Math.min(n - 2, 8) * 0.5;
  if (n >= 3) w.trooper = 1.5 + Math.min(n - 3, 8) * 0.45;
  if (n >= 4) { w.spitter = 1.2 + Math.min(n - 4, 8) * 0.35; w.exploder = 1.0 + Math.min(n - 4, 8) * 0.3; }
  return w;
}
function pickWeighted(w, rnd) {
  let sum = 0; for (const k in w) sum += w[k];
  let r = rnd() * sum;
  for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return 'shambler';
}
function shuffle(a, rnd = Math.random) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
// One wave's worth of regular enemies (no boss). Brutes are rare and capped at floor(wave/4).
function group(n, count, rnd) {
  const w = typeWeights(n);
  let brutes = 0;
  if (n >= 5) {
    const slots = Math.floor(n / 4);
    for (let i = 0; i < slots; i++) if (rnd() < (i === 0 ? 0.85 : 0.5)) brutes++;
    if (n === 5) brutes = 1; // first appearance is guaranteed so the player meets it
  }
  brutes = Math.min(brutes, Math.max(0, count - 3));
  const out = [];
  for (let i = 0; i < count - brutes; i++) out.push(pickWeighted(w, rnd));
  // make sure a newly unlocked type actually shows up on its first wave
  for (const t in UNLOCK) {
    if (UNLOCK[t] !== n || t === 'brute') continue;
    let have = 0; for (const x of out) if (x === t) have++;
    for (; have < 2; have++) { const i = out.indexOf('shambler'); if (i < 0) break; out[i] = t; }
  }
  for (let i = 0; i < brutes; i++) out.push('brute');
  return out;
}

// -> {types: string[] in spawn order, hpMul, speedMul, horde, boss}
export function planWave(n, opts = {}) {
  const rnd = opts.rnd || Math.random;
  const hpMul = hpMulFor(n), speedMul = speedMulFor(n);
  if (n <= 1) return { types: ['shambler', 'shambler', 'shambler', 'shambler', 'shambler'], hpMul, speedMul, horde: false, boss: false };
  const base = waveCount(n);
  const horde = !!opts.horde && n >= 6;
  let types = group(n, base, rnd);
  if (horde) types = types.concat(group(n, base, rnd)); // "2 waves' worth at once"
  shuffle(types, rnd);
  if (horde && types.length > Math.max(60, base + 8)) types.length = Math.max(60, base + 8); // late-game horde: keep the queue sane (alive cap is enforced while spawning); never smaller than a normal wave
  const boss = isBossWave(n);
  if (boss) {
    const tyrants = 1 + Math.floor((n - 10) / 20);
    const escortN = Math.min(6, 2 + Math.floor(n / 10));
    const chunk = [];
    for (let i = 0; i < escortN; i++) chunk.push(i % 2 === 1 ? 'brute' : 'trooper'); // escort walks out first
    for (let i = 0; i < tyrants; i++) chunk.push('tyrant');
    types.splice(Math.floor(types.length * 0.35), 0, ...chunk);
  }
  return { types, hpMul, speedMul, horde, boss };
}

// ---- timing constants ------------------------------------------------------------------------------------------------------
const BREATHER = 6;          // seconds between "wave cleared" and the next wave
const INTRO_DELAY = 1.6;     // wave 1: banner shows before the platform zombies appear
const MAX_ALIVE = 36;        // spawn queue pauses above this many living enemies (rig budget is ~40)
const ARRIVE_TIMEOUT = 45;   // give up waiting for train.arrive() after this many seconds and spawn anyway
const DEPART_TIMEOUT = 40;   // give up waiting for the train to leave and hard-reset it
const BUSY = { busy: true };

export function create(game) {
  const W = { wave: 0, kills: 0, score: 0, state: 'idle', total: 0, timer: 0, track: 'A', horde: false, boss: false, log: [] };
  let token = 0, dead = false, T = 0;
  let queue = [], qi = 0, hpMul = 1, speedMul = 1, platformMode = false, pts = [], ptsI = 0;
  let tracked = [], alive = 0;
  let spawnClock = 0, doorCursor = 0, busyWait = 0;
  let arrived = false, trainT = 0, departing = false, pendingDepart = false, interT = 0, lastHorde = false, departAt = -1, departedAt = -1;
  let wdT = 0, culling = false, lastKill = null;
  const heads = new WeakSet();

  Object.defineProperty(W, 'remaining', { get: () => Math.max(0, queue.length - qi) + alive, configurable: true });
  Object.defineProperty(W, 'alive', { get: () => alive, configurable: true });
  Object.defineProperty(W, 'spawned', { get: () => qi, configurable: true });

  const setState = (s) => {
    if (W.state === s) return;
    W.state = s; W.log.push({ t: +T.toFixed(2), wave: W.wave, state: s }); if (W.log.length > 300) W.log.shift();
  };
  const banner = (t, s, secs) => { try { game.hud?.banner?.(t, s, secs); } catch (e) { console.warn('[waves] banner', e); } };
  const sfx = (n) => { try { game.audio?.play?.(n); } catch (e) { /* audio is optional */ } };
  const trainAway = () => { const tr = game.train; return !tr || !tr.state || tr.state === 'away'; };

  // ---- housekeeping ----------------------------------------------------------------------------------------------------------
  function hardReset() {
    token++;
    queue = []; qi = 0; tracked = []; alive = 0; pts = []; ptsI = 0;
    arrived = false; departing = false; pendingDepart = false; trainT = 0; interT = 0; spawnClock = 0; busyWait = 0; wdT = 0; departAt = departedAt = -1;
    W.timer = 0; W.total = 0; W.horde = false; W.boss = false;
    try { if (game.enemies?.list?.length || tracked.length) game.enemies?.clear?.(); } catch (e) { console.warn('[waves] enemies.clear', e); }
    try { if (game.train && game.train.state && game.train.state !== 'away') game.train.reset?.(); } catch (e) { console.warn('[waves] train.reset', e); }
    setState('idle');
  }

  function countAlive() {
    let w = 0;
    for (let i = 0; i < tracked.length; i++) { const e = tracked[i]; if (e && e.alive && !e._cull) tracked[w++] = e; }
    tracked.length = w; alive = w;
  }

  // ---- wave start ------------------------------------------------------------------------------------------------------------
  function beginWave(n, opts = {}) {
    token++;
    const plan = planWave(n, { horde: n >= 6 && !isBossWave(n) && !lastHorde && Math.random() < hordeChance(n) });
    lastHorde = plan.horde;
    queue = plan.types; qi = 0; hpMul = plan.hpMul; speedMul = plan.speedMul;
    W.wave = n; W.total = queue.length; W.horde = plan.horde; W.boss = plan.boss;
    tracked.length = 0; alive = 0; arrived = false; trainT = 0; spawnClock = 0; busyWait = 0; departing = false; pendingDepart = false;
    platformMode = n === 1 || !!opts.platform;
    bus.emit('wave:start', { wave: n, total: W.total });
    sfx('waveStart');
    const note = plan.boss ? 'BOSS INBOUND' : plan.horde ? 'HEAVY LOAD' : '';
    if (platformMode) {
      choosePlatformPoints(); spawnClock = INTRO_DELAY; setState('spawning');
      banner(`WAVE ${n}`, n === 1 ? 'SURVIVE THE STATION' : 'HOSTILES ON THE PLATFORM', 3);
    } else {
      W.track = n % 2 === 0 ? 'A' : 'B';
      setState('trainIn');
      banner('TRAIN ARRIVING', `WAVE ${n} · PLATFORM ${W.track}${note ? ' · ' + note : ''}`, 3.4);
      requestArrival();
    }
  }

  function requestArrival() {
    const tr = game.train, my = token;
    if (!tr || typeof tr.arrive !== 'function') { arrived = true; return; }
    let p;
    try { p = tr.arrive(W.track); } catch (e) { console.warn('[waves] train.arrive threw', e); arrived = true; return; }
    Promise.resolve(p).then(() => { if (token === my) arrived = true; }, (e) => { console.warn('[waves] train.arrive failed', e); if (token === my) arrived = true; });
  }

  function onDoorsOpen() {
    setState('spawning'); spawnClock = 0.7; busyWait = 0;
    banner(`WAVE ${W.wave}`, W.boss ? 'THE TYRANT STEPS OFF' : `DOORS OPEN · ${W.total} HOSTILES`, 2.4);
  }

  // Wave-1 spawn spots: prefer station.spawnPoints that are far from the player; top up / synthesize if the station provides too few.
  function choosePlatformPoints() {
    const sp = (game.station?.spawnPoints || []).slice(), p = game.player?.pos, T3 = game.THREE;
    const dist = (v) => (p ? Math.hypot(v.x - p.x, v.z - p.z) : 99);
    let pool = sp.filter((v) => dist(v) >= 9);
    if (pool.length < 5) {
      const rest = sp.filter((v) => dist(v) >= 6 && !pool.includes(v)).sort((a, b) => dist(b) - dist(a));
      pool = pool.concat(rest.slice(0, 5 - pool.length));
    }
    for (let tries = 0; pool.length < 5 && tries < 60; tries++) { // synthesize: random floor points at least 10 m from the player
      const v = new T3.Vector3(rand(-28, 28), 0, rand(-3.6, 3.6));
      if (dist(v) < 10) continue;
      game.world?.collide?.(v, 0.5, 1.8); // nudge out of columns / props
      pool.push(v);
    }
    pts = shuffle(pool); ptsI = 0;
  }
  function platformPoint() {
    if (!pts.length) choosePlatformPoints();
    const v = pts[ptsI % pts.length].clone(); if (ptsI >= pts.length) { v.x += rand(-1.5, 1.5); v.z = clamp(v.z + rand(-1.5, 1.5), -4, 4); }
    ptsI++; return v;
  }

  // ---- spawning --------------------------------------------------------------------------------------------------------------
  function doorBusy(d) {
    for (let i = 0; i < tracked.length; i++) { const ep = tracked[i].pos; if (ep && Math.abs(ep.x - d.x) < 1.0 && Math.abs(ep.z - d.z) < 1.6) return true; }
    return false;
  }
  function pickDoor() {
    const doors = game.train?.doorPoints?.();
    if (!doors || !doors.length) return null;
    const n = doors.length;
    for (let k = 0; k < n; k++) {
      const i = (doorCursor + k) % n;
      if (!doorBusy(doors[i])) { doorCursor = (i + 1 + (Math.random() < 0.4 ? 1 : 0)) % n; busyWait = 0; return doors[i]; }
    }
    if (busyWait >= 0.6) { busyWait = 0; return doors[doorCursor % n]; } // every door jammed for a while: spawn anyway
    busyWait += 0.15; return BUSY;
  }
  function nextInterval() {
    if (platformMode) return 0.12;
    const T9 = clamp(9 - 0.25 * (W.wave - 2), 5, 9); // total exit window shortens with the wave number
    return Math.max(0.22, T9 / Math.max(1, W.total)) * rand(0.6, 1.4);
  }
  // returns false when it wants to retry shortly (door busy)
  function spawnOne() {
    const en = game.enemies, type = queue[qi];
    if (!en) { qi++; return true; }
    let pos, emerge = false;
    if (platformMode) pos = platformPoint();
    else {
      const d = pickDoor();
      if (d === BUSY) return false;
      if (d) { pos = d.clone(); emerge = true; } else pos = platformPoint();
    }
    let e = null;
    try { e = en.spawn(type, pos, { hpMul, speedMul, emerge }); }
    catch (err) {
      console.warn(`[waves] spawn(${type}) failed`, err);
      try { e = en.spawn('shambler', pos, { hpMul, speedMul, emerge }); } catch (err2) { e = null; }
    }
    qi++;
    if (e) tracked.push(e);
    alive = tracked.length;
    return true;
  }
  function updateSpawning(dt) {
    spawnClock -= dt;
    let guard = 8;
    while (spawnClock <= 0 && qi < queue.length && guard-- > 0) {
      if (alive >= MAX_ALIVE) { spawnClock = 0.25; break; }
      if (!spawnOne()) { spawnClock = 0.15; break; }
      spawnClock += nextInterval();
    }
    if (qi >= queue.length) setState('fight');
  }

  // ---- clear / intermission --------------------------------------------------------------------------------------------------
  function clearWave() {
    const n = W.wave;
    setState('intermission'); W.timer = BREATHER; interT = 0;
    bus.emit('wave:cleared', { wave: n });
    sfx('waveClear');
    banner(`WAVE ${n} CLEARED`, 'SUPPLY DROP · GRAB WHAT YOU NEED', 3);
    try { game.pickups?.supplyDrop?.(n); } catch (e) { console.warn('[waves] supplyDrop', e); }
    const tr = game.train;
    if (tr && tr.state === 'stopped') callDepart();
    else if (tr && tr.state === 'arriving') pendingDepart = true;
  }
  function callDepart() {
    const tr = game.train, my = token;
    pendingDepart = false;
    if (!tr || typeof tr.depart !== 'function') return;
    departing = true; departAt = T; departedAt = -1;
    let p;
    try { p = tr.depart(); } catch (e) { console.warn('[waves] train.depart threw', e); departing = false; return; }
    const done = () => { if (token === my) { departing = false; departedAt = T; } };
    Promise.resolve(p).then(done, (e) => { console.warn('[waves] train.depart failed', e); done(); });
  }
  function updateIntermission(dt) {
    W.timer = Math.max(0, W.timer - dt); interT += dt;
    if (pendingDepart && game.train?.state === 'stopped') callDepart();
    // tolerate a train that reports 'away' but never resolves depart(), or resolves depart() but never reports 'away'
    if (departing && trainAway() && T - departAt > 3) departing = false;
    if (!departing && departedAt >= 0 && !trainAway() && T - departedAt > 3) { console.warn('[waves] train departed but still reports', game.train.state, '- resetting it'); try { game.train.reset?.(); } catch (e) { /* ignore */ } departedAt = -1; }
    if (W.timer <= 0 && !departing && !pendingDepart && trainAway()) { beginWave(W.wave + 1); return; }
    if (interT > BREATHER + DEPART_TIMEOUT) { // train never left: hard reset it so the game cannot stall
      console.warn('[waves] train did not depart in time, resetting it');
      try { game.train?.reset?.(); } catch (e) { /* ignore */ }
      departing = false; pendingDepart = false;
      if (!game.train || !game.train.state || game.train.state === 'away') beginWave(W.wave + 1); else interT = 0;
    }
  }
  function updateTrainIn(dt) {
    trainT += dt;
    if (arrived) { onDoorsOpen(); return; }
    if (trainT > ARRIVE_TIMEOUT) { console.warn('[waves] train.arrive() never resolved, spawning anyway'); onDoorsOpen(); }
  }

  // ---- watchdogs (a wave must never get stuck on a lost zombie) ----------------------------------------------------------------
  function cull(e) {
    e._cull = true;
    culling = true;
    try { if (game.enemies?.remove) game.enemies.remove(e); else game.enemies?.damage?.(e, 1e6, { point: e.pos.clone(), dir: new game.THREE.Vector3(0, 0, 1), type: 'melee', source: 'enemy' }); } catch (err) { /* ignore */ }
    culling = false;
  }
  function relocate(e) {
    const list = game.station?.spawnPoints; if (!list || !list.length) return;
    const p = game.player?.pos; let best = null, bd = -1;
    for (let k = 0; k < 4; k++) { const c = list[(Math.random() * list.length) | 0]; const d = p ? Math.hypot(c.x - p.x, c.z - p.z) : 99; if (d > bd) { bd = d; best = c; } }
    e.pos.x = best.x; e.pos.z = best.z; e.pos.y = 0; e.vel?.set?.(0, 0, 0);
  }
  function watchdog(dt) {
    wdT += dt; if (wdT < 1) return; wdT = 0;
    const p = game.player?.pos;
    const few = alive > 0 && qi >= queue.length && alive <= Math.max(3, Math.ceil(W.total * 0.15));
    const idleLimit = few ? 20 : 60; // stragglers are hunted down sooner than members of a full horde
    for (let i = 0; i < tracked.length; i++) {
      const e = tracked[i], ep = e.pos; if (!ep) continue;
      if (ep.y < -4) { cull(e); continue; } // fell out of the world
      const a = e._wd || (e._wd = { x: ep.x, z: ep.z, t: T, n: 0 });
      if (Math.hypot(ep.x - a.x, ep.z - a.z) > 1.0) { a.x = ep.x; a.z = ep.z; a.t = T; }
      else if (T - a.t > idleLimit && (!p || Math.hypot(ep.x - p.x, ep.z - p.z) > 5)) { // idle far from the player: unstick it
        if (++a.n >= 3) cull(e); else { relocate(e); a.x = ep.x; a.z = ep.z; a.t = T; }
      }
    }
  }

  // ---- public API --------------------------------------------------------------------------------------------------------------
  W.start = () => { W.reset(); dead = false; beginWave(1); };
  W.reset = () => {
    hardReset(); dead = false; T = 0; lastHorde = false; lastKill = null;
    W.wave = 0; W.kills = 0; W.score = 0; W.track = 'A'; W.log.length = 0;
  };
  // Jump straight to wave n (opts.platform: enemies appear on the platform instead of a train arrival).
  W.debugStart = (n = 1, opts = {}) => {
    n = Math.max(1, Math.floor(+n) || 1);
    hardReset(); dead = false; lastHorde = false; W.wave = n - 1;
    beginWave(n, opts);
  };
  W.update = (dt) => {
    if (dead || W.state === 'idle') return;
    T += dt;
    countAlive();
    switch (W.state) {
      case 'intermission': updateIntermission(dt); break;
      case 'trainIn': updateTrainIn(dt); break;
      case 'spawning': updateSpawning(dt); break;
      default: break;
    }
    if (W.state === 'spawning' || W.state === 'fight') {
      watchdog(dt);
      if (qi >= queue.length && alive === 0) { if (W.state === 'spawning') setState('fight'); clearWave(); }
    }
  };

  // ---- bus ----------------------------------------------------------------------------------------------------------------------
  bus.on('enemy:killed', (d) => {
    if (!d || culling || d.source === 'enemy') return; // only the player's kills score (exploders that burst on their own, culls and infighting do not)
    const e = d.enemy;
    let type = e?.type; if (!POINTS[type]) type = POINTS[d.type] ? d.type : 'shambler';
    W.kills++; W.score += POINTS[type];
    lastKill = e || null;
    if (e && heads.has(e)) { heads.delete(e); W.score += HEAD_BONUS[type] || 50; }
  });
  bus.on('enemy:hit', (d) => {
    if (!d || !d.killed || d.part !== 'head' || culling || d.source === 'enemy') return;
    if (lastKill && d.enemy === lastKill) { lastKill = null; W.score += HEAD_BONUS[d.enemy?.type] || 50; } // hit event arrived after the kill event
    else if (d.enemy) heads.add(d.enemy);
  });
  bus.on('train:doorsOpen', (d) => { if (W.state === 'trainIn' && (!d || !d.track || d.track === W.track)) arrived = true; });
  bus.on('player:dead', () => { dead = true; qi = queue.length; setState('idle'); });

  return W;
}
