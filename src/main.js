// Bootstrap, module wiring, post-processing, game loop and state machine.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, Input, bus, LAYOUT, clamp, damp } from './core.js';
import { STUBS } from './stubs.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const DPR = Math.min(devicePixelRatio, parseFloat(params.get('dpr') || '1.5'));
renderer.setPixelRatio(DPR); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 400);
scene.add(camera);
const viewScene = new THREE.Scene(); // first-person weapon models, drawn on top with a fresh depth buffer
const viewCamera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.02, 10);
viewScene.add(viewCamera);
viewScene.add(new THREE.HemisphereLight(0xdde6ff, 0x30281f, 1.6));
const vkey = new THREE.DirectionalLight(0xfff0dd, 2.2); vkey.position.set(0.5, 1, 0.6); viewScene.add(vkey);

const game = {
  THREE, renderer, scene, camera, viewScene, viewCamera, params,
  world: new World(), input: new Input(canvas), state: 'menu', time: 0, dt: 0, arsenalAll: params.get('arsenal') === 'all',
  fx: { damage: 0, chroma: 0.0006, grain: 0.05 }, debug: {},
  manual: params.get('manual') === '1', // test mode: the real-time loop only renders, the simulation advances through game.debug.step()
};
game.scene.fog = new THREE.FogExp2(0x0d1116, 0.012);
window.game = game;

// ---- module wiring -------------------------------------------------------------------------
const ORDER = ['audio', 'vfx', 'combat', 'projectiles', 'station', 'player', 'enemies', 'weapons', 'train', 'pickups', 'waves', 'hud'];
async function load(name) {
  try { const m = await import(`./${name}.js`); if (typeof m.create !== 'function') throw new Error('no create() export'); return m.create(game); }
  catch (e) { console.warn(`[main] module "${name}" failed to load, using stub:`, e); if (STUBS[name]) return STUBS[name](game); throw e; }
}
async function boot() {
  for (const n of ORDER) game[n] = await load(n);
  for (const n of ORDER) { try { await game[n].init?.(); } catch (e) { console.error(`[main] ${n}.init failed`, e); } }
  setupPost();
  game.player.reset?.(); game.weapons.reset?.();
  warmShaders(); warmRender();
  game.player.reset?.(); // (restores the camera after the warm-up views)
  document.getElementById('loading').style.display = 'none';
  if (params.get('autostart')) startGame();
  requestAnimationFrame(frame);
}

// ---- post processing -----------------------------------------------------------------------
let composer, bloom, finalPass;
const FinalShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uDamage: { value: 0 }, uChroma: { value: 0.0006 }, uGrain: { value: 0.05 }, uLow: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime,uDamage,uChroma,uGrain,uLow; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233))+uTime)*43758.5453); }
    void main(){
      vec2 c=vUv-0.5; float r2=dot(c,c); float ca=uChroma*(1.0+r2*6.0)+uDamage*0.006;
      vec3 col=vec3(texture2D(tDiffuse,vUv+c*ca).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-c*ca).b);
      float g=dot(col,vec3(0.299,0.587,0.114)); col=mix(col,vec3(g),uLow*0.6);
      col*=1.0-smoothstep(0.25,0.95,r2*2.2)*0.55;
      col+=vec3(0.55,0.0,0.0)*uDamage*smoothstep(0.05,0.5,r2);
      col+=(h(vUv*vec2(1920.0,1080.0))-0.5)*uGrain;
      gl_FragColor=vec4(col,1.0);
    }`,
};
function setupPost() {
  const w = innerWidth, h = innerHeight;
  composer = new EffectComposer(renderer); composer.setPixelRatio(DPR); composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));
  const vp = new RenderPass(viewScene, viewCamera); vp.clear = false; vp.clearDepth = true; composer.addPass(vp);
  if (params.get('bloom') !== '0') { bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.55, 0.6, 0.85); composer.addPass(bloom); }
  composer.addPass(new OutputPass());
  finalPass = new ShaderPass(FinalShader); composer.addPass(finalPass);
}
// Compile every material of both scenes up front (renderer.compile walks invisible objects too: unequipped viewmodels, pooled vfx meshes,
// enemy rigs...) so the first shot / first spawn of a run does not stall the frame on shader compilation.
function warmShaders() {
  if (params.get('nowarm')) return; // A/B switch for measuring first-use hitches
  try {
    const t0 = performance.now();
    renderer.compile(scene, camera); renderer.compile(viewScene, viewCamera);
    game.warmMs = performance.now() - t0;
  } catch (e) { console.warn('[main] shader warm-up skipped', e); }
}
// Render a few real frames behind the loading screen: first-use texture uploads, render-target allocation and the train's material pre-warm frames
// all happen here instead of as a multi-hundred-ms stall on the first visible frame. Views cover the platform and both tunnel mouths.
function warmRender() {
  if (params.get('nowarm')) return;
  try {
    const t0 = performance.now();
    for (let i = 0; i < 3; i++) { game.train.update?.(0.016); syncViewCam(); composer ? composer.render(0.016) : renderer.render(scene, camera); }
    for (const yaw of [Math.PI / 2, Math.PI, -Math.PI / 2, 0]) { camera.rotation.set(0, yaw, 0); syncViewCam(); renderer.render(scene, camera); }
    renderer.setRenderTarget(null);
    game.warmRenderMs = performance.now() - t0;
  } catch (e) { console.warn('[main] render warm-up skipped', e); }
}
// for modules that build materials lazily (projectile meshes, per-weapon effects): game.warm(object3d) compiles them against the world scene without adding them
game.warm = (obj) => { try { renderer.compile(obj, camera, scene); } catch (e) { /* best effort */ } };
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); composer?.setSize(innerWidth, innerHeight);
  camera.aspect = viewCamera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); viewCamera.updateProjectionMatrix();
});

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
const syncViewCam = () => { camera.updateMatrixWorld(); viewCamera.position.copy(camera.position); viewCamera.quaternion.copy(camera.quaternion); viewCamera.updateMatrixWorld(); };
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
  if (finalPass) { const u = finalPass.uniforms; u.uTime.value = (game.time % 100); u.uDamage.value = game.fx.damage; u.uChroma.value = game.fx.chroma; u.uGrain.value = game.fx.grain; u.uLow.value = clamp(1 - game.player.health / 35, 0, 1) * (game.player.alive ? 1 : 0); }
  if (composer) composer.render(dt); else { renderer.autoClear = true; renderer.render(scene, camera); renderer.autoClear = false; renderer.clearDepth(); renderer.render(viewScene, viewCamera); }
}

boot().catch((e) => { console.error(e); $('loading').textContent = 'Failed to start: ' + e.message; });
