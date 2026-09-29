// Procedural humanoid/zombie models. Each type = one geometry per bone (merged primitives with vertex colours + atlas UVs),
// shared by every instance of the type. Skeleton space conventions:
//   hips  (origin at pelvis pivot, y = D.hipY)      thighs hang down -Y from (+-hipX, 0, 0), shins from the knee
//   spine (origin D.waist above hips)               torso spans y 0..D.torso, shoulders at (+-shX, shY), neck pivot at y = D.torso
//   +Z is forward, left side = +X.
import * as THREE from 'three';
import { GB } from './geo.js';
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _ax = new THREE.Vector3(1, 0, 0);

const PI = Math.PI;
const SKIN = 0xffffff;

function dims(o) {
  const D = Object.assign({ hipX: 0.095, waist: 0.06, torso: 0.52, shX: 0.2, shY: 0.46, uarm: 0.29, farm: 0.27, thigh: 0.45, shin: 0.43, headY: 0.16 }, o);
  D.hipY = D.thigh + D.shin + 0.05;
  return D;
}

// ------------------------------------------------------------------------------------------------------ generic bones
function pelvisGeo(D, Q) {
  const g = new GB(Q.seed + 1), W = Q.tw, Dp = Q.td;
  g.cyl(0.155 * W, 0.15 * W, 0.24, { p: [0, 0.03, 0], s: [1.12, 1, 0.72 * Dp], reg: 'thigh', seg: 10, jit: 0.002 });
  g.sph(0.11 * W, { p: [0, -0.03, -0.055], s: [1.25, 1, 1], reg: 'thigh', ws: 8, hs: 6 });
  g.cyl(0.158 * W, 0.158 * W, 0.04, { p: [0, 0.135, 0], s: [1.12, 1, 0.73 * Dp], reg: 'shoe', col: Q.beltCol ?? 0x2a2018, seg: 10 });
  g.box(0.045, 0.036, 0.012, { p: [0, 0.135, 0.118 * Dp * W], reg: 'extra', col: 0xffffff });
  Q.pelvis?.(g, D, Q);
  return g.buildParts();
}

function torsoGeo(D, Q) {
  const g = new GB(Q.seed + 2), T = D.torso, W = Q.tw, Dp = Q.td;
  g.cyl(0.165 * W, 0.142 * W, T, { p: [0, T / 2, 0], s: [1.14, 1, 0.7 * Dp], reg: 'torso', seg: 12, jit: Q.torsoJit ?? 0.004, col: 0xffffff, col2: 0xd6d6d6 });
  g.sph(0.078 * Q.limb, { p: [D.shX, D.shY - 0.015, 0], reg: 'uarm', ws: 8, hs: 6, mir: true, jit: 0.002 });
  g.cyl(0.05 * (Q.neckR || 1), 0.056 * (Q.neckR || 1), 0.12, { p: [0, T + 0.025, 0.004], reg: 'skin', seg: 8, jit: 0.002 });
  if (!Q.noTrap) g.cyl(0.05, 0.14 * W, 0.07, { p: [0, T - 0.02, 0], s: [1.35, 1, 0.75], reg: 'torso', seg: 10, sub: [0.35, 0.9, 0.65, 1.0] });
  Q.torso?.(g, D, Q);
  return g.buildParts();
}

// head geometry lives in neck space; centre at (0, headY, 0). variant: 0 bald/patchy, 1 short hair, 2 long hair
function headGeo(D, Q, v) {
  const g = new GB(Q.seed + 10 + v), S = Q.headSize || 1, hy = D.headY;
  g.sph(0.105 * S, { p: [0, hy, 0.004 * S], s: [Q.skullW ?? 0.94, Q.skullH ?? 1.1, Q.skullD ?? 1.03], reg: 'face', planar: [0, hy, 0.24 * S, 0.26 * S], ws: 14, hs: 11, jit: 0.0015 });
  const jo = Q.jawOpen ?? 0.18;
  g.box((Q.jawW ?? 0.092) * S, 0.052 * S, (Q.jawD ?? 0.085) * S, { p: [0, hy - 0.098 * S - jo * 0.05, 0.043 * S], r: [jo, 0, 0], reg: 'skin', tp: [0.65, 0.55], jit: 0.002, cv: 0.1 });
  if (!Q.noTeeth) g.box(0.06 * S, 0.014 * S, 0.02 * S, { p: [0, hy - 0.072 * S, 0.083 * S], reg: 'bone', col: 0xe8e0c0 });
  g.box(0.028 * S, 0.04 * S, 0.032 * S, { p: [0, hy - 0.018 * S, 0.103 * S], r: [-0.25, 0, 0], reg: 'skin', tp: [0.55, 0.55], col: 0xe6e6e6 });
  g.box(0.155 * S, 0.02 * S, 0.03 * S, { p: [0, hy + 0.034 * S, 0.088 * S], reg: 'skin', col: 0x9a9a96, jit: 0.002 });
  g.box(0.012 * S, 0.05 * S, 0.035 * S, { p: [0.101 * S, hy - 0.005 * S, -0.005 * S], reg: 'skin', mir: true, col: 0xdcdcdc });
  if (Q.eyes) { // glowing eyes sit on the (ellipsoid) skull surface so they are not buried inside it
    const ex = 0.04 * S, ey = 0.011 * S, skW = 0.105 * S * (Q.skullW ?? 0.94), skH = 0.105 * S * (Q.skullH ?? 1.1), skD = 0.105 * S * (Q.skullD ?? 1.03);
    const ez = 0.004 * S + skD * Math.sqrt(Math.max(0.05, 1 - (ex / skW) ** 2 - (ey / skH) ** 2)) + 0.001 * S;
    g.sph(0.0135 * S, { p: [ex, hy + ey, ez], s: [1.3, 0.85, 0.8], glow: true, col: Q.eyes, ws: 7, hs: 5, mir: true });
  }
  if (v === 3) { // hood up (hoodie outfits): cloth cap around the skull with a bunched nape and a shadowed opening
    g.sph(0.128 * S, { p: [0, hy + 0.004 * S, -0.014 * S], s: [1.02, 1.1, 1.12], r: [-0.5, 0, 0], th0: 0, thLen: PI * 0.52, reg: 'uarm', ws: 12, hs: 8, jit: 0.005, cv: 0.15 });
    g.sph(0.115 * S, { p: [0, hy - 0.05 * S, -0.085 * S], s: [1.08, 1.0, 0.8], reg: 'uarm', ws: 8, hs: 6, jit: 0.008, col: 0xe0e0e0 });
    g.tor(0.098 * S, 0.014 * S, { p: [0, hy + 0.035 * S, 0.062 * S], r: [0.35, 0, 0], s: [1, 1.2, 1], reg: 'uarm', arc: PI, seg: 12, rs: 4, col: 0xd0d0d0 });
  }
  const hair = v === 1 || v === 2 ? (Q.hair !== false) : false;
  if (hair) {
    g.sph(0.11 * S, { p: [0, hy + 0.012 * S, -0.008 * S], s: [0.98, 1.08, 1.04], r: [-0.55, 0, 0], th0: 0, thLen: PI * 0.5, reg: 'hair', ws: 10, hs: 6, jit: 0.004, cv: 0.3 });
    if (v === 2) {
      g.box(0.175 * S, 0.24 * S, 0.05 * S, { p: [0, hy - 0.08 * S, -0.09 * S], reg: 'hair', tp: [0.85, 1], jit: 0.006, cv: 0.3 });
      g.box(0.03 * S, 0.17 * S, 0.11 * S, { p: [0.098 * S, hy - 0.045 * S, -0.03 * S], reg: 'hair', mir: true, jit: 0.004 });
    }
  } else if (v === 0 && Q.hair !== false) { // patchy tufts
    g.sph(0.045 * S, { p: [0.05 * S, hy + 0.085 * S, -0.03 * S], reg: 'hair', ws: 6, hs: 5, jit: 0.006, mir: true });
    g.sph(0.06 * S, { p: [0, hy + 0.04 * S, -0.075 * S], reg: 'hair', ws: 6, hs: 5, jit: 0.006 });
  }
  Q.head?.(g, D, Q, v, S, hy);
  return g.buildParts();
}

