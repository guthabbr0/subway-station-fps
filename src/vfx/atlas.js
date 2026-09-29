// Procedural sprite atlas for vfx: one 1024x1024 RGBA DataTexture holding 16 tiles (4x4, 256px each).
// Tiles are painted once at init. RGB carries shading/heat, A carries the silhouette. Every tile fades to 0 alpha near its border
// so mip-mapping never bleeds neighbours into each other.
import * as THREE from 'three';
import { mulberry32, TEX_FULL } from '../texutil.js';

export const FRAME = {
  GLOW: 0, HOT: 1, SMOKE1: 2, SMOKE2: 3, FIRE1: 4, FIRE2: 5, STAR: 6, BURST: 7,
  RING: 8, STREAK: 9, SPLAT1: 10, HOLE: 11, SCORCH: 12, SPLAT2: 13, CRACK: 14, DISK: 15,
};
export const ATLAS_COLS = 4;
const TS = TEX_FULL ? 256 : 128, SIZE = ATLAS_COLS * TS, TAU = Math.PI * 2; // 4x4 tiles of 128 px: the sprites are soft gradients / noise; 4x less to generate and sample
const hyp = (a, b) => Math.sqrt(a * a + b * b);
const c01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sm = (a, b, x) => { const t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function lattice(seed) {
  const r = mulberry32(seed), L = new Float32Array(65536);
  for (let i = 0; i < L.length; i++) L[i] = r();
  const at = (x, y) => L[((y & 255) << 8) | (x & 255)];
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, oct = 4) => {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * n2(x * f + i * 17.3, y * f + i * 9.1); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  };
  return { n2, fbm };
}

// ---- tile painters: fn(x, y, u, v, out) with x,y in [-1,1], u,v in [0,1]; out = [r,g,b,a] in 0..1 -------------------
const glow = (x, y, u, v, o) => { const r = hyp(x, y); o[0] = o[1] = o[2] = 1; o[3] = Math.min(1, Math.pow(Math.max(0, 1 - r), 2.2) + 0.5 * Math.exp(-r * r * 30)); };
const hot = (x, y, u, v, o) => { const r = hyp(x, y); o[0] = o[1] = o[2] = 1; o[3] = Math.min(1, 1.2 * Math.exp(-r * r * 55) + 0.6 * Math.pow(Math.max(0, 1 - r), 3)); };
const disk = (x, y, u, v, o) => { const r = hyp(x, y); o[0] = o[1] = o[2] = 1; o[3] = sm(1.0, 0.7, r); };

