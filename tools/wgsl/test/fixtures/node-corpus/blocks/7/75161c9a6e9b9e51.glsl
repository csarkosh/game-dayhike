#define inline
vec3 computeProjectionTextureDiffuseLighting(sampler2D projectionLightSampler,mat4 textureProjectionMatrix,vec3 posW){vec4 strq=textureProjectionMatrix*vec4(posW,1.0);
strq/=strq.w;
vec3 textureColor=texture(projectionLightSampler,strq.xy).rgb;
return toLinearSpace(textureColor);
}