// Chainsaw audio bridge: the stable, game-facing API for the RPM-driven synthesised engine (chainsawEngine.js) plus the recorded layers of chainsawLayers.js (human-curated
// recordings: pull-cord + catch, pitch-following idle / full / loaded beds, bite transients, wet gore bed, shutdown). audio.js exposes it as `game.audio.chainsaw`:
//
//   chainsaw.ready              Promise<boolean>  resolves true once the engine exists (worklet loaded), false if it failed / was disposed. Reading it is a
//                               cheap way to warm the engine up (e.g. at weapon init) so the first start() has no latency; the engine is otherwise created
//                               lazily on first use, and only once the AudioContext exists (after audio.resume()). It also moves the saw recordings to the front of the load queue.
//   chainsaw.state              live snapshot { ready, kind:'worklet'|'script'|'osc'|'none', on, running, mode(0 off,1 cranking,2 running,3 stopping), rpm, hz,
//                               throttle, load, layers, saw ('synth'|'mixed'|'samples'), layerDb, engineDb, samples:{start,stop,idle,full,loaded,rev,hit,gore} }
//   chainsaw.start()            pull-cord start (idempotent while running/cranking; a start during the spin-down re-catches without the cord)
//   chainsaw.stop()             ignition off: spin-down, last pop; the recorded shutdown plays when the saw was idling
//   chainsaw.setThrottle(v)     0..1   (0 = idle, ~0.15 held idle with the chain still, 1 = full)
//   chainsaw.setLoad(v)         0..1   cutting load (rpm sag, growl, grit); > 0.5 with flesh bites also fades in the wet gore bed
//   chainsaw.bite(strength=0.7, kind='flesh')   one tooth-bite transient (call once per melee tick that hits); kind 'flesh'|'wood'|'metal'
//   chainsaw.rev(amount=1)      throttle blip with rev-up overshoot and burble/backfire on the way down
//   chainsaw.setMode(m)         'synth' (engine only, exactly the pre-recordings behaviour) | 'mixed' (default: engine + recorded layers) | 'samples' (recordings in front, the
//                               engine keeps running 26 dB down so throttle / load / bite still drive them). URL flag ?saw=synth|mixed|samples sets the initial mode.
//   chainsaw.setLayers(bool)    false = 'synth'; true = back to the last layered mode (also off when game.audio.setSamples(false) / ?samples=0)
//   chainsaw.setLayerDb(db)     shift every recorded layer by db (-40..+24, default 0); chainsaw.setEngineDb(db) trims the synth engine (-40..+12)
//   chainsaw.tune(obj)          live DSP knobs of the engine ({idle, full, sag, rough, exhaust, chain, grit, bite, hiss, tick, growl, out, drive, crack})
//   chainsaw.reset()            (audio.js calls it on every game start / when the player dies) hard-silences everything, keeps the engine for re-use
//   chainsaw.dispose()          tears the engine and all layer nodes down for good; every later call is a no-op
// Every method is safe before ready / after dispose and never throws. The sound is 2D (first person): no panner, straight into the sfx bus -> limiter/compressor
// -> master, with a small send into the shared reverb.
//
// Graph:   engine.output -> duck (cord / shutdown hand-over) -> engineMode (mute in 'samples') -> dest (+ reverb send)
//          layers -> layerBus -> dest (+ reverb send)            (layerBus carries the same TRIM as the engine output, so REF levels in chainsawLayers.js apply to both)
// The layers follow the engine's telemetry (hz / rpm / load, ~86 messages/s, extrapolated by its slope) every 25 ms. All timing decisions (cord fit, catch hand-over, shutdown
// rate match, rev not layered) and the level presets are documented + measured in chainsawLayers.js and tools/chainsaw-ab.mjs (`node tools/chainsaw-ab.mjs all|scenario|start|seams|levels|beat|audit|rev`).

import { createSawLayers } from './chainsawLayers.js';

