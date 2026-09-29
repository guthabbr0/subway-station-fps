// Static structure of the station: platform slab & edge furniture, tiled walls with tunnel portals, vaulted ceiling with beams,
// ducts and pipes, ballast/sleepers/rails and the long tunnels. Everything is merged per material via ctx builders.
import * as THREE from 'three';
import { LAYOUT } from '../core.js';
import { MB, fbm3, grimeF } from './mb.js';
import { smooth } from './ctx.js';

export const X0 = -32, X1 = 32, PH = 5, WZ = 11.5, CY = 7, BED = LAYOUT.bedY, RT = LAYOUT.railTopY, TUN = LAYOUT.tunnelEndX;
export const TZ = LAYOUT.trackZ, ARCH = { r: 2.6, yc: 2.0 };
export const archHW = (y) => { const dy = y - ARCH.yc; return dy <= 0 ? ARCH.r : dy >= ARCH.r ? 0 : Math.sqrt(ARCH.r * ARCH.r - dy * dy); };
export const COLUMN_XS = [-28, -20, -12, -4, 4, 12, 20, 28];
export const COLUMN_Z = 2.6;

const white = [1, 1, 1];

export function withColor(geo, col = [1, 1, 1]) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = col[0]; a[i * 3 + 1] = col[1]; a[i * 3 + 2] = col[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo;
}

// wall bands: [y0, y1, material, tint]
const BANDS = [
  [BED, 0, 'concrete', [0.55, 0.6, 0.64]],
  [0, 1.2, 'tileGreen', white],
  [1.2, 1.27, 'brass', [0.9, 0.85, 0.7]],
  [1.27, 2.6, 'tileCream', white],
  [2.6, 2.72, 'tileGreen', [1.1, 1.1, 1.1]],
  [2.72, CY, 'concrete', [0.78, 0.84, 0.9]],
];

export function buildStructure(c) {
  floor(c); platformEdge(c); endWalls(c); outerWalls(c); ceiling(c); tracks(c); tunnels(c); colliders(c);
}

// ------------------------------------------------------------------------------------------------ floor
function floor(c) {
  const ff = (x, y, z) => {
    const n = fbm3(x * 0.23 + 3, 0, z * 0.23), m = fbm3(x * 0.9 + 9, 0, z * 0.9);
    let k = 0.7 + 0.62 * n + 0.1 * m;
    k *= 1 - 0.2 * smooth(3.4, 5.0, Math.abs(z));
    k *= 1 - 0.3 * smooth(28.5, 32, Math.abs(x));
    // darker soot under the column rows and worn-lighter walking lane
    k *= 1 - 0.1 * Math.exp(-Math.pow((Math.abs(z) - COLUMN_Z) / 0.7, 2));
    return k;
  };
  c.mb('floor').grid(X0, 0, -PH, X1 - X0, 0, 0, 0, 0, 2 * PH, 128, 20, 0, 1, 0, { c: [0.95, 0.98, 1.0], f: ff });
}

