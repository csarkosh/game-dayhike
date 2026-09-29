vColor=vec4(1.0);
vColor.rgb*=colorUpdated.rgb;
vTerrainW = terrainWeights;
vTerrainW2 = terrainWeights2;
vTerrainCover = terrainCover;
#define CUSTOM_VERTEX_MAIN_END
gl_Position.y *= yFactor_;
}