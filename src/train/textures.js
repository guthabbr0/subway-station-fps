// Procedural canvas textures for the train: body tile, glass, interior grain, decal atlases, LED signs, glows.
import * as THREE from 'three';
import { canvasTexture, mulberry32 } from '../texutil.js';

const FONT = '"Arial Black","Helvetica Neue",Arial,sans-serif';
const txt = (ctx, s, x, y, size, color, align = 'center', weight = 'bold') => {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(s, x, y);
};

function blob(ctx, x, y, r, col, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(0.55, `rgba(${col},${a * 0.75})`); g.addColorStop(1, `rgba(${col},0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
}

function bloodSmear(ctx, w, h, rnd, kind = 0) {
  const col = kind % 2 ? '70,8,8' : '105,12,12';
  const x0 = w * (0.15 + rnd() * 0.2), y0 = h * (0.15 + rnd() * 0.25), x1 = w * (0.6 + rnd() * 0.3), y1 = h * (0.55 + rnd() * 0.3);
  const steps = 26;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1), x = x0 + (x1 - x0) * t + Math.sin(t * 5 + kind) * w * 0.05, y = y0 + (y1 - y0) * t + Math.cos(t * 4) * h * 0.05;
    blob(ctx, x, y, (0.07 + rnd() * 0.07) * w * (1 - t * 0.5), col, 0.55 + rnd() * 0.3);
  }
  // splash dots + drips
  for (let i = 0; i < 28; i++) blob(ctx, x0 + (rnd() - 0.4) * w * 0.6, y0 + (rnd() - 0.3) * h * 0.6, 1.5 + rnd() * 5, col, 0.9);
  ctx.strokeStyle = `rgba(${col},0.8)`; ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) { const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0); ctx.lineWidth = 1.5 + rnd() * 2.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rnd() * 3 - 1.5, y + 14 + rnd() * h * 0.3); ctx.stroke(); }
}

function handPrint(ctx, w, h, rnd) {
  ctx.save(); ctx.translate(w / 2, h * 0.62); ctx.rotate((rnd() - 0.5) * 0.5);
  ctx.fillStyle = 'rgba(95,10,10,0.85)';
  const s = w / 96;
  ctx.beginPath(); ctx.ellipse(0, 0, 15 * s, 18 * s, 0, 0, 7); ctx.fill();
  for (let i = 0; i < 4; i++) { const a = -0.42 + i * 0.28; ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0, -30 * s, 4.4 * s, 15 * s - Math.abs(i - 1.5) * 1.5 * s, 0, 0, 7); ctx.fill(); ctx.restore(); }
  ctx.save(); ctx.rotate(1.1); ctx.beginPath(); ctx.ellipse(-4 * s, -20 * s, 4.6 * s, 12 * s, 0, 0, 7); ctx.fill(); ctx.restore();
  ctx.restore();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(0,0,0,${0.2 + rnd() * 0.5})`; ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3); }
  ctx.globalCompositeOperation = 'source-over';
}

function wear(ctx, w, h, rnd, n = 60, a = 0.7) {
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n; i++) { ctx.strokeStyle = `rgba(0,0,0,${rnd() * a})`; ctx.lineWidth = 0.6 + rnd() * 1.6; ctx.beginPath(); const x = rnd() * w, y = rnd() * h; ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 14); ctx.stroke(); }
  ctx.globalCompositeOperation = 'source-over';
}


// Fine pixel noise as a repeating pattern (no getImageData read-back, which is slow on GPU canvases).
function noisePattern(ctx, size, seed, amount) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), img = x.createImageData(size, size), r = mulberry32(seed);
  for (let i = 0; i < size * size; i++) { const v = r() < 0.5 ? 0 : 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = r() * amount * 255; }
  x.putImageData(img, 0, 0); return ctx.createPattern(c, 'repeat');
}
const speckleFast = (ctx, w, h, seed, amount) => { ctx.fillStyle = noisePattern(ctx, 128, seed, amount); ctx.fillRect(0, 0, w, h); };

