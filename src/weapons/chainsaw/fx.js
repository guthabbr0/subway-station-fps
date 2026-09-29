// View-space particle effects for the chainsaw viewmodel: two pooled quad batches (alpha + additive) drawn in viewScene, parented to the view camera so
// positions are camera-local (x right, y up, -z forward). No allocation per frame or per spawn; every particle is a plain slot in typed arrays.
//   alpha batch : exhaust puffs, fuel haze, blood droplets / mist / lens splats, oil flecks, gore chunks
//   additive    : sparks, hot glints
import * as THREE from 'three';

const CELL_PUFF = 0, CELL_DOT = 1, CELL_STREAK = 2, CELL_SPLAT = 3;

function makeAtlas() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d', { willReadFrequently: true });
  let seed = 12345; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // 0: soft cloud puff
  g.save(); g.beginPath(); g.rect(0, 0, 64, 64); g.clip();
  for (let i = 0; i < 12; i++) { const r = 9 + rnd() * 13, x = 32 + (rnd() - 0.5) * 26, y = 32 + (rnd() - 0.5) * 26, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.30)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }
  g.globalCompositeOperation = 'destination-in'; const m = g.createRadialGradient(32, 32, 0, 32, 32, 32); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.6, 'rgba(0,0,0,0.9)'); m.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = m; g.fillRect(0, 0, 64, 64); g.restore();
  // 1: droplet / dot with a soft rim
  { const gr = g.createRadialGradient(96, 32, 0, 96, 32, 26); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.62, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(64, 0, 64, 64); }
  // 2: streak (tail -> head along +u), soft across v
  { const img = g.getImageData(128, 0, 64, 64), d = img.data;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const u = x / 63, v = (y - 31.5) / 31.5;
      const along = Math.pow(Math.min(1, u / 0.8), 1.5) * (1 - Math.min(1, Math.max(0, (u - 0.88) / 0.12)));
      const across = Math.exp(-(v * v) * 7.0), a = along * across, i = (y * 64 + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(255 * Math.min(1, a));
    }
    g.putImageData(img, 128, 0); }
  // 3: irregular blood splat with drips and fine spray
  { g.save(); g.translate(192, 0); g.fillStyle = '#fff';
    const blob = (x, y, r) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); };
    blob(32, 30, 12); for (let i = 0; i < 9; i++) { const a = rnd() * 6.283, d = 6 + rnd() * 12; blob(32 + Math.cos(a) * d, 30 + Math.sin(a) * d, 3 + rnd() * 6); }
    for (let i = 0; i < 26; i++) { const a = rnd() * 6.283, d = 14 + rnd() * 17; blob(32 + Math.cos(a) * d, 30 + Math.sin(a) * d, 0.8 + rnd() * 2.0); }
    g.strokeStyle = '#fff'; g.lineCap = 'round'; for (let i = 0; i < 3; i++) { g.lineWidth = 2 + rnd() * 2.5; const x = 22 + rnd() * 20; g.beginPath(); g.moveTo(x, 34); g.lineTo(x + (rnd() - 0.5) * 4, 52 + rnd() * 10); g.stroke(); }
    g.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; t.generateMipmaps = true; return t;
}

