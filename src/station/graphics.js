// Procedural 2D graphics for the station: poster / sign / decal atlases drawn on canvases once at init.
import * as THREE from 'three';
import { mulberry32 } from '../texutil.js';
import { cv, rgb, hash2 } from '../textures.js';
import { TEX_FULL } from '../texutil.js';
const LOWF = TEX_FULL ? 1 : 0.5; // scale of the low-frequency atlases (grime / blood): half the resolution, a quarter of the memory

const FONT = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif';
const font = (px, w = 'bold', it = '') => `${it} ${w} ${px}px ${FONT}`;

export class Atlas {
  // scale < 1: the canvas is smaller than the design space `size`; all coordinates (items, rects) stay in design units, the context is scaled once
  constructor(size, gutter = 4, scale = 1) { this.size = size; this.g = gutter; this.c = cv(size * scale, size * scale); this.ctx = this.c.getContext('2d'); if (scale !== 1) this.ctx.scale(scale, scale); this.x = 0; this.y = 0; this.rowH = 0; this.rects = {}; }
  add(name, w, h, draw) {
    if (this.x + w + this.g > this.size) { this.x = 0; this.y += this.rowH + this.g; this.rowH = 0; }
    if (this.y + h > this.size) { console.warn('[station] atlas overflow', name); return; }
    const ctx = this.ctx; ctx.save(); ctx.translate(this.x, this.y); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip(); draw(ctx, w, h); ctx.restore();
    const S = this.size; this.rects[name] = [(this.x + 0.5) / S, 1 - (this.y + h - 0.5) / S, (this.x + w - 0.5) / S, 1 - (this.y + 0.5) / S, w / h];
    this.x += w + this.g; this.rowH = Math.max(this.rowH, h);
  }
  texture(aniso = 8) { const t = new THREE.CanvasTexture(this.c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; }
}

// ------------------------------------------------------------------------------------------------ text helpers
function text(ctx, s, x, y, px, col, { align = 'center', w = 'bold', ls = 0, it = '', stroke = null, sw = 0, maxW = 0 } = {}) {
  ctx.font = font(px, w, it); ctx.textAlign = align; ctx.textBaseline = 'middle'; if (ctx.letterSpacing !== undefined) ctx.letterSpacing = `${ls}px`;
  if (maxW) { const m = ctx.measureText(s).width; if (m > maxW) { px *= maxW / m; ctx.font = font(px, w, it); } }
  if (stroke) { ctx.lineWidth = sw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
  ctx.fillStyle = col; ctx.fillText(s, x, y); if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
}
function rr(ctx, x, y, w, h, r, fill, stroke, lw = 1) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); } }
function arrow(ctx, x, y, s, dir, col) { ctx.save(); ctx.translate(x, y); ctx.rotate(dir); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-s, -s * 0.28); ctx.lineTo(s * 0.2, -s * 0.28); ctx.lineTo(s * 0.2, -s * 0.7); ctx.lineTo(s, 0); ctx.lineTo(s * 0.2, s * 0.7); ctx.lineTo(s * 0.2, s * 0.28); ctx.lineTo(-s, s * 0.28); ctx.closePath(); ctx.fill(); ctx.restore(); }
function runningMan(ctx, cx, cy, s, col) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 0.13;
  ctx.beginPath(); ctx.arc(0.05, -0.55, 0.12, 0, 6.28); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0.02, -0.4); ctx.lineTo(-0.08, -0.05); ctx.lineTo(-0.3, 0.12); ctx.moveTo(-0.08, -0.05); ctx.lineTo(0.12, 0.2); ctx.lineTo(0.05, 0.55);
  ctx.moveTo(0.02, -0.38); ctx.lineTo(0.3, -0.28); ctx.moveTo(0.0, -0.36); ctx.lineTo(-0.25, -0.22); ctx.lineTo(-0.36, -0.05); ctx.stroke(); ctx.restore();
}
// dirt / fold / tear overlay for paper things
function distress(ctx, w, h, rnd, amt = 1, tearAlpha = true) {
  for (let i = 0; i < 6 * amt; i++) { const x = rnd() * w, y = rnd() * h, r = 12 + rnd() * 40; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(70,50,30,${0.10 + rnd() * 0.16})`); g.addColorStop(1, 'rgba(70,50,30,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(0, h * 0.5, w, 1); ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(0, h * 0.5 + 1, w, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(w * 0.5, 0, 1, h);
  for (let i = 0; i < 26 * amt; i++) { const x = rnd() * w, y = rnd() * h; ctx.strokeStyle = `rgba(255,255,255,${0.1 + rnd() * 0.25})`; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 30); ctx.stroke(); }
  // vertical grime drips from the top edge
  for (let i = 0; i < 8 * amt; i++) { const x = rnd() * w, l = 20 + rnd() * h * 0.5; const g = ctx.createLinearGradient(0, 0, 0, l); g.addColorStop(0, 'rgba(30,25,20,0.35)'); g.addColorStop(1, 'rgba(30,25,20,0)'); ctx.fillStyle = g; ctx.fillRect(x, 0, 2 + rnd() * 5, l); }
  if (tearAlpha) { // torn corners (alpha cut)
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000';
    for (const c of [[0, 0], [w, 0], [0, h], [w, h]]) if (rnd() < 0.55) { const s = 10 + rnd() * 34; ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(c[0] + (c[0] ? -s : s), c[1]); ctx.lineTo(c[0] + (c[0] ? -s * 0.3 : s * 0.3), c[1] + (c[1] ? -s * 0.8 : s * 0.8)); ctx.lineTo(c[0], c[1] + (c[1] ? -s : s)); ctx.closePath(); ctx.fill(); }
    if (rnd() < 0.5) { const x = rnd() * w; ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 8 + rnd() * 14, h); ctx.lineTo(x + 4, h - 10 - rnd() * 40); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
}

// ------------------------------------------------------------------------------------------------ paper posters (lit)
function posterGap(ctx, w, h) {
  ctx.fillStyle = '#eec21c'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, 14); ctx.fillRect(0, h - 14, w, 14);
  text(ctx, 'MIND', w / 2, 62, 80, '#111', { ls: 2 }); text(ctx, 'THE', w / 2, 118, 44, '#111', { ls: 6 }); text(ctx, 'GAP', w / 2, 178, 80, '#111', { ls: 2 });
  ctx.fillStyle = '#111'; ctx.fillRect(20, 250, 84, 70); ctx.fillRect(w - 104, 250, 84, 70); ctx.fillStyle = '#c62b1c'; ctx.fillRect(104, 300, w - 208, 20);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(70, 246); ctx.lineTo(74, 218); ctx.lineTo(96, 200); ctx.moveTo(74, 218); ctx.lineTo(52, 196); ctx.moveTo(74, 246); ctx.lineTo(112, 270); ctx.stroke(); ctx.beginPath(); ctx.arc(74, 196, 10, 0, 6.28); ctx.fillStyle = '#111'; ctx.fill();
  arrow(ctx, w / 2, 285, 16, Math.PI / 2, '#c62b1c'); text(ctx, 'Stand behind the yellow line', w / 2, h - 28, 14, '#111', { w: '600' });
}
function posterMissing(ctx, w, h) {
  ctx.fillStyle = '#e8e4d8'; ctx.fillRect(0, 0, w, h); text(ctx, 'MISSING', w / 2, 40, 54, '#111', { ls: 4 });
  ctx.fillStyle = '#7d7f7c'; ctx.fillRect(38, 72, w - 76, 150); const g = ctx.createRadialGradient(w / 2, 130, 5, w / 2, 130, 80); g.addColorStop(0, '#b3b3ac'); g.addColorStop(1, '#4f524f'); ctx.fillStyle = g; ctx.fillRect(38, 72, w - 76, 150);
  ctx.fillStyle = '#25272a'; ctx.beginPath(); ctx.arc(w / 2, 128, 33, 0, 6.28); ctx.fill(); ctx.beginPath(); ctx.ellipse(w / 2, 226, 70, 56, 0, Math.PI, 0); ctx.fill();
  text(ctx, 'HAVE YOU SEEN', w / 2, 240, 15, '#111', { ls: 2 }); text(ctx, 'ELLA MARSH?', w / 2, 262, 24, '#111');
  text(ctx, 'Last seen at Station Zero, 00:47', w / 2, 286, 12, '#333', { w: '600' }); text(ctx, 'Wearing a grey coat. 5\'6". Please call', w / 2, 302, 11, '#333', { w: '500' });
  for (let i = 0; i < 7; i++) { const x = 20 + i * 31; ctx.fillStyle = '#111'; ctx.fillRect(x + 27, 318, 1, 42); ctx.save(); ctx.translate(x + 14, 356); ctx.rotate(-Math.PI / 2); ctx.font = font(8, 'bold'); ctx.fillStyle = '#111'; ctx.textAlign = 'left'; ctx.fillText('555-0147', 0, 0); ctx.restore(); }
}
function posterConcert(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1b0b33'); g.addColorStop(0.55, '#5b1466'); g.addColorStop(1, '#e0417b'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const m = ctx.createRadialGradient(w / 2, 120, 8, w / 2, 120, 90); m.addColorStop(0, '#fff6d8'); m.addColorStop(0.45, '#f7c2d8'); m.addColorStop(1, 'rgba(255,120,200,0)'); ctx.fillStyle = m; ctx.beginPath(); ctx.arc(w / 2, 120, 90, 0, 6.28); ctx.fill();
  ctx.fillStyle = '#0d0714'; ctx.beginPath(); ctx.moveTo(0, 240); for (let x = 0; x <= w; x += 20) ctx.lineTo(x, 200 + Math.sin(x * 0.11) * 18 + ((x / 20) % 2) * 14); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
  text(ctx, 'THE DEAD', w / 2, 262, 44, '#3cf2ff', { ls: 2, stroke: '#0b1f3a', sw: 6 }); text(ctx, 'LINE', w / 2, 306, 52, '#ff3ea5', { ls: 8, stroke: '#0b1f3a', sw: 6 });
  text(ctx, 'LIVE · FRI 13 · THE TERMINAL', w / 2, 342, 12, '#fff', { w: '600', ls: 1 });
}
function posterPerfume(ctx, w, h) {
  ctx.fillStyle = '#0c0c0f'; ctx.fillRect(0, 0, w, h); const g = ctx.createRadialGradient(w / 2, 150, 4, w / 2, 150, 130); g.addColorStop(0, 'rgba(210,170,80,0.55)'); g.addColorStop(1, 'rgba(210,170,80,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1a1a20'; ctx.strokeStyle = '#d8b25a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(w / 2 - 34, 100, 68, 110, 8); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#d8b25a'; ctx.fillRect(w / 2 - 14, 78, 28, 24); ctx.fillStyle = 'rgba(216,178,90,0.25)'; ctx.fillRect(w / 2 - 28, 108, 12, 96);
  text(ctx, 'NOIR', w / 2, 262, 50, '#d8b25a', { w: '300', ls: 14 }); ctx.fillStyle = '#d8b25a'; ctx.fillRect(w / 2 - 50, 290, 100, 1);
  text(ctx, 'eau de nuit', w / 2, 310, 16, '#bda36a', { w: '300', it: 'italic', ls: 4 }); text(ctx, 'for those who stay out late', w / 2, 336, 11, '#8b7a52', { w: '300', ls: 2 });
}
function posterHealth(ctx, w, h) {
  ctx.fillStyle = '#e9f1f4'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#0f5f8a'; ctx.fillRect(0, 0, w, 78); text(ctx, 'FEELING UNWELL?', w / 2, 40, 27, '#fff', { maxW: w - 20 });
  ctx.strokeStyle = '#c12b2b'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(w / 2, 152, 42, 0, 6.28); ctx.stroke(); ctx.fillStyle = '#c12b2b';
  for (let a = 0; a < 3; a++) { ctx.save(); ctx.translate(w / 2, 152); ctx.rotate(a * 2.094); ctx.beginPath(); ctx.arc(0, -18, 12, 0, 6.28); ctx.fill(); ctx.restore(); }
  const items = ['Fever or chills', 'Pale, cold skin', 'Sudden hunger', 'Loss of speech'];
  items.forEach((s, i) => { ctx.fillStyle = '#0f5f8a'; ctx.fillRect(28, 224 + i * 28, 13, 13); text(ctx, s, 52, 231 + i * 28, 17, '#123', { align: 'left', w: '600' }); });
  text(ctx, 'DO NOT TRAVEL. REPORT AT ONCE.', w / 2, 344, 12, '#c12b2b', { ls: 1, maxW: w - 20 });
}
function posterWatch(ctx, w, h) {
  ctx.fillStyle = '#8a1d1a'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#e9d9a9'; ctx.beginPath(); ctx.arc(w / 2, 108, 62, 0, 6.28); ctx.fill(); ctx.fillStyle = '#8a1d1a'; ctx.beginPath(); ctx.arc(w / 2, 108, 54, 0, 6.28); ctx.fill();
  ctx.fillStyle = '#e9d9a9'; ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 20 : 46; ctx.lineTo(w / 2 + Math.cos(a) * r, 108 + Math.sin(a) * r); } ctx.closePath(); ctx.fill();
  text(ctx, 'THE CITY', w / 2, 210, 42, '#e9d9a9', { ls: 3 }); text(ctx, 'NEEDS YOU', w / 2, 254, 42, '#e9d9a9', { ls: 3 }); ctx.fillStyle = '#e9d9a9'; ctx.fillRect(30, 280, w - 60, 3);
  text(ctx, 'JOIN THE CITY WATCH', w / 2, 306, 18, '#fff', { ls: 2 }); text(ctx, 'Recruiting at Central Hall. Bring your own boots.', w / 2, 334, 10.5, '#e9d9a9', { w: '600', maxW: w - 24 });
}
function posterBurger(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ffcd1f'); g.addColorStop(1, '#e8571a'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  text(ctx, 'ZERO', w / 2, 52, 66, '#b0170f', { ls: 4, stroke: '#fff', sw: 6 }); text(ctx, 'BURGER', w / 2, 108, 52, '#b0170f', { ls: 2, stroke: '#fff', sw: 6 });
  ctx.fillStyle = '#c47a2a'; ctx.beginPath(); ctx.ellipse(w / 2, 168, 66, 30, 0, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#3a6b1c'; ctx.fillRect(w / 2 - 68, 168, 136, 8); ctx.fillStyle = '#5a2a14'; ctx.fillRect(w / 2 - 64, 176, 128, 20); ctx.fillStyle = '#f2c230'; ctx.fillRect(w / 2 - 70, 196, 140, 6); ctx.fillStyle = '#c47a2a'; ctx.beginPath(); ctx.ellipse(w / 2, 208, 62, 22, 0, 0, Math.PI); ctx.fill();
  text(ctx, 'EAT BEFORE', w / 2, 262, 26, '#fff', { stroke: '#7a1a0a', sw: 5 }); text(ctx, 'THE LAST TRAIN', w / 2, 296, 26, '#fff', { stroke: '#7a1a0a', sw: 5, maxW: w - 20 }); text(ctx, 'Open 24h · Platform 1 kiosk', w / 2, 334, 13, '#5a1408', { w: '600' });
}
function posterEvac(ctx, w, h) {
  ctx.fillStyle = '#0c7a4a'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.fillRect(14, 14, w - 28, h - 28); ctx.fillStyle = '#0c7a4a'; ctx.fillRect(14, 14, w - 28, 62); text(ctx, 'IN AN EMERGENCY', w / 2, 46, 24, '#fff', { maxW: w - 40 });
  runningMan(ctx, w / 2, 150, 70, '#0c7a4a'); arrow(ctx, w / 2 + 62, 148, 26, 0, '#0c7a4a');
  text(ctx, 'Do not use the lifts', w / 2, 226, 16, '#111', { w: '600' }); text(ctx, 'Follow the green signs', w / 2, 250, 16, '#111', { w: '600' }); text(ctx, 'Stay calm. Stay together.', w / 2, 274, 16, '#111', { w: '600' }); text(ctx, 'Do not stop for belongings.', w / 2, 298, 14, '#a22', { w: '700' });
  ctx.fillStyle = '#0c7a4a'; ctx.fillRect(14, 322, w - 28, 24); text(ctx, 'STATION ZERO · PLATFORM 2', w / 2, 334, 12, '#fff', { ls: 1 });
}
function noticeSuspended(ctx, w, h) { ctx.fillStyle = '#f2f0e6'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#c62b1c'; ctx.fillRect(0, 0, w, 42); text(ctx, 'NOTICE', w / 2, 22, 24, '#fff', { ls: 3 }); text(ctx, 'ALL SERVICES', w / 2, 66, 15, '#111'); text(ctx, 'SUSPENDED', w / 2, 88, 20, '#c62b1c'); text(ctx, 'until further', w / 2, 116, 12, '#222', { w: '500' }); text(ctx, 'notice. We', w / 2, 130, 12, '#222', { w: '500' }); text(ctx, 'apologise for', w / 2, 144, 12, '#222', { w: '500' }); text(ctx, 'the delay.', w / 2, 158, 12, '#222', { w: '500' }); }
function noticeNoSmoke(ctx, w, h) { ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#c62b1c'; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(w / 2, 62, 44, 0, 6.28); ctx.stroke(); ctx.fillStyle = '#222'; ctx.fillRect(w / 2 - 30, 58, 50, 8); ctx.fillStyle = '#c62b1c'; ctx.fillRect(w / 2 + 20, 58, 10, 8); ctx.strokeStyle = '#c62b1c'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(w / 2 - 32, 94); ctx.lineTo(w / 2 + 32, 30); ctx.stroke(); text(ctx, 'NO SMOKING', w / 2, 130, 17, '#111', { maxW: w - 12 }); text(ctx, 'Fine £200', w / 2, 148, 11, '#444', { w: '600' }); }
function noticeCctv(ctx, w, h) { ctx.fillStyle = '#f2c81c'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#111'; ctx.fillRect(6, 6, w - 12, h - 12); ctx.fillStyle = '#f2c81c'; ctx.fillRect(9, 9, w - 18, h - 18); ctx.fillStyle = '#111'; ctx.fillRect(w / 2 - 34, 40, 52, 30); ctx.beginPath(); ctx.moveTo(w / 2 + 18, 46); ctx.lineTo(w / 2 + 40, 36); ctx.lineTo(w / 2 + 40, 74); ctx.lineTo(w / 2 + 18, 64); ctx.fill(); ctx.fillStyle = '#c62b1c'; ctx.beginPath(); ctx.arc(w / 2 - 24, 48, 4, 0, 6.28); ctx.fill(); text(ctx, 'CCTV', w / 2, 100, 26, '#111'); text(ctx, 'IN OPERATION', w / 2, 122, 14, '#111', { maxW: w - 20 }); text(ctx, '24 hours a day', w / 2, 142, 10.5, '#111', { w: '600' }); }
function noticeDanger(ctx, w, h) { ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#f2c81c'; ctx.beginPath(); ctx.moveTo(w / 2, 10); ctx.lineTo(w - 8, 110); ctx.lineTo(8, 110); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 6; ctx.stroke(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(w / 2 + 6, 36); ctx.lineTo(w / 2 - 14, 76); ctx.lineTo(w / 2 - 2, 76); ctx.lineTo(w / 2 - 8, 100); ctx.lineTo(w / 2 + 16, 60); ctx.lineTo(w / 2 + 3, 60); ctx.closePath(); ctx.fill(); text(ctx, 'DANGER', w / 2, 130, 18, '#c62b1c'); text(ctx, '750V DC', w / 2, 148, 14, '#111'); }
function noteHandwritten(ctx, w, h) { ctx.fillStyle = '#efe6a8'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = 'rgba(0,0,0,0.05)'; for (let y = 24; y < h; y += 17) ctx.fillRect(0, y, w, 1); const lines = ['they', 'come up', 'the tunnels', 'at 00:47', "don't", 'look back']; lines.forEach((s, i) => { ctx.save(); ctx.translate(w / 2, 24 + i * 22); ctx.rotate((hash2(i, 3) - 0.5) * 0.06); text(ctx, s, 0, 0, i === 4 ? 21 : 17, '#2a2a72', { it: 'italic', w: '600' }); ctx.restore(); }); }
function noteFloorPlan(ctx, w, h) { ctx.fillStyle = '#e4ecf2'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#12457a'; ctx.fillRect(0, 0, w, 24); text(ctx, 'FIRE EVACUATION', w / 2, 12, 12, '#fff', { maxW: w - 8 }); ctx.strokeStyle = '#12457a'; ctx.lineWidth = 2; ctx.strokeRect(14, 40, w - 28, 62); ctx.fillStyle = '#c62b1c'; ctx.beginPath(); ctx.arc(w / 2 - 12, 74, 4, 0, 6.28); ctx.fill(); ctx.strokeStyle = '#0c7a4a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w / 2 - 12, 74); ctx.lineTo(w - 24, 74); ctx.stroke(); arrow(ctx, w - 20, 74, 8, 0, '#0c7a4a'); text(ctx, 'YOU ARE HERE', w / 2, 122, 10, '#c62b1c'); }
function noticeLift(ctx, w, h) { ctx.fillStyle = '#eceaea'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#222'; ctx.fillRect(0, 0, w, 6); text(ctx, 'LIFT', w / 2, 44, 34, '#111'); text(ctx, 'OUT OF', w / 2, 84, 20, '#c62b1c'); text(ctx, 'SERVICE', w / 2, 108, 20, '#c62b1c'); text(ctx, 'Use stairs to the', w / 2, 136, 10.5, '#222', { w: '500' }); text(ctx, 'mezzanine', w / 2, 148, 10.5, '#222', { w: '500' }); }
function routeMap(ctx, w, h) {
  ctx.fillStyle = '#f1efe8'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#0d2c58'; ctx.fillRect(0, 0, w, 24); text(ctx, 'NORTHLINE', 62, 12, 16, '#fff', { ls: 2 }); text(ctx, 'Platform 2 · All stations', w - 120, 12, 11, '#bcd', { w: '500' });
  ctx.strokeStyle = '#d23a2a'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(24, 72); ctx.lineTo(w - 24, 72); ctx.stroke();
  ctx.strokeStyle = '#1b6fb8'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(w * 0.55, 108); ctx.lineTo(w * 0.55, 72); ctx.lineTo(w * 0.72, 40); ctx.stroke();
  const names = ['Harbour', 'Millbank', 'Ashgrove', 'Old Quay', 'STATION ZERO', 'Kingsway', 'Vale Park', 'Northgate'];
  names.forEach((n, i) => { const x = 40 + i * ((w - 80) / 7), me = i === 4; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, 72, me ? 9 : 6, 0, 6.28); ctx.fill(); ctx.stroke(); ctx.save(); ctx.translate(x, 88); ctx.rotate(0.6); ctx.font = font(me ? 12 : 11, me ? 'bold' : '600'); ctx.textAlign = 'left'; ctx.fillStyle = me ? '#c62b1c' : '#111'; ctx.fillText(n, 0, 6); ctx.restore(); });
  ctx.fillStyle = '#c62b1c'; ctx.beginPath(); ctx.moveTo(40 + 4 * ((w - 80) / 7), 50); ctx.lineTo(40 + 4 * ((w - 80) / 7) - 8, 38); ctx.lineTo(40 + 4 * ((w - 80) / 7) + 8, 38); ctx.fill(); text(ctx, 'YOU ARE HERE', 40 + 4 * ((w - 80) / 7), 30, 9, '#c62b1c', { ls: 1 });
}

// ------------------------------------------------------------------------------------------------ glow (backlit) posters & signs
function adTravel(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5ec0ee'); g.addColorStop(0.55, '#fbd48a'); g.addColorStop(0.56, '#1d6f9c'); g.addColorStop(1, '#0d3a5a'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(w * 0.68, 118, 34, 0, 6.28); ctx.fill(); ctx.fillStyle = '#3a4f6a'; ctx.beginPath(); ctx.moveTo(0, 198); ctx.lineTo(60, 150); ctx.lineTo(110, 190); ctx.lineTo(160, 140); ctx.lineTo(w, 200); ctx.lineTo(w, 200); ctx.lineTo(0, 200); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; for (let i = 0; i < 8; i++) ctx.fillRect(20 + i * 24, 210 + i * 10, 90 - i * 6, 3); text(ctx, 'ASHGROVE', w / 2, 40, 40, '#fff', { stroke: '#0d3a5a', sw: 6, ls: 2 }); text(ctx, 'Sun. Sea. 12 minutes', w / 2, 74, 15, '#0d3a5a', { w: '700' });
  text(ctx, 'from Station Zero', w / 2, 92, 15, '#0d3a5a', { w: '700' }); text(ctx, 'Northline · every 6 min', w / 2, h - 34, 13, '#cde', { w: '600' });
}
function adVolt(ctx, w, h) {
  ctx.fillStyle = '#08131a'; ctx.fillRect(0, 0, w, h); const g = ctx.createRadialGradient(w / 2, 160, 4, w / 2, 160, 150); g.addColorStop(0, 'rgba(60,255,120,0.75)'); g.addColorStop(1, 'rgba(60,255,120,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#12252c'; ctx.beginPath(); ctx.roundRect(w / 2 - 34, 96, 68, 150, 16); ctx.fill(); ctx.fillStyle = '#39ff7a'; ctx.beginPath(); ctx.roundRect(w / 2 - 30, 130, 60, 60, 4); ctx.fill();
  ctx.fillStyle = '#08131a'; ctx.beginPath(); ctx.moveTo(w / 2 + 6, 136); ctx.lineTo(w / 2 - 14, 168); ctx.lineTo(w / 2 - 2, 168); ctx.lineTo(w / 2 - 8, 186); ctx.lineTo(w / 2 + 14, 154); ctx.lineTo(w / 2 + 2, 154); ctx.closePath(); ctx.fill();
  text(ctx, 'VOLT', w / 2, 52, 62, '#39ff7a', { ls: 6 }); text(ctx, 'ENERGY DRINK', w / 2, 80, 16, '#bfffd2', { ls: 3 }); text(ctx, 'WIDE AWAKE', w / 2, 296, 26, '#fff', { ls: 2 }); text(ctx, 'ALL NIGHT LONG', w / 2, 326, 18, '#39ff7a', { ls: 2 });
}
function adTempo(ctx, w, h) {
  ctx.fillStyle = '#ece9e2'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(w / 2, 150, 70, 0, 6.28); ctx.fill(); ctx.fillStyle = '#f5f2ea'; ctx.beginPath(); ctx.arc(w / 2, 150, 60, 0, 6.28); ctx.fill();
  ctx.strokeStyle = '#111'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(w / 2, 150); ctx.lineTo(w / 2, 108); ctx.moveTo(w / 2, 150); ctx.lineTo(w / 2 + 30, 165); ctx.stroke(); for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28; ctx.fillRect(w / 2 + Math.sin(a) * 52 - 1.5, 150 - Math.cos(a) * 52 - 1.5, 3, 3); }
  ctx.fillStyle = '#111'; ctx.fillRect(w / 2 - 22, 70, 44, 14); ctx.fillRect(w / 2 - 22, 216, 44, 14);
  text(ctx, 'TEMPO', w / 2, 44, 34, '#111', { ls: 10, w: '300' }); text(ctx, 'Time is all we have.', w / 2, 262, 16, '#111', { it: 'italic', w: '300' }); text(ctx, 'Make it count.', w / 2, 284, 16, '#c62b1c', { it: 'italic', w: '300' }); text(ctx, 'tempo-watches.example', w / 2, h - 24, 11, '#777', { w: '500' });
}
function adInsure(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#0d3b66'); g.addColorStop(1, '#1b7a8c'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.moveTo(w / 2, 60); ctx.lineTo(w - 36, 92); ctx.lineTo(w - 36, 170); ctx.quadraticCurveTo(w / 2 + 40, 250, w / 2, 262); ctx.quadraticCurveTo(w / 2 - 40, 250, 36, 170); ctx.lineTo(36, 92); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(w / 2 - 32, 160); ctx.lineTo(w / 2 - 8, 186); ctx.lineTo(w / 2 + 38, 130); ctx.stroke();
  text(ctx, 'LIFE.', w / 2, 296, 34, '#fff', { ls: 4 }); text(ctx, 'INSURED.', w / 2, 330, 30, '#f5c542', { ls: 3 }); text(ctx, 'HARBOR & GRACE', w / 2, 28, 15, '#bfe', { ls: 4 });
}
function signBoard(ctx, w, h, { bg = '#0d2c58', fg = '#fff', left = '', right = '', sub = '', arrowDir = null, stripe = '#e12b22' }) {
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.fillStyle = stripe; ctx.fillRect(0, 0, w, 6); ctx.fillRect(0, h - 6, w, 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(6, 8, w - 12, h - 16);
  if (arrowDir !== null) arrow(ctx, arrowDir === 0 ? w - 46 : 46, h / 2, 26, arrowDir, fg);
  const cx = arrowDir === 0 ? (w - 90) / 2 : arrowDir === Math.PI ? (w + 90) / 2 : w / 2;
  text(ctx, left, cx, sub ? h * 0.38 : h / 2, sub ? 40 : 46, fg, { maxW: w - 130, ls: 2 }); if (sub) text(ctx, sub, cx, h * 0.74, 22, '#cfe0f5', { maxW: w - 130, w: '600', ls: 1 });
}
function plateName(ctx, w, h) {
  ctx.fillStyle = '#0f4f3a'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#c9a75a'; ctx.fillRect(0, 4, w, 3); ctx.fillRect(0, h - 7, w, 3);
  const rx = 62; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(rx, h / 2, 34, 0, 6.28); ctx.fill(); ctx.fillStyle = '#d0281e'; ctx.beginPath(); ctx.arc(rx, h / 2, 26, 0, 6.28); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(rx, h / 2, 17, 0, 6.28); ctx.fill(); ctx.fillStyle = '#1a3d8a'; ctx.fillRect(rx - 56, h / 2 - 8, 112, 16);
  text(ctx, 'STATION ZERO', w / 2 + 44, h / 2 + 2, 54, '#f3efe2', { ls: 10, maxW: w - 190 }); ctx.fillStyle = '#f3efe2'; ctx.fillRect(w - 18, 14, 3, h - 28);
}
function plateRoundel(ctx, w, h) { ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.clearRect(0, 0, w, h); const cx = w / 2, cy = h / 2; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.44, 0, 6.28); ctx.fill(); ctx.fillStyle = '#d0281e'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.36, 0, 6.28); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.23, 0, 6.28); ctx.fill(); ctx.fillStyle = '#1a3d8a'; ctx.fillRect(cx - w * 0.5, cy - h * 0.09, w, h * 0.18); text(ctx, 'ZERO', cx, cy, w * 0.14, '#fff', { ls: 2 }); }
function exitSign(ctx, w, h, label = 'EXIT') { ctx.fillStyle = '#0a8a4a'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.strokeRect(5, 5, w - 10, h - 10); runningMan(ctx, 40, h / 2 + 2, h * 0.72, '#fff'); text(ctx, label, w * 0.62, h / 2 + 2, h * 0.34, '#fff', { ls: 2, maxW: w * 0.6 }); arrow(ctx, w - 22, h / 2, 12, 0, '#fff'); }
function fireSign(ctx, w, h) { ctx.fillStyle = '#c8201a'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(w / 2 - 12, 32, 24, 60, 6); ctx.fill(); ctx.fillRect(w / 2 - 6, 22, 12, 12); ctx.fillRect(w / 2 + 4, 24, 16, 5); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w / 2 + 6, 30); ctx.quadraticCurveTo(w / 2 + 34, 40, w / 2 + 30, 78); ctx.stroke(); text(ctx, 'FIRE', w / 2, 106, 15, '#fff', { ls: 2 }); }
function sosSign(ctx, w, h) { ctx.fillStyle = '#1359b3'; ctx.fillRect(0, 0, w, h); text(ctx, 'SOS', w / 2, h * 0.42, h * 0.36, '#fff', { ls: 4 }); text(ctx, 'HELP POINT', w / 2, h * 0.78, h * 0.13, '#fff', { ls: 2 }); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(5, 5, w - 10, h - 10); }
function oooSign(ctx, w, h) { ctx.fillStyle = '#080404'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ff2a1a'; for (let x = 4; x < w; x += 6) for (let y = 4; y < h; y += 6) if (((x * 7 + y * 13) >> 2) % 5 !== 0) { /* dotmatrix bg unlit */ } text(ctx, 'OUT OF ORDER', w / 2, h / 2 + 2, h * 0.5, '#ff3a26', { ls: 3, maxW: w - 16 }); const id = ctx.getImageData(0, 0, w, h), d = id.data; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x % 3 === 2) || (y % 3 === 2)) { const p = (y * w + x) * 4; d[p] *= 0.35; d[p + 1] *= 0.35; d[p + 2] *= 0.35; } ctx.putImageData(id, 0, 0); }
function closedBanner(ctx, w, h) { ctx.fillStyle = '#b81f18'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.fillRect(6, 6, w - 12, h - 12); ctx.fillStyle = '#b81f18'; ctx.fillRect(10, 10, w - 20, h - 20); text(ctx, 'MEZZANINE CLOSED', w / 2, h * 0.38, 40, '#fff', { ls: 3, maxW: w - 50 }); text(ctx, 'Station exit via Platform 1 lift only', w / 2, h * 0.72, 19, '#ffd', { w: '600', maxW: w - 50 }); }
function vending1(ctx, w, h) {
  ctx.fillStyle = '#0b1622'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#1a5bd6'; ctx.fillRect(0, 0, w, 62); text(ctx, 'FIZZ', w / 2, 32, 42, '#fff', { ls: 6 }); ctx.fillStyle = '#e7eef7'; ctx.fillRect(14, 74, 158, 270);
  const cols = ['#d62b2b', '#2b8ad6', '#f0b323', '#2bd66a', '#d62bb0', '#e8e8e8'];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) { ctx.fillStyle = cols[(r * 3 + c * 2 + ((r * c) % 2)) % cols.length]; ctx.fillRect(22 + c * 38, 84 + r * 52, 24, 40); ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(24 + c * 38, 86 + r * 52, 5, 36); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(22 + c * 38, 118 + r * 52, 24, 6); }
  ctx.fillStyle = '#111'; ctx.fillRect(184, 74, 60, 270); ctx.fillStyle = '#2a2f36'; for (let i = 0; i < 6; i++) ctx.fillRect(192, 84 + i * 26, 44, 16); ctx.fillStyle = '#12e26a'; ctx.fillRect(192, 84, 44, 16); ctx.fillStyle = '#080c10'; ctx.fillRect(14, 360, 158, 76); ctx.strokeStyle = '#3a4650'; ctx.lineWidth = 3; ctx.strokeRect(14, 360, 158, 76); text(ctx, '£1.20', 214, 300, 16, '#fff', { w: '600' }); text(ctx, 'SOLD OUT', w / 2, 470, 22, '#ff4a3a', { ls: 3 });
}
function vending2(ctx, w, h) {
  ctx.fillStyle = '#231605'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#f0b323'; ctx.fillRect(0, 0, w, 62); text(ctx, 'SNAX', w / 2, 32, 42, '#3a1a06', { ls: 6 }); ctx.fillStyle = '#f4ecd6'; ctx.fillRect(14, 74, 158, 270);
  const cols = ['#d62b2b', '#2b6bd6', '#2b9a3a', '#c88a24', '#7a3ab5'];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) { ctx.fillStyle = cols[(r + c * 3) % cols.length]; ctx.fillRect(22 + c * 38, 86 + r * 52, 30, 38); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(24 + c * 38, 88 + r * 52, 26, 8); }
  ctx.fillStyle = '#111'; ctx.fillRect(184, 74, 60, 270); ctx.fillStyle = '#12e26a'; ctx.fillRect(192, 84, 44, 16); ctx.fillStyle = '#080c10'; ctx.fillRect(14, 360, 158, 76); ctx.strokeStyle = '#3a4650'; ctx.lineWidth = 3; ctx.strokeRect(14, 360, 158, 76); text(ctx, 'INSERT COIN', w / 2, 470, 16, '#f0b323', { ls: 2 });
}
function ticketScreen(ctx, w, h) {
  ctx.fillStyle = '#0a1e3c'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#1d5fb8'; ctx.fillRect(0, 0, w, 40); text(ctx, 'NORTHLINE TICKETS', w / 2, 21, 20, '#fff', { ls: 2, maxW: w - 20 });
  const b = ['SINGLE', 'RETURN', 'DAY PASS', 'TOP UP']; b.forEach((s, i) => { rr(ctx, 16 + (i % 2) * 118, 58 + (i >> 1) * 74, 106, 62, 8, '#e8eef8'); text(ctx, s, 69 + (i % 2) * 118, 89 + (i >> 1) * 74, 19, '#0a1e3c', { maxW: 96 }); });
  text(ctx, 'CARD ONLY · NO CHANGE GIVEN', w / 2, 224, 12, '#9db8e0', { w: '600' }); ctx.fillStyle = '#f2b90f'; ctx.fillRect(0, h - 22, w, 22); text(ctx, 'TOUCH TO BEGIN', w / 2, h - 11, 14, '#222', { ls: 2 });
}
function helpPanel(ctx, w, h) { ctx.fillStyle = '#e6e2d6'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#1a3d8a'; ctx.fillRect(0, 0, w, 28); text(ctx, 'STATION MAP', w / 2, 14, 15, '#fff', { ls: 2 }); ctx.strokeStyle = '#1a3d8a'; ctx.lineWidth = 3; ctx.strokeRect(14, 44, w - 28, h - 60); ctx.fillStyle = 'rgba(26,61,138,0.15)'; ctx.fillRect(24, 54, w - 48, 40); ctx.fillStyle = '#c62b1c'; ctx.beginPath(); ctx.arc(w / 2, 74, 7, 0, 6.28); ctx.fill(); ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.strokeRect(24, 110, 60, 50); ctx.strokeRect(96, 110, 60, 50); text(ctx, 'PLATFORM 1', 54, 100 + 40, 8, '#333', { maxW: 56 }); }

// ------------------------------------------------------------------------------------------------ decals (lit, alpha)
function streak(ctx, w, h, rnd, col = '40,34,28', a = 0.5) {
  ctx.clearRect(0, 0, w, h);
  for (let k = 0; k < 4; k++) { const x = w * (0.2 + rnd() * 0.6), ww = 2 + rnd() * w * 0.22, l = h * (0.5 + rnd() * 0.5); const g = ctx.createLinearGradient(0, 0, 0, l); g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(0.08, `rgba(${col},${a * (0.5 + rnd() * 0.5)})`); g.addColorStop(0.7, `rgba(${col},${a * 0.5})`); g.addColorStop(1, `rgba(${col},0)`); ctx.fillStyle = g; ctx.fillRect(x - ww / 2, 0, ww, l); }
  // soften horizontally by fading edges
  ctx.globalCompositeOperation = 'destination-in'; const hg = ctx.createLinearGradient(0, 0, w, 0); hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(0.25, 'rgba(0,0,0,1)'); hg.addColorStop(0.75, 'rgba(0,0,0,1)'); hg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = hg; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
}
function blot(ctx, w, h, rnd, col = '30,24,18', a = 0.5, n = 22) {
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < n; i++) { const ang = rnd() * 6.28, r = rnd() * w * 0.22, x = w / 2 + Math.cos(ang) * r, y = h / 2 + Math.sin(ang) * r, rad = w * (0.08 + rnd() * 0.16); const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, `rgba(${col},${a * 0.6})`); g.addColorStop(0.6, `rgba(${col},${a * 0.3})`); g.addColorStop(1, `rgba(${col},0)`); ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
}
function crack(ctx, w, h, rnd) {
  ctx.clearRect(0, 0, w, h); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const branch = (x, y, ang, len, wd, depth) => { ctx.strokeStyle = `rgba(12,10,8,${0.55 + rnd() * 0.3})`; ctx.lineWidth = wd; ctx.beginPath(); ctx.moveTo(x, y); const segs = 7; for (let s = 0; s < segs; s++) { ang += (rnd() - 0.5) * 0.9; x += Math.cos(ang) * len / segs; y += Math.sin(ang) * len / segs; ctx.lineTo(x, y); if (depth < 2 && rnd() < 0.3) { ctx.stroke(); branch(x, y, ang + (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd() * 0.6), len * 0.45, wd * 0.6, depth + 1); ctx.strokeStyle = `rgba(12,10,8,0.6)`; ctx.lineWidth = wd; ctx.beginPath(); ctx.moveTo(x, y); } } ctx.stroke(); };
  branch(w * 0.1, h * 0.5, (rnd() - 0.5) * 0.6, w * 0.85, 2.4, 0);
  ctx.globalAlpha = 0.25; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.globalAlpha = 1;
}
function graffiti(ctx, w, h, txt, cols, rnd, { size = 110, rot = -0.06, drips = true } = {}) {
  ctx.clearRect(0, 0, w, h); ctx.save(); ctx.translate(w / 2, h * 0.52); ctx.rotate(rot); ctx.font = `italic 900 ${size}px "Arial Black", Impact, ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const m = ctx.measureText(txt).width; if (m > w * 0.92) { size *= w * 0.92 / m; ctx.font = `italic 900 ${size}px "Arial Black", Impact, ${FONT}`; }
  ctx.shadowColor = cols[0]; ctx.shadowBlur = 14; ctx.strokeStyle = cols[1]; ctx.lineWidth = size * 0.16; ctx.strokeText(txt, 0, 0); ctx.shadowBlur = 0; ctx.fillStyle = cols[0]; ctx.fillText(txt, 0, 0);
  ctx.globalCompositeOperation = 'source-atop'; const g = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5); g.addColorStop(0, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0.15)'); ctx.fillStyle = g; ctx.fillRect(-w, -h, w * 2, h * 2); ctx.globalCompositeOperation = 'source-over'; ctx.restore();
  if (drips) for (let i = 0; i < 8; i++) { const x = w * (0.12 + rnd() * 0.76), y = h * (0.55 + rnd() * 0.15), l = 8 + rnd() * h * 0.28; ctx.strokeStyle = cols[i % 2 ? 0 : 1]; ctx.lineWidth = 2 + rnd() * 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 2, y + l); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y + l, ctx.lineWidth * 0.8, 0, 6.28); ctx.fillStyle = cols[i % 2 ? 0 : 1]; ctx.fill(); }
  // overspray speckle
  for (let i = 0; i < 160; i++) { ctx.fillStyle = cols[0]; ctx.globalAlpha = 0.25 * rnd(); ctx.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); } ctx.globalAlpha = 1;
}
function tagEye(ctx, w, h, rnd) { ctx.clearRect(0, 0, w, h); ctx.strokeStyle = '#f3f3f3'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.moveTo(14, h / 2); ctx.quadraticCurveTo(w / 2, h * 0.02, w - 14, h / 2); ctx.quadraticCurveTo(w / 2, h * 0.98, 14, h / 2); ctx.stroke(); ctx.beginPath(); ctx.arc(w / 2, h / 2, h * 0.17, 0, 6.28); ctx.stroke(); ctx.fillStyle = '#f3f3f3'; ctx.beginPath(); ctx.arc(w / 2, h / 2, h * 0.07, 0, 6.28); ctx.fill(); for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(w / 2 + i * 22, h * 0.86); ctx.lineTo(w / 2 + i * 26, h * 0.96); ctx.stroke(); } ctx.shadowBlur = 0; }
function stencilGap(ctx, w, h) { ctx.clearRect(0, 0, w, h); text(ctx, 'MIND THE GAP', w / 2, h / 2, h * 0.86, 'rgba(238,238,232,0.9)', { ls: 10, maxW: w - 12 }); const id = ctx.getImageData(0, 0, w, h), d = id.data; const rnd = mulberry32(5); for (let i = 0; i < w * h; i++) if (rnd() < 0.18) d[i * 4 + 3] *= 0.3; ctx.putImageData(id, 0, 0); }
function stencilNumber(ctx, w, h, s) { ctx.clearRect(0, 0, w, h); text(ctx, s, w / 2, h / 2, h * 0.9, 'rgba(238,238,232,0.88)', {}); const id = ctx.getImageData(0, 0, w, h), d = id.data; const rnd = mulberry32(7); for (let i = 0; i < w * h; i++) if (rnd() < 0.2) d[i * 4 + 3] *= 0.25; ctx.putImageData(id, 0, 0); }
function newspaper(ctx, w, h, rnd, angle = 0) {
  ctx.clearRect(0, 0, w, h); ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(angle); ctx.fillStyle = '#d9d4c4'; ctx.fillRect(-w * 0.42, -h * 0.4, w * 0.84, h * 0.8); ctx.fillStyle = '#111'; ctx.font = font(15, 'bold'); ctx.textAlign = 'center'; ctx.fillText('THE DAILY', 0, -h * 0.28); ctx.fillStyle = '#3a3a3a';
  for (let y = -h * 0.16; y < h * 0.36; y += 5) ctx.fillRect(-w * 0.38, y, w * (0.5 + rnd() * 0.26), 2); ctx.fillStyle = '#888'; ctx.fillRect(w * 0.1, -h * 0.16, w * 0.26, h * 0.24);
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(-w * 0.42, -h * 0.02, w * 0.84, 1.5); ctx.restore();
}
function crumple(ctx, w, h, rnd) { ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#c9c4b2'; ctx.beginPath(); for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28, r = w * (0.28 + rnd() * 0.14); ctx.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.moveTo(w / 2 + (rnd() - 0.5) * w * 0.4, h / 2 + (rnd() - 0.5) * h * 0.4); ctx.lineTo(w / 2 + (rnd() - 0.5) * w * 0.5, h / 2 + (rnd() - 0.5) * h * 0.5); ctx.stroke(); } }
function grimeBase(ctx, w, h, rnd) { ctx.clearRect(0, 0, w, h); const g = ctx.createLinearGradient(0, h, 0, 0); g.addColorStop(0, 'rgba(12,10,8,0.85)'); g.addColorStop(0.35, 'rgba(18,14,10,0.45)'); g.addColorStop(1, 'rgba(18,14,10,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 60; i++) { const x = rnd() * w, hh = h * (0.1 + rnd() * 0.5); const gg = ctx.createLinearGradient(0, h, 0, h - hh); gg.addColorStop(0, 'rgba(20,16,12,0.4)'); gg.addColorStop(1, 'rgba(20,16,12,0)'); ctx.fillStyle = gg; ctx.fillRect(x, h - hh, 4 + rnd() * 16, hh); } }
function footprints(ctx, w, h, rnd) { ctx.clearRect(0, 0, w, h); for (let i = 0; i < 10; i++) { const x = 20 + i * (w - 40) / 10, y = h / 2 + (i % 2 ? 14 : -14) + (rnd() - 0.5) * 6; ctx.save(); ctx.translate(x, y); ctx.rotate(0.1); ctx.fillStyle = 'rgba(28,22,16,0.32)'; ctx.beginPath(); ctx.ellipse(0, 0, 9, 4.6, 0, 0, 6.28); ctx.fill(); ctx.beginPath(); ctx.ellipse(-12, 0, 3.6, 3, 0, 0, 6.28); ctx.fill(); ctx.restore(); } }

// ------------------------------------------------------------------------------------------------ blood (glossy decals)
function bloodSplat(ctx, w, h, rnd, big = 1) {
  ctx.clearRect(0, 0, w, h); const cx = w / 2, cy = h / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.3 * big); g.addColorStop(0, 'rgba(96,6,8,0.95)'); g.addColorStop(0.7, 'rgba(70,4,6,0.85)'); g.addColorStop(1, 'rgba(60,4,6,0)'); ctx.fillStyle = g; ctx.beginPath(); for (let i = 0; i < 24; i++) { const a = i / 24 * 6.28, r = w * (0.16 + rnd() * 0.12) * big; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } ctx.closePath(); ctx.fill();
  for (let i = 0; i < 70; i++) { const a = rnd() * 6.28, d = w * (0.18 + rnd() * 0.3) * big, r = 1 + rnd() * 4 * Math.max(0, 1 - d / (w * 0.6)); ctx.fillStyle = `rgba(${70 + rnd() * 40 | 0},4,6,${0.6 + rnd() * 0.3})`; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, 6.28); ctx.fill(); if (rnd() < 0.4) { ctx.strokeStyle = 'rgba(80,4,6,0.6)'; ctx.lineWidth = r * 0.7; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * d * 0.5, cy + Math.sin(a) * d * 0.5); ctx.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d); ctx.stroke(); } }
}
function bloodDrag(ctx, w, h, rnd) { ctx.clearRect(0, 0, w, h); ctx.lineCap = 'round'; for (let k = 0; k < 3; k++) { ctx.strokeStyle = `rgba(${74 + k * 8},4,6,${0.75 - k * 0.15})`; ctx.lineWidth = 10 - k * 3 + rnd() * 3; ctx.beginPath(); ctx.moveTo(24, h / 2 + (k - 1) * 8); let y = h / 2 + (k - 1) * 8; for (let x = 24; x < w - 30; x += 24) { y += (rnd() - 0.5) * 8; ctx.lineTo(x, y); } ctx.stroke(); } const g = ctx.createRadialGradient(w - 60, h / 2, 2, w - 60, h / 2, 46); g.addColorStop(0, 'rgba(90,6,8,0.95)'); g.addColorStop(1, 'rgba(60,4,6,0)'); ctx.fillStyle = g; ctx.fillRect(w - 110, 0, 110, h); }
function bloodHand(ctx, w, h, rnd) { ctx.clearRect(0, 0, w, h); ctx.fillStyle = 'rgba(104,8,10,0.85)'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.66, w * 0.24, h * 0.22, 0, 0, 6.28); ctx.fill(); for (let i = 0; i < 4; i++) { const a = -0.55 + i * 0.36; ctx.save(); ctx.translate(w / 2 + Math.sin(a) * w * 0.2, h * 0.5 - Math.cos(a) * h * 0.02); ctx.rotate(a); ctx.beginPath(); ctx.roundRect(-w * 0.055, -h * 0.4, w * 0.11, h * 0.46, w * 0.05); ctx.fill(); ctx.restore(); } ctx.save(); ctx.translate(w * 0.22, h * 0.66); ctx.rotate(-1.0); ctx.beginPath(); ctx.roundRect(-w * 0.05, -h * 0.26, w * 0.1, h * 0.3, w * 0.05); ctx.fill(); ctx.restore(); const g = ctx.createLinearGradient(0, h * 0.8, 0, h); g.addColorStop(0, 'rgba(100,6,8,0.7)'); g.addColorStop(1, 'rgba(100,6,8,0)'); ctx.fillStyle = g; for (let i = 0; i < 5; i++) ctx.fillRect(w * (0.28 + i * 0.11), h * 0.8, 3, h * 0.2 * (0.4 + rnd())); ctx.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.5})`; ctx.fillRect(rnd() * w, rnd() * h, 2, 2); } ctx.globalCompositeOperation = 'source-over'; }
function bloodSmearWall(ctx, w, h, rnd) { ctx.clearRect(0, 0, w, h); for (let i = 0; i < 5; i++) { const x = w * (0.2 + rnd() * 0.6), l = h * (0.3 + rnd() * 0.65), wd = 4 + rnd() * 10; const g = ctx.createLinearGradient(0, 0, 0, l); g.addColorStop(0, 'rgba(96,6,8,0.9)'); g.addColorStop(0.7, 'rgba(80,4,6,0.6)'); g.addColorStop(1, 'rgba(70,4,6,0)'); ctx.fillStyle = g; ctx.fillRect(x - wd / 2, 0, wd, l); ctx.beginPath(); ctx.arc(x, l * 0.9, wd * 0.6, 0, 6.28); ctx.fill(); } ctx.fillStyle = 'rgba(90,6,8,0.85)'; ctx.beginPath(); ctx.ellipse(w / 2, 10, w * 0.4, 12, 0, 0, 6.28); ctx.fill(); }

// ------------------------------------------------------------------------------------------------ build all
export function buildGraphics(renderer) {
  const aniso = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
  const R = mulberry32(2024);
  const G = {};
  // paper posters (lit, alpha cutout)
  const paper = new Atlas(1024, 4);
  const posters = [['gap', posterGap], ['missing', posterMissing], ['concert', posterConcert], ['perfume', posterPerfume], ['health', posterHealth], ['watch', posterWatch], ['burger', posterBurger], ['evac', posterEvac]];
  posters.forEach(([n, fn], i) => paper.add('p_' + n, 240, 360, (ctx, w, h) => { fn(ctx, w, h); distress(ctx, w, h, R, 1); }));
  [['suspended', noticeSuspended], ['nosmoke', noticeNoSmoke], ['cctv', noticeCctv], ['danger', noticeDanger], ['note', noteHandwritten], ['plan', noteFloorPlan], ['lift', noticeLift]].forEach(([n, fn]) => paper.add('n_' + n, 128, 160, (ctx, w, h) => { fn(ctx, w, h); distress(ctx, w, h, R, 0.4, n === 'note' || n === 'suspended'); }));
  paper.add('map', 512, 128, (ctx, w, h) => { routeMap(ctx, w, h); distress(ctx, w, h, R, 0.5, false); });
  G.paper = paper;

  const glowA = new Atlas(1024, 4);
  [['travel', adTravel], ['volt', adVolt], ['tempo', adTempo], ['insure', adInsure]].forEach(([n, fn]) => glowA.add('ad_' + n, 240, 360, (ctx, w, h) => { fn(ctx, w, h); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(0, 0, w, h * 0.5); for (let i = 0; i < 4; i++) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(R() * w, 0, 1 + R() * 3, h); } }));
  glowA.add('hang_p2', 500, 96, (ctx, w, h) => signBoard(ctx, w, h, { left: 'PLATFORM 2', sub: 'Trains to Harbour · Ashgrove', arrowDir: 0 }));
  glowA.add('hang_way', 500, 96, (ctx, w, h) => signBoard(ctx, w, h, { bg: '#0a7a44', left: 'WAY OUT', sub: 'Exit via mezzanine stairs', arrowDir: -Math.PI / 2, stripe: '#e8e8e8' }));
  glowA.add('hang_north', 500, 96, (ctx, w, h) => signBoard(ctx, w, h, { left: 'TRACK B · NORTH', sub: 'Kingsway · Vale Park', arrowDir: Math.PI }));
  glowA.add('hang_south', 500, 96, (ctx, w, h) => signBoard(ctx, w, h, { left: 'TRACK A · SOUTH', sub: 'Old Quay · Millbank', arrowDir: 0 }));
  glowA.add('hang_name', 500, 96, plateName);
  glowA.add('hang_closed', 500, 96, closedBanner);
  glowA.add('exit', 250, 125, (c, w, h) => exitSign(c, w, h, 'EXIT')); glowA.add('exit2', 250, 125, (c, w, h) => exitSign(c, w, h, 'EMERGENCY EXIT'));
  glowA.add('fire', 125, 125, fireSign); glowA.add('sos', 125, 125, sosSign); glowA.add('ooo', 250, 62, oooSign); glowA.add('roundel', 125, 125, plateRoundel); glowA.add('helpmap', 200, 220, helpPanel);
  G.glowA = glowA;

  const glowB = new Atlas(1024, 4);
  glowB.add('vend1', 256, 512, vending1); glowB.add('vend2', 256, 512, vending2); glowB.add('ticket', 256, 256, ticketScreen);
  G.glowB = glowB;

  const decals = new Atlas(1024, 4, LOWF);
  for (let i = 0; i < 3; i++) decals.add('streak' + i, 96, 256, (c, w, h) => streak(c, w, h, R, '38,32,26', 0.5));
  decals.add('rust0', 96, 256, (c, w, h) => streak(c, w, h, R, '150,74,30', 0.42)); decals.add('rust1', 96, 256, (c, w, h) => streak(c, w, h, R, '130,64,26', 0.4));
  decals.add('grime', 512, 96, (c, w, h) => grimeBase(c, w, h, R));
  for (let i = 0; i < 3; i++) decals.add('blot' + i, 200, 200, (c, w, h) => blot(c, w, h, R, '26,22,18', 0.5 - i * 0.06, 20 + i * 4));
  decals.add('oil', 200, 200, (c, w, h) => blot(c, w, h, R, '10,10,14', 0.55, 12));
  decals.add('crack0', 200, 200, (c, w, h) => crack(c, w, h, R)); decals.add('crack1', 200, 200, (c, w, h) => crack(c, w, h, R));
  decals.add('gap', 512, 64, stencilGap); decals.add('n2', 256, 256, (c, w, h) => stencilNumber(c, w, h, '2'));
  decals.add('foot', 512, 64, (c, w, h) => footprints(c, w, h, R));
  G.decals = decals;

  const decals2 = new Atlas(1024, 4);
  decals2.add('g0', 496, 248, (c, w, h) => graffiti(c, w, h, 'RUN', ['#ff2fa0', '#1a0a1e'], R, { size: 190, rot: -0.08 }));
  decals2.add('g1', 496, 248, (c, w, h) => graffiti(c, w, h, 'NO FUTURE', ['#38f0ff', '#062028'], R, { size: 120, rot: 0.05 }));
  decals2.add('g2', 496, 248, (c, w, h) => graffiti(c, w, h, 'THEY COME', ['#f3f3f3', '#c42020'], R, { size: 130, rot: -0.04 }));
  decals2.add('g3', 496, 248, (c, w, h) => graffiti(c, w, h, 'ZERO', ['#b6ff3a', '#14210a'], R, { size: 190, rot: 0.06 }));
  decals2.add('g4', 496, 248, (c, w, h) => graffiti(c, w, h, 'HELL IS HERE', ['#ff5a1f', '#2a0e05'], R, { size: 108, rot: -0.03 }));
  decals2.add('g5', 256, 128, tagEye);
  decals2.add('news0', 128, 128, (c, w, h) => newspaper(c, w, h, R, 0.3)); decals2.add('news1', 128, 128, (c, w, h) => newspaper(c, w, h, R, -0.5)); decals2.add('crumple', 96, 96, (c, w, h) => crumple(c, w, h, R));
  G.decals2 = decals2;

  const blood = new Atlas(1024, 4, LOWF);
  for (let i = 0; i < 3; i++) blood.add('splat' + i, 256, 256, (c, w, h) => bloodSplat(c, w, h, R, 0.9 + i * 0.25));
  blood.add('drag0', 512, 128, (c, w, h) => bloodDrag(c, w, h, R)); blood.add('drag1', 512, 128, (c, w, h) => bloodDrag(c, w, h, R));
  blood.add('hand0', 128, 128, (c, w, h) => bloodHand(c, w, h, R)); blood.add('hand1', 128, 128, (c, w, h) => bloodHand(c, w, h, R));
  blood.add('smear0', 128, 256, (c, w, h) => bloodSmearWall(c, w, h, R)); blood.add('smear1', 128, 256, (c, w, h) => bloodSmearWall(c, w, h, R));
  G.blood = blood;

  // materials
  G.mat = {
    paper: new THREE.MeshStandardMaterial({ map: paper.texture(aniso), alphaTest: 0.5, roughness: 0.78, metalness: 0, vertexColors: true, envMapIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    glowA: new THREE.MeshBasicMaterial({ map: glowA.texture(aniso), vertexColors: true, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    glowB: new THREE.MeshBasicMaterial({ map: glowB.texture(aniso), vertexColors: true, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    decal: new THREE.MeshStandardMaterial({ map: decals.texture(aniso), transparent: true, depthWrite: false, roughness: 0.9, metalness: 0, vertexColors: true, envMapIntensity: 0.3, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    decal2: new THREE.MeshStandardMaterial({ map: decals2.texture(aniso), transparent: true, depthWrite: false, roughness: 0.85, metalness: 0, vertexColors: true, envMapIntensity: 0.3, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    blood: new THREE.MeshStandardMaterial({ map: blood.texture(aniso), transparent: true, depthWrite: false, roughness: 0.22, metalness: 0, vertexColors: true, envMapIntensity: 1.2, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  };
  return G;
}

export { text as drawText, rr as drawRR, arrow as drawArrow, font };
