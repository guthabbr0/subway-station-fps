// Bootstrap, module wiring, render pipeline, quality control, game loop and state machine.
import * as THREE from 'three';
import { World, Input, bus, LAYOUT, clamp, damp } from './core.js';
import { STUBS } from './stubs.js';
import { Post, updateVisible } from './post.js';
import { create as createPerf } from './perf.js';
import { patchShaders } from './shaders.js';

const params = new URLSearchParams(location.search);
const testMode = params.has('manual') || params.has('nolock'); // headless test / probe runs: fixed quality, no adaptation, no GPU heuristics
const canvas = document.getElementById('game');
// No default-framebuffer depth/alpha (everything is drawn into the post pipeline's own targets; the last pass is a full-screen triangle), no MSAA.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
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

// ---- quality / performance controller ---------------------------------------------------------------------------------------------
let post = null, sizeDirty = true, levelDpr = 1.5;
const dprCapParam = parseFloat(params.get('dpr') || '0') || 0;
game.perf = createPerf(game, {
  apply(e) { // called by the controller (start-up, adaptive steps, F3 manual cycling)
    levelDpr = dprCapParam ? Math.min(e.dpr, dprCapParam) : e.dpr;
    sizeDirty = true; if (post) { applySize(); post.setBloom(e.bloom); }
    game.vfx?.setBudget?.(e.fx, e.decals);
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
    try { if (r.err) throw r.err; game[n] = r.mod.create(game); }
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
  loadingEl.style.display = 'none';
  if (params.get('autostart')) startGame();
  requestAnimationFrame(frame);
}

// ---- post processing -----------------------------------------------------------------------------------------------------------------
function setupPost() {
  post = new Post(game); game.post = post;
  game.debug.perfPasses = () => ({ post, bloom: post.bloom });
}

// ---- resize / DPR ---------------------------------------------------------------------------------------------------------------------
let curPR = 0, curW = 0, curH = 0;
function applySize() {
  sizeDirty = false;
  // Assigning canvas.width/height (three does it in every setPixelRatio/setSize) reallocates the drawing buffer even when the value is unchanged, so each is done only when needed:
  // at boot the ratio is set first (on the tiny default canvas) and the real size second = ONE full-size allocation; a quality step is one allocation; a window resize is one.
  const pr = Math.min(levelDpr, window.devicePixelRatio || 1);
  if (pr !== curPR) { renderer.setPixelRatio(pr); curPR = pr; }
  if (innerWidth !== curW || innerHeight !== curH) { renderer.setSize(innerWidth, innerHeight, false); curW = innerWidth; curH = innerHeight; } // CSS keeps the canvas at 100%; a lower ratio is simply upscaled by the compositor
  camera.aspect = viewCamera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); viewCamera.updateProjectionMatrix();
  if (post) { const s = renderer.getDrawingBufferSize(_sz); post.setSize(s.x, s.y); }
}
const _sz = new THREE.Vector2();
addEventListener('resize', () => { sizeDirty = true; });
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); loadingEl.style.display = 'flex'; loadingEl.textContent = 'Graphics context lost - reloading…'; setTimeout(() => location.reload(), 600); });

// ---- warm-up ----------------------------------------------------------------------------------------------------------------------------
// Every program of both scenes is compiled in PARALLEL (KHR_parallel_shader_compile) against the render-target variant, every texture is uploaded, then a couple of
// real frames run behind the loading screen, so the first shot / first spawn / first train of a run does not stall on shader compilation or texture upload.
async function warmUp() {
  if (params.get('nowarm')) return;
  const t0 = performance.now();
  try {
    progress(0.72, 'shaders');
    if (renderer.extensions.has('KHR_parallel_shader_compile')) await Promise.all([renderer.compileAsync(scene, camera), renderer.compileAsync(viewScene, viewCamera)]); // links run on the GPU process threads, the page stays responsive
    else { // no parallel compile: link them one at a time here (each getUniforms() forces the link) so the cost lands behind the loading screen, not in the first frames
      renderer.compile(scene, camera); renderer.compile(viewScene, viewCamera);
      const progs = renderer.info.programs || [];
      for (let i = 0; i < progs.length; i++) { try { progs[i].getUniforms(); } catch (e) { /* ignore */ } if ((i & 7) === 7) { progress(0.72 + 0.12 * i / progs.length); await paint(); } }
    }
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
  if (!game.manual) simulate(dt);
  if (sizeDirty) applySize();
  renderer.info.reset();
  post.render(dt);
  const info = renderer.info, P = game.perf; P.calls = info.render.calls; P.tris = info.render.triangles;
  P.frame(now); if (P.overlayOn) P.updateOverlay(dt, info);
}

boot().catch((e) => { console.error(e); loadingEl.textContent = 'Failed to start: ' + e.message; });