// Normal map for the body tile computed on the CPU (brushed grain, seams, rivets) - matches the colour tile layout.
function bodyNormal(size = 512, strength = 3.2) {
  const r = mulberry32(31337), H = new Float32Array(size * size).fill(0.5), colN = new Float32Array(size);
  for (let x = 0; x < size; x++) colN[x] = (r() - 0.5) * 0.09;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] += colN[x] + (r() - 0.5) * 0.035;
  for (let y = 0; y < 3; y++) for (let x = 0; x < size; x++) H[y * size + x] -= 0.36;
  for (let y = 0; y < size; y++) { for (let x = 0; x < 3; x++) H[y * size + x] -= 0.36; for (let x = size - 2; x < size; x++) H[y * size + x] -= 0.36; }
  const rivet = (cx, cy) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const d = Math.hypot(dx, dy); if (d <= 2.9) { const x = (cx + dx + size) % size, y = (cy + dy + size) % size; H[y * size + x] += 0.32 * (1 - d / 4); } } };
  for (let i = 0; i < 19; i++) { const y = 12 + i * 27; rivet(12, y); rivet(size - 10, y); rivet(12 + i * 27, 12); }
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size), o = img.data, g = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (g(x + 1, y) - g(x - 1, y)) * strength, dy = (g(x, y + 1) - g(x, y - 1)) * strength, l = Math.sqrt(dx * dx + dy * dy + 1), i = (y * size + x) * 4;
    o[i] = (-dx / l * 0.5 + 0.5) * 255; o[i + 1] = (dy / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}

// ---- atlas packer --------------------------------------------------------------------------------
function makeAtlas(size, items, seed) {
  const rnd = mulberry32(seed);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const sorted = [...items].sort((a, b) => b.h - a.h);
  let x = 0, y = 0, rowH = 0; const rects = {};
  for (const it of sorted) {
    if (x + it.w > size) { x = 0; y += rowH; rowH = 0; }
    if (y + it.h > size) { console.warn('[train] atlas overflow', it.name); continue; }
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, it.w, it.h); ctx.clip(); ctx.translate(x, y);
    it.draw(ctx, it.w, it.h, rnd); ctx.restore();
    rects[it.name] = { u0: (x + 1) / size, u1: (x + it.w - 1) / size, v0: 1 - (y + it.h - 1) / size, v1: 1 - (y + 1) / size, w: it.w, h: it.h };
    x += it.w; rowH = Math.max(rowH, it.h);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true;
  return { tex, rects, canvas: c };
}

// ---- LED dot-matrix sign -------------------------------------------------------------------------
const DOT = [0.45, 1, 1, 0.45, 1, 1, 1, 1, 1, 1, 1, 1, 0.45, 1, 1, 0.45];
export function makeLedSign(w, h, lines, opts = {}) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h), out = img.data;
  const pitch = 4, cols = Math.floor(w / pitch), rows = Math.floor(h / pitch);
  const off = document.createElement('canvas'); off.width = cols; off.height = rows;
  const octx = off.getContext('2d', { willReadFrequently: true });
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const on = hex(opts.on || '#ffb02e'), dim = hex(opts.dim || '#2b1904'), bg = [10, 7, 5];
  let mask = null;
  const api = {
    tex, canvas,
    draw(glitch = 0, rnd = Math.random) {
      if (!mask) { // rasterise the text once into a 1-bit mask
        octx.clearRect(0, 0, cols, rows); octx.fillStyle = '#fff'; octx.textAlign = 'center'; octx.textBaseline = 'middle';
        const lh = rows / lines.length;
        lines.forEach((l, i) => { octx.font = `bold ${Math.floor(lh * 0.86)}px monospace`; octx.fillText(l, cols / 2, lh * (i + 0.5) + 0.5); });
        const d = octx.getImageData(0, 0, cols, rows).data; mask = new Uint8Array(cols * rows);
        for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] > 110 ? 1 : 0;
      }
      const dead = glitch > 0 ? Math.floor(rnd() * cols) : -1, deadW = 4 + Math.floor(rnd() * 22);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        let lit = mask[y * cols + x] === 1;
        if (glitch > 0 && ((x >= dead && x < dead + deadW) || rnd() < glitch * 0.1)) lit = false;
        if (glitch > 0.6 && rnd() < 0.05) lit = !lit;
        const c = lit ? on : dim;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
          const k = DOT[j * 4 + i], px = ((y * pitch + j) * w + x * pitch + i) * 4;
          out[px] = bg[0] + (c[0] - bg[0]) * k; out[px + 1] = bg[1] + (c[1] - bg[1]) * k; out[px + 2] = bg[2] + (c[2] - bg[2]) * k; out[px + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0); tex.needsUpdate = true;
    },
  };
  api.draw(0);
  return api;
}

