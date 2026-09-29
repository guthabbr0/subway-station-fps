// Skeleton assembly (nested THREE.Bones + one SkinnedMesh per enemy with rigid 1-bone skinning), shared materials, pooling, 2-bone arm IK, pose application.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDERS } from './models.js';
import { makeAtlas, makeBlobTexture, OUTFITS } from './textures.js';

// pose channel indices (angles in radians unless noted)
export const CH = { HY: 0, HX: 1, HZ: 2, HR: 3, SX: 4, SY: 5, SZ: 6, NX: 7, NY: 8, NZ: 9, LLX: 10, LLZ: 11, LKX: 12, RLX: 13, RLZ: 14, RKX: 15, RY: 16, RP: 17, RR: 18, N: 19 };

const V = THREE.Vector3;
const _u = new V(), _f = new V(), _D = new V(), _pole = new V(), _xw = new V(), _yw = new V(), _zw = new V(), _pp = new V();
const _M = new THREE.Matrix4(), _E = new THREE.Euler();

// Two-bone IK. Target (tx,ty,tz) is relative to the shoulder pivot in spine space. Writes shoulder Euler (XYZ) + elbow flex.
export function solveArm(sh, el, l1, l2, tx, ty, tz, side) {
  let d = Math.hypot(tx, ty, tz);
  if (d < 1e-4) { tx = 0; ty = -0.1; tz = 0; d = 0.1; }
  const maxR = (l1 + l2) * 0.997, minR = Math.abs(l1 - l2) + 0.03, k = d > maxR ? maxR / d : d < minR ? minR / d : 1;
  _D.set(tx * k, ty * k, tz * k); d *= k;
  const inv = 1 / d; const dx = _D.x * inv, dy = _D.y * inv, dz = _D.z * inv;
  _pole.set(side * 0.6, -0.7, -0.35);
  const pd = _pole.x * dx + _pole.y * dy + _pole.z * dz;
  _pp.set(_pole.x - dx * pd, _pole.y - dy * pd, _pole.z - dz * pd);
  if (_pp.lengthSq() < 1e-6) _pp.set(side, 0, 0); _pp.normalize();
  const cosA = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))), sinA = Math.sqrt(1 - cosA * cosA);
  _u.set(dx * cosA + _pp.x * sinA, dy * cosA + _pp.y * sinA, dz * cosA + _pp.z * sinA);
  _f.set(_D.x - _u.x * l1, _D.y - _u.y * l1, _D.z - _u.z * l1).normalize();
  const cosE = Math.max(-1, Math.min(1, _u.dot(_f)));
  const flex = Math.acos(cosE);
  _xw.crossVectors(_f, _u);
  if (_xw.lengthSq() < 1e-8) _xw.crossVectors(_pp, _u);
  _xw.normalize();
  _yw.copy(_u).negate();
  _zw.crossVectors(_xw, _yw);
  _M.makeBasis(_xw, _yw, _zw);
  _E.setFromRotationMatrix(_M, 'XYZ');
  sh.rotation.set(_E.x, _E.y, _E.z);
  el.rotation.x = -flex;
}

// ------------------------------------------------------------------ shared assets
const TEMPLATES = {};
let SH = null;
export function shared() {
  if (SH) return SH;
  const shadowTex = makeBlobTexture('shadow'), poolTex = makeBlobTexture('pool');
  const plane = new THREE.PlaneGeometry(1, 1); plane.rotateX(-Math.PI / 2);
  SH = {
    plane,
    shadowMat: new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false, color: 0x080808 }),
    poolMat: new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, color: 0x9a6a6a }),
  };
  return SH;
}

export function getTemplate(type) {
  if (TEMPLATES[type]) return TEMPLATES[type];
  const tpl = BUILDERS[type]();
  tpl.type = type; tpl.merged = {};
  tpl.outfits = OUTFITS[type].map((o, i) => {
    const map = makeAtlas(type, i, 3 + i);
    const mat = new THREE.MeshPhongMaterial({ map, vertexColors: true, specular: 0x12161a, shininess: 9 });
    const flash = new THREE.MeshPhongMaterial({ map, vertexColors: true, specular: 0x12161a, shininess: 9, emissive: 0xff5a3c }); flash.emissiveIntensity = 0.4;
    return { map, mat, flash };
  });
  TEMPLATES[type] = tpl;
  return tpl;
}
export function templates() { return TEMPLATES; }