function fingers(g, D, Q, side, y, claw) {
  const L = Q.limb, fl = claw ? 0.085 : 0.055;
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.02 * L;
    if (claw) { g.cone(0.011 * L, fl, { p: [x, y - fl * 0.5, 0.012], r: [-0.35, 0, 0], reg: 'bone', col: 0xd8d0b8, seg: 4 }); }
    else g.box(0.014 * L, fl, 0.015 * L, { p: [x, y - fl * 0.42, 0.012 * (i === 1 || i === 2 ? 1.4 : 1)], r: [-0.4 - i * 0.05, 0, 0], reg: 'skin', jit: 0.001 });
  }
  g.box(0.016 * L, 0.05, 0.016 * L, { p: [-side * 0.038 * L, y + 0.03, 0.016], r: [-0.5, 0, side * 0.5], reg: 'skin' });
}

function uarmGeo(D, Q, side) {
  const g = new GB(Q.seed + 20 + side), L = Q.limb;
  g.cyl(0.054 * L * (Q.uaTop ?? 1), 0.046 * L, D.uarm, { p: [0, -D.uarm / 2, 0], reg: 'uarm', seg: 8, jit: 0.002 });
  g.sph(0.049 * L, { p: [0, -D.uarm, 0], reg: 'farm', ws: 7, hs: 5 });
  Q.uarm?.(g, D, Q, side);
  return g.buildParts();
}

function farmGeo(D, Q, side, variant = 0) {
  const g = new GB(Q.seed + 30 + side + variant * 5), L = Q.limb, fa = D.farm;
  g.cyl(0.047 * L, 0.033 * L, fa, { p: [0, -fa / 2, 0], reg: 'farm', seg: 8, jit: 0.002 });
  if (Q.farm && Q.farm(g, D, Q, side, variant) === 'custom') return g.buildParts();
  if (variant === 1) { // chewed off: ragged flesh + jutting bone, no hand
    g.cyl(0.04 * L, 0.034 * L, 0.05, { p: [0, -fa - 0.005, 0], reg: 'gore', seg: 7, jit: 0.008 });
    g.cyl(0.012, 0.014, 0.16, { p: [0.005, -fa - 0.08, 0.005], r: [0.12, 0, 0.08], reg: 'bone', seg: 5, jit: 0.003 });
    g.sph(0.03 * L, { p: [0.0, -fa - 0.03, 0.02], reg: 'gore', ws: 6, hs: 5, jit: 0.01 });
    return g.buildParts();
  }
  g.box(0.072 * L, 0.085, 0.034 * L, { p: [0, -fa - 0.038, 0], reg: 'skin', jit: 0.002, tp: [1, 1], bt: [0.9, 0.9] });
  fingers(g, D, Q, side, -fa - 0.078, Q.claws);
  Q.hand?.(g, D, Q, side);
  return g.buildParts();
}

function thighGeo(D, Q, side) {
  const g = new GB(Q.seed + 40 + side), L = Q.limb * Q.legw;
  g.cyl(0.088 * L, 0.064 * L, D.thigh, { p: [0, -D.thigh / 2, 0], reg: 'thigh', seg: 8, jit: 0.002 });
  g.sph(0.066 * L, { p: [0, -D.thigh, 0], reg: 'thigh', ws: 7, hs: 5 });
  Q.thigh?.(g, D, Q, side);
  return g.buildParts();
}

