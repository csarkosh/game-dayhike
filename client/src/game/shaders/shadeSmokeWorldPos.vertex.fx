// The outline swells and draws in along the normal by a slow rising noise, so
// the figure's edge is never still. shadeSmoke.y is the time, shadeSmokeEdge.y
// the most it moves, in metres.
#ifdef SHADESMOKE
#ifdef NORMAL
float shadeSmokeSwell = shadeSmokeFbm(shadeSmokeAt(worldPos.xyz, shadeSmoke.y) * 0.5 + vec3(shadeSmoke.y * 0.11, 0.0, shadeSmoke.y * 0.07)) - 0.5;
worldPos.xyz += vNormalW * shadeSmokeSwell * 2.0 * shadeSmokeEdge.y;
#endif
#endif
