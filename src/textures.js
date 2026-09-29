// Procedural surface textures + materials for the subway station. Everything is canvas-generated once at init.
// Each surface set = albedo (sRGB) + tangent normal map (from a height field) + "rm" map (G = roughness, B = metalness).
import * as THREE from 'three';
import { mulberry32, TEX_FULL } from './texutil.js';

if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r = 0) {
    const rr = Math.min(Array.isArray(r) ? r[0] : r, w / 2, h / 2); this.moveTo(x + rr, y); this.arcTo(x + w, y, x + w, y + h, rr); this.arcTo(x + w, y + h, x, y + h, rr); this.arcTo(x, y + h, x, y, rr); this.arcTo(x, y, x + w, y, rr); this.closePath();
  };
}
export const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d', { willReadFrequently: true }); return c; };
export const rgb = (r, g, b, a) => (a === undefined ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`);
export const hash2 = (a, b, s = 0) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(s | 0, 2246822519)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------------------------- fields
// Tileable fractal value noise in [0,1].
export function noiseField(w, h, seed, scale = 8, oct = 4, pers = 0.5) {
  const rnd = mulberry32(seed), out = new Float32Array(w * h); let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const n = Math.max(1, Math.round(scale * (1 << o)));
    const lat = new Float32Array(n * n); for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const xi0 = new Int32Array(w), xi1 = new Int32Array(w), xw = new Float32Array(w);
    for (let x = 0; x < w; x++) { const f = x / w * n, i = Math.floor(f), t = f - i; xi0[x] = i % n; xi1[x] = (i + 1) % n; xw[x] = t * t * (3 - 2 * t); }
    for (let y = 0; y < h; y++) {
      const f = y / h * n, j = Math.floor(f), t = f - j, wy = t * t * (3 - 2 * t), r0 = (j % n) * n, r1 = ((j + 1) % n) * n, row = y * w;
      for (let x = 0; x < w; x++) {
        const a = lat[r0 + xi0[x]], b = lat[r0 + xi1[x]], c = lat[r1 + xi0[x]], d = lat[r1 + xi1[x]], wx = xw[x];
        out[row + x] += amp * ((a + (b - a) * wx) * (1 - wy) + (c + (d - c) * wx) * wy);
      }
    }
    tot += amp; amp *= pers;
  }
  const inv = 1 / tot; for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}
// bilinear-free nearest sampler for a smaller field
const samp = (f, fw, W, x, y) => f[((y * fw / W) | 0) * fw + ((x * fw / W) | 0)];
// nearest upsample of a square field to W x W so hot loops can index directly
function up(f, fw, W) { if (fw === W) return f; const out = new Float32Array(W * W), ix = new Int32Array(W); for (let x = 0; x < W; x++) ix[x] = (x * fw / W) | 0; for (let y = 0; y < W; y++) { const ro = ((y * fw / W) | 0) * fw, o = y * W; for (let x = 0; x < W; x++) out[o + x] = f[ro + ix[x]]; } return out; }

export function blur(src, w, h, r, passes = 1) {
  let a = new Float32Array(src), b = new Float32Array(w * h); const inv = 1 / (2 * r + 1), cs = new Float32Array(w);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) { // horizontal, wrap-around, running sum
      const row = y * w; let s = 0;
      for (let k = -r; k <= r; k++) s += a[row + (k < 0 ? k + w : k >= w ? k - w : k)];
      for (let x = 0; x < w; x++) { b[row + x] = s * inv; let xi = x + r + 1; if (xi >= w) xi -= w; let xo = x - r; if (xo < 0) xo += w; s += a[row + xi] - a[row + xo]; }
    }
    cs.fill(0);
    for (let k = -r; k <= r; k++) { const ro = (k < 0 ? k + h : k >= h ? k - h : k) * w; for (let x = 0; x < w; x++) cs[x] += b[ro + x]; }
    for (let y = 0; y < h; y++) { // vertical, row-major running column sums
      const row = y * w; let yi = y + r + 1; if (yi >= h) yi -= h; let yo = y - r; if (yo < 0) yo += h; const ri = yi * w, rOut = yo * w;
      for (let x = 0; x < w; x++) { a[row + x] = cs[x] * inv; cs[x] += b[ri + x] - b[rOut + x]; }
    }
  }
  return a;
}

export function normalCanvas(hgt, w, h, strength = 2) {
  const c = cv(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), o = img.data;
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w, yp = ((y + 1) % h) * w, row = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const dx = (hgt[row + xp] - hgt[row + xm]) * strength, dy = (hgt[yp + x] - hgt[ym + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (row + x) * 4;
      o[i] = (-dx * inv * 0.5 + 0.5) * 255; o[i + 1] = (dy * inv * 0.5 + 0.5) * 255; o[i + 2] = (inv * 0.5 + 0.5) * 255; o[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0); return c;
}
function rmCanvas(rough, metal, w, h) {
  const c = cv(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), o = img.data;
  for (let i = 0, n = w * h; i < n; i++) { const j = i * 4; o[j] = 255; o[j + 1] = clamp01(rough[i]) * 255; o[j + 2] = metal ? clamp01(metal[i]) * 255 : 0; o[j + 3] = 255; }
  ctx.putImageData(img, 0, 0); return c;
}
export function mkTex(canvas, { srgb = false, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso; return t;
}
// Normal and roughness/metalness maps carry lower-frequency detail than the albedo (grime, seams and print stay full resolution), so for sets of 512 px and up they are built at
// half resolution: the same look at a third of the memory (a 1024 set drops from 16 MB to ~8 MB resident with mips), a quarter of the generation work and less texture bandwidth.
// ?texfull=1 restores the full-size maps for A/B comparisons.
const SHRINK = !TEX_FULL;
export function halve(f, w, h) {
  const w2 = w >> 1, h2 = h >> 1, o = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) { const r0 = 2 * y * w, r1 = r0 + w, ro = y * w2; for (let x = 0; x < w2; x++) { const i = r0 + 2 * x, j = r1 + 2 * x; o[ro + x] = (f[i] + f[i + 1] + f[j] + f[j + 1]) * 0.25; } }
  return o;
}
function makeSet(albedo, hgt, rough, metal, w, h, ns = 2) {
  const map = mkTex(albedo, { srgb: true });
  if (SHRINK && w >= 512 && h >= 512) { hgt = halve(hgt, w, h); rough = halve(rough, w, h); if (metal) metal = halve(metal, w, h); w >>= 1; h >>= 1; }
  return { map, normalMap: mkTex(normalCanvas(hgt, w, h, ns)), rmMap: mkTex(rmCanvas(rough, metal, w, h)) };
}
// per-pixel colour pass helper: fn(i, x, y, d /*Uint8ClampedArray*/, di /*pixel byte index*/) mutates.
function pixelPass(ctx, w, h, fn) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) fn(i, x, y, d, i * 4);
  ctx.putImageData(img, 0, 0);
}
function fillArr(arr, W, x, y, w, h, v) { for (let j = Math.max(0, y | 0); j < Math.min(W, (y + h) | 0); j++) for (let i = Math.max(0, x | 0); i < Math.min(W, (x + w) | 0); i++) arr[j * W + i] = v; }

// ---------------------------------------------------------------------------------------------- tiles
function tileSets() {
  const W = 1024, TW = 128, TH = 64, G = 3, rnd = mulberry32(7);
  const tiles = [];
  for (let r = 0; r < 16; r++) { const off = (r & 1) ? TW / 2 : 0; for (let c = -1; c < 9; c++) tiles.push({ x: c * TW + off + G / 2, y: r * TH + G / 2, w: TW - G, h: TH - G, k: hash2(((c % 8) + 8) % 8, r, 5), k2: hash2(((c % 8) + 8) % 8, r, 11) }); }
  let hgt = new Float32Array(W * W), rough = new Float32Array(W * W).fill(0.92);
  for (const t of tiles) { fillArr(hgt, W, t.x, t.y, t.w, t.h, 1); fillArr(rough, W, t.x, t.y, t.w, t.h, 0.13 + t.k * 0.08); }
  const mask = new Uint8Array(W * W); for (let i = 0; i < mask.length; i++) mask[i] = hgt[i] > 0.5 ? 1 : 0;
  hgt = blur(hgt, W, W, 2, 2);
  const cracks = [];
  for (let n = 0; n < 16; n++) {
    const t = tiles[(rnd() * tiles.length) | 0]; let x = t.x + rnd() * t.w, y = t.y + (rnd() < 0.5 ? 0 : t.h); const pts = [[x, y]]; const dir = y > t.y + 1 ? -1 : 1;
    for (let s = 0; s < 5; s++) { x += (rnd() - 0.5) * 30; y += dir * (6 + rnd() * 12); pts.push([x, y]); }
    cracks.push(pts);
  }
  const crackC = cv(W, W), cctx = crackC.getContext('2d'); cctx.fillStyle = '#000'; cctx.fillRect(0, 0, W, W); cctx.strokeStyle = '#fff'; cctx.lineWidth = 1.4;
  for (const pts of cracks) { cctx.beginPath(); cctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) cctx.lineTo(p[0], p[1]); cctx.stroke(); }
  const cd = cctx.getImageData(0, 0, W, W).data;
  const nA = up(noiseField(256, 256, 31, 5, 4), 256, W), nB = up(noiseField(256, 256, 32, 26, 3), 256, W);
  const col = new Float32Array(W); { const n1 = noiseField(256, 1, 77, 40, 3); for (let x = 0; x < W; x++) col[x] = Math.pow(n1[(x >> 2)], 2.2); }
  const row = new Float32Array(W); { const n2 = noiseField(64, 1, 78, 5, 3); for (let y = 0; y < W; y++) row[y] = n2[(y >> 4)]; }
  // shared dirt mask (0 = clean, 1 = filthy) and vertical smear mask
  const dirt = new Float32Array(W * W), smear = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const i = y * W + x; dirt[i] = clamp01((nA[i] * 1.2 + nB[i] * 0.4 - 0.86) * 2.4); smear[i] = col[x] * (0.3 + row[y]); }
  for (let i = 0; i < W * W; i++) { const k = cd[i * 4] / 255; if (k > 0) { hgt[i] -= k * 0.6; rough[i] = Math.min(1, rough[i] + k * 0.5); } rough[i] = Math.min(1, rough[i] + dirt[i] * 0.35 + smear[i] * 0.2 * mask[i]); }
  const albedoFor = (base, groutCol, dk, seed) => {
    const a = cv(W, W), ctx = a.getContext('2d'); ctx.fillStyle = rgb(...groutCol); ctx.fillRect(0, 0, W, W);
    for (const t of tiles) {
      const v = (t.k - 0.5) * 0.09, tint = (t.k2 - 0.5) * 0.05;
      ctx.fillStyle = rgb(base[0] * (1 + v + tint), base[1] * (1 + v), base[2] * (1 + v - tint));
      ctx.beginPath(); ctx.roundRect(t.x, t.y, t.w, t.h, 6); ctx.fill();
      const gr = ctx.createLinearGradient(t.x, t.y, t.x + t.w * 0.5, t.y + t.h);
      gr.addColorStop(0, 'rgba(255,255,255,0.14)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.0)'); gr.addColorStop(1, 'rgba(0,0,0,0.10)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.roundRect(t.x, t.y, t.w, t.h, 6); ctx.fill();
      if (t.k > 0.55) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(t.x + 6, t.y + 5, t.w * 0.5, 3); }
    }
    ctx.strokeStyle = 'rgba(30,26,20,0.5)'; ctx.lineWidth = 1.1;
    for (const pts of cracks) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke(); }
    const r2 = mulberry32(seed);
    for (let n = 0; n < 26; n++) { const t = tiles[(r2() * tiles.length) | 0]; const cx = t.x + (r2() < 0.5 ? 0 : t.w), cy = t.y + (r2() < 0.5 ? 0 : t.h); ctx.fillStyle = rgb(groutCol[0] * 0.85, groutCol[1] * 0.85, groutCol[2] * 0.85, 0.9); ctx.beginPath(); ctx.arc(cx, cy, 3 + r2() * 4, 0, 6.28); ctx.fill(); }
    pixelPass(ctx, W, W, (i, x, y, d, p) => {
      const dd = dirt[i] * dk, s = smear[i] * dk * 0.8;
      const g = mask[i] ? 1 : 0.78, grain = 1 + (((i * 2654435761) >>> 24) / 255 - 0.5) * 0.05;
      const m = (1 - 0.34 * dd - 0.26 * s) * g * grain;
      d[p] = d[p] * m * (1 + 0.06 * dd); d[p + 1] = d[p + 1] * m; d[p + 2] = d[p + 2] * m * (1 - 0.16 * dd);
    });
    return a;
  };
  const half = SHRINK, hh = half ? halve(hgt, W, W) : hgt, rr = half ? halve(rough, W, W) : rough, W2 = half ? W >> 1 : W;
  const nrm = mkTex(normalCanvas(hh, W2, W2, 3.2)), rm = mkTex(rmCanvas(rr, null, W2, W2));
  return {
    cream: { map: mkTex(albedoFor([234, 229, 210], [128, 122, 108], 1.0, 21), { srgb: true }), normalMap: nrm, rmMap: rm },
    green: { map: mkTex(albedoFor([24, 78, 60], [104, 108, 96], 0.85, 22), { srgb: true }), normalMap: nrm, rmMap: rm },
  };
}

// ---------------------------------------------------------------------------------------------- floor
function floorSet() {
  const W = 1024, T = 128, G = 5, n = 8, rnd = mulberry32(101);
  const a = cv(W, W), ctx = a.getContext('2d'); ctx.fillStyle = '#34363a'; ctx.fillRect(0, 0, W, W);
  const hgt0 = new Float32Array(W * W).fill(0.1), rough = new Float32Array(W * W).fill(0.9);
  for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) {
    const v = hash2(tx, ty, 3), v2 = hash2(tx, ty, 9); const patch = v2 > 0.9;
    const base = patch ? [112, 104, 92] : [86, 91, 96]; const k = 0.86 + v * 0.26;
    const x = tx * T + G / 2, y = ty * T + G / 2, w = T - G, h = T - G;
    ctx.fillStyle = rgb(base[0] * k, base[1] * k, base[2] * k); ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, 'rgba(255,255,255,0.09)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    fillArr(hgt0, W, x, y, w, h, 0.85 + v * 0.05); fillArr(rough, W, x, y, w, h, 0.42 + v2 * 0.22);
  }
  // terrazzo flecks
  const fl = []; for (let k = 0; k < 12; k++) { const a = 0.25 + (k / 12) * 0.35; fl.push(`rgba(215,208,190,${a})`); } for (let k = 0; k < 12; k++) fl.push(`rgba(20,22,26,${0.3 + (k / 12) * 0.4})`); for (let k = 0; k < 6; k++) fl.push(`rgba(140,150,160,${0.3 + (k / 6) * 0.3})`);
  for (let i = 0; i < 20000; i++) {
    const x = (rnd() * W) | 0, y = (rnd() * W) | 0; if ((x % T) < G || (y % T) < G) continue;
    const s = rnd() < 0.85 ? 1 : 2, r = rnd();
    ctx.fillStyle = r < 0.45 ? fl[(rnd() * 12) | 0] : r < 0.8 ? fl[12 + ((rnd() * 12) | 0)] : fl[24 + ((rnd() * 6) | 0)];
    ctx.fillRect(x, y, s, s);
  }
  // scuffs (light elongated smears)
  ctx.lineCap = 'round';
  for (let i = 0; i < 160; i++) { const x = rnd() * W, y = rnd() * W, a2 = rnd() * 6.28, l = 10 + rnd() * 40; ctx.strokeStyle = `rgba(210,205,195,${0.03 + rnd() * 0.06})`; ctx.lineWidth = 1 + rnd() * 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a2) * l, y + Math.sin(a2) * l); ctx.stroke(); }
  // cracks
  const cc = cv(W, W), cctx = cc.getContext('2d'); cctx.fillStyle = '#000'; cctx.fillRect(0, 0, W, W); cctx.strokeStyle = '#fff'; cctx.lineWidth = 2; cctx.lineJoin = 'round';
  for (let n2 = 0; n2 < 14; n2++) {
    let x = rnd() * W, y = rnd() * W, ang = rnd() * 6.28; cctx.beginPath(); cctx.moveTo(x, y);
    const segs = 8 + (rnd() * 12 | 0); for (let s = 0; s < segs; s++) { ang += (rnd() - 0.5) * 1.1; x += Math.cos(ang) * (8 + rnd() * 14); y += Math.sin(ang) * (8 + rnd() * 14); cctx.lineTo(x, y); }
    cctx.stroke();
  }
  const cd = cctx.getImageData(0, 0, W, W).data;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage((() => { const c2 = cv(W, W), x2 = c2.getContext('2d'); x2.fillStyle = '#fff'; x2.fillRect(0, 0, W, W); const id = x2.getImageData(0, 0, W, W); for (let i = 0; i < W * W; i++) { const k = 255 - cd[i * 4] * 0.75; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = k; } x2.putImageData(id, 0, 0); return c2; })(), 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  const wetN = up(noiseField(256, 256, 41, 4, 4), 256, W), dirtN = up(noiseField(256, 256, 42, 14, 4), 256, W), fine = up(noiseField(256, 256, 43, 40, 2), 256, W);
  const wetMask = new Float32Array(W * W);
  pixelPass(ctx, W, W, (i, x, y, d, p) => {
    const wn = wetN[i], dn = dirtN[i], fn = fine[i];
    const wet = sstep(0.6, 0.7, wn); wetMask[i] = wet;
    const dirt = clamp01((dn - 0.38) * 1.7);
    let m = (1 - 0.3 * dirt) * (1 - 0.34 * wet) * (0.94 + fn * 0.12);
    d[p] = d[p] * m * (1 + 0.03 * dirt); d[p + 1] = d[p + 1] * m; d[p + 2] = d[p + 2] * m * (1 - 0.09 * dirt);
  });
  const hgt = blur(hgt0, W, W, 1, 1);
  for (let i = 0; i < W * W; i++) { const k = cd[i * 4] / 255; hgt[i] -= k * 0.5; const wet = wetMask[i]; rough[i] = Math.max(0.05, rough[i] * (1 - wet * 0.85) + dirtN[i] * 0.1); if (hgt[i] > 0.6) rough[i] = Math.min(rough[i], 0.75); }
  return makeSet(a, hgt, rough, null, W, W, 2.4);
}

// ---------------------------------------------------------------------------------------------- concrete
function concreteSet(tint = [1, 1, 1], seed = 201) {
  const W = 1024, rnd = mulberry32(seed);
  const a = cv(W, W), ctx = a.getContext('2d');
  const nA = up(noiseField(256, 256, seed + 1, 5, 5), 256, W), nB = up(noiseField(256, 256, seed + 2, 24, 3), 256, W), nC = up(noiseField(256, 256, seed + 3, 2, 3), 256, W);
  const hgt = new Float32Array(W * W), rough = new Float32Array(W * W);
  ctx.fillStyle = '#9a9994'; ctx.fillRect(0, 0, W, W);
  // vertical stains
  for (let i = 0; i < 46; i++) {
    const x = rnd() * W, w = 5 + rnd() * 34, y = rnd() * W, l = 120 + rnd() * 460; const rust = rnd() < 0.25;
    const g = ctx.createLinearGradient(0, y, 0, y + l); const c = rust ? '150,80,40' : '32,30,28'; const al = rust ? 0.12 + rnd() * 0.12 : 0.06 + rnd() * 0.16;
    g.addColorStop(0, `rgba(${c},0)`); g.addColorStop(0.15, `rgba(${c},${al})`); g.addColorStop(1, `rgba(${c},0)`); ctx.fillStyle = g;
    for (const dx of [0, -W, W]) ctx.fillRect(x + dx, y, w, l);
  }
  // efflorescence blooms
  for (let i = 0; i < 14; i++) { const x = rnd() * W, y = rnd() * W, r = 20 + rnd() * 70; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(235,235,225,0.10)'); g.addColorStop(1, 'rgba(235,235,225,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  // formwork seams + tie holes
  ctx.fillStyle = 'rgba(30,30,30,0.5)'; for (const p of [0, 512]) { ctx.fillRect(p - 1, 0, 3, W); ctx.fillRect(0, p - 1, W, 3); }
  ctx.fillStyle = 'rgba(255,255,255,0.10)'; for (const p of [2, 514]) { ctx.fillRect(p, 0, 1, W); ctx.fillRect(0, p, W, 1); }
  for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) { const x = gx * 256 + 128, y = gy * 256 + 128; const r = ctx.createRadialGradient(x, y, 0, x, y, 9); r.addColorStop(0, 'rgba(15,15,15,0.85)'); r.addColorStop(0.55, 'rgba(15,15,15,0.7)'); r.addColorStop(0.7, 'rgba(255,255,255,0.12)'); r.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = r; ctx.fillRect(x - 10, y - 10, 20, 20); }
  // pits
  for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(20,20,20,${0.2 + rnd() * 0.4})`; const s = 1 + rnd() * 2.4; ctx.fillRect(rnd() * W, rnd() * W, s, s); }
  pixelPass(ctx, W, W, (i, x, y, d, p) => {
    const a1 = nA[i], b1 = nB[i], c1 = nC[i];
    const m = (0.72 + a1 * 0.5) * (0.9 + b1 * 0.2) * (0.92 + c1 * 0.14);
    d[p] = d[p] * m * tint[0]; d[p + 1] = d[p + 1] * m * tint[1]; d[p + 2] = d[p + 2] * m * tint[2];
    hgt[i] = a1 * 0.5 + b1 * 0.45 + (((i * 2654435761) >>> 24) / 255) * 0.15; rough[i] = 0.82 + b1 * 0.14;
  });
  // seams into the height field
  for (const pp of [0, 512]) for (let k = -1; k <= 1; k++) for (let t = 0; t < W; t++) { hgt[((pp + k + W) % W) * W + t] -= 0.35; hgt[t * W + ((pp + k + W) % W)] -= 0.35; }
  return makeSet(a, blur(hgt, W, W, 1, 1), rough, null, W, W, 2.2);
}