function shinGeo(D, Q, side) {
  const g = new GB(Q.seed + 50 + side), L = Q.limb * Q.legw, sh = D.shin;
  g.cyl(0.064 * L, 0.042 * L, sh, { p: [0, -sh / 2, 0], reg: 'shin', seg: 8, jit: 0.002 });
  const fw = (Q.footW ?? 0.098) * Q.legw, fl = Q.footL ?? 0.26;
  g.box(fw, 0.07, fl, { p: [0, -sh - 0.004, fl * 0.27], reg: 'shoe', jit: 0.002 });
  g.sph(0.052 * Q.legw, { p: [0, -sh + 0.0, fl * 0.62], s: [1.05, 0.85, 1.0], reg: 'shoe', ws: 7, hs: 5, col: 0xe0e0e0 });
  g.box(fw * 1.04, 0.022, fl * 1.04, { p: [0, -sh - 0.04, fl * 0.27], reg: 'shoe', col: 0x22201e });
  g.cyl(0.05 * L, 0.05 * L, 0.03, { p: [0, -sh + 0.035, 0], reg: 'shin', seg: 8, col: 0xbdbdbd });
  Q.shin?.(g, D, Q, side);
  return g.buildParts();
}

function build(D, Q, extra = {}) {
  const geos = {
    pelvis: [pelvisGeo(D, Q)], torso: [torsoGeo(D, Q)],
    head: (Q.heads || [0, 1, 2]).map((v) => headGeo(D, Q, v)),
    uarmL: [uarmGeo(D, Q, 1)], uarmR: [uarmGeo(D, Q, -1)],
    farmL: (Q.farmVariants || [0]).map((v) => farmGeo(D, Q, 1, v)), farmR: [farmGeo(D, Q, -1)],
    thighL: [thighGeo(D, Q, 1)], thighR: [thighGeo(D, Q, -1)], shinL: [shinGeo(D, Q, 1)], shinR: [shinGeo(D, Q, -1)],
  };
  return { D, geos, ...extra };
}

const Qd = (o) => Object.assign({ seed: 1, limb: 1, tw: 1, td: 1, legw: 1, headSize: 1 }, o);

// ------------------------------------------------------------------------------------------------------ SHAMBLER
function shambler() {
  const D = dims({ thigh: 0.44, shin: 0.42, torso: 0.52, headY: 0.15 });
  const Q = Qd({
    seed: 11, farmVariants: [0, 1, 0], heads: [0, 1, 2, 3], limb: 1.12, tw: 1.06, td: 1.05,
    torso(g, D, Q) {
      // collar/neck wound + slumped shoulder blades
      g.sph(0.05, { p: [0.09, D.torso - 0.02, 0.07], reg: 'gore', ws: 6, hs: 5, jit: 0.012 });
      g.box(0.1, 0.02, 0.05, { p: [0, D.torso - 0.005, 0.085], r: [0.3, 0, 0], reg: 'torso', sub: [0.3, 0.85, 0.7, 1], col: 0xd0d0d0 });
      g.cyl(0.02, 0.012, 0.24, { p: [-0.1, 0.12, 0.09], r: [0.05, 0, 0.25], reg: 'gore', seg: 5, jit: 0.006 }); // dangling gut ribbon
    },
    head(g, D, Q, v, S, hy) { g.sph(0.04 * S, { p: [-0.062 * S, hy + 0.045 * S, 0.062 * S], reg: 'gore', ws: 6, hs: 5, jit: 0.012 }); }, // head wound
  });
  return build(D, Q, { muzzle: null });
}

// ------------------------------------------------------------------------------------------------------ RUNNER
function runner() {
  const D = dims({ thigh: 0.46, shin: 0.44, torso: 0.5, shX: 0.17, shY: 0.44, uarm: 0.34, farm: 0.32, headY: 0.15 });
  const Q = Qd({
    seed: 21, limb: 0.78, tw: 0.82, td: 0.85, legw: 0.9, claws: true, eyes: 0xff2410, jawOpen: 0.55, jawD: 0.09, heads: [0, 1, 2, 3], skullH: 1.16, footW: 0.085,
    torso(g, D) {
      // visible ribs (curved arcs wrapping the chest) + spine ridge
      for (let i = 0; i < 6; i++) {
        const y = 0.13 + i * 0.058, R = 0.128 - Math.abs(i - 2) * 0.006, arc = PI * (1.32 - i * 0.03);
        g.tor(R, 0.0075, { p: [0, y, 0.0], r: [PI / 2, -(PI / 2 - arc / 2), 0], ro: 'YXZ', s: [1.0, 1.0, 0.78], arc, seg: 14, rs: 4, reg: 'bone', col: 0xdedad0, jit: 0.001 });
      }
      g.box(0.03, 0.3, 0.02, { p: [0, 0.27, 0.098], reg: 'bone', col: 0xc8c4b8 });
      for (let i = 0; i < 6; i++) g.cone(0.014, 0.05, { p: [0, 0.08 + i * 0.075, -0.09], r: [-PI / 2 + 0.2, 0, 0], reg: 'bone', seg: 4 });
    },
    head(g, D, Q, v, S, hy) { g.cyl(0.02, 0.008, 0.08, { p: [0.0, hy - 0.135 * S, 0.11 * S], r: [0.2, 0, 0], reg: 'gore', seg: 5, jit: 0.006 }); }, // lolling tongue
    hand() {},
  });
  return build(D, Q, { muzzle: null });
}

