// Shared toolkit for the weapons-a viewmodels (fist, chainsaw, pistol, shotgun, ssg):
// procedural canvas materials, a merged-geometry part builder, a posable gloved hand + sleeve rig, and small helpers.
// Everything here is built ONCE (cached on game.__kitA) and shared across weapons.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { normalFromCanvas, mulberry32, speckle } from '../texutil.js';
import { clamp, TIC } from '../core.js';

// Same as texutil.canvasTexture, but the 2D context is created with willReadFrequently (we read pixels back for speckle/normal maps).
function canvasTexture(w, h, drawFn, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true }); drawFn(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.wrap !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.aniso ?? 4;
  return t;
}

export const D2R = Math.PI / 180;
export { TIC };

// ---------------------------------------------------------------------------------------------------------------------
// small math helpers used by all weapons (allocation free)
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const easeOut = (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); };
export const easeOut3 = (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) ** 3; };
export const easeIn = (t) => { t = clamp(t, 0, 1); return t * t; };
export const lerpN = (a, b, t) => a + (b - a) * t;
// piecewise-linear keyframe evaluation: keys = [[t0, v0], [t1, v1], ...] with optional easing on each segment.
export function keyframe(keys, t, ease = smooth) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) { const a = keys[i - 1], b = keys[i]; return a[1] + (b[1] - a[1]) * ease((t - a[0]) / (b[0] - a[0])); }
  }
  return keys[keys.length - 1][1];
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _bR = new THREE.Vector3(), _bU = new THREE.Vector3(), _bB = new THREE.Vector3();

// World-space position that matches where a viewmodel Object3D appears on screen (same maths as Weapon.muzzleWorld).
export function viewPointToWorld(game, obj, out) {
  const cam = game.camera, vc = game.viewCamera;
  obj.updateWorldMatrix(true, false);
  _a.setFromMatrixPosition(obj.matrixWorld);
  _b.copy(_a).applyMatrix4(vc.matrixWorldInverse);
  const depth = -_b.z;
  _b.copy(_a).project(vc);
  _c.set(_b.x, _b.y, 0.5).unproject(cam).sub(cam.position).normalize();
  cam.getWorldDirection(_d);
  const cs = Math.max(0.2, _c.dot(_d));
  return out.copy(cam.position).addScaledVector(_c, depth / cs);
}
// Camera basis (world space) for casing velocities: out vectors are shared scratch, copy if kept.
export function camBasis(game) {
  game.camera.matrixWorld.extractBasis(_bR, _bU, _bB);
  return { right: _bR, up: _bU, fwd: _bB.negate() };
}

// ---------------------------------------------------------------------------------------------------------------------
// Canvas painting helpers (wrap-around strokes so the textures tile seamlessly)
function wline(ctx, w, h, x1, y1, x2, y2) {
  const minx = Math.min(x1, x2), maxx = Math.max(x1, x2), miny = Math.min(y1, y2), maxy = Math.max(y1, y2);
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const dx = ox * w, dy = oy * h;
    if (maxx + dx < -4 || minx + dx > w + 4 || maxy + dy < -4 || miny + dy > h + 4) continue;
    ctx.beginPath(); ctx.moveTo(x1 + dx, y1 + dy); ctx.lineTo(x2 + dx, y2 + dy); ctx.stroke();
  }
}
function wblob(ctx, w, h, x, y, rx, ry, rgba, rot = 0) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const cx = x + ox * w, cy = y + oy * h;
    if (cx + rx < 0 || cx - rx > w || cy + ry < 0 || cy - ry > h) continue;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, rgba); g.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}
function hardBlob(ctx, w, h, x, y, rx, ry, color, rot = 0) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const cx = x + ox * w, cy = y + oy * h;
    if (cx + rx < 0 || cx - rx > w || cy + ry < 0 || cy - ry > h) continue;
    ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
  }
}
function fillBase(ctx, w, h, base) { ctx.fillStyle = base; ctx.fillRect(0, 0, w, h); }
const grey = (v) => { const c = Math.round(clamp(v, 0, 1) * 255); return `rgb(${c},${c},${c})`; };

