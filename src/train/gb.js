// Tiny geometry builder used by the train: collects quads/boxes/cylinders with per-vertex colour into one BufferGeometry.
// All colours are LINEAR rgb triples (use rgb('#hex')). Axis convention: for axis a, (t1,t2)=((a+1)%3,(a+2)%3) so t1 x t2 = a.
import * as THREE from 'three';

const _c = new THREE.Color();
export const rgb = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };
export const tint = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const isFn = (v) => typeof v === 'function';

export class GB {
  constructor(uvScale = 0.5) {
    this.P = []; this.N = []; this.U = []; this.K = []; this.I = []; this.n = 0;
    this.uvScale = uvScale; this.ox = 0; this.oy = 0; this.oz = 0;
  }
  setOffset(x, y = 0, z = 0) { this.ox = x; this.oy = y; this.oz = z; return this; }
  vert(x, y, z, nx, ny, nz, u, v, c) {
    this.P.push(x + this.ox, y + this.oy, z + this.oz); this.N.push(nx, ny, nz); this.U.push(u, v); this.K.push(c[0], c[1], c[2]);
    return this.n++;
  }
  _col(col, p, i) { if (isFn(col)) return col(p, i); if (Array.isArray(col[0])) return col[i]; return col; }
  // Quad a,b,c,d (arrays [x,y,z], CCW seen from the front). facing: optional desired normal (flips winding if needed).
  // uvs: optional 4x[u,v]. col: [r,g,b] | 4x[r,g,b] | fn(p,i).
  quad(a, b, c, d, col, uvs, facing) {
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    let vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    let l = Math.hypot(nx, ny, nz); if (l < 1e-12) return;
    nx /= l; ny /= l; nz /= l;
    if (facing && nx * facing[0] + ny * facing[1] + nz * facing[2] < 0) {
      [b, d] = [d, b]; nx = -nx; ny = -ny; nz = -nz; if (uvs) uvs = [uvs[0], uvs[3], uvs[2], uvs[1]];
      if (Array.isArray(col) && Array.isArray(col[0])) col = [col[0], col[3], col[2], col[1]];
    }
    const P = [a, b, c, d];
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz), s = this.uvScale;
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const p = P[i]; let u, v;
      if (uvs) { u = uvs[i][0]; v = uvs[i][1]; }
      else if (ax >= ay && ax >= az) { u = p[2] * s; v = p[1] * s; }
      else if (ay >= az) { u = p[0] * s; v = p[2] * s; }
      else { u = p[0] * s; v = p[1] * s; }
      ids.push(this.vert(p[0], p[1], p[2], nx, ny, nz, u, v, this._col(col, p, i)));
    }
    this.I.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  tri(a, b, c, col, facing, uvs) {
    let nx0 = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny0 = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz0 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx0, ny0, nz0); if (l < 1e-12) return;
    nx0 /= l; ny0 /= l; nz0 /= l;
    if (facing && nx0 * facing[0] + ny0 * facing[1] + nz0 * facing[2] < 0) { [b, c] = [c, b]; nx0 = -nx0; ny0 = -ny0; nz0 = -nz0; }
    const ax = Math.abs(nx0), ay = Math.abs(ny0), az = Math.abs(nz0), s = this.uvScale;
    const ids = [];
    [a, b, c].forEach((p, i) => {
      let u, v;
      if (uvs) { u = uvs[i][0]; v = uvs[i][1]; }
      else if (ax >= ay && ax >= az) { u = p[2] * s; v = p[1] * s; } else if (ay >= az) { u = p[0] * s; v = p[2] * s; } else { u = p[0] * s; v = p[1] * s; }
      ids.push(this.vert(p[0], p[1], p[2], nx0, ny0, nz0, u, v, this._col(col, p, i)));
    });
    this.I.push(ids[0], ids[1], ids[2]);
  }
  // Axis-aligned box. skip: bitmask of faces to omit (bit 2*axis+0 = +face, 2*axis+1 = -face).
  box(x0, y0, z0, x1, y1, z1, col, skip = 0) {
    const mn = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], mx = [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
    for (let ax = 0; ax < 3; ax++) {
      for (let sg = 0; sg < 2; sg++) {
        if (skip & (1 << (ax * 2 + sg))) continue;
        const t1 = (ax + 1) % 3, t2 = (ax + 2) % 3, fixed = sg === 0 ? mx[ax] : mn[ax];
        const mk = (a, b) => { const p = [0, 0, 0]; p[ax] = fixed; p[t1] = a; p[t2] = b; return p; };
        let A = mk(mn[t1], mn[t2]), B = mk(mx[t1], mn[t2]), Cc = mk(mx[t1], mx[t2]), D = mk(mn[t1], mx[t2]);
        if (sg === 1) [B, D] = [D, B];
        this.quad(A, B, Cc, D, col);
      }
    }
  }
  boxC(cx, cy, cz, sx, sy, sz, col, skip = 0) { this.box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, col, skip); }
  // Cylinder/cone along axis ax (0=x,1=y,2=z), centre (cx,cy,cz), radius r0 at -axis end and r1 at +axis end, length len.
  cyl(ax, cx, cy, cz, r0, r1, len, seg, col, caps = 3) {
    const t1 = (ax + 1) % 3, t2 = (ax + 2) % 3, c = [cx, cy, cz], h = len / 2;
    const pt = (a, r, s) => { const p = [c[0], c[1], c[2]]; p[ax] += s * h; p[t1] += Math.cos(a) * r; p[t2] += Math.sin(a) * r; return p; };
    const slope = (r0 - r1) / len;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const pa = pt(a0, r0, -1), pb = pt(a1, r0, -1), pc = pt(a1, r1, 1), pd = pt(a0, r1, 1);
      const push = (p, a, i2) => {
        const n = [0, 0, 0]; n[ax] = slope; n[t1] = Math.cos(a); n[t2] = Math.sin(a);
        const l = Math.hypot(n[0], n[1], n[2]); n[0] /= l; n[1] /= l; n[2] /= l;
        const su = (i + (i2 ? 1 : 0)) / seg * 2, sv = (p[ax] - c[ax] + h) / len;
        return this.vert(p[0], p[1], p[2], n[0], n[1], n[2], su, sv * len * this.uvScale, this._col(col, p, i2));
      };
      const i0 = push(pa, a0, 0), i1 = push(pb, a1, 1), i2 = push(pc, a1, 1), i3 = push(pd, a0, 0);
      this.I.push(i0, i1, i2, i0, i2, i3);
    }
    const cap = (s, r) => {
      const n = [0, 0, 0]; n[ax] = s;
      const cp = [c[0], c[1], c[2]]; cp[ax] += s * h;
      const ci = this.vert(cp[0], cp[1], cp[2], n[0], n[1], n[2], 0.5, 0.5, this._col(col, cp, 0));
      const ring = [];
      for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2, p = pt(a, r, s); ring.push(this.vert(p[0], p[1], p[2], n[0], n[1], n[2], 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5, this._col(col, p, 0))); }
      for (let i = 0; i < seg; i++) { if (s > 0) this.I.push(ci, ring[i], ring[i + 1]); else this.I.push(ci, ring[i + 1], ring[i]); }
    };
    if (caps & 1 && r1 > 0) cap(1, r1);
    if (caps & 2 && r0 > 0) cap(-1, r0);
  }
  // Extrude a (z,y) profile polyline along x from x0 to x1 (outer surface facing away from `inside`); smooth normals.
  extrudeProfile(pts, x0, x1, col, flip = false) {
    const m = pts.length;
    const nrm = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(m - 1, i + 1)];
      let tz = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tz, ty) || 1; tz /= l; ty /= l;
      return flip ? [ty, -tz] : [-ty, tz]; // normal in (z,y): rotate tangent
    });
    for (let i = 0; i < m - 1; i++) {
      const ids = [];
      for (const [x, k] of [[x0, 0], [x1, 1]]) for (const j of [i, i + 1]) {
        const p = pts[j], n = nrm[j];
        ids.push(this.vert(x, p[1], p[0], 0, n[1], n[0], x * this.uvScale, (p[0] + p[1]) * this.uvScale, this._col(col, [x, p[1], p[0]], k * 2 + (j - i))));
      }
      // ids: [x0,i],[x0,i+1],[x1,i],[x1,i+1]
      if (flip) this.I.push(ids[0], ids[2], ids[1], ids[1], ids[2], ids[3]); else this.I.push(ids[0], ids[1], ids[2], ids[1], ids[3], ids[2]);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.K, 3));
    g.setIndex(this.I);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// Rectangular cells of an (a,y) grid minus holes. holes: [{a0,a1,y0,y1}]
