// TRAP 1: never put a trailing "// comment" after code on any line in this
// file — full standalone comment lines only, always above the code they
// describe. Babylon's ifdef/endif-style preprocessor (ShaderCodeCursor's
// `lines` setter, node_modules/@babylonjs/core/Engines/Processors/
// shaderCodeCursor.js) blind-splits any other line on every semicolon
// before the driver ever sees it, losing the "//" on every fragment past
// the first split.
//
// TRAP 2: never spell out a real preprocessor keyword — ifdef, ifndef, if,
// else, elif, endif, define, undef, include — with its leading hash inside
// ANY comment, even just to talk about it (TRAP 1 above did exactly that
// once and broke the same way). Babylon's directive scanner
// (shaderProcessor.js's MoveCursor, matched against MoveCursorRegex) tests
// every line for those hashed keywords with no "is this a comment" check at
// all — only ShaderCodeCursor's semicolon-splitter (TRAP 1) is
// comment-aware. A comment merely mentioning one of those hashed keywords
// gets parsed as a real conditional, and everything through the file's next
// real endif silently vanishes from the compiled shader.
//
// Etched outline post-process. Roberts-cross edge
// detection on the depth pre-pass, optionally sharpened by g-buffer normals
// (the ETCH_NORMALS conditional, high tier), roughened by tiled hash noise,
// and dissolved by the same EXP2 fog the scene draws with.
//
// Two pre-passes feed depthSampler and they do NOT agree on units or on what
// "no geometry" looks like, and stylize.ts sets ETCH_GBUFFER_DEPTH exactly
// when depthSampler is the g-buffer's (i.e. exactly when ETCH_NORMALS is
// also set — the two textures come from the same MRT). Conflating them once
// already fogged out every line on the high tier and painted a full-strength
// halo on the sky instead:
//  - DepthRenderer (medium; !ETCH_GBUFFER_DEPTH): normalized to [0,1] over
//    [minZ, maxZ] (depth.vertex.js: vDepthMetric =
//    (-gl_Position.z+depthValues.x)/depthValues.y), background cleared to
//    1.0 (depthRenderer.pure.js) — the far plane, same order of magnitude as
//    any real sample, so it damps rather than inflates the edge ratio below.
//  - Geometry buffer (high; ETCH_GBUFFER_DEPTH): raw, UNNORMALIZED
//    view-space Z in metres (geometry.fragment.js:
//    gl_FragData[DEPTH_INDEX]=vec4(vViewPos.z/vViewPos.w,0.,0.,1.)),
//    background cleared to 0.0 (geometryBufferRenderer.pure.js
//    _clearColor = Color4(0,0,0,0)) — a value real view-space Z can never
//    take, since it can't be less than camera.minZ away.
precision highp float;

varying vec2 vUV;

// Scene colour (Babylon post-process input).
uniform sampler2D textureSampler;
// Pre-pass depth. See the unit note in the file banner above: DepthRenderer
// (medium) is normalized [0,1] over [minZ, maxZ]; the g-buffer (high) is raw
// view-space metres. Which one this is follows ETCH_GBUFFER_DEPTH below.
uniform sampler2D depthSampler;
// Tiled etch noise, read .r.
uniform sampler2D noiseSampler;
#ifdef ETCH_NORMALS
// Raw, SIGNED view-space normals, already in [-1, 1] — not the [0,1]-packed
// convention. Babylon only packs (ENCODE_NORMAL, *0.5+0.5 in
// geometry.fragment.js) when the g-buffer's normal texture type is
// UNSIGNED_BYTE/UNSIGNED_INT (geometryBufferRenderer.pure.js:952-954,
// checked against types 11/13), which never happens here: this pass only
// runs when fxSupported is float or half-float capable, so the g-buffer
// always picks FLOAT or HALF_FLOAT for its render targets.
uniform sampler2D normalSampler;
#endif

uniform vec2 texelSize;
uniform float cameraMaxZ;
uniform float fogDensity;
uniform vec3 lineColour;
uniform float lineStrength;
uniform float depthThreshold;
uniform float normalThreshold;
uniform float noiseScale;

float readDepth(vec2 uv) {
  float d = texture2D(depthSampler, uv).r;
#ifdef ETCH_GBUFFER_DEPTH
  // Map the g-buffer's zero-cleared "no geometry" texels to the far plane,
  // in the SAME (metres) units this path already reads in, so both the edge
  // ratio's denominator and the fog term below treat the sky the way the
  // depth-only path's background of 1.0 already does: large relative to any
  // real sample, never the tiny value that used to blow the edge ratio up
  // into a full-strength halo.
  if (d <= 0.0) return cameraMaxZ;
#endif
  return d;
}

void main(void) {
  vec4 scene = texture2D(textureSampler, vUV);

  float dC = readDepth(vUV);
  float dL = readDepth(vUV - vec2(texelSize.x, 0.0));
  float dR = readDepth(vUV + vec2(texelSize.x, 0.0));
  float dU = readDepth(vUV - vec2(0.0, texelSize.y));
  float dD = readDepth(vUV + vec2(0.0, texelSize.y));

  // Depth-RELATIVE step: dividing by the centre depth is what keeps
  // kilometre-distant terrain from becoming solid scribble. The
  // sky sits at far-plane depth with equal neighbours and stays clean. Named
  // `edgeStep`, not `step` — `step` is a GLSL built-in, and some mobile GLSL
  // ES compilers reject the redeclaration.
  float edgeStep = (abs(dR - dL) + abs(dU - dD)) / max(dC, 1e-5);
  float edge = smoothstep(depthThreshold, depthThreshold * 2.0, edgeStep);

#ifdef ETCH_NORMALS
  vec3 nC = texture2D(normalSampler, vUV).xyz;
  vec3 nR = texture2D(normalSampler, vUV + vec2(texelSize.x, 0.0)).xyz;
  vec3 nD = texture2D(normalSampler, vUV + vec2(0.0, texelSize.y)).xyz;
  float crease = max(1.0 - dot(nC, nR), 1.0 - dot(nC, nD));
  edge = max(edge, smoothstep(normalThreshold, normalThreshold * 2.0, crease));
#endif

  // Babylon EXP2 fog factor, exp(-(distance*density)^2). minZ sits at 0.05 m,
  // so distance ~= metres regardless of pre-pass. DepthRenderer's dC is
  // normalized over [minZ, maxZ] and needs the *cameraMaxZ back out; the
  // g-buffer's dC (post readDepth) is already raw view-space metres and
  // needs no scaling — scaling it again is what previously sent every real
  // sample's fog argument into the tens of thousands and zeroed every line's
  // opacity. Lines dissolve exactly where geometry does.
#ifdef ETCH_GBUFFER_DEPTH
  float metres = dC;
#else
  float metres = dC * cameraMaxZ;
#endif
  float fogArg = metres * fogDensity;
  float survives = clamp(exp(-fogArg * fogArg), 0.0, 1.0);

  // The etch: noise modulates line opacity so edges read bitten, not drawn.
  float etch = texture2D(noiseSampler, vUV * noiseScale).r;
  float ink = edge * survives * lineStrength * (0.55 + 0.45 * etch);

  gl_FragColor = vec4(mix(scene.rgb, lineColour, ink), scene.a);
}
