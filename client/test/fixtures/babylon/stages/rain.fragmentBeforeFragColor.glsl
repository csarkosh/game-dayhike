// The game's shell on Babylon.js 9.18.0: RainPlugin.prototype.getCustomCode.call({}, "fragment").CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR (rainPlugin.ts)

#ifdef RAIN
color.rgb = mix(color.rgb, rainLampColour, vRainLamp);
color.a *= vRainAlpha;
#endif
