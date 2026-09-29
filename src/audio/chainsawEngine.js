// CHAINSAW ENGINE - a real-time, RPM-driven two-stroke chainsaw voice. AudioWorklet (embedded source, Blob URL) with ScriptProcessor and
// oscillator-graph fallbacks. No samples, no build step. Mono output (the game spatialises it).
//
//   const eng = await createChainsawEngine(ctx, destinationNode);          // eng.output (GainNode) is connected to destination
//   eng.start();  eng.setThrottle(1);  eng.setLoad(0.85);  eng.bite(0.8, 'flesh');  eng.rev();  eng.setDistance(0.3);  eng.stop();  eng.dispose();
//
// MODEL (all synthesised per sample from a few physical state variables; see makeCore):
//  * Controls: throttle 0..1 -> carb lag -> target rpm (idle ~2.8k, full ~12.3k). Load (cutting) sags the target 15-30 %. rpm follows the target
//    through a 2nd-order system: underdamped going up (rev-up overshoot to a ~13.5k racing peak), overdamped coming down. Each bite adds a short
//    load impulse plus a direct rpm kick (the bog of a tooth); load also drives growl (6-14 Hz wobble of rpm and level).
//  * The crank phase is integrated from rpm; one exhaust event per revolution (2-stroke). Every event has its own amplitude, pulse shape and timing
//    jitter. Combustion roughness grows at low rpm / high load / on decel. At idle the engine four-strokes: misfires accumulate unburnt fuel and the
//    next cycle bangs harder. Dropping the throttle from high revs adds burble and backfire pops.
//  * Exhaust pulse = fractional-sample-accurate 3-state exponential kernel (band-limited attack, per-cycle shape jitter) -> tuned-pipe feedback
//    comb -> parallel resonator bank: rpm-tracking bands (1.5x/3x/5x firing frequency) + fixed "tin can" muffler resonances -> muffler high cut ->
//    asymmetric soft saturation (harsh overdriven buzz) -> anti-alias one-pole. On top: combustion crack (noise burst per cycle), piston-slap tick,
//    compression chuffs on dud cycles, crank-locked intake hiss.
//  * The clutch engages at 3.7-4.7 krpm. Below it: clutch-shoe rattle. Above it the chain wakes up: link-rate pulse train (9.1x firing frequency,
//    ~1.9 kHz at full) ringing in bar/chain resonances with timing jitter, band-limited noise, loop-rate flutter and dropouts.
//  * Load adds gritty broadband cutting noise (cutter-tooth AM, chain drag rumble). bite(): pooled transient voices per kind - flesh (wet chunk +
//    thump), wood (crunch + knock + crackle), metal (ringing modes + sparks) - randomised per hit so 9 hits/s stays one continuous gnarly texture.
//  * start(): pull-cord ratchet + rope rasp + compression chuffs, 1-2 failed sputters, catch, choke fast-idle, settles to idle within ~1.4 s.
//    stop(): ignition dying with a last afterfire pop, spin-down with slowing compression chuffs.
//  * Output: DC block -> 2 x 55 Hz high-pass -> high cut -> soft limiter (ceiling 0.86 = -1.3 dBFS) -> [native LP + gain = setDistance] -> output.
//
// The DSP core is ONE plain function (makeCore) shared by the AudioWorklet (makeCore.toString() into a Blob URL), the ScriptProcessor fallback and
// Node tests (renderCore); do not run this file through a transpiler that injects helper references into function bodies.
// Main-thread control uses AudioParams only (sample-accurate scheduling, deterministic in OfflineAudioContext). The audio callback is allocation-free.