// ---------------------------------------------------------------------------------------------- metals
function metalSet({ base, seed, rust = 0.2, metal = 0.0, chip = 0.3, gloss = 0.45, spangle = false, size = 512, ribs = 0 }) {
  const W = size, rnd = mulberry32(seed), a = cv(W, W), ctx = a.getContext('2d');
  ctx.fillStyle = rgb(...base); ctx.fillRect(0, 0, W, W);
  if (spangle) for (let i = 0; i < 700; i++) { const x = rnd() * W, y = rnd() * W, s = 8 + rnd() * 26, k = 0.88 + rnd() * 0.24; ctx.fillStyle = rgb(base[0] * k, base[1] * k, base[2] * k, 0.65); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s, y + rnd() * 6); ctx.lineTo(x + s * 0.8, y + s * 0.9); ctx.lineTo(x + rnd() * 6, y + s); ctx.closePath(); ctx.fill(); }
  // brushed streaks
  for (let i = 0; i < 900; i++) { const x = rnd() * W, y = rnd() * W, l = 20 + rnd() * 160; ctx.strokeStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.02 + rnd() * 0.05})` : `rgba(0,0,0,${0.03 + rnd() * 0.06})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l, y + (rnd() - 0.5) * 2); ctx.stroke(); }
  // panel seams / rivets
  if (ribs) { for (let k = 0; k < ribs; k++) { const y = k * W / ribs; ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, y, W, 2); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, y + 2, W, 1); for (let x = 12; x < W; x += 32) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.arc(x, y + 8, 2.2, 0, 6.28); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(x - 0.5, y + 7.5, 1, 0, 6.28); ctx.fill(); } } }
  // scratches
  for (let i = 0; i < 70; i++) { const x = rnd() * W, y = rnd() * W, a2 = rnd() * 6.28, l = 10 + rnd() * 70; ctx.strokeStyle = `rgba(230,230,230,${0.15 + rnd() * 0.3})`; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a2) * l, y + Math.sin(a2) * l); ctx.stroke(); }
  const rustN = up(noiseField(256, 256, seed + 5, 5, 5), 256, W), chipN = up(noiseField(256, 256, seed + 6, 12, 4), 256, W), dirtN = up(noiseField(256, 256, seed + 7, 3, 4), 256, W), hueN = up(noiseField(256, 256, seed + 8, 9, 3), 256, W);
  const hgt = new Float32Array(W * W), rough = new Float32Array(W * W), met = new Float32Array(W * W);
  const th = 0.8 - rust * 0.6;
  pixelPass(ctx, W, W, (i, x, y, d, p) => {
    const rn = rustN[i], cn = chipN[i], dn = dirtN[i], hn = hueN[i];
    const rs = sstep(th, th + 0.22, rn + (cn - 0.5) * 0.25) * (rust > 0 ? 1 : 0);
    const ch = sstep(0.7 - chip * 0.3, 0.8 - chip * 0.3, cn) * chip * 2;
    let r = d[p], g = d[p + 1], b = d[p + 2];
    const dm = 0.78 + dn * 0.34; r *= dm; g *= dm; b *= dm;
    if (ch > 0) { const c2 = Math.min(1, ch); r = r * (1 - c2) + 104 * c2; g = g * (1 - c2) + 100 * c2; b = b * (1 - c2) + 96 * c2; }
    if (rs > 0) { const rr = 0.55 + rn * 0.55 + (hn - 0.5) * 0.4; r = r * (1 - rs) + (122 * rr) * rs; g = g * (1 - rs) + (62 * rr) * rs; b = b * (1 - rs) + (34 * rr) * rs; }
    d[p] = r; d[p + 1] = g; d[p + 2] = b;
    hgt[i] = 0.5 + (cn - 0.5) * 0.3 - rs * 0.35 * rn - ch * 0.15 + (((i * 2654435761) >>> 24) / 255 - 0.5) * 0.05;
    rough[i] = gloss + dn * 0.2 + rs * 0.42 + ch * 0.1; met[i] = metal * (1 - rs * 0.85);
  });
  return makeSet(a, blur(hgt, W, W, 1, 1), rough, met, W, W, 2.0);
}