// ---- main texture set ----------------------------------------------------------------------------
export function makeTextures() {
  const T = {}, tm = {}, now = () => performance.now();
  let t0 = now();
  const lap = (k) => { const t = now(); tm[k] = Math.round(t - t0); t0 = t; };
  const rnd = mulberry32(90210);

  // Body tile (2 m x 2 m): brushed panels, seams, rivets, grime streaks. Light so vertex colours carry the livery.
  T.body = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#d6d9da'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 520; i++) {
      const x = rnd() * w, y = rnd() * h, l = 40 + rnd() * 240, a = 0.025 + rnd() * 0.05, dk = rnd() < 0.5;
      ctx.strokeStyle = dk ? `rgba(40,50,55,${a})` : `rgba(255,255,255,${a})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + l); ctx.stroke();
    }
    // seams
    ctx.fillStyle = 'rgba(35,42,46,0.55)'; ctx.fillRect(0, 0, 3, h); ctx.fillRect(w - 2, 0, 2, h); ctx.fillRect(0, 0, w, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(3, 0, 1, h); ctx.fillRect(0, 3, w, 1);
    // rivets
    for (let i = 0; i < 19; i++) {
      const y = 12 + i * 27; for (const x of [12, w - 10]) { ctx.fillStyle = 'rgba(30,36,40,0.5)'; ctx.beginPath(); ctx.arc(x + 1, y + 1, 2.6, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill(); }
      const x2 = 12 + i * 27; ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(x2, 12, 2.2, 0, 7); ctx.fill();
    }
    // drip streaks + blotches
    for (let i = 0; i < 34; i++) {
      const x = rnd() * w, len = 90 + rnd() * 330, wd = 2 + rnd() * 9, g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(70,60,45,0)'); g.addColorStop(0.15, `rgba(70,60,45,${0.06 + rnd() * 0.12})`); g.addColorStop(1, 'rgba(70,60,45,0)');
      ctx.save(); ctx.translate(0, rnd() * h); ctx.fillStyle = g; ctx.fillRect(x, 0, wd, len); ctx.restore();
    }
    for (let i = 0; i < 46; i++) blob(ctx, rnd() * w, rnd() * h, 14 + rnd() * 60, '55,50,42', 0.04 + rnd() * 0.08);
    speckleFast(ctx, w, h, 11, 0.16);
  }, { aniso: 8 });
  lap('body'); T.bodyN = bodyNormal(512, 3.2); lap('bodyN');

  // Window glass: tinted with dirt, dust at the sill, diagonal reflection streak
  T.glass = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(16,26,32,0.34)'; ctx.fillRect(0, 0, w, h);
    const d = ctx.createLinearGradient(0, h, 0, h * 0.45); d.addColorStop(0, 'rgba(78,72,58,0.42)'); d.addColorStop(1, 'rgba(78,72,58,0)'); ctx.fillStyle = d; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.rotate(-0.5); const s = ctx.createLinearGradient(0, 0, 60, 0);
    s.addColorStop(0, 'rgba(210,230,245,0)'); s.addColorStop(0.5, 'rgba(210,230,245,0.11)'); s.addColorStop(1, 'rgba(210,230,245,0)');
    ctx.fillStyle = s; ctx.fillRect(60, -100, 60, 500); ctx.fillStyle = s; ctx.fillRect(160, -100, 30, 500); ctx.restore();
    for (let i = 0; i < 22; i++) { const x = rnd() * w, y = rnd() * h * 0.6, l = 30 + rnd() * 120; ctx.strokeStyle = `rgba(150,160,160,${0.05 + rnd() * 0.1})`; ctx.lineWidth = 1 + rnd() * 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rnd() * 4 - 2, y + l); ctx.stroke(); }
    for (let i = 0; i < 14; i++) blob(ctx, rnd() * w, rnd() * h, 8 + rnd() * 30, '40,36,30', 0.08 + rnd() * 0.1);
  });
  T.glass.wrapS = T.glass.wrapT = THREE.ClampToEdgeWrapping;

  lap('glass');
  // Interior grain (neutral so vertex colours drive the look)
  T.grain = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e4e4e2'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) blob(ctx, rnd() * w, rnd() * h, 10 + rnd() * 40, '80,80,76', 0.05 + rnd() * 0.07);
    for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.16})`; ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
    speckleFast(ctx, w, h, 23, 0.2);
  });

  // Exterior decal atlas
  const extItems = [
    { name: 'logo', w: 512, h: 128, draw: (ctx, w, h) => {
      ctx.fillStyle = '#e2741c'; ctx.beginPath(); ctx.arc(64, 64, 52, 0, 7); ctx.fill(); ctx.fillStyle = '#f4efe2'; ctx.beginPath(); ctx.arc(64, 64, 41, 0, 7); ctx.fill();
      txt(ctx, 'N', 64, 66, 62, '#173544'); ctx.fillStyle = '#e2741c'; ctx.fillRect(100, 88, 400, 9);
      txt(ctx, 'NORTHLINE', 106, 52, 66, '#173544', 'left'); wear(ctx, w, h, mulberry32(3), 90, 0.8);
    } },
    ...[0, 1, 2].map((k) => ({ name: 'plate' + k, w: 192, h: 96, draw: (ctx, w, h, r) => {
      ctx.fillStyle = '#10181c'; ctx.fillRect(4, 4, w - 8, h - 8); ctx.strokeStyle = '#d9d4c4'; ctx.lineWidth = 4; ctx.strokeRect(8, 8, w - 16, h - 16);
      txt(ctx, 'NL ' + (4011 + k), w / 2, h / 2 + 2, 40, '#e8e2d0'); wear(ctx, w, h, r, 30, 0.6);
    } })),
    ...[0, 1, 2].map((k) => ({ name: 'streak' + k, w: 128, h: 256, draw: (ctx, w, h, r) => {
      for (let i = 0; i < 9; i++) { const x = 8 + r() * (w - 16), len = 60 + r() * 190, g = ctx.createLinearGradient(0, 0, 0, len); g.addColorStop(0, `rgba(50,40,30,${0.35 + r() * 0.3})`); g.addColorStop(1, 'rgba(50,40,30,0)'); ctx.fillStyle = g; ctx.fillRect(x, 0, 2 + r() * 8, len); }
      const g2 = ctx.createLinearGradient(0, 0, 0, 40); g2.addColorStop(0, 'rgba(40,32,26,0.5)'); g2.addColorStop(1, 'rgba(40,32,26,0)'); ctx.fillStyle = g2; ctx.fillRect(0, 0, w, 40);
    } })),
    ...[0, 1].map((k) => ({ name: 'rust' + k, w: 256, h: 128, draw: (ctx, w, h, r) => {
      for (let i = 0; i < 40; i++) blob(ctx, r() * w, h * (0.35 + r() * 0.65), 8 + r() * 30, k ? '120,60,25' : '140,70,30', 0.18 + r() * 0.3);
      wear(ctx, w, h, r, 40, 0.5);
    } })),
    ...[0, 1, 2, 3].map((k) => ({ name: 'blood' + k, w: 256, h: 256, draw: (ctx, w, h, r) => bloodSmear(ctx, w, h, r, k) })),
    ...[0, 1].map((k) => ({ name: 'hand' + k, w: 128, h: 128, draw: (ctx, w, h, r) => handPrint(ctx, w, h, r) })),
    { name: 'claw', w: 256, h: 256, draw: (ctx, w, h, r) => {
      for (let i = 0; i < 4; i++) { const x0 = 70 + i * 26 + r() * 6, x1 = x0 + 50 + r() * 22;
        ctx.strokeStyle = 'rgba(30,26,22,0.55)'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, 30); ctx.quadraticCurveTo((x0 + x1) / 2 + 10, 130, x1, 225); ctx.stroke();
        ctx.strokeStyle = 'rgba(225,230,232,0.75)'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(x0 - 1, 30); ctx.quadraticCurveTo((x0 + x1) / 2 + 9, 130, x1 - 1, 225); ctx.stroke(); }
    } },
    ...[0, 1].map((k) => ({ name: 'tag' + k, w: 256, h: 128, draw: (ctx, w, h, r) => {
      const words = ['NO LAST STOP', 'ZERO'], cols = ['#f3f0e6', '#ffd23a'];
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-0.12 + k * 0.2); ctx.lineJoin = 'round';
      ctx.font = `bold ${k ? 84 : 25}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(15,15,15,0.85)'; ctx.lineWidth = 9; ctx.strokeText(words[k], 0, 0); ctx.fillStyle = cols[k]; ctx.fillText(words[k], 0, 0); ctx.restore();
      ctx.fillStyle = cols[k]; for (let i = 0; i < 5; i++) ctx.fillRect(40 + r() * 170, h * 0.62, 2.2, 14 + r() * 40); wear(ctx, w, h, r, 30, 0.6);
    } })),
    { name: 'warn', w: 128, h: 128, draw: (ctx, w, h) => {
      ctx.fillStyle = '#f2c31d'; ctx.beginPath(); ctx.moveTo(64, 8); ctx.lineTo(122, 112); ctx.lineTo(6, 112); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 6; ctx.stroke();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(70, 34); ctx.lineTo(48, 72); ctx.lineTo(62, 72); ctx.lineTo(54, 100); ctx.lineTo(82, 62); ctx.lineTo(66, 62); ctx.closePath(); ctx.fill();
    } },
    { name: 'lean', w: 256, h: 64, draw: (ctx, w, h) => { ctx.fillStyle = '#f2c31d'; ctx.fillRect(0, 0, w, h); txt(ctx, 'DO NOT LEAN ON DOORS', w / 2, h / 2 + 1, 24, '#141414'); ctx.strokeStyle = '#141414'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, w - 4, h - 4); } },
  ];
  lap('grain'); T.extAtlas = makeAtlas(1024, extItems, 4242); lap('extAtlas');

  // Interior decal atlas
  const adDraw = (bg1, bg2, big, small, accent) => (ctx, w, h, r) => {
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, bg1); g.addColorStop(1, bg2); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(w * 0.82, h * 0.5, h * 0.42, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(0, h * 0.72, w, h * 0.28);
    txt(ctx, big, w * 0.36, h * 0.38, h * 0.3, '#fff8e8'); txt(ctx, small, w * 0.36, h * 0.82, h * 0.13, '#f4f4f4');
    ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(20,20,20,0.55)'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    for (let i = 0; i < 8; i++) blob(ctx, r() * w, r() * h, 8 + r() * 26, '40,36,30', 0.1 + r() * 0.15);
    // torn corner
    ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.moveTo(w, h); ctx.lineTo(w - 26 - r() * 20, h); ctx.lineTo(w, h - 20 - r() * 20); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
  };
  const intItems = [
    { name: 'ad0', w: 320, h: 112, draw: adDraw('#1d5f8a', '#0f2c45', 'NIGHT BUS', 'REPLACES ALL TRAINS AFTER 00:00', '#f2a51d') },
    { name: 'ad1', w: 320, h: 112, draw: adDraw('#8a1d2c', '#3d0a12', 'DENTIST 24H', 'NO APPOINTMENT? NO PROBLEM.', '#f4e3b0') },
    { name: 'ad2', w: 320, h: 112, draw: adDraw('#2b6b3c', '#0d2b18', 'PIZZA ZERO', 'HOT SLICES · PLATFORM 2 KIOSK', '#e2541c') },
    { name: 'ad3', w: 320, h: 112, draw: adDraw('#4a3a7a', '#1a1230', 'LOST?', 'CALL 0800-NO-EXIT ANYTIME', '#5ad2c8') },
    { name: 'route', w: 800, h: 160, draw: (ctx, w, h) => {
      ctx.fillStyle = '#f0ecdc'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#173544'; ctx.fillRect(0, 0, w, 30); txt(ctx, 'NORTHLINE  ·  LINE 2', 110, 16, 22, '#f0ecdc');
      ctx.strokeStyle = '#e2741c'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(40, 92); ctx.lineTo(w - 40, 92); ctx.stroke();
      const names = ['HARBOUR', 'MILL ST', 'CITY HALL', 'STATION ZERO', 'DEEPWAY', 'ORCHARD', 'TERMINUS'];
      names.forEach((n, i) => { const x = 70 + i * ((w - 140) / 6), cur = i === 3; ctx.fillStyle = cur ? '#c8261e' : '#f0ecdc'; ctx.strokeStyle = '#173544'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, 92, cur ? 14 : 9, 0, 7); ctx.fill(); ctx.stroke(); txt(ctx, n, x, i % 2 ? 132 : 56, cur ? 17 : 14, cur ? '#c8261e' : '#173544'); });
      ctx.strokeStyle = '#c8261e'; ctx.lineWidth = 4; const cx = 70 + 3 * ((w - 140) / 6); ctx.beginPath(); ctx.moveTo(cx - 34, 58); ctx.lineTo(cx - 12, 80); ctx.moveTo(cx - 12, 58); ctx.lineTo(cx - 34, 80); ctx.stroke();
    } },
    { name: 'notice', w: 192, h: 192, draw: (ctx, w, h, r) => {
      ctx.fillStyle = '#f2f0e8'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#c8261e'; ctx.fillRect(0, 0, w, 44); txt(ctx, 'EMERGENCY', w / 2, 24, 26, '#fff');
      txt(ctx, 'PRESS INTERCOM', w / 2, 66, 16, '#222'); txt(ctx, 'AND WAIT FOR', w / 2, 86, 16, '#222'); txt(ctx, 'THE DRIVER', w / 2, 106, 16, '#222');
      ctx.fillStyle = '#c8261e'; ctx.beginPath(); ctx.arc(w / 2, 152, 26, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillRect(w / 2 - 4, 132, 8, 26); ctx.fillRect(w / 2 - 4, 162, 8, 8);
      for (let i = 0; i < 5; i++) blob(ctx, r() * w, r() * h, 10 + r() * 24, '40,30,24', 0.12);
    } },
    { name: 'nosmoke', w: 96, h: 96, draw: (ctx, w, h) => {
      ctx.fillStyle = '#f2f0e8'; ctx.beginPath(); ctx.arc(48, 48, 44, 0, 7); ctx.fill(); ctx.strokeStyle = '#c8261e'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(48, 48, 38, 0, 7); ctx.moveTo(22, 74); ctx.lineTo(74, 22); ctx.stroke();
      ctx.fillStyle = '#222'; ctx.fillRect(24, 44, 40, 8); ctx.fillStyle = '#c8261e'; ctx.fillRect(64, 44, 8, 8);
    } },
    ...[0, 1, 2, 3].map((k) => ({ name: 'blood' + k, w: 192, h: 192, draw: (ctx, w, h, r) => bloodSmear(ctx, w, h, r, k) })),
    ...[0, 1].map((k) => ({ name: 'hand' + k, w: 96, h: 96, draw: (ctx, w, h, r) => handPrint(ctx, w, h, r) })),
    { name: 'drag', w: 384, h: 96, draw: (ctx, w, h, r) => {
      for (let i = 0; i < 44; i++) { const t = i / 43; blob(ctx, 20 + t * (w - 40), h / 2 + Math.sin(t * 6) * 10 + (r() - 0.5) * 8, 12 + r() * 12, r() < 0.5 ? '90,10,10' : '60,8,8', 0.35 + r() * 0.3); }
      for (let i = 0; i < 6; i++) { ctx.strokeStyle = 'rgba(80,10,10,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); const x = 30 + r() * (w - 60); ctx.moveTo(x, h * 0.3); ctx.lineTo(x + (r() - 0.5) * 30, h * 0.9); ctx.stroke(); }
    } },
    ...[0, 1, 2].map((k) => ({ name: 'spat' + k, w: 160, h: 160, draw: (ctx, w, h, r) => { for (let i = 0; i < 46; i++) { const a = r() * 6.28, d = Math.pow(r(), 1.6) * 70; blob(ctx, 80 + Math.cos(a) * d, 80 + Math.sin(a) * d, 1.5 + (1 - d / 70) * 9 * r(), '95,10,10', 0.9); } } })),
    ...[0, 1].map((k) => ({ name: 'grime' + k, w: 128, h: 128, draw: (ctx, w, h, r) => { for (let i = 0; i < 12; i++) blob(ctx, r() * w, r() * h, 12 + r() * 40, '30,26,20', 0.12 + r() * 0.2); } })),
    { name: 'floorline', w: 96, h: 192, draw: (ctx, w, h) => {
      ctx.fillStyle = 'rgba(242,195,29,0.9)'; ctx.fillRect(4, 0, 10, h); ctx.fillRect(w - 14, 0, 10, h);
      ctx.strokeStyle = 'rgba(242,195,29,0.85)'; ctx.lineWidth = 8; for (let y = 20; y < h; y += 34) { ctx.beginPath(); ctx.moveTo(w * 0.2, y + 12); ctx.lineTo(w * 0.5, y); ctx.lineTo(w * 0.8, y + 12); ctx.stroke(); }
      wear(ctx, w, h, mulberry32(9), 60, 0.8);
    } },
    { name: 'scuff', w: 256, h: 64, draw: (ctx, w, h, r) => { for (let i = 0; i < 26; i++) { ctx.strokeStyle = `rgba(20,18,14,${0.1 + r() * 0.25})`; ctx.lineWidth = 2 + r() * 4; ctx.beginPath(); const x = r() * w, y = r() * h; ctx.moveTo(x, y); ctx.lineTo(x + 20 + r() * 60, y + (r() - 0.5) * 12); ctx.stroke(); } } },
  ];
  T.intAtlas = makeAtlas(1024, intItems, 777); lap('intAtlas');

  // Soft glow / flare / spill / steam
  T.glow = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.12, 'rgba(255,255,255,0.75)'); g.addColorStop(0.35, 'rgba(255,255,255,0.22)'); g.addColorStop(0.7, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { wrap: false });
  T.flare = canvasTexture(256, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(128, 64, 0, 128, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.15, 'rgba(255,250,235,0.7)'); g.addColorStop(0.45, 'rgba(255,240,215,0.16)'); g.addColorStop(1, 'rgba(255,240,215,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const s = ctx.createLinearGradient(0, 0, w, 0); s.addColorStop(0, 'rgba(255,245,225,0)'); s.addColorStop(0.5, 'rgba(255,245,225,0.55)'); s.addColorStop(1, 'rgba(255,245,225,0)');
    ctx.fillStyle = s; ctx.fillRect(0, 62, w, 4); ctx.fillStyle = s; ctx.globalAlpha = 0.3; ctx.fillRect(0, 60, w, 8);
  }, { wrap: false });
  T.spill = canvasTexture(128, 128, (ctx, w, h) => {
    // u across the door (0..1), v = distance from the train (0 near .. 1 far) -> brightness on black for additive blending
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / (w - 1) - 0.5, v = y / (h - 1), side = Math.max(0, 1 - Math.pow(Math.abs(u) * 2, 2.2)), fall = Math.pow(1 - v, 2.1), i = (y * w + x) * 4, k = Math.min(1, side * fall * 1.2) * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = k; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { wrap: false });
  T.spill.colorSpace = THREE.NoColorSpace;
  T.pool = canvasTexture(128, 128, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / (w - 1) - 0.5, v = y / (h - 1), i = (y * w + x) * 4, side = Math.max(0, 1 - Math.pow(Math.abs(u) * 2, 1.6)), fall = Math.pow(1 - v, 1.3), k = Math.min(1, side * fall) * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = k; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { wrap: false });
  T.pool.colorSpace = THREE.NoColorSpace;

  lap('glows');
  // LED signs
  T.signFront = makeLedSign(512, 128, ['STATION ZERO', 'NOT IN SERVICE'], { pitch: 4 });
  T.signDoor = makeLedSign(512, 64, ['STATION ZERO'], { pitch: 4, on: '#ff5a2a', dim: '#260a04' });
  lap('signs'); T.timing = tm;
  return T;
}
