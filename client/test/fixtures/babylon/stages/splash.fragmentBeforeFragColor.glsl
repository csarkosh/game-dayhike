// The game's shell on Babylon.js 9.18.0: SplashPlugin.prototype.getCustomCode.call({}, "fragment").CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR (rainSplash.ts)

#ifdef SPLASH
{
  float sD = length(vSplashUv - 0.5) * 2.0;
  float sRing = 1.0 - smoothstep(0.0, 0.15, abs(sD - (0.3 + 0.7 * vSplashPhase)));
  color.a *= sRing * vSplashAlpha;
}
#endif
