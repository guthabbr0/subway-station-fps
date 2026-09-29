// Signage & wall dressing: swaying hanging signs, live departure boards, ticking clock, panning CCTV cameras,
// and the long tiled outer walls across the tracks (name plates, backlit adverts, posters, service doors, niches, graffiti, stains).
import * as THREE from 'three';
import { bus } from '../core.js';
import { MB, fbm3 } from './mb.js';
import { cv, mkTex } from '../textures.js';
import { drawText, font } from './graphics.js';
import { WZ, COLUMN_XS, COLUMN_Z } from './structure.js';
import { panel, pasted } from './props.js';

const W3 = [1, 1, 1];

export function buildSignage(c) {
  const S = { swing: [], boards: [], cams: [], clock: null };
  hanging(c, S); boards(c, S); clock(c, S); cctv(c, S); outerWall(c); pitDressing(c);
  drawClock(S.clock, 47 * 60 + 12); for (const b of S.boards) drawBoard(b, 0, '00:47:12', true);
  c.dynamic.push((dt, t) => updateSignage(c, S, dt, t));
  return S;
}

// ------------------------------------------------------------------------------------------------ hanging signs
function hanging(c, S) {
  const defs = [
    [-24, 0, 'hang_way', 4.75, 1.7], [-18.5, 0, 'hang_north', 4.85, 2.0], [-8, 0, 'hang_p2', 4.9, 2.2], [3, 0, 'hang_name', 4.7, 2.6], [9, 0, 'hang_south', 4.9, 2.2], [18.5, 0, 'hang_p2', 4.85, 2.0], [26, 0, 'hang_north', 4.8, 1.8],
  ];
  defs.forEach(([x, z, name, y, w], i) => {
    const h = w / c.aspect('glowA', name), g = new THREE.Group(); g.position.set(x, 7, z);
    const st = new MB(1), gl = new MB(1);
    const yc = y - 7; // sign centre relative to the attach point
    for (const dz of [-w * 0.42, w * 0.42]) st.cyl(0, 0, dz, 0, yc + h / 2 + 0.03, dz, 0.008, { segs: 4, c: [0.5, 0.5, 0.52] });
    st.box(-0.05, yc - h / 2 - 0.03, -w / 2 - 0.03, 0.05, yc + h / 2 + 0.03, w / 2 + 0.03, { c: [0.22, 0.24, 0.27], seg: 4 });
    for (const sgn of [1, -1]) { const uv = c.G.glowA.rects[name]; gl.oq(sgn * 0.052, yc, 0, sgn, 0, 0, w, h, uv, { c: W3, tint: 0.95 }); }
    const m1 = new THREE.Mesh(st.build(), c.M.steel), m2 = new THREE.Mesh(gl.build(), c.G.mat.glowA); g.add(m1); g.add(m2); c.add(g);
    // tiny caps where rods meet the ceiling
    c.mb('steel').box(x - 0.05, 6.95, -w * 0.42 - 0.05, x + 0.05, 7, w * 0.42 + 0.05, { c: [0.3, 0.3, 0.33] });
    S.swing.push({ g, ph: i * 1.7, a: 0.012 + 0.006 * (i % 3), w: 0.55 + 0.1 * (i % 4) });
  });
}

// ------------------------------------------------------------------------------------------------ departure boards
function boards(c, S) {
  const defs = [[-13, 4.4], [14, 4.4]];
  defs.forEach(([x, y], bi) => {
    const W = 2.6, H = 0.98, cvs = cv(512, 192), ctx = cvs.getContext('2d'), tex = mkTex(cvs, { srgb: true, repeat: false });
    const g = new THREE.Group(); g.position.set(x, 7, 0);
    const st = new MB(1), gl = new MB(1); const yc = y - 7;
    for (const dz of [-W * 0.4, W * 0.4]) st.cyl(0, 0, dz, 0, yc + H / 2, dz, 0.009, { segs: 4, c: [0.5, 0.5, 0.52] });
    st.box(-0.07, yc - H / 2 - 0.04, -W / 2 - 0.04, 0.07, yc + H / 2 + 0.04, W / 2 + 0.04, { c: [0.14, 0.15, 0.17], seg: 4 });
    for (const sgn of [1, -1]) gl.oq(sgn * 0.072, yc, 0, sgn, 0, 0, W, H, [0, 0, 1, 1], { c: W3, tint: 1.0 });
    const mat = new THREE.MeshBasicMaterial({ map: tex, fog: true, vertexColors: true, toneMapped: true });
    g.add(new THREE.Mesh(st.build(), c.M.steel)); g.add(new THREE.Mesh(gl.build(), mat)); c.add(g);
    S.swing.push({ g, ph: bi * 2.3 + 0.5, a: 0.006, w: 0.5 });
    S.boards.push({ ctx, tex, last: '', bi });
  });
}

