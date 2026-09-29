aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
vec4 diffuse2=light2.vLightDiffuse;
#define CUSTOM_LIGHT2_COLOR 
info=computeHemisphericLighting(viewDirectionW,normalW,light2.vLightData,diffuse2.rgb,light2.vLightSpecular.rgb,light2.vLightGround,glossiness);
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
aggShadow=aggShadow/numLights;
vec4 refractionColor=vec4(0.,0.,0.,1.);
vec4 reflectionColor=vec4(0.,0.,0.,1.);
vec3 emissiveColor=vEmissiveColor;
vec3 finalDiffuse=clamp(diffuseBase*diffuseColor+emissiveColor+vAmbientColor,0.0,1.0)*baseColor.rgb;
vec3 finalSpecular=specularBase*specularColor;
vec4 color=vec4(finalDiffuse*baseAmbientColor+finalSpecular+reflectionColor.rgb+refractionColor.rgb,alpha);
#define CUSTOM_FRAGMENT_BEFORE_FOG
color.rgb=max(color.rgb,0.);
float fog=CalcFogFactor();
color.rgb=mix(vFogColor,color.rgb,fog);
color.rgb=toLinearSpace(color.rgb);
color.a*=visibility;
#define CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR
glFragColor=color;
#define CUSTOM_FRAGMENT_MAIN_END
}