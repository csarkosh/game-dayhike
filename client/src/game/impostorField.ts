/**
 * The billboard's distance field (2026-10-15): what the forest makes of a
 * bake's pixels once they are read back, so a far tree's rim is a clean
 * curve at any size and not the black confetti an alpha-tested bake with
 * averaged mips leaves.
 *
 * Two things go wrong with a plain bake on an alpha-tested card. Its alpha
 * mips average coverage, so a branch a texel wide is under the cut-off two
 * mips down and a crown thins to dots as it recedes. And the colour outside
 * the tree is the clear's black, which the filter pulls into every rim as the
 * card shrinks. The field answers both as Valve's text does (Green 2007): the
 * alpha becomes a signed distance to the rim, half at the rim, rising to one
 * `IMPOSTOR_FIELD_SPREAD` texels inside and falling to zero as far outside,
 * which averages to the same rim at every mip and is tested at a half; and
 * every texel outside takes the colour of the nearest texel inside, so the
 * filter has nothing black to pull in.
 *
 * The distance is exact: a two-pass Euclidean transform (Felzenszwalb and
 * Huttenlocher 2012) that keeps, for each texel, which seed is nearest, so the
 * one pass gives the outside its distance and its colour. Run twice, the tree
 * as the seeds for the outside and the clear as the seeds for the inside.
 * Pure, so it is tested on small pictures; 512² takes a few tens of
 * milliseconds, once a bake, at load.
 */

/** How far from the rim the field reaches, in texels of the bake, either
 * way: the alpha is 1 this far inside and 0 this far outside. Eight texels at
 * 512 is a sixty-fourth of the card, a fifth of a metre on a giant, wide
 * enough that the field still has a slope four mips down. */
export const IMPOSTOR_FIELD_SPREAD = 8;

/** Alpha at and above which a bake's texel is tree: the bake's own test
 * discards below Babylon's cut-off, so what is left is near opaque. */
export const IMPOSTOR_FIELD_INSIDE = 128;

/** The alpha the card tests the field at: the rim, where the field is half. */
export const IMPOSTOR_FIELD_CUT = 0.5;

/** A tangent-space normal that faces out, as the field writes outside a bake
 * that has no tree at all. */
const FLAT_NORMAL: readonly [number, number, number] = [128, 128, 255];

/** Every texel's distance to its nearest seed and that seed's index into
 * the picture, or −1 and infinity where there is no seed at all. */
export type NearestSeeds = { dist: Float32Array; index: Int32Array };

/**
 * The exact Euclidean distance transform with the nearest seed kept: `seed`
 * is 1 where a texel is a seed. Rows first: each texel's nearest seed along
 * its row. Then down each column, the lower envelope of the rows' parabolas
 * finds the row whose seed is nearest overall, and that row's seed is the
 * answer.
 */
export function nearestSeeds(seed: Uint8Array, width: number, height: number): NearestSeeds {
  const n = width * height;
  const rowDist = new Float32Array(n);
  const rowSeed = new Int32Array(n);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let last = -1;
    for (let x = 0; x < width; x++) {
      if (seed[row + x] !== 0) last = x;
      rowDist[row + x] = last < 0 ? Infinity : x - last;
      rowSeed[row + x] = last;
    }
    last = -1;
    for (let x = width - 1; x >= 0; x--) {
      if (seed[row + x] !== 0) last = x;
      if (last >= 0 && last - x < (rowDist[row + x] as number)) {
        rowDist[row + x] = last - x;
        rowSeed[row + x] = last;
      }
    }
  }
  const dist = new Float32Array(n);
  const index = new Int32Array(n);
  const f = new Float32Array(height);
  const v = new Int32Array(height);
  const z = new Float32Array(height + 1);
  for (let x = 0; x < width; x++) {
    let first = -1;
    for (let y = 0; y < height; y++) {
      const d = rowDist[y * width + x] as number;
      f[y] = d * d;
      if (first < 0 && d !== Infinity) first = y;
    }
    if (first < 0) {
      for (let y = 0; y < height; y++) {
        dist[y * width + x] = Infinity;
        index[y * width + x] = -1;
      }
      continue;
    }
    let k = 0;
    v[0] = first;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = first + 1; q < height; q++) {
      const fq = f[q] as number;
      if (fq === Infinity) continue;
      let s: number;
      for (;;) {
        const vk = v[k] as number;
        s = (fq + q * q - ((f[vk] as number) + vk * vk)) / (2 * q - 2 * vk);
        if (s <= (z[k] as number) && k > 0) {
          k--;
          continue;
        }
        break;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let y = 0; y < height; y++) {
      while ((z[k + 1] as number) < y) k++;
      const vk = v[k] as number;
      const dy = y - vk;
      dist[y * width + x] = Math.sqrt(dy * dy + (f[vk] as number));
      index[y * width + x] = vk * width + (rowSeed[vk * width + x] as number);
    }
  }
  return { dist, index };
}