const BOARD_ROWS = [['HARBOUR', '00:52', 'CANCELLED'], ['ASHGROVE', '01:05', 'DELAYED'], ['MILLBANK', '--:--', 'NO SERVICE'], ['OLD QUAY', '01:40', 'SUSPENDED']];
export const boardState = { mode: 'idle', flash: 0 };
bus.on('train:arriving', () => { boardState.mode = 'arriving'; });
bus.on('train:doorsOpen', () => { boardState.mode = 'boarding'; });
bus.on('train:departed', () => { boardState.mode = 'idle'; });
bus.on('game:start', () => { boardState.mode = 'idle'; });

function drawBoard(b, t, clockStr, blink) {
  const ctx = b.ctx, W = 512, H = 192, m = boardState.mode;
  ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0d1a2b'; ctx.fillRect(0, 0, W, 34);
  drawText(ctx, 'STATION ZERO', 12, 17, 22, '#e8eef8', { align: 'left', ls: 2 }); drawText(ctx, 'PLATFORM 2', 250, 17, 15, '#8fb0d8', { align: 'left', ls: 1 });
  drawText(ctx, clockStr, W - 12, 17, 24, '#ffb020', { align: 'right', w: 'bold' });
  const rows = BOARD_ROWS.map((r) => r.slice());
  if (m === 'arriving') { rows[0] = ['NEXT TRAIN', '--:--', blink ? 'ARRIVING' : '']; }
  else if (m === 'boarding') { rows[0] = ['NEXT TRAIN', '--:--', 'BOARDING']; }
  rows.forEach((r, i) => {
    const y = 56 + i * 30, hot = i === 0 && (m === 'arriving' || m === 'boarding');
    const col = hot ? (m === 'boarding' ? '#4dff88' : '#ffb020') : (i === 2 ? '#a06a1a' : '#e88a12');
    drawText(ctx, String(i + 1), 12, y, 20, '#5a6a80', { align: 'left' }); drawText(ctx, r[0], 40, y, 21, col, { align: 'left', ls: 1, maxW: 200 }); drawText(ctx, r[1], 300, y, 21, col, { align: 'left' });
    drawText(ctx, r[2], W - 12, y, 21, hot ? col : (r[2] === 'CANCELLED' && blink ? '#ff3a2a' : '#ff5a3a'), { align: 'right', ls: 1, maxW: 180 });
  });
  // scrolling ticker
  const msg = '   ALL SERVICES SUSPENDED   ·   DO NOT APPROACH THE PLATFORM EDGE   ·   REPORT UNWELL PASSENGERS TO STAFF   ·   THIS STATION IS UNSTAFFED   ';
  ctx.font = font(15, 'bold'); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = '#ff9a20'; const tw = ctx.measureText(msg).width; const off = -((t * 42) % tw);
  ctx.fillStyle = '#0d1a2b'; ctx.fillRect(0, H - 30, W, 30); ctx.fillStyle = '#ffb020'; ctx.fillText(msg, off, H - 15); ctx.fillText(msg, off + tw, H - 15);
  // dot-matrix scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  b.tex.needsUpdate = true;
}

