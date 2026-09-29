// terrainHorizon = (start, end, max). Mirrors horizonWeight.
float horizonWeight(float dist) {
return terrainHorizon.z * smoothstep(terrainHorizon.x, terrainHorizon.y, dist);
}