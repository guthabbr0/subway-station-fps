// Lighting design: 8 real point lights + hemisphere fill (never added/removed at runtime), ~60 instanced emissive fluorescent
// fixtures (a quarter of them flickering / dying), additive light-shaft cones, halos, edge LEDs, red emergency beacons,
// caged amber bulkheads, and a baked PMREM environment so the wet floor / tile / metal pick up strip reflections.
import * as THREE from 'three';
import { bus, LAYOUT } from '../core.js';
import { mulberry32 } from '../texutil.js';
import { radialTex } from '../textures.js';
import { MB } from './mb.js';
import { COLUMN_Z, X0, X1, WZ } from './structure.js';

const HOT = new THREE.Color(1.55, 1.8, 1.95);

// ---- flicker patterns -------------------------------------------------------------------------------------------------
const fr = (x) => x - Math.floor(x);
const hnoise = (n, ph) => fr(Math.sin(n * 127.1 + ph * 311.7) * 43758.5453);
function flickerValue(kind, t, ph) {
  switch (kind) {
    case 1: { // erratic tube: mostly on, bursts of strobing
      const s = Math.sin(t * 1.3 + ph) + Math.sin(t * 2.9 + ph * 2.0) + Math.sin(t * 7.1 + ph * 3.0);
      if (s > 1.35) return 0.12 + 0.88 * (hnoise(Math.floor(t * 28), ph) > 0.45 ? 1 : 0);
      return 0.96 + 0.04 * Math.sin(t * 50 + ph);
    }
    case 2: { // dying: long dim glow with periodic stuttering restarts
      const P = 6.5 + (ph % 3), c = (t + ph * 2.0) % P;
      if (c < 0.9) return 0.06 + 0.94 * (hnoise(Math.floor(t * 20), ph) > 0.55 ? 1 : 0.05);
      if (c > P - 0.35) return 0.5 + 0.5 * hnoise(Math.floor(t * 30), ph);
      return 0.07;
    }
    case 3: return 0.02;
    default: return 1;
  }
}