// ------------------------------------------------------------------------------------------------ clock
function clock(c, S) {
  const size = 256, cvs = cv(size, size), ctx = cvs.getContext('2d'), tex = mkTex(cvs, { srgb: true, repeat: false });
  const g = new THREE.Group(); const cx = 1.5, y = 4.55, R = 0.36; g.position.set(cx, 7, 0);
  const st = new MB(1), gl = new MB(1), yc = y - 7;
  st.cyl(0, 0, 0, 0, yc + R, 0, 0.012, { segs: 4, c: [0.5, 0.5, 0.52] });
  st.cyl(-0.06, yc, 0, 0.06, yc, 0, R + 0.03, { segs: 24, cap: true, c: [0.18, 0.2, 0.22] });
  for (const sgn of [1, -1]) gl.oq(sgn * 0.062, yc, 0, sgn, 0, 0, R * 2, R * 2, [0, 0, 1, 1], { c: W3, tint: 0.95 });
  g.add(new THREE.Mesh(st.build(), c.M.steel)); g.add(new THREE.Mesh(gl.build(), new THREE.MeshBasicMaterial({ map: tex, fog: true, vertexColors: true }))); c.add(g);
  S.clock = { ctx, tex, size, last: -1 }; S.swing.push({ g, ph: 4.1, a: 0.008, w: 0.6 });
}
function drawClock(k, secs) {
  const ctx = k.ctx, s = k.size, r = s / 2; ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = '#e9e6da'; ctx.beginPath(); ctx.arc(r, r, r - 4, 0, 6.28); ctx.fill(); ctx.strokeStyle = '#1b1c1e'; ctx.lineWidth = 8; ctx.stroke();
  ctx.fillStyle = 'rgba(80,60,30,0.16)'; ctx.beginPath(); ctx.arc(r * 0.8, r * 1.2, r * 0.6, 0, 6.28); ctx.fill();
  for (let i = 0; i < 60; i++) { const a = i / 60 * 6.283, big = i % 5 === 0, r0 = r - 14 - (big ? 14 : 5), r1 = r - 14; ctx.strokeStyle = '#111'; ctx.lineWidth = big ? 5 : 2; ctx.beginPath(); ctx.moveTo(r + Math.sin(a) * r0, r - Math.cos(a) * r0); ctx.lineTo(r + Math.sin(a) * r1, r - Math.cos(a) * r1); ctx.stroke(); }
  drawText(ctx, 'ZERO', r, r * 0.62, 20, '#a02418', { ls: 3 });
  const h = ((secs / 3600) % 12), m = (secs / 60) % 60, sc = Math.floor(secs % 60);
  const hand = (ang, len, wd, col) => { ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(r - Math.sin(ang) * len * 0.15, r + Math.cos(ang) * len * 0.15); ctx.lineTo(r + Math.sin(ang) * len, r - Math.cos(ang) * len); ctx.stroke(); };
  hand(h / 12 * 6.283, r * 0.5, 9, '#111'); hand(m / 60 * 6.283, r * 0.78, 6, '#111'); hand(sc / 60 * 6.283, r * 0.82, 2.5, '#c22a1a');
  ctx.fillStyle = '#c22a1a'; ctx.beginPath(); ctx.arc(r, r, 7, 0, 6.28); ctx.fill(); k.tex.needsUpdate = true;
}

// ------------------------------------------------------------------------------------------------ CCTV
function cctv(c, S) {
  // [x, z of the column lane face, outward direction (+1 = towards +z)]
  const spots = [[-28, COLUMN_Z - 0.3, -1], [-20, -COLUMN_Z + 0.3, 1], [-4, COLUMN_Z - 0.3, -1], [12, -COLUMN_Z + 0.3, 1], [28, COLUMN_Z - 0.3, -1], [4, -COLUMN_Z + 0.3, 1], [20, COLUMN_Z - 0.3, -1]];
  const led = new THREE.MeshBasicMaterial({ color: 0xff2010, fog: true }); S.led = led;
  spots.forEach(([x, z, out], i) => {
    const g = new THREE.Group(); g.position.set(x, 4.85, z);
    const arm = new MB(1); arm.box(-0.03, -0.02, out > 0 ? 0 : -0.3, 0.03, 0.02, out > 0 ? 0.3 : 0, { c: [0.3, 0.3, 0.32] }); arm.box(-0.05, -0.12, out > 0 ? -0.01 : -0.03, 0.05, 0.12, out > 0 ? 0.03 : 0.01, { c: [0.25, 0.25, 0.28] });
    const head = new THREE.Group(); head.position.set(0, -0.08, out * 0.3);
    const hm = new MB(1); hm.box(-0.07, -0.06, -0.2, 0.07, 0.06, 0.16, { c: [0.85, 0.87, 0.9] }); hm.box(-0.08, 0.06, -0.24, 0.08, 0.075, 0.2, { c: [0.6, 0.62, 0.66] }); hm.cyl(0, 0, -0.2, 0, 0, -0.27, 0.04, { segs: 8, c: [0.02, 0.02, 0.03], cap: true }); hm.cyl(0, 0, -0.27, 0, 0, -0.272, 0.03, { segs: 8, c: [0.1, 0.16, 0.3], cap: true });
    head.add(new THREE.Mesh(hm.build(), c.M.chrome)); const ledM = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 4), led); ledM.position.set(0.05, 0.03, -0.235); head.add(ledM);
    g.add(new THREE.Mesh(arm.build(), c.M.steel)); g.add(head); c.add(g);
    S.cams.push({ head, base: i % 2 ? -Math.PI / 2 : Math.PI / 2, ph: i * 1.3, sw: 0.55 });
  });
}

