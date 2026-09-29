// Lean post-processing pipeline (replaces EffectComposer + RenderPass x2 + UnrealBloomPass + OutputPass + ShaderPass).
//
//   world scene  ->  HDR target (half float, depth)          RenderPass #1 (clears)
//   view scene   ->  same target, depth cleared              RenderPass #2 (first-person weapon)
//   bloom chain  ->  small half-float targets (optional)     high-pass + separable blur mips + composite, at 1/2 (full) or 1/4 (lite) resolution
//   final pass   ->  canvas: bloom add + ACES tone map + sRGB + chroma + vignette + damage + grain in ONE full-screen triangle
//
// versus the old chain this drops one full-resolution pass (OutputPass wrote a whole half-float target that the final pass read again) and the additive
// blend of the bloom back onto the scene target, and it lets the quality controller change the bloom cost (full / lite / off) at run time.
// Every render target is owned here: resize / mode changes dispose the old ones (three's WebGLRenderTarget.setSize / dispose free the GL objects), so
// dynamic-resolution steps do not leak framebuffers or textures.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LuminosityHighPassShader } from 'three/addons/shaders/LuminosityHighPassShader.js';

const VERT = /* glsl */`
precision highp float;
attribute vec3 position; attribute vec2 uv; varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// ---- bloom shaders (same maths as three's UnrealBloomPass so the look is unchanged in 'full' mode) --------------------------------
const HP_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse; uniform float luminosityThreshold; uniform float smoothWidth; varying vec2 vUv;
void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  float v = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
  float a = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
  gl_FragColor = vec4(texel.rgb * a, 1.0);
}`;
// 'lite': the target is 1/4 of the scene, so a single bilinear tap would alias (fireflies on small bright highlights). 4 taps = a 4x4 box.
const HP4_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float luminosityThreshold; uniform float smoothWidth; varying vec2 vUv;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 hp(vec3 c) { return c * smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, lum(c)); }
void main() {
  vec3 s = hp(texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, -1.0)).rgb) + hp(texture2D(tDiffuse, vUv + uTexel * vec2(1.0, -1.0)).rgb)
         + hp(texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, 1.0)).rgb) + hp(texture2D(tDiffuse, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  gl_FragColor = vec4(s * 0.25, 1.0);
}`;
const BLUR_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D colorTexture; uniform vec2 invSize; uniform vec2 direction; uniform float gaussianCoefficients[KERNEL_RADIUS];
void main() {
  float weightSum = gaussianCoefficients[0];
  vec3 diffuseSum = texture2D(colorTexture, vUv).rgb * weightSum;
  for (int i = 1; i < KERNEL_RADIUS; i++) {
    float x = float(i); float w = gaussianCoefficients[i]; vec2 uvOffset = direction * invSize * x;
    vec3 s1 = texture2D(colorTexture, vUv + uvOffset).rgb; vec3 s2 = texture2D(colorTexture, vUv - uvOffset).rgb;
    diffuseSum += (s1 + s2) * w; weightSum += 2.0 * w;
  }
  gl_FragColor = vec4(diffuseSum / weightSum, 1.0);
}`;
const compositeFrag = (n) => /* glsl */`
precision highp float;
varying vec2 vUv;
${Array.from({ length: n }, (_, i) => `uniform sampler2D blurTexture${i + 1};`).join('\n')}
uniform float bloomStrength; uniform float bloomRadius; uniform float bloomFactors[${n}];
float lerpBloomFactor(const in float factor) { float mirrorFactor = 1.2 - factor; return mix(factor, mirrorFactor, bloomRadius); }
void main() {
  vec3 c = vec3(0.0);
  ${Array.from({ length: n }, (_, i) => `c += lerpBloomFactor(bloomFactors[${i}]) * texture2D(blurTexture${i + 1}, vUv).rgb;`).join('\n  ')}
  gl_FragColor = vec4(bloomStrength * c, 1.0);
}`;

// mode -> chain layout. 'full' == the original UnrealBloomPass (half-res first mip, 5 mips). 'lite' starts at 1/4 resolution (4x fewer pixels in the two big levels; the
// deeper levels are tiny anyway so all 5 are kept) with kernel radii picked so the blur widths in screen pixels match the full chain (sigma 6/20/56/144/352 px).
const CHAINS = {
  full: { div: 2, kernels: [3, 5, 7, 9, 11], factors: [1.0, 0.8, 0.6, 0.4, 0.2], gain: 1.0, tap4: false },
  lite: { div: 4, kernels: [2, 3, 4, 5, 6], factors: [1.0, 0.8, 0.6, 0.4, 0.2], gain: 1.0, tap4: true },
};

class Bloom {
  constructor(mode, strength, radius, threshold) {
    const C = CHAINS[mode]; this.mode = mode; this.C = C; this.strength = strength * C.gain; this.radius = radius; this.threshold = threshold;
    this.n = C.kernels.length; this.w = 0; this.h = 0;
    const mk = (name) => { const t = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }); t.texture.name = 'bloom.' + name; t.texture.generateMipmaps = false; return t; };
    this.bright = mk('bright'); this.hor = []; this.ver = [];
    for (let i = 0; i < this.n; i++) { this.hor.push(mk('h' + i)); this.ver.push(mk('v' + i)); }
    this.out = mk('out');
    this.hpMat = new THREE.RawShaderMaterial({ uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, luminosityThreshold: { value: threshold }, smoothWidth: { value: LuminosityHighPassShader.uniforms.smoothWidth.value } }, vertexShader: VERT, fragmentShader: C.tap4 ? HP4_FRAG : HP_FRAG, depthTest: false, depthWrite: false });
    this.hpMat.uniforms.smoothWidth.value = 0.01;
    this.blurMats = C.kernels.map((k) => {
      const coef = []; for (let i = 0; i < k; i++) coef.push(0.39894 * Math.exp(-0.5 * i * i / (k * k)) / k);
      return new THREE.RawShaderMaterial({ defines: { KERNEL_RADIUS: k }, uniforms: { colorTexture: { value: null }, invSize: { value: new THREE.Vector2() }, direction: { value: new THREE.Vector2() }, gaussianCoefficients: { value: coef } }, vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
    });
    const cu = { bloomStrength: { value: this.strength }, bloomRadius: { value: radius }, bloomFactors: { value: C.factors } };
    for (let i = 0; i < this.n; i++) cu['blurTexture' + (i + 1)] = { value: this.ver[i].texture };
    this.compMat = new THREE.RawShaderMaterial({ uniforms: cu, vertexShader: VERT, fragmentShader: compositeFrag(this.n), depthTest: false, depthWrite: false });
    // The old chain blended the composite over the scene with SRC_ALPHA (alpha = strength * sum of factors, unclamped in a float target), i.e. the effective
    // gain was strength * sum(f) applied on top of the composite's own strength * sum(f * blur). Reproduced here as one scalar for the final pass.
    let sf = 0; for (const f of C.factors) sf += f + (1.2 - f - f) * radius; this.finalGain = this.strength * sf;
    this.quad = new FullScreenQuad(null);
  }
  setSize(w, h) {
    this.w = w; this.h = h; let rx = Math.max(1, Math.round(w / this.C.div)), ry = Math.max(1, Math.round(h / this.C.div));
    this.bright.setSize(rx, ry); this.out.setSize(rx, ry);
    this.hpMat.uniforms.uTexel.value.set(0.5 / rx, 0.5 / ry);
    for (let i = 0; i < this.n; i++) {
      this.hor[i].setSize(rx, ry); this.ver[i].setSize(rx, ry);
      this.blurMats[i].uniforms.invSize.value.set(1 / rx, 1 / ry);
      rx = Math.max(1, Math.round(rx / 2)); ry = Math.max(1, Math.round(ry / 2));
    }
  }
  // sceneTex -> this.out.texture
  render(renderer, sceneTex) {
    const q = this.quad;
    this.hpMat.uniforms.tDiffuse.value = sceneTex; this.hpMat.uniforms.luminosityThreshold.value = this.threshold; q.material = this.hpMat;
    renderer.setRenderTarget(this.bright); q.render(renderer);
    let src = this.bright;
    for (let i = 0; i < this.n; i++) {
      const m = this.blurMats[i]; q.material = m;
      m.uniforms.colorTexture.value = src.texture; m.uniforms.direction.value.set(1, 0);
      renderer.setRenderTarget(this.hor[i]); q.render(renderer);
      m.uniforms.colorTexture.value = this.hor[i].texture; m.uniforms.direction.value.set(0, 1);
      renderer.setRenderTarget(this.ver[i]); q.render(renderer);
      src = this.ver[i];
    }
    q.material = this.compMat; renderer.setRenderTarget(this.out); q.render(renderer);
  }
  dispose() {
    this.bright.dispose(); this.out.dispose(); for (const t of this.hor) t.dispose(); for (const t of this.ver) t.dispose();
    this.hpMat.dispose(); this.compMat.dispose(); for (const m of this.blurMats) m.dispose(); this.quad.dispose();
  }
}

