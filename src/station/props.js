// Platform furniture: tiled columns with backlit adverts / notices, benches, bins, luggage and litter, spawn & pickup points.
import * as THREE from 'three';
import { grimeF, fbm3 } from './mb.js';
import { COLUMN_XS, COLUMN_Z } from './structure.js';
import { withColor } from './structure.js';

const W3 = [1, 1, 1];
const ADS = ['travel', 'volt', 'tempo', 'insure'];
const POSTERS = ['gap', 'missing', 'concert', 'perfume', 'health', 'watch', 'burger', 'evac'];

// framed panel on a vertical face. axis: face normal (nx,nz). (x,z) is the wall surface coordinate.
export function panel(c, kind, name, x, y, z, nx, nz, w, h, o = {}) {
  const d = o.depth ?? 0.055, f = o.frame ?? 0.03, key = o.frameKey || 'steel', col = o.frameCol || [0.26, 0.28, 0.3];
  if (nz) c.mb(key).box(x - w / 2 - f, y - h / 2 - f, nz > 0 ? z : z - d, x + w / 2 + f, y + h / 2 + f, nz > 0 ? z + d : z, { c: col, seg: 4 });
  else c.mb(key).box(nx > 0 ? x : x - d, y - h / 2 - f, z - w / 2 - f, nx > 0 ? x + d : x, y + h / 2 + f, z + w / 2 + f, { c: col, seg: 4 });
  const off = d + 0.003;
  c.quadAt(kind, name, x + nx * off, y, z + nz * off, nx, 0, nz, w, h, { tint: o.tint ?? 1, rot: o.rot || 0 });
  if (o.glass) c.mb('glass').box(nx ? (nx > 0 ? x + d : x - d - 0.001) : x - w / 2, y - h / 2, nz ? (nz > 0 ? z + d + 0.002 : z - d - 0.002) : z - w / 2, nx ? (nx > 0 ? x + d + 0.001 : x - d) : x + w / 2, y + h / 2, nz ? (nz > 0 ? z + d + 0.003 : z - d) : z + w / 2, { c: W3 });
}
export function pasted(c, name, x, y, z, nx, nz, w, h, rot = 0, tint = 0.9) { c.quadAt('paper', name, x + nx * 0.004, y, z + nz * 0.004, nx, 0, nz, w, h, { rot, tint }); }

export function buildProps(c) {
  columns(c); benches(c); bins(c); litter(c);
}

