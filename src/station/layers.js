// Scene-layer isolation for HUMAN bisecting of rendering artefacts ("a black box that keeps appearing"): F7 hides ONE category of scene content at a time
// (Shift+F7 goes back), `?layer=<name|number>` starts in a mode. Works through `material.visible` (three skips those draws) so it survives the owners toggling
// `object.visible` every frame (enemies, pickups, the train), never recompiles a shader and never touches game state.
//
//   0 all visible           1 cones (light shafts)        2 halos (glow points / sprites)      3 pools (floor light pools, ripples, neon spill)
//   4 fx (dust, steam, drips, sparks)                     5 decals (station decals, blood, graffiti, puddles, glass)   6 signs (sign / ad / poster atlases, neon, clock, boards)
//   7 enemies (rigs, shadows, blood pools)                8 train                              9 pickups
//   10 vfx particles (additive + alpha)                   11 vfx decals (bullet holes, blood, scorch)   12 vfx lines (tracers + beams)   13 vfx chunks (gibs, debris, casings)
//   14 ALL blended (transparent) materials at once        15 all station geometry except decals / signs (walls, floor, props)
//
// `game.layers`: { modes, mode, set(nameOrIndex), next(d), categoryOf(object), counts() }.
import * as THREE from 'three';

const MODES = ['all visible', 'cones', 'halos', 'pools', 'fx', 'decals', 'signs', 'enemies', 'train', 'pickups', 'vfx particles', 'vfx decals', 'vfx lines', 'vfx chunks', 'ALL blended', 'station solid'];
const ID = ['all', 'cones', 'halos', 'pools', 'fx', 'decals', 'signs', 'enemies', 'train', 'pickups', 'particles', 'vfxdecals', 'lines', 'chunks', 'blended', 'solid'];

export function installLayers(game) {
  if (game.layers) return game.layers;
  const L = { modes: MODES, ids: ID, mode: 0, hidden: [] };
  const isUnder = (o, root) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  const ownedBy = (o, name) => { for (let p = o; p; p = p.parent) if (p.name === name || (name === 'enemy:' && typeof p.name === 'string' && p.name.startsWith('enemy:'))) return true; return false; };

  // which mode hides this object (null = never touched). Objects tag themselves with userData.layer (an id from ID) where the rules below cannot tell.
  L.categoryOf = (o) => {
    const V = game.vfx && game.vfx._dbg, m = o.material && (Array.isArray(o.material) ? o.material[0] : o.material), n = o.name || '';
    if (V) {
      if (o === V.add.mesh || o === V.alp.mesh) return 10;
      if (o === V.decals.mesh) return 11;
      if (o === V.tracers.mesh || o === V.beams.mesh) return 12;
      if (o === V.gibs.mesh || o === V.debris.mesh || o === V.casings.mesh || o === V.shells.mesh) return 13;
    }
    if (ownedBy(o, 'train')) return 8;
    if (ownedBy(o, 'pickups')) return 9;
    if (ownedBy(o, 'enemy:')) return 7;
    if (o.userData && o.userData.layer) { const k = ID.indexOf(o.userData.layer); if (k >= 0) return k; }
    const root = game.station && game.station.root; if (!root || !isUnder(o, root)) return null;
    if (o.geometry && o.geometry.attributes && o.geometry.attributes.aI) return 1; // light shafts
    if (n === 'st_decal' || n === 'st_decal2' || n === 'st_blood' || n === 'st_puddle' || n === 'st_glass') return 5;
    if (n === 'st_glowA' || n === 'st_glowB' || n === 'st_paper') return 6;
    if (o.isPoints) return m && m.isShaderMaterial ? 4 : 2; // dust + steam are shader points; PointsMaterial ones are the halos
    if (m && m.transparent && m.blending === THREE.AdditiveBlending && (o.isMesh || o.isSprite)) return 3; // floor light pools, neon spill
    if (n.startsWith('st_')) return 15;
    return null;
  };

  const restore = () => { for (const m of L.hidden) m.visible = true; L.hidden.length = 0; };
  L.apply = () => {
    restore();
    if (!L.mode) return 0;
    game.scene.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isSprite || o.isLine)) return;
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; if (!ms.length) return;
      const all = L.mode === 14, c = all ? -1 : L.categoryOf(o);
      for (const m of ms) if ((all ? m.transparent : c === L.mode) && m.visible) { m.visible = false; L.hidden.push(m); }
    });
    return L.hidden.length;
  };
  L.counts = () => { const c = {}; game.scene.traverse((o) => { if (!(o.isMesh || o.isPoints || o.isSprite)) return; const k = L.categoryOf(o); c[k === null ? 'other' : ID[k]] = (c[k === null ? 'other' : ID[k]] || 0) + 1; }); return c; };
  L.set = (v) => {
    let n = typeof v === 'number' ? v : ID.indexOf(String(v)); if (n < 0) n = +v; if (!(n >= 0)) n = 0;
    L.mode = ((n % MODES.length) + MODES.length) % MODES.length; const k = L.apply();
    const text = L.mode ? `SCENE LAYER ${L.mode}/${MODES.length - 1} HIDDEN: ${MODES[L.mode]} (${k} materials)   F7 next - Shift+F7 previous` : '';
    try { if (game.bb && game.bb.toast && text) game.bb.toast(text, 3600000); else if (game.bb && game.bb.toast) game.bb.toast('scene layers: all visible', 1500); } catch (e) { /* label is optional */ }
    return L.mode;
  };
  L.next = (d = 1) => L.set(L.mode + d);
  // objects created after a mode was chosen (pooled rigs, projectile meshes ...) are picked up again when the mode is re-applied; do it now and then
  let t = 0; L.update = (dt) => { if (!L.mode) return; t += dt; if (t > 1.5) { t = 0; L.apply(); } };
  addEventListener('keydown', (e) => { if (e.code === 'F7' && !e.altKey && !e.ctrlKey) { e.preventDefault(); L.next(e.shiftKey ? -1 : 1); } });
  const q = game.params && game.params.get('layer'); if (q !== null && q !== undefined && q !== '') setTimeout(() => L.set(isNaN(+q) ? q : +q), 1500);
  game.layers = L;
  return L;
}