// ---------------------------------------------------------------------------------------------- ballast
function ballastSet() {
  const W = 512, rnd = mulberry32(303), a = cv(W, W), ctx = a.getContext('2d'), hc = cv(W, W), hx = hc.getContext('2d');
  ctx.fillStyle = '#211f1d'; ctx.fillRect(0, 0, W, W); hx.fillStyle = '#000'; hx.fillRect(0, 0, W, W);
  const spr = cv(32, 32), sx = spr.getContext('2d'); const sg = sx.createRadialGradient(16, 16, 0, 16, 16, 16); sg.addColorStop(0, 'rgba(255,255,255,1)'); sg.addColorStop(0.6, 'rgba(255,255,255,0.7)'); sg.addColorStop(1, 'rgba(255,255,255,0)'); sx.fillStyle = sg; sx.fillRect(0, 0, 32, 32);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
  for (let i = 0; i < 3600; i++) {
    const x = rnd() * W, y = rnd() * W, rx = 3 + rnd() * 9, ry = rx * (0.6 + rnd() * 0.5), rot = rnd() * 3.14, sh = 38 + rnd() * 78, warm = rnd() * 10;
    const fillC = rgb(sh + warm, sh, sh - warm * 0.6), hv = 0.55 + rnd() * 0.45;
    for (const dx of [0, -W, W]) for (const dy of [0, -W, W]) {
      if (x + dx + rx < 0 || x + dx - rx > W || y + dy + ry < 0 || y + dy - ry > W) continue;
      ctx.fillStyle = fillC; ctx.beginPath(); ctx.ellipse(x + dx, y + dy, rx, ry, rot, 0, 6.28); ctx.fill(); ctx.stroke();
      hx.globalAlpha = hv; hx.drawImage(spr, x + dx - rx, y + dy - rx, rx * 2, rx * 2);
    }
  }
  hx.globalAlpha = 1;
  const dirt = up(noiseField(256, 256, 305, 6, 4), 256, W);
  pixelPass(ctx, W, W, (i, x, y, d, p) => { const m = 0.55 + dirt[i] * 0.6; d[p] *= m; d[p + 1] *= m; d[p + 2] *= m; });
  const hd = hx.getImageData(0, 0, W, W).data, hgt = new Float32Array(W * W), rough = new Float32Array(W * W).fill(0.92);
  for (let i = 0; i < W * W; i++) hgt[i] = hd[i * 4] / 255 * 1.4;
  return makeSet(a, hgt, rough, null, W, W, 3.5);
}

