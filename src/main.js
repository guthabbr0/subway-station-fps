// Bootstrap, module wiring, render pipeline, quality control, game loop and state machine.
import * as THREE from 'three';
import { World, Input, bus, LAYOUT, clamp, damp } from './core.js';
import { STUBS } from './stubs.js';
import { Post, updateVisible, probeTargetType } from './post.js';
import { create as createPerf } from './perf.js';
import { create as createBB } from './blackbox.js';
import { patchShaders } from './shaders.js';

const params = new URLSearchParams(location.search);
const testMode = params.has('manual') || params.has('nolock'); // headless test / probe runs: fixed quality, no adaptation, no GPU heuristics
const canvas = document.getElementById('game');
// Everything is drawn into the post pipeline's own targets and the last pass is a full-screen triangle, so the default framebuffer needs no alpha / stencil / MSAA. It does get a depth
// buffer (4 bytes per pixel): the F4 isolation mode 2 (src/blackbox.js) draws the scene straight to the canvas, which needs depth testing. ?pp=default|low overrides the GPU power hint.
const powerPref = { low: 'low-power', default: 'default', high: 'high-performance' }[params.get('pp')] || 'high-performance';
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: true, stencil: false, powerPreference: powerPref }); }
catch (e) { document.getElementById('loading').textContent = 'WebGL 2 is not available in this browser / GPU configuration (' + (e && e.message ? e.message : e) + '). Try enabling hardware acceleration or another browser.'; throw e; }
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.info.autoReset = false; // the pipeline renders several passes per frame; main.js resets the counters once per frame so F3 shows whole-frame totals

// renderer.compile()/compileAsync() key programs on the CURRENT render target (tone mapping + output colour space differ between the canvas and a target).
// Everything is drawn into the post pipeline's half-float target, so ALL compiles (ours and other modules') must happen against a target too, otherwise the
// programs they warm are the wrong variants: never used, and the right ones then compile in the middle of the game (frame hitch on first use).
const _compileRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
const _compile = renderer.compile.bind(renderer);
renderer.compile = function (s, c, t) { const prev = renderer.getRenderTarget(); renderer.setRenderTarget(_compileRT); try { return _compile(s, c, t); } finally { renderer.setRenderTarget(prev); } };

// Fragment-shader work removed from three's built-in chunks without changing the picture (rough-surface IBL sharing, point-light early-out on real GPUs): see src/shaders.js.
const shaderPatches = patchShaders(THREE, renderer, params);

// Opaque draws sorted PROGRAM-major (three's default is material.id-major, which interleaves programs): every program change re-uploads all light uniforms (14 lights x 4 values), so
// fewer switches = fewer uniform calls. Within one program: material, then front-to-back like three does. Programs are created lazily, so unknown ones sort by material id only.
if (!params.has('nosort')) {
  const pid = (o) => { const p = renderer.properties.get(o.material).currentProgram; return p ? p.id : -1; };
  renderer.setOpaqueSort((a, b) => (a.groupOrder - b.groupOrder) || (a.renderOrder - b.renderOrder) || (pid(a) - pid(b)) || (a.material.id - b.material.id) || (a.z - b.z) || (a.id - b.id));
}

const scene = new THREE.Scene();
scene.matrixAutoUpdate = false; // the scene roots never move; with matrixAutoUpdate on, three flags them dirty EVERY frame and that forces a world-matrix recompute of every node below (2300 per frame here)
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 400);
scene.add(camera);
const viewScene = new THREE.Scene(); // first-person weapon models, drawn on top with a fresh depth buffer
viewScene.matrixAutoUpdate = false;
const viewCamera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.02, 10);
viewScene.add(viewCamera);
viewScene.add(new THREE.HemisphereLight(0xdde6ff, 0x30281f, 1.6));
const vkey = new THREE.DirectionalLight(0xfff0dd, 2.2); vkey.position.set(0.5, 1, 0.6); viewScene.add(vkey);

