t=textureSampleLevel(oceanWindDisp,oceanWindDispSampler,w/FFT_CASCADE_0,0,0.0).xyz*oceanWindRingKeep(FFT_CASCADE_0,cell)
      +textureSampleLevel(oceanWindDisp,oceanWindDispSampler,w/FFT_CASCADE_1,1,0.0).xyz*oceanWindRingKeep(FFT_CASCADE_1,cell)
      +textureSampleLevel(oceanWindDisp,oceanWindDispSampler,w/FFT_CASCADE_2,2,0.0).xyz*oceanWindRingKeep(FFT_CASCADE_2,cell);