// ---------------------------------------------------------------------------------------------- tactile / hazard
function tactileSet() {
  const W = 512, rnd = mulberry32(404), a = cv(W, W), ctx = a.getContext('2d'); const hgt = new Float32Array(W * W), rough = new Float32Array(W * W).fill(0.6);
  ctx.fillStyle = '#c99a12'; ctx.fillRect(0, 0, W, W);
  const dn = noiseField(256, 256, 406, 8, 4);
  const S = 512 / 10, R = 11;
  const hc = cv(W, W), hx = hc.getContext('2d'); hx.fillStyle = '#000'; hx.fillRect(0, 0, W, W);
  for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) {
    const cx = (i + 0.5) * S + ((j & 1) ? S * 0.0 : 0), cy = (j + 0.5) * S;
    const wear = 0.8 + hash2(i, j, 1) * 0.2;
    const g = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, R + 2); g.addColorStop(0, `rgba(255,222,90,${wear})`); g.addColorStop(0.7, 'rgba(230,180,20,0.9)'); g.addColorStop(1, 'rgba(90,60,0,0.6)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R + 2, 0, 6.28); ctx.fill();
    const gh = hx.createRadialGradient(cx, cy, 0, cx, cy, R + 2); gh.addColorStop(0, 'rgba(255,255,255,1)'); gh.addColorStop(0.75, 'rgba(255,255,255,0.75)'); gh.addColorStop(1, 'rgba(255,255,255,0)'); hx.fillStyle = gh; hx.beginPath(); hx.arc(cx, cy, R + 2, 0, 6.28); hx.fill();
  }
  pixelPass(ctx, W, W, (i, x, y, d, p) => { const m = 0.55 + samp(dn, 256, W, x, y) * 0.65; const gr = ((i * 2654435761) >>> 24) / 255; d[p] *= m * (0.95 + gr * 0.1); d[p + 1] *= m * (0.95 + gr * 0.1); d[p + 2] *= m; });
  const hd = hx.getImageData(0, 0, W, W).data; for (let i = 0; i < W * W; i++) hgt[i] = hd[i * 4] / 255;
  return makeSet(a, blur(hgt, W, W, 1, 1), rough, null, W, W, 4.5);
}
function hazardTex() {
  const W = 256, rnd = mulberry32(505), a = cv(W, W), ctx = a.getContext('2d');
  ctx.fillStyle = '#e0ac12'; ctx.fillRect(0, 0, W, W); ctx.fillStyle = '#141414';
  for (let k = -2; k < 6; k++) { ctx.beginPath(); const o = k * 64; ctx.moveTo(o, 0); ctx.lineTo(o + 32, 0); ctx.lineTo(o + 32 + W, W); ctx.lineTo(o + W, W); ctx.closePath(); ctx.fill(); }
  for (let i = 0; i < 600; i++) { ctx.fillStyle = `rgba(${rnd() < 0.5 ? '20,20,20' : '230,220,190'},${rnd() * 0.25})`; ctx.fillRect(rnd() * W, rnd() * W, 1 + rnd() * 3, 1 + rnd() * 3); }
  pixelPass(ctx, W, W, (i, x, y, d, p) => { const gr = 0.85 + ((i * 2654435761) >>> 24) / 255 * 0.3; d[p] *= gr; d[p + 1] *= gr; d[p + 2] *= gr; });
  return { map: mkTex(a, { srgb: true }) };
}

