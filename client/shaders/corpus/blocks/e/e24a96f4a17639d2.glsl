{
vec2 tb = clamp((vPositionW.xz - trailInfo.xy) * trailInfo.z, 0.0, trailInfo.w - 1.0);
vec2 tIdx = texture(trailIndex, (floor(tb) + 0.5) / trailInfo.w).xy;
float tdBest = 1.0e9;
vec2 tOff = vec2(0.0);
float tuBest = 0.0;
float ttBest = 0.0;
for (int ti = 0;
ti < 32;
ti++) {
if (float(ti) >= tIdx.y) break;
float tu = (tIdx.x + float(ti) + 0.5) / 512.0;
vec4 ts = texture(trailSegs, vec2(tu, 0.25));
vec2 te = ts.zw - ts.xy;
vec2 tp = vPositionW.xz - ts.xy;
float tl2 = dot(te, te);
float tt = tl2 > 0.0 ? clamp(dot(tp, te) / tl2, 0.0, 1.0) : 0.0;
vec2 to = tp - tt * te;
float td = length(to);
if (td < tdBest) { tdBest = td;
tOff = to;
tuBest = tu;
ttBest = tt;
}