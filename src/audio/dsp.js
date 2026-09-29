// Tiny offline DSP toolkit for the procedural sound bank. Pure JS, no DOM/WebAudio: runs in a Worker, the
// main thread or Node. Everything renders into mono Float32Arrays at SR.
export const SR = 44100;
export const TAU = Math.PI * 2;
export const dB = (x) => Math.pow(10, x / 20);
export const toDb = (x) => 20 * Math.log10(Math.max(x, 1e-9));
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mixv = (a, b, t) => a + (b - a) * t;

export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Seeded RNG (mulberry32) with helpers.
export function rng(seed) {
  let a = (seed >>> 0) || 1, spare = null;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    r,
    rr: (lo, hi) => lo + (hi - lo) * r(),
    ri: (lo, hi) => Math.floor(lo + (hi - lo + 1) * r()),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
    sgn: () => (r() < 0.5 ? -1 : 1),
    g: () => { if (spare !== null) { const s = spare; spare = null; return s; } let u = 0, v = 0; while (u === 0) u = r(); v = r(); const m = Math.sqrt(-2 * Math.log(u)); spare = m * Math.sin(TAU * v); return m * Math.cos(TAU * v); },
  };
}

export const alloc = (sec) => new Float32Array(Math.max(1, Math.round(sec * SR)));

// ---- envelopes ---------------------------------------------------------------------------------------------
// An envelope is (t seconds since layer start) => gain. Specs: number => exp decay time constant; function; array of [t,v] (linear).
export const E = {
  exp: (tau) => (t) => Math.exp(-t / tau),
  ad: (a, tau) => (t) => (t < a ? t / a : Math.exp(-(t - a) / tau)),
  // attack a, hold, then linear release r
  adr: (a, hold, r) => (t) => (t < a ? t / a : t < a + hold ? 1 : Math.max(0, 1 - (t - a - hold) / r)),
  // attack a, exp decay to sustain level s (time constant tau) then release r after `hold` (from t=0)
  adsr: (a, tau, s, hold, r) => (t) => {
    const base = t < a ? t / a : s + (1 - s) * Math.exp(-(t - a) / tau);
    return t < hold ? base : base * Math.max(0, 1 - (t - hold) / r);
  },
  pts: (p) => (t) => {
    if (t <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) if (t < p[i][0]) { const a = p[i - 1], b = p[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); }
    return p[p.length - 1][1];
  },
  // geometric (exponential) interpolation between points; values must be > 0
  epts: (p) => (t) => {
    if (t <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) if (t < p[i][0]) { const a = p[i - 1], b = p[i]; return a[1] * Math.pow(b[1] / a[1], (t - a[0]) / (b[0] - a[0])); }
    return p[p.length - 1][1];
  },
  gauss: (c, w) => (t) => { const x = (t - c) / w; return Math.exp(-x * x); },
  swell: (dur) => (t) => Math.sin(clamp(t / dur, 0, 1) * Math.PI),
};
export function mkEnv(spec) {
  if (spec == null) return () => 1;
  if (typeof spec === 'function') return spec;
  if (typeof spec === 'number') return E.exp(spec);
  if (Array.isArray(spec)) return E.pts(spec);
  return () => 1;
}
// exponential glide helper: from a to b with time-constant tau (u seconds).
export const glide = (a, b, tau) => (u) => b + (a - b) * Math.exp(-u / tau);
// exponential sweep a -> b over dur seconds
export const sweep = (a, b, dur) => (u) => a * Math.pow(b / a, clamp(u / dur, 0, 1));

// ---- noise -------------------------------------------------------------------------------------------------
export function fillNoise(a, color, R) {
  const n = a.length, r = R.r;
  if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.22; b6 = w * 0.115926;
    }
  } else if (color === 'brown') {
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (r() * 2 - 1)) / 1.02; a[i] = last * 6.5; }
  } else for (let i = 0; i < n; i++) a[i] = r() * 2 - 1;
  return a;
}

// Unit-variance smooth random curve (lowpassed noise), for AM / pitch wobble / stick-slip. cutoff in Hz.
export function smoothNoise(n, fc, R) {
  const a = new Float32Array(n), k = 1 - Math.exp(-TAU * fc / SR), gain = Math.sqrt((2 - k) / k * 3);
  let y = 0;
  for (let i = 0; i < n; i++) { y += k * ((R.r() * 2 - 1) - y); a[i] = y * gain; }
  return a;
}

