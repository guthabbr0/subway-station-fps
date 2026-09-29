// Guide-bar chain: real instanced links + cutters that are visible while the chain crawls (cranking, clutch slipping, spin-down), and a
// motion-blurred belt (same tooth pattern, sampled along the direction of travel and blended into an averaged streak texture as the speed rises)
// that takes over once the chain is too fast to follow. Speed comes from engine rpm: stationary below the clutch, a silver blur at full throttle.
import * as THREE from 'three';
import { bloodify } from './blood.js';

// ---- bar frame constants (saw-local metres). Bar plane at x = X, chain path centre-line is R above/below the bar centre.
export const BAR = { X: -0.060, Y: 0.028, R: 0.0290, ZR: -0.318, ZT: -0.776 };
const LS = BAR.ZR - BAR.ZT, PERIM = 2 * LS + 2 * Math.PI * BAR.R;
export const NLINK = 80, PITCH = PERIM / NLINK;
export { PERIM };
const CUT_PERIOD = 4 * PITCH;              // texture tile = 4 links (cutter L, link, cutter R, link)

// position (z,y) + travel direction (dz,dy) at arc length s along the chain path
const _cp = { z: 0, y: 0, dz: 0, dy: 0 };
export function chainPoint(s) {
  const R = BAR.R;
  if (s < LS) { _cp.z = BAR.ZR - s; _cp.y = R; _cp.dy = 0; _cp.dz = -1; }
  else if (s < LS + Math.PI * R) { const f = (s - LS) / R; _cp.z = BAR.ZT - R * Math.sin(f); _cp.y = R * Math.cos(f); _cp.dz = -Math.cos(f); _cp.dy = -Math.sin(f); }
  else if (s < 2 * LS + Math.PI * R) { _cp.z = BAR.ZT + (s - LS - Math.PI * R); _cp.y = -R; _cp.dy = 0; _cp.dz = 1; }
  else { const f = (s - 2 * LS - Math.PI * R) / R; _cp.z = BAR.ZR + R * Math.sin(f); _cp.y = -R * Math.cos(f); _cp.dz = Math.cos(f); _cp.dy = Math.sin(f); }
  return _cp;
}

