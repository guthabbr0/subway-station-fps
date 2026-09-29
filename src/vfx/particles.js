// Instanced billboard particle batch (CPU simulated, GPU expanded). Two instances are used by vfx.js: additive + alpha.
// All state lives in typed arrays; emit()/update() never allocate.
import * as THREE from 'three';
import { LAYOUT } from '../core.js';

export const F_KILL = 1, F_BOUNCE = 2, F_STAIN = 4, F_LIFT = 8;
export const MODE_BILL = 0, MODE_STREAK = 1, MODE_PLANE = 2;

const ST = 36;
const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, AGE = 6, LIFE = 7, GRAV = 8, DRAG = 9, SX0 = 10, SY0 = 11, SX1 = 12, SY1 = 13, ROT = 14, ROTV = 15,
  R0 = 16, G0 = 17, B0 = 18, A0 = 19, R1 = 20, G1 = 21, B1 = 22, A1 = 23, FRAME = 24, MODE = 25, FLAGS = 26, FADEIN = 27, DX = 28, DY = 29, DZ = 30, STRETCH = 31, APOW = 32, SPOW = 33, BOUNCE = 34;

// Cheap analytic floor for the station: platform top at y=0, everything else is track bed.
export function floorY(x, z) {
  const P = LAYOUT.platform;
  return (x >= P.x0 && x <= P.x1 && z >= -P.halfW && z <= P.halfW) ? 0 : LAYOUT.bedY;
}

const VERT = /* glsl */`
attribute vec4 iPosRot; attribute vec4 iColor; attribute vec4 iParams; attribute vec3 iDir;
varying vec2 vUv; varying vec4 vColor; varying float vNear;
#include <fog_pars_vertex>
void main() {
  vec3 c = iPosRot.xyz; vec2 q = position.xy; vec2 uvl = q + 0.5; float mode = iParams.w; vec3 wp;
  if (mode < 0.5) {
    float cs = cos(iPosRot.w), sn = sin(iPosRot.w);
    vec2 r = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y) * iParams.xy;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    wp = c + right * r.x + up * r.y;
  } else if (mode < 1.5) {
    float sp = length(iDir); vec3 d = iDir / max(sp, 1e-4);
    float len = iParams.x + sp * iPosRot.w;
    vec3 toCam = normalize(cameraPosition - c); vec3 side = cross(d, toCam); float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
    wp = c + d * (uvl.x - 0.8) * len + side * q.y * iParams.y;
  } else {
    vec3 n = normalize(iDir); vec3 t = normalize(cross(abs(n.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), n)); vec3 b = cross(n, t);
    float cs = cos(iPosRot.w), sn = sin(iPosRot.w);
    vec2 r = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y) * iParams.xy;
    wp = c + t * r.x + b * r.y;
  }
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float f = iParams.z; vec2 tile = vec2(mod(f, 4.0), floor(f / 4.0));
  vUv = (tile + uvl) * 0.25; vColor = iColor;
  vNear = mode < 0.5 ? smoothstep(0.15, 0.5 + 0.3 * max(iParams.x, iParams.y), -mvPosition.z) : 1.0;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap; varying vec2 vUv; varying vec4 vColor; varying float vNear;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv); float a = t.a * vColor.a * vNear;
  #ifdef ADDITIVE
    vec3 col = vColor.rgb * t.rgb * a;
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float fogF = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      col *= 1.0 - fogF * 0.85;
    #endif
    gl_FragColor = vec4(col, 1.0);
  #else
    gl_FragColor = vec4(vColor.rgb * t.rgb, a);
    #include <fog_fragment>
  #endif
}`;

