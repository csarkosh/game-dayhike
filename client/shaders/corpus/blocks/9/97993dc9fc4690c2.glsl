    // Rock's X-facing projection samples vPositionW.yz, so the map's x runs
    // along world Y and its y along world Z: x,y order,
    // same rule as the other two faces (ty samples xz -> x,y; tz samples
    // xy -> x,y).
vec3 pert = vec3(planar.x, 0.0, planar.y)
+ w2 * (vec3(0.0, tx.x, tx.y) * bw.x + vec3(ty.x, 0.0, ty.y) * bw.y + vec3(tz.x, tz.y, 0.0) * bw.z);
nrm = normalize(terrainN + pert * strength);
    // Written here, inside the gate, not unconditionally below: when strength
    // is 0 this branch never runs at all, so Babylon's own normalW is left
    // exactly as it was rather than being overwritten with terrainN, which
    // contributes nothing new in that case.
normalW = nrm;
}