// ------------------------------------------------------------------------------------------------ columns
function columns(c) {
  let idx = 0;
  for (const s of [1, -1]) COLUMN_XS.forEach((cx, ci) => {
    const cz = s * COLUMN_Z, i = idx++;
    const g = grimeF({ floorY: 0, dirt: 0.5, seed: i * 1.7, low: 0.55, hi: 0.3 });
    const tk = (key, y0, y1, hw, col = W3, skip = '') => c.mb(key).box(cx - hw, y0, cz - hw, cx + hw, y1, cz + hw, { c: col, f: g, seg: 1.5, skip });
    tk('tileDark', 0, 0.2, 0.36, [0.8, 0.82, 0.85], 'ny');
    tk('tileGreen', 0.2, 1.2, 0.3, W3, 'ny');
    tk('brass', 1.2, 1.27, 0.305, [0.9, 0.82, 0.62]);
    tk('tileCream', 1.27, 2.6, 0.3);
    tk('tileGreen', 2.6, 2.72, 0.31, [1.1, 1.1, 1.1]);
    tk('concrete', 2.72, 5.72, 0.3, [0.8, 0.86, 0.92], 'py');
    // steel corner guards
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.mb('steel').box(cx + sx * 0.3 - (sx > 0 ? 0 : 0.03), 0.2, cz + sz * 0.3 - (sz > 0 ? 0 : 0.03), cx + sx * 0.3 + (sx > 0 ? 0.03 : 0), 1.3, cz + sz * 0.3 + (sz > 0 ? 0.03 : 0), { c: [0.75, 0.75, 0.78], seg: 2 });
    c.collider([cx - 0.36, -1, cz - 0.36], [cx + 0.36, 7, cz + 0.36], { tag: 'column', surface: 'tile' });

    const laneZ = cz - s * 0.3, pitZ = cz + s * 0.3, ln = -s, pn = s; // face coordinates + normals along z
    // ----- per-column loadout ------
    const mode = i % 4;
    if (mode === 0) { panel(c, 'glowA', 'ad_' + ADS[i % 4 === 0 ? (ci + (s > 0 ? 0 : 2)) % 4 : 0], cx, 1.85, laneZ, 0, ln, 0.5, 0.75); pasted(c, 'p_' + POSTERS[(i * 3) % 8], cx, 1.9, pitZ, 0, pn, 0.42, 0.63, (i % 3 - 1) * 0.04); }
    if (mode === 1) { pasted(c, 'map', cx, 2.2, laneZ, 0, ln, 0.52, 0.13, 0, 0.95); pasted(c, 'p_' + POSTERS[(i * 5 + 1) % 8], cx, 1.9, pitZ, 0, pn, 0.42, 0.63, (i % 3 - 1) * 0.05);
      // fire extinguisher on the lane face
      extinguisher(c, cx, cz - s * 0.3, ln); }
    if (mode === 2) { panel(c, 'glowA', 'ad_' + ADS[(ci + 1) % 4], cx, 1.85, laneZ, 0, ln, 0.5, 0.75); panel(c, 'glowA', 'ad_' + ADS[(ci + 3) % 4], cx, 1.85, pitZ, 0, pn, 0.5, 0.75, { tint: 0.85 }); }
    if (mode === 3) { pasted(c, 'p_' + POSTERS[(i * 2 + 3) % 8], cx, 1.85, laneZ, 0, ln, 0.42, 0.63, 0.03); pasted(c, 'n_' + ['suspended', 'cctv', 'nosmoke', 'danger', 'note'][i % 5], cx, 1.5, laneZ, 0, ln, 0.22, 0.28, -0.05); panel(c, 'glowA', 'ad_' + ADS[(ci + 2) % 4], cx, 1.85, pitZ, 0, pn, 0.5, 0.75, { tint: 0.9 }); }
    // notices on the ±x faces (seen when walking down the platform)
    for (const sx of [-1, 1]) {
      const r = (i * 7 + (sx > 0 ? 3 : 0)) % 9;
      if (r < 3) pasted(c, 'n_' + ['plan', 'nosmoke', 'cctv'][r], cx + sx * 0.3, 1.7, cz, sx, 0, 0.3, 0.37, 0.02 * (r - 1));
      else if (r < 5) pasted(c, 'p_' + POSTERS[(i + r) % 8], cx + sx * 0.3, 1.9, cz, sx, 0, 0.42, 0.63, 0);
      else if (r === 5) panel(c, 'glowA', 'fire', cx + sx * 0.3, 1.5, cz, sx, 0, 0.2, 0.2, { depth: 0.03, frame: 0.01 });
    }
    // PA horn speaker + conduit + junction box + CCTV bracket location
    const hx = cx + (i % 2 ? 0.3 : -0.3), hn = i % 2 ? 1 : -1;
    c.mb('steel').cyl(hx, 4.4, cz, hx + hn * 0.28, 4.4, cz, 0.05, { segs: 8, r1: 0.14, c: [0.55, 0.57, 0.6] });
    c.mb('steel').box(hx - (hn > 0 ? 0 : 0.06), 4.34, cz - 0.06, hx + (hn > 0 ? 0.06 : 0), 4.46, cz + 0.06, { c: [0.3, 0.3, 0.33] });
    const px = cx + (i % 2 ? -0.22 : 0.22);
    c.mb('steel').cyl(px, 0.25, pitZ + pn * 0.03, px, 5.72, pitZ + pn * 0.03, 0.02, { segs: 6, c: [0.45, 0.47, 0.5] });
    for (const y of [0.8, 1.9, 3.0, 4.2, 5.3]) c.mb('steel').box(px - 0.035, y, pitZ, px + 0.035, y + 0.04, pitZ + pn * 0.06, { c: [0.3, 0.3, 0.33] });
    c.mb('steel').box(px - 0.09, 1.0, pitZ, px + 0.09, 1.16, pitZ + pn * 0.06, { c: [0.35, 0.4, 0.42] });
    // grime / stains
    if (i % 3 === 0) c.quadAt('decal', 'streak' + (i % 3), cx, 3.9, laneZ + ln * 0.004, 0, 0, ln, 0.5, 2.4, { tint: 0.85 });
    if (i % 4 === 1) c.quadAt('decal', 'rust' + (i % 2), cx + 0.15, 4.6, pitZ + pn * 0.004, 0, 0, pn, 0.35, 2.0, { tint: 0.8 });
    c.quadAt('decal', 'grime', cx, 0.3, laneZ + ln * 0.004, 0, 0, ln, 0.6, 0.6, { tint: 0.9 });
    c.quadAt('decal', 'grime', cx, 0.3, pitZ + pn * 0.004, 0, 0, pn, 0.6, 0.6, { tint: 0.9 });
  });
}

