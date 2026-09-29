// HUD: DOM overlay inside #hud (CSS injected from ./hud/style.js, glyphs from ./hud/icons.js). Doom-minimal but stylish.
// All per-frame work is cached (DOM is only touched when a value actually changes) and every timer runs off the dt given to update().
import { WEAPON_SLOTS, AMMO, bus, clamp, damp } from './core.js';
import { CSS } from './hud/style.js';
import { WEAPON_ICONS, ICON_CROSS, ICON_SHIELD, ICON_TRAIN, ICON_SKULL } from './hud/icons.js';

const WEAPON_NAMES = { fist: 'Fists', chainsaw: 'Chainsaw', pistol: 'Pistol', shotgun: 'Shotgun', ssg: 'Super Shotgun', chaingun: 'Chaingun', rocket: 'Rocket Launcher', plasma: 'Plasma Rifle', bfg: 'BFG 9000' };
const AMMO_OF = { pistol: 'bullets', shotgun: 'shells', ssg: 'shells', chaingun: 'bullets', rocket: 'rockets', plasma: 'cells', bfg: 'cells' };
const PER_SHOT = { ssg: 2, bfg: 40 };
const AMMO_LABEL = { bullets: 'Bullets', shells: 'Shells', rockets: 'Rockets', cells: 'Cells' };
const ENEMY_NAMES = { shambler: 'Shambler', runner: 'Runner', trooper: 'Trooper', spitter: 'Spitter', brute: 'Brute', exploder: 'Exploder', tyrant: 'Tyrant' };
const KICK = { fist: 4, chainsaw: 1.2, pistol: 5, shotgun: 12, ssg: 18, chaingun: 3.2, rocket: 12, plasma: 3, bfg: 22 };
const PICKUP = {
  health: ['Health', 'var(--green)'], medkit: ['Medkit', 'var(--green)'], armor: ['Armor', 'var(--blue)'],
  ammo_bullets: ['Bullets', 'var(--amber)'], ammo_shells: ['Shells', 'var(--amber)'], ammo_rockets: ['Rockets', 'var(--amber)'], ammo_cells: ['Cells', 'var(--amber)'],
};
const COMBO_WINDOW = 3.0;

const TEMPLATE = `
<div class="hx-vig"></div><div class="hx-hb"></div>
<div class="hx-ring">${'<div class="hx-dmg"></div>'.repeat(6)}</div>
<div class="hx-top">
  <div class="hx-plate">
    <div class="cell wave"><span class="hx-lab">Wave</span><span class="val" data-k="wave">00</span></div>
    <div class="sep"></div>
    <div class="cell left"><span class="hx-lab" data-k="leftlab">Enemies left</span><span class="val" data-k="left">0</span></div>
    <div class="hx-prog"><i data-k="prog"></i></div>
  </div>
  <div class="hx-train" data-k="train">${ICON_TRAIN}<span data-k="traintxt"></span></div>
  <div class="hx-boss" data-k="boss"><div class="bn">The Tyrant</div><div class="bb"><i class="g" data-k="bossg"></i><i class="f" data-k="bossf"></i></div></div>
</div>
<div class="hx-side">
  <div class="hx-score" data-k="score">000000</div>
  <div class="hx-kills" data-k="kills">KILLS 0</div>
  <div class="hx-delta" data-k="delta"></div>
  <div class="hx-combo" data-k="combo"><div class="cx" data-k="cx">x2</div><div class="cb"><i data-k="cbar"></i></div><div class="cl">Combo</div></div>
  <div class="hx-feed" data-k="feed"></div>
</div>
<div class="hx-xh" data-k="xh"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="d"></i></div>
<div class="hx-hm" data-k="hm"><i></i><i></i><i></i><i></i></div>
<div class="hx-banner" data-k="banner"><div class="bt" data-k="bt"></div><div class="bl"></div><div class="bs" data-k="bs"></div></div>
<div class="hx-toasts" data-k="toasts"></div>
<div class="hx-vitals" data-k="vitals">
  <div class="hx-stat" data-k="hp"><div class="row"><div class="hx-ico">${ICON_CROSS}</div><div class="txt"><span class="hx-lab">Health</span><span class="hx-num" data-k="hpnum">100</span></div></div><div class="hx-bar"><i class="g" data-k="hpg"></i><i class="f" data-k="hpf"></i></div></div>
  <div class="hx-stat armor sm none" data-k="ar"><div class="row"><div class="hx-ico">${ICON_SHIELD}</div><div class="txt"><span class="hx-lab">Armor</span><span class="hx-num" data-k="arnum">0</span></div></div><div class="hx-bar"><i class="f" data-k="arf"></i></div></div>
</div>
<div class="hx-arms" data-k="arms">
  <div class="hx-wname" data-k="wname">Pistol</div>
  <div class="hx-ammo" data-k="ammo"><div class="hx-atype"><span class="a" data-k="atype">Bullets</span><span class="s" data-k="asub"></span></div><div class="hx-anum" data-k="anum">50</div></div>
</div>
<div class="hx-slots" data-k="slots"></div>
<div class="hx-flash" data-k="flash"></div>`;

