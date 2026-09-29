// Ribbon "segment" renderers: bullet tracers (fully GPU time-animated ring buffer) and lightning beams (CPU-jittered polylines).
import * as THREE from 'three';

const additive = (mat) => { mat.blending = THREE.CustomBlending; mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneFactor; mat.blendEquation = THREE.AddEquation; mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneFactor; return mat; };
const quadGeo = () => {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]); return g;
};
const attr = (g, name, n, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };

// ---------------------------------------------------------------------------------------------------------- tracers
const TVERT = /* glsl */`
attribute vec3 tA; attribute vec3 tB; attribute vec4 tP; attribute vec4 tC;
uniform float uTime;
varying vec2 vQ; varying vec4 vC; varying vec2 vLen;
void main() {
  float T = uTime - tP.x; float k = T / tP.y;
  if (k < 0.0 || k > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vQ = vec2(0.0); vC = vec4(0.0); vLen = vec2(0.0); return; }
  vec3 dv = tB - tA; float L = length(dv); vec3 d = dv / max(L, 1e-4);
  float S = min(tP.w, L);
  float run = k * (L + S); float s1 = min(run, L); float s0 = clamp(run - S, 0.0, L);
  vec3 h3 = tA + d * s1; vec3 t3 = tA + d * s0; vec3 mid = 0.5 * (h3 + t3);
  float dist = length(cameraPosition - mid);
  float w = clamp(tP.z, dist * 0.0017, max(dist * 0.008, dist * 0.0017));
  float len = s1 - s0; float cap = w * 3.0;
  float x = position.x + 0.5;
  vec3 toCam = normalize(cameraPosition - mid); vec3 side = cross(d, toCam); float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
  vec3 wp = t3 + d * (x * (len + cap)) + side * position.y * w * 4.0;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vQ = vec2(x * (len + cap) / w, position.y * 4.0); vLen = vec2(len / w, 1.0 - smoothstep(0.65, 1.0, k));
  vC = tC;
}`;
const TFRAG = /* glsl */`
varying vec2 vQ; varying vec4 vC; varying vec2 vLen;
void main() {
  float y = vQ.y; float xh = vQ.x - vLen.x;
  float tailT = clamp(vQ.x / max(vLen.x, 0.001), 0.0, 1.0);
  float body = pow(tailT, 1.7) * (1.0 - smoothstep(-0.15, 0.25, xh));
  float core = exp(-y * y * 2.4); float halo = 0.22 * exp(-y * y * 0.3);
  float hx = max(xh, 0.0);
  float head = exp(-(hx * hx * 0.9 + y * y * 0.55)) * step(-0.6, xh);
  float a = body * (core + halo) + head * 1.15;
  vec3 col = mix(vC.rgb, vec3(1.0), clamp(core * body * 0.55 + head * 0.7, 0.0, 1.0));
  gl_FragColor = vec4(col * (a * vC.a * vLen.y), 1.0);
}`;

export const TRACER_STYLES = {
  // r, g, b, intensity, width (m), tail length (m), speed (m/s), max life (s)
  // Player tracers are deliberately slower than a real bullet (~1/3): fired along the view axis a fast tracer is a 1-frame dot; at ~200 m/s the streak
  // stays on screen for ~5 frames (80 ms) while it flies from the muzzle to the crosshair.
  bullet: [1.0, 0.78, 0.4, 3.6, 0.032, 9.0, 200, 0.26],
  shotgun: [1.0, 0.68, 0.3, 3.0, 0.026, 6.0, 170, 0.24],
  chaingun: [1.0, 0.8, 0.42, 3.8, 0.036, 10.0, 220, 0.26],
  enemy: [1.0, 0.32, 0.08, 3.4, 0.05, 4.0, 150, 0.4],
  trooper: [1.0, 0.36, 0.1, 3.6, 0.055, 4.5, 140, 0.4],
  plasma: [0.3, 0.6, 1.0, 4.0, 0.075, 3.0, 220, 0.2],
};

