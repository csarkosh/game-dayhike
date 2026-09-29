float adjustRoughnessFromLightProperties(float roughness,float lightRadius,float lightDistance) {
float lightRoughness=lightRadius/lightDistance;
float totalRoughness=saturate(lightRoughness+roughness);
return totalRoughness;
}