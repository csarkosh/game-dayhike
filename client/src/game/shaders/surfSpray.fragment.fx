// The surf's spray, spliced by SprayPlugin (surfSpray.ts) at
// CUSTOM_FRAGMENT_DEFINITIONS: a soft disc on the sprite's quad, full at its
// centre and gone at its rim, times the vertex stage's alpha (its life) and
// the spray's opacity, which surfSpray.ts mirrors (a lockstep test holds it).
// The colour is the material's own, the foam's white under the light.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
#ifdef SPRAY
varying float vSprayAlpha;
varying vec2 vSprayUv;

const float SURF_SPRAY_OPACITY = 0.5;

// The sprite's cover at this pixel, 0 to SURF_SPRAY_OPACITY.
float sprayCover() {
  float d = length(vSprayUv - 0.5) * 2.0;
  return (1.0 - smoothstep(0.0, 1.0, d)) * vSprayAlpha * SURF_SPRAY_OPACITY;
}
#endif
