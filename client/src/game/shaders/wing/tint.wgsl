{
let wingWay=u32(clamp(finalWorld[2].w,0.0,${lastWay}));
var wingTints=array<vec3<f32>,${wayCount}>(${wayColours});
out.vWingTint=wingTints[wingWay];
}
