// Car body / interior / cab / undercarriage geometry for the metro train. Everything is built into shared GB builders
// (one per material) so the whole train renders in a few dozen draw calls.
import { GB, rgb, tint, mixC, smooth, cells, decalQuad } from './gb.js';
import { mulberry32 } from '../texutil.js';
import * as K from './consts.js';

export const COL = {
  lower: rgb('#33647d'), skirt: rgb('#1a2a33'), stripe: rgb('#e5761a'), silver: rgb('#cdd3d5'), upper: rgb('#d3d8d9'), roof: rgb('#a3abae'),
  gasket: rgb('#0b0e10'), door: rgb('#f58d1c'), doorDark: rgb('#c4640e'), rubber: rgb('#090a0b'), endwall: rgb('#2c3d48'), dark: rgb('#151a1d'),
  cream: rgb('#e2ddc9'), creamLow: rgb('#8fa1a3'), floor: rgb('#4a5458'), ceil: rgb('#eeece0'), cove: rgb('#d6d3c3'),
  seat: rgb('#2f7189'), seatB: rgb('#28627a'), seatBase: rgb('#1f2b31'), pole: rgb('#c4cbce'), strap: rgb('#c9a03a'),
  metal: rgb('#8b9296'), under: rgb('#1a1e21'), underLite: rgb('#2b3236'), rust: rgb('#4d2f1c'),
};
const dirt = (y, k = 1) => k * (0.56 + 0.44 * smooth(-0.4, 1.6, y));
const shade = (y) => 0.62 + 0.38 * smooth(0, 1.3, y);
const FULL = { u0: 0, u1: 1, v0: 0, v1: 1 };
const zr = (a, b) => (a < b ? [a, b] : [b, a]);

// ---- door leaf (used for instanced near-side leaves and static far-side leaves) -------------------
export function addLeaf(gb, cu, zc, th, outward, k = 1) {
  const w = K.LEAF_W / 2, z0 = zc - th / 2, z1 = zc + th / 2, c = (b) => (p) => tint(b, 0.78 + 0.22 * smooth(-0.2, 1.4, p[1]) * Math.min(1, k + 0.2));
  gb.box(cu - w, 0, z0, cu + w, 1.08, z1, c(COL.door));
  gb.box(cu - w, 2.05, z0, cu + w, 2.2, z1, c(COL.door));
  gb.box(cu - w, 1.08, z0, cu - w + 0.13, 2.05, z1, c(COL.door));
  gb.box(cu + w - 0.13, 1.08, z0, cu + w, 2.05, z1, c(COL.door));
  // inset panel, kick plate, window gasket on the outer face
  const oz0 = outward < 0 ? z0 - 0.012 : z1, oz1 = outward < 0 ? z0 : z1 + 0.012;
  gb.box(cu - w + 0.07, 0.14, oz0, cu + w - 0.07, 0.98, oz1, c(COL.doorDark), 0);
  gb.box(cu - w, 0.0, oz0, cu + w, 0.1, oz1, c(COL.metal));
  gb.box(cu - w + 0.12, 1.06, oz0, cu + w - 0.12, 1.1, oz1, c(COL.gasket));
  gb.box(cu - w + 0.12, 2.03, oz0, cu + w - 0.12, 2.07, oz1, c(COL.gasket));
  gb.box(cu - w + 0.11, 1.06, oz0, cu - w + 0.14, 2.07, oz1, c(COL.gasket));
  gb.box(cu + w - 0.14, 1.06, oz0, cu + w - 0.11, 2.07, oz1, c(COL.gasket));
  // rubber meeting edges
  gb.box(cu - w - 0.005, 0, z0 - 0.008, cu - w + 0.02, 2.2, z1 + 0.008, COL.rubber);
  gb.box(cu + w - 0.02, 0, z0 - 0.008, cu + w + 0.005, 2.2, z1 + 0.008, COL.rubber);
}

