let k0=oceanWindPixelKeep(FFT_CASCADE_0,FFT_N,pixel);
    let k1=oceanWindPixelKeep(FFT_CASCADE_1,FFT_N,pixel);
    let k2=oceanWindPixelKeep(FFT_CASCADE_2,FFT_N,pixel);
    g=textureSampleLevel(oceanWindSlope,oceanWindDispSampler,w/FFT_CASCADE_0,0,0.0).xy*k0
      +textureSampleLevel(oceanWindSlope,oceanWindDispSampler,w/FFT_CASCADE_1,1,0.0).xy*k1
      +textureSampleLevel(oceanWindSlope,oceanWindDispSampler,w/FFT_CASCADE_2,2,0.0).xy*k2;
    o.drawn=k0*k0*material.oceanWindStats.y+k1*k1*material.oceanWindStats.z+k2*k2*material.oceanWindStats.w;
