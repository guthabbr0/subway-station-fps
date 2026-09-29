// Procedural sound engine (game.audio). Every sound is synthesised in code (src/audio/*): recipes render off-thread in a
// module Worker into Float32Arrays, become cached AudioBuffers, and are played through a light graph
//   BufferSource -> gain [-> air-absorption lowpass -> Panner] -> bus, + shared convolution-reverb send (generated impulse)
//   buses -> DynamicsCompressor -> master low-pass (low-health / concussion muffle) -> master gain -> destination
// API: play(name, pos?, {volume, rate, pitchVar}), loop(name, {volume, rate, pos}) -> {stop(fade), set({volume, rate, pos})},
//      resume(), startAmbience(), stopAmbience(), update(dt), setMasterVolume(v), reset()
// Extras: voice cap + per-name rate/concurrency limits, ambience scheduler (hum, wind, drips, PA chime, vents, far moans, flicker),
//      dynamic tension bed during fights, heartbeat + muffle at low health, tinnitus/concussion after nearby blasts, hit-confirm ticks
//      from the enemy:hit bus event, pause/hidden-tab suspend, main-thread fallback if Workers are unavailable.
// Sample layer (src/audio/samples.js): CC-licensed recordings for monsters / gore / chainsaw are fetched + decoded lazily after resume(). Two human-curated groups
//      (assets/audio/human-monsters, human-chainsaw) are first-class; the older groups (monsters-oga, monsters-other, chainsaw) stay as extra variants in the same shuffle bag
//      (?oldsamples=0 drops them). Per-role policy table MIX decides whether a clip replaces or sits under the synth voice of the same name; same panner / bus / voice
//      limiter / rate limiter. game.audio.setSamples(bool) or ?samples=0 turns the whole layer off for A/B. game.audio.samples exposes counts / info().
// Chainsaw: game.audio.chainsaw = { ready, state, start, stop, setThrottle, setLoad, bite, rev, setMode, setLayers, setLayerDb, setEngineDb, tune, reset, dispose } (src/audio/chainsawBridge.js)
//      drives the RPM-driven worklet engine (chainsawEngine.js) as a 2D first-person sound through the sfx bus / limiter, with the recorded layers of src/audio/chainsawLayers.js
//      (pull-cord + catch, pitch-following idle / full / loaded beds, bite transients, gore bed, shutdown). ?saw=synth|mixed|samples picks the mode (mixed default);
//      tools/chainsaw-ab.html is the listening page. Legacy sawStart / sawIdle / sawFull / sawHit synth sounds keep working unchanged.
// Verification: await game.audio.analyze() renders every sound in-page and returns peak/RMS/duration/centroid rows;
//      node tools/audio-stats.mjs prints the same in Node (+ --wav / --png dumps); game.audio.tap() gives a MediaStream of the master output.
import { AUDIO_NAMES, bus } from './core.js';
import { META } from './audio/meta.js';
import { createSamples } from './audio/samples.js';
import { createChainsawBridge } from './audio/chainsawBridge.js';

const SR = 44100, MAX_VOICES = 32, MAX_LOOPS = 14, AMB = 0.8; // AMB = ambience bus gain
const EXTRA = ['heartbeat', 'tinnitus', 'tunnelWind', 'pipeClank', 'buzzFlicker', 'tensionBed', 'paAnnounce', 'hitTick', 'hitHead', 'hitKill'];
// render the sounds needed first (weapons, impacts, player) before ambience/train stuff
const FIRST = ['uiClick', 'pistol', 'shotgun', 'shotgunPump', 'punch', 'punchHit', 'weaponSwap', 'empty', 'impactConcrete', 'impactFlesh', 'impactMetal', 'step', 'hurt', 'explosion', 'zombieIdle', 'zombiePain', 'zombieDeath', 'zombieAlert', 'zombieAttack', 'zombieStep', 'chaingun', 'plasma', 'stationHum', 'tunnelWind', 'drip'];
const ORDER = [...new Set([...FIRST, ...AUDIO_NAMES, ...EXTRA])];