// ---- filters -----------------------------------------------------------------------------------------------
export class Biquad {
  constructor(type = 'lp', f = 1000, q = 0.707, g = 0) { this.type = type; this.z1 = 0; this.z2 = 0; this.q = q; this.g = g; this.set(f, q, g); }
  set(f, q = this.q, g = this.g) {
    this.f = f; this.q = q; this.g = g;
    f = f < 10 ? 10 : f > SR * 0.47 ? SR * 0.47 : f;
    const w = TAU * f / SR, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'bp': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'ap': b0 = 1 - al; b1 = -2 * cw; b2 = 1 + al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'peak': { const A = Math.pow(10, g / 40); b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; break; }
      case 'ls': { const A = Math.pow(10, g / 40), s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
      case 'hs': { const A = Math.pow(10, g / 40), s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
      default: b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; // lp
    }
    const ia = 1 / a0; this.b0 = b0 * ia; this.b1 = b1 * ia; this.b2 = b2 * ia; this.a1 = a1 * ia; this.a2 = a2 * ia;
  }
  process(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
}

// Zero-delay-feedback state variable filter; bp() is unity-gain at centre. Good for formant banks.
export class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.set(1000, 2); }
  set(f, q) {
    f = f < 20 ? 20 : f > SR * 0.45 ? SR * 0.45 : f;
    const g = Math.tan(Math.PI * f / SR), k = 1 / q;
    this.k = k; this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  bp(x) {
    const v3 = x - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2; return v1 * this.k;
  }
}

// Build the biquad section(s) for a filter spec: {type, f: number|fn(u), q, g, order: 2|4}
function makeSections(spec) {
  const f0 = typeof spec.f === 'function' ? spec.f(0) : spec.f, q0 = typeof spec.q === 'function' ? spec.q(0) : (spec.q ?? 0.707);
  if (spec.order === 4 && (spec.type === 'lp' || spec.type === 'hp')) return [new Biquad(spec.type, f0, 0.5412), new Biquad(spec.type, f0, 1.3066)];
  return [new Biquad(spec.type, f0, q0, spec.g || 0)];
}
// In-place filtering of buf[from..to) with a static or time-varying (u = seconds since `from`) filter.
export function filt(buf, spec, from = 0, to = buf.length) {
  const secs = makeSections(spec), dynF = typeof spec.f === 'function', dynQ = typeof spec.q === 'function';
  const four = secs.length === 2;
  for (let i = from; i < to; i++) {
    if ((dynF || dynQ) && ((i - from) & 15) === 0) {
      const u = (i - from) / SR, f = dynF ? spec.f(u) : spec.f, q = dynQ ? spec.q(u) : spec.q;
      if (four) { secs[0].set(f); secs[1].set(f); } else secs[0].set(f, q ?? 0.707);
    }
    let x = buf[i];
    x = secs[0].process(x); if (four) x = secs[1].process(x);
    buf[i] = x;
  }
  return buf;
}
export function filtAll(buf, specs) { for (const s of specs) filt(buf, s); return buf; }
// Circular filtering (for seamless loops): runs the filter over the buffer twice and keeps the 2nd pass.
export function circFilt(buf, spec) {
  const n = buf.length, two = new Float32Array(n * 2); two.set(buf, 0); two.set(buf, n);
  filt(two, spec); buf.set(two.subarray(n)); return buf;
}

export function circNoise(n, color, R, specs = []) { const a = fillNoise(new Float32Array(n), color, R); for (const s of specs) circFilt(a, s); return a; }
export function normStd(a, target = 1) { let e = 0; for (let i = 0; i < a.length; i++) e += a[i] * a[i]; const g = target / Math.sqrt(e / a.length + 1e-12); for (let i = 0; i < a.length; i++) a[i] *= g; return a; }
export function normPeak(a, p = 1) { const m = peakOf(a); if (m > 1e-9) { const g = p / m; for (let i = 0; i < a.length; i++) a[i] *= g; } return a; }
// normalise to unit peak then tanh-saturate (drive = amount of distortion)
export function satN(a, drive) { return sat(normPeak(a, 1), drive); }

// ---- layers ------------------------------------------------------------------------------------------------
// noise layer: {t, dur, color, amp, env, filters:[...], envFirst}
export function noise(out, o, R) {
  const at = Math.round((o.t || 0) * SR), n = Math.min(Math.round(o.dur * SR), out.length - at);
  if (n <= 0) return out;
  const src = fillNoise(new Float32Array(n), o.color || 'white', R), env = mkEnv(o.env), amp = o.amp ?? 1;
  if (o.envFirst) for (let i = 0; i < n; i++) src[i] *= env(i / SR);
  if (o.filters) for (const f of o.filters) filt(src, f);
  if (o.filters && !o.raw) { let e = 0; for (let i = 0; i < n; i++) e += src[i] * src[i]; const g = 0.58 / Math.sqrt(e / n + 1e-14); for (let i = 0; i < n; i++) src[i] *= g; } // layer amp ~ RMS (white noise reference)
  const fo = Math.min(n * 0.25, Math.round(0.01 * SR)); // short fade-out so layers never end in a step
  if (o.envFirst) for (let i = 0; i < n; i++) out[at + i] += src[i] * amp * (i >= n - fo ? (n - i) / fo : 1);
  else for (let i = 0; i < n; i++) out[at + i] += src[i] * amp * env(i / SR) * (i >= n - fo ? (n - i) / fo : 1);
  return out;
}

function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
// tone layer: {t, dur, f: Hz|fn(u), wave:'sin'|'saw'|'sqr'|'tri', pw, amp, env, fm:{ratio,index:n|fn}, vib:{rate,depth}, unison:[cents], filters, drive, phase}
export function tone(out, o, R) {
  const at = Math.round((o.t || 0) * SR), n = Math.min(Math.round(o.dur * SR), out.length - at);
  if (n <= 0) return out;
  const env = mkEnv(o.env), amp = o.amp ?? 1, wave = o.wave || 'sin';
  const ff = typeof o.f === 'function' ? o.f : null, fc = ff ? 0 : o.f;
  const uni = o.unison || [0], nu = uni.length, rat = uni.map((c) => Math.pow(2, c / 1200));
  const ph = new Float64Array(nu); for (let k = 0; k < nu; k++) ph[k] = o.phase ?? (nu > 1 || wave !== 'sin' ? R.r() : 0);
  const fm = o.fm, fmI = fm ? (typeof fm.index === 'function' ? fm.index : () => fm.index) : null;
  let phm = 0;
  const fo = Math.min(n * 0.25, Math.round(0.01 * SR)), vib = o.vib, pw = o.pw ?? 0.5, post = !!(o.filters || o.drive), buf = post ? new Float32Array(n) : null, norm = 1 / Math.sqrt(nu);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let f = ff ? ff(t) : fc; if (vib) f *= 1 + vib.depth * Math.sin(TAU * vib.rate * t); if (f < 0) f = 0;
    let s = 0;
    for (let k = 0; k < nu; k++) {
      const dt = f * rat[k] / SR; let p = ph[k] + dt; if (p >= 1) p -= 1; ph[k] = p;
      if (wave === 'sin') { if (fm && k === 0) { phm += f * fm.ratio / SR; if (phm >= 1) phm -= 1; s += Math.sin(TAU * p + fmI(t) * Math.sin(TAU * phm)); } else s += Math.sin(TAU * p); }
      else if (wave === 'saw') s += 2 * p - 1 - polyBlep(p, dt);
      else if (wave === 'sqr') { let v = p < pw ? 1 : -1; v += polyBlep(p, dt); v -= polyBlep((p + 1 - pw) % 1, dt); s += v; }
      else s += 4 * Math.abs(p - 0.5) - 1;
    }
    const v = s * norm * amp * env(t) * (i >= n - fo ? (n - i) / fo : 1);
    if (buf) buf[i] = v; else out[at + i] += v;
  }
  if (buf) {
    if (o.filters) for (const f of o.filters) filt(buf, f);
    if (o.drive) { const d = o.drive, nd = 1 / Math.tanh(d); for (let i = 0; i < n; i++) buf[i] = Math.tanh(d * buf[i]) * nd; }
    for (let i = 0; i < n; i++) out[at + i] += buf[i];
  }
  return out;
}

