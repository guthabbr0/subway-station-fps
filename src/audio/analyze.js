// Offline analysis of rendered sound buffers (peak / RMS / duration / spectral centroid / band shares / decay).
// Used by audio.analyze() (in-page verification) and by the Node test harness.
import { SR, toDb, weighted } from './dsp.js';

export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

const N = 2048, HANN = new Float32Array(N); for (let i = 0; i < N; i++) HANN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
export const BAND_EDGES = [0, 100, 400, 1500, 5000, 22050]; // sub, low, low-mid, mid, high
const FP_EDGES = []; for (let i = 0; i <= 20; i++) FP_EDGES.push(40 * Math.pow(18000 / 40, i / 20)); // 20 log bands for fingerprints

// Energy-weighted spectrum accumulators over the whole buffer.
export function spectrum(buf) {
  const acc = new Float64Array(N / 2), re = new Float32Array(N), im = new Float32Array(N);
  const hop = N / 2, frames = Math.max(1, Math.floor((buf.length - N) / hop) + 1);
  for (let f = 0; f < frames; f++) {
    const s = f * hop;
    for (let i = 0; i < N; i++) { re[i] = (buf[s + i] || 0) * HANN[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
  }
  return acc;
}

export function statsOf(buf) {
  const n = buf.length; let peak = 0, sum = 0, clip = 0, mean = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; sum += buf[i] * buf[i]; mean += buf[i]; if (a >= 0.999) clip++; }
  const rms = Math.sqrt(sum / n);
  // loudest 200ms window
  const wb = weighted(buf), w = Math.min(n, Math.round(0.2 * SR)), hop = Math.max(1, w >> 2); let best = 0;
  for (let s = 0; s + w <= n; s += hop) { let e = 0; for (let i = s; i < s + w; i++) e += wb[i] * wb[i]; e = Math.sqrt(e / w); if (e > best) best = e; }
  // 10ms RMS envelope -> time of peak & time to fall 40 dB below it
  const eh = Math.round(0.01 * SR), env = []; for (let s = 0; s < n; s += eh) { let e = 0; const m = Math.min(eh, n - s); for (let i = s; i < s + m; i++) e += buf[i] * buf[i]; env.push(Math.sqrt(e / m)); }
  let emax = 0, ei = 0; env.forEach((v, i) => { if (v > emax) { emax = v; ei = i; } });
  let t40 = env.length; for (let i = env.length - 1; i >= ei; i--) if (env[i] > emax * 0.01) { t40 = i + 1; break; }
  const spec = spectrum(buf); let tot = 0, cen = 0; const bands = [0, 0, 0, 0, 0];
  for (let k = 1; k < N / 2; k++) { const f = k * SR / N, p = spec[k]; tot += p; cen += p * f; for (let b = 0; b < 5; b++) if (f >= BAND_EDGES[b] && f < BAND_EDGES[b + 1]) { bands[b] += p; break; } }
  let roll = 0, cum = 0; for (let k = 1; k < N / 2; k++) { cum += spec[k]; if (cum >= tot * 0.85) { roll = k * SR / N; break; } }
  return { dur: n / SR, peak, rms: toDb(rms), l200: toDb(best), centroid: cen / (tot || 1), rolloff85: roll, bands: bands.map((b) => b / (tot || 1)), t40: (t40 - ei) * 0.01, peakAt: ei * 0.01, crest: toDb(peak / (rms || 1e-9)), clip, dc: mean / n };
}

// 20-band log-spectrum fingerprint (dB, mean-removed) for near-duplicate detection
export function fingerprint(buf) {
  const spec = spectrum(buf), fp = [];
  for (let b = 0; b < 20; b++) { let e = 0; for (let k = 1; k < N / 2; k++) { const f = k * SR / N; if (f >= FP_EDGES[b] && f < FP_EDGES[b + 1]) e += spec[k]; } fp.push(10 * Math.log10(e + 1e-9)); }
  const m = fp.reduce((a, b) => a + b, 0) / fp.length; return fp.map((v) => v - m);
}
export function fpDist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); }
