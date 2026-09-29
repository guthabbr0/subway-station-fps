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
//
// ROBUSTNESS (the "black box" hunt, see perf/BLACKBOX.md). The HDR targets are RGBA16F: a value above 65504 becomes +Inf, and a NaN / Inf in the scene target used to travel through
// the bloom blur (every tap of every mip that touches the bad texel turns NaN, the coarse mips are only ~30 texels wide with kernels up to 11 texels: ONE bad pixel blanked a
// rectangle hundreds of pixels wide, or the whole frame) and through ACES + the sRGB OETF, and a NaN in an 8-bit canvas is drawn black. Defences here:
//   * the bloom high-pass (first stage) and the final pass read the HDR targets through `bbSafe()`: a bit-pattern test (exponent all ones = Inf/NaN, immune to fast-math folding of
//     isnan / x==x) mapping NaN and -Inf to 0 and +Inf to the clamp, plus a min/max clamp into [0, HDR_MAX] (spec order: max(0.0, x) maps NaN to 0);
//   * the final colour is clamped to [0,1] the same way, and every uniform written from JS is forced finite (a NaN fx / health value used to be able to black out the whole frame);
//   * all raw shaders are GLSL ES 3.00 with `precision highp sampler2D` (the ES 1.00 default is lowp samplers = fixed-point [-2,2) HDR reads on PowerVR / some mobile GPUs);
//   * the scene target type is probed (framebuffer completeness) and falls back to RGBA8 when half-float rendering is not available;
//   * render-target sizes are clamped to the hardware limits; one owner disposes everything.
// ?nosan=1 turns the shader sanitising off (A/B on a real GPU).
import * as THREE from 'three';

export const HDR_MAX = 1024.0; // legit HDR values seen in the game reach ~600 (train headlight glare); everything above is a runaway (GGX peaks, additive stacking, Inf)

// ---- shaders (GLSL ES 3.00) ---------------------------------------------------------------------------------------------------------------
const VERT = /* glsl */`
precision highp float;
in vec3 position; in vec2 uv; out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG_HEAD = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
in vec2 vUv; layout(location = 0) out highp vec4 fragColor;`;

// NaN / Inf proof clamp into [0, mx]. The IEEE bit pattern is tested (all-ones exponent = Inf or NaN), which fast-math compilers cannot fold away like isnan(x) or x == x.
// +Inf -> mx (a saturated highlight), NaN / -Inf -> 0, finite values -> min(max(0.0, x), mx) (GLSL max(x,y) is "y if x < y else x": with x = 0.0 a NaN would give 0.0 as well).
const SAFE = /* glsl */`
float bbSafe(float x, float mx) {
  uint b = floatBitsToUint(x);
  if ((b & 0x7F800000u) == 0x7F800000u) return (b == 0x7F800000u) ? mx : 0.0;
  return min(max(0.0, x), mx);
}
vec3 bbSafe(vec3 c, float mx) { return vec3(bbSafe(c.x, mx), bbSafe(c.y, mx), bbSafe(c.z, mx)); }`;
const SAFE_OFF = /* glsl */`
float bbSafe(float x, float mx) { return x; }
vec3 bbSafe(vec3 c, float mx) { return c; }`;

