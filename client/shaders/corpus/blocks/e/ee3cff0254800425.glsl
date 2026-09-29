vec2 rStep = rAb * rDepth / 12.0;
float rLayer = 1.0 / 12.0;
vec2 rOff = vec2(0.0);
float rD = 0.0;
float rPrev = -(1.0 - texture(terrainRAH, vec3(rUv, 2.0)).b);
bool rHit = rPrev >= 0.0;
for (int ri = 0;
ri < 12;
ri++) {
if (rHit) break;
vec2 nOff = rOff + rStep;
float nD = rD + rLayer;
float rDiff = nD - (1.0 - texture(terrainRAH, vec3(rUv + nOff, 2.0)).b);
if (rDiff >= 0.0) { float rT = rPrev / (rPrev - rDiff);
rOff = rOff + rStep * rT;
rHit = true;
}