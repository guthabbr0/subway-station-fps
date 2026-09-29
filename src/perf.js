// Quality presets, adaptive quality controller, frame statistics and the F3 overlay.
//
// The ladder below is ordered by "visual value lost per millisecond gained": bloom cost first (full = half-res first mip -> 'lite' = quarter-res first mip -> off), then the
// pixel count (device pixel ratio 2 -> 1.5 -> 1.25 -> 1.0), then the particle / decal budgets, then a sub-native render scale (0.75, 0.55). The controller only ever walks DOWN
// the ladder while the game runs (one try back UP is allowed after a long stable stretch and is remembered as failed when it does not hold), so the
// quality can never oscillate. `?q=ultra|high|med|low` pins a rung (no adaptation unless `&adapt=1`), `?q=auto` (default) adapts.
import { clamp } from './core.js';
import { templates } from './enemies/rig.js';

export const LADDER = [
  { name: 'ultra', dpr: 2.0, bloom: 'full', fx: 1.0, decals: 1.0 },   // the pre-optimisation look: half-res first bloom mip, DPR up to 2
  { name: 'high', dpr: 1.5, bloom: 'lite', fx: 1.0, decals: 1.0 },    // default: bloom from quarter resolution (visually equal, ~4x fewer bloom pixels)
  { name: 'mid', dpr: 1.5, bloom: 'off', fx: 1.0, decals: 1.0 },
  { name: 'med', dpr: 1.25, bloom: 'off', fx: 1.0, decals: 1.0 },
  { name: 'low1', dpr: 1.0, bloom: 'off', fx: 1.0, decals: 1.0 },
  { name: 'low', dpr: 1.0, bloom: 'off', fx: 0.6, decals: 0.5 },      // reduced particle + decal budgets
  { name: 'min', dpr: 0.75, bloom: 'off', fx: 0.4, decals: 0.35 },    // sub-native render scale
  { name: 'floor', dpr: 0.55, bloom: 'off', fx: 0.4, decals: 0.35 },  // last resort: roughly 1/3 of the pixels of a DPR 1 canvas (the compositor upscales, the grain hides most of it)
];
// ?q=<name> or ?q=<0..7> pins a rung; the documented presets are ultra | high | med | low (= rungs 0, 1, 3, 5)
const PRESET = Object.fromEntries(LADDER.map((l, i) => [l.name, i])); PRESET.medium = 3; Object.assign(PRESET, Object.fromEntries(LADDER.map((l, i) => [String(i), i])));
const TARGET_MS = 20.5;        // ~49 fps: the controller steps down when the median frame time is above this
const SPIKE_MS = 250;          // frames longer than this (tab switch, GC storm, breakpoint) are ignored
const WINDOW = 90;             // frames per decision window
const WARMUP_FRAMES = 30;      // ignored after start / after a step (JIT, shader upload, canvas realloc)
const STABLE_S = 25;           // seconds of comfortable headroom before ONE attempt to go back up

