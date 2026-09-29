// Black-box hunt tooling (see perf/BLACKBOX.md): a HUMAN BISECT FACILITY for rendering problems that cannot be reproduced on the software rasteriser.
//
//   F4 (or F8)  cycle isolation modes (Shift+F4 backwards); an on-screen label names the active one. Start in one with ?bb=<0-8>.
//               0 normal   1 no bloom   2 NO post-processing (scene drawn straight to the canvas)   3 first-person weapon hidden   4 particles / decals / vfx hidden
//               5 HUD + DOM overlays hidden   6 shader patches + vfx lights off   7 DPR 1 and no adaptive quality   8 everything of 2-7 at once
//   F3        overlay (fps, GPU, buffer sizes, targets, memory, quality events, context losses, shader / GL problems)      F6 (or F9)   copy diagnostics (compact JSON) to the clipboard
// Everything here is passive until a key is pressed (error capture is two console wrappers), and works through switches the renderer already has (Post.direct / hideWeapon / hide / dim,
// game.pipeline.override, material.defines.BB_NOPATCH), so a mode never changes the game state.
export const MODES = [
  { id: 0, label: 'normal' },
  { id: 1, label: 'NO BLOOM' },
  { id: 2, label: 'NO POST-PROCESSING (scene drawn directly to the canvas; shaders recompile: wait a few seconds)' },
  { id: 3, label: 'FIRST-PERSON WEAPON HIDDEN' },
  { id: 4, label: 'PARTICLES / DECALS / VFX HIDDEN' },
  { id: 5, label: 'HUD + DOM OVERLAYS HIDDEN' },
  { id: 6, label: 'SHADER PATCHES + VFX LIGHTS OFF (recompiling shaders: wait a few seconds)' },
  { id: 7, label: 'DPR 1 + NO ADAPTIVE QUALITY' },
  { id: 8, label: 'EVERYTHING OFF (2 + 3 + 4 + 5 + 6 + 7)' },
];
const GL_ERR = { 0x500: 'INVALID_ENUM', 0x501: 'INVALID_VALUE', 0x502: 'INVALID_OPERATION', 0x505: 'OUT_OF_MEMORY', 0x506: 'INVALID_FRAMEBUFFER_OPERATION', 0x9242: 'CONTEXT_LOST_WEBGL' };
const FB_STATUS = { 0x8CD6: 'INCOMPLETE_ATTACHMENT', 0x8CD7: 'INCOMPLETE_MISSING_ATTACHMENT', 0x8CD9: 'INCOMPLETE_DIMENSIONS', 0x8CDD: 'UNSUPPORTED', 0x8D56: 'INCOMPLETE_MULTISAMPLE' };
const EXT_OF_INTEREST = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'EXT_float_blend', 'KHR_parallel_shader_compile', 'EXT_texture_filter_anisotropic', 'WEBGL_lose_context', 'EXT_disjoint_timer_query_webgl2', 'WEBGL_compressed_texture_s3tc', 'OVR_multiview2'];

