// Accumulating blood for the chainsaw viewmodel: a tiny shader patch applied to CLONES of the kit's materials (the kit materials are shared with
// other weapons and must not be touched). One shared uniform set drives the housing, bar, chain, gloves and sleeves at once:
//   uBlood 0..1  coverage (grows with every kill, slowly wipes off)     uFresh 0..1  bright wet red -> dark dried brown
// The pattern is procedural (3D value noise in the object's local frame, stretched along the bar, biased toward the business end) so it never
// needs extra draw calls or textures, and wet blood is glossy + non-metallic.
import * as THREE from 'three';

export function makeBloodUniforms() { return { uBlood: { value: 0 }, uFresh: { value: 1 }, uTime: { value: 0 } }; }

const NOISE = /* glsl */`
varying vec3 vBP; uniform float uBlood; uniform float uFresh; uniform float uTime;
float bh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bh(i), bh(i + vec3(1,0,0)), f.x), mix(bh(i + vec3(0,1,0)), bh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bh(i + vec3(0,0,1)), bh(i + vec3(1,0,1)), f.x), mix(bh(i + vec3(0,1,1)), bh(i + vec3(1,1,1)), f.x), f.y), f.z); }
const mat3 BR = mat3(0.0, -0.8, -0.6, 0.8, 0.36, -0.48, 0.6, -0.48, 0.64);          // orthonormal: de-aligns the octaves from the lattice
float bf(vec3 p){ float s = bn(p) * 0.6; p = BR * p * 2.17 + 3.7; s += bn(p) * 0.4; return s; }
vec3 bw(vec3 p){ return vec3(bn(p), bn(p + 13.7), bn(p + 29.3)) - 0.5; }              // domain warp: organic blobs instead of grid-aligned ones
float bloodMask(vec3 p){
  float front = smoothstep(0.0, -0.5, p.z);                                          // more blood toward the business end
  float c = clamp(pow(uBlood, 1.2) * (0.92 + 0.30 * front), 0.0, 1.0);
  vec3 q = p * 150.0; q += bw(q * 0.33) * 2.6;                                       // fine spatter (a few mm)
  float dots = (bf(q) - 0.5) * 2.2 + 0.5;
  vec3 s = p * vec3(44.0, 48.0, 14.0); s += bw(s * 0.45 + 5.0) * 1.8;               // wipes, elongated along the bar
  float smear = (bf(s) - 0.5) * 2.1 + 0.5;
  float td = mix(0.97, 0.32, c), ts = mix(1.22, 0.20, c * c);
  float mDots = smoothstep(td, td + 0.06, dots);
  float mSmear = smoothstep(ts, ts + 0.10, smear + (bn(vec3(p.x * 90.0, p.y * 4.0, p.z * 70.0)) - 0.5) * 0.25);   // thin vertical drip lines
  return max(mDots, mSmear);
}
`;

// mat: a MeshStandardMaterial (clone). opts.instanced: position is per-instance local, so add the instance translation to decorrelate teeth.
// opts.mapChunk: replacement for '#include <map_fragment>' (the belt uses it for motion blur); opts.extraUniforms / opts.extraFrag: extra declarations.
export function bloodify(mat, U, opts = {}) {
  mat.userData.blood = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(mat, shader, renderer);
    shader.uniforms.uBlood = U.uBlood; shader.uniforms.uFresh = U.uFresh; shader.uniforms.uTime = U.uTime;
    if (opts.extraUniforms) for (const k of Object.keys(opts.extraUniforms)) shader.uniforms[k] = opts.extraUniforms[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n#ifdef USE_INSTANCING\n vBP = (instanceMatrix * vec4(position, 1.0)).xyz;\n#else\n vBP = position;\n#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE + (opts.extraFrag || ''))
      .replace('#include <map_fragment>', (opts.mapChunk || '#include <map_fragment>') + `
        float bmv = 0.0;
        if (uBlood > 0.003) {
          bmv = bloodMask(vBP);
          vec3 bcol = mix(vec3(0.030, 0.005, 0.004), vec3(0.20, 0.007, 0.008), uFresh);
          diffuseColor.rgb = mix(diffuseColor.rgb, bcol * (0.65 + 0.7 * bn(vBP * 120.0)), bmv * 0.95);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, mix(0.55, 0.14, uFresh), bmv);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor *= (1.0 - bmv);');
  };
  mat.customProgramCacheKey = () => 'sawblood' + (opts.key || '') + (opts.mapChunk ? 'M' : '');
  mat.needsUpdate = true;
  return mat;
}

// clone a kit material into a blood-capable one (keeps maps / env)
export function cloneBlood(src, U, opts) {
  const m = src.clone(); m.name = (src.name || 'mat') + '_saw';
  if (src.envMap) m.envMap = src.envMap;
  return bloodify(m, U, opts);
}

// swap the materials of every mesh under `root` using a Map(sourceMaterial -> replacement)
export function swapMaterials(root, map) {
  root.traverse((o) => { if (o.isMesh && map.has(o.material)) o.material = map.get(o.material); });
}
