vec3 getBRDFLookup(float NdotV,float perceptualRoughness) {vec2 UV=vec2(NdotV,perceptualRoughness);
vec4 brdfLookup=texture(environmentBrdfSampler,UV);
brdfLookup.rgb=fromRGBD(brdfLookup.rgba);
return brdfLookup.rgb;
}