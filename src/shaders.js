// Patches to three.js' built-in shader chunks (applied once, before any material compiles). Each one removes work per pixel WITHOUT changing the picture; A/B renders against the
// unpatched shaders are in perf/RESULTS.md (perf/ab.mjs: rms difference < 0.1/255 inside flat areas). ?nopatch=1 disables all of them for measurements.
//
// 1. rough-surface IBL (all GPUs): the specular image-based-lighting lookup of a very rough surface (roughness > 0.86: concrete, ballast, wood, rubber, grime decals - most of the
//    screen area of this station) lands on the blurriest mip, exactly the level the diffuse lookup just fetched for the same pixel. Reuse that sample instead of a second lookup
//    (the cubeUV lookup is face selection + 2 bilinear fetches + ~80 ALU). Measured -6.6% of frame cost on the software rasterizer, ~0 visual change.
// 2. point-light early-out (real GPUs only): three evaluates the full GGX BRDF for every light at every pixel even when the light is idle (the 6 pooled vfx lights are dark most of
//    the time) or out of range (each station light reaches only part of the platform). Skip such lights before any BRDF work, and use d*d instead of pow(d, 2) (every light here has
//    decay 2). The condition depends on uniforms / smooth varyings so it is coherent over screen tiles. On a software rasterizer (SwiftShader / llvmpipe, i.e. CI and headless
//    tests) the branchy loop measured ~15% SLOWER than three's straight-line loop, so it is enabled for hardware renderers only.
export function patchShaders(THREE, renderer, params) {
  if (params.has('nopatch')) return { applied: [] };
  const C = THREE.ShaderChunk, applied = [];
  const sw = (() => { try { const gl = renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return !!e && /swiftshader|llvmpipe|softpipe|software/i.test(String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL))); } catch (err) { return false; } })();

  // ---- 1. rough IBL sharing --------------------------------------------------------------------------------------------------------------
  {
    let e = C.envmap_physical_pars_fragment; const n0 = e;
    e = e.replace('#ifdef USE_ENVMAP\n', '#ifdef USE_ENVMAP\n\tvec3 iblDiffuseSample = vec3( 0.0 );\n');
    e = e.replace('return PI * envMapColor.rgb * envMapIntensity;', 'iblDiffuseSample = envMapColor.rgb;\n\t\t\treturn PI * envMapColor.rgb * envMapIntensity;');
    e = e.replace('vec3 reflectVec = reflect( - viewDir, normal );', 'if ( roughness > 0.86 ) return iblDiffuseSample * envMapIntensity;\n\t\t\tvec3 reflectVec = reflect( - viewDir, normal );');
    // the three replacements must all have hit (the function order in the chunk: irradiance first, radiance second)
    if (e !== n0 && e.includes('iblDiffuseSample = envMapColor.rgb') && e.includes('roughness > 0.86')) { C.envmap_physical_pars_fragment = e; applied.push('roughIBL'); }
    else console.warn('[shaders] rough-IBL patch skipped: three.js envmap chunk changed');
  }

  // ---- 2. point-light early-out (hardware GPUs) ---------------------------------------------------------------------------------------
  if (!sw) {
    let ok = 0;
    const RE = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
    if (C.lights_fragment_begin.includes(RE)) { C.lights_fragment_begin = C.lights_fragment_begin.split(RE).join('if ( directLight.visible ) ' + RE); ok++; }
    const re = /void getPointLightInfo\([\s\S]*?\n\s*\}/;
    if (re.test(C.lights_pars_begin)) {
      C.lights_pars_begin = C.lights_pars_begin.replace(re, `void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
	vec3 lVector = pointLight.position - geometryPosition;
	float d2 = dot( lVector, lVector );
	light.direction = vec3( 0.0, 1.0, 0.0 ); light.color = vec3( 0.0 ); light.visible = false;
	if ( pointLight.distance > 0.0 && d2 >= pointLight.distance * pointLight.distance ) return;
	if ( pointLight.color.r + pointLight.color.g + pointLight.color.b <= 0.0 ) return;
	float lightDistance = sqrt( d2 );
	light.direction = lVector / max( lightDistance, 1e-5 );
	light.color = pointLight.color * getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
	light.visible = ( light.color != vec3( 0.0 ) );
	}`); ok++;
    }
    const pw = 'pow( lightDistance, decayExponent )';
    if (C.lights_pars_begin.includes(pw)) { C.lights_pars_begin = C.lights_pars_begin.replace(pw, '( decayExponent == 2.0 ? lightDistance * lightDistance : ' + pw + ' )'); ok++; }
    if (ok === 3) applied.push('lightEarlyOut'); else console.warn('[shaders] light early-out patch only partly applied (' + ok + '/3): three.js chunks changed?');
  }
  return { applied, softwareRenderer: sw };
}