class QuadPool {
  constructor(n, material, order) {
    this.n = n; this.head = 0; this.live = 0; this.dirty = false;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.age = new Float32Array(n).fill(1e9); this.life = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.stretch = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.rot = new Float32Array(n); this.spin = new Float32Array(n); this.c0 = new Float32Array(n * 4); this.c1 = new Float32Array(n * 4); this.alive = new Uint8Array(n);
    const pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), col = new Float32Array(n * 16), idx = new Uint16Array(n * 6);
    for (let i = 0; i < n; i++) { const b = i * 4; idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6); }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(this.geo, material); this.mesh.frustumCulled = false; this.mesh.renderOrder = order; this.mesh.matrixAutoUpdate = false;
    this.pos = pos; this.uv = uv; this.col = col;
  }
  // cell, position, velocity, life, size0, size1, stretch (seconds of motion trail; 0 = billboard), gravity (view-y accel), drag (1/s), spin (rad/s), c0 rgba, c1 rgba
  spawn(cell, x, y, z, vx, vy, vz, life, s0, s1, stretch, grav, drag, spin, r0, g0, b0, a0, r1, g1, b1, a1) {
    const i = this.head; this.head = (i + 1) % this.n; if (!this.alive[i]) this.live++; this.alive[i] = 1;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz; this.age[i] = 0; this.life[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.stretch[i] = stretch; this.grav[i] = grav; this.drag[i] = drag; this.spin[i] = spin; this.rot[i] = stretch > 0 ? 0 : Math.random() * 6.283;
    const c0 = this.c0, c1 = this.c1, k = i * 4; c0[k] = r0; c0[k + 1] = g0; c0[k + 2] = b0; c0[k + 3] = a0; c1[k] = r1; c1[k + 1] = g1; c1[k + 2] = b1; c1[k + 3] = a1;
    const u0 = cell * 0.25, u1 = u0 + 0.25, uv = this.uv, u = i * 8; uv[u] = u0; uv[u + 1] = 0; uv[u + 2] = u1; uv[u + 3] = 0; uv[u + 4] = u1; uv[u + 5] = 1; uv[u + 6] = u0; uv[u + 7] = 1;
    this.uvDirty = true; this.dirty = true;
  }
  clear() { this.alive.fill(0); this.age.fill(1e9); this.live = 0; this.col.fill(0); this.geo.attributes.color.needsUpdate = true; this.dirty = false; }
  update(dt) {
    if (this.live === 0 && !this.dirty) return;
    const pos = this.pos, col = this.col, n = this.n; let live = 0;
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      const a = (this.age[i] += dt), L = this.life[i], b = i * 16, p = i * 12;
      if (a >= L) { this.alive[i] = 0; for (let k = 0; k < 16; k += 4) col[b + k + 3] = 0; for (let k = 0; k < 12; k++) pos[p + k] = 0; continue; }
      live++;
      const t = a / L, dr = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= dr; this.vy[i] = this.vy[i] * dr + this.grav[i] * dt; this.vz[i] *= dr;
      const x = (this.px[i] += this.vx[i] * dt), y = (this.py[i] += this.vy[i] * dt), z = (this.pz[i] += this.vz[i] * dt);
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * t, k4 = i * 4;
      const cr = this.c0[k4] + (this.c1[k4] - this.c0[k4]) * t, cg = this.c0[k4 + 1] + (this.c1[k4 + 1] - this.c0[k4 + 1]) * t, cb = this.c0[k4 + 2] + (this.c1[k4 + 2] - this.c0[k4 + 2]) * t, ca = this.c0[k4 + 3] + (this.c1[k4 + 3] - this.c0[k4 + 3]) * t;
      let ex, ey, hx, hy;
      if (this.stretch[i] > 0) {
        // orient along the SCREEN-projected velocity so particles flung toward the camera streak radially
        const ez = Math.max(0.05, -z), e2 = 0.02, ez2 = Math.max(0.05, -(z + this.vz[i] * e2));
        let dx = (x + this.vx[i] * e2) / ez2 - x / ez, dy = (y + this.vy[i] * e2) / ez2 - y / ez;
        const m = Math.hypot(dx, dy);
        if (m < 1e-7) { dx = 0; dy = 1; } else { dx /= m; dy /= m; }
        const spd = m * ez / e2; ex = dx; ey = dy; hx = 0.5 * (size + Math.min(0.09, spd * this.stretch[i])); hy = 0.5 * size;
        // ex,ey = along; across = (-ey, ex)
        const ax = -ey, ay = ex;
        pos[p] = x - ex * hx - ax * hy; pos[p + 1] = y - ey * hx - ay * hy; pos[p + 2] = z;
        pos[p + 3] = x + ex * hx - ax * hy; pos[p + 4] = y + ey * hx - ay * hy; pos[p + 5] = z;
        pos[p + 6] = x + ex * hx + ax * hy; pos[p + 7] = y + ey * hx + ay * hy; pos[p + 8] = z;
        pos[p + 9] = x - ex * hx + ax * hy; pos[p + 10] = y - ey * hx + ay * hy; pos[p + 11] = z;
      } else {
        const r = (this.rot[i] += this.spin[i] * dt), cs = Math.cos(r) * size * 0.5, sn = Math.sin(r) * size * 0.5;
        pos[p] = x - cs + sn; pos[p + 1] = y - sn - cs; pos[p + 2] = z;
        pos[p + 3] = x + cs + sn; pos[p + 4] = y + sn - cs; pos[p + 5] = z;
        pos[p + 6] = x + cs - sn; pos[p + 7] = y + sn + cs; pos[p + 8] = z;
        pos[p + 9] = x - cs - sn; pos[p + 10] = y - sn + cs; pos[p + 11] = z;
      }
      const nearF = z > -0.14 ? Math.max(0, (-z - 0.06) / 0.08) : 1, caN = ca * nearF;   // fade out right in front of the lens instead of streaking across it
      for (let k = 0; k < 16; k += 4) { col[b + k] = cr; col[b + k + 1] = cg; col[b + k + 2] = cb; col[b + k + 3] = caN; }
    }
    this.live = live;
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
    if (this.uvDirty) { this.geo.attributes.uv.needsUpdate = true; this.uvDirty = false; }
    this.dirty = live > 0; this.mesh.visible = true;
  }
}

