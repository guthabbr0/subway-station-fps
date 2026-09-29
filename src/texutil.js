// Canvas texture helpers shared by procedural-texture code.
import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Draw into a canvas and wrap as a texture. drawFn(ctx, w, h). opts: {repeat:[x,y], srgb=true, aniso=4, wrap=true}
export function canvasTexture(w, h, drawFn, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true }); drawFn(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.wrap !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.anisotropy = opts.aniso ?? 4;
  return t;
}

// Cheap value noise painter: adds speckle/grime to a canvas. amount 0..1
export function speckle(ctx, w, h, rnd, amount = 0.15, dark = true) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 255 * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

// Height/bump -> normal map from a canvas of grayscale heights.
export function normalFromCanvas(srcCanvas, strength = 2) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true }), src = sctx.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const octx = out.getContext('2d'), o = octx.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    o.data[i] = (-dx / l * 0.5 + 0.5) * 255; o.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; o.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; o.data[i + 3] = 255;
  }
  octx.putImageData(o, 0, 0);
  const t = new THREE.CanvasTexture(out); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
