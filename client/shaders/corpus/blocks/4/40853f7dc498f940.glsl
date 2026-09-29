layout(location = 0) out vec4 glFragColor;
void main(void) {
float terrainRough = 1.0;
float terrainF0 = 1.0;
#define CUSTOM_FRAGMENT_MAIN_BEGIN
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);
vec3 normalW=normalize(vNormalW);
vec3 geometricNormalW=normalW;
vec2 uvOffset=vec2(0.0,0.0);
albedoOpacityOutParams albedoOpacityOut;
albedoOpacityOut=albedoOpacityBlock(
vAlbedoColor
,baseWeight
);
vec3 surfaceAlbedo=albedoOpacityOut.surfaceAlbedo;
float alpha=albedoOpacityOut.alpha;
#define CUSTOM_FRAGMENT_UPDATE_ALPHA
{
vec2 uvXZ = vPositionW.xz;
vec2 uvG = uvXZ * terrainTiling.x;
vec2 uvF = uvXZ * terrainTiling.y;
vec2 uvS = uvXZ * terrainTiling.z;
vec2 uvP = uvXZ * terrainTiling.w;
  // Gradients of the UNROTATED uv, and the lattice they index, computed once
  // per scale: a hex seam then changes which texel is fetched but not the mip
  // level, so no seam shows as a blur line. Both pairs are taken here, in
  // uniform control flow, rather than inside the gates that use them —
  // a derivative taken in non-uniform flow is undefined by the spec.
vec2 gdx = dFdx(uvG);
vec2 gdy = (-yFactor_)*dFdy(uvG);
vec2 uvD = uvXZ * terrainDetail.x;
vec2 ddx = dFdx(uvD);
vec2 ddy = (-yFactor_)*dFdy(uvD);
  // The 2 m hex lattice is grass-only work: gated on the raw vertex weight so
  // non-grass ground never pays for a lattice walk and three hashed fetches.
  // At exactly zero vertex weight the grass maps switch from the three-tap
  // hex to one plain fetch, so wherever the height blend below still hands
  // grass a share the pattern changes there too — same mean, different
  // texels, bounded by that share times the map's own variance. The coast is
  // the one ground this happens on today.
vec2 g1 = vec2(0.0);
vec2 g2 = vec2(0.0);
vec2 g3 = vec2(0.0);
vec3 gw = vec3(0.0);
if (vTerrainW.x > 0.0) {
hexSetup(uvG, g1, g2, g3, gw);
}