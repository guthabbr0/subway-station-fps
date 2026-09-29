// Chainsaw engine bridge.
//   * drives game.audio.chainsaw (real-time RPM-driven engine voice) through a tiny command API, feature-checked on every call so it
//     hot-switches when the audio module has it; falls back to the legacy sawStart / sawIdle / sawFull / sawHit one-shots + loops otherwise;
//   * runs a small LOCAL engine model (same states as the audio engine: 0 off, 1 cranking, 2 running, 3 stopping) so the viewmodel always has
//     an rpm / cord-pull / catch signal, and prefers the audio engine's own state (game.audio.chainsaw.state) whenever that is alive so what
//     you see is locked to what you hear.
//   * never leaves the engine running when the weapon isn't the current one (own commanded-on flag + a light watchdog for pause/menu).
import { clamp } from '../../core.js';

export const IDLE_RPM = 2800, FULL_RPM = 12300, CLUTCH_LO = 3700, CLUTCH_HI = 4700, CRANK_PEAK = 560;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class SawEngine {
  constructor(game, owner) {
    this.game = game; this.owner = owner;
    this.on = false;                        // commanded on (start() called, stop() not yet)
    // ---- local model
    this.lMode = 0; this.lRpm = 0; this.lVel = 0; this.lT = 0; this.lCrank = 0; this.lChoke = 0; this.lCatchT = 0.5; this.lP1 = 0.24; this.lG = 0.15; this.lP2 = 0.2;
    this.thrIn = 0; this.thr = 0; this.loadIn = 0; this.load = 0;
    // ---- outputs (read by the viewmodel)
    this.rpm = 0; this.mode = 0; this.pull = 0; this.caught = 0; this.fromAudio = false;
    // ---- audio bookkeeping
    this._sentThr = -1; this._sentLoad = -1; this._watched = null; this._dead = null; this._legacyLoop = null; this._legacyKind = null; this._wd = 0; this._lastBite = -9; this._stopAt = 0; this._aRpm = -1; this._aSame = 0; this.revBoost = 0;
    // pause (pointer lock lost) / tab hidden / window blur do not run the weapon update: check immediately instead of waiting for the watchdog tick
    this._evt = () => queueMicrotask(() => this._guard());
    if (typeof document !== 'undefined') { document.addEventListener('pointerlockchange', this._evt); document.addEventListener('visibilitychange', this._evt); window.addEventListener('blur', this._evt); }
  }

  // ---------------------------------------------------------------------------------------------------------------- audio access
  // game.audio.chainsaw (audio/chainsawBridge.js) is safe to call before its engine exists (it queues the start until the AudioContext + worklet are up) and
  // after dispose, so there is no readiness gating here; `ready` resolving false means the engine failed to build -> fall back to the legacy one-shots.
  get eng() {
    const c = this.game.audio?.chainsaw;
    if (!c || typeof c.start !== 'function' || c === this._dead) return null;
    if (this._watched !== c) {
      this._watched = c;
      try { const p = c.ready; if (p && typeof p.then === 'function') p.then((ok) => { if (ok === false && this._watched === c) this._dead = c; }, () => { if (this._watched === c) this._dead = c; }); } catch (e) { /* ignore */ }
    }
    return c;
  }
  _audio() { return this.eng; }
  _sendControls() {
    const e = this._audio(); if (!e) return;
    if (Math.abs(this.thrIn - this._sentThr) > 0.004) { this._sentThr = this.thrIn; e.setThrottle?.(this.thrIn); }
    if (Math.abs(this.loadIn - this._sentLoad) > 0.004) { this._sentLoad = this.loadIn; e.setLoad?.(this.loadIn); }
  }
  // warm the engine up (creates the worklet as soon as the AudioContext exists) so the first start() has no latency
  warm() { void this.eng; }

  // ---------------------------------------------------------------------------------------------------------------- commands
  start() {
    if (this.on) return; this.on = true;
    // local model
    if (this.lMode === 3) { const dts = (performance.now() - this._stopAt) / 1000; this.lRpm = Math.max(0, (this.lRpm + 118.75) * Math.exp(-3.2 * dts) - 118.75); if (this.lRpm < 60) { this.lMode = 0; this.lRpm = 0; } }   // the spin-down kept going while the weapon was not updating
    if (this.lMode === 3 && this.lRpm > 500) { this.lMode = 2; this.lChoke = 900; this.lVel = Math.max(this.lVel, 1500); this.caught = 1; }
    else if (this.lMode !== 1 && this.lMode !== 2) { this.lMode = 1; this.lT = 0; this.lCrank = 0; this.lRpm = 0; this.lVel = 0; this.lP1 = 0.22 + Math.random() * 0.05; this.lG = 0.15 + Math.random() * 0.05; this.lP2 = 0.18 + Math.random() * 0.03; this.lCatchT = this.lP1 + this.lG + 0.105 + Math.random() * 0.03; }
    // audio
    const e = this.eng;
    if (e) { e.start(); this._sentThr = -1; this._sentLoad = -1; this._sendControls(); }
    else this.game.audio?.play?.('sawStart');
    if (!this._wd) this._wd = setInterval(() => this._guard(), 250);
  }
  stop() {
    if (!this.on) return; this.on = false;
    if (this.lMode === 1 || this.lMode === 2) { this.lMode = 3; this._stopAt = performance.now(); }
    const e = this.eng; if (e) { e.setThrottle?.(0); e.setLoad?.(0); e.stop(); } this._sentThr = this._sentLoad = -1;
    this._killLegacy();
    if (this._wd) { clearInterval(this._wd); this._wd = 0; }
    this.thrIn = 0; this.loadIn = 0;
  }
  setThrottle(v) { this.thrIn = clamp(v, 0, 1); if (this.on) this._sendControls(); }
  setLoad(v) { this.loadIn = clamp(v, 0, 1); if (this.on) this._sendControls(); }
  rev(a = 1) { if (!this.on || this.lMode !== 2) return; const e = this._audio(); e?.rev?.(a); this.revBoost = a; }
  // one tooth-bite: kind 'flesh' | 'wood' | 'metal'
  bite(strength = 0.7, kind = 'flesh', pos) {
    if (!this.on) return; this.lVel -= 1100 * strength;
    const e = this._audio();
    if (e) e.bite?.(strength, kind);
    else if (!this.eng && this.game.time - this._lastBite > 0.09) { this._lastBite = this.game.time; this.game.audio?.play?.('sawHit', pos, { volume: 0.5 + 0.4 * strength }); }
  }
  // watchdog: pause / menu / death do not run the weapon update, so make sure the engine never keeps howling behind a menu
  _guard() {
    const g = this.game, w = this.owner;
    if (!(g.state === 'playing' && g.player?.alive && g.weapons?.current === w && w.selected && w.dir > 0)) this.stop();
  }
  _killLegacy() { if (this._legacyLoop) { try { this._legacyLoop.stop(0.12); } catch (e) { /* ignore */ } this._legacyLoop = null; this._legacyKind = null; } }

  // ---------------------------------------------------------------------------------------------------------------- per-frame
  update(dt) {
    dt = Math.min(dt, 0.05);
    // smoothed controls
    this.thr += (this.thrIn - this.thr) * (1 - Math.exp(-dt / 0.05)); this.load += (this.loadIn - this.load) * (1 - Math.exp(-dt / 0.07));
    // ---- local model
    if (this.lMode === 1) {
      const t = (this.lT += dt), p1 = this.lP1, g = this.lG, p2 = this.lP2; let pulling = false;
      for (let i = 0; i < 2; i++) {
        const a = i ? p1 + g : 0, b = i ? p1 + g + p2 : p1, peak = i ? 760 : 600;
        if (t >= a && t < b) { const u = (t - a) / (b - a), prof = Math.pow(u, 0.75) * (1 - 0.15 * sstep(0.8, 1, u)); pulling = true; this.lCrank += (peak * prof - this.lCrank) * (1 - Math.exp(-dt / 0.03)); }
      }
      if (!pulling) this.lCrank *= Math.exp(-dt / 0.11);
      this.lRpm = this.lCrank;
      if (t >= this.lCatchT) { this.lMode = 2; this.lRpm = Math.max(this.lCrank, 650); this.lVel = 2600; this.lChoke = 1900; this.lCrank = 0; }
    } else if (this.lMode === 3) {
      this._stopAt = performance.now();
      this.lRpm = Math.max(0, this.lRpm - (this.lRpm * 3.2 + 380) * dt); this.lVel *= Math.exp(-dt * 8);
      if (this.lRpm < 60) { this.lMode = 0; this.lRpm = 0; }
    } else if (this.lMode === 2) {
      this.lChoke *= Math.exp(-dt / 0.55); this.revBoost = Math.max(0, this.revBoost - dt * 2.6);
      const tgt = (IDLE_RPM + (FULL_RPM - IDLE_RPM) * Math.pow(Math.max(this.thr, this.revBoost), 1.5)) * (1 - 0.26 * this.load) + this.lChoke;
      const err = tgt - this.lRpm, up = err > 0, wn = 2 * Math.PI * (up ? 1.5 : 1.1), z = up ? 0.55 : 1.05;
      this.lVel += (wn * wn * err - 2 * z * wn * this.lVel) * dt; this.lRpm += this.lVel * dt;
      this.lRpm = clamp(this.lRpm, IDLE_RPM * 0.5, 14600); if (this.lRpm <= IDLE_RPM * 0.5 && this.lVel < 0) this.lVel = 0;
    }
    // ---- choose the source of truth: the audio engine's own state while it is alive and never BEHIND the local model (it lags by ~50 ms; the visuals must not
    //      regress from "running" back to "cranking" if its catch comes a little later), else the local model. A frozen rpm (suspended context) counts as dead.
    const e = this.eng, st = e ? e.state : null;
    let mode = this.lMode, rpm = this.lRpm, pullRpm = this.lCrank, useAudio = false;
    if (st && st.mode > 0 && st.rpm === st.rpm && st.mode >= this.lMode) {
      if (st.rpm === this._aRpm) this._aSame += dt; else { this._aSame = 0; this._aRpm = st.rpm; }
      useAudio = this._aSame < 0.5;
      if (useAudio) { mode = st.mode; rpm = st.rpm; pullRpm = mode === 1 ? st.rpm : 0; }
    } else this._aSame = 0;
    this.fromAudio = useAudio;
    const prev = this.mode; this.mode = mode;
    // smooth rpm a little (audio telemetry arrives ~20 Hz)
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * (useAudio ? 22 : 40));
    if (mode === 1) this.pull = clamp(pullRpm / CRANK_PEAK, 0, 1); else this.pull += (0 - this.pull) * Math.min(1, dt * 14);
    if ((prev === 1 || prev === 3) && mode === 2) this.caught = 1;
    // ---- legacy loops (only when the audio module has no real engine)
    if (!e) this._legacy();
  }
  _legacy() {
    const a = this.game.audio; if (!a?.loop) return;
    const kind = this.on && this.lMode === 2 ? (this.thrIn > 0.5 ? 'full' : 'idle') : null;
    if (kind === this._legacyKind) return;
    this._killLegacy(); this._legacyKind = kind;
    if (kind) this._legacyLoop = a.loop(kind === 'full' ? 'sawFull' : 'sawIdle', { volume: kind === 'full' ? 0.9 : 0.7 });
  }
  consumeCatch() { const c = this.caught; this.caught = 0; return c; }
  // chain speed in m/s: stationary below the clutch, ~24 m/s at full throttle
  get chainSpeed() { return sstep(CLUTCH_LO, CLUTCH_HI, this.rpm) * clamp(this.rpm / FULL_RPM, 0, 1.15) * 24; }
  get rpmN() { return clamp((this.rpm - 1500) / (FULL_RPM - 1500), 0, 1.2); }
  dispose() { this.stop(); if (typeof document !== 'undefined') { document.removeEventListener('pointerlockchange', this._evt); document.removeEventListener('visibilitychange', this._evt); window.removeEventListener('blur', this._evt); } }
}
