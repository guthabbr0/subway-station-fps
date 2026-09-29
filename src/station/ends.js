// The two platform ends: west = closed-off stair to a boarded-up mezzanine with security shutter, fare gates, barricades and
// ticket machines; east = dead lift, vending machines, emergency exit and fire cabinet. Plus the hazard abutments at the tunnel mouths.
import * as THREE from 'three';
import { grimeF, fbm3 } from './mb.js';
import { panel, pasted } from './props.js';

const W3 = [1, 1, 1];

export function buildEnds(c) { west(c); east(c); abutments(c); }

// ---------------------------------------------------------------------------------------------------------- planks
function plank(len, h, th) { const g = new THREE.BoxGeometry(th, h, len); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len * 0.6, uv.getY(i) * h * 0.6); return g; }
function addPlank(mb, x, y, z, rot, len, h, th, col) { const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rot), new THREE.Vector3(1, 1, 1)); mb.addGeometry(plank(len, h, th), m, col); }

// ---------------------------------------------------------------------------------------------------------- west
function west(c) {
  const NST = 22, RISE = 0.17, TREAD = 0.28, X0 = -24.8, ZW = 1.6, TOP = NST * RISE;
  const conc = c.mb('concrete'), rub = c.mb('rubber'), yel = c.mb('yellow');
  const g = grimeF({ floorY: 0, dirt: 0.45, seed: 4, low: 0.4, hi: 0.1 });
  for (let i = 0; i < NST; i++) {
    const xb = X0 - i * TREAD, xa = xb - TREAD, top = (i + 1) * RISE;
    conc.box(xa, 0, -ZW, xb, top, ZW, { c: [0.72, 0.78, 0.84], f: (x, y, z) => g(x, y * 0.6, z) * 0.9, seg: 2, skip: 'py ny' });
    rub.grid(xa, top + 0.002, -ZW, TREAD, 0, 0, 0, 0, 2 * ZW, 1, 4, 0, 1, 0, { c: [0.85, 0.85, 0.9], f: (x, y, z) => 0.55 + 0.6 * fbm3(x * 4, i, z * 2), uv: (x, y, z) => [x / 0.5, z / 0.5] });
    yel.box(xb - 0.055, top - 0.002, -ZW, xb, top + 0.01, ZW, { c: [1, 0.95, 0.9], f: (x, y, z) => 0.6 + 0.4 * fbm3(z * 3, i, 1), seg: 2 });
    // dark shadowed riser lip
    c.mb('dark').grid(xb + 0.010, top - RISE, -ZW, 0, RISE, 0, 0, 0, 2 * ZW, 1, 1, 1, 0, 0, { c: [0.35, 0.35, 0.36] }); // (+10 mm: it was EXACTLY on the concrete riser = z-fighting black / grey on every stair riser)
  }
  // top landing
  conc.box(-32, 0, -ZW, X0 - NST * TREAD, TOP, ZW, { c: [0.7, 0.75, 0.8], skip: 'py' });
  rub.grid(-32, TOP + 0.002, -ZW, 32 - 24.8 - NST * TREAD + 0.0, 0, 0, 0, 0, 2 * ZW, 1, 4, 0, 1, 0, { c: [0.8, 0.8, 0.85], uv: (x, y, z) => [x / 0.5, z / 0.5] });
  // balustrade walls (tiled) following the slope
  const topY = (x) => 1.05 + (RISE / TREAD) * (X0 - x);
  for (const s of [1, -1]) {
    const z0 = s > 0 ? ZW : -ZW - 0.3, z1 = s > 0 ? ZW + 0.3 : -ZW;
    const pts = [[-24.4, 0], [-24.4, topY(-24.4)], [-32, topY(-32)], [-32, 0]];
    c.mb('tileCream').prismXY(pts, z0, z1, { c: [0.95, 0.95, 0.95], f: grimeF({ floorY: 0, dirt: 0.4, seed: s + 9, low: 0.5, hi: 0 }), seg: 1.2 });
    // capping strip (steel) along the top of the wall
    const p0 = [-24.4, topY(-24.4)], p1 = [-32, topY(-32)];
    c.mb('paint').prismXY([[p0[0], p0[1]], [p1[0], p1[1]], [p1[0], p1[1] + 0.05], [p0[0], p0[1] + 0.05]].reverse().map((p) => p), z0 - 0.02, z1 + 0.02, { c: [0.9, 0.95, 0.95], seg: 3 });
    // dark under-glow on the outside wall base
  }
  // handrails: two side rails inside the walls plus a central divider, with posts
  const hr = (z, h0) => {
    const ya = (x) => (RISE / TREAD) * (X0 - x) + h0;
    c.mb('chrome').cyl(-24.5, ya(-24.5), z, -31.7, ya(-31.7), z, 0.024, { segs: 8, c: W3 });
    for (let x = -25.0; x > -31.7; x -= 1.4) c.mb('chrome').cyl(x, (RISE / TREAD) * (X0 - x), z, x, ya(x), z, 0.014, { segs: 5, c: W3 });
    c.mb('chrome').cyl(-24.5, ya(-24.5), z, -24.5, ya(-24.5) - 0.9, z, 0.024, { segs: 8, c: W3 }); // start post
  };
  hr(ZW - 0.16, 0.98); hr(-ZW + 0.16, 0.98); hr(0, 1.05);
  // stair ceiling bulkhead + emergency light
  c.mb('concrete').box(-32, 5.9, -ZW - 0.3, -30.2, 7, ZW + 0.3, { c: [0.45, 0.5, 0.55], seg: 2, skip: 'py' });
  // mezzanine doorway: dark void, frame, half-lowered shutter, planks, sign
  const dx = -32;
  c.mb('dark').box(dx - 0.5, TOP, -ZW, dx + 0.02, 6.2, ZW, { c: [0.02, 0.02, 0.025], skip: 'nx' });
  c.mb('paint').box(dx, TOP, -ZW - 0.16, dx + 0.18, 6.35, -ZW, { c: [0.75, 0.8, 0.8], seg: 2 }); c.mb('paint').box(dx, TOP, ZW, dx + 0.18, 6.35, ZW + 0.16, { c: [0.75, 0.8, 0.8], seg: 2 }); c.mb('paint').box(dx, 6.2, -ZW - 0.16, dx + 0.18, 6.4, ZW + 0.16, { c: [0.75, 0.8, 0.8], seg: 2 });
  // roller housing
  c.mb('steel').cyl(dx + 0.3, 6.05, -ZW - 0.1, dx + 0.3, 6.05, ZW + 0.1, 0.17, { segs: 12, c: [0.6, 0.6, 0.62] }); c.mb('steel').box(dx + 0.14, 5.892, -ZW - 0.1, dx + 0.5, 6.35, ZW + 0.1, { c: [0.45, 0.47, 0.5], skip: 'nx' }); // (5.892: its underside was exactly coplanar with the concrete bulkhead at 5.9)
  // shutter curtain (lowered to y=5.05) + bottom bar
  c.mb('shutter').box(dx + 0.19, 5.05, -ZW, dx + 0.23, 6.05, ZW, { c: [0.85, 0.85, 0.88], f: (x, y, z) => 0.55 + 0.6 * fbm3(z * 1.4, y * 1.2, 7) - 0.15 * (6.05 - y > 0.9 ? 0.5 : 0), seg: 1.5 });
  c.mb('steel').box(dx + 0.17, 4.98, -ZW - 0.05, dx + 0.26, 5.07, ZW + 0.05, { c: [0.35, 0.35, 0.38] });
  // guide rails
  for (const zz of [-ZW - 0.05, ZW + 0.05]) c.mb('steel').box(dx + 0.17, 4.98, zz - 0.04, dx + 0.27, 6.1, zz + 0.04, { c: [0.35, 0.36, 0.4] });
  // boards nailed across the opening below the shutter
  const wood = c.mb('wood');
  [[TOP + 0.2, 0.06, 3.3, 0.14], [TOP + 0.5, -0.04, 3.4, 0.16], [TOP + 0.85, 0.1, 3.2, 0.15], [TOP + 1.05, -0.11, 3.0, 0.14], [TOP + 0.62, 0.62, 1.9, 0.15], [TOP + 0.62, -0.58, 1.9, 0.15]].forEach(([y, rot, len, h], i) => addPlank(wood, dx + 0.28 + i * 0.012, y, (i % 2 ? 0.05 : -0.04), rot, len, h, 0.04, [0.8 + (i % 3) * 0.08, 0.78, 0.74]));
  for (const [y, z] of [[TOP + 0.2, -1.4], [TOP + 0.2, 1.4], [TOP + 0.5, -1.4], [TOP + 0.5, 1.4], [TOP + 0.85, 0], [TOP + 1.05, 1.3], [TOP + 1.05, -1.3]]) c.mb('steel').cyl(dx + 0.3, y, z, dx + 0.34, y, z, 0.018, { segs: 5, c: [0.3, 0.3, 0.32], cap: true });
  // chain + padlock through the bars
  c.mb('chrome').cyl(dx + 0.34, TOP + 0.36, -1.0, dx + 0.34, TOP + 0.36, 1.0, 0.015, { segs: 4, c: W3 }); c.mb('brass').box(dx + 0.33, TOP + 0.22, -0.05, dx + 0.39, TOP + 0.36, 0.05, { c: W3 });
  // signage on/around the shutter
  c.quadAt('glowA', 'hang_closed', dx + 0.245, 5.62, 0, 1, 0, 0, 2.7, 0.52, { tint: 0.92 });
  c.quadAt('decal2', 'g2', dx + 0.245, 5.28, 0.15, 1, 0, 0, 2.2, 1.1, { rot: 0.0, tint: 0.95 });
  c.quadAt('blood', 'hand0', dx + 0.245, 4.5, -1.0, 1, 0, 0, 0.5, 0.5, { rot: 0.2 }); c.quadAt('blood', 'hand1', dx + 0.245, 4.35, 0.8, 1, 0, 0, 0.5, 0.5, { rot: -0.3 });
  c.quadAt('blood', 'smear0', dx + 0.32, 4.6, 1.2, 1, 0, 0, 0.5, 1.0, {}); c.quadAt('blood', 'smear1', dx + 0.32, 4.6, -1.3, 1, 0, 0, 0.5, 1.0, {});
  c.quadAt('decal', 'streak1', dx + 0.24, 5.5, -1.0, 1, 0, 0, 0.6, 1.4, { tint: 0.9 });
  // colliders: solid stair mass (player can't climb), stepped hitscan boxes for accurate impacts
  c.collider([-31.3, -1, -1.9], [-24.6, 6.5, 1.9], { tag: 'stairs', hitscan: false });
  for (let i = 0; i < NST; i++) { const xb = X0 - i * TREAD, top = (i + 1) * RISE; c.world.addBox([xb - TREAD, 0, -ZW], [xb, top, ZW], { tag: 'stairs', solid: false, surface: 'concrete' }); }
  c.world.addBox([-32, 0, -ZW], [-30.9, TOP, ZW], { tag: 'stairs', solid: false, surface: 'concrete' });
  c.world.addBox([-32.6, 0, -1.9], [-24.4, 5.4, -ZW], { tag: 'wall', solid: false, surface: 'tile' }); c.world.addBox([-32.6, 0, ZW], [-24.4, 5.4, 1.9], { tag: 'wall', solid: false, surface: 'tile' });
  // fare gates in front of the stairs
  for (const z of [-1.65, -0.55, 0.55, 1.65]) {
    const x = -23.75;
    c.mb('paint').box(x - 0.55, 0, z - 0.09, x + 0.55, 0.98, z + 0.09, { c: [0.85, 0.9, 0.9], seg: 1.2 });
    c.mb('steel').box(x - 0.58, 0.98, z - 0.12, x + 0.58, 1.02, z + 0.12, { c: [0.7, 0.72, 0.75] });
    c.mb('dark').box(x - 0.3, 1.02, z - 0.07, x + 0.3, 1.06, z + 0.07, { c: [0.03, 0.03, 0.04] });
    const e = c.mb('emit'); e.box(x + 0.32, 1.02, z - 0.04, x + 0.38, 1.05, z + 0.04, { c: [0.1, 2.0, 0.3] }); e.box(x - 0.38, 1.02, z - 0.04, x - 0.32, 1.05, z + 0.04, { c: [2.4, 0.1, 0.05] });
  }
  for (const z of [-1.1, 0, 1.1]) { c.mb('glass').box(-24.15, 0.15, z - 0.4, -24.1, 0.95, z + 0.4, { c: W3 }); c.mb('glass').box(-23.4, 0.15, z - 0.4, -23.35, 0.95, z + 0.4, { c: W3 }); }
  c.collider([-24.25, 0, -1.95], [-23.2, 1.1, 1.95], { tag: 'gates', surface: 'metal' });
  // hazard tape + A-frames closing the approach
  const tapeZ = 2.3;
  for (const z of [-tapeZ, tapeZ]) { c.mb('steel').cyl(-22.7, 0, z, -22.7, 1.05, z, 0.025, { segs: 6, c: [0.4, 0.4, 0.44] }); c.mb('steel').cyl(-22.7, 0.02, z, -22.7, 0.05, z, 0.14, { segs: 10, c: [0.3, 0.3, 0.33] }); }
  for (const y of [0.98, 0.72]) c.mb('hazard').box(-22.72, y, -tapeZ, -22.68, y + 0.07, tapeZ, { c: [1, 1, 1], seg: 1.2, uv: (x, yy, z) => [z / 0.6, yy / 0.6] });
  c.collider([-22.85, 0, -tapeZ], [-22.55, 1.1, tapeZ], { tag: 'tape', surface: 'metal', hitscan: false });
  // hazard-striped road barriers (three rails on legs) flanking the approach
  for (const z of [-1.05, 1.05]) {
    for (const y of [0.75, 0.42]) c.mb('hazard').box(-22.3, y, z - 0.45, -22.26, y + 0.16, z + 0.45, { c: [1, 1, 1], seg: 1, uv: (x, yy, zz) => [zz / 0.5, yy / 0.5] });
    c.collider([-22.55, 0, z - 0.5], [-22.05, 0.95, z + 0.5], { tag: 'barrier', surface: 'metal', walkable: true }); // low enough to hop onto
    for (const dz of [-0.4, 0.4]) { c.mb('steel').box(-22.34, 0, z + dz - 0.03, -22.22, 0.95, z + dz + 0.03, { c: [0.7, 0.7, 0.72] }); c.mb('steel').box(-22.5, 0, z + dz - 0.03, -22.06, 0.04, z + dz + 0.03, { c: [0.5, 0.5, 0.52] }); }
  }
  // west flank dressing: ticket machines, help point, map
  ticketMachine(c, -31.55, 3.0, 1, 'ticket'); ticketMachine(c, -31.55, -3.35, 1, 'ticket');
  vending(c, -31.05, -2.35, 1, 'vend2', true);
  // the slots between the machines and the flank blockers (0.3-0.7 m) are too narrow to use but wide enough to wedge a body into: close them
  // (one block over the whole west flank strip: the 0.7 m gap between the stair mass and the end wall would otherwise be a zero-clearance hiding place no zombie can enter)
  c.collider([-32.05, -1, -4.02], [-31.0, c.world.ceilingY, 4.02], { tag: 'machine', hitscan: false }); // full height: nobody can drop into it from above
  panel(c, 'glowA', 'sos', -32 + 0.0, 1.8, 2.05 + 0.0, 1, 0, 0.3, 0.3, { depth: 0.03, frame: 0.02 }); // on the balustrade end face? fallback to wall pillar
  pasted(c, 'map', -31.98, 2.5, 3.05, 1, 0, 1.5, 0.375, 0, 0.95); c.quadAt('glowA', 'exit', -31.9, 3.4, 3.05, 1, 0, 0, 0.8, 0.4, {});
  pasted(c, 'n_suspended', -31.98, 1.0 + 1.3, -3.0, 1, 0, 0.32, 0.4, 0.03); pasted(c, 'n_note', -31.98, 3.1, -3.2, 1, 0, 0.32, 0.4, -0.06);
  // graffiti + grime on the flank
  c.quadAt('decal2', 'g0', -31.97, 0.75, -3.1, 1, 0, 0, 2.0, 1.0, { tint: 0.9 }); c.quadAt('decal2', 'g4', -31.97, 0.6, 3.0, 1, 0, 0, 2.0, 1.0, { tint: 0.9, rot: 0.03 });
  c.quadAt('decal', 'grime', -31.98, 0.35, 3.0, 1, 0, 0, 2.2, 0.7, { tint: 0.9 }); c.quadAt('decal', 'grime', -31.98, 0.35, -3.0, 1, 0, 0, 2.2, 0.7, { tint: 0.9 });
  for (const z of [-3.2, 3.2]) c.quadAt('decal', 'streak' + (z > 0 ? 0 : 2), -31.98, 4.6, z, 1, 0, 0, 0.7, 2.4, { tint: 0.9 });
}