// modal layer: bank of exponentially decaying sinusoids (bells, metal hits, glass, pings).
// {t, f, ratios:[..], amps:[..], taus: number|[..], amp, phase, dur?}
export function modal(out, o) {
  const at = Math.round((o.t || 0) * SR), ratios = o.ratios, amps = o.amps || ratios.map(() => 1);
  const taus = Array.isArray(o.taus) ? o.taus : ratios.map(() => o.taus), amp = o.amp ?? 1;
  for (let m = 0; m < ratios.length; m++) {
    const f = o.f * ratios[m]; if (f >= SR * 0.48) continue;
    const tau = taus[m], w = TAU * f / SR, dec = Math.exp(-1 / (tau * SR)), c = Math.cos(w), s = Math.sin(w);
    const len = Math.min(Math.round((o.dur ?? tau * 9) * SR), out.length - at);
    const ph0 = o.phase ?? 1.3; let re = Math.cos(ph0), im = Math.sin(ph0); const a = amps[m] * amp;
    for (let i = 0; i < len; i++) {
      out[at + i] += im * a;
      const nr = dec * (re * c - im * s), ni = dec * (re * s + im * c); re = nr; im = ni;
    }
  }
  return out;
}

// clicks: Poisson-scattered damped micro-resonators (crackle, debris, sizzle, gravel).
// {t, dur, rate: Hz|fn(u), f:[lo,hi], tau, amp, env}
export function clicks(out, o, R) {
  const at = Math.round((o.t || 0) * SR), n = Math.min(Math.round(o.dur * SR), out.length - at);
  const rateF = typeof o.rate === 'function' ? o.rate : () => o.rate, env = mkEnv(o.env), amp = o.amp ?? 1;
  const [flo, fhi] = o.f || [1500, 6000], tau = o.tau ?? 0.002, len = Math.ceil(tau * SR * 6);
  for (let i = 0; i < n; i++) {
    const u = i / SR;
    if (R.r() < rateF(u) / SR) {
      const f = flo * Math.pow(fhi / flo, R.r()), w = TAU * f / SR, a = amp * env(u) * (0.35 + 0.65 * R.r()) * (R.r() < 0.5 ? -1 : 1), tt = tau * (0.6 + 0.8 * R.r());
      const end = Math.min(len, out.length - at - i);
      for (let j = 0; j < end; j++) out[at + i + j] += a * Math.sin(w * j) * Math.exp(-j / (tt * SR));
    }
  }
  return out;
}

