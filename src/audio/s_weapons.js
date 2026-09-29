// Weapon + impact sound recipes. Each entry: { gen(R, variant) -> Float32Array, pk|lv (level), variants, loop }.
import { SR, TAU, E, alloc, noise, tone, modal, clicks, sat, satN, normPeak, glide, sweep, filt, circNoise, normStd, fillNoise, circFilt, mixInto, echo, clamp, smoothNoise, pop, popCirc, gainBuf, crush } from './dsp.js';

// ---- helpers ---------------------------------------------------------------------------------------------
function shotBlast(dur, R, s = {}) {
  const { boom = 1, crack = 1, len = 1, pitch = 1, dark = 1 } = s;
  const o = alloc(dur);
  noise(o, { dur: 0.03, env: 0.005, amp: 1.3 * crack, filters: [{ type: 'hp', f: 700 }] }, R);
  noise(o, { dur: 0.35, env: 0.07 * len, amp: 1.2, filters: [{ type: 'bp', f: (u) => (300 + 2700 * Math.exp(-u / 0.05)) * pitch, q: 0.6 }] }, R);
  noise(o, { dur: 0.7 * len, env: 0.16 * len, amp: 1.1 * dark, filters: [{ type: 'lp', f: 700 * pitch }] }, R);
  noise(o, { dur: 0.5 * len, env: 0.09 * len, amp: 0.9 * dark, filters: [{ type: 'bp', f: 300 * pitch, q: 0.8 }] }, R);
  tone(o, { dur: 0.7 * len, f: (u) => (38 + 110 * Math.exp(-u / 0.045)) * pitch, env: 0.24 * len, amp: 0.95 * boom }, R);
  tone(o, { dur: 0.9 * len, f: (u) => (28 + 30 * Math.exp(-u / 0.12)) * pitch, env: 0.4 * len, amp: 0.28 * boom }, R);
  noise(o, { t: 0.02, dur: 1.3 * len, env: 0.42 * len, amp: 0.45, filters: [{ type: 'lp', f: (u) => 2000 * Math.exp(-u * 3.2) + 170 }] }, R);
  return o;
}

// chainsaw / two-stroke firing pulses: each pulse is a burst of damped exhaust resonances. rate(u) in Hz.
function enginePulses(out, o, R) {
  const { t = 0, dur, rate, amp = 1, modes, pattern = [1], jit = 0.05, ampJit = 0.25, tick = 0.5, circ = false } = o;
  const n = Math.round(dur * SR); let phase = 0.999, k = 0;
  const add = circ ? popCirc : pop;
  for (let i = 0; i < n; i++) {
    phase += rate(i / SR) / SR;
    if (phase >= 1) {
      phase -= 1;
      const p = pattern[k++ % pattern.length], per = 1 / Math.max(rate(i / SR), 1);
      let at = t + i / SR + (R.r() - 0.5) * 2 * jit * per; if (at < 0) at = 0;
      add(out, at, modes, amp * p * (1 - ampJit + ampJit * 2 * R.r()), R, tick);
    }
  }
}
const ENG_IDLE = [[165, 0.014, 1.0], [410, 0.009, 0.8], [880, 0.006, 0.55], [1750, 0.004, 0.35]];
const ENG_FULL = [[210, 0.008, 1.0], [520, 0.006, 0.9], [1100, 0.004, 0.7], [2300, 0.0028, 0.5]];

function brassCasing(R) {
  const o = alloc(0.45), f0 = 3300 * R.rr(0.9, 1.2);
  const hit = (at, a, p) => modal(o, { t: at, f: f0 * p, ratios: [1, 1.58, 2.3, 3.1], amps: [0.6, 0.4, 0.3, 0.2], taus: [0.05, 0.04, 0.03, 0.02], amp: a });
  hit(0, 1, 1); hit(0.07 + R.rr(0, 0.02), 0.55, 1.06); hit(0.125 + R.rr(0, 0.03), 0.3, 1.1); hit(0.17 + R.rr(0, 0.03), 0.14, 1.12);
  noise(o, { dur: 0.004, env: 0.001, amp: 0.4, filters: [{ type: 'hp', f: 3000 }] }, R);
  return normPeak(o, 1);
}

