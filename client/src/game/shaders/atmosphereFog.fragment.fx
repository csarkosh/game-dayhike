// Atmosphere fog, spliced into the PBR fragment by AtmospherePlugin in
// atmosphere.ts at CUSTOM_FRAGMENT_DEFINITIONS and called from the regex
// replacement of Babylon's fog mix line. Plugin custom code is applied after
// include expansion and before conditional evaluation, so nothing here may
// rely on material conditionals: the gate is the atmOn uniform.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals below mirror atmosphereParams.ts and a lockstep test asserts
// they agree. Tune them there and here together.

// The cloud map sampler is declared here, not in AtmospherePlugin's
// getUniforms().fragment, because that string lands at
// ADDITIONAL_FRAGMENT_DECLARATION, which exists only on the non-uniform-buffer
// path. With UBOs supported, the fragment declaration include resolves to
// pbrUboDeclaration instead, which carries only ADDITIONAL_UBO_DECLARATION,
// and a sampler cannot live in a UBO — so the uniform would silently vanish
// and every PBR fragment shader would fail to compile. This file lands at
// CUSTOM_FRAGMENT_DEFINITIONS on both paths, the terrainTexture.ts precedent
// for the same trap. getSamplers still lists atmCloudMap, unchanged.
//
// It is the plugin's one sampler: a material has sixteen units and one is
// at them, so the distance gradient is not a texture but the curve below on
// the far colour (atmosphereParams.ts, fogGradientUnder), and the ground
// cloud's map (cloudParams.ts) is one texture: tileable noise in R and G,
// read wrapping, and the height of the ground round the player in B, read
// with its coordinates held off the edge so the wrap never reaches it.
uniform sampler2D atmCloudMap;

// The distance gradient: the far colour dimmed to ATM_NEAR_DIM at the eye,
// rising as t to the power 1 / ATM_GRADIENT_BIAS. Mirrors fogGradientUnder.
const float ATM_NEAR_DIM = 0.85;
const float ATM_GRADIENT_BIAS = 1.6;
// Half a texel of the map: the ground read stays this far inside it.
const float ATM_CLOUD_EDGE = 0.5 / 64.0;

// The most steps the cloud's march takes. atmCloudSteps, a uniform, stops it
// earlier, by tier, and at 0 there is no cloud.
const int ATM_CLOUD_STEPS_MAX = 12;

// Slope below which a ray counts as level, to keep the closed form finite.
const float ATM_LEVEL_SLOPE = 1.0e-3;

// Quilez closed-form height fog: density a*exp(-b*y) integrated along a ray
// of length t from height y0 with vertical slope rdY. Mirrors heightFogAmount
// in atmosphereParams.ts exactly.
float atmHeightFog(float y0, float rdY, float t, float a, float b) {
  float slope = abs(rdY) < ATM_LEVEL_SLOPE ? (rdY < 0.0 ? -ATM_LEVEL_SLOPE : ATM_LEVEL_SLOPE) : rdY;
  return (a / b) * exp(-y0 * b) * (1.0 - exp(-t * slope * b)) / slope;
}

// The ground under a place, read from the height map round the player: the
// rect holds its centre, 1 / its span and its base height, and the range is
// the metres its 0 to 1 spans. Beyond the map the edge texel repeats.
float atmCloudFloor(vec2 xz) {
  vec2 uv = clamp((xz - atmCloudGroundRect.xy) * atmCloudGroundRect.z + 0.5, ATM_CLOUD_EDGE, 1.0 - ATM_CLOUD_EDGE);
  return atmCloudGroundRect.w + textureLod(atmCloudMap, uv, 0.0).b * atmCloudGroundRange;
}

// The cloud's extinction at a point s metres out along the ray: the density,
// falling off with height above the ground (seated a little below it),
// shaped by a large and a small read of the noise, each drifting on the
// wind. Within atmCloudNear of the eye the shapes smooth out to a plain veil,
// the small ones first: a feature a metre or two off sweeps across the view
// at a walker's parallax, tens of degrees a second, and read as the mist
// rushing past, where the mist should hang. Explicit-level reads, so the
// march is free of the uniformity rules a derivative read would be under.
float atmCloudAt(vec3 p, float s) {
  float above = p.y - atmCloudFloor(p.xz) + atmCloudSeat;
  float h = exp(-max(above, 0.0) * atmCloudFalloff);
  float large = textureLod(atmCloudMap, p.xz * atmCloudNoiseScale.x + atmCloudWind, 0.0).r;
  float small = textureLod(atmCloudMap, (p.xz + vec2(p.y, -p.y) * 0.7) * atmCloudNoiseScale.y - atmCloudWind.yx, 0.0).g;
  large = mix(0.7, large, smoothstep(0.0, atmCloudNear * 0.5, s));
  small = mix(0.7, small, smoothstep(atmCloudNear * 0.2, atmCloudNear, s));
  float n = clamp(large * small * 2.4 - 0.2, 0.0, 1.0);
  return atmCloudDensity * h * n;
}

// The cloud's optical depth from the eye along rd to t: at most
// ATM_CLOUD_STEPS_MAX steps, packed toward the eye (where the wisps are
// walked through), none past atmCloudRange.
float atmCloudDepth(vec3 ro, vec3 rd, float t) {
  float reach = min(t, atmCloudRange);
  float od = 0.0;
  float prev = 0.0;
  for (int i = 1; i <= ATM_CLOUD_STEPS_MAX; i++) {
    if (float(i) > atmCloudSteps) break;
    float f = float(i) / atmCloudSteps;
    float s = reach * f * f;
    float mid = 0.5 * (prev + s);
    od += atmCloudAt(ro + rd * mid, mid) * (s - prev);
    prev = s;
  }
  return od;
}

// lit is the lit surface colour, fog is Babylon's linearised EXP2 factor
// (1 = clear, 0 = fully fogged). Returns the fogged colour. atmOn below 0.5
// reproduces Babylon's own mix so an unbound record is harmless.
vec3 atmosphereFog(vec3 lit, float fog) {
  if (atmOn < 0.5) {
    return mix(vFogColor, lit, fog);
  }
  vec3 toFrag = vPositionW - vEyePosition.xyz;
  float d = length(toFrag);
  vec3 rd = toFrag / max(d, 1.0e-4);
  float y0 = vEyePosition.y - atmReferenceLevel;
  float height = atmHeightFog(y0, rd.y, d, atmHeightDensity, atmHeightFalloff);
  float transmit = fog * exp(-max(height, 0.0));
  vec3 gradient = atmFarColour * mix(ATM_NEAR_DIM, 1.0, pow(clamp(d * atmGradientScale, 0.0, 1.0), 1.0 / ATM_GRADIENT_BIAS));
  float glow = pow(max(dot(rd, atmSunDir), 0.0), atmSunPower) * atmSunWeight;
  vec3 air = mix(gradient, atmSunColour, glow);
  vec3 fogged = mix(air, lit, clamp(transmit, 0.0, 1.0));
  if (atmCloudSteps < 0.5) {
    return fogged;
  }
  // The ground cloud, in front of the air: its own colour, glowing a little
  // toward the sun or moon, over the fogged surface by its optical depth.
  float od = atmCloudDepth(vEyePosition.xyz, rd, d);
  float cloudGlow = pow(max(dot(rd, atmSunDir), 0.0), atmCloudGlow.y) * atmCloudGlow.x;
  vec3 cloud = atmCloudColour + atmSunColour * cloudGlow;
  return mix(cloud, fogged, exp(-od));
}