const rr = (a, b) => a + Math.random() * (b - a);

export class SawFX {
  constructor(game) {
    this.game = game; this.group = new THREE.Group(); this.group.name = 'sawFX'; this.group.matrixAutoUpdate = false; this.group.visible = false;
    const atlas = makeAtlas(); this.atlas = atlas;
    const base = { map: atlas, vertexColors: true, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: true };
    this.norm = new QuadPool(260, new THREE.MeshBasicMaterial({ ...base, blending: THREE.NormalBlending }), 60);
    this.add = new QuadPool(140, new THREE.MeshBasicMaterial({ ...base, blending: THREE.AdditiveBlending }), 61);
    this.group.add(this.norm.mesh, this.add.mesh);
    game.viewCamera.add(this.group);
    this.pufAcc = 0; this.hazeAcc = 0; this.oilAcc = 0; this.dripAcc = 0;
  }
  update(dt) { this.norm.update(dt); this.add.update(dt); }
  clear() { this.norm.clear(); this.add.clear(); }
  dispose() { this.group.parent?.remove(this.group); for (const p of [this.norm, this.add]) { p.geo.dispose(); p.mesh.material.dispose(); } this.atlas.dispose(); }

  // ---- exhaust: blue-grey two-stroke smoke. (x,y,z) = tail-pipe in view space, (dx,dy,dz) = unit exhaust direction
  puff(x, y, z, dx, dy, dz, power = 1) {
    const sp = rr(0.10, 0.22) * (0.7 + power * 0.7), s0 = rr(0.012, 0.02), s1 = rr(0.07, 0.12) * (0.8 + 0.4 * power);
    const lum = rr(0.85, 1.15);
    this.norm.spawn(CELL_PUFF, x + rr(-0.003, 0.003), y + rr(-0.003, 0.003), z, dx * sp + rr(-0.03, 0.03), dy * sp + rr(0.02, 0.07), dz * sp + rr(-0.03, 0.03), rr(0.55, 1.05) * (0.8 + 0.3 * power), s0, s1, 0, 0.05, 1.3, rr(-1.2, 1.2),
      0.50 * lum, 0.58 * lum, 0.70 * lum, (0.075 + 0.11 * power) * rr(0.8, 1.2), 0.42 * lum, 0.48 * lum, 0.6 * lum, 0);
  }
  // ---- fuel-mix haze: very faint, bigger, slower cloud
  haze(x, y, z, dx, dy, dz) {
    this.norm.spawn(CELL_PUFF, x, y, z, dx * 0.05 + rr(-0.02, 0.02), dy * 0.05 + 0.04, dz * 0.05 + rr(-0.02, 0.02), rr(1.4, 2.3), 0.07, rr(0.2, 0.3), 0, 0.02, 0.6, rr(-0.5, 0.5),
      0.38, 0.5, 0.78, 0.045, 0.3, 0.4, 0.6, 0);
  }
  // ---- chain oil flung off the bar (amber, tiny streaks)
  oil(x, y, z, dx, dy, dz, speed = 1.6) {
    const sp = speed * rr(0.5, 1.2);
    this.norm.spawn(CELL_STREAK, x, y, z, dx * sp + rr(-0.35, 0.35), dy * sp + rr(-0.25, 0.4), dz * sp + rr(-0.35, 0.35), rr(0.25, 0.5), 0.0035, 0.0025, 0.03, -2.4, 0.3, 0,
      0.52, 0.36, 0.13, 0.55, 0.4, 0.26, 0.08, 0.0);
  }
  // ---- sparks (additive streaks) fanned around (dx,dy,dz)
  sparks(x, y, z, dx, dy, dz, n, strength = 1) {
    for (let i = 0; i < n; i++) {
      const sp = rr(1.4, 4.6) * (0.7 + 0.5 * strength), sx = rr(-0.9, 0.9), sy = rr(-0.5, 1.0), sz = rr(-0.9, 0.9);
      this.add.spawn(CELL_STREAK, x, y, z, (dx + sx * 0.7) * sp, (dy + sy * 0.7) * sp, (dz + sz * 0.7) * sp, rr(0.14, 0.42), rr(0.003, 0.0062), 0.002, 0.03 + Math.random() * 0.02, -4.2, 0.6, 0,
        3.4, 2.2, 0.8, 1.0, 1.4, 0.3, 0.05, 0.0);
    }
    // a couple of hot glints
    for (let i = 0; i < 2; i++) this.add.spawn(CELL_DOT, x, y, z, dx * 0.3, dy * 0.3, dz * 0.3, rr(0.05, 0.1), rr(0.016, 0.03), 0.004, 0, 0, 0, 0, 3.0, 2.0, 0.7, 0.8, 1.0, 0.3, 0.05, 0);
  }
  // ---- blood flecks flung from (x,y,z) around direction (dx,dy,dz) (view space, +z = toward the eye)
  gore(x, y, z, dx, dy, dz, n, strength = 1) {
    for (let i = 0; i < n; i++) {
      const sp = rr(0.7, 3.2) * (0.6 + 0.6 * strength), sx = rr(-1, 1), sy = rr(-0.6, 1.0), sz = rr(-0.6, 0.6), dark = rr(0.7, 1.15);
      this.norm.spawn(CELL_STREAK, x, y, z, (dx + sx * 0.8) * sp, (dy + sy * 0.8) * sp, (dz + sz * 0.6) * sp, rr(0.32, 0.75), rr(0.005, 0.013), 0.004, 0.02 + Math.random() * 0.02, -3.2, 0.5, 0,
        0.30 * dark, 0.006, 0.008, 0.95, 0.16 * dark, 0.004, 0.006, 0.6);
    }
    // a few fat droplets
    const m = Math.max(1, (n / 4) | 0);
    for (let i = 0; i < m; i++) {
      const sp = rr(0.5, 1.8) * (0.7 + 0.5 * strength);
      this.norm.spawn(CELL_DOT, x, y, z, (dx + rr(-0.8, 0.8)) * sp, (dy + rr(-0.4, 0.9)) * sp, (dz + rr(-0.5, 0.5)) * sp, rr(0.3, 0.6), rr(0.010, 0.022), rr(0.008, 0.016), 0, -4.5, 0.4, 0,
        0.26, 0.005, 0.008, 0.95, 0.15, 0.003, 0.005, 0.5);
    }
  }
  // ---- blood on the lens: a few big splats very close to the eye that run down and fade
  lens(n = 1, strength = 1) {
    for (let i = 0; i < n; i++) {
      const x = rr(-0.16, 0.16), y = rr(-0.08, 0.12), z = -rr(0.22, 0.32), s = rr(0.05, 0.11) * (0.7 + 0.5 * strength);
      this.norm.spawn(CELL_SPLAT, x, y, z, rr(-0.01, 0.01), rr(-0.03, 0), 0, rr(0.5, 0.95), s * 0.85, s * 1.05, 0, -0.06, 0.2, rr(-0.05, 0.05),
        0.28, 0.004, 0.006, 0.62 * Math.min(1, 0.6 + 0.4 * strength), 0.16, 0.003, 0.004, 0.0);
    }
  }
  // ---- soft red mist puffs on kills
  mist(x, y, z, dx, dy, dz, n = 3) {
    for (let i = 0; i < n; i++) this.norm.spawn(CELL_PUFF, x + rr(-0.02, 0.02), y + rr(-0.02, 0.02), z, dx * rr(0.2, 0.9) + rr(-0.3, 0.3), dy * rr(0.2, 0.9) + rr(-0.1, 0.4), dz * rr(0.3, 1.1), rr(0.35, 0.7), 0.03, rr(0.1, 0.2), 0, -0.4, 1.4, rr(-1, 1),
      0.34, 0.006, 0.008, 0.34, 0.2, 0.003, 0.004, 0.0);
  }
  // ---- gore chunks (dark red / pinkish lumps)
  chunks(x, y, z, dx, dy, dz, n) {
    for (let i = 0; i < n; i++) {
      const sp = rr(1.0, 3.2), pink = Math.random() < 0.35;
      this.norm.spawn(CELL_DOT, x, y, z, (dx + rr(-0.9, 0.9)) * sp, (dy + rr(-0.3, 1.0)) * sp, (dz + rr(-0.6, 0.6)) * sp, rr(0.4, 0.8), rr(0.012, 0.03), rr(0.01, 0.02), 0, -5.5, 0.25, 0,
        pink ? 0.42 : 0.2, pink ? 0.09 : 0.008, pink ? 0.09 : 0.01, 0.98, pink ? 0.3 : 0.12, pink ? 0.04 : 0.004, pink ? 0.05 : 0.006, 0.7);
    }
  }
  // ---- a slow blood drip falling off the bar / housing
  drip(x, y, z, fresh = 1) {
    this.norm.spawn(CELL_DOT, x, y, z, rr(-0.01, 0.01), -rr(0.02, 0.1), rr(-0.01, 0.02), rr(0.5, 0.9), rr(0.006, 0.011), 0.006, 0, -1.6, 0.1, 0,
      0.2 * fresh + 0.08, 0.004, 0.006, 0.9, 0.12, 0.003, 0.004, 0.55);
  }
}
