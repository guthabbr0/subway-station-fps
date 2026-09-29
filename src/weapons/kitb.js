// Shared "hero" kit for the heavy weapons (chaingun, rocket launcher, plasma rifle, BFG-9000).
// Builds on kit_a (materials, Parts builder, articulated gloved Hand) and adds: canvas-painted PBR plating (albedo + normal + ORM), an extended
// parts builder (crisp lathes, native-UV mode, bolt circles), a merged decal atlas (all stencils of one weapon = one draw call), pooled view-space
// puffs, LCD readouts, ribbon arcs (energy crackle), projectile helpers and a render-target-aware shader pre-warm.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getKit, Parts, Hand, keyframe, smooth } from './kit_a.js';
import { makeLayout, plateNormal, paintAlbedo, paintORM, mk, mkTex, hazardStripes } from './hero/paint.js';
import { mulberry32 } from '../texutil.js';

export const DEG = Math.PI / 180;
export { Parts, Hand, keyframe, smooth, getKit };
export * from './hero/paint.js';

// ---------------------------------------------------------------------------------------------------------------------------------
// Hero materials (built once, cached on game.__hero)
// ---------------------------------------------------------------------------------------------------------------------------------
export function getHero(game) {
  if (game.__hero) return game.__hero;
  const kit = getKit(game), env = kit.env, M = kit.M, T = {}, H = {};
  const pbr = (name, o, uv) => { const m = new THREE.MeshStandardMaterial({ envMap: env, ...o }); m.name = name; m.userData.uv = uv; H[name] = m; return m; };
  const ns = (v) => new THREE.Vector2(v, v);

  // --- military plating (rocket launcher tube, ammo box, chaingun receiver): heavy rivets + weld seams
  const lm = makeLayout(101, { cols: 2, rows: 3, weld: 0.34, rivetGap: 24, chips: 110, scratches: 50, dents: 8 });
  T.milN = plateNormal(lm, { seed: 101, strength: 2.7 }); T.milNormal = T.milN.texture;
  T.olive = paintAlbedo(lm, { base: '#66704a', seed: 111, tints: ['rgba(20,26,10,0.16)', 'rgba(150,160,100,0.08)'], chip: '#8d939a', stain: 'rgba(60,40,20,0.4)', speck: 0.06 });
  T.oliveOrm = paintORM(lm, { seed: 112, rough: 0.66, metal: 0.05 });
  T.gun = paintAlbedo(lm, { base: '#575e68', seed: 121, tints: ['rgba(0,0,0,0.18)', 'rgba(140,150,170,0.06)'], chip: '#9096a0', stain: 'rgba(40,30,22,0.4)', speck: 0.05 });
  T.gunOrm = paintORM(lm, { seed: 122, rough: 0.48, metal: 0.3 });
  pbr('olive', { map: T.olive, normalMap: T.milNormal, normalScale: ns(0.9), roughnessMap: T.oliveOrm, metalnessMap: T.oliveOrm, roughness: 1, metalness: 1, envMapIntensity: 0.9 }, 3.4);
  pbr('gunmetal', { map: T.gun, normalMap: T.milNormal, normalScale: ns(1.15), roughnessMap: T.gunOrm, metalnessMap: T.gunOrm, roughness: 1, metalness: 1, envMapIntensity: 1.5 }, 3.4);

  // --- plasma rifle: pale ceramic armour + dark chassis, fine panel lines, few rivets
  const lp = makeLayout(201, { cols: 3, rows: 3, weld: 0, rivetGap: 64, rivetOff: 10, chips: 44, scratches: 34, dents: 4 });
  T.plateN = plateNormal(lp, { seed: 201, strength: 2.0, groove: 3.0 }); T.plateNormal = T.plateN.texture;
  T.plate = paintAlbedo(lp, { base: '#74849a', seed: 211, tints: ['rgba(20,36,64,0.16)', 'rgba(255,255,255,0.08)'], chip: '#c9d2dc', stain: 'rgba(60,70,90,0.3)', speck: 0.04, seam: 'rgba(20,30,50,0.6)' });
  T.plateOrm = paintORM(lp, { seed: 212, rough: 0.36, metal: 0.30, chipRough: 0.35, chipMetal: 0.9 });
  T.plateD = paintAlbedo(lp, { base: '#1d2533', seed: 221, tints: ['rgba(0,0,0,0.2)', 'rgba(100,140,200,0.06)'], chip: '#7a828e', speck: 0.05, seam: 'rgba(0,0,0,0.7)' });
  T.plateDOrm = paintORM(lp, { seed: 222, rough: 0.5, metal: 0.3 });
  pbr('plate', { map: T.plate, normalMap: T.plateNormal, normalScale: ns(0.8), roughnessMap: T.plateOrm, metalnessMap: T.plateOrm, roughness: 1, metalness: 1, envMapIntensity: 1.25 }, 3.4);
  pbr('plateDark', { map: T.plateD, normalMap: T.plateNormal, normalScale: ns(0.8), roughnessMap: T.plateDOrm, metalnessMap: T.plateDOrm, roughness: 1, metalness: 1, envMapIntensity: 1.2 }, 3.4);

  // --- BFG: army-green armour + black-green chassis, chunky rivets and welds
  const lb = makeLayout(301, { cols: 2, rows: 2, weld: 0.5, rivetGap: 22, rivetOff: 9, chips: 100, scratches: 40, dents: 9 });
  T.bfgN = plateNormal(lb, { seed: 301, strength: 3.0 }); T.bfgNormal = T.bfgN.texture;
  T.bfgG = paintAlbedo(lb, { base: '#42583a', seed: 311, tints: ['rgba(8,20,6,0.2)', 'rgba(150,190,120,0.07)'], chip: '#8d959a', stain: 'rgba(30,50,20,0.4)', speck: 0.06 });
  T.bfgGOrm = paintORM(lb, { seed: 312, rough: 0.6, metal: 0.08 });
  T.bfgK = paintAlbedo(lb, { base: '#161c18', seed: 321, tints: ['rgba(0,0,0,0.22)', 'rgba(90,130,90,0.06)'], chip: '#8a9288', speck: 0.05, seam: 'rgba(0,0,0,0.8)' });
  T.bfgKOrm = paintORM(lb, { seed: 322, rough: 0.5, metal: 0.35 });
  pbr('bfgGreen', { map: T.bfgG, normalMap: T.bfgNormal, normalScale: ns(0.95), roughnessMap: T.bfgGOrm, metalnessMap: T.bfgGOrm, roughness: 1, metalness: 1, envMapIntensity: 1.0 }, 3.4);
  pbr('bfgBlack', { map: T.bfgK, normalMap: T.bfgNormal, normalScale: ns(0.95), roughnessMap: T.bfgKOrm, metalnessMap: T.bfgKOrm, roughness: 1, metalness: 1, envMapIntensity: 1.2 }, 3.4);

  // --- rocket round: cream body + red warhead, painted, sharing the plating normal
  const lr = makeLayout(401, { cols: 1, rows: 3, weld: 0.6, rivetGap: 30, chips: 60, scratches: 40, dents: 5 });
  T.rocketN = plateNormal(lr, { seed: 401, strength: 2.2 }); T.rocketNormal = T.rocketN.texture;
  T.rocketBody = paintAlbedo(lr, { base: '#d8d2bb', seed: 411, tints: ['rgba(60,50,20,0.16)', 'rgba(255,255,240,0.10)'], chip: '#7b7f86', stain: 'rgba(80,60,30,0.35)', speck: 0.05, seam: 'rgba(50,40,20,0.55)' });
  T.rocketHead = paintAlbedo(lr, { base: '#b42a1c', seed: 421, tints: ['rgba(40,0,0,0.2)', 'rgba(255,120,90,0.08)'], chip: '#8b7f78', stain: 'rgba(50,10,6,0.4)', speck: 0.05, seam: 'rgba(40,0,0,0.55)' });
  T.rocketOrm = paintORM(lr, { seed: 412, rough: 0.5, metal: 0.12, chipRough: 0.4, chipMetal: 0.8 });
  pbr('rocketBody', { map: T.rocketBody, normalMap: T.rocketNormal, normalScale: ns(0.8), roughnessMap: T.rocketOrm, metalnessMap: T.rocketOrm, roughness: 1, metalness: 1, envMapIntensity: 0.9 }, 3.4);
  pbr('rocketHead', { map: T.rocketHead, normalMap: T.rocketNormal, normalScale: ns(0.8), roughnessMap: T.rocketOrm, metalnessMap: T.rocketOrm, roughness: 1, metalness: 1, envMapIntensity: 1.0 }, 3.4);

  // --- hazard band (box-projected for flat parts, native-UV variant for bands around cylinders) + translucent glass
  T.hazard = hazardStripes();
  pbr('hazard', { map: T.hazard, roughness: 0.6, metalness: 0.3, envMapIntensity: 0.5 }, 9);
  T.hazardN = T.hazard.clone(); T.hazardN.repeat.set(10, 1); T.hazardN.needsUpdate = true;
  pbr('hazardN', { map: T.hazardN, roughness: 0.6, metalness: 0.3, envMapIntensity: 0.5 }, 1); H.hazardN.userData.native = true;
  pbr('glass', { color: 0x9fd8c8, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 0.8 }, 8);
  H.glass.side = THREE.FrontSide;
  // colour tokens for the shared vertex-colour materials (Parts merges them into one mesh)
  const tk = (name, hex, target) => { H[name] = { isVC: true, name, color: new THREE.Color(hex), target, userData: { uv: 8 } }; };
  tk('copper', 0xb8683a, M.vcMetal); tk('brassBright', 0xd8a84a, M.vcMetal); tk('steelVC', 0x9aa2ac, M.vcMetal); tk('redVC', 0xa01c14, M.vcDull); tk('orangeVC', 0xe8680e, M.vcDull); tk('yellowVC', 0xd8b020, M.vcDull);
  tk('cyanVC', 0x30a0c8, M.vcDull); tk('greenVC', 0x2a7a30, M.vcDull); tk('darkVC', 0x101215, M.vcDull); tk('lightVC', 0xc8ccd0, M.vcDull);
  return (game.__hero = { kit, M, env, T, H, mats: H });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Extended parts builder
// ---------------------------------------------------------------------------------------------------------------------------------
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
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
export class HParts extends Parts {
  // same as Parts.addMatrix, but a material with userData.native keeps the geometry's own UVs (cylinders: u around, v along)
  addMatrix(geo, mat, m4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    let key = mat;
    if (mat.isVC) { key = mat.target; const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = mat.color.r; c[i * 3 + 1] = mat.color.g; c[i * 3 + 2] = mat.color.b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') g.deleteAttribute(k);
    g.applyMatrix4(m4);
    if (m4.determinant() < 0) for (const k of ['position', 'normal', 'uv']) { const at = g.attributes[k], n = at.itemSize, arr = at.array; for (let i = 0; i < at.count; i += 3) for (let c = 0; c < n; c++) { const a = (i + 1) * n + c, b = (i + 2) * n + c, t = arr[a]; arr[a] = arr[b]; arr[b] = t; } }
    if (!key.userData.native) boxUV(g, key.userData.uv || 8);
    let a = this.by.get(key); if (!a) this.by.set(key, a = []); a.push(g); return this;
  }
  // rounded boxes are triangle-hungry (seg 2 = 300 tris): skip the bevel on tiny parts and use 1 segment (108 tris) on small/medium ones
  box(mat, size, p, r, rad = 0, seg) {
    const m = Math.min(size[0], size[1], size[2]);
    if (rad > 0 && m < 0.008) rad = 0;
    return super.box(mat, size, p, r, rad, seg ?? (m < 0.026 ? 1 : 2));
  }
  torus(mat, R, tube, p, r, seg = 20, s) { return super.torus(mat, R, tube, p, r, R < 0.03 ? Math.min(seg, 16) : seg, s); }
  // lathe with crisp (hard) edges: pts = [[radius, forwardDist, smooth?], ...]; every point is doubled unless its third element is truthy
  lathe2(mat, pts, p, r, seg = 24) {
    const out = [];
    pts.forEach((q, i) => { out.push([q[0], q[1]]); if (!q[2] && i > 0 && i < pts.length - 1) out.push([q[0], q[1]]); });
    return this.lathe(mat, out, p, r, seg);
  }
  // n small cylinders along Z arranged on a circle (bolt circle) around (cx, cy)
  boltCircle(mat, cx, cy, z, R, n, rad, len = 0.004, a0 = 0, seg = 8) {
    for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; this.cyl(mat, rad, rad, len, 'z', [cx + Math.cos(a) * R, cy + Math.sin(a) * R, z], null, seg); }
    return this;
  }
  // a row of n copies of a box along a direction
  row(mat, size, start, step, n, r, rad = 0) { for (let i = 0; i < n; i++) this.box(mat, size, [start[0] + step[0] * i, start[1] + step[1] * i, start[2] + step[2] * i], r, rad); return this; }
  // Phillips-style screw head (disc + dark slot) on a surface; axis 'x' | 'y' | 'z'
  screw(mat, slotMat, rad, p, axis = 'x', h = 0.0022) {
    this.cyl(mat, rad, rad, h, axis, p, null, 10);
    const q = [p[0], p[1], p[2]], off = h * 0.5 + 0.0002; if (axis === 'x') q[0] += Math.sign(p[0] || 1) * off; else if (axis === 'y') q[1] += off; else q[2] += Math.sign(p[2] || 1) * off;
    const sz = axis === 'x' ? [0.0004, rad * 1.5, 0.0006] : axis === 'y' ? [rad * 1.5, 0.0004, 0.0006] : [rad * 1.5, 0.0006, 0.0004];
    this.box(slotMat, sz, q, null, 0); return this;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Decal atlas: every stencil / label of a weapon is drawn into ONE canvas and merged into ONE transparent mesh (planes + curved patches)
// ---------------------------------------------------------------------------------------------------------------------------------
export class DecalSheet {
  constructor(game, w = 1024, h = 512) {
    this.game = game; this.w = w; this.h = h; [this.canvas, this.g] = mk(w, h); this.g.clearRect(0, 0, w, h);
    this.x = 2; this.y = 2; this.rowH = 0; this.geos = [];
  }
  // reserve a pw x ph pixel rect and let draw(g, x, y, pw, ph) paint it; returns the uv rect
  label(pw, ph, draw) {
    if (this.x + pw + 2 > this.w) { this.x = 2; this.y += this.rowH + 2; this.rowH = 0; }
    const x = this.x, y = this.y; this.x += pw + 2; this.rowH = Math.max(this.rowH, ph);
    if (y + ph > this.h) console.warn('[hero] decal atlas overflow');
    this.g.save(); this.g.beginPath(); this.g.rect(x, y, pw, ph); this.g.clip(); draw(this.g, x, y, pw, ph); this.g.restore();
    return { u0: x / this.w, u1: (x + pw) / this.w, v0: 1 - (y + ph) / this.h, v1: 1 - y / this.h };
  }
  // convenience: text label, fitted to the rect. o: {color, bg, font, weight, align, border, lines}
  text(pw, ph, lines, o = {}) {
    return this.label(pw, ph, (g, x, y, w, h) => {
      if (o.bg) { g.fillStyle = o.bg; g.fillRect(x, y, w, h); }
      const L = Array.isArray(lines) ? lines : [lines], lh = h / L.length;
      g.fillStyle = o.color || 'rgba(232,228,206,0.92)'; g.textBaseline = 'middle'; g.textAlign = o.align || 'center';
      L.forEach((t, i) => {
        let fs = Math.round(lh * (o.size ?? 0.78)); g.font = `${o.weight || 'bold'} ${fs}px ${o.font || 'Arial Narrow, Arial, sans-serif'}`;
        if (o.spacing && 'letterSpacing' in g) g.letterSpacing = o.spacing;
        const tw = g.measureText(t).width, maxW = w * 0.94; if (tw > maxW) { fs = Math.floor(fs * maxW / tw); g.font = `${o.weight || 'bold'} ${fs}px ${o.font || 'Arial Narrow, Arial, sans-serif'}`; }
        g.fillText(t, o.align === 'left' ? x + 6 : o.align === 'right' ? x + w - 6 : x + w / 2, y + lh * (i + 0.5) + fs * 0.04);
      });
      if (o.border) { g.strokeStyle = o.border; g.lineWidth = o.bw || 3; g.strokeRect(x + 2, y + 2, w - 4, h - 4); }
      if (o.wear !== false) { const r = mulberry32(x * 7 + y * 13 + 5); g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < w * h / 380; i++) { g.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.55})`; g.fillRect(x + r() * w, y + r() * h, 1 + r() * 2.2, 1 + r() * 1.6); } g.globalCompositeOperation = 'source-over'; }
    });
  }
  _push(g) { this.geos.push(g); return this; }
  // flat quad. axis: 'x-' faces -X (left flank; text reads front->rear), 'x+' faces +X, 'y+' faces up (text reads left->right), 'z+' faces the player
  plane(rect, wM, hM, pos, face = 'x-') {
    const g = new THREE.PlaneGeometry(wM, hM), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, rect.u0 + uv.getX(i) * (rect.u1 - rect.u0), rect.v0 + uv.getY(i) * (rect.v1 - rect.v0));
    if (face === 'x-') g.rotateY(-Math.PI / 2); else if (face === 'x+') g.rotateY(Math.PI / 2); else if (face === 'y+') g.rotateX(-Math.PI / 2); else if (face === 'y-') g.rotateX(Math.PI / 2);
    g.translate(pos[0], pos[1], pos[2]); return this._push(g);
  }
  // curved patch on a cylinder along Z (axis at (cx, cy)); centred at angle phi0 (0 = left flank (-X), +pi/2 = top), spanning arc radians and len metres around z0
  wrap(rect, R, arc, len, z0, phi0 = 0, cx = 0, cy = 0, segs = 10) {
    const pos = [], nor = [], uvs = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, phi = phi0 - arc / 2 + arc * t, c = Math.cos(phi), s = Math.sin(phi);
      for (let j = 0; j <= 1; j++) { // j=0 front(-Z), j=1 rear(+Z): u (text direction) grows toward the rear on the left flank
        pos.push(cx - R * c, cy + R * s, z0 + (j ? len / 2 : -len / 2)); nor.push(-c, s, 0);
        uvs.push(rect.u0 + (rect.u1 - rect.u0) * j, rect.v0 + (rect.v1 - rect.v0) * t);
      }
    }
    for (let i = 0; i < segs; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx);
    return this._push(g.toNonIndexed());
  }
  build(name = 'decals', o = {}) {
    const H = getHero(this.game), t = mkTex(this.canvas, { srgb: true, repeat: false }); this.tex = t;
    const g = mergeGeometries(this.geos.map((x) => { const y = x.index ? x.toNonIndexed() : x; for (const k of Object.keys(y.attributes)) if (!['position', 'normal', 'uv'].includes(k)) y.deleteAttribute(k); return y; }), false);
    const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.62, metalness: 0.0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, envMap: H.env, envMapIntensity: 0.45, ...o });
    const mesh = new THREE.Mesh(g, m); mesh.name = name; mesh.frustumCulled = false; mesh.renderOrder = 2; return mesh;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Small texture helpers (glow / spark / smoke / streak / beam), cached
// ---------------------------------------------------------------------------------------------------------------------------------
const TEX = {}; const once = (k, f) => TEX[k] || (TEX[k] = f());
export function glowTexture() {
  return once('glow', () => { const [c, g] = mk(128, 128); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return mkTex(c, { repeat: false }); });
}
export function sparkTexture() {
  return once('spark', () => { const [c, g] = mk(64, 64); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(31, 4, 2, 56); g.fillRect(4, 31, 56, 2); return mkTex(c, { repeat: false }); });
}
export function smokeTexture() {
  return once('smoke', () => {
    const [c, g] = mk(128, 128), r = mulberry32(77);
    for (let i = 0; i < 34; i++) { const a = r() * 6.283, d = r() * 34, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, rad = 12 + r() * 26; const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
    const m = g.createRadialGradient(64, 64, 30, 64, 64, 64); m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = m; g.fillRect(0, 0, 128, 128); g.globalCompositeOperation = 'source-over';
    return mkTex(c, { repeat: false });
  });
}
export function streakTexture() { // bright at v=0 (head) fading to v=1 (tail), soft across
  return once('streak', () => { const [c, g] = mk(32, 128); const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 128); const gx = g.createLinearGradient(0, 0, 32, 0); gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = gx; g.fillRect(0, 0, 32, 128); g.globalCompositeOperation = 'source-over'; return mkTex(c, { repeat: false }); });
}
export function beamTexture() { // gaussian across u, constant along v (lightning ribbons)
  return once('beam', () => { const [c, g] = mk(32, 8); const gx = g.createLinearGradient(0, 0, 32, 0); gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gx.addColorStop(0.5, 'rgba(255,255,255,1)'); gx.addColorStop(0.65, 'rgba(255,255,255,0.55)'); gx.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gx; g.fillRect(0, 0, 32, 8); return mkTex(c, { repeat: false }); });
}
export function vignetteTexture() { // transparent centre, soft glow toward the screen edges/corners (superellipse falloff)
  return once('vignette', () => {
    const N = 128, [c, g] = mk(N, N), img = g.createImageData(N, N), d = img.data, r = mulberry32(31);
    const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const nx = (x + 0.5) / (N / 2) - 1, ny = (y + 0.5) / (N / 2) - 1, ang = Math.atan2(ny, nx);
      const n = Math.pow(Math.pow(Math.abs(nx), 3.0) + Math.pow(Math.abs(ny), 3.0), 1 / 3.0) + 0.02 * Math.sin(ang * 5 + ph[0]) + 0.012 * Math.sin(ang * 9 + ph[1]) + 0.008 * Math.sin(ang * 17 + ph[2]);
      let a = Math.min(1, Math.max(0, (n - 0.50) / 0.66)); a = a * a * (3 - 2 * a); a = Math.pow(a, 1.6);
      const i = (y * N + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255);
    }
    g.putImageData(img, 0, 0); return mkTex(c, { repeat: false });
  });
}
export const glowBasic = (r, g, b, extra = {}) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false, ...extra });
export const additiveMat = (map, r, g, b, extra = {}) => new THREE.MeshBasicMaterial({ map, color: new THREE.Color(r, g, b), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, ...extra });

// ---------------------------------------------------------------------------------------------------------------------------------
// Pooled smoke / steam / glow puffs living in the weapon's local space. ONE instanced draw call per batch (camera-facing quads expanded in view space by a
// tiny shader; per-instance offset / size / opacity / spin), so a busy volley of smoke + sparks costs 2 draw calls instead of ~24 sprites.
// ---------------------------------------------------------------------------------------------------------------------------------
const PUFF_VS = `attribute vec3 aOff; attribute vec3 aPar; varying vec2 vUv; varying float vOp;
void main() { vUv = uv; vOp = aPar.y; float c = cos(aPar.z), s = sin(aPar.z);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aPar.x;
  vec4 mv = modelViewMatrix * vec4(aOff, 1.0); mv.xy += p; gl_Position = projectionMatrix * mv; }`;
const PUFF_FS = `uniform sampler2D map; uniform vec3 color; varying vec2 vUv; varying float vOp;
void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(color * t.rgb, t.a * vOp); }`;
export class Puffs {
  constructor(parent, n, map, { additive: add = false, color = 0xffffff, drag = 1.5 } = {}) {
    this.n = n; this.drag = drag; this.next = 0; this.active = 0;
    const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
    this.off = new Float32Array(n * 3); this.par = new Float32Array(n * 3);
    this.aOff = new THREE.InstancedBufferAttribute(this.off, 3).setUsage(THREE.DynamicDrawUsage); this.aPar = new THREE.InstancedBufferAttribute(this.par, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aOff', this.aOff); g.setAttribute('aPar', this.aPar); g.instanceCount = n;
    this.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: map }, color: { value: new THREE.Color(color) } }, vertexShader: PUFF_VS, fragmentShader: PUFF_FS, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; this.mesh.visible = false; parent.add(this.mesh);
    this.list = []; for (let i = 0; i < n; i++) this.list.push({ on: false, age: 0, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 0.1, s1: 0.3, op: 0.5, vr: 0, rot: 0 });
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, op, vr = 0) {
    const p = this.list[this.next]; this.next = (this.next + 1) % this.n;
    if (!p.on) this.active++;
    p.on = true; p.age = 0; p.life = life; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.s0 = s0; p.s1 = s1; p.op = op; p.vr = vr; p.rot = Math.random() * 6.28;
    this.mesh.visible = true;
  }
  update(dt) {
    if (this.active <= 0) return;
    const k = Math.exp(-this.drag * dt), O = this.off, P = this.par; let act = 0;
    for (let i = 0; i < this.n; i++) {
      const p = this.list[i]; if (!p.on) continue;
      p.age += dt; const t = p.age / p.life;
      if (t >= 1) { p.on = false; P[i * 3 + 1] = 0; P[i * 3] = 0; continue; }
      act++;
      p.vx *= k; p.vy *= k; p.vz *= k; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.vr * dt;
      const sz = p.s0 + (p.s1 - p.s0) * (1 - (1 - t) * (1 - t));
      O[i * 3] = p.x; O[i * 3 + 1] = p.y; O[i * 3 + 2] = p.z; P[i * 3] = sz; P[i * 3 + 1] = p.op * Math.min(1, p.age / 0.04) * (1 - t) * (1 - t); P[i * 3 + 2] = p.rot;
    }
    this.active = act; this.aOff.needsUpdate = true; this.aPar.needsUpdate = true; if (act === 0) this.mesh.visible = false;
  }
  clear() { for (let i = 0; i < this.n; i++) { this.list[i].on = false; this.par[i * 3] = 0; this.par[i * 3 + 1] = 0; } this.active = 0; this.aPar.needsUpdate = true; this.mesh.visible = false; }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Little LCD readout (canvas texture, redrawn only when the key changes)
// ---------------------------------------------------------------------------------------------------------------------------------
export class LCD {
  constructor(w, h, draw) {
    this.w = w; this.h = h; this.canvas = document.createElement('canvas'); this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d'); this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }); this.draw = draw; this.last = null;
  }
  set(key, ...args) { if (key === this.last) return; this.last = key; this.draw(this.ctx, this.w, this.h, key, ...args); this.tex.needsUpdate = true; }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ribbon arcs: n jagged additive lightning arcs of `seg` segments each (two crossed ribbons per segment so they read from any angle)
// ---------------------------------------------------------------------------------------------------------------------------------
export class Arcs {
  constructor(parent, n, seg, mat) {
    this.n = n; this.seg = seg; const vps = 8, verts = n * seg * vps;
    this.pos = new Float32Array(verts * 3); const uv = new Float32Array(verts * 2), idx = [];
    for (let a = 0; a < n; a++) for (let s = 0; s < seg; s++) for (let q = 0; q < 2; q++) {
      const v = (a * seg + s) * vps + q * 4; uv.set([0, s / seg, 1, s / seg, 0, (s + 1) / seg, 1, (s + 1) / seg], v * 2);
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    this.geo = new THREE.BufferGeometry(); this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 7; parent.add(this.mesh);
    this.pts = new Float32Array(n * (seg + 1) * 3); this.on = new Uint8Array(n);
  }
  // set arc i from A to B with jitter amplitude `amp` and ribbon half-width `w`
  set(i, ax, ay, az, bx, by, bz, amp, w) {
    const seg = this.seg, P = this.pts, o = i * (seg + 1) * 3;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg, e = s === 0 || s === seg ? 0 : 1, j = amp * e * (Math.sin(t * 3.14159) * 0.8 + 0.2);
      P[o + s * 3] = ax + (bx - ax) * t + (Math.random() - 0.5) * 2 * j; P[o + s * 3 + 1] = ay + (by - ay) * t + (Math.random() - 0.5) * 2 * j; P[o + s * 3 + 2] = az + (bz - az) * t + (Math.random() - 0.5) * 2 * j;
    }
    const V = this.pos;
    for (let s = 0; s < seg; s++) {
      const a = o + s * 3, b = a + 3; let dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2]; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      // first perpendicular: d x (0,1,0) (or d x (1,0,0) when nearly vertical), second: d x p1
      let px = dz, py = 0, pz = -dx; let pl = Math.hypot(px, pz); if (pl < 0.05) { px = 0; py = dz; pz = -dy; pl = Math.hypot(py, pz) || 1; } px /= pl; py /= pl; pz /= pl;
      const qx = dy * pz - dz * py, qy = dz * px - dx * pz, qz = dx * py - dy * px;
      const v = (i * seg + s) * 8 * 3;
      const put = (k, x, y, z, sx, sy, sz, side) => { V[v + k * 3] = x + sx * side * w; V[v + k * 3 + 1] = y + sy * side * w; V[v + k * 3 + 2] = z + sz * side * w; };
      put(0, P[a], P[a + 1], P[a + 2], px, py, pz, -1); put(1, P[a], P[a + 1], P[a + 2], px, py, pz, 1); put(2, P[b], P[b + 1], P[b + 2], px, py, pz, -1); put(3, P[b], P[b + 1], P[b + 2], px, py, pz, 1);
      put(4, P[a], P[a + 1], P[a + 2], qx, qy, qz, -1); put(5, P[a], P[a + 1], P[a + 2], qx, qy, qz, 1); put(6, P[b], P[b + 1], P[b + 2], qx, qy, qz, -1); put(7, P[b], P[b + 1], P[b + 2], qx, qy, qz, 1);
    }
    this.on[i] = 1; this.dirty = true;
  }
  hide(i) { if (!this.on[i]) return; this.on[i] = 0; const v = i * this.seg * 8 * 3, V = this.pos; V.fill(0, v, v + this.seg * 8 * 3); this.dirty = true; }
  flush() { if (this.dirty) { this.geo.attributes.position.needsUpdate = true; this.dirty = false; } }
  hideAll() { for (let i = 0; i < this.n; i++) this.hide(i); this.flush(); }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Hands: a right (trigger) hand and a left (support) hand gripping vertical rods, baked into `parts`. The forearms stay live (pointArm).
// grip = centre of the vertical rod the palm wraps, in gun space. rake = grip tilt (rad, positive = top forward like a pistol).
// ---------------------------------------------------------------------------------------------------------------------------------
export const POSE_TRIGGER = { i: [0.55, 0.65, 0.5], m: [1.4, 1.5, 0.95], r: [1.44, 1.52, 0.95], p: [1.4, 1.55, 0.9], t: { yaw: 0.10, pitch: -0.95, roll: 0.15, c: [0.10, 0.25, 0.30] } };
export const POSE_GRIP = { i: [1.30, 1.45, 0.9], m: [1.42, 1.5, 0.95], r: [1.46, 1.55, 0.95], p: [1.44, 1.55, 0.9], t: { yaw: 0.10, pitch: -0.55, roll: 0.15, c: [0.10, 0.20, 0.20] } };
export function gripHand(kit, side, gun, parts, pos, rot, pose, opts = {}) {
  const h = new Hand(kit, { side, freeze: true, keep: opts.keep ?? (side === 'R' ? ['index'] : []), pose, sleeveLen: opts.sleeveLen ?? 0.6, knuckleStuds: false });
  h.place(pos, rot); gun.add(h.group); if (parts) h.bake(parts, gun);
  return h;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Shader pre-warm. main.js compiles every program of the world scene + the view scene in parallel (against the composer's render-target variant) and uploads
// every texture, walking INVISIBLE objects too. Projectile / effect prototypes are built lazily otherwise (first shot = ~7 programs compiled mid-fight), so
// park a spare instance of each in the scene (invisible, far below the floor): the boot-time warm-up then covers it. Clones share materials + geometry.
// ---------------------------------------------------------------------------------------------------------------------------------
export function park(game, obj) {
  if (!obj) return obj;
  obj.traverse((o) => { o.frustumCulled = false; });
  obj.position.set(0, -500, 0); obj.visible = false; game.scene.add(obj);
  return obj;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// View space helpers for projectiles
// ---------------------------------------------------------------------------------------------------------------------------------
const _cpD = new THREE.Vector3(), _aimT = new THREE.Vector3();
// True when the straight segment eye -> muzzle is free of world geometry AND enemies (a projectile spawned beyond a point-blank enemy would never hit it).
export function clearPath(game, a, b) {
  _cpD.copy(b).sub(a); const d = _cpD.length(); if (d < 1e-4) return true; _cpD.multiplyScalar(1 / d);
  return !game.combat.castRay(a, _cpD, d);
}
// Aim: direction from `from` to the point the crosshair is on (world or enemy), falling back to the aim ray.
export function aimDir(game, from, out, maxDist = 200) {
  const ray = game.player.getAimRay();
  const hit = game.combat.castRay(ray.origin, ray.dir, maxDist);
  if (hit) _aimT.copy(hit.point); else _aimT.copy(ray.origin).addScaledVector(ray.dir, maxDist);
  out.subVectors(_aimT, from);
  if (out.lengthSq() < 0.25 || out.dot(ray.dir) < 0) out.copy(ray.dir); else out.normalize();
  return out;
}
export { mulberry32 };
