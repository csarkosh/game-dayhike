#ifdef OCEAN
// Water plugin, the sea's surface: spliced into the definitions of both
// stages, after the ocean's declarations (ocean.vertex.fx, ocean.fragment.fx).
// The vertex stage displaces the rings with it and the fragment stage shades
// with it. The swell's sum is swellAt's in oceanWaves.ts line for line: the
// same atlas rows, the same reads between texel centres, the same blend of
// the bay and the cove (the phase by its own weight along the coast, the
// depth and the rest by the cove's), the same cap, the same scale of
// steepness, the same foam.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals mirror oceanPhysics.ts, oceanSwell.ts, oceanTables.ts,
// oceanWaves.ts, water.ts and waterShading.ts, and lockstep tests assert
// they agree. Every read is at level 0, which the atlas's only level is: a
// read at a fixed level needs no derivatives, so it is legal in any control
// flow on WebGPU, in the vertex stage and the fragment stage alike.
const float OCEAN_G = 9.81;
const float OCEAN_TWO_PI = 6.283185307179586;
const float OCEAN_D_MIN = -1000.0;
const float OCEAN_D_STEP = 1.0;
const float OCEAN_TABLE_SAMPLES = 1040.0;
const float OCEAN_ATLAS_ROWS = 28.0;
const float OCEAN_ROW_BAY_PROFILE = 0.0;
const float OCEAN_ROW_COVE_PROFILE = 1.0;
const float OCEAN_ROW_BAY_FIRST = 2.0;
const float OCEAN_ROW_COVE_FIRST = 14.0;
const float OCEAN_ROW_COMPONENTS = 26.0;
const float OCEAN_ROW_COAST = 27.0;
const float OCEAN_DRY_DEPTH = 0.05;
const float WEGGEL_GAMMA_MIN = 0.78;
const float WEGGEL_GAMMA_MAX = 1.56;
const float SWELL_Q_SUM_MAX = 0.9;
const float OCEAN_BORE_RATIO = 0.42;
const float OCEAN_BREAK_FULL = 1.5;
const float OCEAN_BREAK_FOAM_LO = 1.0;
const float OCEAN_BREAK_FOAM_HI = 1.3;
const float OCEAN_FOAM_LIFE = 20.0;
const float OCEAN_ROLL_WIDTH = 0.6;
const float OCEAN_INNER_FOAM = 0.5;
const float SHELTER_SWELL = 0.3;
const float SHELTER_CHOP = 0.15;
const float SHELTER_WIDTH = 40.0;
// A drawn wave keeps all of its share while its phase turns by at most a
// quarter turn over one step of the drawing (four steps a wavelength), and
// none of it from a half turn (two steps), where it would alias.
const float OCEAN_RESOLVE_PHASE_LO = 1.5707963267948966;
const float OCEAN_RESOLVE_PHASE_HI = 3.141592653589793;
// The finest ring's spacing, and how many of a ring's cells lie between the
// eye and the ring's inner edge (a quarter of its side).
const float OCEAN_RING_BASE = 1.0;
const float OCEAN_RING_REACH = 32.0;

// One texel of the atlas, at its centre: the atlas is sampled nearest.
vec4 oceanAtlasTexel(float row, float column) {
  return textureLod(oceanAtlas, vec2((column + 0.5) / OCEAN_TABLE_SAMPLES, (row + 0.5) / OCEAN_ATLAS_ROWS), 0.0);
}

// A row read at a fractional column, as atlasRead in oceanWaves.ts reads it:
// the column held to the table, linear between the two nearest texels.
vec4 oceanAtlasRead(float row, float column) {
  float c = clamp(column, 0.0, OCEAN_TABLE_SAMPLES - 1.0);
  float i0 = floor(c);
  vec4 a = oceanAtlasTexel(row, i0);
  vec4 b = oceanAtlasTexel(row, min(i0 + 1.0, OCEAN_TABLE_SAMPLES - 1.0));
  return a + (b - a) * (c - i0);
}

// A row over d, the distance from the coastline (negative at sea), at d.
vec4 oceanAtlasRow(float row, float d) {
  return oceanAtlasRead(row, (d - OCEAN_D_MIN) / OCEAN_D_STEP);
}