/* eslint-disable no-bitwise */
function makeCore() {
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // Pade tanh approximation, exactly +-1 at |x| >= 3
  const tanhf = (x) => { if (x > 3) return 1; if (x < -3) return -1; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); };

  const SAT0 = tanhf(0.3);

  // Zavalishin TPT state-variable filter: stable under fast coefficient modulation. bp is peak-normalised by k (unity gain at fc).
  class Svf {
    constructor() { this.ic1 = 0; this.ic2 = 0; this.a1 = 0; this.a2 = 0; this.a3 = 0; this.k = 1; this.rk = 1; this.bp = 0; this.lp = 0; this.hp = 0; }
    set(fc, q, sr) {
      fc = clamp(fc, 8, sr * 0.45);
      const g = Math.tan(Math.PI * fc / sr), k = 1 / q;
      this.k = k; this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
      this.rk = q * sr / (TAU * fc); // ring gain: feed an impulse of (amp * rk) to get a decaying sinusoid of peak ~amp
    }
    run(v0) {
      const v3 = v0 - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
      this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
      this.bp = v1 * this.k; this.lp = v2; this.hp = v0 - this.k * v1 - v2;
      return this.bp;
    }
    clear() { this.ic1 = 0; this.ic2 = 0; this.bp = 0; this.lp = 0; this.hp = 0; }
  }

  // transient voice (bite / pop / cough)
  class Voice {
    constructor() {
      this.on = false; this.age = 0; this.delay = 0; this.kind = 0; this.s = 0; this.j = 1; this.tau = 0.05; this.dur = 0.3; this.ph = 0; this.am = 0; this.amf = 0; this.a = 0;
      this.f1 = new Svf(); this.f2 = new Svf(); this.r1 = new Svf(); this.r2 = new Svf(); this.r3 = new Svf();
    }
  }

  const KIND_FLESH = 0, KIND_WOOD = 1, KIND_METAL = 2, KIND_POP = 3, KIND_COUGH = 4;

  class Core {
    constructor(sr, seed, tune) {
      this.sr = sr; this.dt = 1 / sr; this.cN = 16; this.cdt = this.cN / sr;
      // per-sample one-pole coefficients derived from time constants / corner frequencies, so the timbre is sample-rate independent
      const tc = (sec) => 1 - Math.exp(-1 / (sec * sr)), fcK = (hz) => 1 - Math.exp(-TAU * hz / sr);
      this.kCrackHi = Math.exp(-1 / (0.00036 * sr)); this.kCrackLo = Math.exp(-1 / (0.00063 * sr)); this.kPuff = Math.exp(-1 / (0.009 * sr));
      this.kGate = tc(0.0057); this.kGrit = tc(0.00113); this.kComb = fcK(5500); this.kLpO = fcK(6900);
      this.rs = (((seed || 1) * 2654435761) >>> 0) || 1;
      // tuning knobs (all multiplicative unless noted); can be changed at runtime with tune()
      this.T = { idle: 2800, full: 12300, sag: 1, rough: 1, exhaust: 1, chain: 1, grit: 1, bite: 1, hiss: 1, tick: 1, growl: 1, out: 1, drive: 1, crack: 1 };
      if (tune) this.tune(tune);
      // ---- control state
      this.thrIn = 0; this.loadIn = 0; this.thrC = 0; this.load = 0; this.biteL = 0; this.blipT = -1; this.blipAmp = 0; this.thrHi = 0; this.popCool = 0;
      this.decel = 0; this.startRough = 0; this.choke = 0; this.stopT = 0; this.tail = 0; this.popT = 0;
      this.thumpImp = 0; this.tickImp = 0; this.rattleKick = 0; this.chainAmp = 0; this.gritAmp = 0; this.crackG = 0.3; this.lvl = 0.5; this.lvlE = 0.7; this.tinG = 0.6; this.drive = 1.5; this.hissG = 0.01; this.tickHold = 0; this.thumpHold = 0; this.ratHold = 0; this.ringHold = Math.round(0.012 * sr); this.chainOn = false; this.gritOn = false; this.rewPh = 0; this.linkRate = 1000; this.loopRate = 20;
      this.mode = 0; // 0 off, 1 cranking, 2 running, 3 stopping
      this.rpm = 0; this.rvel = 0; this.phase = 0; this.f = 0; this.per = 0.02; this.popT = 0;
      this.ctr = 0; this.time = 0;
      // ---- combustion
      this.fuel = 0; this.pMis = 0.2; this.rough = 0.3; this.pw = 0.4; this.stopFireP = 0; this.forceFire = 0;
      // ---- exhaust kernel
      this.yL = 0; this.yS = 0; this.yA = 0; this.aL = 0.99; this.aS = 0.98; this.aA = 0.6; this.tauL = 0.005; this.tauS = 0.002; this.tauA = 0.00004;
      this.dlMask = 4095; this.dl = new Float32Array(4096); this.wi = 0; this.D = Math.max(8, Math.round(0.00112 * sr)); this.cLp = 0; this.gfb = 0.4;
      this.bank = { lp: new Svf(), r1: new Svf(), r2: new Svf(), r3: new Svf(), t1: new Svf(), t2: new Svf(), t3: new Svf() };
      this.crackE = 0; this.crackF = new Svf(); this.crackF.set(1500, 0.8, sr);
      this.tickF1 = new Svf(); this.tickF1.set(1900, 9, sr); this.tickF2 = new Svf(); this.tickF2.set(3300, 10, sr);
      this.thumpF = new Svf(); this.thumpF.set(82, 2.4, sr); this.puffE = 0; this.puffF = new Svf(); this.puffF.set(650, 0.7, sr);
      this.hissF = new Svf(); this.hissF.set(2300, 0.7, sr);
      // ---- chain / clutch / load
      this.cph = 0; this.chainR1 = new Svf(); this.chainR1.set(2450, 7, sr); this.chainR2 = new Svf(); this.chainR2.set(4100, 9, sr); this.chainR3 = new Svf(); this.chainR3.set(1250, 5, sr);
      this.chainN = new Svf(); this.chainN.set(2400, 1.1, sr);
      this.loopPh = 0; this.gate = 1; this.gateT = 1;
      this.clutchF = 0; this.rattleF1 = new Svf(); this.rattleF1.set(2650, 8, sr); this.rattleF2 = new Svf(); this.rattleF2.set(1350, 6, sr);
      this.gritA = new Svf(); this.gritA.set(950, 0.9, sr); this.gritB = new Svf(); this.gritB.set(3300, 0.7, sr); this.gritC = new Svf(); this.gritC.set(4200, 0.6, sr);
      this.gritLp = 0; this.cutPh = 0; this.dragF = new Svf(); this.dragF.set(160, 0.8, sr);
      // ---- wobble / growl
      this.wp1 = 0; this.wp2 = 0; this.wn = 0; this.wob = 0; this.wd1 = 0; this.wd2 = 0; this.hunt = 0; this.vLp = 0;
      // ---- starter
      this.seq = { pulls: new Float64Array(6), coughs: new Float64Array(4), nc: 0, ci: 0, catchT: 0.6 }; this.startT = 0; this.crankRpm = 0; this.pullSpd = 0; this.clickPh = 0; this.clickRate = 40; this.rewind = 0;
      this.ratF1 = new Svf(); this.ratF1.set(2300, 4.5, sr); this.ratF2 = new Svf(); this.ratF2.set(3700, 8, sr); this.ratF3 = new Svf(); this.ratF3.set(780, 6, sr);
      this.ropeF = new Svf(); this.ropeF.set(1500, 0.9, sr); this.rewF = new Svf(); this.rewF.set(1800, 1.6, sr);
      // ---- transient voices
      this.voices = []; for (let i = 0; i < 8; i++) this.voices.push(new Voice());
      this.vi = 0; this.nVox = 0; this.pops = new Float32Array(8); this.nPops = 0; this.probe = false; this.pe = new Float64Array(12);
      // ---- output stage
      this.m1 = 0; this.m2 = 0; this.p1 = 0; this.mK = 0.3; this.pK = 0.6; this.dcIn = 0; this.dcOut = 0; this.lpO = 0; this.hp2a = 0; this.hp2b = 0; this.hp3a = 0; this.hp3b = 0;
      this.svfs = [...Object.values(this.bank), this.crackF, this.tickF1, this.tickF2, this.thumpF, this.puffF, this.hissF, this.chainR1, this.chainR2, this.chainR3, this.chainN,
        this.rattleF1, this.rattleF2, this.gritA, this.gritB, this.gritC, this.dragF, this.ratF1, this.ratF2, this.ratF3, this.ropeF, this.rewF];
      for (const v of this.voices) this.svfs.push(v.f1, v.f2, v.r1, v.r2, v.r3);
      this.bankFc = { lp: 200, r1: 100, r2: 200, r3: 400 };
      this._control(); // prime coefficients
    }

    tune(o) {
      const lim = { idle: [1200, 5000], full: [6000, 16000] };
      for (const k in o) if (k in this.T && Number.isFinite(+o[k])) this.T[k] = lim[k] ? clamp(+o[k], lim[k][0], lim[k][1]) : clamp(+o[k], 0, 8);
    }
    rnd() { let s = this.rs; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.rs = s; return (s >>> 0) / 4294967296; }
    nz() { let s = this.rs; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.rs = s; return s / 2147483648; }

    get active() { return this.mode !== 0 || this.tail > 0; }
    snapshot() { return { rpm: this.rpm, hz: this.f, throttle: this.thrC, load: this.load, mode: this.mode, fuel: this.fuel, pMis: this.pMis, rough: this.rough, clutch: this.clutchF, time: this.time }; }

    // ------------------------------------------------------------------ public triggers
    setControls(thr, load) { this.thrIn = clamp(thr, 0, 1); this.loadIn = clamp(load, 0, 1); }
    start() {
      if (this.mode === 2 || this.mode === 1) return;
      if (this.mode === 3 && this.rpm > 500) { // restart while still spinning down: re-catch on the fly (no pull cord)
        this.mode = 2; this.startRough = 1; this.fuel = 0.6; this.choke = 900; this.rvel = Math.max(this.rvel, 1500); this.forceFire = 0.9; return;
      }
      const s = this.seq, p1 = 0.22 + 0.05 * this.rnd(), g = 0.15 + 0.05 * this.rnd(), p2 = 0.18 + 0.03 * this.rnd();
      // seq layout (preallocated): pulls[i*3..] = start, end, peak crank rpm; coughs[i*2..] = time, strength
      s.pulls[0] = 0; s.pulls[1] = p1; s.pulls[2] = 560 + 120 * this.rnd(); s.pulls[3] = p1 + g; s.pulls[4] = p1 + g + p2; s.pulls[5] = 700 + 120 * this.rnd();
      s.coughs[0] = p1 - 0.035 + 0.02 * this.rnd(); s.coughs[1] = 0.7; s.nc = 1;
      if (this.rnd() < 0.6) { s.coughs[2] = p1 + 0.03 + 0.03 * this.rnd(); s.coughs[3] = 0.5; s.nc = 2; }
      s.catchT = p1 + g + 0.105 + 0.03 * this.rnd();
      this.dl.fill(0); this.cLp = 0; this.m1 = this.m2 = this.p1 = this.vLp = 0; this.dcIn = this.dcOut = this.hp2a = this.hp2b = this.hp3a = this.hp3b = this.lpO = 0; // no stale audio from the last run
      s.ci = 0; this.startT = 0; this.mode = 1; this.crankRpm = 0; this.rpm = 0; this.rvel = 0; this.tail = 1.2; this.fuel = 0; this.choke = 0; this.startRough = 0;
      this.stopT = 0; this.loopPh = 0; this.pullSpd = 0;
    }
    stop() {
      if (this.mode === 0 || this.mode === 3) return;
      if (this.mode === 1) { this.mode = 3; this.stopT = 0; this.stopFireP = 0; return; }
      this.mode = 3; this.stopT = 0; this.stopFireP = 0.85; this.nPops = 0;
      this.startVoice(KIND_POP, 0.9, 0.12 + 0.1 * this.rnd()); // last pop (afterfire in the muffler)
    }
    rev(amount) { if (this.mode !== 2) return; this.blipT = 0; this.blipAmp = clamp(amount == null ? 1 : amount, 0, 1) * 0.97; }
    bite(str, kind) {
      if (this.mode !== 2) return;
      str = clamp(str, 0, 1);
      const k = kind === 2 || kind === 'metal' ? KIND_METAL : kind === 1 || kind === 'wood' ? KIND_WOOD : KIND_FLESH;
      this.startVoice(k, str, this.rnd() * 0.016); // 0-16 ms humanising delay so a fixed 9 Hz caller cadence never phase-locks
      const kickK = k === KIND_METAL ? 1.5 : k === KIND_WOOD ? 1.1 : 0.9;
      this.biteL = Math.min(1.2, this.biteL + (0.15 + 0.35 * str) * kickK * this.T.bite);
      this.rvel -= (1800 + 6500 * str) * kickK * this.T.bite * (0.3 + 0.7 * clamp(this.thrC * 1.4, 0, 1));
    }

    startVoice(kind, str, delaySec) {
      let v = null;
      for (let i = 0; i < this.voices.length; i++) { const c = this.voices[(this.vi + i) % this.voices.length]; if (!c.on) { v = c; this.vi = (this.vi + i + 1) % this.voices.length; break; } }
      if (!v) { v = this.voices[this.vi]; this.vi = (this.vi + 1) % this.voices.length; } // steal oldest
      const sr = this.sr;
      if (!v.on) this.nVox++;
      v.on = true; v.age = 0; v.delay = Math.max(0, Math.round((delaySec || 0) * sr)); v.kind = kind; v.s = str; v.ph = this.rnd() * TAU; v.j = 0.86 + 0.34 * this.rnd();
      v.a = 0.75 + 0.25 * this.rnd(); v.am = this.rnd() * TAU; v.amf = 45 + 35 * this.rnd();
      v.f1.clear(); v.f2.clear(); v.r1.clear(); v.r2.clear(); v.r3.clear();
      const j = v.j;
      if (kind === KIND_FLESH) { v.tau = 0.045 * (0.8 + 0.5 * this.rnd()); v.dur = 0.3; v.f1.set(900 * j, 1.3, sr); v.f2.set(2400 * j, 0.9, sr); v.r1.set(2100 * j, 12, sr); v.r2.set(1000 * j, 4, sr); }
      else if (kind === KIND_WOOD) { v.tau = 0.06 * (0.8 + 0.5 * this.rnd()); v.dur = 0.28; v.f1.set(2000 * j, 0.9, sr); v.f2.set(3400, 0.7, sr); v.r1.set(1700 * j, 12, sr); v.r2.set(2700 * j, 10, sr); v.r3.set(420 * j, 3, sr); }
      else if (kind === KIND_METAL) { v.tau = 0.04 * (0.8 + 0.5 * this.rnd()); v.dur = 0.36; v.f1.set(1100 * j, 3, sr); v.f2.set(4000, 0.8, sr); v.r1.set(2750 * j, 300, sr); v.r2.set(4310 * j, 260, sr); v.r3.set(6480 * j, 200, sr); }
      else if (kind === KIND_POP) { v.tau = 0.014; v.dur = 0.22; v.f1.set(1300, 0.7, sr); v.f2.set(95, 1.0, sr); v.r1.set(150 * j, 4, sr); v.r2.set(760 * j, 7, sr); v.r3.set(1500 * j, 9, sr); }
      else { v.tau = 0.02; v.dur = 0.2; v.f1.set(900, 0.8, sr); v.f2.set(90, 1.0, sr); v.r1.set(190 * j, 3, sr); v.r2.set(600 * j, 5, sr); v.r3.set(1200 * j, 7, sr); }
    }

    // ------------------------------------------------------------------ control-rate update (every cN samples)
    _control() {
      const cdt = this.cdt, T = this.T, sr = this.sr;
      this.time += cdt;
      // --- effective throttle (blip)
      let thrT = this.thrIn;
      if (this.blipT >= 0) {
        this.blipT += cdt; const u = this.blipT;
        const lev = u < 0.08 ? u / 0.08 : u < 0.15 ? 1 : Math.max(0, 1 - (u - 0.15) / 0.2);
        thrT = Math.max(thrT, lev * this.blipAmp); if (u > 0.4) this.blipT = -1;
      }
      // --- backfire / burble on throttle drop
      this.thrHi = Math.max(thrT, this.thrHi - cdt * 2.2); this.popCool -= cdt;
      if (this.mode === 2 && this.thrHi - thrT > 0.42 && this.popCool <= 0 && this.rpm > 5200) {
        this.popCool = 0.9; this.decel = clamp((this.rpm - 3800) / 7000, 0.35, 1);
        const n = (this.thrHi - thrT > 0.6 && this.rnd() < 0.85) ? 1 + ((this.rnd() * 3) | 0) : (this.rnd() < 0.5 ? 1 : 0);
        this.nPops = n; for (let i = 0; i < n; i++) this.pops[i] = 0.07 + 0.55 * this.rnd() + 0.08 * i;
        for (let i = 1; i < n; i++) { const x = this.pops[i]; let j = i - 1; while (j >= 0 && this.pops[j] > x) { this.pops[j + 1] = this.pops[j]; j--; } this.pops[j + 1] = x; } // insertion sort (n <= 3)
        this.popT = 0;
      }
      if (this.nPops > 0) {
        this.popT += cdt;
        for (let i = 0; i < this.nPops; i++) if (this.popT >= this.pops[i]) { this.pops[i] = 1e9; this.startVoice(KIND_POP, 0.55 + 0.45 * this.rnd(), 0); this.fuel = Math.min(1.5, this.fuel + 0.6); }
        let alive = 0; for (let i = 0; i < this.nPops; i++) if (this.pops[i] < 1e8) alive++;
        if (!alive) this.nPops = 0;
      }
      this.decel *= Math.exp(-cdt / 0.5);
      this.startRough *= Math.exp(-cdt / 0.4);
      // --- carb lag and load smoothing
      this.thrC += (thrT - this.thrC) * (1 - Math.exp(-cdt / (thrT > this.thrC ? 0.045 : 0.1)));
      this.load += (this.loadIn - this.load) * (1 - Math.exp(-cdt / 0.05));
      this.biteL *= Math.exp(-cdt / 0.085);
      const thc = this.thrC, L = clamp(this.load + this.biteL, 0, 1.3);
      // --- wobble / growl (6-14 Hz, wandering)
      this.wd1 += (this.rnd() - 0.5) * cdt * 6; this.wd1 *= 1 - cdt * 1.2; this.wd2 += (this.rnd() - 0.5) * cdt * 8; this.wd2 *= 1 - cdt * 1.2;
      this.wp1 += TAU * (7.4 + this.wd1) * cdt; this.wp2 += TAU * (11.6 + this.wd2) * cdt;
      this.wn += (this.nz() - this.wn) * (1 - Math.exp(-cdt * TAU * 9));
      this.hunt += (this.nz() * 8 - this.hunt) * (1 - Math.exp(-cdt * TAU * 1.5)); // slow idle 'hunting' of the carb (+-2 % rpm wander at idle)
      this.wob = 0.55 * Math.sin(this.wp1) + 0.35 * Math.sin(this.wp2) + 0.9 * this.wn;
      // --- rpm dynamics
      if (this.mode === 1) {
        this._starter(cdt);
      } else if (this.mode === 3) {
        this.stopT += cdt; this.stopFireP = Math.max(0, 0.85 * (1 - this.stopT / 0.26));
        this.rpm = Math.max(0, this.rpm - (this.rpm * 3.2 + 380) * cdt); this.rvel *= Math.exp(-cdt * 8);
        if (this.rpm < 60) { this.mode = 0; this.tail = 0.5; this.rpm = 0; }
      } else if (this.mode === 2) {
        this.choke *= Math.exp(-cdt / 0.17);
        const base = T.idle + (T.full - T.idle) * Math.pow(thc, 1.5) + this.choke;
        const sag = (0.09 + 0.15 * thc) * T.sag * clamp(this.load + 0.35 * this.biteL, 0, 1.3);
        let tgt = base * (1 - sag);
        tgt *= 1 + (0.03 * L * T.growl + 0.006 * thc) * this.wob + 0.02 * (1 - thc) * clamp(this.hunt, -2.5, 2.5);
        tgt = Math.max(tgt, T.idle * 0.62);
        const err = tgt - this.rpm, up = err > 0;
        const wn = TAU * (up ? 1.55 : 1.1), z = up ? 0.5 : 1.05;
        this.rvel += (wn * wn * err - 2 * z * wn * this.rvel) * cdt;
        this.rpm += this.rvel * cdt;
        if (this.rpm < T.idle * 0.5) { this.rpm = T.idle * 0.5; if (this.rvel < 0) this.rvel = 0; }
        if (this.rpm > 14600) { this.rpm = 14600; if (this.rvel > 0) this.rvel = 0; }
      } else if (this.tail > 0) this.tail -= cdt;
      if (this.mode === 0 && this.tail <= 0 && this.nPops === 0) { this.f = 0; return; }
      const rpm = this.rpm, f = Math.max(rpm, 1) / 60; this.f = f; this.per = 1 / f;
      // --- combustion statistics
      const lowRpm = 1 - sstep(3200, 7200, rpm), lowThr = 1 - sstep(0.12, 0.6, thc);
      const Lc = clamp(L, 0, 1), mode2 = this.mode === 2;
      this.pMis = clamp(0.15 * lowRpm * lowThr + 0.05 * lowRpm + 0.05 * Lc + 0.5 * this.decel + 0.4 * this.startRough, 0, 0.75);
      this.rough = clamp(T.rough * (0.11 + 0.5 * lowRpm + 0.35 * Lc + 0.6 * this.decel + 0.5 * this.startRough), 0, 1.3);
      this.pw = 0.3 + 0.5 * Math.pow(thc, 0.7) + 0.3 * Lc;
      // --- exhaust kernel time constants (scale with period: smoother/sinusoidal at high rpm, sharp puffs at idle)
      const per = this.per;
      this.tauL = Math.max(0.0006, 0.26 * per); this.tauS = Math.max(0.00025, 0.085 * per);
      this.aL = Math.exp(-this.dt / this.tauL); this.aS = Math.exp(-this.dt / this.tauS); this.aA = Math.exp(-this.dt / this.tauA);
      this.drive = (1.0 + 1.3 * thc + 0.5 * Lc) * T.drive; this.hissG = mode2 ? T.hiss * (0.008 + 0.035 * Math.pow(thc, 1.3)) : 0;
      const lx = Math.pow(clamp(rpm / 12300, 0, 1.1), 1.3);
      this.tinG = 0.55 + 0.45 * lx; this.lvl = 0.5 + 0.5 * lx; this.lvlE = 0.66 + 0.34 * lx; // loudness ladder: mechanical noise follows rpm strongly, exhaust less so
      this.gfb = 0.32 + 0.16 * thc; this.crackG = 0.15 + 0.6 * lowRpm;
      this.mK = 1 - Math.exp(-TAU * (3300 + 1300 * clamp(rpm / 12500, 0, 1)) * this.dt); this.pK = 1 - Math.exp(-TAU * 6500 * this.dt);
      // --- resonator bank (tracking + fixed muffler)
      const B = this.bank, bf = this.bankFc;
      bf.lp += (clamp(2.2 * f, 90, 520) - bf.lp) * 0.35; bf.r1 += (clamp(1.5 * f, 70, 380) - bf.r1) * 0.35; bf.r2 += (clamp(3.1 * f, 220, 1100) - bf.r2) * 0.35; bf.r3 += (clamp(5.3 * f, 420, 2300) - bf.r3) * 0.35;
      B.lp.set(bf.lp, 0.7, sr); B.r1.set(bf.r1, 1.3, sr); B.r2.set(bf.r2, 1.7, sr); B.r3.set(bf.r3, 2.2, sr);
      B.t1.set(1160, 4.5, sr); B.t2.set(1790, 5.5, sr); B.t3.set(3000, 2.5, sr);
      this.crackF.set(1500 + 900 * thc, 0.9, sr);
      // --- clutch / chain
      const clutch = sstep(3700, 4700, rpm);
      if (mode2 && this.clutchF < 0.5 && clutch >= 0.5) this.rattleKick = 3; // clutch shoes bite the drum: one metallic clunk
      this.clutchF = clutch;
      this.chainAmp = T.chain * clutch * Math.pow(clamp(rpm / 12500, 0, 1.15), 1.7) * (1 + 0.25 * Lc);
      this.linkRate = 9.1 * f; this.loopRate = clamp(this.linkRate / 46, 8, 60);
      this.chainR1.set(2450 + 500 * clutch * rpm / 12500, 7, sr);
      this.chainN.set(2300 + 1200 * clamp(rpm / 12500, 0, 1.1), 1.1, sr);
      // --- load grit
      this.gritAmp = T.grit * 0.31 * (0.25 + 0.75 * clamp(thc * 1.3, 0, 1)) * Lc;
      this.gritA.set(520 + 420 * clamp(rpm / 12500, 0, 1), 0.9, sr);
      this.gritB.set(1700 + 700 * clamp(rpm / 12500, 0, 1), 0.7, sr);
      // --- denormal guard for slowly decaying control variables
      if (this.biteL < 1e-6) this.biteL = 0; if (this.choke < 1e-3) this.choke = 0; if (this.decel < 1e-5) this.decel = 0; if (this.startRough < 1e-5) this.startRough = 0;
      if (this.rewind < 1e-5) this.rewind = 0; if (this.crankRpm < 1e-3) this.crankRpm = 0;
    }

    // pull-cord starter sequence (mode 1)
    _starter(cdt) {
      const s = this.seq, t = (this.startT += cdt);
      let pulling = false, spd = 0;
      for (let i = 0; i < 6; i += 3) {
        const p0 = s.pulls[i], p1 = s.pulls[i + 1];
        if (t >= p0 && t < p1) {
          const u = (t - p0) / (p1 - p0); pulling = true;
          const prof = Math.pow(u, 0.75) * (1 - 0.15 * sstep(0.8, 1, u)); spd = prof;
          this.crankRpm += (s.pulls[i + 2] * prof - this.crankRpm) * (1 - Math.exp(-cdt / 0.03));
          this.clickRate = 38 + 85 * Math.pow(u, 1.2);
        } else if (t >= p1 && t < p1 + cdt) { this.rewind = 1; }
      }
      if (!pulling) this.crankRpm *= Math.exp(-cdt / 0.11);
      this.pullSpd += (spd - this.pullSpd) * (1 - Math.exp(-cdt / 0.012));
      this.rewind *= Math.exp(-cdt / 0.14);
      this.rpm = this.crankRpm; this.rvel = 0;
      if (s.ci < s.nc && t >= s.coughs[s.ci * 2]) { this.forceFire = s.coughs[s.ci * 2 + 1]; s.ci++; }
      if (t >= s.catchT) {
        // engine catches: fast idle overshoot, first cycles stutter
        this.mode = 2; this.rpm = Math.max(this.crankRpm, 650); this.rvel = 2600; this.choke = 1900; this.startRough = 1; this.fuel = 0.6; this.decel = 0; this.pullSpd = 0;
        this.forceFire = 1.1;
      }
    }

    // ------------------------------------------------------------------ one exhaust/crank event per revolution
    _cycle(d) {
      const mode = this.mode;
      let fired, amp; const rough = this.rough;
      if (mode === 1) fired = false;
      else if (mode === 3) fired = this.rnd() < this.stopFireP;
      else fired = this.rnd() >= this.pMis;
      const pw = mode === 1 ? 0.3 : this.pw;
      if (fired) {
        amp = pw * (1 + this.fuel * 0.9) * (1 + rough * 0.4 * (2 * this.rnd() - 1)) * (0.94 + 0.12 * this.rnd());
        this.fuel *= 0.22;
      } else {
        amp = pw * (mode === 1 ? 0.35 : 0.1 + 0.16 * this.rnd());
        if (mode === 2) this.fuel = Math.min(1.6, this.fuel + 0.45 + 0.4 * this.rnd());
        // compression chuff of a dud cycle
        this.thumpImp = (mode === 2 ? 0.08 : 0.3) * clamp(0.5 + this.rpm / 3000, 0.5, 1.2) * (0.7 + 0.5 * this.rnd());
        this.puffE += mode === 2 ? 0.25 : 1.0;
      }
      this._exhaust(d, amp, clamp(0.5 + rough * 0.35 * (2 * this.rnd() - 1), 0.1, 0.9));
      this.crackE += amp * (fired ? 1 : 0.12) * (0.65 + 0.7 * this.rnd());
      // piston slap tick every revolution
      const tk = this.T.tick * (0.05 + 0.075 * (fired ? 1 : 0.3)) * (0.7 + 0.6 * this.rnd()) * (1 - 0.6 * sstep(4000, 11000, this.rpm));
      this.tickImp = tk * (mode === 1 ? 0.4 : 1);
      // timing jitter (rough cycles wander)
      this.phase += (this.rnd() - 0.5) * 0.07 * rough;
      if (this.phase < 0) this.phase += 1;
    }
    _exhaust(d, A, m) {
      const dt = this.dt; A *= this.T.exhaust;
      this.yL += A * m * Math.exp(-d * dt / this.tauL); this.yS += A * (1 - m) * Math.exp(-d * dt / this.tauS); this.yA += A * Math.exp(-d * dt / this.tauA);
    }

    // ------------------------------------------------------------------ transient voices (bites, pops, coughs)
    _voices() {
      let sum = 0; const dt = this.dt;
      for (let vi = 0; vi < this.voices.length; vi++) {
        const v = this.voices[vi]; if (!v.on) continue;
        if (v.delay > 0) { v.delay--; continue; }
        const age = v.age, t = age * dt, s = v.s, kind = v.kind, j = v.j; let o = 0;
        const att = 1 - Math.exp(-t / 0.0012), env = att * Math.exp(-t / v.tau), n = this.nz();
        if (kind === KIND_FLESH) {
          if ((age & 15) === 0) v.f1.set((520 + 1500 * Math.exp(-t / 0.028)) * j, 1.3, this.sr);
          const gurgle = 0.6 + 0.4 * Math.sin(v.am + TAU * v.amf * t);
          const body = v.f1.run(n) * env * gurgle * 1.5;
          const wet = v.f2.run(n) * Math.exp(-t / 0.012) * 0.45;
          v.ph += TAU * (68 + 62 * Math.exp(-t / 0.04)) * j * dt;
          const thump = Math.sin(v.ph) * Math.exp(-t / 0.03) * 1.25 * att;
          if (age === 0) { v.r1.run(0.18 * s * v.r1.rk); v.r2.run(0.28 * s * v.r2.rk); } else { v.r1.run(0); v.r2.run(0); }
          o = s * (0.55 + 0.45 * v.a) * (body + wet + thump) + v.r1.bp + v.r2.bp;
        } else if (kind === KIND_WOOD) {
          if ((age & 15) === 0) v.f1.set((950 + 1900 * Math.exp(-t / 0.05)) * j, 0.9, this.sr);
          const body = v.f1.run(n) * env * 1.9;
          const rasp = v.f2.run(n) * Math.exp(-t / 0.02) * 0.45;
          v.ph += TAU * (180 + 130 * Math.exp(-t / 0.03)) * j * dt;
          const knock = Math.sin(v.ph) * Math.exp(-t / 0.022) * 0.7 * att;
          if (age === 0) v.r1.run(0.32 * s * v.r1.rk); else v.r1.run(0);
          let crk = 0; if (Math.abs(n) > 0.9992 - 0.0006 * Math.exp(-t / 0.05)) crk = 0.9 * (0.4 + 0.6 * Math.abs(this.nz()));
          v.r2.run(crk * s * 0.28 * v.r2.rk); v.r3.run(0);
          o = s * (0.55 + 0.45 * v.a) * (body + rasp + knock) + v.r1.bp + v.r2.bp;
        } else if (kind === KIND_METAL) {
          if (age === 0) { v.r1.run(0.55 * s * v.r1.rk); v.r2.run(0.4 * s * v.r2.rk); v.r3.run(0.28 * s * v.r3.rk); } else { v.r1.run(0); v.r2.run(0); v.r3.run(0); }
          const rings = v.r1.bp + v.r2.bp + v.r3.bp;
          const sparks = v.f2.run(n) * Math.exp(-t / 0.028) * 0.5;
          if ((age & 15) === 0) v.f1.set((1500 * Math.exp(-t / 0.05) + 900) * j, 3, this.sr);
          const grind = v.f1.run(n) * env * 0.9;
          v.ph += TAU * (120 * j) * dt;
          const buzz = Math.sin(v.ph) * Math.exp(-t / 0.05) * 0.4;
          o = s * (0.55 + 0.45 * v.a) * (sparks + grind + buzz) + rings * (0.6 + 0.4 * v.a);
        } else {
          // backfire pop / weak sputter: low boom + resonant crack + noise puff
          const pop = kind === KIND_POP;
          if (age === 0) { v.r1.run(0.45 * s * v.r1.rk); v.r2.run(0.3 * s * v.r2.rk); v.r3.run(0.2 * s * v.r3.rk); } else { v.r1.run(0); v.r2.run(0); v.r3.run(0); }
          const crack = v.f1.run(n) * Math.exp(-t / (pop ? 0.011 : 0.018)) * (pop ? 1.0 : 0.6);
          const boom = v.f2.run(n) * Math.exp(-t / 0.03) * 1.6 + Math.sin((v.ph += TAU * 78 * dt)) * Math.exp(-t / 0.035) * 0.9;
          o = s * (crack * 1.1 + boom * (pop ? 0.9 : 0.7)) + (v.r1.bp + v.r2.bp + v.r3.bp) * (pop ? 0.9 : 0.7);
        }
        sum += o; v.age++;
        if (t > v.dur) { v.on = false; this.nVox--; }
      }
      this.vLp += 0.6 * (sum - this.vLp); // tame voice sparkle (~8 kHz corner)
      return this.vLp;
    }

    // ------------------------------------------------------------------ audio-rate render
    process(out, n, off) {
      off = off || 0;
      if (this.mode === 0 && this.tail <= 0 && this.nPops === 0 && this.nVox === 0) {
        for (let i = 0; i < n; i++) out[off + i] = 0;
        this.time += n * this.dt; this.ctr = 0; this.yL = this.yS = this.yA = 0;
        return;
      }
      const dt = this.dt, sr = this.sr, T = this.T, B = this.bank, probe = this.probe, pe = this.pe, hpc = 1 - 2 * Math.PI * 16 / sr, hp2 = 1 - 2 * Math.PI * 55 / sr;
      let chk = 0;
      for (let i = 0; i < n; i++) {
        if ((this.ctr++ % this.cN) === 0) this._control();
        const f = this.f, thc = this.thrC, rpm = this.rpm, mode = this.mode;
        // ---- crank phase -> one cycle event per revolution
        if (f > 0) {
          this.phase += f * dt;
          if (this.phase >= 1) { this.phase -= 1; this._cycle(clamp(this.phase / (f * dt), 0, 1)); }
        }
        if (this.forceFire > 0) { const a = this.forceFire; this.forceFire = 0; this._exhaust(0.5, 0.5 * a, 0.4); this.crackE += 0.7 * a; this.startVoice(KIND_COUGH, 0.55 * a, 0); }
        // ---- exhaust excitation -> tuned-pipe feedback comb (fixed muffler geometry)
        this.yL *= this.aL; this.yS *= this.aS; this.yA *= this.aA;
        const dl = this.dl, rd = (this.wi - this.D) & this.dlMask;
        this.cLp += this.kComb * (dl[rd] - this.cLp);
        const c = this.yL + this.yS - this.yA + this.gfb * this.cLp; dl[this.wi] = c; this.wi = (this.wi + 1) & this.dlMask;
        // ---- resonator bank: rpm-tracking bands + fixed tin-can pair
        B.lp.run(c); B.r1.run(c); B.r2.run(c); B.r3.run(c); B.t1.run(c); B.t2.run(c); B.t3.run(c);
        let eng = 0.5 * B.lp.lp + 0.55 * B.r1.bp + 0.8 * B.r2.bp + 0.85 * B.r3.bp + this.tinG * (0.75 * B.t1.bp + 0.55 * B.t2.bp + 0.3 * B.t3.bp) + 0.1 * c;
        this.m1 += this.mK * (eng - this.m1); this.m2 += this.mK * (this.m1 - this.m2); eng = this.m2; // muffler high cut
        const L = clamp(this.load + this.biteL, 0, 1.3), wob = this.wob;
        eng *= 1 + 0.30 * T.growl * L * wob; // growl AM under load
        // drive / saturation (asymmetric -> even harmonics, harsh small-engine buzz), then anti-alias one-pole
        const drive = this.drive;
        let sat = tanhf(eng * drive * 1.6 + 0.3) - SAT0;
        this.p1 += this.pK * (sat - this.p1); sat = this.p1;
        const cExh = sat * 0.55 / (1 + 0.35 * drive) * this.lvlE;
        // ---- combustion crack (noise burst per cycle), piston slap tick, compression chuffs
        let cCrack = 0, cTick = 0, cThump = 0, cPuff = 0;
        if (this.crackE > 1e-5) { this.crackE *= (rpm > 8000 ? this.kCrackHi : this.kCrackLo); this.crackF.run(this.nz()); cCrack = this.crackF.bp * this.crackE * this.crackG * T.crack * this.lvl; }
        if (this.tickImp !== 0 || this.tickHold > 0) {
          if (this.tickImp !== 0) { this.tickHold = this.ringHold; }
          if (this.tickImp !== 0) { this.tickF1.set(1900 * (0.86 + 0.28 * this.rnd()), 9, sr); this.tickF2.set(3300 * (0.88 + 0.24 * this.rnd()), 10, sr); }
          const tk = this.tickImp; this.tickImp = 0; this.tickF1.run(tk * this.tickF1.rk); this.tickF2.run(tk * 0.6 * this.tickF2.rk);
          cTick = (this.tickF1.bp * 0.9 + this.tickF2.bp * 0.6) * this.lvl;
          if (--this.tickHold <= 0) { this.tickF1.clear(); this.tickF2.clear(); }
        }
        if (this.thumpImp !== 0 || this.thumpHold > 0) {
          if (this.thumpImp !== 0) this.thumpHold = this.ringHold * 6;
          const th = this.thumpImp; this.thumpImp = 0; this.thumpF.run(th * this.thumpF.rk); cThump = this.thumpF.bp * 0.9;
          if (--this.thumpHold <= 0) this.thumpF.clear();
        }
        if (this.puffE > 1e-4) { this.puffE *= this.kPuff; cPuff = this.puffF.run(this.nz()) * this.puffE * 0.5; }
        // ---- intake hiss (phase-locked whoosh), clutch rattle at idle
        let cHiss = 0, cRat = 0, cChain = 0, cGrit = 0;
        if (mode === 2) {
          const q = this.phase + 0.15, qq = q - (q | 0), whoosh = 0.55 + 1.8 * qq * (1 - qq);
          cHiss = this.hissF.run(this.nz()) * this.hissG * whoosh;
          const cl = this.clutchF;
          if (cl < 0.98) {
            let ri = 0; if (this.rnd() < (1 - cl) * f * 0.9 * dt) { ri = (0.35 + 0.65 * this.rnd()) * (1 - cl); this.ratHold = this.ringHold; }
            if (this.rattleKick !== 0) { ri = this.rattleKick; this.rattleKick = 0; this.ratHold = this.ringHold * 2; }
            if (ri !== 0 || this.ratHold > 0) {
              this.rattleF1.run(ri * 0.16 * this.rattleF1.rk); this.rattleF2.run(ri * 0.12 * this.rattleF2.rk); cRat = (this.rattleF1.bp * 0.9 + this.rattleF2.bp * 0.6) * T.tick;
              if (--this.ratHold <= 0) { this.rattleF1.clear(); this.rattleF2.clear(); }
            }
          }
          cChain = this._chain(); cGrit = this._grit();
        }
        // ---- starter noises + transient voices (bites, pops, coughs)
        const cStart = (mode === 1 || this.rewind > 0.002 || this.pullSpd > 0.002) ? this._ratchet() : 0;
        const cVox = this.nVox > 0 ? this._voices() * 0.42 : 0;
        const y = cExh + cThump + cCrack + cTick + cPuff + cHiss + cRat + cChain + cGrit + cStart + cVox;
        if (probe) { pe[0] += cExh * cExh; pe[1] += cThump * cThump; pe[2] += cCrack * cCrack; pe[3] += cTick * cTick; pe[4] += cPuff * cPuff; pe[5] += cHiss * cHiss; pe[6] += cRat * cRat; pe[7] += cChain * cChain; pe[8] += cGrit * cGrit; pe[9] += cStart * cStart; pe[10] += cVox * cVox; pe[11]++; }
        // ---- output stage: DC block (16 Hz) -> 52 Hz high-pass -> gentle high cut -> soft limiter (ceiling 0.86)
        const dcy = y - this.dcIn + hpc * this.dcOut; this.dcIn = y; this.dcOut = dcy;
        const z0 = dcy - this.hp2a + hp2 * this.hp2b; this.hp2a = dcy; this.hp2b = z0;
        const z1 = z0 - this.hp3a + hp2 * this.hp3b; this.hp3a = z0; this.hp3b = z1; // two 1-pole 55 Hz high-passes: a handheld saw has little real sub-bass
        this.lpO += this.kLpO * (z1 - this.lpO);
        const o = 0.86 * tanhf(this.lpO * T.out * 1.85 / 0.86);
        out[off + i] = o; chk += o;
      }
      if (chk !== chk || chk > 1e6 || chk < -1e6) { this._reset(); for (let i = 0; i < n; i++) out[off + i] = 0; return; }
      this._flush();
    }

    // chain: link-rate pulse train ringing in bar resonances + band noise, loop-rate flutter with dropouts
    _chain() {
      const amp = this.chainAmp;
      if (amp < 0.0005) { if (this.chainOn) { this.chainOn = false; this.chainR1.clear(); this.chainR2.clear(); this.chainR3.clear(); this.chainN.clear(); } return 0; }
      this.chainOn = true;
      const dt = this.dt;
      this.cph += this.linkRate * dt;
      let imp = 0;
      if (this.cph >= 1) { this.cph -= 1 + 0.16 * (this.rnd() - 0.5); imp = (0.7 + 0.3 * this.rnd()); } // +-8 % link timing jitter: a rough whine, not a pure tone
      this.loopPh += this.loopRate * dt;
      if (this.loopPh >= 1) { this.loopPh -= 1; this.gateT = this.rnd() < 0.18 ? 0.25 + 0.3 * this.rnd() : 0.8 + 0.4 * this.rnd(); }
      this.gate += (this.gateT - this.gate) * this.kGate;
      this.chainR1.run(imp * 0.19 * this.chainR1.rk); this.chainR2.run(imp * 0.13 * this.chainR2.rk); this.chainR3.run(imp * 0.09 * this.chainR3.rk);
      const tone = this.chainR1.bp * 0.55 + this.chainR2.bp * 0.35 + this.chainR3.bp * 0.3;
      const tri = this.loopPh < 0.5 ? this.loopPh * 2 : 2 - this.loopPh * 2; // cheap triangle instead of sin
      const noise = this.chainN.run(this.nz()) * (0.55 + 0.45 * (2 * tri - 1)) * 0.3;
      return (tone * 1.1 + noise) * amp * this.gate * 1.0;
    }

    // cutting grit: broadband gnarly noise, cutter-tooth AM, chain drag rumble
    _grit() {
      const a = this.gritAmp;
      if (a < 0.0004) { if (this.gritOn) { this.gritOn = false; this.gritA.clear(); this.gritB.clear(); this.gritC.clear(); this.dragF.clear(); } return 0; }
      this.gritOn = true;
      const dt = this.dt, n = this.nz();
      this.gritLp += (Math.abs(this.nz()) - this.gritLp) * this.kGrit;
      this.cutPh += (95 + 40 * this.gritLp) * dt; if (this.cutPh >= 1) this.cutPh -= 1;
      const tri = this.cutPh < 0.5 ? this.cutPh * 2 : 2 - this.cutPh * 2, tooth = 0.45 + 0.55 * tri * tri;
      const irr = 0.55 + 0.9 * this.gritLp + 0.25 * this.wob;
      const g1 = this.gritA.run(n), g2 = this.gritB.run(this.nz()), g3 = this.gritC.run(this.nz());
      const drag = this.dragF.run(this.nz());
      return a * (irr * (g1 * 0.7 + g2 * 0.7 * tooth + g3 * 0.15) + drag * 0.5) * (1 + 0.35 * this.wob * this.T.growl);
    }

    // pull-cord ratchet clicks, rope rasp and rewind whir
    _ratchet() {
      const dt = this.dt, spd = this.pullSpd; let imp = 0;
      if (spd > 0.003) { this.clickPh += this.clickRate * dt; if (this.clickPh >= 1) { this.clickPh -= 1; imp = (0.45 + 0.55 * this.rnd()) * (0.4 + 0.6 * spd); } }
      this.ratF1.run(imp * 0.4 * this.ratF1.rk); this.ratF2.run(imp * 0.25 * this.ratF2.rk); this.ratF3.run(imp * 0.35 * this.ratF3.rk);
      const rope = spd > 0.01 ? this.ropeF.run(this.nz()) * spd * spd * 0.35 : 0;
      let rew = 0;
      if (this.rewind > 0.002) { this.rewPh += 62 * dt; if (this.rewPh >= 1) this.rewPh -= 1; rew = this.rewF.run(this.nz()) * this.rewind * (0.5 + 0.5 * (this.rewPh < 0.5 ? this.rewPh * 4 - 1 : 3 - this.rewPh * 4)) * 0.14; }
      return (this.ratF1.bp * 0.7 + this.ratF2.bp * 0.45 + this.ratF3.bp * 0.6) + rope + rew;
    }

    _flush() {
      const s = this.svfs; for (let i = 0; i < s.length; i++) { const f = s[i]; if (Math.abs(f.ic1) < 1e-14) f.ic1 = 0; if (Math.abs(f.ic2) < 1e-14) f.ic2 = 0; }
      if (Math.abs(this.yL) < 1e-14) this.yL = 0; if (Math.abs(this.yS) < 1e-14) this.yS = 0; if (Math.abs(this.yA) < 1e-14) this.yA = 0;
      if (Math.abs(this.crackE) < 1e-12) this.crackE = 0; if (Math.abs(this.puffE) < 1e-12) this.puffE = 0; if (Math.abs(this.cLp) < 1e-14) this.cLp = 0;
      if (Math.abs(this.vLp) < 1e-14) this.vLp = 0; if (Math.abs(this.m1) < 1e-14) this.m1 = 0; if (Math.abs(this.m2) < 1e-14) this.m2 = 0; if (Math.abs(this.p1) < 1e-14) this.p1 = 0;
      if (Math.abs(this.dcOut) < 1e-14) this.dcOut = 0; if (Math.abs(this.hp2b) < 1e-14) this.hp2b = 0; if (Math.abs(this.hp3b) < 1e-14) this.hp3b = 0; if (Math.abs(this.lpO) < 1e-14) this.lpO = 0;
    }
    _reset() {
      for (const f of this.svfs) f.clear();
      this.dl.fill(0); this.yL = this.yS = this.yA = 0; this.cLp = 0; this.crackE = 0; this.puffE = 0; this.dcIn = this.dcOut = this.hp2a = this.hp2b = this.hp3a = this.hp3b = this.lpO = 0; this.m1 = this.m2 = this.p1 = this.vLp = 0;
      if (!(this.rpm === this.rpm) || this.rpm > 20000) { this.rpm = 2800; this.rvel = 0; }
      if (!(this.phase === this.phase)) this.phase = 0;
      for (const v of this.voices) v.on = false;
      this.nVox = 0;
      this.resets = (this.resets || 0) + 1;
    }
  }
  return Core;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// AudioWorklet source (module text). The core is embedded by stringifying makeCore.
