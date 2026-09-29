vec3 computeSkyBoxCoords(vec3 positionW,mat4 reflectionMatrix)
{return vec3(reflectionMatrix*vec4(positionW,1.));
}