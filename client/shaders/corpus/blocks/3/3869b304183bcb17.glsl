mat3 cotangent_frame(vec3 normal,vec3 p,vec2 uv,vec2 tangentSpaceParams)
{vec3 dp1=dFdx(p);
vec3 dp2=(-yFactor_)*dFdy(p);
vec2 duv1=dFdx(uv);
vec2 duv2=(-yFactor_)*dFdy(uv);
vec3 dp2perp=cross(dp2,normal);
vec3 dp1perp=cross(normal,dp1);
vec3 tangent=dp2perp*duv1.x+dp1perp*duv2.x;
vec3 bitangent=dp2perp*duv1.y+dp1perp*duv2.y;
tangent*=tangentSpaceParams.x;
bitangent*=tangentSpaceParams.y;
float det=max(dot(tangent,tangent),dot(bitangent,bitangent));
float invmax=det==0.0 ? 0.0 : inversesqrt(det);
return mat3(tangent*invmax,bitangent*invmax,normal);
}