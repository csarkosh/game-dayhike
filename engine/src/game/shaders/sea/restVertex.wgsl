{${ring}
  let seaAt=seaRecord.xy+position.xz*seaSpacing;
  out.worldPos=vec3<f32>(seaAt.x,${level},seaAt.y);
  out.clipPos=scene.viewProjection*vec4<f32>(out.worldPos,1.0);${hole}
}
