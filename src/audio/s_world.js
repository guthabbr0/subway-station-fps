// Train / station / ambience sound recipes.
import { vocal } from './vocal.js';
import { SR, TAU, E, alloc, noise, tone, modal, clicks, sat, satN, normPeak, glide, sweep, filt, circFilt, circNoise, normStd, fillNoise, mixInto, clamp, reverb, echo, pop, popCirc, smoothNoise, am } from './dsp.js';

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const CLACK = [[95, 0.03, 1.0], [210, 0.05, 0.5], [420, 0.03, 0.3], [1300, 0.008, 0.25]];
const th = Math.tanh;

function bell(o, at, f, amp, tau) {
  modal(o, { t: at, f, ratios: [1, 2.0, 2.76, 4.07, 5.4], amps: [1, 0.35, 0.22, 0.1, 0.05], taus: [tau, tau * 0.6, tau * 0.45, tau * 0.3, tau * 0.2], amp, phase: 0 });
}

export const world = {
  // ---- trains ---------------------------------------------------------------------------------------------
  trainRumble: { loop: true, lv: -19, gen(R) {
    const L = 4, n = Math.round(L * SR), o = new Float32Array(n);
    const low = normStd(circNoise(n, 'brown', R, [{ type: 'lp', f: 95 }])), mid = normStd(circNoise(n, 'pink', R, [{ type: 'bp', f: 380, q: 0.6 }]));
    const hi = normStd(circNoise(n, 'white', R, [{ type: 'hp', f: 3200 }])), slow = normStd(circNoise(n, 'white', R, [{ type: 'lp', f: 2, order: 4 }]));
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      o[i] = low[i] * (0.9 + 0.2 * slow[i]) + mid[i] * (0.32 + 0.14 * slow[i]) + hi[i] * 0.05 * (0.6 + 0.4 * Math.sin(TAU * 0.5 * t))
        + Math.sin(TAU * 330 * t) * 0.03 * (0.7 + 0.3 * Math.sin(TAU * t)) + Math.sin(TAU * 660 * t) * 0.014 + Math.sin(TAU * 48 * t) * 0.28;
    }
    for (let k = 0; k < 16; k++) { const t0 = k * 0.25 + R.rr(-0.004, 0.004); popCirc(o, t0, CLACK, 0.5 * R.rr(0.7, 1.1), R, 0.5); popCirc(o, t0 + 0.036, CLACK, 0.4 * R.rr(0.7, 1.1), R, 0.4); }
    return normPeak(o, 0.9);
  } },

  // ~9 s train braking (train.js plays it 0.5 s after the nose passes the portal; the stop lands at ~8.5 s)
  trainBrake: { lv: -14, pk: 0.9, gen(R) {
    const L = 9.8, o = alloc(L), S = 0.25, D = 8.3, nn = Math.round(D * SR);
    const spd = (u) => Math.pow(Math.max(0, 1 - (u + S + 0.5) / 9), 1.5);                    // relative train speed
    // per-sample lookup tables (cheaper than re-evaluating the curves in every layer)
    const fqA = new Float32Array(nn + 2), baseA = new Float32Array(nn + 2), spdA = new Float32Array(nn + 2);
    for (let i = 0; i < nn + 2; i++) { const u = i / SR, s = spd(u); spdA[i] = s; fqA[i] = 1450 + 1850 * Math.pow(s, 0.55); baseA[i] = Math.min(1, u / 0.6) * (u < 6.6 ? 1 : Math.max(0, 1 - (u - 6.6) / 1.6)); }
    const at = (A, u) => A[Math.min(nn + 1, (u * SR) | 0)];
    [[1, 1], [1.507, 0.62], [2.02, 0.42], [2.76, 0.26]].forEach(([r, a], k) => {   // stick-slip squeal partials (tight loop: this recipe is the most expensive one)
      const sm = smoothNoise(nn + 8, 4 + k * 1.5, R), o0 = Math.round(S * SR), amp = 0.3 * a / SR; let ph = R.r();
      for (let i = 0; i < nn; i++) {
        ph += fqA[i] * r / SR; ph -= Math.floor(ph);
        const g = clamp(0.62 + 0.5 * sm[i], 0, 1.35), fo = i > nn - 441 ? (nn - i) / 441 : 1;
        o[o0 + i] += Math.sin(TAU * ph) * baseA[i] * g * g * 0.3 * a * fo;
      }
    });
    const sm2 = smoothNoise(nn + 8, 6, R), gate2 = (u) => { const g = clamp(0.6 + 0.5 * sm2[Math.min(nn, (u * SR) | 0)], 0, 1.3); return at(baseA, u) * g * g; };
    noise(o, { t: S, dur: D, env: gate2, amp: 0.5, filters: [{ type: 'bp', f: (u) => at(fqA, u) * 1.02, q: 22 }] }, R);                                       // screech
    noise(o, { t: S, dur: D, env: gate2, amp: 0.32, filters: [{ type: 'bp', f: (u) => 500 + 600 * at(spdA, u), q: 1.5 }] }, R);                                // grind
    noise(o, { t: S, dur: 9.0, env: E.pts([[0, 0], [0.5, 1], [6, 0.8], [8.2, 0.2], [9, 0]]), amp: 0.7, filters: [{ type: 'lp', f: 130 }] }, R);              // rumble
    clicks(o, { t: 4.0, dur: 4.6, rate: (u) => 10 + 8 * u / 4.6, f: [300, 1600], tau: 0.006, amp: 0.4, env: (u) => Math.exp(-u / 3) }, R);                    // pad judder as it slows
    noise(o, { dur: 0.7, env: E.ad(0.005, 0.16), amp: 0.5, filters: [{ type: 'hp', f: 2600 }] }, R);                                                          // pneumatic pssh
    const T = 8.45;
    noise(o, { t: T - 0.1, dur: 1.2, env: E.ad(0.01, 0.32), amp: 0.85, filters: [{ type: 'hp', f: 2200 }] }, R);                                              // brake release hiss
    tone(o, { t: T, dur: 0.6, f: glide(85, 42, 0.08), env: E.ad(0.003, 0.12), amp: 1.1 }, R);                                                                  // stop clunk
    noise(o, { t: T, dur: 0.3, env: 0.07, amp: 0.7, filters: [{ type: 'lp', f: 420 }] }, R);
    modal(o, { t: T, f: 180, ratios: [1, 2.3, 3.8], amps: [0.4, 0.3, 0.2], taus: [0.2, 0.12, 0.08], amp: 0.5 });
    return normPeak(o, 1);
  } },

  trainDoorChime: { lv: -18, pk: 0.7, gen(R) {
    const o = alloc(1.8);
    bell(o, 0, 1318.5, 1.0, 0.55); bell(o, 0.36, 1046.5, 1.0, 0.85);
    tone(o, { dur: 0.5, f: 1318.5, env: E.ad(0.004, 0.2), amp: 0.25 }, R);
    tone(o, { t: 0.36, dur: 0.9, f: 1046.5, env: E.ad(0.004, 0.32), amp: 0.25 }, R);
    return reverb(o, { room: 0.6, wet: 0.16, tail: 0.5 });
  } },

  trainDoorOpen: { lv: -15, pk: 0.9, gen(R) {
    const o = alloc(2.4), S = 0.15, D = 1.3;
    noise(o, { dur: 0.5, env: E.ad(0.004, 0.11), amp: 1.0, filters: [{ type: 'hp', f: 2200 }] }, R);
    noise(o, { dur: 0.5, env: E.ad(0.004, 0.16), amp: 0.5, filters: [{ type: 'bp', f: 900, q: 0.8 }] }, R);
    tone(o, { t: 0.06, dur: 0.15, f: glide(160, 80, 0.025), env: 0.035, amp: 0.9 }, R);
    modal(o, { t: 0.06, f: 900, ratios: [1, 2.1, 3.6], amps: [0.5, 0.3, 0.2], taus: 0.02, amp: 0.7 });
    noise(o, { t: S, dur: D, env: E.pts([[0, 0], [0.15, 0.8], [D - 0.3, 1], [D, 0]]), amp: 0.5, filters: [{ type: 'bp', f: (u) => 520 + 500 * Math.sin(Math.PI * u / D), q: 1.1 }] }, R);
    noise(o, { t: S, dur: D, env: E.pts([[0, 0], [0.2, 1], [D - 0.2, 1], [D, 0]]), amp: 0.4, filters: [{ type: 'lp', f: 260 }] }, R);
    tone(o, { t: S, dur: D, f: (u) => 300 + 340 * Math.pow(Math.sin(Math.PI * u / D), 0.7), wave: 'saw', env: E.pts([[0, 0], [0.12, 1], [D - 0.15, 1], [D, 0]]), amp: 0.12, filters: [{ type: 'lp', f: 2200 }] }, R);
    clicks(o, { t: S, dur: D, rate: 44, f: [500, 2000], tau: 0.004, amp: 0.35 }, R);
    const T = S + D;
    tone(o, { t: T, dur: 0.4, f: glide(112, 58, 0.06), env: E.ad(0.002, 0.09), amp: 1.1 }, R);
    noise(o, { t: T, dur: 0.2, env: 0.05, amp: 0.8, filters: [{ type: 'lp', f: 520 }] }, R);
    modal(o, { t: T, f: 340, ratios: [1, 2.4, 3.9], amps: [0.5, 0.3, 0.2], taus: [0.09, 0.05, 0.03], amp: 0.6 });
    clicks(o, { t: T, dur: 0.3, rate: 120, f: [500, 3000], tau: 0.004, amp: 0.3, env: E.exp(0.1) }, R);
    noise(o, { t: T + 0.12, dur: 0.5, env: E.ad(0.01, 0.1), amp: 0.3, filters: [{ type: 'hp', f: 3000 }] }, R);
    return satN(o, 1.2);
  } },

  trainDoorClose: { lv: -15, pk: 0.9, gen(R) {
    const o = alloc(2.6);
    for (let k = 0; k < 2; k++) {
      tone(o, { t: k * 0.17, dur: 0.12, f: 2400, wave: 'sqr', env: E.adr(0.003, 0.085, 0.025), amp: 0.32, filters: [{ type: 'lp', f: 5200 }] }, R);
      tone(o, { t: k * 0.17, dur: 0.12, f: 4810, env: E.adr(0.003, 0.085, 0.025), amp: 0.09 }, R);
    }
    const S = 0.3, D = 1.4;
    noise(o, { t: S - 0.05, dur: 0.4, env: E.ad(0.004, 0.09), amp: 0.7, filters: [{ type: 'hp', f: 2400 }] }, R);
    noise(o, { t: S, dur: D, env: E.pts([[0, 0], [0.15, 0.8], [D - 0.3, 1], [D, 0]]), amp: 0.5, filters: [{ type: 'bp', f: (u) => 950 - 450 * Math.sin(Math.PI * u / D), q: 1.1 }] }, R);
    noise(o, { t: S, dur: D, env: E.pts([[0, 0], [0.2, 1], [D - 0.2, 1], [D, 0]]), amp: 0.4, filters: [{ type: 'lp', f: 260 }] }, R);
    tone(o, { t: S, dur: D, f: (u) => 620 - 240 * Math.pow(Math.sin(Math.PI * u / D), 0.7), wave: 'saw', env: E.pts([[0, 0], [0.12, 1], [D - 0.15, 1], [D, 0]]), amp: 0.12, filters: [{ type: 'lp', f: 2200 }] }, R);
    clicks(o, { t: S, dur: D, rate: 44, f: [500, 2000], tau: 0.004, amp: 0.35 }, R);
    const T = S + D;
    tone(o, { t: T, dur: 0.5, f: glide(80, 40, 0.09), env: E.ad(0.002, 0.11), amp: 1.4 }, R);
    noise(o, { t: T, dur: 0.25, env: 0.06, amp: 1.0, filters: [{ type: 'lp', f: 380 }] }, R);
    noise(o, { t: T, dur: 0.02, env: 0.004, amp: 0.7, filters: [{ type: 'bp', f: 1600, q: 0.8 }] }, R);
    modal(o, { t: T, f: 260, ratios: [1, 2.3, 3.5], amps: [0.5, 0.35, 0.2], taus: [0.1, 0.06, 0.04], amp: 0.5 });
    noise(o, { t: T + 0.06, dur: 0.5, env: E.ad(0.01, 0.1), amp: 0.5, filters: [{ type: 'hp', f: 2800 }] }, R);
    return satN(o, 1.2);
  } },

  trainHorn: { lv: -12, pk: 0.9, gen(R) {
    const o = alloc(2.6), env = E.adr(0.09, 1.5, 0.5);
    const horn = (f, amp) => tone(o, { dur: 2.1, f: (u) => f * (1 - 0.05 * Math.exp(-u / 0.05)), wave: 'saw', unison: [-6, 5], env, amp, vib: { rate: 5.3, depth: 0.002 }, filters: [{ type: 'lp', f: 1900, q: 0.8 }, { type: 'peak', f: 700, q: 1.2, g: 8 }] }, R);
    horn(311.1, 0.7); horn(370, 0.6); horn(155.6, 0.4);
    tone(o, { dur: 2.1, f: 622, wave: 'sqr', env, amp: 0.13, filters: [{ type: 'lp', f: 2500 }] }, R);
    noise(o, { dur: 2.1, env, amp: 0.07, filters: [{ type: 'bp', f: 1500, q: 0.6 }] }, R);
    return reverb(satN(o, 1.4), { room: 0.8, wet: 0.22, tail: 0.6 });
  } },

  // ~8.6 s departure: brake release, stepped traction-motor whine, accelerating wheel clatter, fading away down the tunnel
  trainDepart: { lv: -16, pk: 0.9, gen(R) {
    const L = 8.6, o = alloc(L), dist = (t) => (t < 3.2 ? 1 : Math.exp(-(t - 3.2) / 2.0));
    noise(o, { dur: 0.9, env: E.ad(0.01, 0.3), amp: 0.9, filters: [{ type: 'hp', f: 2000 }] }, R);
    const whine = (t0, d, f0, f1, amp) => {
      tone(o, { t: t0, dur: d, f: sweep(f0, f1, d), wave: 'saw', env: E.pts([[0, 0], [0.08, 1], [d - 0.15, 1], [d, 0]]), amp, filters: [{ type: 'lp', f: 3000 }, { type: 'peak', f: f1 * 2, q: 1.5, g: 5 }] }, R);
      tone(o, { t: t0, dur: d, f: sweep(f0 * 2, f1 * 2, d), env: E.pts([[0, 0], [0.08, 1], [d - 0.15, 1], [d, 0]]), amp: amp * 0.35 }, R);
    };
    whine(0.5, 2.0, 170, 420, 0.75); whine(2.3, 2.2, 290, 650, 0.75); whine(4.4, 2.8, 450, 1000, 0.7);
    const rum = normStd(circNoise(Math.round(L * SR), 'brown', R, [{ type: 'lp', f: 110 }])), wind = normStd(circNoise(Math.round(L * SR), 'pink', R, [{ type: 'bp', f: 700, q: 0.7 }]));
    for (let i = 0; i < rum.length; i++) { const t = i / SR; o[i] += (rum[i] * 0.55 + wind[i] * 0.3 * Math.min(1, t / 3)) * Math.min(1, t / 1.5) * Math.min(1, t / 0.6); }
    let t = 0.8; while (t < L - 0.2) { const a = 0.55 * dist(t) * Math.min(1, t / 1.5); pop(o, t, CLACK, a, R, 0.5); pop(o, t + 0.034, CLACK, a * 0.8, R, 0.4); t += 1 / Math.min(30, 2.5 + 4.6 * t); }
    for (let i = 0; i < o.length; i++) o[i] *= dist(i / SR);
    return normPeak(o, 1);
  } },

  trainPass: { lv: -14, pk: 0.9, gen(R) {
    const L = 5.5, C = 2.4, o = alloc(L), dop = (u) => th((C - u) * 1.4), g = E.gauss(C, 0.95);
    noise(o, { dur: L, env: (u) => g(u) * 1.0, amp: 0.8, filters: [{ type: 'bp', f: (u) => 900 + 600 * dop(u), q: 0.7 }] }, R);
    noise(o, { dur: L, env: E.gauss(C, 1.5), amp: 1.0, filters: [{ type: 'lp', f: 130 }] }, R);
    noise(o, { dur: L, env: E.gauss(C, 0.32), amp: 1.0, filters: [{ type: 'lp', f: 1600 }] }, R);                                    // pressure wave
    tone(o, { dur: L, f: (u) => 700 + 240 * dop(u), wave: 'saw', env: (u) => g(u) * 0.9, amp: 0.2, filters: [{ type: 'lp', f: 2600 }] }, R);
    let t = 0.2; while (t < L - 0.2) { const d = dop(t), a = 0.6 * Math.exp(-Math.pow((t - C) / 1.15, 2)); if (a > 0.02) { pop(o, t, CLACK.map(([f, ta, aa]) => [f * (1 + 0.06 * d), ta, aa]), a, R, 0.5); pop(o, t + 0.03, CLACK, a * 0.75, R, 0.4); } t += 1 / (16 + 6 * d); }
    return normPeak(o, 1);
  } },

  // ---- station --------------------------------------------------------------------------------------------
  drip: { pk: 0.55, variants: 4, gen(R) {
    const o = alloc(0.5), f0 = R.rr(900, 1900);
    tone(o, { dur: 0.25, f: (u) => f0 * (1 + 0.55 * (1 - Math.exp(-u / 0.012))), env: E.ad(0.0008, 0.03), amp: 1 }, R);
    tone(o, { dur: 0.2, f: (u) => f0 * 2.1 * (1 + 0.55 * (1 - Math.exp(-u / 0.012))), env: 0.012, amp: 0.25 }, R);
    noise(o, { dur: 0.004, env: 0.001, amp: 0.45, filters: [{ type: 'hp', f: 3500 }] }, R);
    return reverb(o, { room: 0.78, damp: 0.4, wet: 0.55, tail: 1.1, pre: 0.01 });
  } },

  stationChime: { lv: -21, pk: 0.5, gen(R) {
    const o = alloc(2.2);
    tone(o, { dur: 0.02, f: 1000, env: 0.005, amp: 0.05 }, R);
    [[81, 0], [78, 0.5], [74, 1.0]].forEach(([m, at]) => { bell(o, at, hz(m), 1, 0.7); tone(o, { t: at, dur: 0.7, f: hz(m), env: E.ad(0.005, 0.22), amp: 0.3 }, R); });
    filt(o, { type: 'hp', f: 320 }); filt(o, { type: 'lp', f: 5200 });                                                              // tannoy band-limit
    return reverb(sat(normPeak(o, 1), 1.3), { room: 0.9, damp: 0.3, wet: 0.6, tail: 2.4, pre: 0.02 });
  } },

  // corrupted tannoy announcement: formant babble in syllables (no words), band-limited + distorted, with dropouts and static
  paAnnounce: { lv: -23, pk: 0.5, variants: 2, gen(R) {
    const o = alloc(9), vows = ['a', 'e', 'i', 'o', 'u', 'ae', 'uh', 'aw'];
    let t = 0.4;
    const phrases = R.ri(2, 3);
    for (let p = 0; p < phrases; p++) {
      const syl = R.ri(4, 8), base = R.rr(104, 136);
      for (let s = 0; s < syl; s++) {
        const d = R.rr(0.11, 0.27), v1 = R.pick(vows), v2 = R.pick(vows), lift = R.rr(-0.06, 0.1);
        vocal(o, { t, dur: d, f0: (u) => base * (1 + lift * u + 0.05 * Math.sin(p + s)), vow: [[0, v1], [1, v2]], breath: 0.12, rough: 0, jitter: 0.008, drive: 1.6, env: E.pts([[0, 0], [0.02, 1], [d * 0.7, 0.85], [d, 0]]) }, R);
        if (R.chance(0.35)) noise(o, { t, dur: 0.05, env: E.pts([[0, 0], [0.01, 1], [0.05, 0]]), amp: 0.25, filters: [{ type: 'bp', f: 4200, q: 0.9 }] }, R);   // sibilant
        t += d + R.rr(0.02, 0.08);
      }
      t += R.rr(0.4, 0.8);
    }
    const len = Math.min(o.length, Math.round((t + 0.2) * SR));
    for (let g = 0; g < 5; g++) { const a = R.rr(0.4, t), l = R.rr(0.03, 0.12); for (let i = Math.round(a * SR); i < Math.min(len, Math.round((a + l) * SR)); i++) o[i] *= 0.05; }   // digital dropouts
    noise(o, { t: 0, dur: len / SR, env: E.pts([[0, 0.2], [0.05, 1], [len / SR - 0.05, 1], [len / SR, 0.2]]), amp: 0.08, filters: [{ type: 'bp', f: 2600, q: 0.6 }] }, R);   // line static
    modal(o, { t: 0, f: 1000, ratios: [1], amps: [0.3], taus: 0.004, amp: 0.6 });                                                                                     // PA click on
    filt(o, { type: 'hp', f: 380 }); filt(o, { type: 'lp', f: 3400 });
    return reverb(sat(normPeak(o.subarray(0, len), 1), 2.2), { room: 0.88, damp: 0.3, wet: 0.5, tail: 2.0, pre: 0.02 });
  } },

  stationHum: { loop: true, lv: -25, gen(R) {
    const L = 3, n = Math.round(L * SR), o = new Float32Array(n);
    const hum = [[1, 0.5], [2, 0.3], [3, 0.25], [4, 0.14], [5, 0.1], [6, 0.07], [8, 0.04]].map(([h, a]) => [h, a, R.r() * TAU]);
    const air = normStd(circNoise(n, 'pink', R, [{ type: 'bp', f: 250, q: 0.5 }, { type: 'lp', f: 900 }])), room = normStd(circNoise(n, 'brown', R, [{ type: 'lp', f: 60 }]));
    const tun = normStd(circNoise(n, 'white', R, [{ type: 'bp', f: 1100, q: 0.4 }])), sw = normStd(circNoise(n, 'white', R, [{ type: 'lp', f: 0.7, order: 4 }]));
    for (let i = 0; i < n; i++) {
      const t = i / SR; let b = 0;
      for (const [h, a, p] of hum) b += Math.sin(TAU * 100 * h * t + p) * a;
      o[i] = b * 0.16 * (0.85 + 0.15 * Math.sin(TAU * 2 * t)) + Math.sin(TAU * 7800 * t) * 0.006 + air[i] * 0.34 + room[i] * 0.3 + Math.sin(TAU * 50 * t) * 0.09 + tun[i] * 0.06 * (0.6 + 0.4 * sw[i]);
    }
    return normPeak(o, 0.9);
  } },

  // dark drone that fades in while a wave is being fought (all frequencies chosen so every component has an integer number of cycles per loop)
  tensionBed: { loop: true, lv: -27, gen(R) {
    const L = 5, n = Math.round(L * SR), o = new Float32Array(n);
    const saw = (f, ph0) => { const a = new Float32Array(n), dt = f / SR; let ph = ph0; for (let i = 0; i < n; i++) { ph += dt; if (ph >= 1) ph -= 1; let v = 2 * ph - 1; if (ph < dt) { const x = ph / dt; v -= x + x - x * x - 1; } else if (ph > 1 - dt) { const x = (ph - 1) / dt; v -= x * x + x + x + 1; } a[i] = v; } return a; };
    const d1 = saw(55, 0), d1b = saw(55.4, 0.3), d2 = saw(82.4, 0.6), d3 = saw(110.2, 0.1);
    circFilt(d1, { type: 'lp', f: 420, order: 4 }); circFilt(d1b, { type: 'lp', f: 420, order: 4 }); circFilt(d2, { type: 'lp', f: 1100 }); circFilt(d3, { type: 'lp', f: 1600 });
    const air = normStd(circNoise(n, 'pink', R, [{ type: 'bp', f: 700, q: 0.5 }]));
    for (let i = 0; i < n; i++) {
      const t = i / SR, br = 0.5 + 0.5 * Math.sin(TAU * t / L * 2), th = Math.pow(Math.max(0, Math.sin(TAU * 1.2 * t)), 3);
      o[i] = (d1[i] + d1b[i]) * 0.5 + d2[i] * (0.25 + 0.35 * br) + d3[i] * 0.18 * (1 - br)
        + Math.sin(TAU * 41 * t) * th * 0.55 + Math.sin(TAU * 1650 * t) * Math.pow(Math.sin(TAU * 0.3 * t), 2) * 0.012 + Math.sin(TAU * 2478 * t) * Math.pow(Math.sin(TAU * 0.2 * t + 1), 2) * 0.008 + air[i] * 0.14 * (0.4 + 0.6 * br);
    }
    return normPeak(o, 0.9);
  } },

  ventHiss: { pk: 0.55, variants: 2, gen(R) {
    const o = alloc(1.7);
    const env = E.pts([[0, 0], [0.06, 1], [0.5, 0.7], [1.4, 0]]);
    noise(o, { dur: 1.5, env, amp: 0.7, filters: [{ type: 'hp', f: 2500 }, { type: 'lp', f: 10000 }] }, R);
    noise(o, { dur: 1.5, env, amp: 0.55, filters: [{ type: 'bp', f: 5200, q: 0.9 }] }, R);
    const fl = smoothNoise(o.length, 28, R); for (let i = 0; i < o.length; i++) o[i] *= 1 + 0.18 * fl[i];
    noise(o, { dur: 0.6, env: E.ad(0.01, 0.16), amp: 0.3, filters: [{ type: 'lp', f: 320 }] }, R);
    return normPeak(o, 1);
  } },

  tunnelWind: { loop: true, lv: -27, gen(R) {
    const L = 8, n = Math.round(L * SR), o = new Float32Array(n);
    const w = normStd(circNoise(n, 'pink', R, [{ type: 'bp', f: 500, q: 1.1 }])), w2 = normStd(circNoise(n, 'white', R, [{ type: 'bp', f: 1300, q: 3 }]));
    const sw = normStd(circNoise(n, 'white', R, [{ type: 'lp', f: 0.35, order: 4 }])), sw2 = normStd(circNoise(n, 'white', R, [{ type: 'lp', f: 0.5, order: 4 }]));
    for (let i = 0; i < n; i++) {
      const t = i / SR, sl = 0.5 + 0.5 * Math.sin(TAU * t / L * 2);
      o[i] = w[i] * (0.4 + 0.3 * sw[i]) * (0.6 + 0.4 * sl) + w2[i] * 0.08 * Math.max(0, 0.5 + 0.5 * sw2[i]);
    }
    // faint low howl with slow pitch drift (integer cycles across the loop)
    for (let i = 0; i < n; i++) { const t = i / SR; o[i] += Math.sin(TAU * (176 * t + 6 * Math.sin(TAU * t / L))) * 0.05 * (0.5 + 0.5 * Math.sin(TAU * 3 * t / L)); }
    return normPeak(o, 0.9);
  } },

  pipeClank: { pk: 0.5, variants: 2, gen(R) {
    const o = alloc(0.8), f = R.rr(260, 420);
    noise(o, { dur: 0.01, env: 0.003, amp: 0.6, filters: [{ type: 'bp', f: 2500, q: 0.8 }] }, R);
    modal(o, { f, ratios: [1, 2.7, 5.2, 8.1, 11.3], amps: [0.6, 0.45, 0.3, 0.18, 0.1], taus: [0.35, 0.2, 0.11, 0.06, 0.04], amp: 1 });
    tone(o, { dur: 0.1, f: glide(f * 0.6, f * 0.4, 0.02), env: 0.03, amp: 0.4 }, R);
    return reverb(normPeak(o, 1), { room: 0.85, damp: 0.35, wet: 0.5, tail: 1.6 });
  } },

  buzzFlicker: { pk: 0.45, variants: 2, gen(R) {
    const o = alloc(0.45), gates = []; let t = 0;
    for (let k = 0; k < 6; k++) { const d = R.rr(0.02, 0.06); gates.push([t, t + d]); t += d + R.rr(0.015, 0.07); }
    const gate = (u) => { for (const [a, b] of gates) if (u >= a && u < b) return 1; return 0; };
    tone(o, { dur: 0.45, f: 100, wave: 'saw', env: (u) => gate(u), amp: 0.5, drive: 2, filters: [{ type: 'lp', f: 2600 }] }, R);
    clicks(o, { dur: 0.45, rate: 260, f: [1000, 7000], tau: 0.0012, amp: 0.7, env: (u) => 0.3 + gate(u) }, R);
    noise(o, { dur: 0.45, env: (u) => gate(u) * 0.5, amp: 0.25, filters: [{ type: 'bp', f: 3200, q: 1 }] }, R);
    return normPeak(o, 1);
  } },
};