const game = {
  THREE, renderer, scene, camera, viewScene, viewCamera, params,
  world: new World(), input: new Input(canvas), state: 'menu', time: 0, dt: 0, arsenalAll: params.get('arsenal') === 'all',
  fx: { damage: 0, chroma: 0.0006, grain: 0.05 }, debug: {}, shaderPatches,
  manual: params.get('manual') === '1', // test mode: the real-time loop only renders, the simulation advances through game.debug.step()
  testMode,
};
game.scene.fog = new THREE.FogExp2(0x0d1116, 0.012);
window.game = game;
game.bb = createBB(game); // black-box hunt tooling: error capture, F4 isolation modes, F6 diagnostics (src/blackbox.js)

// ---- quality / performance controller ---------------------------------------------------------------------------------------------
let post = null, sizeDirty = true, levelDpr = 1.5, curEff = { bloom: 'lite', dpr: 1.5, fx: 1, decals: 1 }, booted = false;
const dprCapParam = parseFloat(params.get('dpr') || '0') || 0;
const override = { bloom: null, dpr: 0 }; // isolation modes (F4): forced bloom mode / forced pixel ratio (0 = none)
game.perf = createPerf(game, {
  apply(e) { // called by the controller (start-up, adaptive steps, F3 manual cycling)
    levelDpr = dprCapParam ? Math.min(e.dpr, dprCapParam) : e.dpr; curEff = e; sizeDirty = true;
    game.vfx?.setBudget?.(e.fx, e.decals);
    if (post) refresh();
  },
});
game.perf.eff0 = () => game.perf.apply(game.perf.level, 'start');
game.aniso = game.perf.anisoFor(game.perf.level); // read by textures.js when the station materials are created
game.quality = game.perf;

// ---- module wiring -------------------------------------------------------------------------------------------------------------------
const ORDER = ['audio', 'vfx', 'combat', 'projectiles', 'station', 'player', 'enemies', 'weapons', 'train', 'pickups', 'waves', 'hud'];
// weight of each init step in the loading bar (rough share of the boot time; the bar only has to be monotonic and honest)
const WEIGHT = { audio: 6, vfx: 6, combat: 1, projectiles: 1, station: 25, player: 2, enemies: 12, weapons: 10, train: 8, pickups: 5, waves: 1, hud: 3 };
const boot_ = { marks: {}, t0: performance.now() };
const mark = (k) => { boot_.marks[k] = Math.round(performance.now() - boot_.t0); };
game.perf.boot = boot_.marks;

// loading screen: label + bar (built here so index.html stays untouched)
const loadingEl = document.getElementById('loading');
const bar = document.createElement('div'), fill = document.createElement('i'), stage = document.createElement('div');
bar.style.cssText = 'position:absolute;left:50%;top:calc(50% + 26px);width:min(320px,60vw);height:3px;transform:translateX(-50%);background:rgba(232,226,212,.16);overflow:hidden';
fill.style.cssText = 'display:block;height:100%;width:0;background:#ffb020;transition:width .2s ease-out';
stage.style.cssText = 'position:absolute;left:0;right:0;top:calc(50% + 40px);text-align:center;font-size:11px;letter-spacing:.2em;opacity:.55';
bar.appendChild(fill); loadingEl.append(bar, stage);
let bootDone = 0, bootTotal = 1;
const progress = (p, text) => { fill.style.width = (clamp(p, 0, 1) * 100).toFixed(1) + '%'; if (text) stage.textContent = text; };
// let the browser paint the bar between the synchronous chunks of start-up work (falls back to a timer when the tab is hidden and rAF is paused)
let lastPaint = 0;
const paint = () => new Promise((res) => { let d = false; const f = () => { if (!d) { d = true; lastPaint = performance.now(); res(); } }; requestAnimationFrame(() => setTimeout(f, 0)); setTimeout(f, 80); });
// modules with long synchronous inits may `await game.yield?.()` between chunks; it only actually yields (one frame) when 45 ms of work piled up since the last repaint, so a chatty caller costs ~nothing
game.yield = () => (performance.now() - lastPaint > 45 ? paint() : Promise.resolve());

