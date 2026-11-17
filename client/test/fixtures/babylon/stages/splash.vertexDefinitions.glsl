// The game's shell on Babylon.js 9.18.0: SplashPlugin.prototype.getCustomCode.call({}, "vertex").CUSTOM_VERTEX_DEFINITIONS (rainSplash.ts)

#ifdef SPLASH
attribute vec4 splashSeed;
varying float vSplashAlpha;
varying float vSplashPhase;
varying vec2 vSplashUv;
uniform sampler2D splashMapSampler;
vec2 splashHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
#endif