function extinguisher(c, x, zFace, nz) {
  const z = zFace + nz * 0.1;
  c.mb('yellow').cyl(x, 0.95, z, x, 1.45, z, 0.07, { segs: 10, c: [0.85, 0.05, 0.04] });
  c.mb('chrome').cyl(x, 1.45, z, x, 1.53, z, 0.03, { segs: 6, c: W3 });
  c.mb('chrome').box(x - 0.02, 1.52, z - 0.02, x + 0.05, 1.56, z + 0.02, { c: W3 });
  c.mb('cable').cyl(x + 0.04, 1.45, z, x + 0.09, 1.1, z + nz * 0.05, 0.01, { segs: 4, c: [0.05, 0.05, 0.05] });
  c.mb('steel').box(x - 0.09, 1.3, zFace, x + 0.09, 1.36, zFace + nz * 0.1, { c: [0.25, 0.25, 0.28] });
  c.mb('steel').box(x - 0.09, 0.98, zFace, x + 0.09, 1.04, zFace + nz * 0.1, { c: [0.25, 0.25, 0.28] });
  c.quadAt('glowA', 'fire', x, 1.8, zFace + nz * 0.004, 0, 0, nz, 0.22, 0.22, { tint: 0.85 });
}

// ------------------------------------------------------------------------------------------------ benches
function benches(c) {
  const spots = [[-24, 1], [-16, -1], [-8, 1], [0, -1], [8, 1], [16, -1], [24, 1], [-24, -1], [16, 1]];
  spots.forEach(([x, s], i) => {
    const z = s * COLUMN_Z, back = z - s * 0.22, front = z + s * 0.22;
    const slat = (y0, y1, za, zb, xs = 1.75) => c.mb('paint').box(x - xs / 2, y0, Math.min(za, zb), x + xs / 2, y1, Math.max(za, zb), { c: [0.8, 0.85, 0.85], f: (px, py, pz) => 0.7 + 0.4 * fbm3(px * 3, py * 4, pz * 3 + i), seg: 1 });
    for (let k = 0; k < 3; k++) slat(0.44, 0.47, z - s * 0.22 + s * k * 0.15, z - s * 0.22 + s * (k * 0.15 + 0.12));
    for (let k = 0; k < 3; k++) c.mb('paint').box(x - 0.875, 0.62 + k * 0.1, back - 0.02 * s - 0.015, x + 0.875, 0.7 + k * 0.1, back - 0.02 * s + 0.015, { c: [0.8, 0.85, 0.85], seg: 1 });
    for (const lx of [-0.8, 0, 0.8]) { // frames
      c.mb('steel').box(x + lx - 0.02, 0, back - 0.04, x + lx + 0.02, 0.44, back, { c: [0.3, 0.32, 0.35] });
      c.mb('steel').box(x + lx - 0.02, 0, front, x + lx + 0.02, 0.44, front + 0.04 * s, { c: [0.3, 0.32, 0.35] });
      c.mb('steel').box(x + lx - 0.02, 0.44, Math.min(back, front + 0.04 * s), x + lx + 0.02, 0.5, Math.max(back, front + 0.04 * s), { c: [0.3, 0.32, 0.35] });
      c.mb('steel').box(x + lx - 0.02, 0.47, back - 0.05, x + lx + 0.02, 0.9, back - 0.03, { c: [0.3, 0.32, 0.35] });
    }
    c.mb('steel').box(x - 0.91, 0.5, back - 0.06, x - 0.87, 0.68, front, { c: [0.3, 0.32, 0.35] }); c.mb('steel').box(x + 0.87, 0.5, back - 0.06, x + 0.91, 0.68, front, { c: [0.3, 0.32, 0.35] });
    // the two benches beside the fare gates leave a 0.35 m slot to the gate line: too narrow to use, wide enough to wedge a body in -> the collider closes it
    const nearGates = Math.abs(x + 24) < 0.5, zlo = s > 0 ? (nearGates ? 1.9 : z - 0.3) : z - 0.3, zhi = s < 0 ? (nearGates ? -1.9 : z + 0.3) : z + 0.3;
    c.collider([x - 0.92, 0, zlo], [x + 0.92, 0.92, zhi], { tag: 'bench', surface: 'metal', walkable: true });
    if (i % 3 === 0) c.quadAt('decal', 'blot' + (i % 3), x, 0.006, z + s * 0.6, 0, 1, 0, 1.6, 1.6, { tint: 0.7 });
  });
}