// ---- buffer utilities --------------------------------------------------------------------------------------
export function mixInto(dst, src, at = 0, gain = 1) {
  const o = Math.round(at * SR), n = Math.min(src.length, dst.length - o);
  for (let i = 0; i < n; i++) dst[o + i] += src[i] * gain;
  return dst;
}
export function gainBuf(buf, g) { for (let i = 0; i < buf.length; i++) buf[i] *= g; return buf; }
// tanh saturation normalised so +-1 maps to +-1
export function sat(buf, drive, asym = 0) {
  const nd = 1 / Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) { const x = buf[i] + asym; buf[i] = (Math.tanh(drive * x) - Math.tanh(drive * asym)) * nd; }
  return buf;
}
// retro sample-rate / bit-depth reduction (Doom-era grit): hold every `hold` samples, quantise to `bits`
export function crush(buf, bits = 9, hold = 2) {
  const q = Math.pow(2, bits - 1); let h = 0;
  for (let i = 0; i < buf.length; i++) { if (i % hold === 0) h = Math.round(buf[i] * q) / q; buf[i] = h; }
  return buf;
}
export function fold(buf, drive) { for (let i = 0; i < buf.length; i++) { let x = buf[i] * drive; x = Math.abs(((x + 1) % 4 + 4) % 4 - 2) - 1; buf[i] = x; } return buf; }
export function fadeEdges(buf, inSec, outSec) {
  const a = Math.round(inSec * SR), b = Math.round(outSec * SR), n = buf.length;
  for (let i = 0; i < a && i < n; i++) buf[i] *= i / a;
  for (let i = 0; i < b && i < n; i++) { const g = i / b; buf[n - 1 - i] *= g * g * (3 - 2 * g); }
  return buf;
}
export function dcBlock(buf, fc = 18) {
  const R = 1 - TAU * fc / SR; let x1 = 0, y1 = 0;
  for (let i = 0; i < buf.length; i++) { const x = buf[i], y = x - x1 + R * y1; x1 = x; y1 = y; buf[i] = y; }
  return buf;
}
export function peakOf(buf) { let p = 0; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; } return p; }
// linear-interpolating resampler: ratio > 1 => higher pitch, shorter.
export function resample(buf, ratio) {
  const n = Math.floor(buf.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * ratio, j = Math.floor(p), f = p - j; out[i] = buf[j] * (1 - f) + (buf[j + 1] ?? 0) * f; }
  return out;
}
// multi-tap echo: taps [[delaySec, gain, lpHz?]]
export function echo(buf, taps) {
  const out = new Float32Array(buf);
  for (const [d, g, lp] of taps) {
    const o = Math.round(d * SR); let y = 0; const k = lp ? 1 - Math.exp(-TAU * lp / SR) : 1;
    for (let i = 0; i + o < buf.length; i++) { y += k * (buf[i] - y); out[i + o] += y * g; }
  }
  return out;
}
// amplitude-modulate buf by a curve function of time (seconds)
export function am(buf, fn) { for (let i = 0; i < buf.length; i++) buf[i] *= fn(i / SR); return buf; }

