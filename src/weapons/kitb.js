// Shared viewmodel kit for the heavy weapons (chaingun, rocket, plasma, bfg): geometry builder (merges by material),
// procedural textures/materials, gloved hands, smoke/steam puffs, LCD displays, view->world helpers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, mulberry32 } from '../texutil.js';

export const DEG = Math.PI / 180;
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0), _c = new THREE.Vector3();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------------------------
// Geometry builder: accumulate primitives, then merge per material into one mesh each (few draw calls, lots of detail)
// ---------------------------------------------------------------------------------------------------------------
export class Builder {
  constructor() { this.lists = new Map(); }
  put(mat, geo, x, y, z, q, sx = 1, sy = 1, sz = 1) {
    geo.applyMatrix4(_m4.compose(_p.set(x, y, z), q, _s.set(sx, sy, sz)));
    let l = this.lists.get(mat); if (!l) this.lists.set(mat, l = []);
    l.push(geo); return this;
  }
  _eu(rx, ry, rz) { return _q.setFromEuler(_e.set(rx, ry, rz)); }
  box(mat, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { return this.put(mat, new THREE.BoxGeometry(w, h, d), x, y, z, this._eu(rx, ry, rz)); }
  cyl(mat, rTop, rBot, h, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 14, open = false) { return this.put(mat, new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open), x, y, z, this._eu(rx, ry, rz)); }
  // cylinder/cone along Z, rFront is the radius at the -Z (muzzle) end
  cylZ(mat, rFront, rBack, len, x = 0, y = 0, z = 0, seg = 14, open = false) { return this.cyl(mat, rFront, rBack, len, x, y, z, -Math.PI / 2, 0, 0, seg, open); }
  cylX(mat, r, len, x = 0, y = 0, z = 0, seg = 12) { return this.cyl(mat, r, r, len, x, y, z, 0, 0, Math.PI / 2, seg); }
  sph(mat, r, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ws = 12, hs = 8) { return this.put(mat, new THREE.SphereGeometry(r, ws, hs), x, y, z, _q.identity(), sx, sy, sz); }
  tor(mat, R, r, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 20, tube = 6) { return this.put(mat, new THREE.TorusGeometry(R, r, tube, seg), x, y, z, this._eu(rx, ry, rz)); }
  limb(mat, r, a, b, seg = 8) {
    _c.subVectors(b, a); const total = _c.length(), len = Math.max(1e-4, total - 2 * r);
    _q.setFromUnitVectors(_Y, _c.multiplyScalar(1 / total));
    return this.put(mat, new THREE.CapsuleGeometry(r, len, 3, seg), (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, _q);
  }
  build(parent = new THREE.Group()) {
    for (const [mat, list] of this.lists) {
      const g = mergeGeometries(list, false);
      for (const l of list) l.dispose();
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; parent.add(m);
    }
    this.lists.clear(); return parent;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------------------------
const TEX = {};
const once = (k, f) => TEX[k] || (TEX[k] = f());

function grime(ctx, w, h, r, n, a = 0.1) {
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, rad = 10 + r() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, `rgba(0,0,0,${a * (0.4 + r())})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}
function streaks(ctx, w, h, r, n, alpha) {
  for (let i = 0; i < n; i++) {
    const y = r() * h, x = r() * w, l = 20 + r() * 140, v = r() < 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * (0.3 + r())})`; ctx.fillRect(x, y, l, 1);
  }
}

export function metalTexture() {
  return once('metal', () => canvasTexture(256, 256, (ctx, w, h) => {
    const r = mulberry32(11);
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#a4a9b0'); g.addColorStop(0.5, '#8d939b'); g.addColorStop(1, '#7c828a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    streaks(ctx, w, h, r, 1000, 0.09);
    for (let i = 0; i < 220; i++) { ctx.fillStyle = `rgba(0,0,0,${0.06 + r() * 0.16})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    ctx.lineWidth = 1;
    for (let i = 0; i < 46; i++) {
      const x = r() * w, y = r() * h, a = r() * Math.PI, l = 8 + r() * 40;
      ctx.strokeStyle = `rgba(255,255,255,${0.08 + r() * 0.2})`; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    grime(ctx, w, h, r, 9, 0.12);
  }));
}

// Painted metal with chips, grime and edge wear. base = css colour.
export function paintTexture(base, seed = 5, chip = '#9aa0a6') {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const r = mulberry32(seed);
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    streaks(ctx, w, h, r, 700, 0.06);
    for (let i = 0; i < 1800; i++) { const v = r() < 0.5 ? 0 : 255; ctx.fillStyle = `rgba(${v},${v},${v},${0.02 + r() * 0.05})`; ctx.fillRect(r() * w, r() * h, 1, 1); }
    // chips, biased to the borders (edge wear)
    for (let i = 0; i < 90; i++) {
      let x = r() * w, y = r() * h;
      if (r() < 0.6) { const s = Math.floor(r() * 4); if (s === 0) x = r() * 10; else if (s === 1) x = w - r() * 10; else if (s === 2) y = r() * 10; else y = h - r() * 10; }
      ctx.fillStyle = chip; ctx.globalAlpha = 0.5 + r() * 0.5; ctx.beginPath();
      const n = 4 + Math.floor(r() * 3), rad = 1 + r() * 3.5;
      for (let k = 0; k < n; k++) { const a = k / n * 6.283, rr = rad * (0.5 + r()); ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // dirt streaks + grime
    for (let i = 0; i < 24; i++) { const x = r() * w, y = r() * h * 0.6, l = 20 + r() * 90; const gr = ctx.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, 'rgba(20,14,8,0.0)'); gr.addColorStop(0.3, `rgba(20,14,8,${0.08 + r() * 0.12})`); gr.addColorStop(1, 'rgba(20,14,8,0)'); ctx.fillStyle = gr; ctx.fillRect(x, y, 1 + r() * 2, l); }
    grime(ctx, w, h, r, 10, 0.16);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3; ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.strokeRect(4, 4, w - 8, h - 8);
  });
}

export function leatherTexture() {
  return once('leather', () => canvasTexture(128, 128, (ctx, w, h) => {
    const r = mulberry32(21);
    ctx.fillStyle = '#7a6448'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = r() < 0.5 ? 0 : 255; ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + r() * 0.06})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
    for (let i = 0; i < 30; i++) { const y = r() * h; ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 10, w * 0.6, y + (r() - 0.5) * 10, w, y + (r() - 0.5) * 8); ctx.stroke(); }
    ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(210,190,150,0.5)'; ctx.strokeRect(6, 6, w - 12, h - 12); ctx.setLineDash([]);
    grime(ctx, w, h, r, 5, 0.2);
  }));
}

export function fabricTexture(base = '#4a5a3c') {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const r = mulberry32(31);
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { ctx.fillStyle = `rgba(0,0,0,${0.08 + (y % 4) * 0.02})`; ctx.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 2) { ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(x, 0, 1, h); }
    for (let i = 0; i < 14; i++) { const x = r() * w; const gr = ctx.createLinearGradient(x, 0, x + 12, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, `rgba(0,0,0,${0.12 + r() * 0.18})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.fillRect(x, 0, 12, h); }
    grime(ctx, w, h, r, 6, 0.22);
  });
}

export function hazardTexture() {
  return once('hazard', () => canvasTexture(128, 32, (ctx, w, h) => {
    const r = mulberry32(9);
    ctx.fillStyle = '#d9a91c'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#16171a';
    for (let x = -h; x < w + h; x += 22) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 11, h); ctx.lineTo(x + 11 + h, 0); ctx.lineTo(x + h, 0); ctx.closePath(); ctx.fill(); }
    for (let i = 0; i < 400; i++) { const v = r() < 0.5 ? 0 : 255; ctx.fillStyle = `rgba(${v},${v},${v},${0.05 + r() * 0.1})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }
    grime(ctx, w, h, r, 4, 0.25);
  }));
}

export function rubberTexture() {
  return once('rubber', () => canvasTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#26282a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (let y = 0; y < h; y += 4) for (let x = (y / 4) % 2 ? 0 : 2; x < w; x += 4) ctx.fillRect(x, y, 2, 2);
  }));
}

// Text stencil decal (transparent background)
export function stencilTexture(lines, { w = 256, h = 128, color = '#e6e0c8', size = 30, weight = 'bold', font = 'Arial, sans-serif', align = 'left' } = {}) {
  return canvasTexture(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = color; ctx.font = `${weight} ${size}px ${font}`; ctx.textBaseline = 'top'; ctx.textAlign = align;
    const lh = size * 1.1;
    lines.forEach((t, i) => ctx.fillText(t, align === 'left' ? 6 : align === 'center' ? w / 2 : w - 6, 4 + i * lh));
  }, { wrap: false });
}

export function glowTexture() {
  return once('glow', () => canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.75)'); g.addColorStop(0.5, 'rgba(255,255,255,0.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { wrap: false }));
}
export function sparkTexture() {
  return once('spark', () => canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(31, 4, 2, 56); ctx.fillRect(4, 31, 56, 2);
  }, { wrap: false }));
}
export function smokeTexture() {
  return once('smoke', () => canvasTexture(128, 128, (ctx, w, h) => {
    const r = mulberry32(77);
    for (let i = 0; i < 34; i++) {
      const a = r() * 6.283, d = r() * 34, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, rad = 12 + r() * 26;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    // fade the outer rim to zero
    const m = ctx.createRadialGradient(64, 64, 30, 64, 64, 64); m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = m; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
  }, { wrap: false }));
}
// gradient streak: bright at v=0 (head) fading to v=1 (tail); used by bolts.
export function streakTexture() {
  return once('streak', () => canvasTexture(32, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.15, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const gx = ctx.createLinearGradient(0, 0, w, 0); gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = gx; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
  }, { wrap: false }));
}

// ---------------------------------------------------------------------------------------------------------------
// Environment map (tiny PMREM of a bright "station" room) so metals have something to reflect
// ---------------------------------------------------------------------------------------------------------------
let ENV = null;
export function getEnv(game) {
  if (ENV) return ENV;
  const sc = new THREE.Scene();
  const dome = new THREE.SphereGeometry(20, 24, 14), pos = dome.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 20; // -1 .. 1
    const c = t > 0 ? [0.20 + 0.45 * t, 0.24 + 0.5 * t, 0.30 + 0.6 * t] : [0.20 + 0.15 * t, 0.19 + 0.15 * t, 0.2 + 0.16 * t];
    col[i * 3] = Math.max(0.02, c[0]); col[i * 3 + 1] = Math.max(0.02, c[1]); col[i * 3 + 2] = Math.max(0.02, c[2]);
  }
  dome.setAttribute('color', new THREE.BufferAttribute(col, 3));
  sc.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const panel = (w, h, x, y, z, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); sc.add(m); };
  panel(9, 0.9, 0, 9, -3, [7, 7.2, 7.6]); panel(9, 0.9, 0, 9, 4, [6, 6.2, 6.6]);
  panel(4, 3, -12, 3, -3, [2.6, 1.5, 0.7]); panel(4, 3, 12, 2, 6, [0.8, 1.4, 2.6]);
  panel(6, 2, 0, -1, -14, [1.4, 1.5, 1.7]);
  const pm = new THREE.PMREMGenerator(game.renderer);
  ENV = pm.fromScene(sc, 0.03).texture; pm.dispose();
  return ENV;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------------------------------------------
let MATS = null;
export function getMats(game) {
  if (MATS) return MATS;
  const env = getEnv(game), mt = metalTexture();
  const mk = (o) => new THREE.MeshStandardMaterial({ envMap: env, envMapIntensity: 1.5, ...o });
  const leather = leatherTexture();
  MATS = {
    env,
    steel: mk({ color: 0xc8cdd4, map: mt, bumpMap: mt, bumpScale: 0.7, metalness: 0.85, roughness: 0.34 }),
    darkSteel: mk({ color: 0x565c66, map: mt, bumpMap: mt, bumpScale: 0.7, metalness: 0.85, roughness: 0.42 }),
    blued: mk({ color: 0x2c3138, map: mt, bumpMap: mt, bumpScale: 0.5, metalness: 0.92, roughness: 0.28 }),
    brass: mk({ color: 0xd2a04a, metalness: 0.95, roughness: 0.28 }),
    copper: mk({ color: 0xb8683a, metalness: 0.9, roughness: 0.32 }),
    rubber: mk({ color: 0x9a9c9e, map: rubberTexture(), metalness: 0.0, roughness: 0.92 }),
    black: mk({ color: 0x0a0b0c, metalness: 0.3, roughness: 0.6 }),
    hazard: mk({ color: 0xffffff, map: hazardTexture(), metalness: 0.3, roughness: 0.6 }),
    glove: mk({ color: 0xc8bba4, map: leather, metalness: 0.0, roughness: 0.82 }),
    gloveDark: mk({ color: 0x2b2c2f, map: rubberTexture(), metalness: 0.15, roughness: 0.55 }),
    sleeve: mk({ color: 0xffffff, map: fabricTexture('#4a5b3d'), metalness: 0.0, roughness: 0.95 }),
    cuff: mk({ color: 0x33363a, metalness: 0.1, roughness: 0.75 }),
    strap: mk({ color: 0x7a7f52, metalness: 0.0, roughness: 0.9 }),
  };
  return MATS;
}

// Painted metal material with its own colour (chips reveal steel).
export function paintMat(game, base, seed, o = {}) {
  return new THREE.MeshStandardMaterial({ envMap: getEnv(game), envMapIntensity: o.env ?? 0.8, map: paintTexture(base, seed, o.chip), bumpMap: metalTexture(), bumpScale: 0.6, color: o.tint ?? 0xffffff, metalness: o.metalness ?? 0.45, roughness: o.roughness ?? 0.55 });
}
export function glassMat(game, color, opacity = 0.35) {
  return new THREE.MeshStandardMaterial({ envMap: getEnv(game), envMapIntensity: 1.3, color, metalness: 0.1, roughness: 0.08, transparent: true, opacity, depthWrite: false });
}
export function glowBasic(r, g, b, extra = {}) { return new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false, ...extra }); }
export function additive(map, r, g, b, extra = {}) {
  return new THREE.MeshBasicMaterial({ map, color: new THREE.Color(r, g, b), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, ...extra });
}

// ---------------------------------------------------------------------------------------------------------------
// Hands. Local frame: forearm extends toward +Z, back of hand is +Y, fingers wrap around a rod along local X that sits
// under the palm (rod radius R at the origin). Index/thumb on the -X side (mirror with scale.x=-1 for a left hand).
// ---------------------------------------------------------------------------------------------------------------
export function buildHand(M, o = {}) {
  const R = o.R ?? 0.02, W = o.W ?? 0.076, curl = o.curl ?? 1, sleeveLen = o.sleeveLen ?? 0.6;
  const b = new Builder(), G = M.glove, K = M.gloveDark;
  const rfs = [0.0104, 0.0112, 0.0106, 0.0094], lens = [1, 1.06, 1.0, 0.86];
  const py = R + 0.0135 + 0.006;
  // back of hand + palm block
  b.box(G, W, 0.019, 0.07, 0, py, 0.03);
  b.sph(G, 1, 0, py + 0.002, 0.03, W * 0.54, 0.0125, 0.042);
  b.box(K, W * 0.86, 0.0055, 0.048, 0, py + 0.0125, 0.024, -0.1, 0, 0);            // knuckle/back plate
  b.box(K, W * 0.5, 0.004, 0.02, 0, py + 0.0135, 0.058, -0.05, 0, 0);
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  for (let i = 0; i < 4; i++) {
    const x = -W / 2 + W * (i + 0.5) / 4, rf = rfs[i], Rf = R + rf * 0.92, L = lens[i];
    const straight = o.trigger && i === 0;
    const pts = [];
    if (straight) { pts.push([x, py + 0.003, -0.012], [x, py - 0.004, -0.040], [x, py - 0.012, -0.064], [x, py - 0.02, -0.082]); }
    else for (const ang of [12, 58, 104, 148]) { const a = ang * curl * DEG; pts.push([x, Rf * Math.cos(a), -Rf * Math.sin(a)]); }
    // lift the first (knuckle) point to match the palm height
    if (!straight) pts[0][1] = py + 0.002;
    for (let j = 0; j < 3; j++) {
      A.set(...pts[j]); B.set(...pts[j + 1]);
      if (j === 2) B.lerp(A, 1 - L * 0.98 + 0.0);
      b.limb(G, rf * (j === 2 ? 0.94 : 1), A, B, 7);
      b.sph(G, rf * 1.04, B.x, B.y, B.z, 1, 1, 1, 8, 6);
    }
    b.sph(K, rf * 1.12, pts[0][0], pts[0][1] + 0.003, pts[0][2], 1, 0.8, 1, 8, 6); // knuckle pad
  }
  // thumb wraps alongside the index finger
  const th = [[-W / 2 + 0.003, py - 0.003, 0.05], [-W / 2 - 0.012, py - 0.008, 0.02], [-W / 2 - 0.013, py - 0.012, -0.012], [-W / 2 - 0.004, py - 0.014, -0.038]];
  for (let j = 0; j < 3; j++) { A.set(...th[j]); B.set(...th[j + 1]); b.limb(G, 0.0118 - j * 0.0008, A, B, 7); b.sph(G, 0.0122 - j * 0.0008, B.x, B.y, B.z, 1, 1, 1, 8, 6); }
  // wrist: cuff, strap, sleeve
  const wy = py - 0.004;
  b.cylZ(M.cuff, 0.038, 0.042, 0.04, 0, wy, 0.106, 16);
  b.box(M.strap, 0.05, 0.007, 0.032, 0, wy + 0.04, 0.086);
  b.box(K, 0.02, 0.004, 0.02, 0, wy + 0.0445, 0.086);
  b.cylZ(M.sleeve, 0.046, 0.066, sleeveLen, 0, wy, 0.125 + sleeveLen / 2, 16);
  b.tor(M.cuff, 0.047, 0.006, 0, wy, 0.128, 0, 0, 0, 16, 5);
  const g = new THREE.Group(); b.build(g); return g;
}

// Orient a hand: zDir = forearm direction (toward the elbow, out of the gun), xDir = rod axis. Y (back of hand) = Z x X.
export function poseHand(hand, pos, zDir, xDir, mirror = false) {
  const z = _v1.copy(zDir).normalize(), x = _v2.copy(xDir);
  x.addScaledVector(z, -x.dot(z)).normalize();
  const y = _v3.crossVectors(z, x);
  _m4.makeBasis(x, y, z); hand.quaternion.setFromRotationMatrix(_m4);
  hand.position.copy(pos); hand.scale.set(mirror ? -1 : 1, 1, 1);
  return hand;
}

// ---------------------------------------------------------------------------------------------------------------
// Smoke / steam / glow puffs living in the weapon's local space
// ---------------------------------------------------------------------------------------------------------------
export class Puffs {
  constructor(parent, n, map, { additive: add = false, color = 0xffffff, drag = 1.5 } = {}) {
    this.list = []; this.next = 0; this.drag = drag;
    for (let i = 0; i < n; i++) {
      const m = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, opacity: 0, color, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false, toneMapped: !add });
      const s = new THREE.Sprite(m); s.visible = false; s.renderOrder = 6; s.frustumCulled = false; parent.add(s);
      this.list.push({ s, m, on: false, age: 0, life: 1, vx: 0, vy: 0, vz: 0, s0: 0.1, s1: 0.3, op: 0.5, vr: 0 });
    }
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, op, vr = 0) {
    const p = this.list[this.next]; this.next = (this.next + 1) % this.list.length;
    p.on = true; p.age = 0; p.life = life; p.vx = vx; p.vy = vy; p.vz = vz; p.s0 = s0; p.s1 = s1; p.op = op; p.vr = vr;
    p.s.position.set(x, y, z); p.s.visible = true; p.m.rotation = Math.random() * 6.28; p.m.opacity = 0; p.s.scale.set(s0, s0, 1);
  }
  update(dt) {
    const k = Math.exp(-this.drag * dt);
    for (const p of this.list) {
      if (!p.on) continue;
      p.age += dt; const t = p.age / p.life;
      if (t >= 1) { p.on = false; p.s.visible = false; continue; }
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      const sz = p.s0 + (p.s1 - p.s0) * (1 - (1 - t) * (1 - t));
      p.s.scale.set(sz, sz, 1); p.m.rotation += p.vr * dt;
      p.m.opacity = p.op * Math.min(1, p.age / 0.04) * (1 - t) * (1 - t);
    }
  }
  clear() { for (const p of this.list) { p.on = false; p.s.visible = false; } }
}

// ---------------------------------------------------------------------------------------------------------------
// Little LCD readout (canvas texture, redrawn only when the key changes)
// ---------------------------------------------------------------------------------------------------------------
export class LCD {
  constructor(w, h, draw) {
    this.w = w; this.h = h; this.canvas = document.createElement('canvas'); this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d'); this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }); this.draw = draw; this.last = null;
  }
  set(key, ...args) { if (key === this.last) return; this.last = key; this.draw(this.ctx, this.w, this.h, key, ...args); this.tex.needsUpdate = true; }
}

// ---------------------------------------------------------------------------------------------------------------
// View space -> world space: where a viewmodel point appears on screen, expressed as a world point along the same pixel ray.
// ---------------------------------------------------------------------------------------------------------------
const _vm = new THREE.Matrix4(), _wa = new THREE.Vector3(), _wb = new THREE.Vector3(), _wf = new THREE.Vector3();
export function viewToWorld(game, obj, out, ox = 0, oy = 0, oz = 0) {
  const cam = game.camera, vc = game.viewCamera;
  obj.updateWorldMatrix(true, false);
  _wa.set(ox, oy, oz).applyMatrix4(obj.matrixWorld);
  _vm.copy(vc.matrixWorld).invert();
  _wb.copy(_wa).applyMatrix4(_vm); const depth = -_wb.z;
  _wb.applyMatrix4(vc.projectionMatrix);
  _wb.set(_wb.x, _wb.y, 0.5).unproject(cam).sub(cam.position).normalize();
  cam.getWorldDirection(_wf);
  const c = Math.max(0.2, _wb.dot(_wf));
  return out.copy(cam.position).addScaledVector(_wb, depth / c);
}

// True when the straight segment eye -> muzzle is free of world geometry AND enemies (a projectile spawned at the muzzle beyond a point-blank enemy would never hit it).
const _cpD = new THREE.Vector3();
export function clearPath(game, a, b) {
  _cpD.copy(b).sub(a); const d = _cpD.length(); if (d < 1e-4) return true; _cpD.multiplyScalar(1 / d);
  const h = game.combat.castRay(a, _cpD, d); return !h;
}

// Aim: direction from `from` to the point the crosshair is on (world or enemy), falling back to the aim ray.
const _aimT = new THREE.Vector3();
export function aimDir(game, from, out, maxDist = 200) {
  const ray = game.player.getAimRay();
  const hit = game.combat.castRay(ray.origin, ray.dir, maxDist);
  if (hit) _aimT.copy(hit.point); else _aimT.copy(ray.origin).addScaledVector(ray.dir, maxDist);
  out.subVectors(_aimT, from);
  if (out.lengthSq() < 0.25 || out.dot(ray.dir) < 0) out.copy(ray.dir); else out.normalize();
  return out;
}

// Right/up vectors of the world camera (for ejecting casings, etc.)
export function camBasis(game, right, up) {
  const q = game.camera.quaternion;
  right.set(1, 0, 0).applyQuaternion(q); up.set(0, 1, 0).applyQuaternion(q);
}
