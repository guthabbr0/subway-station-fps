// Player, pickup and UI sound recipes (+ a few internal extras used by the ambience/feedback system).
import { SR, TAU, E, alloc, noise, tone, modal, clicks, sat, satN, normPeak, glide, sweep, filt, circNoise, normStd, fillNoise, mixInto, clamp, reverb, echo, crush } from './dsp.js';
import { vocal } from './vocal.js';

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12); // MIDI note -> Hz

// bell-ish electronic note: fundamental + inharmonic partials
function bell(o, at, f, amp, tau, R) {
  modal(o, { t: at, f, ratios: [1, 2.0, 2.76, 4.07, 5.4], amps: [1, 0.35, 0.22, 0.1, 0.05], taus: [tau, tau * 0.6, tau * 0.45, tau * 0.3, tau * 0.2], amp, phase: 0 });
}
// plucky synth note (detuned saws through a decaying low-pass) + soft sine body
function pluck(o, at, f, amp, dur, R) {
  tone(o, { t: at, dur, f, wave: 'saw', unison: [-7, 7], env: E.ad(0.003, dur * 0.35), amp: amp * 0.55, filters: [{ type: 'lp', f: (u) => 4200 * Math.exp(-u / (dur * 0.3)) + 500, q: 1.2 }] }, R);
  tone(o, { t: at, dur, f, env: E.ad(0.004, dur * 0.45), amp: amp * 0.6 }, R);
}

