#version 450
#define SHADER_NAME fragment:shadeVeil
layout(set = 1, binding = 3) uniform LeftOver {
        vec2 scale;
    vec4 stareShade;
    vec4 shadeShape;
    float shadeMonster;
};

// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};

// The shade veil (shadeVeil.ts, shadeVeilParams.ts): one quad over the frame
// after the scene, on the material path (the tiers with no post chain),
// multiplied into it. It writes a factor, 1 where nothing darkens: the haunt's
// shades read back through a blur of their mask, and the stare's darkness
// closing on an open centre, both exactly as the grade pass draws them on the
// post tiers. The two blocks below are grade.fragment.fx's, verbatim, and
// shadeVeilShader.test.ts holds them so: the grade's own text is recorded in
// the WGSL corpus and is not edited for this. The frame is sRGB-encoded by the
// time this draws, where the grade multiplies in linear light, so the factor
// is raised to the display's gamma (VEIL_GAMMA) before it is written.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.
precision highp float;
layout(location = 0)  in vec2 vUV;
// The stare (stareLens.ts): xy the open centre's offset, z how far the
// darkness has closed, w the seconds its edge crawls on.

// The haunt's shades (shadeSilhouette.ts): a mask of their silhouettes, red
// the softness, read back through a blur of radius x (in the frame's width),
// darkening the frame by y of it; z is the frame's aspect, w is 1 while any
// shade is in the mask and 0 to skip the taps.
layout(set = 1, binding = 2) uniform sampler shadeSamplerSampler;
                        layout(set = 1, binding = 1) uniform texture2D shadeSamplerTexture;
                        #define shadeSampler sampler2D(shadeSamplerTexture, shadeSamplerSampler)


// Blotches for the shades' going: one octave of value noise on a hash, no
// sampler, so it costs the veil no texture unit.
float shadeHash(vec2 p) {
return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float shadeNoise(vec2 p) {
vec2 i = floor(p);
vec2 f = fract(p);
f = f * f * (3.0 - 2.0 * f);
float a = shadeHash(i);
float b = shadeHash(i + vec2(1.0, 0.0));
float c = shadeHash(i + vec2(0.0, 1.0));
float d = shadeHash(i + vec2(1.0, 1.0));
return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
layout(location = 0) out vec4 glFragColor;
void main() {
vec3 c = vec3(1.0);
vec2 centred = (vUV - 0.5) * 2.0;
  // The shades: nine taps of the mask, the centre and a ring, the figure a
  // dark blur. The grade's block, verbatim.
vec2 shadeStep = vec2(shadeShape.x, shadeShape.x * shadeShape.z);
vec3 shadeInner = texture(shadeSampler, vUV).rgb * 2.0;
shadeInner += texture(shadeSampler, vUV + shadeStep * vec2(0.5, 0.0)).rgb;
shadeInner += texture(shadeSampler, vUV + shadeStep * vec2(-0.5, 0.0)).rgb;
shadeInner += texture(shadeSampler, vUV + shadeStep * vec2(0.0, 0.5)).rgb;
shadeInner += texture(shadeSampler, vUV + shadeStep * vec2(0.0, -0.5)).rgb;
shadeInner += texture(shadeSampler, vUV + shadeStep * vec2(0.35, 0.35)).rgb;
shadeInner += texture(shadeSampler, vUV + shadeStep * vec2(-0.35, 0.35)).rgb;
shadeInner += texture(shadeSampler, vUV + shadeStep * vec2(0.35, -0.35)).rgb;
shadeInner += texture(shadeSampler, vUV + shadeStep * vec2(-0.35, -0.35)).rgb;
vec3 shadeOuter = texture(shadeSampler, vUV + shadeStep * vec2(1.0, 0.0)).rgb;
shadeOuter += texture(shadeSampler, vUV + shadeStep * vec2(-1.0, 0.0)).rgb;
shadeOuter += texture(shadeSampler, vUV + shadeStep * vec2(0.0, 1.0)).rgb;
shadeOuter += texture(shadeSampler, vUV + shadeStep * vec2(0.0, -1.0)).rgb;
shadeOuter += texture(shadeSampler, vUV + shadeStep * vec2(0.7, 0.7)).rgb;
shadeOuter += texture(shadeSampler, vUV + shadeStep * vec2(-0.7, 0.7)).rgb;
shadeOuter += texture(shadeSampler, vUV + shadeStep * vec2(0.7, -0.7)).rgb;
shadeOuter += texture(shadeSampler, vUV + shadeStep * vec2(-0.7, -0.7)).rgb;
vec3 shadeRGB = (shadeInner + shadeOuter) * shadeShape.w / 18.0;
float shadeReal = shadeInner.z * shadeShape.w / 10.0;
float shadeFigure = shadeRGB.x + shadeRGB.z;
float shadeGone = shadeRGB.y / max(shadeFigure, 1.0e-4);
float shadeBlot = shadeNoise(vUV * vec2(shadeShape.z, 1.0) * 9.0 + stareShade.w * 0.12);
float shadeKeep = smoothstep(shadeGone - 0.35, shadeGone + 0.05, shadeBlot);
c *= 1.0 - min(1.0, shadeRGB.x * shadeShape.y + shadeReal * shadeMonster) * shadeKeep;
  // The stare: black closing on an open centre that sits off the Hollow. The
  // grade's block, verbatim.
vec2 sp = centred - stareShade.xy;
float sa = atan(sp.y, sp.x);
float st = stareShade.w;
float crawl = 0.5 * sin(sa * 2.0 + st * 0.37) + 0.3 * sin(sa * 3.0 - st * 0.56 + 1.7) + 0.2 * sin(sa * 7.0 + st * 0.94 + 4.1);
float sr = length(sp) / 1.41421356 + crawl * 0.11 * stareShade.z;
float openTo = mix(1.25, 0.3, stareShade.z);
float dark = smoothstep(openTo - 0.42, openTo + 0.14, sr) * min(1.0, stareShade.z * 3.0);
c *= 1.0 - 0.97 * dark;
glFragColor = vec4(pow(c, vec3(0.45454545454545453)), 1.0);
}
