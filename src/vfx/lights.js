// Fixed pool of point lights. They live in the scene from the very start (intensity 0 when idle) so the shader never recompiles.
import * as THREE from 'three';

const _c = new THREE.Color();

// Callers pass "nominal" intensities (about 1..10 for small flashes, 30..500 for blasts). Small values are boosted so that a naive
// `light(p, col, 3, 0.08)` is still visible in candela terms, large values pass through (physically based lights, decay 2).
export function effIntensity(i) { return Math.min(700, i * (1 + 10 * Math.exp(-i / 8))); }

export class LightPool {
  constructor(scene, n = 6) {
    this.n = n; this.lights = []; this.base = new Float32Array(n); this.age = new Float32Array(n); this.life = new Float32Array(n); this.flick = new Float32Array(n);
    this.cr = new Float32Array(n); this.cg = new Float32Array(n); this.cb = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const L = new THREE.PointLight(0xffffff, 0, 12, 2); L.position.set(0, -500, 0); L.name = 'vfxLight' + i;
      scene.add(L); this.lights.push(L); this.life[i] = 0;
    }
  }
  // Claims the dimmest light (or refreshes a nearby one of the same hue). Returns the light or null when everything is brighter.
  claim(pos, color, intensity, dur, distance = 12) {
    _c.set(color);
    const eff = effIntensity(intensity);
    let best = -1, bestCur = Infinity, merge = -1;
    for (let i = 0; i < this.n; i++) {
      const L = this.lights[i], cur = L.intensity;
      if (cur > 0.01) {
        const dx = L.position.x - pos.x, dy = L.position.y - pos.y, dz = L.position.z - pos.z;
        if (dx * dx + dy * dy + dz * dz < 1.44 && Math.abs(this.cr[i] - _c.r) + Math.abs(this.cg[i] - _c.g) + Math.abs(this.cb[i] - _c.b) < 0.6) { merge = i; break; }
      }
      if (cur < bestCur) { bestCur = cur; best = i; }
    }
    const i = merge >= 0 ? merge : best;
    if (merge < 0 && eff < bestCur * 0.9) return null;
    const L = this.lights[i];
    L.position.copy(pos); L.color.copy(_c); L.distance = distance; L.intensity = eff;
    this.cr[i] = _c.r; this.cg[i] = _c.g; this.cb[i] = _c.b;
    this.base[i] = eff; this.age[i] = 0; this.life[i] = Math.max(0.02, dur); this.flick[i] = Math.random() * 100;
    return L;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i]; if (life <= 0) continue;
      const L = this.lights[i], a = this.age[i] += dt;
      if (a >= life) { L.intensity = 0; this.life[i] = 0; L.position.y = -500; continue; }
      const k = a / life, f = Math.pow(1 - k, 1.7), fl = 1 + 0.12 * Math.sin(a * 63 + this.flick[i]) * (life > 0.2 ? 1 : 0.3);
      L.intensity = this.base[i] * f * fl;
    }
  }
  reset() { for (let i = 0; i < this.n; i++) { this.lights[i].intensity = 0; this.lights[i].position.y = -500; this.life[i] = 0; } }
}