function platformEdge(c) {
  for (const s of [1, -1]) {
    // tactile ribbon + hazard lip
    c.mb('tactile').grid(X0, 0.012, s * 4.3, X1 - X0, 0, 0, 0, 0, s * 0.58, 64, 1, 0, 1, 0, { c: [1, 1, 1], f: (x) => 0.75 + 0.4 * fbm3(x * 0.5, 1, s) });
    c.mb('hazard').grid(X0, 0.013, s * 4.88, X1 - X0, 0, 0, 0, 0, s * 0.12, 64, 1, 0, 1, 0, { c: [1, 1, 1], f: (x) => 0.65 + 0.4 * fbm3(x * 0.6, 3, s), uv: (x, y, z) => [x / 0.5 + z * 0.0, z / 0.5] });
    // coping front + recess under the lip (deep shadow)
    c.mb('concrete').grid(X0, -0.3, s * 5.0, X1 - X0, 0, 0, 0, 0.312, 0, 64, 1, 0, 0, s, { c: [0.95, 0.95, 0.92], f: (x, y) => 0.7 + 0.35 * fbm3(x * 0.4, y, s) });
    c.mb('concrete').grid(X0, -0.3, s * 4.7, X1 - X0, 0, 0, 0, 0, s * 0.3, 32, 1, 0, -1, 0, { c: [0.2, 0.2, 0.22] });
    c.mb('concrete').grid(X0, BED, s * 4.7, X1 - X0, 0, 0, 0, 0.95, 0, 32, 4, 0, 0, s, { c: [0.6, 0.64, 0.7], f: (x, y, z) => { const g = 0.12 + 0.6 * smooth(-1.25, -0.4, y); return g * (0.7 + 0.5 * fbm3(x * 0.3, y, 4)); } });
    // under-platform cable runs and drainage (mounted on the recessed wall face)
    const zz = (p, q) => (s > 0 ? [p, q] : [-q, -p]);
    { const [za, zb] = zz(4.7, 4.84); c.mb('steel').box(X0, -0.75, za, X1, -0.7, zb, { seg: 200, c: [0.5, 0.5, 0.52] }); }
    for (let i = 0; i < 4; i++) { const z = s * (4.745 + i * 0.022); c.mb('cable').cyl(X0, -0.688, z, X1, -0.688, z, 0.011, { segs: 5, c: [[0.1, 0.1, 0.12], [0.5, 0.05, 0.05], [0.05, 0.1, 0.4], [0.3, 0.3, 0.3]][i] }); }
    { const [za, zb] = zz(4.7, 4.85); for (let x = X0 + 1; x < X1; x += 2) c.mb('steel').box(x - 0.03, -0.9, za, x + 0.03, -0.68, zb, { c: [0.35, 0.35, 0.38] }); }
  }
}

// ------------------------------------------------------------------------------------------------ walls
function bandSlices(y0, y1) {
  const cuts = [y0]; const a = Math.max(y0, ARCH.yc), b = Math.min(y1, ARCH.yc + ARCH.r);
  if (b > a) { if (a > y0) cuts.push(a); for (let y = a + 0.2; y < b - 1e-6; y += 0.2) cuts.push(y); if (b < y1) cuts.push(b); }
  cuts.push(y1); const out = []; for (let i = 0; i < cuts.length - 1; i++) if (cuts[i + 1] - cuts[i] > 1e-5) out.push([cuts[i], cuts[i + 1]]);
  return out;
}
const edgeDist = (z, y, zc) => { const dz = z - zc; if (y <= ARCH.yc) return Math.abs(Math.abs(dz) - ARCH.r); return Math.abs(Math.hypot(dz, y - ARCH.yc) - ARCH.r); };

function endWalls(c) {
  for (const side of [1, -1]) {
    const xF = side * 32, nx = -side;
    for (const [y0, y1, key, tint] of BANDS) {
      const grime = grimeF({ floorY: y0 < 0 ? BED : 0, dirt: 0.32, seed: side * 3 + 1, low: key === 'concrete' && y0 < 0 ? 0.2 : 0.45, hi: 0.4 });
      const f = (x, y, z) => {
        let k = grime(x, y, z);
        const d = Math.min(edgeDist(z, y, TZ.A), edgeDist(z, y, TZ.B)); k *= 0.55 + 0.45 * smooth(0, 0.9, d);
        return k * (0.85 + 0.15 * smooth(0, 3, Math.abs(z)));
      };
      for (const [ya, yb] of bandSlices(y0, y1)) {
        const ha = archHW(ya), hbb = archHW(yb);
        const zB = TZ.B, zA = TZ.A; // hole centres: B at -6.6, A at +6.6
        const ints = [
          [-WZ, zB - ha, -WZ, zB - hbb],
          [zB + ha, zA - ha, zB + hbb, zA - hbb],
          [zA + ha, WZ, zA + hbb, WZ],
        ];
        for (const [la, ra, lb, rb] of ints) {
          if (ra - la < 1e-4 && rb - lb < 1e-4) continue;
          const wmax = Math.max(ra - la, rb - lb);
          c.mb(key).patch([xF, ya, la], [xF, ya, ra], [xF, yb, lb], [xF, yb, rb], Math.max(1, Math.ceil(wmax / 0.9)), 1, nx, 0, 0, { c: tint, f });
        }
      }
    }
    // wall thickness reveal is the tunnel sweep itself; close the wall top above ceiling? (not visible)
  }
}

