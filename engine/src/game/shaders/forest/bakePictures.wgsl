if(material.bakeMode>1.5){let bakeN=normalize(N);color=vec3<f32>(bakeN.x,bakeN.y,-bakeN.z)*0.5+0.5;alpha=1.0;}else if(material.bakeMode>0.5){color=pow(surfaceAlbedo,vec3<f32>(1.0/2.2));alpha=1.0;}
