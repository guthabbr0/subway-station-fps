// Procedural animation: locomotion cycle + per-style arm poses (IK hand targets) + table-driven attack poses + death poses.
// Everything is computed into a scratch target pose, then critically-damped into e.P and applied to the skeleton.
import * as THREE from 'three';
import { CH, applyPose } from './rig.js';

const { HY, HX, HZ, HR, SX, SY, SZ, NX, NY, NZ, LLX, LLZ, LKX, RLX, RLZ, RKX, RY, RP, RR } = CH;
const T = new Float32Array(CH.N);
const hlT = new THREE.Vector3(), hrT = new THREE.Vector3();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (u) => u * u * (3 - 2 * u);
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const H = (v, side, R, x, y, z) => v.set(side * x * R, y * R, z * R);

// ------------------------------------------------------------------ attack pose table (targets in units of arm reach R; x is "outward")
// fields: sp spine pitch, hp hips pitch, nk neck pitch, hy hips height, sy spine twist, cr crouch (0..1), hl/hr [x,y,z] hand targets, lr leg raise (right leg)
export const ATK = {
  swipe: { w: { sp: -0.3, hp: -0.06, nk: -0.35, hy: -0.03, hl: [0.2, 0.85, 0.1], hr: [0.2, 0.9, 0.05] }, s: { sp: 0.55, hp: 0.3, nk: 0.4, hy: -0.1, hl: [0.1, -0.8, 0.6], hr: [0.1, -0.8, 0.6] } },
  rake: { w: { sp: 0.55, hp: 0.4, nk: -0.4, cr: 0.5, hl: [0.5, -0.5, -0.4], hr: [0.5, -0.5, -0.4] }, s: { sp: 0.7, hp: 0.45, nk: 0.35, cr: 0.05, hl: [0.15, 0.05, 1.0], hr: [0.15, 0.0, 1.0] } },
  shoot: { w: { sp: -0.08, nk: 0.05 }, s: { sp: -0.22, nk: -0.08 } },
  spit: { w: { sp: -0.5, hp: -0.14, nk: -0.65, hl: [0.6, 0.15, 0.25], hr: [0.6, 0.2, 0.25] }, s: { sp: 0.42, hp: 0.16, nk: 0.55, hl: [0.1, -0.1, 0.95], hr: [0.1, -0.1, 0.95] } },
  slam: { w: { sp: -0.55, hp: -0.15, nk: -0.2, cr: 0.1, hl: [0.3, 0.95, -0.15], hr: [0.3, 0.95, -0.15] }, s: { sp: 0.75, hp: 0.4, nk: 0.5, hy: -0.1, cr: 0.35, hl: [0.1, -0.85, 0.75], hr: [0.1, -0.85, 0.75] } },
  charge: { w: { sp: 0.4, hp: 0.25, nk: 0.5, cr: 0.35, hl: [0.4, -0.55, -0.6], hr: [0.4, -0.55, -0.6] }, s: { sp: 0.45, hp: 0.3, nk: 0.5, cr: 0.15, hl: [0.4, -0.55, -0.7], hr: [0.4, -0.55, -0.7] } },
  prime: { w: { sp: -0.2, nk: -0.3, hl: [0.8, 0.5, 0.15], hr: [0.8, 0.5, 0.15] }, s: { sp: -0.3, nk: -0.4, hl: [0.9, 0.7, 0.1], hr: [0.9, 0.7, 0.1] } },
  claw: { w: { sp: -0.15, sy: 0.7, hp: -0.08, hr: [0.95, 0.3, -0.6], hl: [0.45, -0.5, 0.0] }, s: { sp: 0.3, sy: -0.85, hp: 0.15, hr: [-0.8, -0.2, 0.85], hl: [0.4, -0.55, 0.15] } },
  stomp: { w: { sp: -0.5, hp: -0.1, nk: -0.3, hl: [0.3, 0.95, 0.0], hr: [0.3, 0.95, 0.0], lr: 1.0 }, s: { sp: 0.65, hp: 0.3, nk: 0.45, hy: -0.14, hl: [0.15, -0.85, 0.75], hr: [0.15, -0.85, 0.75], lr: 0.0 } },
};

