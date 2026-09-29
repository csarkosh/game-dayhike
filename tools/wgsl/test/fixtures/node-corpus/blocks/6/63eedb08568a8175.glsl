struct preLightingInfo
{vec3 lightOffset;
float lightDistanceSquared;
float lightDistance;
float attenuation;
vec3 L;
vec3 H;
float NdotV;
float NdotLUnclamped;
float NdotL;
float VdotH;
float LdotV;
float roughness;
float diffuseRoughness;
vec3 surfaceAlbedo;
};