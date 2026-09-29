// Assembles the train scene graph: merged car meshes, instanced door leaves / wheelsets, glows and light pools.
import * as THREE from 'three';
import { GB, rgb } from './gb.js';
import * as K from './consts.js';
import { buildCar, buildBogie, buildWheelset, buildGap, addLeaf } from './car.js';
import { makeTextures } from './textures.js';

export function buildTrain() {
  const T = makeTextures();
  const G = {
    ext: new GB(0.5), extDecal: new GB(1), glass: new GB(1), under: new GB(0.5), signs: new GB(1), lampDoor: new GB(1), lampHead: new GB(1), lampTail: new GB(1), lampMark: new GB(1), ledInt: new GB(1),
    cars: [0, 1, 2].map(() => ({ int: new GB(0.5), dec: new GB(1), strip: new GB(1) })),
  };
  for (let i = 0; i < K.CAR_COUNT; i++) buildCar(G, T, i);
  for (let i = 0; i < K.CAR_COUNT; i++) for (const s of [-1, 1]) buildBogie(G, K.carU(i) + s * K.BOGIE_U);
  for (let i = 0; i < K.CAR_COUNT - 1; i++) buildGap(G, K.carU(i) + K.HALF, K.carU(i + 1) - K.HALF);

  const M = {};
  M.body = new THREE.MeshStandardMaterial({ map: T.body, normalMap: T.bodyN, normalScale: new THREE.Vector2(0.75, 0.75), vertexColors: true, roughness: 0.5, metalness: 0.22, emissive: 0x0c1216 });
  M.under = new THREE.MeshLambertMaterial({ map: T.grain, vertexColors: true, emissive: 0x080b0d });
  M.extDecal = new THREE.MeshLambertMaterial({ map: T.extAtlas.tex, transparent: true, depthWrite: false, emissive: 0x0a0e10, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  M.glass = new THREE.MeshBasicMaterial({ map: T.glass, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  M.sign = new THREE.MeshBasicMaterial({ map: T.signFront.tex, color: 0xffffff });
  M.led = new THREE.MeshBasicMaterial({ map: T.signDoor.tex, color: 0xffffff });
  M.lampHead = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.85, 2.5) });
  M.lampTail = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.12, 0.08) });
  M.lampMark = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.7, 0.2) });
  M.lampDoor = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.03, 0.01) });
  M.int = []; M.intDec = []; M.strip = [];
  for (let i = 0; i < K.CAR_COUNT; i++) {
    M.int.push(new THREE.MeshBasicMaterial({ map: T.grain, vertexColors: true }));
    M.intDec.push(new THREE.MeshBasicMaterial({ map: T.intAtlas.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    M.strip.push(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.2, 2.2) }));
  }

  const root = new THREE.Group(); root.name = 'train';
  const body = new THREE.Group(); body.name = 'trainBody'; // sways
  const chassis = new THREE.Group(); chassis.name = 'trainChassis'; // bogies, wheels, pools, beams (no sway)
  root.add(body, chassis);
  const add = (parent, geo, mat, order = 0) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = order; parent.add(m); return m; };

  add(body, G.ext.build(), M.body);
  add(body, G.extDecal.build(), M.extDecal, 1);
  add(body, G.glass.build(), M.glass, 2);
  add(body, G.signs.build(), M.sign);
  add(body, G.ledInt.build(), M.led);
  add(body, G.lampHead.build(), M.lampHead);
  add(body, G.lampTail.build(), M.lampTail);
  add(body, G.lampMark.build(), M.lampMark);
  add(body, G.lampDoor.build(), M.lampDoor);
  for (let i = 0; i < K.CAR_COUNT; i++) {
    add(body, G.cars[i].int.build(), M.int[i]);
    add(body, G.cars[i].dec.build(), M.intDec[i], 1);
    add(body, G.cars[i].strip.build(), M.strip[i]);
  }
  add(chassis, G.under.build(), M.under);

  // ---- door leaves (near side, instanced): 3 cars x 2 doors x 2 leaves ----
  const leafGB = new GB(0.5); addLeaf(leafGB, 0, -0.025, 0.05, -1, 0.9);
  const leafGlassGB = new GB(1); leafGlassGB.quad([-0.22, 1.1, -0.025], [0.22, 1.1, -0.025], [0.22, 2.05, -0.025], [-0.22, 2.05, -0.025], [1, 1, 1], [[0.2, 0.15], [0.55, 0.15], [0.55, 0.6], [0.2, 0.6]], [0, 0, -1]);
  const leafMesh = new THREE.InstancedMesh(leafGB.build(), M.body, K.CAR_COUNT * 4);
  const leafGlass = new THREE.InstancedMesh(leafGlassGB.build(), M.glass, K.CAR_COUNT * 4);
  leafMesh.frustumCulled = leafGlass.frustumCulled = false; leafGlass.renderOrder = 2;
  body.add(leafMesh, leafGlass);

  // ---- wheelsets (instanced) ----
  const wsGB = new GB(0.5); buildWheelset(wsGB);
  const wheels = new THREE.InstancedMesh(wsGB.build(), new THREE.MeshLambertMaterial({ map: T.grain, vertexColors: true, emissive: 0x0a0b0c }), K.CAR_COUNT * 4);
  wheels.frustumCulled = false; chassis.add(wheels);
  const wheelU = [];
  for (let i = 0; i < K.CAR_COUNT; i++) for (const s of [-1, 1]) for (const a of [-1, 1]) wheelU.push(K.carU(i) + s * K.BOGIE_U + a * K.AXLE_OFF);

  // ---- light spill pools on the platform floor in front of each door (additive, instanced) ----
  const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({ map: T.spill, color: new THREE.Color(1.0, 0.9, 0.7), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, K.CAR_COUNT * 2);
  pools.frustumCulled = false; pools.renderOrder = 6; pools.setColorAt(0, new THREE.Color(0, 0, 0));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const POOL_L = 3.0, POOL_W = 2.0;
  for (let i = 0; i < K.CAR_COUNT; i++) K.DOOR_U.forEach((d, j) => {
    ps.set(K.carU(i) + d, 0.022, -K.HW - POOL_L / 2 + 0.25); sc.set(POOL_W, 1, POOL_L); m4.compose(ps, q, sc); pools.setMatrixAt(i * 2 + j, m4); pools.setColorAt(i * 2 + j, new THREE.Color(0, 0, 0));
  });
  chassis.add(pools);

  // ---- headlight beam cone + ground pool (additive) ----
  const noseU = K.TRAIN_HALF + 0.1, beamLen = 34;
  const beamGB = new GB(1);
  beamGB.cyl(0, noseU + beamLen / 2, 0.66, 0, 0.5, 3.4, beamLen, 22, (p) => { const t = (p[0] - noseU) / beamLen, c = 0.17 * Math.pow(1 - t, 1.5) * Math.min(1, t * 8 + 0.15); return [c, c * 0.95, c * 0.82]; }, 0);
  const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beam = new THREE.Mesh(beamGB.build(), beamMat); beam.renderOrder = 7; beam.visible = false; chassis.add(beam);
  const gpGB = new GB(1);
  gpGB.quad([noseU, -1.02, -1.7], [noseU, -1.02, 1.7], [noseU + 26, -1.02, 1.7], [noseU + 26, -1.02, -1.7], [1, 1, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0]);
  const gpMat = new THREE.MeshBasicMaterial({ map: T.pool, color: new THREE.Color(0.9, 0.85, 0.7), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const groundPool = new THREE.Mesh(gpGB.build(), gpMat); groundPool.renderOrder = 7; groundPool.visible = false; chassis.add(groundPool);

  // ---- glow sprites ----
  const mkSprite = (tex, color, u, y, z) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 1 }));
    s.position.set(u, y, z); s.renderOrder = 8; root.add(s); return s;
  };
  const headGlow = [-0.95, 0.95].map((z) => mkSprite(T.flare, new THREE.Color(1.0, 0.94, 0.8), noseU + 0.15, 0.62, z));
  const tailGlow = [-0.95, 0.95].map((z) => mkSprite(T.glow, new THREE.Color(1.0, 0.12, 0.06), -noseU - 0.15, 0.62, z));

  return { T, M, root, body, chassis, leafMesh, leafGlass, wheels, wheelU, pools, poolL: POOL_L, poolW: POOL_W, beam, groundPool, headGlow, tailGlow, noseU };
}