// ---- one car ---------------------------------------------------------------------------------------
export function buildCar(G, T, i) {
  const uC = K.carU(i), rnd = mulberry32(5000 + i * 131), front = i === K.CAR_COUNT - 1, rear = i === 0;
  const dk = [0.92, 0.78, 0.86][i];
  const uMin = rear ? -7.05 : -K.HALF, uMax = front ? 7.05 : K.HALF;
  const ext = G.ext, glass = G.glass, under = G.under, xd = G.extDecal, sg = G.signs, lampD = G.lampDoor;
  const P = G.cars[i], I = P.int, D = P.dec, S = P.strip;
  for (const g of [ext, glass, under, xd, sg, lampD, G.ledInt, G.lampHead, G.lampTail, G.lampMark, I, D, S]) g.setOffset(uC, 0, 0);
  const X = T.extAtlas.rects, Y = T.intAtlas.rects;
  const cabSgn = (u) => (front && u > 5.9 ? 1 : rear && u < -5.9 ? -1 : 0);

  // ---------------- wall holes (shared by exterior skin and interior lining) ----------------
  const doorHoles = K.DOOR_U.map((d) => ({ a0: d - K.DOOR_W / 2, a1: d + K.DOOR_W / 2, y0: 0, y1: K.DOOR_H, door: true, d }));
  const winHoles = K.WINDOWS.map((w) => ({ a0: w[0], a1: w[1], y0: K.WIN_Y0, y1: K.WIN_Y1 }));
  const holes = [...doorHoles, ...winHoles];
  const edges = holes.flatMap((h) => [h.a0, h.a1]);

  for (const side of [-1, 1]) {
    const zo = side * K.HW, zi = side * K.IW, zmid = side * (K.HW + K.IW) / 2;
    // exterior skin cells
    const yB = [-0.35, -0.1, 0, 0.35, 0.7, 0.82, 0.9, 1.6, 2.2, 2.3, 2.9, 3.35];
    for (const [a0, a1, y0, y1] of cells([uMin, uMax, ...edges], yB, holes)) {
      const m = (y0 + y1) / 2;
      const b = m < 0 ? COL.skirt : m < 0.7 ? COL.lower : m < 0.82 ? COL.stripe : m < 0.9 ? COL.lower : m < 2.3 ? COL.silver : COL.upper;
      ext.quad([a0, y0, zo], [a1, y0, zo], [a1, y1, zo], [a0, y1, zo], (p) => tint(b, dirt(p[1], dk)), null, [0, 0, side]);
    }
    // interior lining cells
    for (const [a0, a1, y0, y1] of cells([uMin === -7.05 ? -6.95 : -7.2, uMax === 7.05 ? 6.95 : 7.2, ...edges, ...(front ? [5.9] : []), ...(rear ? [-5.9] : [])], [0, 0.25, 0.9, 1.6, 2.2, 2.3, 2.85], holes.map((h) => ({ ...h })))) {
      const m = (y0 + y1) / 2, mu = (a0 + a1) / 2, b = m < 0.9 ? COL.creamLow : COL.cream, cab = cabSgn(mu) !== 0 ? 0.16 : 1;
      I.quad([a0, y0, zi], [a1, y0, zi], [a1, y1, zi], [a0, y1, zi], (p) => tint(b, shade(p[1]) * cab * (0.93 + 0.07 * dk)), null, [0, 0, -side]);
    }
    // reveals + glass
    for (const h of holes) {
      const [z0, z1] = zr(side * K.IW, side * K.HW), g = 0.035;
      if (h.door) {
        ext.box(h.a0, h.y0, z0, h.a0 + 0.03, h.y1, z1, COL.gasket); ext.box(h.a1 - 0.03, h.y0, z0, h.a1, h.y1, z1, COL.gasket); ext.box(h.a0, h.y1 - 0.05, z0, h.a1, h.y1, z1, COL.gasket);
        ext.box(h.a0, -0.02, z0, h.a1, 0.02, z1, COL.metal); // sill / threshold
        if (side < 0) {
          // hanging-door track above the opening (near side)
          ext.box(h.d - 1.5, 2.24, -1.485, h.d + 1.5, 2.33, -1.4, COL.under);
          ext.box(h.d - 1.5, 2.33, -1.475, h.d + 1.5, 2.345, -1.42, COL.metal);
          for (const rx of [-1.2, -0.6, 0.6, 1.2]) ext.box(h.d + rx - 0.03, 2.05, -1.46, h.d + rx + 0.03, 2.24, -1.4, COL.under);
        } else {
          addLeaf(ext, h.d - 0.35, side * 1.35, 0.05, +1, dk); addLeaf(ext, h.d + 0.35, side * 1.35, 0.05, +1, dk);
          for (const cx of [h.d - 0.35, h.d + 0.35]) glass.quad([cx - 0.22, 1.1, zmid], [cx + 0.22, 1.1, zmid], [cx + 0.22, 2.05, zmid], [cx - 0.22, 2.05, zmid], [1, 1, 1], [[0.1, 0.1], [0.5, 0.1], [0.5, 0.6], [0.1, 0.6]], [0, 0, side]);
        }
        // door-open lamp above the opening
        lampD.boxC(h.d, 2.5, side * (K.HW + 0.008), 0.2, 0.07, 0.02, [1, 1, 1]);
        ext.boxC(h.d, 2.5, side * (K.HW + 0.004), 0.26, 0.11, 0.01, COL.gasket);
      } else {
        ext.box(h.a0, h.y0, z0, h.a0 + g, h.y1, z1, COL.gasket); ext.box(h.a1 - g, h.y0, z0, h.a1, h.y1, z1, COL.gasket);
        ext.box(h.a0, h.y0, z0, h.a1, h.y0 + g, z1, COL.gasket); ext.box(h.a0, h.y1 - g, z0, h.a1, h.y1, z1, COL.gasket);
        const u0 = rnd() * 0.35, v0 = rnd() * 0.35;
        glass.quad([h.a0 + g, h.y0 + g, zmid], [h.a1 - g, h.y0 + g, zmid], [h.a1 - g, h.y1 - g, zmid], [h.a0 + g, h.y1 - g, zmid], [1, 1, 1], [[u0, v0], [u0 + 0.6, v0], [u0 + 0.6, v0 + 0.6], [u0, v0 + 0.6]], [0, 0, side]);
        // dirty sill streaks below main windows on both sides
        if (h.a1 - h.a0 > 1.2 && rnd() < 0.85) decalQuad(xd, X['streak' + Math.floor(rnd() * 3)], (h.a0 + h.a1) / 2 + (rnd() - 0.5) * 0.5, 0.42, side * (K.HW + 0.004), 'z', side, 0.55 + rnd() * 0.5, 0.95);
      }
    }
  }

  // ---------------- end walls (saloon ends) ----------------
  const endWall = (sgn) => {
    const isCab = (sgn > 0 && front) || (sgn < 0 && rear);
    if (isCab) return;
    const uo = sgn * K.HALF, ui = sgn * 7.2;
    for (const [a0, a1, y0, y1] of cells([-1.4, -0.5, 0.5, 1.4], [-0.35, 0, 2.1, 3.35], [{ a0: -0.5, a1: 0.5, y0: 0, y1: 2.1 }])) {
      ext.quad([uo, y0, a0], [uo, y0, a1], [uo, y1, a1], [uo, y1, a0], (p) => tint(y0 < 0 ? COL.skirt : COL.endwall, 0.85), null, [sgn, 0, 0]);
    }
    // arch fill above the walls
    for (let k = 0; k < 8; k++) {
      const z0 = -1.4 + (2.8 * k) / 8, z1 = -1.4 + (2.8 * (k + 1)) / 8, f = (z) => K.ROOF_Y + (K.ROOF_APEX - K.ROOF_Y) * (1 - Math.pow(z / 1.4, 2));
      ext.quad([uo, K.ROOF_Y, z0], [uo, K.ROOF_Y, z1], [uo, f(z1), z1], [uo, f(z0), z0], COL.endwall, null, [sgn, 0, 0]);
    }
    for (const [a0, a1, y0, y1] of cells([-1.3, -0.5, 0.5, 1.3], [0, 0.9, 2.1, 2.85], [{ a0: -0.5, a1: 0.5, y0: 0, y1: 2.1 }])) {
      I.quad([ui, y0, a0], [ui, y0, a1], [ui, y1, a1], [ui, y1, a0], (p) => tint(y1 <= 0.9 ? COL.creamLow : COL.cream, shade(p[1])), null, [-sgn, 0, 0]);
    }
    const [x0, x1] = zr(ui, uo);
    ext.box(x0, 0, -0.5, x1, 2.1, -0.47, COL.gasket); ext.box(x0, 0, 0.47, x1, 2.1, 0.5, COL.gasket); ext.box(x0, 2.07, -0.5, x1, 2.1, 0.5, COL.gasket);
    // extinguisher + intercom + bracket on the interior end wall
    I.cyl(1, ui - sgn * 0.09, 0.62, -1.0, 0.075, 0.075, 0.5, 10, rgb('#b3221c'));
    I.box(ui - sgn * 0.1 - 0.04, 0.93, -1.05, ui - sgn * 0.1 + 0.04, 0.98, -0.95, COL.dark);
    I.boxC(ui - sgn * 0.03, 1.45, 1.0, 0.05, 0.22, 0.16, COL.dark);
    S.boxC(ui - sgn * 0.058, 1.5, 1.0, 0.01, 0.03, 0.03, [0.2, 1.4, 0.3]);
    // CCTV dome
    I.cyl(1, ui - sgn * 0.3, 2.93, 0.0, 0.11, 0.11, 0.14, 10, COL.dark);
    S.cyl(1, ui - sgn * 0.3, 2.85, 0.0, 0.03, 0.03, 0.02, 6, [2.2, 0.15, 0.1]);
  };
  endWall(1); endWall(-1);

  // ---------------- cabs ----------------
  const cab = (sgn, isFront) => {
    const U = (u) => sgn * u, fc = [sgn, 0, 0];
    // chin block
    const bands = [[-0.35, 0, COL.skirt], [0, 0.7, COL.lower], [0.7, 0.82, COL.stripe], [0.82, 1.05, COL.lower]];
    for (const [y0, y1, c] of bands) ext.box(Math.min(U(7.05), U(7.3)), y0, -1.4, Math.max(U(7.05), U(7.3)), y1, 1.4, (p) => tint(c, dirt(p[1], dk)));
    // upper fascia
    ext.box(Math.min(U(6.95), U(7.05)), 2.55, -1.4, Math.max(U(6.95), U(7.05)), 3.35, 1.4, (p) => tint(COL.upper, dirt(p[1], dk)));
    // side triangles + slanted pillars
    for (const s of [-1, 1]) {
      ext.tri([U(7.05), 1.05, s * 1.4], [U(7.3), 1.05, s * 1.4], [U(7.05), 2.55, s * 1.4], (p) => tint(COL.silver, dirt(p[1], dk)), [0, 0, s]);
      ext.quad([U(7.3), 1.05, s * 1.25], [U(7.3), 1.05, s * 1.4], [U(7.05), 2.55, s * 1.4], [U(7.05), 2.55, s * 1.25], COL.gasket, null, fc);
    }
    ext.quad([U(7.3), 1.05, -0.1], [U(7.3), 1.05, 0.1], [U(7.05), 2.55, 0.1], [U(7.05), 2.55, -0.1], COL.gasket, null, fc);
    // windscreen glass (two panes), dark cab wall behind
    for (const [za, zb] of [[-1.25, -0.1], [0.1, 1.25]]) glass.quad([U(7.295), 1.05, za], [U(7.295), 1.05, zb], [U(7.055), 2.55, zb], [U(7.055), 2.55, za], [1, 1, 1], [[0.05, 0.05], [0.55, 0.05], [0.55, 0.6], [0.05, 0.6]], fc);
    // wipers
    for (const z of [-0.7, 0.7]) ext.box(Math.min(U(7.27), U(7.31)), 1.12, z - 0.34, Math.max(U(7.27), U(7.31)), 1.16, z + 0.34, COL.gasket);
    // headlamps / tail lamps / markers
    for (const z of [-0.95, 0.95]) {
      ext.cyl(0, U(7.31), 0.62, z, 0.16, 0.16, 0.05, 14, COL.gasket);
      (isFront ? G.lampHead : G.lampTail).cyl(0, U(7.335), 0.62, z, 0.12, 0.12, 0.03, 14, [1, 1, 1]);
      G.lampMark.boxC(U(7.32), 0.32, z * 1.24, 0.03, 0.07, 0.11, [1, 1, 1]);
      ext.boxC(U(7.31), 0.32, z * 1.24, 0.02, 0.1, 0.14, COL.gasket);
    }
    // number plate, coupler, hoses, step, horn grille
    decalQuad(xd, X['plate' + i], U(7.305), 0.66, 0, 'x', sgn, 0.5, 0.25);
    ext.box(Math.min(U(7.3), U(7.42)), -0.08, -0.42, Math.max(U(7.3), U(7.42)), 0.3, 0.42, COL.under);
    under.cyl(0, U(7.5), 0.1, 0, 0.09, 0.07, 0.3, 10, COL.metal);
    under.cyl(0, U(7.4), 0.16, -0.24, 0.03, 0.03, 0.16, 8, rgb('#a5231b')); under.cyl(0, U(7.4), 0.16, 0.24, 0.03, 0.03, 0.16, 8, rgb('#c9a02a'));
    for (let k = 0; k < 7; k++) ext.box(Math.min(U(7.3), U(7.31)), 0.86 + k * 0.025 - 0.02, -0.35, Math.max(U(7.3), U(7.31)), 0.865 + k * 0.025, 0.35, COL.gasket);
    // destination sign (front only; the rear stays dark)
    ext.box(Math.min(U(7.05), U(7.07)), 2.6, -0.88, Math.max(U(7.05), U(7.07)), 3.04, 0.88, COL.gasket);
    if (isFront) sg.quad([U(7.072), 2.62, -0.83], [U(7.072), 2.62, 0.83], [U(7.072), 3.02, 0.83], [U(7.072), 3.02, -0.83], [1, 1, 1], [[1, 0], [0, 0], [0, 1], [1, 1]], fc);
    // roof lamp + horn
    ext.boxC(U(6.9), 3.4, 0, 0.3, 0.1, 0.3, COL.metal); ext.cyl(1, U(6.3), 3.45, 0.5, 0.11, 0.11, 0.24, 10, COL.dark);
    // cab interior: console, seat, floor, indicator lights
    const c0 = Math.min(U(6.4), U(6.9)), c1 = Math.max(U(6.4), U(6.9));
    I.box(c0, 0.02, -1.0, c1, 1.1, 1.0, rgb('#161d21')); I.box(c0, 1.1, -1.0, c1, 1.14, 1.0, rgb('#0b0f11'));
    I.box(Math.min(U(5.98), U(6.2)), 0.4, 0.15, Math.max(U(5.98), U(6.2)), 0.5, 0.75, rgb('#22292d')); I.box(Math.min(U(5.98), U(6.05)), 0.5, 0.15, Math.max(U(5.98), U(6.05)), 1.0, 0.75, rgb('#22292d'));
    const lc = [[1.8, 1.0, 0.15], [0.2, 1.6, 0.4], [0.2, 0.9, 2], [2.0, 0.3, 0.2], [0.3, 1.4, 1.4]];
    for (let k = 0; k < 16; k++) { const cc = lc[k % lc.length]; S.boxC(U(6.55 + rnd() * 0.3), 1.15, -0.85 + k * 0.11, 0.035, 0.012, 0.035, cc); }
    S.box(Math.min(U(6.5), U(6.52)), 0.7, -0.45, Math.max(U(6.5), U(6.52)), 0.95, 0.45, [0.05, 0.28, 0.32]);
    // bulkhead between saloon and cab with an open door
    for (const [a0, a1, y0, y1] of cells([-1.3, -0.45, 0.45, 1.3], [0, 2.0, 2.85], [{ a0: -0.45, a1: 0.45, y0: 0, y1: 2.0 }])) {
      I.quad([U(5.9), y0, a0], [U(5.9), y0, a1], [U(5.9), y1, a1], [U(5.9), y1, a0], (p) => tint(COL.cream, shade(p[1])), null, [-sgn, 0, 0]);
    }
    for (const [a0, a1, y0, y1] of cells([-1.3, -0.45, 0.45, 1.3], [0, 2.0, 2.85], [{ a0: -0.45, a1: 0.45, y0: 0, y1: 2.0 }])) {
      I.quad([U(5.9), y0, a0], [U(5.9), y0, a1], [U(5.9), y1, a1], [U(5.9), y1, a0], rgb('#10161a'), null, [sgn, 0, 0]);
    }
    I.box(Math.min(U(5.9), U(6.0)), 0, -0.47, Math.max(U(5.9), U(6.0)), 2.0, -0.43, COL.dark); I.box(Math.min(U(5.9), U(6.0)), 0, 0.43, Math.max(U(5.9), U(6.0)), 2.0, 0.47, COL.dark); I.box(Math.min(U(5.9), U(6.0)), 1.96, -0.47, Math.max(U(5.9), U(6.0)), 2.0, 0.47, COL.dark);
    // bulkhead window (cab door glass) skip; arch cap above windscreen is the roof end
  };
  if (front) cab(1, true);
  if (rear) cab(-1, false);

  // ---------------- roof ----------------
  const prof = []; for (let k = 0; k <= 8; k++) { const z = -1.4 + (2.8 * k) / 8; prof.push([z, K.ROOF_Y + (K.ROOF_APEX - K.ROOF_Y) * (1 - Math.pow(z / 1.4, 2))]); }
  ext.extrudeProfile(prof, uMin, uMax, (p) => tint(COL.roof, 0.85 - 0.12 * Math.abs(p[2]) * 0.3));
  if (front || rear) for (let k = 0; k < 8; k++) {
    const sgn = front ? 1 : -1, uo = sgn * 7.05, z0 = -1.4 + (2.8 * k) / 8, z1 = -1.4 + (2.8 * (k + 1)) / 8, f = (z) => K.ROOF_Y + (K.ROOF_APEX - K.ROOF_Y) * (1 - Math.pow(z / 1.4, 2));
    ext.quad([uo, K.ROOF_Y, z0], [uo, K.ROOF_Y, z1], [uo, f(z1), z1], [uo, f(z0), z0], COL.upper, null, [sgn, 0, 0]);
  }
  for (const s of [-1, 1]) ext.box(uMin, 3.33, s * 1.4 - 0.02, uMax, 3.39, s * 1.4 + 0.04 * s, COL.under);
  for (const ax of [-4.4, 4.4]) {
    if ((front && ax > 5) || (rear && ax < -5)) continue;
    ext.box(ax - 1.4, 3.5, -0.75, ax + 1.4, 3.85, 0.75, (p) => tint(COL.silver, 0.72 * (p[1] > 3.8 ? 1.05 : 0.85)));
    for (let k = 0; k < 7; k++) ext.box(ax - 1.28 + k * 0.4, 3.85, -0.68, ax - 1.28 + k * 0.4 + 0.24, 3.875, 0.68, COL.gasket);
    ext.cyl(1, ax - 0.5, 3.9, 0, 0.26, 0.26, 0.05, 14, COL.gasket); ext.cyl(1, ax + 0.5, 3.9, 0, 0.26, 0.26, 0.05, 14, COL.gasket);
    ext.box(ax - 1.4, 3.5, -0.78, ax + 1.4, 3.56, 0.78, COL.under);
  }
  ext.cyl(0, 0, 3.66, 0, 0.045, 0.045, uMax - uMin - 1, 8, COL.under);
  for (const z of [-0.5, 0.5]) ext.cyl(0, 0, 3.6, z, 0.025, 0.025, uMax - uMin - 1, 6, COL.metal);

  // ---------------- side signs / logos / plates / grime / blood (exterior decals) ----------------
  for (const side of [-1, 1]) {
    const zs = side * (K.HW + 0.006);
    ext.box(-0.86, 2.53, side * K.HW, 0.86, 3.01, side * (K.HW + 0.005), COL.gasket);
    decalQuad(sg, FULL, 0, 2.77, side * (K.HW + 0.008), 'z', side, 1.6, 0.4);
    decalQuad(xd, X.logo, 2.6, 2.72, zs, 'z', side, 1.36, 0.34);
    decalQuad(xd, X['plate' + i], side < 0 ? 6.35 : -6.35, 2.72, zs, 'z', side, 0.48, 0.24);
    if (!(front || rear)) decalQuad(xd, X['plate' + i], side < 0 ? -6.35 : 6.35, 2.72, zs, 'z', side, 0.48, 0.24);
    decalQuad(xd, X.warn, side < 0 ? 2.87 : -2.87, 1.55, zs, 'z', side, 0.2, 0.2);
    // blood / claws / hand prints / graffiti / rust on the lower body
    const spots = [-6.3, -2.4, 0.2, 2.2, 6.3];
    for (const u of spots) {
      const r = rnd();
      if (r < 0.28) { const bs = 0.7 + rnd() * 0.14; decalQuad(xd, X['blood' + Math.floor(rnd() * 4)], u, 0.46, zs, 'z', side, bs, bs, rnd() * 6.28); }
      else if (r < 0.46) decalQuad(xd, X.claw, u, 0.46, zs, 'z', side, 0.7, 0.7, (rnd() - 0.5) * 0.4);
      else if (r < 0.62) decalQuad(xd, X['rust' + Math.floor(rnd() * 2)], u, 0.15, zs, 'z', side, 1.5, 0.75);
      else if (r < 0.74) decalQuad(xd, X['tag' + Math.floor(rnd() * 2)], u, 0.46, zs, 'z', side, 1.2, 0.6);
    }
    if (rnd() < 0.7) decalQuad(xd, X['hand' + Math.floor(rnd() * 2)], side < 0 ? -0.975 : 0.975, 1.2 + rnd() * 0.5, zs, 'z', side, 0.3, 0.3, (rnd() - 0.5) * 0.6);
  }

  // ---------------- interior ----------------
  const uL = rear ? -6.95 : -7.2, uR = front ? 6.95 : 7.2;
  // floor + threshold plates
  I.quad([uL, K.FLOOR_Y, -1.3], [uR, K.FLOOR_Y, -1.3], [uR, K.FLOOR_Y, 1.3], [uL, K.FLOOR_Y, 1.3], (p) => tint(COL.floor, (0.85 + 0.25 * Math.abs(p[2] / 1.3)) * (cabSgn(p[0]) ? 0.4 : 1)), null, [0, 1, 0]);
  // ceiling + coves
  const cU0 = rear ? -6.95 : -7.2, cU1 = front ? 6.95 : 7.2;
  I.quad([cU0, K.CEIL_Y, -0.75], [cU1, K.CEIL_Y, -0.75], [cU1, K.CEIL_Y, 0.75], [cU0, K.CEIL_Y, 0.75], tint(COL.ceil, 0.98), null, [0, -1, 0]);
  for (const s of [-1, 1]) I.quad([cU0, K.CEIL_Y, s * 0.75], [cU1, K.CEIL_Y, s * 0.75], [cU1, K.LINING_TOP, s * K.IW], [cU0, K.LINING_TOP, s * K.IW], [[0.95, 0.95, 0.9], [0.95, 0.95, 0.9], [0.7, 0.7, 0.66], [0.7, 0.7, 0.66]].map((c) => tint(c, 0.95)), null, [0, -0.55, -0.2 * s]);
  // light strips: segmented, a few dead/dying
  const segs = 7, sw = 13.2 / segs;
  for (const s of [-1, 1]) for (let k = 0; k < segs; k++) {
    const a = -6.6 + k * sw + 0.05, b = -6.6 + (k + 1) * sw - 0.05; if ((front && b > 6.0) || (rear && a < -6.0)) continue;
    const dead = rnd() < 0.16, lv = dead ? 0.07 : 1;
    S.quad([a, K.CEIL_Y - 0.006, s * 0.36], [b, K.CEIL_Y - 0.006, s * 0.36], [b, K.CEIL_Y - 0.006, s * 0.56], [a, K.CEIL_Y - 0.006, s * 0.56], [0.86 * lv, 0.95 * lv, 1.0 * lv], null, [0, -1, 0]);
    I.box(a - 0.02, K.CEIL_Y - 0.035, s * 0.33, b + 0.02, K.CEIL_Y - 0.008, s * 0.36, COL.under); I.box(a - 0.02, K.CEIL_Y - 0.035, s * 0.56, b + 0.02, K.CEIL_Y - 0.008, s * 0.59, COL.under);
  }
  // benches
  const bench = (side, u0, u1) => {
    const zw = side * (K.IW - 0.005), zf = side * 0.86, [a, b] = zr(zw, zf);
    I.box(u0, 0.02, a, u1, 0.4, b, COL.seatBase);
    const n = Math.max(1, Math.round((u1 - u0) / 0.56)), w = (u1 - u0) / n;
    for (let k = 0; k < n; k++) {
      const x0 = u0 + k * w + 0.012, x1 = u0 + (k + 1) * w - 0.012, v = 0.82 + rnd() * 0.3;
      const [c0, c1] = zr(zw, side * 0.84), [d0, d1] = zr(side * (K.IW - 0.11), side * (K.IW - 0.015));
      I.box(x0, 0.4, c0, x1, 0.475, c1, (p) => tint(COL.seat, v * (0.75 + 0.25 * (1 - Math.abs(p[2]) / 1.3) + 0.1)));
      I.box(x0, 0.475, d0, x1, 0.94, d1, (p) => tint(COL.seatB, v * (0.6 + 0.4 * smooth(0.45, 0.95, p[1]))));
    }
  };
  for (const s of [-1, 1]) {
    bench(s, -3.3, 3.3);
    if (!front) bench(s, 5.95, 7.15);
    if (!rear) bench(s, -7.15, -5.95);
    // partition screens next to the door pockets
    for (const u of [-3.45, 3.45]) I.box(u - 0.02, 0.02, Math.min(s * 0.78, s * 1.3), u + 0.02, 1.25, Math.max(s * 0.78, s * 1.3), rgb('#6f8288'));
  }
  // poles, rails, straps
  const railZ = 0.55;
  for (const s of [-1, 1]) {
    for (const u of [-3.3, -1.75, 0, 1.75, 3.3]) I.cyl(1, u, (K.FLOOR_Y + K.CEIL_Y) / 2, s * (Math.abs(u) > 3 ? 0.72 : railZ), 0.022, 0.022, K.CEIL_Y - K.FLOOR_Y, 8, COL.pole);
    I.cyl(0, 0, 2.32, s * railZ, 0.02, 0.02, 13.6, 8, COL.pole);
    for (let k = -7; k <= 7; k++) {
      const u = k * 0.86; if (Math.abs(u) > 6.4 || (Math.abs(u) > 3.4 && Math.abs(u) < 5.4) || (front && u > 5.5) || (rear && u < -5.5)) continue;
      I.box(u - 0.03, 2.28, s * railZ - 0.025, u + 0.03, 2.33, s * railZ + 0.025, COL.metal);
      I.box(u - 0.014, 2.0, s * railZ - 0.004, u + 0.014, 2.28, s * railZ + 0.004, COL.strap);
      I.box(u - 0.07, 1.97, s * railZ - 0.012, u + 0.07, 2.01, s * railZ + 0.012, COL.strap);
    }
  }
  // door frame pillars (grab poles either side of each doorway inside)
  for (const d of K.DOOR_U) for (const e of [-0.86, 0.86]) for (const s of [-1, 1]) I.cyl(1, d + e, (K.FLOOR_Y + K.CEIL_Y) / 2, s * 1.22, 0.02, 0.02, K.CEIL_Y - K.FLOOR_Y, 8, COL.pole);

  // interior decals: route strips + LED over doors, ads, notices, floor lines, blood
  const sides = [-1, 1];
  for (const s of sides) {
    const zi = s * (K.IW - 0.004);
    for (const d of K.DOOR_U) {
      decalQuad(D, Y.route, d, 2.43, zi, 'z', -s, 1.4, 0.28);
      decalQuad(G.ledInt, FULL, d, 2.73, s * (K.IW - 0.008), 'z', -s, 1.12, 0.14);
    }
    [-1.95, 0, 1.95].forEach((u, k) => decalQuad(D, Y['ad' + ((i * 2 + k + (s > 0 ? 1 : 0)) % 4)], u, 2.575, zi, 'z', -s, 1.26, 0.44));
    decalQuad(D, Y.notice, -0.975 * s, 1.55, zi, 'z', -s, 0.28, 0.28); decalQuad(D, Y.nosmoke, 0.975 * s, 1.55, zi, 'z', -s, 0.26, 0.26);
    // wall blood
    for (let k = 0; k < 3; k++) {
      const u = (rnd() * 2 - 1) * 6.2; if (Math.abs(Math.abs(u) - 4.4) < 0.9) continue;
      const r = rnd(); decalQuad(D, r < 0.5 ? Y['spat' + Math.floor(rnd() * 3)] : r < 0.8 ? Y['blood' + Math.floor(rnd() * 4)] : Y['hand' + Math.floor(rnd() * 2)], u, 0.5 + rnd() * 1.3, zi, 'z', -s, 0.5 + rnd() * 0.5, 0.5 + rnd() * 0.5, rnd() * 6.28);
    }
    decalQuad(D, Y.grime0, (rnd() - 0.5) * 8, 0.3, zi, 'z', -s, 2, 0.9);
  }
  for (const d of K.DOOR_U) {
    decalQuad(D, Y.floorline, d, K.FLOOR_Y + 0.004, -0.8, 'y', 1, 1.4, 0.95, 0);
    if (rnd() < 0.9) decalQuad(D, Y.drag, d + (rnd() - 0.5) * 0.4, K.FLOOR_Y + 0.006, -0.7, 'y', 1, 1.6, 0.4, Math.PI / 2 + (rnd() - 0.5) * 0.3, [1, 1, 1]);
  }
  for (let k = 0; k < 7; k++) {
    const u = (rnd() * 2 - 1) * 6, z = (rnd() * 2 - 1) * 1.05, r = rnd();
    decalQuad(D, r < 0.45 ? Y['blood' + Math.floor(rnd() * 4)] : r < 0.75 ? Y['spat' + Math.floor(rnd() * 3)] : Y['grime' + Math.floor(rnd() * 2)], u, K.FLOOR_Y + 0.008 + k * 0.0003, z, 'y', 1, 0.9 + rnd() * 0.9, 0.9 + rnd() * 0.9, rnd() * 6.28);
  }
  for (let k = 0; k < 4; k++) decalQuad(D, Y.scuff, (rnd() * 2 - 1) * 5.5, K.FLOOR_Y + 0.005, (rnd() * 2 - 1) * 0.9, 'y', 1, 1.2, 0.35, rnd() * 3);

  // ---------------- underframe ----------------
  under.box(-7.1, -0.55, -1.15, 7.1, -0.05, 1.15, COL.under);
  under.box(-7.1, -0.38, -1.4, 7.1, -0.35, 1.4, COL.under);
  under.box(-3.2, -0.95, -1.0, -1.6, -0.55, -0.3, COL.underLite); under.box(0.5, -0.9, 0.2, 1.8, -0.55, 0.95, COL.underLite);
  under.box(2.0, -0.85, -0.9, 3.4, -0.55, -0.2, rgb('#3a2a20'));
  under.box(-6.2, -0.8, 0.3, -4.9, -0.55, 1.0, COL.underLite); under.box(4.2, -0.85, 0.35, 5.6, -0.55, 1.05, COL.underLite);
  under.cyl(0, 0, -0.72, -0.62, 0.17, 0.17, 2.8, 12, COL.underLite); under.cyl(0, -1.0, -0.66, 0.55, 0.14, 0.14, 1.9, 12, COL.underLite);
  under.cyl(0, 0.3, -0.62, 0.02, 0.028, 0.028, 12, 6, COL.rust); under.cyl(0, 0.3, -0.6, -0.15, 0.02, 0.02, 12, 6, rgb('#1a2b3a'));
  // skirt hatch handles + rivets strip
  for (let k = -3; k <= 3; k++) ext.box(k * 1.9 - 0.25, -0.3, -1.41, k * 1.9 + 0.25, -0.15, -1.395, COL.under);
  for (const g of [ext, glass, under, xd, sg, lampD, G.ledInt, G.lampHead, G.lampTail, G.lampMark, I, D, S]) g.setOffset(0, 0, 0);
}

