// No-op fallbacks so the game boots while modules are missing/broken. Real modules replace these automatically.
import * as THREE from 'three';
import { LAYOUT } from './core.js';

const noop = () => {};
export const STUBS = {
  audio: () => ({ play: noop, loop: () => ({ stop: noop, set: noop }), resume: noop, init: noop, update: noop, startAmbience: noop, stopAmbience: noop, setMasterVolume: noop }),
  vfx: () => ({ tracer: noop, impact: noop, blood: noop, gib: noop, explosion: noop, trail: noop, shell: noop, muzzleFlash: noop, light: noop, bfgBeam: noop, bfgExplosion: noop, plasmaImpact: noop, decal: noop, createFlash: () => ({ object3d: new THREE.Group(), fire: noop, update: noop }), update: noop, reset: noop }),
  station: (game) => ({
    playerSpawn: new THREE.Vector3(-8, 0, 0), spawnPoints: [8, 12, 16, 20].map((x) => new THREE.Vector3(x, 0, (x % 8) - 3)), pickupPoints: [new THREE.Vector3(-4, 0, 2), new THREE.Vector3(4, 0, -2)],
    init() {
      const w = LAYOUT.platform; game.world.addFloor(w.x0, w.x1, -w.halfW, w.halfW, 0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(64, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x555a60 })); m.position.y = -0.1; game.scene.add(m);
      game.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.5));
      game.world.addBox([w.x0, -2, -w.halfW - 0.4], [w.x1, 1.6, -w.halfW], { tag: 'edge', hitscan: false }); game.world.addBox([w.x0, -2, w.halfW], [w.x1, 1.6, w.halfW + 0.4], { tag: 'edge', hitscan: false });
      game.world.addBox([w.x0 - 1, -2, -12], [w.x0, 8, 12], { tag: 'wall' }); game.world.addBox([w.x1, -2, -12], [w.x1 + 1, 8, 12], { tag: 'wall' });
    },
    update: noop,
  }),
  player: (game) => ({
    pos: new THREE.Vector3(-8, 0, 0), vel: new THREE.Vector3(), yaw: 0, pitch: 0, radius: 0.35, height: 1.75, health: 100, armor: 0, alive: true, grounded: true,
    get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z); },
    damage: noop, heal: noop, addArmor: noop, impulse: noop, kick: noop, shake: noop, teleport: noop, reset: noop,
    getAimRay() { const d = new THREE.Vector3(); game.camera.getWorldDirection(d); return { origin: game.camera.position.clone(), dir: d }; },
    update() { game.camera.position.set(this.pos.x, this.pos.y + 1.6, this.pos.z); },
  }),
  enemies: () => ({ list: [], spawn: () => null, raycast: () => null, damage: () => false, aliveCount: () => 0, clear: noop, update: noop, reset: noop }),
  train: () => ({ state: 'away', arrive: () => Promise.resolve(), depart: () => Promise.resolve(), doorPoints: () => [], update: noop, reset: noop }),
  pickups: () => ({ list: [], spawn: noop, supplyDrop: noop, update: noop, reset: noop }),
  waves: () => ({ wave: 0, kills: 0, score: 0, state: 'idle', start: noop, update: noop, reset: noop, debugStart: noop }),
  hud: () => ({ flash: noop, banner: noop, update: noop, reset: noop, show: noop, hide: noop }),
};
