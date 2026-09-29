vec3 getR0RemappedForClearCoat(vec3 f0) {
return saturate(f0*(f0*(0.941892-0.263008*f0)+0.346479)-0.0285998);
}