// ---------------------------------------------------------------------------------------------- shutter, wood, misc
function shutterSet() {
  const W = 512, rnd = mulberry32(606), a = cv(W, W), ctx = a.getContext('2d'); const S = 36;
  const hgt = new Float32Array(W * W), rough = new Float32Array(W * W), met = new Float32Array(W * W).fill(0.9);
  ctx.fillStyle = '#6b7075'; ctx.fillRect(0, 0, W, W);
  for (let y = 0; y < W; y += 32) {
    const g = ctx.createLinearGradient(0, y, 0, y + 32); g.addColorStop(0, 'rgb(150,156,160)'); g.addColorStop(0.35, 'rgb(112,118,122)'); g.addColorStop(0.8, 'rgb(72,76,80)'); g.addColorStop(1, 'rgb(30,32,34)'); ctx.fillStyle = g; ctx.fillRect(0, y, W, 32);
    for (let yy = 0; yy < 32; yy++) { const t = yy / 32; const hv = t < 0.12 ? t / 0.12 * 0.5 : 0.5 + Math.sin((t - 0.12) / 0.88 * 3.14) * 0.5; for (let x = 0; x < W; x++) hgt[(y + yy) * W + x] = hv; }
  }
  for (let x = 40; x < W; x += 160) for (let y = 0; y < W; y += 32) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, y + 4, 4, 22); }
  for (let i = 0; i < 40; i++) { const x = rnd() * W, y = rnd() * W, r = 8 + rnd() * 34; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(20,20,20,0.35)'); g.addColorStop(1, 'rgba(20,20,20,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); }
  const rustN = noiseField(256, 256, 607, 5, 5), dirtN = noiseField(256, 256, 608, 4, 4);
  pixelPass(ctx, W, W, (i, x, y, d, p) => { const rn = samp(rustN, 256, W, x, y), dn = samp(dirtN, 256, W, x, y); const rs = sstep(0.6, 0.72, rn) * 0.8; const m = 0.7 + dn * 0.5; d[p] = d[p] * m * (1 - rs) + 130 * rs * m; d[p + 1] = d[p + 1] * m * (1 - rs) + 62 * rs * m; d[p + 2] = d[p + 2] * m * (1 - rs) + 30 * rs * m; rough[i] = 0.45 + dn * 0.25 + rs * 0.4; met[i] = 0.95 - rs * 0.8; });
  return makeSet(a, blur(hgt, W, W, 1, 1), rough, met, W, W, 3.0);
}
function woodSet() {
  const W = 512, rnd = mulberry32(707), a = cv(W, W), ctx = a.getContext('2d'); const PW = 128;
  const hgt = new Float32Array(W * W), rough = new Float32Array(W * W).fill(0.9);
  for (let p = 0; p < 4; p++) {
    const k = 0.7 + hash2(p, 1, 2) * 0.5; ctx.fillStyle = rgb(112 * k, 96 * k, 78 * k); ctx.fillRect(p * PW, 0, PW, W);
    for (let i = 0; i < 90; i++) { const x = p * PW + 4 + rnd() * (PW - 8); ctx.strokeStyle = `rgba(${rnd() < 0.5 ? '30,22,14' : '190,170,140'},${0.05 + rnd() * 0.16})`; ctx.lineWidth = 0.7 + rnd() * 1.5; ctx.beginPath(); ctx.moveTo(x, 0); let xx = x; for (let y = 0; y < W; y += 32) { xx += (rnd() - 0.5) * 3; ctx.lineTo(xx, y); } ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(p * PW, 0, 3, W); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(p * PW + 3, 0, 1, W);
    for (let y = 0; y < W; y++) for (let x = 0; x < PW; x++) hgt[y * W + p * PW + x] = (x < 3 ? 0 : 0.6) + Math.sin(x * 0.7 + p) * 0.05;
    if (hash2(p, 3, 4) > 0.3) { const kx = p * PW + 30 + rnd() * 60, ky = rnd() * W; const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, 14); g.addColorStop(0, 'rgba(30,20,10,0.9)'); g.addColorStop(0.6, 'rgba(60,40,20,0.5)'); g.addColorStop(1, 'rgba(60,40,20,0)'); ctx.fillStyle = g; ctx.fillRect(kx - 14, ky - 14, 28, 28); }
    for (const ny of [40, 256, 470]) for (const nx of [p * PW + 22, p * PW + PW - 22]) { ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.arc(nx, ny, 3, 0, 6.28); ctx.fill(); ctx.strokeStyle = 'rgba(150,70,30,0.45)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx + (rnd() - 0.5) * 6, ny + 16 + rnd() * 20); ctx.stroke(); }
  }
  const dn = noiseField(256, 256, 708, 4, 4);
  pixelPass(ctx, W, W, (i, x, y, d, p) => { const m = 0.62 + samp(dn, 256, W, x, y) * 0.7; d[p] *= m; d[p + 1] *= m; d[p + 2] *= m * 0.95; });
  return makeSet(a, blur(hgt, W, W, 1, 1), rough, null, W, W, 2.5);
}
// grey speckled plastic / rubber flooring for stairs and mats
function rubberSet() {
  const W = 256, rnd = mulberry32(808), a = cv(W, W), ctx = a.getContext('2d'); ctx.fillStyle = '#26292c'; ctx.fillRect(0, 0, W, W);
  const hgt = new Float32Array(W * W), rough = new Float32Array(W * W).fill(0.8);
  for (let y = 8; y < W; y += 16) for (let x = 8; x < W; x += 16) { ctx.fillStyle = 'rgba(70,74,78,0.9)'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.28); ctx.fill(); }
  const hc = cv(W, W), hx = hc.getContext('2d'); hx.fillStyle = '#000'; hx.fillRect(0, 0, W, W);
  for (let y = 8; y < W; y += 16) for (let x = 8; x < W; x += 16) { const g = hx.createRadialGradient(x, y, 0, x, y, 6); g.addColorStop(0, '#fff'); g.addColorStop(1, '#000'); hx.fillStyle = g; hx.fillRect(x - 6, y - 6, 12, 12); }
  const hd = hx.getImageData(0, 0, W, W).data; for (let i = 0; i < W * W; i++) hgt[i] = hd[i * 4] / 255;
  pixelPass(ctx, W, W, (i, x, y, d, p) => { const k = 0.85 + ((i * 2654435761) >>> 24) / 255 * 0.3; d[p] *= k; d[p + 1] *= k; d[p + 2] *= k; });
  return makeSet(a, hgt, rough, null, W, W, 3);
}