function importModule(name) { return import(`./${name}.js`).then((m) => { if (typeof m.create !== 'function') throw new Error('no create() export'); return { mod: m }; }); }
async function boot() {
  progress(0.02, 'code');
  // all module files are fetched in parallel (their own static imports form the rest of the graph); creation and init stay strictly in ORDER
  const loaded = ORDER.map((n) => importModule(n).catch((e) => ({ err: e })));
  for (const n of ORDER) {
    const r = await loaded[ORDER.indexOf(n)];
    try {
      if (r.err) throw r.err;
      const before = n === 'vfx' ? new Set(scene.children) : null;
      game[n] = r.mod.create(game);
      if (before) { game.bbVfx = scene.children.filter((c) => !before.has(c) && !c.isLight); game.bbLights = scene.children.filter((c) => c.isPointLight && /^vfxLight/.test(c.name)); } // F4 modes 4 / 6
    }
    catch (e) { console.warn(`[main] module "${n}" failed to load, using stub:`, e); if (STUBS[n]) game[n] = STUBS[n](game); else throw e; }
  }
  mark('modules'); bootTotal = ORDER.reduce((a, n) => a + WEIGHT[n], 0) + 30; progress(0.08, 'modules loaded');
  for (const n of ORDER) {
    progress(0.08 + 0.62 * bootDone / bootTotal, n); await paint();
    const t = performance.now();
    try { await game[n].init?.(); } catch (e) { console.error(`[main] ${n}.init failed`, e); }
    boot_.marks['init_' + n] = Math.round(performance.now() - t); bootDone += WEIGHT[n];
  }
  mark('inits'); singlePass(scene); singlePass(viewScene);
  setupPost(); game.perf.eff0(); applySize();
  game.player.reset?.(); game.weapons.reset?.();
  await warmUp();
  game.player.reset?.(); // (restores the camera after the warm-up views)
  mark('ready'); boot_.marks.programs = renderer.info.programs?.length || 0;
  for (const c of viewCamera.children) if (c.isPointLight) (game.bbLights || (game.bbLights = [])).push(c); // the weapon muzzle light (F4 mode 6)
  loadingEl.style.display = 'none'; booted = true;
  if (params.get('autostart')) startGame();
  game.bb.boot();
  requestAnimationFrame(frame);
}

// ---- post processing -----------------------------------------------------------------------------------------------------------------
function setupPost() {
  const probe = probeTargetType(renderer); // is a half-float colour buffer really renderable here? (otherwise the HDR targets fall back to RGBA8 and the look loses its highlights, but nothing goes black)
  post = new Post(game, { type: probe.type, sanitize: !params.has('nosan'), maxDim: hwMaxDim() }); game.post = post; game.hdr = probe;
  if (params.has('nancheck')) post.probeEvery = 10; // Inf / NaN detector on the HDR scene target (F3 shows it, F6 exports it)
  if (!probe.ok) console.warn('[main] half-float render targets are not renderable here (framebuffer status ' + probe.status + '): using RGBA8 targets');
  game.debug.perfPasses = () => ({ post, bloom: post.bloom });
}

