// Procedural low-poly pickup models. Every model is ONE merged BufferGeometry with vertex colours (`color`) and a per-vertex
// emissive strength (`aEmit`) so a single shared material renders all of them (see pickups.js). Units while modelling are "cm-ish";
// the finished geometry is centred and normalised so its largest dimension equals `size` metres.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../texutil.js';

const C = {
  steel: 0x7f8b99, steelDk: 0x4a525c, steelLt: 0xb4bfcb, gun: 0x363d46, black: 0x1c2026, brass: 0xd6a94e, copper: 0xb4642f,
  wood: 0x8a5528, woodDk: 0x51301a, red: 0xc72d20, redDk: 0x7e1a14, olive: 0x5b6d3d, oliveDk: 0x3b472b, orange: 0xef7b1f,
  yellow: 0xf4c81a, white: 0xe9ecef, grey: 0xaeb4bb, cyan: 0x3ff2ff, blue: 0x2f6cff, green: 0x63ff4d, leather: 0x6e5240, teal: 0x1d8f86,
  bone: 0xd8cfae,
};

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();

class Builder {
  constructor(seed = 1) { this.geos = []; this.rnd = mulberry32(seed); }
  // generic: geometry already built about the origin; o: {rx,ry,rz (rad), ax:'x'|'z' (align cylinder axis), sx,sy,sz, emit, jitter}
  add(g, x, y, z, col, o = {}) {
    g.deleteAttribute('uv');
    if (o.ax === 'x') g.rotateZ(-Math.PI / 2); else if (o.ax === 'z') g.rotateX(Math.PI / 2);
    if (o.sx || o.sy || o.sz) g.scale(o.sx || 1, o.sy || 1, o.sz || 1);
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ'); _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1)); g.applyMatrix4(_m);
    const n = g.attributes.position.count, colors = new Float32Array(n * 3), emit = new Float32Array(n);
    _c.set(col); const j = 1 + (this.rnd() - 0.5) * (o.jitter ?? 0.1);
    for (let i = 0; i < n; i++) { colors[i * 3] = Math.min(1.6, _c.r * j); colors[i * 3 + 1] = Math.min(1.6, _c.g * j); colors[i * 3 + 2] = Math.min(1.6, _c.b * j); emit[i] = o.emit || 0; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); g.setAttribute('aEmit', new THREE.BufferAttribute(emit, 1));
    this.geos.push(g); return this;
  }
  box(w, h, d, x, y, z, col, o) { return this.add(new THREE.BoxGeometry(w, h, d), x, y, z, col, o); }
  // cylinder: radius r (rTop optional taper: top = +Y / +X / +Z depending on ax), length h
  cyl(r, h, x, y, z, col, o = {}) { return this.add(new THREE.CylinderGeometry(o.rt ?? r, r, h, o.seg || 12, 1, o.open === true), x, y, z, col, o); }
  sph(r, x, y, z, col, o = {}) { return this.add(new THREE.SphereGeometry(r, o.seg || 12, o.seg ? Math.ceil(o.seg / 1.5) : 8), x, y, z, col, o); }
  tor(R, r, x, y, z, col, o = {}) { return this.add(new THREE.TorusGeometry(R, r, 6, o.seg || 16), x, y, z, col, o); }
  // Bake a cheap ambient-occlusion-ish gradient, centre + normalise, and merge.
  build(size) {
    const g = mergeGeometries(this.geos, false);
    this.geos.forEach((x) => x.dispose());
    g.computeBoundingBox();
    const bb = g.boundingBox, c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    const k = size / Math.max(sz.x, sz.y, sz.z);
    g.translate(-c.x, -c.y, -c.z); g.scale(k, k, k);
    const pos = g.attributes.position, col = g.attributes.color, h = sz.y * k;
    for (let i = 0; i < pos.count; i++) {
      const t = clamp01((pos.getY(i) + h / 2) / (h || 1)), f = 0.74 + 0.26 * t;
      col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
    }
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ---------------------------------------------------------------------------------------------
// Health / armour
// ---------------------------------------------------------------------------------------------
function health() { // stimpack: white hard case, red cross, glowing green syringe
  const b = new Builder(3);
  b.box(30, 13, 20, 0, 0, 0, C.white);
  b.box(30.8, 2.2, 20.8, 0, -5.2, 0, C.grey); b.box(30.8, 2.2, 20.8, 0, 5.2, 0, C.grey);
  for (const s of [1, -1]) {
    b.box(13, 3.8, 0.9, 0, 0, s * 10.3, C.red, { emit: 0.55 }); b.box(3.8, 13, 0.9, 0, 0, s * 10.3, C.red, { emit: 0.55 });
  }
  b.box(2, 4, 3, 10, 1, 10.6, C.steelLt); b.box(2, 4, 3, -10, 1, 10.6, C.steelLt); // latches
  // syringe lying on top
  b.cyl(3.1, 24, 0, 11.6, 0, C.green, { ax: 'x', emit: 1.15 });            // glowing barrel
  b.cyl(3.4, 1.6, -11.6, 11.6, 0, C.white, { ax: 'x' }); b.cyl(3.4, 1.6, 11.6, 11.6, 0, C.white, { ax: 'x' }); // collars
  b.cyl(1.3, 8, -16, 11.6, 0, C.white, { ax: 'x' }); b.cyl(4.4, 1.2, -20.4, 11.6, 0, C.grey, { ax: 'x' });     // plunger
  b.cyl(2.3, 3, 14, 11.6, 0, C.steelLt, { ax: 'x' }); b.cyl(0.9, 14, 22.5, 11.6, 0, C.steelLt, { ax: 'x', rt: 0.25 }); // hub + needle
  b.box(2.2, 1.4, 8, -4, 8.3, 0, C.steelDk); b.box(2.2, 1.4, 8, 5, 8.3, 0, C.steelDk); // syringe cradle
  return b.build(0.52);
}

function medkit() { // red first-aid case, white cross, handle, latches, green status lights
  const b = new Builder(5);
  b.box(46, 21, 27, 0, -3.5, 0, C.red); b.box(46.4, 9, 27.4, 0, 11.3, 0, C.red);
  b.box(46.8, 1.2, 27.8, 0, 6.6, 0, C.redDk);                                   // seam
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { b.box(4, 30, 4, sx * 22.5, 3.5, sz * 12.8, C.black); }
  b.box(46.6, 3, 3, 0, -13.5, 12.8, C.black); b.box(46.6, 3, 3, 0, -13.5, -12.8, C.black);
  for (const s of [1, -1]) {
    b.box(22, 6.4, 1, 0, 1.5, s * 13.8, C.white, { emit: 0.7 }); b.box(6.4, 22, 1, 0, 1.5, s * 13.8, C.white, { emit: 0.7 });
    for (let i = -1; i <= 1; i++) b.box(3, 1.8, 0.8, i * 5, -10.5, s * 13.8, C.green, { emit: 1.2 });
  }
  b.box(4, 11, 2, -18, 6.6, 13.9, C.steelLt); b.box(4, 11, 2, 18, 6.6, 13.9, C.steelLt);
  b.box(2, 3, 1, -18, 6.6, 15, C.steelDk); b.box(2, 3, 1, 18, 6.6, 15, C.steelDk);
  // carry handle
  b.box(3, 8, 4, -11, 19.5, 0, C.black); b.box(3, 8, 4, 11, 19.5, 0, C.black);
  b.cyl(2.3, 26, 0, 24, 0, C.black, { ax: 'x' }); b.cyl(2.6, 15, 0, 24, 0, C.grey, { ax: 'x', seg: 10 });
  for (const s of [-1, 1]) b.cyl(1.6, 0.5, s * 22.5, 4.5, 0, C.steelLt, { ax: 'x' }); // side rivets
  return b.build(0.72);
}

function armor() { // plate carrier vest with glowing shield emblem
  const b = new Builder(7);
  b.box(36, 42, 3.4, 0, 0, 3.3, C.olive); b.box(36, 42, 3.4, 0, 0, -3.3, C.oliveDk);        // front/back panels
  b.box(9, 6, 16, -11, 21.5, -0.5, C.olive, { rx: -0.45 }); b.box(9, 6, 16, 11, 21.5, -0.5, C.olive, { rx: -0.45 }); // shoulder straps
  b.box(9.6, 1.2, 16.4, -11, 24.3, -0.5, C.black, { rx: -0.45 }); b.box(9.6, 1.2, 16.4, 11, 24.3, -0.5, C.black, { rx: -0.45 });
  b.box(20, 3, 6, 0, 22, -1, C.black);                                                       // neck yoke
  for (const s of [-1, 1]) { b.box(5, 20, 11, s * 19.5, -8, 0, C.black); b.box(3, 14, 12, s * 21.5, -8, 0, C.oliveDk); } // side cummerbund
  b.box(26, 30, 2.2, 0, 3, 5.6, C.steelDk); b.box(24, 28, 1.4, 0, 3, 6.9, C.steel);          // ceramic plate
  b.box(24.2, 1.2, 1.5, 0, 16.5, 7.1, C.black); b.box(24.2, 1.2, 1.5, 0, -10.5, 7.1, C.black);
  // emblem: glowing chevron shield
  b.tor(9.5, 1.5, 0, 3, 7.6, C.cyan, { seg: 6, emit: 1.2, rz: Math.PI / 6 });
  b.box(9, 2.2, 0.9, -3.6, 4.2, 7.9, C.cyan, { emit: 1.2, rz: 0.7 }); b.box(9, 2.2, 0.9, 3.6, 4.2, 7.9, C.cyan, { emit: 1.2, rz: -0.7 });
  b.box(2.2, 6, 0.9, 0, 0.2, 7.9, C.cyan, { emit: 1.2 });
  // webbing rows + mag pouches
  for (let i = 0; i < 3; i++) b.box(34, 1.1, 0.6, 0, 19.2 - i * 1.7, 5.2, C.black);
  for (const x of [-10, 0, 10]) { b.box(8, 10, 4.4, x, -15, 7, C.oliveDk); b.box(8.4, 4, 4.9, x, -11.4, 7, C.olive); b.box(1.6, 1.6, 0.8, x, -11.4, 9.6, C.yellow, { emit: 0.3 }); }
  b.box(32, 1, 0.6, 0, -19.4, 5.6, C.cyan, { emit: 1.0 });                                   // edge light strip
  b.box(6, 8, 3, -20, 6, 6.5, C.oliveDk); b.box(6, 8, 3, 20, 6, 6.5, C.oliveDk);             // radio pouches
  return b.build(0.78);
}

// ---------------------------------------------------------------------------------------------
// Ammo
// ---------------------------------------------------------------------------------------------
function bullets() { // olive ammo crate with brass cartridges standing in rows
  const b = new Builder(11);
  b.box(44, 13, 26, 0, -6, 0, C.oliveDk); b.box(46, 2.4, 28, 0, 1.4, 0, C.olive);         // crate + rim
  b.box(44.4, 1.4, 4, 0, -9.5, 12, C.black); b.box(44.4, 1.4, 4, 0, -9.5, -12, C.black);
  for (let i = 0; i < 3; i++) b.box(7, 2, 0.5, -12 + i * 12, -5, 13.2, C.yellow, { emit: 0.35 }); // stencil
  b.box(2.5, 7, 0.8, -19, -4.5, 13.3, C.steelLt); b.box(2.5, 7, 0.8, 19, -4.5, 13.3, C.steelLt);
  for (let ix = 0; ix < 6; ix++) for (let iz = 0; iz < 3; iz++) {
    const x = -17.5 + ix * 7, z = -8 + iz * 8;
    b.cyl(2.5, 9, x, 7, z, C.brass, { emit: 0.28, seg: 8 });
    b.cyl(2.5, 1.2, x, 2.2, z, C.copper, { seg: 8 });
    b.cyl(2.15, 5.2, x, 13.4, z, C.copper, { rt: 0.5, seg: 8, emit: 0.2 });
  }
  b.cyl(2.5, 8, 0, 4.5, 15.5, C.brass, { ax: 'x', emit: 0.28, seg: 8, rx: 0 });             // loose rounds on the lip
  return b.build(0.64);
}

function shells() { // red cardboard shell box, rows of red 12-gauge shells with brass heads
  const b = new Builder(13);
  b.box(36, 9, 20, 0, -5, 0, C.redDk); b.box(36.8, 1.6, 20.8, 0, -0.6, 0, C.red);
  b.box(14, 4.4, 0.6, 0, -4.6, 10.4, C.yellow, { emit: 0.4 }); b.cyl(1.4, 0.6, -3, -4.6, 10.8, C.black, { ax: 'z', seg: 8 }); b.box(6, 1.2, 0.6, 3, -4.6, 10.9, C.black);
  b.box(14, 4.4, 0.6, 0, -4.6, -10.4, C.yellow, { emit: 0.4 });
  for (let ix = 0; ix < 5; ix++) for (let iz = 0; iz < 2; iz++) {
    const x = -14.5 + ix * 7.2, z = -5 + iz * 10;
    b.cyl(3, 13, x, 7.2, z, C.red, { seg: 10, emit: 0.22 });
    b.cyl(3.15, 3.6, x, 1.6, z, C.brass, { seg: 10, emit: 0.3 });
    b.cyl(2.5, 1.2, x, 14.4, z, C.redDk, { seg: 10 });
    b.cyl(3.16, 0.6, x, 3.5, z, C.steelLt, { seg: 10 });
  }
  return b.build(0.6);
}

function rockets() { // wooden rack with three rockets: olive body, red-orange warhead, fins
  const b = new Builder(17);
  const rocket = (x, y, z) => {
    b.cyl(5, 34, x, y, z, C.oliveDk, { ax: 'x', seg: 12 });
    b.cyl(5.1, 3.4, x - 4, y, z, C.yellow, { ax: 'x', seg: 12, emit: 0.25 }); b.cyl(5.1, 1.6, x + 6, y, z, C.black, { ax: 'x', seg: 12 });
    b.cyl(5, 12, x + 23, y, z, C.red, { ax: 'x', rt: 0.4, seg: 12, emit: 0.55 });             // warhead
    b.sph(0.9, x + 29.4, y, z, C.orange, { emit: 1.0, seg: 6 });
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; b.box(9, 6.4, 0.9, x - 14, y + Math.sin(a) * 5, z + Math.cos(a) * 5, C.steelDk, { rx: -a + Math.PI / 2 }); }
    b.cyl(3.4, 3, x - 18, y, z, C.steelDk, { ax: 'x', seg: 8, rt: 4.4 }); b.cyl(2.4, 0.6, x - 19.6, y, z, C.orange, { ax: 'x', seg: 8, emit: 1.0 });
  };
  rocket(0, 0, -6); rocket(0, 0, 6); rocket(0, 9.6, 0);
  for (const x of [-8, 12]) { b.box(3, 5, 30, x, -6.6, 0, C.wood); b.box(3.4, 1.2, 30.4, x, -4.2, 0, C.woodDk); b.box(2.6, 22, 2, x, 1.5, -13.6, C.woodDk); b.box(2.6, 22, 2, x, 1.5, 13.6, C.woodDk); }
  b.box(1.2, 1.6, 33, -8, 6.2, 0, C.black); b.box(1.2, 1.6, 33, 12, 6.2, 0, C.black); // straps
  b.box(1.2, 1.6, 33, -8, -2.2, 0, C.black); b.box(1.2, 1.6, 33, 12, -2.2, 0, C.black);
  return b.build(0.84);
}

function cells() { // cyan plasma cell pack in a black frame
  const b = new Builder(19);
  b.box(42, 4, 24, 0, -9.5, 0, C.gun); b.box(42, 3, 24, 0, 9.5, 0, C.gun);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(3, 16, 3, sx * 19.5, 0, sz * 10.5, C.steelDk);
  for (let i = -1; i <= 1; i++) {
    b.cyl(5.6, 15, i * 12.5, 0, 0, C.cyan, { emit: 1.35, seg: 14 });
    b.cyl(6.1, 1.2, i * 12.5, 6.2, 0, C.steelLt, { seg: 14 }); b.cyl(6.1, 1.2, i * 12.5, -6.2, 0, C.steelLt, { seg: 14 });
    b.cyl(2, 3, i * 12.5, 12.4, 0, C.steelLt, { seg: 8 }); b.cyl(2.8, 0.8, i * 12.5, 14, 0, C.brass, { seg: 8 });
    b.cyl(2.4, 7.5, i * 12.5, 0, 0, C.white, { emit: 1.0, seg: 8 });                       // white-hot core
  }
  b.box(15, 3.6, 0.8, 0, -9.5, 12.4, C.yellow, { emit: 0.4 }); b.box(3, 3.6, 0.9, -3, -9.5, 12.5, C.black, { rz: 0.5 }); b.box(3, 3.6, 0.9, 3, -9.5, 12.5, C.black, { rz: 0.5 });
  b.box(42.4, 1, 24.4, 0, -6.5, 0, C.cyan, { emit: 0.9 });                                  // glow seam
  b.cyl(1.6, 20, 0, 13.4, 0, C.steelLt, { ax: 'x', seg: 8 });                              // carry bar
  b.box(2, 4, 2, -10, 11.8, 0, C.steelDk); b.box(2, 4, 2, 10, 11.8, 0, C.steelDk);
  return b.build(0.64);
}

// ---------------------------------------------------------------------------------------------
// Weapons (barrel along +X, up = +Y). Miniature but recognisable Doom II silhouettes.
// ---------------------------------------------------------------------------------------------
function fist() { // clenched leather glove wearing spiked brass knuckles
  const b = new Builder(23);
  b.box(22, 17, 36, 0, 0, 0, C.leather, { jitter: 0.06 });                                   // palm / back of hand
  b.box(22.4, 3, 36.4, 0, 6.6, 0, 0x5a4232);                                                   // padded back
  for (let i = 0; i < 4; i++) {
    const z = -13.5 + i * 9;
    b.cyl(4.5, 13, 16, 2, z, C.leather, { ax: 'x', seg: 10 });                                  // proximal phalanx
    b.sph(4.7, 22.5, 2, z, C.leather, { seg: 10 });                                             // knuckle
    b.cyl(4.2, 10, 23.4, -3.5, z, C.leather, { seg: 10 });                                      // curled middle phalanx
    b.sph(4.2, 21.4, -8.6, z, C.leather, { seg: 10 });                                          // fingertip
    b.tor(5.4, 1.5, 15.5, 2, z, C.brass, { ry: Math.PI / 2, seg: 12, emit: 0.2 });               // brass finger ring
    b.cyl(2.6, 7, 27.6, 5.2, z, C.steelLt, { ax: 'x', rt: 0.15, seg: 6, emit: 0.1 });            // spike
  }
  b.box(6, 4.2, 40, 24.6, 5.4, 0, C.brass, { emit: 0.2 });                                      // knuckle bar
  b.cyl(4.6, 22, 24.5, -3.4, 0, C.leather, { ax: 'z', seg: 10, rx: 0 });                        // thumb across the fingers
  b.sph(4.7, 24.5, -3.4, -11.6, C.leather, { seg: 10 });
  b.cyl(14, 16, -19, 0, 0, 0x4d3a2e, { ax: 'x', seg: 14 });                                     // cuff
  b.cyl(14.6, 2.4, -11.8, 0, 0, C.brass, { ax: 'x', seg: 14, emit: 0.15 }); b.cyl(14.6, 2.4, -26, 0, 0, C.brass, { ax: 'x', seg: 14, emit: 0.15 });
  b.box(2, 9, 8, -27.5, 0, 0, C.brass);
  b.sph(3.6, 4, 9.6, 0, C.red, { emit: 1.1, seg: 8 }); b.tor(4.4, 1.1, 4, 9.6, 0, C.brass, { rx: Math.PI / 2, seg: 10 }); // red rune gem
  return b.build(0.66);
}

function chainsaw() { // orange body, black handles, bar with a row of chain teeth, blood
  const b = new Builder(29);
  b.box(36, 27, 20, -6, 3, 0, C.orange); b.box(30, 8, 16, -8, 18, 0, C.black);            // engine housing + top cover
  for (let i = 0; i < 5; i++) b.box(1.4, 6, 14, -20 + i * 5, 21.5, 0, C.gun);              // cooling fins
  b.box(6, 12, 22, 12, 6, 0, C.red);                                                       // front hand-guard base
  b.box(3, 16, 22, 15.5, 16, 0, C.yellow, { rz: -0.3, emit: 0.2 });                        // guard
  // top handle loop
  b.box(4, 16, 5, -26, 27, -7, C.black); b.box(4, 16, 5, 6, 30, -7, C.black); b.box(34, 4.4, 5, -10, 35, -7, C.black);
  b.box(4, 14, 5, -26, 27, 7, C.black); b.box(4, 14, 5, 6, 30, 7, C.black); b.box(34, 4.4, 5, -10, 35, 7, C.black);
  b.box(34, 4, 16, -10, 36, 0, C.black);
  // rear grip + trigger
  b.box(12, 7, 9, -30, -6, 0, C.black, { rz: 0.35 }); b.box(6, 22, 9, -36, -12, 0, C.black, { rz: -0.2 });
  b.box(3, 8, 2.4, -30, -14, 0, C.red);
  // bar + chain
  b.box(62, 10, 3.4, 46, 2, 0, C.steelLt);
  b.box(54, 4.4, 3.8, 46, 2, 0, C.steelDk);
  b.cyl(5, 3.4, 77, 2, 0, C.steelLt, { ax: 'z', seg: 10 }); b.cyl(3, 3.8, 77, 2, 0, C.steelDk, { ax: 'z', seg: 10 });
  for (let i = 0; i < 15; i++) {
    const x = 20 + i * 4.3;
    b.box(2.4, 3.6, 5.6, x, 8.4, 0, C.steelDk, { jitter: 0.25 }); b.box(2.4, 3.6, 5.6, x + 2.1, -4.4, 0, C.steelDk, { jitter: 0.25 });
  }
  for (let i = 0; i < 3; i++) { b.sph(2.4, 30 + i * 12, 2, 2.2 + i * 0.5, C.redDk, { seg: 6, sy: 0.5, sz: 0.4 }); }   // blood
  b.box(9, 1.2, 3.6, 62, 8.8, 0, C.red, { jitter: 0.3 });
  // pull-start + exhaust
  b.cyl(7, 4, -14, 2, 11.5, C.black, { ax: 'z', seg: 12 }); b.cyl(3, 4.6, -14, 2, 12.2, C.red, { ax: 'z', seg: 8 }); b.tor(4, 0.7, -14, 2, 13.6, C.steelLt, { seg: 8 });
  b.cyl(3.4, 6, -20, 6, -12, C.steelDk, { ax: 'z', seg: 8 }); b.cyl(4.6, 2.6, -8, 8, -11, C.red, { ax: 'z', seg: 10 }); // exhaust + fuel cap
  return b.build(1.0);
}

function pistol() { // 9mm slide-and-frame handgun with wooden grips
  const b = new Builder(31);
  b.box(60, 13, 11, 3, 13, 0, C.steelDk);                                                     // slide
  b.box(60.6, 2, 8.4, 3, 20, 0, C.gun);                                                        // slide top
  for (let i = 0; i < 5; i++) b.box(1.2, 11, 11.6, -22 + i * 2.4, 13, 0, C.black);            // serrations
  b.box(2.4, 3.4, 3, 33, 22, 0, C.steelLt); b.box(3.4, 3.4, 8, -25, 22, 0, C.steelLt);         // sights
  b.box(2.2, 2.2, 1.6, -25, 22.2, 0, C.black, { emit: 0 }); b.sph(0.9, 33, 24, 0, C.white, { emit: 0.9, seg: 6 }); // sight dot
  b.cyl(3.4, 8, 35, 13.5, 0, C.steelLt, { ax: 'x', seg: 10 }); b.cyl(1.6, 1, 39.3, 13.5, 0, C.black, { ax: 'x', seg: 8 });
  b.box(50, 6.4, 9.6, 0, 5.4, 0, C.gun);                                                        // frame
  b.box(16, 2, 9.2, 12, 1, 0, C.gun);
  b.box(15, 32, 10.6, -14, -11, 0, C.gun, { rz: 0.22 });                                        // grip
  b.box(1.6, 27, 11.6, -14 + 4.2, -10.6, 0, C.woodDk, { rz: 0.22, sz: 0.001 });               // (thin spacer, mostly hidden)
  for (const z of [-5.6, 5.6]) { b.box(13.6, 27, 1.6, -14, -10, z, C.wood, { rz: 0.22, emit: 0.06 }); b.tor(2, 0.4, -14, -3, z + Math.sign(z) * 0.7, C.brass, { seg: 8 }); }
  b.box(18, 3, 11.2, -19, -27.6, 0, C.steelDk, { rz: 0.22 });                                   // magazine base
  b.box(2, 8, 3.4, 5, -1.5, 0, C.black);                                                       // trigger
  b.box(2, 9, 3, 16.5, -1.5, 0, C.gun); b.box(18, 2, 3, 8, -6, 0, C.gun);                       // trigger guard
  b.box(4, 5, 3, -26, 20.5, 0, C.black, { rz: -0.5 });                                          // hammer
  b.box(14, 4, 0.8, 2, 14, 5.8, C.black); b.box(9, 3, 0.6, -1, 15, 5.9, C.brass, { emit: 0.15 }); // ejection port + case
  return b.build(0.66);
}

function shotgun() { // pump-action: long barrel, tube magazine, wooden pump + stock
  const b = new Builder(37);
  b.cyl(3.3, 74, 32, 9, 0, C.steelDk, { ax: 'x', seg: 12 });                                    // barrel
  b.cyl(3.7, 60, 28, 2, 0, C.steel, { ax: 'x', seg: 12 });                                      // magazine tube
  b.cyl(4.2, 2, 58.5, 2, 0, C.steelLt, { ax: 'x', seg: 12 });                                    // tube cap
  b.box(72, 1.4, 2.2, 32, 13, 0, C.black);                                                       // rib
  b.cyl(1, 3, 66, 14, 0, C.brass, { seg: 6, emit: 0.35 });                                       // bead
  b.box(36, 15, 11, -9, 6, 0, C.steelDk); b.box(36, 2, 8.4, -9, 14.4, 0, C.gun);                 // receiver
  b.box(10, 5, 1.4, -6, 5, 5.9, C.black); b.box(9, 3, 0.8, -6, 4.6, 6.3, C.brass, { emit: 0.15 }); // ejection port
  b.cyl(5.6, 26, 21, 1.5, 0, C.wood, { ax: 'x', seg: 10, emit: 0.05 });                           // pump forend
  for (let i = 0; i < 5; i++) b.cyl(5.75, 1.1, 12 + i * 4.6, 1.5, 0, C.woodDk, { ax: 'x', seg: 10 });
  b.box(40, 13, 8.6, -40, 3, 0, C.wood, { rz: -0.14, emit: 0.05 });                              // stock
  b.box(12, 20, 8.6, -60, -1, 0, C.wood, { rz: -0.14 }); b.box(3, 24, 9.4, -66, -1.6, 0, C.black, { rz: -0.14 }); // butt + pad
  b.box(10, 19, 8, -23, -8, 0, C.wood, { rz: 0.3 });                                             // pistol grip
  b.box(2, 8, 3, -14, -2, 0, C.black); b.box(2, 9, 3, -4, -2, 0, C.gun); b.box(16, 2, 3, -9, -7, 0, C.gun); // trigger + guard
  b.cyl(1.4, 1.2, -30, 4, 6.4, C.brass, { ax: 'z', seg: 8 }); b.cyl(1.4, 1.2, 10, 4, -6.4, C.steelLt, { ax: 'z', seg: 8 });
  b.cyl(2.5, 9, -1, -1.4, 0, C.red, { ax: 'x', seg: 8, emit: 0.3 }); b.cyl(2.6, 2.4, -5.3, -1.4, 0, C.brass, { ax: 'x', seg: 8, emit: 0.3 }); // shell in the loading gate
  return b.build(1.08);
}

function ssg() { // double-barrel break-action: side-by-side barrels, brass hinge, walnut furniture
  const b = new Builder(41);
  for (const z of [-3.6, 3.6]) {
    b.cyl(3.4, 64, 30, 8, z, C.steelDk, { ax: 'x', seg: 12 }); b.cyl(2.3, 0.8, 62.2, 8, z, C.black, { ax: 'x', seg: 10 }); b.cyl(3.7, 1.6, 61, 8, z, C.steel, { ax: 'x', seg: 12 });
  }
  b.box(64, 1.2, 4, 30, 12.6, 0, C.black); b.box(64, 1.2, 6, 30, 3.4, 0, C.gun);               // ribs
  b.sph(1.1, 62, 13.6, 0, C.brass, { emit: 0.5, seg: 6 });
  b.box(28, 17, 15, -8, 4, 0, C.steel);                                                         // action
  b.cyl(4, 17, -3, -1, 0, C.brass, { ax: 'z', seg: 12, emit: 0.18 });                          // hinge pin
  b.box(22, 1.2, 12, -6, 12.8, 0, C.brass, { emit: 0.15 });                                     // engraved plate
  b.box(3, 5, 9, -14, 14, 0, C.black, { rz: 0.4 });                                             // top lever
  b.box(30, 8, 12, 24, -3.2, 0, C.woodDk, { emit: 0.05 });                                      // forend
  b.box(4, 10, 12.4, 10, -1.8, 0, C.steelDk);
  b.box(42, 14, 9, -40, 3, 0, C.wood, { rz: -0.16, emit: 0.05 });                               // stock
  b.box(14, 22, 9, -62, -2, 0, C.wood, { rz: -0.16 }); b.box(3, 26, 9.6, -69, -2.6, 0, C.black, { rz: -0.16 });
  b.box(9, 19, 8, -22, -10, 0, C.wood, { rz: 0.32 });
  b.box(2, 7, 3, -10, -3, -1.6, C.black); b.box(2, 7, 3, -10, -3, 1.6, C.black); b.box(18, 2, 5, -6, -7.6, 0, C.gun); b.box(2, 7, 5, 3, -4.6, 0, C.gun); // triggers + guard
  b.box(4, 3, 4, -22, 13.4, -2, C.gun); b.box(4, 3, 4, -22, 13.4, 2, C.gun);                   // hammers
  return b.build(1.08);
}

function chaingun() { // six-barrel rotary cluster, gearbox, ammo drum with belt
  const b = new Builder(43);
  b.cyl(3.2, 64, 30, 8, 0, C.steelDk, { ax: 'x', seg: 10 });                                    // central spindle
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, y = 8 + Math.sin(a) * 6.6, z = Math.cos(a) * 6.6; b.cyl(2.2, 62, 31, y, z, C.steel, { ax: 'x', seg: 8 }); b.cyl(1.2, 0.8, 62.2, y, z, C.black, { ax: 'x', seg: 6 }); b.cyl(2.7, 3, 60, y, z, C.steelLt, { ax: 'x', seg: 8 }); }
  for (const x of [58, 38, 14]) b.cyl(9.6, 3, x, 8, 0, C.gun, { ax: 'x', seg: 14 });
  b.cyl(10.4, 4, 62, 8, 0, C.steelDk, { ax: 'x', seg: 14 });
  b.box(30, 22, 22, -8, 7, 0, C.gun); b.box(26, 2.4, 18, -8, 19.2, 0, C.steelDk);              // gearbox
  for (let i = 0; i < 4; i++) b.box(1.6, 12, 22.6, -18 + i * 6, 5, 0, C.black);
  b.box(10, 2.4, 22.8, -2, 10, 0, C.orange, { emit: 0.9 });                                     // glowing heat vent
  b.cyl(8, 24, -32, 8, 0, C.steel, { ax: 'x', seg: 12 }); b.cyl(8.6, 3, -22, 8, 0, C.steelDk, { ax: 'x', seg: 12 }); // motor
  b.cyl(13, 15, -13, -19, 0, C.olive, { ax: 'z', seg: 14 }); b.cyl(13.4, 2, -13, -19, 8, C.oliveDk, { ax: 'z', seg: 14 }); b.cyl(13.4, 2, -13, -19, -8, C.oliveDk, { ax: 'z', seg: 14 });
  for (let i = 0; i < 6; i++) { const a = -0.3 + i * 0.28; b.box(4, 2.4, 6, -13 + Math.sin(a) * 15.5, -19 + Math.cos(a) * 15.5, 0, C.brass, { rz: -a, emit: 0.3 }); } // belt
  for (let i = 0; i < 5; i++) b.box(3.4, 2.2, 5, -13 + 3 + i * 0.9, -8 + i * 4.6 - 0.2, 0, C.brass, { emit: 0.3, rz: -0.1 });
  b.box(2, 12, 4, -2, 27, -7, C.black); b.box(2, 12, 4, -2, 27, 7, C.black); b.box(3, 3.4, 20, -2, 33.5, 0, C.black); b.cyl(2, 14, -2, 33.5, 0, C.grey, { ax: 'z', seg: 8 }); // carry handle
  b.box(9, 22, 8, -40, -6, 0, C.black, { rz: 0.18 }); b.box(3, 8, 3, -34, 2, 0, C.gun);        // rear grip
  b.box(8, 18, 8, 16, -11, 0, C.black, { rz: -0.14 });                                          // front grip
  b.box(3, 24, 26, -50, 6, 0, C.steelDk);                                                       // shoulder plate
  return b.build(1.12);
}