const PARAMS = ['throttle', 'load', 'cStart', 'cStop', 'cRev', 'cBite', 'bStr', 'bKind', 'rAmt'];
const WORKLET_SRC = `
const Core = (${makeCore.toString()})();
class ChainsawProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return ${JSON.stringify(PARAMS)}.map((name) => ({ name, defaultValue: name === 'rAmt' ? 1 : 0, minValue: -1e9, maxValue: 1e9, automationRate: 'k-rate' }));
  }
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.core = new Core(sampleRate, o.seed || 1, o.tune || null);
    this.last = { cStart: 0, cStop: 0, cRev: 0, cBite: 0 };
    this.blocks = 0; this.tel = o.telemetry !== false;
    this.port.onmessage = (e) => { const m = e.data; if (m && m.tune) this.core.tune(m.tune); };
  }
  process(inputs, outputs, p) {
    const c = this.core, L = this.last;
    c.setControls(p.throttle[0], p.load[0]);
    if (p.cStart[0] !== L.cStart) { L.cStart = p.cStart[0]; c.start(); }
    if (p.cStop[0] !== L.cStop) { L.cStop = p.cStop[0]; c.stop(); }
    if (p.cRev[0] !== L.cRev) { L.cRev = p.cRev[0]; c.rev(p.rAmt[0]); }
    if (p.cBite[0] !== L.cBite) { L.cBite = p.cBite[0]; c.bite(p.bStr[0], p.bKind[0]); }
    const out = outputs[0], ch = out[0];
    c.process(ch, ch.length, 0);
    for (let k = 1; k < out.length; k++) out[k].set(ch);
    if (this.tel && (++this.blocks & 15) === 0) this.port.postMessage(c.snapshot());
    return true;
  }
}
registerProcessor('chainsaw-engine', ChainsawProcessor);
`;

