// Shared build context for the station sub-builders: per-material merged geometry builders, decal helper, colliders.
import * as THREE from 'three';
import { LAYOUT } from '../core.js';
import { mulberry32 } from '../texutil.js';
import { MB, grimeF } from './mb.js';

// metres per texture repeat for world-projected materials
const PERIOD = { floor: 4.8, tileCream: 2.4, tileGreen: 2.4, tileDark: 2.4, concrete: 4.0, paint: 1.6, steel: 1.6, galv: 1.6, rust: 1.6, yellow: 1.6, ballast: 1.5, tactile: 0.6, hazard: 0.5, shutter: 1.0, wood: 1.0, rubber: 0.5 };
const ATLAS_KEYS = new Set(['paper', 'glowA', 'glowB', 'decal', 'decal2', 'blood']);

export function makeCtx(game, M, G) {
  const builders = {};
  const rnd = mulberry32(90210);
  const c = {
    game, THREE, M, G, world: game.world, scene: game.scene, LAYOUT, rnd, MB, grimeF,
    root: new THREE.Group(), builders,
    dynamic: [], // per-frame updaters: fn(dt, t)
    spawnPoints: [], pickupPoints: [], flickerFixtures: [],
    mb(key) { return builders[key] || (builders[key] = new MB(PERIOD[key] ?? 1)); },
    rr(a, b) { return a + rnd() * (b - a); },
    pick(arr) { return arr[Math.floor(rnd() * arr.length)]; },
    // atlas decal / poster / sign quad. kind in paper|glowA|glowB|decal|decal2|blood; name = rect name in that atlas
    quadAt(kind, name, cx, cy, cz, nx, ny, nz, w, h, o = {}) {
      const atlas = kind === 'paper' ? G.paper : kind === 'glowA' ? G.glowA : kind === 'glowB' ? G.glowB : kind === 'decal' ? G.decals : kind === 'decal2' ? G.decals2 : G.blood;
      const r = atlas.rects[name]; if (!r) { console.warn('[station] missing atlas rect', kind, name); return; }
      const uv = o.flipU ? [r[2], r[1], r[0], r[3]] : r;
      c.mb(kind).oq(cx, cy, cz, nx, ny, nz, w, h, uv, o);
    },
    aspect(kind, name) { const atlas = kind === 'paper' ? G.paper : kind === 'glowA' ? G.glowA : kind === 'glowB' ? G.glowB : kind === 'decal' ? G.decals : kind === 'decal2' ? G.decals2 : G.blood; return atlas.rects[name]?.[4] || 1; },
    // collider helper: registers in the world and returns the box
    collider(min, max, o = {}) { return game.world.addBox(min, max, o); },
    add(obj) { c.root.add(obj); return obj; },
    flush() {
      for (const [k, b] of Object.entries(builders)) {
        if (b.empty) continue;
        const mat = M[k] || G.mat[k]; if (!mat) { console.warn('[station] no material for', k); continue; }
        const mesh = new THREE.Mesh(b.build(), mat); mesh.name = 'st_' + k; mesh.matrixAutoUpdate = false;
        if (ATLAS_KEYS.has(k) && k !== 'paper') mesh.renderOrder = 2;
        c.root.add(mesh);
      }
    },
  };
  return c;
}

// deterministic tiny helpers used by several builders
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