// ---- bloom shaders (same maths as three's UnrealBloomPass so the look is unchanged in 'full' mode) --------------------------------
const hpFrag = (san) => /* glsl */`${FRAG_HEAD}${san ? SAFE : SAFE_OFF}
uniform sampler2D tDiffuse; uniform float luminosityThreshold; uniform float smoothWidth;
void main() {
  vec3 c = bbSafe(texture(tDiffuse, vUv).rgb, ${HDR_MAX.toFixed(1)});
  float v = dot(c, vec3(0.299, 0.587, 0.114));
  float a = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
  fragColor = vec4(c * a, 1.0);
}`;
// 'lite': the target is 1/4 of the scene, so a single bilinear tap would alias (fireflies on small bright highlights). 4 taps = a 4x4 box.
const hp4Frag = (san) => /* glsl */`${FRAG_HEAD}${san ? SAFE : SAFE_OFF}
uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float luminosityThreshold; uniform float smoothWidth;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 hp(vec2 uv) { vec3 c = bbSafe(texture(tDiffuse, uv).rgb, ${HDR_MAX.toFixed(1)}); return c * smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, lum(c)); }
void main() {
  vec3 s = hp(vUv + uTexel * vec2(-1.0, -1.0)) + hp(vUv + uTexel * vec2(1.0, -1.0)) + hp(vUv + uTexel * vec2(-1.0, 1.0)) + hp(vUv + uTexel * vec2(1.0, 1.0));
  fragColor = vec4(s * 0.25, 1.0);
}`;
const BLUR_FRAG = /* glsl */`${FRAG_HEAD}
uniform sampler2D colorTexture; uniform vec2 invSize; uniform vec2 direction; uniform float gaussianCoefficients[KERNEL_RADIUS];
void main() {
  float weightSum = gaussianCoefficients[0];
  vec3 diffuseSum = texture(colorTexture, vUv).rgb * weightSum;
  for (int i = 1; i < KERNEL_RADIUS; i++) {
    float x = float(i); float w = gaussianCoefficients[i]; vec2 uvOffset = direction * invSize * x;
    vec3 s1 = texture(colorTexture, vUv + uvOffset).rgb; vec3 s2 = texture(colorTexture, vUv - uvOffset).rgb;
    diffuseSum += (s1 + s2) * w; weightSum += 2.0 * w;
  }
  fragColor = vec4(diffuseSum / weightSum, 1.0);
}`;
const compositeFrag = (n) => /* glsl */`${FRAG_HEAD}
${Array.from({ length: n }, (_, i) => `uniform sampler2D blurTexture${i + 1};`).join('\n')}
uniform float bloomStrength; uniform float bloomRadius; uniform float bloomFactors[${n}];
float lerpBloomFactor(const in float factor) { float mirrorFactor = 1.2 - factor; return mix(factor, mirrorFactor, bloomRadius); }
void main() {
  vec3 c = vec3(0.0);
  ${Array.from({ length: n }, (_, i) => `c += lerpBloomFactor(bloomFactors[${i}]) * texture(blurTexture${i + 1}, vUv).rgb;`).join('\n  ')}
  fragColor = vec4(bloomStrength * c, 1.0);
}`;

// mode -> chain layout. 'full' == the original UnrealBloomPass (half-res first mip, 5 mips). 'lite' starts at 1/4 resolution (4x fewer pixels in the two big levels; the
// deeper levels are tiny anyway so all 5 are kept) with kernel radii picked so the blur widths in screen pixels match the full chain (sigma 6/20/56/144/352 px).
const CHAINS = {
  full: { div: 2, kernels: [3, 5, 7, 9, 11], factors: [1.0, 0.8, 0.6, 0.4, 0.2], gain: 1.0, tap4: false },
  lite: { div: 4, kernels: [2, 3, 4, 5, 6], factors: [1.0, 0.8, 0.6, 0.4, 0.2], gain: 1.0, tap4: true },
};

// one full-screen triangle owned by the pipeline (three's FullScreenQuad shares ONE geometry between all instances and its dispose() frees that shared buffer)
class Tri {
  constructor(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new THREE.Mesh(g, material); this.mesh.frustumCulled = false; this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  set material(m) { this.mesh.material = m; }
  get material() { return this.mesh.material; }
  render(renderer) { renderer.render(this.mesh, this.cam); }
  dispose() { this.mesh.geometry.dispose(); }
}
const raw = (o) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, ...o });
const fin = (v, d) => (Number.isFinite(v) ? v : d); // every uniform written from JS goes through this: one NaN health / fx value used to blank the whole frame

