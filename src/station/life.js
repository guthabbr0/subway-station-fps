// "Lived-in" extras: buzzing neon signs on the far walls, rats scurrying along the track bed, dangling severed cables.
import * as THREE from 'three';
import { MB } from './mb.js';
import { cv, mkTex, radialTex } from '../textures.js';
import { drawText } from './graphics.js';
import { WZ } from './structure.js';
import { mulberry32 } from '../texutil.js';

const W3 = [1, 1, 1];

export function buildLife(c) {
  const L = {}; neon(c, L); rats(c, L); cables(c);
  c.dynamic.push((dt, t) => { L.updateNeon(dt, t); L.updateRats(dt, t); });
  return L;
}

// ---------------------------------------------------------------------------------------------------------- neon
function neonCanvas(w, h, lines, bg = '#07080b') {
  const cvs = cv(w, h), ctx = cvs.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 3; ctx.strokeRect(6, 6, w - 12, h - 12);
  for (const l of lines) {
    ctx.save(); ctx.shadowColor = l.glow; ctx.shadowBlur = 22; drawText(ctx, l.t, w / 2, l.y, l.px, l.col, { ls: l.ls || 4, stroke: l.glow, sw: 3, maxW: w - 50 }); ctx.restore();
    drawText(ctx, l.t, w / 2, l.y, l.px, '#fff6ea', { ls: l.ls || 4, maxW: w - 50, w: '300' });
  }
  ctx.strokeStyle = lines[0].glow; ctx.lineWidth = 4; ctx.shadowColor = lines[0].glow; ctx.shadowBlur = 16; ctx.beginPath(); ctx.roundRect(16, 16, w - 32, h - 32, 18); ctx.stroke();
  return cvs;
}

