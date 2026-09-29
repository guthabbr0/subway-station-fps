// Canvas painters for the hero weapons (chaingun, rocket launcher, plasma rifle, BFG). Everything is procedural and seeded.
// A "plating layout" (panel seams, rivets, weld beads, paint chips, scratches, dents) is generated once and painted into THREE canvases
// so the grooves, chips and rivets line up across the albedo, the normal map (from a height canvas) and the ORM map
// (R = 1, G = roughness, B = metalness; used as both roughnessMap and metalnessMap, so chipped paint reads as bare steel).
import * as THREE from 'three';
import { mulberry32, speckle, normalFromCanvas } from '../../texutil.js';

export const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; };
export const mkTex = (c, { srgb = false, repeat = true, aniso = 4 } = {}) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso; return t;
};
// call fn(dx, dy) for every 3x3 wrap offset whose bounding box touches the S x S tile (seamless tiling)
function wrapped(S, x, y, rx, ry, fn) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const cx = x + ox * S, cy = y + oy * S;
    if (cx + rx < 0 || cx - rx > S || cy + ry < 0 || cy - ry > S) continue;
    fn(ox * S, oy * S);
  }
}
const grey = (v) => { const c = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${c},${c},${c})`; };

// ---------------------------------------------------------------------------------------------------------------------
export function makeLayout(seed, o = {}) {
  const S = o.S || 512, r = mulberry32(seed), L = { S, seams: [], rivets: [], chips: [], scr: [], dents: [], stains: [] };
  const cols = o.cols ?? 2, rows = o.rows ?? 3, gap = o.rivetGap ?? 24, off = o.rivetOff ?? 8;
  for (let i = 0; i < cols; i++) L.seams.push({ v: 1, p: ((i + 0.2 + r() * 0.3) / cols) * S, weld: r() < (o.weld ?? 0.3) });
  for (let j = 0; j < rows; j++) L.seams.push({ v: 0, p: ((j + 0.2 + r() * 0.3) / rows) * S, weld: r() < (o.weld ?? 0.3) });
  for (const s of L.seams) {
    if (s.weld || o.noRivets) continue;
    for (let t = r() * gap; t < S; t += gap * (0.85 + r() * 0.3)) for (const side of [-1, 1]) {
      if (r() < 0.05) continue;
      const x = s.v ? s.p + side * off : t, y = s.v ? t : s.p + side * off;
      L.rivets.push([x, y, 2.3 + r() * 0.9]);
      if (r() < 0.2) L.stains.push([x, y, 14 + r() * 42]);
    }
  }
  const nc = o.chips ?? 90;
  for (let i = 0; i < nc; i++) {
    let x = r() * S, y = r() * S;
    if (r() < 0.55) { const s = L.seams[Math.floor(r() * L.seams.length)]; if (s.v) x = s.p + (r() - 0.5) * 24; else y = s.p + (r() - 0.5) * 24; }
    const rad = 1.2 + r() * r() * 7, n = 5 + Math.floor(r() * 3), pts = [];
    for (let k = 0; k < n; k++) { const a = k / n * 6.283 + r() * 0.5, rr = rad * (0.55 + r() * 0.7); pts.push([Math.cos(a) * rr, Math.sin(a) * rr * (0.6 + r() * 0.5)]); }
    L.chips.push({ x, y, pts, rad });
  }
  for (let i = 0; i < (o.scratches ?? 46); i++) { const a = (r() - 0.5) * 0.8 + (r() < 0.25 ? 1.57 : 0), l = 10 + r() * 70; L.scr.push([r() * S, r() * S, Math.cos(a) * l, Math.sin(a) * l, 0.15 + r() * 0.35]); }
  for (let i = 0; i < (o.dents ?? 7); i++) L.dents.push([r() * S, r() * S, 12 + r() * 30, r() < 0.7 ? -1 : 1]);
  return L;
}

// ---------------------------------------------------------------------------------------------------------------------
// height canvas -> normal map
export function plateNormal(L, o = {}) {
  const S = L.S, [c, g] = mk(S, S), r = mulberry32((o.seed ?? 1) + 77);
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  for (const [x, y, rad, sg] of L.dents) wrapped(S, x, y, rad, rad, (dx, dy) => {
    const v = sg < 0 ? 0 : 255, gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
    gr.addColorStop(0, `rgba(${v},${v},${v},0.5)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`); g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
  });
  for (const s of L.seams) {
    if (s.weld) { // weld bead: overlapping scallops
      for (let t = 0; t < S; t += 3.4) {
        const jx = (r() - 0.5) * 1.8, x = s.v ? s.p + jx : t, y = s.v ? t : s.p + jx;
        g.fillStyle = `rgba(200,200,200,${0.6 + r() * 0.3})`; g.beginPath(); g.ellipse(x, y, s.v ? 3.6 : 2.4, s.v ? 2.4 : 3.6, 0, 0, 6.283); g.fill();
      }
    } else {
      g.lineWidth = o.groove ?? 3.4; g.strokeStyle = '#303030'; g.beginPath(); if (s.v) { g.moveTo(s.p, 0); g.lineTo(s.p, S); } else { g.moveTo(0, s.p); g.lineTo(S, s.p); } g.stroke();
      g.lineWidth = 1.3; g.strokeStyle = '#c4c4c4'; g.beginPath(); if (s.v) { g.moveTo(s.p + 3.2, 0); g.lineTo(s.p + 3.2, S); } else { g.moveTo(0, s.p + 3.2); g.lineTo(S, s.p + 3.2); } g.stroke();
    }
  }
  for (const [x, y, rad] of L.rivets) wrapped(S, x, y, rad + 2, rad + 2, (dx, dy) => {
    g.fillStyle = '#4a4a4a'; g.beginPath(); g.arc(x + dx, y + dy, rad + 1.3, 0, 6.283); g.fill();
    const gr = g.createRadialGradient(x + dx - 0.6, y + dy - 0.6, 0, x + dx, y + dy, rad); gr.addColorStop(0, '#f0f0f0'); gr.addColorStop(1, '#9a9a9a'); g.fillStyle = gr; g.beginPath(); g.arc(x + dx, y + dy, rad, 0, 6.283); g.fill();
  });
  g.fillStyle = '#555';
  for (const ch of L.chips) wrapped(S, ch.x, ch.y, ch.rad + 2, ch.rad + 2, (dx, dy) => { g.beginPath(); ch.pts.forEach(([px, py], i) => g[i ? 'lineTo' : 'moveTo'](ch.x + dx + px, ch.y + dy + py)); g.closePath(); g.fill(); });
  g.lineWidth = 0.7;
  for (const [x, y, lx, ly, a] of L.scr) { g.strokeStyle = `rgba(210,210,210,${a})`; wrapped(S, x, y, 80, 80, (dx, dy) => { g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + lx, y + dy + ly); g.stroke(); }); }
  speckle(g, S, S, r, o.grain ?? 0.09);
  return { canvas: c, texture: normalFromCanvas(c, o.strength ?? 2.4) };
}

// ---------------------------------------------------------------------------------------------------------------------
// albedo: o = {base, tints: [dark, light], chip: css, seed, blots, speck, seam: css, extra(g, S, r, L)}
export function paintAlbedo(L, o) {
  const S = L.S, [c, g] = mk(S, S), r = mulberry32(o.seed ?? 5);
  g.fillStyle = o.base; g.fillRect(0, 0, S, S);
  const tints = o.tints || ['rgba(0,0,0,0.10)', 'rgba(255,255,255,0.05)'];
  for (let i = 0; i < (o.blots ?? 48); i++) {
    const x = r() * S, y = r() * S, rx = 24 + r() * 80, ry = 12 + r() * 44, rot = r() * 3, col = tints[r() < 0.6 ? 0 : 1];
    wrapped(S, x, y, rx, rx, (dx, dy) => { g.save(); g.translate(x + dx, y + dy); g.rotate(rot); g.scale(rx, ry); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, col); gr.addColorStop(1, col.replace(/[\d.]+\)$/, '0)')); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, 6.283); g.fill(); g.restore(); });
  }
  for (let i = 0; i < (o.streaks ?? 260); i++) { const x = r() * S, y = r() * S, l = 14 + r() * 90; g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)'; wrapped(S, x, y, l, 2, (dx, dy) => g.fillRect(x + dx, y + dy, l, 1)); }
  // seams: dark grooves, weld beads slightly darker
  for (const s of L.seams) {
    g.lineWidth = s.weld ? 7 : 3.6; g.strokeStyle = s.weld ? 'rgba(0,0,0,0.22)' : (o.seam || 'rgba(0,0,0,0.55)');
    g.beginPath(); if (s.v) { g.moveTo(s.p, 0); g.lineTo(s.p, S); } else { g.moveTo(0, s.p); g.lineTo(S, s.p); } g.stroke();
    if (!s.weld) { g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); if (s.v) { g.moveTo(s.p + 3.4, 0); g.lineTo(s.p + 3.4, S); } else { g.moveTo(0, s.p + 3.4); g.lineTo(S, s.p + 3.4); } g.stroke(); }
  }
  // rust / grime streaks under rivets
  for (const [x, y, l] of L.stains) wrapped(S, x, y, 4, l, (dx, dy) => { const gr = g.createLinearGradient(0, y + dy, 0, y + dy + l); gr.addColorStop(0, o.stain || 'rgba(70,40,18,0.35)'); gr.addColorStop(1, 'rgba(70,40,18,0)'); g.fillStyle = gr; g.fillRect(x + dx - 1.2, y + dy, 2.4, l); });
  for (const [x, y, rad] of L.rivets) wrapped(S, x, y, rad + 2, rad + 2, (dx, dy) => { g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(x + dx, y + dy + 0.6, rad + 0.9, 0, 6.283); g.fill(); g.fillStyle = 'rgba(255,255,255,0.13)'; g.beginPath(); g.arc(x + dx - 0.5, y + dy - 0.6, rad * 0.55, 0, 6.283); g.fill(); });
  // chipped paint down to steel
  const chip = o.chip || '#8b929b';
  for (const ch of L.chips) wrapped(S, ch.x, ch.y, ch.rad + 2, ch.rad + 2, (dx, dy) => {
    g.beginPath(); ch.pts.forEach(([px, py], i) => g[i ? 'lineTo' : 'moveTo'](ch.x + dx + px, ch.y + dy + py)); g.closePath();
    g.fillStyle = 'rgba(20,18,16,0.55)'; g.save(); g.translate(0.8, 0.8); g.fill(); g.restore(); g.fillStyle = chip; g.fill();
  });
  g.lineWidth = 0.6;
  for (const [x, y, lx, ly, a] of L.scr) { g.strokeStyle = `rgba(${o.scr || '220,226,236'},${a})`; wrapped(S, x, y, 80, 80, (dx, dy) => { g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + lx, y + dy + ly); g.stroke(); }); }
  // dents catch dirt
  for (const [x, y, rad, sg] of L.dents) if (sg < 0) wrapped(S, x, y, rad, rad, (dx, dy) => { const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad); gr.addColorStop(0, 'rgba(0,0,0,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2); });
  speckle(g, S, S, r, o.speck ?? 0.06);
  if (o.extra) o.extra(g, S, r, L);
  return mkTex(c, { srgb: true });
}

// ORM (R=1, G=roughness, B=metalness)
export function paintORM(L, o = {}) {
  const S = o.S || 256, k = S / L.S, [c, g] = mk(S, S), r = mulberry32(o.seed ?? 3);
  const rc = (rough, metal, ao = 255) => `rgb(${ao},${Math.round(rough * 255)},${Math.round(metal * 255)})`;
  g.fillStyle = rc(o.rough ?? 0.62, o.metal ?? 0.06); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 34; i++) { const x = r() * S, y = r() * S, rx = 8 + r() * 34, rr = r(); wrapped(S, x, y, rx, rx, (dx, dy) => { const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rx); const col = rr < 0.6 ? rc((o.rough ?? 0.62) + 0.22, o.metal ?? 0.06, 235) : rc((o.rough ?? 0.62) - 0.2, (o.metal ?? 0.06) + 0.05); gr.addColorStop(0, col.replace('rgb', 'rgba').replace(')', ',0.5)')); gr.addColorStop(1, col.replace('rgb', 'rgba').replace(')', ',0)')); g.fillStyle = gr; g.fillRect(x + dx - rx, y + dy - rx, rx * 2, rx * 2); }); }
  g.lineWidth = Math.max(1, 3 * k); g.strokeStyle = rc(0.85, 0.02, 170);
  for (const s of L.seams) { g.beginPath(); if (s.v) { g.moveTo(s.p * k, 0); g.lineTo(s.p * k, S); } else { g.moveTo(0, s.p * k); g.lineTo(S, s.p * k); } g.stroke(); }
  g.fillStyle = rc(o.chipRough ?? 0.34, o.chipMetal ?? 0.92);
  for (const ch of L.chips) wrapped(S, ch.x * k, ch.y * k, ch.rad * k + 2, ch.rad * k + 2, (dx, dy) => { g.beginPath(); ch.pts.forEach(([px, py], i) => g[i ? 'lineTo' : 'moveTo'](ch.x * k + dx + px * k, ch.y * k + dy + py * k)); g.closePath(); g.fill(); });
  g.lineWidth = 0.8; g.strokeStyle = rc(0.28, 0.9);
  for (const [x, y, lx, ly] of L.scr) { g.beginPath(); g.moveTo(x * k, y * k); g.lineTo((x + lx) * k, (y + ly) * k); g.stroke(); }
  return mkTex(g.canvas, { srgb: false });
}

// ---------------------------------------------------------------------------------------------------------------------
// misc one-off textures
export function ringsTexture(seed = 9, o = {}) { // machined barrel: fine rings along v (use with texture.repeat), dark steel
  const [c, g] = mk(64, 128), r = mulberry32(seed);
  g.fillStyle = o.base || '#4a5058'; g.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 128; y += 4) { g.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.05})`; g.fillRect(0, y, 64, 1); g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.1})`; g.fillRect(0, y + 2, 64, 1); }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.1})`; g.fillRect(r() * 64, r() * 128, 1 + r() * 5, 1); }
  for (const y of [10, 62, 100]) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, y, 64, 3); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, y + 3, 64, 1); }
  speckle(g, 64, 128, r, 0.05);
  return mkTex(c, { srgb: true });
}
export function heatGradient() { // u-independent: dark at v=0 (breech end), hot toward v=1 (muzzle end)
  const [c, g] = mk(8, 64); const gr = g.createLinearGradient(0, 64, 0, 0);
  gr.addColorStop(0, '#000'); gr.addColorStop(0.35, '#1a0a04'); gr.addColorStop(0.7, '#a04a18'); gr.addColorStop(1, '#ffe0a0');
  g.fillStyle = gr; g.fillRect(0, 0, 8, 64);
  return mkTex(c, { srgb: true, repeat: false });
}
// staggered round perforations on a see-through steel shell (alpha-tested)
export function perforatedTexture(o = {}) {
  const W = o.w || 256, Hh = o.h || 128, [c, g] = mk(W, Hh), r = mulberry32(o.seed ?? 4);
  g.fillStyle = o.base || '#3b4148'; g.fillRect(0, 0, W, Hh);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.05})`; g.fillRect(r() * W, r() * Hh, 6 + r() * 30, 1); }
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(150,156,166,${0.2 + r() * 0.4})`; g.fillRect(r() * W, r() * Hh, 1 + r() * 2, 1 + r() * 1.5); }
  speckle(g, W, Hh, r, 0.05);
  const sx = o.pitchX || 16, sy = o.pitchY || 16, rad = o.rad || 4.6;
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
  for (let row = 0, y = sy / 2; y < Hh; y += sy, row++) for (let x = (row & 1) ? sx : sx / 2; x < W + sx; x += sx) { g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill(); }
  g.globalCompositeOperation = 'source-over';
  // rim highlight around the holes (painted after cutting: only on the opaque part)
  g.globalCompositeOperation = 'source-atop'; g.strokeStyle = 'rgba(190,200,215,0.35)'; g.lineWidth = 1;
  for (let row = 0, y = sy / 2; y < Hh; y += sy, row++) for (let x = (row & 1) ? sx : sx / 2; x < W + sx; x += sx) { g.beginPath(); g.arc(x, y, rad + 1.2, 0, 6.283); g.stroke(); }
  g.globalCompositeOperation = 'source-over';
  return mkTex(c, { srgb: true });
}
export function hazardStripes(o = {}) {
  const [c, g] = mk(128, 64), r = mulberry32(o.seed ?? 12);
  g.fillStyle = o.a || '#d8a91a'; g.fillRect(0, 0, 128, 64); g.fillStyle = o.b || '#15171a';
  for (let x = -64; x < 192; x += 32) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 16, 64); g.lineTo(x + 16 + 64, 0); g.lineTo(x + 64, 0); g.closePath(); g.fill(); }
  for (let i = 0; i < 260; i++) { g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.07)'; g.fillRect(r() * 128, r() * 64, 1 + r() * 3, 1); }
  for (let i = 0; i < 14; i++) { const x = r() * 128, y = r() * 64; const gr = g.createRadialGradient(x, y, 0, x, y, 10 + r() * 14); gr.addColorStop(0, 'rgba(10,8,6,0.35)'); gr.addColorStop(1, 'rgba(10,8,6,0)'); g.fillStyle = gr; g.fillRect(x - 24, y - 24, 48, 48); }
  speckle(g, 128, 64, r, 0.06);
  return mkTex(c, { srgb: true });
}
// emissive grille: bright slots on black, for glowing vents (MeshBasicMaterial map, colour multiplies)
export function grilleTexture(o = {}) {
  const [c, g] = mk(64, 64); g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
  const n = o.slots || 5;
  for (let i = 0; i < n; i++) { const y = 4 + i * (56 / n); const gr = g.createLinearGradient(0, y, 0, y + 56 / n - 5); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#b0b0b0'); g.fillStyle = gr; g.fillRect(5, y, 54, 56 / n - 5); }
  return mkTex(c, { srgb: true, repeat: false });
}
// swirling energy: additive plasma noise for the BFG core shells / plasma orbs (values are kept < 1, colour multiplies)
export function energyTexture(seed = 3, o = {}) {
  const W = o.w || 256, Hh = o.h || 128, [c, g] = mk(W, Hh), r = mulberry32(seed);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, Hh); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < (o.blobs ?? 150); i++) {
    const x = r() * W, y = r() * Hh, rad = 5 + r() * 22, a = 0.05 + r() * 0.22;
    for (const ox of [-W, 0, W]) { const gr = g.createRadialGradient(x + ox, y, 0, x + ox, y, rad); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2); }
  }
  g.lineCap = 'round';
  for (let k = 0; k < (o.arcs ?? 14); k++) {
    let x = r() * W, y = r() * Hh; g.strokeStyle = `rgba(255,255,255,${0.35 + r() * 0.5})`; g.lineWidth = 0.7 + r() * 1.4; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 9; s++) { x += 6 + r() * 14; y += (r() - 0.5) * 22; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  return mkTex(c, { srgb: true });
}
// vertical liquid with rising bubbles (scrolled with texture.offset.y)
export function liquidTexture(seed = 8) {
  const W = 64, Hh = 128, [c, g] = mk(W, Hh), r = mulberry32(seed);
  const gr = g.createLinearGradient(0, 0, 0, Hh); gr.addColorStop(0, '#1fa83a'); gr.addColorStop(0.5, '#2fe04a'); gr.addColorStop(1, '#1fa83a'); g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
  for (let i = 0; i < 40; i++) { const x = r() * W, y = r() * Hh, rad = 0.8 + r() * 3; for (const oy of [-Hh, 0, Hh]) { g.fillStyle = `rgba(210,255,215,${0.25 + r() * 0.5})`; g.beginPath(); g.arc(x, y + oy, rad, 0, 6.283); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 0.6; g.beginPath(); g.arc(x, y + oy, rad + 0.7, 0, 6.283); g.stroke(); } }
  for (let i = 0; i < 12; i++) { const y = r() * Hh; g.fillStyle = 'rgba(200,255,200,0.08)'; g.fillRect(0, y, W, 1 + r() * 3); }
  return mkTex(c, { srgb: true });
}