// ------------------------------------------------------------------------------------------------ outer walls across the tracks
function outerWall(c) {
  const ads = ['travel', 'volt', 'tempo', 'insure'];
  for (const s of [1, -1]) {
    const zf = s * WZ, nz = -s;
    const plateXs = [-24, -8, 8, 24];
    for (const x of plateXs) {
      panel(c, 'glowA', 'hang_name', x, 1.95, zf, 0, nz, 3.6, 0.69, { tint: 0.95, depth: 0.05, frame: 0.05, frameCol: [0.7, 0.58, 0.3], frameKey: 'brass' });
      for (const dx of [-2.6, 2.6]) c.quadAt('glowA', 'roundel', x + dx, 1.95, zf + nz * 0.004, 0, 0, nz, 0.75, 0.75, { tint: 0.95 });
      c.quadAt('decal', 'streak' + (x > 0 ? 1 : 2), x + 1.1, 1.4, zf + nz * 0.004, 0, 0, nz, 0.5, 1.2, { tint: 0.8 });
    }
    // backlit adverts at bay centres
    COLUMN_XS.forEach((x, i) => {
      panel(c, 'glowA', 'ad_' + ads[(i + (s > 0 ? 0 : 2)) % 4], x, 1.5, zf, 0, nz, 1.2, 1.8, { tint: 0.92, depth: 0.07, frame: 0.05 });
      c.quadAt('decal', (i % 2 ? 'rust0' : 'streak0'), x + (i % 2 ? 0.5 : -0.4), 0.05, zf + nz * 0.004, 0, 0, nz, 0.5, 1.4, { tint: 0.85 });
    });
    // big backlit billboards on the upper wall
    (s > 0 ? [[0, 'volt'], [16, 'travel']] : [[-16, 'insure'], [0, 'tempo']]).forEach(([x, n]) => panel(c, 'glowA', 'ad_' + n, x, 4.7, zf, 0, nz, 1.6, 2.4, { tint: 0.85, depth: 0.08, frame: 0.06 }));
    // poster clusters, service doors, refuge niches, graffiti
    const clusterXs = s > 0 ? [0, 16] : [-16, 0], doorX = s > 0 ? -16 : 16;
    const POST = ['gap', 'missing', 'concert', 'perfume', 'health', 'watch', 'burger', 'evac'];
    clusterXs.forEach((x, ci) => { for (let k = -1; k <= 1; k++) pasted(c, 'p_' + POST[(ci * 3 + k + 5 + (s > 0 ? 0 : 3)) & 7], x + k * 0.55, 1.5 + (k === 0 ? 0.06 : -0.04), zf, 0, nz, 0.42, 0.63, (k * 0.05) + (ci - 0.5) * 0.03); pasted(c, 'n_' + ['suspended', 'cctv', 'note', 'danger'][(ci + (s > 0 ? 1 : 3)) & 3], x, 0.65, zf, 0, nz, 0.26, 0.33, 0.04); });
    door(c, doorX, zf, nz);
    for (const x of [-24, 24]) niche(c, x + (s > 0 ? 0 : 0), zf, nz);
    // tags / stains
    c.quadAt('decal2', s > 0 ? 'g0' : 'g3', s > 0 ? -6 : 6, -0.62, zf + nz * 0.004, 0, 0, nz, 2.4, 1.2, { tint: 0.95 });
    c.quadAt('decal2', s > 0 ? 'g1' : 'g4', s > 0 ? 12 : -12, -0.6, zf + nz * 0.004, 0, 0, nz, 2.4, 1.2, { tint: 0.95 });
    c.quadAt('decal2', s > 0 ? 'g2' : 'g0', s > 0 ? 28 : -28.5, 0.85, zf + nz * 0.004, 0, 0, nz, 1.9, 0.95, { tint: 0.95 });
    c.quadAt('decal2', 'g5', s > 0 ? -12 : 20, 3.55, zf + nz * 0.004, 0, 0, nz, 1.4, 0.7, { tint: 0.95 });
    c.quadAt('decal', 'n2', s > 0 ? -14 : 14, 4.7, zf + nz * 0.004, 0, 0, nz, 1.3, 1.3, { tint: 0.9 });
    for (let k = 0; k < 16; k++) { const x = -30 + k * 4 + c.rr(-1, 1); c.quadAt('decal', k % 4 === 0 ? 'rust' + (k & 1) : 'streak' + (k % 3), x, 5.6, zf + nz * 0.004, 0, 0, nz, c.rr(0.4, 0.9), c.rr(2.0, 3.0), { tint: c.rr(0.7, 1) }); }
    for (let k = 0; k < 6; k++) c.quadAt('decal', 'blot' + (k % 3), c.rr(-30, 30), c.rr(3.2, 5.4), zf + nz * 0.004, 0, 0, nz, c.rr(1.6, 3.2), c.rr(1.6, 2.6), { tint: 0.8 });
    c.quadAt('decal', 'crack' + (s > 0 ? 0 : 1), s > 0 ? 3.5 : -3.5, 4.3, zf + nz * 0.004, 0, 0, nz, 2.0, 2.0, { tint: 0.9, rot: 0.6 });
    // blood in the pit
    c.quadAt('blood', 'smear' + (s > 0 ? 0 : 1), s > 0 ? -5.4 : 5.4, 0.35, zf + nz * 0.004, 0, 0, nz, 0.7, 1.4, {}); c.quadAt('blood', 'hand' + (s > 0 ? 1 : 0), s > 0 ? -5.9 : 5.9, 1.0, zf + nz * 0.004, 0, 0, nz, 0.45, 0.45, { rot: 0.4 });
    // grime line at the top of the pit wall
    for (let x = -28; x <= 28; x += 8) c.quadAt('decal', 'grime', x, 0.3, zf + nz * 0.003, 0, 0, nz, 8, 0.6, { tint: 0.95 });
  }
}

