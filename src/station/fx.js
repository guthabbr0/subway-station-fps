// Ambient effects: dust motes drifting inside the light shafts, steam plumes from vents/leaking pipes, ceiling drips with
// puddle ripples (and 3D drip sounds), occasional electrical sparks. All GPU-animated or pooled; no per-frame allocation.
import * as THREE from 'three';
import { bus } from '../core.js';
import { radialTex, puffTex, ringTex } from '../textures.js';
import { mulberry32 } from '../texutil.js';

export function buildFX(c) {
  const F = { gust: 0, gustTarget: 0, gustDir: 1 }, game = c.game, rnd = mulberry32(7331);
  const uTime = { value: 0 }, uScale = { value: 500 }, uGust = { value: 0 };
  const fogU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  const chimePos = new THREE.Vector3(0, 5.5, 0);
  bus.on('train:arriving', (e) => { F.gustTarget = 1; F.gustDir = e?.track === 'B' ? -1 : 1; game.audio?.play('stationChime', chimePos, { volume: 0.8, pitchVar: 0 }); });
  bus.on('train:stopped', () => { F.gustTarget = 0; });
  bus.on('train:departed', () => { F.gustTarget = 0; });
  bus.on('game:start', () => { F.gust = 0; F.gustTarget = 0; });

  // ------------------------------------------------------------------ dust motes (only inside light shafts)
  const fixtures = (c.S?.lighting?.fixtures || []).filter((f) => f.row !== 'P');
  const N = 1100, pos = new Float32Array(N * 3), rr = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const f = fixtures.length ? fixtures[(rnd() * fixtures.length) | 0] : { x: rnd() * 60 - 30, z: 0, row: 'C' };
    const y = 0.3 + rnd() * 5.1, k = (5.5 - y) / 5.4, rad = (0.5 + (f.row === 'C' ? 1.8 : 1.4) * k) * Math.sqrt(rnd()), a = rnd() * 6.283;
    pos.set([f.x + Math.cos(a) * rad * 1.7, y, f.z + Math.sin(a) * rad], i * 3); rr.set([rnd(), rnd(), 0.4 + rnd() * 0.9, 0.012 + rnd() * 0.02], i * 4);
  }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); dg.setAttribute('aR', new THREE.BufferAttribute(rr, 4));
  const dm = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime, uScale, uGust, uColor: { value: new THREE.Color(0.75, 0.88, 1.0) } }]),
    vertexShader: `attribute vec4 aR; uniform float uTime; uniform float uScale; uniform float uGust; varying float vA;
      #include <fog_pars_vertex>
      void main(){ vec3 p = position; float sp = aR.z;
        p.x += sin(uTime*0.13*sp + aR.x*6.283)*0.8 + uGust*(0.6+aR.y)*3.0*fract(uTime*0.07+aR.x);
        p.z += cos(uTime*0.1*sp + aR.y*6.283)*0.7;
        p.y = 0.25 + mod(position.y - 0.25 - uTime*0.05*sp + sin(uTime*0.4*sp+aR.x*9.0)*0.15, 5.3);
        vec4 mvPosition = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(aR.w * uScale / -mvPosition.z, 1.2, 7.0);
        float tw = 0.5 + 0.5*sin(uTime*sp*1.7 + aR.x*40.0); vA = (0.3 + 0.7*tw) * smoothstep(0.25,1.0,p.y) * (1.0 - smoothstep(4.6,5.4,p.y));
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      #include <fog_pars_fragment>
      void main(){ float d = length(gl_PointCoord - 0.5); float a = (1.0 - smoothstep(0.05, 0.5, d)) * vA * 0.75;
        #ifdef USE_FOG
          a *= exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
        #endif
        gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  });
  const dust = new THREE.Points(dg, dm); dust.frustumCulled = false; dust.renderOrder = 4; c.add(dust);

  // ------------------------------------------------------------------ steam plumes
  // [x,y,z, dx,dy,dz, spread, life, height, size, count]
  const vents = [
    [8.0, 0.02, -3.85, 0, 1, 0.05, 0.28, 3.4, 3.2, 1.3, 26],
    [-8.0, -1.2, 8.1, 0, 1, -0.1, 0.35, 4.2, 3.6, 1.6, 26],
    [-4.0, 6.45, -6.1, 0.1, -1, 0.5, 0.25, 2.6, 4.5, 0.9, 22],
    [14.0, -1.2, -8.0, 0, 1, 0.1, 0.35, 4.6, 4.0, 1.7, 26],
    [-22.0, 0.02, 3.6, 0, 1, -0.05, 0.22, 3.0, 2.4, 1.0, 18],
    [24.5, 5.4, 8.3, 0, -1, 0, 0.3, 3.0, 2.8, 1.0, 16],
  ];
  const total = vents.reduce((s, v) => s + v[10], 0), sp = new Float32Array(total * 3), sd = new Float32Array(total * 4), sq = new Float32Array(total * 4), sr = new Float32Array(total * 4);
  let k = 0;
  vents.forEach((v, vi) => { for (let i = 0; i < v[10]; i++, k++) { sp.set([v[0], v[1], v[2]], k * 3); const dl = Math.hypot(v[3], v[4], v[5]); sd.set([v[3] / dl, v[4] / dl, v[5] / dl, v[7]], k * 4); sq.set([v[6], v[8], v[9], vi], k * 4); sr.set([i / v[10] + rnd() * 0.02, rnd(), rnd(), rnd()], k * 4); } });
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aD', new THREE.BufferAttribute(sd, 4)); sg.setAttribute('aQ', new THREE.BufferAttribute(sq, 4)); sg.setAttribute('aR', new THREE.BufferAttribute(sr, 4));
  const puff = puffTex(128, 11);
  const sm = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime, uScale, uGust, uMap: { value: puff }, uColor: { value: new THREE.Color(0.62, 0.7, 0.78) }, uWindDir: { value: 1 } }]),
    vertexShader: `attribute vec4 aD; attribute vec4 aQ; attribute vec4 aR; uniform float uTime; uniform float uScale; uniform float uGust; uniform float uWindDir; varying float vA; varying float vRot;
      #include <fog_pars_vertex>
      void main(){ float life = aD.w; float age = fract(uTime/life*(0.7+aR.y*0.6) + aR.x); float h = aQ.y;
        vec3 p = position + aD.xyz * h * (1.0 - pow(clamp(1.0-age, 0.0, 1.0), 1.6));
        p.x += sin(age*5.0 + aR.y*30.0) * aQ.x * age * 1.4 + uGust*uWindDir*age*age*3.5;
        p.z += cos(age*4.2 + aR.z*30.0) * aQ.x * age * 1.4;
        vec4 mvPosition = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mvPosition;
        float size = aQ.z * (0.3 + age*1.9) * (0.8 + aR.w*0.5);
        gl_PointSize = clamp(size * uScale / -mvPosition.z, 1.0, 260.0);
        vA = smoothstep(0.0,0.1,age) * pow(clamp(1.0-age, 0.0, 1.0), 1.4) * 0.22; vRot = aR.z * 6.283;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; varying float vA; varying float vRot;
      #include <fog_pars_fragment>
      void main(){ vec2 uv = gl_PointCoord - 0.5; float cs = cos(vRot), sn = sin(vRot); uv = vec2(cs*uv.x - sn*uv.y, sn*uv.x + cs*uv.y) + 0.5;
        vec4 t = texture2D(uMap, uv); float a = t.a * vA;
        #ifdef USE_FOG
          a *= exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
        #endif
        gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0)); }`,
    transparent: true, depthWrite: false, fog: true,
  });
  const steam = new THREE.Points(sg, sm); steam.frustumCulled = false; steam.renderOrder = 5; c.add(steam);
  // floor grate under the platform vent + rusted vent stubs in the pit
  c.mb('dark').box(7.5, 0.001, -4.2, 8.5, 0.012, -3.5, { c: [0.03, 0.03, 0.035] });
  for (let i = 0; i < 9; i++) c.mb('steel').box(7.52 + i * 0.11, 0.012, -4.18, 7.56 + i * 0.11, 0.03, -3.52, { c: [0.5, 0.5, 0.54] });
  c.mb('steel').box(7.44, 0.012, -4.24, 8.56, 0.035, -4.18, { c: [0.4, 0.4, 0.44] }); c.mb('steel').box(7.44, 0.012, -3.52, 8.56, 0.035, -3.46, { c: [0.4, 0.4, 0.44] });
  c.mb('rust').cyl(-8.0, -1.25, 8.1, -8.0, -0.75, 8.1, 0.14, { segs: 10, c: [1, 0.9, 0.9] }); c.mb('rust').cyl(14.0, -1.25, -8.0, 14.0, -0.7, -8.0, 0.14, { segs: 10, c: [1, 0.9, 0.9] });
  c.mb('rust').cyl(-4.0, 6.5, -6.1, -4.0, 6.45, -6.1, 0.2, { segs: 10, c: [1, 0.8, 0.7] });

  // ------------------------------------------------------------------ drips + ripples
  const dripSpots = [[-2.4, -0.6], [9.6, -1.5], [-20.3, -1.2], [14.8, 0.8], [-9, 2.9], [22.4, -3.0]];
  const ripTex = ringTex(128), dropTex = radialTex(32, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
  const drips = dripSpots.map(([x, z], i) => {
    const mat = new THREE.MeshBasicMaterial({ map: ripTex, transparent: true, depthWrite: false, opacity: 0, color: new THREE.Color(0.7, 0.85, 1.0), fog: true, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z); m.visible = false; c.add(m);
    return { x, z, y0: 6.85, t: rnd() * 3, wait: 2 + rnd() * 4, state: 0, ripple: m, mat, sy: 0 };
  });
  const dgp = new Float32Array(dripSpots.length * 3), dgeo = new THREE.BufferGeometry(); dgeo.setAttribute('position', new THREE.BufferAttribute(dgp, 3));
  const dropPts = new THREE.Points(dgeo, new THREE.PointsMaterial({ map: dropTex, size: 0.07, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(0.7, 0.85, 1) })); dropPts.frustumCulled = false; c.add(dropPts);
  for (let i = 0; i < dgp.length; i += 3) dgp[i + 1] = -50;
  // drip source fittings on the ceiling side (small wet stains)
  dripSpots.forEach(([x, z]) => { c.quadAt('decal', 'blot0', x, 6.99, z, 0, -1, 0, 0.9, 0.9, { tint: 0.9 }); });

  // ------------------------------------------------------------------ sparks
  const SN = 14, spk = { pos: new Float32Array(SN * 3), vel: new Float32Array(SN * 3), age: 0, next: 4, live: false, life: 0.7 };
  const spg = new THREE.BufferGeometry(); spg.setAttribute('position', new THREE.BufferAttribute(spk.pos, 3)); spk.pos.fill(-50);
  const spMat = new THREE.PointsMaterial({ map: dropTex, size: 0.09, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2.4, 1.6, 0.6) });
  const spPts = new THREE.Points(spg, spMat); spPts.frustumCulled = false; c.add(spPts);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(64, [[0, 'rgba(200,225,255,1)'], [0.3, 'rgba(120,170,255,0.5)'], [1, 'rgba(100,150,255,0)']]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: true }));
  const SPARK_AT = [-3.6, 2.4, 11.3]; flash.position.set(...SPARK_AT); flash.scale.setScalar(1.8); c.add(flash);
  // broken junction box
  c.mb('paint').box(-3.9, 2.1, 11.05, -3.3, 2.9, 11.5, { c: [0.6, 0.7, 0.7], seg: 1 }); c.mb('dark').box(-3.85, 2.15, 11.0, -3.35, 2.85, 11.06, { c: [0.03, 0.03, 0.03] });
  c.mb('cable').cyl(-3.6, 2.5, 11.0, -3.55, 1.95, 10.85, 0.012, { segs: 4, c: [0.05, 0.05, 0.05] }); c.mb('cable').cyl(-3.5, 2.6, 11.0, -3.4, 2.0, 10.9, 0.012, { segs: 4, c: [0.5, 0.06, 0.05] });

  // ------------------------------------------------------------------ update
  const cam = game.camera, cp = new THREE.Vector3(), ventT = vents.map(() => 2 + rnd() * 10), ventP = vents.map((v) => new THREE.Vector3(v[0], Math.max(0.4, v[1]), v[2]));
  F.update = (dt, t) => {
    uTime.value = t % 3600;
    F.gust += (F.gustTarget - F.gust) * Math.min(1, dt * (F.gustTarget > F.gust ? 0.5 : 0.35)); uGust.value = F.gust; sm.uniforms.uWindDir.value = F.gustDir;
    const h = game.renderer.domElement.height; uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5));
    // drips
    for (let i = 0; i < drips.length; i++) {
      const d = drips[i];
      if (d.state === 0) { d.t += dt; if (d.t > d.wait) { d.state = 1; d.sy = d.y0; d.vy = 0; d.t = 0; } dgp[i * 3 + 1] = -50; }
      else if (d.state === 1) { d.vy -= 9.8 * dt; d.sy += d.vy * dt; dgp[i * 3] = d.x; dgp[i * 3 + 1] = d.sy; dgp[i * 3 + 2] = d.z; if (d.sy <= 0.02) { d.state = 2; d.t = 0; dgp[i * 3 + 1] = -50; d.ripple.visible = true; cp.set(d.x, 0.05, d.z); if (cp.distanceToSquared(cam.position) < 900) game.audio?.play('drip', cp, { volume: 0.45, pitchVar: 0.2 }); } }
      else { d.t += dt; const u = d.t / 1.1; d.ripple.scale.setScalar(0.06 + u * 0.7); d.mat.opacity = Math.max(0, 0.6 * (1 - u)); if (u >= 1) { d.state = 0; d.t = 0; d.wait = 2.2 + Math.random() * 5; d.ripple.visible = false; } }
    }
    dgeo.attributes.position.needsUpdate = true;
    for (let i = 0; i < ventT.length; i++) { ventT[i] -= dt; if (ventT[i] < 0) { ventT[i] = 9 + Math.random() * 10; if (ventP[i].distanceToSquared(cam.position) < 900) game.audio?.play('ventHiss', ventP[i], { volume: 0.32, pitchVar: 0.1 }); } }
    // sparks
    spk.next -= dt;
    if (!spk.live && spk.next <= 0) { spk.live = true; spk.age = 0; spk.life = 0.55 + Math.random() * 0.4; for (let i = 0; i < SN; i++) { spk.pos[i * 3] = SPARK_AT[0]; spk.pos[i * 3 + 1] = SPARK_AT[1]; spk.pos[i * 3 + 2] = SPARK_AT[2] - 0.15; const a = Math.random() * 6.283, s = 0.8 + Math.random() * 2.6; spk.vel[i * 3] = Math.cos(a) * s * 0.6; spk.vel[i * 3 + 1] = 1.2 + Math.random() * 2.2; spk.vel[i * 3 + 2] = -Math.abs(Math.sin(a)) * s; } }
    if (spk.live) {
      spk.age += dt; for (let i = 0; i < SN; i++) { spk.vel[i * 3 + 1] -= 9.8 * dt; spk.pos[i * 3] += spk.vel[i * 3] * dt; spk.pos[i * 3 + 1] += spk.vel[i * 3 + 1] * dt; spk.pos[i * 3 + 2] += spk.vel[i * 3 + 2] * dt; if (spk.pos[i * 3 + 1] < -1.2) { spk.pos[i * 3 + 1] = -1.2; spk.vel[i * 3 + 1] *= -0.3; } }
      spg.attributes.position.needsUpdate = true; spMat.opacity = Math.max(0, 1 - spk.age / spk.life); flash.material.opacity = spk.age < 0.25 ? (Math.random() < 0.6 ? 1 : 0.2) * (1 - spk.age / 0.25) : 0;
      if (spk.age > spk.life) { spk.live = false; spk.next = 4 + Math.random() * 9; spk.pos.fill(-50); spg.attributes.position.needsUpdate = true; flash.material.opacity = 0; }
    }
  };
  c.dynamic.push(F.update);
  return F;
}