function outerWalls(c) {
  for (const s of [1, -1]) {
    const zF = s * WZ;
    for (const [y0, y1, key, tint] of BANDS) {
      const grime = grimeF({ floorY: y0 < 0 ? BED : 0, dirt: 0.4, seed: s * 7 + 2, low: y0 < 0 ? 0.25 : 0.5 });
      const nu = Math.ceil(64 / 1.2), nv = Math.max(1, Math.ceil((y1 - y0) / 1.2));
      c.mb(key).grid(X0, y0, zF, X1 - X0, 0, 0, 0, y1 - y0, 0, nu, nv, 0, 0, -s, { c: tint, f: (x, y, z) => grime(x, y, z) * (0.85 + 0.3 * fbm3(x * 0.15, y * 0.1, s)) });
    }
    // pit-wall cable trays with bundles
    for (const [y, n] of [[-0.6, 5], [-0.05, 4]]) {
      c.mb('steel').box(X0, y, s * (WZ - 0.32), X1, y + 0.05, s * (WZ - 0.02), { seg: 200, c: [0.42, 0.42, 0.46] });
      const cols = [[0.08, 0.08, 0.1], [0.5, 0.05, 0.05], [0.06, 0.12, 0.45], [0.35, 0.35, 0.38], [0.08, 0.08, 0.1], [0.55, 0.42, 0.05]];
      for (let i = 0; i < n; i++) c.mb('cable').cyl(X0, y + 0.085, s * (WZ - 0.26 + i * 0.05), X1, y + 0.085, s * (WZ - 0.26 + i * 0.05), 0.024, { segs: 5, c: cols[i % cols.length] });
      for (let x = X0 + 1.5; x < X1; x += 3) c.mb('steel').box(x - 0.03, y - 0.2, s * (WZ - 0.03), x + 0.03, y + 0.06, s * (WZ - 0.0), { c: [0.3, 0.3, 0.33] });
    }
    // vertical drain / down pipes every 16 m and a service conduit at 2.9 m
    for (let x = -24; x <= 24; x += 16) { c.mb('steel').cyl(x, BED, s * (WZ - 0.09), x, 6.9, s * (WZ - 0.09), 0.07, { segs: 8, c: [0.5, 0.52, 0.56] }); for (let y = -1; y < 7; y += 1.6) c.mb('steel').box(x - 0.11, y, s * (WZ - 0.13), x + 0.11, y + 0.05, s * (WZ - 0.0), { c: [0.3, 0.3, 0.33] }); }
    c.mb('galv').cyl(X0, 3.35, s * (WZ - 0.12), X1, 3.35, s * (WZ - 0.12), 0.05, { segs: 6, c: [0.9, 0.9, 0.95] });
    // cornice above the tile
    c.mb('concrete').box(X0, 2.72, s * (WZ - 0.1), X1, 2.8, s * WZ, { seg: 4, c: [0.55, 0.6, 0.65] });
    c.mb('paint').box(X0, 2.6, s * (WZ - 0.05), X1, 2.72, s * WZ, { seg: 4, c: [0.9, 0.9, 0.9], skip: 'ny' });
    // skirting at platform level
    c.mb('tileDark').box(X0, 0, s * (WZ - 0.05), X1, 0.14, s * WZ, { seg: 4, c: [0.9, 0.9, 0.9] });
  }
}