export function create(game) {
  let ctx = null, master, comp, lpm, sfxBus, ambBus, revIn, conv, revOut, worker = null, irData = null;
  let masterVol = 0.85, ducked = false, duckUntil = 0, pausedByUs = false, hbT = 0;
  const bank = new Map();      // name -> { raw: Float32Array[], bufs: AudioBuffer[], last: -1 }
  const warned = new Set(), lastAt = new Map(), lastLoud = new Map(), active = new Map(), lastPrio = new Map();
  const voices = [], loops = [], pending = []; let born = 0; // pending: sounds requested while a freshly created context is still 'suspended'
  const L = { x: 0, y: 0, z: 0 };                 // listener position (for distance culling / gains)
  const scratch = { x: 0, y: 0, z: 0 };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const mf = { cur: 20000, hit: 0 };  // master low-pass state (low-health muffle, concussion)
  const flag = game.params?.get?.('samples') ?? (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('samples') : null);
  const urlParam = (k) => game.params?.get?.(k) ?? (typeof location !== 'undefined' ? new URLSearchParams(location.search).get(k) : null);
  const sbase = urlParam('samplebase');   // ?samplebase=/path/ hosts assets/audio elsewhere (tests / CDN)
  const samples = createSamples({ ctx: () => ctx, enabled: flag !== '0', legacy: urlParam('oldsamples') !== '0', base: sbase ? new URL(sbase.endsWith('/') ? sbase : sbase + '/', location.href).href : undefined, warn: (...a) => console.warn('[audio]', ...a) });
  const chainsaw = createChainsawBridge({ ctx: () => ctx, dest: () => sfxBus, reverb: () => revIn, samples, mode: urlParam('saw'), warn: (...a) => console.warn('[audio]', ...a) });   // ?saw=synth|mixed|samples
  const amb = { on: false, hum: null, wind: null, bed: null, tension: 0, tDrip: 2, tChime: 40, tVent: 12, tClank: 25, tFlick: 8, tMoan: 45, tPA: 1e9, paX: 0, paZ: 0 };

  // ---------------------------------------------------------------------------------------------------------
  // bank / rendering
  // ---------------------------------------------------------------------------------------------------------
  const entry = (name) => { let e = bank.get(name); if (!e) bank.set(name, e = { raw: [], bufs: [], last: -1 }); return e; };
  function toBuffer(f32) { const b = ctx.createBuffer(1, f32.length, SR); b.copyToChannel(f32, 0); return b; }
  function onRendered(m) {
    if (m.ir) { irData = m.ir; if (ctx) applyIR(); return; }
    if (m.error) { console.warn('[audio] render failed:', m.name, m.error); return; }
    if (m.done) { try { worker?.terminate(); } catch (_) {} worker = null; return; }
    const e = entry(m.name);
    if (ctx) e.bufs[m.v] = toBuffer(m.data); else e.raw[m.v] = m.data;
    attachPendingLoops();
  }
  function startRendering() {
    try {
      worker = new Worker(new URL('./audio/worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => onRendered(e.data);
      worker.onerror = (e) => { console.warn('[audio] worker failed, rendering on the main thread:', e.message || e); try { worker.terminate(); } catch (_) {} worker = null; renderOnMain(); };
      worker.postMessage({ cmd: 'render', names: ORDER });
    } catch (e) { worker = null; renderOnMain(); }
  }
  async function renderOnMain() {
    const R = await import('./audio/render.js'), { makeImpulse } = await import('./audio/impulse.js');
    const jobs = [{ ir: true }];
    for (const name of ORDER) if (R.SOUNDS[name]) for (let v = 0; v < R.variantsOf(name); v++) jobs.push({ name, v });
    const step = () => {
      const t0 = performance.now();
      while (jobs.length && performance.now() - t0 < 6) {
        const j = jobs.shift();
        try { if (j.ir) onRendered({ ir: makeImpulse() }); else onRendered({ name: j.name, v: j.v, data: R.renderSound(j.name, j.v) }); } catch (e) { console.warn('[audio] render failed:', j.name, e); }
      }
      if (jobs.length) setTimeout(step, 4);
    };
    step();
  }
  function want(name) { // ask the worker to render `name` next
    const now = performance.now(); if (now - (lastPrio.get(name) || 0) < 1500) return; lastPrio.set(name, now);
    worker?.postMessage({ cmd: 'prio', name });
  }
  function pickBuf(name) {
    const e = bank.get(name); if (!e) return null;
    if (ctx && e.raw.length) { for (let v = 0; v < e.raw.length; v++) if (e.raw[v] && !e.bufs[v]) e.bufs[v] = toBuffer(e.raw[v]); e.raw.length = 0; }
    const n = e.bufs.length; if (!n) return null;
    let k = 0;
    if (n > 1) { k = Math.floor(Math.random() * n); if (k === e.last) k = (k + 1) % n; e.last = k; }
    return e.bufs[k] || e.bufs.find(Boolean) || null;
  }

  // ---------------------------------------------------------------------------------------------------------
  // context + bus graph
  // ---------------------------------------------------------------------------------------------------------
  function applyIR() {
    if (!ctx || !irData || !conv) return;
    const b = ctx.createBuffer(2, irData[0].length, SR); b.copyToChannel(irData[0], 0); b.copyToChannel(irData[1], 1);
    conv.buffer = b;
  }
  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    try { ctx = new AC({ sampleRate: SR, latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { ctx = null; return null; } }
    master = ctx.createGain(); master.gain.value = masterVol;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -13; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    lpm = ctx.createBiquadFilter(); lpm.type = 'lowpass'; lpm.frequency.value = 20000; lpm.Q.value = 0.5; mf.cur = 20000;
    comp.connect(lpm); lpm.connect(master); master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    ambBus = ctx.createGain(); ambBus.gain.value = AMB; ambBus.connect(comp);
    revIn = ctx.createGain(); conv = ctx.createConvolver(); conv.normalize = true; revOut = ctx.createGain(); revOut.gain.value = 1.0;
    revIn.connect(conv); conv.connect(revOut); revOut.connect(comp);
    applyIR();
    for (const [, e] of bank) { for (let v = 0; v < e.raw.length; v++) if (e.raw[v]) e.bufs[v] = toBuffer(e.raw[v]); e.raw.length = 0; }
    born = performance.now();
    ctx.onstatechange = () => { if (ctx.state === 'running') { attachPendingLoops(); flushPending(); } };
    chainsaw.onContext();   // a start() / .ready that arrived before the context existed can create the engine now
    return ctx;
  }
  function flushPending() {
    const now = performance.now();
    while (pending.length) { const p = pending.shift(); if (now - p.t < 700) play(p.name, p.pos, p.opts); }
  }
  function resume() {
    if (!ensureCtx()) return;
    samples.start();   // lazy, idle-time fetch + decode of the recorded clips (idempotent)
    if (ctx.state === 'suspended') ctx.resume().then(() => { attachPendingLoops(); flushPending(); if (amb.on) startAmbLoops(); }).catch(() => {});
    else { attachPendingLoops(); if (amb.on) startAmbLoops(); }
  }

  // ---------------------------------------------------------------------------------------------------------
  // listener + spatial helpers
  // ---------------------------------------------------------------------------------------------------------
  function syncListener() {
    const cam = game.camera; if (!cam || !ctx) return;
    const m = cam.matrixWorld.elements, l = ctx.listener;
    L.x = m[12]; L.y = m[13]; L.z = m[14];
    if (l.positionX) {
      l.positionX.value = m[12]; l.positionY.value = m[13]; l.positionZ.value = m[14];
      l.forwardX.value = -m[8]; l.forwardY.value = -m[9]; l.forwardZ.value = -m[10]; l.upX.value = m[4]; l.upY.value = m[5]; l.upZ.value = m[6];
    } else { l.setPosition(m[12], m[13], m[14]); l.setOrientation(-m[8], -m[9], -m[10], m[4], m[5], m[6]); }
  }
  function setPos(p, pos) { if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z); }
  function makePanner(m, pos, ref = m.ref) {
    const p = ctx.createPanner();
    p.panningModel = game.params?.get('hrtf') ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = m.roll ?? 1; p.maxDistance = 10000;
    setPos(p, pos); return p;
  }

  // ---------------------------------------------------------------------------------------------------------
  // one-shots
  // ---------------------------------------------------------------------------------------------------------
  function freeVoice(v, delayMs = 0) {
    if (v.done) return; v.done = true;
    const i = voices.indexOf(v); if (i >= 0) { voices[i] = voices[voices.length - 1]; voices.pop(); }
    active.set(v.name, Math.max(0, (active.get(v.name) || 1) - 1));
    const dc = () => { try { for (const s of v.srcs) s.disconnect(); v.g.disconnect(); v.aux.forEach((n) => n.disconnect()); } catch (_) {} };
    if (delayMs) setTimeout(dc, delayMs); else dc();
  }
  function killVoice(v, fade = 0.02) {
    if (v.done) return; const t = ctx.currentTime;
    try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, fade * 0.35); for (const s of v.srcs) s.stop(t + fade * 2); } catch (_) {}
    freeVoice(v, fade * 2500 + 50);
  }
  function makeRoom(pri, loud) {
    let worst = null, ws = 1e9;
    for (const v of voices) { const s = v.pri * 100 + v.loud * 10 + Math.min(2, v.end - ctx.currentTime); if (s < ws) { ws = s; worst = v; } }
    if (worst && (worst.pri < pri || (worst.pri === pri && worst.loud < loud))) { killVoice(worst); return true; }
    return false;
  }
  function duck(a, t) {
    const now = ctx.currentTime; ambBus.gain.cancelScheduledValues(now); ambBus.gain.setTargetAtTime(AMB * a, now, 0.015); ducked = true; duckUntil = now + t;
  }

  // play(name, pos?, {volume=1, rate=1, pitchVar=0.05})  (opts also accepts: ref (panner reference distance override), rev (reverb send override), amb/ambient (ambience bus, no distance cull))
  function play(name, pos, opts) { try { return playImpl(name, pos, opts); } catch (e) { fail('play ' + name, e); return null; } }
  function fail(what, e) { if (!warned.has(what)) { warned.add(what); console.warn(`[audio] ${what} failed:`, e); } }
  function playImpl(name, pos, opts) {
    const m = META[name];
    if (!m) { if (!warned.has(name)) { warned.add(name); console.warn(`[audio] unknown sound "${name}"`); } return null; }
    if (!ctx) return null;
    if (ctx.state !== 'running') {
      if (ctx.state === 'suspended' && !pausedByUs && performance.now() - born < 1500 && pending.length < 12) pending.push({ name, pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null, opts: opts ? { ...opts } : undefined, t: performance.now() });
      return null;
    }
    const now = ctx.currentTime;
    if (pos && !Number.isFinite(pos.x + pos.y + pos.z)) pos = null;   // ignore garbage positions
    const vol = (Number.isFinite(opts?.volume) ? opts.volume : 1) * m.vol, ref = opts?.ref ?? m.ref;
    let dist = 0, gd = 1;
    if (pos) {
      const dx = pos.x - L.x, dy = pos.y - L.y, dz = pos.z - L.z; dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      gd = dist <= ref ? 1 : ref / (ref + (dist - ref) * (m.roll ?? 1));
      if (!opts?.ambient && vol * gd < 0.012 && m.pri < 9) return null;
    }
    const loud = vol * gd;
    // per-name rate limit (a clearly louder / closer instance may still cut in) and per-name voice cap (steals the quietest)
    if (now - (lastAt.get(name) ?? -1e9) < m.gap && loud < (lastLoud.get(name) ?? 0) * 1.6) return null;
    if ((active.get(name) || 0) >= m.max) {
      let q = null; for (const v of voices) if (v.name === name && (!q || v.loud < q.loud)) q = v;
      if (q && loud > q.loud * 1.25) killVoice(q, 0.03); else return null;
    }
    // sample layer: null when off / not decoded yet / role not covered -> the synth voice plays exactly as before
    const sp = samples.plan(name, opts, m.pv);
    const buf = sp && !(sp.synth > 0) ? null : pickBuf(name);
    if (!buf && !sp) { want(name); return null; }
    if (voices.length >= MAX_VOICES && !makeRoom(m.pri, loud)) return null;
    lastAt.set(name, now); lastLoud.set(name, loud);
    const g = ctx.createGain(); g.gain.value = vol;
    const srcs = [], aux = []; let endAt = now, endSrc = null;
    if (buf) {
      const src = ctx.createBufferSource(); src.buffer = buf;
      const rate = Math.min(8, Math.max(0.05, (opts?.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (opts?.pitchVar ?? m.pv))));
      src.playbackRate.value = rate;
      if (sp && sp.synth !== 1) { const tg = ctx.createGain(); tg.gain.value = sp.synth; src.connect(tg); tg.connect(g); aux.push(tg); } else src.connect(g);
      srcs.push(src); endAt = now + buf.duration / rate; endSrc = src;
    }
    if (sp) {                                    // recorded clip: own trim gain (level match + policy) into the same voice gain -> identical spatial chain
      const ss = ctx.createBufferSource(); ss.buffer = sp.buf; ss.playbackRate.value = sp.rate;
      const sg = ctx.createGain(); sg.gain.value = sp.gain; ss.connect(sg); sg.connect(g); aux.push(sg);
      if (sp.fadeAt > 0) { sg.gain.setValueAtTime(sp.gain, now + sp.fadeAt); sg.gain.linearRampToValueAtTime(0, now + sp.wall); }
      srcs.push(ss); if (now + sp.wall >= endAt) { endAt = now + sp.wall; endSrc = ss; }
      ss.start(now, 0, sp.playDur);
    }
    let tail = g;
    const dest = opts?.amb ? ambBus : sfxBus;
    if (pos) {
      if (dist > 16 && m.pri < 9) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(1300, 16000 / (1 + (dist - 10) * 0.09)); g.connect(lp); tail = lp; aux.push(lp); }
      const p = makePanner(m, pos, ref); tail.connect(p); p.connect(dest); aux.push(p);
    } else tail.connect(dest);
    const rev = opts?.rev ?? m.rev;
    if (rev > 0 && conv) { const s = ctx.createGain(); s.gain.value = rev * Math.sqrt(gd); g.connect(s); s.connect(revIn); aux.push(s); }
    const v = { name, src: srcs[0], srcs, g, aux, pri: m.pri, loud, end: endAt, done: false, stop(fade = 0.05) { killVoice(v, fade); } };
    endSrc.onended = () => freeVoice(v);
    voices.push(v); active.set(name, (active.get(name) || 0) + 1);
    if (buf) srcs[0].start();
    if (m.duck) duck(m.duck.a, m.duck.t);
    if (pos && dist < 5.5 && (name === 'explosion' || name === 'bfgHit')) { const k = 1 - dist / 5.5; play('tinnitus', null, { volume: 0.5 * k }); mf.hit = Math.max(mf.hit, 0.8 + 1.6 * k); } // concussion: ringing + muffled hearing
    return v;
  }

  // ---------------------------------------------------------------------------------------------------------
  // loops
  // ---------------------------------------------------------------------------------------------------------
  function attach(h) {
    if (!ctx || ctx.state !== 'running' || h.node || h.stopped) return;
    const buf = pickBuf(h.name); if (!buf) { want(h.name); return; }
    const m = META[h.name] || META.uiClick;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = h.rate;
    const g = ctx.createGain(); g.gain.value = 0; src.connect(g);
    const now = ctx.currentTime, aux = [];
    let panner = null;
    if (h.pos) { panner = makePanner(m, h.pos); g.connect(panner); panner.connect(h.amb ? ambBus : sfxBus); aux.push(panner); } else g.connect(h.amb ? ambBus : sfxBus);
    if (m.rev > 0 && conv && !h.amb) { const s = ctx.createGain(); s.gain.value = m.rev; g.connect(s); s.connect(revIn); aux.push(s); }
    g.gain.setTargetAtTime(h.volume * m.vol, now, 0.05);
    src.start(0, Math.random() * buf.duration);
    h.node = { src, g, panner, aux, m }; h.appliedV = h.volume; h.appliedR = h.rate;
  }
  function attachPendingLoops() { for (const h of loops) if (!h.node && !h.stopped) attach(h); }
  function loop(name, o = {}) { try { return loopImpl(name, o); } catch (e) { fail('loop ' + name, e); return { stop() {}, set() {} }; } }
  function loopImpl(name, o = {}) {
    const m = META[name];
    if (!m) { if (!warned.has(name)) { warned.add(name); console.warn(`[audio] unknown sound "${name}"`); } return { stop() {}, set() {} }; }
    for (let i = loops.length - 1; i >= 0; i--) if (loops[i].stopped) loops.splice(i, 1);
    if (loops.length >= MAX_LOOPS) { const old = loops.find((l) => !l.amb); if (old) old.stop(0.05); }
    const h = {
      name, volume: Number.isFinite(o.volume) ? o.volume : 1, rate: Number.isFinite(o.rate) ? Math.min(4, Math.max(0.1, o.rate)) : 1, pos: o.pos && Number.isFinite(o.pos.x + o.pos.y + o.pos.z) ? { x: o.pos.x, y: o.pos.y, z: o.pos.z } : null, amb: !!o.amb, stopped: false, node: null, appliedV: -1, appliedR: -1, dop: 1,
      stop(fade = 0.1) {
        if (h.stopped) return; h.stopped = true; const n = h.node; if (!n || !ctx) return; h.node = null;
        const t = ctx.currentTime;
        try { n.g.gain.cancelScheduledValues(t); n.g.gain.setTargetAtTime(0, t, Math.max(0.005, fade / 4)); n.src.stop(t + fade * 1.6 + 0.05); } catch (_) {}
        setTimeout(() => { try { n.src.disconnect(); n.g.disconnect(); n.aux.forEach((x) => x.disconnect()); } catch (_) {} }, (fade * 1.6 + 0.2) * 1000);
      },
      set(p = {}) { try { h.setImpl(p); } catch (e) { fail('loop.set ' + name, e); } },
      setImpl(p) {
        if (h.stopped) return;
        if (Number.isFinite(p.volume)) h.volume = p.volume;
        if (Number.isFinite(p.rate)) h.rate = Math.min(4, Math.max(0.1, p.rate));
        if (p.pos && Number.isFinite(p.pos.x + p.pos.y + p.pos.z)) { if (!h.pos) h.pos = { x: 0, y: 0, z: 0 }; h.pos.x = p.pos.x; h.pos.y = p.pos.y; h.pos.z = p.pos.z; }
        const n = h.node; if (!n) return;
        const t = ctx.currentTime;
        if (Math.abs(h.volume - h.appliedV) > 0.003) { n.g.gain.setTargetAtTime(h.volume * n.m.vol, t, 0.04); h.appliedV = h.volume; }
        if (!n.m.doppler && Math.abs(h.rate - h.appliedR) > 0.002) { n.src.playbackRate.setTargetAtTime(h.rate, t, 0.05); h.appliedR = h.rate; }
        if (n.panner && h.pos) setPos(n.panner, h.pos);
        if (n.m.doppler) { // cheap doppler from radial speed relative to the listener
          if (h.pos && p.pos) {
            const dt = t - (h.lastT ?? t), dx = h.pos.x - L.x, dy = h.pos.y - L.y, dz = h.pos.z - L.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
            if (dt > 0.004 && dt < 0.25 && h.lastD !== undefined) { const vr = (d - h.lastD) / dt; h.dop += ((1 / (1 + Math.max(-120, Math.min(120, vr)) / 343)) - h.dop) * 0.35; }
            h.lastT = t; h.lastD = d;
          }
          n.src.playbackRate.setTargetAtTime(h.rate * h.dop, t, 0.04);
        }
      },
    };
    loops.push(h); attach(h); return h;
  }
  function stopLoops(fade = 0.05) { for (const h of loops.slice()) h.stop(fade); loops.length = 0; amb.hum = amb.wind = amb.bed = null; amb.tension = 0; }

  // ---------------------------------------------------------------------------------------------------------
  // ambience
  // ---------------------------------------------------------------------------------------------------------
  function startAmbLoops() {
    if (!ctx) return;
    if (!amb.hum || amb.hum.stopped) amb.hum = loop('stationHum', { volume: 0.9, amb: true });
    if (!amb.wind || amb.wind.stopped) amb.wind = loop('tunnelWind', { volume: 0.8, amb: true });
  }
  function startAmbience() {
    amb.on = true; amb.tDrip = rnd(1, 3); amb.tChime = rnd(30, 60); amb.tVent = rnd(8, 16); amb.tClank = rnd(18, 35); amb.tFlick = rnd(6, 12); amb.tMoan = rnd(30, 60); amb.tPA = 1e9;
    startAmbLoops();
  }
  function stopAmbience() { amb.on = false; amb.hum?.stop(0.8); amb.wind?.stop(0.8); amb.bed?.stop(0.8); amb.hum = amb.wind = amb.bed = null; amb.tension = 0; }
  function ambPlay(name, x, y, z, volume, extra) { scratch.x = x; scratch.y = y; scratch.z = z; return play(name, scratch, { volume, amb: true, ambient: true, ...extra }); }
  function updateAmbience(dt) {
    if (!amb.on) return;
    const lx = L.x, lz = L.z, cl = (v, a, b) => Math.min(b, Math.max(a, v));
    if ((amb.tDrip -= dt) < 0) { amb.tDrip = rnd(1.3, 4.5); ambPlay('drip', cl(lx + rnd(-20, 20), -30, 30), rnd(0, 0.3), rnd(-9, 9), rnd(0.4, 0.9)); }
    if ((amb.tFlick -= dt) < 0) { amb.tFlick = rnd(5, 14); ambPlay('buzzFlicker', lx + rnd(-8, 8), 6.3, rnd(-4, 4), rnd(0.5, 1)); }
    if ((amb.tVent -= dt) < 0) { amb.tVent = rnd(12, 30); ambPlay('ventHiss', cl(lx + rnd(-25, 25), -30, 30), rnd(3, 6), rnd(-10, 10), rnd(0.5, 1)); }
    if ((amb.tClank -= dt) < 0) { amb.tClank = rnd(18, 45); ambPlay('pipeClank', cl(lx + rnd(-35, 35), -50, 50), rnd(3, 6), rnd(-11, 11), rnd(0.6, 1), { ref: 14 }); }
    if ((amb.tChime -= dt) < 0) { amb.tChime = rnd(50, 110); amb.paX = lx + rnd(-8, 8); amb.paZ = rnd(-4, 4); ambPlay('stationChime', amb.paX, 6, amb.paZ, 0.8, { rev: 0.5 }); if (Math.random() < 0.6) amb.tPA = 3.6; }
    if ((amb.tPA -= dt) < 0) { amb.tPA = 1e9; ambPlay('paAnnounce', amb.paX, 6, amb.paZ, 0.75, { rev: 0.5 }); }
    if ((amb.tMoan -= dt) < 0) { amb.tMoan = rnd(28, 70); ambPlay('zombieIdle', lx + (Math.random() < 0.5 ? -1 : 1) * rnd(55, 80), 1.5, rnd(-8, 8), 0.5, { rev: 0.8, pitchVar: 0.12, ref: 26 }); }
  }

  // ---------------------------------------------------------------------------------------------------------
  // frame update / pause / reset
  // ---------------------------------------------------------------------------------------------------------
  function update(dt) { try { updateImpl(dt); } catch (e) { fail('update', e); } }
  function updateImpl(dt) {
    if (!ctx) return;
    dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
    syncListener();
    const now = ctx.currentTime;
    if (ducked && now > duckUntil) { ambBus.gain.setTargetAtTime(AMB, now, 0.35); ducked = false; }
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end < now - 0.6) freeVoice(voices[i]);
    updateAmbience(dt);
    const p = game.player;
    if (game.state === 'dead' || (p && p.alive === false)) chainsaw.kill();   // dying with the saw running: spin down, ignore the weapon until the next reset()
    // master low-pass: muffled hearing when nearly dead / dead / just concussed by a blast
    let f = 20000;
    if (p) { if (!p.alive) f = 1200; else if (p.health < 40) f = 20000 * Math.pow(0.11, 1 - Math.max(0, p.health) / 40); }
    if (mf.hit > 0) { mf.hit -= dt; f = Math.min(f, 1300 * Math.pow(15, 1 - Math.max(0, mf.hit) / 2.4)); }
    if (Math.abs(f - mf.cur) > mf.cur * 0.03) { lpm.frequency.setTargetAtTime(f, now, p && !p.alive ? 0.6 : 0.12); mf.cur = f; }
    // dynamic tension bed while a wave is being fought
    if (amb.on) {
      const w = game.waves; let tgt = 0;
      if (game.state === 'playing' && p && p.alive && w && (w.state === 'fight' || w.state === 'spawning' || w.state === 'trainIn')) { const n = game.enemies?.aliveCount?.() ?? 0; tgt = w.state === 'trainIn' ? 0.3 : Math.min(1, 0.3 + n / 14); }
      amb.tension += (tgt - amb.tension) * Math.min(1, dt * 0.5);
      if (amb.tension > 0.03 && !amb.bed) amb.bed = loop('tensionBed', { volume: 0, amb: true });
      if (amb.bed) { amb.bed.set({ volume: amb.tension * 0.9 }); if (tgt === 0 && amb.tension < 0.02) { amb.bed.stop(1.2); amb.bed = null; } }
    }
    if (p && p.alive && game.state === 'playing' && p.health < 30) { // heartbeat when hurt badly
      hbT -= dt; if (hbT <= 0) { const k = 1 - p.health / 30; hbT = 1.15 - 0.55 * k; play('heartbeat', null, { volume: 0.35 + 0.65 * k }); }
    } else hbT = 0;
  }
  function reset() {
    stopLoops(0.04); for (const v of voices.slice()) if (ctx) killVoice(v, 0.03);
    ducked = false; mf.hit = 0; hbT = 0; chainsaw.reset();
    if (ctx) { const t = ctx.currentTime; ambBus.gain.setTargetAtTime(AMB, t, 0.05); lpm.frequency.setTargetAtTime(20000, t, 0.05); mf.cur = 20000; }
  }
  function pollPause() {
    if (!ctx) return;
    if ((game.state === 'paused' || document.hidden) && ctx.state === 'running') { pausedByUs = true; ctx.suspend().catch(() => {}); }
    else if (pausedByUs && game.state !== 'paused' && !document.hidden) { pausedByUs = false; ctx.resume().catch(() => {}); }
  }

  // ---------------------------------------------------------------------------------------------------------
  // verification helpers (used from tests / --eval)
  // ---------------------------------------------------------------------------------------------------------
  async function renderRaw(name, v = 0) { const R = await import('./audio/render.js'); return R.renderSound(name, v); }
  async function analyze(names = AUDIO_NAMES.concat(EXTRA)) {
    const R = await import('./audio/render.js'), A = await import('./audio/analyze.js'), rows = [], fps = {};
    for (const name of names) {
      const data = R.renderSound(name, 0); if (!data) { rows.push({ name, missing: true }); continue; }
      const s = A.statsOf(data); fps[name] = A.fingerprint(data);
      rows.push({ name, dur: +s.dur.toFixed(2), peak: +s.peak.toFixed(2), rmsDb: +s.rms.toFixed(1), l200Db: +s.l200.toFixed(1), centroid: Math.round(s.centroid), t40: +s.t40.toFixed(2), clip: s.clip, loop: !!R.SOUNDS[name].loop, variants: R.variantsOf(name) });
    }
    let minD = 1e9, pair = '';
    const keys = Object.keys(fps); for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) { const d = A.fpDist(fps[keys[i]], fps[keys[j]]); if (d < minD) { minD = d; pair = keys[i] + '~' + keys[j]; } }
    return { rows, closestPair: pair, closestDist: +minD.toFixed(2) };
  }

  return {
    names: ORDER,
    play, loop, resume, startAmbience, stopAmbience, update, reset,
    // A/B switch for the recorded-sample layer (also ?samples=0 at load). Off = pure synth, exactly the previous behaviour; decoded clips stay in memory so it can be flipped back instantly.
    setSamples(on) { samples.setEnabled(!!on); if (on && ctx) samples.start(); return samples.enabled; },
    get samples() { return samples; },
    chainsaw,
    setMasterVolume(v) { masterVol = Math.max(0, Math.min(1.5, v)); if (ctx) master.gain.setTargetAtTime(masterVol, ctx.currentTime, 0.02); },
    init() {
      startRendering();
      // hit-confirmation ticks: body / headshot / kill (2D, subtle; the visual hit marker lives in hud.js)
      bus.on('enemy:hit', (e) => { if (game.state === 'playing' && e && e.amount > 0 && e.source !== 'enemy') play(e.killed ? 'hitKill' : e.part === 'head' ? 'hitHead' : 'hitTick'); });
      const unlock = () => { resume(); if (ctx && ctx.state === 'running') for (const ev of ['pointerdown', 'keydown', 'touchstart']) removeEventListener(ev, unlock, true); };
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlock, true);
      setInterval(pollPause, 250);
    },
    get ready() { let n = 0; for (const name of ORDER) { const e = bank.get(name); if (e && (e.bufs.length || e.raw.length)) n++; } return n; },
    get state() { return ctx ? ctx.state : 'none'; },
    get activeVoices() { return voices.length; },
    get context() { return ctx; },
    // test hook: MediaStream of the final master output (for recording / level checks)
    tap() { ensureCtx(); const d = ctx.createMediaStreamDestination(); master.connect(d); return d.stream; },
    get master() { return master || null; },   // final master GainNode (tests attach a recorder / analyser here)
    renderRaw, analyze,
  };
}
