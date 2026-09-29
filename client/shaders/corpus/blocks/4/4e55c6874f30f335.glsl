layout(location = 1)  in vec2 vBumpUV;
layout(set = 1, binding = 14) uniform sampler bumpSamplerSampler;
                        layout(set = 1, binding = 13) uniform texture2D bumpSamplerTexture;
                        #define bumpSampler sampler2D(bumpSamplerTexture, bumpSamplerSampler)
vec3 computeFixedEquirectangularCoords(vec4 worldPos,vec3 worldNormal,vec3 direction)
{float lon=atan(direction.z,direction.x);
float lat=acos(direction.y);
vec2 sphereCoords=vec2(lon,lat)*RECIPROCAL_PI2*2.0;
float s=sphereCoords.x*0.5+0.5;
float t=sphereCoords.y;
return vec3(s,t,0);
}