// ------------------------------------------------------------------------------------------------ ceiling
function ceiling(c) {
  const cf = (x, y, z) => 0.5 + 0.55 * fbm3(x * 0.16 + 5, 0, z * 0.16) - 0.2 * smooth(9.5, 11.5, Math.abs(z));
  c.mb('concrete').grid(X0, CY, -WZ, X1 - X0, 0, 0, 0, 0, 2 * WZ, 32, 12, 0, -1, 0, { c: [0.52, 0.58, 0.66], f: cf });
  // transverse beams at each bay and both ends, longitudinal beams over the column rows
  const beamF = (x, y, z) => 0.55 + 0.4 * fbm3(x * 0.4, y, z * 0.3) - 0.15 * smooth(6.6, 6.15, y);
  const bxs = [...COLUMN_XS, -32 + 0.4, 32 - 0.4];
  for (const bx of bxs) c.mb('concrete').box(bx - 0.36, 6.12, -WZ, bx + 0.36, CY, WZ, { seg: 2, c: [0.6, 0.66, 0.74], f: beamF, skip: 'py' });
  for (const s of [1, -1]) {
    c.mb('concrete').box(X0, 6.4, s * COLUMN_Z - 0.32, X1, CY, s * COLUMN_Z + 0.32, { seg: 3, c: [0.6, 0.66, 0.74], f: beamF, skip: 'py' });
    // column capitals
    for (const x of COLUMN_XS) { c.mb('concrete').box(x - 0.5, 5.95, s * COLUMN_Z - 0.5, x + 0.5, 6.15, s * COLUMN_Z + 0.5, { c: [0.66, 0.7, 0.76], seg: 2 }); c.mb('concrete').box(x - 0.4, 5.72, s * COLUMN_Z - 0.4, x + 0.4, 5.95, s * COLUMN_Z + 0.4, { c: [0.7, 0.75, 0.8], seg: 2 }); }
  }
  // galvanised ducts over the track pits with flanges + hangers
  for (const s of [1, -1]) {
    const zc = s * 8.3;
    c.mb('galv').box(X0, 5.35, zc - 0.45, X1, 5.95, zc + 0.45, { seg: 4, c: [0.75, 0.8, 0.85], f: (x, y, z) => 0.65 + 0.4 * fbm3(x * 0.3, y, z) });
    for (let x = X0 + 2; x < X1; x += 3) c.mb('galv').box(x - 0.04, 5.3, zc - 0.5, x + 0.04, 6.0, zc + 0.5, { c: [0.9, 0.92, 0.98], seg: 2 });
    for (let x = X0 + 3; x < X1; x += 6) for (const dz of [-0.35, 0.35]) c.mb('steel').cyl(x, 5.95, zc + dz, x, CY, zc + dz, 0.014, { segs: 4, c: [0.4, 0.4, 0.42] });
    // pipes: a big rust-streaked main + coloured service pipes
    const pz = s * 6.1;
    c.mb('rust').cyl(X0, 6.55, pz, X1, 6.55, pz, 0.14, { segs: 10, c: [0.85, 0.8, 0.8] });
    for (let x = X0 + 2; x < X1; x += 4) { c.mb('steel').cyl(x - 0.06, 6.55, pz, x + 0.06, 6.55, pz, 0.18, { segs: 10, c: [0.7, 0.7, 0.72] }); c.mb('steel').box(x - 0.04, 6.55, pz - 0.05, x + 0.04, CY, pz + 0.05, { c: [0.3, 0.3, 0.32] }); }
    c.mb('yellow').cyl(X0, 6.72, s * 5.55, X1, 6.72, s * 5.55, 0.07, { segs: 8, c: [1, 0.15, 0.1] });
    c.mb('yellow').cyl(X0, 6.74, s * 7.05, X1, 6.74, s * 7.05, 0.07, { segs: 8, c: [0.15, 0.4, 1] });
    for (let x = X0 + 4; x < X1; x += 8) for (const zz of [5.55, 7.05]) c.mb('steel').cyl(x - 0.04, 6.72, s * zz, x + 0.04, 6.72, s * zz, 0.1, { segs: 8, c: [0.6, 0.6, 0.62] });
  }
  // cable trays overhead in the middle
  for (const s of [1, -1]) {
    const zc = s * 1.15;
    c.mb('steel').box(X0, 6.85, zc - 0.25, X1, 6.9, zc + 0.25, { seg: 100, c: [0.4, 0.4, 0.44] });
    for (const [dz, col] of [[-0.15, [0.08, 0.08, 0.1]], [-0.05, [0.5, 0.06, 0.05]], [0.05, [0.08, 0.1, 0.4]], [0.15, [0.35, 0.35, 0.38]]]) c.mb('cable').cyl(X0, 6.93, zc + dz, X1, 6.93, zc + dz, 0.03, { segs: 5, c: col });
    for (let x = X0 + 1; x < X1; x += 2) c.mb('steel').box(x - 0.03, 6.86, zc - 0.28, x + 0.03, CY, zc + 0.28, { c: [0.3, 0.3, 0.33] });
  }
  // water stains on the ceiling
  for (let i = 0; i < 16; i++) c.quadAt('decal', ['blot0', 'blot1', 'blot2'][i % 3], c.rr(-30, 30), 6.985, c.rr(-10, 10), 0, -1, 0, c.rr(1.6, 3.4), c.rr(1.4, 2.8), { rot: c.rr(0, 6.28), tint: c.rr(0.5, 0.9) });
  // ventilation grilles in the ceiling
  for (const [gx, gz] of [[-16, -6.6], [16, 6.6], [-16, 6.6], [0, -9.2], [24, -6.6], [-8, 9.4]]) {
    c.mb('dark').box(gx - 0.7, 6.94, gz - 0.7, gx + 0.7, CY, gz + 0.7, { c: [0.35, 0.35, 0.38] });
    for (let i = -3; i <= 3; i++) c.mb('steel').box(gx - 0.66, 6.9, gz + i * 0.19 - 0.02, gx + 0.66, 6.94, gz + i * 0.19 + 0.02, { c: [0.6, 0.6, 0.64] });
  }
}

