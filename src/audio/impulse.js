// Generated stereo impulse response for the shared convolution reverb: a large tiled subway hall
// (early tile reflections + dense, high-frequency-damped exponential tail, ~2 s RT60).
import { SR, TAU, rng } from './dsp.js';

export function makeImpulse(seconds = 2.1, seed = 4242) {
  const n = Math.round(seconds * SR), out = [new Float32Array(n), new Float32Array(n)], pre = Math.round(0.009 * SR), rt60 = 1.9;
  for (let ch = 0; ch < 2; ch++) {
    const R = rng(seed + ch * 977), a = out[ch];
    // early reflections: platform walls / vaulted ceiling / columns
    for (let k = 0; k < 18; k++) {
      const t = 0.006 + Math.pow(R.r(), 1.4) * 0.085, i = pre + Math.round(t * SR), g = (R.r() < 0.5 ? -1 : 1) * (0.55 * Math.exp(-t / 0.05)) * (0.6 + 0.4 * R.r());
      if (i < n) a[i] += g;
    }
    // diffuse tail with time-varying one-pole damping (bright -> dark)
    let y = 0;
    const start = pre + Math.round(0.012 * SR);
    for (let i = start; i < n; i++) {
      const t = (i - start) / SR, k = 1 - Math.exp(-TAU * (9500 * Math.exp(-t * 1.75) + 1100) / SR);
      y += k * (R.g() - y);
      const env = Math.exp(-6.91 * t / rt60) * Math.min(1, t / 0.02);
      a[i] += y * env * 0.5;
    }
    // gentle low cut so the wash doesn't muddy the bass
    let lp = 0; const kl = 1 - Math.exp(-TAU * 140 / SR);
    for (let i = 0; i < n; i++) { lp += kl * (a[i] - lp); a[i] -= lp * 0.85; }
    const f = Math.round(0.25 * SR); for (let i = 0; i < f; i++) a[n - 1 - i] *= i / f;
  }
  return out;
}