// The coastline's row at z, as coastRead has it: x the coastline's x, y its
// slope along z, z the cove's weight and w the phase weight, each the linear
// read of the row's channel. phaseDz is the phase weight's slope along z: the
// difference of the two texels the read mixes over the row's step, the
// derivative of the linear read exactly, and 0 where the column is below the
// row. Both texels are read whatever the column, the select is on values. The
// row starts at oceanCoast.x and steps oceanCoast.y metres a texel. Named
// apart from the oceanCoast uniform, which shares its scope.
vec4 oceanCoastAt(float z, out float phaseDz) {
  float column = (z - oceanCoast.x) / oceanCoast.y;
  float c = clamp(column, 0.0, OCEAN_TABLE_SAMPLES - 1.0);
  float i0 = floor(c);
  vec4 a = oceanAtlasTexel(OCEAN_ROW_COAST, i0);
  vec4 b = oceanAtlasTexel(OCEAN_ROW_COAST, min(i0 + 1.0, OCEAN_TABLE_SAMPLES - 1.0));
  phaseDz = column < 0.0 ? 0.0 : (b.w - a.w) / oceanCoast.y;
  return a + (b - a) * (c - i0);
}

// One headland's shadow at p, as shelterAt has it: the share of the height
// kept, keep deep in the lee and 1 outside it. The lee lies downstream of the
// tip, on the ridge's side the swell's along-shore travel points to, and past
// the swell's line through the tip, fading in over SHELTER_WIDTH metres.
float oceanShelterTip(vec2 p, vec2 tip, float keep) {
  vec2 u = oceanSwell.xy;
  vec2 r = p - tip;
  float side = u.y >= 0.0 ? 1.0 : -1.0;
  float on = step(0.0, dot(u, r)) * step(0.0, r.y * side);
  float lambda = -(u.x * r.y - u.y * r.x) * side;
  return 1.0 - (1.0 - keep) * smoothstep(0.0, SHELTER_WIDTH, lambda) * on;
}

// Both headlands' shelter at p, keep being SHELTER_SWELL or SHELTER_CHOP.
float oceanShelter(vec2 p, float keep) {
  return oceanShelterTip(p, oceanTips.xy, keep) * oceanShelterTip(p, oceanTips.zw, keep);
}

