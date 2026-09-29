// Enemy type definitions: stats, AI tuning, sound tables, animation tuning, hit volumes.
// Sound entries: [audioName, rate, volume]. Hit volumes are in un-scaled model units (root scale multiplies them).

export const DEFS = {
  shambler: {
    hp: 60, speed: 2.0, radius: 0.36, height: 1.78, scale: 1, mass: 1, score: 10, glow: 1.4,
    melee: { range: 1.55, dmg: 12, windup: 0.6, strike: 0.16, recover: 0.5, cooldown: 0.9, arc: 0.3, atk: 'swipe' },
    pain: 0.8, painTime: 0.4, turn: 3.4, accel: 5, knockRes: 1,
    snd: { alert: ['zombieAlert', 1, 0.9], idle: ['zombieIdle', 1, 0.8], attack: ['zombieAttack', 1, 0.9], pain: ['zombiePain', 1, 0.8], death: ['zombieDeath', 1, 1], step: ['zombieStep', 1, 0.5] },
    anim: { cyc: 0.5, hip: 0.5, knee: 0.75, kneeBase: 0.12, bob: 0.035, hipLean: 0.16, spine: 0.22, head: 0.1, sway: 0.06, twist: 0.2, wob: 0.09, look: 0.7, drag: 0.6, arms: 'zombie', stance: 0.02 },
    hit: { head: 0.125, torso: 0.2, arm: 0.075, thigh: 0.105, shin: 0.08 },
  },
  runner: {
    hp: 35, speed: 5.5, radius: 0.32, height: 1.74, scale: 1, mass: 0.7, score: 15, glow: 2.2,
    melee: { range: 1.5, dmg: 9, windup: 0.22, strike: 0.2, recover: 0.4, cooldown: 0.55, arc: 0.1, atk: 'rake', lunge: 9 },
    pain: 0.5, painTime: 0.28, turn: 9, accel: 14, knockRes: 0.6,
    snd: { alert: ['runnerScream', 1, 1], idle: ['zombieIdle', 1.35, 0.6], attack: ['runnerScream', 1.25, 0.8], pain: ['zombiePain', 1.3, 0.8], death: ['zombieDeath', 1.25, 0.9], step: null },
    anim: { cyc: 0.3, hip: 0.95, knee: 1.25, kneeBase: 0.25, bob: 0.05, hipLean: 0.32, spine: 0.34, head: -0.05, sway: 0.05, twist: 0.3, wob: 0.16, look: 0.5, arms: 'flail', stance: 0 },
    hit: { head: 0.115, torso: 0.16, arm: 0.06, thigh: 0.085, shin: 0.065 },
  },
  trooper: {
    hp: 50, speed: 3.0, radius: 0.36, height: 1.82, scale: 1, mass: 1.1, score: 25, glow: 2.4,
    ranged: { min: 10, max: 18, telegraph: 0.42, cooldown: [0.9, 1.9], burst: [1, 3], burstGap: 0.12, dmg: [8, 14], spread: 0.085, atk: 'shoot' }, // spread: ~60% hit rate on a standing target at 12 m, less at range / when strafing
    pain: 0.6, painTime: 0.33, turn: 4.2, accel: 8, knockRes: 1,
    snd: { alert: ['zombieAlert', 0.8, 0.9], idle: ['zombieIdle', 0.85, 0.5], attack: ['enemyShot', 1, 0.8], pain: ['zombiePain', 0.9, 0.8], death: ['zombieDeath', 0.85, 1], step: ['zombieStep', 0.9, 0.35] },
    anim: { cyc: 0.45, hip: 0.5, knee: 0.7, kneeBase: 0.1, bob: 0.03, hipLean: 0.06, spine: 0.06, head: -0.05, sway: 0.03, twist: 0.08, wob: 0.03, look: 0.6, arms: 'rifle', stance: 0.03 },
    hit: { head: 0.13, torso: 0.22, arm: 0.07, thigh: 0.11, shin: 0.085 },
  },
  spitter: {
    hp: 45, speed: 2.5, radius: 0.36, height: 1.8, scale: 1, mass: 0.9, score: 30, glow: 2.0,
    ranged: { min: 6, max: 15, telegraph: 0.7, cooldown: [1.4, 2.6], burst: [1, 1], dmg: [25, 25], atk: 'spit', projectile: true },
    melee: { range: 1.4, dmg: 10, windup: 0.4, strike: 0.15, recover: 0.5, cooldown: 1.2, arc: 0.2, atk: 'swipe' },
    pain: 0.6, painTime: 0.35, turn: 4, accel: 7, knockRes: 1,
    snd: { alert: ['zombieAlert', 0.7, 0.9], idle: ['zombieIdle', 0.75, 0.7], attack: ['zombieAttack', 0.7, 0.8], pain: ['zombiePain', 0.85, 0.8], death: ['zombieDeath', 0.8, 1], step: null },
    anim: { cyc: 0.48, hip: 0.5, knee: 0.7, kneeBase: 0.14, bob: 0.03, hipLean: 0.1, spine: 0.18, head: 0.05, sway: 0.07, twist: 0.15, wob: 0.12, look: 0.6, arms: 'spitter', stance: 0.03 },
    hit: { head: 0.13, torso: 0.2, arm: 0.07, thigh: 0.1, shin: 0.08 },
  },
  brute: {
    hp: 400, speed: 3.0, radius: 0.62, height: 2.6, scale: 1.24, mass: 4, lieY: 0.3, score: 100, glow: 2.4,
    melee: { range: 2.7, dmg: 35, windup: 0.85, strike: 0.2, recover: 0.9, cooldown: 1.2, arc: 0.1, atk: 'slam', knock: 11, shake: 0.6 },
    charge: { min: 5, max: 22, windup: 0.85, speed: 9, time: 1.7, cooldown: 6, dmg: 35, knock: 13 },
    pain: 0.08, painTime: 0.18, turn: 2.6, accel: 4, knockRes: 6,
    snd: { alert: ['bruteRoar', 1, 1], idle: ['zombieIdle', 0.5, 0.9], attack: ['bruteRoar', 1.1, 0.8], pain: ['zombiePain', 0.55, 0.9], death: ['bruteRoar', 0.7, 1], step: ['bruteStep', 1, 1] },
    anim: { cyc: 0.33, hip: 0.45, knee: 0.6, kneeBase: 0.1, bob: 0.03, hipLean: 0.14, spine: 0.16, head: 0.05, sway: 0.09, twist: 0.12, wob: 0.03, look: 0.5, arms: 'swing', stance: 0.06 },
    hit: { head: 0.11, torso: 0.36, arm: 0.15, thigh: 0.19, shin: 0.15 },
  },
  exploder: {
    hp: 70, speed: 2.4, radius: 0.5, height: 1.85, scale: 1, mass: 1.6, score: 40, glow: 3.0,
    prime: { range: 1.9, time: 0.8 }, burst: { radius: 3.5, dmg: 60 },
    pain: 0.35, painTime: 0.3, turn: 3, accel: 5, knockRes: 1.5,
    snd: { alert: ['zombieAlert', 0.6, 0.9], idle: ['zombieIdle', 0.6, 0.9], attack: ['zombieAlert', 1.5, 0.9], pain: ['zombiePain', 0.7, 0.8], death: ['exploderBurst', 1, 1], step: ['zombieStep', 0.7, 0.5] },
    anim: { cyc: 0.55, hip: 0.4, knee: 0.5, kneeBase: 0.08, bob: 0.04, hipLean: 0.04, spine: 0.06, head: 0.1, sway: 0.11, twist: 0.1, wob: 0.06, look: 0.6, arms: 'wide', stance: 0.1 },
    hit: { head: 0.12, torso: 0.2, belly: [0.2, 0.17, 0.5], arm: 0.1, thigh: 0.14, shin: 0.11 },
  },
  tyrant: {
    hp: 1800, speed: 3.5, radius: 0.9, height: 3.6, scale: 1.55, mass: 8, lieY: 0.29, score: 500, glow: 2.6,
    claw: { range: 3.6, dmg: 40, windup: 0.5, strike: 0.2, recover: 0.6, cooldown: 0.35, arc: -0.1, atk: 'claw', knock: 12, shake: 0.7 },
    stomp: { range: 7.5, dmg: 32, windup: 1.0, strike: 0.22, recover: 0.9, cooldown: 0.4, radius: 10, atk: 'stomp', shake: 1.2 },
    pain: 0, painTime: 0.15, turn: 3, accel: 4, knockRes: 12,
    snd: { alert: ['tyrantRoar', 1, 1], idle: ['bruteRoar', 0.6, 0.7], attack: ['tyrantRoar', 1.2, 0.7], pain: ['zombiePain', 0.5, 1], death: ['tyrantRoar', 0.6, 1], step: ['bruteStep', 0.8, 1.2] },
    anim: { cyc: 0.28, hip: 0.4, knee: 0.55, kneeBase: 0.1, bob: 0.03, hipLean: 0.08, spine: 0.1, head: 0.02, sway: 0.06, twist: 0.1, wob: 0.03, look: 0.4, arms: 'claw', stance: 0.06 },
    hit: { head: 0.17, torso: 0.34, arm: 0.15, thigh: 0.17, shin: 0.14 },
  },
};
export const TYPE_NAMES = Object.keys(DEFS);