// ---- resize / DPR ---------------------------------------------------------------------------------------------------------------------
// The drawing buffer is chosen here and NOWHERE else: pixel ratio = the quality rung's DPR limited by the display's, then (a) capped so that the TOTAL pixel count stays within the budget of the rung
// (?maxpx=<Mpx>, 0 = unlimited; default 2.6 Mpx, 8.5 Mpx for the ultra rung on a strong GPU, no cap in test mode) and (b) within the hardware limits (max texture / renderbuffer / viewport).
// Every full-frame pass target follows the drawing buffer size (Post.setSize), and a change is followed by an immediate re-render so no frame is presented with a freshly re-allocated
// (undefined) drawing buffer or with stale targets.
let curPR = 0, curW = 0, curH = 0, lastDev = 0;
const hwMaxDim = () => {
  let m = Math.min(renderer.capabilities.maxTextureSize || 4096, 8192);
  try { const gl = renderer.getContext(); m = Math.min(m, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || m); const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS); if (vp) m = Math.min(m, vp[0], vp[1]); } catch (e) { /* context lost */ }
  return m;
};
const pipeline = game.pipeline = { override, capMpx: 0, reason: '', hwMax: 0, refresh: () => refresh(), verify: () => verifySizes(), applySize: () => applySize() };
function chooseRatio(iw, ih) {
  const dev = window.devicePixelRatio || 1; lastDev = dev;
  let pr = Math.min(levelDpr, dev), reason = '';
  if (override.dpr) { pr = Math.min(pr, override.dpr); reason = 'F4 dpr'; }
  const capMpx = game.perf.pixelCap(); pipeline.capMpx = capMpx;
  if (capMpx > 0 && iw * ih * pr * pr > capMpx * 1e6) { pr = Math.sqrt(capMpx * 1e6 / (iw * ih)); reason = 'pixel cap ' + capMpx + ' Mpx'; }
  const lim = pipeline.hwMax = hwMaxDim();
  if (iw * pr > lim) { pr = lim / iw; reason = 'hardware limit ' + lim; }
  if (ih * pr > lim) { pr = lim / ih; reason = 'hardware limit ' + lim; }
  pipeline.reason = reason;
  return Math.max(0.2, Math.floor(pr * 1000) / 1000);
}
function applySize() {
  sizeDirty = false;
  // Assigning canvas.width/height (three does it in every setPixelRatio/setSize) reallocates the drawing buffer even when the value is unchanged, so each is done only when needed:
  // at boot the ratio is set first (on the tiny default canvas) and the real size second = ONE full-size allocation; a quality step is one allocation; a window resize is one.
  const iw = Math.max(1, innerWidth), ih = Math.max(1, innerHeight), pr = chooseRatio(iw, ih);
  if (pr !== curPR) { renderer.setPixelRatio(pr); curPR = pr; }
  if (iw !== curW || ih !== curH) { renderer.setSize(iw, ih, false); curW = iw; curH = ih; } // CSS keeps the canvas at 100%; a lower ratio is simply upscaled by the compositor
  camera.aspect = viewCamera.aspect = iw / ih; camera.updateProjectionMatrix(); viewCamera.updateProjectionMatrix();
  if (post) { const gl = renderer.getContext(); post.setSize(gl.drawingBufferWidth || canvas.width, gl.drawingBufferHeight || canvas.height); } // (the browser may hand out a smaller buffer than requested: believe the context)
}
// re-applies size + bloom mode after ANY change and renders once right away: the drawing buffer was re-allocated, so without it the compositor could show an empty frame
function refresh() {
  applySize(); post.setBloom(override.bloom || curEff.bloom);
  if (booted && !ctxLost) { try { post.render(0); } catch (e) { console.warn('[main] render after resize failed', e); } }
}
// consistency check used by F6 and tools/blackbox-resize.mjs: every full-frame target must match the drawing buffer, the bloom chain must match its layout, the camera the window
function verifySizes() {
  const P = [], gl = renderer.getContext(); if (!post) return P;
  const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;
  if (canvas.width !== bw || canvas.height !== bh) P.push(`canvas ${canvas.width}x${canvas.height} != drawing buffer ${bw}x${bh}`);
  if (post.w !== bw || post.h !== bh) P.push(`post ${post.w}x${post.h} != drawing buffer ${bw}x${bh}`);
  if (post.rt.width !== post.w || post.rt.height !== post.h) P.push(`scene target ${post.rt.width}x${post.rt.height} != ${post.w}x${post.h}`);
  const b = post.bloom; if (b) { const S = b.sizes(post.w, post.h); const chk = (t, s, n) => { if (t.width !== s[0] || t.height !== s[1]) P.push(`${n} ${t.width}x${t.height} != ${s[0]}x${s[1]}`); }; chk(b.bright, S[0], 'bloom.bright'); chk(b.out, S[0], 'bloom.out'); for (let i = 0; i < b.n; i++) { chk(b.hor[i], S[1 + i], 'bloom.h' + i); chk(b.ver[i], S[1 + i], 'bloom.v' + i); } }
  if (Math.abs(camera.aspect - innerWidth / innerHeight) > 1e-6) P.push('camera aspect ' + camera.aspect + ' != window ' + innerWidth / innerHeight);
  const vp = renderer.getViewport(new THREE.Vector4()); if (Math.round(vp.width) !== curW || Math.round(vp.height) !== curH || vp.x || vp.y) P.push(`viewport ${vp.x},${vp.y} ${vp.width}x${vp.height} != ${curW}x${curH}`);
  return P;
}
addEventListener('resize', () => { sizeDirty = true; });
addEventListener('orientationchange', () => { sizeDirty = true; });
document.addEventListener('visibilitychange', () => { sizeDirty = true; }); // the window may have been resized / moved to another monitor while the tab was hidden (no rAF, resize events coalesced)

