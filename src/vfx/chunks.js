// Instanced rigid chunks (gibs, debris, shell casings) with gravity, spin, floor bounce. Allocation-free update loop.
import * as THREE from 'three';
import { floorY } from './particles.js';

const ST = 24;
const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, QX = 6, QY = 7, QZ = 8, QW = 9, WX = 10, WY = 11, WZ = 12, SX = 13, SY = 14, SZ = 15,
  AGE = 16, LIFE = 17, GRAV = 18, BOUNCE = 19, RAD = 20, FLAGS = 21, TRAIL = 22;
export const C_LANDED = 1, C_BOUNCED = 2, C_TRAIL = 4, C_LIE = 8;

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class ChunkSystem {
  constructor(scene, geometry, material, capacity, { renderOrder = 0 } = {}) {
    this.cap = capacity; this.n = 0; this.d = new Float32Array(capacity * ST);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
    this.onBounce = null; this.onTrail = null; this.next = 0;
  }

  // Spawn one chunk. Returns false if the pool is full and the oldest could not be recycled.
  emit(x, y, z, vx, vy, vz, sx, sy, sz, wx, wy, wz, life, grav, bounce, rad, r, g, b, flags = 0) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else { i = this.next; this.next = (this.next + 1) % this.cap; } // recycle oldest slot
    const d = this.d, o = i * ST;
    d[o + PX] = x; d[o + PY] = y; d[o + PZ] = z; d[o + VX] = vx; d[o + VY] = vy; d[o + VZ] = vz;
    _q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    d[o + QX] = _q.x; d[o + QY] = _q.y; d[o + QZ] = _q.z; d[o + QW] = _q.w;
    d[o + WX] = wx; d[o + WY] = wy; d[o + WZ] = wz; d[o + SX] = sx; d[o + SY] = sy; d[o + SZ] = sz;
    d[o + AGE] = 0; d[o + LIFE] = life; d[o + GRAV] = grav; d[o + BOUNCE] = bounce; d[o + RAD] = rad; d[o + FLAGS] = flags; d[o + TRAIL] = 0;
    const c = this.mesh.instanceColor.array; c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
    return true;
  }

  clear() { this.n = 0; this.next = 0; this.mesh.count = 0; }

  update(dt) {
    const d = this.d, mat = this.mesh.instanceMatrix.array, col = this.mesh.instanceColor.array;
    let n = this.n;
    for (let i = 0; i < n;) {
      const o = i * ST, age = d[o + AGE] + dt; d[o + AGE] = age;
      const life = d[o + LIFE];
      if (age >= life) { // remove: move last into i (including colour)
        n--; if (i !== n) { d.copyWithin(o, n * ST, n * ST + ST); col[i * 3] = col[n * 3]; col[i * 3 + 1] = col[n * 3 + 1]; col[i * 3 + 2] = col[n * 3 + 2]; }
        continue;
      }
      let fl = d[o + FLAGS] | 0;
      let x = d[o + PX], y = d[o + PY], z = d[o + PZ];
      if (!(fl & C_LANDED)) {
        let vx = d[o + VX], vy = d[o + VY], vz = d[o + VZ];
        vy -= d[o + GRAV] * dt;
        x += vx * dt; y += vy * dt; z += vz * dt;
        const rad = d[o + RAD], fy = floorY(x, z) + rad;
        // station walls / ceiling (cheap clamps)
        if (z > 11.3) { z = 11.3; vz = -Math.abs(vz) * 0.4; } else if (z < -11.3) { z = -11.3; vz = Math.abs(vz) * 0.4; }
        if (y > 6.8) { y = 6.8; vy = -Math.abs(vy) * 0.3; }
        if (y < fy) {
          y = fy;
          const sp = -vy;
          if (sp > 0.6 && !(fl & C_BOUNCED) || sp > 1.8) { if (this.onBounce) this.onBounce(i, x, y, z, sp, (fl & C_BOUNCED) === 0); }
          fl |= C_BOUNCED;
          vy = sp > 0.5 ? sp * d[o + BOUNCE] : 0;
          vx *= 0.62; vz *= 0.62; d[o + WX] *= 0.6; d[o + WY] *= 0.6; d[o + WZ] *= 0.6;
          if (vy < 0.5 && Math.abs(vx) + Math.abs(vz) < 0.7) { fl |= C_LANDED; vx = vy = vz = 0; d[o + WX] = d[o + WY] = d[o + WZ] = 0; }
          if (fl & C_LIE) { // settle casings on their side
            _q.set(d[o + QX], d[o + QY], d[o + QZ], d[o + QW]);
            _a.set(0, 1, 0).applyQuaternion(_q); // cylinder axis
            if (Math.abs(_a.y) > 0.05) {
              _b.set(_a.x, 0, _a.z); if (_b.lengthSq() < 1e-6) _b.set(1, 0, 0); _b.normalize();
              _q2.setFromUnitVectors(_a, _b); _q3.identity().slerp(_q2, (fl & C_LANDED) ? 1 : 0.55); _q.premultiply(_q3);
              d[o + QX] = _q.x; d[o + QY] = _q.y; d[o + QZ] = _q.z; d[o + QW] = _q.w;
            }
          }
        }
        d[o + VX] = vx; d[o + VY] = vy; d[o + VZ] = vz; d[o + PX] = x; d[o + PY] = y; d[o + PZ] = z; d[o + FLAGS] = fl;
        // spin
        const wx = d[o + WX], wy = d[o + WY], wz = d[o + WZ];
        if (wx !== 0 || wy !== 0 || wz !== 0) {
          const hx = wx * dt * 0.5, hy = wy * dt * 0.5, hz = wz * dt * 0.5;
          const qx = d[o + QX], qy = d[o + QY], qz = d[o + QZ], qw = d[o + QW];
          let nx = qx + hx * qw + hy * qz - hz * qy, ny = qy + hy * qw + hz * qx - hx * qz, nz = qz + hz * qw + hx * qy - hy * qx, nw = qw - hx * qx - hy * qy - hz * qz;
          const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
          d[o + QX] = nx * il; d[o + QY] = ny * il; d[o + QZ] = nz * il; d[o + QW] = nw * il;
        }
        if ((fl & C_TRAIL) && this.onTrail) { const tt = d[o + TRAIL] + dt; if (tt > 0.05) { d[o + TRAIL] = 0; if (age < 1.1 && !(fl & C_LANDED)) this.onTrail(x, y, z, vx, vy, vz); } else d[o + TRAIL] = tt; }
      }
      // matrix compose (rotation quaternion * scale, translation)
      const qx = d[o + QX], qy = d[o + QY], qz = d[o + QZ], qw = d[o + QW];
      const fade = life - age < 0.5 ? (life - age) * 2 : 1;
      const sx = d[o + SX] * fade, sy = d[o + SY] * fade, sz = d[o + SZ] * fade;
      const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz, xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2, wx2 = qw * x2, wy2 = qw * y2, wz2 = qw * z2;
      const m = i * 16;
      mat[m] = (1 - (yy + zz)) * sx; mat[m + 1] = (xy + wz2) * sx; mat[m + 2] = (xz - wy2) * sx; mat[m + 3] = 0;
      mat[m + 4] = (xy - wz2) * sy; mat[m + 5] = (1 - (xx + zz)) * sy; mat[m + 6] = (yz + wx2) * sy; mat[m + 7] = 0;
      mat[m + 8] = (xz + wy2) * sz; mat[m + 9] = (yz - wx2) * sz; mat[m + 10] = (1 - (xx + yy)) * sz; mat[m + 11] = 0;
      mat[m + 12] = d[o + PX]; mat[m + 13] = d[o + PY]; mat[m + 14] = d[o + PZ]; mat[m + 15] = 1;
      i++;
    }
    this.n = n; this.mesh.count = n;
    if (n > 0) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
  }
}