// ------------------------------------------------------------------------------------------------------ TROOPER
function trooper() {
  const D = dims({ thigh: 0.46, shin: 0.44, torso: 0.54, shX: 0.22, shY: 0.47, headY: 0.16 });
  const RX = -0.105; // rifle axis (character's right side)
  const Q = Qd({
    seed: 31, limb: 1.05, tw: 1.06, td: 1.1, headSize: 1.0, eyes: 0, hair: false, heads: [0, 1], jawOpen: 0.25, beltCol: 0x1a1a18, noTeeth: false,
    pelvis(g, D) { // holster + pouches
      g.box(0.05, 0.14, 0.09, { p: [-0.19, -0.05, 0.02], reg: 'metal', col: 0x808080, jit: 0.002 });
      for (const s of [-1, 1]) g.box(0.05, 0.07, 0.035, { p: [s * 0.08, 0.13, 0.135], reg: 'extra2', col: 0xb0b0b0, jit: 0.002 });
    },
    torso(g, D) {
      const T = D.torso;
      // plate carrier: front & back plates, shoulder straps, cummerbund, pouches, collar
      g.box(0.3, 0.34, 0.055, { p: [0, T * 0.6, 0.11], reg: 'metal', col: 0xb8b8b8, tp: [1, 1], bt: [0.86, 1], jit: 0.002 });
      g.box(0.3, 0.34, 0.05, { p: [0, T * 0.6, -0.105], reg: 'metal', col: 0xa0a0a0, bt: [0.86, 1] });
      for (const s of [-1, 1]) {
        g.box(0.06, 0.05, 0.22, { p: [s * 0.15, T - 0.005, 0.0], reg: 'extra2', col: 0xc0c0c0 });
        g.box(0.06, 0.24, 0.05, { p: [s * 0.185, T * 0.42, 0], reg: 'extra2', col: 0xb0b0b0 });
        g.sph(0.085, { p: [s * 0.225, T - 0.04, 0], s: [1, 0.55, 1.1], reg: 'metal', col: 0xc0c0c0, ws: 8, hs: 5 });
      }
      for (let i = -1; i <= 1; i++) g.box(0.075, 0.09, 0.04, { p: [i * 0.085, 0.13, 0.135], reg: 'extra2', col: 0xd0d0d0, jit: 0.002 });
      g.box(0.05, 0.03, 0.02, { p: [0.09, T * 0.86, 0.14], reg: 'extra', col: 0xffffff }); // radio
      g.cyl(0.006, 0.006, 0.18, { p: [0.12, T * 0.86 + 0.09, 0.14], reg: 'metal', seg: 4 });
      // ---- the rifle (held across the chest; hands are posed onto it) ----
      const M = { reg: 'metal', col: 0x9a9a9a };
      g.box(0.05, 0.095, 0.2, { p: [RX, 0.375, -0.02], r: [0.1, 0, 0], ...M });          // stock
      g.box(0.056, 0.1, 0.34, { p: [RX, 0.36, 0.24], ...M, jit: 0.001 });               // receiver
      g.box(0.05, 0.062, 0.27, { p: [RX, 0.352, 0.52], reg: 'metal', col: 0x707070 });   // handguard
      g.cyl(0.011, 0.011, 0.26, { p: [RX, 0.362, 0.78], r: [PI / 2, 0, 0], reg: 'metal', col: 0x555555, seg: 6 }); // barrel
      g.cyl(0.02, 0.018, 0.06, { p: [RX, 0.362, 0.925], r: [PI / 2, 0, 0], reg: 'metal', col: 0x333333, seg: 6 }); // flash hider
      g.box(0.032, 0.16, 0.06, { p: [RX, 0.265, 0.27], r: [0.22, 0, 0], reg: 'metal', col: 0x666666 }); // magazine
      g.box(0.022, 0.03, 0.09, { p: [RX, 0.43, 0.28], ...M });                            // rear sight rail
      g.box(0.012, 0.045, 0.012, { p: [RX, 0.41, 0.72], reg: 'metal', col: 0x555555 });   // front post
      g.box(0.03, 0.085, 0.045, { p: [RX, 0.285, 0.14], r: [0.35, 0, 0], reg: 'metal', col: 0x555555 }); // pistol grip
      g.box(0.05, 0.02, 0.03, { p: [RX, 0.34, 0.06], reg: 'metal', col: 0x444444 });      // trigger guard
      g.box(0.008, 0.008, 0.05, { p: [RX, 0.43, 0.62], glow: true, col: 0xff5a1a });      // laser sight glint
    },
    head(g, D, Q, v, S, hy) {
      // helmet: shell, brim, ear guards, visor with glowing slit, NVG mount, chin strap
      g.sph(0.124 * S, { p: [0, hy + 0.012 * S, -0.006 * S], s: [1.0, 0.98, 1.06], r: [-0.18, 0, 0], th0: 0, thLen: PI * 0.62, reg: 'extra', ws: 12, hs: 8, jit: 0.002 });
      g.cyl(0.128 * S, 0.128 * S, 0.014, { p: [0, hy + 0.062 * S, 0.0], s: [1.0, 1, 1.12], reg: 'extra', seg: 14, col: 0xd0d0d0 });
      g.box(0.15 * S, 0.06 * S, 0.04 * S, { p: [0, hy + 0.05 * S, 0.118 * S], r: [-0.25, 0, 0], reg: 'extra', col: 0xe0e0e0, tp: [0.9, 1] }); // front brim
      g.box(0.14 * S, 0.04 * S, 0.028 * S, { p: [0, hy + 0.015 * S, 0.108 * S], reg: 'metal', col: 0x202428, jit: 0.001 }); // visor glass
      g.box(0.12 * S, 0.012 * S, 0.012 * S, { p: [0, hy + 0.017 * S, 0.123 * S], glow: true, col: Q.visor ?? 0xff5a10 });
      for (const sx of [-1, 1]) {
        g.box(0.03 * S, 0.075 * S, 0.09 * S, { p: [sx * 0.118 * S, hy - 0.0 * S, -0.005 * S], reg: 'extra', col: 0xc0c0c0 });
        g.box(0.006, 0.08 * S, 0.006, { p: [sx * 0.066 * S, hy - 0.09 * S, 0.06 * S], r: [0, 0, sx * 0.25], reg: 'shoe', col: 0x333333 });
      }
      g.box(0.04 * S, 0.03 * S, 0.05 * S, { p: [0, hy + 0.1 * S, 0.075 * S], reg: 'metal', col: 0x808080 });
    },
    thigh(g, D) { g.box(0.1, 0.085, 0.05, { p: [0, -D.thigh + 0.03, 0.07], reg: 'metal', col: 0xa8a8a8, jit: 0.002 }); }, // knee pad
    shin(g, D) { g.box(0.09, 0.15, 0.03, { p: [0, -0.1, 0.06], reg: 'metal', col: 0x909090 }); },
    uarm(g, D) { g.box(0.09, 0.09, 0.09, { p: [0, -0.1, 0], reg: 'metal', col: 0xa0a0a0, jit: 0.002 }); }, // elbow guard
  });
  return build(D, Q, { muzzle: [RX, 0.362, 0.96] });
}