class Bloom {
  constructor(mode, strength, radius, threshold, type, san) {
    const C = CHAINS[mode]; this.mode = mode; this.C = C; this.strength = strength * C.gain; this.radius = radius; this.threshold = threshold; this.type = type;
    this.n = C.kernels.length; this.w = 0; this.h = 0;
    const mk = (name) => { const t = new THREE.WebGLRenderTarget(4, 4, { type, depthBuffer: false }); t.texture.name = 'bloom.' + name; t.texture.generateMipmaps = false; return t; };
    this.bright = mk('bright'); this.hor = []; this.ver = [];
    for (let i = 0; i < this.n; i++) { this.hor.push(mk('h' + i)); this.ver.push(mk('v' + i)); }
    this.out = mk('out');
    this.hpMat = raw({ uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, luminosityThreshold: { value: threshold }, smoothWidth: { value: 0.01 } }, vertexShader: VERT, fragmentShader: C.tap4 ? hp4Frag(san) : hpFrag(san) });
    this.blurMats = C.kernels.map((k) => {
      const coef = []; for (let i = 0; i < k; i++) coef.push(0.39894 * Math.exp(-0.5 * i * i / (k * k)) / k);
      return raw({ defines: { KERNEL_RADIUS: k }, uniforms: { colorTexture: { value: null }, invSize: { value: new THREE.Vector2() }, direction: { value: new THREE.Vector2() }, gaussianCoefficients: { value: coef } }, vertexShader: VERT, fragmentShader: BLUR_FRAG });
    });
    const cu = { bloomStrength: { value: this.strength }, bloomRadius: { value: radius }, bloomFactors: { value: C.factors } };
    for (let i = 0; i < this.n; i++) cu['blurTexture' + (i + 1)] = { value: this.ver[i].texture };
    this.compMat = raw({ uniforms: cu, vertexShader: VERT, fragmentShader: compositeFrag(this.n) });
    // The old chain blended the composite over the scene with SRC_ALPHA (alpha = strength * sum of factors, unclamped in a float target), i.e. the effective
    // gain was strength * sum(f) applied on top of the composite's own strength * sum(f * blur). Reproduced here as one scalar for the final pass.
    let sf = 0; for (const f of C.factors) sf += f + (1.2 - f - f) * radius; this.finalGain = this.strength * sf;
    this.quad = new Tri(null);
  }
  // every mip is at least 1x1 (a 1-texel or 0-texel target would be an incomplete framebuffer); sizes follow UnrealBloomPass (halve + round per level)
  sizes(w, h) {
    const out = []; let rx = Math.max(1, Math.round(w / this.C.div)), ry = Math.max(1, Math.round(h / this.C.div)); out.push([rx, ry]);
    for (let i = 0; i < this.n; i++) { out.push([rx, ry]); rx = Math.max(1, Math.round(rx / 2)); ry = Math.max(1, Math.round(ry / 2)); }
    return out; // [0] = bright/out, [1 + i] = mip i
  }
  setSize(w, h) {
    this.w = w; this.h = h; const S = this.sizes(w, h);
    this.bright.setSize(S[0][0], S[0][1]); this.out.setSize(S[0][0], S[0][1]);
    this.hpMat.uniforms.uTexel.value.set(0.5 / S[0][0], 0.5 / S[0][1]);
    for (let i = 0; i < this.n; i++) {
      const [rx, ry] = S[1 + i]; this.hor[i].setSize(rx, ry); this.ver[i].setSize(rx, ry); this.blurMats[i].uniforms.invSize.value.set(1 / rx, 1 / ry);
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
  targets() { return [this.bright, ...this.hor, ...this.ver, this.out]; }
  dispose() {
    for (const t of this.targets()) t.dispose();
    this.hpMat.dispose(); this.compMat.dispose(); for (const m of this.blurMats) m.dispose(); this.quad.dispose();
  }
}

// ---- final pass -----------------------------------------------------------------------------------------------------------------------------
const finalFrag = (san) => /* glsl */`${FRAG_HEAD}${san ? SAFE : SAFE_OFF}
uniform sampler2D tScene; uniform sampler2D tBloom;
uniform float uTime, uDamage, uChroma, uGrain, uLow, uBloomGain; uniform vec2 uRes;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
vec3 grade(vec3 c) { c = ACESFilmicToneMapping(c); return sRGBTransferOETF(vec4(c, 1.0)).rgb; }
vec3 scn(vec2 uv) { return bbSafe(texture(tScene, uv).rgb, ${HDR_MAX.toFixed(1)}); }
void main() {
  vec2 c = vUv - 0.5; float r2 = dot(c, c); float ca = uChroma * (1.0 + r2 * 6.0) + uDamage * 0.006;
  #ifdef BLOOM
    vec3 bl = bbSafe(texture(tBloom, vUv).rgb * uBloomGain, ${HDR_MAX.toFixed(1)});
  #else
    vec3 bl = vec3(0.0);
  #endif
  vec3 col;
  if (ca * uRes.x > 0.3) { // chromatic aberration only when it moves the channels by a visible fraction of a pixel
    col = vec3(grade(scn(vUv + c * ca) + bl).r, grade(scn(vUv) + bl).g, grade(scn(vUv - c * ca) + bl).b);
  } else col = grade(scn(vUv) + bl);
  float g = dot(col, vec3(0.299, 0.587, 0.114)); col = mix(col, vec3(g), uLow * 0.6);
  col *= 1.0 - smoothstep(0.25, 0.95, r2 * 2.2) * 0.55;
  col += vec3(0.55, 0.0, 0.0) * uDamage * smoothstep(0.05, 0.5, r2);
  col += (h(vUv * vec2(1920.0, 1080.0)) - 0.5) * uGrain;
  fragColor = vec4(bbSafe(col, 1.0), 1.0);
}`;

// three's Object3D.updateMatrixWorld walks EVERY node of a scene each frame, including hidden subtrees (8 holstered weapon models = ~300 nodes in the view scene,
// the parked train, pooled effects) and it cannot be pruned per subtree once an ancestor moved (force propagates). This is the same update with the one difference
// that invisible subtrees are skipped. A subtree that was skipped may have stale world matrices (an ancestor can move while it is hidden and never mark it dirty), so a skipped node is
// marked dirty (matrixWorldNeedsUpdate, an existing field: adding an ad hoc property to only the hidden objects would give every Object3D two shapes and slow three's hot loops down):
// the first visit after it becomes visible again recomputes it and forces its subtree. (Camera / SkinnedMesh extras of the overridden three methods are replicated.)
export function updateVisible(o, force) {
  if (!o.visible) { o.matrixWorldNeedsUpdate = true; return; }
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

// Is the half-float colour buffer usable? (checkFramebufferStatus on a small RGBA16F target with a depth renderbuffer). Returns the THREE type to use for HDR targets.
export function probeTargetType(renderer) {
  const gl = renderer.getContext(); const prev = renderer.getRenderTarget(); let ok = false, status = 0;
  try {
    const t = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true });
    renderer.setRenderTarget(t); status = gl.checkFramebufferStatus(gl.FRAMEBUFFER); ok = status === gl.FRAMEBUFFER_COMPLETE; renderer.setRenderTarget(prev); t.dispose();
  } catch (e) { ok = false; }
  return { type: ok ? THREE.HalfFloatType : THREE.UnsignedByteType, ok, status };
}
const BPP = (type) => (type === THREE.FloatType ? 16 : type === THREE.HalfFloatType ? 8 : 4);

