#ifdef OCEAN_LIP
// The plunging lip's strip on the high tier (oceanLip.ts), vertex
// definitions: spliced after the sea's own on the strip's material alone, so
// the sea's rings and every lake keep the text they had.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals mirror oceanBreaker.ts, and a lockstep test asserts they
// agree. The crests the strip draws (LipTracker): a row a slot, a texel a
// column, (crest d, progress, height, share), RGBA32F, nearest. The baked
// cross-section (lipProfile): a row a keyframe, a texel a vertex, (across,
// up, tangent across, tangent up) in units of the crest's height. Both are
// read at level 0, as the atlas is.
uniform highp sampler2D oceanLipState;
uniform highp sampler2D oceanLipProfile;
const float LIP_COLUMNS = 512.0;
const float LIP_HALF = 256.0;
const float LIP_SLOTS = 2.0;
const float LIP_PROFILE_VERTS = 24.0;
const float LIP_KEYFRAMES = 8.0;
const float LIP_THROW = 0.6;
const float LIP_KEY_THROW = 4.0;
const float LIP_EDGE_FIRST = 14.0;
const float LIP_EDGE_LAST = 18.0;
const float LIP_FOAM_ENVELOPE = 1000.0;

// The keyframe at progress p, as lipKey has it: four to the throw, three
// after it.
float oceanLipKey(float p) {
  float q = clamp(p, 0.0, 1.0);
  float early = q / LIP_THROW * LIP_KEY_THROW;
  float late = LIP_KEY_THROW + (q - LIP_THROW) / (1.0 - LIP_THROW) * (LIP_KEYFRAMES - 1.0 - LIP_KEY_THROW);
  return mix(early, late, step(LIP_THROW, q));
}

// The cross-section at progress p and vertex v, between the two keyframes
// about p, as profileAt reads it.
vec4 oceanLipShape(float p, float v) {
  float k = oceanLipKey(p);
  float k0 = min(floor(k), LIP_KEYFRAMES - 2.0);
  float u = (v + 0.5) / LIP_PROFILE_VERTS;
  vec4 a = textureLod(oceanLipProfile, vec2(u, (k0 + 0.5) / LIP_KEYFRAMES), 0.0);
  vec4 b = textureLod(oceanLipProfile, vec2(u, (k0 + 1.5) / LIP_KEYFRAMES), 0.0);
  return a + (b - a) * (k - k0);
}

// A strip's vertex, as lipVertexAt places it. strip is the column's world z,
// the slot and the section's vertex. The slot's crest stands crest d metres
// from the coastline at that z, the section runs from it along the swell's
// travel, and the vertex is lifted from the sea's own surface at its
// undisplaced point by the section's up, both in units of the crest's height
// times its share: so the feet, whose up is 0, lie on the rings' surface, and
// a free slot, of height 0, folds its vertices onto one point, which draws
// nothing. xz is that undisplaced point, swell the sum handed on as the rings
// hand it with its normal turned to the section's and its height the lifted
// one, and env the envelope, the leading edge's taken toward one so far past
// any break that its foam is whole as the crest goes through to the throw.
vec3 oceanLipPlace(vec3 strip, out vec2 xz, out vec4 swell, out vec4 env) {
  float column = clamp(strip.x - oceanCove.x + LIP_HALF, 0.0, LIP_COLUMNS - 1.0);
  vec4 slot = textureLod(oceanLipState, vec2((column + 0.5) / LIP_COLUMNS, (strip.y + 0.5) / LIP_SLOTS), 0.0);
  float size = slot.z * slot.w;
  vec4 shape = oceanLipShape(slot.y, strip.z);
  float phaseDz;
  vec2 travel = oceanSwell.xy;
  xz = vec2(oceanCoastAt(strip.x, phaseDz).x + slot.x, strip.x) + travel * (shape.x * size);
  vec4 sum;
  vec2 sumEnv;
  vec3 disp = oceanDisplace(xz, sum, sumEnv);
  float lift = shape.y * size;
  // The section's normal in its plane, the tangent turned a quarter, laid
  // along the travel: on a flat stretch of the section it is up, and the
  // swell's own normal is left as it is.
  vec2 t = shape.zw / max(length(shape.zw), 1.0e-4);
  vec3 sumNormal = vec3(sum.x, sqrt(max(1.0 - dot(sum.xy, sum.xy), 0.0)), sum.y);
  vec3 turned = vec3(-t.y * travel.x, t.x, -t.y * travel.y) - vec3(0.0, 1.0, 0.0);
  vec3 normal = normalize(sumNormal + turned * step(1.0e-6, size));
  swell = vec4(normal.x, normal.z, sum.z + lift, sum.w);
  // The edge's white water rises with the lip, from none at progress 0, where
  // the section lies on the rings, to whole at the throw.
  float edge = step(LIP_EDGE_FIRST, strip.z) * step(strip.z, LIP_EDGE_LAST) * step(1.0e-6, size) * smoothstep(0.0, LIP_THROW, slot.y);
  env = mix(vec4(sumEnv, length(sumEnv), 0.0), vec4(LIP_FOAM_ENVELOPE, 0.0, LIP_FOAM_ENVELOPE, 0.0), edge);
  return vec3(xz.x, waterLevel, xz.y) + disp + vec3(0.0, lift, 0.0);
}
#endif
