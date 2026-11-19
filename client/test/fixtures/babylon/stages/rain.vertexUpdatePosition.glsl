// The game's shell on Babylon.js 9.18.0: RainPlugin.prototype.getCustomCode.call({}, "vertex").CUSTOM_VERTEX_UPDATE_POSITION (rainPlugin.ts)

#ifdef RAIN
{
#ifdef RAIN_DRIP
  float rSpeed = 6.0;
  float rWidth = 0.04;
  float rClassAlpha = 1.0;
  vec3 rDrift = vec3(0.0, -rSpeed * rainFold / rainBoxSize.y, 0.0);
#else
  float rkI = floor(rainSeed.w * 3.0 + 0.5);
  vec4 rkSel = vec4(equal(vec4(rkI), vec4(0.0, 1.0, 2.0, 3.0)));
  float rSpeed = dot(rainSpeeds, rkSel);
  float rWidth = dot(rainWidths, rkSel);
  float rClassAlpha = dot(rainAlphas, rkSel);
  vec3 rDrift = vec3(rainDrift.x, -rSpeed * rainFold / rainBoxSize.y, rainDrift.y);
#endif
  vec3 rq = fract(rainSeed.xyz + rDrift - rainBoxMin / rainBoxSize);
  vec3 rp = rainBoxMin + rq * rainBoxSize;
#ifdef RAIN_DRIP
  vec3 rAlong = vec3(0.0, -1.0, 0.0);
#else
  vec3 rAlong = normalize(vec3(rainWind.x, -rSpeed, rainWind.y));
#endif
  vec3 rToCam = rainCam - rp;
  float rDist = max(length(rToCam), 0.001);
  vec3 rView = rToCam / rDist;
  vec3 rSide = cross(rAlong, rView);
  vec3 rRight = rSide / max(length(rSide), 0.001);
#ifdef RAIN_DRIP
  float rLen = 0.12;
#else
  float rLen = clamp(rSpeed * rainDt * 1.5, 0.08, 0.5);
#endif
  positionUpdated = rp + rRight * (position.x * rWidth) + rAlong * (position.y * rLen);
  float rFade = smoothstep(0.6, 1.5, rDist) * (1.0 - smoothstep(9.0, 12.0, rDist));
  float rSky = 1.0 - 0.35 * smoothstep(0.0, 0.5, -rView.y);
  vec3 rToLamp = rp - rainLampPos;
  float rLampD2 = dot(rToLamp, rToLamp);
  float rCos = dot(rToLamp, rainLampDir) / sqrt(max(rLampD2, 0.0001));
  float rCone = smoothstep(rainLamp.y, 0.5 + 0.5 * rainLamp.y, rCos);
  float rLampT = rainLamp.x * rCone / (1.0 + rLampD2);
  float rCover = 1.0;
#ifdef RAIN_OCCLUSION
  vec2 rMu = (rp.xz - rainMapCentre) / rainMapExtent + 0.5;
  vec4 rMap = texture2D(rainMapSampler, rMu);
  float rInMap = step(0.0, rMu.x) * step(rMu.x, 1.0) * step(0.0, rMu.y) * step(rMu.y, 1.0);
  float rCovered = rInMap * step(rp.y, rMap.r + rMap.b);
#ifdef RAIN_DRIP
  rCover = rCovered * (1.0 - rMap.g) * rainCanopyWater;
#else
  rCover = mix(1.0, max(rMap.g, step(0.5, rMap.b)), rCovered);
#endif
#else
#ifdef RAIN_DRIP
  rCover = 0.0;
#endif
#endif
  vRainAlpha = min(rFade * rCover * (rSky * rClassAlpha + rLampT), 1.0);
  vRainLamp = min(rLampT, 1.0);
}
#endif
