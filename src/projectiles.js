// Generic projectile system. Weapons/enemies supply mesh + callbacks; this handles motion + collision.
import * as THREE from 'three';

const _seg = new THREE.Vector3(), _dir = new THREE.Vector3(), _q = new THREE.Vector3();

export function create(game) {
  const list = [];
  return {
    list,
    // o: {mesh?:Object3D, pos:Vector3, dir:Vector3 (normalised), speed:m/s, radius=0.15, gravity=0, life=6,
    //     owner:'player'|'enemy', onHit(p, hit)->'pass'|undefined, onUpdate(p, dt), onExpire(p), data:{}}
    // hit = {kind:'world'|'enemy'|'player', point, normal, enemy?, part?, surface?}. Projectile is removed after onHit unless it returns 'pass'.
    spawn(o) {
      const p = {
        mesh: o.mesh || null, pos: o.pos.clone(), dir: o.dir.clone().normalize(), speed: o.speed, radius: o.radius ?? 0.15, gravity: o.gravity || 0,
        life: o.life ?? 6, age: 0, owner: o.owner || 'player', onHit: o.onHit, onUpdate: o.onUpdate, onExpire: o.onExpire, data: o.data || {}, dead: false,
        vel: null, kill() { this.dead = true; },
      };
      p.vel = p.dir.clone().multiplyScalar(p.speed);
      if (p.mesh) { p.mesh.position.copy(p.pos); game.scene.add(p.mesh); }
      list.push(p); return p;
    },
    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        if (!p.dead) {
          p.age += dt; p.vel.y -= p.gravity * dt;
          _seg.copy(p.vel).multiplyScalar(dt); const len = _seg.length();
          if (len > 1e-6) {
            _dir.copy(_seg).multiplyScalar(1 / len);
            let hit = null;
            const w = game.world.raycast(p.pos, _dir, len + p.radius);
            if (w) hit = { kind: 'world', dist: w.dist, point: w.point, normal: w.normal, surface: w.surface };
            if (p.owner === 'player' && game.enemies) {
              const e = game.enemies.raycast(p.pos, _dir, (hit ? hit.dist : len + p.radius) + p.radius, p.radius);
              if (e && (!hit || e.dist < hit.dist)) hit = { kind: 'enemy', dist: e.dist, point: e.point, normal: e.normal || _dir.clone().negate(), enemy: e.enemy, part: e.part };
            }
            if (p.owner === 'enemy' && game.player?.alive) {
              _q.copy(game.player.pos); _q.y += 0.9; _q.sub(p.pos);
              const t = Math.max(0, Math.min(len, _q.dot(_dir)));
              const cx = p.pos.x + _dir.x * t - game.player.pos.x, cy = p.pos.y + _dir.y * t - (game.player.pos.y + 0.9), cz = p.pos.z + _dir.z * t - game.player.pos.z;
              const rr = p.radius + game.player.radius;
              if (Math.hypot(cx, cz) < rr && Math.abs(cy) < 0.95 + p.radius && (!hit || t < hit.dist)) hit = { kind: 'player', dist: t, point: p.pos.clone().addScaledVector(_dir, t), normal: _dir.clone().negate() };
            }
            if (hit && hit.dist <= len + p.radius) {
              p.pos.copy(hit.point);
              const r = p.onHit ? p.onHit(p, hit) : undefined;
              if (r !== 'pass') p.dead = true; else p.pos.addScaledVector(_dir, 0.02);
            } else p.pos.add(_seg);
          }
          if (!p.dead) {
            if (p.mesh) p.mesh.position.copy(p.pos);
            p.onUpdate?.(p, dt);
            if (p.age >= p.life) { p.onExpire?.(p); p.dead = true; }
          }
        }
        if (p.dead) { if (p.mesh) game.scene.remove(p.mesh); list.splice(i, 1); }
      }
    },
    clear() { for (const p of list) if (p.mesh) game.scene.remove(p.mesh); list.length = 0; },
    reset() { this.clear(); }, // main.js calls reset() on every game start: nothing may survive a restart
  };
}