export function ticketMachine(c, x, z, dir, screen) {
  const hx = 0.22, hz = 0.3, fx = x + dir * hx; // front face at x + dir*hx
  c.mb('paint').box(x - hx, 0, z - hz, x + hx, 1.55, z + hz, { c: [0.75, 0.85, 0.9], seg: 1.2 });
  c.mb('steel').box(x - hx - 0.02, 1.55, z - hz - 0.02, x + hx + 0.02, 1.6, z + hz + 0.02, { c: [0.3, 0.32, 0.36] });
  c.mb('concrete').box(x - hx - 0.04, 0, z - hz - 0.04, x + hx + 0.04, 0.12, z + hz + 0.04, { c: [0.7, 0.7, 0.72] });
  c.quadAt('glowB', screen, fx + dir * 0.003, 1.22, z, dir, 0, 0, 0.42, 0.42, { tint: 0.95 });
  c.mb('dark').box(fx - (dir < 0 ? 0.05 : 0), 0.85, z - 0.13, fx + (dir > 0 ? 0.05 : 0), 0.95, z + 0.13, { c: [0.02, 0.02, 0.02] }); // card slot
  c.mb('dark').box(fx - (dir < 0 ? 0.04 : 0), 0.62, z - 0.09, fx + (dir > 0 ? 0.04 : 0), 0.78, z + 0.09, { c: [0.03, 0.03, 0.03] });
  c.mb('emit').box(fx, 0.97, z - 0.02, fx + dir * 0.012, 1.0, z + 0.02, { c: [0.1, 1.8, 0.4] });
  c.mb('yellow').box(fx - (dir < 0 ? 0.01 : 0), 1.42, z - hz + 0.03, fx + (dir > 0 ? 0.01 : 0), 1.5, z + hz - 0.03, { c: [1, 0.9, 0.5] });
  c.collider([x - hx - 0.04, 0, z - hz - 0.04], [x + hx + 0.04, 1.62, z + hz + 0.04], { tag: 'machine', surface: 'metal' });
}
export function vending(c, xFront, z, dir, screen, west = false) {
  // xFront is the front face x; body extends away from the viewer (dir = facing direction)
  const w = 0.86, depth = 0.85, x0 = dir > 0 ? xFront - depth : xFront, x1 = dir > 0 ? xFront : xFront + depth;
  c.mb('paint').box(x0, 0.08, z - w / 2, x1, 1.95, z + w / 2, { c: [0.6, 0.7, 0.75], seg: 1 });
  c.mb('dark').box(x0, 0, z - w / 2, x1, 0.08, z + w / 2, { c: W3 });
  c.quadAt('glowB', screen, xFront + dir * 0.004, 1.08, z, dir, 0, 0, 0.8, 1.6, { tint: 1.0 });
  c.mb('glass').box(Math.min(xFront + dir * 0.006, xFront + dir * 0.014), 0.28, z - 0.4, Math.max(xFront + dir * 0.006, xFront + dir * 0.014), 1.9, z + 0.4, { c: W3 });
  c.mb('steel').box(xFront - 0.01, 0.2, z - 0.4, xFront + dir * 0.03, 0.28, z + 0.4, { c: [0.3, 0.3, 0.33] });
  c.collider([x0, 0, z - w / 2], [x1, 1.95, z + w / 2], { tag: 'machine', surface: 'metal' });
}