// ---------------------------------------------------------------------------------------------- generic small sprite textures
export function radialTex(size = 128, stops = [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]) {
  const c = cv(size, size), x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) g.addColorStop(t, col); x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function puffTex(size = 128, seed = 9) {
  const c = cv(size, size), x = c.getContext('2d'), rnd = mulberry32(seed); x.clearRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) { const a = rnd() * 6.28, r = rnd() * size * 0.22, px = size / 2 + Math.cos(a) * r, py = size / 2 + Math.sin(a) * r, rr = size * (0.14 + rnd() * 0.14); const g = x.createRadialGradient(px, py, 0, px, py, rr); g.addColorStop(0, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, size, size); }
  const id = x.getImageData(0, 0, size, size), d = id.data;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) { const dx = (i - size / 2) / (size / 2), dy = (j - size / 2) / (size / 2), f = Math.max(0, 1 - Math.hypot(dx, dy)); const p = (j * size + i) * 4; d[p + 3] *= sstep(0, 0.35, f); }
  x.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function ringTex(size = 128) {
  const c = cv(size, size), x = c.getContext('2d'); x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = size * 0.035; x.beginPath(); x.arc(size / 2, size / 2, size * 0.42, 0, 6.28); x.stroke();
  x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = size * 0.025; x.beginPath(); x.arc(size / 2, size / 2, size * 0.3, 0, 6.28); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// irregular puddle: greyscale alpha map (G channel) + colour map with a lighter wet rim
export function puddleTex(size = 256, seed = 4) {
  const n = noiseField(size, size, seed + 10, 4, 4);
  const ca = cv(size, size), cx = ca.getContext('2d'), ia = cx.createImageData(size, size), da = ia.data;
  const cc = cv(size, size), cy = cc.getContext('2d'), ic = cy.createImageData(size, size), dc = ic.data;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const dx = (i / size - 0.5) * 2, dy = (j / size - 0.5) * 2, r = Math.hypot(dx, dy * 1.05), nn = n[j * size + i];
    const a = sstep(1.0, 0.5, r + (nn - 0.5) * 0.9), rim = sstep(0.0, 0.45, 1 - a) * a; // brightest just inside the edge
    const p = (j * size + i) * 4, v = a * 255; da[p] = da[p + 1] = da[p + 2] = v; da[p + 3] = 255;
    const k = 0.35 + rim * 1.6; dc[p] = 22 * k; dc[p + 1] = 32 * k; dc[p + 2] = 44 * k; dc[p + 3] = 255;
  }
  cx.putImageData(ia, 0, 0); cy.putImageData(ic, 0, 0);
  const ta = new THREE.CanvasTexture(ca), tc = new THREE.CanvasTexture(cc); tc.colorSpace = THREE.SRGBColorSpace;
  return { alpha: ta, color: tc };
}