export const misc = {
  // ---- player ---------------------------------------------------------------------------------------------
  step: { pk: 0.5, variants: 4, gen(R) {
    const o = alloc(0.26), j = R.rr(0.88, 1.15);
    tone(o, { dur: 0.09, f: glide(185 * j, 95, 0.014), env: 0.022, amp: 0.5 }, R);                                              // heel
    noise(o, { dur: 0.05, env: 0.014, amp: 0.7, filters: [{ type: 'bp', f: 1050 * j, q: 1.1 }] }, R);                            // tile tock
    noise(o, { dur: 0.008, env: 0.002, amp: 0.7, filters: [{ type: 'bp', f: 2700 * j, q: 0.8 }] }, R);                          // tile click
    noise(o, { t: 0.008, dur: 0.07, env: E.pts([[0, 0], [0.01, 1], [0.07, 0]]), amp: 0.22, filters: [{ type: 'bp', f: 950 * j, q: 0.9 }] }, R); // sole scuff
    const t2 = 0.085 + R.rr(-0.01, 0.015);                                                                                        // toe
    tone(o, { t: t2, dur: 0.06, f: glide(105 * j, 62, 0.012), env: 0.014, amp: 0.4 }, R);
    noise(o, { t: t2, dur: 0.006, env: 0.0015, amp: 0.35, filters: [{ type: 'bp', f: 2900 * j, q: 0.8 }] }, R);
    modal(o, { t: 0.004, f: 2700 * j, ratios: [1, 1.9], amps: [0.06, 0.04], taus: 0.02 });                                        // tile ring
    return normPeak(o, 1);
  } },

  jump: { pk: 0.45, gen(R) {
    const o = alloc(0.4);
    noise(o, { dur: 0.22, env: E.pts([[0, 0], [0.05, 1], [0.22, 0]]), amp: 0.45, filters: [{ type: 'bp', f: (u) => 1100 + 900 * u / 0.22, q: 1.1 }] }, R);        // effort breath "hup"
    noise(o, { dur: 0.12, env: E.pts([[0, 0], [0.03, 1], [0.12, 0]]), amp: 0.22, filters: [{ type: 'bp', f: 3400, q: 0.8 }] }, R);                             // cloth
    tone(o, { dur: 0.08, f: glide(100, 58, 0.02), env: 0.02, amp: 0.55 }, R);                                                                                // push-off
    noise(o, { dur: 0.006, env: 0.0015, amp: 0.3, filters: [{ type: 'bp', f: 2500, q: 0.8 }] }, R);
    return normPeak(o, 1);
  } },

  land: { pk: 0.6, gen(R) {
    const o = alloc(0.5);
    tone(o, { dur: 0.25, f: glide(135, 62, 0.045), env: E.ad(0.002, 0.06), amp: 0.7 }, R);
    noise(o, { dur: 0.14, env: 0.045, amp: 1.1, filters: [{ type: 'lp', f: 900 }] }, R);
    noise(o, { dur: 0.1, env: 0.03, amp: 0.8, filters: [{ type: 'bp', f: 420, q: 0.9 }] }, R);
    noise(o, { dur: 0.01, env: 0.002, amp: 0.6, filters: [{ type: 'bp', f: 2500, q: 0.8 }] }, R);
    clicks(o, { t: 0.03, dur: 0.25, rate: 110, f: [1000, 3200], tau: 0.004, amp: 0.3, env: E.exp(0.12) }, R);            // gear rattle
    noise(o, { t: 0.04, dur: 0.2, env: 0.06, amp: 0.2, filters: [{ type: 'bp', f: 1500, q: 1 }] }, R);
    return satN(o, 1.3);
  } },

  hurt: { lv: -15, pk: 0.9, variants: 3, gen(R) {
    const o = alloc(0.55), b = R.rr(0.9, 1.12);
    tone(o, { dur: 0.16, f: glide(150, 62, 0.03), env: 0.05, amp: 0.9 }, R);                                                      // impact thump
    noise(o, { dur: 0.08, env: 0.03, amp: 0.7, filters: [{ type: 'lp', f: 800 }] }, R);
    noise(o, { dur: 0.006, env: 0.0015, amp: 0.4, filters: [{ type: 'hp', f: 1500 }] }, R);
    vocal(o, { t: 0.02, dur: 0.34, f0: (u) => b * (150 - 55 * u + 10 * Math.sin(TAU * 4 * u)), vow: [[0, 'uh'], [0.5, 'aw'], [1, 'o']], scale: 0.95, breath: 0.28, rough: 0.22, roughHz: 40, jitter: 0.03, drive: 2.0, env: E.pts([[0, 0], [0.02, 1], [0.15, 0.75], [0.34, 0]]) }, R); // "ugh"
    noise(o, { t: 0.18, dur: 0.25, env: E.pts([[0, 0], [0.05, 0.6], [0.25, 0]]), amp: 0.12, filters: [{ type: 'bp', f: 1200, q: 0.8 }] }, R);        // breath out
    return satN(o, 1.2);
  } },

  playerDeath: { lv: -14, pk: 0.9, gen(R) {
    const o = alloc(3.6);
    noise(o, { dur: 0.2, env: E.pts([[0, 0], [0.09, 1], [0.2, 0]]), amp: 0.3, filters: [{ type: 'bp', f: (u) => 800 + 1200 * u / 0.2, q: 0.9 }] }, R);                     // shocked gasp
    vocal(o, { t: 0.12, dur: 1.0, f0: (u) => 168 - 100 * Math.pow(u, 0.9) + 14 * Math.sin(TAU * 3 * u) * (1 - u), vow: [[0, 'ae'], [0.35, 'uh'], [0.7, 'aw'], [1, 'o']], scale: 1.05, breath: 0.45, rough: 0.15, roughHz: 34, jitter: 0.04, sub: 0.15, drive: 1.8, hiss: 0.03, env: E.pts([[0, 0], [0.05, 1], [0.45, 0.8], [0.8, 0.35], [1.0, 0]]) }, R);
    noise(o, { t: 0.85, dur: 0.4, env: E.pts([[0, 0], [0.1, 1], [0.4, 0]]), amp: 0.16, filters: [{ type: 'bp', f: 1300, q: 0.8 }] }, R);        // last breath out
    const T = 1.0;
    tone(o, { t: T, dur: 0.8, f: glide(95, 40, 0.12), env: E.ad(0.003, 0.13), amp: 1.0 }, R);
    noise(o, { t: T, dur: 0.5, env: 0.1, amp: 0.9, filters: [{ type: 'lp', f: 420 }] }, R);
    noise(o, { t: T, dur: 0.05, env: 0.01, amp: 0.5, filters: [{ type: 'bp', f: 1800, q: 0.8 }] }, R);
    clicks(o, { t: T + 0.02, dur: 0.6, rate: 60, f: [800, 3000], tau: 0.004, amp: 0.3, env: E.exp(0.2) }, R);                                  // gear clatter
    tone(o, { t: 0.05, dur: 3.5, f: 3950, env: E.pts([[0, 0], [0.3, 0.25], [1.7, 0.2], [3.5, 0]]), amp: 0.08 }, R);                              // tinnitus
    tone(o, { t: T + 0.1, dur: 2.0, f: 52, env: E.pts([[0, 0], [0.4, 1], [2.0, 0]]), amp: 0.22 }, R);
    return satN(o, 1.1);
  } },

  // ---- pickups --------------------------------------------------------------------------------------------
  pickup: { pk: 0.6, gen(R) {
    const o = alloc(0.6);
    for (const [at, m, a] of [[0, 88, 1], [0.075, 93, 0.9]]) {
      tone(o, { t: at, dur: 0.4, f: hz(m), env: E.ad(0.003, 0.14), amp: 0.7 * a }, R);
      tone(o, { t: at, dur: 0.3, f: hz(m + 12), env: E.ad(0.003, 0.07), amp: 0.22 * a }, R);
      tone(o, { t: at, dur: 0.15, f: hz(m + 19), env: E.ad(0.001, 0.03), amp: 0.1 * a }, R);
    }
    noise(o, { dur: 0.004, env: 0.001, amp: 0.3, filters: [{ type: 'hp', f: 4000 }] }, R);
    return crush(normPeak(o, 1), 9, 2);
  } },

  pickupAmmo: { pk: 0.65, gen(R) {
    const o = alloc(0.55);
    modal(o, { f: 1900, ratios: [1, 1.63, 2.5, 3.6], amps: [0.6, 0.45, 0.3, 0.16], taus: [0.03, 0.022, 0.016, 0.012], amp: 1 });        // magazine clack
    noise(o, { dur: 0.006, env: 0.0015, amp: 0.7, filters: [{ type: 'hp', f: 2000 }] }, R);
    tone(o, { dur: 0.06, f: glide(240, 120, 0.014), env: 0.018, amp: 0.5 }, R);
    noise(o, { t: 0.06, dur: 0.1, env: E.pts([[0, 0], [0.02, 1], [0.1, 0]]), amp: 0.18, filters: [{ type: 'bp', f: 2600, q: 1.2 }] }, R);   // slide
    modal(o, { t: 0.14, f: 2500, ratios: [1, 1.5, 2.4, 3.7], amps: [0.5, 0.35, 0.2, 0.1], taus: [0.03, 0.02, 0.015, 0.01], amp: 0.9 });    // second clack
    modal(o, { t: 0.2, f: 4300, ratios: [1, 1.6], amps: [0.25, 0.15], taus: 0.05, amp: 0.6 });                                            // brass shimmer
    return crush(normPeak(o, 1), 9, 2);
  } },

  pickupWeapon: { pk: 0.75, gen(R) {
    const o = alloc(1.3);
    tone(o, { dur: 0.25, f: glide(120, 58, 0.05), env: E.ad(0.002, 0.08), amp: 1.2 }, R);
    noise(o, { dur: 0.09, env: 0.03, amp: 0.8, filters: [{ type: 'lp', f: 900 }] }, R);
    modal(o, { f: 520, ratios: [1, 2.2, 3.9, 6.1], amps: [0.55, 0.4, 0.28, 0.14], taus: [0.09, 0.06, 0.04, 0.03], amp: 0.8 });          // heavy metal ka-chunk
    noise(o, { dur: 0.006, env: 0.0015, amp: 0.6, filters: [{ type: 'hp', f: 1800 }] }, R);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => pluck(o, 0.14 + i * 0.075, f, 0.75, 0.5, R));
    bell(o, 0.44, 1046.5, 0.22, 0.6, R);
    return crush(satN(o, 1.15), 10, 2);
  } },

  pickupHealth: { pk: 0.6, gen(R) {
    const o = alloc(0.95);
    for (const [at, m, a] of [[0, 79, 1], [0.11, 84, 1]]) {
      tone(o, { t: at, dur: 0.75, f: hz(m), unison: [-6, 6], wave: 'sin', env: E.pts([[0, 0], [0.02, 1], [0.1, 0.7], [0.75, 0]]), amp: 0.6 * a }, R);
      tone(o, { t: at, dur: 0.6, f: hz(m + 12), env: E.pts([[0, 0], [0.02, 1], [0.6, 0]]), amp: 0.18 * a }, R);
      tone(o, { t: at, dur: 0.5, f: hz(m), wave: 'tri', env: E.pts([[0, 0], [0.03, 1], [0.5, 0]]), amp: 0.25 * a }, R);
    }
    tone(o, { t: 0.1, dur: 0.3, f: (u) => 2200 + 1200 * u / 0.3, env: E.pts([[0, 0], [0.05, 1], [0.3, 0]]), amp: 0.08 }, R);          // sparkle
    return crush(normPeak(o, 1), 10, 2);
  } },

  pickupArmor: { pk: 0.7, gen(R) {
    const o = alloc(0.75);
    modal(o, { f: 300, ratios: [1, 2.6, 4.5, 7], amps: [0.6, 0.5, 0.35, 0.2], taus: [0.07, 0.05, 0.035, 0.02], amp: 1 });                 // plate clank
    noise(o, { dur: 0.007, env: 0.002, amp: 0.6, filters: [{ type: 'hp', f: 2000 }] }, R);
    tone(o, { dur: 0.12, f: glide(180, 80, 0.02), env: 0.03, amp: 0.7 }, R);
    tone(o, { t: 0.05, dur: 0.5, f: sweep(400, 1300, 0.3), wave: 'saw', env: E.ad(0.06, 0.2), amp: 0.28, filters: [{ type: 'lp', f: 3200, q: 1.5 }] }, R);   // rising energy ring
    noise(o, { t: 0.08, dur: 0.4, env: E.ad(0.05, 0.12), amp: 0.28, filters: [{ type: 'bp', f: (u) => 2000 + 3500 * u / 0.4, q: 1.5 }] }, R);          // shing
    bell(o, 0.16, 1318.5, 0.16, 0.25, R);
    return crush(normPeak(o, 1), 9, 2);
  } },

  // ---- UI -------------------------------------------------------------------------------------------------
  uiClick: { pk: 0.7, gen(R) {
    const o = alloc(0.09);
    tone(o, { dur: 0.05, f: sweep(1900, 1200, 0.03), env: 0.012, amp: 0.6 }, R);
    noise(o, { dur: 0.006, env: 0.0015, amp: 0.6, filters: [{ type: 'bp', f: 4000, q: 0.9 }] }, R);
    tone(o, { dur: 0.03, f: 320, env: 0.008, amp: 0.4 }, R);
    return crush(normPeak(o, 1), 9, 2);
  } },

  waveStart: { lv: -12, pk: 0.9, gen(R) {
    const o = alloc(3.0);
    tone(o, { dur: 0.7, f: glide(70, 28, 0.15), env: E.ad(0.004, 0.22), amp: 1.5 }, R);                                                    // impact
    noise(o, { dur: 0.6, env: E.ad(0.003, 0.14), amp: 0.8, filters: [{ type: 'lp', f: (u) => 300 + 2500 * Math.exp(-u / 0.1) }] }, R);
    const brass = (f, amp) => tone(o, { t: 0.05, dur: 2.7, f, wave: 'saw', unison: [-9, 0, 9], env: E.adsr(0.28, 0.6, 0.55, 1.4, 1.2), amp, drive: 1.6, filters: [{ type: 'lp', f: (u) => 260 + 2100 * (1 - Math.exp(-u / 0.35)) * Math.exp(-u / 2.2) + 320, q: 1.6 }] }, R);
    brass(73.42, 0.55); brass(110, 0.4); brass(146.83, 0.3); brass(174.6, 0.18);
    noise(o, { t: 0.15, dur: 1.4, env: E.ad(0.9, 0.25), amp: 0.32, filters: [{ type: 'bp', f: (u) => 400 * Math.pow(7, clamp(u / 1.1, 0, 1)), q: 1.1 }] }, R);   // rising tension
    modal(o, { t: 0.02, f: 220, ratios: [1, 3, 4.5, 6.3], amps: [0.2, 0.14, 0.1, 0.07], taus: [1.2, 0.8, 0.6, 0.4], amp: 0.7 });
    return satN(o, 1.5);
  } },

  waveClear: { lv: -15, pk: 0.8, gen(R) {
    const o = alloc(2.4);
    [64, 67, 71, 76].forEach((m, i) => pluck(o, i * 0.11, hz(m), 0.9, 0.65, R));
    [76, 83, 80, 88].forEach((m, i) => bell(o, 0.44 + i * 0.035, hz(m), 0.18, 0.9, R));
    tone(o, { t: 0.44, dur: 1.5, f: hz(52), wave: 'saw', unison: [-6, 6], env: E.pts([[0, 0], [0.03, 1], [0.5, 0.5], [1.5, 0]]), amp: 0.25, filters: [{ type: 'lp', f: 900 }] }, R);
    tone(o, { dur: 0.3, f: glide(90, 45, 0.06), env: 0.09, amp: 0.7 }, R);
    return reverb(satN(o, 1.1), { room: 0.7, wet: 0.35, tail: 0.6 });
  } },

  gameOver: { lv: -12, pk: 0.9, gen(R) {
    const o = alloc(6.0);
    tone(o, { dur: 5.4, f: (u) => 118 * Math.pow(0.5, u / 4.2), wave: 'saw', unison: [-12, 0, 11], env: E.pts([[0, 0], [0.4, 1], [3.6, 0.8], [5.4, 0]]), amp: 0.6, drive: 1.6, filters: [{ type: 'lp', f: (u) => 1300 * Math.exp(-u * 0.5) + 130, q: 1.4 }] }, R);
    tone(o, { dur: 5.4, f: (u) => 59 * Math.pow(0.5, u / 4.2), env: E.pts([[0, 0], [0.5, 1], [4.0, 0.7], [5.4, 0]]), amp: 0.7 }, R);
    for (const [at, a] of [[0.0, 1], [1.8, 0.7]]) modal(o, { t: at, f: 196, ratios: [1, 2.32, 4.1, 5.9, 8.2], amps: [0.6, 0.4, 0.28, 0.16, 0.1], taus: [2.4, 1.5, 0.9, 0.55, 0.35], amp: a });
    tone(o, { dur: 0.6, f: glide(70, 30, 0.14), env: E.ad(0.004, 0.2), amp: 1.2 }, R);
    const rum = normStd(circNoise(Math.round(6 * SR), 'brown', R, [{ type: 'lp', f: 110 }]));
    for (let i = 0; i < rum.length; i++) { const t = i / SR; o[i] += rum[i] * 0.4 * Math.min(1, t / 0.6) * Math.exp(-t / 2.4); }
    noise(o, { t: 0.1, dur: 4.5, env: E.pts([[0, 0], [1.5, 0.5], [4.5, 0]]), amp: 0.12, filters: [{ type: 'bp', f: (u) => 900 * Math.exp(-u * 0.5) + 120, q: 0.7 }] }, R);
    return satN(o, 1.2);
  } },

  // ---- internal extras (not in AUDIO_NAMES; used by ambience / feedback) -------------------------------
  // hit-confirmation ticks (played by audio.js from the enemy:hit bus event): body hit, headshot, kill
  hitTick: { pk: 0.5, gen(R) {
    const o = alloc(0.1);
    noise(o, { dur: 0.005, env: 0.0012, amp: 0.9, filters: [{ type: 'bp', f: 3800, q: 0.8 }] }, R);
    tone(o, { dur: 0.07, f: 2600, env: 0.012, amp: 0.6 }, R);
    tone(o, { dur: 0.06, f: glide(1300, 850, 0.02), env: 0.012, amp: 0.3 }, R);
    return crush(normPeak(o, 1), 10, 1);
  } },
  hitHead: { pk: 0.6, gen(R) {
    const o = alloc(0.42);
    noise(o, { dur: 0.005, env: 0.0012, amp: 0.8, filters: [{ type: 'bp', f: 4200, q: 0.8 }] }, R);
    modal(o, { f: 3100, ratios: [1, 1.5, 2.4, 3.8], amps: [0.7, 0.4, 0.25, 0.12], taus: [0.11, 0.07, 0.05, 0.03], amp: 1, phase: 0.6 });
    tone(o, { dur: 0.05, f: 3100, env: 0.01, amp: 0.5 }, R);
    return normPeak(o, 1);
  } },
  hitKill: { pk: 0.7, gen(R) {
    const o = alloc(0.3);
    tone(o, { dur: 0.15, f: glide(200, 88, 0.045), env: 0.05, amp: 0.9 }, R);
    noise(o, { dur: 0.08, env: 0.028, amp: 0.9, filters: [{ type: 'lp', f: 900 }] }, R);
    noise(o, { dur: 0.005, env: 0.0012, amp: 0.7, filters: [{ type: 'bp', f: 3000, q: 0.8 }] }, R);
    tone(o, { t: 0.02, dur: 0.16, f: sweep(800, 1700, 0.1), env: E.ad(0.004, 0.04), amp: 0.28 }, R);
    modal(o, { t: 0.02, f: 1700, ratios: [1, 2.3], amps: [0.2, 0.1], taus: 0.05, amp: 0.7 });
    return satN(o, 1.2);
  } },

  heartbeat: { pk: 0.7, gen(R) {
    const o = alloc(0.7);
    for (const [at, a] of [[0, 1], [0.26, 0.7]]) {
      tone(o, { t: at, dur: 0.25, f: glide(115, 58, 0.05), env: E.ad(0.006, 0.06), amp: 1.0 * a }, R);
      noise(o, { t: at, dur: 0.14, env: 0.03, amp: 0.7 * a, filters: [{ type: 'lp', f: 380 }] }, R);
    }
    return satN(o, 1.2);
  } },

  tinnitus: { pk: 0.3, gen(R) {
    const o = alloc(3.2);
    tone(o, { dur: 3.2, f: 3900, env: E.pts([[0, 0], [0.05, 1], [0.8, 0.7], [3.2, 0]]), amp: 0.7 }, R);
    tone(o, { dur: 3.2, f: 6400, env: E.pts([[0, 0], [0.05, 0.6], [0.6, 0.3], [2.0, 0]]), amp: 0.25 }, R);
    return o;
  } },
};
