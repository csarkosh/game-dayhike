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
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;
uniform vec2 texel;
uniform vec3 soft;

const float FAR_SOFT_SKY = 100000.0;

float farDepth(vec2 uv) {
  float d = textureLod(depthSampler, uv, 0.0).r;
  return d > 0.0 ? d : FAR_SOFT_SKY;
}

void main(void) {
  float d = farDepth(vUV);
  vec4 c = textureLod(textureSampler, vUV, 0.0);
  float r = smoothstep(soft.x, soft.y, d) * soft.z;
  if (r < 0.2) {
    gl_FragColor = c;
    return;
  }
  vec3 sum = c.rgb;
  float wsum = 1.0;
  for (int i = 0; i < 12; i++) {
    float a = i < 8 ? float(i) * 0.7853982 : float(i - 8) * 1.5707963 + 0.7853982;
    float ring = i < 8 ? r : r * 0.5;
    vec2 o = vec2(cos(a), sin(a)) * ring * texel;
    float dn = farDepth(vUV + o);
    float w = step(d * 0.8, dn);
    sum += textureLod(textureSampler, vUV + o, 0.0).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, c.a);
}
