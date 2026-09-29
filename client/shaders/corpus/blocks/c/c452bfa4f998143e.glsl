vec3 computeReflectionCoords(vec4 worldPos,vec3 worldNormal)
{
return computeCubicCoords(worldPos,worldNormal,vEyePosition.xyz,reflectionMatrix);
}