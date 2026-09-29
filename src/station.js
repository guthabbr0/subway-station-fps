// Station environment: an abandoned-at-night metro platform. Builds everything into game.scene, registers colliders in game.world.
// Sub-builders live in src/station/*.js; textures in src/textures.js. See CONTRACT.md "station.js".
import * as THREE from 'three';
import { LAYOUT, bus } from './core.js';
import { buildTextures, createMaterials, puddleTex } from './textures.js';
import { buildGraphics } from './station/graphics.js';
import { makeCtx } from './station/ctx.js';
import { buildStructure } from './station/structure.js';
import { buildLighting } from './station/lighting.js';
import { buildProps, buildPoints } from './station/props.js';
import { buildEnds } from './station/ends.js';
import { buildSignage } from './station/signage.js';
import { buildFX } from './station/fx.js';
import { buildLife } from './station/life.js';

export function create(game) {
  const S = {
    playerSpawn: new THREE.Vector3(-16, 0, 0.5),
    spawnPoints: [], pickupPoints: [],
    root: null, ctx: null, t: 0,
  };
  const updaters = [];

  S.init = async () => {
    const T = {}, t0 = performance.now(); let tl = t0;
    const lap = (k) => { const n = performance.now(); T[k] = Math.round(n - tl); tl = n; };
    const P = buildTextures(); lap('textures'); const G = buildGraphics(game.renderer); lap('graphics'); const M = createMaterials(P, game.renderer);
    const pt = puddleTex(256, 4);
    M.puddle = new THREE.MeshStandardMaterial({ color: 0xffffff, map: pt.color, roughness: 0.03, metalness: 0.0, alphaMap: pt.alpha, transparent: true, opacity: 0.9, depthWrite: false, vertexColors: true, envMapIntensity: 2.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    M.emit = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    const c = makeCtx(game, M, G); S.ctx = c; c.S = S; lap('materials');
    const light = buildLighting(c); S.lighting = light; updaters.push((dt, t) => light.update(dt, t)); lap('lighting');
    buildStructure(c); lap('structure'); buildProps(c); lap('props'); buildEnds(c); lap('ends'); S.signage = buildSignage(c); lap('signage'); buildFX(c); lap('fx'); buildLife(c); lap('life'); buildPoints(c);
    for (const u of c.dynamic) updaters.push(u);
    c.flush(); lap('flush');
    game.scene.add(c.root); S.root = c.root;
    light.buildEnv?.(); lap('env');
    S.spawnPoints = c.spawnPoints; S.pickupPoints = c.pickupPoints;
    S.buildMs = Math.round(performance.now() - t0); S.timing = T;
  };

  S.update = (dt, time) => {
    S.t += dt;
    for (let i = 0; i < updaters.length; i++) updaters[i](dt, S.t);
  };
  S.reset = () => { if (S.lighting) { S.lighting.warn.t = 0; S.lighting.warn.target = 0; } };
  return S;
}