// ------------------------------------------------------------------------------------------------ tracks
function tracks(c) {
  const bedF = (x, y, z) => 0.7 + 0.7 * fbm3(x * 0.3, 2, z * 0.3);
  for (const s of [1, -1]) {
    const zc = s * 6.6;
    // ballast in the station pit + in tunnel (both directions)
    c.mb('ballast').grid(X0, BED, Math.min(s * 4.7, s * WZ), X1 - X0, 0, 0, 0, 0, s * (WZ - 4.7), 32, 4, 0, 1, 0, { c: [1, 1, 1], f: (x, y, z) => bedF(x, y, z) * (1 - 0.35 * smooth(0.9, 0, Math.abs(Math.abs(z) - 4.7)) - 0.4 * smooth(9.6, 11.5, Math.abs(z))) });
    for (const e of [1, -1]) c.mb('ballast').grid(e * 32, BED, zc - 2.6, e * (TUN - 32), 0, 0, 0, 0, 5.2, 27, 2, 0, 1, 0, { c: [0.7, 0.7, 0.72], f: (x, y, z) => bedF(x, y, z) * (1 - 0.6 * smooth(32, 130, Math.abs(x))) });
    // rails
    for (const dz of [-LAYOUT.gauge / 2 - 0.035, LAYOUT.gauge / 2 + 0.035]) {
      const rz = zc + dz;
      c.mb('steel').box(-TUN, -1.22, rz - 0.075, TUN, -1.19, rz + 0.075, { seg: 400, c: [0.5, 0.36, 0.3] });
      c.mb('steel').box(-TUN, -1.19, rz - 0.018, TUN, -1.14, rz + 0.018, { seg: 400, c: [0.55, 0.4, 0.34] });
      c.mb('steel').box(-TUN, -1.14, rz - 0.04, TUN, RT, rz + 0.04, { seg: 400, c: [1.5, 1.45, 1.4] });
      for (let x = -TUN + 9; x < TUN; x += 18) c.mb('steel').box(x - 0.35, -1.21, rz - 0.05, x + 0.35, -1.12, rz + 0.05, { c: [0.7, 0.55, 0.45] });
    }
    // third rail with cover + insulators
    const tzr = zc + s * 1.37;
    c.mb('steel').box(-TUN, -0.98, tzr - 0.05, TUN, -0.88, tzr + 0.05, { seg: 400, c: [0.6, 0.55, 0.5] });
    c.mb('plastic').box(-TUN, -0.88, tzr - s * 0.0 - 0.09, TUN, -0.85, tzr + 0.09, { seg: 400, c: [0.9, 0.7, 0.1] });
    for (let x = -TUN + 1.5; x < TUN; x += 3) c.mb('plastic').box(x - 0.05, -1.24, tzr - 0.06, x + 0.05, -0.98, tzr + 0.06, { c: [0.8, 0.8, 0.75] });
    // sleepers (instanced)
    const g = withColor(new THREE.BoxGeometry(0.26, 0.14, 2.6), [0.3, 0.32, 0.35]), n = Math.floor(2 * TUN / 0.65);
    const im = new THREE.InstancedMesh(g, c.M.concrete, n), m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (let i = 0; i < n; i++) { p.set(-TUN + i * 0.65 + (i % 7 === 0 ? 0.02 : 0), -1.29, zc + (((i * 37) % 11) - 5) * 0.004); const rz = ((i * 13) % 5 - 2) * 0.006; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rz); m.compose(p, q, sc); im.setMatrixAt(i, m); }
    im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; c.add(im);
  }
}

