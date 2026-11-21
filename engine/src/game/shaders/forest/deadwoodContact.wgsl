surfaceAlbedo*=mix(1.0,mix(${deadwoodContact},1.0,smoothstep(${deadwoodContactBand0},${deadwoodContactBand1},input.vDeadwood.z)),dwLog);