// The swell at the undisplaced point p: disp its displacement (x, height, z),
// normal its Gerstner normal, foam (foam, B, foamAge, depth) and drawn the
// slope variance its drawn waves carry. dpx and dpy are how far p moves over
// one step of the drawing, a pixel or a ring's cells: a component fades out
// of what is drawn as its phase turns by more than a quarter turn a step,
// gone at a half turn. With both zero nothing fades and the sum is exactly
// swellAt's. The envelope, the break and the foam are the whole swell's and
// never fade. The loops run to a constant 12 and stop at the count, a uniform.
void oceanSwellSum(vec2 p, vec2 dpx, vec2 dpy, out vec3 disp, out vec3 normal, out vec4 foam, out float drawn) {
  float phaseDz;
  vec4 coast = oceanCoastAt(p.y, phaseDz);
  float d = p.x - coast.x;
  float column = (d - OCEAN_D_MIN) / OCEAN_D_STEP;
  // Seaward of the table each phase runs on as the plane wave it is there.
  float deep = min(d - OCEAN_D_MIN, 0.0);
  vec4 bay = oceanAtlasRead(OCEAN_ROW_BAY_PROFILE, column);
  vec4 cove = oceanAtlasRead(OCEAN_ROW_COVE_PROFILE, column);
  float h = bay.x + (cove.x - bay.x) * coast.z;
  float a = bay.y + (cove.y - bay.y) * coast.z;
  float b = bay.z + (cove.z - bay.z) * coast.z;
  float shelter = oceanShelter(p, SHELTER_SWELL);
  float theta[12];
  theta[0] = oceanPhase0.x;
  theta[1] = oceanPhase0.y;
  theta[2] = oceanPhase0.z;
  theta[3] = oceanPhase0.w;
  theta[4] = oceanPhase1.x;
  theta[5] = oceanPhase1.y;
  theta[6] = oceanPhase1.z;
  theta[7] = oceanPhase1.w;
  theta[8] = oceanPhase2.x;
  theta[9] = oceanPhase2.y;
  theta[10] = oceanPhase2.z;
  theta[11] = oceanPhase2.w;
  float phi[12];
  float amp[12];
  float q0[12];
  vec2 kv[12];
  vec2 env = vec2(0.0);
  for (int c = 0; c < 12; c++) {
    float fc = float(c);
    if (fc >= oceanCoast.z) break;
    vec4 k = oceanAtlasTexel(OCEAN_ROW_COMPONENTS, 2.0 * fc);
    vec4 rb = oceanAtlasRead(OCEAN_ROW_BAY_FIRST + fc, column);
    vec4 rc = oceanAtlasRead(OCEAN_ROW_COVE_FIRST + fc, column);
    // The phase and its onshore wavenumber blend by the phase weight, the
    // amplitude factor by the cove's. The wavevector's z part carries the
    // coastline's turn and what the phase weight's change along z adds.
    float dpsi = rc.x - rb.x;
    float psi = rb.x + dpsi * coast.w + k.x * deep;
    float kn = rb.y + (rc.y - rb.y) * coast.w;
    float shoal = rb.z + (rc.z - rb.z) * coast.z;
    phi[c] = psi + k.x * coast.x + k.y * p.y + theta[c];
    kv[c] = vec2(kn, k.y + (k.x - kn) * coast.y + dpsi * phaseDz);
    amp[c] = k.w * shoal * shelter;
    q0[c] = oceanAtlasTexel(OCEAN_ROW_COMPONENTS, 2.0 * fc + 1.0).x;
    env += amp[c] * vec2(cos(phi[c]), sin(phi[c]));
  }
  float envelope = length(env);
  float unbroken = 2.0 * envelope;
  float crestPhase = envelope > 0.0 ? atan(env.y, env.x) : 0.0;
  // No dry branch: over sand the depth is held at OCEAN_DRY_DEPTH, so the
  // swell there is the bore's few centimetres.
  float hc = max(h, OCEAN_DRY_DEPTH);
  float gamma = clamp(b - a * unbroken / (OCEAN_G * oceanSwell.z * oceanSwell.z), WEGGEL_GAMMA_MIN, WEGGEL_GAMMA_MAX);
  float ratio = unbroken / (gamma * hc);
  float scale = 1.0;
  if (ratio > 1.0) {
    float cap = gamma + (OCEAN_BORE_RATIO - gamma) * smoothstep(1.0, OCEAN_BREAK_FULL, ratio);
    scale = hc * cap / max(unbroken, 1.0e-6);
  }
  float breaking = smoothstep(OCEAN_BREAK_FOAM_LO, OCEAN_BREAK_FOAM_HI, ratio);
  float steepness = 0.0;
  for (int c = 0; c < 12; c++) {
    if (float(c) >= oceanCoast.z) break;
    amp[c] *= scale;
    steepness += q0[c] * length(kv[c]) * amp[c];
  }
  float s = min(1.0, SWELL_Q_SUM_MAX / max(steepness, 1.0e-6));
  float height = 0.0;
  vec2 across = vec2(0.0);
  vec2 slope = vec2(0.0);
  float fold = 0.0;
  drawn = 0.0;
  for (int c = 0; c < 12; c++) {
    if (float(c) >= oceanCoast.z) break;
    float kmag = length(kv[c]);
    float turn = max(abs(dot(dpx, kv[c])), abs(dot(dpy, kv[c])));
    float A = amp[c] * (1.0 - smoothstep(OCEAN_RESOLVE_PHASE_LO, OCEAN_RESOLVE_PHASE_HI, turn));
    float Q = q0[c] * s;
    float sn = sin(phi[c]);
    float cs = cos(phi[c]);
    height += A * cs;
    across -= Q * A * kv[c] * sn / kmag;
    slope += A * kv[c] * sn;
    fold += Q * A * kmag * cs;
    drawn += 0.5 * (A * kmag) * (A * kmag);
  }
  disp = vec3(across.x, height, across.y);
  normal = normalize(vec3(slope.x, 1.0 - fold, slope.y));
  float foamAge = mod(-crestPhase, OCEAN_TWO_PI) / (OCEAN_TWO_PI / oceanSwell.z);
  float roll = breaking * (1.0 - smoothstep(0.0, OCEAN_ROLL_WIDTH, mod(crestPhase, OCEAN_TWO_PI)));
  float trailing = breaking * exp(-foamAge / OCEAN_FOAM_LIFE);
  foam = vec4(max(max(roll, trailing), breaking * OCEAN_INNER_FOAM), breaking, foamAge, h);
}

// The swell at p as swellAt has it, nothing faded.
void oceanSwellEval(vec2 p, out vec3 disp, out vec3 normal, out vec4 foam) {
  float drawn;
  oceanSwellSum(p, vec2(0.0), vec2(0.0), disp, normal, foam, drawn);
}

// The spacing of the ring that draws p, from p's distance to the eye: a ring
// of spacing s lies from 32 s to 64 s from the eye, so this is the ring's own
// spacing at its inner edge and the next ring's at its outer. It depends on
// the point alone, so two rings drawing one point displace it alike.
float oceanRingCell(vec2 p) {
  vec2 r = abs(p - vEyePosition.xz);
  return max(OCEAN_RING_BASE, max(r.x, r.y) / OCEAN_RING_REACH);
}

// The sea's displacement of a ring's vertex at p: a swell component under four
// of the ring's cells a wavelength is left to the pixels' normal, so no ring
// aliases it.
vec3 oceanDisplace(vec2 p) {
  float cell = oceanRingCell(p);
  vec3 disp;
  vec3 normal;
  vec4 foam;
  float drawn;
  oceanSwellSum(p, vec2(2.0 * cell, 0.0), vec2(0.0, 2.0 * cell), disp, normal, foam, drawn);
  return disp;
}
#endif
