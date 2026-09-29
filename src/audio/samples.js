// Sample layer: real (CC-licensed) recordings for monsters / gore / chainsaw that sit on top of - or replace - the synthesised bank.
//
//   * Five asset groups under assets/audio/<group>/manifest.json, fetched at RUNTIME. Two HUMAN-CURATED groups are first-class and take priority everywhere
//       human-monsters  89 clips, all CC0 (zombie / brute / tyrant voices, gib, flesh impacts, bursts, steps)   -> monster roles
//       human-chainsaw  50 clips (sawStart/Idle/Full/Rev/Shutdown/Hit/Gore + gib + exploderBurst)             -> chainsaw catalogue (+ gib / exploderBurst pools)
//     and three OLDER groups stay as ADDITIONAL VARIANTS for variety (optional at runtime: ?oldsamples=0 or setLegacy(false); loaded last, never past the memory budget)
//       monsters-oga, monsters-other (monster roles), chainsaw (6 clips: extra saw loops / hits)
//     A missing group / manifest / file is tolerated (skipped); nothing here can throw into the game.
//   * Loading is lazy: audio.js calls start() after resume(); clips are fetched + decoded (decodeAudioData, off-thread) two at a time in idle slices, most-needed
//     first (one variant of every monster role, then the chainsaw set, then the rest of the human clips, then the legacy groups), so gameplay is never blocked.
//     play() falls back to the synth for a role until at least one of its clips is decoded. prioritize('chainsaw') pulls the saw set to the front of the queue.
//   * Every decoded clip is loudness-measured with the SAME metric that level-matched the synth bank (loudest 200 ms of a 110 Hz-14 kHz weighted signal, dsp.js) and gets
//     a compensation gain toward MIX[role].lv (= the measured level of the synth sound it replaces / joins), peak-capped. Clips longer than their play cap are trimmed
//     right after decoding (the tail was never audible) to keep the decoded memory down.
//   * Variant choice is ONE pooled shuffle bag per role over all groups: every human clip once per pass plus a random ~40 % of the legacy clips (so the human material
//     carries ~3/4 of the plays), never the same clip twice in a row, and not one of the last two either while alternatives exist.
//   * Clips flagged EXPERIMENTAL / WEAK in their manifest notes (human runnerScream pitched-up fragments, weak spit crackles) or described as a human shout are skipped.
//   * The spatial path is NOT here: audio.js feeds the sample source into the exact same gain -> air-absorption LP -> panner -> bus (+ reverb send) chain, voice limiter
//     and per-name rate limiter as the synth voice, so both layers pan / attenuate identically. The chainsaw catalogue (S.saw) is consumed by chainsawLayers.js.
//
// MIX POLICY  (per role; every level in dB, 0 = the loudness of the synth sound of that name)
//   mode   'primary' : the recording IS the sound; the synth is not played (or only as a quiet sub layer, see `synth`) once a clip is decoded.
//          'layer'   : the synth stays primary (thin / short recordings) and the clip is mixed with it.
//   lv     target loudness of the sample at 0 dB trim (dB, weighted loudest-200 ms). Equals the synth's own measured level (tools/audio-stats.mjs).
//   sample trim of the sample voice relative to lv.        synth  trim of the synth voice while a sample plays (-Infinity = not played at all).
//   pitch  wanted overall pitch factor relative to the RAW source. Applies to the legacy clips only: the human clips are delivered already pitched (their manifests say
//          how much: 0.62 tyrant .. 0.82 brute) and play at rate 1.  pv random pitch variation +-fraction.  chance probability that a layer joins.
//   maxDur cap playback (source seconds) with a short fade-out.  skipOver  do not even load clips longer than this (source seconds).
export const MIX = {
  // ---- sample-primary: recordings are convincing as delivered ------------------------------------------------------------------------------------
  zombieIdle:    { mode: 'primary', lv: -17.0, sample: 0, synth: -Infinity, pv: 0.07, maxDur: 2.6 },
  zombieAlert:   { mode: 'primary', lv: -14.0, sample: 0, synth: -Infinity, pv: 0.07, maxDur: 2.5 },
  zombieAttack:  { mode: 'primary', lv: -12.0, sample: 0, synth: -Infinity, pv: 0.07, maxDur: 1.5 },
  zombiePain:    { mode: 'primary', lv: -16.0, sample: 0, synth: -Infinity, pv: 0.09, maxDur: 1.0 },
  zombieDeath:   { mode: 'primary', lv: -15.2, sample: -1.5, synth: -Infinity, pv: 0.07, maxDur: 2.4 },
  gib:           { mode: 'primary', lv: -15.8, sample: 1.5, synth: -9, pv: 0.08, maxDur: 0.9 },                        // synth stays under as the low-end body the clips lack
  bruteRoar:     { mode: 'primary', lv: -12.8, sample: -2.5, synth: -7, pitch: 0.80, pv: 0.05, maxDur: 2.8 },            // deeper for size, synth sub layer under it
  tyrantRoar:    { mode: 'primary', lv: -11.8, sample: -3, synth: -6, pitch: 0.64, pv: 0.03, maxDur: 5.5 },            // boss: deepest pitch (human clips ship at 0.62-0.65), longest tail
  // ---- layered with the synth: short / thin recordings add texture (the human sets made the transient roles rich enough for a much stronger layer) ----
  runnerScream:  { mode: 'layer', lv: -12.0, sample: -3, synth: -1.5, pv: 0.10, maxDur: 1.6 },                          // stays synth-primary (human clips are experimental: skipped)
  zombieStep:    { mode: 'layer', lv: -23.0, sample: -2.5, synth: 0, pv: 0.10, chance: 0.8, maxDur: 0.6 },
  spit:          { mode: 'layer', lv: -19.9, sample: -3, synth: -1, pv: 0.08, maxDur: 0.8, skipOver: 1.4 },             // human spit clips are flagged weak: skipped
  impactFlesh:   { mode: 'layer', lv: -18.7, sample: -1.5, synth: -2, pv: 0.08, chance: 0.85, maxDur: 0.5 },
  exploderBurst: { mode: 'layer', lv: -13.5, sample: -1.5, synth: -2, pv: 0.06, maxDur: 1.5 },
  bruteStep:     { mode: 'layer', lv: -15.1, sample: -1.5, synth: -1, pitch: 0.92, pv: 0.05, maxDur: 0.7 },
};
// asset groups: prio = share of the pooled shuffle bag (1 = every clip once per pass; legacy: that fraction of the clips per pass), baked = clips are delivered already pitched
export const GROUPS = [
  { id: 'human-monsters', prio: 1, legacy: false, baked: true },
  { id: 'human-chainsaw', prio: 1, legacy: false, baked: true },
  { id: 'monsters-oga', prio: 0.4, legacy: true, baked: false },
  { id: 'monsters-other', prio: 0.4, legacy: true, baked: false },
  { id: 'chainsaw', prio: 0.5, legacy: true, baked: false },
];
// sawRev is deliberately NOT loaded: measured against the engine's rev(1) blip none of the recorded revs fits (see chainsawLayers.js header), so the decoded MB is not spent on them
export const SAW_ROLES = new Set(['sawStart', 'sawIdle', 'sawFull', 'sawShutdown', 'sawHit', 'sawGore']);
// clips that are individually unsuitable (the researchers' notes): a human shout is not a zombie growl
const SKIP = new Set(['monsters-other/zombieAlert_02.ogg']);
const SKIP_NOTE = /human (angry )?(scream|shout)|aggro shout|^\s*(experimental|weak)\b/i;
// loading order of the monster roles: one variant of every role first (round-robin over this list), then the remaining variants
const PRIORITY = ['zombieIdle', 'zombiePain', 'zombieDeath', 'zombieAttack', 'zombieAlert', 'impactFlesh', 'gib', 'zombieStep', 'runnerScream', 'spit', 'exploderBurst', 'bruteStep', 'bruteRoar', 'tyrantRoar'];
const SAW_ORDER = ['sawIdle', 'sawFull', 'sawStart', 'sawHit', 'sawGore', 'sawShutdown'];
// clips of a role kept after decoding (source seconds): the start clips are ~6 s but only the pull + catch + a short tail is ever played
const SAW_KEEP = { sawStart: 3.6 };
const SAW_HP = { idle: [560, 46.7], full: [1230, 205], loaded: [970, 161], oneshot: [700, 0] };
// Which manifest entries the game loads: true | false (a role without a policy, too long...) | 'skip' (flagged experimental / weak / human shout, or listed in SKIP). tools/build-credits.mjs credits exactly these.
export function wantedClip(groupId, s) {
  if (!s || typeof s.file !== 'string' || !s.role) return false;
  const saw = SAW_ROLES.has(s.role), mix = MIX[s.role];
  if (!saw && !mix) return false;                                              // a role the game has no policy for: do not spend memory on it
  if (SKIP.has(groupId + '/' + s.file) || !!(s.experimental || s.weak || SKIP_NOTE.test(String(s.notes || '')) || SKIP_NOTE.test(String(s.label || '')))) return 'skip';
  if (mix?.skipOver && s.duration > mix.skipOver) return false;
  return true;
}
// crest-heavy clips (gib cracks, snarls: RMS 8-10 dB below the synth's) reach their level target only with peaks above digital full scale: allowed up to +1.9 dBFS before the sfx bus compressor,
// which brings the master peaks back to the weapons' range (tools/audio-verify.mjs roles: <= -2.5 dBFS)
const PEAK_CAP = 1.25;
const DB = (x) => Math.pow(10, x / 20);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// pitch/speed factor already baked into a delivered clip: human sets say "tape-style pitch factor 0.82" / "pitched -20%"; the older sets "Slowed/pitched down to 0.75x"
export function preShift(note) {
  const n = note || '';
  let m = /pitch factor\s*([0-9.]+)/i.exec(n); if (m) { const v = parseFloat(m[1]); if (v >= 0.4 && v <= 2) return v; }
  m = /pitch(?:ed)?[^0-9\-+|;]{0,12}([+-]?\d+)\s*%/i.exec(n); if (m) { const v = 1 + parseFloat(m[1]) / 100 * (/pitch(?:ed)?\s+down/i.test(n) && parseFloat(m[1]) > 0 ? -1 : 1); if (v >= 0.4 && v <= 2) return v; }
  m = /(?:pitch(?:ed)?(?:\s*\/\s*speed)?(?:\s+down)?(?:\s+to)?|slowed[^.]*?to)\s*x?\s*(0\.\d+)\s*x?/i.exec(n); const v = m ? parseFloat(m[1]) : 1;
  return v >= 0.5 && v <= 1 ? v : 1;
}