function rocket() { // launcher tube: flared muzzle with a live warhead, exhaust bell, optic, grips
  const b = new Builder(47);
  b.cyl(9, 84, 0, 8, 0, C.oliveDk, { ax: 'x', seg: 16 });                                       // main tube
  for (const x of [-30, -8, 16]) b.cyl(9.5, 3.2, x, 8, 0, C.black, { ax: 'x', seg: 16 });
  b.cyl(9.6, 4.4, 30, 8, 0, C.yellow, { ax: 'x', seg: 16, emit: 0.2 }); b.cyl(9.6, 4.4, 38, 8, 0, C.black, { ax: 'x', seg: 16 });
  b.cyl(9, 16, 50, 8, 0, C.steelDk, { ax: 'x', seg: 16, rt: 13.2 });                            // muzzle flare
  b.cyl(9.6, 1.4, 58.6, 8, 0, C.steel, { ax: 'x', seg: 16, rt: 13.7 });
  b.cyl(11, 1, 58, 8, 0, C.black, { ax: 'x', seg: 16 });
  b.cyl(5.2, 12, 55, 8, 0, C.red, { ax: 'x', seg: 12, rt: 0.5, emit: 0.7 }); b.sph(1.1, 61.3, 8, 0, C.orange, { emit: 1.4, seg: 6 }); // visible warhead
  b.cyl(12, 12, -50, 8, 0, C.steelDk, { ax: 'x', seg: 16, rt: 9 });                              // exhaust bell (wide end at -X)
  b.cyl(9, 0.8, -56.4, 8, 0, C.orange, { ax: 'x', seg: 16, emit: 0.7 });
  b.box(16, 6, 6, 10, 19, 0, C.gun); b.cyl(2.6, 10, 15, 22.5, 0, C.black, { ax: 'x', seg: 8 }); b.cyl(1.9, 0.8, 20.4, 22.5, 0, C.cyan, { ax: 'x', seg: 8, emit: 1.0 }); // optic
  b.box(1, 9, 1.4, -30, 17.5, 0, C.steelLt); b.box(2, 3, 6, 40, 17.8, 0, C.black);             // iron sights
  b.box(10, 20, 8, -12, -8, 0, C.black, { rz: 0.28 }); b.box(3, 8, 3, -6, -3, 0, C.gun); b.box(10, 2, 3, -6, -6, 0, C.gun);    // rear grip
  b.box(9, 15, 8, 16, -6, 0, C.black, { rz: -0.12 });                                           // fore grip
  b.box(16, 10, 15, -34, -2, 0, C.black, { rz: 0.1 }); b.box(3, 12, 16, -42, -1, 0, C.steelDk); // shoulder rest
  b.sph(1.4, -21, 17, 5, C.green, { emit: 1.4, seg: 6 });                                        // "armed" LED
  b.box(6, 4, 0.8, 26, 8, 9.3, C.red, { emit: 0.25 }); b.box(3, 6, 0.8, -22, 8, 9.3, C.yellow, { emit: 0.25 }); // stencil marks
  return b.build(1.14);
}

