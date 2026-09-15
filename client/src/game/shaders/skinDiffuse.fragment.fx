// Skin diffuse, spliced into the PBR fragment by
// SkinShadingPlugin in skin.ts at CUSTOM_FRAGMENT_DEFINITIONS and called from
// the per-light diffuse line. Babylon applies plugin custom code after include
// expansion and BEFORE conditional evaluation (shaderProcessor.js:
// processCodeAfterIncludes runs before EvaluatePreProcessors), so nothing
// here may rely on material conditionals: the gate is the skinOn uniform,
// declared by the plugin. This is exactly why a hashed keyword spelled in a
// comment here is fatal — the preprocessor still sees it as live text.
//
// COMMENT RULES, hard-won on a retired shader: never put a semicolon inside a
// trailing comment on a declaration line, and never spell a hashed
// preprocessor keyword in comment prose. client/test/game/shaderHygiene.test.ts
// enforces both for every shader in this directory.
//
// The tint mirrors skinParams.ts and a lockstep test asserts they agree.
// The wrap and scatter amounts are runtime uniforms (skinWrap, skinScatter),
// not literals, so there is nothing of theirs to mirror here.

const vec3 SKIN_SCATTER_TINT = vec3(1.0, 0.3, 0.2);
const float SKIN_PI = 3.14159265;

// Energy-conserving wrap Lambert - at wrap 0 it is Lambert, and it never
// exceeds Lambert at full light.
float skinWrapLambert(float ndotl, float wrap) {
  return clamp((ndotl + wrap) / ((1.0 + wrap) * (1.0 + wrap)), 0.0, 1.0);
}

// A smooth bump centred on the terminator, zero beyond plus or minus wrap.
float skinTerminatorBand(float ndotl, float wrap) {
  float t = clamp(ndotl / max(wrap, 1e-4), -1.0, 1.0);
  return 1.0 - t * t;
}

// Replaces the per-light diffuse term on skin texels. `base` is what Babylon
// computed (BRDF * attenuation * NdotL * lightColor); the wrapped term
// re-expresses it with Lambert so it stays independent of the diffuse model,
// and the scatter adds the red glow only where the light grazes the surface.
// mask at or below 0.001, or skinOn below 0.5, is a pass-through.
vec3 skinDiffuseLighting(preLightingInfo info, vec3 lightColor, float mask) {
  vec3 base = computeDiffuseLighting(info, lightColor);
  if (skinOn < 0.5 || mask <= 0.001) {
    return base;
  }
  vec3 unit = info.attenuation * lightColor / SKIN_PI;
  vec3 wrapped = unit * skinWrapLambert(info.NdotLUnclamped, skinWrap);
  vec3 scatter = unit * skinTerminatorBand(info.NdotLUnclamped, skinWrap) * SKIN_SCATTER_TINT * skinScatter;
  return mix(base, wrapped + scatter, mask);
}
