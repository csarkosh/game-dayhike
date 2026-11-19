fn mossHash(p:vec2<f32>)->f32{var p3=fract(vec3<f32>(p.x,p.y,p.x)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