function plasma() { // sleek plasma rifle: glowing coil, finned emitter, energy magazine
  const b = new Builder(53);
  b.box(50, 15, 13, -4, 6, 0, C.steelLt); b.box(46, 4, 11, -4, 14.6, 0, C.steelDk);            // body
  b.box(30, 1, 13.6, -6, 6, 0, C.blue, { emit: 0.9 });                                          // side light strip
  b.cyl(4.4, 48, -2, 19, 0, C.cyan, { ax: 'x', seg: 12, emit: 1.35 });                          // energy coil core
  for (let i = 0; i < 6; i++) b.tor(6.2, 1.1, -22 + i * 8, 19, 0, C.steelDk, { ry: Math.PI / 2, seg: 14 });
  for (const z of [-6.4, 6.4]) b.box(50, 2, 1.6, -2, 19, z, C.steelDk);
  b.cyl(4.2, 40, 44, 8, 0, C.steelDk, { ax: 'x', seg: 12 });                                    // barrel
  for (let i = 0; i < 4; i++) b.tor(6.4, 1.2, 32 + i * 8, 8, 0, C.cyan, { ry: Math.PI / 2, seg: 14, emit: 1.2 });
  b.cyl(6.4, 8, 68, 8, 0, C.cyan, { ax: 'x', seg: 12, rt: 2, emit: 1.4 });                      // emitter cone
  b.sph(2.6, 73, 8, 0, C.white, { emit: 1.6, seg: 8 });
  b.box(13, 20, 9.4, 4, -8, 0, C.gun); b.box(10, 14, 9.9, 4, -8, 0, C.cyan, { emit: 1.1 });     // energy magazine
  b.box(8, 22, 8, -26, -7, 0, C.gun, { rz: 0.3 });                                              // grip
  b.box(2, 8, 3, -14, -2, 0, C.black); b.box(16, 2, 3, -10, -7, 0, C.gun); b.box(2, 7, 3, -2, -4, 0, C.gun);
  for (const z of [-4.6, 4.6]) { b.box(24, 3, 1.6, -45, 12, z, C.steelDk); b.box(24, 3, 1.6, -45, -4, z, C.steelDk); } // skeletal stock
  b.box(3, 22, 12, -58, 4, 0, C.black);
  for (let i = 0; i < 4; i++) b.box(3, 1.2, 0.6, -18 + i * 4.2, 8, 6.9, C.black);               // vent slats
  b.box(6, 2.4, 0.7, 14, 10, 6.9, C.yellow, { emit: 0.5 });
  return b.build(1.1);
}