/** What the field makes of a bake: its colour with the outside filled from
 * the nearest inside and its alpha the signed distance; and the same fill of
 * a second picture over the same alpha, the bake's normals, when given. */
export type ImpostorFields = { albedo: Uint8Array; normal: Uint8Array | null };

/**
 * The field of a bake's RGBA pixels (`width` by `height`, four bytes a
 * texel): the alpha of every texel becomes its signed distance to the rim,
 * `spread` texels either way mapped onto 0 to 1 with the rim at a half
 * (`IMPOSTOR_FIELD_CUT`), and every texel outside takes the nearest inside
 * texel's colour, from both pictures. The rim lies half a texel outside each
 * inside texel's centre, so a pair of texels either side of it read 0.5 ±
 * 1 / (4 · spread) and the filter crosses the cut between them. A bake
 * with no tree is all outside: alpha 0 everywhere, the colour left as it
 * was and the normal flat.
 */
export function impostorFields(
  albedo: Uint8Array,
  normal: Uint8Array | null,
  width: number,
  height: number,
  spread: number = IMPOSTOR_FIELD_SPREAD,
): ImpostorFields {
  const n = width * height;
  const inside = new Uint8Array(n);
  const outside = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const tree = (albedo[i * 4 + 3] as number) >= IMPOSTOR_FIELD_INSIDE ? 1 : 0;
    inside[i] = tree;
    outside[i] = tree ^ 1;
    if (tree) any = true;
  }
  const outAlbedo = new Uint8Array(n * 4);
  const outNormal = normal === null ? null : new Uint8Array(n * 4);
  if (!any) {
    for (let i = 0; i < n; i++) {
      outAlbedo[i * 4] = albedo[i * 4] as number;
      outAlbedo[i * 4 + 1] = albedo[i * 4 + 1] as number;
      outAlbedo[i * 4 + 2] = albedo[i * 4 + 2] as number;
      if (outNormal !== null) {
        outNormal[i * 4] = FLAT_NORMAL[0];
        outNormal[i * 4 + 1] = FLAT_NORMAL[1];
        outNormal[i * 4 + 2] = FLAT_NORMAL[2];
      }
    }
    return { albedo: outAlbedo, normal: outNormal };
  }
  const toInside = nearestSeeds(inside, width, height);
  const toOutside = nearestSeeds(outside, width, height);
  for (let i = 0; i < n; i++) {
    const tree = inside[i] === 1;
    // The nearest texel of the other kind lies at least one texel away; the
    // rim is halfway to it.
    const signed = tree
      ? Math.min(toOutside.dist[i] as number, Infinity) - 0.5
      : 0.5 - (toInside.dist[i] as number);
    const alpha = Math.max(0, Math.min(1, 0.5 + signed / (2 * spread)));
    const from = tree ? i : (toInside.index[i] as number);
    outAlbedo[i * 4] = albedo[from * 4] as number;
    outAlbedo[i * 4 + 1] = albedo[from * 4 + 1] as number;
    outAlbedo[i * 4 + 2] = albedo[from * 4 + 2] as number;
    outAlbedo[i * 4 + 3] = Math.round(alpha * 255);
    if (outNormal !== null && normal !== null) {
      outNormal[i * 4] = normal[from * 4] as number;
      outNormal[i * 4 + 1] = normal[from * 4 + 1] as number;
      outNormal[i * 4 + 2] = normal[from * 4 + 2] as number;
      outNormal[i * 4 + 3] = 255;
    }
  }
  return { albedo: outAlbedo, normal: outNormal };
}