// ------------------------------------------------------------------------------------------------ bins
function bins(c) {
  const spots = [[-16, 2.0], [-8, -2.0], [-2, 2.05], [16, 2.0], [24, -2.0], [-24, -2.0], [8, -2.05], [28, 2.0]];
  spots.forEach(([x, z], i) => {
    const R = 0.21;
    c.mb('paint').cyl(x, 0, z, x, 0.86, z, R, { segs: 14, c: [0.55, 0.6, 0.6], f: (px, py) => 0.7 + 0.5 * fbm3(px * 6, py * 3, i) });
    c.mb('steel').cyl(x, 0.82, z, x, 0.87, z, R + 0.015, { segs: 14, c: [0.45, 0.45, 0.48] });
    c.mb('dark').cyl(x, 0.855, z, x, 0.858, z, R - 0.02, { segs: 14, cap: true, c: [0.02, 0.02, 0.02] });
    c.mb('steel').box(x - 0.25, 0.25, z - 0.005, x + 0.25, 0.3, z + 0.005, { c: [0.3, 0.3, 0.32] }); // band
    if (i % 2 === 0) for (let k = 0; k < 4; k++) c.mb('plastic').box(x - 0.09 + k * 0.05, 0.86, z - 0.08 + (k % 2) * 0.06, x + 0.02 + k * 0.05, 0.98 + (k % 3) * 0.02, z + 0.02 + (k % 2) * 0.06, { c: [[0.7, 0.68, 0.6], [0.2, 0.3, 0.6], [0.6, 0.15, 0.1], [0.75, 0.75, 0.7]][k] });
    c.collider([x - 0.24, 0, z - 0.24], [x + 0.24, 0.95, z + 0.24], { tag: 'bin', surface: 'metal', walkable: true });
  });
}