// ------------------------------------------------------------------------------------------------------ SPITTER
function spitter() {
  const D = dims({ thigh: 0.44, shin: 0.42, torso: 0.55, shX: 0.19, shY: 0.48, uarm: 0.31, farm: 0.29, headY: 0.17 });
  const Q = Qd({
    seed: 41, limb: 0.92, tw: 0.95, headSize: 1.0, eyes: 0x8dff30, jawOpen: 0.62, jawW: 0.115, jawD: 0.11, skullD: 1.22, skullH: 1.02, heads: [0, 1], hair: false, claws: false, noTeeth: false,
    torso(g, D) {
      const T = D.torso;
      // glowing acid sac at the throat + veins climbing the neck; acid pustules on the shoulders/back
      g.sph(0.078, { p: [0, T - 0.01, 0.1], s: [1.05, 1.2, 0.85], glow: true, col: 0xd0ff90, col2: 0x2f9a14, ws: 10, hs: 8, jit: 0.004 });
      for (let i = 0; i < 4; i++) g.tor(0.07 + i * 0.006, 0.006, { p: [0, T - 0.05 - i * 0.03, 0.09], r: [PI / 2 - 0.3, 0, 0], s: [1, 1, 0.9], reg: 'gore', seg: 10, rs: 4, arc: PI * 1.2 });
      for (let i = 0; i < 9; i++) { const a = i * 2.4, y = 0.1 + (i * 0.137) % 0.4; g.sph(0.018 + (i % 3) * 0.008, { p: [Math.sin(a) * 0.17, y, -Math.abs(Math.cos(a)) * 0.1 + 0.02], glow: true, col: 0x9cff50, ws: 5, hs: 4 }); }
      for (let i = 0; i < 4; i++) g.cone(0.022, 0.09, { p: [(i - 1.5) * 0.08, T - 0.07 - (i % 2) * 0.05, -0.1], r: [-PI / 2 - 0.5, 0, 0], reg: 'bone', seg: 5, col: 0xc8d0a8 });
    },
    head(g, D, Q, v, S, hy) {
      g.sph(0.03 * S, { p: [0, hy - 0.075 * S, 0.075 * S], glow: true, col: 0x7cff40, ws: 6, hs: 5, s: [1.5, 0.8, 0.8] }); // glowing mouth
      for (const sx of [-1, 1]) g.cone(0.014 * S, 0.06 * S, { p: [sx * 0.045 * S, hy - 0.105 * S, 0.09 * S], r: [PI + 0.2, 0, sx * 0.1], reg: 'bone', seg: 4 }); // fangs
      g.cyl(0.012, 0.006, 0.12, { p: [0.03 * S, hy - 0.16 * S, 0.1 * S], reg: 'extra', col: 0xa0ff70, seg: 4 }); // drool
    },
    farm(g, D, Q, side) { g.sph(0.026, { p: [0, -0.1, 0.035], glow: true, col: 0x8cff40, ws: 5, hs: 4 }); },
  });
  return build(D, Q, { muzzle: null });
}