export function create(game, hooks) {
  const params = game.params;
  const dprNow = () => Math.min(window.devicePixelRatio || 1, 3);
  const P = { level: 1, adaptive: true, overlayOn: false, steps: 0, log: [], fps: 0, ms: 0, p95: 0, calls: 0, tris: 0, frames: 0, failed: new Set(), startLevel: 1 };

  // ---- initial level ---------------------------------------------------------------------------------------------------------------
  const q = (params.get('q') || 'auto').toLowerCase(), pinned = q in PRESET, adaptParam = params.get('adapt');
  const gpu = (() => { try { const gl = game.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''; } catch (e) { return ''; } })();
  const weak = /uhd|hd graphics|mali|adreno|powervr|videocore|vega \d|swiftshader|llvmpipe|software/i.test(gpu); // clearly weak parts start one rung down; everything else starts at 'high'
  P.gpu = gpu; P.weakGpu = weak;
  if (pinned) P.level = PRESET[q]; else if (game.testMode) P.level = 1; else P.level = weak ? 2 : 1; // clearly weak GPUs start one rung down
  P.adaptive = adaptParam === '1' ? true : adaptParam === '0' ? false : !(pinned || game.testMode); // tests / probes / pinned presets never adapt
  P.startLevel = P.level;
  P.bloomForcedOff = params.get('bloom') === '0'; // legacy switch used by tests and screenshots

  // nominal effect of a rung; the device pixel ratio is applied by the caller at resize time (it can change while playing: zoom, monitor switch)
  const eff = (i) => { const L = LADDER[i]; return { dpr: L.dpr, bloom: P.bloomForcedOff ? 'off' : L.bloom, fx: L.fx, decals: L.decals }; };
  const sig = (i) => { const e = eff(i); return Math.min(e.dpr, dprNow()) + '|' + e.bloom + '|' + e.fx + '|' + e.decals; };
  P.anisoFor = (i) => (i >= 4 ? 2 : i >= 3 ? 4 : 8);
  P.apply = (i, why) => {
    i = clamp(i | 0, 0, LADDER.length - 1); P.level = i; const e = eff(i);
    hooks.apply(e, LADDER[i]); P.frames = 0; ring.n = 0; ring.i = 0; stableSince = 0; P.log.push({ t: +game.time.toFixed(1), level: i, name: LADDER[i].name, why }); if (P.log.length > 40) P.log.shift();
    return e;
  };
  P.name = () => LADDER[P.level].name;

  // ---- frame statistics ------------------------------------------------------------------------------------------------------------
  const ring = { a: new Float32Array(WINDOW), s: new Float32Array(WINDOW), n: 0, i: 0 };
  let last = 0, stableSince = 0, strikes = 0, cool = 0, upAt = -1, overlay = null, overlayT = 0;
  const disp = { a: new Float32Array(120), n: 0, i: 0 };
  const median = (arr, n, out) => { for (let k = 0; k < n; k++) out[k] = arr[k]; for (let a = 1; a < n; a++) { const v = out[a]; let b = a - 1; while (b >= 0 && out[b] > v) { out[b + 1] = out[b]; b--; } out[b + 1] = v; } return out; };

  // called once per rendered frame with the rAF timestamp (ms)
  P.frame = (now) => {
    const dt = last ? now - last : 0; last = now;
    if (dt <= 0 || dt > SPIKE_MS || document.hidden) { ring.n = 0; ring.i = 0; return; }
    P.frames++;
    disp.a[disp.i] = dt; disp.i = (disp.i + 1) % 120; if (disp.n < 120) disp.n++;
    if (P.frames <= WARMUP_FRAMES) return;
    ring.a[ring.i] = dt; ring.i = (ring.i + 1) % WINDOW; if (ring.n < WINDOW) ring.n++;
    if (cool > 0) { cool--; return; }
    if (ring.n < WINDOW) return;
    if (!P.adaptive || game.state === 'paused') { ring.n = WINDOW - 30; return; }
    const s = median(ring.a, ring.n, ring.s), med = s[ring.n >> 1], p90 = s[Math.floor(ring.n * 0.9)];
    if (med > TARGET_MS || p90 > 34) {
      stableSince = 0; strikes++;
      if (strikes >= 2 && P.level < LADDER.length - 1) { // two consecutive slow windows: step down (to the next rung that actually changes something)
        strikes = 0; const from = sig(P.level); let n = P.level + 1; while (n < LADDER.length - 1 && sig(n) === from) n++;
        if (upAt >= 0) { P.failed.add(P.level); upAt = -1; } // the rung we tried going up to did not hold: never try it again
        P.steps++; P.apply(n, `median ${med.toFixed(1)}ms p90 ${p90.toFixed(1)}ms`); cool = 20;
      } else ring.n = WINDOW - 45; // re-check after 45 more frames
    } else {
      strikes = 0;
      if (med < 12.8 && p90 < 15.5) { if (!stableSince) stableSince = now; } else stableSince = 0;
      ring.n = WINDOW - 45;
      const nextUp = P.level - 1;
      // one careful attempt to go back up after a long stable stretch (never above the starting rung, never a rung that already failed)
      if (stableSince && now - stableSince > STABLE_S * 1000 && nextUp >= P.startLevel && !P.failed.has(nextUp) && sig(nextUp) !== sig(P.level)) { upAt = game.time; stableSince = 0; P.apply(nextUp, 'stable headroom'); cool = 20; }
      else if (upAt >= 0 && game.time - upAt > 12) upAt = -1; // it held: forget the attempt
    }
  };

  P.summary = () => ({ level: P.level, name: P.name(), fps: P.fps, ms: P.ms, p95: P.p95, calls: P.calls, tris: P.tris, dpr: game.renderer.getPixelRatio(), bloom: game.post ? game.post.mode : 'legacy', mpx: game.post ? +game.post.mpx().toFixed(2) : 0, passes: game.post ? game.post.passList().length : 0, steps: P.steps, adaptive: P.adaptive });

  // Estimated resident GPU texture memory in MB (unique textures reachable from both scenes + enemy atlases + post targets; RGBA8 x1.33 for mips, RGBA16F x2). On demand only.
  P.textureMb = () => {
    const seen = new Set(); let bytes = 0;
    const add = (t) => { if (!t || !t.isTexture || seen.has(t)) return; seen.add(t); const im = t.image, w = (im && (im.width || im.naturalWidth)) || 0, h = (im && (im.height || im.naturalHeight)) || 0; const half = t.type === 1016 || t.type === 1015; bytes += w * h * (half ? 8 : 4) * (t.generateMipmaps !== false && t.minFilter !== 1006 && t.minFilter !== 1003 ? 1.333 : 1); };
    for (const root of [game.scene, game.viewScene]) root.traverse((o) => { const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) { for (const k in m) add(m[k]); if (m.uniforms) for (const k in m.uniforms) add(m.uniforms[k].value); } });
    for (const tpl of Object.values(templates())) for (const o of tpl.outfits) add(o.map);
    if (game.scene.environment) bytes += 6 * 256 * 256 * 8 * 1.33 * 0.5; // PMREM cube (approximation)
    const p = game.post; if (p) { bytes += p.w * p.h * (8 + 4); if (p.bloom) for (const t of [p.bloom.bright, p.bloom.out, ...p.bloom.hor, ...p.bloom.ver]) bytes += t.width * t.height * 8; }
    return bytes / 1048576;
  };

  // ---- F3 overlay --------------------------------------------------------------------------------------------------------------------
  const ensureOverlay = () => {
    if (overlay) return overlay;
    overlay = document.createElement('pre'); overlay.id = 'perf-overlay';
    overlay.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;z-index:40;pointer-events:none;font:11px/1.35 ui-monospace,Consolas,Menlo,monospace;color:#9fe8a8;background:rgba(0,0,0,.62);border:1px solid rgba(159,232,168,.35);white-space:pre;display:none';
    document.body.appendChild(overlay); return overlay;
  };
  P.toggleOverlay = (on) => {
    P.overlayOn = on === undefined ? !P.overlayOn : !!on; const o = ensureOverlay(); o.style.display = P.overlayOn ? 'block' : 'none';
    try { localStorage.setItem('perfOverlay', P.overlayOn ? '1' : '0'); } catch (e) { /* storage may be blocked */ }
    overlayT = 0;
  };
  P.stats = () => { // fps / frame ms over the display window (median + p95), computed on demand only
    const n = disp.n; if (!n) return P;
    const s = median(disp.a, n, new Float32Array(n)); P.ms = s[n >> 1]; P.p95 = s[Math.min(n - 1, Math.floor(n * 0.95))]; P.fps = P.ms > 0 ? 1000 / P.ms : 0; return P;
  };
  P.updateOverlay = (dtSec, info) => {
    if (!P.overlayOn) return; overlayT -= dtSec; if (overlayT > 0) return; overlayT = 0.25;
    P.stats(); const r = game.renderer, e = LADDER[P.level], sz = r.getDrawingBufferSize(_v2), post = game.post;
    const mem = performance && performance.memory ? ` heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}MB` : '';
    overlay.textContent =
      `${P.fps.toFixed(0).padStart(3)} fps  ${P.ms.toFixed(1)} ms  p95 ${P.p95.toFixed(1)}\n` +
      `draws ${P.calls}  tris ${(P.tris / 1000).toFixed(0)}k  prog ${info.programs ? info.programs.length : 0}  geo ${info.memory.geometries}  tex ${info.memory.textures}${mem}\n` +
      `quality ${e.name} [${P.level}]${P.adaptive ? ' auto' : ' fixed'}  ${sz.x}x${sz.y} @${r.getPixelRatio().toFixed(2)}  bloom ${post ? post.mode : 'legacy'}  fx ${e.fx}\n` +
      `enemies ${game.enemies ? game.enemies.aliveCount?.() : 0}  steps ${P.steps}${P.log.length ? '  last: ' + P.log[P.log.length - 1].name : ''}\nF3 hide - Shift+F3 next quality (stops auto)`;
  };
  const _v2 = new game.THREE.Vector2();

  addEventListener('keydown', (ev) => {
    if (ev.code === 'F3') { ev.preventDefault(); if (ev.shiftKey) { P.adaptive = false; P.apply((P.level + 1) % LADDER.length, 'manual'); } else P.toggleOverlay(); }
  });
  try { if (localStorage.getItem('perfOverlay') === '1') { P.overlayOn = true; ensureOverlay().style.display = 'block'; } } catch (e) { /* ignore */ }
  return P;
}
