// Procedural canvas texture atlases for enemies. One 1024x512 atlas per (type, outfit); geometry is shared, so an
// "outfit" is purely a different painting of the same regions.
import * as THREE from 'three';
import { canvasTexture, mulberry32 } from '../texutil.js';

export const AW = 1024, AH = 512;
// name: [x, y, w, h] in canvas pixels
export const REG = {
  face: [0, 0, 256, 256], torso: [256, 0, 384, 256], uarm: [640, 0, 128, 128], farm: [768, 0, 128, 128], thigh: [896, 0, 128, 128],
  shin: [640, 128, 128, 128], skin: [768, 128, 128, 128], gore: [896, 128, 64, 128], bone: [960, 128, 64, 128],
  metal: [0, 256, 256, 128], extra: [256, 256, 256, 128], extra2: [512, 256, 256, 128], shoe: [768, 256, 128, 64], hair: [896, 256, 128, 64],
};
export function uvRect(name, inset = 1.5) {
  const [x, y, w, h] = REG[name];
  return { u0: (x + inset) / AW, du: (w - 2 * inset) / AW, v0: 1 - (y + h - inset) / AH, dv: (h - 2 * inset) / AH };
}

// ---------------------------------------------------------------- colour helpers
const c255 = (v) => Math.max(0, Math.min(255, v | 0));
const parse = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const col = (c, f = 1, a = 1) => { const [r, g, b] = parse(c); return `rgba(${c255(r * f)},${c255(g * f)},${c255(b * f)},${a})`; };
export const mix = (c1, c2, t) => { const a = parse(c1), b = parse(c2); const h = (i) => c255(a[i] + (b[i] - a[i]) * t).toString(16).padStart(2, '0'); return '#' + h(0) + h(1) + h(2); };