const REV_SEND = 0.08;                            // touch of the shared convolution reverb
const TRIM = 0.75;                                // engine output gain into the game buses (calibrated so a cutting saw sits just under the shotgun)
const TICK_MS = 25;
const SAMPLES_ENGINE_DB = -26;                    // 'samples' mode keeps the muted synth 26 dB down: inaudible under the recordings, but a mid-rev stretch no loop fits (pitch range) never goes silent
const DB = (x) => Math.pow(10, x / 20);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const MODES = ['synth', 'mixed', 'samples'];
const parseMode = (m) => { const s = String(m == null ? '' : m).toLowerCase(); return MODES.includes(s) ? s : 'mixed'; };

export function createChainsawBridge(env) {
  const B = {};
  const warn = env.warn || ((...a) => console.warn('[audio/chainsaw]', ...a));
  const warned = new Set();
  const fail = (what, e) => { if (!warned.has(what)) { warned.add(what); warn(what + ' failed:', e); } };
  let eng = null, send = null, duck = null, engMode = null, layerBus = null, L = null, creating = false, failed = false, disposed = false, dead = false, wantEngine = false, engOn = false;
  let mode = parseMode(env.mode), lastLayered = mode === 'synth' ? 'mixed' : mode, layerDb = 0, engineDb = 0, engMuted = null;
  let timer = null, lastFleshT = -1e9, created = 0;
  const stats = { starts: 0, bites: 0, ticks: 0, tickMs: 0, tickMaxMs: 0 };
  const want = { on: false, thr: 0, load: 0 };
  const tel = { key: null, prevKey: null, hz: 0, prevHz: 0, at: 0 };
  let pendingTune = null, resolveReady; const readyP = new Promise((r) => { resolveReady = r; });
  const ctxOf = () => env.ctx?.() || null;
  const safe = (name, fn, dflt) => (...a) => { try { return fn(...a); } catch (e) { fail(name, e); return dflt; } };
  const wantSamples = () => { try { env.samples?.prioritize?.('chainsaw'); if (ctxOf()) env.samples?.start?.(); } catch (_) { /* optional */ } };   // start() only once the context exists (audio.resume() starts it anyway)

  // ------------------------------------------------------------------------------------------------ engine lifecycle
  async function create() {
    if (eng || creating || failed || disposed) return;
    const ctx = ctxOf(); if (!ctx) return;
    creating = true;
    try {
      const mod = await import('./chainsawEngine.js');
      const dest = env.dest();
      duck = ctx.createGain(); engMode = ctx.createGain(); layerBus = ctx.createGain();
      duck.connect(engMode); engMode.connect(dest); layerBus.gain.value = TRIM; layerBus.connect(dest);
      const e = await mod.createChainsawEngine(ctx, duck, { telemetry: true });
      if (disposed) { e.dispose(); return; }
      created++;
      e.output.gain.value = TRIM;
      const rv = env.reverb?.(); if (rv) { send = ctx.createGain(); send.gain.value = REV_SEND; engMode.connect(send); layerBus.connect(send); send.connect(rv); }
      L = createSawLayers({ ctx: ctxOf, out: () => layerBus, samples: env.samples });
      L.setMode(mode === 'samples' ? 'samples' : 'mixed'); L.setLevelDb(layerDb);
      if (pendingTune) { e.tune(pendingTune); pendingTune = null; }
      eng = e; applyEngineGain(true); resolveReady(true);
      sync();
    } catch (e) { failed = true; fail('engine creation', e); resolveReady(false); }
    finally { creating = false; }
  }
  const ensure = () => { if (!eng && !creating && !failed && !disposed && ctxOf()) create(); };
  function sync() {                                          // apply the desired controls to the engine (engine just became available)
    if (!eng || disposed) return;
    eng.setThrottle(want.thr); eng.setLoad(want.load);
    if (want.on && !engOn && !dead) doStart();
  }
  B.onContext = safe('onContext', () => { if (wantEngine || want.on) ensure(); }, undefined);

  // ------------------------------------------------------------------------------------------------ mode / level plumbing
  const haveRecordings = () => { const c = env.samples?.saw; return !!c && (c.idle.length + c.full.length + c.loaded.length) > 0; };
  // recorded layers exist only in 'mixed' / 'samples', with the sample layer enabled, an engine and a running context
  function layersActive() { const c = ctxOf(); return mode !== 'synth' && !!env.samples?.enabled && !!eng && !!L && !!c && c.state === 'running'; }
  // 'samples' pushes the synth engine 26 dB down (it keeps running for state / telemetry, and as a whisper-quiet safety net) - but only once recordings are decoded, so a saw never goes silent while they load
  function applyEngineGain(force) {
    if (!engMode) return; const c = ctxOf(); if (!c) return;
    const mute = mode === 'samples' && !!env.samples?.enabled && haveRecordings();
    if (!force && mute === engMuted) return; engMuted = mute;
    engMode.gain.setTargetAtTime(mute ? DB(SAMPLES_ENGINE_DB) : DB(engineDb), c.currentTime, 0.04);
  }
  function duckReset() { if (!duck) return; const c = ctxOf(); if (!c) return; const t = c.currentTime; try { duck.gain.cancelScheduledValues(t); duck.gain.setValueAtTime(duck.gain.value, t); duck.gain.linearRampToValueAtTime(1, t + 0.03); } catch (_) { /* ignore */ } }
  // the recorded cord replaces the synth cord: engine silent while it plays (its ratchet would be a second cord), faded in over the catch (tiny lead so the earliest catch, 0.49 s, is already rising)
  function duckCord(r) {
    const c = ctxOf(); if (!c || B._noDuck) return; const t = c.currentTime, p = duck.gain;
    p.cancelScheduledValues(t); p.setValueAtTime(0, t); p.setValueAtTime(0, t + r.catchT - 0.07); p.linearRampToValueAtTime(1, t + r.catchT + 0.55);
  }
  // shutdown: the synth keeps its own last pop, then sits 14 dB down under the recorded dying engine
  function duckShutdown() {
    const c = ctxOf(); if (!c) return; const t = c.currentTime, p = duck.gain;
    p.cancelScheduledValues(t); p.setValueAtTime(1, t); p.setValueAtTime(1, t + 0.12); p.linearRampToValueAtTime(0.2, t + 0.3); p.setValueAtTime(0.2, t + 2.0); p.linearRampToValueAtTime(1, t + 2.1);
  }
  function doStart() {
    engOn = true;
    const s = eng.state, cold = !(s && (s.mode === 1 || s.mode === 2 || (s.mode === 3 && s.rpm > 500)));
    eng.start(); stats.starts++;
    if (layersActive()) {
      if (cold) { L.killAll(0.03); const r = L.cord(); if (r) duckCord(r); else duckReset(); } else duckReset();
    } else duckReset();
    applyEngineGain(false); timerOn();
  }

  // ------------------------------------------------------------------------------------------------ per-tick layer control
  // firing rate: latest telemetry extrapolated along its slope (the layers must not lag the synth through a rev)
  function hzNow(s, now) {
    const key = s.time ?? s.t;
    if (key !== tel.key) { tel.prevKey = tel.key; tel.prevHz = tel.hz; tel.key = key; tel.hz = +s.hz || 0; tel.at = s.t ?? now; }
    let hz = tel.hz;
    if (tel.prevKey != null && Number.isFinite(tel.prevKey) && tel.key > tel.prevKey) {
      const slope = clamp((tel.hz - tel.prevHz) / (tel.key - tel.prevKey), -2500, 2500);
      hz += slope * clamp(now - tel.at + 0.012, 0, 0.1);
    }
    return Math.max(0, hz);
  }
  function tick() {
    const ctx = ctxOf(); if (!eng || !ctx || disposed) return;
    if (ctx.state !== 'running') return;
    const s = eng.state || {}, running = engOn && s.mode === 2, now = ctx.currentTime;
    applyEngineGain(false);
    if (!L) { if (!engOn && s.mode === 0) timerOff(); return; }
    if (!(running && layersActive())) { L.tick({}, false, false); if (!engOn && s.mode === 0 && !L.liveCount()) timerOff(); return; }
    L.tick({ rpm: s.rpm || 0, hz: hzNow(s, now), load: s.load || 0 }, true, want.load > 0.5 && now - lastFleshT < 0.4);
  }
  const timedTick = () => { const t0 = performance.now(); tick(); const dt = performance.now() - t0; stats.ticks++; stats.tickMs += dt; if (dt > stats.tickMaxMs) stats.tickMaxMs = dt; };
  const timerOn = () => { if (!timer && !disposed) timer = setInterval(safe('tick', timedTick), TICK_MS); };
  const timerOff = () => { if (timer) { clearInterval(timer); timer = null; } };

  // ------------------------------------------------------------------------------------------------ public API
  Object.defineProperty(B, 'ready', { get() { if (disposed) return Promise.resolve(false); wantEngine = true; wantSamples(); ensure(); return readyP; }, enumerable: true });
  Object.defineProperty(B, 'mode', { get() { return mode; }, enumerable: true });
  Object.defineProperty(B, 'state', {
    enumerable: true,
    get() {
      let s = null, cs = null;
      try { s = (eng && eng.state) || null; cs = env.samples?.sawCounts ? env.samples.sawCounts() : null; } catch (e) { fail('state', e); }
      return { ready: !!eng, kind: eng ? eng.kind : 'none', on: want.on && engOn, running: !!s && s.mode === 2, mode: s ? s.mode | 0 : 0, rpm: s ? +s.rpm || 0 : 0, hz: s ? +s.hz || 0 : 0, throttle: s ? +s.throttle || 0 : want.thr, load: s ? +s.load || 0 : want.load,
        layers: mode !== 'synth' && !!env.samples?.enabled, saw: mode, layerDb, engineDb, samples: cs, disposed };
    },
  });
  B.start = safe('start', () => {
    if (disposed || dead) return false;
    want.on = true; wantEngine = true; wantSamples();
    if (!eng) { ensure(); return true; }
    if (!engOn) doStart();
    return true;
  }, false);
  B.stop = safe('stop', () => {
    want.on = false;
    if (!eng || !engOn) return true;
    const s = eng.state;
    engOn = false; eng.stop();
    if (L) {
      L.stopAll(0.12);
      if (layersActive() && L.shutdown(s)) duckShutdown(); else if (L) duckReset();
    }
    timerOn();                                              // timer keeps running until the spin-down finished (tick stops itself)
    return true;
  }, false);
  B.setThrottle = safe('setThrottle', (v) => { if (disposed || dead) return; want.thr = clamp(+v || 0, 0, 1); if (eng) eng.setThrottle(want.thr); }, undefined);
  B.setLoad = safe('setLoad', (v) => { if (disposed || dead) return; want.load = clamp(+v || 0, 0, 1); if (eng) eng.setLoad(want.load); }, undefined);
  B.bite = safe('bite', (strength = 0.7, kind = 'flesh') => {
    if (!eng || disposed || dead) return;
    const k = kind === 1 || kind === 'wood' ? 'wood' : kind === 2 || kind === 'metal' ? 'metal' : 'flesh', s = clamp(+strength || 0, 0, 1);
    eng.bite(s, k); stats.bites++;
    if (k === 'flesh') { const ctx = ctxOf(); if (ctx) lastFleshT = ctx.currentTime; }
    if (layersActive()) L.bite(s, k, eng.state);
  }, undefined);
  B.rev = safe('rev', (amount = 1) => { if (eng && !disposed && !dead) eng.rev(clamp(+amount || 0, 0, 1)); }, undefined);
  B.setMode = safe('setMode', (m) => {
    const nm = parseMode(m); if (nm === mode) return mode;
    mode = nm; if (mode !== 'synth') lastLayered = mode;
    if (L) { L.setMode(mode === 'samples' ? 'samples' : 'mixed'); L.killAll(0.1); }
    duckReset(); applyEngineGain(true);
    return mode;
  }, 'mixed');
  B.setLayers = safe('setLayers', (on) => { B.setMode(on ? lastLayered : 'synth'); return mode !== 'synth'; }, false);
  B.setLayerDb = safe('setLayerDb', (db) => { layerDb = clamp(+db || 0, -40, 24); L?.setLevelDb(layerDb); return layerDb; }, 0);
  B.setEngineDb = safe('setEngineDb', (db) => { engineDb = clamp(+db || 0, -40, 12); applyEngineGain(true); return engineDb; }, 0);
  B.tune = safe('tune', (o) => { if (!o || typeof o !== 'object') return; if (eng) eng.tune(o); else pendingTune = { ...(pendingTune || {}), ...o }; }, undefined);
  // game start / player death: everything silent NOW, engine kept for re-use (a later start() works again after reset())
  B.reset = safe('reset', () => {
    dead = false; want.on = false; want.thr = 0; want.load = 0; L?.killAll(0.03); duckReset();
    if (eng && (engOn || (eng.state && eng.state.mode !== 0))) { engOn = false; eng.setThrottle(0); eng.setLoad(0); eng.stop(); }
    engOn = false; timerOff();
  }, undefined);
  B.kill = safe('kill', () => {                              // player died: spin down, ignore the weapon until reset()
    if (dead) return; dead = true; want.on = false;
    if (eng && (engOn || (eng.state && eng.state.mode !== 0))) { eng.setThrottle(0); eng.setLoad(0); eng.stop(); }
    engOn = false; L?.killAll(0.05); duckReset();
  }, undefined);
  B.dispose = safe('dispose', () => {
    if (disposed) return; disposed = true; timerOff(); engOn = false; want.on = false;
    L?.killAll(0.02);
    try { eng?.dispose(); } catch (_) { /* already gone */ }
    for (const n of [send, duck, engMode, layerBus]) { try { n?.disconnect(); } catch (_) { /* already gone */ } }
    eng = null; send = null; L = null; resolveReady(false);
  }, undefined);
  B._debug = () => {
    const d = L ? L.debug() : { shots: 0, loopStarts: 0, bedStarts: 0, live: 0, loops: {}, bed: null };
    const c = env.samples?.saw;
    return { stats: { shots: d.shots, loopStarts: d.loopStarts, bedSlices: d.bedStarts, starts: stats.starts, bites: stats.bites, cords: d.cords || 0, shutdowns: d.shutdowns || 0, layerBites: d.bites || 0, bogs: d.bogs || 0, ticks: stats.ticks, tickAvgMs: +(stats.tickMs / Math.max(1, stats.ticks)).toFixed(3), tickMaxMs: +stats.tickMaxMs.toFixed(2) },
      loopInfo: d.loops, created, live: d.live, loops: L ? L.loopCount() : 0, bed: L ? L.hasBed() : false, bedClip: d.bed, timer: !!timer, engOn, dead, disposed, failed, mode, layerDb, engineDb, engMuted: !!engMuted,
      cat: c ? { start: c.start.length, hit: c.hit.length, gore: c.gore.length, idle: c.idle.length, full: c.full.length, loaded: c.loaded.length, stop: c.stop.length, rev: c.rev.length } : null };
  };
  B._noDuck = false;                                        // test hook: leave the synth cord audible while the recorded one plays (double-cord measurement)
  B._engine = () => eng;
  B._layers = () => L;
  B._slices = () => (L ? L._slices() : {});
  return B;
}