function door(c, x, zf, nz) {
  const yb = -1.25, ht = 2.25, w = 1.3, z = (a, b) => (nz > 0 ? [zf + a, zf + b] : [zf - b, zf - a]);
  // frame is a hollow surround (4 bars) so the leaf never z-fights with it
  const bar = (x0, y0, x1, y1, col, depth = 0.1) => { const [za, zb] = z(0, depth); c.mb('yellow').box(x0, y0, za, x1, y1, zb, { c: col, seg: 1 }); };
  bar(x - w / 2 - 0.09, yb, x - w / 2, yb + ht + 0.09, [1, 0.95, 0.8]); bar(x + w / 2, yb, x + w / 2 + 0.09, yb + ht + 0.09, [1, 0.95, 0.8]); bar(x - w / 2 - 0.09, yb + ht, x + w / 2 + 0.09, yb + ht + 0.09, [1, 0.95, 0.8]);
  const [la, lb] = z(0.02, 0.085);
  c.mb('paint').box(x - w / 2, yb, la, x + w / 2, yb + ht, lb, { c: [0.75, 0.85, 0.8], seg: 1, f: (px, py, pz) => 0.6 + 0.6 * fbm3(px * 2, py * 2, 9) });
  const [sa, sb] = z(0.08, 0.092); c.mb('steel').box(x - 0.02, yb + 0.02, sa, x + 0.02, yb + ht - 0.02, sb, { c: [0.15, 0.15, 0.17] });
  const zz = zf + nz * 0.1;
  const [ha, hb] = z(0.085, 0.13); c.mb('chrome').box(x - 0.42, yb + 1.05, ha, x - 0.28, yb + 1.09, hb, { c: W3 }); c.mb('chrome').box(x + 0.28, yb + 1.05, ha, x + 0.42, yb + 1.09, hb, { c: W3 });
  c.quadAt('paper', 'n_danger', x, yb + 1.5, zf + nz * 0.09, 0, 0, nz, 0.3, 0.37, { tint: 0.95 });
  c.quadAt('glowA', 'exit', x, yb + ht + 0.33, zf + nz * 0.006, 0, 0, nz, 0.7, 0.35, { tint: 0.95 });
  c.quadAt('decal', 'rust0', x - 0.4, yb + 1.0, zf + nz * 0.0865, 0, 0, nz, 0.4, 1.6, { tint: 0.8 });
}
function niche(c, x, zf, nz) {
  const yb = -1.25, ht = 2.0, w = 0.95;
  c.mb('dark').box(x - w / 2, yb, nz > 0 ? zf : zf - 0.02, x + w / 2, yb + ht, nz > 0 ? zf + 0.02 : zf, { c: [0.03, 0.03, 0.035] });
  for (const [a, b, cc, d] of [[x - w / 2 - 0.07, yb, x - w / 2, yb + ht + 0.07], [x + w / 2, yb, x + w / 2 + 0.07, yb + ht + 0.07], [x - w / 2 - 0.07, yb + ht, x + w / 2 + 0.07, yb + ht + 0.07]]) c.mb('yellow').box(a, b, nz > 0 ? zf : zf - 0.05, cc, d, nz > 0 ? zf + 0.05 : zf, { c: [1, 0.95, 0.8] });
  c.quadAt('paper', 'n_danger', x, yb + ht + 0.32, zf + nz * 0.006, 0, 0, nz, 0.24, 0.3, { tint: 0.95 });
}