// ---- HDR probe: "is anything in the scene target Inf / NaN right now?" ------------------------------------------------------------------------------------
// The evidence the tester cannot screenshot. A chain of tiny reduction passes (8x8 texelFetch per output texel: count of non-finite channel values, largest finite value, position of the first
// bad texel) shrinks the scene target to 1x1, then ONE 1-texel readPixels (a sync point, so it only runs every few frames and only when asked for: ?nancheck=1 or the F3 overlay is open).
const REDUCE_FRAG = /* glsl */`${FRAG_HEAD}
uniform sampler2D tSrc; uniform ivec2 uSize; uniform int uFirst;
void main() {
  ivec2 o = ivec2(gl_FragCoord.xy) * 8; float cnt = 0.0, mx = 0.0; vec2 pos = vec2(-1.0);
  for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
    ivec2 p = o + ivec2(x, y); if (p.x >= uSize.x || p.y >= uSize.y) continue;
    vec4 t = texelFetch(tSrc, p, 0);
    if (uFirst == 1) {
      for (int k = 0; k < 3; k++) { float v = t[k]; uint b = floatBitsToUint(v); if ((b & 0x7F800000u) == 0x7F800000u) { cnt += 1.0; if (pos.x < 0.0) pos = (vec2(p) + 0.5) / vec2(uSize); } else mx = max(mx, v); }
    } else { cnt += t.x; mx = max(mx, t.y); if (pos.x < 0.0 && t.x > 0.0) pos = t.zw; }
  }
  fragColor = vec4(cnt, mx, pos);
}`;
class HdrProbe {
  constructor(renderer) {
    this.r = renderer; this.type = renderer.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.HalfFloatType; this.rts = []; this.sizeKey = '';
    this.mat = raw({ uniforms: { tSrc: { value: null }, uSize: { value: new THREE.Vector2() }, uFirst: { value: 1 } }, vertexShader: VERT, fragmentShader: REDUCE_FRAG });
    this.mat.uniforms.uSize.value = new THREE.Vector2(); this.quad = new Tri(this.mat); this.buf = new Float32Array(4);
  }
  layout(w, h) {
    const key = w + 'x' + h; if (key === this.sizeKey) return; this.sizeKey = key; for (const t of this.rts) t.dispose(); this.rts = [];
    let cw = w, ch = h; do { cw = Math.max(1, Math.ceil(cw / 8)); ch = Math.max(1, Math.ceil(ch / 8)); const t = new THREE.WebGLRenderTarget(cw, ch, { type: this.type, depthBuffer: false, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter }); t.texture.generateMipmaps = false; t.texture.name = 'probe' + this.rts.length; this.rts.push(t); } while (cw > 1 || ch > 1);
  }
  // -> { count, max, x, y } (x, y in 0..1 of the first bad texel of the first bad block, -1 when clean)
  run(tex, w, h) {
    const r = this.r, gl = r.getContext(), q = this.quad; this.layout(w, h); const U = this.mat.uniforms; q.material = this.mat;
    let src = tex, sw = w, sh = h;
    for (let i = 0; i < this.rts.length; i++) {
      const t = this.rts[i]; U.tSrc.value = src; U.uSize.value.set(sw, sh); U.uFirst.value = i === 0 ? 1 : 0; r.setRenderTarget(t); q.render(r); src = t.texture; sw = t.width; sh = t.height;
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, this.buf); // (the last target is 1x1 and still bound)
    return { count: this.buf[0], max: this.buf[1], x: this.buf[2], y: this.buf[3] };
  }
  dispose() { for (const t of this.rts) t.dispose(); this.mat.dispose(); this.quad.dispose(); }
}