// ---- final pass -----------------------------------------------------------------------------------------------------------------------------
const FINAL_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tScene; uniform sampler2D tBloom;
uniform float uTime, uDamage, uChroma, uGrain, uLow, uBloomGain; uniform vec2 uRes;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
vec3 grade(vec3 c) { c = ACESFilmicToneMapping(c); return sRGBTransferOETF(vec4(c, 1.0)).rgb; }
void main() {
  vec2 c = vUv - 0.5; float r2 = dot(c, c); float ca = uChroma * (1.0 + r2 * 6.0) + uDamage * 0.006;
  #ifdef BLOOM
    vec3 bl = texture2D(tBloom, vUv).rgb * uBloomGain;
  #else
    vec3 bl = vec3(0.0);
  #endif
  vec3 col;
  if (ca * uRes.x > 0.3) { // chromatic aberration only when it moves the channels by a visible fraction of a pixel
    col = vec3(grade(texture2D(tScene, vUv + c * ca).rgb + bl).r, grade(texture2D(tScene, vUv).rgb + bl).g, grade(texture2D(tScene, vUv - c * ca).rgb + bl).b);
  } else col = grade(texture2D(tScene, vUv).rgb + bl);
  float g = dot(col, vec3(0.299, 0.587, 0.114)); col = mix(col, vec3(g), uLow * 0.6);
  col *= 1.0 - smoothstep(0.25, 0.95, r2 * 2.2) * 0.55;
  col += vec3(0.55, 0.0, 0.0) * uDamage * smoothstep(0.05, 0.5, r2);
  col += (h(vUv * vec2(1920.0, 1080.0)) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}`;

// three's Object3D.updateMatrixWorld walks EVERY node of a scene each frame, including hidden subtrees (8 holstered weapon models = ~300 nodes in the view scene,
// the parked train, pooled effects) and it cannot be pruned per subtree once an ancestor moved (force propagates). This is the same update with the one difference
// that invisible subtrees are skipped; they get a correct matrix the first frame they are visible again because becoming visible needs no flag: a visible node is
// always recomputed when its parent changed or when matrixAutoUpdate marks it dirty. (Camera / SkinnedMesh extras of the overridden three methods are replicated.)
export function updateVisible(o, force) {
  if (!o.visible) return;
  if (o.matrixAutoUpdate) o.updateMatrix();
  if (o.matrixWorldNeedsUpdate || force) {
    if (o.parent === null) o.matrixWorld.copy(o.matrix); else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    o.matrixWorldNeedsUpdate = false; force = true;
  }
  if (o.isCamera) o.matrixWorldInverse.copy(o.matrixWorld).invert();
  else if (o.isSkinnedMesh) { if (o.bindMode === 'attached') o.bindMatrixInverse.copy(o.matrixWorld).invert(); else o.bindMatrixInverse.copy(o.bindMatrix).invert(); }
  const c = o.children;
  for (let i = 0, n = c.length; i < n; i++) updateVisible(c[i], force);
}

export class Post {
  constructor(game) {
    this.game = game; this.renderer = game.renderer; this.w = 0; this.h = 0; this.bloom = null; this.mode = 'off';
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false });
    this.rt.texture.name = 'post.scene'; this.rt.texture.generateMipmaps = false;
    this.uniforms = {
      tScene: { value: this.rt.texture }, tBloom: { value: null }, uTime: { value: 0 }, uDamage: { value: 0 }, uChroma: { value: 0.0006 }, uGrain: { value: 0.05 }, uLow: { value: 0 },
      uBloomGain: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, toneMappingExposure: { value: 1 },
    };
    this.finalMat = new THREE.RawShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false });
    this.finalMat.defines = { ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '' };
    this.quad = new FullScreenQuad(this.finalMat);
    this.strength = 0.55; this.radius = 0.6; this.threshold = 0.85;
  }
  // canvas backing-store size in device pixels
  setSize(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h; this.rt.setSize(w, h); this.uniforms.uRes.value.set(w, h);
    if (this.bloom) this.bloom.setSize(w, h);
  }
  // 'off' | 'lite' | 'full'
  setBloom(mode) {
    if (mode === this.mode) return;
    if (this.bloom) { this.bloom.dispose(); this.bloom = null; }
    this.mode = mode;
    if (mode !== 'off') { this.bloom = new Bloom(mode, this.strength, this.radius, this.threshold); if (this.w) this.bloom.setSize(this.w, this.h); }
    const m = this.finalMat; if (mode === 'off') delete m.defines.BLOOM; else m.defines.BLOOM = ''; m.needsUpdate = true;
    this.uniforms.uBloomGain.value = this.bloom ? this.bloom.finalGain : 0;
    this.uniforms.tBloom.value = this.bloom ? this.bloom.out.texture : null;
  }
  render(dt) {
    const g = this.game, r = this.renderer, u = this.uniforms, fx = g.fx;
    u.uTime.value = g.time % 100; u.uDamage.value = fx.damage; u.uChroma.value = fx.chroma; u.uGrain.value = fx.grain;
    u.uLow.value = Math.min(1, Math.max(0, 1 - g.player.health / 35)) * (g.player.alive ? 1 : 0); u.toneMappingExposure.value = r.toneMappingExposure;
    const sc = g.scene, vs = g.viewScene;
    sc.matrixWorldAutoUpdate = vs.matrixWorldAutoUpdate = false; updateVisible(sc, false); updateVisible(vs, false); // (tools that call renderer.render() themselves keep three's own update: the flags are restored below)
    r.setRenderTarget(this.rt);
    r.autoClear = true; r.render(sc, g.camera); // the scene background (a Color) clears colour + depth
    r.autoClear = false; r.clearDepth(); r.render(vs, g.viewCamera);
    sc.matrixWorldAutoUpdate = vs.matrixWorldAutoUpdate = true;
    if (this.bloom) this.bloom.render(r, this.rt.texture);
    r.setRenderTarget(null); this.quad.render(r);
  }
  // the passes of one frame with their target sizes (for F3 / perf reports: the sum of the areas is the fill-rate exposure of the frame)
  passList() {
    const L = [{ name: 'world', w: this.w, h: this.h }, { name: 'weapon', w: this.w, h: this.h }], b = this.bloom;
    if (b) { L.push({ name: 'bloom.bright', w: b.bright.width, h: b.bright.height }); for (let i = 0; i < b.n; i++) { L.push({ name: 'bloom.h' + i, w: b.hor[i].width, h: b.hor[i].height }, { name: 'bloom.v' + i, w: b.ver[i].width, h: b.ver[i].height }); } L.push({ name: 'bloom.composite', w: b.out.width, h: b.out.height }); }
    L.push({ name: 'final', w: this.w, h: this.h });
    return L;
  }
  mpx() { let px = 0; for (const p of this.passList()) px += p.w * p.h; return px / 1e6; }
  dispose() { this.rt.dispose(); if (this.bloom) this.bloom.dispose(); this.finalMat.dispose(); this.quad.dispose(); }
}