// ---------------------------------------------------------------- paint primitives (region-local coords)
function blob(ctx, x, y, r, c, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col(c, 1, a)); g.addColorStop(1, col(c, 1, 0));
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function poly(ctx, pts, fill, stroke, lw = 1) {
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function mottle(ctx, w, h, rnd, n, amt, rmax = 16) {
  for (let i = 0; i < n; i++) blob(ctx, rnd() * w, rnd() * h, 3 + rnd() * rmax, rnd() < 0.55 ? '#000000' : '#ffffff', amt * (0.25 + rnd() * 0.75));
}
function fabric(ctx, w, h, rnd, base, o = {}) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  mottle(ctx, w, h, rnd, Math.round(w * h / 900), o.mottle ?? 0.1, 14);
  const wv = o.weave ?? 0.05;
  if (wv > 0) {
    ctx.fillStyle = col('#000000', 1, wv);
    for (let x = 0; x < w; x += 2) ctx.fillRect(x, 0, 1, h);
    ctx.fillStyle = col('#ffffff', 1, wv * 0.5);
    for (let y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 1);
  }
}
function fibres(ctx, w, h, rnd, n, a = 0.06, len = 8) {
  ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h, ang = rnd() * 6.283, l = 2 + rnd() * len;
    ctx.strokeStyle = col(rnd() < 0.5 ? '#000000' : '#ffffff', 1, a);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l); ctx.stroke();
  }
}
// dark grime streaks running down from the top + ground-in dirt at the bottom
function grime(ctx, w, h, rnd, k = 1) {
  for (let i = 0; i < 26 * k; i++) {
    const x = rnd() * w, len = 20 + rnd() * h * 0.7, wd = 1 + rnd() * 3, y0 = rnd() * h * 0.5;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len); g.addColorStop(0, col('#120d08', 1, 0.28)); g.addColorStop(1, col('#120d08', 1, 0));
    ctx.fillStyle = g; ctx.fillRect(x, y0, wd, len);
  }
  const g2 = ctx.createLinearGradient(0, h * 0.72, 0, h); g2.addColorStop(0, 'rgba(10,8,6,0)'); g2.addColorStop(1, 'rgba(10,8,6,' + 0.4 * Math.min(1.4, k) + ')');
  ctx.fillStyle = g2; ctx.fillRect(0, h * 0.72, w, h * 0.28);
  mottle(ctx, w, h, rnd, 18 * k, 0.12, 22);
}
function splat(ctx, x, y, r, rnd, c = '#5a0d0d', a = 0.85) {
  const n = 9 + (rnd() * 6 | 0); const pts = [];
  for (let i = 0; i < n; i++) { const an = i / n * 6.283, rr = r * (0.55 + rnd() * 0.7); pts.push(x + Math.cos(an) * rr, y + Math.sin(an) * rr); }
  poly(ctx, pts, col(c, 1, a));
  for (let i = 0; i < 5; i++) { const an = rnd() * 6.283, d = r * (1.1 + rnd() * 0.9); ctx.fillStyle = col(c, 1, a); ctx.beginPath(); ctx.arc(x + Math.cos(an) * d, y + Math.sin(an) * d, 0.6 + rnd() * r * 0.18, 0, 6.283); ctx.fill(); }
}
function bloodDrips(ctx, w, h, rnd, n, maxLen = 60, c = '#4a0808') {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h * 0.7, l = 8 + rnd() * maxLen, wd = 1 + rnd() * 2.2;
    const g = ctx.createLinearGradient(0, y, 0, y + l); g.addColorStop(0, col(c, 1, 0.75)); g.addColorStop(1, col(c, 1, 0.5));
    ctx.fillStyle = g; ctx.fillRect(x, y, wd, l); ctx.beginPath(); ctx.arc(x + wd / 2, y + l, wd * 0.9, 0, 6.283); ctx.fill();
  }
}
function bloodOn(ctx, w, h, rnd, n, r = 12, drips = 0.6) {
  for (let i = 0; i < n; i++) { const c = rnd() < 0.5 ? '#5a0c0c' : '#3d0808'; splat(ctx, rnd() * w, rnd() * h, 3 + rnd() * r, rnd, c, 0.55 + rnd() * 0.4); }
  bloodDrips(ctx, w, h, rnd, Math.round(n * drips), 40);
}
// jagged torn hole showing something underneath
function tear(ctx, x, y, tw, th, rnd, under = '#6a1c1c', edge = '#1a0d0a') {
  const n = 12, pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * 6.283; const k = 0.55 + rnd() * 0.6; pts.push(x + Math.cos(a) * tw * k, y + Math.sin(a) * th * k); }
  poly(ctx, pts, col(edge, 1, 0.9));
  const pts2 = pts.map((v, i) => (i % 2 ? y + (v - y) * 0.82 : x + (v - x) * 0.82));
  poly(ctx, pts2, under);
  blob(ctx, x, y, Math.max(tw, th) * 0.8, '#000000', 0.25);
}
function stitches(ctx, x0, y0, x1, y1, n, c = '#1a1410') {
  ctx.strokeStyle = c; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l * 4, ny = dx / l * 4;
  for (let i = 0; i <= n; i++) { const t = i / n, px = x0 + dx * t, py = y0 + dy * t; ctx.beginPath(); ctx.moveTo(px - nx, py - ny); ctx.lineTo(px + nx, py + ny); ctx.stroke(); }
}
function rivets(ctx, pts, r = 1.8, c = '#3a3a3a') {
  for (let i = 0; i < pts.length; i += 2) {
    ctx.fillStyle = col('#000000', 1, 0.5); ctx.beginPath(); ctx.arc(pts[i] + 0.8, pts[i + 1] + 0.8, r, 0, 6.283); ctx.fill();
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(pts[i], pts[i + 1], r, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(pts[i] - 0.5, pts[i + 1] - 0.5, r * 0.4, 0, 6.283); ctx.fill();
  }
}
function line(ctx, x0, y0, x1, y1, c, lw = 1) { ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
function veins(ctx, w, h, rnd, c, n = 9, a = 0.55) {
  ctx.strokeStyle = col(c, 1, a); ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    let x = rnd() * w, y = rnd() * h; ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) { const nx = x + (rnd() - 0.5) * 34, ny = y + (rnd() - 0.2) * 30; ctx.quadraticCurveTo(x + (rnd() - 0.5) * 20, y + (rnd() - 0.5) * 20, nx, ny); x = nx; y = ny; }
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- region painters
function paintSkin(ctx, w, h, rnd, O) {
  const sk = O.skin, dk = mix(sk, '#000000', 0.5), lt = mix(sk, '#ffffff', 0.2);
  ctx.fillStyle = sk; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) blob(ctx, rnd() * w, rnd() * h, 4 + rnd() * 14, rnd() < 0.5 ? dk : lt, 0.14 + rnd() * 0.22);
  for (let i = 0; i < 5; i++) blob(ctx, rnd() * w, rnd() * h, 6 + rnd() * 10, rnd() < 0.5 ? '#5a3a6a' : '#3a5a3a', 0.25); // bruises
  veins(ctx, w, h, rnd, O.vein || '#3d5566', 10, 0.5);
  fibres(ctx, w, h, rnd, 200, 0.05, 4);
  if ((O.gore ?? 0.5) > 0.2) bloodOn(ctx, w, h, rnd, 3, 8, 0.8);
  // sooty grime at the bottom (hands/feet)
  const g = ctx.createLinearGradient(0, h * 0.7, 0, h); g.addColorStop(0, 'rgba(20,14,10,0)'); g.addColorStop(1, 'rgba(20,14,10,0.35)'); ctx.fillStyle = g; ctx.fillRect(0, h * 0.7, w, h * 0.3);
}

function paintFace(ctx, w, h, rnd, O, type) {
  const F = O.face || {};
  const sk = mix(O.skin, '#000000', 0.12), dk = mix(O.skin, '#000000', 0.68), lt = mix(O.skin, '#ffffff', 0.1);
  ctx.fillStyle = sk; ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(128, 118, 24, 128, 128, 150); g.addColorStop(0, col(lt, 1, 0.4)); g.addColorStop(0.55, col(sk, 1, 0)); g.addColorStop(1, col(dk, 1, 0.6));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  mottle(ctx, w, h, rnd, 80, 0.16, 22);
  blob(ctx, 128, 128, 120, '#3a4a44', 0.18); // sickly cast
  veins(ctx, w, h, rnd, O.vein || '#3d5566', F.veins ?? 8, 0.5);
  // sculpting shadows: cheek hollows, temples, under the brow, nasolabial folds
  blob(ctx, 84, 160, 36, dk, F.hollow ?? 0.55); blob(ctx, 172, 160, 36, dk, F.hollow ?? 0.55);
  blob(ctx, 50, 104, 26, dk, 0.4); blob(ctx, 206, 104, 26, dk, 0.4);
  blob(ctx, 128, 84, 60, lt, 0.1);
  ctx.strokeStyle = col(dk, 1, 0.45); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(104, 158); ctx.quadraticCurveTo(92, 180, 100, 200); ctx.moveTo(152, 158); ctx.quadraticCurveTo(164, 180, 156, 200); ctx.stroke();
  // eye sockets (big, dark)
  const eyeY = 116;
  for (const sx of [86, 170]) {
    blob(ctx, sx, eyeY + 2, 44, '#0e060c', F.socket ?? 0.9);
    blob(ctx, sx, eyeY + 14, 30, '#2a1a3c', 0.4);
  }
  const eye = F.eye || 'cloudy';
  for (const sx of [86, 170]) {
    if (eye === 'cloudy') {
      ctx.fillStyle = '#d9d6a6'; ctx.beginPath(); ctx.ellipse(sx, eyeY, 17, 10.5, 0, 0, 6.283); ctx.fill();
      ctx.strokeStyle = col('#8a1a1a', 1, 0.75); ctx.lineWidth = 1.1;
      for (let i = 0; i < 7; i++) { const a = rnd() * 6.283; ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * 16, eyeY + Math.sin(a) * 9.5); ctx.lineTo(sx + Math.cos(a) * 6, eyeY + Math.sin(a) * 3.5); ctx.stroke(); }
      ctx.fillStyle = '#14110c'; ctx.beginPath(); ctx.arc(sx + (rnd() - 0.5) * 8, eyeY + 1, 2.8, 0, 6.283); ctx.fill();
      blob(ctx, sx, eyeY, 20, '#1a1008', 0.25);
      ctx.strokeStyle = col('#000000', 1, 0.8); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sx, eyeY, 17, 10.5, 0, 0, 6.283); ctx.stroke();
    } else if (eye === 'dead') {
      ctx.fillStyle = '#cfccbc'; ctx.beginPath(); ctx.ellipse(sx, eyeY, 15, 8.5, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#080604'; ctx.beginPath(); ctx.ellipse(sx, eyeY + 1, 6, 5, 0, 0, 6.283); ctx.fill();
      ctx.strokeStyle = col('#000', 1, 0.8); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sx, eyeY, 15, 8.5, 0, 0, 6.283); ctx.stroke();
    } else { // 'socket' - black pit for a 3D glowing eye to sit in
      ctx.fillStyle = '#050208'; ctx.beginPath(); ctx.ellipse(sx, eyeY, 19, 11.5, 0, 0, 6.283); ctx.fill();
    }
  }
  // heavy brow
  ctx.strokeStyle = col('#0a0604', 1, F.brow ?? 0.8); ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(52, 90); ctx.quadraticCurveTo(84, 82, 116, 100); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(204, 90); ctx.quadraticCurveTo(172, 82, 140, 100); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.strokeStyle = col(dk, 1, 0.35); ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(78, 58 + i * 9); ctx.quadraticCurveTo(128, 54 + i * 9 + (rnd() - 0.5) * 6, 178, 58 + i * 9); ctx.stroke(); }
  // nose
  ctx.fillStyle = col(dk, 1, 0.55); ctx.beginPath(); ctx.moveTo(128, 122); ctx.lineTo(108, 168); ctx.lineTo(148, 168); ctx.closePath(); ctx.fill();
  blob(ctx, 128, 142, 12, lt, 0.24);
  ctx.fillStyle = '#12080a'; ctx.beginPath(); ctx.ellipse(117, 168, 6, 4, 0, 0, 6.283); ctx.ellipse(139, 168, 6, 4, 0, 0, 6.283); ctx.fill();
  // mouth
  const mo = F.mouth || 'gape', my = 196;
  if (mo === 'shut') {
    ctx.strokeStyle = '#0c0405'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(94, my); ctx.quadraticCurveTo(128, my + 7, 162, my - 2); ctx.stroke();
    ctx.fillStyle = col(mix(sk, '#803030', 0.4), 1, 0.7); ctx.beginPath(); ctx.ellipse(128, my + 6, 28, 5, 0, 0, 6.283); ctx.fill();
  } else {
    const mw = mo === 'scream' ? 48 : mo === 'wide' ? 58 : 36, mh = mo === 'scream' ? 38 : mo === 'wide' ? 30 : 22;
    ctx.fillStyle = '#0c0206'; ctx.beginPath(); ctx.ellipse(128, my + 4, mw, mh, 0, 0, 6.283); ctx.fill();
    if (mo === 'wide') { const gg = ctx.createRadialGradient(128, my + 10, 4, 128, my + 6, mw); gg.addColorStop(0, 'rgba(120,255,60,0.9)'); gg.addColorStop(1, 'rgba(60,140,20,0)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.ellipse(128, my + 4, mw - 2, mh - 2, 0, 0, 6.283); ctx.fill(); }
    else { ctx.fillStyle = col('#8a2a3a', 1, 0.9); ctx.beginPath(); ctx.ellipse(128, my + mh * 0.55, mw * 0.55, mh * 0.42, 0, 0, 6.283); ctx.fill(); }
    const tc = F.teeth || '#cfc79a';
    for (let i = 0; i < 9; i++) {
      const tx = 128 + (i - 4) * (mw * 2 / 10.5); if (rnd() < 0.18) continue;
      const th = 6 + rnd() * 6; ctx.fillStyle = tc; ctx.fillRect(tx - 2.6, my + 4 - mh + 2, 5.2, th); ctx.fillStyle = col('#000', 1, 0.3); ctx.fillRect(tx + 2, my + 4 - mh + 2, 0.8, th);
      if (rnd() > 0.15) { ctx.fillStyle = mix(tc, '#5a3a20', rnd() * 0.5); ctx.fillRect(tx - 2.6, my + 4 + mh - 2 - th, 5.2, th); }
    }
    ctx.strokeStyle = col('#000000', 1, 0.6); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(128, my + 4, mw, mh, 0, 0, 6.283); ctx.stroke();
  }
  // blood on chin/mouth
  if ((F.blood ?? 0.6) > 0) {
    const b = F.blood ?? 0.6, bc = F.drool || '#4a0808';
    for (let i = 0; i < 6 * b + 2; i++) { const x = 96 + rnd() * 64, l = 16 + rnd() * 54 * b, wd = 2.5 + rnd() * 4; const gg = ctx.createLinearGradient(0, my, 0, my + l); gg.addColorStop(0, col(bc, 1, 0.9)); gg.addColorStop(1, col(bc, 1, 0.3)); ctx.fillStyle = gg; ctx.fillRect(x, my + 6, wd, l); }
    splat(ctx, 128, my + 34, 12 * b + 3, rnd, bc, 0.75);
  }
  for (let i = 0; i < (F.scars ?? 3); i++) {
    const x0 = 40 + rnd() * 170, y0 = 60 + rnd() * 130, ang = rnd() * 3.14, l = 18 + rnd() * 36;
    ctx.strokeStyle = col('#4a0c0c', 1, 0.95); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(ang) * l, y0 + Math.sin(ang) * l); ctx.stroke();
    ctx.strokeStyle = col('#c07070', 1, 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y0 - 1.5); ctx.lineTo(x0 + Math.cos(ang) * l, y0 + Math.sin(ang) * l - 1.5); ctx.stroke();
  }
  if (F.wound) { tear(ctx, F.wound[0], F.wound[1], 18, 12, rnd, '#7a1c1c', '#2a0a0a'); }
  const eg = ctx.createLinearGradient(0, 0, w, 0); eg.addColorStop(0, col(sk, 1, 1)); eg.addColorStop(0.07, col(sk, 1, 0)); eg.addColorStop(0.93, col(sk, 1, 0)); eg.addColorStop(1, col(sk, 1, 1));
  ctx.fillStyle = eg; ctx.fillRect(0, 0, w, h);
  fibres(ctx, w, h, rnd, 300, 0.06, 4);
}