// ---------------------------------------------------------------------------------------------- public API
// async only so the loading bar can repaint between the ~15 texture sets (each is 20-300 ms of typed-array work); yieldFn is optional
export async function buildTextures(yieldFn) {
  const P = {}, timing = {};
  const T = async (name, fn) => { const t0 = performance.now(); const r = fn(); timing[name] = Math.round(performance.now() - t0); if (yieldFn) await yieldFn(); return r; };
  const tiles = await T('tiles', tileSets);
  P.tileCream = tiles.cream; P.tileGreen = tiles.green;
  P.floor = await T('floor', floorSet);
  P.concrete = await T('concrete', () => concreteSet([0.92, 0.97, 1.0], 201));
  P.paintGreen = await T('paint', () => metalSet({ base: [34, 74, 62], seed: 11, rust: 0.05, metal: 0.05, chip: 0.10, gloss: 0.38 }));
  P.steel = await T('steel', () => metalSet({ base: [78, 82, 88], seed: 12, rust: 0.04, metal: 1.0, chip: 0.0, gloss: 0.42 }));
  P.galv = await T('galv', () => metalSet({ base: [150, 156, 162], seed: 13, rust: 0.03, metal: 0.9, chip: 0.0, gloss: 0.38, spangle: true, ribs: 4 }));
  P.rust = await T('rust', () => metalSet({ base: [92, 54, 36], seed: 14, rust: 0.7, metal: 0.4, chip: 0.05, gloss: 0.6 }));
  P.yellow = await T('yellow', () => metalSet({ base: [196, 148, 22], seed: 15, rust: 0.04, metal: 0.05, chip: 0.12, gloss: 0.4 }));
  P.ballast = await T('ballast', ballastSet);
  P.tactile = await T('tactile', tactileSet);
  P.hazard = await T('hazard', hazardTex);
  P.shutter = await T('shutter', shutterSet);
  P.wood = await T('wood', woodSet);
  P.rubber = await T('rubber', rubberSet);
  P._timing = timing;
  return P;
}

