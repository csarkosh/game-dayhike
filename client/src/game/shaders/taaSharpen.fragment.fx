// The temporal anti-aliasing's sharpen (post.ts, 2026-10-28): the TAA's
// output copied on down the chain with the detail its history blending
// softened lifted back, an unsharp mask on the four neighbours held inside
// their range so no edge rings. The TAA's history keeps the unsharpened
// frame, so the lift never builds up from frame to frame.
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 texel;
uniform float sharpen;

void main(void) {
  vec4 c = textureLod(textureSampler, vUV, 0.0);
  vec3 n = textureLod(textureSampler, vUV + vec2(0.0, texel.y), 0.0).rgb;
  vec3 s = textureLod(textureSampler, vUV - vec2(0.0, texel.y), 0.0).rgb;
  vec3 e = textureLod(textureSampler, vUV + vec2(texel.x, 0.0), 0.0).rgb;
  vec3 w = textureLod(textureSampler, vUV - vec2(texel.x, 0.0), 0.0).rgb;
  vec3 lo = min(c.rgb, min(min(n, s), min(e, w)));
  vec3 hi = max(c.rgb, max(max(n, s), max(e, w)));
  vec3 lifted = c.rgb + sharpen * (c.rgb - 0.25 * (n + s + e + w));
  gl_FragColor = vec4(clamp(lifted, lo, hi), c.a);
}