// ---- bogie (static frame, axle boxes, springs, motors) --------------------------------------------
export function buildBogie(G, uAbs) {
  const g = G.under; g.setOffset(uAbs, 0, 0);
  const fr = COL.underLite, dk = COL.under;
  for (const s of [-1, 1]) {
    g.box(-1.3, -0.74, s * 1.0 - 0.06, 1.3, -0.5, s * 1.0 + 0.06, fr);
    g.box(-1.4, -0.68, s * 1.0 - 0.07, -1.2, -0.44, s * 1.0 + 0.07, dk); g.box(1.2, -0.68, s * 1.0 - 0.07, 1.4, -0.44, s * 1.0 + 0.07, dk);
    for (const a of [-K.AXLE_OFF, K.AXLE_OFF]) {
      g.cyl(2, a, K.AXLE_Y, s * 1.0, 0.13, 0.13, 0.24, 10, COL.metal); // axle box
      g.cyl(1, a, -0.42, s * 1.0, 0.07, 0.07, 0.24, 8, rgb('#5d6468')); g.cyl(1, a, -0.42, s * 1.0, 0.09, 0.09, 0.04, 8, COL.metal); // coil spring
      g.cyl(1, a + 0.2, -0.55, s * 1.0, 0.02, 0.02, 0.3, 6, rgb('#b8b23a')); // damper
    }
  }
  g.box(-0.2, -0.72, -1.0, 0.2, -0.52, 1.0, fr); g.box(-1.25, -0.7, -0.9, -1.0, -0.52, 0.9, fr); g.box(1.0, -0.7, -0.9, 1.25, -0.52, 0.9, fr);
  for (const a of [-K.AXLE_OFF, K.AXLE_OFF]) { g.cyl(2, a, K.AXLE_Y, 0, 0.21, 0.21, 0.55, 14, rgb('#3b4348')); g.box(a - 0.14, K.AXLE_Y + 0.05, -0.12, a + 0.14, K.AXLE_Y + 0.25, 0.12, dk); }
  // brake cylinders + third-rail shoe beam (far side)
  g.cyl(0, 0.0, -0.6, -0.6, 0.08, 0.08, 0.5, 10, rgb('#4a5156')); g.cyl(0, 0.0, -0.6, 0.6, 0.08, 0.08, 0.5, 10, rgb('#4a5156'));
  g.box(0.4, -0.8, 1.0, 0.75, -0.72, 1.5, dk); g.box(0.42, -0.86, 1.27, 0.72, -0.8, 1.47, rgb('#7a6a4a'));
  for (const s of [-1, 1]) g.box(-1.0, -0.85, s * 0.6 - 0.03, 1.0, -0.8, s * 0.6 + 0.03, dk);
  g.setOffset(0, 0, 0);
}