export class Post {
  // opts: { type (HDR target type), sanitize (bool), maxDim (largest allowed target side) }
  constructor(game, opts = {}) {
    this.game = game; this.renderer = game.renderer; this.w = 0; this.h = 0; this.bloom = null; this.mode = 'off';
    this.type = opts.type ?? THREE.HalfFloatType; this.sanitize = opts.sanitize !== false; this.maxDim = opts.maxDim || 8192;
    this.direct = false; this.hideWeapon = false; this.hide = null; this.dim = null; // isolation switches (F4, see blackbox.js): render straight to the canvas / skip the weapon pass / hide objects / zero lights
    this.frames = 0; this.lastError = null; this.probe = null; this.probeEvery = 0; // ?nancheck=1 / F3 overlay: HDR probe every N frames
    this.hdr = { runs: 0, badFrames: 0, maxEver: 0, last: null, cur: null, error: null };
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: this.type, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false });
    this.rt.texture.name = 'post.scene'; this.rt.texture.generateMipmaps = false;
    this.uniforms = {
      tScene: { value: this.rt.texture }, tBloom: { value: null }, uTime: { value: 0 }, uDamage: { value: 0 }, uChroma: { value: 0.0006 }, uGrain: { value: 0.05 }, uLow: { value: 0 },
      uBloomGain: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, toneMappingExposure: { value: 1 },
    };
    this.finalMat = raw({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: finalFrag(this.sanitize) });
    this.finalMat.defines = { ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '' };
    this.quad = new Tri(this.finalMat);
    this.strength = 0.55; this.radius = 0.6; this.threshold = 0.85;
  }
  // canvas backing-store size in device pixels
  setSize(w, h) {
    w = Math.min(this.maxDim, Math.max(1, Math.round(fin(w, 1)))); h = Math.min(this.maxDim, Math.max(1, Math.round(fin(h, 1))));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h; this.rt.setSize(w, h); this.uniforms.uRes.value.set(w, h);
    if (this.bloom) this.bloom.setSize(w, h);
  }
  // 'off' | 'lite' | 'full'
  setBloom(mode) {
    if (mode === this.mode) return;
    if (this.bloom) { this.bloom.dispose(); this.bloom = null; }
    this.mode = mode;
    if (mode !== 'off') { this.bloom = new Bloom(mode, this.strength, this.radius, this.threshold, this.type, this.sanitize); if (this.w) this.bloom.setSize(this.w, this.h); }
    const m = this.finalMat; if (mode === 'off') delete m.defines.BLOOM; else m.defines.BLOOM = ''; m.needsUpdate = true;
    this.uniforms.uBloomGain.value = this.bloom ? this.bloom.finalGain : 0;
    this.uniforms.tBloom.value = this.bloom ? this.bloom.out.texture : null;
  }
  render(dt) {
    const g = this.game, r = this.renderer, u = this.uniforms, fx = g.fx;
    u.uTime.value = fin(g.time % 100, 0); u.uDamage.value = fin(fx.damage, 0); u.uChroma.value = fin(fx.chroma, 0.0006); u.uGrain.value = fin(fx.grain, 0.05);
    u.uLow.value = Math.min(1, Math.max(0, 1 - fin(g.player.health, 100) / 35)) * (g.player.alive ? 1 : 0); u.toneMappingExposure.value = fin(r.toneMappingExposure, 1);
    const sc = g.scene, vs = g.viewScene, hide = this.hide, dim = this.dim; let hv = null, dv = null;
    if (hide && hide.length) { hv = hide.map((o) => o.visible); for (const o of hide) o.visible = false; }
    if (dim && dim.length) { dv = dim.map((o) => o.intensity); for (const o of dim) o.intensity = 0; } // (the light COUNT must never change: zero intensity, not visible = false)
    sc.matrixWorldAutoUpdate = vs.matrixWorldAutoUpdate = false; updateVisible(sc, false); updateVisible(vs, false); // (tools that call renderer.render() themselves keep three's own update: the flags are restored below)
    if (this.direct) { // isolation mode: no post-processing at all, three's own screen path (materials tone-map themselves; needs a default-framebuffer depth buffer)
      r.setRenderTarget(null); r.autoClear = true; r.render(sc, g.camera);
      if (!this.hideWeapon) { r.autoClear = false; r.clearDepth(); r.render(vs, g.viewCamera); }
    } else {
      r.setRenderTarget(this.rt);
      r.autoClear = true; r.render(sc, g.camera); // the scene background (a Color) clears colour + depth
      if (!this.hideWeapon) { r.autoClear = false; r.clearDepth(); r.render(vs, g.viewCamera); }
      if (this.probeEvery && this.frames % this.probeEvery === 0) this.runProbe();
      if (this.bloom) this.bloom.render(r, this.rt.texture);
      r.setRenderTarget(null); r.autoClear = false; this.quad.render(r);
    }
    sc.matrixWorldAutoUpdate = vs.matrixWorldAutoUpdate = true;
    if (hv) for (let i = 0; i < hide.length; i++) hide[i].visible = hv[i];
    if (dv) for (let i = 0; i < dim.length; i++) dim[i].intensity = dv[i];
    this.frames++;
  }
  runProbe() {
    try {
      if (!this.probe) this.probe = new HdrProbe(this.renderer);
      const R = this.probe.run(this.rt.texture, this.w, this.h), H = this.hdr; H.runs++; H.cur = R; if (R.max > H.maxEver) H.maxEver = R.max;
      if (R.count > 0) { H.badFrames++; H.last = { frame: this.frames, count: R.count, x: +R.x.toFixed(3), y: +R.y.toFixed(3), t: +(performance.now() / 1000).toFixed(1) }; }
    } catch (e) { this.probeEvery = 0; this.hdr.error = String(e && e.message); console.warn('[post] HDR probe disabled', e); }
  }
  // every render target the pipeline owns
  targets() { const L = [this.rt]; if (this.bloom) L.push(...this.bloom.targets()); return L; }
  // the passes of one frame with their target sizes (for F3 / perf reports: the sum of the areas is the fill-rate exposure of the frame)
  passList() {
    const L = [{ name: 'world', w: this.w, h: this.h }, { name: 'weapon', w: this.w, h: this.h }], b = this.bloom;
    if (b) { L.push({ name: 'bloom.bright', w: b.bright.width, h: b.bright.height }); for (let i = 0; i < b.n; i++) { L.push({ name: 'bloom.h' + i, w: b.hor[i].width, h: b.hor[i].height }, { name: 'bloom.v' + i, w: b.ver[i].width, h: b.ver[i].height }); } L.push({ name: 'bloom.composite', w: b.out.width, h: b.out.height }); }
    L.push({ name: 'final', w: this.w, h: this.h });
    return L;
  }
  mpx() { let px = 0; for (const p of this.passList()) px += p.w * p.h; return px / 1e6; }
  // estimated GPU memory of the pipeline in bytes: the scene target (colour + 24-bit depth renderbuffer) and every bloom target
  memoryBytes() { let b = this.rt.width * this.rt.height * (BPP(this.type) + 4); for (const t of this.bloom ? this.bloom.targets() : []) b += t.width * t.height * BPP(this.type); return b; }
  // framebuffer completeness of every target (F6 diagnostics): binds each one through three (so its own state cache stays right)
  status() {
    const r = this.renderer, gl = r.getContext(), prev = r.getRenderTarget(), out = {};
    try { for (const t of this.targets()) { r.setRenderTarget(t); const s = gl.checkFramebufferStatus(gl.FRAMEBUFFER); if (s !== gl.FRAMEBUFFER_COMPLETE) out[t.texture.name] = s; } } finally { r.setRenderTarget(prev); }
    return out; // {} = all complete
  }
  dispose() { this.rt.dispose(); if (this.bloom) this.bloom.dispose(); if (this.probe) this.probe.dispose(); this.finalMat.dispose(); this.quad.dispose(); }
}