const CoreCtor = makeCore();
const workletModules = new WeakMap();
const KIND_ID = { flesh: 0, wood: 1, metal: 2 };

async function loadWorklet(ctx) {
  let p = workletModules.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }));
    p = ctx.audioWorklet.addModule(url).finally(() => setTimeout(() => URL.revokeObjectURL(url), 5000));
    workletModules.set(ctx, p);
  }
  return p;
}

// Distance/output chain shared by every backend: src -> distLP -> distGain -> output -> destination.
function buildChain(ctx, destination) {
  const output = ctx.createGain(); output.gain.value = 1;
  const distGain = ctx.createGain(); distGain.gain.value = 1;
  const distLP = ctx.createBiquadFilter(); distLP.type = 'lowpass'; distLP.Q.value = 0.55;
  const maxF = Math.min(20000, ctx.sampleRate * 0.45); distLP.frequency.value = maxF;
  const layerInput = ctx.createGain(); layerInput.gain.value = 1;
  layerInput.connect(distLP); distLP.connect(distGain); distGain.connect(output); output.connect(destination);
  return { output, distGain, distLP, layerInput, maxF };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// backends: each exposes send(cmd, a, b, when) and dispose()
async function workletBackend(ctx, chain, opts, engine) {
  await loadWorklet(ctx);
  const node = new AudioWorkletNode(ctx, 'chainsaw-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { seed: opts.seed || 1, tune: opts.tune || null, telemetry: opts.telemetry !== false } });
  node.connect(chain.distLP);
  const P = node.parameters, cnt = { cStart: 0, cStop: 0, cRev: 0, cBite: 0 };
  node.port.onmessage = (e) => { if (e.data && typeof e.data.rpm === 'number') engine.state = { ...e.data, t: ctx.currentTime, backend: 'worklet' }; };
  const set = (name, v, t) => P.get(name).setValueAtTime(v, t);
  return {
    send(cmd, a, b, t) {
      switch (cmd) {
        case 'throttle': set('throttle', a, t); break;
        case 'load': set('load', a, t); break;
        case 'start': set('cStart', (cnt.cStart = (cnt.cStart + 1) % 1000000), t); break;
        case 'stop': set('cStop', (cnt.cStop = (cnt.cStop + 1) % 1000000), t); break;
        case 'rev': set('rAmt', a, t); set('cRev', (cnt.cRev = (cnt.cRev + 1) % 1000000), t); break;
        case 'bite': set('bStr', a, t); set('bKind', b, t); set('cBite', (cnt.cBite = (cnt.cBite + 1) % 1000000), t); break;
        case 'tune': node.port.postMessage({ tune: a }); break;
        default: break;
      }
    },
    dispose() { try { node.disconnect(); node.port.onmessage = null; node.port.close(); } catch (e) { /* already gone */ } },
  };
}

// ScriptProcessor fallback: same DSP core on the main thread; events are queued and applied at their exact sample inside the buffer.
function scriptBackend(ctx, chain, opts, engine) {
  const core = new CoreCtor(ctx.sampleRate, opts.seed || 1, opts.tune || null);
  const node = ctx.createScriptProcessor(opts.bufferSize || 2048, 0, 1);
  const queue = []; let thr = 0, load = 0;
  const apply = (e) => {
    switch (e.cmd) {
      case 'throttle': thr = e.a; core.setControls(thr, load); break;
      case 'load': load = e.a; core.setControls(thr, load); break;
      case 'start': core.start(); break; case 'stop': core.stop(); break;
      case 'rev': core.rev(e.a); break; case 'bite': core.bite(e.a, e.b); break; case 'tune': core.tune(e.a); break;
      default: break;
    }
  };
  let frames = 0;
  node.onaudioprocess = (ev) => {
    const out = ev.outputBuffer.getChannelData(0), n = out.length, t0 = ev.playbackTime != null ? ev.playbackTime : ctx.currentTime;
    let pos = 0;
    queue.sort((x, y) => x.t - y.t);
    while (queue.length && queue[0].t < t0 + n / ctx.sampleRate) {
      const e = queue.shift(); const at = clamp01((e.t - t0) * ctx.sampleRate, n);
      if (at > pos) { core.process(out, at - pos, pos); pos = at; }
      apply(e);
    }
    if (pos < n) core.process(out, n - pos, pos);
    for (let c = 1; c < ev.outputBuffer.numberOfChannels; c++) ev.outputBuffer.getChannelData(c).set(out);
    if (((frames += n) & 0x3fff) < n) engine.state = { ...core.snapshot(), t: ctx.currentTime, backend: 'script' };
  };
  const clamp01 = (x, n) => Math.max(0, Math.min(n, Math.round(x)));
  node.connect(chain.distLP);
  return {
    send(cmd, a, b, t) { queue.push({ cmd, a, b, t }); },
    dispose() { try { node.onaudioprocess = null; node.disconnect(); } catch (e) { /* already gone */ } },
    core,
  };
}

// Last-resort oscillator/noise graph (no worklet, no script processor). Crude but alive: rpm-tracking saw + detuned saw + noise, main-thread rpm model.
function oscBackend(ctx, chain, opts, engine) {
  const sr = ctx.sampleRate, T = { idle: 2800, full: 12300 };
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = o2.type = 'sawtooth';
  const nb = ctx.createBuffer(1, sr, sr), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.8;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; lp.Q.value = 2;
  const g1 = ctx.createGain(), g2 = ctx.createGain(), gn = ctx.createGain(), am = ctx.createGain(), master = ctx.createGain();
  g1.gain.value = 0.25; g2.gain.value = 0.15; gn.gain.value = 0; am.gain.value = 1; master.gain.value = 0;
  const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 9; lfoG.gain.value = 0; lfo.connect(lfoG); lfoG.connect(am.gain);
  o1.connect(g1); o2.connect(g2); g1.connect(lp); g2.connect(lp); ns.connect(bp); bp.connect(gn); gn.connect(lp); lp.connect(am); am.connect(master); master.connect(chain.distLP);
  o1.start(); o2.start(); ns.start(); lfo.start();
  const S = { on: false, thr: 0, load: 0, rpm: 0, vel: 0 };
  const tick = () => {
    const t = ctx.currentTime, thc = S.thr, tgt = S.on ? (T.idle + (T.full - T.idle) * Math.pow(thc, 1.5)) * (1 - 0.28 * S.load) : 0;
    const dt = 0.03, err = tgt - S.rpm, wn = 2 * Math.PI * (err > 0 ? 1.5 : 1.1), z = err > 0 ? 0.55 : 1.05;
    S.vel += (wn * wn * err - 2 * z * wn * S.vel) * dt; S.rpm = Math.max(0, S.rpm + S.vel * dt);
    const f = S.rpm / 60, on = S.on || S.rpm > 50;
    o1.frequency.setTargetAtTime(Math.max(1, f), t, 0.02); o2.frequency.setTargetAtTime(Math.max(1, f * 2.003), t, 0.02);
    lp.frequency.setTargetAtTime(900 + 3500 * Math.min(1, S.rpm / 12000), t, 0.03);
    gn.gain.setTargetAtTime(on ? 0.05 + 0.25 * Math.pow(Math.min(1, S.rpm / 12000), 2) + 0.35 * S.load : 0, t, 0.05);
    lfoG.gain.setTargetAtTime(0.3 * S.load, t, 0.05);
    master.gain.setTargetAtTime(on ? 0.35 : 0, t, S.on ? 0.03 : 0.25);
    engine.state = { rpm: S.rpm, hz: f, throttle: thc, load: S.load, mode: S.on ? 2 : 0, t, backend: 'osc' };
  };
  const timer = setInterval(tick, 30);
  return {
    send(cmd, a, b, t) {
      const run = () => {
        if (cmd === 'throttle') S.thr = a; else if (cmd === 'load') S.load = a; else if (cmd === 'start') { S.on = true; S.rpm = Math.max(S.rpm, 600); S.vel = 4000; }
        else if (cmd === 'stop') S.on = false; else if (cmd === 'rev') { const old = S.thr; S.thr = 1; setTimeout(() => { S.thr = old; }, 220); }
        else if (cmd === 'bite') { S.vel -= 5000 * a; }
      };
      const dtMs = (t - ctx.currentTime) * 1000; if (dtMs > 5) setTimeout(run, dtMs); else run();
    },
    dispose() { clearInterval(timer); try { o1.stop(); o2.stop(); ns.stop(); lfo.stop(); master.disconnect(); } catch (e) { /* ignore */ } },
  };
}

/**
 * Create the chainsaw engine voice.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} destination
 * @param {{mode?: 'auto'|'worklet'|'script'|'osc', seed?: number, tune?: object, telemetry?: boolean}} [opts]
 */
export async function createChainsawEngine(ctx, destination, opts = {}) {
  const chain = buildChain(ctx, destination);
  const engine = { output: chain.output, layerInput: chain.layerInput, kind: 'none', state: { rpm: 0, hz: 0, throttle: 0, load: 0, mode: 0, t: 0 }, _when: null, _dist: 0, _disposed: false };
  let backend = null, kind = 'none';
  const want = opts.mode || 'auto';
  if ((want === 'auto' || want === 'worklet') && ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    try { backend = await workletBackend(ctx, chain, opts, engine); kind = 'worklet'; } catch (e) { console.warn('[chainsawEngine] AudioWorklet unavailable, falling back:', e && e.message); }
  }
  if (!backend && (want === 'auto' || want === 'worklet' || want === 'script') && typeof ctx.createScriptProcessor === 'function') {
    try { backend = scriptBackend(ctx, chain, opts, engine); kind = 'script'; } catch (e) { console.warn('[chainsawEngine] ScriptProcessor unavailable, falling back:', e && e.message); }
  }
  if (!backend) { backend = oscBackend(ctx, chain, opts, engine); kind = 'osc'; }
  engine.kind = kind; engine.backend = backend;

  const when = (t) => (t != null ? t : engine._when != null ? engine._when : ctx.currentTime);
  const cl = (x, a, b) => (x < a ? a : x > b ? b : x);
  Object.assign(engine, {
    /** Pull-cord start: ratchet, 1-2 failed sputters, catch, fast idle, settle to idle in ~1.4 s. */
    start(t) { if (!engine._disposed) backend.send('start', 0, 0, when(t)); },
    /** Ignition off: dying firing, spin-down with compression chuffs, last pop. */
    stop(t) { if (!engine._disposed) backend.send('stop', 0, 0, when(t)); },
    /** 0..1, smoothed with rotational inertia inside the DSP. 0 = idle, ~0.15 = held idle (chain still), 1 = full. */
    setThrottle(v, t) { if (!engine._disposed) backend.send('throttle', cl(+v || 0, 0, 1), 0, when(t)); },
    /** 0..1 cutting load: rpm sag, roughness, growl, grit, chain drag. */
    setLoad(v, t) { if (!engine._disposed) backend.send('load', cl(+v || 0, 0, 1), 0, when(t)); },
    /** One tooth-bite transient (call per melee tick that hits). kind: 'flesh'|'wood'|'metal'. */
    bite(strength = 0.7, kind = 'flesh', t) { if (!engine._disposed) backend.send('bite', cl(+strength || 0, 0, 1), typeof kind === 'number' ? kind : KIND_ID[kind] ?? 0, when(t)); },
    /** Throttle blip (rev-up overshoot, then decel with burble / backfire pops). */
    rev(amount = 1, t) { if (!engine._disposed) backend.send('rev', cl(+amount || 0, 0, 1), 0, when(t)); },
    /** 0 = right here, 1 = far away: lowpass sweep + level drop. */
    setDistance(d, t) {
      d = cl(+d || 0, 0, 1); engine._dist = d; const tt = when(t);
      const fc = chain.maxF * Math.pow(1300 / chain.maxF, Math.pow(d, 0.7)), g = 1 - 0.78 * Math.pow(d, 0.8);
      chain.distLP.frequency.setTargetAtTime(fc, tt, 0.06); chain.distGain.gain.setTargetAtTime(g, tt, 0.06);
    },
    /** Live-tune DSP knobs: {idle, full, sag, rough, exhaust, chain, grit, bite, hiss, tick, growl, out, drive}. */
    tune(o) { backend.send('tune', o, 0, when()); },
    dispose() {
      if (engine._disposed) return; engine._disposed = true;
      try { backend.dispose(); chain.layerInput.disconnect(); chain.distLP.disconnect(); chain.distGain.disconnect(); chain.output.disconnect(); } catch (e) { /* ignore */ }
    },
  });
  return engine;
}

/**
 * Render a scripted sequence offline. script: [{t, call, arg}] with call in start|stop|setThrottle|setLoad|bite|rev|setDistance,
 * arg = number | [numbers/kind...] (bite: [strength, kind]).  Returns mono Float32Array.
 * opts.mode forces a backend ('worklet' | 'script'); opts.seed for determinism; opts.engineOut receives {kind}.
 */
export async function renderOffline(script, duration, sampleRate = 44100, opts = {}) {
  const Off = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : window.webkitOfflineAudioContext;
  const ctx = new Off(1, Math.ceil(duration * sampleRate), sampleRate);
  const eng = await createChainsawEngine(ctx, ctx.destination, { seed: 7, telemetry: false, ...opts });
  if (opts.engineOut) opts.engineOut.kind = eng.kind;
  for (const ev of script) {
    eng._when = Math.max(0, ev.t);
    const a = Array.isArray(ev.arg) ? ev.arg : ev.arg === undefined ? [] : [ev.arg];
    eng[ev.call](...a);
  }
  eng._when = null;
  const buf = await ctx.startRendering();
  const data = buf.getChannelData(0).slice();
  eng.dispose();
  return data;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Direct core render (no WebAudio): same DSP, events applied at 128-sample block boundaries exactly like the AudioWorklet.
// Used by tests/lab to get the true rpm trajectory and to check worklet == core. Returns {samples, traj:[{t, rpm, hz, ...}]}.
export function renderCore(script, duration, sampleRate = 44100, opts = {}) {
  const core = new CoreCtor(sampleRate, opts.seed || 7, opts.tune || null);
  core.probe = !!opts.probe;
  const n = Math.ceil(duration * sampleRate), out = new Float32Array(n), Q = 128;
  const evs = script.map((e) => ({ ...e })).sort((a, b) => a.t - b.t); let ei = 0, thr = 0, load = 0; const traj = [];
  const trajEvery = Math.round(sampleRate * (opts.trajStep || 0.05)); let nextTraj = 0;
  for (let pos = 0; pos < n; pos += Q) {
    const tBlock = pos / sampleRate;
    while (ei < evs.length && evs[ei].t * sampleRate <= pos + 1e-6) { // k-rate params: an event at time t is seen by the first quantum starting at/after t
      const e = evs[ei++], a = Array.isArray(e.arg) ? e.arg : e.arg === undefined ? [] : [e.arg];
      switch (e.call) {
        case 'setThrottle': thr = Math.fround(a[0]); break; case 'setLoad': load = Math.fround(a[0]); break; // AudioParams are float32
        case 'start': core.start(); break; case 'stop': core.stop(); break; case 'rev': core.rev(Math.fround(a[0] == null ? 1 : a[0])); break;
        case 'bite': core.bite(Math.fround(a[0] == null ? 0.7 : a[0]), typeof a[1] === 'number' ? a[1] : KIND_ID[a[1]] ?? 0); break;
        default: break;
      }
    }
    core.setControls(thr, load);
    const m = Math.min(Q, n - pos);
    core.process(out, m, pos);
    if (pos >= nextTraj) {
      const e = { t: tBlock, ...core.snapshot() };
      if (core.probe) { const c = core.pe[11] || 1; e.comp = Array.from(core.pe.subarray(0, 11), (v) => Math.sqrt(v / c)); core.pe.fill(0); }
      traj.push(e); nextTraj += trajEvery;
    }
  }
  return { samples: out, traj, core };
}

export const _internals = { makeCore, WORKLET_SRC, Core: CoreCtor };