// ---- one wheelset (axle + wheels + brake discs), local origin at the axle centre --------------------
export function buildWheelset(gb) {
  const steel = rgb('#2b2e32'), bright = rgb('#474c51'), paint = rgb('#d9d7cc'), disc = rgb('#6b6660');
  gb.cyl(2, 0, 0, 0, 0.055, 0.055, 1.9, 8, rgb('#26282b'));
  for (const s of [-1, 1]) {
    gb.cyl(2, 0, 0, s * 0.76, K.WHEEL_R, K.WHEEL_R, 0.13, 22, steel);
    gb.cyl(2, 0, 0, s * 0.685, 0.5, 0.5, 0.04, 22, rgb('#2c2e31'));
    gb.cyl(2, 0, 0, s * 0.83, 0.2, 0.2, 0.05, 14, bright);
    gb.cyl(2, 0, 0, s * 0.865, 0.1, 0.1, 0.04, 10, rgb('#77746a'));
    gb.box(0.17, -0.025, s * 0.825, 0.45, 0.025, s * 0.832, paint);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; gb.boxC(Math.cos(a) * 0.29, Math.sin(a) * 0.29, s * 0.83, 0.05, 0.05, 0.02, rgb('#9aa0a5')); }
    gb.cyl(2, 0, 0, s * 0.45, 0.3, 0.3, 0.03, 22, disc);
    for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; gb.boxC(Math.cos(a) * 0.24, Math.sin(a) * 0.24, s * 0.45, 0.032, 0.032, 0.036, rgb('#171717')); }
  }
}

