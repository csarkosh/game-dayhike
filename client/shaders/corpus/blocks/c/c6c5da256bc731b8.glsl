#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vec3 positionUpdated=position;
vec3 normalUpdated=normal;
vec4 colorUpdated=color;
#define CUSTOM_VERTEX_UPDATE_POSITION
#define CUSTOM_VERTEX_UPDATE_NORMAL
mat4 finalWorld=world;
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);
vPositionW=vec3(worldPos);
mat3 normalWorld=mat3(finalWorld);
vNormalW=normalize(normalWorld*normalUpdated);
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);
float NdotV=max(dot(vNormalW,viewDirectionW),0.0);
vec3 roughNormal=mix(vNormalW,viewDirectionW,(0.5*(1.0-NdotV))*baseDiffuseRoughness);
vec3 reflectionVector=vec3(reflectionMatrix*vec4(roughNormal,0)).xyz;
vEnvironmentIrradiance=computeEnvironmentIrradiance(reflectionVector);
// The foliage world-position block, spliced at CUSTOM_VERTEX_UPDATE_WORLDPOS,
// after the thin-instance matrix: worldPos, positionUpdated and finalWorld
// are in scope. Order: clump hash, the up bias on the world normal, motion
// weight, lean, gust (phased at the instance origin so a tuft moves as one),
// flutter (phased at the vertex so blades break up), camera tilt, player
// bend, far sink, then for the blade clumps the collapse: a grow-in from the
// tier inside, the collapse toward the tier outside, and the strength cut,
// each blade pulled toward its root by its share, last so a collapsed
// blade's vertices coincide exactly (the root is taken through finalWorld
// with no displacement).
//
// The motion weight carries the instance's own uniform scale — the Y column's
// length, since thin instances here are uniformly scaled — because
// foliageHeight is the MODEL bounding height while the displacement is added
// in world space. Without it a tree drawn at 5x would lean a fifth as far, in
// drawn terms, as one drawn at 1x. With it the tip lean is the same fraction
// of DRAWN height at every scale: about 2.9 % at the calmest wind, 19.8 % at
// speed 1.
//
// vPositionW is written BEFORE this hook, so fog, viewDirectionW and the
// distance fade all see the undisplaced vertex — centimetres for cards, under
// a metre for crowns, which is below what any of the three can resolve.
//
// COMMENT RULES as in foliage.vertex.fx.
{
const float FOLIAGE_TILT = 0.04;
const float FOLIAGE_BEND = 0.25;
const float FOLIAGE_BEND_R = 0.6;
const float FOLIAGE_SINK = 0.5;
const float FOLIAGE_BLADE_SOFT = 0.15;
vec2 fOrigin = finalWorld[3].xz;
float fH = clamp(positionUpdated.y / foliageHeight, 0.0, 1.0);
float fH2 = fH * fH;
float fDist = distance(fOrigin, windEye.xz);
vec2 fCell = floor(fOrigin / FOLIAGE_CLUMP_CELL);
float fClump = fract(fCell.x * 0.618034 + fCell.y * 0.381966);
float fScale = length(finalWorld[1].xyz);
vec3 fUp = vNormalW + vec3(0.0, foliageNormalUp, 0.0);
float fUl = length(fUp);
vNormalW = fUl > 1.0e-4 ? fUp / fUl : vec3(0.0, 1.0, 0.0);
float fEdge = 1.0 - smoothstep(foliageEdges.x, foliageEdges.y, fDist);
fEdge = 1.0;
float fM = foliageAmp * fH2 * foliageHeight * fScale * fEdge;
vec3 fDir = vec3(windDir.x, 0.0, windDir.y);
float fGust = foliageGust(fOrigin, windTime + 0.6 * (fClump - 0.5));
worldPos.xyz += fDir * (windLean + windGust * fGust) * fM;
float fFlutter = sin(2.1 * worldPos.x + 1.7 * worldPos.z + WIND_OMEGA3 * windTime);
worldPos.xz += windFlutter * fM * fFlutter * vec2(0.75, -0.35);
if (foliageFlags.x > 0.5) {
vec2 fAway = fOrigin - windEye.xz;
worldPos.xz += FOLIAGE_TILT * fH2 * fAway / max(length(fAway), 1.0e-3);
}