function neon(c, L) {
  const defs = [
    { x: -20, z: WZ, nz: -1, y: 4.35, w: 2.9, h: 1.1, glow: '#ff5020', lines: [{ t: 'ZERO BURGER', y: 78, px: 74, col: '#ff5a24', glow: '#ff3a10', ls: 6 }, { t: 'OPEN 24 HRS', y: 150, px: 44, col: '#ffd23a', glow: '#ffb000', ls: 8 }], flicker: 1, tint: [1.0, 0.36, 0.12] },
    { x: 17, z: -WZ, nz: 1, y: 4.3, w: 2.6, h: 1.0, glow: '#26e6ff', lines: [{ t: 'LAST CALL', y: 74, px: 80, col: '#26e6ff', glow: '#00c8ff', ls: 8 }, { t: 'BAR  ·  NO CLOSING', y: 146, px: 38, col: '#ff4fd8', glow: '#ff2fc8', ls: 5 }], flicker: 2, tint: [0.16, 0.85, 1.0] },
  ];
  L.neons = defs.map((d, i) => {
    const tex = mkTex(neonCanvas(512, Math.round(512 * d.h / d.w), d.lines), { srgb: true, repeat: false });
    const mat = new THREE.MeshBasicMaterial({ map: tex, fog: true, color: new THREE.Color(1.5, 1.5, 1.5), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const m = new MB(1); m.oq(d.x, d.y, d.z + d.nz * 0.053, 0, 0, d.nz, d.w, d.h, [0, 0, 1, 1], { c: W3 });
    c.mb('dark').box(d.x - d.w / 2 - 0.04, d.y - d.h / 2 - 0.04, d.nz > 0 ? d.z : d.z - 0.05, d.x + d.w / 2 + 0.04, d.y + d.h / 2 + 0.04, d.nz > 0 ? d.z + 0.05 : d.z, { c: [0.1, 0.1, 0.12] });
    const geo = m.build(); const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.userData.layer = 'signs'; c.add(mesh);
    // wall spill glow (additive)
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(d.w * 2.6, d.h * 3.2), new THREE.MeshBasicMaterial({ map: radialTex(64, [[0, 'rgba(255,255,255,0.55)'], [0.5, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]), color: new THREE.Color(...d.tint).multiplyScalar(0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
    spill.position.set(d.x, d.y, d.z + d.nz * 0.04); spill.rotation.y = d.nz > 0 ? 0 : Math.PI; spill.renderOrder = 2; c.add(spill);
    return { mat, spill, d, ph: i * 7.3 };
  });
  L.updateNeon = (dt, t) => {
    for (let i = 0; i < L.neons.length; i++) {
      const n = L.neons[i]; let v = 1;
      const s = Math.sin(t * 1.7 + n.ph) + Math.sin(t * 4.1 + n.ph * 2) + Math.sin(t * 0.63 + n.ph * 3);
      if (n.d.flicker === 1) { if (s > 1.7) v = Math.sin(t * 60) > 0 ? 1 : 0.15; else v = 0.94 + 0.06 * Math.sin(t * 90); }
      else { const ph = (t + n.ph) % 7; if (ph < 0.5) v = 0.2 + 0.8 * (Math.sin(t * 40) > 0 ? 1 : 0); else v = 0.96; }
      n.mat.color.setScalar(1.5 * v); n.spill.material.color.setRGB(n.d.tint[0] * 0.55 * v, n.d.tint[1] * 0.55 * v, n.d.tint[2] * 0.55 * v);
    }
  };
}

// ---------------------------------------------------------------------------------------------------------- rats
function rats(c, L) {
  const rnd = mulberry32(4242), N = 7, mb = new MB(1);
  mb.box(-0.1, 0.0, -0.032, 0.09, 0.062, 0.032, { c: W3 }); mb.box(0.09, 0.006, -0.022, 0.16, 0.048, 0.022, { c: [1.1, 1, 1] });
  mb.box(0.16, 0.014, -0.008, 0.185, 0.036, 0.008, { c: [1.5, 1.2, 1.2] }); mb.box(0.1, 0.05, -0.03, 0.12, 0.075, -0.012, { c: [1.2, 1, 1] }); mb.box(0.1, 0.05, 0.012, 0.12, 0.075, 0.03, { c: [1.2, 1, 1] });
  mb.box(-0.32, 0.01, -0.005, -0.1, 0.02, 0.005, { c: [1.6, 1.2, 1.2] });
  const im = new THREE.InstancedMesh(mb.build(), new THREE.MeshStandardMaterial({ color: 0x2a201b, roughness: 0.85, vertexColors: true, envMapIntensity: 0.6 }), N);
  im.frustumCulled = false; c.add(im);
  const st = [], mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) st.push({ x: (rnd() - 0.5) * 60, z: (i % 2 ? -1 : 1) * (6.6 + (rnd() - 0.5) * 2.2), dir: rnd() < 0.5 ? -1 : 1, sp: 1.3 + rnd() * 1.8, pause: rnd() * 6, ph: rnd() * 6 });
  L.updateRats = (dt, t) => {
    for (let i = 0; i < N; i++) {
      const r = st[i];
      if (r.pause > 0) r.pause -= dt; else { r.x += r.dir * r.sp * dt; if (Math.abs(r.x) > 62) { r.dir = -r.dir; r.pause = 1 + Math.random() * 5; } else if (Math.random() < dt * 0.15) r.pause = 0.4 + Math.random() * 2; }
      const moving = r.pause <= 0, hop = moving ? Math.abs(Math.sin(r.x * 9 + r.ph)) * 0.018 : 0;
      p.set(r.x, -1.25 + 0.005 + hop, r.z + Math.sin(r.x * 0.7 + r.ph) * (moving ? 0.05 : 0));
      q.setFromAxisAngle(up, r.dir > 0 ? 0 : Math.PI); if (!moving) q.setFromAxisAngle(up, (r.dir > 0 ? 0 : Math.PI) + Math.sin(t * 1.3 + r.ph) * 0.4);
      mtx.compose(p, q, sc); im.setMatrixAt(i, mtx);
    }
    im.instanceMatrix.needsUpdate = true;
  };
}

// ---------------------------------------------------------------------------------------------------------- cables
function cables(c) {
  const cab = c.mb('cable'), steel = c.mb('steel'), rnd = mulberry32(99);
  const catenary = (x0, z0, x1, z1, y, sag, col, r = 0.02) => {
    let prev = null; for (let i = 0; i <= 10; i++) { const t = i / 10, p = [x0 + (x1 - x0) * t, y - sag * 4 * t * (1 - t), z0 + (z1 - z0) * t]; if (prev) cab.cyl(prev[0], prev[1], prev[2], p[0], p[1], p[2], r, { segs: 5, c: col }); prev = p; }
  };
  const dangle = (x, z, len, col) => { let px = x, py = 6.92, pz = z; for (let i = 1; i <= 6; i++) { const nx = x + (rnd() - 0.5) * 0.12 * i, ny = 6.92 - len * i / 6, nz = z + (rnd() - 0.5) * 0.12 * i; cab.cyl(px, py, pz, nx, ny, nz, 0.018, { segs: 5, c: col }); px = nx; py = ny; pz = nz; } c.mb('brass').box(px - 0.012, py - 0.04, pz - 0.012, px + 0.012, py, pz + 0.012, { c: W3 }); };
  const cols = [[0.05, 0.05, 0.06], [0.5, 0.06, 0.05], [0.06, 0.1, 0.4], [0.5, 0.45, 0.05]];
  // stair ceiling + pit ceilings: sagging runs and severed loose ends
  catenary(-27.6, -3.2, -24.2, -1.6, 6.85, 0.7, cols[0]); catenary(-27.4, -3.0, -24.0, -1.4, 6.85, 0.9, cols[1]); catenary(-26.9, 3.6, -23.1, 2.4, 6.85, 0.8, cols[2]);
  for (let i = 0; i < 4; i++) dangle(-26.2 + i * 0.08, 0.7 + (i % 2) * 0.1, 1.3 + rnd() * 0.9, cols[i % 4]);
  c.mb('steel').box(-26.5, 6.8, 0.45, -25.7, 7.0, 1.05, { c: [0.3, 0.3, 0.33] });
  catenary(-8, -9.3, 2, -9.6, 6.9, 0.55, cols[0], 0.025); catenary(12, 9.2, 22, 9.5, 6.9, 0.6, cols[3], 0.025);
  for (let i = 0; i < 3; i++) dangle(18.5 + i * 0.1, 9.4, 1.0 + rnd() * 0.7, cols[(i + 1) % 4]);
  for (let i = 0; i < 3; i++) dangle(-3.0 + i * 0.09, -9.5, 0.9 + rnd() * 0.8, cols[i % 4]);
  c.mb('steel').box(18.1, 6.8, 9.2, 19.0, 7.0, 9.7, { c: [0.3, 0.3, 0.33] }); c.mb('steel').box(-3.4, 6.8, -9.8, -2.6, 7.0, -9.3, { c: [0.3, 0.3, 0.33] });
}