function paintGore(ctx, w, h, rnd) {
  ctx.fillStyle = '#5c1414'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) blob(ctx, rnd() * w, rnd() * h, 5 + rnd() * 12, rnd() < 0.5 ? '#a63030' : '#2c0808', 0.45);
  for (let i = 0; i < 6; i++) { ctx.fillStyle = col('#d8b070', 1, 0.5); ctx.beginPath(); ctx.ellipse(rnd() * w, rnd() * h, 3 + rnd() * 5, 1.5 + rnd() * 2, rnd() * 3, 0, 6.283); ctx.fill(); }
  for (let i = 0; i < 30; i++) { ctx.fillStyle = 'rgba(255,190,190,0.5)'; ctx.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
  veins(ctx, w, h, rnd, '#3a0a0a', 6, 0.6);
}
function paintBone(ctx, w, h, rnd) {
  ctx.fillStyle = '#c9c0a2'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 30; i++) blob(ctx, rnd() * w, rnd() * h, 4 + rnd() * 9, rnd() < 0.5 ? '#6a5a3a' : '#f0ead0', 0.35);
  for (let i = 0; i < 6; i++) line(ctx, rnd() * w, 0, rnd() * w, h, col('#4a3a20', 1, 0.3), 1);
  bloodOn(ctx, w, h, rnd, 2, 6, 0.4);
}

function paintMetal(ctx, w, h, rnd, O) {
  const base = O.metal || '#4a4f55', rust = O.rust ?? 0.25;
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  // brushed grain
  for (let i = 0; i < 220; i++) { ctx.fillStyle = col(rnd() < 0.5 ? '#ffffff' : '#000000', 1, 0.05 + rnd() * 0.05); ctx.fillRect(rnd() * w, rnd() * h, 10 + rnd() * 40, 1); }
  mottle(ctx, w, h, rnd, 40, 0.16, 20);
  // plate seams + rivets
  const pts = [];
  for (let x = 0; x <= w; x += 64) { line(ctx, x, 0, x, h, col('#000000', 1, 0.5), 2); line(ctx, x + 1.5, 0, x + 1.5, h, col('#ffffff', 1, 0.12), 1); for (let y = 10; y < h; y += 28) { pts.push(x + 8, y); pts.push(x + 56, y); } }
  line(ctx, 0, h / 2, w, h / 2, col('#000000', 1, 0.45), 2);
  rivets(ctx, pts, 1.7, mix(base, '#ffffff', 0.2));
  // rust + scratches
  for (let i = 0; i < 26 * rust * 4; i++) blob(ctx, rnd() * w, rnd() * h, 4 + rnd() * 14, rnd() < 0.7 ? '#7a3d18' : '#4a2410', rust * (0.6 + rnd() * 0.6));
  for (let i = 0; i < 40; i++) { const x = rnd() * w, y = rnd() * h, a = rnd() * 3.14, l = 5 + rnd() * 24; line(ctx, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, col('#ffffff', 1, 0.22), 0.8); }
  // edge highlights + AO
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.08)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.3)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  if (O.gore > 0.3) bloodOn(ctx, w, h, rnd, 3, 9, 0.4);
}

function paintShoe(ctx, w, h, rnd, O) {
  const c = O.shoe || '#1a1612';
  fabric(ctx, w, h, rnd, c, { weave: 0.03, mottle: 0.12 });
  for (let i = 0; i < 6; i++) line(ctx, 30 + i * 12, 8, 44 + i * 12, 30, col(O.shoeLace || '#8a8a80', 1, 0.5), 1.4); // laces
  ctx.fillStyle = 'rgba(8,6,5,0.85)'; ctx.fillRect(0, h - 12, w, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(0, h - 13, w, 1);
  grime(ctx, w, h, rnd, 0.7);
  bloodOn(ctx, w, h, rnd, 2, 7, 0.2);
}
function paintHair(ctx, w, h, rnd, O) {
  const c = O.hair || '#2a2119';
  ctx.fillStyle = c; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) line(ctx, rnd() * w, 0, rnd() * w + (rnd() - 0.5) * 10, h, col(rnd() < 0.5 ? '#000000' : mix(c, '#ffffff', 0.35), 1, 0.25 + rnd() * 0.3), 1);
  mottle(ctx, w, h, rnd, 14, 0.15, 10);
  if ((O.gore ?? 0) > 0.3) bloodOn(ctx, w, h, rnd, 2, 8, 0.4);
}

