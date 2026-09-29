// Patches to three.js' built-in shader chunks (applied once, before any material compiles).
//
// Every inserted piece is wrapped in `#ifndef BB_NOPATCH` / `#else` so that ONE material define switches it off again at run time (the F4 isolation mode 6 of src/blackbox.js sets
// `material.defines.BB_NOPATCH` on every material + needsUpdate: the define is part of three's program cache key, so the unpatched variant compiles next to the patched one).
// With the define absent the compiled GLSL is exactly the patched text.
//
// 1. rough-surface IBL (default ON, all GPUs): the specular image-based-lighting lookup of a very rough surface (roughness > 0.86: concrete, ballast, wood, rubber, grime decals - most of the
//    screen area of this station) lands on the blurriest mip, exactly the level the diffuse lookup just fetched for the same pixel. Reuse that sample instead of a second lookup
//    (the cubeUV lookup is face selection + 2 bilinear fetches + ~80 ALU). Measured -6.6% of frame cost on the software rasterizer, ~0 visual change. It runs on SwiftShader, so it is
//    covered by every screenshot / test we have. (Ordering contract: three calls getIBLIrradiance before getIBLRadiance in lights_fragment_maps, both in uniform control flow.)
// 2. point-light early-out (default OFF since the black-box hunt; `?lightpatch=1` or `?forcepatch=1` turns it on, also on software renderers): three evaluates the full GGX BRDF
//    for every light at every pixel even when the light is idle (the 6 pooled vfx lights are dark most of the time) or out of range. Skip such lights before any BRDF work, and use
//    d*d instead of pow(d, 2). It is the only shader change that is data-dependent branching in the light loop; it was enabled on hardware renderers only and therefore never executed by
//    any test on software GL, and it was the top suspect of the "black box on a real GPU" report. The GLSL was reviewed against r170's chunks line by line (perf/BLACKBOX.md) and it
//    is correct (every path assigns direction / color / visible; the guarded RE_Direct has no derivatives inside), but its value on hardware is only analytic and its risk on drivers is
//    not measured, so it stays opt-in until a real-GPU A/B (`?lightpatch=1` vs default) shows it is both safe and worth it. Forcing it on under SwiftShader
//    (`?forcepatch=1`) exercises the branch (tools/blackbox-glsl.mjs compares the image with the unpatched one).
// 3. HDR output clamp (default ON): every built-in material writes `gl_FragColor` through the `opaque_fragment` chunk. Clamp its rgb to [0, 1024] in NaN-tolerant order
//    (`max(0.0, x)` maps NaN to 0, then `min`): the HDR targets are RGBA16F, a GGX highlight of a near light on a smooth surface (D peaks at 1/(pi*a^2) = 4e4) or many stacked additive layers used to
//    overflow to +Inf, which the bloom blur turned into a black rectangle. The post chain sanitises again at its first stage (src/post.js), this keeps the Inf out of the target (and out of
//    blending: Inf * 0 = NaN). Legit values reach ~600 (train headlight glare). `?noclamp=1` disables only this one.
// ?nopatch=1 disables every patch (pure three.js chunks).
export function patchShaders(THREE, renderer, params) {
  const C = THREE.ShaderChunk, applied = [];
  const sw = (() => { try { const gl = renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return !!e && /swiftshader|llvmpipe|softpipe|software/i.test(String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL))); } catch (err) { return false; } })();
  const orig = {}; const keep = (k) => { if (!(k in orig)) orig[k] = C[k]; };
  const restore = () => { for (const k in orig) C[k] = orig[k]; };
  if (params.has('nopatch')) return { applied, softwareRenderer: sw, requested: 'none', restore };
  const wantLight = params.has('lightpatch') || params.has('forcepatch');

  // ---- 1. rough IBL sharing --------------------------------------------------------------------------------------------------------------
  {
    keep('envmap_physical_pars_fragment');
    let e = C.envmap_physical_pars_fragment; const n0 = e;
    e = e.replace('#ifdef USE_ENVMAP\n', '#ifdef USE_ENVMAP\n#ifndef BB_NOPATCH\n\tvec3 iblDiffuseSample = vec3( 0.0 );\n#endif\n');
    e = e.replace('return PI * envMapColor.rgb * envMapIntensity;', '#ifndef BB_NOPATCH\n\t\t\tiblDiffuseSample = envMapColor.rgb;\n#endif\n\t\t\treturn PI * envMapColor.rgb * envMapIntensity;');
    e = e.replace('vec3 reflectVec = reflect( - viewDir, normal );', '#ifndef BB_NOPATCH\n\t\t\tif ( roughness > 0.86 ) return iblDiffuseSample * envMapIntensity;\n#endif\n\t\t\tvec3 reflectVec = reflect( - viewDir, normal );');
    // the three replacements must all have hit (the function order in the chunk: irradiance first, radiance second)
    if (e !== n0 && e.includes('iblDiffuseSample = envMapColor.rgb') && e.includes('roughness > 0.86') && e.includes('vec3 iblDiffuseSample')) { C.envmap_physical_pars_fragment = e; applied.push('roughIBL'); }
    else console.warn('[shaders] rough-IBL patch skipped: three.js envmap chunk changed');
  }

  // ---- 2. point-light early-out (opt-in) --------------------------------------------------------------------------------------------------
  if (wantLight) {
    let ok = 0;
    keep('lights_fragment_begin'); keep('lights_pars_begin');
    const RE = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
    if (C.lights_fragment_begin.includes(RE)) { C.lights_fragment_begin = C.lights_fragment_begin.split(RE).join('#ifdef BB_NOPATCH\n\t\t' + RE + '\n#else\n\t\tif ( directLight.visible ) ' + RE + '\n#endif'); ok++; }
    const re = /void getPointLightInfo\([\s\S]*?\n\s*\}/;
    const m = re.exec(C.lights_pars_begin);
    if (m) {
      C.lights_pars_begin = C.lights_pars_begin.replace(re, () => `#ifdef BB_NOPATCH\n${m[0]}\n#else
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		float d2 = dot( lVector, lVector );
		light.direction = vec3( 0.0, 1.0, 0.0 ); light.color = vec3( 0.0 ); light.visible = false;
		if ( pointLight.distance > 0.0 && d2 >= pointLight.distance * pointLight.distance ) return;
		if ( pointLight.color.r + pointLight.color.g + pointLight.color.b <= 0.0 ) return;
		float lightDistance = sqrt( d2 );
		light.direction = lVector / max( lightDistance, 1e-5 );
		light.color = pointLight.color * getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif`); ok++;
    }
    const pw = 'float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );';
    if (C.lights_pars_begin.includes(pw)) { C.lights_pars_begin = C.lights_pars_begin.replace(pw, () => `#ifdef BB_NOPATCH\n\t${pw}\n#else\n\tfloat distanceFalloff = 1.0 / max( ( decayExponent == 2.0 ? lightDistance * lightDistance : pow( lightDistance, decayExponent ) ), 0.01 );\n#endif`); ok++; }
    if (ok === 3) applied.push('lightEarlyOut');
    else { console.warn('[shaders] light early-out patch only partly applied (' + ok + '/3): three.js chunks changed? reverting it'); C.lights_fragment_begin = orig.lights_fragment_begin; C.lights_pars_begin = orig.lights_pars_begin; }
  }

  // ---- 3. HDR output clamp -------------------------------------------------------------------------------------------------------------
  if (!params.has('noclamp')) {
    keep('opaque_fragment');
    const tail = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';
    if (C.opaque_fragment.includes(tail)) { C.opaque_fragment = C.opaque_fragment.replace(tail, '#ifndef BB_NOPATCH\n\toutgoingLight = min( max( vec3( 0.0 ), outgoingLight ), vec3( 1024.0 ) );\n#endif\n' + tail); applied.push('hdrClamp'); }
    else console.warn('[shaders] HDR clamp skipped: three.js opaque_fragment chunk changed');
  }
  return { applied, softwareRenderer: sw, requested: wantLight ? 'lightpatch' : 'default', restore };
}
