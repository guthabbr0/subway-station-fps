// Chainsaw audio bridge: the stable, game-facing API for the RPM-driven synthesised engine (chainsawEngine.js) plus an optional layer of real recordings
// (assets/audio/chainsaw/*, CC-licensed) mixed UNDER the engine. audio.js exposes it as `game.audio.chainsaw`:
//
//   chainsaw.ready              Promise<boolean>  resolves true once the engine exists (worklet loaded), false if it failed / was disposed. Reading it is a
//                               cheap way to warm the engine up (e.g. at weapon init) so the first start() has no latency; the engine is otherwise created
//                               lazily on first use, and only once the AudioContext exists (after audio.resume()).
//   chainsaw.state              live snapshot { ready, kind:'worklet'|'script'|'osc'|'none', on, running, mode(0 off,1 cranking,2 running,3 stopping), rpm, hz,
//                               throttle, load, layers, samples }
//   chainsaw.start()            pull-cord start (idempotent while running/cranking; a start during the spin-down re-catches without the cord)
//   chainsaw.stop()             ignition off: spin-down, last pop; layers fade out
//   chainsaw.setThrottle(v)     0..1   (0 = idle, ~0.15 held idle with the chain still, 1 = full)
//   chainsaw.setLoad(v)         0..1   cutting load (rpm sag, growl, grit); > 0.5 with flesh bites also fades in the wet gore bed
//   chainsaw.bite(strength=0.7, kind='flesh')   one tooth-bite transient (call once per melee tick that hits); kind 'flesh'|'wood'|'metal'
//   chainsaw.rev(amount=1)      throttle blip with rev-up overshoot and burble/backfire on the way down
//   chainsaw.setLayers(bool)    recorded-sample layers on/off (they are also off when game.audio.setSamples(false) / ?samples=0); the synth engine is unaffected
//   chainsaw.tune(obj)          live DSP knobs of the engine ({idle, full, sag, rough, exhaust, chain, grit, bite, hiss, tick, growl, out, drive, crack})
//   chainsaw.reset()            (audio.js calls it on every game start / when the player dies) hard-silences everything, keeps the engine for re-use
//   chainsaw.dispose()          tears the engine and all layer nodes down for good; every later call is a no-op
// Every method is safe before ready / after dispose and never throws. The sound is 2D (first person): no panner, straight into the sfx bus -> limiter/compressor
// -> master, with a small send into the shared reverb.
//
// Sample layers (all optional, all discovered at RUNTIME from the manifest; a missing folder / role just means that layer is absent):
//   start/stop clips at start()/stop()    role /start|pull|crank/ , /stop|shut/
//   bite transients                        roles /hit|bite|cut/ (+ /gore|wet|squish/): chosen by kind via the manifest label/notes (flesh|wood|metal), long
//                                          "sequence" clips are cut into onset slices; velocity-scaled gain, rate-varied, 0-12 ms humanising delay
//   wet gore bed                           slices of gore/hit clips while load > 0.5 and flesh bites are landing
//   idle / full loops (loop:true+seamless) high-passed texture; playbackRate = engine hz / clip.fundamentalHz; crossfaded by rpm
// Levels are set relative to the engine's own level (LAYER, dB), compensated with each clip's measured loudness (samples.js).

