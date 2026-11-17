// The game's shell on Babylon.js 9.18.0: SplashPlugin.prototype.getCustomCode.call({}, "vertex").CUSTOM_VERTEX_UPDATE_POSITION (rainSplash.ts)

#ifdef SPLASH
{
  float sT = splashTime / 0.12 + splashSeed.x;
  float sCycle = mod(floor(sT), 300.0);
  float sPhase = fract(sT);
  vec2 sH = splashHash(splashSeed.yz + sCycle);
  float sR = 10.0 * sqrt(sH.x);
  float sA = 6.2831853 * sH.y;
  vec2 sXZ = splashCam.xz + vec2(cos(sA), sin(sA)) * sR;
  vec2 sMu = (sXZ - splashMapCentre) / splashMapExtent + 0.5;
  vec4 sMap = texture2D(splashMapSampler, sMu);
  float sIn = step(0.0, sMu.x) * step(sMu.x, 1.0) * step(0.0, sMu.y) * step(sMu.y, 1.0);
  vec3 sp = vec3(sXZ.x, sMap.r, sXZ.y);
  vec3 sToCam = splashCam - sp;
  float sDist = max(length(sToCam), 0.001);
  vec3 sView = sToCam / sDist;
  vec3 sSide = cross(vec3(0.0, 1.0, 0.0), sView);
  vec3 sRight = sSide / max(length(sSide), 0.001);
  vec3 sUp = cross(sView, sRight);
  float sSize = mix(0.06, 0.1, splashSeed.w) * (0.5 + sPhase) * sIn;
  positionUpdated = sp + (sRight * position.x + sUp * position.y) * sSize;
  float sSunT = max(dot(sView, splashSun), 0.0);
  vec3 sToLamp = sp - splashLampPos;
  float sLampD2 = dot(sToLamp, sToLamp);
  float sCos = dot(sToLamp, splashLampDir) / sqrt(max(sLampD2, 0.0001));
  float sCone = smoothstep(splashLamp.y, 0.5 + 0.5 * splashLamp.y, sCos);
  float sLampT = splashLamp.x * sCone / (1.0 + sLampD2);
  float sBack = min(sSunT + sLampT, 1.0);
  vSplashAlpha = (1.0 - sPhase) * splashRain * (0.5 + 0.5 * sBack) * sIn;
  vSplashPhase = sPhase;
  vSplashUv = position.xy + 0.5;
}
#endif
