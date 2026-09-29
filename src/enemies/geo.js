// Tiny geometry builder: merges primitives into ONE BufferGeometry per bone, with vertex colours, atlas UV regions,
// organic vertex jitter and an optional second "glow" group (drawn with an unlit emissive material).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uvRect } from './textures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
const hash = (x, y, z, s) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453; return n - Math.floor(n); };

export class GB {
  constructor(seed = 1) { this.lit = []; this.glow = []; this.seed = seed; }

  // o: {p:[x,y,z], r:[rx,ry,rz], s:[sx,sy,sz], col, col2 (bottom colour for vertical gradient), cv (per-vertex colour noise),
  //     reg (atlas region), sub:[u0,v0,u1,v1] (sub-rect of region), planar:[cx,cy,w,h] (front planar UV in final space),
  //     glow (bool), jit (metres), mir (also add an x-mirrored copy)}
  add(g, o = {}) {
    const glow = !!o.glow;
    const pos = g.attributes.position, n = pos.count;
    g.computeBoundingBox();
    const y0 = g.boundingBox.min.y, hy = (g.boundingBox.max.y - y0) || 1;
    // taper (top/bottom scale of x,z)
    if (o.tp || o.bt) {
      const tp = o.tp || [1, 1], bt = o.bt || [1, 1];
      for (let i = 0; i < n; i++) {
        const t = (pos.getY(i) - y0) / hy;
        pos.setX(i, pos.getX(i) * (bt[0] + (tp[0] - bt[0]) * t)); pos.setZ(i, pos.getZ(i) * (bt[1] + (tp[1] - bt[1]) * t));
      }
    }
    // vertex colours
    _c1.set(o.col ?? 0xffffff); _c2.set(o.col2 ?? o.col ?? 0xffffff);
    const cv = o.cv || 0, colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = (pos.getY(i) - y0) / hy;
      let k = 1; if (cv) k += (hash(pos.getX(i), pos.getY(i), pos.getZ(i), this.seed + 3) - 0.5) * cv;
      colors[i * 3] = (_c2.r + (_c1.r - _c2.r) * t) * k; colors[i * 3 + 1] = (_c2.g + (_c1.g - _c2.g) * t) * k; colors[i * 3 + 2] = (_c2.b + (_c1.b - _c2.b) * t) * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // uv -> atlas region
    const uv = g.attributes.uv;
    if (glow) { for (let i = 0; i < n; i++) uv.setXY(i, 0.5, 0.5); }
    else if (!o.planar) {
      const R = uvRect(o.reg || 'skin'), sb = o.sub;
      for (let i = 0; i < n; i++) {
        let u = uv.getX(i), v = uv.getY(i);
        if (sb) { u = sb[0] + u * (sb[2] - sb[0]); v = sb[1] + v * (sb[3] - sb[1]); }
        uv.setXY(i, R.u0 + u * R.du, R.v0 + v * R.dv);
      }
    }
    // transform
    _p.set(...(o.p || [0, 0, 0])); _e.set(...(o.r || [0, 0, 0]), o.ro || 'XYZ'); _q.setFromEuler(_e); _s.set(...(o.s || [1, 1, 1]));
    _m.compose(_p, _q, _s); g.applyMatrix4(_m);
    // planar (front-projected) UV, evaluated in final bone space; back-facing verts sample the plain skin region
    if (o.planar) {
      const [cx, cy, w, h] = o.planar, R = uvRect(o.reg || 'face', 3), B = uvRect('skin', 6);
      const nrm = g.attributes.normal;
      for (let i = 0; i < n; i++) {
        if (nrm.getZ(i) < 0.02) { uv.setXY(i, B.u0 + B.du * (0.3 + 0.4 * ((i * 0.618) % 1)), B.v0 + B.dv * (0.3 + 0.4 * ((i * 0.377) % 1))); continue; }
        const u = Math.min(1, Math.max(0, (pos.getX(i) - cx) / w + 0.5)), v = Math.min(1, Math.max(0, (pos.getY(i) - cy) / h + 0.5));
        uv.setXY(i, R.u0 + u * R.du, R.v0 + v * R.dv);
      }
    }
    if (o.jit) {
      const j = o.jit * 2, sd = this.seed;
      for (let i = 0; i < n; i++) {
        const x = Math.round(pos.getX(i) * 400) / 400, y = Math.round(pos.getY(i) * 400) / 400, z = Math.round(pos.getZ(i) * 400) / 400;
        pos.setXYZ(i, pos.getX(i) + (hash(x, y, z, sd) - 0.5) * j, pos.getY(i) + (hash(y, z, x, sd + 1) - 0.5) * j, pos.getZ(i) + (hash(z, x, y, sd + 2) - 0.5) * j);
      }
      g.computeVertexNormals();
    }
    (glow ? this.glow : this.lit).push(g);
    if (o.mir) {
      const g2 = g.clone(); g2.applyMatrix4(_mirror);
      const ix = g2.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
      (glow ? this.glow : this.lit).push(g2);
    }
    return this;
  }

  box(w, h, d, o) { return this.add(new THREE.BoxGeometry(w, h, d), o); }
  // cylinder along Y; seam at the back (-Z), front (+Z) is the centre of the u range
  cyl(rt, rb, h, o = {}) { const g = new THREE.CylinderGeometry(rt, rb, h, o.seg || 8, 1, !!o.open); g.rotateY(Math.PI); return this.add(g, o); }
  cone(r, h, o = {}) { return this.cyl(0.0001, r, h, o); }
  // sphere with the front (+Z) at u=0.5
  sph(r, o = {}) {
    const g = new THREE.SphereGeometry(r, o.ws || 10, o.hs || 8, o.phi0 ?? 0, o.phiLen ?? Math.PI * 2, o.th0 ?? 0, o.thLen ?? Math.PI);
    g.rotateY(-Math.PI / 2); return this.add(g, o);
  }
  tor(R, r, o = {}) { return this.add(new THREE.TorusGeometry(R, r, o.rs || 5, o.seg || 10, o.arc ?? Math.PI * 2), o); }

  // Returns {lit, glow}: two merged geometries (either may be null). The rig merges parts of all bones into one skinned geometry.
  buildParts() {
    const lit = this.lit.length ? mergeGeometries(this.lit, false) : null;
    const glow = this.glow.length ? mergeGeometries(this.glow, false) : null;
    for (const g of this.lit) g.dispose(); for (const g of this.glow) g.dispose();
    return { lit, glow };
  }
}
