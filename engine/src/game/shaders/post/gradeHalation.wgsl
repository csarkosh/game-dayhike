  let halo=textureSampleLevel(halationSampler,postSampler,tx(vUV),0.0).rgb*u.halationStrength;
  c=1.0-(1.0-c)*(1.0-clamp(halo,vec3<f32>(0.0),vec3<f32>(1.0)));