// ------------------------------------------------------------------------------------------------------ BRUTE
function brute() {
  const D = dims({ hipX: 0.15, waist: 0.08, thigh: 0.5, shin: 0.48, torso: 0.66, shX: 0.4, shY: 0.6, uarm: 0.5, farm: 0.48, headY: 0.2 });
  const Q = Qd({
    seed: 51, limb: 2.0, tw: 1.6, td: 1.4, legw: 0.9, headSize: 0.82, neckR: 2.1, eyes: 0xff2a10, jawOpen: 0.25, footW: 0.11, footL: 0.28, noTrap: true, torsoJit: 0.008, claws: false, heads: [0, 1], hair: false, uaTop: 1.15,
    pelvis(g, D) { // ragged loincloth strips + iron belt plates
      for (let i = -2; i <= 2; i++) g.box(0.09, 0.32 - Math.abs(i) * 0.03, 0.02, { p: [i * 0.085, -0.16, 0.16 - Math.abs(i) * 0.02], r: [0.12, 0, i * 0.05], reg: 'thigh', col: 0x9a9a9a, jit: 0.006 });
      g.box(0.3, 0.06, 0.02, { p: [0, 0.03, 0.18], reg: 'extra', col: 0xb0b0b0 });
    },
    torso(g, D) {
      const T = D.torso;
      g.sph(0.16, { p: [0.27, T - 0.1, -0.03], s: [1, 0.8, 1], reg: 'skin', col: 0xd0d0d0, ws: 9, hs: 6, jit: 0.01, mir: true }); // trapezius mounds
      g.sph(0.2, { p: [0, T - 0.09, -0.11], s: [1.3, 0.7, 0.9], reg: 'skin', col: 0xc0c0c0, ws: 9, hs: 6, jit: 0.012 });
      // bone spurs along the back and shoulders
      for (let i = 0; i < 7; i++) g.cone(0.035 - i * 0.002, 0.16 - i * 0.008, { p: [((i % 2) - 0.5) * 0.14, 0.08 + i * 0.1, -0.2], r: [-PI / 2 - 0.35, 0, ((i % 2) - 0.5) * 0.5], reg: 'bone', seg: 5, jit: 0.006 });
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) g.cone(0.03, 0.14 + i * 0.03, { p: [s * (0.42 + i * 0.04), T - 0.02 + i * 0.045, -0.02], r: [0, 0, -s * (0.9 - i * 0.2)], reg: 'bone', seg: 5, jit: 0.005 });
      g.box(0.08, 0.06, 0.03, { p: [0, T - 0.02, 0.24], reg: 'extra', col: 0xc0c0c0 });
    },
    head(g, D, Q, v, S, hy) {
      for (const sx of [-1, 1]) g.cone(0.022, 0.13, { p: [sx * 0.085, hy + 0.11, 0.0], r: [0.1, 0, -sx * 0.55], reg: 'bone', seg: 5 }); // horns
      for (const sx of [-1, 1]) g.sph(0.035, { p: [sx * 0.045, hy + 0.04, 0.085], s: [1.4, 0.7, 1], reg: 'skin', col: 0x9a9a9a, ws: 6, hs: 5, jit: 0.006 }); // heavy brow ridges
      g.box(0.14, 0.05, 0.07, { p: [0, hy - 0.115, 0.07], reg: 'skin', col: 0xb0b0b0, jit: 0.006 }); // massive jaw
      for (const sx of [-1, 1]) g.cone(0.014, 0.05, { p: [sx * 0.04, hy - 0.115, 0.075], r: [PI, 0, 0], reg: 'bone', seg: 4 }); // tusks
    },
    uarm(g, D, Q, side) { g.cone(0.034, 0.16, { p: [side * 0.07, -0.09, -0.02], r: [0, 0, -side * 1.15], reg: 'bone', seg: 5 }); },
    farm(g, D, Q, side) {
      // shackle + broken chain, bone blades along the forearm, huge fist
      g.tor(0.062, 0.016, { p: [0, -D.farm + 0.06, 0], r: [PI / 2, 0, 0], reg: 'extra', seg: 9 });
      for (let i = 0; i < 3; i++) g.tor(0.02, 0.006, { p: [side * 0.03, -D.farm + 0.02 - i * 0.03, 0.05], r: [(i % 2) * PI / 2, 0.3, 0], reg: 'extra', seg: 6 });
      for (let i = 0; i < 3; i++) g.cone(0.024, 0.12 - i * 0.02, { p: [side * 0.07, -0.12 - i * 0.12, -0.03], r: [0.3, 0, -side * 1.2], reg: 'bone', seg: 5 });
    },
    hand(g, D, Q, side) { g.box(0.14, 0.13, 0.09, { p: [0, -D.farm - 0.05, 0.005], reg: 'skin', col: 0xd0d0d0, jit: 0.006 }); },
    shin(g, D) { g.cyl(0.11, 0.09, 0.1, { p: [0, -0.06, 0], reg: 'extra', seg: 8 }); },
  });
  return build(D, Q, { muzzle: null });
}

// ------------------------------------------------------------------------------------------------------ EXPLODER
function exploder() {
  const D = dims({ hipX: 0.125, waist: 0.04, thigh: 0.4, shin: 0.38, torso: 0.5, shX: 0.29, shY: 0.42, uarm: 0.28, farm: 0.26, headY: 0.13 });
  const hh0 = (n) => { const q = Math.sin(n * 71.3 + 5.7) * 43758.5453; return q - Math.floor(q); };
  const Q = Qd({
    seed: 61, limb: 1.15, tw: 1.2, td: 1.15, legw: 1.25, headSize: 0.9, jawOpen: 0.3, heads: [0, 1], noTrap: true, farmVariants: [0], footW: 0.12, hair: true,
    torso(g, D) {
      // the belly: taut sac of skin veined with glowing pustules
      const R0 = 0.42, cy = 0.14, cz = 0.15;
      g.sph(R0, { p: [0, cy, cz], s: [1.06, 0.92, 0.98], reg: 'extra', ws: 18, hs: 14, jit: 0.028, cv: 0.4, col: 0xffffff, col2: 0xb0806c });
      for (let i = 0; i < 6; i++) g.sph(0.1 + (i % 3) * 0.03, { p: [(hh0(i) - 0.5) * 0.6, cy + (hh0(i + 9) - 0.5) * 0.4, cz + 0.28 + hh0(i + 3) * 0.1], reg: 'extra', ws: 8, hs: 6, jit: 0.01, col: 0xe0d0c0 }); // lumpy flesh
      const hh = (n) => { const q = Math.sin(n * 91.7 + 13.1) * 43758.5453; return q - Math.floor(q); };
      for (let i = 0; i < 30; i++) { // blisters scattered over the front
        const a = hh(i) * 6.283, th = Math.acos(1 - hh(i + 50) * 0.92) * 0.95;
        const x = Math.sin(th) * Math.cos(a), yy = Math.sin(th) * Math.sin(a), z = Math.cos(th);
        const r = 0.02 + hh(i + 100) * 0.028 + (i % 7 === 0 ? 0.03 : 0);
        const px = x * R0 * 1.06, py = cy + yy * R0 * 0.92, pz = cz + z * R0 * 0.98;
        g.sph(r * 1.12, { p: [px * 0.99, cy + (py - cy) * 0.99, cz + (pz - cz) * 0.99], reg: 'gore', ws: 6, hs: 5, jit: 0.003 });
        g.sph(r, { p: [px * 1.012, cy + (py - cy) * 1.012, cz + (pz - cz) * 1.012], glow: true, col: i % 3 ? 0xffa02a : 0xffe04a, col2: 0xff5a10, ws: 6, hs: 5 });
      }
      { // glowing cracks: chains of thin glowing bars following the belly surface
        const P = (th, a) => [Math.sin(th) * Math.cos(a) * R0 * 1.07, cy + Math.sin(th) * Math.sin(a) * R0 * 0.94, cz + Math.cos(th) * R0 * 1.0];
        for (let k = 0; k < 8; k++) {
          let th = 0.12 + hh(k + 200) * 0.2, a = k * 0.8 + hh(k + 300) * 0.4, prev = P(th, a);
          for (let st = 0; st < 8; st++) {
            th += 0.1 + hh(k * 10 + st) * 0.05; a += (hh(k * 17 + st + 40) - 0.5) * 0.5;
            const cur = P(th, a), dx = cur[0] - prev[0], dy = cur[1] - prev[1], dz = cur[2] - prev[2], len = Math.hypot(dx, dy, dz);
            _q.setFromUnitVectors(_ax, _v.set(dx / len, dy / len, dz / len)); _e.setFromQuaternion(_q);
            g.box(len * 1.15, 0.013, 0.013, { p: [(cur[0] + prev[0]) / 2, (cur[1] + prev[1]) / 2, (cur[2] + prev[2]) / 2], r: [_e.x, _e.y, _e.z], glow: true, col: 0xff7a14, col2: 0xffb030 });
            prev = cur;
          }
        }
      }
      g.sph(0.08, { p: [0.0, 0.4, 0.06], s: [1.2, 0.7, 1], reg: 'skin', col: 0xd8d8d8, ws: 8, hs: 6, jit: 0.01 }); // sagging fat roll
    },
    head(g, D, Q, v, S, hy) { g.sph(0.03, { p: [0.06 * S, hy + 0.06 * S, 0.06 * S], glow: true, col: 0xffa020, ws: 6, hs: 5 }); g.sph(0.045, { p: [0.06 * S, hy + 0.06 * S, 0.06 * S], reg: 'gore', ws: 6, hs: 5, jit: 0.006 }); },
    thigh(g, D) { g.sph(0.06, { p: [0.06, -0.15, 0.06], glow: true, col: 0xff8a20, ws: 5, hs: 4 }); },
  });
  return build(D, Q, { muzzle: null });
}