// ------------------------------------------------------------------------------------------------ litter, luggage, floor dressing
function litter(c) {
  const rr = c.rr, rnd = c.rnd;
  // instanced cans + cups
  const canG = withColor(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 8), W3), cupG = withColor(new THREE.CylinderGeometry(0.04, 0.028, 0.11, 8), W3);
  const canM = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.8, vertexColors: true, envMapIntensity: 1.2 }), cupM = new THREE.MeshStandardMaterial({ roughness: 0.7, vertexColors: true });
  const N1 = 26, N2 = 18, cans = new THREE.InstancedMesh(canG, canM, N1), cups = new THREE.InstancedMesh(cupG, cupM, N2), m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
  const spot = () => { let x, z; do { x = rr(-30, 30); z = rr(-4.6, 4.6); } while (Math.abs(Math.abs(z) - COLUMN_Z) < 0.5 && COLUMN_XS.some((cx) => Math.abs(cx - x) < 0.5)); return [x, z]; };
  const cc = [0xd0302a, 0x2a70c8, 0xc9c9c9, 0x2aa04a, 0xe0a020, 0x222222];
  for (let i = 0; i < N1; i++) { const [x, z] = spot(); q.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr(0, 6.28))); p.set(x, 0.035, z); m.compose(p, q, sc); cans.setMatrixAt(i, m); cans.setColorAt(i, col.set(cc[i % cc.length])); }
  const cu = [0xe8e2d2, 0xc9382c, 0xefe9dc, 0x3d6f9c];
  for (let i = 0; i < N2; i++) { const [x, z] = spot(); q.setFromEuler(new THREE.Euler(Math.PI / 2 + rr(-0.3, 0.3), rr(0, 6.28), 0, 'YXZ')); p.set(x, 0.04, z); m.compose(p, q, sc); cups.setMatrixAt(i, m); cups.setColorAt(i, col.set(cu[i % cu.length])); }
  cans.frustumCulled = false; cups.frustumCulled = false; c.add(cans); c.add(cups);

  // luggage
  const suit = (x, z, rot, col, standing = false) => {
    const box = (k, x0, y0, z0, x1, y1, z1, cc2) => c.mb(k).box(x0, y0, z0, x1, y1, z1, { c: cc2, seg: 2 });
    // axis-aligned boxes only: rot 0 / PI/2
    const along = Math.abs(Math.sin(rot)) > 0.7; const hx = along ? 0.14 : 0.32, hz = along ? 0.32 : 0.14, hy = standing ? 0.37 : 0.14;
    const y0 = 0.0; box('plastic', x - hx, y0, z - hz, x + hx, y0 + hy * 2, z + hz, col);
    box('steel', x - hx - 0.005, y0 + hy * 2 * 0.5 - 0.01, z - hz - 0.005, x + hx + 0.005, y0 + hy * 2 * 0.5 + 0.01, z + hz + 0.005, [0.5, 0.5, 0.52]);
    box('steel', x - (along ? 0.03 : 0.1), y0 + hy * 2, z - (along ? 0.1 : 0.03), x + (along ? 0.03 : 0.1), y0 + hy * 2 + 0.04, z + (along ? 0.1 : 0.03), [0.3, 0.3, 0.32]);
    if (standing) c.collider([x - hx, 0, z - hz], [x + hx, hy * 2, z + hz], { tag: 'prop', surface: 'metal', walkable: true });
  };
  suit(-24.3, 3.6, 0, [0.45, 0.06, 0.06]); suit(-23.7, 3.75, 0, [0.12, 0.3, 0.32]); suit(-9.6, -3.5, Math.PI / 2, [0.18, 0.18, 0.22], true); suit(17.5, 3.4, 0, [0.5, 0.35, 0.12]); suit(-6.8, -3.8, 0, [0.25, 0.08, 0.3]);
  // backpack + duffel
  c.mb('plastic').box(14.2, 0, -3.6, 14.55, 0.42, -3.28, { c: [0.15, 0.32, 0.18], seg: 2 }); c.mb('plastic').box(14.25, 0.05, -3.28, 14.5, 0.25, -3.22, { c: [0.1, 0.22, 0.12] });
  c.mb('plastic').box(2.0, 0, 3.6, 2.7, 0.3, 3.9, { c: [0.35, 0.3, 0.15], seg: 2 });
  // trash bags
  for (const [x, z, r] of [[-15.6, 2.4, 0.3], [-15.35, 2.0, -0.4], [8.3, -2.35, 0.2], [24.6, -2.3, 0.6], [-1.6, 2.3, 0.1]]) { const s = 0.18; c.mb('plastic').box(x - s, 0, z - s, x + s * 1.1, 0.3, z + s, { c: [0.03, 0.03, 0.035], seg: 2 }); c.mb('plastic').box(x - 0.05, 0.3, z - 0.05, x + 0.07, 0.36, z + 0.05, { c: [0.03, 0.03, 0.035] }); }
  // wet-floor A-frame sign (two leaning yellow panels with a warning sticker each side)
  const wf = (x, z, yaw) => {
    const th = 0.2, mm = new THREE.Matrix4(), q = new THREE.Quaternion(), yq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    for (const k of [-1, 1]) {
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -k * th).premultiply(yq);
      const off = new THREE.Vector3(0, 0.3, k * 0.1).applyQuaternion(yq);
      mm.compose(new THREE.Vector3(x + off.x, off.y, z + off.z), q, new THREE.Vector3(1, 1, 1)); c.mb('yellow').addGeometry(new THREE.BoxGeometry(0.34, 0.6, 0.016), mm, [1, 0.95, 0.8]);
      const n = new THREE.Vector3(0, Math.sin(th), k * Math.cos(th)).applyQuaternion(yq);
      const cpos = new THREE.Vector3(0, 0.3, k * 0.1).applyQuaternion(yq).add(n.clone().multiplyScalar(0.011)); c.quadAt('paper', 'n_danger', x + cpos.x, cpos.y, z + cpos.z, n.x, n.y, n.z, 0.2, 0.25, { tint: 0.95 });
    }
    c.collider([x - 0.18, 0, z - 0.2], [x + 0.18, 0.62, z + 0.2], { tag: 'prop', surface: 'metal', walkable: true });
  };
  wf(-3.1, -1.2, 0.3); wf(12.0, 2.0, -0.4);

  // ---- floor decals ----
  const floor = (kind, name, x, z, w, h, rot = 0, tint = 1) => c.quadAt(kind, name, x, 0.004, z, 0, 1, 0, w, h, { rot, tint });
  for (let i = 0; i < 26; i++) { const [x, z] = spot(); floor('decal', ['blot0', 'blot1', 'blot2', 'oil'][i % 4], x, z, rr(0.9, 2.2), rr(0.9, 2.2), rr(0, 6.28), rr(0.25, 0.55)); }
  for (let i = 0; i < 9; i++) { const [x, z] = spot(); floor('decal', 'crack' + (i % 2), x, z, rr(1.2, 2.6), rr(1.2, 2.6), rr(0, 6.28), 0.85); }
  for (let i = 0; i < 8; i++) { const [x, z] = spot(); floor('decal', 'foot', x, z, 3.2, 0.4, rr(-0.5, 0.5) + (i % 2 ? Math.PI : 0), 0.9); }
  for (let i = 0; i < 12; i++) { const [x, z] = spot(); floor('decal2', ['news0', 'news1', 'crumple'][i % 3], x, z, 0.45, 0.45, rr(0, 6.28), rr(0.8, 1)); }
  for (const x of [-22, -5, 13, 27]) for (const s of [1, -1]) c.quadAt('decal', 'gap', x, 0.015, s * 4.15, 0, 1, 0, 3.4, 0.43, { rot: s > 0 ? 0 : Math.PI, tint: 0.85 });
  // blood: pools, drags, hand-prints
  const bl = (name, x, z, w, h, rot = 0) => c.quadAt('blood', name, x, 0.006, z, 0, 1, 0, w, h, { rot });
  bl('splat0', 8.5, -1.6, 2.2, 2.2, 0.5); bl('drag0', 5.2, -0.6, 3.6, 0.9, 0.18); bl('splat1', 10.8, 1.4, 1.7, 1.7, 2.0); bl('splat2', -19.5, 3.2, 2.6, 2.6, 1.0); bl('drag1', -22.5, 2.2, 3.6, 0.9, 2.9); bl('splat1', 26.0, -3.3, 1.9, 1.9, 0.3); bl('splat0', -6.0, -3.0, 1.4, 1.4, 4.0);
  // puddles (glossy) with ripples handled by fx
  const pu = (x, z, w, h, r) => c.mb('puddle').oq(x, 0.008, z, 0, 1, 0, w, h, [0, 0, 1, 1], { rot: r, c: [1, 1, 1] });
  const puddles = [[-20, -1.3, 3.2, 1.9, 0.3], [-9, 2.9, 2.6, 1.4, 1.2], [-2, -0.8, 3.6, 2.0, 0.4], [4.5, 3.2, 2.2, 1.6, 2.2], [9.5, -1.6, 3.0, 2.0, 0.9], [15, 0.9, 3.4, 1.8, 0.1], [22, -3.0, 2.6, 1.5, 1.6], [26.5, 1.3, 2.8, 1.7, 0.7], [-27, -0.5, 2.4, 1.8, 2.5], [1.5, 2.2, 1.6, 1.2, 0.6], [-13.5, -3.2, 2.2, 1.4, 0.5], [18.5, 3.6, 1.6, 1.1, 1.9]];
  puddles.forEach((p2) => pu(...p2)); c.puddles = puddles;
}