function overlay(e, atk, wgt, sm, R) {
  const W = atk.w, S = atk.s, D = e.rig.D;
  const f = (ch, k) => { const w = W[k], s = S[k]; if (w === undefined && s === undefined) return; const cur = T[ch]; const wv = w ?? cur, sv = s ?? cur; T[ch] = cur + (lerp(wv, sv, sm) - cur) * wgt; };
  f(SX, 'sp'); f(HX, 'hp'); f(NX, 'nk'); f(HY, 'hy'); f(SY, 'sy');
  if (W.cr !== undefined || S.cr !== undefined) {
    const cr = lerp(W.cr ?? 0, S.cr ?? 0, sm) * wgt, a = cr * 0.95, k = a * 1.9;
    T[HY] -= D.thigh * (1 - Math.cos(a)) + D.shin * (1 - Math.cos(k - a));
    T[LLX] = lerp(T[LLX], -a, wgt); T[RLX] = lerp(T[RLX], -a, wgt); T[LKX] = lerp(T[LKX], k, wgt); T[RKX] = lerp(T[RKX], k, wgt);
  }
  if (W.lr !== undefined || S.lr !== undefined) { const lr = lerp(W.lr ?? 0, S.lr ?? 0, sm) * wgt; T[RLX] = lerp(T[RLX], -1.2 * lr, 0.9); T[RKX] = lerp(T[RKX], 1.4 * lr, 0.9); T[LKX] += 0.15 * lr; }
  const hf = (v, side, k) => {
    const w = W[k], s = S[k]; if (!w && !s) return;
    const cx = v.x / (side * R), cy = v.y / R, cz = v.z / R;
    const a = w || [cx, cy, cz], b = s || w;
    H(v, side, R, lerp(cx, lerp(a[0], b[0], sm), wgt), lerp(cy, lerp(a[1], b[1], sm), wgt), lerp(cz, lerp(a[2], b[2], sm), wgt));
  };
  hf(hlT, 1, 'hl'); hf(hrT, -1, 'hr');
}

// ------------------------------------------------------------------ resting arm styles
const STYLE = {
  zombie(e, s, c, t, mv, R, sd) {
    const w = e.hasTarget ? 1 : 0.15;
    H(hlT, 1, R, 0.1 + s * 0.06 * mv, lerp(-0.95, -0.02, w) + Math.sin(t * 1.9 + sd) * 0.06, lerp(0.05, 0.9, w));
    H(hrT, -1, R, 0.1 - s * 0.06 * mv, lerp(-0.95, -0.08, w) + Math.sin(t * 2.3 + sd + 1) * 0.07, lerp(0.05, 0.84, w));
  },
  flail(e, s, c, t, mv, R) { // running pump, hands hooked
    const a = mv > 0.1 ? s : Math.sin(t * 5.0) * 0.4;
    H(hlT, 1, R, 0.2, -0.32 - Math.min(0, a) * 0.5 + Math.max(0, -a) * 0.5, 0.34 - a * 0.7 + (1 - mv) * 0.3);
    H(hrT, -1, R, 0.2, -0.32 - Math.min(0, -a) * 0.5 + Math.max(0, a) * 0.5, 0.34 + a * 0.7 + (1 - mv) * 0.3);
  },
  rifle(e, s, c, t, mv, R) { // absolute targets: hands on the rifle grip / handguard (spine space, relative to shoulder)
    const D = e.rig.D, RX = -0.105;
    hlT.set(RX - D.shX, 0.325 - D.shY, 0.42); hrT.set(RX + D.shX, 0.295 - D.shY, 0.15);
  },
  swing(e, s, c, t, mv, R, sd) { // heavy pendulum arms, fists near the floor
    H(hlT, 1, R, 0.25, -0.9 + Math.abs(s) * 0.04, -0.05 - s * 0.55 * mv + Math.sin(t * 1.3 + sd) * 0.05);
    H(hrT, -1, R, 0.25, -0.9 + Math.abs(s) * 0.04, -0.05 + s * 0.55 * mv + Math.sin(t * 1.1 + sd) * 0.05);
  },
  wide(e, s, c, t, mv, R, sd) { // arms held out around the belly
    H(hlT, 1, R, 0.8 + Math.sin(t * 1.4 + sd) * 0.05, -0.28 + s * 0.04, 0.42 + s * 0.12 * mv);
    H(hrT, -1, R, 0.8 + Math.sin(t * 1.7 + sd) * 0.05, -0.28 - s * 0.04, 0.42 - s * 0.12 * mv);
  },
  claw(e, s, c, t, mv, R, sd) { // tyrant: hanging claw + lantern arm
    H(hlT, 1, R, 0.42, -0.85, 0.12 - s * 0.32 * mv + Math.sin(t * 1.2 + sd) * 0.04);
    H(hrT, -1, R, 0.38, -0.78 + Math.sin(t * 1.6) * 0.03, 0.22 + s * 0.35 * mv);
  },
  spitter(e, s, c, t, mv, R, sd) {
    H(hlT, 1, R, 0.26, -0.5 + Math.sin(t * 2.1 + sd) * 0.05, 0.6 + s * 0.08 * mv);
    H(hrT, -1, R, 0.26, -0.45 + Math.sin(t * 1.8 + sd) * 0.05, 0.62 - s * 0.08 * mv);
  },
};

