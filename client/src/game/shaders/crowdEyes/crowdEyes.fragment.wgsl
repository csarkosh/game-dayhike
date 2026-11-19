${varyings}
@fragment fn mainFragment(input:EyesOut)->@location(0)vec4<f32>{
  let round=1.0-smoothstep(0.25,1.0,length(input.corner));
  return vec4<f32>(input.colour.rgb*input.colour.a,round);
}
