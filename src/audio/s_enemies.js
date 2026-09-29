// Enemy sound recipes: formant-synth vocals (zombies, runner, brute, tyrant), wet/gore effects, footsteps.
import { SR, TAU, E, alloc, noise, tone, modal, clicks, sat, satN, normPeak, glide, sweep, filt, circNoise, normStd, fillNoise, mixInto, clamp, smoothNoise, gainBuf, am } from './dsp.js';
import { vocal } from './vocal.js';

export const enemies = {
  zombieIdle: { lv: -17, pk: 0.75, variants: 3, gen(R) {
    const o = alloc(1.7), b = R.rr(0.9, 1.14), w = R.rr(0.85, 1.15);
    vocal(o, {
      dur: 1.55, f0: (u) => b * (76 + 18 * Math.sin(Math.PI * Math.min(1, u * 1.1)) - 12 * u + 4 * Math.sin(TAU * 3 * u)),
      vow: [[0, 'u'], [0.3, 'o'], [0.62, 'a'], [1, 'gr']], scale: w, breath: 0.4, rough: 0.35, roughHz: 22 + R.rr(-4, 6), jitter: 0.05, sub: 0.35, drive: 2.4, gurgle: 0.3, hiss: 0.03,
      env: E.pts([[0, 0], [0.32, 0.8], [0.9, 1], [1.25, 0.5], [1.55, 0]]),
    }, R);
    noise(o, { t: 0.05, dur: 1.5, env: E.pts([[0, 0], [0.35, 0.5], [0.9, 0.7], [1.5, 0]]), amp: 0.13, filters: [{ type: 'bp', f: 1300, q: 0.8 }] }, R);
    return normPeak(o, 1);
  } },

  zombieAlert: { lv: -14, pk: 0.9, variants: 2, gen(R) {
    const o = alloc(1.2), b = R.rr(0.92, 1.1);
    noise(o, { dur: 0.16, env: E.pts([[0, 0], [0.07, 0.8], [0.16, 0]]), amp: 0.3, filters: [{ type: 'bp', f: (u) => 700 + 1400 * u / 0.16, q: 1 }] }, R);   // sharp inhale
    vocal(o, {
      t: 0.1, dur: 1.0, f0: (u) => b * (88 + 62 * Math.sin(Math.PI * Math.min(1, u * 0.85)) + 10 * u),
      vow: [[0, 'o'], [0.25, 'a'], [0.6, 'ae'], [1, 'a']], scale: 1.05, breath: 0.3, rough: 0.48, roughHz: 34, jitter: 0.045, sub: 0.2, drive: 3.2, hiss: 0.1, gurgle: 0.15,
      env: E.pts([[0, 0], [0.06, 1], [0.6, 0.95], [0.95, 0.4], [1.0, 0]]),
    }, R);
    return satN(o, 1.3);
  } },

  zombieAttack: { lv: -12, pk: 0.92, variants: 2, gen(R) {
    const o = alloc(0.7), b = R.rr(0.92, 1.1);
    noise(o, { dur: 0.09, env: E.pts([[0, 0], [0.015, 1], [0.09, 0]]), amp: 0.5, filters: [{ type: 'bp', f: 1700, q: 0.9 }] }, R);
    vocal(o, {
      t: 0.01, dur: 0.55, f0: (u) => b * (158 - 55 * u), vow: [[0, 'a'], [0.5, 'ae'], [1, 'o']], scale: 1.0, breath: 0.35, rough: 0.55, roughHz: 40, jitter: 0.05, drive: 3.6, hiss: 0.18, hissF: 2800,
      env: E.pts([[0, 0], [0.02, 1], [0.28, 0.85], [0.55, 0]]),
    }, R);
    return satN(o, 1.4);
  } },

  zombiePain: { lv: -16, pk: 0.85, variants: 3, gen(R) {
    const o = alloc(0.55), b = R.rr(0.88, 1.15);
    vocal(o, {
      dur: 0.4, f0: (u) => b * (205 - 80 * u + 25 * Math.sin(TAU * 6 * u)), vow: [[0, 'ae'], [0.5, 'uh'], [1, 'o']], scale: R.rr(0.95, 1.15), breath: 0.3, rough: 0.35, roughHz: 30, jitter: 0.05, drive: 2.6, hiss: 0.06,
      env: E.pts([[0, 0], [0.012, 1], [0.15, 0.8], [0.4, 0]]),
    }, R);
    noise(o, { dur: 0.06, env: 0.02, amp: 0.25, filters: [{ type: 'bp', f: 1000, q: 0.9 }] }, R);
    return satN(o, 1.2);
  } },

  zombieDeath: { lv: -14, pk: 0.9, variants: 2, gen(R) {
    const o = alloc(1.6), b = R.rr(0.9, 1.1);
    vocal(o, {
      dur: 1.05, f0: (u) => b * (145 - 80 * Math.pow(u, 0.8) + 8 * Math.sin(TAU * 2.5 * u)),
      vow: [[0, 'a'], [0.3, 'aw'], [0.65, 'o'], [1, 'u']], scale: 1.0, breath: 0.4, rough: 0.5, roughHz: 26, jitter: 0.06, sub: 0.3, drive: 2.8, gurgle: 0.55, gurgleHz: 17, hiss: 0.05,
      env: E.pts([[0, 0], [0.03, 1], [0.45, 0.85], [0.75, 0.4], [1.05, 0]]),
    }, R);
    noise(o, { t: 0.5, dur: 0.9, env: E.pts([[0, 0], [0.2, 0.7], [0.9, 0]]), amp: 0.16, filters: [{ type: 'bp', f: 420, q: 1.5 }, { type: 'lp', f: 1000 }] }, R);          // gurgling rattle
    tone(o, { t: 0.72, dur: 0.6, f: glide(95, 42, 0.1), env: 0.1, amp: 0.42 }, R);                                                                                    // body hits floor
    noise(o, { t: 0.72, dur: 0.4, env: 0.09, amp: 0.4, filters: [{ type: 'lp', f: 420 }] }, R);
    noise(o, { t: 0.72, dur: 0.05, env: 0.012, amp: 0.4, filters: [{ type: 'bp', f: 1800, q: 0.8 }] }, R);
    return normPeak(o, 1);
  } },

  runnerScream: { lv: -12, pk: 0.9, variants: 2, gen(R) {
    const o = alloc(1.2), b = R.rr(0.92, 1.1);
    vocal(o, {
      dur: 1.1, f0: (u) => b * (300 + 250 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 0.6)) * (1 + 0.025 * Math.sin(TAU * 7.5 * u * 1.1)),
      vow: [[0, 'a'], [0.5, 'ae'], [1, 'e']], scale: 1.2, breath: 0.25, rough: 0.55, roughHz: 58, jitter: 0.05, drive: 3.6, hiss: 0.26, hissF: 3300,
      env: E.pts([[0, 0], [0.03, 1], [0.72, 0.85], [1.05, 0]]),
    }, R);
    tone(o, { dur: 1.0, f: (u) => 1700 + 600 * Math.sin(TAU * 5 * u), wave: 'saw', env: E.pts([[0, 0], [0.05, 1], [0.7, 0.7], [1, 0]]), amp: 0.09, filters: [{ type: 'bp', f: 2800, q: 2 }] }, R);
    return satN(o, 1.5);
  } },

  bruteRoar: { lv: -11, pk: 0.95, gen(R) {
    const o = alloc(2.1);
    vocal(o, {
      dur: 1.9, f0: (u) => 54 + 16 * Math.sin(Math.PI * Math.min(1, u * 1.05)) - 12 * u + 3 * Math.sin(TAU * 4 * u),
      vow: [[0, 'o'], [0.28, 'a'], [0.65, 'gr'], [1, 'o']], scale: 0.78, breath: 0.42, rough: 0.6, roughHz: 17, jitter: 0.06, sub: 0.5, drive: 3.2, gurgle: 0.25, hiss: 0.06, hissF: 1800,
      env: E.pts([[0, 0], [0.22, 0.9], [0.9, 1], [1.5, 0.7], [1.9, 0]]),
    }, R);
    tone(o, { dur: 1.9, f: (u) => 44 + 12 * Math.sin(Math.PI * u), env: E.pts([[0, 0], [0.25, 0.8], [1.3, 0.8], [1.9, 0]]), amp: 0.32 }, R);
    noise(o, { t: 0.05, dur: 1.9, env: E.pts([[0, 0], [0.3, 0.6], [1.2, 0.5], [1.85, 0]]), amp: 0.2, filters: [{ type: 'bp', f: 520, q: 0.7 }] }, R);
    return satN(o, 1.5);
  } },

  bruteStep: { lv: -12, pk: 0.9, variants: 2, gen(R) {
    const o = alloc(0.9), j = R.rr(0.9, 1.1);
    tone(o, { dur: 0.6, f: glide(96 * j, 40, 0.08), env: E.ad(0.002, 0.15), amp: 0.9 }, R);
    noise(o, { dur: 0.4, env: 0.08, amp: 1.2, filters: [{ type: 'lp', f: 420 * j }] }, R);
    noise(o, { dur: 0.16, env: 0.04, amp: 1.0, filters: [{ type: 'bp', f: 700 * j, q: 0.8 }] }, R);
    noise(o, { dur: 0.05, env: 0.01, amp: 0.8, filters: [{ type: 'bp', f: 1500, q: 0.7 }] }, R);
    modal(o, { t: 0.01, f: 150 * j, ratios: [1, 1.5, 2.3, 3.4], amps: [0.4, 0.3, 0.2, 0.12], taus: [0.28, 0.2, 0.14, 0.1], amp: 0.7 });      // floor / tile resonance
    clicks(o, { t: 0.04, dur: 0.4, rate: 90, f: [800, 3000], tau: 0.003, amp: 0.3, env: E.exp(0.15) }, R);                                       // grit
    noise(o, { t: 0.02, dur: 0.6, env: 0.15, amp: 0.3, filters: [{ type: 'bp', f: 200, q: 1 }] }, R);
    return satN(o, 1.6);
  } },

  tyrantRoar: { lv: -9.5, pk: 0.97, gen(R) {
    const o = alloc(3.2);
    vocal(o, {
      dur: 2.8, f0: (u) => 46 + 20 * Math.sin(Math.PI * Math.min(1, u * 1.04)) - 14 * u + 3 * Math.sin(TAU * 5 * u),
      vow: [[0, 'o'], [0.2, 'a'], [0.5, 'gr'], [0.8, 'a'], [1, 'o']], scale: 0.7, breath: 0.4, rough: 0.62, roughHz: 14, jitter: 0.07, sub: 0.55, drive: 3.6, gurgle: 0.3, hiss: 0.1, hissF: 2200,
      env: E.pts([[0, 0], [0.3, 0.9], [1.0, 1], [2.0, 0.8], [2.8, 0]]),
    }, R);
    // inhuman metallic scream layer (inharmonic FM)
    tone(o, { t: 0.15, dur: 2.5, f: (u) => 360 + 150 * Math.sin(TAU * 0.6 * u) + 80 * u, fm: { ratio: 1.414, index: (u) => 3.5 + 2 * Math.sin(TAU * 0.9 * u) }, env: E.pts([[0, 0], [0.4, 0.8], [1.5, 1], [2.5, 0]]), amp: 0.3, vib: { rate: 7.5, depth: 0.02 }, filters: [{ type: 'lp', f: 3500 }] }, R);
    tone(o, { t: 0.1, dur: 2.6, f: (u) => 62 + 10 * Math.sin(Math.PI * u), wave: 'saw', env: E.pts([[0, 0], [0.4, 1], [2.0, 0.8], [2.6, 0]]), amp: 0.3, drive: 2, filters: [{ type: 'bp', f: 700, q: 2.2 }] }, R);
    tone(o, { dur: 2.8, f: (u) => 38 + 8 * Math.sin(Math.PI * u), env: E.pts([[0, 0], [0.3, 1], [2.2, 0.8], [2.8, 0]]), amp: 0.45 }, R);
    noise(o, { t: 0.05, dur: 2.9, env: E.pts([[0, 0], [0.4, 0.6], [2.0, 0.6], [2.9, 0]]), amp: 0.22, filters: [{ type: 'bp', f: 480, q: 0.7 }] }, R);
    clicks(o, { t: 0.2, dur: 2.4, rate: 45, f: [200, 900], tau: 0.01, amp: 0.25 }, R);
    return satN(o, 1.7);
  } },

  spit: { pk: 0.75, variants: 2, gen(R) {
    const o = alloc(0.55), j = R.rr(0.9, 1.15);
    noise(o, { dur: 0.13, env: E.pts([[0, 0], [0.03, 0.6], [0.12, 1], [0.13, 0]]), amp: 0.5, filters: [{ type: 'bp', f: (u) => (900 + 2600 * u / 0.13) * j, q: 1.6 }] }, R);   // hawk
    tone(o, { t: 0.12, dur: 0.12, f: (u) => (260 + 700 * Math.min(1, u / 0.05)) * j, env: 0.03, amp: 0.6 }, R);                                                   // pop
    noise(o, { t: 0.12, dur: 0.02, env: 0.004, amp: 0.5, filters: [{ type: 'hp', f: 2000 }] }, R);
    noise(o, { t: 0.13, dur: 0.4, env: E.ad(0.01, 0.09), amp: 0.4, filters: [{ type: 'hp', f: 4500 }] }, R);                                                      // spray
    clicks(o, { t: 0.14, dur: 0.35, rate: 420, f: [2500, 8500], tau: 0.0012, amp: 0.4, env: E.exp(0.1) }, R);                                                     // sizzle
    tone(o, { t: 0.15, dur: 0.3, f: (u) => 420 * Math.exp(-u * 3) + 180, env: 0.09, amp: 0.2, vib: { rate: 28, depth: 0.2 } }, R);
    return normPeak(o, 1);
  } },

  spitHit: { pk: 0.75, gen(R) {
    const o = alloc(1.0);
    noise(o, { dur: 0.005, env: 0.001, amp: 0.8, filters: [{ type: 'hp', f: 2000 }] }, R);
    noise(o, { dur: 0.16, env: 0.045, amp: 1.0, filters: [{ type: 'bp', f: (u) => 3000 * Math.exp(-u * 14) + 350, q: 1.4 }] }, R);
    tone(o, { dur: 0.1, f: glide(210, 90, 0.025), env: 0.03, amp: 0.6 }, R);
    clicks(o, { dur: 0.9, rate: (u) => 650 * Math.exp(-u / 0.5), f: [2000, 8500], tau: 0.0015, amp: 0.6 }, R);
    noise(o, { t: 0.02, dur: 0.8, env: E.ad(0.01, 0.28), amp: 0.3, filters: [{ type: 'hp', f: 3800 }] }, R);
    clicks(o, { t: 0.05, dur: 0.6, rate: 32, f: [200, 520], tau: 0.012, amp: 0.4, env: E.exp(0.3) }, R);        // acid bubbling
    return normPeak(o, 1);
  } },

  exploderBurst: { lv: -11, pk: 0.95, gen(R) {
    const o = alloc(1.8);
    // swelling gurgle
    const g = fillNoise(new Float32Array(Math.round(0.34 * SR)), 'white', R); filt(g, { type: 'bp', f: 420, q: 2 });
    for (let i = 0; i < g.length; i++) { const t = i / SR; o[i] += g[i] * 5.5 * Math.pow(t / 0.34, 1.3) * (0.5 + 0.5 * Math.sin(TAU * (12 + 30 * t / 0.34) * t)); }
    // burst
    const T = 0.34;
    noise(o, { t: T, dur: 0.01, env: 0.002, amp: 1.0, filters: [{ type: 'hp', f: 800 }] }, R);
    noise(o, { t: T, dur: 0.7, env: E.ad(0.004, 0.14), amp: 1.4, filters: [{ type: 'lp', f: (u) => 250 + 3400 * Math.exp(-u / 0.12), q: 3 }] }, R);      // squelchy resonant low-pass sweep
    tone(o, { t: T, dur: 0.6, f: glide(120, 40, 0.09), env: E.ad(0.003, 0.14), amp: 1.5 }, R);
    noise(o, { t: T, dur: 0.3, env: 0.06, amp: 0.9, filters: [{ type: 'bp', f: (u) => 1300 * Math.exp(-u * 8) + 220, q: 4 }] }, R);
    clicks(o, { t: T + 0.02, dur: 1.2, rate: (u) => 90 * Math.exp(-u / 0.5), f: [150, 700], tau: 0.008, amp: 0.7 }, R);                                  // wet pops
    clicks(o, { t: T + 0.05, dur: 1.1, rate: (u) => 220 * Math.exp(-u / 0.4), f: [600, 3500], tau: 0.003, amp: 0.4 }, R);                               // chunks
    noise(o, { t: T, dur: 1.4, env: E.ad(0.02, 0.3), amp: 0.35, filters: [{ type: 'lp', f: 500 }] }, R);
    return satN(o, 1.4);
  } },

  gib: { pk: 0.85, variants: 3, gen(R) {
    const o = alloc(0.75), j = R.rr(0.88, 1.15);
    noise(o, { dur: 0.008, env: 0.002, amp: 0.8, filters: [{ type: 'hp', f: 1000 }] }, R);
    noise(o, { dur: 0.3, env: E.ad(0.003, 0.07), amp: 1.3, filters: [{ type: 'lp', f: (u) => (250 + 2600 * Math.exp(-u / 0.06)) * j, q: 2.5 }] }, R);
    tone(o, { dur: 0.3, f: glide(140 * j, 46, 0.06), env: E.ad(0.002, 0.08), amp: 1.3 }, R);
    for (let k = 0; k < 4; k++) noise(o, { t: 0.02 + k * R.rr(0.035, 0.07), dur: 0.1, env: 0.03, amp: 0.55 * (1 - k * 0.15), filters: [{ type: 'bp', f: (u) => (R.rr(800, 1400) * Math.exp(-u * 12) + 240), q: 4 }] }, R);   // splats
    clicks(o, { t: 0.02, dur: 0.35, rate: 280, f: [1500, 5500], tau: 0.0012, amp: 0.5, env: E.exp(0.08) }, R);                                                                             // bone crunch
    clicks(o, { t: 0.1, dur: 0.6, rate: (u) => 60 * Math.exp(-u / 0.25), f: [200, 800], tau: 0.007, amp: 0.5 }, R);                                                                          // drips/slaps
    noise(o, { dur: 0.6, env: 0.14, amp: 0.3, filters: [{ type: 'lp', f: 700 }] }, R);
    return satN(o, 1.5);
  } },

  zombieStep: { pk: 0.5, variants: 3, gen(R) {
    const o = alloc(0.32), j = R.rr(0.85, 1.18);
    tone(o, { dur: 0.14, f: glide(92 * j, 52, 0.03), env: 0.035, amp: 0.85 }, R);
    noise(o, { dur: 0.09, env: 0.026, amp: 0.9, filters: [{ type: 'lp', f: 520 * j }] }, R);
    noise(o, { t: 0.03, dur: 0.22, env: E.pts([[0, 0], [0.04, 1], [0.22, 0]]), amp: 0.22, filters: [{ type: 'bp', f: 850 * j, q: 0.8 }] }, R);                // cloth/skin drag
    noise(o, { dur: 0.09, env: 0.03, amp: 0.4, filters: [{ type: 'bp', f: (u) => 420 * Math.exp(-u * 12) + 160, q: 5 }] }, R);                                // wet slap
    noise(o, { dur: 0.006, env: 0.0018, amp: 0.4, filters: [{ type: 'bp', f: 1900, q: 0.8 }] }, R);
    return satN(o, 1.2);
  } },
};