function fireTile(seed) {
  const N = lattice(seed);
  return (x, y, u, v, o) => {
    const r = hyp(x, y), n = N.fbm(u * 3.2, v * 3.2, 4), n2 = N.fbm(u * 6.1 + 9, v * 6.1 + 3, 3);
    const rw = r + (n - 0.5) * 0.75;
    const a = sm(0.95, 0.08, rw) * (0.7 + 0.5 * n2);
    const heat = c01(1.25 - rw * 1.35 + (n2 - 0.5) * 0.5), c = 0.3 + 0.7 * heat;
    o[0] = o[1] = o[2] = c; o[3] = Math.min(1, a * 1.15);
  };
}
function smokeTile(seed) {
  const N = lattice(seed);
  return (x, y, u, v, o) => {
    const r = hyp(x, y), n = N.fbm(u * 2.6, v * 2.6, 4), n2 = N.fbm(u * 5.5 + 4, v * 5.5 + 7, 3);
    const rw = r + (n - 0.5) * 0.7;
    const a = sm(0.95, 0.12, rw) * (0.55 + 0.7 * n2);
    const light = c01(0.55 + (-x * 0.45 + y * 0.55) * 0.5 + (n2 - 0.5) * 0.6);
    o[0] = o[1] = o[2] = 0.55 + 0.45 * light; o[3] = c01(a);
  };
}
function starTile(seed, lines, thin) {
  const R = mulberry32(seed), L = [];
  const a0 = R() * 3;
  for (let i = 0; i < lines; i++) L.push({ a: a0 + (i / lines) * Math.PI + (R() - 0.5) * (thin ? 0.25 : 0.5), len: (thin ? 0.55 : 0.7) + R() * 0.32, w: (thin ? 0.02 : 0.05) * (0.8 + R() * 0.5) });
  for (const l of L) { l.c = Math.cos(l.a); l.s = Math.sin(l.a); }
  return (x, y, u, v, o) => {
    const r2 = x * x + y * y;
    let a = (thin ? 0.9 : 1.0) * Math.exp(-r2 * (thin ? 60 : 22)) + (thin ? 0.15 : 0.4) * Math.exp(-r2 * 5);
    for (const l of L) {
      const t = Math.abs(x * l.c + y * l.s), d = Math.abs(-x * l.s + y * l.c), along = c01(1 - t / l.len), w = l.w * (0.3 + along * 0.9);
      a += Math.exp(-(d * d) / (w * w)) * Math.pow(along, 1.4);
    }
    o[0] = o[1] = o[2] = 1; o[3] = Math.min(1, a);
  };
}
const ring = (x, y, u, v, o) => {
  const r = hyp(x, y);
  const inner = sm(0.3, 0.82, r), crest = r < 0.82 ? Math.pow(inner, 4) : Math.exp(-Math.pow((r - 0.82) / 0.045, 2));
  o[0] = o[1] = o[2] = 0.6 + 0.4 * crest; o[3] = c01(crest * (r < 0.82 ? 0.9 : 1));
};
// streak: u runs tail(0) -> head(~0.8); v is across. The head peak sits at u=0.8 so shaders can anchor it at the particle position.
const streak = (x, y, u, v, o) => {
  const along = u < 0.8 ? Math.pow(sm(0.02, 0.8, u), 1.5) : Math.exp(-Math.pow((u - 0.8) / 0.06, 2));
  const d = y, core = Math.exp(-Math.pow(d / 0.28, 2)), halo = 0.3 * Math.exp(-Math.pow(d / 0.75, 2));
  o[0] = o[1] = o[2] = 0.65 + 0.35 * Math.pow(along, 3); o[3] = Math.min(1, along * (core * 0.95 + halo));
};
function splatTile(seed, stretch, nDots) {
  const N = lattice(seed), R = mulberry32(seed * 7 + 1), dots = [];
  for (let i = 0; i < nDots; i++) { const a = R() * TAU, rad = 0.42 + R() * 0.32; dots.push([Math.cos(a) * rad, Math.sin(a) * rad, 0.02 + R() * 0.05]); }
  return (x, y, u, v, o) => {
    const xs = x * stretch, r = hyp(xs, y), th = Math.atan2(y, xs), cs = Math.cos(th), sn = Math.sin(th);
    const e1 = 0.24 + 0.2 * N.n2(cs * 1.6 + 5, sn * 1.6 + 5), spike = Math.pow(N.n2(cs * 3.6 + 11, sn * 3.6 + 3), 2.4) * 0.34;
    const wob = (N.fbm(u * 6 + 3, v * 6 + 8, 3) - 0.5) * 0.18, ext = e1 + spike + wob;
    let a = sm(ext, ext - 0.1, r);
    for (let i = 0; i < dots.length; i++) { const dd = dots[i], d = hyp(xs - dd[0], y - dd[1]); a = Math.max(a, sm(dd[2], dd[2] * 0.5, d)); }
    a *= sm(0.95, 0.72, Math.max(Math.abs(x), Math.abs(y), r));
    const thick = 1 - sm(0, ext, r), c = 0.6 + 0.4 * (1 - thick * 0.75);
    o[0] = o[1] = o[2] = c; o[3] = c01(a);
  };
}
function holeTile(seed) {
  const N = lattice(seed);
  return (x, y, u, v, o) => {
    const r = hyp(x, y), th = Math.atan2(y, x), cs = Math.cos(th), sn = Math.sin(th);
    const n = N.n2(cs * 2.2 + 3, sn * 2.2 + 3), n3 = N.fbm(u * 8, v * 8, 3);
    const hr = 0.11 + 0.03 * n, hole = sm(hr + 0.03, hr - 0.01, r);
    const haloR = 0.28 + 0.24 * Math.pow(N.n2(cs * 3.3 + 8, sn * 3.3 + 2), 1.5), halo = sm(haloR, haloR * 0.4, r) * (0.55 + 0.4 * n3);
    const cracks = Math.pow(N.n2(cs * 7 + 20, sn * 7 + 20), 3) * sm(0.85, 0.18, r) * 0.7;
    o[0] = o[1] = o[2] = 0.85 - 0.83 * hole; o[3] = c01(Math.max(hole, halo * 0.85, cracks));
  };
}
function scorchTile(seed) {
  const N = lattice(seed);
  return (x, y, u, v, o) => {
    const r = hyp(x, y), th = Math.atan2(y, x), cs = Math.cos(th), sn = Math.sin(th);
    const n = N.fbm(u * 3.4, v * 3.4, 5), rad = 0.55 + 0.4 * N.n2(cs * 2.6 + 30, sn * 2.6 + 30);
    const streaks = 0.75 + 0.5 * N.n2(cs * 9 + 40, sn * 9 + 40);
    const a = sm(rad, 0.1, r + (n - 0.5) * 0.45) * 0.92 * c01(streaks);
    o[0] = o[1] = o[2] = 0.06 + 0.3 * sm(0.2, 0.9, r); o[3] = c01(a);
  };
}
function crackTile(seed) {
  const R = mulberry32(seed), N = lattice(seed), L = [];
  for (let i = 0; i < 9; i++) L.push({ a: (i / 9) * TAU + (R() - 0.5) * 0.5, len: 0.5 + R() * 0.45 });
  for (const l of L) { l.c = Math.cos(l.a); l.s = Math.sin(l.a); }
  return (x, y, u, v, o) => {
    const r = hyp(x, y), th = Math.atan2(y, x);
    let a = 0.9 * Math.exp(-r * r * 90);
    for (const l of L) {
      const t = x * l.c + y * l.s; if (t < 0 || t > l.len) continue;
      const d = Math.abs(-x * l.s + y * l.c), w = 0.012 + 0.012 * (1 - t / l.len);
      a = Math.max(a, Math.exp(-(d * d) / (w * w)) * Math.pow(1 - t / l.len, 0.6));
    }
    const arc = Math.exp(-Math.pow((r - 0.28) / 0.012, 2)) + 0.8 * Math.exp(-Math.pow((r - 0.5) / 0.012, 2));
    a = Math.max(a, arc * (N.n2(Math.cos(th) * 3 + 9, Math.sin(th) * 3 + 9) > 0.5 ? 0.55 : 0));
    o[0] = o[1] = o[2] = 0.95; o[3] = c01(a * sm(0.98, 0.7, r));
  };
}

