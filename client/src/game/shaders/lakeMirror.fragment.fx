// The lake's mirror, read (spec §5.3). The high tier's target (lakeMirror.ts)
// holds the shore as the mirrored camera saw it this frame, cleared to
// alpha 0 where nothing was drawn. Spliced at CUSTOM_FRAGMENT_DEFINITIONS on
// a lake's material alone (waterPlugin.ts), after water.fragment.fx, which
// declares the sampler, and called from waterCompose.fragment.fx.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literal below mirrors MIRROR_DEPTH_FULL in mirrorView.ts, and
// waterMirrorUv is mirrorUv there, line for line. A lockstep test holds them
// equal.

// The water depth (m) at which a ripple moves the read by its whole offset.
const float WATER_MIRROR_DEPTH = 0.5;

// The mirror target's texel under a point of the surface: its clip position
// in the mirrored camera (waterMirrorVP, the four columns of its
// view-projection), which for a point on the plane is the point's own place
// on the screen, mapped to 0..1 as Babylon samples a target, v up the
// screen. The ripple's slope moves it by waterMirrorK over the view depth,
// scaled by the water's depth so that it is none at the contact line, where
// the bank meets its image, and never up the screen: v stays at or below the
// unmoved texel's, so no sky from past a bank's reflected top is read.
vec2 waterMirrorUv(vec3 worldPos, vec2 slope, float depth, float viewDepth) {
  mat4 vp = mat4(waterMirrorVP[0], waterMirrorVP[1], waterMirrorVP[2], waterMirrorVP[3]);
  vec4 clip = vp * vec4(worldPos, 1.0);
  vec2 uv0 = clip.xy / clip.w * 0.5 + 0.5;
  vec2 uv = uv0 + slope * waterMirrorK * min(depth / WATER_MIRROR_DEPTH, 1.0) / max(viewDepth, 1.0);
  uv.y = min(uv.y, uv0.y);
  return uv;
}

// One read of the target: nothing drawn outside it. A level-zero read, so it
// is never a derivative's business where it sits.
vec4 waterMirrorTap(vec2 uv) {
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return textureLod(waterMirror, clamp(uv, 0.0, 1.0), 0.0) * inside.x * inside.y;
}

// The mirror at uv smeared down the screen over smearPx pixels of the frame
// (waterScreen holds the frame's 1/size): four reads from the texel down.
// Returns the mean colour of the reads that met something drawn, and in
// alpha the share of the four that did, 0 where the target drew nothing.
vec4 waterMirrorSample(vec2 uv, float smearPx) {
  float stride = smearPx * waterScreen.y / 3.0;
  vec4 sum = waterMirrorTap(uv)
    + waterMirrorTap(uv - vec2(0.0, stride))
    + waterMirrorTap(uv - vec2(0.0, 2.0 * stride))
    + waterMirrorTap(uv - vec2(0.0, 3.0 * stride));
  return vec4(sum.rgb / max(sum.a, 1.0e-4), sum.a * 0.25);
}

// The medium and low tiers' shore (spec §6): no mirror pass, the reflected
// ray read against the shore instead. The panorama (lakePanorama.ts) holds
// the shore seen from the lake's centre PANORAMA_EYE_UP over the level, u the
// azimuth and v the height over the level on the cylinder of the lake's
// radius, 0 to PANORAMA_HEIGHT_M. The skyline (lakeSkyline.ts) holds, by
// the same azimuth, the treeline's elevation from that eye in radians. The
// two literals mirror lakePanorama.ts and a test holds them equal.
const float PANORAMA_HEIGHT_M = 64.0;
const float PANORAMA_EYE_UP = 0.4;

// A horizontal direction's azimuth, 0 to 1 of a turn: 0 facing +z and a
// quarter facing +x, as the panorama and the skyline lay their u. The nudge
// keeps the arctangent from being asked for the angle of nothing.
float waterAzimuth(vec2 d) {
  return fract(atan(d.x, d.y + 1.0e-20) * RECIPROCAL_PI2 + 1.0);
}

// The reflected ray from origin against the vertical cylinder of the lake's
// radius about its centre, where it leaves it (the far shore): x the hit's
// azimuth, y its height over the level, z 1 where the ray meets the cylinder
// ahead and 0 where it never does. Mirrors cylinderHit in lakeSkyline.ts.
// Every term stays finite for any input, a radius of 0 or an upright ray
// among them, so the mix that drops it never meets a NaN.
vec3 waterCylinderHit(vec3 origin, vec3 dir) {
  vec2 o = origin.xz - waterLakeCentre.xz;
  float a = max(dot(dir.xz, dir.xz), 1.0e-8);
  float b = dot(o, dir.xz);
  float c = dot(o, o) - waterLakeRadius * waterLakeRadius;
  float disc = b * b - a * c;
  float t = (sqrt(max(disc, 0.0)) - b) / a;
  return vec3(waterAzimuth(o + dir.xz * t), origin.y + dir.y * t - waterLakeCentre.y, step(0.0, disc) * step(0.0, t));
}

// Medium: the panorama where the reflected ray meets the shore's cylinder
// below the skyline and the capture drew something there, the probe's own
// radiance elsewhere. Seen from the centre's eye, the hit is below the
// skyline when its rise over the eye is under the radius times the
// skyline's tangent. The ripples are already in dir, and the cylinder keeps
// the contact line: the ray's tilt moves the hit by the tilt times the ray's
// run to the shore, which is nothing at the bank.
vec3 waterPanoramaRadiance(vec3 origin, vec3 dir, vec3 probeRadiance) {
  vec3 hit = waterCylinderHit(origin, dir);
  vec4 shore = texture2D(waterPanorama, vec2(hit.x, clamp(hit.y / PANORAMA_HEIGHT_M, 0.0, 1.0)));
  float skyline = texture2D(waterSkyline, vec2(hit.x, 0.5)).r;
  float below = step(hit.y - PANORAMA_EYE_UP, waterLakeRadius * tan(skyline));
  return mix(probeRadiance, shore.rgb, hit.z * below * shore.a);
}

// Low: the forest's shade below the skyline at the reflected ray's own
// azimuth and elevation, the probe's radiance above it. One read, one compare.
// The shade is the probe's horizon times SKYLINE_SHADE, raw: scaled here by
// the environment's intensity, as the probe's radiance passed in already is.
vec3 waterSkylineRadiance(vec3 dir, vec3 probeRadiance) {
  float skyline = texture2D(waterSkyline, vec2(waterAzimuth(dir.xz), 0.5)).r;
  float below = step(dir.y, length(dir.xz) * tan(skyline));
  return mix(probeRadiance, waterShadeColour * vLightingIntensity.z, below);
}
