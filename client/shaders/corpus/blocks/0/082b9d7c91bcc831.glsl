vec3 computeProjectionCoords(vec4 worldPos,mat4 view,mat4 reflectionMatrix)
{return vec3(reflectionMatrix*(view*worldPos));
}