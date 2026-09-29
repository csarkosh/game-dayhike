{
float dfN = dfNoise(glFragCoord_.xy);
float dfIn = smoothstep(vFadeBands.x, vFadeBands.y, vFadeDist);
float dfOut = 1.0 - smoothstep(vFadeBands.z, vFadeBands.w, vFadeDist);
if (dfIn < 1.0 - dfN || dfOut < dfN) discard;
}