// ---------------------------------------------------------------- clothing painters: torso (384x256, front centre at x=192)
const CX = 192;
const T = {};
T.suit = (ctx, w, h, rnd, O) => {
  fabric(ctx, w, h, rnd, O.cloth, { weave: 0.04 });
  ctx.fillStyle = 'rgba(255,255,255,0.075)'; for (let x = 0; x < w; x += 9) ctx.fillRect(x, 0, 1, h);
  poly(ctx, [CX - 36, 0, CX + 36, 0, CX + 9, 140, CX - 9, 140], O.cloth2); // shirt
  for (const s of [-1, 1]) poly(ctx, [CX + s * 36, 0, CX + s * 76, 0, CX + s * 16, 156, CX + s * 9, 140], mix(O.cloth, '#000000', 0.25), '#000', 1); // lapels
  poly(ctx, [CX - 7, 6, CX + 7, 6, CX + 10, 122, CX, 144, CX - 10, 122], O.accent); // tie
  ctx.fillStyle = mix(O.accent, '#000000', 0.35); ctx.fillRect(CX - 8, 4, 16, 14);
  line(ctx, CX, 144, CX, h, col('#000000', 1, 0.5), 2);
  for (const y of [178, 214]) { ctx.fillStyle = '#0c0c0c'; ctx.beginPath(); ctx.arc(CX + 6, y, 4, 0, 6.283); ctx.fill(); }
  for (const s of [-1, 1]) { ctx.fillStyle = col('#000000', 1, 0.4); ctx.fillRect(CX + s * 70 - 22, 196, 44, 4); line(ctx, CX + s * 70 - 22, 200, CX + s * 70 + 22, 200, col('#ffffff', 1, 0.15), 1); }
  line(ctx, 0, 60, 0, h, col('#000000', 1, 0.5), 2); line(ctx, w - 1, 60, w - 1, h, col('#000000', 1, 0.5), 2);
  // dried blood down the shirt + jacket
  splat(ctx, CX - 4, 60, 22, rnd, '#4a0a0a', 0.75); bloodDrips(ctx, CX - 30, 40, rnd, 8, 80);
  ctx.save(); ctx.translate(CX - 30, 0); bloodDrips(ctx, 60, 200, rnd, 8, 90); ctx.restore();
  tear(ctx, CX + 92, 130, 26, 30, rnd, '#7a2222'); tear(ctx, 40, 170, 18, 22, rnd, '#4a1010');
  bloodOn(ctx, w, h, rnd, 8, 14); grime(ctx, w, h, rnd, 1.1);
};
T.hivis = (ctx, w, h, rnd, O) => {
  fabric(ctx, w, h, rnd, O.cloth, { weave: 0.07, mottle: 0.14 });
  poly(ctx, [0, 0, 30, 0, 22, h, 0, h], O.cloth2); poly(ctx, [w, 0, w - 30, 0, w - 22, h, w, h], O.cloth2); poly(ctx, [CX - 100, 0, CX - 92, 0, CX - 92, h * 0.5, CX - 100, h * 0.5], O.cloth2);
  const refl = (x0, y0, x1, y1) => { ctx.fillStyle = O.accent; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); for (let i = 0; i < (x1 - x0) * (y1 - y0) / 30; i++) { ctx.fillStyle = col(rnd() < 0.5 ? '#ffffff' : '#606860', 1, 0.3); ctx.fillRect(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), 1.5, 1.5); } line(ctx, x0, y0, x1, y0, col('#000', 1, 0.35), 1); line(ctx, x0, y1, x1, y1, col('#000', 1, 0.35), 1); };
  refl(0, 136, w, 154); refl(0, 190, w, 208);
  for (const x of [CX - 50, CX + 36, 36, w - 50]) refl(x, 0, x + 14, 136);
  line(ctx, CX, 0, CX, h, col('#000000', 1, 0.6), 2); for (let y = 6; y < h; y += 6) line(ctx, CX - 3, y, CX + 3, y, col('#909090', 1, 0.6), 1);
  ctx.fillStyle = col('#000000', 1, 0.28); ctx.fillRect(CX + 44, 60, 34, 30); ctx.fillStyle = col('#ffffff', 1, 0.12); ctx.fillRect(CX + 44, 60, 34, 2);
  bloodOn(ctx, w, h, rnd, 10, 16); tear(ctx, CX - 70, 110, 22, 28, rnd, '#7a1c1c'); tear(ctx, w - 60, 175, 20, 16, rnd, '#4a1010'); grime(ctx, w, h, rnd, 1.4);
};
T.hoodie = (ctx, w, h, rnd, O) => {
  fabric(ctx, w, h, rnd, O.cloth, { weave: 0.09, mottle: 0.16 });
  ctx.fillStyle = col('#000000', 1, 0.28); ctx.beginPath(); ctx.ellipse(0, 20, 90, 60, 0, 0, 6.283); ctx.ellipse(w, 20, 90, 60, 0, 0, 6.283); ctx.fill(); // hood bunched at the back
  poly(ctx, [CX - 78, 160, CX + 78, 160, CX + 96, 236, CX - 96, 236], col('#000000', 1, 0.14), col('#000', 1, 0.4), 2); // kangaroo pocket
  line(ctx, CX - 60, 160, CX - 76, 236, col('#ffffff', 1, 0.1), 1);
  for (const s of [-1, 1]) { line(ctx, CX + s * 12, 6, CX + s * 14, 104, O.accent, 2.2); ctx.fillStyle = '#d8d8d0'; ctx.fillRect(CX + s * 14 - 2, 104, 4, 9); }
  ctx.fillStyle = col('#000000', 1, 0.3); for (let x = 0; x < w; x += 4) ctx.fillRect(x, 240, 2, 16); // rib hem
  ctx.fillStyle = col('#ffffff', 1, 0.7); ctx.font = 'bold 22px sans-serif'; ctx.fillText('N.Y.', CX - 22, 80);
  ctx.fillStyle = col(O.cloth, 1, 0.7); for (let i = 0; i < 40; i++) ctx.fillRect(CX - 26 + rnd() * 50, 62 + rnd() * 22, 3 + rnd() * 7, 1.2); // cracked print
  bloodOn(ctx, w, h, rnd, 12, 16); tear(ctx, CX + 84, 96, 20, 30, rnd, '#8a2a2a'); tear(ctx, 60, 150, 22, 20, rnd, '#4a1010'); grime(ctx, w, h, rnd, 1.2);
};
T.uniform = (ctx, w, h, rnd, O) => {
  fabric(ctx, w, h, rnd, O.cloth, { weave: 0.05 });
  poly(ctx, [CX - 30, 0, CX + 30, 0, CX, 66], O.cloth2); poly(ctx, [CX - 32, 0, CX - 24, 0, CX, 58, CX - 4, 68], '#eeeeee');
  poly(ctx, [CX - 5, 12, CX + 5, 12, CX + 6, 100, CX, 108, CX - 6, 100], '#14161c'); // tie
  for (const s of [-1, 1]) { line(ctx, CX + s * 10, 66, CX + s * 12, h, O.accent, 2); ctx.fillStyle = O.accent; ctx.fillRect(CX + s * 96 - 22, 0, 44, 16); line(ctx, CX + s * 96 - 22, 8, CX + s * 96 + 22, 8, '#000', 1); }
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { ctx.fillStyle = O.accent; ctx.beginPath(); ctx.arc(CX + s * 6, 84 + i * 32, 3.5, 0, 6.283); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(CX + s * 6 + 1, 85 + i * 32, 3, 0, 6.283); ctx.fill(); }
  ctx.fillStyle = O.accent; ctx.beginPath(); ctx.arc(CX + 62, 88, 12, 0, 6.283); ctx.fill(); ctx.strokeStyle = '#3a2a08'; ctx.lineWidth = 1.5; ctx.stroke(); // badge
  ctx.fillStyle = '#e8e6da'; ctx.fillRect(CX - 76, 84, 32, 12); ctx.fillStyle = '#222'; ctx.font = '9px sans-serif'; ctx.fillText('STAFF', CX - 72, 93);
  for (const s of [-1, 1]) { ctx.fillStyle = col('#000', 1, 0.25); ctx.fillRect(CX + s * 66 - 20, 168, 40, 26); line(ctx, CX + s * 66 - 20, 168, CX + s * 66 + 20, 168, col('#fff', 1, 0.15), 1); }
  bloodOn(ctx, w, h, rnd, 9, 15); tear(ctx, CX - 64, 150, 26, 24, rnd, '#7a1c1c'); tear(ctx, w - 50, 60, 16, 24, rnd, '#4a1010'); grime(ctx, w, h, rnd, 1.1);
};
T.trackie = (ctx, w, h, rnd, O) => {
  fabric(ctx, w, h, rnd, O.cloth, { weave: 0.08, mottle: 0.18 });
  for (const s of [-1, 1]) { ctx.fillStyle = O.accent; ctx.fillRect(CX + s * 92 - 5, 0, 10, h); ctx.fillRect(CX + s * 92 + 8, 0, 3, h); }
  poly(ctx, [CX - 16, 0, CX + 16, 0, CX + 12, 40, CX - 12, 40], O.cloth2); line(ctx, CX, 0, CX, h, '#111', 2);
  for (let y = 40; y < h; y += 5) line(ctx, CX - 2, y, CX + 2, y, '#999', 1);
  bloodOn(ctx, w, h, rnd, 12, 18); tear(ctx, CX - 50, 130, 24, 30, rnd, '#7a1c1c'); tear(ctx, w - 40, 90, 20, 34, rnd, '#5a1414'); grime(ctx, w, h, rnd, 1.3);
};
T.shirt = (ctx, w, h, rnd, O) => {
  fabric(ctx, w, h, rnd, O.cloth, { weave: 0.05, mottle: 0.18 });
  line(ctx, CX, 0, CX, h, col('#000', 1, 0.35), 2);
  for (let i = 0; i < 6; i++) { ctx.fillStyle = col('#e8e8e0', 1, 0.9); ctx.beginPath(); ctx.arc(CX, 20 + i * 38, 3.4, 0, 6.283); ctx.fill(); }
  poly(ctx, [CX - 30, 0, CX + 30, 0, CX + 14, 40, CX - 14, 40], mix(O.cloth, '#ffffff', 0.2), '#000', 1);
  if (O.torn) { // shirt hanging open over a bare ribcage
    poly(ctx, [CX - 40, 30, CX + 40, 30, CX + 62, 210, CX + 20, 256, CX - 20, 256, CX - 62, 210], O.skin);
    blob(ctx, CX, 130, 80, '#000000', 0.25);
    for (let i = 0; i < 7; i++) { const y = 56 + i * 20; ctx.strokeStyle = col('#20140e', 1, 0.75); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(CX, y - 4); ctx.quadraticCurveTo(CX + 44, y - 18, CX + 60 - i * 3, y + 8); ctx.moveTo(CX, y - 4); ctx.quadraticCurveTo(CX - 44, y - 18, CX - 60 + i * 3, y + 8); ctx.stroke(); ctx.strokeStyle = col('#e0d6b8', 1, 0.28); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(CX, y - 6); ctx.quadraticCurveTo(CX + 44, y - 20, CX + 58 - i * 3, y + 5); ctx.moveTo(CX, y - 6); ctx.quadraticCurveTo(CX - 44, y - 20, CX - 58 + i * 3, y + 5); ctx.stroke(); }
    line(ctx, CX, 40, CX, 220, col('#20140e', 1, 0.7), 4); tear(ctx, CX + 20, 150, 26, 22, rnd, '#6a1616');
  }
  bloodOn(ctx, w, h, rnd, 14, 18); grime(ctx, w, h, rnd, 1.2);
};
T.tactical = (ctx, w, h, rnd, O) => {
  fabric(ctx, w, h, rnd, O.cloth, { weave: 0.06 });
  const plate = mix(O.cloth, '#000000', 0.35);
  poly(ctx, [CX - 64, 6, CX + 64, 6, CX + 72, 212, CX + 40, 234, CX - 40, 234, CX - 72, 212], plate, '#000', 2);
  for (let y = 12; y < 226; y += 9) for (let x = CX - 60; x < CX + 62; x += 12) { ctx.fillStyle = col('#000', 1, 0.45); ctx.fillRect(x, y, 8, 3); }
  for (let i = -1; i <= 1; i++) { ctx.fillStyle = mix(O.cloth, '#3a4030', 0.5); ctx.fillRect(CX + i * 40 - 16, 156, 32, 46); line(ctx, CX + i * 40 - 16, 166, CX + i * 40 + 16, 166, col('#000', 1, 0.6), 2); ctx.fillStyle = '#111'; ctx.fillRect(CX + i * 40 - 3, 160, 6, 5); }
  ctx.fillStyle = O.accent; ctx.fillRect(CX - 50, 60, 38, 12); ctx.fillStyle = '#111'; ctx.font = 'bold 10px sans-serif'; ctx.fillText('SEC', CX - 42, 70);
  ctx.fillStyle = O.accent; ctx.fillRect(CX + 20, 30, 22, 6);
  for (const s of [-1, 1]) { ctx.fillStyle = plate; ctx.fillRect(CX + s * 96 - 12, 0, 24, 200); }
  bloodOn(ctx, w, h, rnd, 9, 14); tear(ctx, CX + 84, 96, 18, 26, rnd, '#5a1414'); grime(ctx, w, h, rnd, 1.2);
};
T.coverall = (ctx, w, h, rnd, O) => {
  fabric(ctx, w, h, rnd, O.cloth, { weave: 0.06, mottle: 0.16 });
  for (const y of [140, 190]) { ctx.fillStyle = O.accent; ctx.fillRect(0, y, w, 12); ctx.fillStyle = col('#fff', 1, 0.35); ctx.fillRect(0, y + 4, w, 3); }
  line(ctx, CX, 0, CX, h, col('#000', 1, 0.5), 2); for (let y = 4; y < h; y += 6) line(ctx, CX - 3, y, CX + 3, y, '#7a7a70', 1);
  ctx.fillStyle = '#e0e0d4'; ctx.fillRect(CX + 40, 70, 40, 14); ctx.fillStyle = '#222'; ctx.font = '9px sans-serif'; ctx.fillText('MAINT.', CX + 44, 80);
  // acid burns
  for (let i = 0; i < 9; i++) { const x = rnd() * w, y = 20 + rnd() * 200, r = 6 + rnd() * 16; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col(O.skin, 1, 1)); g.addColorStop(0.6, col('#1a2a10', 1, 0.9)); g.addColorStop(1, col('#000', 1, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); }
  tear(ctx, CX - 20, 20, 44, 24, rnd, '#5a8a40', '#1a2a10'); // torn open at the throat
  bloodOn(ctx, w, h, rnd, 8, 12); grime(ctx, w, h, rnd, 1.4);
};
T.rags = (ctx, w, h, rnd, O) => {
  const sk = O.skin, dk = mix(sk, '#000000', 0.55), lt = mix(sk, '#ffffff', 0.15);
  ctx.fillStyle = sk; ctx.fillRect(0, 0, w, h);
  mottle(ctx, w, h, rnd, 90, 0.16, 26);
  for (const s of [-1, 1]) { blob(ctx, CX + s * 46, 66, 46, lt, 0.28); blob(ctx, CX + s * 46, 100, 30, dk, 0.4); } // pecs
  line(ctx, CX, 24, CX, h, col(dk, 1, 0.7), 2.5);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { ctx.fillStyle = col(dk, 1, 0.35); ctx.beginPath(); ctx.ellipse(CX + s * 22, 130 + i * 30, 20, 12, 0, 0, 6.283); ctx.fill(); ctx.fillStyle = col(lt, 1, 0.16); ctx.beginPath(); ctx.ellipse(CX + s * 22, 126 + i * 30, 15, 8, 0, 0, 6.283); ctx.fill(); }
  veins(ctx, w, h, rnd, '#3a2a4a', 22, 0.6); veins(ctx, w, h, rnd, '#7a2020', 6, 0.5);
  for (let i = 0; i < 7; i++) { const x = rnd() * w, y = 20 + rnd() * 200, a = rnd() * 3.14, l = 20 + rnd() * 40; line(ctx, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, col('#701818', 1, 0.9), 3); line(ctx, x, y - 1.5, x + Math.cos(a) * l, y + Math.sin(a) * l - 1.5, col('#d08a8a', 1, 0.4), 1); }
  stitches(ctx, CX - 80, 90, CX - 30, 200, 9);
  // leather bandolier + belt
  ctx.save(); ctx.translate(CX, 128); ctx.rotate(0.62); ctx.fillStyle = '#2c1e14'; ctx.fillRect(-190, -12, 380, 24); ctx.fillStyle = col('#000', 1, 0.3); ctx.fillRect(-190, 8, 380, 4); line(ctx, -190, -12, 190, -12, col('#a07a50', 1, 0.3), 1); for (let x = -180; x < 180; x += 26) { ctx.fillStyle = '#7a7060'; ctx.beginPath(); ctx.arc(x, 0, 2.6, 0, 6.283); ctx.fill(); } ctx.restore();
  ctx.fillStyle = '#25190f'; ctx.fillRect(0, 236, w, 20); for (let x = 8; x < w; x += 24) { ctx.fillStyle = '#7a7060'; ctx.beginPath(); ctx.arc(x, 246, 2.4, 0, 6.283); ctx.fill(); }
  bloodOn(ctx, w, h, rnd, 12, 16); grime(ctx, w, h, rnd, 1.0);
};
T.coat = (ctx, w, h, rnd, O) => {
  fabric(ctx, w, h, rnd, O.cloth, { weave: 0.05, mottle: 0.16 });
  for (const s of [-1, 1]) { poly(ctx, [CX + s * 10, 0, CX + s * 58, 0, CX + s * 22, 170, CX + s * 10, 150], mix(O.cloth, '#000', 0.35), '#000', 1); line(ctx, CX + s * 58, 0, CX + s * 22, 170, O.cloth2, 3); }
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) { const x = CX + s * 20, y = 34 + i * 40; const g = ctx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, 5.5); g.addColorStop(0, '#fff2b0'); g.addColorStop(0.5, '#c9a030'); g.addColorStop(1, '#4a3608'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 6.283); ctx.fill(); }
  ctx.fillStyle = O.cloth2; ctx.fillRect(0, 0, w, 9); ctx.fillRect(0, 232, w, 7); // red piping
  ctx.fillStyle = '#231a12'; ctx.fillRect(0, 214, w, 16); ctx.fillStyle = '#c9a030'; ctx.fillRect(CX - 10, 212, 20, 20); ctx.fillStyle = '#231a12'; ctx.fillRect(CX - 6, 216, 12, 12);
  for (const s of [-1, 1]) { ctx.fillStyle = '#c9a030'; ctx.fillRect(CX + s * 96 - 22, 8, 44, 6); }
  tear(ctx, CX + 74, 120, 24, 30, rnd, '#7a1c1c'); tear(ctx, 50, 180, 22, 26, rnd, '#3a1010');
  bloodOn(ctx, w, h, rnd, 12, 18); grime(ctx, w, h, rnd, 1.5);
};

