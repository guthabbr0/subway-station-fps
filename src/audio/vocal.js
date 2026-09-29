// Formant vocal synthesiser: glottal saw source (jitter, vocal-fry, roughness AM, breath) through a parallel
// bank of SVF band-passes whose centre frequencies glide between vowel targets. Used for zombie/brute/player voices.
import { SR, TAU, SVF, mkEnv, smoothNoise, clamp } from './dsp.js';

export const VOW = {
  a: [730, 1090, 2440, 3400], o: [570, 840, 2410, 3300], u: [300, 870, 2240, 3200], e: [530, 1840, 2480, 3400],
  i: [270, 2290, 3010, 3700], ae: [660, 1720, 2410, 3400], uh: [640, 1190, 2390, 3300], aw: [590, 880, 2540, 3300],
  // dark, throaty "growl" vowels (lowered F2/F3)
  gr: [520, 760, 1900, 2900], er: [490, 1350, 1690, 2800],
};
const BW = [85, 110, 170, 240], FG = [1, 0.6, 0.34, 0.2];

function keyframes(v) { return typeof v === 'string' ? [[0, v]] : v; }
function vowelAt(keys, u, scale, out) {
  let a = keys[0], b = keys[0];
  for (let i = 0; i < keys.length; i++) { if (keys[i][0] <= u) a = keys[i]; if (keys[i][0] >= u) { b = keys[i]; break; } b = keys[i]; }
  const va = VOW[a[1]], vb = VOW[b[1]], span = b[0] - a[0], t = span > 1e-6 ? clamp((u - a[0]) / span, 0, 1) : 0, s = t * t * (3 - 2 * t);
  for (let k = 0; k < 4; k++) out[k] = va[k] * Math.pow(vb[k] / va[k], s) * scale;
}

// o: {t, dur, f0: Hz|fn(u01), vow: 'a'|[[u01,'a'],[u01,'o']], scale, breath, rough, roughHz, jitter, sub, drive, amp, env(secs), hiss, hissF, tilt, gurgle, gurgleHz}
export function vocal(out, o, R) {
  const at = Math.round((o.t || 0) * SR), n = Math.min(Math.round(o.dur * SR), out.length - at);
  if (n <= 0) return out;
  const f0f = typeof o.f0 === 'function' ? o.f0 : () => o.f0, keys = keyframes(o.vow || 'a'), scale = o.scale ?? 1;
  const breath = o.breath ?? 0.15, rough = o.rough ?? 0.3, roughHz = o.roughHz ?? 32, jit = o.jitter ?? 0.02, sub = o.sub ?? 0;
  const env = mkEnv(o.env), amp = o.amp ?? 1, tilt = o.tilt ?? 0.4, drive = o.drive ?? 2, hiss = o.hiss ?? 0, hissF = o.hissF ?? 3500;
  const gur = o.gurgle ?? 0, gurHz = o.gurgleHz ?? 22;
  const drift = smoothNoise(n, 7, R), rmod = smoothNoise(n, 12, R), gmod = smoothNoise(n, 18, R);
  const filters = [new SVF(), new SVF(), new SVF(), new SVF()], hf = new SVF(), F = [0, 0, 0, 0];
  const dur = n / SR; let ph = 0, lp = 0, jc = 1, alt = 0, hlp = 0;
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, u = t / dur;
    if ((i & 15) === 0) { vowelAt(keys, u, scale, F); for (let k = 0; k < 4; k++) filters[k].set(F[k], F[k] / BW[k]); if (hiss) hf.set(hissF, 1.6); }
    const f = f0f(u) * (1 + drift[i] * jit * 0.5) * jc;
    const dt = f / SR; ph += dt;
    if (ph >= 1) { ph -= 1; jc = 1 + (R.r() - 0.5) * 2 * jit; alt ^= 1; }
    let saw = 2 * ph - 1;
    if (ph < dt) { const x = ph / dt; saw -= x + x - x * x - 1; } else if (ph > 1 - dt) { const x = (ph - 1) / dt; saw -= x * x + x + x + 1; }
    lp += tilt * (saw - lp);
    let v = lp * (sub && alt ? 1 - sub * 0.65 : 1);
    v *= 1 - rough * (0.5 + 0.5 * Math.sin(TAU * roughHz * t + rmod[i] * 0.8));
    if (gur) v *= 1 - gur * Math.max(0, 0.5 + 0.5 * Math.tanh(gmod[i] * 0.9 + Math.sin(TAU * gurHz * t)));
    const src = v + breath * (R.r() * 2 - 1) * (0.4 + 0.6 * Math.abs(lp));
    let y = 0;
    for (let k = 0; k < 4; k++) y += filters[k].bp(src) * FG[k];
    let w = Math.tanh(drive * y) / Math.tanh(drive);
    if (hiss) { const nz = hf.bp(R.r() * 2 - 1); w += nz * hiss; }
    buf[i] = w * amp * env(t);
  }
  for (let i = 0; i < n; i++) out[at + i] += buf[i];
  return out;
}