// ------------------------------------------------------------------------------------------------ tunnels
function archProfile() {
  const P = [], r = ARCH.r, yc = ARCH.yc; let u = 0, prev = null;
  const push = (z, y, nz, ny) => { if (prev) u += Math.hypot(z - prev[0], y - prev[1]); prev = [z, y]; P.push({ z, y, nz, ny, u }); };
  push(-r, BED, 1, 0); push(-r, yc, 1, 0);
  const N = 20; for (let i = 1; i < N; i++) { const th = Math.PI - (i / N) * Math.PI; push(Math.cos(th) * r, yc + Math.sin(th) * r, -Math.cos(th), -Math.sin(th)); }
  push(r, yc, -1, 0); push(r, BED, -1, 0);
  return P;
}

function tunnels(c) {
  const P = archProfile(), dark = [0.5, 0.56, 0.62];
  for (const e of [1, -1]) for (const zs of [1, -1]) {
    const zc = zs * 6.6;
    const mb = c.mb('concrete'), stations = []; for (let x = 32; x <= TUN + 0.001; x += 4) stations.push(x);
    const base = mb.n;
    for (let si = 0; si < stations.length; si++) for (let pi = 0; pi < P.length; pi++) {
      const x = e * stations[si], p = P[pi], y = p.y, z = zc + p.z;
      const dist = stations[si]; let k = (0.42 + 0.6 * fbm3(x * 0.12, y * 0.4, z * 0.4)) * (1 - 0.7 * smooth(34, 120, dist)) * (1 + 0.8 * (1 - smooth(32, 46, dist)));
      if (y < 0) k *= 0.6 + 0.4 * smooth(BED, 0, y);
      mb.vert(x, y, z, 0, p.ny, p.nz, x / 4, p.u / 4, dark[0] * k, dark[1] * k, dark[2] * k);
    }
    const w = P.length;
    for (let si = 0; si < stations.length - 1; si++) for (let pi = 0; pi < P.length - 1; pi++) {
      const a = base + si * w + pi, b = a + 1, c2 = a + w, d = c2 + 1;
      // orientation: inward-facing; choose by direction of travel so normals point at the tunnel axis
      if (e > 0) mb.idx.push(a, c2, b, b, c2, d); else mb.idx.push(a, b, c2, b, d, c2);
    }
    // end cap
    c.mb('dark').grid(e * TUN, BED, zc - 2.6, 0, 0, 5.2, 0, 6, 0, 1, 1, -e, 0, 0, { c: [0.02, 0.02, 0.025] });
    // portal frame on the platform-side face: yellow inner lip + green outer band
    portalFrame(c, e, zc);
    // cable trays along both walls
    for (const wz of [-1, 1]) {
      const z = zc + wz * 2.52;
      c.mb('steel').box(e * 32, 0.55, z - wz * 0.14 - 0.14, e * TUN, 0.6, z - wz * 0.14 + 0.14, { seg: 400, c: [0.4, 0.4, 0.44] });
      for (let i = 0; i < 4; i++) c.mb('cable').cyl(e * 32, 0.64, z - wz * (0.02 + i * 0.05) - wz * 0.05, e * TUN, 0.64, z - wz * (0.02 + i * 0.05) - wz * 0.05, 0.022, { segs: 5, c: [[0.08, 0.08, 0.1], [0.5, 0.06, 0.05], [0.06, 0.1, 0.4], [0.3, 0.3, 0.3]][i] });
      for (let x = 34; x < TUN; x += 3) c.mb('steel').box(e * x - 0.03, 0.3, z - wz * 0.3 - 0.0, e * x + 0.03, 0.62, z + wz * 0.0, { c: [0.3, 0.3, 0.33] });
    }
    // ceiling dressing: a long conduit along the crown
    c.mb('steel').cyl(e * 32, ARCH.yc + ARCH.r - 0.16, zc + 0.6, e * TUN, ARCH.yc + ARCH.r - 0.16, zc + 0.6, 0.05, { segs: 6, c: [0.35, 0.35, 0.38] });
  }
  // structural ribs (instanced)
  const ring = ribGeometry(P);
  const xs = []; for (let x = 36; x < TUN; x += 3.6) xs.push(x);
  const im = new THREE.InstancedMesh(ring, c.M.concrete, xs.length * 4), m = new THREE.Matrix4(); let n = 0;
  for (const e of [1, -1]) for (const zs of [1, -1]) for (const x of xs) { m.makeTranslation(e * x, 0, zs * 6.6); im.setMatrixAt(n++, m); }
  im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; c.add(im);
}

