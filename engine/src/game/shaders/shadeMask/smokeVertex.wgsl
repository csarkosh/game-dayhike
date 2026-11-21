{
  let shadeSmokeTime=${frameBlock}.${shadeSmokeTimeName};
  var w=out.worldPos;
  let shadeSmokeSwell=shadeSmokeFbm(shadeSmokeAt(w,shadeSmokeTime)*0.5+vec3<f32>(shadeSmokeTime*0.11,0.0,shadeSmokeTime*0.07))-0.5;
  w+=normalize(out.worldNormal)*shadeSmokeSwell*2.0*${shadeSmokeSwellM};
  out.worldPos=w;
  out.clipPos=scene.viewProjection*vec4<f32>(w,1.0);
  out.vShadeLook=shadeLook;
  out.vShadeFeet=shadeFeet.xy;
}