// ---- gangway bellows + couplers between two cars (train-local u range [uA, uB]) ---------------------
export function buildGap(G, uA, uB) {
  const u = G.under, mid = (uA + uB) / 2, len = uB - uA;
  const rub = rgb('#3b4248'), rub2 = rgb('#262b30');
  const folds = 6;
  for (let k = 0; k < folds; k++) {
    const x = uA + 0.03 + ((len - 0.06) * (k + 0.5)) / folds, e = k % 2 ? 0.05 : 0, th = (len - 0.06) / folds * 0.55;
    const c = k % 2 ? rub : rub2;
    u.box(x - th / 2, 0.0, -1.1 - e, x + th / 2, 0.08 + e * 0, 1.1 + e, c);
    u.box(x - th / 2, 2.5 - e * 0, -1.1 - e, x + th / 2, 2.6 + e, 1.1 + e, c);
    u.box(x - th / 2, 0.0, -1.1 - e, x + th / 2, 2.6 + e, -1.02, c);
    u.box(x - th / 2, 0.0, 1.02, x + th / 2, 2.6 + e, 1.1 + e, c);
  }
  u.box(uA, 0.0, -1.0, uB, 2.55, -0.96, rgb('#0d0f11')); u.box(uA, 0.0, 0.96, uB, 2.55, 1.0, rgb('#0d0f11')); u.box(uA, 2.5, -1.0, uB, 2.55, 1.0, rgb('#0d0f11'));
  u.box(uA, -0.06, -0.62, uB, 0.02, 0.62, COL.metal); // gangway floor plate
  // coupler drawbar + hoses + jumper cable
  u.cyl(0, mid, -0.22, 0, 0.11, 0.11, len + 0.3, 12, COL.underLite); u.boxC(mid, -0.22, 0, 0.26, 0.2, 0.3, COL.under);
  for (const [z, c] of [[-0.42, '#a5231b'], [-0.3, '#c9a02a'], [0.3, '#c9a02a'], [0.42, '#a5231b']]) { u.cyl(1, mid - 0.15, -0.22, z, 0.03, 0.03, 0.34, 8, rgb(c)); u.cyl(1, mid + 0.15, -0.3, z * 0.8, 0.03, 0.03, 0.24, 8, rgb('#111')); }
  for (let k = 0; k < 6; k++) u.cyl(0, uA + (len * (k + 0.5)) / 6, -0.34 - Math.sin((k / 5) * Math.PI) * 0.1, 0.62, 0.035, 0.035, len / 6 + 0.02, 6, rgb('#0b0b0c'));
}
