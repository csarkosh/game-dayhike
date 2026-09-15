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

// The gradient sampler is declared here, not in AtmospherePlugin's
// getUniforms().fragment, because that string lands at
// ADDITIONAL_FRAGMENT_DECLARATION, which exists only on the non-uniform-buffer
// path. With UBOs supported, the fragment declaration include resolves to
// pbrUboDeclaration instead, which carries only ADDITIONAL_UBO_DECLARATION,
// and a sampler cannot live in a UBO — so the uniform would silently vanish
// and every PBR fragment shader would fail to compile. This file lands at
// CUSTOM_FRAGMENT_DEFINITIONS on both paths, the terrainTexture.ts precedent
// for the same trap. getSamplers still lists atmGradient, unchanged.
uniform sampler2D atmGradient;

// Slope below which a ray counts as level, to keep the closed form finite.
const float ATM_LEVEL_SLOPE = 1.0e-3;

// Quilez closed-form height fog: density a*exp(-b*y) integrated along a ray
// of length t from height y0 with vertical slope rdY. Mirrors heightFogAmount
// in atmosphereParams.ts exactly.
float atmHeightFog(float y0, float rdY, float t, float a, float b) {
  float slope = abs(rdY) < ATM_LEVEL_SLOPE ? (rdY < 0.0 ? -ATM_LEVEL_SLOPE : ATM_LEVEL_SLOPE) : rdY;
  return (a / b) * exp(-y0 * b) * (1.0 - exp(-t * slope * b)) / slope;
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
  vec3 gradient = texture2D(atmGradient, vec2(clamp(d * atmGradientScale, 0.0, 1.0), 0.5)).rgb;
  float glow = pow(max(dot(rd, atmSunDir), 0.0), atmSunPower) * atmSunWeight;
  vec3 air = mix(gradient, atmSunColour, glow);
  return mix(air, lit, clamp(transmit, 0.0, 1.0));
}
