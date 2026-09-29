// Recorded layers for the RPM-driven chainsaw engine (chainsawEngine.js). The synthesised engine stays the responsive core (throttle / load / bite react instantly); the
// human-curated recordings (assets/audio/human-chainsaw, + the 6 older assets/audio/chainsaw clips as extra variants) ride on top of it:
//
//   pull-cord + catch   sawStart_01/02/03 replace the synth cord at start(): the recorded rip is time-fitted to the engine's own ~0.54 s cord (playbackRate), the silent
//                       "dead air" between rip and catch is cut out, the recorded catch lands on the engine's catch, and the engine is ducked while the recording plays
//                       (its cord ratchet would be a SECOND cord) and faded in over the catch: one saw starting. The recorded idle warm-up tail is high-passed (sweeping up as it
//                       fades) so the low harmonics of the recording and of the synth never sound together.
//   idle / full / loaded loops   pitch-following bed: playbackRate = engine hz / clip.fundamentalHz (telemetry with slope extrapolation), constant-power crossfade
//                       idle -> full by rpm and full -> loaded (the two manifest clips flagged loaded:true) by load; high-passed with a corner that follows the firing rate
//                       (~6 x hz, 560..1500 Hz, 4th order) so the tonal low harmonics stay the synth's and cannot beat against it. A loop only exists while it is audible and is
//                       re-drawn (never the previous one) each time, so a long session does not lock onto one recording.
//   bite transients     round-robin (no-repeat window) over slices of the sawHit rips / sawGore one-shots, velocity scaled, rate varied, 0-12 ms humanising delay and a random
//                       micro-offset into the slice; the real bog-down bites (sawHit_08-10) only as a rare accent (one at a time) - never a sample per tooth at 8.75 hits/s.
//   wet gore bed        sawGore loops (chicken / guts / blood gush) while load > 0.5 and flesh bites keep landing, hopping between clips every ~2 s with a crossfade.
//   shutdown            sawShutdown_01/02 from the point where the recorded engine starts dying, rate-matched to the current firing rate (no pitch jump), the synth is ducked to
//                       -14 dB after its own last pop. Only when the saw was at idle (rpm < 4800): from high revs the synth spin-down passes through idle by itself.
//   rev()               NOT layered: `node tools/chainsaw-ab.mjs rev` measures it - the engine's rev(1) blip peaks at 162 Hz after 0.36 s and is back within 10 % of idle at 1.18 s;
//                       the recorded revs hold full throttle (01, 03), decel from 220 Hz over 1.5 s (02, 06), or peak at 0.6-1.3 s (04, 05): playing one would put a second, differently
//                       timed rev on top of the engine. The pitch-following full bed already carries the real texture through every rev (sawRev clips are therefore not even decoded).
//
// Measured with tools/chainsaw-ab.mjs (real-time capture of the master output in headless Chromium; numbers in the final report):
//   * double cord: ratchet band (1.5-6 kHz) in the cord window is identical with the duck (mixed = recording alone, within 0.5 dB); without it the synth cord adds +2..+7 dB
//   * catch alignment: recorded catch at 0.535 s, engine catch 0.49-0.58 s (telemetry) -> -31..+48 ms; level through the hand-over stays within 1.6 dB steps
//   * layer level: -6.5..-7 dB re the engine adds only +0.5..+1.5 dB loudness (l200w) but +2..+4 dB in the 3-8 kHz band at idle, +1..+2 dB in the cut; 60-250 Hz and the pitch track
//     (94 % within 8 % of the firing rate, same as the synth) are untouched; steady-state beating lines stay inside the synth's own range for every high-pass corner tried
//   * loop layers follow the engine's firing rate within 1.2 % mean / 3.4 % p90; every loop join is not worse than the material itself
//
// Modes (chainsawBridge.js decides): 'mixed' = engine + layers with the levels below (high-passed against the synth); 'samples' = recordings in front (the engine keeps
// running 26 dB down so every control / telemetry still works; loops full band). All levels are dB relative to the engine's own level in that state (REF) and are compensated
// with each clip's measured loudness (samples.js: same weighted loudest-200 ms metric as the synth bank, after the layer's own high-pass).

const DB = (x) => Math.pow(10, x / 20);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);

