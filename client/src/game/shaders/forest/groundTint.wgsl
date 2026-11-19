{let cHas=step(1.0/255.0,max(input.vCliffTint.r,max(input.vCliffTint.g,input.vCliffTint.b)));surfaceAlbedo=mix(surfaceAlbedo,input.vCliffTint.rgb,${ground}*cHas);}