export function create(game) {
  const params = game.params, renderer = game.renderer;
  const B = { mode: 0, MODES, errors: [], errCount: {}, shaderErrors: [], glErr: { count: 0, last: '' }, ctx: { lost: 0, restored: 0, prevLost: 0, prevReloads: 0, lastAt: '' }, note: '', flags: {} };
  const now = () => +(performance.now() / 1000).toFixed(1);
  const clip = (m, n = 400) => { m = String(m); return m.length > n ? m.slice(0, n) + '...' : m; };

  // ---- error capture (console.warn / error, uncaught exceptions, rejected promises, shader compile / link problems) -------------------------------
  B.push = (kind, msg) => { B.errors.push({ t: now(), kind, msg: clip(msg) }); if (B.errors.length > 40) B.errors.shift(); B.errCount[kind] = (B.errCount[kind] || 0) + 1; };
  for (const k of ['warn', 'error']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => { try { B.push(k, a.map((x) => (x && x.message) || (typeof x === 'object' ? '[object]' : String(x))).join(' ')); } catch (e) { /* never break logging */ } orig(...a); };
  }
  addEventListener('error', (e) => B.push('exception', `${e.message} @${String(e.filename || '').split('/').pop()}:${e.lineno}`));
  addEventListener('unhandledrejection', (e) => B.push('rejection', (e.reason && (e.reason.message || e.reason)) || 'unhandled rejection'));
  // three calls this for a program that fails to LINK; a compile-only problem shows up as a non-empty info log on a program that still runs (three logs those as console.warn)
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const e = { t: now(), link: clip(gl.getProgramInfoLog(program) || '', 500), vertex: clip(gl.getShaderInfoLog(vs) || '', 500), fragment: clip(gl.getShaderInfoLog(fs) || '', 700) };
    B.shaderErrors.push(e); if (B.shaderErrors.length > 12) B.shaderErrors.shift();
    console.error('THREE.WebGLProgram: shader program failed to link\nProgram Info Log: ' + (gl.getProgramInfoLog(program) || '') + '\nVertex: ' + (gl.getShaderInfoLog(vs) || '') + '\nFragment: ' + (gl.getShaderInfoLog(fs) || ''));
  };
  // after the warm-up (links are forced there) every program's diagnostics are available: report the ones that are not runnable
  B.scanPrograms = () => {
    let bad = 0; for (const p of renderer.info.programs || []) { const d = p.diagnostics; if (d && d.runnable === false) bad++; }
    return bad;
  };
  B.pollGL = () => { try { const gl = renderer.getContext(), e = gl.getError(); if (e) { B.glErr.count++; B.glErr.last = GL_ERR[e] || ('0x' + e.toString(16)); B.push('gl', B.glErr.last); } } catch (e) { /* lost */ } };

  // ---- context loss counters survive the reload that follows a loss (sessionStorage) ----------------------------------------------------------
  try { const s = JSON.parse(sessionStorage.getItem('bb.ctx') || 'null'); if (s) { B.ctx.prevLost = s.lost | 0; B.ctx.prevReloads = s.reloads | 0; B.ctx.lastAt = s.at || ''; } } catch (e) { /* storage blocked */ }
  B.ctxEvent = (kind) => {
    B.ctx[kind]++; B.ctx.lastAt = new Date().toISOString();
    try { const s = JSON.parse(sessionStorage.getItem('bb.ctx') || '{}'); if (kind === 'lost') s.lost = (s.lost | 0) + 1; s.at = B.ctx.lastAt; sessionStorage.setItem('bb.ctx', JSON.stringify(s)); } catch (e) { /* ignore */ }
    B.push('context', kind);
  };
  B.noteReload = () => { try { const s = JSON.parse(sessionStorage.getItem('bb.ctx') || '{}'); s.reloads = (s.reloads | 0) + 1; s.tReload = Date.now(); sessionStorage.setItem('bb.ctx', JSON.stringify(s)); return s; } catch (e) { return {}; } };

  // ---- label / toast ---------------------------------------------------------------------------------------------------------------------------
  let label = null, toastUntil = 0, toastText = '';
  const ensureLabel = () => {
    if (label) return label;
    const st = document.createElement('style'); st.id = 'bb-style';
    st.textContent = 'html.bb-nohud #hud, html.bb-nohud #hud * { opacity: 0 !important; }'
      + '#bb-label { position: fixed; left: 50%; bottom: 110px; transform: translateX(-50%); z-index: 60; pointer-events: none; padding: 5px 12px; font: 600 13px/1.3 ui-monospace, Consolas, Menlo, monospace; color: #ffe27a; background: rgba(16, 26, 70, .92); border: 2px solid #7fd4ff; border-radius: 4px; letter-spacing: .04em; text-align: center; max-width: 92vw; display: none; white-space: pre-wrap; }'
      + '#bb-panel { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 70; width: min(760px, 92vw); padding: 10px; background: rgba(16, 26, 70, .96); border: 2px solid #7fd4ff; color: #e8f4ff; font: 12px/1.4 ui-monospace, Consolas, monospace; }'
      + '#bb-panel textarea { width: 100%; height: 210px; background: #08102a; color: #cfe8ff; border: 1px solid #446; font: 11px/1.35 ui-monospace, Consolas, monospace; }';
    document.head.appendChild(st);
    label = document.createElement('div'); label.id = 'bb-label'; document.body.appendChild(label); return label;
  };
  const refreshLabel = () => {
    const el = ensureLabel(), lines = [];
    if (B.mode) lines.push(`ISOLATION MODE ${B.mode}/${MODES.length - 1}: ${MODES[B.mode].label}`, 'F4 next  -  Shift+F4 previous  -  F6 copy diagnostics');
    if (performance.now() < toastUntil) lines.push(toastText);
    el.textContent = lines.join('\n'); el.style.display = lines.length ? 'block' : 'none';
  };
  B.toast = (text, ms = 4000) => { toastText = text; toastUntil = performance.now() + ms; refreshLabel(); setTimeout(refreshLabel, ms + 50); };

  // ---- isolation modes ----------------------------------------------------------------------------------------------------------------------------
  const P = () => game.perf, post = () => game.post, pipe = () => game.pipeline;
  let savedAdaptive = null, patchTimer = 0;
  const materialsOf = (fn) => { const seen = new Set(); for (const root of [game.scene, game.viewScene]) root.traverse((o) => { const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) if (!seen.has(m)) { seen.add(m); fn(m); } }); };
  const setNoPatch = (on) => {
    let n = 0;
    materialsOf((m) => {
      if (m.isShaderMaterial || m.isRawShaderMaterial) return; const has = !!(m.defines && 'BB_NOPATCH' in m.defines);
      if (on && !has) { m.defines = { ...(m.defines || {}), BB_NOPATCH: '' }; m.needsUpdate = true; n++; } else if (!on && has) { delete m.defines.BB_NOPATCH; m.needsUpdate = true; n++; }
    });
    return n;
  };
  const wantsOff = (k) => B.mode === 8 || B.mode === k;
  B.apply = () => { // (re)applies the switches of the current mode; idempotent
    const p = post(), pl = pipe(); if (!p || !pl) return;
    p.direct = wantsOff(2); p.hideWeapon = wantsOff(3); p.hide = wantsOff(4) && game.bbVfx && game.bbVfx.length ? game.bbVfx : null; p.dim = wantsOff(6) && game.bbLights && game.bbLights.length ? game.bbLights : null;
    document.documentElement.classList.toggle('bb-nohud', wantsOff(5));
    const stopAdapt = B.mode === 1 || wantsOff(7) || wantsOff(2);
    if (stopAdapt && savedAdaptive === null) { savedAdaptive = P().adaptive; P().adaptive = false; } else if (!stopAdapt && savedAdaptive !== null) { P().adaptive = savedAdaptive; savedAdaptive = null; }
    pl.override.bloom = B.mode === 1 || wantsOff(2) ? 'off' : null; pl.override.dpr = wantsOff(7) ? 1 : 0;
    if (wantsOff(6)) { setNoPatch(true); clearInterval(patchTimer); patchTimer = setInterval(() => { if (wantsOff(6)) setNoPatch(true); }, 1500); } // (materials created later get the define too)
    else { clearInterval(patchTimer); setNoPatch(false); }
    pl.refresh();
  };
  // The label is painted first (a mode switch may recompile every shader = a multi-second freeze on a real GPU), the switches are applied one frame later; `sync` = tools / tests.
  B.set = (n, sync = false) => { B.mode = ((n % MODES.length) + MODES.length) % MODES.length; refreshLabel(); if (sync) B.apply(); else { const m = B.mode; requestAnimationFrame(() => setTimeout(() => { if (B.mode === m) B.apply(); }, 30)); } return B.mode; };
  B.next = (d = 1) => B.set(B.mode + d);
  B.boot = () => {
    const q = params.get('bb'); if (q !== null && q !== '' && +q > 0) B.set(+q, true);
    if (!game.testMode && !navigator.webdriver && /swiftshader|llvmpipe|softpipe|software|microsoft basic/i.test(String(B.gpuInfo().renderer))) B.toast('WARNING: the browser is rendering WebGL in SOFTWARE (' + B.gpuInfo().renderer + '). Enable hardware acceleration in the browser settings, then reload.', 12000);
  };

  // ---- diagnostics -----------------------------------------------------------------------------------------------------------------------------------
  B.gpuInfo = () => {
    const gl = renderer.getContext(); const g = {}; try {
      const e = gl.getExtension('WEBGL_debug_renderer_info'); g.renderer = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); g.vendor = e ? gl.getParameter(e.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      g.webgl = gl.getParameter(gl.VERSION); g.glsl = gl.getParameter(gl.SHADING_LANGUAGE_VERSION); g.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE); g.maxRB = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
      const pr = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE); g.pointSize = pr ? [pr[0], pr[1]] : null; g.maxFragUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS); g.maxVertTex = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS); g.maxCombinedTex = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS); g.maxVarying = gl.getParameter(gl.MAX_VARYING_VECTORS);
      const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS); g.maxViewport = vp ? [vp[0], vp[1]] : null; g.maxAniso = renderer.capabilities.getMaxAnisotropy(); g.precision = renderer.capabilities.precision;
      g.exts = EXT_OF_INTEREST.filter((n) => renderer.extensions.has(n)); g.attrs = gl.getContextAttributes && (({ alpha, antialias, depth, stencil, powerPreference, preserveDrawingBuffer }) => ({ alpha, antialias, depth, stencil, powerPreference, preserveDrawingBuffer }))(gl.getContextAttributes() || {});
    } catch (e) { g.error = String(e && e.message); }
    return g;
  };
  B.diag = () => {
    const p = post(), P_ = P(), pl = pipe(), r = renderer, gl = r.getContext(), sz = r.getDrawingBufferSize(new game.THREE.Vector2());
    let stat = {}; try { stat = p ? p.status() : {}; } catch (e) { stat = { error: String(e && e.message) }; }
    const st = P_ && P_.stats ? P_.stats() : {};
    let ctxLost = false; try { ctxLost = gl.isContextLost(); } catch (e) { /* ignore */ }
    return {
      v: 2, t: new Date().toISOString(), url: location.search, ua: navigator.userAgent, platform: navigator.platform, cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory,
      gpu: B.gpuInfo(),
      display: { css: [innerWidth, innerHeight], screen: [screen.width, screen.height], dpr: window.devicePixelRatio, buffer: [sz.x, sz.y], canvas: [r.domElement.width, r.domElement.height], pr: +r.getPixelRatio().toFixed(3), hidden: document.hidden, ctxLost },
      cap: pl ? { mpx: pl.capMpx, reason: pl.reason, mpxNow: +(sz.x * sz.y / 1e6).toFixed(2), sizesOk: pl.verify().length === 0, problems: pl.verify().slice(0, 4) } : null,
      hdr: p ? { every: p.probeEvery, runs: p.hdr.runs, badFrames: p.hdr.badFrames, maxEver: +p.hdr.maxEver.toFixed(1), cur: p.hdr.cur, last: p.hdr.last, error: p.hdr.error } : null,
      rt: p ? { type: p.type === game.THREE.HalfFloatType ? 'half' : p.type === game.THREE.FloatType ? 'float' : 'rgba8', sanitize: p.sanitize, bloom: p.mode, passes: p.passList().map((q) => `${q.name} ${q.w}x${q.h}`), mb: +(p.memoryBytes() / 1048576).toFixed(1), incomplete: Object.fromEntries(Object.entries(stat).map(([k, v]) => [k, FB_STATUS[v] || v])), frames: p.frames } : null,
      quality: P_ ? { name: P_.name(), level: P_.level, adaptive: P_.adaptive, steps: P_.steps, weak: P_.weakGpu, log: (P_.log || []).slice(-6) } : null,
      shaders: { patches: game.shaderPatches && game.shaderPatches.applied, requested: game.shaderPatches && game.shaderPatches.requested, programs: (r.info.programs || []).length, notRunnable: B.scanPrograms(), errors: B.shaderErrors.slice(-4) },
      mode: { id: B.mode, label: MODES[B.mode].label }, ctx: B.ctx, glErr: B.glErr, errCount: B.errCount, errors: B.errors.slice(-10),
      perf: st ? { fps: +(st.fps || 0).toFixed(1), ms: +(st.ms || 0).toFixed(1), p95: +(st.p95 || 0).toFixed(1), draws: P_ && P_.calls, tris: P_ && P_.tris } : null,
      game: { state: game.state, wave: game.waves && game.waves.wave, alive: game.enemies && game.enemies.aliveCount && game.enemies.aliveCount(), weapon: game.weapons && game.weapons.current && game.weapons.current.id, hp: game.player && game.player.health },
      boot: game.perf && game.perf.boot, note: B.note,
    };
  };
  const fallbackCopy = (text) => {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(ta); ta.focus(); ta.select(); const ok = document.execCommand && document.execCommand('copy'); ta.remove(); return !!ok; } catch (e) { return false; }
  };
  const showPanel = (text) => {
    let el = document.getElementById('bb-panel'); if (el) el.remove();
    el = document.createElement('div'); el.id = 'bb-panel';
    el.innerHTML = '<div style="margin-bottom:6px;color:#ffe27a">Could not access the clipboard. Select all (Ctrl+A), copy (Ctrl+C) and paste it to the developers. Click outside / press F6 again to close.</div>';
    const ta = document.createElement('textarea'); ta.readOnly = true; ta.value = text; el.appendChild(ta); document.body.appendChild(el); ta.focus(); ta.select();
    try { document.exitPointerLock && document.exitPointerLock(); } catch (e) { /* ignore */ }
  };
  B.copyDiag = async () => {
    const old = document.getElementById('bb-panel'); if (old) { old.remove(); return; }
    let text = ''; try { text = JSON.stringify(B.diag()); } catch (e) { text = JSON.stringify({ error: String(e && e.message) }); }
    console.log('[diag] ' + text); B.lastDiag = text;
    let ok = false; try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
    if (!ok) ok = fallbackCopy(text);
    if (ok) B.toast(`Diagnostics copied to the clipboard (${text.length} chars): paste them into the chat`); else { showPanel(text); B.toast('Clipboard blocked: diagnostics shown in a box'); }
    return text;
  };
  addEventListener('keydown', (e) => {
    // (F8 / F9 are aliases in case a browser keeps F4 / F6 for itself)
    if ((e.code === 'F4' || e.code === 'F8') && !e.altKey && !e.ctrlKey) { e.preventDefault(); B.next(e.shiftKey ? -1 : 1); }
    else if (e.code === 'F6' || e.code === 'F9') { e.preventDefault(); B.copyDiag(); }
  });
  return B;
}