// ------------------------------------------------------------------------------------------------ spawn / pickup points
export function buildPoints(c) {
  const T = c.THREE, world = c.world;
  const free = (x, z, r = 0.55) => { for (const b of world.boxes) { if (!b.solid || !b.enabled) continue; if (b.max.y <= 0.45 || b.min.y >= 1.7) continue; const cx = Math.max(b.min.x, Math.min(x, b.max.x)), cz = Math.max(b.min.z, Math.min(z, b.max.z)); if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return false; } return Math.abs(z) < 4.3 && Math.abs(x) < 31.2; };
  c.free = free;
  const push = (arr, x, z) => { if (!free(x, z)) { for (const [dx, dz] of [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [1.2, 0.6], [-1.2, -0.6]]) if (free(x + dx, z + dz)) { x += dx; z += dz; break; } } arr.push(new T.Vector3(x, 0, z)); };
  for (const [x, z] of [[-4, -3.4], [2, 3.3], [7, -1.2], [11.5, 3.4], [15, -3.3], [19, 1.0], [23, -3.3], [26, 2.4], [29.5, -1.0], [5, 0.6], [-2, 1.4], [13.5, -0.4]]) push(c.spawnPoints, x, z);
  for (const [x, z] of [[-21, -1.6], [-18, 3.6], [-10, -3.5], [-6, 0], [0, 3.5], [4, -0.3], [9, 3.6], [14, -3.6], [18, 0.4], [22, 3.6], [26, -3.6], [-27, -3.6], [-27, 3.7], [30, 0.6], [-13, 0.3]]) push(c.pickupPoints, x, z);
}