// ------------------------------------------------------------------ rig construction
// One SkinnedMesh per enemy (rigid 1-bone skinning): all bone parts are merged into a single geometry (2 draw calls with a glow group,
// 1 without). The skeleton is an ordinary nested THREE.Bone hierarchy that anim.js poses each frame.
const BONE_ORDER = ['hips', 'spine', 'neck', 'legL', 'kneeL', 'legR', 'kneeR', 'shL', 'elL', 'shR', 'elR'];
const PART_BONE = { pelvis: 'hips', torso: 'spine', head: 'neck', uarmL: 'shL', farmL: 'elL', uarmR: 'shR', farmR: 'elR', thighL: 'legL', shinL: 'kneeL', thighR: 'legR', shinR: 'kneeR' };

function restPos(D) { // bone origins in root space at rest
  const y1 = D.hipY, y2 = y1 + D.waist, y3 = y2 + D.torso, ys = y2 + D.shY;
  return { hips: [0, y1, 0], spine: [0, y2, 0], neck: [0, y3, 0], legL: [D.hipX, y1, 0], kneeL: [D.hipX, y1 - D.thigh, 0], legR: [-D.hipX, y1, 0], kneeR: [-D.hipX, y1 - D.thigh, 0],
    shL: [D.shX, ys, 0], elL: [D.shX, ys - D.uarm, 0], shR: [-D.shX, ys, 0], elR: [-D.shX, ys - D.uarm, 0] };
}

// Merged, skinned geometry for one (head variant, left-forearm variant) combination. Cached per template.
export function mergedGeometry(tpl, head, farm) {
  const hi = head % tpl.geos.head.length, fi = farm % tpl.geos.farmL.length, key = hi + ':' + fi;
  if (tpl.merged[key]) return tpl.merged[key];
  const rest = restPos(tpl.D), lit = [], glow = [];
  for (const name of Object.keys(PART_BONE)) {
    const idx = name === 'head' ? hi : name === 'farmL' ? fi : 0, part = tpl.geos[name][idx];
    const b = PART_BONE[name], bi = BONE_ORDER.indexOf(b), t = rest[b];
    for (const [k, arr] of [['lit', lit], ['glow', glow]]) {
      const src = part[k]; if (!src) continue;
      const g = src.clone(); g.translate(t[0], t[1], t[2]);
      const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      arr.push(g);
    }
  }
  const litG = mergeGeometries(lit, false), glowG = glow.length ? mergeGeometries(glow, false) : null;
  let out = litG;
  if (glowG) { out = mergeGeometries([litG, glowG], true); litG.dispose(); glowG.dispose(); }
  for (const g of lit) g.dispose(); for (const g of glow) g.dispose();
  out.userData.hasGlow = !!glowG;
  tpl.merged[key] = out; return out;
}

// Build every head/forearm combination up front so spawning never hitches on geometry merging.
export function prebuild(tpl) { for (let h = 0; h < tpl.geos.head.length; h++) for (let f = 0; f < tpl.geos.farmL.length; f++) mergedGeometry(tpl, h, f); }

