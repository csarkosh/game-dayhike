{let fBase=surfaceAlbedo*wetShare;colorF0=mix(vec3<f32>(dielectricF0),fBase,metallic);surfaceAlbedo=fBase*(1.0-dielectricF0)*(1.0-metallic);}