// ---------------------------------------------------------------------------------------------------------- east
function east(c) {
  const xf = 32;
  // lift
  const lz = 0;
  c.mb('paint').box(xf - 0.06, 0, lz - 1.1, xf, 2.5, lz - 0.95, { c: [0.7, 0.8, 0.8] }); c.mb('paint').box(xf - 0.06, 0, lz + 0.95, xf, 2.5, lz + 1.1, { c: [0.7, 0.8, 0.8] }); c.mb('paint').box(xf - 0.06, 2.3, lz - 1.1, xf, 2.5, lz + 1.1, { c: [0.7, 0.8, 0.8] });
  for (const s of [-1, 1]) c.mb('steel').box(xf - 0.05, 0.02, s > 0 ? lz + 0.01 : lz - 0.93, xf - 0.02, 2.3, s > 0 ? lz + 0.93 : lz - 0.01, { c: [1.15, 1.15, 1.2], seg: 1, f: (x, y, z) => 0.7 + 0.5 * fbm3(z * 3, y * 2, 11) });
  c.mb('dark').box(xf - 0.05, 0.02, lz - 0.012, xf - 0.02, 2.3, lz + 0.012, { c: [0.05, 0.05, 0.05] });
  c.mb('brass').box(xf - 0.1, 0.0, lz - 0.95, xf - 0.02, 0.03, lz + 0.95, { c: W3 });
  c.mb('steel').box(xf - 0.05, 2.5, lz - 1.15, xf, 2.9, lz + 1.15, { c: [0.3, 0.32, 0.35], skip: 'px' });
  c.quadAt('glowA', 'ooo', xf - 0.055, 2.7, lz, -1, 0, 0, 1.6, 0.4, { tint: 1.0 });
  // call panel
  c.mb('steel').box(xf - 0.05, 0.95, lz + 1.22, xf, 1.3, lz + 1.4, { c: [0.6, 0.6, 0.64] }); const em = c.mb('emit'); em.box(xf - 0.06, 1.2, lz + 1.27, xf - 0.05, 1.24, lz + 1.31, { c: [2.2, 0.2, 0.1] }); em.box(xf - 0.06, 1.08, lz + 1.27, xf - 0.05, 1.12, lz + 1.31, { c: [0.1, 0.9, 0.2] });
  pasted(c, 'n_lift', xf - 0.005, 1.6, lz - 1.5, -1, 0, 0.32, 0.4, 0.02);
  c.quadAt('blood', 'smear0', xf - 0.006, 1.0, lz + 0.6, -1, 0, 0, 0.5, 1.0, { tint: 0.9 }); c.quadAt('blood', 'hand0', xf - 0.006, 1.2, lz - 0.55, -1, 0, 0, 0.45, 0.45, { rot: 0.3 });
  // vending machines (drinks, snacks)
  vending(c, 31.1, -3.5, -1, 'vend1'); vending(c, 31.1, -2.6, -1, 'vend2');
  // emergency exit door
  const ez = 3.0;
  c.mb('paint').box(xf - 0.12, 0, ez - 0.62, xf, 2.28, ez - 0.52, { c: [0.6, 0.75, 0.7] }); c.mb('paint').box(xf - 0.12, 0, ez + 0.52, xf, 2.28, ez + 0.62, { c: [0.6, 0.75, 0.7] }); c.mb('paint').box(xf - 0.12, 2.18, ez - 0.62, xf, 2.28, ez + 0.62, { c: [0.6, 0.75, 0.7] });
  c.mb('paint').box(xf - 0.07, 0.0, ez - 0.52, xf - 0.02, 2.18, ez + 0.52, { c: [0.35, 0.75, 0.55], seg: 1, f: (x, y, z) => 0.6 + 0.6 * fbm3(z * 2, y * 2, 13) });
  c.mb('chrome').box(xf - 0.1, 1.0, ez - 0.4, xf - 0.07, 1.06, ez + 0.4, { c: W3 }); c.mb('steel').box(xf - 0.09, 0.98, ez - 0.44, xf - 0.07, 1.08, ez - 0.4, { c: [0.3, 0.3, 0.3] }); c.mb('steel').box(xf - 0.09, 0.98, ez + 0.4, xf - 0.07, 1.08, ez + 0.44, { c: [0.3, 0.3, 0.3] });
  c.mb('steel').box(xf - 0.09, 2.3, ez - 0.55, xf, 2.83, ez + 0.55, { c: [0.25, 0.27, 0.3], skip: 'px' }); c.quadAt('glowA', 'exit2', xf - 0.095, 2.57, ez, -1, 0, 0, 1.0, 0.5, { tint: 1.0 });
  c.quadAt('blood', 'smear1', xf - 0.075, 1.1, ez - 0.3, -1, 0, 0, 0.4, 0.9, {}); c.quadAt('blood', 'hand1', xf - 0.075, 1.35, ez + 0.3, -1, 0, 0, 0.4, 0.4, { rot: -0.2 });
  // fire hose cabinet
  c.mb('yellow').box(xf - 0.22, 0.95, 1.55, xf, 1.65, 2.05, { c: [0.85, 0.06, 0.05], seg: 1 }); c.mb('glass').box(xf - 0.225, 1.0, 1.6, xf - 0.223, 1.6, 2.0, { c: W3 }); c.mb('dark').box(xf - 0.2, 1.05, 1.65, xf - 0.02, 1.55, 1.95, { c: [0.15, 0.03, 0.03] }); c.quadAt('glowA', 'fire', xf - 0.005, 1.95, 1.8, -1, 0, 0, 0.25, 0.25, { tint: 0.9 });
  // big station plate + roundels + 'platform 2'
  c.mb('steel').box(xf - 0.09, 3.9, -2.05, xf, 4.7, 2.05, { c: [0.22, 0.25, 0.28], skip: 'px' }); c.quadAt('glowA', 'hang_name', xf - 0.094, 4.3, 0, -1, 0, 0, 3.9, 0.75, {});
  for (const z of [-2.85, 2.85]) c.quadAt('glowA', 'roundel', xf - 0.03, 4.3, z, -1, 0, 0, 0.75, 0.75, {});
  // graffiti + stains
  c.quadAt('decal2', 'g3', xf - 0.006, 0.9, -1.9, -1, 0, 0, 1.6, 0.8, { tint: 0.9 }); c.quadAt('decal2', 'g5', xf - 0.006, 3.2, 1.8, -1, 0, 0, 1.2, 0.6, { tint: 0.95 });
  c.quadAt('decal', 'grime', xf - 0.006, 0.35, 2.0, -1, 0, 0, 3.0, 0.7, { tint: 0.9 }); c.quadAt('decal', 'grime', xf - 0.006, 0.35, -2.0, -1, 0, 0, 3.0, 0.7, { tint: 0.9 });
  for (const z of [-3.3, 0.0, 3.3]) c.quadAt('decal', 'streak' + (z > 0 ? 1 : 0), xf - 0.006, 5.2, z, -1, 0, 0, 0.7, 2.4, { tint: 0.9 });
  // vent + conduits above
  c.mb('dark').box(xf - 0.12, 5.7, -3.0, xf, 6.5, -1.2, { c: [0.3, 0.3, 0.32], skip: 'px' }); for (let i = 0; i < 8; i++) c.mb('steel').box(xf - 0.13, 5.76 + i * 0.09, -2.98, xf - 0.11, 5.79 + i * 0.09, -1.22, { c: [0.6, 0.6, 0.64] });
}

