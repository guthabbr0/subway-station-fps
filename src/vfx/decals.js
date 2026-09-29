// Pooled surface decals (bullet holes, blood stains, scorch marks): one instanced draw call, fades handled on the GPU by time.
import * as THREE from 'three';

const VERT = /* glsl */`
attribute vec4 dPos; attribute vec4 dNrm; attribute vec4 dTint; attribute vec4 dTime;
uniform float uTime;
varying vec2 vUv; varying vec4 vTint;
#include <fog_pars_vertex>
void main() {
  float T = uTime - dTime.y;
  if (dTime.z <= 0.0 || T < 0.0 || T > dTime.z) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUv = vec2(0.0); vTint = vec4(0.0); return; }
  float fade = 1.0 - smoothstep(dTime.z - max(dTime.w, 1e-3), dTime.z, T);
  float sz = dNrm.w * (0.25 + 0.75 * smoothstep(0.0, 0.18, T));
  vec3 n = dNrm.xyz / max(length(dNrm.xyz), 1e-4);
  vec3 t0 = cross(abs(n.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), n); vec3 t = t0 / max(length(t0), 1e-4); vec3 b = cross(n, t);
  float cs = cos(dPos.w), sn = sin(dPos.w);
  vec2 q = position.xy; vec2 r = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y) * sz;
  vec3 wp = dPos.xyz + n * 0.006 + t * r.x + b * r.y;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float f = floor(dTime.x + 0.5); vec2 tile = vec2(mod(f, 4.0), floor(f / 4.0));
  vUv = (tile + q + 0.5) * 0.25; vTint = vec4(dTint.rgb, dTint.a * fade);
  #include <fog_vertex>
}`;
const FRAG = /* glsl */`
uniform sampler2D uMap; varying vec2 vUv; varying vec4 vTint;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(min(max(vec3(0.0), vTint.rgb * t.rgb), vec3(1024.0)), clamp(t.a * vTint.a, 0.0, 1.0));
  #include <fog_fragment>
}`;

// Ring layout: [holes | blood | scorch]
export const DECAL_RINGS = { hole: 0, blood: 1, scorch: 2 };

export class DecalBatch {
  constructor(scene, atlas, uTime, { holes = 120, blood = 72, scorch = 24 } = {}) {
    this.ranges = [[0, holes], [holes, holes + blood], [holes + blood, holes + blood + scorch]]; this.full = [holes, blood, scorch]; this.sizes = this.full.slice();
    this.next = [0, 0, 0]; this.cap = holes + blood + scorch; this.dirty = false;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (name) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 4), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.aPos = mk('dPos'); this.aNrm = mk('dNrm'); this.aTint = mk('dTint'); this.aTime = mk('dTime');
    g.instanceCount = this.cap;
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), { uMap: { value: atlas }, uTime }),
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; scene.add(this.mesh);
  }

  add(ring, now, px, py, pz, nx, ny, nz, size, frame, r, g, b, a, life, fade, rot) {
    // callers pass hit normals / positions from raycasts and weapons: a zero-length normal or a non-finite value would become NaN vertex positions (garbage geometry on real GPUs)
    if (!Number.isFinite(px + py + pz + size + r + g + b + a + life + fade + rot)) return;
    const nl = nx * nx + ny * ny + nz * nz;
    if (nl > 1e-8 && Number.isFinite(nl)) { const il = 1 / Math.sqrt(nl); nx *= il; ny *= il; nz *= il; } else { nx = 0; ny = 1; nz = 0; }
    const lo = this.ranges[ring][0], n = this.sizes[ring], i = lo + this.next[ring]; this.next[ring] = (this.next[ring] + 1) % n;
    const k = i * 4;
    this.aPos.array[k] = px; this.aPos.array[k + 1] = py; this.aPos.array[k + 2] = pz; this.aPos.array[k + 3] = rot;
    this.aNrm.array[k] = nx; this.aNrm.array[k + 1] = ny; this.aNrm.array[k + 2] = nz; this.aNrm.array[k + 3] = size;
    this.aTint.array[k] = r; this.aTint.array[k + 1] = g; this.aTint.array[k + 2] = b; this.aTint.array[k + 3] = a;
    this.aTime.array[k] = frame; this.aTime.array[k + 1] = now; this.aTime.array[k + 2] = life; this.aTime.array[k + 3] = fade;
    this.dirty = true;
  }

  // quality controller: shrink the ring buffers (older decals beyond the smaller ring just fade out on their own schedule)
  setBudget(k) { this.sizes = this.full.map((n) => Math.max(4, Math.floor(n * k))); for (let r = 0; r < 3; r++) this.next[r] %= this.sizes[r]; }

  clear() { this.aTime.array.fill(0); this.next[0] = this.next[1] = this.next[2] = 0; this.dirty = true; }

  flush() {
    if (!this.dirty) return; this.dirty = false;
    this.aPos.needsUpdate = true; this.aNrm.needsUpdate = true; this.aTint.needsUpdate = true; this.aTime.needsUpdate = true;
  }
}