// ---- WebGL context loss ----------------------------------------------------------------------------------------------------------------
// three.js re-creates its own state on 'webglcontextrestored' and re-uploads textures / geometry lazily, but GPU-generated content (the PMREM environment maps of the station and the
// weapons) comes back EMPTY, and the module state has no rebuild hooks for it yet (game.station.regenEnv / game.weapons.regenEnv would be the hooks). Until they exist a restored context is
// followed by a clean reload (with a message, and a loop guard: 3 losses within a minute stops reloading and tells the player what to try).
let ctxLost = false, ctxTimer = 0;
const overlayMsg = (t) => { loadingEl.style.display = 'flex'; loadingEl.textContent = t; };
const softRestorable = () => typeof game.station?.regenEnv === 'function' && typeof game.weapons?.regenEnv === 'function';
function reloadAfterLoss() {
  let recent = [];
  try { recent = JSON.parse(sessionStorage.getItem('bb.reloads') || '[]').filter((t) => Date.now() - t < 60000); } catch (e) { /* ignore */ }
  if (recent.length >= 3) { overlayMsg('The graphics driver keeps resetting. Try adding ?q=low or ?bloom=0 to the address, update the GPU driver, or close other GPU-heavy tabs; then reload the page.'); return; }
  recent.push(Date.now()); try { sessionStorage.setItem('bb.reloads', JSON.stringify(recent)); } catch (e) { /* ignore */ }
  game.bb.noteReload(); game.leaveGuard?.release?.(); location.reload(); // release: the leave-page prompt must not block an intentional reload
}
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); ctxLost = true; game.bb.ctxEvent('lost');
  overlayMsg('Graphics context lost - waiting for the browser to restore it…');
  clearTimeout(ctxTimer); ctxTimer = setTimeout(() => reloadAfterLoss(), 10000); // never restored: a fresh page gets a fresh context
});
canvas.addEventListener('webglcontextrestored', async () => {
  clearTimeout(ctxTimer); game.bb.ctxEvent('restored');
  if (!softRestorable()) { overlayMsg('Graphics context restored - reloading to rebuild GPU resources…'); ctxTimer = setTimeout(() => reloadAfterLoss(), 600); return; }
  try { overlayMsg('Graphics context restored - rebuilding…'); await game.station.regenEnv(); await game.weapons.regenEnv(); sizeDirty = true; applySize(); post.setBloom(post.mode === 'off' ? 'off' : post.mode); await warmUp(); ctxLost = false; loadingEl.style.display = 'none'; }
  catch (err) { console.warn('[main] soft restore failed, reloading', err); reloadAfterLoss(); }
});

