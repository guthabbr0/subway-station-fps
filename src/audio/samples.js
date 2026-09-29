// Sample layer: real (CC-licensed) recordings for monsters / gore / chainsaw that sit on top of - or replace - the synthesised bank.
//
//   * assets/audio/<group>/manifest.json is fetched at RUNTIME (groups: monsters-oga, monsters-other, chainsaw). A missing group / manifest / file
//     is tolerated (404 -> group skipped, clip skipped); nothing here can throw into the game.
//   * Loading is lazy: audio.js calls start() after resume(); clips are fetched + decoded (decodeAudioData, off-thread) two at a time in idle
//     slices, most-needed roles first (one variant of every role, then the rest), so gameplay is never blocked. play() falls back to the synth for
//     a role until at least one of its clips is decoded.
//   * Every decoded clip is loudness-measured with the SAME metric that level-matched the synth bank (loudest 200 ms of a 110 Hz-14 kHz weighted
//     signal, dsp.js) and gets a compensation gain toward MIX[role].lv (= the measured level of the synth sound it replaces / joins), peak-capped.
//   * Variant choice is a shuffle bag per role (a full pass before any repeat, never the same clip twice in a row). Rate/pitch variance and the
//     mix policy live in ONE table (MIX, below).
//   * The spatial path is NOT here: audio.js feeds the sample source into the exact same gain -> air-absorption LP -> panner -> bus (+ reverb send)
//     chain, voice limiter and per-name rate limiter as the synth voice, so both layers pan / attenuate identically.
//
// MIX POLICY  (per role; every level in dB, 0 = the loudness of the synth sound of that name)
//   mode   'primary' : the recording IS the sound; the synth is not played (or only as a quiet sub layer, see `synth`) once a clip is decoded.
//          'layer'   : the synth stays primary (these are the roles the researchers flagged as weak / thin recordings) and the clip is mixed under it.
//   lv     target loudness of the sample at 0 dB trim (dB, weighted loudest-200 ms). Equals the synth's own measured level (tools/audio-stats.mjs).
//   sample trim of the sample voice relative to lv.        synth  trim of the synth voice while a sample plays (-Infinity = not played at all).
//   pitch  overall pitch factor wanted relative to the RAW source (clips the researchers already pitched down are corrected via their notes).
//   pv     random pitch variation +-fraction.  chance  probability that a layer joins (limits node churn on shotgun blasts).
//   maxDur cap playback (source seconds) with a short fade-out.  skipOver  do not even load clips longer than this (source seconds).
export const MIX = {
  // ---- sample-primary: recordings are convincing as delivered ------------------------------------------------------------------------------------
  zombieIdle:    { mode: 'primary', lv: -17.0, sample: 0, synth: -Infinity, pv: 0.07, maxDur: 2.6 },
  zombieAlert:   { mode: 'primary', lv: -14.0, sample: 0, synth: -Infinity, pv: 0.07, maxDur: 2.2 },
  zombieAttack:  { mode: 'primary', lv: -12.0, sample: 0, synth: -Infinity, pv: 0.07, maxDur: 1.5 },
  zombiePain:    { mode: 'primary', lv: -16.0, sample: 0, synth: -Infinity, pv: 0.09, maxDur: 1.0 },
  zombieDeath:   { mode: 'primary', lv: -15.2, sample: -1.5, synth: -Infinity, pv: 0.07, maxDur: 2.4 },
  gib:           { mode: 'primary', lv: -15.8, sample: 1.5, synth: -9, pv: 0.08, maxDur: 0.9 },                       // synth stays under as the low-end body the clips lack
  bruteRoar:     { mode: 'primary', lv: -12.8, sample: -2.5, synth: -7, pitch: 0.80, pv: 0.05, maxDur: 2.8 },           // pitched down for size, synth sub layer under it
  tyrantRoar:    { mode: 'primary', lv: -11.8, sample: -2, synth: -6, pitch: 0.78, pv: 0.03, maxDur: 5.5 },           // boss: deepest pitch, longest tail, synth underlay
  // ---- layered under the synth: weak / thin / band-limited recordings only add texture ---------------------------------------------------------------
  runnerScream:  { mode: 'layer', lv: -12.0, sample: -3, synth: -1.5, pv: 0.10, maxDur: 1.6 },
  zombieStep:    { mode: 'layer', lv: -23.0, sample: -2, synth: 0, pv: 0.10, chance: 0.8, maxDur: 0.6 },
  spit:          { mode: 'layer', lv: -19.9, sample: -3, synth: -1, pv: 0.08, maxDur: 0.8, skipOver: 1.4 },
  impactFlesh:   { mode: 'layer', lv: -18.7, sample: -4, synth: -1, pv: 0.08, chance: 0.75, maxDur: 0.5 },
  exploderBurst: { mode: 'layer', lv: -13.5, sample: -3, synth: -1, pv: 0.06, maxDur: 1.5 },
  bruteStep:     { mode: 'layer', lv: -15.1, sample: -3, synth: -1, pitch: 0.92, pv: 0.05, maxDur: 0.7 },
};
// clips that are individually unsuitable (the researchers' notes): a human shout is not a zombie growl
const SKIP = new Set(['monsters-other/zombieAlert_02.ogg']);
// loading order: one variant of every role first (round-robin over this list), then the remaining variants
const PRIORITY = ['zombieIdle', 'zombiePain', 'zombieDeath', 'zombieAttack', 'zombieAlert', 'impactFlesh', 'gib', 'zombieStep', 'runnerScream', 'spit', 'exploderBurst', 'bruteStep', 'bruteRoar', 'tyrantRoar'];
export const GROUPS = ['monsters-oga', 'monsters-other', 'chainsaw'];
const DB = (x) => Math.pow(10, x / 20);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createSamples(env = {}) {
  const S = {
    enabled: env.enabled !== false,
    base: env.base || new URL('../../assets/audio/', import.meta.url).href,
    groups: new Map(),          // group -> clips[] (every manifest entry that was wanted; buf is null until decoded)
    roles: new Map(),           // role  -> { ready: clip[] (decoded), bag: clip[], last: clip|null }   (monster roles in MIX only)
    stats: { manifests: 0, missing: [], planned: 0, decoded: 0, failed: [], bytes: 0, decodeMs: 0, analyseMs: 0, seconds: 0 },
    loaded: false, started: false,
  };
  const warn = env.warn || ((...a) => console.warn('[audio/samples]', ...a));
  let dsp = null, resolveDone; const donePromise = new Promise((r) => { resolveDone = r; });
  let queue = [], running = 0, epoch = 0;
  const getCtx = () => env.ctx?.() || null;

  // ------------------------------------------------------------------------------------------------ loading
  const idle = () => new Promise((res) => { if (typeof requestIdleCallback === 'function') requestIdleCallback(() => res(), { timeout: 250 }); else setTimeout(res, 16); });
  async function getJSON(url) { try { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) return null; return await r.json(); } catch (e) { return null; } }
  // pitch/speed factor the researchers already baked into a clip ("Slowed/pitched down to 0.8x", "pitched down to 0.75x")
  function preShift(note) { const m = /(?:pitch(?:ed)?(?:\s*\/\s*speed)?(?:\s+down)?(?:\s+to)?|slowed[^.]*?to)\s*x?\s*(0\.\d+)\s*x?/i.exec(note || ''); const v = m ? parseFloat(m[1]) : 1; return v >= 0.5 && v <= 1 ? v : 1; }

  async function loadManifests() {
    const lists = await Promise.all(GROUPS.map((g) => getJSON(S.base + g + '/manifest.json').then((m) => [g, m])));
    for (const [g, m] of lists) {
      const list = m && (Array.isArray(m) ? m : Array.isArray(m.sounds) ? m.sounds : Array.isArray(m.clips) ? m.clips : null);
      if (!list) { S.stats.missing.push(g); continue; }
      S.stats.manifests++;
      const out = [];
      for (const s of list) {
        if (!s || typeof s.file !== 'string' || !s.role) continue;
        if (SKIP.has(g + '/' + s.file)) continue;
        const mix = g === 'chainsaw' ? null : MIX[s.role];
        if (g !== 'chainsaw' && !mix) continue;                       // a role the game has no policy for: do not spend memory on it
        if (mix?.skipOver && s.duration > mix.skipOver) continue;
        out.push({ group: g, file: s.file, role: s.role, url: S.base + g + '/' + encodeURIComponent(s.file), meta: s, buf: null, gain: 1, loudDb: NaN, peak: 1, dur: +s.duration || 0, pre: preShift(s.notes), loop: !!s.loop, loopStart: +s.loopStart || 0, loopEnd: +s.loopEnd || 0, fundamentalHz: +s.fundamentalHz || 0, seamless: !!s.seamless });
      }
      S.groups.set(g, out);
      S.stats.planned += out.length;
    }
  }
  function order() {
    const monsters = [], perRole = new Map();
    for (const g of GROUPS) if (g !== 'chainsaw') for (const c of S.groups.get(g) || []) { if (!perRole.has(c.role)) perRole.set(c.role, []); perRole.get(c.role).push(c); }
    for (let i = 0; ; i++) { let any = false; for (const r of PRIORITY) { const c = perRole.get(r)?.[i]; if (c) { monsters.push(c); any = true; } } if (!any) break; }
    // the chainsaw clips follow the first pass over the monster roles (the saw only shows up from wave 2)
    const first = monsters.slice(0, PRIORITY.length + 6), rest = monsters.slice(PRIORITY.length + 6);
    return [...first, ...(S.groups.get('chainsaw') || []), ...rest];
  }
  async function measure(c) {
    const t0 = performance.now(); const ch = c.buf.getChannelData(0);
    let pk = 0; for (let i = 0; i < ch.length; i++) { const a = ch[i] < 0 ? -ch[i] : ch[i]; if (a > pk) pk = a; }
    c.peak = pk || 1e-6;
    try { dsp = dsp || await import('./dsp.js'); c.loudDb = 20 * Math.log10(Math.max(1e-9, dsp.loudest(dsp.weighted(ch), 0.2))); } catch (e) { c.loudDb = (+c.meta.rmsDb || -18) + 3; }
    const mix = MIX[c.role];
    if (c.group !== 'chainsaw' && mix) c.gain = clamp(Math.min(DB(mix.lv - c.loudDb), 0.95 / c.peak), 0.05, 4);
    S.stats.analyseMs += performance.now() - t0;
  }
  function admit(c) {
    if (c.group === 'chainsaw') return;
    let r = S.roles.get(c.role); if (!r) S.roles.set(c.role, r = { ready: [], bag: [], last: null });
    r.ready.push(c); r.bag.splice(Math.floor(Math.random() * (r.bag.length + 1)), 0, c);   // a fresh clip is heard soon: random slot in the running bag
  }
  async function worker(my) {
    const ctx = getCtx();
    while (my === epoch && queue.length) {
      const c = queue.shift();
      try {
        const res = await fetch(c.url); if (!res.ok) { S.stats.failed.push(c.group + '/' + c.file + ' (' + res.status + ')'); continue; }
        const ab = await res.arrayBuffer(); S.stats.bytes += ab.byteLength;
        const t0 = performance.now(); const buf = await ctx.decodeAudioData(ab); S.stats.decodeMs += performance.now() - t0;
        c.buf = buf; c.dur = buf.duration; await measure(c); admit(c); S.stats.decoded++; S.stats.seconds += buf.duration;
      } catch (e) { S.stats.failed.push(c.group + '/' + c.file + ' (' + (e && e.message || e) + ')'); }
      await idle();
    }
  }
  async function run() {
    const my = epoch;
    try {
      await new Promise((r) => setTimeout(r, env.delay ?? 250)); await idle();
      if (my !== epoch) return;
      await loadManifests();
      queue = order();
      if (!getCtx()) return;
      running = 2; await Promise.all([worker(my), worker(my)]); running = 0;
    } catch (e) { warn('load failed:', e); }
    finally { S.loaded = true; resolveDone(S); }
  }

  // ------------------------------------------------------------------------------------------------ selection
  function nextClip(r) {
    if (!r.bag.length) {                                            // refill: shuffle everything, never start with the clip that just played
      r.bag = r.ready.slice();
      for (let i = r.bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r.bag[i], r.bag[j]] = [r.bag[j], r.bag[i]]; }
      if (r.bag.length > 1 && r.bag[r.bag.length - 1] === r.last) { const j = Math.floor(Math.random() * (r.bag.length - 1)); [r.bag[r.bag.length - 1], r.bag[j]] = [r.bag[j], r.bag[r.bag.length - 1]]; }
    }
    let c = r.bag.pop();
    if (c === r.last && r.bag.length) { const d = r.bag.pop(); r.bag.push(c); c = d; }   // a late-admitted clip landed on the same slot: swap, still no immediate repeat
    r.last = c; return c;
  }
  // plan(role, opts, defaultPv) -> null | { buf, gain, rate, playDur, wall, fadeAt, synth, primary, clip }
  function plan(role, opts, defaultPv) {
    if (!S.enabled) return null;
    const mix = MIX[role]; if (!mix) return null;
    const r = S.roles.get(role); if (!r || !r.ready.length) return null;
    if (mix.chance != null && Math.random() > mix.chance) return null;
    const c = nextClip(r);
    const pv = Number.isFinite(opts?.pitchVar) ? opts.pitchVar : mix.pv ?? defaultPv ?? 0.05;
    const rate = clamp((Number.isFinite(opts?.rate) ? opts.rate : 1) * (mix.pitch != null ? mix.pitch / c.pre : 1) * (1 + (Math.random() * 2 - 1) * pv), 0.2, 4);
    const gain = c.gain * DB(mix.sample) * (0.9 + 0.2 * Math.random());
    const cap = mix.maxDur ?? 99, playDur = Math.min(c.dur, cap), truncated = playDur < c.dur - 1e-3;
    const wall = playDur / rate;
    return { buf: c.buf, gain, rate, playDur, wall, fadeAt: truncated ? Math.max(0, wall - Math.min(0.18, wall * 0.3)) : 0, synth: DB(mix.synth), primary: mix.mode === 'primary', clip: c };
  }

  function start() {
    if (S.started || !S.enabled) return donePromise;
    S.started = true; run();
    return donePromise;
  }
  S.start = start;
  S.plan = plan;
  S.whenLoaded = () => donePromise;
  S.setEnabled = (on) => { S.enabled = !!on; if (S.enabled) start(); };
  S.setBase = (url) => { S.base = url.endsWith('/') ? url : url + '/'; };
  S.clips = (group, role) => (S.groups.get(group) || []).filter((c) => c.buf && (!role || c.role === role));
  S.counts = () => { const o = {}; for (const [r, v] of S.roles) o[r] = v.ready.length; return o; };
  S.info = () => {
    const roles = {};
    for (const [r, v] of S.roles) roles[r] = { mode: MIX[r].mode, n: v.ready.length, clips: v.ready.map((c) => ({ file: c.group + '/' + c.file, dur: +c.dur.toFixed(2), loudDb: +c.loudDb.toFixed(1), peak: +c.peak.toFixed(2), gainDb: +(20 * Math.log10(c.gain)).toFixed(1), pre: c.pre })) };
    const saw = (S.groups.get('chainsaw') || []).filter((c) => c.buf).map((c) => ({ file: c.file, role: c.role, dur: +c.dur.toFixed(2), loudDb: +c.loudDb.toFixed(1) }));
    return { enabled: S.enabled, loaded: S.loaded, ...S.stats, decodedMB: +(S.stats.seconds * 44100 * 4 / 1e6).toFixed(1), groups: [...S.groups].map(([g, l]) => [g, l.length, l.filter((c) => c.buf).length]), roles, chainsaw: saw };
  };
  S.dispose = () => { epoch++; queue = []; for (const l of S.groups.values()) for (const c of l) c.buf = null; S.roles.clear(); S.groups.clear(); };
  return S;
}