// ---------------------------------------------------------------- sleeves (128x128). part 'u' = upper arm, 'f' = forearm
function paintSleeve(ctx, w, h, rnd, O, part) {
  const S = O.sleeve || 'long'; const st = O.style;
  if (S === 'none' || (S === 'short' && part === 'f') || S === 'bare') return paintSkin(ctx, w, h, rnd, O);
  const base = (S === 'under' || (S === 'short' && st === 'hivis')) ? O.cloth2 : O.cloth;
  fabric(ctx, w, h, rnd, base, { weave: 0.07, mottle: 0.16 });
  if (st === 'suit') { ctx.fillStyle = 'rgba(255,255,255,0.07)'; for (let x = 0; x < w; x += 9) ctx.fillRect(x, 0, 1, h); }
  if (st === 'trackie') { ctx.fillStyle = O.accent; ctx.fillRect(w * 0.5 - 4, 0, 8, h); }
  if (st === 'hivis') { if (part === 'u') { ctx.fillStyle = O.accent; ctx.fillRect(0, h - 26, w, 10); } }
  if (part === 'f') { ctx.fillStyle = col('#000', 1, 0.35); ctx.fillRect(0, h - 14, w, 14); ctx.fillStyle = col('#fff', 1, 0.1); ctx.fillRect(0, h - 15, w, 1); if (st === 'suit') { ctx.fillStyle = O.cloth2; ctx.fillRect(0, h - 10, w, 10); } if (st === 'uniform') { ctx.fillStyle = O.accent; ctx.fillRect(0, h - 22, w, 4); } }
  if (part === 'u' && st === 'uniform') { ctx.fillStyle = O.accent; ctx.fillRect(0, 0, w, 5); }
  if (part === 'u' && st === 'tactical') { ctx.fillStyle = O.accent; ctx.fillRect(w * 0.3, 20, 30, 20); }
  // elbow wear + folds
  for (let i = 0; i < 4; i++) line(ctx, 0, h * (0.3 + i * 0.16), w, h * (0.3 + i * 0.16) + (rnd() - 0.5) * 6, col('#000', 1, 0.16), 2);
  if ((O.gore ?? 0.6) > 0.2) { tear(ctx, rnd() * w, 20 + rnd() * 70, 14, 20, rnd, rnd() < 0.5 ? '#6a1818' : mix(O.skin, '#000', 0.3)); bloodOn(ctx, w, h, rnd, 5, 10); }
  grime(ctx, w, h, rnd, 1.2);
}
// trousers: 'thigh' (hip->knee) and 'shin' (knee->ankle)
function paintPants(ctx, w, h, rnd, O, part) {
  const st = O.style, base = O.pants;
  if (O.legs === 'bare') return paintSkin(ctx, w, h, rnd, O);
  fabric(ctx, w, h, rnd, base, { weave: st === 'hoodie' ? 0.1 : 0.06, mottle: 0.2 });
  if (st === 'suit') { ctx.fillStyle = 'rgba(255,255,255,0.07)'; for (let x = 0; x < w; x += 9) ctx.fillRect(x, 0, 1, h); line(ctx, w * 0.5, 0, w * 0.5, h, col('#000', 1, 0.3), 2); line(ctx, w * 0.5 + 1.5, 0, w * 0.5 + 1.5, h, col('#fff', 1, 0.08), 1); }
  if (st === 'hoodie') { blob(ctx, w * 0.5, h * 0.4, 40, '#a8c0e0', 0.22); for (let i = 0; i < 12; i++) line(ctx, rnd() * w, rnd() * h, rnd() * w, rnd() * h, col('#c0d0e8', 1, 0.14), 1); line(ctx, w * 0.5, 0, w * 0.5, h, col('#e0c070', 1, 0.3), 1); }
  if (st === 'hivis' && part === 'shin') { ctx.fillStyle = O.accent; ctx.fillRect(0, h * 0.55, w, 9); }
  if (st === 'uniform') { line(ctx, w * 0.5, 0, w * 0.5, h, O.accent, 3); }
  if (st === 'trackie') { ctx.fillStyle = O.accent; ctx.fillRect(w * 0.5 - 5, 0, 10, h); }
  if (st === 'tactical' && part === 'thigh') { ctx.fillStyle = col('#000', 1, 0.3); ctx.fillRect(18, 44, 44, 44); line(ctx, 18, 56, 62, 56, col('#000', 1, 0.6), 2); ctx.fillStyle = col('#fff', 1, 0.08); ctx.fillRect(18, 44, 44, 1); }
  if (st === 'coverall') { ctx.fillStyle = O.accent; ctx.fillRect(0, h * 0.5, w, 10); }
  if (part === 'shin') { ctx.fillStyle = col('#000', 1, 0.3); ctx.fillRect(0, h - 12, w, 12); }
  for (let i = 0; i < 3; i++) line(ctx, 0, h * (0.35 + i * 0.2), w, h * (0.35 + i * 0.2) + (rnd() - 0.5) * 8, col('#000', 1, 0.15), 2);
  // ragged tears with skin/blood beneath
  const nt = O.style === 'rags' ? 6 : 2;
  for (let i = 0; i < nt; i++) tear(ctx, rnd() * w, rnd() * h, 14 + rnd() * 10, 14 + rnd() * 16, rnd, rnd() < 0.5 ? mix(O.skin, '#000', 0.25) : '#6a1616');
  bloodOn(ctx, w, h, rnd, 6, 12); grime(ctx, w, h, rnd, 1.6);
}

