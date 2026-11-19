{let tF0=dielectricF0*terrainF0*terrainSpecW;colorF0=vec3<f32>(tF0);colorF90=vec3<f32>(terrainSpecW);surfaceAlbedo*=1.0-tF0;}