export function createSamples(env = {}) {
  const S = {
    enabled: env.enabled !== false,
    legacy: env.legacy !== false,        // older groups as extra variants
    base: env.base || new URL('../../assets/audio/', import.meta.url).href,
    budgetMB: env.budgetMB ?? 58,        // decoded-memory ceiling for the optional (legacy) clips
    groups: new Map(),                   // group -> clips[] (every manifest entry that was wanted; buf is null until decoded)
    roles: new Map(),                    // role  -> { ready: clip[] (decoded), bag: clip[], recent: clip[], last: clip|null }   (monster roles in MIX only)
    saw: { start: [], idle: [], full: [], loaded: [], rev: [], stop: [], hit: [], gore: [], version: 0 },   // decoded chainsaw catalogue (consumed by chainsawLayers.js)
    stats: { manifests: 0, missing: [], planned: 0, decoded: 0, failed: [], skipped: [], bytes: 0, decodeMs: 0, analyseMs: 0, analyseMaxMs: 0, analyseMaxClip: '', seconds: 0, trimmedSeconds: 0, legacyHeld: 0 },
    loaded: false, started: false,
  };
  const warn = env.warn || ((...a) => console.warn('[audio/samples]', ...a));
  let dsp = null, resolveDone; const donePromise = new Promise((r) => { resolveDone = r; });
  let queue = [], running = 0, epoch = 0, wantSaw = false;
  const getCtx = () => env.ctx?.() || null;
  const gInfo = (id) => GROUPS.find((g) => g.id === id);

  // ------------------------------------------------------------------------------------------------ loading
  const idle = () => new Promise((res) => { if (typeof requestIdleCallback === 'function') requestIdleCallback(() => res(), { timeout: 250 }); else setTimeout(res, 16); });
  async function getJSON(url) { try { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) return null; return await r.json(); } catch (e) { return null; } }

  async function loadManifests() {
    const wanted = GROUPS.filter((g) => !g.legacy || S.legacy);
    const lists = await Promise.all(wanted.map((g) => getJSON(S.base + g.id + '/manifest.json').then((m) => [g, m])));
    for (const [g, m] of lists) {
      const list = m && (Array.isArray(m) ? m : Array.isArray(m.sounds) ? m.sounds : Array.isArray(m.clips) ? m.clips : null);
      if (!list) { S.stats.missing.push(g.id); continue; }
      S.stats.manifests++;
      const out = [];
      for (const s of list) {
        const w = wantedClip(g.id, s); if (w === 'skip') { S.stats.skipped.push(g.id + '/' + s.file); continue; } if (!w) continue;
        const saw = SAW_ROLES.has(s.role), mix = MIX[s.role];
        out.push({ group: g.id, legacy: g.legacy, baked: g.baked, saw, file: s.file, role: s.role, url: S.base + g.id + '/' + encodeURIComponent(s.file), meta: s, buf: null, gain: 1, loudDb: NaN, loudHP: NaN, peakHP: 1, peak: 1, dur: +s.duration || 0,
          pre: preShift(s.notes), loop: !!s.loop, loopStart: +s.loopStart || 0, loopEnd: +s.loopEnd || 0, fundamentalHz: +s.fundamentalHz || 0, seamless: !!s.seamless, loaded: !!s.loaded,
          src: String(s.sourceFile || s.originalFile || s.sourceUrl || s.file) });
      }
      S.groups.set(g.id, out);
      S.stats.planned += out.length;
    }
  }
  const byRole = (ids, pick) => { const per = new Map(); for (const id of ids) for (const c of S.groups.get(id) || []) if (pick(c)) { if (!per.has(c.role)) per.set(c.role, []); per.get(c.role).push(c); } return per; };
  const roundRobin = (per, roles) => { const out = []; for (let i = 0; ; i++) { let any = false; for (const r of roles) { const c = per.get(r)?.[i]; if (c) { out.push(c); any = true; } } if (!any) break; } return out; };
  function order() {
    const human = GROUPS.filter((g) => !g.legacy).map((g) => g.id), legacy = GROUPS.filter((g) => g.legacy).map((g) => g.id);
    const mon = roundRobin(byRole(human, (c) => !c.saw), PRIORITY), monLegacy = roundRobin(byRole(legacy, (c) => !c.saw), PRIORITY);
    const sawH = roundRobin(byRole(human, (c) => c.saw), SAW_ORDER), sawL = roundRobin(byRole(legacy, (c) => c.saw), SAW_ORDER);
    const first = mon.slice(0, PRIORITY.length), rest = mon.slice(PRIORITY.length);
    // the saw only shows up from wave 2 (prioritize('chainsaw') moves it to the front the moment the weapon is touched): human saw set right after the first monster pass
    return wantSaw ? [...sawH, ...first, ...sawL, ...rest, ...monLegacy] : [...first, ...sawH, ...rest, ...sawL, ...monLegacy];
  }
  const decodedMB = () => (S.stats.seconds * 44100 * 4) / 1e6;
  function trimmed(ctx, buf, sec) {
    const n = Math.min(buf.length, Math.max(64, Math.round(sec * buf.sampleRate)));
    if (n >= buf.length - 64) return buf;
    const nb = ctx.createBuffer(buf.numberOfChannels, n, buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) nb.copyToChannel(buf.getChannelData(ch).subarray(0, n), ch);
    S.stats.trimmedSeconds += (buf.length - n) / buf.sampleRate;
    return nb;
  }
  const keepSec = (c) => (c.saw ? SAW_KEEP[c.role] : MIX[c.role]?.maxDur != null ? MIX[c.role].maxDur + 0.06 : 0) || 0;
  const yieldNow = () => new Promise((r) => setTimeout(r, 0));
  // loudness measure in short stages (each stays a few ms even on a 3 s loop) with a yield between them: decoding must never stall a frame
  async function measure(c) {
    const t0 = performance.now(); let busy = 0, t1 = t0; const lap = () => { const n = performance.now(); busy = Math.max(busy, n - t1); t1 = n; };
    const ch = c.buf.getChannelData(0);
    let pk = 0; for (let i = 0; i < ch.length; i++) { const a = ch[i] < 0 ? -ch[i] : ch[i]; if (a > pk) pk = a; }
    c.peak = pk || 1e-6;
    try {
      dsp = dsp || await import('./dsp.js'); t1 = performance.now();
      const w = dsp.weighted(ch); lap(); await yieldNow(); t1 = performance.now();
      c.loudDb = 20 * Math.log10(Math.max(1e-9, dsp.loudest(w, 0.2))); lap();
    } catch (e) { c.loudDb = (+c.meta.rmsDb || -18) + 3; }
    const mix = MIX[c.role];
    if (!c.saw && mix) c.gain = clamp(Math.min(DB(mix.lv - c.loudDb), PEAK_CAP / c.peak), 0.05, 4);
    // the chainsaw layers are high-passed (the synth keeps the low harmonics) and pitch-followed: level them by what is left after the layer's own 4th-order high-pass, at the
    // rate the clip is typically played at (engine firing rate / clip f0), same weighted metric. [corner Hz, firing rate the clip is played at (0 = rate 1)]
    c.loudHP = c.loudDb; c.peakHP = c.peak;
    if (c.saw && dsp?.filt && dsp.resample) {
      const [fc, hz] = SAW_HP[c.role === 'sawIdle' ? 'idle' : c.role === 'sawFull' ? (c.loaded ? 'loaded' : 'full') : 'oneshot'] || SAW_HP.oneshot, r0 = hz && c.fundamentalHz ? clamp(hz / c.fundamentalHz, 0.55, 1.7) : 1;
      try {
        await yieldNow(); t1 = performance.now(); const cp = Math.abs(r0 - 1) > 0.02 ? dsp.resample(ch, r0) : Float32Array.from(ch); dsp.filt(cp, { type: 'hp', f: fc, order: 4 }); lap(); await yieldNow(); t1 = performance.now();
        let pkh = 0; for (let i = 0; i < cp.length; i++) { const a = cp[i] < 0 ? -cp[i] : cp[i]; if (a > pkh) pkh = a; } c.peakHP = pkh || 1e-6;
        const w2 = dsp.weighted(cp); lap(); await yieldNow(); t1 = performance.now();
        c.loudHP = 20 * Math.log10(Math.max(1e-9, dsp.loudest(w2, 0.2))); lap();
      } catch (e) { /* keep the full-band value */ }
    }
    S.stats.analyseMs += performance.now() - t0;
    if (busy > S.stats.analyseMaxMs) { S.stats.analyseMaxMs = busy; S.stats.analyseMaxClip = c.group + '/' + c.file; }   // longest uninterrupted main-thread stretch of any clip
  }
  // chainsaw kinds a clip can cut (manifest title / label / notes): the human set names its material ("cutting through flesh", "Crosscutting", "load onset")
  function tagsOf(c) {
    const t = ((c.meta?.label || '') + ' ' + (c.meta?.notes || '') + ' ' + (c.meta?.title || '') + ' ' + c.file).toLowerCase();
    const bog = /bog|load onset|sag/.test(t);
    return { flesh: /flesh|squish|squelch|splat|wet|gore|blood|meat|gib|rip|guts/.test(t), wood: /wood|crack|log|branch|tree|timber|crosscut/.test(t), metal: /metal|steel|iron|clang|ping|spark|pipe/.test(t), bog };
  }
  function admit(c) {
    if (c.saw) {
      const k = c.role === 'sawStart' ? 'start' : c.role === 'sawShutdown' ? 'stop' : c.role === 'sawRev' ? 'rev' : c.role === 'sawHit' ? 'hit' : c.role === 'sawGore' ? 'gore'
        : c.role === 'sawIdle' ? (c.loop && c.seamless ? 'idle' : null) : c.role === 'sawFull' ? (c.loop && c.seamless ? (c.loaded ? 'loaded' : 'full') : null) : null;
      if (!k) return;
      c.tags = tagsOf(c); c.kind = k; S.saw[k].push(c); S.saw.version++;
      return;
    }
    let r = S.roles.get(c.role); if (!r) S.roles.set(c.role, r = { ready: [], bag: [], recent: [], last: null, humanN: 0 });
    r.ready.push(c); if (!c.legacy) r.humanN++;
    if (!c.legacy || Math.random() < legacyShare(r, c)) r.bag.splice(Math.floor(Math.random() * (r.bag.length + 1)), 0, c);   // a fresh clip is heard soon: random slot in the running bag
  }
  async function worker(my) {
    const ctx = getCtx();
    while (my === epoch && queue.length) {
      const c = queue.shift();
      if (c.legacy && (decodedMB() > S.budgetMB || !S.legacy)) { S.stats.legacyHeld++; continue; }     // optional variants never push the memory past the budget
      try {
        const res = await fetch(c.url); if (!res.ok) { S.stats.failed.push(c.group + '/' + c.file + ' (' + res.status + ')'); continue; }
        const ab = await res.arrayBuffer(); S.stats.bytes += ab.byteLength;
        const t0 = performance.now(); let buf = await ctx.decodeAudioData(ab); S.stats.decodeMs += performance.now() - t0;
        const keep = keepSec(c); if (keep > 0 && buf.duration > keep + 0.1) buf = trimmed(ctx, buf, keep);
        c.buf = buf; c.dur = buf.duration; await measure(c); admit(c); S.stats.decoded++; S.stats.seconds += buf.duration;
      } catch (e) { S.stats.failed.push(c.group + '/' + c.file + ' (' + (e && e.message || e) + ')'); }
      await idle();
    }
  }
  async function run() {
    const my = epoch; let finished = true;
    try {
      if (!getCtx()) { finished = false; S.started = false; return; }                // no AudioContext yet: a later start() (audio.resume()) begins the load
      await new Promise((r) => setTimeout(r, env.delay ?? 250)); await idle();
      if (my !== epoch) return;
      await loadManifests();
      queue = order();
      running = 2; await Promise.all([worker(my), worker(my)]); running = 0;
    } catch (e) { warn('load failed:', e); }
    finally { if (finished) { S.loaded = true; resolveDone(S); } }
  }

  // ------------------------------------------------------------------------------------------------ selection
  // pooled bag: human clips once per pass + a random share of the legacy clips; never the previous clip, not one of the last two while others exist, not the same recording twice in a row
  // share of the legacy clips per pass: their group's prio when the human clips alone make a decent pool, more (up to all of them) when the role has few or no human clips
  const legacyShare = (r, c) => { const h = r.humanN; return !S.legacy ? 0 : h === 0 ? 1 : h < 4 ? Math.max(gInfo(c.group)?.prio ?? 0.4, 0.75) : gInfo(c.group)?.prio ?? 0.4; };
  function refill(r) {
    const bag = r.ready.filter((c) => !c.legacy || Math.random() < legacyShare(r, c));
    r.bag = shuffle(bag.length ? bag : r.ready.slice());
  }
  function nextClip(r) {
    if (!r.bag.length) refill(r);
    // preference ladder over the bag (its top = the end): fresh clip from another recording > fresh clip > anything but the previous clip > whatever is left
    const fresh = (c) => c !== r.last && !r.recent.includes(c), other = (c) => !r.last || c.src !== r.last.src;
    let idx = -1;
    for (const test of [(c) => fresh(c) && other(c), fresh, (c) => c !== r.last]) { for (let i = r.bag.length - 1; i >= 0 && idx < 0; i--) if (test(r.bag[i])) idx = i; if (idx >= 0) break; }
    if (idx < 0) { refill(r); for (let i = r.bag.length - 1; i >= 0 && idx < 0; i--) if (r.bag[i] !== r.last) idx = i; if (idx < 0) idx = r.bag.length - 1; }
    const c = r.bag.splice(idx, 1)[0];
    r.recent.push(c); while (r.recent.length > Math.min(2, Math.max(0, r.ready.length - 2))) r.recent.shift();
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
    const base = mix.pitch != null && !c.baked ? mix.pitch / c.pre : 1;              // human clips ship pitched already
    const rate = clamp((Number.isFinite(opts?.rate) ? opts.rate : 1) * base * (1 + (Math.random() * 2 - 1) * pv), 0.2, 4);
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
  S.setLegacy = (on) => { S.legacy = !!on; for (const r of S.roles.values()) { r.bag = []; r.recent = []; } };
  S.setBase = (url) => { S.base = url.endsWith('/') ? url : url + '/'; };
  // the saw set is wanted NOW (weapon selected / engine warmed up): move its not yet decoded clips to the front of the queue (and load them first if loading has not begun)
  S.prioritize = (what) => {
    if (what !== 'chainsaw') return;
    wantSaw = true; if (!queue.length) return;
    const isSaw = (c) => c.saw && !c.legacy; queue = [...queue.filter(isSaw), ...queue.filter((c) => !isSaw(c))];
  };
  S.loudness = (x) => (dsp ? 20 * Math.log10(Math.max(1e-9, dsp.loudest(dsp.weighted(x), 0.2))) : NaN);
  S.clips = (group, role) => (S.groups.get(group) || []).filter((c) => c.buf && (!role || c.role === role));
  S.counts = () => { const o = {}; for (const [r, v] of S.roles) o[r] = v.ready.length; return o; };
  S.sawCounts = () => Object.fromEntries(Object.entries(S.saw).filter(([k]) => k !== 'version').map(([k, v]) => [k, v.length]));
  S.decodedMB = () => +decodedMB().toFixed(1);
  S.info = () => {
    const roles = {};
    for (const [r, v] of S.roles) roles[r] = { mode: MIX[r].mode, n: v.ready.length, clips: v.ready.map((c) => ({ file: c.group + '/' + c.file, dur: +c.dur.toFixed(2), loudDb: +c.loudDb.toFixed(1), peak: +c.peak.toFixed(2), gainDb: +(20 * Math.log10(c.gain)).toFixed(1), pre: c.pre })) };
    const saw = []; for (const [k, l] of Object.entries(S.saw)) if (k !== 'version') for (const c of l) saw.push({ file: c.group + '/' + c.file, role: c.role, kind: k, dur: +c.dur.toFixed(2), loudDb: +c.loudDb.toFixed(1), loudHP: +c.loudHP.toFixed(1), f0: c.fundamentalHz, loop: c.loop, loopStart: c.loopStart, loopEnd: c.loopEnd, loaded: c.loaded });
    return { enabled: S.enabled, legacy: S.legacy, loaded: S.loaded, ...S.stats, decodedMB: S.decodedMB(), groups: [...S.groups].map(([g, l]) => [g, l.length, l.filter((c) => c.buf).length]), roles, chainsaw: saw };
  };
  S.dispose = () => { epoch++; queue = []; for (const l of S.groups.values()) for (const c of l) c.buf = null; S.roles.clear(); S.groups.clear(); for (const k of Object.keys(S.saw)) if (k !== 'version') S.saw[k] = []; };
  return S;
}
