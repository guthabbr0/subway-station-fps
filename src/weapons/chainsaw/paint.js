// Procedural textures / materials that are specific to the chainsaw: glossy safety-orange powerhead paint (clear-coated, scuffed, chipped) and
// the dark carbon-look plastic. Built once and shared through game.__sawPaint.
import * as THREE from 'three';
import { bloodify } from './blood.js';

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function orangeCanvas() {
  const W = 512, c = document.createElement('canvas'); c.width = c.height = W; const g = c.getContext('2d', { willReadFrequently: true }), r = rng(4242);
  // base: safety orange with a soft vertical falloff + big low-frequency mottling
  g.fillStyle = '#e4531b'; g.fillRect(0, 0, W, W);
  for (let i = 0; i < 46; i++) { const x = r() * W, y = r() * W, rad = 40 + r() * 140, gr = g.createRadialGradient(x, y, 0, x, y, rad); const l = r() < 0.5; gr.addColorStop(0, l ? 'rgba(255,150,70,0.10)' : 'rgba(120,30,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
  const wrap = (fn) => { for (const ox of [-W, 0, W]) for (const oy of [-W, 0, W]) fn(ox, oy); };
  // fine scuffs (short random-direction scratches: isotropic so the box-projected UVs never look striped)
  for (let i = 0; i < 380; i++) {
    const x = r() * W, y = r() * W, a = r() * 6.283, l = 4 + r() * 22, light = r() < 0.55;
    g.strokeStyle = light ? `rgba(255,190,120,${0.05 + r() * 0.14})` : `rgba(70,20,5,${0.06 + r() * 0.16})`; g.lineWidth = 0.6 + r() * 1.1;
    wrap((ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke(); });
  }
  // deep scratches down to bare steel
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y = r() * W, a = r() * 6.283, l = 20 + r() * 60; g.strokeStyle = `rgba(190,196,205,${0.25 + r() * 0.35})`; g.lineWidth = 0.7 + r();
    wrap((ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l * 0.5); g.stroke(); });
  }
  // paint chips: dark undercoat with a bright steel rim
  for (let i = 0; i < 70; i++) {
    const x = r() * W, y = r() * W, rx = 0.8 + r() * 3.2, ry = 0.6 + r() * 2.4, rot = r() * 3;
    wrap((ox, oy) => { g.fillStyle = 'rgba(28,26,26,0.92)'; g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, rot, 0, 6.283); g.fill(); g.strokeStyle = 'rgba(200,205,215,0.55)'; g.lineWidth = 0.6; g.beginPath(); g.ellipse(x + ox, y + oy, rx + 0.6, ry + 0.6, rot, 0.4, 3.1); g.stroke(); });
  }
  // oil / fuel grime blooms and a few old dried blood specks
  for (let i = 0; i < 16; i++) { const x = r() * W, y = r() * W, rad = 10 + r() * 40, gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(24,14,6,0.28)'); gr.addColorStop(1, 'rgba(24,14,6,0)'); wrap((ox, oy) => { g.fillStyle = gr; g.save(); g.translate(ox, oy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore(); }); }
  for (let i = 0; i < 14; i++) { const x = r() * W, y = r() * W; g.fillStyle = `rgba(${70 + r() * 30},6,6,${0.35 + r() * 0.3})`; wrap((ox, oy) => { g.beginPath(); g.arc(x + ox, y + oy, 0.8 + r() * 2.2, 0, 6.283); g.fill(); }); }
  // speckle
  const img = g.getImageData(0, 0, W, W), d = img.data; for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 16; d[i] += n; d[i + 1] += n * 0.7; d[i + 2] += n * 0.5; } g.putImageData(img, 0, 0);
  return c;
}

export function getSawPaint(game, kit) {
  if (game.__sawPaint) return game.__sawPaint;
  const tex = new THREE.CanvasTexture(orangeCanvas()); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4;
  const P = { tex };
  P.makeOrange = (U) => bloodify(new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.46, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.16, envMap: kit.env, envMapIntensity: 1.15 }), U, { key: 'paint' });
  P.userDataUV = 5;
  return (game.__sawPaint = P);
}