export function buildRig(tpl, def) {
  const D = tpl.D;
  const root = new THREE.Group(); root.name = 'enemy:' + tpl.type;
  const body = new THREE.Group(); root.add(body);
  const rig = { tpl, D, root, body, mesh: null, meshes: [], outfit: null, flashing: false };
  const bone = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); rig[name] = b; return b; };
  const hips = bone('hips', body, 0, D.hipY, 0);
  bone('legL', hips, D.hipX, 0, 0); bone('kneeL', rig.legL, 0, -D.thigh, 0);
  bone('legR', hips, -D.hipX, 0, 0); bone('kneeR', rig.legR, 0, -D.thigh, 0);
  const spine = bone('spine', hips, 0, D.waist, 0);
  bone('neck', spine, 0, D.torso, 0);
  bone('shL', spine, D.shX, D.shY, 0); bone('elL', rig.shL, 0, -D.uarm, 0);
  bone('shR', spine, -D.shX, D.shY, 0); bone('elR', rig.shR, 0, -D.uarm, 0);
  if (tpl.muzzle) { rig.muzzle = new THREE.Object3D(); rig.muzzle.position.set(...tpl.muzzle); spine.add(rig.muzzle); }
  const bones = BONE_ORDER.map((n) => rig[n]);
  rig.nodes = [root, body, ...bones, ...(rig.muzzle ? [rig.muzzle] : [])];
  // unlit emissive material (eyes, pustules, lantern...) is per-rig so it can pulse independently
  rig.glow = new THREE.MeshBasicMaterial({ vertexColors: true }); rig.glow.color.setScalar(def.glow ?? 1.8);
  // skeleton bound in the rest pose (all rotations zero, root at the origin)
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(mergedGeometry(tpl, 0, 0), rig.glow);
  mesh.matrixAutoUpdate = false; root.add(mesh); root.updateMatrixWorld(true);
  mesh.bind(skeleton, new THREE.Matrix4());
  const H = D.hipY + D.waist + D.torso + D.headY + 0.2; // generous fixed culling sphere (pose extents never leave it)
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H * 0.5, 0.05), H * 0.95 + 0.6);
  rig.mesh = mesh; rig.meshes.push(mesh); rig.skeleton = skeleton;
  return rig;
}

// choose per-instance geometry variants + outfit materials. variant: {head, farm, outfit}
export function dressRig(rig, variant) {
  const tpl = rig.tpl, of = tpl.outfits[variant.outfit % tpl.outfits.length], m = rig.mesh;
  rig.outfit = of; rig.flashing = false;
  m.geometry = mergedGeometry(tpl, variant.head, variant.farm);
  m.material = m.geometry.userData.hasGlow ? [of.mat, rig.glow] : of.mat;
  m.visible = true;
  rig.neck.scale.set(1, 1, 1); rig.spine.scale.set(1, 1, 1);
}
export function setFlash(rig, on) {
  if (rig.flashing === on || !rig.outfit) return; rig.flashing = on;
  const mat = on ? rig.outfit.flash : rig.outfit.mat, m = rig.mesh;
  if (Array.isArray(m.material)) m.material[0] = mat; else m.material = mat;
}
export function hideHead(rig) { rig.neck.scale.set(1e-4, 1e-4, 1e-4); }
export function freezeRig(rig, frozen) {
  for (const n of rig.nodes) { if (frozen) n.updateMatrix(); n.matrixAutoUpdate = !frozen; }
}

// Write pose channels + IK hands into the skeleton.
export function applyPose(rig, P, hl, hr, def) {
  const D = rig.D;
  rig.body.position.y = P[CH.RY]; rig.body.rotation.set(P[CH.RP], 0, P[CH.RR]);
  rig.hips.position.y = D.hipY + P[CH.HY]; rig.hips.rotation.set(P[CH.HX], P[CH.HR], P[CH.HZ]);
  rig.spine.rotation.set(P[CH.SX], P[CH.SY], P[CH.SZ]);
  rig.neck.rotation.set(P[CH.NX], P[CH.NY], P[CH.NZ]);
  rig.legL.rotation.set(P[CH.LLX], 0, P[CH.LLZ]); rig.kneeL.rotation.x = P[CH.LKX];
  rig.legR.rotation.set(P[CH.RLX], 0, P[CH.RLZ]); rig.kneeR.rotation.x = P[CH.RKX];
  solveArm(rig.shL, rig.elL, D.uarm, D.farm, hl.x, hl.y, hl.z, 1);
  solveArm(rig.shR, rig.elR, D.uarm, D.farm, hr.x, hr.y, hr.z, -1);
}

// ------------------------------------------------------------------ pooling
const POOL = {};
export function acquireRig(type, def, variant) {
  const tpl = getTemplate(type);
  const list = POOL[type] || (POOL[type] = []);
  const rig = list.pop() || buildRig(tpl, def);
  dressRig(rig, variant);
  rig.root.visible = true; rig.body.position.set(0, 0, 0); rig.body.rotation.set(0, 0, 0);
  freezeRig(rig, false);
  return rig;
}
export function releaseRig(type, rig) {
  rig.root.visible = false; if (rig.root.parent) rig.root.parent.remove(rig.root);
  (POOL[type] || (POOL[type] = [])).push(rig);
}
export function poolStats() { const o = {}; for (const k in POOL) o[k] = POOL[k].length; return o; }