export class TracerBatch {
  constructor(scene, uTime, cap = 448) {
    this.cap = cap; this.next = 0; this.uTime = uTime; this.dirty = false;
    const g = quadGeo();
    this.aA = attr(g, 'tA', cap, 3); this.aB = attr(g, 'tB', cap, 3); this.aP = attr(g, 'tP', cap, 4); this.aC = attr(g, 'tC', cap, 4);
    for (let i = 0; i < cap; i++) this.aP.array[i * 4 + 1] = 1; // life 1, t0 = 0 -> expired at time > 1 (reset() pushes t0 far into the past)
    g.instanceCount = cap;
    const mat = additive(new THREE.ShaderMaterial({ uniforms: { uTime }, vertexShader: TVERT, fragmentShader: TFRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; scene.add(this.mesh);
  }
  add(now, ax, ay, az, bx, by, bz, style) {
    const s = TRACER_STYLES[style] || TRACER_STYLES.bullet, i = this.next; this.next = (this.next + 1) % this.cap;
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.sqrt(dx * dx + dy * dy + dz * dz), S = Math.min(s[5], L);
    const life = Math.min(s[7], Math.max(0.055, (L + S) / s[6]));
    const k3 = i * 3, k4 = i * 4;
    this.aA.array[k3] = ax; this.aA.array[k3 + 1] = ay; this.aA.array[k3 + 2] = az; this.aB.array[k3] = bx; this.aB.array[k3 + 1] = by; this.aB.array[k3 + 2] = bz;
    this.aP.array[k4] = now; this.aP.array[k4 + 1] = life; this.aP.array[k4 + 2] = s[4]; this.aP.array[k4 + 3] = s[5];
    this.aC.array[k4] = s[0]; this.aC.array[k4 + 1] = s[1]; this.aC.array[k4 + 2] = s[2]; this.aC.array[k4 + 3] = s[3];
    this.dirty = true;
  }
  clear() { for (let i = 0; i < this.cap; i++) { this.aP.array[i * 4] = -1e6; this.aP.array[i * 4 + 1] = 1; } this.dirty = true; }
  flush() { if (!this.dirty) return; this.dirty = false; this.aA.needsUpdate = this.aB.needsUpdate = this.aP.needsUpdate = this.aC.needsUpdate = true; }
}

// ---------------------------------------------------------------------------------------------------------- beams
const BVERT = /* glsl */`
attribute vec3 bA; attribute vec3 bB; attribute vec4 bP; attribute vec4 bC;
varying vec2 vQ; varying vec4 vC; varying float vE;
void main() {
  if (bP.y <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vQ = vec2(0.0); vC = vec4(0.0); vE = 0.0; return; }
  vec3 dv = bB - bA; float L = length(dv); vec3 d = dv / max(L, 1e-4); vec3 mid = 0.5 * (bA + bB);
  float dist = length(cameraPosition - mid); float w = max(bP.x, dist * 0.002);
  vec3 toCam = normalize(cameraPosition - mid); vec3 side = cross(d, toCam); float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
  float x = position.x + 0.5; float along = x * (L + 2.0 * w) - w;
  vec3 wp = bA + d * along + side * position.y * w * 5.0;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vQ = vec2(along, position.y * 5.0); vE = max(max(-along, along - L), 0.0) / w; vC = vec4(bC.rgb * bC.w, bP.y);
  vC.a = bP.y;
}`;
const BFRAG = /* glsl */`
varying vec2 vQ; varying vec4 vC; varying float vE;
void main() {
  float y = vQ.y; float core = exp(-y * y * 3.0); float halo = 0.3 * exp(-y * y * 0.35);
  float cap = exp(-vE * vE * 1.6);
  float a = (core + halo) * cap * vC.a;
  vec3 col = mix(vC.rgb, vec3(1.0), core * 0.6);
  gl_FragColor = vec4(col * a, 1.0);
}`;

const SEG_PER_BEAM = 14; // 10 main + 2 forks x 2

export class BeamBatch {
  constructor(scene, beams = 40) {
    this.nBeams = beams; this.cap = beams * SEG_PER_BEAM; this.dirty = false;
    const g = quadGeo();
    this.aA = attr(g, 'bA', this.cap, 3); this.aB = attr(g, 'bB', this.cap, 3); this.aP = attr(g, 'bP', this.cap, 4); this.aC = attr(g, 'bC', this.cap, 4);
    g.instanceCount = this.cap;
    const mat = additive(new THREE.ShaderMaterial({ vertexShader: BVERT, fragmentShader: BFRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; scene.add(this.mesh);
    const n = beams;
    this.ax = new Float32Array(n * 3); this.bx = new Float32Array(n * 3);
    this.age = new Float32Array(n); this.life = new Float32Array(n); this.width = new Float32Array(n); this.amp = new Float32Array(n);
    this.col = new Float32Array(n * 4); this.tick = new Float32Array(n); this.active = new Uint8Array(n); this.seed = new Float32Array(n);
    this.next = 0;
    // scratch
    this._u = new THREE.Vector3(); this._v = new THREE.Vector3(); this._d = new THREE.Vector3(); this._p = new THREE.Vector3(); this._q = new THREE.Vector3();
  }
  add(ax, ay, az, bx, by, bz, life, width, r, g, b, intensity, amp) {
    const i = this.next; this.next = (this.next + 1) % this.nBeams;
    this.ax[i * 3] = ax; this.ax[i * 3 + 1] = ay; this.ax[i * 3 + 2] = az; this.bx[i * 3] = bx; this.bx[i * 3 + 1] = by; this.bx[i * 3 + 2] = bz;
    this.age[i] = 0; this.life[i] = life; this.width[i] = width; this.amp[i] = amp; this.tick[i] = 1e9; this.active[i] = 1;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = intensity;
  }
  clear() { this.active.fill(0); this.aP.array.fill(0); this.dirty = true; }
  _seg(k, ax, ay, az, bx, by, bz, w, a, i) {
    const A = this.aA.array, B = this.aB.array, P = this.aP.array, C = this.aC.array, k3 = k * 3, k4 = k * 4;
    A[k3] = ax; A[k3 + 1] = ay; A[k3 + 2] = az; B[k3] = bx; B[k3 + 1] = by; B[k3 + 2] = bz;
    P[k4] = w; P[k4 + 1] = a; C[k4] = this.col[i * 4]; C[k4 + 1] = this.col[i * 4 + 1]; C[k4 + 2] = this.col[i * 4 + 2]; C[k4 + 3] = this.col[i * 4 + 3];
  }
  update(dt) {
    const u = this._u, v = this._v, d = this._d, p = this._p, q = this._q, P = this.aP.array;
    for (let i = 0; i < this.nBeams; i++) {
      if (!this.active[i]) continue;
      const base = i * SEG_PER_BEAM;
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) { this.active[i] = 0; for (let s = 0; s < SEG_PER_BEAM; s++) P[(base + s) * 4 + 1] = 0; this.dirty = true; continue; }
      this.dirty = true;
      const alpha = Math.pow(1 - t, 0.8) * (t < 0.08 ? 0.6 + t * 5 : 1), w = this.width[i] * (1 - t * 0.5);
      this.tick[i] += dt;
      if (this.tick[i] >= 0.04) { // re-jitter ~25 Hz
        this.tick[i] = 0;
        const ax = this.ax[i * 3], ay = this.ax[i * 3 + 1], az = this.ax[i * 3 + 2], bx = this.bx[i * 3], by = this.bx[i * 3 + 1], bz = this.bx[i * 3 + 2];
        d.set(bx - ax, by - ay, bz - az); const L = d.length(); d.multiplyScalar(1 / Math.max(L, 1e-4));
        if (Math.abs(d.y) > 0.95) u.set(1, 0, 0); else u.set(0, 1, 0);
        u.cross(d).normalize(); v.crossVectors(d, u);
        const amp = this.amp[i];
        let px = ax, py = ay, pz = az;
        for (let s = 1; s <= 10; s++) {
          const f = s / 10, env = Math.sin(Math.PI * f), j1 = (Math.random() - 0.5) * 2 * amp * env, j2 = (Math.random() - 0.5) * 2 * amp * env;
          const nx = s === 10 ? bx : ax + (bx - ax) * f + u.x * j1 + v.x * j2, ny = s === 10 ? by : ay + (by - ay) * f + u.y * j1 + v.y * j2, nz = s === 10 ? bz : az + (bz - az) * f + u.z * j1 + v.z * j2;
          this._seg(base + s - 1, px, py, pz, nx, ny, nz, w, alpha, i);
          if (s === 3 || s === 7) { // fork: 2 short segments off this node
            const fk = (s === 3 ? 10 : 12) + base;
            const fl = amp * (1.2 + Math.random()) + 0.2, s1 = (Math.random() - 0.5) * 2, s2 = (Math.random() - 0.5) * 2;
            p.set(nx + (u.x * s1 + v.x * s2 + d.x * 0.6) * fl, ny + (u.y * s1 + v.y * s2 + d.y * 0.6) * fl, nz + (u.z * s1 + v.z * s2 + d.z * 0.6) * fl);
            q.set((nx + p.x) * 0.5 + (Math.random() - 0.5) * fl * 0.4, (ny + p.y) * 0.5 + (Math.random() - 0.5) * fl * 0.4, (nz + p.z) * 0.5 + (Math.random() - 0.5) * fl * 0.4);
            this._seg(fk, nx, ny, nz, q.x, q.y, q.z, w * 0.6, alpha * 0.7, i);
            this._seg(fk + 1, q.x, q.y, q.z, p.x, p.y, p.z, w * 0.45, alpha * 0.55, i);
          }
          px = nx; py = ny; pz = nz;
        }
      } else { // just fade
        for (let s = 0; s < SEG_PER_BEAM; s++) { const k4 = (base + s) * 4; if (P[k4 + 1] > 0) { P[k4 + 1] = alpha * (s < 10 ? 1 : (s === 10 || s === 12 ? 0.7 : 0.55)); P[k4] = w * (s < 10 ? 1 : 0.55); } }
      }
    }
    if (this.dirty) { this.dirty = false; this.aA.needsUpdate = this.aB.needsUpdate = this.aP.needsUpdate = this.aC.needsUpdate = true; }
  }
}
