// Chainsaw viewmodel geometry: orange/black two-stroke saw ("REAPER 660"), guide bar + chain, starter with pull cord, gloved hands and sleeves.
// Everything static is merged per material (few draw calls); the chain, trigger, cord, hands and arm are live parts. All materials that touch the
// housing / bar / chain / gloves are CLONES of the kit's with the blood patch (see blood.js).
import * as THREE from 'three';
import { toCreasedNormals, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Parts, Hand } from '../kit_a.js';
import { cloneBlood, bloodify, swapMaterials } from './blood.js';
import { makeChain, BAR } from './chain.js';
import { getSawPaint } from './paint.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SLEEVE = 0.40;                 // forearm length (m): long enough to leave the bottom of the frame, short enough never to reach the camera plane
// hand-local centre of the loop the curled fingers make round a handle (the handle axis is the hand's local X axis through this point)
export const GRIP = new THREE.Vector3(0, -0.026, -0.082);
// wrist position for a hand with orientation q whose grip centre must sit at T
export function gripPose(T, q, out) { return out.copy(GRIP).applyQuaternion(q).negate().add(T); }
const _yAxis = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _e = new THREE.Euler();

// cylinder / cone between two points (radii ra at a, rb at b)
function between(F, mat, a, b, ra, rb, seg = 12) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length(); d.normalize();
  _q.setFromUnitVectors(_yAxis, d); _e.setFromQuaternion(_q, 'YXZ');
  return F.cyl(mat, rb, ra, len, 'y', [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], [_e.x, _e.y, _e.z], seg);
}

// fewer triangles: rounded boxes get 1 corner segment, and tiny boxes (thinnest side < 11 mm, invisible rounding) are plain boxes
function cheapBoxes(P) {
  const orig = P.box.bind(P);
  P.box = (mat, size, p, r, rad = 0, seg = 1) => orig(mat, size, p, r, Math.min(size[0], size[1], size[2]) < 0.011 ? 0 : rad, seg);
  return P;
}

// merge the meshes hanging directly off a finger joint by material (a finger was 9 draw calls: cylinder + knuckle sphere + ring per phalanx)
function mergeJointMeshes(j) {
  const by = new Map();
  for (const m of [...j.children]) {
    if (!m.isMesh) continue;
    m.updateMatrix(); const g = m.geometry.clone(); g.applyMatrix4(m.matrix); j.remove(m);
    let a = by.get(m.material); if (!a) by.set(m.material, a = []); a.push(g);
  }
  for (const [mat, gs] of by) { const mesh = new THREE.Mesh(gs.length > 1 ? mergeGeometries(gs, false) : gs[0], mat); mesh.frustumCulled = false; j.add(mesh); }
}

// Every sticker / engraving of the saw in ONE transparent mesh: a small canvas atlas + merged quads (four separate canvases and draw calls before).
// item: { rect: [x, y, w, h] px in the atlas, size: [w, h] metres, pos: [x, y, z] saw-local (quad faces -X), text: [lines], o: textDecal-style options }
function makeDecals(items, U) {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), geos = [];
  for (const it of items) {
    const [ax, ay, pw, ph] = it.rect, o = it.o || {};
    if (o.bg) { g.fillStyle = o.bg; g.fillRect(ax, ay, pw, ph); }
    g.save(); g.beginPath(); g.rect(ax, ay, pw, ph); g.clip();
    g.fillStyle = o.color ?? 'rgba(235,235,225,0.85)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${o.weight ?? 'bold'} ${Math.round(ph * (o.size ?? 0.72))}px ${o.font ?? 'Arial Narrow, Arial, sans-serif'}`;
    if (o.spacing && 'letterSpacing' in g) g.letterSpacing = o.spacing;
    it.text.forEach((t, i) => g.fillText(t, ax + pw / 2, ay + ph * (i + 0.5) / it.text.length));
    g.restore();
    const q = new THREE.PlaneGeometry(it.size[0], it.size[1]), uv = q.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (ax + uv.getX(i) * pw) / W, 1 - (ay + (1 - uv.getY(i)) * ph) / H);
    q.rotateY(-Math.PI / 2); q.translate(it.pos[0], it.pos[1], it.pos[2]); geos.push(q);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), bloodify(new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), U, { key: 'decal' }));   // stickers get bloody like everything else
  for (const q of geos) q.dispose();
  mesh.frustumCulled = false; mesh.name = 'decals'; return mesh;
}