// ------------------------------------------------------------------ main pose
export function animate(e, dt) {
  const d = e.def, A = d.anim, rig = e.rig, D = rig.D, R = D.uarm + D.farm, sd = e.seed * 6.283;
  e.animT += dt;
  const t = e.animT;
  const sp = e.fakeSpeed ?? e.speedNow, mv = Math.min(1, sp / 1.0) * (e.state === 'dying' ? 0 : 1);
  e.phase += sp * A.cyc * 6.2832 * dt;
  const ph = e.phase, s = Math.sin(ph), c = Math.cos(ph);
  T.fill(0);
  // ---- legs / hips / spine
  T[LLX] = -s * A.hip * mv; T[RLX] = s * A.hip * mv;
  T[LKX] = (A.kneeBase + Math.max(0, c) * A.knee) * mv; T[RKX] = (A.kneeBase + Math.max(0, -c) * A.knee) * mv;
  if (A.drag) { T[LLX] = T[LLX] * (1 - 0.45 * A.drag) - 0.12 * A.drag * mv; T[LKX] *= 1 - 0.7 * A.drag; }
  T[LLZ] = 0.05 + (A.stance || 0); T[RLZ] = -0.05 - (A.stance || 0);
  T[HY] = -A.bob * (1 - Math.cos(2 * ph)) * 0.5 * mv - (A.crouch || 0);
  T[HZ] = s * A.sway * mv; T[HR] = -s * A.twist * 0.6 * mv; T[SY] = s * A.twist * mv; T[SZ] = -s * A.sway * 0.6 * mv;
  T[HX] = A.hipLean * (0.5 + 0.5 * mv) ; T[SX] = A.spine * (0.6 + 0.4 * mv) + Math.sin(t * 1.6 + sd) * 0.012;
  T[HX] += e.hunch * 0.5; T[SX] += e.hunch;
  T[NX] = A.head - (T[HX] + T[SX]) * 0.6;
  T[NZ] = Math.sin(t * 0.9 + sd * 1.7) * A.wob; T[NY] = clamp(e.lookRel, -A.look, A.look);
  STYLE[A.arms](e, s, c, t, mv, R, sd);
  // ---- state overlays
  let lam = A.lam || 14;
  const st = e.state, at = e.atk ? ATK[e.atk] : null;
  if (at && (st === 'windup' || st === 'strike' || st === 'recover' || st === 'charge')) {
    const u = e.dur > 0 ? clamp(e.t / e.dur, 0, 1) : 1;
    if (st === 'windup') { overlay(e, at, ease(u), 0, R); lam = 16; }
    else if (st === 'strike') { overlay(e, at, 1, easeOut(u), R); lam = 42; }
    else if (st === 'charge') { overlay(e, at, 1, 1, R); lam = 14; T[NX] += 0.1; }
    else { overlay(e, at, 1 - ease(u), 1, R); lam = 10; }
  } else if (st === 'prime' && at) { const u = clamp(e.t / e.dur, 0, 1); overlay(e, at, ease(Math.min(1, u * 3)), u, R); lam = 14; }
  else if (st === 'aim' && at) { const u = clamp(e.t / e.dur, 0, 1); overlay(e, at, ease(u), 0, R); lam = 16; }
  else if (st === 'shoot' && at) { overlay(e, at, 1, e.kick, R); lam = 40; }
  else if (st === 'stagger') { e.react = Math.max(e.react, 0.9 * (1 - clamp(e.t / e.dur, 0, 1) * 0.6)); }
  else if (st === 'emerge') { T[SX] += 0.12; T[NX] -= 0.15; }
  if (e.react > 0.02) { // hit flinch
    const r = e.react; T[SX] -= 0.45 * r; T[HX] -= 0.15 * r; T[NX] -= 0.4 * r; T[NZ] += e.reactSide * 0.3 * r; T[HZ] += e.reactSide * 0.1 * r; T[SY] += e.reactSide * 0.25 * r;
    if (A.arms !== 'rifle') { hlT.x = lerp(hlT.x, 0.1 * R, r * 0.6); hlT.y = lerp(hlT.y, 0.45 * R, r * 0.6); hlT.z = lerp(hlT.z, 0.35 * R, r * 0.6); hrT.x = lerp(hrT.x, -0.1 * R, r * 0.6); hrT.y = lerp(hrT.y, 0.45 * R, r * 0.6); hrT.z = lerp(hrT.z, 0.35 * R, r * 0.6); }
  }
  if (e.primeGlow) T[HZ] += Math.sin(t * 40) * 0.02 * e.primeGlow;
  if (e.hitGrace > 0) e.hitGrace -= dt;
  // ---- damp
  const k = 1 - Math.exp(-lam * dt), P = e.P;
  for (let i = 0; i < CH.N; i++) P[i] += (T[i] - P[i]) * k;
  const kh = 1 - Math.exp(-(lam + 4) * dt);
  e.hl.x += (hlT.x - e.hl.x) * kh; e.hl.y += (hlT.y - e.hl.y) * kh; e.hl.z += (hlT.z - e.hl.z) * kh;
  e.hr.x += (hrT.x - e.hr.x) * kh; e.hr.y += (hrT.y - e.hr.y) * kh; e.hr.z += (hrT.z - e.hr.z) * kh;
  e.react *= Math.exp(-5 * dt);
  e.lean = P[HX] + P[SX];
  applyPose(rig, P, e.hl, e.hr, d);
}