// Materials shared by the whole station. `vertexColors` on everything so baked grime/AO in vertex colours works.
export function createMaterials(P, renderer, maxAniso = 8) {
  const aniso = Math.min(maxAniso, renderer?.capabilities?.getMaxAnisotropy?.() ?? 4); // maxAniso comes from the quality level (game.aniso)
  for (const k in P) for (const t of Object.values(P[k])) if (t?.isTexture) t.anisotropy = aniso;
  const std = (p, { metal = false, env = 0.6, ns = 1, color = 0xffffff, rough = 1 } = {}) => new THREE.MeshStandardMaterial({
    map: p.map, normalMap: p.normalMap, normalScale: new THREE.Vector2(ns, ns), roughnessMap: p.rmMap, metalnessMap: metal ? p.rmMap : null,
    roughness: rough, metalness: metal ? 1 : 0, vertexColors: true, envMapIntensity: env, color,
  });
  const M = {};
  M.floor = std(P.floor, { env: 1.1, ns: 1.0 });
  M.tileCream = std(P.tileCream, { env: 0.9, ns: 1.0 });
  M.tileGreen = std(P.tileGreen, { env: 1.0, ns: 1.0 });
  M.tileDark = std(P.tileGreen, { env: 0.9, ns: 1.0, color: 0x6c7078 }); // (no longer used by the station: its plinths / skirting were pure black boxes, they use 'concrete' now)
  M.concrete = std(P.concrete, { env: 0.45, ns: 1.0 });
  M.paint = std(P.paintGreen, { env: 0.8, metal: true, ns: 0.7 });
  M.steel = std(P.steel, { env: 1.0, metal: true, ns: 0.6 });
  M.galv = std(P.galv, { env: 1.0, metal: true, ns: 0.6 });
  M.rust = std(P.rust, { env: 0.55, metal: true, ns: 1.0 });
  M.yellow = std(P.yellow, { env: 0.7, metal: true, ns: 0.6 });
  M.ballast = std(P.ballast, { env: 0.3, ns: 1.4 });
  M.tactile = std(P.tactile, { env: 0.5, ns: 1.0 });
  M.hazard = new THREE.MeshStandardMaterial({ map: P.hazard.map, roughness: 0.55, metalness: 0, vertexColors: true, envMapIntensity: 0.5 });
  M.shutter = std(P.shutter, { env: 0.9, metal: true, ns: 1.0 });
  M.wood = std(P.wood, { env: 0.3, ns: 1.0 });
  M.rubber = std(P.rubber, { env: 0.3, ns: 1.0 });
  // (base colour white: every user of this material passes its albedo as VERTEX colours (red / teal suitcases, coloured litter, dark bags), a dark base colour multiplied on top rendered all of them as pure black boxes)
  M.plastic = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.1, vertexColors: true, envMapIntensity: 0.6 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.8, metalness: 0.2, vertexColors: true, envMapIntensity: 0.4 });
  M.brass = new THREE.MeshStandardMaterial({ color: 0xb08a3c, roughness: 0.35, metalness: 1.0, vertexColors: true, envMapIntensity: 1.2 });
  M.chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.22, metalness: 1.0, vertexColors: true, envMapIntensity: 1.4 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0x8fb0bd, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.22, vertexColors: true, envMapIntensity: 1.6, depthWrite: false });
  M.cable = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.2, vertexColors: true, envMapIntensity: 0.5 }); // (white base: the red / blue / yellow cables are vertex colours, a dark base made them black)
  return M;
}