// ------------------------------------------------------------------------------------------------------ TYRANT
function tyrant() {
  const D = dims({ hipX: 0.13, waist: 0.06, thigh: 0.5, shin: 0.48, torso: 0.62, shX: 0.34, shY: 0.56, uarm: 0.42, farm: 0.4, headY: 0.17 });
  const Q = Qd({
    seed: 71, limb: 1.75, tw: 1.5, td: 1.32, legw: 1.0, headSize: 0.95, neckR: 1.6, eyes: 0xff1a10, jawOpen: 0.4, heads: [0], hair: false, footW: 0.11, footL: 0.3, claws: true, uaTop: 1.2, noTrap: false,
    pelvis(g, D) { // conductor's tail-coat skirts + brass belt
      for (const s of [-1, 1]) {
        g.box(0.2, 0.62, 0.035, { p: [s * 0.1, -0.3, -0.19], r: [0.06, 0, s * 0.1], reg: 'torso', sub: [0.1, 0.05, 0.4, 0.9], col: 0xd0d0d0, tp: [1, 1], bt: [1.15, 1], jit: 0.008 });
        g.box(0.035, 0.5, 0.26, { p: [s * 0.225, -0.24, -0.06], r: [0, 0, -s * 0.08], reg: 'torso', sub: [0.1, 0.05, 0.4, 0.9], col: 0xc0c0c0, bt: [1, 1.2], jit: 0.008 });
      }
      g.box(0.09, 0.08, 0.03, { p: [0, 0.135, 0.19], reg: 'extra', col: 0xffffff });
    },
    torso(g, D) {
      const T = D.torso;
      // riveted chest armour plates (rail steel), pauldrons with signal-lamp spikes, back pipes
      g.box(0.34, 0.3, 0.06, { p: [0, T * 0.55, 0.15], reg: 'extra2', col: 0xd0d0d0, bt: [0.8, 1], jit: 0.004 });
      g.box(0.36, 0.06, 0.09, { p: [0, T * 0.3, 0.16], reg: 'extra2', col: 0xb0b0b0 });
      g.sph(0.026, { p: [0, T * 0.62, 0.185], glow: true, col: 0xff2a10, ws: 6, hs: 5 }); // red signal lamp on the chest
      for (const s of [-1, 1]) {
        g.sph(0.2, { p: [s * 0.36, T - 0.04, 0], s: [1, 0.72, 1.05], reg: 'extra2', th0: 0, thLen: PI * 0.6, ws: 10, hs: 6, col: 0xc8c8c8, jit: 0.01 });
        for (let i = 0; i < 3; i++) g.cone(0.028, 0.16 - i * 0.02, { p: [s * (0.36 + (i - 1) * 0.07), T + 0.09 - Math.abs(i - 1) * 0.02, 0], r: [0, 0, -s * (i - 1) * 0.5], reg: 'bone', seg: 5, col: 0xc8c0a8 });
        g.cyl(0.03, 0.03, 0.5, { p: [s * 0.1, 0.3, -0.24], reg: 'extra2', seg: 7, col: 0xb0b0b0 });
        g.sph(0.022, { p: [s * 0.1, 0.56, -0.24], glow: true, col: 0xff4020, ws: 5, hs: 4 });
      }
      g.box(0.22, 0.06, 0.05, { p: [0, T + 0.0, -0.14], reg: 'extra2', col: 0xb0b0b0 });
      for (let i = 0; i < 5; i++) g.cone(0.03, 0.2 - Math.abs(i - 2) * 0.03, { p: [(i - 2) * 0.09, T - 0.02 - Math.abs(i - 2) * 0.1, -0.22], r: [-PI / 2 - 0.6, 0, (i - 2) * 0.12], reg: 'bone', seg: 5, col: 0xb8b0a0 });
      g.box(0.14, 0.1, 0.02, { p: [-0.13, T * 0.38, 0.185], reg: 'extra', col: 0xffffff }); // brass ID plate
    },
    head(g, D, Q, v, S, hy) {
      // conductor's peaked cap + brass badge, gaping skull face
      g.cyl(0.128 * S, 0.132 * S, 0.075, { p: [0, hy + 0.1 * S, -0.005], s: [1, 1, 1.05], reg: 'extra2', col: 0xd0d0e8, seg: 12 });
      g.cyl(0.14 * S, 0.14 * S, 0.02, { p: [0, hy + 0.062 * S, 0.0], s: [1, 1, 1.08], reg: 'extra2', col: 0xffffff, seg: 12 });
      g.box(0.15 * S, 0.014, 0.08 * S, { p: [0, hy + 0.058 * S, 0.14 * S], r: [0.25, 0, 0], reg: 'shoe', col: 0x1a1a1a }); // peak
      g.box(0.045, 0.05, 0.015, { p: [0, hy + 0.1 * S, 0.135 * S], reg: 'extra', col: 0xffffff });
      g.box(0.14 * S, 0.02, 0.012, { p: [0, hy + 0.078 * S, 0.128 * S], reg: 'extra', col: 0xd0c070 });
      for (const sx of [-1, 1]) { g.cone(0.02, 0.1, { p: [sx * 0.11 * S, hy - 0.02, 0.0], r: [0, 0, -sx * 1.1], reg: 'bone', seg: 4 }); g.cone(0.012, 0.06, { p: [sx * 0.04 * S, hy - 0.125 * S, 0.09 * S], r: [PI, 0, 0], reg: 'bone', seg: 4 }); }
    },
    uarm(g, D, Q, side) { if (side < 0) { g.cone(0.045, 0.22, { p: [-0.09, -0.12, -0.03], r: [0.2, 0, 1.2], reg: 'bone', seg: 5 }); } },
    farm(g, D, Q, side, variant) {
      const fa = D.farm;
      if (side > 0) { // left arm: holds a hanging signal lantern (hooked chain)
        g.tor(0.055, 0.014, { p: [0, -fa + 0.05, 0], r: [PI / 2, 0, 0], reg: 'extra2', seg: 8 });
        g.box(0.08, 0.09, 0.034 * Q.limb, { p: [0, -fa - 0.038, 0], reg: 'skin', col: 0xd0d0d0, jit: 0.002 });
        for (let i = 0; i < 3; i++) g.tor(0.016, 0.004, { p: [0, -fa - 0.1 - i * 0.045, 0.0], r: [(i % 2) * PI / 2, 0.4, 0], reg: 'extra2', seg: 5, rs: 4 });
        const ly = -fa - 0.34;
        g.cyl(0.075, 0.075, 0.18, { p: [0, ly, 0.0], glow: true, col: 0xffb040, col2: 0xff7a10, seg: 10 });
        g.cyl(0.02, 0.02, 0.2, { p: [0, ly, 0.0], glow: true, col: 0xffffe0, seg: 6 });
        for (let i = 0; i < 6; i++) { const a = i / 6 * PI * 2; g.box(0.012, 0.2, 0.012, { p: [Math.cos(a) * 0.08, ly, Math.sin(a) * 0.08], reg: 'extra2', col: 0x8a8a8a }); }
        g.cyl(0.085, 0.085, 0.02, { p: [0, ly - 0.105, 0], reg: 'extra2', seg: 10 }); g.cone(0.09, 0.07, { p: [0, ly + 0.14, 0], reg: 'extra2', seg: 10 });
        g.tor(0.028, 0.006, { p: [0, ly + 0.2, 0], reg: 'extra2', seg: 6 });
        return 'custom';
      }
      // right arm: mutated forearm - a huge bone-bladed claw
      g.sph(0.09, { p: [0, -fa * 0.4, 0.0], s: [1.1, 1.5, 1.1], reg: 'gore', ws: 8, hs: 6, jit: 0.015 }); // swollen muscle
      for (let i = 0; i < 4; i++) g.cone(0.03 - i * 0.003, 0.32 - i * 0.03, { p: [(i - 1.5) * 0.045, -fa - 0.16, 0.03], r: [-0.55 + (i % 2) * 0.12, 0, (i - 1.5) * 0.14], reg: 'bone', seg: 5, jit: 0.004 });
      g.box(0.16, 0.12, 0.09, { p: [0, -fa - 0.04, 0.0], reg: 'skin', col: 0xb0b0b0, jit: 0.006 });
      g.cone(0.05, 0.44, { p: [0.09, -0.16, -0.02], r: [0.1, 0, -0.35], reg: 'bone', seg: 5, jit: 0.005 }); // forearm blade
      for (let i = 0; i < 3; i++) g.cone(0.028, 0.16, { p: [-0.07, -0.08 - i * 0.09, -0.02], r: [0.2, 0, 1.0], reg: 'bone', seg: 4 });
      return 'custom';
    },
    shin(g, D) { g.box(0.12, 0.12, 0.06, { p: [0, -0.08, 0.075], reg: 'extra2', col: 0xb0b0b0, jit: 0.004 }); g.box(0.14, 0.09, 0.14, { p: [0, -D.shin + 0.12, 0.09], reg: 'extra2', col: 0x909090 }); },
    thigh(g, D) { g.sph(0.09, { p: [0, -D.thigh + 0.02, 0.06], s: [1, 1, 0.6], reg: 'extra2', col: 0xb8b8b8, ws: 8, hs: 5 }); },
  });
  return build(D, Q, { muzzle: null });
}

export const BUILDERS = { shambler, runner, trooper, spitter, brute, exploder, tyrant };