// ------------------------------------------------------------------ death
export const DEATH_DUR = { back: 0.85, front: 0.8, crumple: 1.15 };
export function poseDeath(e, dt) {
  const rig = e.rig, D = rig.D, R = D.uarm + D.farm, k = clamp(e.dtime / e.ddur, 0, 1), kind = e.dkind, sg = e.dside, lie = e.def.lieY ?? 0.16;
  e.dtime += dt;
  T.fill(0);
  const a = k * k;
  if (kind === 'back') {
    T[RP] = -1.5 * a; T[RY] = lie * a; T[SX] = -0.25 * k; T[NX] = -0.35 * k; T[LKX] = 0.7 * k; T[RKX] = 0.35 * k; T[LLX] = -0.35 * k; T[RLX] = -0.1 * k; T[LLZ] = 0.12 * k; T[RLZ] = -0.2 * k; T[NZ] = sg * 0.4 * k;
    H(hlT, 1, R, 0.85, 0.35, -0.35); H(hrT, -1, R, 0.7, 0.1, -0.55);
  } else if (kind === 'front') {
    T[RP] = 1.5 * a; T[RY] = lie * a; T[SX] = 0.3 * k; T[NX] = 0.3 * k; T[LKX] = 0.5 * k; T[RKX] = 0.9 * k; T[LLX] = -0.2 * k; T[RLX] = 0.1 * k; T[NZ] = sg * 0.5 * k;
    H(hlT, 1, R, 0.4, -0.25, 0.9); H(hrT, -1, R, 0.5, 0.1, 0.8);
  } else { // crumple: knees buckle, then topple sideways/back
    const p1 = clamp(k / 0.55, 0, 1), p2 = clamp((k - 0.5) / 0.5, 0, 1);
    T[LLX] = -1.05 * p1; T[RLX] = -0.85 * p1; T[LKX] = 2.0 * p1; T[RKX] = 2.1 * p1;
    T[HY] = -(D.thigh * (1 - Math.cos(0.99 * p1)) + D.shin * (1 - Math.cos(0.9 * p1)) + 0.05) * 1.0;
    T[SX] = 0.5 * p1 - 0.2 * p2; T[NX] = 0.4 * p1;
    T[RP] = -sg * 0.0 - 1.45 * p2 * p2; T[RR] = sg * 0.35 * p2; T[RY] = lie * p2 * p2;
    H(hlT, 1, R, 0.3, -0.6, 0.4 - p2); H(hrT, -1, R, 0.35, -0.6, 0.3 - p2 * 0.8);
  }
  const kk = 1 - Math.exp(-(k < 1 ? 16 : 10) * dt), P = e.P;
  for (let i = 0; i < CH.N; i++) P[i] += (T[i] - P[i]) * kk;
  e.hl.lerp(hlT, kk); e.hr.lerp(hrT, kk);
  applyPose(rig, P, e.hl, e.hr, e.def);
  return k >= 1;
}