const LAYER = { start: -13, stop: -13, hit: -12, gore: -14, bed: -17, idle: -14, full: -14 };  // dB relative to the engine's own level in that state
const REF = { idle: -24, run: -17.8, cut: -13.7 };   // engine loudest-200ms weighted level (dBFS) at the engine output in that state (measured, tools/audio-verify.mjs chainsaw)
const TRIM = 0.75;                                // engine output gain into the game buses (calibrated so a cutting saw sits just under the shotgun)
const REV_SEND = 0.08;                            // touch of the shared convolution reverb
const DB = (x) => Math.pow(10, x / 20);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function createChainsawBridge(env) {
  const B = {};
  const warn = env.warn || ((...a) => console.warn('[audio/chainsaw]', ...a));
  const warned = new Set();
  const fail = (what, e) => { if (!warned.has(what)) { warned.add(what); warn(what + ' failed:', e); } };
  let eng = null, send = null, creating = false, failed = false, disposed = false, dead = false, wantEngine = false, engOn = false, layersOn = true;
  let pendingTune = null, timer = null, lastHitAt = -1, lastFleshT = -1e9, hitBag = new Map(), created = 0;
  const stats = { shots: 0, loopStarts: 0, bedSlices: 0, starts: 0, bites: 0 };
  const want = { on: false, thr: 0, load: 0 };
  let resolveReady; const readyP = new Promise((r) => { resolveReady = r; });
  const live = new Set();                                  // layer one-shots currently alive (leak accounting)
  const loops = { idle: null, full: null };
  const bed = { cur: null, nextT: 0 };
  const cache = { n: -1, start: [], stop: [], idle: [], full: [], hit: [], gore: [] };
  const ctxOf = () => env.ctx?.() || null;
  const safe = (name, fn, dflt) => (...a) => { try { return fn(...a); } catch (e) { fail(name, e); return dflt; } };

  // ------------------------------------------------------------------------------------------------ clip catalogue (runtime, from the manifest)
  const tagsOf = (c) => {
    const t = ((c.meta?.label || '') + ' ' + (c.meta?.notes || '') + ' ' + (c.meta?.title || '') + ' ' + c.file).toLowerCase();
    return { flesh: /flesh|squish|squelch|splat|wet|gore|blood|meat|gib/.test(t), wood: /wood|crack|log|branch|tree|timber/.test(t), metal: /metal|steel|iron|clang|ping|spark|pipe/.test(t) };
  };
  function classify(c) {
    const r = String(c.role).toLowerCase();
    if (/start|pull|crank/.test(r)) return 'start';
    if (/stop|shut/.test(r)) return 'stop';
    if (/idle/.test(r)) return c.loop && c.seamless ? 'idle' : null;
    if (/full|high/.test(r)) return c.loop && c.seamless ? 'full' : null;
    if (/rev/.test(r)) return null;                                   // rev-up recordings have their own (unrelated) timing: not layered (see header)
    if (/gore|wet|squish|blood/.test(r)) return 'gore';
    if (/hit|bite|cut|chop/.test(r)) return 'hit';
    return null;
  }
  function catalogue() {
    const all = env.samples?.clips?.('chainsaw') || [];
    if (all.length === cache.n) return cache;
    cache.n = all.length; for (const k of ['start', 'stop', 'idle', 'full', 'hit', 'gore']) cache[k] = [];
    for (const c of all) { const k = classify(c); if (!k) continue; c.tags = c.tags || tagsOf(c); c.kindOf = k; cache[k].push(c); }
    return cache;
  }
  // onset slices of long "sequence" clips (detected once): [{off, len}]
  function slicesOf(c) {
    if (c.slices) return c.slices;
    const ch = c.buf.getChannelData(0), sr = c.buf.sampleRate, hop = Math.max(1, Math.round(sr * 0.004)), n = Math.floor(ch.length / hop), env2 = new Float32Array(n);
    let mx = 1e-9; for (let i = 0; i < n; i++) { let e = 0; for (let j = i * hop; j < (i + 1) * hop; j++) e += ch[j] * ch[j]; env2[i] = Math.sqrt(e / hop); if (env2[i] > mx) mx = env2[i]; }
    const out = [];
    if (c.dur <= 0.8) out.push({ off: 0, len: c.dur });
    else {
      let lastT = -1;
      for (let i = 6; i < n - 2; i++) {
        let prev = 1e9; for (let k = i - 6; k < i; k++) prev = Math.min(prev, env2[k]);
        if (env2[i] > mx * 0.09 && env2[i] > prev * 2.8 && env2[i] >= env2[i - 1] && env2[i] >= env2[i + 1] && i * hop / sr - lastT > 0.12) {
          let j = i; while (j > 0 && env2[j - 1] < env2[j]) j--;                      // walk back to the foot of the rise
          const t0 = Math.max(0, j * hop / sr - 0.003); lastT = i * hop / sr; out.push({ off: t0, len: 0.34 });
        }
      }
      if (!out.length) out.push({ off: 0, len: Math.min(0.5, c.dur) });
      for (let k = 0; k < out.length; k++) { const nx = out[k + 1]?.off ?? c.dur; out[k].len = clamp(nx - out[k].off, 0.08, Math.min(0.42, c.dur - out[k].off)); }
    }
    return (c.slices = out);
  }
  function nextFrom(key, list) {                            // shuffle-bag over a list of items (no immediate repeat)
    if (!list.length) return null;
    let bag = hitBag.get(key);
    if (!bag || !bag.length) { bag = list.slice(); for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } hitBag.set(key, bag); }
    return bag.pop();
  }

  // ------------------------------------------------------------------------------------------------ engine lifecycle
  async function create() {
    if (eng || creating || failed || disposed) return;
    const ctx = ctxOf(); if (!ctx) return;
    creating = true;
    try {
      const mod = await import('./chainsawEngine.js');
      const e = await mod.createChainsawEngine(ctx, env.dest(), { telemetry: true });
      if (disposed) { e.dispose(); return; }
      created++;
      e.output.gain.value = TRIM;
      const rv = env.reverb?.(); if (rv) { send = ctx.createGain(); send.gain.value = REV_SEND; e.output.connect(send); send.connect(rv); }
      if (pendingTune) { e.tune(pendingTune); pendingTune = null; }
      eng = e; resolveReady(true);
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
  function doStart() {
    engOn = true;
    const cold = !eng.state || eng.state.mode === 0 || eng.state.mode === undefined;
    eng.start(); stats.starts++;
    if (cold) layerStart();
    timerOn();
  }
  B.onContext = safe('onContext', () => { if (wantEngine || want.on) ensure(); }, undefined);

  // ------------------------------------------------------------------------------------------------ layers
  function samplesOn() { return layersOn && !!env.samples?.enabled && !!eng && !!ctxOf() && ctxOf().state === 'running'; }
  function shot(c, { rel, ref, offset = 0, dur = c.dur, rate = 1, delay = 0, fadeIn = 0.003, fadeOut = 0.02, vel = 1 }) {
    const ctx = ctxOf(); if (!ctx || !eng) return null;
    while (live.size >= 10) { let old = null; for (const v of live) { old = v; break; } kill(old, 0.02); }
    const gain = clamp(DB(rel + ref - c.loudDb), 0, 4) * vel * (0.9 + 0.2 * Math.random());
    const t = ctx.currentTime + delay, wall = dur / rate;
    const src = ctx.createBufferSource(); src.buffer = c.buf; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(fadeIn, wall * 0.3));
    if (wall > fadeOut * 2) { g.gain.setValueAtTime(gain, t + wall - fadeOut); g.gain.linearRampToValueAtTime(0, t + wall); }
    src.connect(g); g.connect(eng.layerInput);
    const v = { src, g, end: t + wall };
    live.add(v); stats.shots++;
    src.onended = () => { live.delete(v); try { src.disconnect(); g.disconnect(); } catch (_) { /* gone */ } };
    src.start(t, offset, dur);
    return v;
  }
  function kill(v, fade = 0.03) {
    if (!v) return; live.delete(v); const ctx = ctxOf();
    try { const t = ctx.currentTime; v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, fade * 0.4); v.src.stop(t + fade * 2 + 0.01); } catch (_) { /* already stopped */ }
    setTimeout(() => { try { v.src.disconnect(); v.g.disconnect(); } catch (_) { /* gone */ } }, fade * 2000 + 80);
  }
  function layerStart() {
    if (!samplesOn()) return; const c = nextFrom('start', catalogue().start); if (c) shot(c, { rel: LAYER.start, ref: REF.run, rate: 1 + (Math.random() - 0.5) * 0.04, fadeOut: 0.06 });
  }
  function layerStop() {
    if (!samplesOn()) return; const c = nextFrom('stop', catalogue().stop); if (c) shot(c, { rel: LAYER.stop, ref: REF.run, rate: 1 + (Math.random() - 0.5) * 0.04, fadeOut: 0.06 });
  }
  function layerBite(strength, kind) {
    if (!samplesOn() || !eng.state || eng.state.mode !== 2) return;
    const ctx = ctxOf(); if (ctx.currentTime - lastHitAt < 0.04) return; lastHitAt = ctx.currentTime;
    const cat = catalogue(), pool = [...cat.hit, ...cat.gore].filter((c) => c.tags[kind]);
    const c = nextFrom('bite:' + kind, pool); if (!c) return;                      // e.g. no metal clip: the engine's own ringing metal bite stands alone
    const sl = nextFrom('slice:' + c.file, slicesOf(c)); if (!sl) return;
    const flesh = kind === 'flesh';
    shot(c, { rel: flesh && c.kindOf === 'gore' ? LAYER.gore : LAYER.hit, ref: REF.cut, offset: sl.off, dur: sl.len, rate: clamp(1.06 - 0.12 * strength + (Math.random() - 0.5) * 0.12, 0.7, 1.4), delay: Math.random() * 0.012, vel: 0.35 + 0.65 * strength, fadeOut: 0.05 });
  }
  function startLoop(k, c) {
    const ctx = ctxOf(); const src = ctx.createBufferSource(); src.buffer = c.buf; src.loop = true; src.loopStart = c.loopStart || 0; src.loopEnd = c.loopEnd || c.dur;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 450; hp.Q.value = 0.6;   // texture only: the low harmonics stay the synth's (no pitch beating between the two)
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(hp); hp.connect(g); g.connect(eng.layerInput);
    src.start(0, Math.random() * (src.loopEnd - src.loopStart) + src.loopStart);
    loops[k] = { src, hp, g, c }; stats.loopStarts++;
  }
  function stopLoop(k, fade = 0.25) {
    const l = loops[k]; if (!l) return; loops[k] = null; const ctx = ctxOf();
    try { const t = ctx.currentTime; l.g.gain.cancelScheduledValues(t); l.g.gain.setTargetAtTime(0, t, fade / 4); l.src.stop(t + fade * 1.6 + 0.05); } catch (_) { /* already stopped */ }
    setTimeout(() => { try { l.src.disconnect(); l.hp.disconnect(); l.g.disconnect(); } catch (_) { /* gone */ } }, (fade * 1.6 + 0.25) * 1000);
  }
  function stopBed(fade = 0.2) {
    const b = bed.cur; if (!b) return; bed.cur = null; const ctx = ctxOf();
    try { const t = ctx.currentTime; b.ctl.gain.cancelScheduledValues(t); b.ctl.gain.setTargetAtTime(0, t, fade / 4); b.src.stop(t + fade * 1.6 + 0.05); } catch (_) { /* already stopped */ }
    setTimeout(() => { try { b.src.disconnect(); b.env.disconnect(); b.ctl.disconnect(); } catch (_) { /* gone */ } }, (fade * 1.6 + 0.25) * 1000);
  }
  function stopLayers(fade = 0.2) { stopLoop('idle', fade); stopLoop('full', fade); stopBed(fade); }
  // wet gore bed: overlapping slices of the gore/hit clips, level driven by "cutting flesh" (load > 0.5 AND flesh bites landing within the last 0.4 s)
  function bedStep(ctx, cutting) {
    if (!cutting) { if (bed.cur) stopBed(0.18); return; }
    const t = ctx.currentTime;
    if (bed.cur && t < bed.nextT - 0.14) { bed.cur.ctl.gain.setTargetAtTime(1, t, 0.06); return; }
    const cat = catalogue(), pool = [...cat.gore, ...cat.hit].filter((c) => c.tags.flesh); const c = nextFrom('bed', pool); if (!c) return;
    const len = Math.min(c.dur, 0.9 + Math.random() * 0.5), off = Math.random() * Math.max(0, c.dur - len);
    const gain = clamp(DB(LAYER.bed + REF.cut - c.loudDb), 0, 4), src = ctx.createBufferSource(); src.buffer = c.buf; src.playbackRate.value = 0.95 + Math.random() * 0.1;
    const wall = len / src.playbackRate.value, e = ctx.createGain(), ctl = ctx.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(gain, t + 0.14); e.gain.setValueAtTime(gain, t + wall - 0.2); e.gain.linearRampToValueAtTime(0, t + wall); ctl.gain.value = 1;
    src.connect(e); e.connect(ctl); ctl.connect(eng.layerInput); src.start(t, off, len);
    const prev = bed.cur; bed.cur = { src, env: e, ctl }; bed.nextT = t + wall; stats.bedSlices++;
    if (prev) { try { prev.ctl.gain.setTargetAtTime(1, t, 0.02); } catch (_) { /* ignore */ } setTimeout(() => { try { prev.src.disconnect(); prev.env.disconnect(); prev.ctl.disconnect(); } catch (_) { /* gone */ } }, 1800); }
  }
  function tick() {
    const ctx = ctxOf(); if (!eng || !ctx || disposed) return;
    if (ctx.state !== 'running') return;
    const s = eng.state || {}, running = engOn && s.mode === 2, t = ctx.currentTime;
    if (!(running && samplesOn())) { if (loops.idle || loops.full || bed.cur) stopLayers(0.25); if (!engOn && s.mode === 0 && !live.size) timerOff(); return; }
    const cat = catalogue(), rpm = s.rpm || 0;
    for (const k of ['idle', 'full']) {
      const c = cat[k][0]; if (!c) continue;
      if (!loops[k]) startLoop(k, c);
      const l = loops[k], rate = c.fundamentalHz ? clamp((s.hz || 0) / c.fundamentalHz, 0.5, 1.8) : 1;
      const cf = k === 'idle' ? 1 - smooth(3400, 6600, rpm) : smooth(5200, 9800, rpm);
      const g = DB(LAYER[k] + (k === 'idle' ? REF.idle : REF.run) - c.loudDb) * cf * (k === 'idle' ? 1 : 0.6 + 0.4 * clamp(s.load || 0, 0, 1));
      l.src.playbackRate.setTargetAtTime(rate, t, 0.05); l.g.gain.setTargetAtTime(Math.min(4, g), t, 0.08);
    }
    bedStep(ctx, want.load > 0.5 && (t - lastFleshT) < 0.4);
  }
  const timerOn = () => { if (!timer && !disposed) timer = setInterval(safe('tick', tick), 40); };
  const timerOff = () => { if (timer) { clearInterval(timer); timer = null; } };

  // ------------------------------------------------------------------------------------------------ public API
  Object.defineProperty(B, 'ready', { get() { if (disposed) return Promise.resolve(false); wantEngine = true; ensure(); return readyP; }, enumerable: true });
  Object.defineProperty(B, 'state', {
    enumerable: true,
    get() {
      let s = null, cs = null;
      try { s = (eng && eng.state) || null; cs = env.samples ? catalogue() : null; } catch (e) { fail('state', e); }
      return { ready: !!eng, kind: eng ? eng.kind : 'none', on: want.on && engOn, running: !!s && s.mode === 2, mode: s ? s.mode | 0 : 0, rpm: s ? +s.rpm || 0 : 0, hz: s ? +s.hz || 0 : 0, throttle: s ? +s.throttle || 0 : want.thr, load: s ? +s.load || 0 : want.load,
        layers: layersOn && !!env.samples?.enabled, samples: cs ? { start: cs.start.length, stop: cs.stop.length, idle: cs.idle.length, full: cs.full.length, hit: cs.hit.length, gore: cs.gore.length } : null, disposed };
    },
  });
  B.start = safe('start', () => {
    if (disposed || dead) return false;
    want.on = true; wantEngine = true;
    if (!eng) { ensure(); return true; }
    if (!engOn) doStart();
    return true;
  }, false);
  B.stop = safe('stop', () => {
    want.on = false;
    if (!eng || !engOn) return true;
    engOn = false; eng.stop(); layerStop(); stopLayers(0.3); timerOn();   // timer keeps running until the spin-down finished (tick stops itself)
    return true;
  }, false);
  B.setThrottle = safe('setThrottle', (v) => { if (disposed || dead) return; want.thr = clamp(+v || 0, 0, 1); if (eng) eng.setThrottle(want.thr); }, undefined);
  B.setLoad = safe('setLoad', (v) => { if (disposed || dead) return; want.load = clamp(+v || 0, 0, 1); if (eng) eng.setLoad(want.load); }, undefined);
  B.bite = safe('bite', (strength = 0.7, kind = 'flesh') => {
    if (!eng || disposed || dead) return;
    const k = kind === 1 || kind === 'wood' ? 'wood' : kind === 2 || kind === 'metal' ? 'metal' : 'flesh', s = clamp(+strength || 0, 0, 1);
    eng.bite(s, k); stats.bites++;
    if (k === 'flesh') { const ctx = ctxOf(); if (ctx) lastFleshT = ctx.currentTime; }
    layerBite(s, k);
  }, undefined);
  B.rev = safe('rev', (amount = 1) => { if (eng && !disposed && !dead) eng.rev(clamp(+amount || 0, 0, 1)); }, undefined);
  B.setLayers = safe('setLayers', (on) => { layersOn = !!on; if (!layersOn) stopLayers(0.15); return layersOn; }, false);
  B.tune = safe('tune', (o) => { if (!o || typeof o !== 'object') return; if (eng) eng.tune(o); else pendingTune = { ...(pendingTune || {}), ...o }; }, undefined);
  // game start / player death: everything silent NOW, engine kept for re-use (a later start() works again after reset())
  B.reset = safe('reset', () => {
    dead = false; want.on = false; want.thr = 0; want.load = 0; stopLayers(0.05); for (const v of [...live]) kill(v, 0.03);
    if (eng && (engOn || (eng.state && eng.state.mode !== 0))) { engOn = false; eng.setThrottle(0); eng.setLoad(0); eng.stop(); }
    engOn = false; timerOff();
  }, undefined);
  B.kill = safe('kill', () => {                              // player died: spin down, ignore the weapon until reset()
    if (dead) return; dead = true; want.on = false;
    if (eng && (engOn || (eng.state && eng.state.mode !== 0))) { eng.setThrottle(0); eng.setLoad(0); eng.stop(); }
    engOn = false; stopLayers(0.15); for (const v of [...live]) kill(v, 0.05);
  }, undefined);
  B.dispose = safe('dispose', () => {
    if (disposed) return; disposed = true; timerOff(); engOn = false; want.on = false;
    stopLayers(0.03); for (const v of [...live]) kill(v, 0.02);
    try { eng?.dispose(); } catch (_) { /* already gone */ }
    try { send?.disconnect(); } catch (_) { /* already gone */ }
    eng = null; send = null; resolveReady(false);
  }, undefined);
  B._debug = () => ({ stats: { ...stats }, loopInfo: Object.fromEntries(Object.entries(loops).filter(([, l]) => l).map(([k, l]) => [k, { rate: +l.src.playbackRate.value.toFixed(3), gain: +l.g.gain.value.toFixed(4) }])), created, live: live.size, loops: !!loops.idle + !!loops.full, bed: !!bed.cur, timer: !!timer, engOn, dead, disposed, failed, cat: { start: cache.start.length, hit: cache.hit.length, gore: cache.gore.length, idle: cache.idle.length, full: cache.full.length } });
  B._engine = () => eng;
  B._slices = () => { const o = {}; for (const c of [...catalogue().hit, ...catalogue().gore]) o[c.file] = slicesOf(c).map((x) => [+x.off.toFixed(3), +x.len.toFixed(3)]); return o; };
  return B;
}