export const weapons = {
  // ---- guns -----------------------------------------------------------------------------------------------
  pistol: { pk: 0.95, variants: 3, gen(R) {
    const o = alloc(0.7);
    noise(o, { dur: 0.006, env: 0.0015, amp: 1.4, filters: [{ type: 'hp', f: 1200 }] }, R);
    noise(o, { dur: 0.08, env: 0.013, amp: 1.1, filters: [{ type: 'bp', f: 3000, q: 0.6 }] }, R);
    noise(o, { dur: 0.16, env: 0.035, amp: 1.0, filters: [{ type: 'bp', f: 850, q: 0.8 }] }, R);
    tone(o, { dur: 0.16, f: glide(260, 62, 0.02), env: 0.045, amp: 1.0 }, R);
    noise(o, { t: 0.004, dur: 0.6, env: 0.13, amp: 0.3, filters: [{ type: 'lp', f: (u) => 4200 * Math.exp(-u * 6) + 380 }] }, R);
    modal(o, { t: 0.028, f: 2300, ratios: [1, 1.52, 2.4], amps: [0.16, 0.1, 0.06], taus: 0.012 });
    return satN(o, 1.7);
  } },

  // trooper rifle: thin, zippy and sharp with a tile slap-back
  enemyShot: { pk: 0.8, variants: 2, gen(R) {
    const o = alloc(0.6), j = R.rr(0.92, 1.08);
    noise(o, { dur: 0.005, env: 0.001, amp: 1.3, filters: [{ type: 'hp', f: 2500 }] }, R);
    noise(o, { dur: 0.06, env: 0.009, amp: 1.1, filters: [{ type: 'bp', f: 4600 * j, q: 0.55 }] }, R);
    tone(o, { dur: 0.09, f: sweep(3400 * j, 620, 0.07), env: 0.03, amp: 0.55, wave: 'saw', filters: [{ type: 'lp', f: 4500 }] }, R);
    noise(o, { dur: 0.1, env: 0.025, amp: 0.7, filters: [{ type: 'bp', f: 1300, q: 0.8 }] }, R);
    tone(o, { dur: 0.08, f: glide(180, 90, 0.02), env: 0.025, amp: 0.45 }, R);
    noise(o, { t: 0.003, dur: 0.5, env: 0.09, amp: 0.22, filters: [{ type: 'bp', f: (u) => 3500 * Math.exp(-u * 5) + 500, q: 0.6 }] }, R);
    const dry = satN(o, 1.5);
    return mixInto(dry, echo(dry, [[0.085, 0.3, 3200], [0.17, 0.14, 2200]]).subarray(0, dry.length), 0, 0.5);
  } },

  shotgun: { pk: 0.97, variants: 2, gen(R) { return satN(shotBlast(1.5, R), 2.1); } },

  shotgunPump: { pk: 0.9, gen(R) {
    const o = alloc(0.62);
    const fric = (t0, l) => noise(o, { t: t0, dur: l, env: E.pts([[0, 0], [l * 0.15, 1], [l * 0.7, 0.55], [l, 0]]), amp: 0.32, filters: [{ type: 'bp', f: (u) => 1100 + 2200 * u / l, q: 1.4 }] }, R);
    fric(0.0, 0.13);
    modal(o, { t: 0.05, f: R.rr(700, 800), ratios: [1, 1.9, 3.1, 4.7], amps: [0.5, 0.35, 0.25, 0.15], taus: [0.05, 0.035, 0.025, 0.015], amp: 0.85 });
    tone(o, { t: 0.05, dur: 0.12, f: glide(160, 70, 0.02), env: 0.03, amp: 0.7 }, R);
    noise(o, { t: 0.05, dur: 0.05, env: 0.008, amp: 0.5, filters: [{ type: 'bp', f: 2200, q: 1 }] }, R);
    fric(0.2, 0.11);
    modal(o, { t: 0.265, f: R.rr(950, 1050), ratios: [1, 1.7, 2.6, 4.2, 6.1], amps: [0.6, 0.42, 0.3, 0.2, 0.1], taus: [0.04, 0.03, 0.02, 0.012, 0.008], amp: 1.0 });
    tone(o, { t: 0.265, dur: 0.1, f: glide(190, 85, 0.015), env: 0.025, amp: 0.8 }, R);
    noise(o, { t: 0.265, dur: 0.04, env: 0.006, amp: 0.6, filters: [{ type: 'hp', f: 2500 }] }, R);
    modal(o, { t: 0.29, f: 3300, ratios: [1, 1.6], amps: [0.16, 0.1], taus: 0.02 }); // shell rattling in the tube
    return normPeak(o, 1);
  } },

  ssg: { pk: 0.98, variants: 2, gen(R) {
    const a = shotBlast(2.0, R, { boom: 1.35, len: 1.3, pitch: 0.84, dark: 1.35 });
    const b = shotBlast(2.0, R, { boom: 1.25, len: 1.3, pitch: 0.76, dark: 1.35, crack: 1.1 });
    const o = alloc(2.0); mixInto(o, a, 0, 1); mixInto(o, b, 0.058, 0.95);
    tone(o, { dur: 1.2, f: (u) => 30 + 50 * Math.exp(-u / 0.12), env: 0.4, amp: 0.4 }, R);
    noise(o, { t: 0.02, dur: 1.4, env: E.ad(0.02, 0.35), amp: 0.5, filters: [{ type: 'bp', f: (u) => 520 * Math.exp(-u * 1.6) + 110, q: 0.9 }] }, R);   // guttural growl of the double blast
    return satN(o, 2.7);
  } },

  ssgOpen: { pk: 0.85, gen(R) {
    const o = alloc(0.7);
    modal(o, { t: 0.0, f: 3600, ratios: [1, 1.7, 2.6], amps: [0.4, 0.25, 0.15], taus: 0.006, amp: 0.8 });   // latch release click
    tone(o, { t: 0.02, dur: 0.12, f: glide(220, 95, 0.03), env: 0.04, amp: 0.9 }, R);                     // lever thunk
    noise(o, { t: 0.06, dur: 0.3, env: E.pts([[0, 0], [0.06, 1], [0.24, 0.7], [0.3, 0]]), amp: 0.22, filters: [{ type: 'bp', f: (u) => 320 + 900 * u, q: 5 }] }, R); // hinge creak
    modal(o, { t: 0.34, f: 480, ratios: [1, 2.4, 4.1], amps: [0.5, 0.3, 0.15], taus: [0.06, 0.03, 0.02], amp: 0.8 }); // barrels reach the stop
    tone(o, { t: 0.34, dur: 0.1, f: glide(170, 80, 0.02), env: 0.03, amp: 0.7 }, R);
    modal(o, { t: 0.44, f: 2900, ratios: [1, 1.53], amps: [0.25, 0.15], taus: 0.02, amp: 0.7 });          // spent shell ping
    tone(o, { t: 0.44, dur: 0.06, f: glide(300, 200, 0.01), env: 0.02, amp: 0.3 }, R);
    return normPeak(o, 1);
  } },

  ssgLoad: { pk: 0.8, gen(R) {
    const o = alloc(0.55);
    for (const [at, pv] of [[0.02, 1.0], [0.21, 1.12]]) {
      noise(o, { t: at, dur: 0.12, env: E.pts([[0, 0], [0.02, 1], [0.1, 0]]), amp: 0.16, filters: [{ type: 'bp', f: 1600 * pv, q: 1.2 }] }, R);         // slide friction
      tone(o, { t: at + 0.05, dur: 0.08, f: glide(330 * pv, 190 * pv, 0.02), env: 0.02, amp: 0.7 }, R);                                            // plastic hull tok
      noise(o, { t: at + 0.05, dur: 0.04, env: 0.01, amp: 0.55, filters: [{ type: 'bp', f: 760 * pv, q: 2 }] }, R);
      modal(o, { t: at + 0.05, f: 3200 * pv, ratios: [1, 1.6, 2.3], amps: [0.16, 0.1, 0.06], taus: 0.025 });                                       // brass rim
    }
    return normPeak(o, 1);
  } },

  ssgClose: { pk: 0.95, gen(R) {
    const o = alloc(0.55);
    noise(o, { dur: 0.006, env: 0.0015, amp: 1.0, filters: [{ type: 'hp', f: 1500 }] }, R);
    modal(o, { t: 0, f: 420, ratios: [1, 2.6, 4.4, 7.1], amps: [0.7, 0.5, 0.35, 0.2], taus: [0.06, 0.04, 0.03, 0.02], amp: 1.1 });   // frame slams
    tone(o, { dur: 0.16, f: glide(210, 60, 0.03), env: 0.05, amp: 1.0 }, R);
    noise(o, { dur: 0.1, env: 0.02, amp: 0.7, filters: [{ type: 'bp', f: 1100, q: 0.9 }] }, R);
    modal(o, { t: 0.05, f: 3100, ratios: [1, 1.5, 2.2], amps: [0.4, 0.25, 0.14], taus: 0.011, amp: 0.9 });                              // latch snap
    noise(o, { t: 0.05, dur: 0.008, env: 0.002, amp: 0.6, filters: [{ type: 'hp', f: 3000 }] }, R);
    return normPeak(o, 1);
  } },

  chaingun: { pk: 0.92, variants: 4, gen(R) {
    const o = alloc(0.32), j = R.rr(0.88, 1.12);
    noise(o, { dur: 0.005, env: 0.0012, amp: 1.3, filters: [{ type: 'hp', f: 1500 * j }] }, R);
    noise(o, { dur: 0.06, env: 0.010, amp: 1.1, filters: [{ type: 'bp', f: 2700 * j, q: 0.7 }] }, R);
    noise(o, { dur: 0.1, env: 0.024, amp: 1.0, filters: [{ type: 'bp', f: 720 * j, q: 1 }] }, R);
    tone(o, { dur: 0.1, f: glide(210 * j, 58, 0.014), env: 0.035, amp: 1.0 }, R);
    modal(o, { t: 0.006, f: 1700 * j, ratios: [1, 1.7, 2.9], amps: [0.22, 0.15, 0.1], taus: 0.009 });
    noise(o, { t: 0.004, dur: 0.3, env: 0.07, amp: 0.26, filters: [{ type: 'lp', f: (u) => 3200 * Math.exp(-u * 9) + 320 }] }, R);
    return satN(o, 1.7);
  } },

  rocketFire: { pk: 0.95, variants: 2, gen(R) {
    const o = alloc(1.7);
    tone(o, { dur: 0.35, f: glide(115, 42, 0.05), env: 0.12, amp: 1.2 }, R);                                       // launch thump
    noise(o, { dur: 0.08, env: 0.02, amp: 0.9, filters: [{ type: 'bp', f: 1400, q: 0.8 }] }, R);                   // tube pop
    modal(o, { t: 0, f: 260, ratios: [1, 2.7, 5.2], amps: [0.4, 0.25, 0.12], taus: [0.08, 0.05, 0.03], amp: 0.6 });  // tube ring
    noise(o, { t: 0.01, dur: 1.68, env: E.ad(0.07, 0.3), amp: 1.1, filters: [{ type: 'bp', f: (u) => 250 * Math.pow(10.4, clamp(u / 0.55, 0, 1)), q: 0.9 }] }, R); // whoosh sweep
    noise(o, { t: 0.02, dur: 1.0, env: E.ad(0.03, 0.22), amp: 0.36, filters: [{ type: 'hp', f: 4200 }] }, R);       // hiss
    noise(o, { t: 0.05, dur: 1.6, env: E.ad(0.05, 0.45), amp: 0.38, filters: [{ type: 'lp', f: 1100 }] }, R);      // motor tail
    return satN(o, 1.35);
  } },

  rocketFly: { loop: true, lv: -19, gen(R) {
    const n = Math.round(1.5 * SR), o = new Float32Array(n);
    const roar = normStd(circNoise(n, 'pink', R, [{ type: 'bp', f: 1050, q: 0.6 }, { type: 'lp', f: 3600 }]));
    const hiss = normStd(circNoise(n, 'white', R, [{ type: 'hp', f: 4200 }]));
    const rumble = normStd(circNoise(n, 'brown', R, [{ type: 'lp', f: 150 }]));
    const cr = normStd(circNoise(n, 'white', R, [{ type: 'lp', f: 60, order: 4 }]));
    const swirl = normStd(circNoise(n, 'white', R, [{ type: 'lp', f: 4, order: 4 }]));
    for (let i = 0; i < n; i++) {
      const am = clamp(0.62 + 0.3 * cr[i], 0.15, 1.4), sw = 1 + 0.25 * swirl[i];
      o[i] = roar[i] * am * sw * 0.8 + hiss[i] * (0.14 + 0.09 * cr[i]) + rumble[i] * 0.6;
    }
    return normPeak(o, 0.9);
  } },

  explosion: { lv: -8.5, pk: 0.98, variants: 3, gen(R) {
    const o = alloc(3.9);
    noise(o, { dur: 0.06, env: 0.008, amp: 1.5, filters: [{ type: 'hp', f: 500 }] }, R);
    noise(o, { dur: 1.1, env: E.ad(0.002, 0.17), amp: 1.5, filters: [{ type: 'lp', f: (u) => 300 + 8700 * Math.exp(-u / 0.11), q: 0.8 }] }, R);           // blast
    tone(o, { dur: 1.8, f: (u) => 34 + 90 * Math.exp(-u / 0.13), env: E.ad(0.004, 0.42), amp: 1.1 }, R);                                                      // body boom
    tone(o, { dur: 2.8, f: (u) => 23 + 40 * Math.exp(-u / 0.55), env: E.ad(0.03, 0.85), amp: 0.5 }, R);                                                       // sub
    const rum = normStd(circNoise(Math.round(3.8 * SR), 'brown', R, [{ type: 'lp', f: 200 }]));
    const crumble = smoothNoise(rum.length, 11, R);
    for (let i = 0; i < rum.length; i++) { const t = i / SR; rum[i] *= (0.7 + 0.35 * crumble[i]) * Math.min(1, t / 0.03) * Math.exp(-t / 1.05) * 1.1; }
    mixInto(o, rum, 0, 1);
    noise(o, { t: 0.05, dur: 2.5, env: E.ad(0.04, 0.7), amp: 0.9, filters: [{ type: 'bp', f: (u) => 900 * Math.exp(-u * 0.9) + 140, q: 0.7 }] }, R);      // mid churn
    clicks(o, { t: 0.2, dur: 3.0, rate: (u) => 320 * Math.exp(-u / 0.9), f: [500, 5000], tau: 0.003, amp: 0.55 }, R);                                         // debris patter
    noise(o, { t: 0.11, dur: 0.6, env: 0.12, amp: 0.55, filters: [{ type: 'lp', f: 1500 }] }, R);                                                              // wall reflection
    return satN(o, 2.0);
  } },

  plasma: { pk: 0.85, variants: 3, gen(R) {
    const o = alloc(0.26), j = R.rr(0.9, 1.12);
    tone(o, { dur: 0.2, f: (u) => (2100 * Math.exp(-u / 0.04) + 380) * j, env: E.ad(0.001, 0.055), amp: 0.7, fm: { ratio: 2.01, index: (u) => 5 * Math.exp(-u / 0.05) } }, R);
    tone(o, { dur: 0.16, f: (u) => (1300 * Math.exp(-u / 0.05) + 180) * j, wave: 'saw', env: 0.04, amp: 0.4, filters: [{ type: 'lp', f: 2800 }] }, R);
    noise(o, { dur: 0.14, env: 0.045, amp: 0.55, filters: [{ type: 'bp', f: 5200 * j, q: 1.2 }] }, R);
    clicks(o, { dur: 0.16, rate: 700, f: [3000, 9000], tau: 0.0012, amp: 0.55, env: E.exp(0.06) }, R);
    tone(o, { dur: 0.09, f: glide(210, 85, 0.02), env: 0.025, amp: 0.6 }, R);
    noise(o, { dur: 0.004, env: 0.001, amp: 0.9, filters: [{ type: 'hp', f: 3000 }] }, R);
    return satN(o, 1.4);
  } },

  plasmaHit: { pk: 0.8, variants: 2, gen(R) {
    const o = alloc(0.6);
    noise(o, { dur: 0.005, env: 0.001, amp: 1.0, filters: [{ type: 'hp', f: 2000 }] }, R);
    noise(o, { dur: 0.25, env: E.ad(0.002, 0.07), amp: 0.9, filters: [{ type: 'bp', f: (u) => 800 + 5200 * Math.exp(-u / 0.06), q: 1.4 }] }, R);
    clicks(o, { dur: 0.45, rate: (u) => 800 * Math.exp(-u / 0.14), f: [2000, 9000], tau: 0.0016, amp: 0.6 }, R);
    tone(o, { dur: 0.25, f: (u) => 1700 * Math.exp(-u / 0.09) + 260, env: E.ad(0.002, 0.08), amp: 0.5, fm: { ratio: 1.5, index: 4 } }, R);
    tone(o, { dur: 0.2, f: glide(150, 58, 0.04), env: 0.06, amp: 0.85 }, R);
    noise(o, { dur: 0.4, env: 0.08, amp: 0.3, filters: [{ type: 'lp', f: 900 }] }, R);
    return satN(o, 1.4);
  } },

  bfgCharge: { lv: -13, pk: 0.9, gen(R) {
    const L = 0.6, o = alloc(L), rise = (u) => clamp(u / 0.56, 0, 1), ramp = (u) => Math.pow(rise(u), 1.4) * 0.9 + 0.1;
    tone(o, { dur: L, f: (u) => 90 * Math.pow(10, rise(u)), wave: 'saw', env: ramp, amp: 0.55, vib: { rate: 9, depth: 0.03 }, filters: [{ type: 'lp', f: (u) => 900 + 5000 * rise(u), q: 1.4 }] }, R);
    tone(o, { dur: L, f: (u) => 180 * Math.pow(8, rise(u)), env: ramp, amp: 0.7, fm: { ratio: 1.5, index: (u) => 3 + 8 * rise(u) } }, R);
    tone(o, { dur: L, f: (u) => 2200 * Math.pow(2.2, rise(u)), env: (u) => ramp(u) * (0.6 + 0.4 * Math.sin(TAU * 32 * u)), amp: 0.28 }, R);
    tone(o, { dur: L, f: (u) => 55 + 55 * rise(u), env: ramp, amp: 0.8 }, R);
    noise(o, { dur: L, env: (u) => Math.pow(rise(u), 2) * 0.9, amp: 0.55, filters: [{ type: 'bp', f: (u) => 1500 * (1 + rise(u) * 3), q: 1.5 }] }, R);
    for (let i = 0; i < o.length; i++) { const t = i / SR; if (t > L - 0.008) o[i] *= (L - t) / 0.008; }
    return satN(o, 1.6);
  } },

  bfgFire: { pk: 0.98, gen(R) {
    const o = alloc(2.0);
    tone(o, { dur: 1.2, f: (u) => 30 + 120 * Math.exp(-u / 0.08), env: E.ad(0.005, 0.45), amp: 1.0 }, R);
    noise(o, { dur: 1.0, env: E.ad(0.003, 0.25), amp: 1.2, filters: [{ type: 'lp', f: (u) => 200 + 5800 * Math.exp(-u / 0.14) }] }, R);
    tone(o, { dur: 1.1, f: (u) => 2500 * Math.exp(-u / 0.25) + 90, wave: 'saw', env: E.ad(0.002, 0.3), amp: 0.7, fm: { ratio: 3.01, index: (u) => 6 * Math.exp(-u / 0.2) }, filters: [{ type: 'lp', f: 6000 }] }, R);
    tone(o, { dur: 1.3, f: (u) => 300 + 420 * Math.exp(-u / 0.3), env: E.ad(0.01, 0.5), amp: 0.3, vib: { rate: 38, depth: 0.1 } }, R);
    clicks(o, { dur: 1.4, rate: (u) => 900 * Math.exp(-u / 0.5), f: [2000, 9000], tau: 0.002, amp: 0.5 }, R);
    noise(o, { t: 0.03, dur: 1.9, env: E.ad(0.04, 0.6), amp: 0.45, filters: [{ type: 'lp', f: (u) => 700 * Math.exp(-u * 0.9) + 110 }] }, R);
    return satN(o, 1.8);
  } },

  bfgHit: { lv: -8, pk: 0.98, gen(R) {
    const o = alloc(4.6);
    noise(o, { dur: 0.05, env: 0.008, amp: 1.5, filters: [{ type: 'hp', f: 400 }] }, R);
    noise(o, { dur: 2.2, env: E.ad(0.004, 0.5), amp: 1.5, filters: [{ type: 'lp', f: (u) => 180 + 11800 * Math.exp(-u / 0.35), q: 0.8 }] }, R);
    tone(o, { dur: 3.6, f: (u) => 24 + 75 * Math.exp(-u / 0.2), env: E.ad(0.01, 1.1), amp: 1.0 }, R);
    tone(o, { dur: 2.6, f: (u) => 3000 * Math.exp(-u / 0.6) + 170, wave: 'saw', env: E.ad(0.003, 0.7), amp: 0.5, fm: { ratio: 2.5, index: (u) => 5 * Math.exp(-u / 0.5) }, filters: [{ type: 'lp', f: 5000 }] }, R);
    clicks(o, { dur: 3.0, rate: (u) => 1500 * Math.exp(-u / 1.1), f: [1500, 9000], tau: 0.002, amp: 0.6 }, R);
    modal(o, { t: 0.05, f: 440, ratios: [1, 1.5, 2.37, 3.11, 4.4], amps: [0.16, 0.14, 0.1, 0.08, 0.05], taus: [1.5, 1.3, 1.0, 0.8, 0.6], amp: 1.0 });
    const rum = normStd(circNoise(Math.round(4.4 * SR), 'brown', R, [{ type: 'lp', f: 130 }])), crumble = smoothNoise(rum.length, 9, R);
    for (let i = 0; i < rum.length; i++) { const t = i / SR; rum[i] *= (0.7 + 0.35 * crumble[i]) * Math.min(1, t / 0.05) * Math.exp(-t / 1.6) * 1.2; }
    mixInto(o, rum, 0, 1);
    noise(o, { t: 0.08, dur: 3.5, env: E.ad(0.08, 1.0), amp: 0.4, filters: [{ type: 'bp', f: (u) => 1200 * Math.exp(-u * 0.8) + 150, q: 0.6 }] }, R);
    clicks(o, { t: 0.3, dur: 4.0, rate: (u) => 260 * Math.exp(-u / 1.2), f: [500, 4500], tau: 0.003, amp: 0.5 }, R);
    return satN(o, 1.9);
  } },

  weaponSwap: { pk: 0.7, gen(R) {
    const o = alloc(0.28);
    noise(o, { dur: 0.16, env: E.pts([[0, 0], [0.04, 1], [0.16, 0]]), amp: 0.26, filters: [{ type: 'bp', f: (u) => 500 + 1700 * u / 0.16, q: 0.9 }] }, R);
    modal(o, { t: 0.08, f: 1650, ratios: [1, 1.55, 2.4], amps: [0.45, 0.3, 0.16], taus: 0.014, amp: 0.7 });
    noise(o, { t: 0.08, dur: 0.006, env: 0.0015, amp: 0.5, filters: [{ type: 'hp', f: 2500 }] }, R);
    tone(o, { t: 0.15, dur: 0.1, f: glide(160, 88, 0.025), env: 0.035, amp: 0.5 }, R);
    return normPeak(o, 1);
  } },

  empty: { pk: 0.8, gen(R) {
    const o = alloc(0.1);
    noise(o, { dur: 0.004, env: 0.001, amp: 0.9, filters: [{ type: 'bp', f: 3500, q: 0.8 }] }, R);
    modal(o, { f: 2100, ratios: [1, 1.57, 2.48], amps: [0.4, 0.3, 0.16], taus: 0.006, amp: 0.8 });
    tone(o, { dur: 0.05, f: glide(220, 120, 0.012), env: 0.012, amp: 0.4 }, R);
    modal(o, { t: 0.03, f: 1500, ratios: [1, 2.2], amps: [0.2, 0.1], taus: 0.005, amp: 0.7 });
    return crush(normPeak(o, 1), 8, 2);
  } },

  // shotgun-shell thunks (variants 0-2) and brass casing tinkles (variants 3-4); vfx.shell() always asks for 'shellDrop', so both kinds live here
  shellDrop: { pk: 0.8, variants: 5, gen(R, v) {
    if (v >= 3) return brassCasing(R);
    const o = alloc(0.55), pv = R.rr(0.88, 1.15);
    const hit = (at, a, p) => {
      tone(o, { t: at, dur: 0.1, f: glide(340 * pv * p, 210 * pv * p, 0.02), env: 0.02, amp: 0.7 * a }, R);
      noise(o, { t: at, dur: 0.05, env: 0.012, amp: 0.6 * a, filters: [{ type: 'bp', f: 900 * pv * p, q: 2 }] }, R);
      modal(o, { t: at, f: 3300 * pv * p, ratios: [1, 1.58, 2.3], amps: [0.14, 0.1, 0.06], taus: 0.03, amp: a });
    };
    hit(0, 1, 1); hit(0.11 + R.rr(-0.01, 0.02), 0.5, 1.1); hit(0.19 + R.rr(0, 0.03), 0.22, 1.2);
    noise(o, { t: 0.2, dur: 0.25, env: E.pts([[0, 0], [0.05, 1], [0.25, 0]]), amp: 0.06, filters: [{ type: 'bp', f: 1500, q: 1 }] }, R);
    return normPeak(o, 1);
  } },

  casing: { pk: 0.7, variants: 3, gen(R) { return brassCasing(R); } },

  // ---- melee ----------------------------------------------------------------------------------------------
  punch: { pk: 0.5, variants: 2, gen(R) {
    const o = alloc(0.36), j = R.rr(0.9, 1.1);
    noise(o, { dur: 0.3, env: E.pts([[0, 0], [0.07, 1], [0.2, 0.25], [0.3, 0]]), amp: 0.8, filters: [{ type: 'bp', f: (u) => (350 + 1100 * clamp(u / 0.2, 0, 1)) * j, q: 0.8 }] }, R);
    noise(o, { dur: 0.3, env: E.pts([[0, 0], [0.09, 0.8], [0.3, 0]]), amp: 0.4, filters: [{ type: 'lp', f: 320 }] }, R);
    noise(o, { t: 0.02, dur: 0.05, env: E.pts([[0, 0], [0.01, 0.5], [0.05, 0]]), amp: 0.15, filters: [{ type: 'bp', f: 3200, q: 1 }] }, R);
    return normPeak(o, 1);
  } },

  punchHit: { pk: 0.85, variants: 3, gen(R) {
    const o = alloc(0.45), j = R.rr(0.88, 1.15);
    tone(o, { dur: 0.25, f: glide(175 * j, 52, 0.05), env: 0.06, amp: 1.2 }, R);
    noise(o, { dur: 0.12, env: 0.045, amp: 1.0, filters: [{ type: 'lp', f: 700 * j }] }, R);
    noise(o, { dur: 0.05, env: 0.012, amp: 0.8, filters: [{ type: 'bp', f: 1800 * j, q: 0.9 }] }, R);
    noise(o, { t: 0.01, dur: 0.16, env: 0.07, amp: 0.5, filters: [{ type: 'bp', f: (u) => 1200 * Math.exp(-u * 6) + 250, q: 3 }] }, R);
    clicks(o, { t: 0.005, dur: 0.08, rate: 220, f: [1000, 3000], tau: 0.002, amp: 0.4 }, R);
    noise(o, { dur: 0.003, env: 0.001, amp: 0.7, filters: [{ type: 'hp', f: 1500 }] }, R);
    return satN(o, 1.5);
  } },

  sawStart: { lv: -14, pk: 0.85, gen(R) {
    const o = alloc(1.4);
    // pull-cord ratchet + rasp
    clicks(o, { dur: 0.32, rate: (u) => 60 + 90 * u / 0.32, f: [900, 2800], tau: 0.0015, amp: 0.55 }, R);
    noise(o, { dur: 0.34, env: E.pts([[0, 0], [0.05, 0.6], [0.28, 1], [0.34, 0]]), amp: 0.3, filters: [{ type: 'bp', f: (u) => 1400 + 1200 * u, q: 1.1 }] }, R);
    // first sputters
    for (const [at, a] of [[0.34, 0.9], [0.43, 0.7], [0.48, 1.0], [0.515, 0.6], [0.545, 0.9]]) pop(o, at, ENG_IDLE, a * 1.1, R, 0.6);
    // catch and run up to idle (matches sawIdle modes)
    enginePulses(o, { t: 0.56, dur: 0.84, rate: (u) => 14 + 26 * clamp(u / 0.55, 0, 1), modes: ENG_IDLE, amp: 0.9, pattern: [1, 0.75, 0.95, 0.6], jit: 0.08 }, R);
    const chain = fillNoise(new Float32Array(Math.round(0.84 * SR)), 'white', R); filt(chain, { type: 'bp', f: 2300, q: 0.8 });
    for (let i = 0; i < chain.length; i++) { const u = i / SR; o[Math.round(0.56 * SR) + i] += chain[i] * 0.25 * clamp(u / 0.4, 0, 1) * (0.55 + 0.45 * Math.sin(TAU * (14 + 26 * clamp(u / 0.55, 0, 1)) * u)); }
    noise(o, { t: 0.5, dur: 0.9, env: E.pts([[0, 0], [0.1, 0.7], [0.9, 0.5]]), amp: 0.28, filters: [{ type: 'lp', f: 260 }] }, R);
    return satN(o, 1.3);
  } },

  sawIdle: { loop: true, lv: -19, gen(R) {
    const L = 1.2, n = Math.round(L * SR), o = new Float32Array(n);
    enginePulses(o, { dur: L, rate: () => 40, modes: ENG_IDLE, amp: 1, pattern: [1, 0.72, 0.92, 0.55], jit: 0.07, circ: true }, R);
    const chain = normStd(circNoise(n, 'white', R, [{ type: 'bp', f: 2300, q: 0.8 }]));
    const body = normStd(circNoise(n, 'brown', R, [{ type: 'lp', f: 240 }]));
    for (let i = 0; i < n; i++) { const t = i / SR; o[i] += chain[i] * 0.35 * (0.55 + 0.45 * Math.sin(TAU * 40 * t)) + body[i] * 0.5 * (0.6 + 0.4 * Math.sin(TAU * 40 * t + 1)); }
    return normPeak(satN(o, 1.2), 0.9);
  } },

  sawFull: { loop: true, lv: -16, gen(R) {
    const L = 1.2, n = Math.round(L * SR), o = new Float32Array(n);
    enginePulses(o, { dur: L, rate: () => 110, modes: ENG_FULL, amp: 0.9, pattern: [1, 0.85, 0.95, 0.8], jit: 0.05, circ: true }, R);
    const chain = normStd(circNoise(n, 'white', R, [{ type: 'bp', f: 2600, q: 0.7 }])), grind = normStd(circNoise(n, 'white', R, [{ type: 'bp', f: 900, q: 1.5 }]));
    const body = normStd(circNoise(n, 'brown', R, [{ type: 'lp', f: 320 }])), wob = normStd(circNoise(n, 'white', R, [{ type: 'lp', f: 18, order: 4 }]));
    for (let i = 0; i < n; i++) {
      const t = i / SR, ac = 0.6 + 0.4 * Math.sin(TAU * 110 * t);
      o[i] += chain[i] * 0.4 * ac + grind[i] * 0.3 * (0.7 + 0.3 * wob[i]) + body[i] * 0.5;
    }
    return normPeak(satN(o, 1.7), 0.9);
  } },

  sawHit: { pk: 0.8, variants: 3, gen(R) {
    const o = alloc(0.3), j = R.rr(0.9, 1.15);
    const g = fillNoise(new Float32Array(o.length), 'white', R); filt(g, { type: 'bp', f: 1500 * j, q: 0.8 });
    for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] += g[i] * (0.6 + 0.4 * Math.sin(TAU * 110 * t)) * Math.min(1, t / 0.006) * Math.exp(-t / 0.11) * 0.9; }
    tone(o, { dur: 0.3, f: 110 * j, wave: 'saw', env: E.ad(0.003, 0.1), amp: 0.5, drive: 2, filters: [{ type: 'lp', f: 1800 }] }, R);
    tone(o, { dur: 0.15, f: glide(120, 55, 0.04), env: 0.05, amp: 0.8 }, R);
    noise(o, { dur: 0.22, env: 0.07, amp: 0.55, filters: [{ type: 'bp', f: (u) => 1100 * Math.exp(-u * 7) + 260, q: 3 }] }, R);
    clicks(o, { dur: 0.2, rate: 180, f: [1200, 4000], tau: 0.002, amp: 0.4, env: E.exp(0.1) }, R);
    return satN(o, 1.5);
  } },

  // ---- impacts --------------------------------------------------------------------------------------------
  impactConcrete: { pk: 0.75, variants: 3, gen(R) {
    const o = alloc(0.3), j = R.rr(0.85, 1.2);
    noise(o, { dur: 0.008, env: 0.0018, amp: 1.0, filters: [{ type: 'hp', f: 1200 * j }] }, R);
    noise(o, { dur: 0.05, env: 0.011, amp: 0.9, filters: [{ type: 'bp', f: 2600 * j, q: 0.7 }] }, R);
    tone(o, { dur: 0.1, f: glide(320 * j, 120, 0.02), env: 0.025, amp: 0.6 }, R);
    noise(o, { t: 0.01, dur: 0.22, env: 0.06, amp: 0.25, filters: [{ type: 'lp', f: 2500 }] }, R);
    clicks(o, { t: 0.02, dur: 0.2, rate: 260, f: [2000, 6500], tau: 0.0015, amp: 0.4, env: E.exp(0.08) }, R);
    return satN(o, 1.3);
  } },

  impactMetal: { pk: 0.65, variants: 3, gen(R) {
    const o = alloc(0.7), f = R.rr(700, 1300);
    noise(o, { dur: 0.005, env: 0.0012, amp: 0.9, filters: [{ type: 'hp', f: 3000 }] }, R);
    modal(o, { f, ratios: [1, 2.32, 4.25, 6.63], amps: [0.5, 0.4, 0.28, 0.18], taus: [0.16, 0.1, 0.06, 0.04], amp: 0.9 });
    modal(o, { f: f * 3.7, ratios: [1, 1.41, 2.1], amps: [0.3, 0.2, 0.12], taus: [0.05, 0.03, 0.02], amp: 0.7 });
    noise(o, { dur: 0.03, env: 0.007, amp: 0.5, filters: [{ type: 'bp', f: 3800, q: 0.7 }] }, R);
    tone(o, { dur: 0.05, f: glide(400, 180, 0.01), env: 0.012, amp: 0.4 }, R);
    return normPeak(o, 1);
  } },

  impactFlesh: { pk: 0.7, variants: 3, gen(R) {
    const o = alloc(0.32), j = R.rr(0.88, 1.15);
    noise(o, { dur: 0.09, env: 0.028, amp: 1.0, filters: [{ type: 'lp', f: 650 * j }] }, R);
    tone(o, { dur: 0.15, f: glide(150 * j, 75, 0.03), env: 0.04, amp: 0.9 }, R);
    noise(o, { t: 0.005, dur: 0.16, env: 0.05, amp: 0.55, filters: [{ type: 'bp', f: (u) => (1000 * Math.exp(-u * 12) + 280) * j, q: 3.5 }] }, R);
    noise(o, { dur: 0.012, env: 0.003, amp: 0.4, filters: [{ type: 'bp', f: 2200, q: 0.8 }] }, R);
    clicks(o, { t: 0.02, dur: 0.12, rate: 140, f: [400, 1400], tau: 0.004, amp: 0.3 }, R);
    return satN(o, 1.3);
  } },

  ricochet: { pk: 0.6, variants: 2, gen(R) {
    const o = alloc(0.65), j = R.rr(0.85, 1.2);
    noise(o, { dur: 0.005, env: 0.001, amp: 0.9, filters: [{ type: 'hp', f: 3000 }] }, R);
    modal(o, { f: 2800 * j, ratios: [1, 1.6], amps: [0.3, 0.2], taus: 0.02, amp: 0.7 });
    noise(o, { t: 0.004, dur: 0.5, env: E.ad(0.01, 0.15), amp: 1.0, filters: [{ type: 'bp', f: (u) => (5200 * j) * Math.pow(0.28, clamp(u / 0.42, 0, 1)), q: 14 }] }, R);
    tone(o, { t: 0.004, dur: 0.5, f: (u) => (5200 * j) * Math.pow(0.28, clamp(u / 0.42, 0, 1)), env: E.ad(0.01, 0.13), amp: 0.22 }, R);
    return normPeak(o, 1);
  } },
};