// ---- the tooth pattern texture (3 strips: left side / top / right side), 4 links per tile
function makePatternCanvas() {
  const W = 256, H = 96, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#0d0f12'; g.fillRect(0, 0, W, H);
  const link = W / 4;
  const plate = (x, y, w, h, top, bot) => { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, top); gr.addColorStop(1, bot); g.fillStyle = gr; g.fillRect(x, y, w, h); };
  // strip 0 (0..32): left side view; strip 2 (64..96): right side view (mirrored roles). Cutter on the LEFT at link 0, on the RIGHT at link 2.
  for (const [row, cutIdx] of [[0, 0], [64, 2]]) {
    for (let i = 0; i < 4; i++) {
      const x0 = i * link;
      plate(x0 + 3, row + 9, link - 6, 15, '#9aa1ab', '#5b626c');                 // side plate
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x0 + 5, row + 10, link - 10, 2);
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x0 + link / 2 - 2, row + 13, 4, 7);  // rivet hole
      if (i === cutIdx) { plate(x0 + 4, row + 3, link - 8, 8, '#d6dbe2', '#8b929c'); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x0 + 4, row + 11, link - 8, 1.5); }   // cutter blade
      if (i === cutIdx) { g.fillStyle = '#4b5058'; g.fillRect(x0 + link - 12, row + 7, 8, 3); }                                                                          // depth gauge
    }
  }
  // strip 1 (32..64): top view. dark drive links in the centre, side plates left/right, cutter top plates alternate
  for (let i = 0; i < 4; i++) {
    const x0 = i * link;
    g.fillStyle = '#1b1e23'; g.fillRect(x0 + 4, 32 + 11, link - 8, 10);                    // drive link tang (dark)
    g.fillStyle = 'rgba(210,216,225,0.9)'; g.fillRect(x0 + 5, 32 + 11, link - 10, 2);
    plate(x0 + 3, 32 + 3, link - 6, 7, '#8f96a0', '#5d646e'); plate(x0 + 3, 32 + 22, link - 6, 7, '#8f96a0', '#5d646e');   // side plates seen from above
    if (i === 0) { plate(x0 + 2, 32 + 0, link - 3, 12, '#e3e8ee', '#9098a3'); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 + 2, 32 + 11, link - 3, 1.5); }   // left cutter top plate
    if (i === 2) { plate(x0 + 2, 32 + 20, link - 3, 12, '#e3e8ee', '#9098a3'); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 + 2, 32 + 20, link - 3, 1.5); }  // right cutter top plate
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x0, 32, 1.5, 32);                          // link gaps
  }
  g.fillStyle = 'rgba(0,0,0,0.5)'; for (let i = 0; i < 4; i++) g.fillRect(i * link, 0, 1.5, H);
  // oil sheen
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(20,14,6,${0.05 + Math.random() * 0.12})`; g.fillRect(Math.random() * W, Math.random() * H, 3 + Math.random() * 14, 1 + Math.random() * 3); }
  return c;
}
// average the pattern along u (the blurred streak texture): 1 row per v
function makeBlurCanvas(src) {
  const W = src.width, H = src.height, sg = src.getContext('2d').getImageData(0, 0, W, H).data, c = document.createElement('canvas'); c.width = 8; c.height = H; const g = c.getContext('2d'), out = g.createImageData(8, H);
  for (let y = 0; y < H; y++) {
    let r = 0, gg = 0, b = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; r += sg[i] * sg[i]; gg += sg[i + 1] * sg[i + 1]; b += sg[i + 2] * sg[i + 2]; }   // average in ~linear light (sqrt of mean square approximates)
    r = Math.sqrt(r / W); gg = Math.sqrt(gg / W); b = Math.sqrt(b / W);
    for (let x = 0; x < 8; x++) { const i = (y * 8 + x) * 4; out.data[i] = r; out.data[i + 1] = gg; out.data[i + 2] = b; out.data[i + 3] = 255; }
  }
  g.putImageData(out, 0, 0); return c;
}

export function makeChain(kit, U, saw) {
  const M = kit.M, env = kit.env;
  // ---------- instanced teeth
  const mk = (hex, rough, metal, ei = 1.6) => bloodify(new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal, envMap: env, envMapIntensity: ei }), U, { key: 'chain' });
  const matCut = mk(0xd4d9df, 0.32, 0.95, 2.0), matPlate = mk(0x8d949e, 0.45, 0.9, 1.6), matLink = mk(0x14171b, 0.55, 0.8, 1.0);
  const box = (w, h, d, x, y, z, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); return g; };
  const merge = (arr) => { let n = 0; const P = [], N = [], I = []; for (const g of arr) { const ng = g.toNonIndexed(); P.push(ng.attributes.position.array); N.push(ng.attributes.normal.array); n += ng.attributes.position.count; g.dispose(); } const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0; for (let i = 0; i < P.length; i++) { pos.set(P[i], o); nor.set(N[i], o); o += P[i].length; } const G = new THREE.BufferGeometry(); G.setAttribute('position', new THREE.BufferAttribute(pos, 3)); G.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); return G; };
  const L = PITCH * 0.94;
  const gLink = merge([box(0.0032, 0.0080, L, 0, -0.0012, 0), box(0.0032, 0.0050, 0.0040, 0, 0.0035, 0)]);                                                            // drive link + tang tip
  const gPlate = merge([box(0.0016, 0.0058, L, -0.0034, 0.0006, 0), box(0.0016, 0.0058, L, 0.0034, 0.0006, 0)]);                                                          // both side plates
  const cutter = (side) => merge([box(0.0078, 0.0022, L * 0.86, side * 0.0058, 0.0048, -0.0004), box(0.0018, 0.0086, L * 0.86, side * 0.0092, 0.0014, -0.0004), box(0.0060, 0.0012, 0.0036, side * 0.0030, 0.0038, L * 0.36)]);  // top plate, side plate, gauge
  const gCutL = cutter(-1), gCutR = cutter(1);
  const iLink = new THREE.InstancedMesh(gLink, matLink, NLINK), iPlate = new THREE.InstancedMesh(gPlate, matPlate, NLINK);
  iPlate.instanceMatrix = iLink.instanceMatrix;     // same transforms: update once
  const iCutL = new THREE.InstancedMesh(gCutL, matCut, NLINK / 4), iCutR = new THREE.InstancedMesh(gCutR, matCut, NLINK / 4);
  const teeth = new THREE.Group(); teeth.name = 'chainTeeth';
  for (const im of [iLink, iPlate, iCutL, iCutR]) { im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); teeth.add(im); }
  saw.add(teeth);

  // ---------- blurred belt
  const pat = makePatternCanvas(), tex = new THREE.CanvasTexture(pat); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4;
  const blurTex = new THREE.CanvasTexture(makeBlurCanvas(pat)); blurTex.colorSpace = THREE.SRGBColorSpace; blurTex.wrapS = blurTex.wrapT = THREE.RepeatWrapping;
  const beltU = { uPhase: { value: 0 }, uSmear: { value: 0 }, uBlur: { value: 0 }, uBlurTex: { value: blurTex }, uShimmer: { value: 0 } };
  const beltMat = bloodify(new THREE.MeshStandardMaterial({ map: tex, metalness: 0.85, roughness: 0.42, envMap: env, envMapIntensity: 1.7, side: THREE.DoubleSide }), U, {
    key: 'belt', extraUniforms: beltU,
    extraFrag: 'uniform float uPhase, uSmear, uBlur, uShimmer; uniform sampler2D uBlurTex;',
    mapChunk: `
      #ifdef USE_MAP
        vec2 buv = vMapUv; vec4 sharpC = vec4(0.0);
        for (int bi = 0; bi < 6; bi++) { float k = (float(bi) + 0.5) / 6.0 - 0.5; sharpC += texture2D(map, vec2(buv.x + uPhase + k * uSmear, buv.y)); }
        sharpC /= 6.0;
        vec4 streakC = texture2D(uBlurTex, vec2(0.5, buv.y));
        float sh = 1.0 + uShimmer * (sin(buv.x * 91.0 + uPhase * 300.0) * 0.5 + sin(buv.x * 37.0 - uPhase * 210.0 + buv.y * 9.0) * 0.5);
        vec4 sampledDiffuseColor = mix(sharpC, streakC * sh * (1.0 + 0.9 * uBlur), uBlur);
        diffuseColor *= sampledDiffuseColor;
      #endif`,
  });
  // belt geometry: top-facing outer band + two side bands around the path
  const MS = 200, W = 0.0150, H = 0.0062, pos = [], uv = [], nor = [], idx = [];
  const ring = (kind) => {
    const base = pos.length / 3;
    for (let j = 0; j <= MS; j++) {
      const s = Math.min((j / MS) * PERIM, PERIM - 1e-6), cp = chainPoint(s), ny = -cp.dz, nz = cp.dy, u = s / CUT_PERIOD + 0.125;   // outward normal in (y,z); +0.125: link 0 of the tile is centred on the chain element
      if (kind === 1) { for (const sx of [-1, 1]) { pos.push(BAR.X + sx * W / 2, BAR.Y + cp.y + ny * H, cp.z + nz * H); nor.push(0, ny, nz); uv.push(u, sx < 0 ? 0.667 : 0.333); } }
      else { const sx = kind === 0 ? -1 : 1, v0 = kind === 0 ? 0.985 : 0.32, v1 = kind === 0 ? 0.68 : 0.015;   // v0 = outer edge, v1 = inner edge
        for (const rr of [0, 1]) { pos.push(BAR.X + sx * W / 2, BAR.Y + cp.y + ny * H * rr - ny * 0.0018, cp.z + nz * H * rr - nz * 0.0018); nor.push(sx, 0, 0); uv.push(u, rr ? v0 : v1); } }
    }
    for (let j = 0; j < MS; j++) { const a = base + j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  };
  ring(0); ring(1); ring(2);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
  const belt = new THREE.Mesh(geo, beltMat); belt.frustumCulled = false; belt.visible = false; belt.name = 'chainBelt'; saw.add(belt);

  // ---------- motion halo: faint silver fringe around the chain (the blur of teeth that stick out past the belt), additive, only visible at speed
  const HM = 120, hpos = [], hcol = [], hidx = [];
  for (const xo of [-0.006, 0, 0.006]) {
    const base = hpos.length / 3;
    for (let j = 0; j <= HM; j++) {
      const s = Math.min((j / HM) * PERIM, PERIM - 1e-6), cp = chainPoint(s), ny = -cp.dz, nz = cp.dy;
      for (const [r, a] of [[0.0035, 0.95], [0.0125, 0.0]]) { hpos.push(BAR.X + xo, BAR.Y + cp.y + ny * r, cp.z + nz * r); hcol.push(0.85, 0.92, 1.0, a); }
    }
    for (let j = 0; j < HM; j++) { const a = base + j * 2; hidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const hgeo = new THREE.BufferGeometry(); hgeo.setAttribute('position', new THREE.Float32BufferAttribute(hpos, 3)); hgeo.setAttribute('color', new THREE.Float32BufferAttribute(hcol, 4)); hgeo.setIndex(hidx);
  const haloMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0, fog: false });
  const halo = new THREE.Mesh(hgeo, haloMat); halo.frustumCulled = false; halo.visible = false; halo.renderOrder = 5; saw.add(halo);

  // ---------- animation state
  const dummy = new THREE.Object3D(); let lastPhase = -1, lastMode = -1;
  const API = {
    teeth, belt, phase: 0, speed: 0, materials: [matCut, matPlate, matLink, beltMat], beltU,
    // speed in m/s along the chain; dt seconds. Returns nothing.
    update(speed, dt, time) {
      this.speed = speed; this.phase = (this.phase + speed * dt) % PERIM; if (this.phase < 0) this.phase += PERIM;
      const step = speed * dt;
      // 0: crisp 3D teeth, 1: belt with blur amount
      const useBelt = speed > 0.9;
      if (useBelt !== (lastMode === 1)) { teeth.visible = !useBelt; belt.visible = useBelt; }
      lastMode = useBelt ? 1 : 0;
      const hv = useBelt ? Math.min(1, (speed - 0.9) / 8) : 0; halo.visible = hv > 0.02; haloMat.opacity = hv * (0.34 + 0.12 * Math.sin(time * 173) + 0.08 * Math.sin(time * 311 + 1.3));
      if (useBelt) {
        beltU.uPhase.value = -(this.phase / CUT_PERIOD) % 1;
        // exposure smear: distance moved in one frame (or ~1/60 s) in pattern periods, capped at one period so the samples stay meaningful
        const trav = Math.max(step, speed / 60) / CUT_PERIOD;
        beltU.uSmear.value = Math.min(1.0, trav);
        beltU.uBlur.value = Math.min(1, Math.max(0, (trav - 0.35) / 0.9));
        beltU.uShimmer.value = 0.30 * beltU.uBlur.value;
      } else if (this.phase !== lastPhase || lastPhase < 0) {
        lastPhase = this.phase;
        for (let k = 0; k < NLINK; k++) {
          let s = (k * PITCH + this.phase) % PERIM; if (s < 0) s += PERIM;
          const cp = chainPoint(s), th = Math.atan2(cp.dy, -cp.dz);
          dummy.position.set(BAR.X, BAR.Y + cp.y, cp.z); dummy.rotation.set(th, 0, 0); dummy.updateMatrix();
          iLink.setMatrixAt(k, dummy.matrix);
          if ((k & 3) === 0) iCutL.setMatrixAt(k >> 2, dummy.matrix); else if ((k & 3) === 2) iCutR.setMatrixAt(k >> 2, dummy.matrix);
        }
        iLink.instanceMatrix.needsUpdate = true; iCutL.instanceMatrix.needsUpdate = true; iCutR.instanceMatrix.needsUpdate = true;
      }
    },
    // position of the chain path at arc-length s in bar-frame (writes into out {x,y,z})
    dispose() { for (const g of [gLink, gPlate, gCutL, gCutR, geo]) g.dispose(); tex.dispose(); blurTex.dispose(); hgeo.dispose(); haloMat.dispose(); for (const m of [matCut, matPlate, matLink, beltMat]) m.dispose(); },
  };
  API.update(0, 0.016, 0); lastPhase = -1; API.update(0, 0.016, 0);
  return API;
}