export class BillboardBatch {
  constructor(scene, { atlas, additive, capacity, renderOrder = 3 }) {
    this.cap = this.capMax = capacity; this.n = 0; this.d = new Float32Array(capacity * ST);
    this.onStain = null; this.audioHook = null;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (name, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.aPos = mk('iPosRot', 4); this.aCol = mk('iColor', 4); this.aPar = mk('iParams', 4); this.aDir = mk('iDir', 3);
    this.attrs = [this.aPos, this.aCol, this.aPar, this.aDir]; this.ranges = [{ start: 0, count: 0 }, { start: 0, count: 0 }, { start: 0, count: 0 }, { start: 0, count: 0 }];
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), { uMap: { value: atlas } }),
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      defines: additive ? { ADDITIVE: '' } : {},
    });
    if (additive) { mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneFactor; mat.blendEquation = THREE.AddEquation; mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneFactor; }
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder; this.geo = g;
    scene.add(this.mesh);
    // reusable emit descriptor
    this.p = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, delay: 0, grav: 0, drag: 0, s0: 1, s1: 1, sy0: 0, sy1: 0, rot: 0, rotV: 0, r0: 1, g0: 1, b0: 1, a0: 1, r1: 1, g1: 1, b1: 1, a1: 0, frame: 0, mode: 0, flags: 0, fadeIn: 0, dx: 0, dy: 1, dz: 0, stretch: 0, apow: 1, spow: 2, bounce: 0.4 };
  }

  // Reset the shared descriptor to defaults and return it. Fill fields, then call emit().
  begin() {
    const p = this.p;
    p.x = p.y = p.z = p.vx = p.vy = p.vz = 0; p.life = 1; p.delay = 0; p.grav = 0; p.drag = 0; p.s0 = p.s1 = 1; p.sy0 = p.sy1 = 0; p.rot = p.rotV = 0;
    p.r0 = p.g0 = p.b0 = p.a0 = 1; p.r1 = p.g1 = p.b1 = 1; p.a1 = 0; p.frame = 0; p.mode = 0; p.flags = 0; p.fadeIn = 0; p.dx = 0; p.dy = 1; p.dz = 0; p.stretch = 0; p.apow = 1; p.spow = 2; p.bounce = 0.4;
    return p;
  }

  emit() {
    if (this.n >= this.cap) return false;
    const p = this.p, d = this.d, o = this.n++ * ST;
    d[o + PX] = p.x; d[o + PY] = p.y; d[o + PZ] = p.z; d[o + VX] = p.vx; d[o + VY] = p.vy; d[o + VZ] = p.vz;
    d[o + AGE] = -p.delay; d[o + LIFE] = p.life; d[o + GRAV] = p.grav; d[o + DRAG] = p.drag;
    d[o + SX0] = p.s0; d[o + SY0] = p.sy0 || p.s0; d[o + SX1] = p.s1; d[o + SY1] = p.sy1 || p.s1; d[o + ROT] = p.rot; d[o + ROTV] = p.rotV;
    d[o + R0] = p.r0; d[o + G0] = p.g0; d[o + B0] = p.b0; d[o + A0] = p.a0; d[o + R1] = p.r1; d[o + G1] = p.g1; d[o + B1] = p.b1; d[o + A1] = p.a1;
    d[o + FRAME] = p.frame; d[o + MODE] = p.mode; d[o + FLAGS] = p.flags; d[o + FADEIN] = p.fadeIn;
    d[o + DX] = p.dx; d[o + DY] = p.dy; d[o + DZ] = p.dz; d[o + STRETCH] = p.stretch; d[o + APOW] = p.apow; d[o + SPOW] = p.spow; d[o + BOUNCE] = p.bounce;
    return true;
  }

  clear() { this.n = 0; this.geo.instanceCount = 0; }

  // quality controller: cap the live particle count (existing particles finish naturally; new ones are dropped while the batch is over the cap)
  setBudget(k) { this.cap = Math.max(96, Math.floor(this.capMax * k)); }

  update(dt) {
    const d = this.d, ap = this.aPos.array, ac = this.aCol.array, aq = this.aPar.array, ad = this.aDir.array;
    let n = this.n;
    for (let i = 0; i < n;) {
      const o = i * ST, age = d[o + AGE] + dt; d[o + AGE] = age;
      const life = d[o + LIFE];
      if (age >= life) { n--; if (i !== n) d.copyWithin(o, n * ST, n * ST + ST); continue; }
      const g4 = i * 4, g3 = i * 3;
      if (age < 0) { aq[g4] = 0; aq[g4 + 1] = 0; ac[g4 + 3] = 0; i++; continue; } // delayed: invisible
      // ---- physics
      let vx = d[o + VX], vy = d[o + VY], vz = d[o + VZ];
      const drag = d[o + DRAG];
      if (drag > 0) { const k = 1 / (1 + drag * dt); vx *= k; vy *= k; vz *= k; }
      vy -= d[o + GRAV] * dt;
      let x = d[o + PX] + vx * dt, y = d[o + PY] + vy * dt, z = d[o + PZ] + vz * dt;
      const fl = d[o + FLAGS] | 0;
      if (fl & 15) {
        const fy = floorY(x, z);
        if (fl & F_LIFT) { const m = fy + d[o + SY0] * 0.3; if (y < m) { y = m; if (vy < 0) vy = 0; } }
        else if (y < fy + 0.004) {
          if (fl & F_KILL) {
            if ((fl & F_STAIN) && this.onStain) this.onStain(x, fy, z, d[o + SX0]);
            n--; if (i !== n) d.copyWithin(o, n * ST, n * ST + ST); continue;
          }
          y = fy + 0.004; if (vy < 0) vy = -vy * d[o + BOUNCE]; vx *= 0.72; vz *= 0.72;
        }
      }
      if (y > 6.9) { y = 6.9; if (vy > 0) vy = -vy * 0.3; }
      d[o + PX] = x; d[o + PY] = y; d[o + PZ] = z; d[o + VX] = vx; d[o + VY] = vy; d[o + VZ] = vz;
      const rot = d[o + ROT] + d[o + ROTV] * dt; d[o + ROT] = rot;
      // ---- appearance
      const t = age / life, sp = d[o + SPOW];
      const kk = sp === 2 ? 1 - (1 - t) * (1 - t) : sp === 1 ? t : 1 - Math.pow(1 - t, sp);
      const ap_ = d[o + APOW], ta = ap_ === 1 ? t : Math.pow(t, ap_);
      let a = d[o + A0] + (d[o + A1] - d[o + A0]) * ta;
      const fi = d[o + FADEIN]; if (fi > 0 && age < fi) a *= age / fi;
      ap[g4] = x; ap[g4 + 1] = y; ap[g4 + 2] = z;
      const mode = d[o + MODE];
      ap[g4 + 3] = mode === 1 ? d[o + STRETCH] : rot;
      ac[g4] = d[o + R0] + (d[o + R1] - d[o + R0]) * t; ac[g4 + 1] = d[o + G0] + (d[o + G1] - d[o + G0]) * t; ac[g4 + 2] = d[o + B0] + (d[o + B1] - d[o + B0]) * t; ac[g4 + 3] = a;
      aq[g4] = d[o + SX0] + (d[o + SX1] - d[o + SX0]) * kk; aq[g4 + 1] = d[o + SY0] + (d[o + SY1] - d[o + SY0]) * kk; aq[g4 + 2] = d[o + FRAME]; aq[g4 + 3] = mode;
      if (mode === 1) { ad[g3] = vx; ad[g3 + 1] = vy; ad[g3 + 2] = vz; } else { ad[g3] = d[o + DX]; ad[g3 + 1] = d[o + DY]; ad[g3 + 2] = d[o + DZ]; }
      i++;
    }
    this.n = n; this.geo.instanceCount = n;
    if (n > 0) { // upload only the live part of each attribute (reused range objects, no allocation)
      const at = this.attrs, rg = this.ranges;
      for (let k = 0; k < 4; k++) { const a = at[k], r = rg[k]; r.start = 0; r.count = n * a.itemSize; a.updateRanges.length = 0; a.updateRanges.push(r); a.needsUpdate = true; }
    }
  }
}
