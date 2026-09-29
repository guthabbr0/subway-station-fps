// Shared combat helpers: unified raycast (world + enemies) and explosion splash.
import * as THREE from 'three';
import { clamp } from './core.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export function create(game) {
  return {
    // Nearest hit among static world and enemies.
    // Returns {kind:'world'|'enemy', dist, point, normal, surface, enemy?, part?} or null.
    castRay(origin, dir, max = 64, opts = {}) {
      const w = game.world.raycast(origin, dir, max);
      let best = w ? { kind: 'world', dist: w.dist, point: w.point, normal: w.normal, surface: w.surface, box: w.box } : null;
      if (!opts.ignoreEnemies && game.enemies) {
        const e = game.enemies.raycast(origin, dir, best ? best.dist : max);
        if (e && (!best || e.dist < best.dist)) best = { kind: 'enemy', dist: e.dist, point: e.point, normal: e.normal || dir.clone().negate(), surface: 'flesh', enemy: e.enemy, part: e.part };
      }
      return best;
    },

    // True if there is no static geometry between a and b.
    lineClear(a, b) {
      _a.copy(b).sub(a); const d = _a.length(); if (d < 1e-4) return true; _a.multiplyScalar(1 / d);
      const h = game.world.raycast(a, _a, d); return !h;
    },

    // Radial splash. opts: {owner:'player'|'enemy', kind:'rocket'|'bfg'|'barrel'|'exploder', selfScale=0.5, fx=true}
    explosion(pos, radius, damage, opts = {}) {
      const owner = opts.owner || 'player';
      pos = pos.clone(); // callers (e.g. enemies.js exploders) may pass a shared scratch vector that nested kills overwrite mid-loop
      if (opts.fx !== false) {
        game.vfx?.explosion(pos, radius, opts.kind || 'rocket');
        game.audio?.play('explosion', pos);
      }
      if (game.enemies) for (const e of game.enemies.list.slice()) {
        if (!e.alive) continue;
        _b.set(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z);
        const d = Math.max(0, _b.distanceTo(pos) - e.radius);
        if (d >= radius) continue;
        if (!this.lineClear(pos, _b)) continue;
        const amt = damage * (1 - d / radius);
        _c.copy(_b).sub(pos).normalize();
        game.enemies.damage(e, amt, { point: _b.clone(), dir: _c.clone(), type: 'explosion', source: owner, knock: 8 * (1 - d / radius) });
      }
      const p = game.player;
      if (p && p.alive) {
        _b.copy(p.eye);
        const d = _b.distanceTo(pos);
        if (d < radius && this.lineClear(pos, _b)) {
          const k = 1 - d / radius, scale = owner === 'player' ? (opts.selfScale ?? 0.5) : 1;
          _c.copy(_b).sub(pos).normalize();
          p.damage(damage * k * scale, { from: pos.clone(), type: 'explosion' });
          p.impulse(_c.multiplyScalar(9 * k));
        }
        p.shake(clamp(1.4 * (1 - d / (radius * 4)), 0, 1.2));
      }
    },
  };
}