// type-specific 'extra' / 'extra2' regions (256x128)
const XT = {};
XT.default = (ctx, w, h, rnd, O, which) => {
  if (which === 'extra') { fabric(ctx, w, h, rnd, mix(O.cloth, '#000000', 0.25), { weave: 0.05 }); grime(ctx, w, h, rnd, 1); }
  else { fabric(ctx, w, h, rnd, '#2a2018', { weave: 0.03 }); for (let i = 0; i < 40; i++) line(ctx, rnd() * w, rnd() * h, rnd() * w, rnd() * h, col('#a0805a', 1, 0.15), 1); grime(ctx, w, h, rnd, 0.6); }
};
XT.exploder = (ctx, w, h, rnd, O, which) => {
  if (which === 'extra') { // taut, bruised belly skin: purple mottling, stretch marks, dark vein channels
    ctx.fillStyle = O.belly || '#9a5a48'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) blob(ctx, rnd() * w, rnd() * h, 6 + rnd() * 18, rnd() < 0.5 ? '#5a2038' : '#d49a6a', 0.3);
    for (let i = 0; i < 30; i++) { const x = rnd() * w, y = rnd() * h; line(ctx, x, y, x + (rnd() - 0.5) * 36, y + 8 + rnd() * 16, col('#6a1a1a', 1, 0.55), 1.3); }
    veins(ctx, w, h, rnd, '#4a1030', 22, 0.75); bloodOn(ctx, w, h, rnd, 3, 10, 0.3);
  } else { fabric(ctx, w, h, rnd, O.cloth, { weave: 0.05 }); grime(ctx, w, h, rnd, 1); }
};
XT.trooper = (ctx, w, h, rnd, O, which) => {
  if (which === 'extra') { // helmet shell
    ctx.fillStyle = O.helmet || '#14161a'; ctx.fillRect(0, 0, w, h); mottle(ctx, w, h, rnd, 40, 0.2, 22);
    for (let i = 0; i < 60; i++) { const x = rnd() * w, y = rnd() * h, a = rnd() * 3.14, l = 4 + rnd() * 20; line(ctx, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, col('#c8ccd0', 1, 0.2), 0.8); }
    ctx.fillStyle = O.accent; ctx.fillRect(w * 0.42, 40, 44, 22); ctx.fillStyle = '#111'; ctx.font = 'bold 15px sans-serif'; ctx.fillText('SEC', w * 0.42 + 6, 57);
    ctx.fillStyle = col(O.accent, 1, 0.9); ctx.fillRect(0, 84, w, 8);
    bloodOn(ctx, w, h, rnd, 4, 12, 0.5);
  } else { fabric(ctx, w, h, rnd, mix(O.cloth, '#20241a', 0.5), { weave: 0.06 }); for (let x = 0; x < w; x += 10) line(ctx, x, 0, x, h, col('#000', 1, 0.3), 1); grime(ctx, w, h, rnd, 1); }
};
XT.spitter = (ctx, w, h, rnd, O, which) => {
  if (which === 'extra') { // translucent glowing acid sac (self-lit look: drawn bright)
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#7ce04a'); g.addColorStop(1, '#3a9a20'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) blob(ctx, rnd() * w, rnd() * h, 5 + rnd() * 14, rnd() < 0.5 ? '#d8ff90' : '#1f6a10', 0.4);
    veins(ctx, w, h, rnd, '#144a0a', 14, 0.7);
  } else { fabric(ctx, w, h, rnd, '#2a3a1c', { weave: 0.03 }); grime(ctx, w, h, rnd, 1); }
};
XT.brute = (ctx, w, h, rnd, O, which) => {
  if (which === 'extra') { paintMetal(ctx, w, h, rnd, { metal: '#3c3a38', rust: 0.7, gore: 0.5 }); }
  else { ctx.fillStyle = '#2c1e14'; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 80; i++) line(ctx, rnd() * w, rnd() * h, rnd() * w, rnd() * h, col('#a08060', 1, 0.14), 1); mottle(ctx, w, h, rnd, 20, 0.2); bloodOn(ctx, w, h, rnd, 4, 10, 0.4); }
};
XT.tyrant = (ctx, w, h, rnd, O, which) => {
  if (which === 'extra') { // brass fittings / rust-plate
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#e0b840'); g.addColorStop(0.5, '#a07a18'); g.addColorStop(1, '#5a4008'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rnd, 40, 0.25, 18); fibres(ctx, w, h, rnd, 220, 0.12, 14);
  } else { paintMetal(ctx, w, h, rnd, { metal: '#6a5346', rust: 0.75, gore: 0.6 }); }
};

