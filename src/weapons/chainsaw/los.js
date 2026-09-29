// Melee line of sight. kit_a's meleeProbe() forgives 0.3-0.42 m of slop so enemies pressed against a wall can still be hit; that also lets a tooth (or a fist)
// reach an enemy standing just BEHIND a thin solid (a column, a 5 cm wall). solidMeleeProbe() is a drop-in replacement for meleeProbe(): same result object, but
// an enemy whose chest is not visible from the eye (a solid world box in between) is demoted to a world contact on whatever is in the way.
// The platform-edge barrier is hitscan:false (bullets fly over it) yet still stops a melee reach, so tag 'edge' boxes count; the train's hitscan-only box does not.
import { meleeProbe } from '../kit_a.js';

// is the segment eye -> enemy chest cut by a solid world box that does not contain the chest?  (slab test, allocation free)
export function meleeBlocked(world, o, e) {
  const tx = e.pos.x, ty = e.pos.y + (e.height || 1.7) * 0.6, tz = e.pos.z, dx = tx - o.x, dy = ty - o.y, dz = tz - o.z;
  for (const b of world.boxes) {
    if (!b.enabled || !b.solid || b.surface === 'train' || (b.hitscan === false && b.tag !== 'edge')) continue;
    if (tx >= b.min.x && tx <= b.max.x && ty >= b.min.y && ty <= b.max.y && tz >= b.min.z && tz <= b.max.z) continue;
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-9) { if (o.x < b.min.x || o.x > b.max.x) continue; } else { let a = (b.min.x - o.x) / dx, c = (b.max.x - o.x) / dx; if (a > c) { const q = a; a = c; c = q; } if (a > t0) t0 = a; if (c < t1) t1 = c; }
    if (t0 > t1) continue;
    if (Math.abs(dy) < 1e-9) { if (o.y < b.min.y || o.y > b.max.y) continue; } else { let a = (b.min.y - o.y) / dy, c = (b.max.y - o.y) / dy; if (a > c) { const q = a; a = c; c = q; } if (a > t0) t0 = a; if (c < t1) t1 = c; }
    if (t0 > t1) continue;
    if (Math.abs(dz) < 1e-9) { if (o.z < b.min.z || o.z > b.max.z) continue; } else { let a = (b.min.z - o.z) / dz, c = (b.max.z - o.z) / dz; if (a > c) { const q = a; a = c; c = q; } if (a > t0) t0 = a; if (c < t1) t1 = c; }
    if (t0 <= t1 && t0 < 0.96) return true;
  }
  return false;
}

// same contract as kit_a.meleeProbe(game, range, extra) -> {kind:'enemy'|'world'|null, enemy, part, dist, point, normal, dir, surface} (a shared object, valid until the next call)
export function solidMeleeProbe(game, range = 2.0, extra = 0.3) {
  const pr = meleeProbe(game, range, extra), ray = game.player.getAimRay();
  if (pr.kind === 'enemy' && meleeBlocked(game.world, ray.origin, pr.enemy)) {
    const wr = game.world.raycast(ray.origin, ray.dir, range);
    if (wr) { pr.kind = 'world'; pr.enemy = null; pr.dist = wr.dist; pr.surface = wr.surface; pr.point.copy(wr.point); pr.normal.copy(wr.normal); } else { pr.kind = null; pr.enemy = null; pr.dist = range; }
  }
  return pr;
}
