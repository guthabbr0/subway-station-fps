// MB: tiny merged-geometry builder used by the station. Everything static is accumulated per-material into one
// BufferGeometry (positions, normals, uvs, vertex colours) so the whole environment costs a handful of draw calls.
// UVs are projected from world position (metres / period) so tiling textures keep a constant texel density.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// cheap hashed value noise in 3D (for baked grime / AO variation in vertex colours)
const H = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(H(ix, iy, iz), H(ix + 1, iy, iz), sx), l(H(ix, iy + 1, iz), H(ix + 1, iy + 1, iz), sx), sy),
    l(l(H(ix, iy, iz + 1), H(ix + 1, iy, iz + 1), sx), l(H(ix, iy + 1, iz + 1), H(ix + 1, iy + 1, iz + 1), sx), sy), sz);
}
export const fbm3 = (x, y, z) => noise3(x, y, z) * 0.55 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.3 + noise3(x * 4.3, y * 4.3, z * 4.3) * 0.15;

export class MB {
  constructor(period = 1) { this.period = period; this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }

  vert(x, y, z, nx, ny, nz, u, v, r, g, b) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v); this.col.push(r, g, b); return this.n++;
  }

  // bilinear patch through 4 corners a=p(0,0) b=p(1,0) c=p(0,1) d=p(1,1) (arrays [x,y,z]), subdivided nu x nv, facing n.
  // opts: c=[r,g,b], f(x,y,z,nx,ny,nz,s,t)->scalar|[r,g,b], uv(...)->[u,v], uo/vo/us/vs
  patch(a, b, c, d, nu, nv, nx, ny, nz, o = {}) {
    const col = o.c || [1, 1, 1], P = this.period, f = o.f, uvf = o.uv, uo = o.uo || 0, vo = o.vo || 0, us = o.us || 1, vs = o.vs || 1;
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    const flip = cx * nx + cy * ny + cz * nz < 0;
    const base = this.n, anx = Math.abs(nx), any = Math.abs(ny);
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const s = i / nu, t = j / nv;
      const x = (a[0] * (1 - s) + b[0] * s) * (1 - t) + (c[0] * (1 - s) + d[0] * s) * t;
      const y = (a[1] * (1 - s) + b[1] * s) * (1 - t) + (c[1] * (1 - s) + d[1] * s) * t;
      const z = (a[2] * (1 - s) + b[2] * s) * (1 - t) + (c[2] * (1 - s) + d[2] * s) * t;
      let u, v;
      if (uvf) { const r = uvf(x, y, z, nx, ny, nz, s, t); u = r[0]; v = r[1]; }
      else if (anx > 0.5) { u = z / P; v = y / P; } else if (any > 0.5) { u = x / P; v = z / P; } else { u = x / P; v = y / P; }
      u = u * us + uo; v = v * vs + vo;
      let r = col[0], g = col[1], bl = col[2];
      if (f) { const k = f(x, y, z, nx, ny, nz, s, t); if (typeof k === 'number') { r *= k; g *= k; bl *= k; } else { r *= k[0]; g *= k[1]; bl *= k[2]; } }
      this.vert(x, y, z, nx, ny, nz, u, v, r, g, bl);
    }
    const w = nu + 1;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const i0 = base + j * w + i, i1 = i0 + 1, i2 = i0 + w, i3 = i2 + 1;
      if (flip) this.idx.push(i0, i2, i1, i1, i2, i3); else this.idx.push(i0, i1, i2, i1, i3, i2);
    }
  }
  // planar parallelogram patch: o + s*A + t*B
  grid(ox, oy, oz, ax, ay, az, bx, by, bz, nu, nv, nx, ny, nz, o = {}) {
    this.patch([ox, oy, oz], [ox + ax, oy + ay, oz + az], [ox + bx, oy + by, oz + bz], [ox + ax + bx, oy + ay + by, oz + az + bz], nu, nv, nx, ny, nz, o);
  }
  // convex polygon (array of [x,y,z]) with a flat normal, fan-triangulated, world-projected uv
  poly(pts, nx, ny, nz, o = {}) {
    const c = o.c || [1, 1, 1], P = this.period, f = o.f, anx = Math.abs(nx), any = Math.abs(ny), base = this.n;
    for (const p of pts) {
      let u, v; if (anx > 0.5) { u = p[2] / P; v = p[1] / P; } else if (any > 0.5) { u = p[0] / P; v = p[2] / P; } else { u = p[0] / P; v = p[1] / P; }
      let r = c[0], g = c[1], b = c[2]; if (f) { const k = f(p[0], p[1], p[2], nx, ny, nz); if (typeof k === 'number') { r *= k; g *= k; b *= k; } else { r *= k[0]; g *= k[1]; b *= k[2]; } }
      this.vert(p[0], p[1], p[2], nx, ny, nz, u, v, r, g, b);
    }
    const e1 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]], e2 = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0], flip = cx * nx + cy * ny + cz * nz < 0;
    for (let i = 1; i < pts.length - 1; i++) { if (flip) this.idx.push(base, base + i + 1, base + i); else this.idx.push(base, base + i, base + i + 1); }
  }
  // extrude a convex CCW polygon in the XY plane between z0 and z1 (side faces + both caps). opts: c, f, skipCaps
  prismXY(pts, z0, z1, o = {}) {
    const n = pts.length, seg = o.seg || 1.5;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
      this.patch([p[0], p[1], z0], [q[0], q[1], z0], [p[0], p[1], z1], [q[0], q[1], z1], Math.max(1, Math.ceil(l / seg)), Math.max(1, Math.ceil((z1 - z0) / seg)), dy / l, -dx / l, 0, o);
    }
    if (!o.skipCaps) { this.poly(pts.map((p) => [p[0], p[1], z1]), 0, 0, 1, o); this.poly(pts.map((p) => [p[0], p[1], z0]), 0, 0, -1, o); }
  }

  // axis-aligned box. opts: c, f, seg (max subdivision length, default 1.5), skip:'px nx py ny pz nz' string, uvScale
  box(x0, y0, z0, x1, y1, z1, o = {}) {
    const seg = o.seg || 1.5, sk = o.skip || '';
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const nx = Math.max(1, Math.ceil(dx / seg)), ny = Math.max(1, Math.ceil(dy / seg)), nz = Math.max(1, Math.ceil(dz / seg));
    if (!sk.includes('px')) this.grid(x1, y0, z0, 0, 0, dz, 0, dy, 0, nz, ny, 1, 0, 0, o);
    if (!sk.includes('nx')) this.grid(x0, y0, z0, 0, 0, dz, 0, dy, 0, nz, ny, -1, 0, 0, o);
    if (!sk.includes('py')) this.grid(x0, y1, z0, dx, 0, 0, 0, 0, dz, nx, nz, 0, 1, 0, o);
    if (!sk.includes('ny')) this.grid(x0, y0, z0, dx, 0, 0, 0, 0, dz, nx, nz, 0, -1, 0, o);
    if (!sk.includes('pz')) this.grid(x0, y0, z1, dx, 0, 0, 0, dy, 0, nx, ny, 0, 0, 1, o);
    if (!sk.includes('nz')) this.grid(x0, y0, z0, dx, 0, 0, 0, dy, 0, nx, ny, 0, 0, -1, o);
  }
  // box from centre + size
  boxC(cx, cy, cz, w, h, d, o) { this.box(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, o); }

  // quad from 4 corners (CCW when seen from the normal side), explicit uv rect [u0,v0,u1,v1]. Corners: bl, br, tr, tl.
  quad(bl, br, tr, tl, uv, c = [1, 1, 1], o = {}) {
    _a.subVectors(br, bl); _b.subVectors(tl, bl); _c.crossVectors(_a, _b).normalize();
    const n = o.normal || _c;
    const t = o.tint || 1, r = c[0] * t, g = c[1] * t, b = c[2] * t;
    const i0 = this.vert(bl.x, bl.y, bl.z, n.x, n.y, n.z, uv[0], uv[1], r, g, b);
    this.vert(br.x, br.y, br.z, n.x, n.y, n.z, uv[2], uv[1], r, g, b);
    this.vert(tr.x, tr.y, tr.z, n.x, n.y, n.z, uv[2], uv[3], r, g, b);
    this.vert(tl.x, tl.y, tl.z, n.x, n.y, n.z, uv[0], uv[3], r, g, b);
    this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }

  // oriented rectangle facing along normal n (unit), centred at cx,cy,cz, size w (right) x h (up), rotated by rot about n, uv rect.
  // up hint defaults to +Y (or +Z for horizontal normals pointing up/down).
  oq(cx, cy, cz, nx, ny, nz, w, h, uv, o = {}) {
    const rot = o.rot || 0, c = o.c || [1, 1, 1];
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(ny) > 0.95) { ux = 0; uy = 0; uz = 1; }
    // right = up x n
    let rx = uy * nz - uz * ny, ry = uz * nx - ux * nz, rz = ux * ny - uy * nx; let rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    let vx = ny * rz - nz * ry, vy = nz * rx - nx * rz, vz = nx * ry - ny * rx; // true up = n x right
    if (rot) { const cs = Math.cos(rot), sn = Math.sin(rot); const r2x = rx * cs + vx * sn, r2y = ry * cs + vy * sn, r2z = rz * cs + vz * sn; const v2x = -rx * sn + vx * cs, v2y = -ry * sn + vy * cs, v2z = -rz * sn + vz * cs; rx = r2x; ry = r2y; rz = r2z; vx = v2x; vy = v2y; vz = v2z; }
    const hw = w / 2, hh = h / 2;
    const p = (sx, sy) => new THREE.Vector3(cx + rx * hw * sx + vx * hh * sy, cy + ry * hw * sx + vy * hh * sy, cz + rz * hw * sx + vz * hh * sy);
    const nn = _c.set(nx, ny, nz);
    const t = o.tint === undefined ? 1 : o.tint, r = c[0] * t, g = c[1] * t, b = c[2] * t;
    const a = p(-1, -1), bb = p(1, -1), cc = p(1, 1), d = p(-1, 1);
    const i0 = this.vert(a.x, a.y, a.z, nx, ny, nz, uv[0], uv[1], r, g, b);
    this.vert(bb.x, bb.y, bb.z, nx, ny, nz, uv[2], uv[1], r, g, b);
    this.vert(cc.x, cc.y, cc.z, nx, ny, nz, uv[2], uv[3], r, g, b);
    this.vert(d.x, d.y, d.z, nx, ny, nz, uv[0], uv[3], r, g, b);
    // ensure the winding faces along n
    _a.set(bb.x - a.x, bb.y - a.y, bb.z - a.z); _b.set(d.x - a.x, d.y - a.y, d.z - a.z); const dir = _a.cross(_b).dot(nn);
    if (dir >= 0) this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3); else this.idx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
  }

  // cylinder / pipe along an arbitrary axis from (x0,y0,z0) to (x1,y1,z1). opts: segs, cap (bool), c, f, uvLen (metres per v repeat)
  cyl(x0, y0, z0, x1, y1, z1, r0, o = {}) {
    const r1 = o.r1 === undefined ? r0 : o.r1, segs = o.segs || 8, c = o.c || [1, 1, 1], f = o.f;
    _a.set(x1 - x0, y1 - y0, z1 - z0); const len = _a.length(); if (len < 1e-6) return; _a.multiplyScalar(1 / len);
    if (Math.abs(_a.y) < 0.95) _b.set(0, 1, 0); else _b.set(1, 0, 0);
    const ux = _b.clone().cross(_a).normalize(), vx = _a.clone().cross(ux).normalize();
    const base = this.n, P = o.uvLen || this.period, slope = (r0 - r1) / len;
    for (let k = 0; k <= 1; k++) for (let i = 0; i <= segs; i++) {
      const ang = i / segs * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
      const nx = ux.x * ca + vx.x * sa, ny = ux.y * ca + vx.y * sa, nz = ux.z * ca + vx.z * sa;
      const rr = k ? r1 : r0, x = (k ? x1 : x0) + nx * rr, y = (k ? y1 : y0) + ny * rr, z = (k ? z1 : z0) + nz * rr;
      let cr = c[0], cg = c[1], cb = c[2]; if (f) { const s = f(x, y, z); if (typeof s === 'number') { cr *= s; cg *= s; cb *= s; } else { cr *= s[0]; cg *= s[1]; cb *= s[2]; } }
      // tilt the normal for tapered cylinders
      const tx = nx + _a.x * slope, ty = ny + _a.y * slope, tz = nz + _a.z * slope, tl = Math.hypot(tx, ty, tz) || 1;
      this.vert(x, y, z, tx / tl, ty / tl, tz / tl, i / segs * (o.uRep || 1) * Math.max(1, Math.round(r0 * 6.283 / P * 2) / 2 || 1), k * len / P, cr, cg, cb);
    }
    const w = segs + 1;
    for (let i = 0; i < segs; i++) { const a = base + i, b = a + 1, c2 = a + w, d = c2 + 1; this.idx.push(a, c2, b, b, c2, d); }
    if (o.cap) for (let k = 0; k <= 1; k++) {
      const sgn = k ? 1 : -1, cx = k ? x1 : x0, cy = k ? y1 : y0, cz = k ? z1 : z0, rr = k ? r1 : r0;
      const ci = this.vert(cx, cy, cz, _a.x * sgn, _a.y * sgn, _a.z * sgn, 0.5, 0.5, c[0], c[1], c[2]); const b0 = this.n;
      for (let i = 0; i <= segs; i++) { const ang = i / segs * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang); this.vert(cx + (ux.x * ca + vx.x * sa) * rr, cy + (ux.y * ca + vx.y * sa) * rr, cz + (ux.z * ca + vx.z * sa) * rr, _a.x * sgn, _a.y * sgn, _a.z * sgn, 0.5 + ca * 0.5, 0.5 + sa * 0.5, c[0], c[1], c[2]); }
      for (let i = 0; i < segs; i++) { if (k) this.idx.push(ci, b0 + i, b0 + i + 1); else this.idx.push(ci, b0 + i + 1, b0 + i); }
    }
  }

  // merge an existing THREE geometry with a matrix and colour tint
  addGeometry(geo, m, c = [1, 1, 1], uvOff = null) {
    const p = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv, base = this.n;
    const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m); n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
      this.vert(v.x, v.y, v.z, n.x, n.y, n.z, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, c[0], c[1], c[2]);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i)); else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  get empty() { return this.n === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// Grime / ambient-occlusion multiplier for vertex colours: darker at floor & ceiling junctions, blotchy dirt.
export function grimeF(opts = {}) {
  const floorY = opts.floorY ?? 0, ceilY = opts.ceilY ?? 7, dirt = opts.dirt ?? 0.35, low = opts.low ?? 0.5, hi = opts.hi ?? 0.4, seed = opts.seed ?? 0;
  return (x, y, z) => {
    const n = fbm3(x * 0.35 + seed, y * 0.3, z * 0.35 - seed);
    let k = 1 - dirt * (n * 1.4 - 0.3);
    const dy = y - floorY; if (dy < 1.0) k *= 1 - low * Math.pow(1 - Math.max(0, dy) / 1.0, 2) * (0.6 + 0.6 * n);
    const dc = ceilY - y; if (dc < 1.6) k *= 1 - hi * Math.pow(1 - Math.max(0, dc) / 1.6, 2);
    return Math.max(0.12, k);
  };
}