// Deterministically jittered convex-ish lump geometry (non-indexed, flat normals)
export function lumpGeometry(kind, seed = 1, jitter = 0.28) {
  let g = kind === 'box' ? new THREE.BoxGeometry(1, 1, 1, 1, 1, 1) : new THREE.IcosahedronGeometry(0.5, kind === 'rock' ? 0 : 1);
  g = g.index ? g.toNonIndexed() : g;
  const p = g.attributes.position, key = new Map();
  const h = (x, y, z, s) => { let n = Math.imul((x * 1000) | 0, 73856093) ^ Math.imul((y * 1000) | 0, 19349663) ^ Math.imul((z * 1000) | 0, 83492791) ^ Math.imul(s + seed, 2654435761); n = Math.imul(n ^ (n >>> 15), 2246822507); n ^= n >>> 13; return ((n >>> 0) / 4294967296 - 0.5) * 2; };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let j = key.get(k); if (!j) { j = [h(x, y, z, 1), h(x, y, z, 2), h(x, y, z, 3), 1 + h(x, y, z, 4) * 0.25]; key.set(k, j); }
    p.setXYZ(i, (x + j[0] * jitter * 0.5) * j[3], (y + j[1] * jitter * 0.5) * j[3], (z + j[2] * jitter * 0.5) * j[3]);
  }
  g.computeVertexNormals();
  return g;
}