// ---------------------------------------------------------------- outfits
export const OUTFITS = {
  shambler: [
    { style: 'suit', cloth: '#2b2e36', cloth2: '#d9d5c9', accent: '#7c1f1f', pants: '#2b2e36', shoe: '#17130f', skin: '#a9a794', hair: '#2a2119', gore: 0.8, face: { eye: 'cloudy' } },
    { style: 'hivis', cloth: '#e5701b', cloth2: '#22303f', accent: '#c8ccc8', pants: '#2a3038', shoe: '#2b2118', skin: '#b3a58f', hair: '#463526', gore: 0.9, sleeve: 'short', face: { eye: 'cloudy', mouth: 'gape' } },
    { style: 'hoodie', cloth: '#4c5762', cloth2: '#3a4452', accent: '#d8d8d0', pants: '#33465f', shoe: '#8b8b86', shoeLace: '#eee', skin: '#9aa593', hair: '#1c1814', gore: 0.8, face: { eye: 'dead', mouth: 'shut', blood: 0.9 } },
    { style: 'uniform', cloth: '#232b3c', cloth2: '#a9b6c4', accent: '#d9b13a', pants: '#1b2336', shoe: '#101010', skin: '#b0a498', hair: '#5a5148', gore: 0.9, face: { eye: 'cloudy', mouth: 'gape' } },
  ],
  runner: [
    { style: 'trackie', cloth: '#5a616c', cloth2: '#20242c', accent: '#d8d8d8', pants: '#4a505a', shoe: '#c8c8c0', skin: '#b9b3a2', hair: '#2a2018', gore: 1, face: { eye: 'socket', mouth: 'scream', blood: 1, hollow: 0.8 } },
    { style: 'shirt', cloth: '#cfcac0', cloth2: '#a8a498', accent: '#333', pants: '#22252c', shoe: '#14110e', skin: '#aab29c', hair: '#4a3a2a', gore: 1, torn: true, face: { eye: 'socket', mouth: 'scream', blood: 1, hollow: 0.8 } },
    { style: 'hoodie', cloth: '#7a2a2c', cloth2: '#4a1a1c', accent: '#e8e8e0', pants: '#252830', shoe: '#606060', skin: '#c0b0a2', hair: '#181410', gore: 1, face: { eye: 'socket', mouth: 'scream', blood: 1, hollow: 0.8 } },
  ],
  trooper: [
    { style: 'tactical', cloth: '#1c2233', cloth2: '#141820', accent: '#e8b020', pants: '#1a1f2c', shoe: '#0c0c0c', skin: '#a8a696', hair: '#1a1a1a', helmet: '#101318', metal: '#23272e', rust: 0.15, gore: 0.5, sleeve: 'long', face: { eye: 'socket', mouth: 'gape', blood: 0.8, hollow: 0.7 } },
    { style: 'tactical', cloth: '#2c2f28', cloth2: '#1e2018', accent: '#e8641c', pants: '#25281f', shoe: '#0c0c0c', skin: '#9fa891', hair: '#1a1a1a', helmet: '#2a2c25', metal: '#2a2c2c', rust: 0.25, gore: 0.6, sleeve: 'long', face: { eye: 'socket', mouth: 'gape', blood: 0.8, hollow: 0.7 } },
  ],
  spitter: [
    { style: 'coverall', cloth: '#31452a', cloth2: '#20301a', accent: '#c8c040', pants: '#31452a', shoe: '#1c1a14', skin: '#8fa88a', hair: '#1a2214', gore: 0.7, sleeve: 'long', face: { eye: 'socket', mouth: 'wide', blood: 1, drool: '#3a9a20', hollow: 0.7 } },
    { style: 'coverall', cloth: '#c4621a', cloth2: '#8a4410', accent: '#d0d0c8', pants: '#c4621a', shoe: '#1c1a14', skin: '#9ab08c', hair: '#1a2214', gore: 0.7, sleeve: 'long', face: { eye: 'socket', mouth: 'wide', blood: 1, drool: '#3a9a20', hollow: 0.7 } },
  ],
  brute: [
    { style: 'rags', cloth: '#5a4a3a', cloth2: '#3a3028', accent: '#6a6a60', pants: '#4a3f34', shoe: '#2a2018', skin: '#6c5a5c', hair: '#1a1410', metal: '#4a4642', rust: 0.7, gore: 1, sleeve: 'bare', face: { eye: 'socket', mouth: 'gape', blood: 1, scars: 4, hollow: 0.6 } },
    { style: 'rags', cloth: '#3a3a3e', cloth2: '#28282c', accent: '#6a6a60', pants: '#33302e', shoe: '#2a2018', skin: '#76645c', hair: '#241c16', metal: '#4a4642', rust: 0.7, gore: 1, sleeve: 'bare', face: { eye: 'socket', mouth: 'gape', blood: 1, scars: 4, hollow: 0.6 } },
  ],
  exploder: [
    { style: 'shirt', cloth: '#b8c4d0', cloth2: '#8a97a6', accent: '#333', pants: '#3a3a3a', shoe: '#1a1512', skin: '#c4b48a', belly: '#9a5a48', hair: '#3a2a1a', gore: 0.8, torn: false, sleeve: 'long', face: { eye: 'cloudy', mouth: 'gape', blood: 0.6 } },
    { style: 'hivis', cloth: '#d8842a', cloth2: '#22303f', accent: '#c8ccc8', pants: '#2a3038', shoe: '#2a2118', skin: '#c8b890', belly: '#a0644c', hair: '#3a2a1a', gore: 0.8, sleeve: 'short', face: { eye: 'cloudy', mouth: 'gape', blood: 0.6 } },
  ],
  tyrant: [
    { style: 'coat', cloth: '#2a3450', cloth2: '#8a1c1c', accent: '#c9a030', pants: '#1e222c', shoe: '#0c0a08', skin: '#6a5858', hair: '#141210', metal: '#6a5a50', rust: 0.8, gore: 1, sleeve: 'long', face: { eye: 'socket', mouth: 'scream', blood: 1, scars: 5, hollow: 0.9 } },
  ],
};

