influence=readMatrixFromRawSampler_0*matricesWeights[0];
mat4 readMatrixFromRawSampler_1;
{
int offset=int(matricesIndices[1])*4;
int textureWidth=int(boneTextureInfo.x);
int y=int(offset)/textureWidth;
int x=int(offset) % textureWidth;
vec4 m0=texelFetch(boneSampler,ivec2(x+0,y),0);
vec4 m1=texelFetch(boneSampler,ivec2(x+1,y),0);
vec4 m2=texelFetch(boneSampler,ivec2(x+2,y),0);
vec4 m3=texelFetch(boneSampler,ivec2(x+3,y),0);
readMatrixFromRawSampler_1 = mat4(m0,m1,m2,m3);
}