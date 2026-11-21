
  let wLens=lakeLens(wRippleXz);
  let wShallow=1.0-smoothstep(0.0,CAUSTIC_DEPTH_M,wBehind);
  wBed*=1.0+clamp(CAUSTIC_GAIN*wOctave*wShallow*material.waterSun*wLens,-CAUSTIC_MAX,CAUSTIC_MAX);