function bfg() { // BFG 9000: massive green-glowing cannon
  const b = new Builder(59);
  b.cyl(15, 50, 0, 8, 0, C.steelDk, { ax: 'x', seg: 18 });                                      // fat main body
  for (const x of [-18, -6, 6, 18]) b.cyl(15.8, 2.6, x, 8, 0, C.gun, { ax: 'x', seg: 18 });
  for (let i = 0; i < 5; i++) b.box(3, 2, 5, -18 + i * 9, 23.4, 0, C.yellow, { emit: 0.3 });   // hazard ticks
  b.cyl(15, 26, 38, 8, 0, C.steelDk, { ax: 'x', seg: 18, rt: 25 });                              // flared dish
  b.cyl(25.6, 3, 52, 8, 0, C.steel, { ax: 'x', seg: 18 });
  b.cyl(23, 1.2, 52.6, 8, 0, C.green, { ax: 'x', seg: 18, emit: 1.1 });                          // glowing dish face
  b.cyl(8, 3, 53.6, 8, 0, C.white, { ax: 'x', seg: 12, emit: 1.6 });
  b.sph(6, 56, 8, 0, C.green, { emit: 1.8, seg: 10 });                                           // emitter orb
  for (const [x, r] of [[31, 16.9], [39, 20.1], [47, 23.3]]) b.cyl(r + 0.5, 2.4, x, 8, 0, C.steelLt, { ax: 'x', seg: 18 });   // dish rings
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + 0.2; b.box(3, 1.6, 1.6, 50, 8 + Math.sin(a) * 22.5, Math.cos(a) * 22.5, C.green, { emit: 1.2, rx: -a }); } // rim lamps
  for (const z of [-11, 11]) { b.cyl(6.4, 42, -2, 27, z, C.green, { ax: 'x', seg: 12, emit: 1.3 }); b.cyl(7, 3, -24, 27, z, C.steelDk, { ax: 'x', seg: 12 }); b.cyl(7, 3, 20, 27, z, C.steelDk, { ax: 'x', seg: 12 }); b.cyl(3.2, 42.4, -2, 27, z, C.white, { ax: 'x', seg: 8, emit: 1.2 }); } // cell canisters
  b.box(46, 3, 30, -2, 22, 0, C.gun);                                                            // cell rack
  for (const x of [-16, 0, 16]) b.cyl(2.6, 40, x, -4, 0, C.steelLt, { ax: 'z', seg: 8 });         // pipes
  b.box(30, 3, 3, 0, -12, 15.4, C.green, { emit: 1.0 }); b.box(30, 3, 3, 0, -12, -15.4, C.green, { emit: 1.0 });
  b.cyl(12, 20, -36, 8, 0, C.steelDk, { ax: 'x', seg: 16, rt: 16 });                             // rear housing
  b.box(3, 20, 24, -48, 8, 0, C.black);
  b.box(4, 10, 14, -26, 14, 0, C.black); b.box(1, 7, 10, -28.2, 14, 0, C.green, { emit: 1.3 }); // status panel
  b.box(12, 26, 10, -8, -22, 0, C.black, { rz: 0.25 }); b.box(3, 8, 3, 0, -10.5, 0, C.gun); b.box(18, 2, 3, -2, -12.5, 0, C.gun); // grip
  b.box(11, 20, 9, 22, -18, 0, C.black, { rz: -0.15 });                                          // fore grip
  b.cyl(2, 10, 44, -6, 20, C.steelLt, { seg: 6 });
  return b.build(1.22);
}

const BUILDERS = { health, medkit, armor, ammo_bullets: bullets, ammo_shells: shells, ammo_rockets: rockets, ammo_cells: cells,
  weapon_fist: fist, weapon_chainsaw: chainsaw, weapon_pistol: pistol, weapon_shotgun: shotgun, weapon_ssg: ssg, weapon_chaingun: chaingun,
  weapon_rocket: rocket, weapon_plasma: plasma, weapon_bfg: bfg };

export function buildModel(kind) { const f = BUILDERS[kind]; return f ? f() : null; }
export const MODEL_KINDS = Object.keys(BUILDERS);
