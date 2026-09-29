// Grid navigation for enemies: a per-size-class "distance to player" flow field over the platform.
// The platform is a small, static, mostly open box with a few concave dead ends (stair block + fare gates + benches at the west end),
// which purely reactive whisker steering cannot escape. Instead each enemy asks for a waypoint:
//   - direct line to the player is clear (for its size class)  -> null (caller keeps its cheap direct steering)
//   - otherwise follow the field downhill and string-pull to the furthest visible cell.
// Passability is baked once from the static colliders (circle-vs-AABB with the class radius + margin), fields are rebuilt lazily
// (BFS, ~46k cells at 12.5 cm, ~1 ms) whenever the player moved to another cell, at most every FIELD_MIN_DT seconds and only for classes with enemies.
import { LAYOUT } from '../core.js';
const CELL = 0.125, X0 = -32.5, Z0 = -5.5, NX = 520, NZ = 88, N = NX * NZ, INF = 65535;
const FIELD_MIN_DT = 0.3, FIELD_MIN_MOVE = 0.5;
// class radius = largest enemy radius of the class + 2 cm (brute/tyrant have a fixed radius, see enemies.spawn)
const CLASSES = [{ r: 0.41, h: 1.9 }, { r: 0.56, h: 2.0 }, { r: 0.68, h: 2.8 }, { r: 0.93, h: 3.8 }];
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function createNav(game) {
  const pass = CLASSES.map(() => new Uint8Array(N));
  const dist = CLASSES.map(() => new Uint16Array(N).fill(INF));
  const stamp = CLASSES.map(() => ({ x: 0, z: 0, t: -9 }));
  const queue = new Int32Array(N), path = new Int32Array(32);
  const out = { x: 0, z: 0 };
  let built = false;
  const stats = { fills: 0, fillMs: 0, calls: 0 };

  const cellOf = (x, z) => { const i = Math.floor((x - X0) / CELL), j = Math.floor((z - Z0) / CELL); return i < 0 || j < 0 || i >= NX || j >= NZ ? -1 : i * NZ + j; };
  const cx = (k) => X0 + ((k / NZ) | 0) * CELL + CELL * 0.5, cz = (k) => Z0 + (k % NZ) * CELL + CELL * 0.5;
  const classOf = (r) => (r <= 0.41 ? 0 : r <= 0.56 ? 1 : r <= 0.68 ? 2 : 3);

  function build() {
    const w = game.world;
    const boxes = w.boxes.filter((b) => b.enabled && b.solid && b.max.x > X0 && b.min.x < X0 + NX * CELL && b.max.z > Z0 && b.min.z < Z0 + NZ * CELL && b.max.y > 0.45);
    for (let c = 0; c < CLASSES.length; c++) {
      const { r, h } = CLASSES[c], P = pass[c], r2 = r * r;
      for (let i = 0; i < NX; i++) {
        const x = X0 + i * CELL + CELL * 0.5;
        for (let j = 0; j < NZ; j++) {
          const z = Z0 + j * CELL + CELL * 0.5; let ok = 1;
          if (x < LAYOUT.platform.x0 + r * 0.5 || x > LAYOUT.platform.x1 - r * 0.5 || z < -LAYOUT.platform.halfW || z > LAYOUT.platform.halfW) ok = 0; // the platform floor
          else for (let b = 0; b < boxes.length; b++) {
            const bx = boxes[b]; if (bx.min.y >= h) continue;
            const dx = x - Math.max(bx.min.x, Math.min(x, bx.max.x)), dz = z - Math.max(bx.min.z, Math.min(z, bx.max.z));
            if (dx * dx + dz * dz < r2) { ok = 0; break; }
          }
          P[i * NZ + j] = ok;
        }
      }
    }
    built = true;
  }

  // nearest passable cell to (x,z) within `span` cells; with reach=true it must also be connected to the current field (dist < INF)
  function snap(c, x, z, reach = false, span = 12) {
    const k0 = cellOf(x, z); if (k0 >= 0 && pass[c][k0] && (!reach || dist[c][k0] !== INF)) return k0;
    const i0 = Math.floor((x - X0) / CELL), j0 = Math.floor((z - Z0) / CELL); let best = -1, bd = 1e9;
    for (let di = -span; di <= span; di++) for (let dj = -span; dj <= span; dj++) {
      const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
      const k = i * NZ + j; if (!pass[c][k] || (reach && dist[c][k] === INF)) continue;
      const d = di * di + dj * dj; if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  function fill(c, px, pz, t) {
    const t0 = performance.now(); stats.fills++;
    const D = dist[c], P = pass[c]; D.fill(INF);
    let head = 0, tail = 0;
    // seed: every passable cell within 0.9 m of the player (so a player hugging a wall is still targetable)
    const i0 = Math.floor((px - X0) / CELL), j0 = Math.floor((pz - Z0) / CELL);
    for (let di = -8; di <= 8; di++) for (let dj = -8; dj <= 8; dj++) {
      const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
      const k = i * NZ + j; if (P[k] && di * di + dj * dj <= 52) { D[k] = 0; queue[tail++] = k; }
    }
    if (tail === 0) { const k = snap(c, px, pz, false, 48); if (k >= 0) { D[k] = 0; queue[tail++] = k; } } // player somewhere this size class cannot stand: head for the nearest spot it can
    while (head < tail) {
      const k = queue[head++], i = (k / NZ) | 0, j = k - i * NZ, d = D[k] + 1;
      for (let n = 0; n < 8; n++) {
        const ii = i + NB[n][0], jj = j + NB[n][1]; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
        const kk = ii * NZ + jj; if (!P[kk] || D[kk] <= d) continue;
        if (n >= 4 && (!P[i * NZ + jj] || !P[ii * NZ + j])) continue; // no diagonal corner cutting
        D[kk] = d; queue[tail++] = kk;
      }
    }
    stamp[c].t = t; stamp[c].x = px; stamp[c].z = pz;
    stats.fillMs += performance.now() - t0;
  }

  // is the straight segment passable for class c? (sampled every ~0.15 m; the last `skip` metres before the target are ignored)
  function clear(c, x0, z0, x1, z1, skip = 0) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), n = Math.ceil(len / 0.15), P = pass[c];
    const upto = len - skip;
    for (let s = 1; s <= n; s++) {
      const u = s / n; if (u * len > upto) break;
      const k = cellOf(x0 + dx * u, z0 + dz * u); if (k < 0 || !P[k]) return false;
    }
    return true;
  }

  const api = {
    get built() { return built; }, stats,
    init() { build(); },
    // Mark the player position for this frame; fields rebuild lazily on demand.
    // Returns {x,z} of the waypoint an enemy of radius r at (ex,ez) should steer to, or null when the direct line is fine / no route exists.
    waypoint(r, ex, ez, px, pz, t) {
      if (!built) return null;
      stats.calls++;
      const c = classOf(r);
      const st = stamp[c];
      // direct line: free of static obstacles for this size class (ignore the final metre, the player may hug a prop)
      if (clear(c, ex, ez, px, pz, 1.0)) return null;
      if (st.t < 0 || t < st.t || (t - st.t >= FIELD_MIN_DT && Math.hypot(px - st.x, pz - st.z) > FIELD_MIN_MOVE)) fill(c, px, pz, t);
      const D = dist[c], P = pass[c];
      let k = snap(c, ex, ez, true); if (k < 0) return null;
      // steepest descent, then pull the string to the furthest cell we can see
      let np = 1; path[0] = k; let cur = k;
      for (let s = 0; s < 28 && D[cur] > 0; s++) {
        const i = (cur / NZ) | 0, j = cur - i * NZ; let best = cur, bd = D[cur];
        for (let n = 0; n < 8; n++) {
          const ii = i + NB[n][0], jj = j + NB[n][1]; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
          const kk = ii * NZ + jj; if (!P[kk] || D[kk] >= bd) continue;
          if (n >= 4 && (!P[i * NZ + jj] || !P[ii * NZ + j])) continue;
          bd = D[kk]; best = kk;
        }
        if (best === cur) break; cur = best; path[np++] = cur;
      }
      let pick = np > 1 ? 1 : 0;
      for (let s = np - 1; s >= 1; s--) if (clear(c, ex, ez, cx(path[s]), cz(path[s]))) { pick = s; break; }
      out.x = cx(path[pick]); out.z = cz(path[pick]);
      return out;
    },
    // An enemy wedged in space its size class cannot occupy (prop/wall gap narrower than its body): the nearest free cell that is connected to the player, or null.
    rescue(r, ex, ez, px, pz, t) {
      if (!built) return null;
      const c = classOf(r), k0 = cellOf(ex, ez);
      if (k0 >= 0 && pass[c][k0] && dist[c][k0] !== INF && stamp[c].t >= 0) return null; // fine where it is
      if (stamp[c].t < 0 || t < stamp[c].t || t - stamp[c].t >= 1) fill(c, px, pz, t);
      if (k0 >= 0 && pass[c][k0] && dist[c][k0] !== INF) return null;
      const k = snap(c, ex, ez, true, 24); if (k < 0) return null;
      out.x = cx(k); out.z = cz(k); return out;
    },
    // debug: is the player cell reachable for a class, distance in cells
    reach(r, x, z, px, pz) { const c = classOf(r); fill(c, px, pz, 0); const k = snap(c, x, z); return k < 0 ? -1 : dist[c][k] === INF ? -1 : dist[c][k]; },
    classOf, cells: () => ({ NX, NZ, CELL, X0, Z0 }),
    passable: (r, x, z) => { const k = cellOf(x, z); return k >= 0 && !!pass[classOf(r)][k]; },
  };
  return api;
}