function pitDressing(c) {
  // trackside cabinets, junction boxes, fallen debris in the pit
  for (const [x, s] of [[-20, 1], [18, -1], [-2, -1], [26, 1]]) {
    const zw = s * WZ, zf = zw - s * 0.45, za = Math.min(zw, zf), zb = Math.max(zw, zf);
    c.mb('paint').box(x - 0.5, -1.25, za, x + 0.5, 0.05, zb, { c: [0.7, 0.8, 0.8], seg: 1 });
    c.mb('steel').box(x - 0.52, 0.05, za, x + 0.52, 0.09, zb + (s > 0 ? 0.02 : -0.02) * 0 + 0.0, { c: [0.3, 0.3, 0.33] });
    c.quadAt('paper', 'n_danger', x, -0.6, zf - s * 0.004, 0, 0, -s, 0.26, 0.33, { tint: 0.9 });
    c.mb('dark').box(x - 0.02, -0.95, s > 0 ? zf - 0.012 : zf, x + 0.02, -0.4, s > 0 ? zf : zf + 0.012, { c: [0.1, 0.1, 0.1] });
    c.collider([x - 0.5, -1.25, za], [x + 0.5, 0.09, zb], { tag: 'cabinet', solid: false, surface: 'metal' });
  }
  // rubbish on the ballast
  const rr = c.rr;
  for (let i = 0; i < 22; i++) { const s = i % 2 ? 1 : -1, x = rr(-30, 30), z = s * rr(5.4, 6.3); c.mb('plastic').box(x, -1.25, z, x + rr(0.1, 0.4), -1.25 + rr(0.03, 0.12), z + rr(0.1, 0.3), { c: [rr(0.1, 0.6), rr(0.1, 0.5), rr(0.1, 0.5)] }); }
  // a fallen ceiling panel / cable clump on the track bed
  for (const [x, z] of [[-11, 7.9], [9.5, -8.3]]) { c.mb('galv').box(x - 0.6, -1.25, z - 0.3, x + 0.6, -1.2, z + 0.3, { c: [0.7, 0.75, 0.8] }); c.mb('cable').cyl(x - 0.5, -1.2, z, x + 0.6, -1.2, z + 0.4, 0.02, { segs: 4, c: [0.05, 0.05, 0.06] }); }
}

// ------------------------------------------------------------------------------------------------ runtime
let _acc = 0;
function updateSignage(c, S, dt, t) {
  for (let i = 0; i < S.swing.length; i++) { const s = S.swing[i]; s.g.rotation.z = Math.sin(t * s.w + s.ph) * s.a; s.g.rotation.y = Math.sin(t * s.w * 0.6 + s.ph * 1.3) * s.a * 1.6; }
  for (let i = 0; i < S.cams.length; i++) { const k = S.cams[i]; k.head.rotation.y = k.base + Math.sin(t * 0.32 + k.ph) * k.sw; }
  S.led.color.setRGB(Math.sin(t * 3.0) > 0.6 ? 3.0 : 0.25, 0.03, 0.02);
  _acc += dt; if (_acc < 0.5) return; _acc = 0;
  const secs = 47 * 60 + Math.floor(t) + 12; // fake clock: 00:47:12 onwards
  const cs = `${String(Math.floor(secs / 3600) % 24).padStart(2, '0')}:${String(Math.floor(secs / 60) % 60).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  const blink = Math.floor(t * 2) % 2 === 0;
  for (const b of S.boards) drawBoard(b, t, cs.slice(0, 5) + (blink ? ':' : ' ') + cs.slice(6), blink);
  if (S.clock.last !== secs) { S.clock.last = secs; drawClock(S.clock, secs); }
}