// Freeverb-style mono reverb for baking tails into chimes / drips. Returns a new, longer buffer.
export function reverb(inp, o = {}) {
  const room = o.room ?? 0.75, damp = o.damp ?? 0.35, wet = o.wet ?? 0.3, tail = o.tail ?? 1.5, pre = Math.round((o.pre ?? 0.012) * SR);
  const n = inp.length + Math.round(tail * SR), out = new Float32Array(n);
  const ct = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], at = [556, 441, 341, 225];
  const combs = ct.map((l) => ({ b: new Float32Array(l + 23), i: 0, l: l + 23, s: 0 })), aps = at.map((l) => ({ b: new Float32Array(l), i: 0, l }));
  const fb = 0.7 + room * 0.28, d1 = damp, d2 = 1 - damp;
  for (let i = 0; i < n; i++) {
    const src = i - pre >= 0 && i - pre < inp.length ? inp[i - pre] * 0.03 : 0;
    let s = 0;
    for (let c = 0; c < 8; c++) { const cb = combs[c], y = cb.b[cb.i]; cb.s = y * d2 + cb.s * d1; cb.b[cb.i] = src + cb.s * fb; if (++cb.i >= cb.l) cb.i = 0; s += y; }
    for (let a = 0; a < 4; a++) { const ap = aps[a], y = ap.b[ap.i]; ap.b[ap.i] = s + y * 0.5; s = y - s; if (++ap.i >= ap.l) ap.i = 0; }
    out[i] = (i < inp.length ? inp[i] : 0) + s * wet * 3.2;
  }
  const f = Math.round(0.15 * SR); for (let i = 0; i < f; i++) out[n - 1 - i] *= i / f; // fade tail
  return out;
}

// ---- rhythm / engine helper -------------------------------------------------------------------------------
// Resonant "pop" used for engine firing pulses & rail clacks: a few damped modes + a noise tick.
export function pop(out, at, modes, amp, R, tickAmp = 0) {
  const o = Math.round(at * SR);
  for (const [f, tau, a] of modes) {
    const w = TAU * f / SR, dec = Math.exp(-1 / (tau * SR)), len = Math.min(Math.round(tau * 7 * SR), out.length - o);
    let re = 1, im = 0; const c = Math.cos(w), s = Math.sin(w);
    for (let i = 0; i < len; i++) { out[o + i] += im * a * amp; const nr = dec * (re * c - im * s), ni = dec * (re * s + im * c); re = nr; im = ni; }
  }
  if (tickAmp) { const len = Math.min(Math.round(0.004 * SR), out.length - o); let y = 0; for (let i = 0; i < len; i++) { y += 0.6 * ((R.r() * 2 - 1) - y); out[o + i] += y * tickAmp * amp * Math.exp(-i / (0.0012 * SR)); } }
}
// circular variant (wraps around end) for seamless loops
export function popCirc(out, at, modes, amp, R, tickAmp = 0) {
  const n = out.length, tmp = new Float32Array(n * 2); pop(tmp, at % (n / SR), modes, amp, R, tickAmp);
  for (let i = 0; i < n; i++) out[i] += tmp[i] + tmp[i + n];
}

// ---- analysis helpers used by finalize() ------------------------------------------------------------------
// rough A-weighting stand-in (small speakers / ear): 4th-order high-pass @110Hz + low-pass @14k
export function weighted(buf) { const c = new Float32Array(buf); filt(c, { type: 'hp', f: 110, order: 4 }); filt(c, { type: 'lp', f: 14000 }); return c; }
// max RMS over sliding windows of `win` seconds (or the whole buffer when shorter)
export function loudest(buf, win = 0.2) {
  const w = Math.min(buf.length, Math.round(win * SR)), hop = Math.max(1, w >> 2);
  let best = 0;
  for (let s = 0; s + w <= buf.length; s += hop) { let e = 0; for (let i = s; i < s + w; i++) e += buf[i] * buf[i]; e = Math.sqrt(e / w); if (e > best) best = e; }
  return best;
}