const tone = (t) => (/CLEARED|COMPLETE|VICTORY/i.test(t) ? 'clear' : /TRAIN/i.test(t) ? 'train' : /BOSS|TYRANT|DANGER|WARNING|HORDE|DEAD/i.test(t) ? 'danger' : '');
const pad = (n, w) => { const s = String(Math.max(0, Math.floor(n))); return s.length >= w ? s : '0'.repeat(w - s.length) + s; };
const setText = (el, v) => { const s = '' + v; if (el._s !== s) { el.textContent = s; el._s = s; } };
const setScale = (el, v) => { if (el._v === undefined || Math.abs(el._v - v) > 0.0015) { el.style.transform = 'scaleX(' + v.toFixed(3) + ')'; el._v = v; } };
const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

export function create(game) {
  if (!document.getElementById('hud-style')) { const s = document.createElement('style'); s.id = 'hud-style'; s.textContent = CSS; document.head.appendChild(s); }
  let host = document.getElementById('hud');
  if (!host) { host = document.createElement('div'); host.id = 'hud'; host.style.cssText = 'position:fixed;inset:0;pointer-events:none'; document.body.appendChild(host); }
  const root = document.createElement('div'); root.className = 'hx-root hidden'; root.innerHTML = TEMPLATE; host.appendChild(root);
  const q = {}; root.querySelectorAll('[data-k]').forEach((n) => { q[n.dataset.k] = n; });
  const ringEls = [...root.querySelectorAll('.hx-dmg')];
  const V3 = game.THREE.Vector3, _v = new V3();

  const slots = WEAPON_SLOTS.map((ids, i) => {
    const el = document.createElement('div'); el.className = 'hx-slot';
    el.innerHTML = `<span class="k">${i + 1}</span><span class="ic"></span><span class="n"></span><span class="mb"><b></b></span>`;
    q.slots.appendChild(el);
    return { el, ic: el.querySelector('.ic'), n: el.querySelector('.n'), mb: el.querySelector('.mb b'), ids, icon: null, own: null, cur: null, lowa: null };
  });

  // ---- state ----------------------------------------------------------------------------------------------------------------
  let visible = false, wasPaused = false, dead = false, T = 0;
  let dispHP = 100, lastHP = 100, fillF = 1, ghostF = 1, ghostDelay = 0, hpCls = '', dispAR = 0;
  let dispId = null;
  let kick = 0, gap = 5, lastGap = -1, hmT = 0, hmDur = 0.16, hmKind = 'hit', hmPrev = 0;
  let vigA = 0, deadA = 0, hbPhase = 0;
  const inds = ringEls.map((el) => ({ el, life: 0, max: 1, str: 1, x: 0, z: 0 }));
  const fl = { t: 0, dur: 0, peak: 0 };
  const toasts = [], feed = [];
  let combo = 0, comboT = 0, scoreShown = 0, scoreTarget = 0, deltaAcc = 0, deltaT = 0, lastLeft = -1;
  let trainKey = '', boss = null, bossScan = 0, bossF = 1, bossG = 1;
  const heads = new WeakSet(), pendingKills = [];

  // ---- per-frame sections -----------------------------------------------------------------------------------------------------
  function updVitals(dt) {
    const p = game.player; if (!p) return;
    const max = p.maxHealth || 100, hp = p.alive === false ? 0 : Math.max(0, p.health || 0);
    if (hp < lastHP - 0.01) ghostDelay = 0.55;
    lastHP = hp;
    dispHP = Math.abs(dispHP - hp) < 0.6 ? hp : damp(dispHP, hp, hp < dispHP ? 26 : 10, dt);
    let shown = Math.round(dispHP); if (hp > 0 && shown < 1) shown = 1;
    setText(q.hpnum, shown);
    const frac = clamp(hp / max, 0, 1);
    fillF = damp(fillF, frac, 22, dt);
    if (frac >= ghostF) ghostF = frac; else { ghostDelay -= dt; if (ghostDelay <= 0) ghostF = damp(ghostF, frac, 3.2, dt); }
    setScale(q.hpf, fillF); setScale(q.hpg, ghostF);
    const cls = hp >= 60 ? '' : hp >= 30 ? 'warn' : 'crit';
    if (cls !== hpCls) { q.hp.classList.remove('warn', 'crit'); if (cls) q.hp.classList.add(cls); hpCls = cls; }
    const ar = Math.max(0, p.armor || 0);
    dispAR = Math.abs(dispAR - ar) < 0.6 ? ar : damp(dispAR, ar, 12, dt);
    setText(q.arnum, Math.round(dispAR)); setScale(q.arf, clamp(dispAR / 100, 0, 1));
    q.ar.classList.toggle('none', ar <= 0);
  }

  function updArms() {
    const W = game.weapons; if (!W) return;
    const cur = W.current?.id || null, disp = W.pending || cur;
    if (disp !== dispId) {
      dispId = disp;
      q.wname.textContent = (WEAPON_NAMES[disp] || W.list?.[disp]?.name || disp || '').toString();
      restart(q.wname, 'sw');
    }
    const type = disp ? (AMMO_OF[disp] ?? W.list?.[disp]?.ammoType ?? null) : null;
    const per = PER_SHOT[disp] || 1, amt = type ? (W.ammo?.[type] ?? 0) : 0;
    setText(q.anum, type ? amt : '∞');
    q.anum.classList.toggle('inf', !type);
    setText(q.atype, type ? AMMO_LABEL[type] : 'Melee');
    setText(q.asub, type && per > 1 ? `${Math.floor(amt / per)} shot${Math.floor(amt / per) === 1 ? '' : 's'}` : '');
    const empty = !!type && amt < per, low = !!type && !empty && amt <= Math.max(per * 2, (AMMO[type]?.max ?? 100) * 0.12);
    q.ammo.classList.toggle('empty', empty); q.ammo.classList.toggle('low', low);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]; let own = false, show = null;
      for (const id of s.ids) if (W.owned?.has(id)) { own = true; show = id; }
      const isCur = !!disp && s.ids.includes(disp);
      if (isCur) show = disp;
      if (!show) show = s.ids[0];
      if (s.icon !== show) { s.ic.innerHTML = WEAPON_ICONS[show] || ''; s.icon = show; }
      if (s.own !== own) { s.el.classList.toggle('own', own); s.own = own; }
      if (s.cur !== isCur) { s.el.classList.toggle('cur', isCur); s.cur = isCur; }
      const st = AMMO_OF[show] ?? null, sa = st ? (W.ammo?.[st] ?? 0) : 0;
      setText(s.n, st && own ? sa : '');
      const lowa = !!st && own && sa < (PER_SHOT[show] || 1);
      if (s.lowa !== lowa) { s.el.classList.toggle('lowa', lowa); s.lowa = lowa; }
      setScale(s.mb, st && own ? clamp(sa / (AMMO[st]?.max ?? 100), 0, 1) : 0);
    }
  }

  function updTop() {
    const Wv = game.waves; if (!Wv) return;
    const wave = Wv.wave | 0, st = Wv.state, tr = game.train, trs = tr?.state;
    setText(q.wave, wave < 100 ? pad(wave, 2) : wave);
    let label = 'Enemies left', val = Wv.remaining ?? game.enemies?.aliveCount?.() ?? 0, frac = Wv.total ? clamp(val / Wv.total, 0, 1) : 0, clear = false;
    if (st === 'intermission') { label = 'Area'; val = 'CLEAR'; clear = true; frac = 0; }
    else if (st === 'trainIn') { label = 'Inbound'; val = Wv.total || 0; frac = 1; }
    else if (st === 'idle' && !wave) { val = '-'; frac = 0; }
    setText(q.leftlab, label);
    if (q.left._s !== '' + val) { if (typeof val === 'number' && lastLeft >= 0 && val < lastLeft) restart(q.left, 'pulse'); }
    if (typeof val === 'number') lastLeft = val; else lastLeft = -1;
    setText(q.left, val); q.left.classList.toggle('clear', clear);
    setScale(q.prog, frac);

    // train chip
    const track = Wv.track || tr?.track || 'A';
    let txt = '', cls = '';
    if (st === 'intermission') {
      if (trs === 'departing' || trs === 'stopped') { txt = 'Train departing'; cls = 'dim'; }
      else if (wave >= 1) { txt = Wv.timer > 0.5 ? `Next train in ${Math.ceil(Wv.timer)}` : 'Next train imminent'; cls = 'ok'; }
    } else if (st === 'trainIn' || trs === 'arriving') { txt = `Train inbound · Platform ${track}`; cls = 'warn'; }
    else if (trs === 'stopped') { txt = st === 'spawning' ? `Doors open · Platform ${track}` : `Train at platform ${track}`; cls = st === 'spawning' ? 'danger' : 'dim'; }
    else if (trs === 'departing') { txt = 'Train departing'; cls = 'dim'; }
    const key = (txt ? 'on ' : '') + cls;
    if (txt) setText(q.traintxt, txt);
    if (key !== trainKey) { q.train.className = 'hx-train ' + key; trainKey = key; }
  }

  // boss health bar: shown while a tyrant is alive
  function updBoss(dt) {
    bossScan -= dt;
    if (bossScan <= 0) {
      bossScan = 0.3;
      let f = null; const L = game.enemies?.list;
      if (L) for (let i = 0; i < L.length; i++) { const e = L[i]; if (e && e.alive && e.type === 'tyrant') { f = e; break; } }
      if (f !== boss) { boss = f; q.boss.classList.toggle('on', !!f); bossF = bossG = 1; }
    }
    if (!boss) return;
    const fr = clamp((boss.hp || 0) / (boss.maxHp || 1), 0, 1);
    bossF = damp(bossF, fr, 18, dt);
    bossG = fr >= bossG ? fr : damp(bossG, fr, 2.2, dt);
    setScale(q.bossf, bossF); setScale(q.bossg, bossG);
  }

  function updCross(dt) {
    const p = game.player, sp = p ? Math.hypot(p.vel.x, p.vel.z) : 0;
    kick = damp(kick, 0, 9, dt);
    const target = 5 + Math.min(sp, 10) * 0.85 + (p && p.grounded === false ? 6 : 0) + kick - (p && p.height < 1.5 ? 1.5 : 0);
    gap = damp(gap, target, 16, dt);
    if (Math.abs(gap - lastGap) > 0.1) { q.xh.style.setProperty('--g', gap.toFixed(2)); lastGap = gap; }
    if (hmT > 0) {
      hmT -= dt;
      if (hmT <= 0) { q.hm.style.opacity = '0'; hmPrev = 0; }
      else { const k = hmT / hmDur; q.hm.style.opacity = Math.pow(k, 0.6).toFixed(2); q.hm.style.transform = 'scale(' + (1 + (1 - k) * (hmKind === 'kill' ? 0.55 : 0.3)).toFixed(2) + ')'; }
    }
  }

  function updDamage(dt) {
    const p = game.player, alive = !p || p.alive !== false;
    vigA = Math.max(0, vigA - dt * 1.05);
    deadA = dead ? Math.min(0.85, deadA + dt * 0.5) : 0;
    const a = Math.max(vigA, deadA);
    setOpacity(q.vig, a);
    // low-health heartbeat
    let hb = 0;
    if (alive && p && p.health > 0 && p.health <= 30) {
      const sev = 1 - p.health / 30, bpm = 62 + 62 * sev;
      hbPhase = (hbPhase + dt * bpm / 60) % 1;
      const lub = Math.exp(-Math.pow((hbPhase - 0.02) / 0.06, 2)), dub = 0.65 * Math.exp(-Math.pow((hbPhase - 0.3) / 0.07, 2));
      hb = sev * (0.28 + 0.72 * Math.min(1, lub + dub));
      const pulse = 1 + 0.1 * Math.min(1, lub + dub) * sev;
      q.hpnum.style.transform = 'scale(' + pulse.toFixed(3) + ')'; q.hpnum._pulsed = true;
    } else if (q.hpnum._pulsed) { q.hpnum.style.transform = ''; q.hpnum._pulsed = false; }
    setOpacity(q.hb, hb);
    // directional indicators
    let any = false;
    for (const it of inds) if (it.life > 0) { any = true; break; }
    if (any && p) {
      game.camera.getWorldDirection(_v);
      let fx = _v.x, fz = _v.z; const fl2 = Math.hypot(fx, fz) || 1; fx /= fl2; fz /= fl2;
      for (const it of inds) {
        if (it.life <= 0) continue;
        it.life -= dt;
        if (it.life <= 0) { it.el.style.display = 'none'; continue; }
        const tx = it.x - p.pos.x, tz = it.z - p.pos.z, tl = Math.hypot(tx, tz) || 1;
        const ang = Math.atan2((-fz * tx + fx * tz) / tl, (fx * tx + fz * tz) / tl) * 57.29578;
        it.el.style.transform = 'rotate(' + ang.toFixed(1) + 'deg)';
        it.el.style.opacity = (Math.min(1, it.life / it.max * 1.8) * it.str).toFixed(2);
      }
    }
  }
  const setOpacity = (el, a) => { a = a < 0.005 ? 0 : a; if (el._o === undefined || Math.abs(el._o - a) > 0.008 || (a === 0 && el._o !== 0)) { el.style.opacity = a.toFixed(3); el._o = a; } };

  function updFlash(dt) {
    if (fl.t <= 0) return;
    fl.t -= dt;
    q.flash.style.opacity = fl.t > 0 ? (fl.peak * Math.pow(fl.t / fl.dur, 1.5)).toFixed(3) : '0';
  }

  function updToasts(dt) {
    for (let i = toasts.length - 1; i >= 0; i--) {
      const t = toasts[i]; t.age += dt;
      if (t.age > t.life && !t.out) { t.out = true; t.el.classList.add('out'); }
      if (t.age > t.life + 0.35) { t.el.remove(); toasts.splice(i, 1); }
    }
  }

  function processKills() {
    if (!pendingKills.length) return;
    while (pendingKills.length) {
      const k = pendingKills.shift(), e = k.enemy;
      const head = !!e && heads.has(e); if (head) heads.delete(e);
      const type = e?.type && ENEMY_NAMES[e.type] ? e.type : (ENEMY_NAMES[k.dmg] ? k.dmg : 'shambler');
      addFeed(type, head, !!k.gibbed);
      combo++; comboT = COMBO_WINDOW;
    }
    q.combo.className = 'hx-combo' + (combo >= 2 ? ' on' : '') + (combo >= 10 ? ' t4' : combo >= 6 ? ' t3' : combo >= 3 ? ' t2' : '');
    if (combo >= 2) { setText(q.cx, 'x' + combo); restart(q.cx, 'bump'); }
  }
  function addFeed(type, head, gib) {
    const boss = type === 'tyrant' || type === 'brute', name = ENEMY_NAMES[type];
    const last = feed[feed.length - 1];
    if (last && last.type === type && last.age < 1.2 && !last.out && last.head === head && last.gib === gib) {
      last.count++; last.age = 0; last.x.textContent = ' ×' + last.count; return;
    }
    const el = document.createElement('div'); el.className = 'hx-kill' + (type === 'tyrant' ? ' boss' : '');
    el.innerHTML = `${ICON_SKULL}<span>${name}</span><span class="x"></span>${head ? '<span class="tag hs">Headshot</span>' : ''}${gib && !head ? '<span class="tag gib">Gibbed</span>' : ''}${type === 'tyrant' ? '<span class="tag boss">Boss</span>' : ''}`;
    q.feed.appendChild(el);
    feed.push({ el, x: el.querySelector('.x'), age: 0, life: boss ? 6 : 4.2, type, head, gib, count: 1, out: false });
    if (feed.length > 5) { const o = feed.shift(); o.el.remove(); }
  }
  function updFeed(dt) {
    for (let i = feed.length - 1; i >= 0; i--) {
      const f = feed[i]; f.age += dt;
      if (f.age > f.life && !f.out) { f.out = true; f.el.classList.add('out'); }
      if (f.age > f.life + 0.4) { f.el.remove(); feed.splice(i, 1); }
    }
    if (combo > 0) {
      comboT -= dt;
      if (comboT <= 0) { combo = 0; q.combo.className = 'hx-combo'; }
      else setScale(q.cbar, comboT / COMBO_WINDOW);
    }
  }

  function updScore(dt) {
    const Wv = game.waves; if (!Wv) return;
    const sc = Wv.score | 0;
    if (sc !== scoreTarget) {
      if (sc > scoreTarget) { deltaAcc += sc - scoreTarget; deltaT = 1.7; } else { scoreShown = sc; deltaAcc = 0; deltaT = 0; }
      scoreTarget = sc;
    }
    scoreShown = Math.abs(scoreShown - scoreTarget) < 1 ? scoreTarget : damp(scoreShown, scoreTarget, 9, dt);
    setText(q.score, pad(Math.round(scoreShown), 6));
    setText(q.kills, 'Kills ' + (Wv.kills | 0));
    if (deltaT > 0) { deltaT -= dt; setText(q.delta, '+' + deltaAcc); q.delta.style.opacity = Math.min(1, deltaT * 2.2).toFixed(2); }
    else if (deltaAcc) { deltaAcc = 0; q.delta.style.opacity = '0'; }
  }

  // ---- events -------------------------------------------------------------------------------------------------------------------
  function hitMarker(kind) {
    const prio = { hit: 1, head: 2, kill: 3 };
    if (hmT > 0 && prio[kind] < hmPrev && hmT > hmDur * 0.35) return;
    hmKind = kind; hmPrev = prio[kind]; hmDur = kind === 'kill' ? 0.42 : kind === 'head' ? 0.24 : 0.16; hmT = hmDur;
    const c = 'hx-hm' + (kind === 'hit' ? '' : ' ' + kind);
    if (q.hm._c !== c) { q.hm.className = c; q.hm._c = c; }
    q.hm.style.opacity = '1';
  }
  bus.on('enemy:hit', (d) => {
    if (!d || d.source === 'enemy') return; // enemy blasts / culls are not the player's hits: no marker, no headshot credit
    if (d.killed && d.part === 'head' && d.enemy) heads.add(d.enemy);
    hitMarker(d.killed ? 'kill' : d.part === 'head' ? 'head' : 'hit');
  });
  bus.on('enemy:killed', (d) => { if (d && d.source !== 'enemy') { pendingKills.push({ enemy: d.enemy, gibbed: d.gibbed, dmg: d.type }); if (pendingKills.length > 30) pendingKills.shift(); hitMarker('kill'); } });
  bus.on('weapon:fire', (d) => { kick = Math.min(26, kick + (KICK[d?.id] ?? 4)); });
  bus.on('player:hurt', (d) => {
    if (!d) return;
    const amt = d.amount || 10;
    vigA = Math.min(0.85, Math.max(vigA, 0.18 + amt / 45));
    q.hp.classList.remove('hit'); void q.hp.offsetWidth; q.hp.classList.add('hit');
    const f = d.from, src = f && f.isVector3 ? f : f && f.pos && f.pos.isVector3 ? f.pos : null;
    if (src) {
      let it = inds.find((x) => x.life <= 0); if (!it) it = inds.reduce((a, b) => (a.life < b.life ? a : b));
      it.x = src.x; it.z = src.z; it.max = it.life = clamp(0.7 + amt / 40, 0.8, 1.6); it.str = clamp(0.55 + amt / 30, 0.6, 1);
      it.el.style.display = 'block';
    }
  });
  bus.on('player:dead', () => { dead = true; root.classList.add('dead'); vigA = 0.9; });
  bus.on('pickup', (d) => {
    if (!d) return;
    const kind = d.kind || '';
    if (kind.startsWith('weapon_')) { const id = kind.slice(7); H.toast(`${WEAPON_NAMES[id] || id} acquired`, { key: kind, color: 'var(--amber)', big: true, life: 2.6 }); return; }
    const [label, color] = PICKUP[kind] || [kind.replace(/_/g, ' '), 'var(--amber)'];
    H.toast(label, { key: kind, color, amount: d.amount });
  });

  // ---- public API ---------------------------------------------------------------------------------------------------------------
  const H = {
    get visible() { return visible; },
    show() { visible = true; root.classList.remove('hidden'); },
    hide() { visible = false; root.classList.add('hidden'); },
    // Big centred wave banner. Newer banners replace the current one.
    banner(text, sub = '', seconds = 2.5) {
      const b = q.banner;
      b.classList.remove('show'); b.dataset.tone = tone(text);
      q.bt.textContent = text; q.bs.textContent = sub || ''; q.bs.style.display = sub ? '' : 'none';
      b.style.setProperty('--dur', Math.max(0.6, seconds) + 's');
      void b.offsetWidth; b.classList.add('show');
    },
    // Full-screen colour flash that fades out over `seconds`.
    flash(color = '#ffffff', intensity = 0.5, seconds = 0.4) {
      intensity = clamp(intensity, 0, 1); seconds = Math.max(0.05, seconds);
      const now = fl.t > 0 ? fl.peak * Math.pow(fl.t / fl.dur, 1.5) : 0;
      if (intensity < now * 0.9) return;
      q.flash.style.background = color; fl.peak = intensity; fl.t = fl.dur = seconds;
      q.flash.style.opacity = intensity.toFixed(3);
    },
    // Small pickup-style toast above the weapon row. opts: {key (merge key), color, amount, life, big}
    toast(text, opts = {}) {
      const key = opts.key || text, amt = opts.amount;
      const ex = toasts.find((t) => t.key === key && t.age < 1.6 && !t.out);
      if (ex && amt != null) { ex.amount += amt; ex.b.textContent = '+' + ex.amount; ex.age = 0; restart(ex.el, 'bump'); return ex; }
      const el = document.createElement('div'); el.className = 'hx-toast' + (opts.big ? ' big' : ''); if (opts.color) el.style.setProperty('--c', opts.color);
      el.innerHTML = `${amt != null ? '<b></b>' : ''}<span></span>`;
      const b = el.querySelector('b'); if (b) b.textContent = '+' + amt;
      el.querySelector('span').textContent = text;
      q.toasts.appendChild(el);
      const t = { el, b, key, amount: amt || 0, age: 0, life: opts.life || 2.2, out: false };
      toasts.push(t);
      if (toasts.length > 4) { const o = toasts.shift(); o.el.remove(); }
      return t;
    },
    hitMarker,
    reset() {
      dead = false; root.classList.remove('dead'); T = 0;
      dispHP = lastHP = game.player?.health ?? 100; fillF = ghostF = clamp(dispHP / (game.player?.maxHealth || 100), 0, 1); ghostDelay = 0; hpCls = ''; q.hp.classList.remove('warn', 'crit', 'hit'); dispAR = 0;
      dispId = null; kick = 0; gap = 5; lastGap = -1; hmT = 0; hmPrev = 0; q.hm.style.opacity = '0';
      vigA = deadA = 0; hbPhase = 0; setOpacity(q.vig, 0); setOpacity(q.hb, 0); q.hpnum.style.transform = ''; q.hpnum._pulsed = false;
      for (const it of inds) { it.life = 0; it.el.style.display = 'none'; }
      fl.t = 0; q.flash.style.opacity = '0';
      for (const t of toasts) t.el.remove(); toasts.length = 0;
      for (const f of feed) f.el.remove(); feed.length = 0; pendingKills.length = 0;
      combo = 0; comboT = 0; q.combo.className = 'hx-combo'; scoreShown = scoreTarget = 0; deltaAcc = 0; deltaT = 0; q.delta.style.opacity = '0'; lastLeft = -1; trainKey = ''; boss = null; bossScan = 0; q.boss.classList.remove('on');
      q.banner.classList.remove('show'); q.banner.style.opacity = '';
      setText(q.score, '000000'); setText(q.kills, 'Kills 0');
    },
    update(dt) {
      if (!visible) return;
      const paused = game.state === 'paused';
      if (paused !== wasPaused) { root.classList.toggle('paused', paused); wasPaused = paused; }
      if (paused) return;
      dt = Math.min(dt, 0.1); T += dt;
      processKills();
      updVitals(dt); updArms(); updTop(); updBoss(dt); updCross(dt); updDamage(dt); updFlash(dt); updToasts(dt); updFeed(dt); updScore(dt);
    },
  };
  // expose the vignette/heartbeat layers under short names used above
  q.vig = root.querySelector('.hx-vig'); q.hb = root.querySelector('.hx-hb');
  return H;
}
