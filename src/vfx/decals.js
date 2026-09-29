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
  float fade = 1.0 - smoothstep(dTime.z - dTime.w, dTime.z, T);
  float sz = dNrm.w * (0.25 + 0.75 * smoothstep(0.0, 0.18, T));
  vec3 n = normalize(dNrm.xyz);
  vec3 t = normalize(cross(abs(n.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), n)); vec3 b = cross(n, t);
  float cs = cos(dPos.w), sn = sin(dPos.w);
  vec2 q = position.xy; vec2 r = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y) * sz;
  vec3 wp = dPos.xyz + n * 0.006 + t * r.x + b * r.y;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float f = dTime.x; vec2 tile = vec2(mod(f, 4.0), floor(f / 4.0));
  vUv = (tile + q + 0.5) * 0.25; vTint = vec4(dTint.rgb, dTint.a * fade);
  #include <fog_vertex>
}`;
const FRAG = /* glsl */`
uniform sampler2D uMap; varying vec2 vUv; varying vec4 vTint;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(vTint.rgb * t.rgb, t.a * vTint.a);
  #include <fog_fragment>
}`;

// Ring layout: [holes | blood | scorch]
export const DECAL_RINGS = { hole: 0, blood: 1, scorch: 2 };

export class DecalBatch {
  constructor(scene, atlas, uTime, { holes = 120, blood = 72, scorch = 24 } = {}) {
    this.ranges = [[0, holes], [holes, holes + blood], [holes + blood, holes + blood + scorch]];
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
    const rg = this.ranges[ring], lo = rg[0], hi = rg[1], i = lo + this.next[ring]; this.next[ring] = (this.next[ring] + 1) % (hi - lo);
    const k = i * 4;
    this.aPos.array[k] = px; this.aPos.array[k + 1] = py; this.aPos.array[k + 2] = pz; this.aPos.array[k + 3] = rot;
    this.aNrm.array[k] = nx; this.aNrm.array[k + 1] = ny; this.aNrm.array[k + 2] = nz; this.aNrm.array[k + 3] = size;
    this.aTint.array[k] = r; this.aTint.array[k + 1] = g; this.aTint.array[k + 2] = b; this.aTint.array[k + 3] = a;
    this.aTime.array[k] = frame; this.aTime.array[k + 1] = now; this.aTime.array[k + 2] = life; this.aTime.array[k + 3] = fade;
    this.dirty = true;
  }

  clear() { this.aTime.array.fill(0); this.next[0] = this.next[1] = this.next[2] = 0; this.dirty = true; }

  flush() {
    if (!this.dirty) return; this.dirty = false;
    this.aPos.needsUpdate = true; this.aNrm.needsUpdate = true; this.aTint.needsUpdate = true; this.aTime.needsUpdate = true;
  }
}