const PAINT = {
  face: (c, w, h, r, O, t) => paintFace(c, w, h, r, O, t), skin: paintSkin, gore: paintGore, bone: paintBone, metal: paintMetal, shoe: paintShoe, hair: paintHair,
  torso: (c, w, h, r, O) => (T[O.style] || T.suit)(c, w, h, r, O),
  uarm: (c, w, h, r, O) => paintSleeve(c, w, h, r, O, 'u'), farm: (c, w, h, r, O) => paintSleeve(c, w, h, r, O, 'f'),
  thigh: (c, w, h, r, O) => paintPants(c, w, h, r, O, 'thigh'), shin: (c, w, h, r, O) => paintPants(c, w, h, r, O, 'shin'),
  extra: (c, w, h, r, O, t) => (XT[t] || XT.default)(c, w, h, r, O, 'extra'), extra2: (c, w, h, r, O, t) => (XT[t] || XT.default)(c, w, h, r, O, 'extra2'),
};

export function makeAtlas(type, outfit, seed) {
  const O = OUTFITS[type][outfit];
  const rnd = mulberry32(seed * 7919 + outfit * 104729 + type.length * 131);
  return canvasTexture(AW, AH, (ctx) => {
    ctx.fillStyle = '#6a6a6a'; ctx.fillRect(0, 0, AW, AH);
    for (const name of Object.keys(REG)) {
      const [x, y, w, h] = REG[name];
      ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      PAINT[name](ctx, w, h, rnd, O, type);
      // ground-in dirt + desaturation so nothing looks factory-fresh
      if (name !== 'face' && name !== 'metal') { ctx.fillStyle = 'rgba(38,32,26,0.2)'; ctx.fillRect(0, 0, w, h); mottle(ctx, w, h, rnd, Math.round(w * h / 1400), 0.16, 26); }
      ctx.restore();
    }
  }, { wrap: false, aniso: 4 });
}

// Small shared canvas textures used by rig extras (blob shadow, blood pool, glow sprite).
export function makeBlobTexture(kind) {
  return canvasTexture(128, 128, (ctx, w, h) => {
    if (kind === 'shadow') {
      const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62); g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.55, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else if (kind === 'glow') {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else if (kind === 'ring') {
      const g = ctx.createRadialGradient(64, 64, 34, 64, 64, 62); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.72, 'rgba(255,255,255,0.9)'); g.addColorStop(0.85, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else { // blood pool: irregular dark-red puddle with a glossy highlight
      const rnd = mulberry32(99); const pts = [];
      for (let i = 0; i < 22; i++) { const a = i / 22 * 6.283, r = 40 + rnd() * 22 + Math.sin(a * 3) * 5; pts.push(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
      ctx.filter = 'blur(2px)'; poly(ctx, pts, 'rgba(70,6,8,0.92)'); ctx.filter = 'none';
      blob(ctx, 50, 50, 26, '#8a1414', 0.6); blob(ctx, 74, 78, 18, '#2a0404', 0.5); blob(ctx, 46, 44, 8, '#ffb0b0', 0.28);
    }
  }, { wrap: false, aniso: 1 });
}