export function buildSaw(game, kit, U) {
  const M = kit.M;
  const out = { pts: {} };
  const saw = new THREE.Group(); saw.name = 'saw'; saw.rotation.order = 'YXZ'; out.saw = saw;

  // ---- materials
  const vc = (name, hex, target) => ({ isVC: true, name, color: new THREE.Color(hex), target: target || M.vcDull, userData: { uv: 8 } });
  const hazard = vc('hazard', 0xe8b414), redP = vc('redP', 0xa81414);
  const fuelMat = new THREE.MeshStandardMaterial({ color: 0xffb648, emissive: 0x9a5200, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.88, envMap: kit.env, envMapIntensity: 0.8 });
  const shared = ['sawPlastic', 'stipple', 'steel', 'dark', 'bar', 'leather', 'gloveDark', 'fabric', 'vcDull', 'vcMetal'];
  const swap = new Map(); for (const k of shared) swap.set(M[k], cloneBlood(M[k], U));
  swap.set(M.orange, getSawPaint(game, kit).makeOrange(U));
  swap.get(M.bar).color.set(0xb4bcc8); swap.get(M.bar).roughness = 0.5;
  swap.get(M.leather).color.setRGB(2.2, 1.85, 1.4);      // tan work gloves: the dark-brown kit leather vanished against the black handles
  swap.get(M.fabric).color.setRGB(1.35, 1.35, 1.25);
  out.materials = [...swap.values()];

  // =================================================================================================================================
  // STATIC BODY
  const F = new Parts();
  cheapBoxes(F);
  // ---- powerhead: orange shroud over black crankcase / fuel tank
  F.profile(M.orange, [[0.040, 0.094, 0.030], [0.046, 0.058, 0.012], [0.004, 0.034, 0.006], [-0.310, 0.034, 0.010], [-0.334, 0.066, 0.010], [-0.334, 0.104, 0.026], [-0.262, 0.134, 0.040], [-0.120, 0.146, 0.052], [-0.010, 0.132, 0.048]], 0.108, [0, 0, 0], null, 0.004);
  F.profile(M.sawPlastic, [[0.012, 0.040, 0.010], [0.008, -0.012, 0.012], [-0.030, -0.046, 0.020], [-0.110, -0.062, 0.026], [-0.286, -0.062, 0.022], [-0.322, -0.024, 0.014], [-0.322, 0.040, 0.006]], 0.098, [0, 0, 0], null, 0.004);
  F.box(M.dark, [0.110, 0.003, 0.300], [0, 0.0335, -0.160], null, 0.001);                                      // seam / gasket line between shroud and tank
  for (let i = 0; i < 4; i++) F.box(M.dark, [0.100, 0.004, 0.012], [0, -0.064, -0.09 - i * 0.07], null, 0.001); // skid ribs
  // hazard chevron strip along the lower left edge of the shroud
  for (let i = 0; i < 9; i++) F.box(i % 2 ? M.black : hazard, [0.0022, 0.011, 0.0135], [-0.0546, 0.047, -0.062 - i * 0.0137], null, 0.0006);
  // ---- front top handle (tubular arch) with rubber grip
  const ARCH = [[-0.052, 0.104], [-0.060, 0.146], [-0.052, 0.182], [-0.030, 0.203], [0.030, 0.203], [0.052, 0.182], [0.060, 0.146], [0.052, 0.104]];
  F.tube(M.sawPlastic, ARCH.map(([x, y]) => [x, y, -0.150]), 0.0125, [0, 0, 0], 56);
  F.cyl(M.stipple, 0.0170, 0.0170, 0.082, 'x', [0, 0.2035, -0.150], null, 18);
  for (const s of [-1, 1]) F.cyl(M.stipple, 0.0148, 0.0148, 0.030, 'y', [s * 0.0575, 0.130, -0.150], null, 14);      // side struts rubber
  for (const s of [-1, 1]) F.torus(M.dark, 0.0175, 0.0018, [s * 0.0405, 0.2035, -0.150], [0, Math.PI / 2, 0], 16);     // grip end rings
  // ---- chain brake hand guard (orange, hinged) with hazard strip
  F.box(M.orange, [0.112, 0.040, 0.010], [0, 0.166, -0.240], [0.52, 0, 0], 0.005);
  F.box(M.trim, [0.104, 0.007, 0.011], [0, 0.152, -0.228], [0.52, 0, 0], 0.002);
  for (const s of [-1, 1]) { F.box(M.sawPlastic, [0.010, 0.030, 0.016], [s * 0.056, 0.160, -0.226], [0.52, 0, 0], 0.004); F.cyl(M.steel, 0.006, 0.006, 0.010, 'x', [s * 0.0555, 0.146, -0.214], null, 10); }   // (short struts: the label sits just below them)
  // ---- air filter cover with ribs, primer bulb, choke lever
  F.box(M.sawPlastic, [0.090, 0.026, 0.102], [0, 0.153, -0.036], [0.08, 0, 0], 0.011);
  for (let i = 0; i < 7; i++) F.box(M.black, [0.066, 0.0026, 0.0055], [0, 0.1665 - i * 0.0006, -0.010 - i * 0.0125], [0.08, 0, 0], 0.001);
  F.cyl(M.trim, 0.0075, 0.0075, 0.012, 'y', [0.026, 0.168, -0.038], null, 14);                                  // orange wing-nut
  F.sphere(redP, 0.0105, [0.028, 0.142, -0.098], null, [1, 0.85, 1.1], 12);                                   // primer bulb
  F.torus(M.dark, 0.0105, 0.0019, [0.028, 0.136, -0.098], [Math.PI / 2, 0, 0], 12);
  F.box(hazard, [0.006, 0.012, 0.022], [-0.030, 0.149, -0.098], [0.3, 0, 0], 0.002);                           // master lever
  // ---- fuel + oil caps
  F.cyl(M.black, 0.0165, 0.0165, 0.012, 'y', [0.030, 0.1385, -0.196], null, 18);
  F.torus(M.trim, 0.0165, 0.0026, [0.030, 0.1455, -0.196], [Math.PI / 2, 0, 0], 20);
  F.box(M.dark, [0.004, 0.004, 0.024], [0.030, 0.1475, -0.196], null, 0.001);
  F.cyl(M.black, 0.0125, 0.0125, 0.011, 'y', [-0.030, 0.1385, -0.204], null, 16);
  F.box(M.chrome, [0.004, 0.004, 0.018], [-0.030, 0.1445, -0.204], null, 0.001);
  // ---- exhaust stack (top, front-left): spark-arrestor pot with a chrome cap - the visible smoke source
  F.cyl(M.steel, 0.0135, 0.0150, 0.034, 'y', [-0.036, 0.152, -0.196], null, 18);
  F.cyl(M.dark, 0.0142, 0.0142, 0.006, 'y', [-0.036, 0.166, -0.196], null, 18);
  F.torus(M.chrome, 0.0136, 0.0018, [-0.036, 0.1705, -0.196], [Math.PI / 2, 0, 0], 16);
  F.cyl(M.black, 0.0095, 0.0095, 0.004, 'y', [-0.036, 0.1715, -0.196], null, 14);
  for (let i = 0; i < 3; i++) F.torus(M.dark, 0.0142, 0.0011, [-0.036, 0.140 + i * 0.010, -0.196], [Math.PI / 2, 0, 0], 14);
  F.box(M.steel, [0.0022, 0.030, 0.026], [-0.0555, 0.136, -0.196], null, 0.001);                                 // heat-shield strap
  // ---- spark-plug boot + wire
  F.cyl(M.black, 0.0085, 0.0100, 0.026, 'y', [-0.004, 0.156, -0.262], null, 12); F.cyl(M.chrome, 0.0046, 0.0046, 0.006, 'y', [-0.004, 0.172, -0.262], null, 8);
  F.tube(M.black, [[-0.004, 0.150, -0.262], [-0.020, 0.146, -0.245], [-0.040, 0.146, -0.226]], 0.0028, [0, 0, 0], 12);
  // ---- side louvres + screws (left side) and fuel window
  for (const [y, z] of [[0.122, -0.040], [0.128, -0.290], [0.052, -0.290], [0.052, -0.026], [0.128, -0.100], [0.046, -0.190]]) F.cyl(M.steel, 0.0040, 0.0040, 0.0045, 'x', [-0.0555, y, z], null, 10);
  F.box(M.black, [0.004, 0.038, 0.062], [-0.0500, 0.004, -0.170], null, 0.003);                                 // fuel window frame
  // ---- clutch / sprocket cover (left), bar nuts, tensioner, bumper spike
  F.cyl(M.dark, 0.066, 0.066, 0.013, 'x', [BAR.X - 0.0135, BAR.Y, -0.290], null, 36);
  F.cyl(M.sawPlastic, 0.056, 0.056, 0.007, 'x', [BAR.X - 0.0225, BAR.Y, -0.290], null, 36);
  F.torus(M.trim, 0.058, 0.0022, [BAR.X - 0.0262, BAR.Y, -0.290], [0, Math.PI / 2, 0], 40);
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.2; F.box(M.dark, [0.0025, 0.020, 0.007], [BAR.X - 0.0268, BAR.Y + Math.cos(a) * 0.036, -0.290 + Math.sin(a) * 0.036], [a, 0, 0], 0.001); }  // cooling vanes
  for (const z of [-0.262, -0.338]) { F.cyl(M.steel, 0.0090, 0.0090, 0.012, 'x', [BAR.X - 0.030, BAR.Y, z], null, 6); F.cyl(M.dark, 0.0052, 0.0052, 0.014, 'x', [BAR.X - 0.030, BAR.Y, z], null, 8); }
  F.cyl(M.steel, 0.0068, 0.0068, 0.011, 'x', [BAR.X - 0.028, BAR.Y - 0.040, -0.322], null, 10); F.box(M.black, [0.014, 0.0025, 0.0025], [BAR.X - 0.0345, BAR.Y - 0.040, -0.322], null, 0.0006);
  for (const s of [0, 1]) F.box(M.dark, [0.011, 0.010, 0.032], [-0.030 - s * 0.056, -0.040, -0.318], [0.3, 0, 0], 0.002);   // bumper dogs
  F.box(M.steel, [0.070, 0.004, 0.014], [-0.045, -0.056, -0.340], [0.25, 0, 0], 0.001);
  // ---- muffler (left-rear): dark perforated heat shield in a steel frame + tail pipe
  F.box(M.dark, [0.011, 0.058, 0.086], [-0.0625, 0.014, 0.004], null, 0.005);
  F.box(M.steel, [0.0125, 0.0035, 0.088], [-0.0625, 0.0435, 0.004], null, 0.001); F.box(M.steel, [0.0125, 0.0035, 0.088], [-0.0625, -0.0155, 0.004], null, 0.001);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) F.cyl(M.black, 0.0032, 0.0032, 0.003, 'x', [-0.0685, -0.002 + i * 0.0125, -0.030 + j * 0.0125], null, 8);
  F.cyl(M.steel, 0.0135, 0.0135, 0.042, 'z', [-0.050, 0.008, 0.048], null, 14);
  F.cyl(M.black, 0.0092, 0.0092, 0.0435, 'z', [-0.050, 0.008, 0.048], null, 12);
  F.torus(M.dark, 0.0135, 0.0016, [-0.050, 0.008, 0.0685], [0, 0, 0], 14);
  // ---- starter housing (left/rear) with vents + rope eyelet
  F.cyl(M.sawPlastic, 0.046, 0.046, 0.020, 'x', [-0.064, 0.076, -0.058], null, 30);
  F.cyl(M.dark, 0.036, 0.036, 0.004, 'x', [-0.0765, 0.076, -0.058], null, 26);
  F.cyl(M.trim, 0.011, 0.011, 0.004, 'x', [-0.0795, 0.076, -0.058], null, 14);
  for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; F.box(M.black, [0.0030, 0.010, 0.0044], [-0.0775, 0.076 + Math.cos(a) * 0.028, -0.058 + Math.sin(a) * 0.028], [a, 0, 0], 0.001); }
  F.torus(M.chrome, 0.0058, 0.0022, [-0.0775, 0.036, -0.090], [0, Math.PI / 2, 0], 12);
  // ---- rear wrap-around handle (tube) + rubber grip, vibration mounts, trigger guard
  F.tube(M.sawPlastic, [[0, 0.060, 0.010], [0, 0.079, 0.055], [0, 0.066, 0.092], [0, 0.020, 0.102], [0, -0.030, 0.094], [0, -0.070, 0.066], [0, -0.084, 0.020], [0, -0.070, -0.026]], 0.0142, [0, 0, 0], 56);
  { const a = V(0, 0.046, 0.101), b = V(0, -0.056, 0.089); between(F, M.stipple, a, b, 0.0205, 0.0205, 18); }
  for (let i = 0; i < 6; i++) F.torus(M.dark, 0.0204, 0.0012, [0, 0.036 - i * 0.0165, 0.1002 - i * 0.002], [Math.PI / 2 + 0.11, 0, 0], 14);
  F.box(M.stipple, [0.040, 0.012, 0.030], [0, -0.079, 0.045], [0.3, 0, 0], 0.005);
  F.box(M.stipple, [0.044, 0.030, 0.020], [0, 0.066, 0.086], null, 0.006);
  for (const [y, z] of [[0.062, 0.006], [-0.066, -0.024]]) F.box(M.rubber, [0.058, 0.020, 0.018], [0, y, z], null, 0.006);   // vibration dampers
  F.tube(M.sawPlastic, [[0, 0.049, 0.062], [0, 0.028, 0.068], [0, 0.008, 0.058], [0, -0.004, 0.036]], 0.0085, [0, 0, 0], 18);  // trigger guard loop
  F.box(hazard, [0.0105, 0.0125, 0.026], [0, 0.0655, 0.010], [0.15, 0, 0], 0.003);                             // throttle lockout
  // ---- text / stickers
  F.box(M.black, [0.0016, 0.030, 0.082], [-0.0549, 0.113, -0.258], null, 0.0006);
  const IMPACT = 'Impact, Arial Black, sans-serif';
  saw.add(makeDecals([
    { rect: [0, 0, 1024, 57], size: [0.19, 0.0105], pos: [BAR.X - 0.0046, BAR.Y + 0.0195, -0.56], text: ['REAPER   \u00b7   18 IN   \u00b7   .325'], o: { color: 'rgba(214,220,230,0.78)', size: 0.86, weight: '800', font: IMPACT, spacing: '2px' } },
    { rect: [0, 80, 512, 158], size: [0.078, 0.024], pos: [-0.0559, 0.113, -0.258], text: ['REAPER'], o: { color: 'rgba(250,244,232,0.96)', size: 0.66, weight: '900', font: IMPACT, spacing: '3px' } },
    { rect: [544, 80, 256, 207], size: [0.042, 0.034], pos: [-0.0548, 0.066, -0.118], text: ['DANGER', 'BLADE'], o: { bg: 'rgba(238,186,20,0.96)', color: 'rgba(15,15,15,0.95)', size: 0.36 } },
    { rect: [832, 80, 160, 160], size: [0.030, 0.030], pos: [-0.0790, 0.076, -0.058], text: ['\u2620'], o: { color: 'rgba(240,235,225,0.85)', size: 0.95, font: 'Arial, sans-serif' } },
  ], U));
  const fuelWin = new THREE.Mesh(new THREE.PlaneGeometry(0.054, 0.028), fuelMat); fuelWin.position.set(-0.0522, 0.004, -0.170); fuelWin.rotation.y = -Math.PI / 2; saw.add(fuelWin);

  // =================================================================================================================================
  // GUIDE BAR (static plate; the chain lives in chain.js)
  const B = new Parts();
  cheapBoxes(B);
  B.profile(M.bar, [[-0.300, -0.0285, 0.004], [-0.792, -0.0285, 0.0285], [-0.792, 0.0285, 0.0285], [-0.300, 0.0285, 0.004]], 0.0078, [BAR.X, BAR.Y, 0], null, 0.0006);
  for (const sx of [-1, 1]) {
    for (const [z, l] of [[-0.420, 0.090], [-0.530, 0.090], [-0.650, 0.070]]) B.box(M.black, [0.0016, 0.012, l], [BAR.X + sx * 0.0040, BAR.Y, z], null, 0.0006);   // lightening slots
    B.cyl(M.dark, 0.0092, 0.0092, 0.0012, 'x', [BAR.X + sx * 0.0040, BAR.Y, BAR.ZT], null, 16);
    B.cyl(M.chrome, 0.0034, 0.0034, 0.0016, 'x', [BAR.X + sx * 0.0043, BAR.Y, -0.352], null, 8);                                                 // oiler hole
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; B.cyl(M.chrome, 0.0016, 0.0016, 0.0014, 'x', [BAR.X + sx * 0.0043, BAR.Y + Math.cos(a) * 0.014, BAR.ZT + Math.sin(a) * 0.014 - 0.006], null, 6); }
  }
  B.cyl(M.steel, 0.0032, 0.0032, 0.0096, 'x', [BAR.X, BAR.Y, BAR.ZT], null, 8);
  for (const y of [-0.0288, 0.0288]) B.box(M.dark, [0.0060, 0.0018, 0.44], [BAR.X, BAR.Y + y, -0.545], null, 0.0006);                           // chain rails
  out.bar = B.build('bar'); saw.add(out.bar);


  // =================================================================================================================================
  // LIVE PARTS
  // ---- trigger (pivot at the top of the guard)
  out.trigger = new THREE.Group(); out.trigger.position.set(0, 0.046, 0.052);
  { const Tp = new Parts(); Tp.box(M.dark, [0.0095, 0.038, 0.010], [0, -0.019, 0], [0.30, 0, 0], 0.003); Tp.box(hazard, [0.010, 0.006, 0.012], [0, -0.038, 0.010], [0.3, 0, 0], 0.002); out.trigger.add(Tp.build('trig')); saw.add(out.trigger); }

  // ---- pull cord: rope (thin cylinder stretched between the eyelet and the handle) + T handle
  out.cord = { eye: V(-0.0775, 0.036, -0.090), rest: V(-0.084, 0.030, -0.100), dir: V(-0.10, 0.28, 0.96).normalize(), handle: new THREE.Group(), rope: null };
  { const Hp = new Parts(); Hp.box(M.trim, [0.038, 0.014, 0.014], [0, 0, 0], null, 0.005); Hp.box(M.rubber, [0.030, 0.017, 0.017], [0, 0, 0], null, 0.006); Hp.cyl(M.dark, 0.006, 0.006, 0.010, 'y', [0, 0.010, 0], null, 8); out.cord.handle.add(Hp.build('cordHandle')); saw.add(out.cord.handle);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.0029, 0.0029, 1, 6), new THREE.MeshStandardMaterial({ color: 0x6e6450, roughness: 0.9, metalness: 0 })); rope.frustumCulled = false; saw.add(rope); out.cord.rope = rope; }

  // ---- chain
  out.chain = makeChain(kit, U, saw);
  out.materials.push(...out.chain.materials);

  // =================================================================================================================================
  // HANDS
  out.handR = new Hand(kit, { side: 'R', freeze: true, keep: ['index'], sleeveLen: SLEEVE,
    pose: { i: [0.50, 0.62, 0.45], m: [1.42, 1.50, 0.95], r: [1.46, 1.55, 0.95], p: [1.44, 1.55, 0.9], t: { yaw: 0.10, pitch: -0.95, roll: 0.15, c: [0.10, 0.25, 0.30] } } });
  out.idxF = out.handR.find('index'); for (const j of out.idxF.joints) mergeJointMeshes(j);
  { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, -0.08, -Math.PI / 2, 'YXZ')), p = new THREE.Vector3();
    gripPose(V(0.0, -0.004, 0.0955), q, p); out.handR.group.position.copy(p); out.handR.group.quaternion.copy(q); saw.add(out.handR.group); }
  out.handL = new Hand(kit, { side: 'L', freeze: true, sleeveLen: SLEEVE,
    pose: { i: [1.35, 1.55, 1.0], m: [1.40, 1.6, 1.0], r: [1.42, 1.6, 1.0], p: [1.40, 1.6, 1.0], t: { yaw: 0.35, pitch: -0.35, roll: 0.9, c: [0.20, 0.55, 0.6] } } });
  out.handL.group.position.set(0, 0, 0); out.handL.group.rotation.set(0, 0, 0);
  out.lhPivot = new THREE.Group(); out.lhPivot.rotation.order = 'YXZ'; out.lhPivot.add(out.handL.group); saw.add(out.lhPivot);
  // hi-vis band + reflective stripes on both sleeves (a metro-worker jacket breaks up the plain olive tube): merged into each arm's existing vertex-colour mesh
  { const vcm = (hex) => ({ isVC: true, name: 'hv', color: new THREE.Color(hex), target: M.vcDull, userData: { uv: 8 } }), yel = vcm(0x7c8316), sil = vcm(0xa4acb4);
    const rad = (z) => 0.0405 + 0.0075 * ((z - 0.05) / SLEEVE);
    for (const h of [out.handL, out.handR]) {
      const P = new Parts(); P.cyl(yel, rad(0.170) + 0.0014, rad(0.210) + 0.0014, 0.040, 'z', [0, 0, 0.190], null, 22);
      for (const z of [0.178, 0.202]) P.cyl(sil, rad(z - 0.002) + 0.0021, rad(z + 0.002) + 0.0021, 0.004, 'z', [0, 0, z], null, 22);
      const ex = h.arm.children.find((m) => m.isMesh && m.material === M.vcDull), g2 = P.geometry(M.vcDull);
      if (ex) { const old = ex.geometry; ex.geometry = mergeGeometries([old, g2], false); old.dispose(); g2.dispose(); } else h.arm.add(Object.assign(new THREE.Mesh(g2, M.vcDull), { frustumCulled: false }));
    } }
  out.handR.bake(F, saw);

  // ---- finish static body (merged per material)
  out.body = F.build('saw-body'); saw.add(out.body);
  // extruded profiles come out with flat (faceted) normals: re-smooth everything except hard edges (crease angle ~50 deg)
  for (const grp of [out.body, out.bar]) grp.traverse((o) => { if (o.isMesh) { const g2 = toCreasedNormals(o.geometry, 0.9); if (g2 !== o.geometry) { o.geometry.dispose(); o.geometry = g2; } } });

  // ---- emitters / anchors (saw-local)
  const pt = (name, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); o.name = name; saw.add(o); out.pts[name] = o; return o; };
  pt('exhaust', -0.036, 0.1745, -0.196); pt('haze', 0.0, 0.168, -0.040); pt('nose', BAR.X, BAR.Y, BAR.ZT - 0.012); pt('noseTop', BAR.X, BAR.Y + BAR.R + 0.004, BAR.ZT + 0.006);
  pt('barMid', BAR.X, BAR.Y - BAR.R - 0.004, (BAR.ZR + BAR.ZT) / 2); pt('cordEye', out.cord.eye.x, out.cord.eye.y, out.cord.eye.z); pt('barTop', BAR.X, BAR.Y + BAR.R + 0.004, (BAR.ZR + BAR.ZT) / 2 + 0.05);

  // ---- swap kit materials -> blood clones (statics, hands, arms)
  swapMaterials(saw, swap);

  // ---- base hold pose of the whole saw in view space
  saw.rotation.set(0.05, 0.50, 0.03); saw.position.set(0, 0, 0);
  return out;
}