// engine loudest-200 ms weighted level at the engine output in each state (dBFS; renderCore + tools/audio-verify.mjs chainsaw)
export const REF = { idle: -25.5, run: -17.5, cut: -15.5, cord: -19.8 };
// layer level presets, dB re the engine's level in that state (mixed: loops -6.5..-7 dB, bites -1.5 dB: clearly audible texture, engine rpm behaviour unmasked - `node tools/chainsaw-ab.mjs levels`)
export const LEVELS = {
  mixed:   { idle: -6.5, full: -7, loaded: -6.5, bite: -1.5, bog: -6, bed: -11, cord: 0, shut: -3 },
  samples: { idle: 0, full: 0, loaded: 0, bite: -3.5, bog: -6, bed: -3, cord: 0, shut: 2 },
};
// pull-cord clips (source seconds): pull = the AUDIBLE part of the rip (source level above ~ -33 dB; the rest of the recording is dead air), fitted to the engine's cord time with
// playbackRate 1.0-1.2; catch = onset of the first ignition bang; tail = seconds of recorded engine kept after the catch; w = pick weight
export const START_CFG = {
  'sawStart_01.ogg': { pull: [0.12, 0.62], catch: 1.402, w: 1 },
  'sawStart_02.ogg': { pull: [0.22, 0.80], catch: 1.336, w: 1 },
  'sawStart_03.ogg': { pull: [1.30, 1.80], catch: 2.596, w: 0.6, tail: 0.55 },     // second (failed) pull, catch straight into a rev: only the catch + the first 0.55 s are used
};
// shutdown clips: where the recorded engine starts to die (source seconds), and the firing rate at idle before that
export const SHUT_CFG = { 'sawShutdown_01.ogg': { from: 0.66, idleHz: 62 }, 'sawShutdown_02.ogg': { from: 0.86, idleHz: 64 } };
const CATCH_P = 0.535;               // engine catch time after start(): 0.49-0.58 s over 40 seeds (median 0.543)

