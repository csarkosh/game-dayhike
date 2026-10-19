// The far field's softening (2026-10-16): past soft.x metres of camera depth
// the frame is blurred by a radius rising to soft.z texels at soft.y, two
// rings of reads round the texel, eight at the radius and four at half of
// it, each kept only where it is not much nearer than the texel itself, so
// the near grass never bleeds into the far field behind it. Sub-pixel cards
// and rims melt into a mass as a temporal pass would leave them. The depth
// is the prepass's camera-space depth, a target of the scene's own pass
// (post.ts); a material that draws to one target alone (the sky dome's)
// leaves it at the clear, 0, read here as the far sky. Every read is at an
// explicit level: the near field leaves after two reads, and WGSL allows an
// implicit-level sample only in uniform control flow.
//
// The ground cloud (2026-10-18), marched here once a pixel on the same ray
// and the same depth, in place of every material's fragment, which paid for
// it again under each layer of foliage drawn over a pixel. The march is the
// atmosphere's own (atmosphereFog.fragment.fx), its three functions copied
// as they are written there, which a test holds to the letter; the ray is
// the camera's through the pixel, its length the depth over the ray's share
// of the camera's forward axis. No cloud on the far sky, as the sky's
// material draws none. Off (no steps) by day and wherever the materials
// still draw it.

precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;
uniform sampler2D atmCloudMap;
uniform vec2 texel;
uniform vec3 soft;
uniform vec3 farEye;
uniform vec3 farForward;
uniform vec3 farRight;
uniform vec3 farUp;
uniform vec3 atmSunDir;
uniform vec3 atmSunColour;
uniform float atmCloudDensity;
uniform float atmCloudSteps;
uniform float atmCloudRange;
uniform float atmCloudFalloff;
uniform float atmCloudSeat;
uniform float atmCloudGroundRange;
uniform float atmCloudNear;
uniform float atmCloudTrail;
uniform vec2 atmCloudNoiseScale;
uniform vec2 atmCloudWind;
uniform vec2 atmCloudGlow;
uniform vec3 atmCloudColour;
uniform vec4 atmCloudGroundRect;

const float FAR_SOFT_SKY = 100000.0;
const float ATM_CLOUD_EDGE = 0.5 / 64.0;
const int ATM_CLOUD_STEPS_MAX = 12;

float farDepth(vec2 uv) {
  float d = textureLod(depthSampler, uv, 0.0).r;
  return d > 0.0 ? d : FAR_SOFT_SKY;
}

vec2 atmCloudGround(vec2 xz) {
  vec2 uv = clamp((xz - atmCloudGroundRect.xy) * atmCloudGroundRect.z + 0.5, ATM_CLOUD_EDGE, 1.0 - ATM_CLOUD_EDGE);
  vec4 g = textureLod(atmCloudMap, uv, 0.0);
  return vec2(atmCloudGroundRect.w + g.b * atmCloudGroundRange, g.a);
}

float atmCloudAt(vec3 p, float s) {
  vec2 ground = atmCloudGround(p.xz);
  float above = p.y - ground.x + atmCloudSeat;
  // Thin on the trail (atmCloudTrail of itself), whole beside it: the way is open, the sides are not.
  float h = exp(-max(above, 0.0) * atmCloudFalloff) * mix(atmCloudTrail, 1.0, ground.y);
  float large = textureLod(atmCloudMap, p.xz * atmCloudNoiseScale.x + atmCloudWind, 0.0).r;
  float small = textureLod(atmCloudMap, (p.xz + vec2(p.y, -p.y) * 0.7) * atmCloudNoiseScale.y - atmCloudWind.yx, 0.0).g;
  large = mix(0.7, large, smoothstep(0.0, atmCloudNear * 0.5, s));
  small = mix(0.7, small, smoothstep(atmCloudNear * 0.2, atmCloudNear, s));
  float n = clamp(large * small * 2.4 - 0.2, 0.0, 1.0);
  return atmCloudDensity * h * n;
}

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

vec3 farSoftened(vec2 uv, float d, vec3 c) {
  float r = smoothstep(soft.x, soft.y, d) * soft.z;
  if (r < 0.2) {
    return c;
  }
  vec3 sum = c;
  float wsum = 1.0;
  for (int i = 0; i < 12; i++) {
    float a = i < 8 ? float(i) * 0.7853982 : float(i - 8) * 1.5707963 + 0.7853982;
    float ring = i < 8 ? r : r * 0.5;
    vec2 o = vec2(cos(a), sin(a)) * ring * texel;
    float dn = farDepth(uv + o);
    float w = step(d * 0.8, dn);
    sum += textureLod(textureSampler, uv + o, 0.0).rgb * w;
    wsum += w;
  }
  return sum / wsum;
}

void main(void) {
  float d = farDepth(vUV);
  vec4 c = textureLod(textureSampler, vUV, 0.0);
  vec3 col = farSoftened(vUV, d, c.rgb);
  if (atmCloudSteps > 0.5 && d < FAR_SOFT_SKY) {
    vec2 ndc = vUV * 2.0 - 1.0;
    vec3 rd = normalize(farForward + ndc.x * farRight + ndc.y * farUp);
    float t = d / max(dot(rd, farForward), 1.0e-4);
    float od = atmCloudDepth(farEye, rd, t);
    float cloudGlow = pow(max(dot(rd, atmSunDir), 0.0), atmCloudGlow.y) * atmCloudGlow.x;
    vec3 cloud = atmCloudColour + atmSunColour * cloudGlow;
    col = mix(cloud, col, exp(-od));
  }
  gl_FragColor = vec4(col, c.a);
}