export function buildLighting(c) {
  const { game, scene, M } = c, rnd = mulberry32(555);
  const L = { lights: [], dyn: [] };

  // ---- atmosphere ----------------------------------------------------------------------------------------------------
  scene.background = new THREE.Color(0x070a0e);
  scene.fog = new THREE.FogExp2(0x0a0f15, 0.0165);
  const hemi = new THREE.HemisphereLight(0x7890b0, 0x221e18, 0.55); scene.add(hemi); L.hemi = hemi;

  // ---- real lights (exactly 8) ------------------------------------------------------------------------------------------
  const P = (col, I, dist, x, y, z, name) => { const l = new THREE.PointLight(col, I, dist, 2); l.position.set(x, y, z); l.name = name; scene.add(l); L.lights.push(l); return l; };
  const coolCol = 0xbfe0f4;
  const lc = [
    P(coolCol, 105, 34, -21, 5.2, 4.2, 'cool0'), P(coolCol, 105, 34, -21, 5.2, -4.2, 'cool1'),
    P(coolCol, 105, 34, 0, 5.2, 4.2, 'cool2'), P(coolCol, 105, 34, 0, 5.2, -4.2, 'cool3'),
    P(coolCol, 105, 34, 21, 5.2, 4.2, 'cool4'), P(coolCol, 105, 34, 21, 5.2, -4.2, 'cool5'),
  ];
  const red = P(0xff2a14, 34, 16, -28.2, 4.4, 0, 'emergencyRed');
  const warm = P(0xffa552, 16, 12, 28.6, 2.7, -2.4, 'warm');
  L.base = lc.map((l) => l.intensity);

  // ---- fixtures --------------------------------------------------------------------------------------------------------
  const fixtures = []; // {x,y,z,kind,ph,row}
  const add = (x, y, z, row, len = 1.2) => fixtures.push({ x, y, z, row, len, kind: 0, ph: rnd() * 40, v: 1 });
  for (let x = -28; x <= 28; x += 4) add(x, 5.55, 0, 'C');
  for (const s of [1, -1]) for (let x = -30; x <= 30; x += 4) add(x, 5.3, s * 3.95, 'S');
  for (const s of [1, -1]) for (let x = -28; x <= 28; x += 8) add(x, 5.0, s * 9.5, 'P');
  // assign states: deterministic hand placement for the dramatic ones, random for the rest
  const setKind = (row, x, z, k) => { for (const f of fixtures) if (f.row === row && Math.abs(f.x - x) < 0.1 && (z === null || Math.abs(f.z - z) < 0.1)) f.kind = k; };
  setKind('C', -12, null, 2); setKind('C', 12, null, 1); setKind('C', -4, null, 1); setKind('C', 20, null, 3); setKind('S', -22, 3.95, 2); setKind('S', -18, -3.95, 1); setKind('S', 22, 3.95, 1); setKind('S', 6, -3.95, 3);
  for (const f of fixtures) if (f.kind === 0) { const r = rnd(); if (f.row === 'P') f.kind = r < 0.18 ? 1 : r < 0.28 ? 2 : r < 0.34 ? 3 : 0; else f.kind = r < 0.07 ? 1 : r < 0.11 ? 2 : r < 0.14 ? 3 : 0; }
  L.fixtures = fixtures;

  // housings + chains (merged) --------------------------------------------------------------------------------------
  const steel = c.mb('steel'), dark = c.mb('dark');
  for (const f of fixtures) {
    steel.box(f.x - 0.65, f.y + 0.04, f.z - 0.11, f.x + 0.65, f.y + 0.12, f.z + 0.11, { c: [0.55, 0.57, 0.6], seg: 4 });
    dark.box(f.x - 0.66, f.y - 0.005, f.z - 0.115, f.x + 0.66, f.y + 0.04, f.z - 0.095, { c: [0.3, 0.3, 0.3] });
    dark.box(f.x - 0.66, f.y - 0.005, f.z + 0.095, f.x + 0.66, f.y + 0.04, f.z + 0.115, { c: [0.3, 0.3, 0.3] });
    dark.box(f.x - 0.67, f.y - 0.005, f.z - 0.115, f.x - 0.65, f.y + 0.06, f.z + 0.115, { c: [0.25, 0.25, 0.25] });
    dark.box(f.x + 0.65, f.y - 0.005, f.z - 0.115, f.x + 0.67, f.y + 0.06, f.z + 0.115, { c: [0.25, 0.25, 0.25] });
    for (const dx of [-0.5, 0.5]) steel.cyl(f.x + dx, f.y + 0.12, f.z, f.x + dx, 7, f.z, 0.008, { segs: 4, c: [0.45, 0.45, 0.48] });
  }
  // tubes: instanced emissive with per-instance colour
  const tg = new THREE.BufferGeometry(); { const m = new MB(1); for (const dz of [-0.045, 0.045]) m.box(-0.6, 0.0, dz - 0.014, 0.6, 0.028, dz + 0.014, { c: [1, 1, 1], seg: 5 }); const g = m.build(); tg.copy(g); }
  const tubeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true, vertexColors: true });
  const tubes = new THREE.InstancedMesh(tg, tubeMat, fixtures.length), mtx = new THREE.Matrix4();
  fixtures.forEach((f, i) => { mtx.makeTranslation(f.x, f.y - 0.014, f.z); tubes.setMatrixAt(i, mtx); tubes.setColorAt(i, HOT); }); // (-14 mm: at -4 mm the tube was 1 mm from the housing's dark frame strips = z-fighting bright/black along the whole ceiling from ~25 m)
  tubes.frustumCulled = false; c.add(tubes); L.tubes = tubes;
  // halos
  const halo = radialTex(128, [[0, 'rgba(255,255,255,0.9)'], [0.25, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
  const hgeo = new THREE.BufferGeometry(); const hp = new Float32Array(fixtures.length * 3), hc = new Float32Array(fixtures.length * 3);
  fixtures.forEach((f, i) => { hp.set([f.x, f.y - 0.03, f.z], i * 3); hc.set([0.32, 0.44, 0.5], i * 3); });
  hgeo.setAttribute('position', new THREE.BufferAttribute(hp, 3)); hgeo.setAttribute('color', new THREE.BufferAttribute(hc, 3));
  const haloPts = new THREE.Points(hgeo, new THREE.PointsMaterial({ map: halo, size: 2.2, sizeAttenuation: true, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  haloPts.frustumCulled = false; c.add(haloPts);

  // soft additive light pools on the wet floor (fake bounce; follow fixture flicker via vertex colours)
  const poolTex = radialTex(64, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]);
  const pmb = new MB(1), poolFix = [];
  for (const f of fixtures) { if (f.row === 'P') continue; const w = f.row === 'C' ? 4.2 : 3.4, h = f.row === 'C' ? 3.0 : 1.9; const zc = f.row === 'C' ? 0 : f.z * 1.03; const base = pmb.n; pmb.oq(f.x, 0.02, zc, 0, 1, 0, w, h, [0, 0, 1, 1], { c: [0.08, 0.12, 0.15] }); f.pool = base; }
  const poolMesh = new THREE.Mesh(pmb.build(), new THREE.MeshBasicMaterial({ map: poolTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
  poolMesh.frustumCulled = false; poolMesh.renderOrder = 1; c.add(poolMesh); const poolCol = poolMesh.geometry.attributes.color;

  // light shafts (cones) for rows C and S -------------------------------------------------------------------------------------
  const cones = fixtures.filter((f) => f.row !== 'P'); const SEG = 14, cm = new MB(1);
  const aI = [], aH = []; cones.forEach((f, ci) => { f.cone = ci; });
  const topY = 5.5, botY = 0.05;
  for (const f of cones) {
    const base = cm.n, rt = 0.5, rb = f.row === 'C' ? 2.3 : 1.9;
    for (let k = 0; k < 2; k++) for (let i = 0; i <= SEG; i++) {
      const a = i / SEG * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), r = k ? rb : rt, y = k ? botY : f.y - 0.05;
      const nl = Math.hypot(1, (rb - rt) / (topY - botY)); cm.vert(f.x + ca * r * 1.9, y, f.z + sa * r, ca / nl, ((rb - rt) / (topY - botY)) / nl, sa / nl, 0, 0, 1, 1, 1);
      aI.push(1); aH.push(k);
    }
    for (let i = 0; i < SEG; i++) { const a = base + i, b = a + 1, c2 = a + SEG + 1, d = c2 + 1; cm.idx.push(a, b, c2, b, d, c2); }
  }
  const cg = cm.build(); cg.setAttribute('aI', new THREE.BufferAttribute(new Float32Array(aI), 1)); cg.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(aH), 1));
  const coneMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(0.55, 0.72, 0.85) }, uGain: { value: 0.09 } }]),
    vertexShader: `attribute float aI; attribute float aH; varying float vI; varying float vH; varying vec3 vN; varying vec3 vV;
      #include <fog_pars_vertex>
      void main(){ vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition; vN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz); vI = aI; vH = aH;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uGain; varying float vI; varying float vH; varying vec3 vN; varying vec3 vV;
      #include <fog_pars_fragment>
      void main(){ float f = abs(dot(vN * inversesqrt(max(dot(vN, vN), 1e-8)), vV * inversesqrt(max(dot(vV, vV), 1e-8)))); f = pow(f, 1.7); float a = f * pow(clamp(1.0 - vH, 0.0, 1.0), 1.4) * vI * uGain;
      #ifdef USE_FOG
        a *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #endif
      gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
  });
  const coneMesh = new THREE.Mesh(cg, coneMat); coneMesh.frustumCulled = false; coneMesh.renderOrder = 3; c.add(coneMesh);
  const coneAttr = cg.attributes.aI, vPerCone = (SEG + 1) * 2;

  // edge LED strip (shared colour, pulses amber when a train is due) ---------------------------------------------------------------
  const ledGeo = withCol(new THREE.BoxGeometry(0.34, 0.014, 0.05)); const ledN = Math.floor(64 / 0.8) * 2;
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.42, 0.5), vertexColors: true, fog: true });
  const leds = new THREE.InstancedMesh(ledGeo, ledMat, ledN); let li = 0;
  for (const s of [1, -1]) for (let x = X0 + 0.5; x < X1; x += 0.8) { mtx.makeTranslation(x, 0.02, s * 4.94); leds.setMatrixAt(li++, mtx); }
  leds.count = li; leds.instanceMatrix.needsUpdate = true; leds.frustumCulled = false; c.add(leds);
  L.ledMat = ledMat;
  L.warn = { t: 0, target: 0 };
  bus.on('train:arriving', () => { L.warn.target = 1; }); bus.on('train:doorsOpen', () => { L.warn.target = 0; }); bus.on('train:departed', () => { L.warn.target = 0; });
  bus.on('game:start', () => { L.warn.target = 0; L.warn.t = 0; });

  // red emergency beacons (columns + stairs) + amber caged bulkheads ---------------------------------------------------------------
  const redGeo = new THREE.SphereGeometry(0.075, 10, 8), redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.12, 0.05), fog: true });
  const beaconPos = [[-28.7, 4.5, 1.7], [-28.7, 4.5, -1.7], [-12, 4.3, -COLUMN_Z + 0.4], [12, 4.3, COLUMN_Z - 0.4], [28, 4.3, -COLUMN_Z + 0.4], [-20, 4.3, COLUMN_Z - 0.4], [4, 4.3, -COLUMN_Z + 0.4]];
  const rb = new THREE.InstancedMesh(redGeo, redMat, beaconPos.length);
  beaconPos.forEach((p, i) => { mtx.makeTranslation(p[0], p[1], p[2]); rb.setMatrixAt(i, mtx); steel.box(p[0] - 0.1, p[1] - 0.13, p[2] - 0.1, p[0] + 0.1, p[1] - 0.05, p[2] + 0.1, { c: [0.3, 0.3, 0.33] }); });
  rb.frustumCulled = false; c.add(rb); L.beaconMat = redMat;
  const bh = new THREE.BufferGeometry(); const bp = new Float32Array(beaconPos.length * 3), bc = new Float32Array(beaconPos.length * 3); beaconPos.forEach((p, i) => { bp.set(p, i * 3); bc.set([0.9, 0.06, 0.03], i * 3); });
  bh.setAttribute('position', new THREE.BufferAttribute(bp, 3)); bh.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  const beaconHalo = new THREE.PointsMaterial({ map: halo, size: 1.8, sizeAttenuation: true, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const bhp = new THREE.Points(bh, beaconHalo); bhp.frustumCulled = false; c.add(bhp); L.beaconAttr = bh.attributes.color;

  // amber cage bulkheads on outer walls (lit along the pit) + tunnel lamps
  const bulbs = []; for (const s of [1, -1]) for (let x = -28; x <= 28; x += 8) bulbs.push([x, 3.75, s * (WZ - 0.12), s]);
  const amberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.15, 0.32), fog: true });
  const bulbGeo = new THREE.SphereGeometry(0.09, 8, 6); const bi = new THREE.InstancedMesh(bulbGeo, amberMat, bulbs.length);
  bulbs.forEach((p, i) => { mtx.makeTranslation(p[0], p[1], p[2]); bi.setMatrixAt(i, mtx); const s = p[3]; steel.box(p[0] - 0.14, p[1] - 0.14, p[2] - s * 0.08 - (s > 0 ? 0.0 : 0.0), p[0] + 0.14, p[1] + 0.14, p[2] + s * 0.02 + 0, { c: [0.32, 0.32, 0.36] }); for (let k = -1; k <= 1; k++) steel.cyl(p[0] + k * 0.08, p[1] - 0.12, p[2] - s * 0.14, p[0] + k * 0.08, p[1] + 0.12, p[2] - s * 0.14, 0.006, { segs: 3, c: [0.5, 0.5, 0.52] }); });
  bi.frustumCulled = false; c.add(bi);
  const tl = []; for (const e of [1, -1]) for (const zs of [1, -1]) for (let x = 44; x < 138; x += 12) tl.push([e * x, 2.4, zs * 6.6 + (zs > 0 ? 2.48 : -2.48) * (e > 0 ? 1 : -1)]);
  const tunnelLamp = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 6, 5), amberMat, tl.length); tl.forEach((p, i) => { mtx.makeTranslation(p[0], p[1], p[2]); tunnelLamp.setMatrixAt(i, mtx); }); tunnelLamp.frustumCulled = false; c.add(tunnelLamp);
  const lamph = new THREE.BufferGeometry(); const lp = new Float32Array(bulbs.length * 3 + tl.length * 3); bulbs.forEach((p, i) => lp.set([p[0], p[1], p[2] - p[3] * 0.1], i * 3)); tl.forEach((p, i) => lp.set(p, (bulbs.length + i) * 3));
  const lcol = new Float32Array(lp.length); for (let i = 0; i < lp.length / 3; i++) lcol.set([0.55, 0.3, 0.08], i * 3);
  lamph.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lamph.setAttribute('color', new THREE.BufferAttribute(lcol, 3));
  const lampHalo = new THREE.Points(lamph, new THREE.PointsMaterial({ map: halo, size: 2.6, sizeAttenuation: true, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); lampHalo.frustumCulled = false; c.add(lampHalo);
  // trackside signals in the tunnels (red aspect + a couple of green)
  const sigs = [[-47, 1], [-47, -1], [58, 1], [58, -1], [-96, 1], [104, -1]];
  const sigGeo = new THREE.CircleGeometry(0.11, 12);
  const sigR = new THREE.InstancedMesh(sigGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.08), fog: true, side: THREE.DoubleSide }), sigs.length);
  const sgh = new THREE.BufferGeometry(); const sgp = new Float32Array(sigs.length * 3), sgc = new Float32Array(sigs.length * 3);
  sigs.forEach(([x, zs], i) => { const zc = zs * 6.6, z = zc + (zs > 0 ? 2.45 : -2.45); mtx.makeRotationY(Math.PI / 2).setPosition(x, 2.3, z); sigR.setMatrixAt(i, mtx); sgp.set([x, 2.3, z], i * 3); sgc.set([0.9, 0.05, 0.03], i * 3); steel.box(x - 0.05, 0.4, z - 0.05, x + 0.05, 2.5, z + 0.05, { c: [0.3, 0.3, 0.33] }); c.mb('dark').box(x - 0.09, 2.15, z - 0.16, x + 0.09, 2.45, z + 0.16, { c: [0.15, 0.15, 0.17] }); });
  sgh.setAttribute('position', new THREE.BufferAttribute(sgp, 3)); sgh.setAttribute('color', new THREE.BufferAttribute(sgc, 3)); const sgHalo = new THREE.Points(sgh, new THREE.PointsMaterial({ map: halo, size: 1.6, sizeAttenuation: true, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); sgHalo.frustumCulled = false;
  sigR.frustumCulled = false; c.add(sigR); c.add(sgHalo);

  // ---- environment map ----------------------------------------------------------------------------------------------------------
  L.buildEnv = () => {
    const env = new THREE.Scene(); const EYE = 1.6;
    const shell = new THREE.Mesh(new THREE.BoxGeometry(64, 9, 23), new THREE.MeshBasicMaterial({ color: 0x1b242e, side: THREE.BackSide })); shell.position.y = (7 + LAYOUT.bedY) / 2 - EYE; shell.scale.y = (7 - LAYOUT.bedY) / 9; env.add(shell);
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(7.5, 8.5, 9.5) }), sg = new THREE.BoxGeometry(1.2, 0.06, 0.12);
    for (const f of fixtures) { const m = new THREE.Mesh(sg, f.kind === 3 ? new THREE.MeshBasicMaterial({ color: 0x0a0d10 }) : strip); m.position.set(f.x, f.y - EYE, f.z); env.add(m); }
    const mk = (col, w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: col })); m.position.set(x, y - EYE, z); env.add(m); };
    mk(new THREE.Color(6, 0.5, 0.25), 0.6, 0.6, 3, -31, 3.2, 0); mk(new THREE.Color(4, 2.2, 0.8), 2, 2.4, 0.3, 31.5, 1.6, -3); // west red beacon, east vending glow
    for (const zs of [1, -1]) mk(new THREE.Color(0.02, 0.02, 0.03), 0.4, 4.6, 5.2, 32, 1.6, zs * 6.6); // tunnel mouths are black
    for (const zs of [1, -1]) mk(new THREE.Color(0.02, 0.02, 0.03), 0.4, 4.6, 5.2, -32, 1.6, zs * 6.6);
    try { const pm = new THREE.PMREMGenerator(game.renderer); const rt = pm.fromScene(env, 0.02, 0.1, 120); pm.dispose(); scene.environment = rt.texture; scene.environmentIntensity = 0.7; L.envRT = rt; } catch (e) { console.warn('[station] environment map unavailable', e); }
    env.traverse((o) => { if (o.geometry) o.geometry.dispose?.(); });
  };

  // ---- runtime ---------------------------------------------------------------------------------------------------------------
  const tubeCol = tubes.instanceColor.array, colAttr = hgeo.attributes.color, tc = new THREE.Color();
  const flickering = fixtures.map((f, i) => [f, i]).filter(([f]) => f.kind !== 0);
  // which light dims with which fixture: each cool light follows the nearest row-C / row-S fixtures
  const link = lc.map((l) => fixtures.filter((f) => f.row !== 'P' && Math.abs(f.x - l.position.x) < 4.1 && Math.abs(f.z - l.position.z) < 4.6).map((f) => f));
  const nF = flickering.length, nL = lc.length, nB = beaconPos.length;
  L.update = (dt, t) => {
    for (let q = 0; q < nF; q++) {
      const f = flickering[q][0], i = flickering[q][1];
      const v = flickerValue(f.kind, t, f.ph); f.v = v;
      tubeCol[i * 3] = HOT.r * v; tubeCol[i * 3 + 1] = HOT.g * v; tubeCol[i * 3 + 2] = HOT.b * v;
      colAttr.setXYZ(i, 0.32 * v, 0.44 * v, 0.5 * v);
      if (f.cone !== undefined) for (let k = 0; k < vPerCone; k++) coneAttr.setX(f.cone * vPerCone + k, v);
      if (f.pool !== undefined) for (let k = 0; k < 4; k++) poolCol.setXYZ(f.pool + k, 0.08 * v, 0.12 * v, 0.15 * v);
    }
    if (nF) { poolCol.needsUpdate = true; tubes.instanceColor.needsUpdate = true; colAttr.needsUpdate = true; coneAttr.needsUpdate = true; }
    for (let i = 0; i < nL; i++) { const fs = link[i]; let s = 0; for (let k = 0; k < fs.length; k++) s += fs[k].v; lc[i].intensity = L.base[i] * (fs.length ? 0.35 + 0.65 * (s / fs.length) : 1); }
    // red emergency pulse
    const rp = 0.55 + 0.45 * Math.sin(t * 5.2), rp2 = Math.max(0, Math.sin(t * 2.6)) ** 2;
    red.intensity = 22 + 26 * rp2; redMat.color.setRGB(1.0 + 2.6 * rp, 0.06, 0.03);
    for (let i = 0; i < nB; i++) { const k = (i < 2 ? rp2 : 0.5 + 0.5 * Math.sin(t * 2.6 + i)); L.beaconAttr.setXYZ(i, 0.2 + 0.7 * k, 0.03, 0.02); } L.beaconAttr.needsUpdate = true;
    warm.intensity = 14 * (0.92 + 0.08 * Math.sin(t * 9.0) * Math.sin(t * 3.3));
    // edge LEDs: dim cold white normally, amber pulse while a train is approaching
    L.warn.t += (L.warn.target - L.warn.t) * Math.min(1, dt * 3);
    const w = L.warn.t, pulse = 0.5 + 0.5 * Math.sin(t * 9.0);
    ledMat.color.setRGB(0.32 + w * (3.0 * pulse - 0.32), 0.4 + w * (1.4 * pulse - 0.4), 0.48 + w * (0.1 - 0.48));
  };
  return L;
}

function withCol(geo) { const n = geo.attributes.position.count, a = new Float32Array(n * 3).fill(1); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; }
