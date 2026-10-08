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
