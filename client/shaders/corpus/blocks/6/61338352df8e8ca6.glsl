#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vec3 positionUpdated=position;
vec3 normalUpdated=normal;
vec4 tangentUpdated=tangent;
vec2 uvUpdated=uv;
#define CUSTOM_VERTEX_UPDATE_POSITION
#define CUSTOM_VERTEX_UPDATE_NORMAL
mat4 finalWorld=world;
mat4 influence;
mat4 readMatrixFromRawSampler_0;
{
int offset=int(matricesIndices[0])*4;
int textureWidth=int(boneTextureInfo.x);
int y=int(offset)/textureWidth;
int x=int(offset) % textureWidth;
vec4 m0=texelFetch(boneSampler,ivec2(x+0,y),0);
vec4 m1=texelFetch(boneSampler,ivec2(x+1,y),0);
vec4 m2=texelFetch(boneSampler,ivec2(x+2,y),0);
vec4 m3=texelFetch(boneSampler,ivec2(x+3,y),0);
readMatrixFromRawSampler_0 = mat4(m0,m1,m2,m3);
}