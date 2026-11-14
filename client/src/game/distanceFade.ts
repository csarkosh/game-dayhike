/**
 * The distance dither's arithmetic (`distanceFadePlugin.ts` says what the
 * fade is and draws it): the bands an instance fades in and out across, the
 * visibility and the discard the fragment stage computes from them, the
 * screen-space noise they are tested against, how a material's instances
 * widen with distance, and the uniforms the fade is drawn with as one record
 * by name. Loads no engine.
 */

/** (inStart, inEnd, outStart, outEnd) in metres from the eye. */
export type FadeBands = readonly [number, number, number, number];

/** A band that never fires. Two DISTINCT edges: smoothstep(e, e, x) is
 * undefined in GLSL, so a no-op band cannot be a degenerate one. Negative,
 * so every real distance is already past it; 1e8, so none reaches it. */
export const FADE_NONE_IN: readonly [number, number] = [-2, -1];
export const FADE_NONE_OUT: readonly [number, number] = [1e8, 2e8];
export const FADE_ALWAYS: FadeBands = [FADE_NONE_IN[0], FADE_NONE_IN[1], FADE_NONE_OUT[0], FADE_NONE_OUT[1]];

export function fadeBands(
  inBand: readonly [number, number] | null,
  outBand: readonly [number, number] | null,
): FadeBands {
  const i = inBand ?? FADE_NONE_IN;
  const o = outBand ?? FADE_NONE_OUT;
  return [i[0], i[1], o[0], o[1]];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The visibility DISTANCE_FADE_FRAGMENT computes: 0 before the in-band,
 * 1 between the bands, 0 at and beyond the out-band, smoothstep across each. */
export function fadeVisibility(dist: number, bands: FadeBands): number {
  return smoothstep(bands[0], bands[1], dist) * (1 - smoothstep(bands[2], bands[3], dist));
}

/** The GLSL discard predicate (`FADE_FRAGMENT_MAIN_BEGIN`), mirrored exactly:
 * `true` means the fragment is KEPT (not discarded) at this noise sample.
 * `smoothstep(bands.x, bands.y, dist)` is the in-band term and
 * `1 - smoothstep(bands.z, bands.w, dist)` the out-band term — NOT their
 * product (an earlier version had this bug): each is tested against noise on its
 * own side of the partition, `1 − noise` for the incoming (in-band) term, so
 * two buckets meeting at a seam keep complementary halves of every pixel
 * instead of nested or gapped ones. */
export function fadeKeeps(dist: number, bands: FadeBands, noise: number): boolean {
  const dfIn = smoothstep(bands[0], bands[1], dist);
  const dfOut = 1 - smoothstep(bands[2], bands[3], dist);
  return !(dfIn < 1 - noise || dfOut < noise);
}

/** The single-edge CPU sibling of `fadeVisibility`'s out-band half: 1 inside
 * `edgeStart`, 0 at and beyond `edgeEnd`, smoothstep between. Moved here from
 * the retired clutter edge-fade plugin — `wildlifeMeshes.ts`
 * still needs it: a pooled creature is a container CLONE sharing its
 * species' material, so it cannot carry the per-instance `fadeBands`
 * attribute this file's thin-instance path uses, and shrinks its own root
 * transform toward zero by this weight instead, on the CPU. */
export function fadeWeight(distance: number, edgeStart: number, edgeEnd: number): number {
  return 1 - smoothstep(edgeStart, edgeEnd, distance);
}

/** Interleaved gradient noise (Jimenez 2014) on pixel coordinates — a fixed
 * screen-space pattern, so the dissolve does not crawl as the camera moves. */
export function ign(x: number, y: number): number {
  const f = (v: number) => v - Math.floor(v);
  return f(52.9829189 * f(0.06711056 * x + 0.00583715 * y));
}

export function writeFadeBands(buf: Float32Array, offset: number, bands: FadeBands): void {
  buf[offset] = bands[0];
  buf[offset + 1] = bands[1];
  buf[offset + 2] = bands[2];
  buf[offset + 3] = bands[3];
}

/** How a material's instances widen with eye distance (`setDistanceWiden`):
 * across `band` the card grows about its origin, in the ground plane, from
 * its own width to `factor` times it. */
export type DistanceWiden = { readonly band: readonly [number, number]; readonly factor: number };

/** No widening: the band never reached, the factor one. */
export const WIDEN_NONE: DistanceWiden = { band: [1e8, 2e8], factor: 1 };

/** The fade's uniforms by name: the eye the distances are measured from, and
 * the widening as (band start, band end, growth past one). */
export type FadeUniforms = { fadeEye: [number, number, number]; fadeWiden: [number, number, number] };

/** A record of the right shape, every component zero. */
export function emptyFadeUniforms(): FadeUniforms {
  return { fadeEye: [0, 0, 0], fadeWiden: [0, 0, 0] };
}

/**
 * The uniforms a material's fade is drawn with, into `out`: the eye (the
 * origin where there is none) and `widen` as the band's edges and the growth
 * past one, so a factor of one is a no-op.
 */
export function fadeUniforms(eye: { x: number; y: number; z: number } | null | undefined, widen: DistanceWiden, out: FadeUniforms): FadeUniforms {
  out.fadeEye[0] = eye?.x ?? 0;
  out.fadeEye[1] = eye?.y ?? 0;
  out.fadeEye[2] = eye?.z ?? 0;
  out.fadeWiden[0] = widen.band[0];
  out.fadeWiden[1] = widen.band[1];
  out.fadeWiden[2] = widen.factor - 1;
  return out;
}