const TILES = [
  glow, hot, smokeTile(21), smokeTile(87), fireTile(5), fireTile(41), starTile(11, 3, false), starTile(33, 4, true),
  ring, streak, splatTile(3, 1.0, 10), holeTile(9), scorchTile(17), splatTile(29, 1.35, 8), crackTile(4), disk,
];

export function createAtlas(renderer) {
  const data = new Uint8Array(SIZE * SIZE * 4), o = [0, 0, 0, 0];
  for (let idx = 0; idx < TILES.length; idx++) {
    const fn = TILES[idx], radial = idx !== FRAME.STREAK, cx = (idx % ATLAS_COLS) * TS, cy = Math.floor(idx / ATLAS_COLS) * TS;
    for (let j = 0; j < TS; j++) {
      const v = (j + 0.5) / TS, y = (v - 0.5) * 2;
      for (let i = 0; i < TS; i++) {
        const u = (i + 0.5) / TS, x = (u - 0.5) * 2;
        if (radial && x * x + y * y > 1.0) { const q = ((cy + j) * SIZE + cx + i) * 4; data[q] = data[q + 1] = data[q + 2] = 200; data[q + 3] = 0; continue; } // outside the unit disc: transparent
        fn(x, y, u, v, o);
        const m = 1 - sm(0.84, 0.985, Math.max(Math.abs(x), Math.abs(y))), p = ((cy + j) * SIZE + cx + i) * 4;
        data[p] = c01(o[0]) * 255; data[p + 1] = c01(o[1]) * 255; data[p + 2] = c01(o[2]) * 255; data[p + 3] = c01(o[3] * m) * 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.anisotropy = Math.min(4, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  tex.needsUpdate = true;
  return tex;
}