// ---- warm-up ----------------------------------------------------------------------------------------------------------------------------
// Every program of both scenes is compiled in PARALLEL (KHR_parallel_shader_compile) against the render-target variant, every texture is uploaded, then a couple of
// real frames run behind the loading screen, so the first shot / first spawn / first train of a run does not stall on shader compilation or texture upload.
async function warmUp() {
  if (params.get('nowarm')) return;
  const t0 = performance.now();
  try {
    progress(0.72, 'shaders');
    // Parallel compile (KHR_parallel_shader_compile) exists on real GPUs only, so this branch never ran under software GL. It is bounded (20 s) and any failure falls back to the
    // sequential path below; ?noasync=1 forces the sequential path (bisect flag).
    let done = false;
    if (!params.has('noasync') && renderer.extensions.has('KHR_parallel_shader_compile')) {
      try {
        const r = await Promise.race([Promise.all([renderer.compileAsync(scene, camera), renderer.compileAsync(viewScene, viewCamera)]), new Promise((res) => setTimeout(() => res('timeout'), 20000))]); // links run on the GPU process threads, the page stays responsive
        if (r === 'timeout') { console.warn('[main] parallel shader compile did not finish in 20 s: compiling sequentially'); game.bb.note = (game.bb.note || '') + 'compileAsync timeout; '; } else done = true;
      } catch (e) { console.warn('[main] parallel shader compile failed: compiling sequentially', e); game.bb.note = (game.bb.note || '') + 'compileAsync failed; '; }
    }
    if (!done) { // link them one at a time here (each getUniforms() forces the link) so the cost lands behind the loading screen, not in the first frames
      renderer.compile(scene, camera); renderer.compile(viewScene, viewCamera);
      const progs = renderer.info.programs || [];
      for (let i = 0; i < progs.length; i++) { try { progs[i].getUniforms(); } catch (e) { /* ignore */ } if ((i & 7) === 7) { progress(0.72 + 0.12 * i / progs.length); await paint(); } }
    }
    for (const p of renderer.info.programs || []) { try { p.getUniforms(); } catch (e) { /* forces the link so link errors surface now (F3 / F6 list them) */ } }
    mark('compile'); progress(0.85, 'textures'); await paint();
    const seen = new Set(), texs = [];
    for (const root of [scene, viewScene]) root.traverse((o) => { const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) for (const k in m) { const t = m[k]; if (t && t.isTexture && !seen.has(t)) { seen.add(t); texs.push(t); } } });
    if (scene.environment) texs.push(scene.environment);
    for (let i = 0; i < texs.length; i++) { try { renderer.initTexture(texs[i]); } catch (e) { /* not every property named like a texture is uploadable */ } if ((i & 15) === 15) { progress(0.85 + 0.1 * i / texs.length); await paint(); } }
    mark('textures'); progress(0.94, 'weapons'); await paint();
    // Geometry buffers are uploaded when an object is first RENDERED: every holstered weapon viewmodel (~50 buffers each) would otherwise upload in the middle of the fight the first
    // time it is selected. Show each one for a frame behind the loading screen (culling off so the lowered ones are not skipped).
    try {
      const W = game.weapons && game.weapons.list ? game.weapons.list : {}; renderer.setRenderTarget(post.rt); syncViewCam();
      for (const id in W) {
        const root = W[id].root, was = root.visible, fc = []; root.visible = true;
        root.traverse((o) => { fc.push([o, o.frustumCulled]); o.frustumCulled = false; }); root.updateMatrixWorld(true);
        renderer.autoClear = true; renderer.render(viewScene, viewCamera);
        for (const [o, f] of fc) o.frustumCulled = f; root.visible = was;
      }
      renderer.setRenderTarget(null); mark('weaponUpload');
    } catch (e) { console.warn('[main] weapon pre-upload skipped', e); }
    progress(0.96, 'first frames'); await paint();
    for (let i = 0; i < 3; i++) { game.train.update?.(0.016); syncViewCam(); post.render(0.016); }
    renderer.setRenderTarget(null); renderer.info.reset();
    game.warmMs = performance.now() - t0; game.warmRenderMs = game.warmMs; mark('warm');
  } catch (e) { console.warn('[main] warm-up skipped', e); }
  progress(1, 'ready');
}
// three renders a transparent DoubleSide material in TWO passes (back faces, then front faces) and, to switch between them, sets material.side + needsUpdate each time: every
// draw of such an object re-derives its program key (getProgram: ~1.5 KB of garbage and ~20 us each) and costs an extra draw call. For blend modes that do not depend on the
// order of the faces (additive, or depthWrite=false glows / windows / shafts) one pass is identical, so switch it off. Runs over every material we can reach.
function singlePass(root) {
  root.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) if (m.transparent && m.side === THREE.DoubleSide && m.depthWrite === false) m.forceSinglePass = true;
  });
}
game.singlePass = singlePass;
// for modules that build materials lazily (projectile meshes, per-weapon effects): game.warm(object3d) compiles them against the world scene without adding them
game.warm = (obj) => { try { singlePass(obj); renderer.compile(obj, camera, scene); } catch (e) { /* best effort */ } };