function ribGeometry(P) {
  const mb = new MB(4); // local builder (uv from arc)
  const inset = 0.12, hw = 0.2, shade = [0.34, 0.37, 0.41];
  const pts = P.map((p) => ({ z: p.z + p.nz * inset, y: p.y + p.ny * inset, nz: p.nz, ny: p.ny, u: p.u }));
  const base = mb.n;
  for (let i = 0; i < P.length; i++) for (const sx of [-hw, hw]) mb.vert(sx, pts[i].y, pts[i].z, 0, pts[i].ny, pts[i].nz, (sx + hw) / 0.4 * 0.5, pts[i].u / 4, shade[0], shade[1], shade[2]);
  for (let i = 0; i < P.length - 1; i++) { const a = base + i * 2, b = a + 1, c2 = a + 2, d = a + 3; mb.idx.push(a, b, c2, b, d, c2); }
  // side faces (x = +-hw), stepping from the tunnel wall (P) to the inset line
  for (const sx of [-hw, hw]) { const b0 = mb.n; for (let i = 0; i < P.length; i++) { mb.vert(sx, P[i].y, P[i].z, sx > 0 ? 1 : -1, 0, 0, P[i].z / 4, P[i].y / 4, shade[0] * 0.8, shade[1] * 0.8, shade[2] * 0.8); mb.vert(sx, pts[i].y, pts[i].z, sx > 0 ? 1 : -1, 0, 0, pts[i].z / 4, pts[i].y / 4, shade[0] * 0.8, shade[1] * 0.8, shade[2] * 0.8); }
    for (let i = 0; i < P.length - 1; i++) { const a = b0 + i * 2, b = a + 1, c2 = a + 2, d = a + 3; if (sx > 0) mb.idx.push(a, c2, b, b, c2, d); else mb.idx.push(a, b, c2, b, d, c2); } }
  return mb.build();
}

function portalFrame(c, e, zc) {
  const xF = e * 32, nx = -e, out = 0.13, fx = xF + nx * out;
  const r0 = ARCH.r, r1 = ARCH.r + 0.16, r2 = ARCH.r + 0.5, N = 18, yc = ARCH.yc;
  const ring = (ra, rb, key, col, xf, nxx) => {
    for (let i = 0; i < N; i++) {
      const a0 = Math.PI - (i / N) * Math.PI, a1 = Math.PI - ((i + 1) / N) * Math.PI;
      const p = (r, a) => [xf, yc + Math.sin(a) * r, zc + Math.cos(a) * r];
      c.mb(key).patch(p(ra, a0), p(rb, a0), p(ra, a1), p(rb, a1), 1, 1, nxx, 0, 0, { c: col });
    }
    for (const sz of [-1, 1]) c.mb(key).patch([xf, BED, zc + sz * ra], [xf, BED, zc + sz * rb], [xf, yc, zc + sz * ra], [xf, yc, zc + sz * rb], 1, 3, nxx, 0, 0, { c: col });
  };
  ring(r0, r1, 'yellow', [1, 1, 1], fx, nx); ring(r1, r2, 'paint', [0.85, 0.9, 0.9], fx, nx);
  // outer step face of the frame (faces the arch axis) so the protrusion has thickness
  for (let i = 0; i < N; i++) {
    const a0 = Math.PI - (i / N) * Math.PI, a1 = Math.PI - ((i + 1) / N) * Math.PI, r = r2;
    const p = (a, x) => [x, yc + Math.sin(a) * r, zc + Math.cos(a) * r];
    const am = (a0 + a1) / 2; c.mb('paint').patch(p(a0, xF), p(a0, fx), p(a1, xF), p(a1, fx), 1, 1, 0, Math.sin(am), Math.cos(am), { c: [0.6, 0.65, 0.65] });
  }
  // chevron warning plate above the apex
}

