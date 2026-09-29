// View-space muzzle flashes for the first-person weapons (rendered in viewScene): crossed star quads + jets + core glow.
import * as THREE from 'three';
import { FRAME } from './atlas.js';

const TAU = Math.PI * 2;
// life (s), star size, core size, jet length, jet width, star colour, core colour, extra
const STYLES = {
  pistol: { life: 0.07, star: 0.12, core: 0.06, jet: 0.15, jetW: 0.032, col: [2.2, 1.35, 0.5], core2: [2.6, 2.1, 1.3], stars: 2 },
  shotgun: { life: 0.10, star: 0.21, core: 0.1, jet: 0.28, jetW: 0.06, col: [2.3, 1.25, 0.45], core2: [2.8, 2.2, 1.2], stars: 2 },
  ssg: { life: 0.125, star: 0.3, core: 0.15, jet: 0.4, jetW: 0.09, col: [2.4, 1.2, 0.4], core2: [3.0, 2.2, 1.1], stars: 3 },
  chaingun: { life: 0.058, star: 0.15, core: 0.07, jet: 0.2, jetW: 0.04, col: [2.2, 1.4, 0.55], core2: [2.7, 2.2, 1.4], stars: 2, alt: true },
  plasma: { life: 0.085, star: 0.13, core: 0.19, jet: 0.1, jetW: 0.04, col: [0.5, 1.1, 2.6], core2: [1.0, 1.8, 3.0], stars: 2, glow: true },
  rocket: { life: 0.12, star: 0.24, core: 0.17, jet: 0.3, jetW: 0.085, col: [2.4, 1.15, 0.4], core2: [3.0, 2.0, 0.9], stars: 3 },
  bfg: { life: 0.3, star: 0.2, core: 0.26, jet: 0.2, jetW: 0.07, col: [0.45, 2.0, 0.55], core2: [0.9, 2.4, 0.9], stars: 3, glow: true },
  saw: { life: 0.065, star: 0.075, core: 0.04, jet: 0.09, jetW: 0.022, col: [2.2, 1.5, 0.6], core2: [2.6, 2.1, 1.3], stars: 2 },
};

const geoCache = new Map();
// Quad in the XY plane centred on origin using atlas frame `frame`.
function quadXY(frame, w, h) {
  const key = `xy${frame}_${w}_${h}`; if (geoCache.has(key)) return geoCache.get(key);
  const g = new THREE.BufferGeometry(), c = frame % 4, r = Math.floor(frame / 4), u0 = c * 0.25, v0 = r * 0.25;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([u0, v0, u0 + 0.25, v0, u0 + 0.25, v0 + 0.25, u0, v0 + 0.25]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); geoCache.set(key, g); return g;
}
// Jet quad lying in the plane spanned by Z and (X if horizontal else Y): streak head (u=0.8) sits at z=0, the tail extends toward -Z.
function jetQuad(len, width, horizontal) {
  const key = `jet${len}_${width}_${horizontal}`; if (geoCache.has(key)) return geoCache.get(key);
  const g = new THREE.BufferGeometry(), u0 = 1 * 0.25, v0 = 2 * 0.25; // STREAK = frame 9 -> col 1, row 2
  const z0 = -len, z1 = len * 0.25, hw = width / 2;
  const p = horizontal ? [-hw, 0, z0, -hw, 0, z1, hw, 0, z1, hw, 0, z0] : [0, -hw, z0, 0, -hw, z1, 0, hw, z1, 0, hw, z0];
  // tile u runs along the streak (tail -> head), tile v across
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([u0, v0, u0 + 0.25, v0, u0 + 0.25, v0 + 0.25, u0, v0 + 0.25]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); geoCache.set(key, g); return g;
}

export function makeFlashFactory(atlas) {
  const mats = [];
  const mkMat = () => {
    const m = new THREE.MeshBasicMaterial({ map: atlas, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false });
    mats.push(m); return m;
  };
  return function createFlash(style = 'pistol') {
    const S = STYLES[style] || STYLES.pistol, group = new THREE.Group(); group.name = 'muzzleFlash_' + style;
    const mStar = mkMat(), mCore = mkMat(), mJet = mkMat(), mStar2 = mkMat();
    mStar.color.setRGB(...S.col); mStar2.color.setRGB(S.col[0] * 0.8, S.col[1] * 0.8, S.col[2] * 0.8); mCore.color.setRGB(...S.core2); mJet.color.setRGB(...S.col);
    const starA = new THREE.Mesh(quadXY(FRAME.STAR, S.star, S.star), mStar);
    const starB = new THREE.Mesh(quadXY(FRAME.BURST, S.star * 0.85, S.star * 0.85), mStar2); starB.position.z = -0.03;
    const parts = [starA, starB];
    if (S.stars > 2) { const starC = new THREE.Mesh(quadXY(FRAME.STAR, S.star * 0.7, S.star * 0.7), mStar2); starC.position.z = -0.06; parts.push(starC); }
    const core = new THREE.Mesh(quadXY(S.glow ? FRAME.GLOW : FRAME.HOT, S.core, S.core), mCore); core.position.z = -0.02;
    const jetH = new THREE.Mesh(jetQuad(S.jet, S.jetW, true), mJet), jetV = new THREE.Mesh(jetQuad(S.jet, S.jetW, false), mJet);
    const all = [...parts, core, jetH, jetV];
    for (const m of all) { m.frustumCulled = false; m.renderOrder = 999; group.add(m); m.scale.setScalar(0.0001); }
    const st = { t: 0, life: S.life, scale: 1, flip: 1 };
    group.visible = false;
    const api = {
      object3d: group, style,
      fire(scale = 1) {
        group.visible = true; st.t = st.life; st.scale = scale * (0.85 + Math.random() * 0.3); st.flip = -st.flip;
        for (const m of parts) m.rotation.z = Math.random() * TAU;
        core.rotation.z = Math.random() * TAU; jetH.rotation.z = Math.random() * TAU; jetV.rotation.z = jetH.rotation.z + Math.PI / 2 + (Math.random() - 0.5) * 0.4;
        if (S.alt) { starA.rotation.z = st.flip > 0 ? 0.3 : 0.9; }
        this.update(0);
      },
      update(dt) {
        if (st.t <= 0) return;
        st.t -= dt;
        if (st.t <= 0) { for (const m of all) m.scale.setScalar(0.0001); group.visible = false; return; }
        const k = st.t / st.life, pop = st.scale * (0.6 + 0.4 * k), op = Math.min(1, k * 1.7);
        mStar.opacity = mStar2.opacity = mCore.opacity = mJet.opacity = op;
        for (const m of parts) m.scale.setScalar(pop);
        core.scale.setScalar(pop * (S.glow ? 1.0 : 0.85 + 0.3 * k));
        const jl = st.scale * (0.5 + 0.5 * k);
        jetH.scale.set(pop, pop, jl); jetV.scale.set(pop, pop, jl);
      },
    };
    return api;
  };
}