// ---------------------------------------------------------------------------------------------------------- tunnel-mouth abutments
function abutments(c) {
  for (const e of [1, -1]) for (const s of [1, -1]) {
    const xa = e > 0 ? 30.8 : -32, xb = e > 0 ? 32 : -30.8, za = s > 0 ? 4.0 : -4.99, zb = s > 0 ? 4.99 : -4.0; // (4.99 / -4.99: the pit-side face was exactly on the platform edge plane z = +-5 = z-fighting)
    c.mb('concrete').box(xa, -1.25, za, xb, 1.1, zb, { c: [0.65, 0.7, 0.75], seg: 1.2, skip: 'ny', f: grimeF({ floorY: -1.25, dirt: 0.5, seed: e * 3 + s, low: 0.3, hi: 0 }) });
    const face = e > 0 ? xa : xb; // face towards the platform (the hazard bands below sit 12 mm off the concrete: at 4 mm they z-fought from the far end of the platform, where one depth step is ~4 mm)
    c.mb('hazard').grid(face + (e > 0 ? -0.012 : 0.012), 0.75, za, 0, 0, zb - za, 0, 0.3, 0, 1, 1, -e, 0, 0, { c: W3, uv: (x, y, z) => [z / 0.5, y / 0.5] });
    c.mb('hazard').grid(xa, 0.75, s > 0 ? zb + 0.012 : za - 0.012, xb - xa, 0, 0, 0, 0.3, 0, 1, 1, 0, 0, s, { c: W3, uv: (x, y, z) => [x / 0.5, y / 0.5] });
    c.mb('hazard').grid(xa, 1.112, za, xb - xa, 0, 0, 0, 0, zb - za, 1, 1, 0, 1, 0, { c: W3 });
    // chain posts
    const cx = (xa + xb) / 2;
    c.mb('yellow').cyl(face - e * 0.1, 1.1, (za + zb) / 2, face - e * 0.1, 1.4, (za + zb) / 2, 0.03, { segs: 6, c: W3 });
    c.quadAt('paper', 'n_danger', face - e * 0.006, 0.55, (za + zb) / 2, -e, 0, 0, 0.3, 0.37, { tint: 0.9 });
  }
}