// ---- game state ----------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function startGame() {
  game.arsenalAll = game.arsenalAll || $('opt-arsenal')?.checked;
  for (const n of ORDER) game[n].reset?.();
  game.projectiles.clear?.(); // projectiles has no reset(): rockets / acid globs / BFG balls in flight must not survive a restart
  game.weapons.reset?.(); game.player.reset?.();
  game.state = 'playing'; game.time = 0;
  $('menu').style.display = 'none'; $('dead').style.display = 'none'; $('paused').style.display = 'none';
  game.audio.resume?.(); game.audio.startAmbience?.();
  game.hud.show?.(); bus.emit('game:start');
  game.waves.start();
  lock();
}
// pause/resume: driven by pointer lock (real play) or by Escape / the overlay click (?nolock=1, headless tests)
function setPaused(p) {
  if (p && game.state === 'playing') { game.state = 'paused'; $('paused').style.display = 'flex'; game.input.keys.clear(); game.input.mouse.fill(false); }
  else if (!p && game.state === 'paused') { game.state = 'playing'; $('paused').style.display = 'none'; }
}
game.debug.setPaused = setPaused;
function lock() {
  if (params.get('nolock')) { game.input.locked = true; setPaused(false); return; }
  canvas.requestPointerLock?.();
}
document.addEventListener('pointerlockchange', () => {
  game.input.locked = document.pointerLockElement === canvas;
  setPaused(!game.input.locked);
});
addEventListener('keydown', (e) => { if (e.code === 'Escape' && params.get('nolock')) { setPaused(game.state === 'playing'); if (game.state === 'paused') game.input.locked = false; } });
$('start').addEventListener('click', startGame);
$('restart').addEventListener('click', startGame);
$('paused').addEventListener('click', () => { game.audio.resume?.(); lock(); });
bus.on('player:dead', () => {
  if (game.state !== 'playing') return;
  game.state = 'dead'; document.exitPointerLock?.(); game.input.locked = false;
  setTimeout(() => {
    $('dead-stats').textContent = `Survived to wave ${game.waves.wave} · ${game.waves.kills} kills · score ${game.waves.score}`;
    $('dead').style.display = 'flex'; game.audio.play('gameOver'); bus.emit('game:over', { wave: game.waves.wave, kills: game.waves.kills, score: game.waves.score });
  }, 1800);
});

// ---- debug helpers (headless tests / demos) ------------------------------------------------
game.debug.god = false;
game.debug.giveAll = () => { game.weapons.reset({ all: true }); game.weapons.ammo = { bullets: 200, shells: 50, rockets: 50, cells: 300 }; };
game.debug.select = (id) => { game.weapons.give(id, false); game.weapons.forceSelect(id); };
game.debug.startWave = (n) => game.waves.debugStart?.(n);

// ---- loop ----------------------------------------------------------------------------------
let last = performance.now();
// (the view camera parents all nine weapon models: updateMatrixWorld() would recompute every holstered weapon too, ~450 nodes per call and this runs twice per frame)
const syncViewCam = () => { camera.updateMatrixWorld(); viewCamera.position.copy(camera.position); viewCamera.quaternion.copy(camera.quaternion); updateVisible(viewCamera, false); };
function simulate(dt) {
  game.dt = dt;
  const active = game.state === 'playing' || game.state === 'dead';
  if (active) {
    game.time += dt;
    game.player.update(dt);
    syncViewCam(); // weapon models are children of viewCamera
    game.weapons.update(dt);
    game.enemies.update(dt); game.projectiles.update(dt); game.waves.update(dt); game.train.update(dt); game.pickups.update(dt);
    game.station.update(dt, game.time); game.vfx.update(dt); game.audio.update?.(dt);
  } else {
    syncViewCam();
    game.station.update(dt, game.time); game.vfx.update(dt);
    if (game.state === 'menu') game.train.update(dt); // menu only: lets the train pre-warm its materials; a paused game must freeze the train too
  }
  game.hud.update?.(dt);
  game.fx.damage = damp(game.fx.damage, 0, 4, dt); game.fx.chroma = damp(game.fx.chroma, 0.0006, 3, dt);
  game.input.endFrame();
}
// Headless testing: advance the simulation n fixed steps without rendering (software GL runs at ~3 fps, so real frames are too slow to test gameplay).
game.debug.step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) simulate(dt); };
function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  if (ctxLost) return; // the context is gone: nothing can be drawn (see the loss handler above)
  if (!game.manual) simulate(dt);
  if (sizeDirty || window.devicePixelRatio !== lastDev) applySize(); // (zoom / moving the window to another monitor changes the ratio without a size change)
  renderer.info.reset();
  post.render(dt);
  const info = renderer.info, P = game.perf; P.calls = info.render.calls; P.tris = info.render.triangles;
  P.frame(now); if (P.overlayOn) P.updateOverlay(dt, info);
}

boot().catch((e) => { console.error(e); loadingEl.textContent = 'Failed to start: ' + e.message; });