// ------------------------------------------------------------------------------------------------ colliders
function colliders(c) {
  const w = c.world;
  w.addFloor(X0, X1, -PH, PH, 0);
  w.addBox([X0, -2, PH], [X1, 1.6, PH + 0.4], { tag: 'edge', hitscan: false }); w.addBox([X0, -2, -PH - 0.4], [X1, 1.6, -PH], { tag: 'edge', hitscan: false });
  w.addBox([X0, -2, -PH], [X1, -0.002, PH], { tag: 'body', solid: false, surface: 'concrete' });
  for (const s of [1, -1]) {
    const z0 = s > 0 ? PH : -WZ, z1 = s > 0 ? WZ : -PH;
    w.addBox([X0, -2, z0], [X1, BED, z1], { tag: 'ballast', solid: false, surface: 'concrete' });
    w.addBox([X0 - 1, -2, s > 0 ? WZ : -WZ - 1.5], [X1 + 1, 8, s > 0 ? WZ + 1.5 : -WZ], { tag: 'wall', surface: 'tile' });
  }
  for (const e of [1, -1]) {
    const xa = e > 0 ? 32 : -33.5, xb = e > 0 ? 33.5 : -32;
    // centre wall between the portals (solid tile wall)
    w.addBox([xa, -2, -4.0], [xb, 8, 4.0], { tag: 'wall', surface: 'tile' });
    for (const zs of [1, -1]) {
      const zc = zs * 6.6;
      // outer strip beside the arch
      w.addBox([xa, -2, zs > 0 ? zc + ARCH.r : -WZ - 1.5], [xb, 8, zs > 0 ? WZ + 1.5 : zc - ARCH.r], { tag: 'wall', surface: 'concrete' });
      // wall above the arch (approximating the curved reveal in steps)
      const steps = [[2.0, 3.2, 2.35], [3.2, 4.0, 1.85], [4.0, 4.6, 1.0]];
      for (const [y0, y1, hw] of steps) for (const sg of [-1, 1]) { const zz0 = sg > 0 ? zc + hw : zc - ARCH.r; const zz1 = sg > 0 ? zc + ARCH.r : zc - hw; w.addBox([xa, y0, zz0], [xb, y1, zz1], { tag: 'wall', surface: 'concrete', solid: false }); }
      w.addBox([xa, 4.6, zc - ARCH.r], [xb, 8, zc + ARCH.r], { tag: 'wall', surface: 'concrete', solid: false });
      // tunnel walls / roof / floor (hitscan only)
      const ta = e > 0 ? 33.5 : -TUN, tb = e > 0 ? TUN : -33.5;
      w.addBox([ta, -2, zs > 0 ? zc + ARCH.r : -WZ - 1.5], [tb, 8, zs > 0 ? WZ + 1.5 : zc - ARCH.r], { tag: 'tunnel', solid: false, surface: 'concrete' });
      w.addBox([ta, 4.6, zc - ARCH.r], [tb, 8, zc + ARCH.r], { tag: 'tunnel', solid: false, surface: 'concrete' });
      w.addBox([ta, -2, zc - ARCH.r], [tb, BED, zc + ARCH.r], { tag: 'tunnel', solid: false, surface: 'concrete' });
      // platform end abutment: visible hitscan block + taller invisible solid so nobody can hop into the tunnel mouth
      w.addBox([e > 0 ? 30.8 : -32, -2, zs > 0 ? 4.0 : -5.0], [e > 0 ? 32 : -30.8, 1.1, zs > 0 ? 5.0 : -4.0], { tag: 'wall', surface: 'concrete' });
      w.addBox([e > 0 ? 31.0 : -33, -2, zs > 0 ? 4.0 : -5.4], [e > 0 ? 33 : -31.0, 3.2, zs > 0 ? 5.4 : -4.0], { tag: 'blocker', hitscan: false });
    }
    // dividing rock between the two tunnels
    w.addBox([e > 0 ? 33.5 : -TUN, -2, -4.0], [e > 0 ? TUN : -33.5, 8, 4.0], { tag: 'tunnel', solid: false, surface: 'concrete' });
    // dead end
    w.addBox([e > 0 ? TUN : -TUN - 2, -2, -WZ - 1.5], [e > 0 ? TUN + 2 : -TUN, 8, WZ + 1.5], { tag: 'wall', surface: 'concrete' });
  }
}