function paintMetal(ctx, w, h, rnd, o) {
  fillBase(ctx, w, h, o.base);
  for (let i = 0; i < (o.blots ?? 26); i++) wblob(ctx, w, h, rnd() * w, rnd() * h, 20 + rnd() * 70, 8 + rnd() * 40, rnd() < 0.5 ? `rgba(255,255,255,${0.02 + rnd() * 0.05})` : `rgba(0,0,0,${0.05 + rnd() * 0.10})`, rnd() * 3);
  for (let i = 0; i < (o.streaks ?? 700); i++) {
    const y = rnd() * h, x = rnd() * w, l = 8 + rnd() * 110;
    ctx.strokeStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.02 + rnd() * 0.06})` : `rgba(0,0,0,${0.05 + rnd() * 0.12})`;
    ctx.lineWidth = 0.5 + rnd() * 1.1; wline(ctx, w, h, x, y, x + l, y + (rnd() - 0.5) * 1.2);
  }
  for (let i = 0; i < (o.scratches ?? 26); i++) {
    const a = (rnd() - 0.5) * 0.9 + (rnd() < 0.2 ? 1.57 : 0), l = 14 + rnd() * 70, x = rnd() * w, y = rnd() * h;
    ctx.strokeStyle = `rgba(${o.scr ?? '235,240,250'},${0.15 + rnd() * 0.3})`; ctx.lineWidth = 0.5;
    wline(ctx, w, h, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l);
  }
  if (o.wear) for (let i = 0; i < o.wear; i++) hardBlob(ctx, w, h, rnd() * w, rnd() * h, 0.5 + rnd() * 1.6, 0.4 + rnd() * 1.2, `rgba(${o.wearC ?? '170,176,186'},${0.25 + rnd() * 0.4})`, rnd() * 3);
  speckle(ctx, w, h, rnd, o.speck ?? 0.07);
}
function paintMetalRough(ctx, w, h, rnd, base = 0.55) {
  fillBase(ctx, w, h, grey(base));
  for (let i = 0; i < 30; i++) wblob(ctx, w, h, rnd() * w, rnd() * h, 14 + rnd() * 60, 6 + rnd() * 30, rnd() < 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.22)', rnd() * 3);
  for (let i = 0; i < 380; i++) { const y = rnd() * h, x = rnd() * w; ctx.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.7; wline(ctx, w, h, x, y, x + 10 + rnd() * 90, y); }
  for (let i = 0; i < 26; i++) { const a = (rnd() - 0.5) * 0.9, l = 14 + rnd() * 70, x = rnd() * w, y = rnd() * h; ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.6; wline(ctx, w, h, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l); }
  speckle(ctx, w, h, rnd, 0.12);
}

function makeTextures() {
  const T = {};
  const R = (s) => mulberry32(s);
  // --- blued gunmetal
  T.blued = { map: canvasTexture(256, 256, (c, w, h) => paintMetal(c, w, h, R(11), { base: '#68717d', wear: 30, speck: 0.04, scratches: 18 })), rough: canvasTexture(256, 256, (c, w, h) => paintMetalRough(c, w, h, R(12), 0.55), { srgb: false }) };
  // --- bright brushed steel
  T.steel = { map: canvasTexture(256, 256, (c, w, h) => paintMetal(c, w, h, R(21), { base: '#a9b0b9', streaks: 1100, scratches: 30, wear: 10, speck: 0.05 })), rough: canvasTexture(256, 256, (c, w, h) => paintMetalRough(c, w, h, R(22), 0.42), { srgb: false }) };
  // --- dark parkerised steel (barrels / rails)
  T.dark = { map: canvasTexture(256, 256, (c, w, h) => paintMetal(c, w, h, R(31), { base: '#3f454d', wear: 90, wearC: '150,156,166', scr: '190,200,215' })), rough: canvasTexture(256, 256, (c, w, h) => paintMetalRough(c, w, h, R(32), 0.6), { srgb: false }) };
  // --- black polymer with stipple
  {
    const hc = canvasTexture(128, 128, (c, w, h) => { const r = R(41); fillBase(c, w, h, '#808080'); for (let i = 0; i < 2600; i++) { const v = 90 + r() * 140; c.fillStyle = `rgb(${v},${v},${v})`; const x = r() * w, y = r() * h; c.beginPath(); c.arc(x, y, 0.8 + r() * 1.3, 0, 7); c.fill(); } });
    T.poly = { map: canvasTexture(128, 128, (c, w, h) => { const r = R(42); fillBase(c, w, h, '#25282c'); for (let i = 0; i < 900; i++) { const v = 20 + r() * 40; c.fillStyle = `rgb(${v},${v + 2},${v + 5})`; c.fillRect(r() * w, r() * h, 1.5, 1.5); } speckle(c, w, h, r, 0.08); }), normal: normalFromCanvas(hc.image, 2.4) };
    T.stipple = { map: T.poly.map, normal: normalFromCanvas(canvasTexture(128, 128, (c, w, h) => { const r = R(43); fillBase(c, w, h, '#707070'); for (let i = 0; i < 1500; i++) { const v = 40 + r() * 200; c.fillStyle = `rgb(${v},${v},${v})`; c.beginPath(); c.arc(r() * w, r() * h, 1.3 + r() * 1.0, 0, 7); c.fill(); } }).image, 3.4) };
  }
  // --- walnut wood with grain (u runs along the grain)
  {
    const grain = (c, w, h, r, tone) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      if (tone) { g.addColorStop(0, '#4a2c19'); g.addColorStop(0.5, '#583620'); g.addColorStop(1, '#43281a'); } else { g.addColorStop(0, '#9a9a9a'); g.addColorStop(1, '#8a8a8a'); }
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 230; i++) {
        const y0 = r() * h, amp = 1 + r() * 5, f = 0.004 + r() * 0.02, ph = r() * 6.28, a = 0.06 + r() * 0.3;
        c.strokeStyle = tone ? (r() < 0.62 ? `rgba(28,13,4,${a})` : `rgba(190,130,80,${a * 0.5})`) : (r() < 0.6 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.5})`);
        c.lineWidth = 0.5 + r() * 1.7; c.beginPath();
        for (let x = 0; x <= w; x += 8) { const y = y0 + Math.sin(x * f * 6.28 + ph) * amp; if (x === 0) c.moveTo(x, y); else c.lineTo(x, y); }
        c.stroke();
      }
      for (let k = 0; k < 1; k++) { const x = r() * w, y = r() * h; for (let i = 4; i > 0; i--) { c.strokeStyle = tone ? `rgba(30,14,5,${0.09 + i * 0.03})` : `rgba(0,0,0,${0.09 + i * 0.03})`; c.lineWidth = 1; c.beginPath(); c.ellipse(x, y, i * 9, i * 2.6, 0, 0, 6.28); c.stroke(); } }
      speckle(c, w, h, r, 0.05);
    };
    const hc = canvasTexture(256, 128, (c, w, h) => grain(c, w, h, R(51), false));
    T.wood = { map: canvasTexture(256, 128, (c, w, h) => grain(c, w, h, R(51), true)), normal: normalFromCanvas(hc.image, 1.6) };
    // worn varnish: rougher where scratched
    T.woodRough = canvasTexture(128, 128, (c, w, h) => { const r = R(52); fillBase(c, w, h, grey(0.5)); for (let i = 0; i < 60; i++) wblob(c, w, h, r() * w, r() * h, 10 + r() * 40, 5 + r() * 20, r() < 0.5 ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.25)', r() * 3); speckle(c, w, h, r, 0.1); }, { srgb: false });
  }
  // --- checkering (diamond knurl) for grips and fore-ends
  {
    const P = 10;
    const hc = canvasTexture(128, 128, (c, w, h) => {
      const img = c.createImageData(w, h), d = img.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const a = ((x + y) % P) / P, b = (((x - y) % P) + P) % P / P, v = Math.min(1 - Math.abs(2 * a - 1), 1 - Math.abs(2 * b - 1));
        const g = Math.round(v * 255), i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    });
    T.check = { map: canvasTexture(128, 128, (c, w, h) => { const r = R(61); fillBase(c, w, h, '#3d2412'); for (let i = -h; i < w + h; i += P) { c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.stroke(); c.beginPath(); c.moveTo(i, h); c.lineTo(i + h, 0); c.stroke(); } speckle(c, w, h, r, 0.06); }), normal: normalFromCanvas(hc.image, 3.2) };
  }
  // --- leather glove
  {
    const hc = canvasTexture(128, 128, (c, w, h) => { const r = R(71); fillBase(c, w, h, '#808080'); for (let i = 0; i < 700; i++) { const v = 70 + r() * 120; c.fillStyle = `rgb(${v},${v},${v})`; c.beginPath(); c.arc(r() * w, r() * h, 1.6 + r() * 2.6, 0, 7); c.fill(); } for (let i = 0; i < 30; i++) { c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; const x = r() * w, y = r() * h; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 40); c.stroke(); } });
    T.leather = { map: canvasTexture(128, 128, (c, w, h) => { const r = R(72); fillBase(c, w, h, '#45372b'); for (let i = 0; i < 46; i++) wblob(c, w, h, r() * w, r() * h, 8 + r() * 30, 8 + r() * 30, r() < 0.5 ? 'rgba(120,100,80,0.14)' : 'rgba(10,6,3,0.25)', r() * 3); speckle(c, w, h, r, 0.07); }), normal: normalFromCanvas(hc.image, 2.0) };
    T.gloveDark = { map: canvasTexture(128, 128, (c, w, h) => { const r = R(73); fillBase(c, w, h, '#2b2e33'); speckle(c, w, h, r, 0.06); }), normal: T.poly.normal };
  }
  // --- fabric (twill jacket sleeve, dark navy-charcoal with dirt & old stains)
  {
    const hc = canvasTexture(128, 128, (c, w, h) => { fillBase(c, w, h, '#808080'); for (let i = -h; i < w + h; i += 4) { c.strokeStyle = 'rgba(255,255,255,0.65)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.stroke(); } for (let i = 0; i < w; i += 4) { c.strokeStyle = 'rgba(0,0,0,0.18)'; c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); } });
    T.fabric = { map: canvasTexture(256, 256, (c, w, h) => {
      const r = R(81); fillBase(c, w, h, '#3d4436');
      for (let i = -h; i < w + h; i += 4) { c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 1.4; wline(c, w, h, i, 0, i + h, h); }
      for (let i = 0; i < 46; i++) wblob(c, w, h, r() * w, r() * h, 14 + r() * 50, 10 + r() * 40, r() < 0.7 ? `rgba(20,16,12,${0.06 + r() * 0.10})` : `rgba(120,110,84,${0.05 + r() * 0.08})`, r() * 3);
      for (let i = 0; i < 4; i++) wblob(c, w, h, r() * w, r() * h, 6 + r() * 16, 4 + r() * 12, `rgba(90,12,10,${0.2 + r() * 0.25})`, r() * 3);
      speckle(c, w, h, r, 0.08);
    }), normal: normalFromCanvas(hc.image, 1.5) };
  }
  // --- painted orange housing (chainsaw)
  {
    T.orange = { map: canvasTexture(256, 256, (c, w, h) => {
      const r = R(91); fillBase(c, w, h, '#d34a17');
      for (let i = 0; i < 40; i++) wblob(c, w, h, r() * w, r() * h, 12 + r() * 60, 8 + r() * 40, r() < 0.5 ? 'rgba(255,140,60,0.12)' : 'rgba(80,20,0,0.18)', r() * 3);
      for (let i = 0; i < 90; i++) { c.strokeStyle = `rgba(30,12,4,${0.08 + r() * 0.2})`; c.lineWidth = 0.8 + r() * 1.5; const x = r() * w, y = r() * h; wline(c, w, h, x, y, x + (r() - 0.5) * 6, y + 10 + r() * 60); } // grime drips
      for (let i = 0; i < 70; i++) hardBlob(c, w, h, r() * w, r() * h, 0.6 + r() * 2.4, 0.5 + r() * 1.8, `rgba(${40 + r() * 60},${38 + r() * 40},${36 + r() * 30},${0.55 + r() * 0.4})`, r() * 3); // chipped paint
      for (let i = 0; i < 7; i++) wblob(c, w, h, r() * w, r() * h, 5 + r() * 12, 4 + r() * 9, `rgba(80,10,8,${0.3 + r() * 0.3})`, r() * 3);
      speckle(c, w, h, r, 0.07);
    }), rough: canvasTexture(128, 128, (c, w, h) => { const r = R(92); fillBase(c, w, h, grey(0.55)); for (let i = 0; i < 40; i++) wblob(c, w, h, r() * w, r() * h, 10 + r() * 30, 8 + r() * 20, r() < 0.5 ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)', r() * 3); speckle(c, w, h, r, 0.15); }, { srgb: false }) };
    T.saw = { map: canvasTexture(256, 256, (c, w, h) => { const r = R(93); fillBase(c, w, h, '#20242a'); for (let i = 0; i < 24; i++) wblob(c, w, h, r() * w, r() * h, 14 + r() * 50, 8 + r() * 30, r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)', r() * 3); for (let i = 0; i < 50; i++) hardBlob(c, w, h, r() * w, r() * h, 0.6 + r() * 2, 0.5 + r() * 1.5, `rgba(${100 + r() * 60},${100 + r() * 60},${105 + r() * 60},0.5)`, r() * 3); speckle(c, w, h, r, 0.08); }), normal: T.poly.normal };
    // chainsaw guide bar: brushed steel with bloody streaks and oil
    T.bar = { map: canvasTexture(256, 256, (c, w, h) => {
      const r = R(94); paintMetal(c, w, h, r, { base: '#8c939b', streaks: 900, scratches: 40, wear: 20 });
      for (let i = 0; i < 18; i++) wblob(c, w, h, r() * w, r() * h, 10 + r() * 50, 4 + r() * 12, `rgba(${70 + r() * 30},8,6,${0.35 + r() * 0.35})`, r() * 0.4);
      for (let i = 0; i < 50; i++) { c.strokeStyle = `rgba(${60 + r() * 30},6,5,${0.25 + r() * 0.4})`; c.lineWidth = 0.8 + r() * 1.6; const x = r() * w, y = r() * h; wline(c, w, h, x, y, x + 6 + r() * 26, y + (r() - 0.5) * 3); }
      for (let i = 0; i < 40; i++) hardBlob(c, w, h, r() * w, r() * h, 0.6 + r() * 1.6, 0.5 + r() * 1.2, `rgba(${80 + r() * 50},10,8,${0.5 + r() * 0.4})`, r() * 3);
      for (let i = 0; i < 12; i++) wblob(c, w, h, r() * w, r() * h, 8 + r() * 26, 5 + r() * 14, 'rgba(10,8,6,0.28)', 0);
    }), rough: T.steel.rough };
  }
  // --- engraved case-hardened receiver (ssg)
  {
    T.engraved = { map: canvasTexture(512, 256, (c, w, h) => {
      const r = R(101); fillBase(c, w, h, '#69717c');
      for (let i = 0; i < 44; i++) wblob(c, w, h, r() * w, r() * h, 30 + r() * 110, 12 + r() * 50, ['rgba(70,90,150,0.20)', 'rgba(160,130,70,0.16)', 'rgba(30,34,44,0.24)', 'rgba(230,235,245,0.12)'][Math.floor(r() * 4)], r() * 3);
      // scroll engraving
      c.lineCap = 'round';
      for (let k = 0; k < 20; k++) {
        const cx = r() * w, cy = r() * h, a0 = r() * 6.28, dir = r() < 0.5 ? 1 : -1, sc = 3 + r() * 5;
        c.strokeStyle = 'rgba(15,18,24,0.72)'; c.lineWidth = 1.2; c.beginPath();
        for (let t = 0; t < 8.5; t += 0.12) { const rr = sc * (0.5 + t * 1.15), a = a0 + dir * t; const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.72; if (t === 0) c.moveTo(x, y); else c.lineTo(x, y); }
        c.stroke();
        c.strokeStyle = 'rgba(235,240,250,0.40)'; c.lineWidth = 0.7; c.beginPath();
        for (let t = 0; t < 8.5; t += 0.12) { const rr = sc * (0.5 + t * 1.15), a = a0 + dir * t; const x = cx + Math.cos(a) * rr + 1, y = cy + Math.sin(a) * rr * 0.72 + 1; if (t === 0) c.moveTo(x, y); else c.lineTo(x, y); }
        c.stroke();
      }
      for (let i = 0; i < 160; i++) { c.strokeStyle = `rgba(255,255,255,${0.02 + r() * 0.05})`; c.lineWidth = 0.6; const y = r() * h, x = r() * w; wline(c, w, h, x, y, x + 10 + r() * 60, y); }
      for (let i = 0; i < 20; i++) { const a = (r() - 0.5) * 0.9, l = 14 + r() * 60, x = r() * w, y = r() * h; c.strokeStyle = 'rgba(240,244,255,0.3)'; c.lineWidth = 0.5; wline(c, w, h, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l); }
      speckle(c, w, h, r, 0.06);
    }), rough: T.blued.rough };
  }
  // --- shell plastic + brass
  T.shellRed = { map: canvasTexture(64, 64, (c, w, h) => { const r = R(111); fillBase(c, w, h, '#b8231a'); for (let i = 0; i < 40; i++) { c.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.1})`; c.beginPath(); c.moveTo(r() * w, 0); c.lineTo(r() * w, h); c.stroke(); } speckle(c, w, h, r, 0.06); }) };
  T.brass = { map: canvasTexture(64, 64, (c, w, h) => { const r = R(112); fillBase(c, w, h, '#c99a45'); for (let i = 0; i < 30; i++) wblob(c, w, h, r() * w, r() * h, 8 + r() * 14, 4 + r() * 10, r() < 0.5 ? 'rgba(255,230,150,0.25)' : 'rgba(90,50,10,0.25)', r() * 3); speckle(c, w, h, r, 0.06); }) };
  return T;
}

function makeEnv(renderer) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#b4c6d8'); grd.addColorStop(0.2, '#8fa5bb'); grd.addColorStop(0.42, '#62768c'); grd.addColorStop(0.5, '#8698ab'); grd.addColorStop(0.54, '#3a4654'); grd.addColorStop(0.7, '#171d24'); grd.addColorStop(1, '#090b0e');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  // cold fluorescent strips overhead (elevated) and soft boxes
  g.fillStyle = 'rgba(225,240,255,0.35)'; g.fillRect(10, 18, 230, 70); g.fillRect(300, 26, 200, 50);
  for (const [x, y, w, h, col] of [[30, 40, 150, 10, '#ffffff'], [200, 46, 110, 9, '#f4fbff'], [330, 36, 150, 10, '#ffffff'], [60, 72, 120, 7, '#eaf4ff'], [370, 74, 110, 7, '#f0f7ff'], [0, 56, 26, 8, '#ffffff'], [486, 60, 26, 8, '#ffffff'], [120, 20, 90, 6, '#ffffff'], [90, 108, 70, 5, '#ffffff'], [300, 112, 90, 4, '#f0f8ff']]) { g.fillStyle = col; g.fillRect(x, y, w, h); }
  // warm accents (emergency / sodium) kept small and low so they only glint
  g.fillStyle = 'rgba(255,140,60,0.6)'; g.fillRect(96, 134, 22, 5); g.fillStyle = '#ff9a3c'; g.fillRect(420, 120, 14, 5); g.fillStyle = 'rgba(255,120,40,0.5)'; g.fillRect(250, 100, 30, 6);
  g.fillStyle = '#9ad8ff'; g.fillRect(180, 112, 18, 4);
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromEquirectangular(t); t.dispose(); pm.dispose();
  return rt.texture;
}

function makeMaterials(T, env) {
  const M = {};
  const std = (name, o, uv = 8) => { const m = new THREE.MeshStandardMaterial(o); m.userData.uv = uv; m.name = name; M[name] = m; return m; };
  std('blued', { map: T.blued.map, roughnessMap: T.blued.rough, roughness: 0.7, metalness: 0.9, envMap: env, envMapIntensity: 2.0 }, 7);
  std('steel', { map: T.steel.map, roughnessMap: T.steel.rough, roughness: 0.55, metalness: 0.92, envMap: env, envMapIntensity: 1.7 }, 7);
  std('dark', { map: T.dark.map, roughnessMap: T.dark.rough, roughness: 0.7, metalness: 0.85, envMap: env, envMapIntensity: 1.6 }, 7);
  std('poly', { map: T.poly.map, normalMap: T.poly.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.78, metalness: 0.0, envMap: env, envMapIntensity: 0.6 }, 14);
  std('stipple', { map: T.stipple.map, normalMap: T.stipple.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.85, metalness: 0.0, envMap: env, envMapIntensity: 0.4 }, 22);
  std('wood', { map: T.wood.map, normalMap: T.wood.normal, normalScale: new THREE.Vector2(0.18, 0.18), roughnessMap: T.woodRough, roughness: 0.75, metalness: 0.0, envMap: env, envMapIntensity: 0.7 }, 5);
  std('check', { map: T.check.map, normalMap: T.check.normal, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.7, metalness: 0.0, envMap: env, envMapIntensity: 0.6 }, 18);
  std('leather', { map: T.leather.map, normalMap: T.leather.normal, normalScale: new THREE.Vector2(0.2, 0.2), roughness: 0.6, metalness: 0.0, envMap: env, envMapIntensity: 0.9 }, 20);
  std('gloveDark', { map: T.gloveDark.map, normalMap: T.gloveDark.normal, normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.85, metalness: 0.0, envMap: env, envMapIntensity: 0.35 }, 14);
  std('fabric', { map: T.fabric.map, normalMap: T.fabric.normal, normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.95, metalness: 0.0, envMap: env, envMapIntensity: 0.25 }, 9);
  std('trim', { color: 0xff8a1e, roughness: 0.5, metalness: 0, emissive: 0x552200, emissiveIntensity: 0.6, envMap: env, envMapIntensity: 0.5 }, 8);
  std('orange', { map: T.orange.map, roughnessMap: T.orange.rough, roughness: 0.95, metalness: 0.05, envMap: env, envMapIntensity: 0.55 }, 6);
  std('sawPlastic', { map: T.saw.map, normalMap: T.saw.normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.7, metalness: 0.05, envMap: env, envMapIntensity: 0.6 }, 10);
  std('bar', { map: T.bar.map, roughnessMap: T.bar.rough, roughness: 0.55, metalness: 0.92, envMap: env, envMapIntensity: 1.6 }, 6);
  std('engraved', { map: T.engraved.map, roughnessMap: T.engraved.rough, roughness: 0.5, metalness: 0.9, envMap: env, envMapIntensity: 1.7 }, 9);
  std('shellRed', { map: T.shellRed.map, roughness: 0.42, metalness: 0.0, envMap: env, envMapIntensity: 0.8 }, 30);
  std('shellSpent', { map: T.shellRed.map, color: 0x9a7a70, roughness: 0.6, metalness: 0.0, envMap: env, envMapIntensity: 0.5 }, 30);
  std('glass', { color: 0xbfe6ff, roughness: 0.1, metalness: 0.0, emissive: 0x9fdcff, emissiveIntensity: 1.6, envMap: env, envMapIntensity: 1.2 }, 8);
  // Vertex-colour "detail" materials: many tiny parts of different colours share ONE draw call per group.
  const vcDull = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15, envMap: env, envMapIntensity: 0.55 }); vcDull.userData.uv = 8;
  const vcMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.95, envMap: env, envMapIntensity: 1.7 }); vcMetal.userData.uv = 8;
  const tk = (name, hex, target) => { M[name] = { isVC: true, name, color: new THREE.Color(hex), target, userData: { uv: 8 } }; };
  tk('black', 0x08090b, vcDull); tk('rubber', 0x141414, vcDull); tk('strap', 0x424846, vcDull); tk('white', 0xece9dc, vcDull);
  tk('brass', 0xc99a45, vcMetal); tk('chrome', 0xdfe6ee, vcMetal);
  M.vcDull = vcDull; M.vcMetal = vcMetal;
  return M;
}

export function getKit(game) {
  if (game.__kitA) return game.__kitA;
  const T = makeTextures();
  const env = makeEnv(game.renderer);
  const M = makeMaterials(T, env);
  // ONE shared muzzle-flash point light for the viewmodels, created here (weapon init, before the first render) and never added/removed again.
  const light = new THREE.PointLight(0xffb060, 0, 1.4, 2); light.name = 'weaponFlashLight'; game.viewCamera.add(light);
  return (game.__kitA = { T, M, env, light });
}

// A thin canvas text decal (returns a Mesh with a transparent textured plane; face +Z by default).
export function textDecal(text, wM, hM, o = {}) {
  const pxw = o.px ?? 256, pxh = Math.max(16, Math.round(pxw * hM / wM));
  const c = document.createElement('canvas'); c.width = pxw; c.height = pxh; const g = c.getContext('2d');
  if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, pxw, pxh); }
  g.fillStyle = o.color ?? 'rgba(235,235,225,0.85)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${o.weight ?? 'bold'} ${Math.round(pxh * (o.size ?? 0.72))}px ${o.font ?? 'Arial Narrow, Arial, sans-serif'}`;
  if (o.spacing && 'letterSpacing' in g) g.letterSpacing = o.spacing;
  const lines = Array.isArray(text) ? text : [text];
  lines.forEach((t, i) => g.fillText(t, pxw / 2, pxh * (i + 0.5) / lines.length));
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.frustumCulled = false; return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// Box-projected UVs (world-consistent texel density; u runs along the barrel/Z axis on side faces).
function boxUV(geo, scale) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  let uv = geo.attributes.uv; if (!uv) { uv = new THREE.BufferAttribute(new Float32Array(p.count * 2), 2); geo.setAttribute('uv', uv); }
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getZ(i); v = p.getX(i); } else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, u * scale, v * scale);
  }
  uv.needsUpdate = true;
}

const _ad = new THREE.Vector3(), _am = new THREE.Matrix4(), _aq = new THREE.Quaternion(), _aq2 = new THREE.Quaternion(), _az = new THREE.Vector3(0, 0, 1);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

function makeShape(pts) {
  const n = pts.length, sh = new THREE.Shape();
  const P = pts.map(([z, y, r]) => ({ x: -z, y, r: r || 0 }));
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n];
    if (b.r > 0) {
      let d1x = a.x - b.x, d1y = a.y - b.y, d2x = c.x - b.x, d2y = c.y - b.y;
      const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y); d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;
      const r1 = Math.min(b.r, l1 * 0.5), r2 = Math.min(b.r, l2 * 0.5);
      const sx = b.x + d1x * r1, sy = b.y + d1y * r1;
      if (i === 0) sh.moveTo(sx, sy); else sh.lineTo(sx, sy);
      sh.quadraticCurveTo(b.x, b.y, b.x + d2x * r2, b.y + d2y * r2);
    } else if (i === 0) sh.moveTo(b.x, b.y); else sh.lineTo(b.x, b.y);
  }
  return sh;
}

// Collects primitives per material and merges them into one Mesh per material (few draw calls, lots of detail).
// All positions are in metres in the parent's frame; rotations are Euler YXZ radians.
export class Parts {
  constructor() { this.by = new Map(); }
  addGeo(geo, mat, p, r, s) {
    _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, 'YXZ'); _q.setFromEuler(_e);
    _m4.compose(_p.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0), _q, _s.set(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1));
    return this.addMatrix(geo, mat, _m4);
  }
  addMatrix(geo, mat, m4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    let key = mat;
    if (mat.isVC) { key = mat.target; const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = mat.color.r; c[i * 3 + 1] = mat.color.g; c[i * 3 + 2] = mat.color.b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') g.deleteAttribute(k);
    g.applyMatrix4(m4);
    if (m4.determinant() < 0) { // mirrored transform: restore triangle winding
      for (const k of ['position', 'normal', 'uv']) { const at = g.attributes[k], n = at.itemSize, arr = at.array; for (let i = 0; i < at.count; i += 3) for (let c = 0; c < n; c++) { const a = (i + 1) * n + c, b = (i + 2) * n + c, t = arr[a]; arr[a] = arr[b]; arr[b] = t; } }
    }
    boxUV(g, key.userData.uv || 8);
    let a = this.by.get(key); if (!a) this.by.set(key, a = []); a.push(g); return this;
  }
  box(mat, size, p, r, rad = 0, seg = 2) {
    const g = rad > 0 ? new RoundedBoxGeometry(size[0], size[1], size[2], seg, Math.min(rad, Math.min(size[0], size[1], size[2]) * 0.49)) : new THREE.BoxGeometry(size[0], size[1], size[2]);
    return this.addGeo(g, mat, p, r);
  }
  // tapered rounded box: width/height lerp from the back (+Z) to the front (-Z)
  taper(mat, w0, w1, h0, h1, d, p, r, rad = 0.012) {
    const g = new RoundedBoxGeometry(1, 1, 1, 3, 0.35), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const u = 0.5 - pos.getZ(i); pos.setXYZ(i, pos.getX(i) * (w0 + (w1 - w0) * u), pos.getY(i) * (h0 + (h1 - h0) * u), pos.getZ(i) * d); }
    g.computeVertexNormals(); return this.addGeo(g, mat, p, r);
  }
  // cylinder along an axis; rFront is the radius at the -Z / -X.. see below. axis 'z': top(-Z)=rFront; 'x': top(+X)=rFront; 'y': top(+Y)=rFront
  cyl(mat, rFront, rBack, len, axis = 'z', p, r, seg = 14, open = false) {
    const g = new THREE.CylinderGeometry(rFront, rBack, len, seg, 1, open);
    if (axis === 'z') g.rotateX(-Math.PI / 2); else if (axis === 'x') g.rotateZ(-Math.PI / 2);
    return this.addGeo(g, mat, p, r);
  }
  sphere(mat, rad, p, r, s, seg = 12) { return this.addGeo(new THREE.SphereGeometry(rad, seg, Math.max(6, seg * 0.66 | 0)), mat, p, r, s); }
  torus(mat, R, tube, p, r, seg = 20, s) { return this.addGeo(new THREE.TorusGeometry(R, tube, 8, seg), mat, p, r, s); }
  // lathe profile [[radius, forwardDist], ...] revolved around the Z axis (forwardDist positive toward -Z)
  lathe(mat, pts, p, r, seg = 18) {
    const g = new THREE.LatheGeometry(pts.map(([rad, y]) => new THREE.Vector2(rad, y)), seg); g.rotateX(-Math.PI / 2);
    return this.addGeo(g, mat, p, r);
  }
  tube(mat, pts, rad, p, seg = 24) {
    const cur = new THREE.CatmullRomCurve3(pts.map((v) => new THREE.Vector3(v[0], v[1], v[2])));
    return this.addGeo(new THREE.TubeGeometry(cur, seg, rad, 6, false), mat, p);
  }
  // Extruded side-profile polygon. pts: [[z, y, cornerRadius?], ...] (model Z, Y). width along X.
  profile(mat, pts, width, p, r, bevel = 0.0015) {
    const g = new THREE.ExtrudeGeometry(makeShape(pts), { depth: Math.max(0.0005, width - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
    g.translate(0, 0, -(width - 2 * bevel) / 2); g.rotateY(Math.PI / 2);
    return this.addGeo(g, mat, p, r);
  }
  // merged raw geometry of everything added with `mat` (for InstancedMesh templates)
  geometry(mat) { const l = this.by.get(mat); return l && l.length ? mergeGeometries(l, false) : null; }
  build(name = '') {
    const grp = new THREE.Group(); grp.name = name;
    for (const [mat, list] of this.by) {
      const geo = mergeGeometries(list, false); if (!geo) continue;
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; grp.add(m);
      for (const g of list) g.dispose();
    }
    return grp;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Gloved hand + jacket sleeve rig. Hand-local frame: origin = wrist centre, fingers/knuckles point toward -Z, back of the hand
// faces +Y, thumb toward -X (for the RIGHT hand; the LEFT hand is a mirror image), forearm extends along +Z.
// Curl angles are positive = curl toward the palm.
const FINGERS = [
  { name: 'index', x: -0.0300, len: [0.040, 0.027, 0.024], r: 0.0096 },
  { name: 'middle', x: -0.0100, len: [0.044, 0.030, 0.025], r: 0.0098 },
  { name: 'ring', x: 0.0100, len: [0.041, 0.028, 0.024], r: 0.0093 },
  { name: 'pinky', x: 0.0285, len: [0.033, 0.022, 0.020], r: 0.0084 },
];
export const POSES = {
  open: { i: [0.05, 0.05, 0.03], m: [0.05, 0.05, 0.03], r: [0.08, 0.06, 0.03], p: [0.12, 0.08, 0.05], t: { yaw: 0.7, pitch: 0.0, roll: 0.3, c: [0.1, 0.1, 0.05] } },
  fist: { i: [1.50, 1.75, 1.15], m: [1.55, 1.80, 1.10], r: [1.55, 1.80, 1.10], p: [1.45, 1.80, 1.10], t: { yaw: 0.35, pitch: 0.55, roll: 1.0, c: [0.25, 0.55, 0.65] } },
};

export class Hand {
  // o: {side:'R'|'L', pose: spec (see POSES), freeze=true, keep:['index'], sleeve=true, sleeveLen=0.55, knuckleStuds=false}
  constructor(kit, o = {}) {
    this.M = kit.M; this.side = o.side || 'R';
    this.group = new THREE.Group(); this.group.rotation.order = 'YXZ';
    this.rig = new THREE.Group(); this.rig.scale.x = this.side === 'L' ? -1 : 1; this.group.add(this.rig);
    this.fingers = []; this.o = o;
    const M = this.M;
    const cylG = (r0, r1, len) => { const g = new THREE.CylinderGeometry(r0, r1, len, 10, 1); g.rotateX(-Math.PI / 2); g.translate(0, 0, -len / 2); return g; };
    const sphG = new THREE.SphereGeometry(1, 10, 7), ringG = new THREE.TorusGeometry(1, 0.075, 5, 12);
    for (const f of FINGERS) {
      const root = new THREE.Group(); root.position.set(f.x, -0.003, -0.096); this.rig.add(root);
      const joints = []; let parent = root, r = f.r * 1.06;
      f.len.forEach((L, k) => {
        const j = new THREE.Group(); if (k > 0) j.position.z = -f.len[k - 1]; parent.add(j); joints.push(j);
        const r1 = r * (k === 2 ? 0.86 : 0.94);
        const mesh = new THREE.Mesh(cylG(r, r1, L), M.leather); mesh.frustumCulled = false; j.add(mesh);
        const s = new THREE.Mesh(sphG, M.leather); s.scale.setScalar(r * 1.02); s.frustumCulled = false; j.add(s);
        if (k === 2) { const tip = new THREE.Mesh(sphG, M.leather); tip.scale.set(r1 * 1.02, r1 * 0.9, r1 * 1.15); tip.position.z = -L; tip.frustumCulled = false; j.add(tip); }
        if (k > 0) { const ring = new THREE.Mesh(ringG, M.gloveDark); ring.scale.setScalar(r * 1.02); ring.frustumCulled = false; j.add(ring); }
        r = r1; parent = j;
      });
      this.fingers.push({ name: f.name, root, joints, len: f.len });
    }
    // thumb
    const troot = new THREE.Group(); troot.position.set(-0.036, -0.008, -0.022); troot.rotation.order = 'YXZ'; this.rig.add(troot);
    const troll = new THREE.Group(); troot.add(troll);
    const tj = [], TL = [0.040, 0.034, 0.028]; let par = troll, tr = 0.0118;
    TL.forEach((L, k) => {
      const j = new THREE.Group(); if (k > 0) j.position.z = -TL[k - 1]; par.add(j); tj.push(j);
      const r1 = tr * (k === 2 ? 0.86 : 0.92);
      const mesh = new THREE.Mesh(cylG(tr, r1, L), M.leather); mesh.frustumCulled = false; j.add(mesh);
      const s = new THREE.Mesh(sphG, M.leather); s.scale.setScalar(tr * 1.03); s.frustumCulled = false; j.add(s);
      if (k === 2) { const tip = new THREE.Mesh(sphG, M.leather); tip.scale.set(r1 * 1.03, r1 * 0.92, r1 * 1.15); tip.position.z = -L; tip.frustumCulled = false; j.add(tip); }
      tr = r1; par = j;
    });
    this.thumb = { root: troot, roll: troll, joints: tj };
    this.pose(o.pose || POSES.open);
    this.finish();
  }
  // spec: {i,m,r,p: [mcp,pip,dip], t:{yaw,pitch,roll,c:[a,b,c]}}
  pose(spec) {
    const arr = [spec.i, spec.m, spec.r, spec.p];
    this.fingers.forEach((f, k) => { const a = arr[k] || arr[0]; f.joints[0].rotation.x = -a[0]; f.joints[1].rotation.x = -a[1]; f.joints[2].rotation.x = -a[2]; });
    const t = spec.t; if (t) {
      this.thumb.root.rotation.set(t.pitch || 0, t.yaw || 0, 0); this.thumb.roll.rotation.z = t.roll || 0;
      this.thumb.joints.forEach((j, k) => { j.rotation.x = -(t.c[k] || 0); });
    }
    // fan the fingers slightly when spec.spread given
    if (spec.spread !== undefined) this.fingers.forEach((f, k) => { f.root.rotation.y = (k - 1.5) * spec.spread; });
    return this;
  }
  _static() {
    const P = new Parts(), A = new Parts(), M = this.M, o = this.o;
    // palm (tapered) + padding
    P.taper(M.leather, 0.064, 0.088, 0.030, 0.033, 0.100, [0, 0, -0.050], null, 0.013);
    P.sphere(M.leather, 0.024, [-0.028, -0.008, -0.036], null, [1.0, 0.72, 1.35]);                 // thenar pad
    P.sphere(M.leather, 0.020, [0.030, -0.006, -0.056], null, [0.85, 0.7, 1.5]);                   // hypothenar
    P.sphere(M.leather, 1, [0, 0.0158, -0.052], null, [0.033, 0.0058, 0.038], 14);                 // dorsal padding
    P.box(M.gloveDark, [0.030, 0.0026, 0.026], [0, 0.0208, -0.058], null, 0.0012);                 // small hard patch
    P.cyl(M.gloveDark, 0.0083, 0.0083, 0.068, 'x', [0, 0.0105, -0.098], null, 12);                 // knuckle protector bar
    for (let k = 0; k < 4; k++) P.sphere(M.dark, 0.0026, [FINGERS[k].x, 0.0186, -0.099], null, [1, 0.7, 1], 8);
    if (o.knuckleStuds) for (let k = 0; k < 4; k++) P.box(M.steel, [0.016, 0.010, 0.009], [FINGERS[k].x, 0.0135, -0.110], null, 0.003);
    P.sphere(M.leather, 0.0335, [0, 0, 0.004], null, [1, 0.95, 1.0], 14);                            // wrist ball (hides the bend seam)
    // wrist cuff + small velcro tab + sleeve (a separate group so the forearm can bend at the wrist)
    A.cyl(M.gloveDark, 0.0375, 0.040, 0.052, 'z', [0, 0, 0.026], null, 18, false);
    A.box(M.strap, [0.036, 0.0042, 0.020], [0, 0.0385, 0.022], null, 0.0015);
    this._watch = null;
    if (this.side === 'L' && o.watch !== false) {
      // rugged digital wristwatch on the back of the left wrist (glowing LCD shows the station clock)
      A.cyl(M.rubber, 0.0432, 0.0432, 0.028, 'z', [0, 0, 0.098], null, 20);
      A.box(M.black, [0.040, 0.011, 0.040], [0, 0.0465, 0.098], null, 0.004);
      A.box(M.steel, [0.043, 0.0026, 0.043], [0, 0.0405, 0.098], null, 0.001);
      for (const sx of [-1, 1]) A.box(M.dark, [0.0044, 0.004, 0.0044], [sx * 0.019, 0.0505, 0.098 - 0.019 * sx * 0 + 0.0], null, 0.001);
      this._watch = true;
    }
    if (o.sleeve !== false) {
      const L = o.sleeveLen ?? 0.6;
      A.cyl(M.fabric, 0.0405, 0.048, L, 'z', [0, 0, 0.05 + L / 2], null, 20);
      A.torus(M.trim, 0.0418, 0.0028, [0, 0, 0.068], [0, Math.PI / 2, 0], 24);
      A.torus(M.fabric, 0.0418, 0.0050, [0, 0, 0.052], [0, Math.PI / 2, 0], 24);
    }
    return { P, A };
  }
  // Merge every static + finger mesh into a few meshes (except kept fingers, e.g. the trigger finger).
  finish() {
    const o = this.o, keep = new Set(o.keep || []);
    const { P, A } = this._static();
    this.arm = A.build('arm'); this.rig.add(this.arm);
    if (this._watch) {
      const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
      g.fillStyle = '#071407'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#93ff7c'; g.font = 'bold 44px Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('00:47', 64, 34);
      g.fillStyle = 'rgba(147,255,124,0.55)'; g.font = 'bold 11px Consolas, monospace'; g.fillText('PLAT-2  ' + '\u25CF', 64, 8);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.030, 0.015), new THREE.MeshBasicMaterial({ map: t, fog: false })); d.rotation.x = -Math.PI / 2; d.scale.x = -1; d.position.set(0, 0.0524, 0.098); d.frustumCulled = false; this.arm.add(d);
    }
    if (o.freeze !== false) {
      this.group.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(this.rig.matrixWorld).invert(), rel = new THREE.Matrix4();
      const eat = (root) => root.traverse((ob) => { if (ob.isMesh) { rel.multiplyMatrices(inv, ob.matrixWorld); P.addMatrix(ob.geometry, ob.material, rel); } });
      const dead = [];
      this.fingers.forEach((f) => { if (!keep.has(f.name)) { eat(f.root); dead.push(f.root); } });
      eat(this.thumb.root); dead.push(this.thumb.root);
      for (const d of dead) this.rig.remove(d);
      this.fingers = this.fingers.filter((f) => keep.has(f.name));
      this.thumb = null;
      for (const d of dead) d.traverse((ob) => { if (ob.isMesh && ob.geometry.type === 'CylinderGeometry') ob.geometry.dispose(); });
    }
    this.statics = P.build('hand'); this.rig.add(this.statics);
  }
  // Merge this hand's static (non-animated) meshes into `parts` (a Parts that will be built into `parentGroup`), then drop them from the rig.
  // Use for hands that never move relative to the weapon part they are baked into. The arm (pointArm) and kept fingers stay live.
  bake(parts, parentGroup) {
    parentGroup.updateWorldMatrix(true, false); this.group.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(parentGroup.matrixWorld).invert(), rel = new THREE.Matrix4();
    for (const m of this.statics.children) { rel.multiplyMatrices(inv, m.matrixWorld); parts.addMatrix(m.geometry, m.material, rel); m.geometry.dispose(); }
    this.rig.remove(this.statics); this.statics = null;
    return this;
  }
  find(name) { return this.fingers.find((f) => f.name === name); }
  // Bend the forearm at the wrist (radians, in the hand's own frame: rx<0 = toward the back of the hand, ry = toward the pinky side).
  bend(rx = 0, ry = 0, rz = 0) { this.arm.rotation.set(rx, ry, rz); return this; }
  // Aim the forearm along a VIEW-space direction (x right, y up, z toward the eye) regardless of how the hand is posed; the wrist bend is clamped.
  pointArm(viewCam, dx, dy, dz, maxBend = 1.25) {
    this.rig.updateWorldMatrix(true, false);
    _ad.set(dx, dy, dz).transformDirection(viewCam.matrixWorld);
    _am.copy(this.rig.matrixWorld).invert(); _ad.transformDirection(_am);
    _aq.setFromUnitVectors(_az, _ad);
    const ang = 2 * Math.acos(clamp(_aq.w, -1, 1));
    if (ang > maxBend) { _aq2.identity(); _aq2.slerp(_aq, maxBend / ang); this.arm.quaternion.copy(_aq2); } else this.arm.quaternion.copy(_aq);
    return this;
  }
  placeN(px, py, pz, rx, ry, rz) {
    this.group.rotation.set(rx, ry, rz); this.group.updateMatrix();
    _p.set(0, 0, -0.05).applyQuaternion(this.group.quaternion);
    this.group.position.set(px - _p.x, py - _p.y, pz - _p.z);
    return this;
  }
  // Position the hand so its palm centre lands on `pos` with rotation `rot` (Euler YXZ radians).
  place(pos, rot, palmLocal = [0, 0, -0.05]) {
    this.group.rotation.set(rot[0], rot[1], rot[2]); this.group.updateMatrix();
    _p.set(palmLocal[0], palmLocal[1], palmLocal[2]).applyQuaternion(this.group.quaternion);
    this.group.position.set(pos[0] - _p.x, pos[1] - _p.y, pos[2] - _p.z);
    return this;
  }
}

// Shared helpers so every weapon handles input edges / empty clicks / casings the same way.
export function trackFire(w, ctx) {
  w._edge = !!ctx.fire && !w._pf; w._pf = !!ctx.fire;
  if (!ctx.fire) w.held = false;
}
// Play the dry-fire click (rate limited) and switch to the best weapon that still has ammo. Returns true if it handled the empty case.
export function dryFire(w, ctx) {
  if (w.hasAmmo()) return false;
  if (w._emptyT === undefined || w.time - w._emptyT > 0.45) { w._emptyT = w.time; w.game.audio.play('empty'); }
  if (w._edge || w.time - (w._autoT ?? -9) > 0.6) { w._autoT = w.time; w.game.weapons.autoSwitch(); }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Melee probe shared by fist + chainsaw: forgiving ray test against enemies (raycast with extra radius, then a short forward cone),
// compared against the static world. Returns a shared result object {kind:'enemy'|'world'|null, enemy, part, dist, point, normal, dir, surface}.
const _mo = new THREE.Vector3(), _md = new THREE.Vector3(), _mp = new THREE.Vector3(), _mn = new THREE.Vector3();
const _res = { kind: null, enemy: null, part: 'torso', dist: 0, point: _mp, normal: _mn, dir: _md, origin: _mo, surface: 'concrete' };
const _coneHit = { enemy: null, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), part: 'torso' };
function coneFind(game, o, d, range) {
  const list = game.enemies?.list; if (!list) return null;
  let fx = d.x, fz = d.z; const fl = Math.hypot(fx, fz);
  if (fl < 0.1) { const y = game.player.yaw; fx = -Math.sin(y); fz = -Math.cos(y); } else { fx /= fl; fz /= fl; }
  let best = null, bd = 1e9;
  for (const e of list) {
    if (!e.alive) continue;
    const dx = e.pos.x - o.x, dz = e.pos.z - o.z, dist = Math.hypot(dx, dz), reach = dist - e.radius;
    if (reach > range) continue;
    const cos = dist > 1e-3 ? (dx * fx + dz * fz) / dist : 1;
    if (cos < 0.78 && dist > e.radius + 0.15) continue;
    if (reach < bd) { bd = reach; best = e; }
  }
  if (!best) return null;
  const dx = best.pos.x - o.x, dz = best.pos.z - o.z, dist = Math.max(1e-3, Math.hypot(dx, dz));
  const y = clamp(o.y + d.y * dist, best.pos.y + 0.35, best.pos.y + Math.max(0.5, best.height - 0.3));
  _coneHit.enemy = best; _coneHit.dist = Math.max(0, bd);
  _coneHit.point.set(best.pos.x - dx / dist * best.radius * 0.5, y, best.pos.z - dz / dist * best.radius * 0.5);
  _coneHit.normal.set(-dx / dist, 0, -dz / dist); _coneHit.part = y > best.pos.y + best.height * 0.82 ? 'head' : 'torso';
  return _coneHit;
}
export function meleeProbe(game, range = 2.0, extra = 0.3) {
  const ray = game.player.getAimRay(); _mo.copy(ray.origin); _md.copy(ray.dir);
  let e = game.enemies?.raycast?.(_mo, _md, range, extra) || null;
  if (!e) e = coneFind(game, _mo, _md, range);
  const wr = game.world.raycast(_mo, _md, range);
  if (e && (!wr || e.dist <= wr.dist + 0.3)) {
    _res.kind = 'enemy'; _res.enemy = e.enemy; _res.part = e.part || 'torso'; _res.dist = e.dist; _mp.copy(e.point);
    if (e.normal) _mn.copy(e.normal); else _mn.copy(_md).negate();
  } else if (wr) {
    _res.kind = 'world'; _res.enemy = null; _res.dist = wr.dist; _res.surface = wr.surface; _mp.copy(wr.point); _mn.copy(wr.normal);
  } else { _res.kind = null; _res.enemy = null; _res.dist = range; }
  return _res;
}

// ---------------------------------------------------------------------------------------------------------------------
// Muzzle-flash light on the viewmodel (fast decay). Call flashPulse() at the shot and flashDecay() from animate().
const _fp = new THREE.Vector3();
export function flashPulse(game, muzzleObj, intensity, color = 0xffb060) {
  const L = game.__kitA?.light; if (!L) return;
  muzzleObj.updateWorldMatrix(true, false); _fp.setFromMatrixPosition(muzzleObj.matrixWorld).applyMatrix4(game.viewCamera.matrixWorldInverse);
  L.position.copy(_fp); L.position.z += 0.06; L.position.y += 0.05; L.color.setHex(color); L.intensity = intensity;
}
export function flashDecay(game, dt) { const L = game.__kitA?.light; if (L && L.intensity > 0) { L.intensity *= Math.exp(-dt * 26); if (L.intensity < 0.004) L.intensity = 0; } }
export function flashKill(game) { const L = game.__kitA?.light; if (L) L.intensity = 0; }

// Compile every weapon's shader programs (and upload the kit textures) once, on the first frame a weapon runs, so the first switch to a
// weapon never hitches. Temporarily shows all weapon roots so renderer.compile() sees them.
export function warmup(game) {
  if (game.__waWarm) return; game.__waWarm = true;
  try {
    const kit = game.__kitA, list = Object.values(game.weapons?.list || {}), vis = list.map((w) => w.root.visible);
    if (kit) for (const t of Object.values(kit.T)) { if (t.isTexture) game.renderer.initTexture(t); else for (const k of Object.values(t)) if (k && k.isTexture) game.renderer.initTexture(k); }
    for (const w of list) w.root.visible = true;
    game.renderer.compile(game.viewScene, game.viewCamera);
    list.forEach((w, i) => { w.root.visible = vis[i]; });
  } catch (e) { console.warn('[weapons-a] warmup skipped:', e.message); }
}
