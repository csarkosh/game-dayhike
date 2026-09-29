vFogDistance=(view*worldPos).xyz;
vColor=vec4(1.0);
vColor*=colorUpdated;
#define CUSTOM_VERTEX_MAIN_END
gl_Position.y *= yFactor_;
}