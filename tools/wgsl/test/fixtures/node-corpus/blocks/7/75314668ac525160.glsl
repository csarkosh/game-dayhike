// Interleaved gradient noise on pixel coordinates plus a per-frame offset,
// the distanceFadePlugin pattern.
float finishNoise(vec2 p, float seed) {
return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y + seed));
}