export function createSawLayers(env) {
  const L = {};
  const ctx = () => env.ctx();
  const S = () => env.samples;
  const out = () => env.out();
  const st = { level: 0, mode: 'mixed', shots: 0, loopStarts: 0, bedStarts: 0, cords: 0, shutdowns: 0, bites: 0, bogs: 0 };
  const live = new Set();            // one-shots currently alive (leak accounting)
  const loops = { idle: null, full: null, loaded: null };
  const bed = { cur: null, hopAt: 0 };
  const recent = new Map();          // pick key -> recent items (no-repeat windows)
  let lastBiteAt = -1, lastBogAt = -9, cordV = null;
  L.force = { start: null, idle: null, full: null, loaded: null };                       // test hook: pin the pull-cord clip (tools/chainsaw-ab.mjs)
  L.tuning = { hzMul: 6, hpMin: 560, hpMax: 1500, wobble: 0 };   // loop high-pass corner = clamp(hzMul x firing rate, hpMin, hpMax); wobble = +-fraction of slow random rate drift (decorrelates the recording from the synth)
  const lv = () => LEVELS[st.mode] || LEVELS.mixed;
  const samplesMode = () => st.mode === 'samples';

  // ------------------------------------------------------------------------------------------------ helpers
  // draw from `list` avoiding the last `win` picks of this key (weights optional)
  function pick(key, list, win = 2, weightOf = null) {
    if (!list.length) return null;
    let rec = recent.get(key); if (!rec) recent.set(key, rec = []);
    const ok = list.filter((x) => !rec.includes(x)), pool = ok.length ? ok : list.filter((x) => x !== rec[rec.length - 1]);
    const p = pool.length ? pool : list;
    let x, tot = 0; if (weightOf) for (const y of p) tot += weightOf(y);
    if (weightOf && tot > 0) { let r = Math.random() * tot; x = p[p.length - 1]; for (const y of p) { r -= weightOf(y); if (r <= 0) { x = y; break; } } } else x = p[Math.floor(Math.random() * p.length)];
    rec.push(x); while (rec.length > Math.min(win, list.length - 1)) rec.shift();
    return x;
  }
  function biquad(type, f, q = 0.707) { const b = ctx().createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  // two cascaded high-passes = 4th order (Butterworth Qs)
  function hp4(f) { return [biquad('highpass', f, 0.5412), biquad('highpass', f, 1.3066)]; }
  function drop(nodes, delayMs = 60) { setTimeout(() => { for (const n of nodes) { try { n.disconnect(); } catch (_) { /* gone */ } } }, delayMs); }

  function kill(v, fade = 0.03) {
    if (!v) return; live.delete(v); const c = ctx(); if (!c) return;
    try { const t = c.currentTime; for (const g of v.gains || [v.g]) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, fade * 0.4); } for (const s of v.srcs) s.stop(t + fade * 2 + 0.01); } catch (_) { /* already stopped */ }
    drop(v.nodes, fade * 2000 + 100);
  }
  // one-shot: BufferSource [-> hp] -> gain -> layer bus (a high-passed layer is levelled by the clip's post-700 Hz-HP loudness, a wide-open one by its full-band loudness)
  function shot(c, o) {
    const cx = ctx(); if (!cx) return null;
    while (live.size >= 12) { const old = live.values().next().value; kill(old, 0.02); }
    const hi = o.hp >= 500, rel = o.rel, loud = hi && Number.isFinite(c.loudHP) ? c.loudHP : c.loudDb;   // loudHP / peakHP were measured after a 700 Hz high-pass: only valid for layers filtered that high
    const pkc = hi ? (c.peakHP || c.peak || 1) : (c.peak || 1), gain = Math.min(clamp(DB(rel + st.level + o.ref - loud), 0, 8) * (o.vel ?? 1) * (0.9 + 0.2 * Math.random()), 0.55 / pkc * (o.vel ?? 1));   // level match, capped so the transient peak stays <= ~-5 dBFS before the bus
    const rate = o.rate ?? 1, dur = o.dur ?? c.dur, wall = dur / rate, t = cx.currentTime + (o.delay ?? 0);
    const src = cx.createBufferSource(); src.buffer = c.buf; src.playbackRate.value = rate;
    const g = cx.createGain(), nodes = [src, g]; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(o.fadeIn ?? 0.004, wall * 0.3));
    const fo = Math.min(o.fadeOut ?? 0.03, wall * 0.5); if (wall > fo * 1.5) { g.gain.setValueAtTime(gain, t + wall - fo); g.gain.linearRampToValueAtTime(0, t + wall); }
    let head = src;
    if (o.hp) { const f = biquad('highpass', o.hp, 0.62); head.connect(f); head = f; nodes.push(f); }
    head.connect(g); g.connect(out());
    const v = { srcs: [src], g, nodes, end: t + wall };
    live.add(v); st.shots++;
    src.onended = () => { live.delete(v); drop(nodes, 40); };
    src.start(t, o.offset ?? 0, dur);
    return v;
  }

  // ------------------------------------------------------------------------------------------------ pull cord + catch (start) and shutdown (stop)
  // pick the pull-cord clip (test hook L.force.start pins it) and measure the level of its rip once; null when no start clip is decoded yet (the synth cord plays alone)
  function cordPlan() {
    const list = S()?.saw?.start?.filter((c) => START_CFG[c.file]) || []; if (!list.length) return null;
    const c = (L.force.start && list.find((x) => x.file === L.force.start)) || pick('start', list, 1, (x) => START_CFG[x.file].w || 1), cfg = START_CFG[c.file], cx = ctx();
    if (!c.cordDb) {                                   // level of the rip (weighted loudest 200 ms), measured once
      try { const seg = c.buf.getChannelData(0).subarray(Math.round(cfg.pull[0] * c.buf.sampleRate), Math.round(cfg.pull[1] * c.buf.sampleRate)); const d = S().loudness?.(seg); c.cordDb = Number.isFinite(d) ? d : c.loudDb - 2; } catch (e) { c.cordDb = c.loudDb - 2; }
    }
    return { c, cfg, cx };
  }
  // start(): schedules the recorded rip + catch; returns { catchT, keep, voice, clip } (the bridge ducks the engine around catchT) or null
  L.cord = () => {
    const P = cordPlan(); if (!P) return null;
    const { c, cfg, cx } = P, t0 = cx.currentTime + 0.004, [a, b] = cfg.pull;
    const rateA = clamp((b - a) / (CATCH_P - 0.006), 0.92, 1.3), lenA = (b - a) / rateA;             // the rip fits the engine's cord time (it ends as the catch starts)
    const gain = clamp(DB(lv().cord + st.level + REF.cord - c.cordDb), 0, 6) * rnd(0.95, 1.05);
    const nodes = [], srcs = [];
    // A: the rip
    const sa = cx.createBufferSource(); sa.buffer = c.buf; sa.playbackRate.value = rateA; const ga = cx.createGain(); ga.gain.setValueAtTime(0, t0); ga.gain.linearRampToValueAtTime(gain, t0 + 0.004);
    ga.gain.setValueAtTime(gain, t0 + lenA - 0.02); ga.gain.linearRampToValueAtTime(0, t0 + lenA);
    sa.connect(ga); ga.connect(out()); sa.start(t0, a, b - a); nodes.push(sa, ga); srcs.push(sa);
    // B: the catch + recorded idle warm-up, high-passed by a sweep once the synth takes over
    const tB = t0 + CATCH_P - 0.02, keep = cfg.tail ?? (samplesMode() ? 1.6 : 1.25), hold = samplesMode() ? Math.min(0.5, keep * 0.4) : Math.min(0.3, keep * 0.4);
    const sb = cx.createBufferSource(); sb.buffer = c.buf; sb.playbackRate.value = 1 + rnd(-0.015, 0.015);
    const hp = biquad('highpass', 45, 0.62), gb = cx.createGain();
    gb.gain.setValueAtTime(0, tB); gb.gain.linearRampToValueAtTime(gain, tB + 0.014); gb.gain.setValueAtTime(gain, tB + hold); gb.gain.linearRampToValueAtTime(0, tB + keep);
    if (!samplesMode()) { hp.frequency.setValueAtTime(45, tB + 0.1); hp.frequency.exponentialRampToValueAtTime(760, tB + Math.min(0.62, keep * 0.7)); }
    sb.connect(hp); hp.connect(gb); gb.connect(out()); sb.start(tB, cfg.catch - 0.02, keep + 0.05); nodes.push(sb, hp, gb); srcs.push(sb);
    const v = { srcs, g: gb, gains: [ga, gb], nodes, end: tB + keep }; live.add(v); st.cords++; cordV = v;
    sb.onended = () => { live.delete(v); if (cordV === v) cordV = null; drop(nodes, 60); };
    return { catchT: CATCH_P, keep, voice: v, clip: c.file };
  };
  L.shutdown = (s) => {
    const list = S()?.saw?.stop?.filter((c) => SHUT_CFG[c.file]) || []; if (!list.length || !s || s.rpm > 4800 || s.hz < 20) return null;
    const c = pick('stop', list, 1), cfg = SHUT_CFG[c.file];
    const rate = clamp(s.hz / cfg.idleHz, 0.72, 1.15), dur = Math.max(0.2, c.dur - cfg.from - 0.01);
    const v = shot(c, { rel: lv().shut, ref: REF.idle, offset: cfg.from, dur, rate, delay: 0.004, fadeIn: 0.008, fadeOut: 0.12, hp: 0 });
    if (v) st.shutdowns++;
    return v ? { wall: dur / rate, clip: c.file } : null;
  };

  // ------------------------------------------------------------------------------------------------ pitch-following loops
  function startLoop(k, c) {
    const cx = ctx(), src = cx.createBufferSource(); src.buffer = c.buf; src.loop = true; src.loopStart = c.loopStart || 0; src.loopEnd = c.loopEnd || c.dur;
    const g = cx.createGain(); g.gain.value = 0; const nodes = [src, g]; let head = src, hp = null;
    hp = hp4(samplesMode() ? 55 : 500); for (const f of hp) { head.connect(f); head = f; nodes.push(f); }
    head.connect(g); g.connect(out());
    src.start(0, rnd(0, (src.loopEnd - src.loopStart) * 0.9) + src.loopStart);
    loops[k] = { src, g, hp, nodes, c, zeroSince: 0, born: cx.currentTime }; st.loopStarts++;
  }
  function stopLoop(k, fade = 0.25) {
    const l = loops[k]; if (!l) return; loops[k] = null; const cx = ctx();
    try { const t = cx.currentTime; l.g.gain.cancelScheduledValues(t); l.g.gain.setTargetAtTime(0, t, fade / 4); l.src.stop(t + fade * 1.6 + 0.05); } catch (_) { /* already stopped */ }
    drop(l.nodes, (fade * 1.6 + 0.25) * 1000);
  }
  function stopBed(fade = 0.2) {
    const b = bed.cur; if (!b) return; bed.cur = null; const cx = ctx();
    try { const t = cx.currentTime; b.g.gain.cancelScheduledValues(t); b.g.gain.setTargetAtTime(0, t, fade / 4); b.src.stop(t + fade * 1.6 + 0.05); } catch (_) { /* already stopped */ }
    drop(b.nodes, (fade * 1.6 + 0.25) * 1000);
  }
  // loop clip per state: idle, free full, loaded (falls back to full when no loaded clip is decoded)
  function loopClip(k) {
    const cat = S()?.saw; if (!cat) return null;
    if (L.force[k]) { const f = [...cat.idle, ...cat.full, ...cat.loaded].find((c) => c.group + '/' + c.file === L.force[k] || c.file === L.force[k]); if (f) return f; }
    const list = k === 'idle' ? cat.idle : k === 'loaded' ? (cat.loaded.length ? cat.loaded : cat.full) : cat.full;
    // clips whose natural firing rate overlaps the neighbouring state's are preferred (idle: f0 >= 55 covers up to ~100 Hz; full / loaded: f0 <= 170 starts from ~85 Hz): no hole in the bed mid-rev
    const w = k === 'idle' ? (c) => ((c.fundamentalHz || 55) >= 55 ? 1.6 : 0.8) : (c) => ((c.fundamentalHz || 170) <= 170 ? 1.5 : 0.6);
    return pick('loop:' + k, list, k === 'idle' ? 2 : 1, w);
  }
  // s = { rpm, hz (extrapolated firing rate), load }, running: engine in mode 2
  L.tick = (s, running, cutting) => {
    const cx = ctx(); if (!cx) return; const t = cx.currentTime;
    if (!running) { for (const k of ['idle', 'full', 'loaded']) if (loops[k]) stopLoop(k, 0.25); if (bed.cur) stopBed(0.2); return; }
    const x = smooth(3400, 8600, s.rpm), lw = smooth(0.25, 0.8, clamp(s.load || 0, 0, 1));
    const wgt = { idle: Math.cos(x * Math.PI / 2), full: Math.sin(x * Math.PI / 2) * Math.cos(lw * Math.PI / 2), loaded: Math.sin(x * Math.PI / 2) * Math.sin(lw * Math.PI / 2) };
    const TU = L.tuning, fc = samplesMode() ? 55 : clamp(TU.hzMul * (s.hz || 47), TU.hpMin, TU.hpMax), samp = samplesMode();
    for (const k of ['idle', 'full', 'loaded']) {
      let l = loops[k]; const w0 = wgt[k];
      // a recording pitched far from its natural range sounds wrong (chipmunk / slowed): full level for a rate of 0.7..1.7 (a rev sweeps through it in a few tenths of a second),
      // tapering to nothing at 0.5 / 2.1; a loop that would start out of range waits until the engine reaches it
      const clipNow = l ? l.c : null, fund = clipNow ? clipNow.fundamentalHz : 0, rateNow = fund ? (s.hz || 0) / fund : 1;
      const fit = fund ? smooth(0.5, 0.7, rateNow) * (1 - smooth(1.7, 2.1, rateNow)) : 1, w = w0 * (l ? fit : 1);
      if (!l) { if (w0 < 0.04) continue; const c = loopClip(k); if (!c) continue; const r = c.fundamentalHz ? (s.hz || 0) / c.fundamentalHz : 1; if (c.fundamentalHz && (r < 0.6 || r > 1.9)) continue; startLoop(k, c); l = loops[k]; }
      if (w < 0.02) { if (!l.zeroSince) l.zeroSince = t; else if (t - l.zeroSince > 0.7) stopLoop(k, 0.15); } else l.zeroSince = 0;
      if (!loops[k]) continue;
      if (TU.wobble > 0) { l.wob = (l.wob || 0) * 0.93 + (Math.random() - 0.5) * 0.14 * TU.wobble; }
      const c = l.c, rate = (c.fundamentalHz ? clamp((s.hz || 0) / c.fundamentalHz, 0.5, 2.1) : 1) * (1 + (l.wob || 0)), ref = k === 'idle' ? REF.idle : k === 'full' ? REF.run : REF.cut;
      const loud = samp ? c.loudDb : Number.isFinite(c.loudHP) ? c.loudHP : c.loudDb;
      const pkc = samp ? c.peak : (c.peakHP || c.peak), g = Math.min(clamp(DB(lv()[k] + st.level + ref - loud), 0, 8), 0.4 / (pkc || 1)) * w;
      l.src.playbackRate.setTargetAtTime(rate, t, 0.03);
      if (Math.abs(g - (l.gSet ?? -1)) > 0.004 * (l.gSet || 0) + 1e-5) { l.g.gain.setTargetAtTime(g, t, 0.05); l.gSet = g; }
      if (!samp && Math.abs(fc - (l.fcSet ?? 0)) > 0.015 * fc) { for (const f of l.hp) f.frequency.setTargetAtTime(fc, t, 0.06); l.fcSet = fc; }
    }
    bedStep(cx, cutting);
  };
  // wet gore bed: loops of the gore clips, hop + crossfade every ~2 s while cutting flesh
  function bedStep(cx, cutting) {
    const t = cx.currentTime;
    if (!cutting) { if (bed.cur) stopBed(0.2); return; }
    if (bed.cur && t < bed.hopAt) return;
    const list = (S()?.saw?.gore || []).filter((c) => c.loop && c.seamless); if (!list.length) return;
    const c = pick('bed', list, 1); if (!c) return;
    const src = cx.createBufferSource(); src.buffer = c.buf; src.loop = true; src.loopStart = c.loopStart || 0; src.loopEnd = c.loopEnd || c.dur; src.playbackRate.value = rnd(0.94, 1.06);
    const f = biquad('highpass', samplesMode() ? 80 : 220, 0.6), g = cx.createGain(), gain = clamp(DB(lv().bed + st.level + REF.cut - c.loudDb), 0, 8) * rnd(0.9, 1.1), nodes = [src, f, g];
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.4); src.connect(f); f.connect(g); g.connect(out()); src.start(0, rnd(0, (src.loopEnd - src.loopStart) * 0.9) + src.loopStart);
    const prev = bed.cur; bed.cur = { src, g, nodes, c }; bed.hopAt = t + rnd(1.7, 2.6); st.bedStarts++;
    if (prev) { const p = prev; try { p.g.gain.cancelScheduledValues(t); p.g.gain.setTargetAtTime(0, t, 0.15); p.src.stop(t + 0.8); } catch (_) { /* gone */ } drop(p.nodes, 1200); }
  }

  // ------------------------------------------------------------------------------------------------ bite transients
  // onset slices of a hit clip: [{off, len}] (short clips: one slice; multi-hit clips are cut at their onsets)
  function slicesOf(c) {
    if (c.slices) return c.slices;
    const ch = c.buf.getChannelData(0), sr = c.buf.sampleRate, hop = Math.max(1, Math.round(sr * 0.004)), n = Math.floor(ch.length / hop), env2 = new Float32Array(n);
    let mx = 1e-9; for (let i = 0; i < n; i++) { let e = 0; for (let j = i * hop; j < (i + 1) * hop; j++) e += ch[j] * ch[j]; env2[i] = Math.sqrt(e / hop); if (env2[i] > mx) mx = env2[i]; }
    const out2 = [];
    if (c.dur <= 0.3) out2.push({ off: 0, len: c.dur });
    else {
      let lastT = -1;
      for (let i = 4; i < n - 2; i++) {
        let prev = 1e9; for (let k = i - 4; k < i; k++) prev = Math.min(prev, env2[k]);
        if (env2[i] > mx * 0.1 && env2[i] > prev * 2.4 && env2[i] >= env2[i - 1] && env2[i] >= env2[i + 1] && i * hop / sr - lastT > 0.09) {
          let j = i; while (j > 0 && env2[j - 1] < env2[j]) j--;
          const t0 = Math.max(0, j * hop / sr - 0.003); lastT = i * hop / sr; out2.push({ off: t0, len: 0.2 });
        }
      }
      if (!out2.length || out2[0].off > 0.05) out2.unshift({ off: 0, len: 0.2 });
      for (let k = 0; k < out2.length; k++) { const nx = out2[k + 1]?.off ?? c.dur; out2[k].len = clamp(nx - out2[k].off, 0.07, Math.min(0.22, c.dur - out2[k].off)); }
    }
    return (c.slices = out2);
  }
  function pools(kind) {
    const cat = S()?.saw; if (!cat) return { main: [], accent: [] };
    const hits = cat.hit, gore = cat.gore.filter((c) => !c.loop);
    if (kind === 'wood') return { main: [...hits.filter((c) => c.tags.wood || c.tags.bog), ...gore.filter((c) => c.tags.wood)], accent: [] };
    if (kind === 'flesh') return { main: [...hits.filter((c) => c.tags.flesh && !c.tags.bog && !c.tags.wood), ...gore.filter((c) => c.tags.flesh && !c.tags.wood)], accent: hits.filter((c) => c.tags.bog || c.tags.wood) };
    return { main: [], accent: [] };                                    // metal: the engine's own ringing metal bite stands alone
  }
  L.bite = (strength, kind, s) => {
    const cx = ctx(); if (!cx || (s && s.mode !== 2)) return;
    const now = cx.currentTime; if (now - lastBiteAt < 0.04) return; lastBiteAt = now;
    const { main, accent } = pools(kind); if (!main.length && !accent.length) return;
    const samp = samplesMode(), bogOk = accent.length && strength >= 0.62 && now - lastBogAt > 0.5 && (kind === 'wood' || Math.random() < 0.3);
    let c, bog = false;
    if (bogOk || !main.length) { c = pick('bog', accent.length ? accent : main, 2); bog = true; lastBogAt = now; } else c = pick('bite:' + kind, main, Math.min(4, main.length - 1));
    if (!c) return;
    // a slice, never repeating the last few (clip, slice) combinations
    const sls = slicesOf(c), key = 'slice:' + c.group + '/' + c.file, sl = pick(key, sls, Math.min(2, sls.length - 1)) || sls[0];
    const s01 = clamp(strength, 0, 1), len = bog ? Math.min(0.3, c.dur - 0.02) : clamp(sl.len, 0.07, 0.17);
    const off = bog ? rnd(0, Math.min(0.06, Math.max(0, c.dur - len))) : Math.min(c.dur - len, sl.off + rnd(0, Math.min(0.02, Math.max(0, sl.len - len))));
    const rate = clamp(1.08 - 0.14 * s01 + rnd(-0.07, 0.07), 0.75, 1.35);
    const v = shot(c, { rel: bog ? lv().bog : lv().bite, ref: REF.cut, offset: Math.max(0, off), dur: len, rate, delay: rnd(0, 0.012), vel: 0.4 + 0.6 * s01, fadeIn: 0.003, fadeOut: bog ? 0.09 : 0.045, hp: samp ? 90 : bog ? 900 : 700 });
    if (v) { st.bites++; if (bog) st.bogs++; }
  };

  // ------------------------------------------------------------------------------------------------ housekeeping
  L.stopAll = (fade = 0.2) => { for (const k of ['idle', 'full', 'loaded']) stopLoop(k, fade); stopBed(fade); if (cordV) { kill(cordV, 0.05); cordV = null; } };
  L.killAll = (fade = 0.03) => { L.stopAll(fade); for (const v of [...live]) kill(v, fade); };
  L.setMode = (m) => { st.mode = m === 'samples' ? 'samples' : 'mixed'; };
  L.setLevelDb = (db) => { st.level = clamp(+db || 0, -40, 24); };
  L.mode = () => st.mode;
  L.liveCount = () => live.size;
  L.debug = () => ({ ...st, live: live.size, loops: Object.fromEntries(Object.entries(loops).filter(([, l]) => l).map(([k, l]) => [k, { file: l.c.group + '/' + l.c.file, rate: +l.src.playbackRate.value.toFixed(3), gain: +l.g.gain.value.toFixed(4) }])), bed: bed.cur ? bed.cur.c.file : null });
  L._slices = () => { const o = {}; const cat = S()?.saw; for (const c of [...(cat?.hit || []), ...(cat?.gore || [])]) if (!c.loop) o[c.group + '/' + c.file] = slicesOf(c).map((x) => [+x.off.toFixed(3), +x.len.toFixed(3)]); return o; };
  L.loopCount = () => Object.values(loops).filter(Boolean).length;
  L.hasBed = () => !!bed.cur;
  return L;
}
