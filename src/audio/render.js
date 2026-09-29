// Sound bank: aggregates every recipe and turns them into final, level-matched Float32Array buffers.
import { SR, rng, hashSeed, dB, peakOf, loudest, weighted, dcBlock, fadeEdges } from './dsp.js';
import { weapons } from './s_weapons.js';
import { enemies } from './s_enemies.js';
import { misc } from './s_misc.js';
import { world } from './s_world.js';

export const SOUNDS = { ...weapons, ...enemies, ...misc, ...world };

// def: { gen, pk (peak cap, default .95), lv (target dBFS RMS of loudest 200ms), loop, variants }
export function finalize(buf, def) {
  const n = buf.length;
  let mean = 0;
  for (let i = 0; i < n; i++) { const v = buf[i]; if (v !== v || v === Infinity || v === -Infinity) buf[i] = 0; else mean += v; }
  mean /= n;
  if (def.loop) { for (let i = 0; i < n; i++) buf[i] -= mean; } else { dcBlock(buf, 8); fadeEdges(buf, 0.0004, def.fade ?? 0.012); }
  const pk = peakOf(buf) || 1e-9, cap = def.pk ?? 0.95;
  let g = cap / pk;
  if (def.lv != null) { const l = loudest(weighted(buf), 0.2) || 1e-9; g = Math.min(g, dB(def.lv) / l); }
  for (let i = 0; i < n; i++) buf[i] *= g;
  if (def.loop) return buf;
  // trim inaudible tail (keep 25 ms) so voices free up early
  const thr = cap * 0.0008; let last = n - 1; while (last > 0 && Math.abs(buf[last]) < thr) last--;
  const end = Math.min(n, last + Math.round(0.025 * SR));
  return end < n ? buf.slice(0, end) : buf;
}

export function renderSound(name, v = 0) {
  const def = SOUNDS[name]; if (!def) return null;
  const R = rng(hashSeed(name) + v * 7919 + 13);
  const out = def.gen(R, v);
  return finalize(out, def);
}
export const variantsOf = (name) => SOUNDS[name]?.variants ?? 1;
export const isLoop = (name) => !!SOUNDS[name]?.loop;