export function cells(aB, yB, holes) {
  const uniq = (arr) => { const s = [...arr].sort((p, q) => p - q), o = []; for (const v of s) if (!o.length || v - o[o.length - 1] > 1e-6) o.push(v); return o; };
  const A = uniq(aB), Y = uniq(yB), out = [];
  for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < Y.length - 1; j++) {
    const ma = (A[i] + A[i + 1]) / 2, my = (Y[j] + Y[j + 1]) / 2;
    if (holes.some((h) => ma > h.a0 && ma < h.a1 && my > h.y0 && my < h.y1)) continue;
    out.push([A[i], A[i + 1], Y[j], Y[j + 1]]);
  }
  return out;
}

// Decal quad from an atlas rect {u0,v0,u1,v1}. axis 'x'|'y'|'z', sign +1/-1 = normal direction. rot = radians about the normal.
export function decalQuad(gb, rect, cx, cy, cz, axis, sign, w, h, rot = 0, col = [1, 1, 1]) {
  let R, U;
  if (axis === 'z') { R = [sign, 0, 0]; U = [0, 1, 0]; } else if (axis === 'x') { R = [0, 0, -sign]; U = [0, 1, 0]; } else { R = [1, 0, 0]; U = [0, 0, -sign]; }
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const R2 = [R[0] * cr + U[0] * sr, R[1] * cr + U[1] * sr, R[2] * cr + U[2] * sr];
  const U2 = [U[0] * cr - R[0] * sr, U[1] * cr - R[1] * sr, U[2] * cr - R[2] * sr];
  const hw = w / 2, hh = h / 2;
  const P = (a, b) => [cx + R2[0] * a * hw + U2[0] * b * hh, cy + R2[1] * a * hw + U2[1] * b * hh, cz + R2[2] * a * hw + U2[2] * b * hh];
  const n = [axis === 'x' ? sign : 0, axis === 'y' ? sign : 0, axis === 'z' ? sign : 0];
  gb.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), col, [[rect.u0, rect.v0], [rect.u1, rect.v0], [rect.u1, rect.v1], [rect.u0, rect.v1]], n);
}
