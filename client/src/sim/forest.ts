import "./passes/index.js";
import { createChunkGrid, type ChunkGrid } from "./chunkGrid.js";
import { generateChunkWith, registeredPasses, type Pass } from "./chunk.js";
import { activeTerrainVariantName, elevationAt } from "./terrain.js";
import { HEIGHT_QUANTUM } from "./forestConstants.js";

const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5;

/**
 * Escape hatch, not the main defence. Bumped to 5 for the wall at the road
 * (`containment.ts`): the ground is untouched, and a peer without the wall
 * would walk straight through it.
 *
 * `passHash` below derives version skew from the generated world and from the
 * constants that steer it, so an ordinary change to a pass invalidates the levelId
 * without anyone remembering to do anything. This stays for the cases no generation
 * digest can see: a change to how the world is *used* rather than generated — spawn
 * selection, collision resolution, the tick rate — where two peers generate
 * identical geometry and still disagree about what happens on it.
 *
 * Bumped to 4 when sprinting began raising the speed cap, and to 3 when the
 * walk speed was retuned. Geometry is again untouched, and
 * again every peer must agree: two builds that disagree about how fast a player
 * moves disagree about where that player is, one tick later.
 *
 * Bumped to 2 when the ground stopped being collision boxes and became the
 * analytic height field (`ground.ts`). The generated world is bit-identical
 * either way — the elevation pass is untouched — so no digest here can see the
 * change, and yet a peer on the old build resolves every step against a
 * different surface. This is exactly the case the escape hatch exists for.
 */
export const GEN_VERSION = 5;

export type Forest = {
  seed: number;
  grid: ChunkGrid;
  fieldHash: number;
  passHash: number;
  /** Fits the Welcome event's uint8-length-prefixed levelId slot. */
  levelId: string;
};

/**
 * Hash of a fixed 16x16 lattice of field samples at fixed world coordinates.
 *
 * Samples the *fields* rather than generated chunks, so it can be computed before
 * any chunk exists and does not depend on where anybody walked. Quantized before
 * hashing so it compares the terrain players will actually stand on rather than
 * the last bit of a float.
 */
function fieldHashOf(seed: number): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      const x = (i - 8) * 32;
      const z = (j - 8) * 32;
      const e = Math.round(elevationAt(seed, x, z) / HEIGHT_QUANTUM) | 0;
      h = Math.imul(h ^ e, FNV_PRIME);
    }
  }
  return h | 0;
}

/**
 * The probe the pass digest is taken over.
 *
 * A fixed seed, not the player's, so the digest is a property of the build
 * rather than of where anybody happened to start.
 *
 * Coverage is no longer a question of geography. The old forest generator's
 * feature passes only fired at rare sites — ramps only at plateau edges — so the
 * probe had to be searched for, and these coordinates are what that search
 * returned. With a single field-sampling pass left, every cell of any probe
 * region exercises it, so any block would do; these stay because changing them
 * would churn every level id for nothing. `forest.test.ts` proves the coverage
 * claim structurally rather than trusting it, by removing each pass in turn and
 * requiring the digest to move. When feature passes return at id 6 and above,
 * that test is what will tell you whether this window still reaches them.
 */
const PROBE_SEED = 0x0badf00d;
const PROBE_CHUNKS: readonly (readonly [number, number])[] = [
  [1, 2],
  [2, 2],
  [1, 3],
  [2, 3],
  // Extended 2026-08-26 for pass 7 (clutter): boulders are rare sites, and
  // the original window is coastal lowland below their altitude gate.
  // Measured under PROBE_SEED on olympic: chunk [0, -96] holds 1
  // boulder brushes (scan of cx,cz ∈ [-96, 96)).
  [0, -96],
  // Extended 2026-09-09 for pass 8 (trailhead): the chunks holding the
  // trailhead props for seed 0x0badf00d — derived from
  // terrainVariant("olympic").trailGraph(0x0badf00d).trailhead (x=−248.63, z=0)
  // plus the prop offsets in passes/trailhead.ts ({−3,0}, {+4,+3}, {+5,−3}).
  // If TRAILHEAD_U or the road moves, the coverage test below says so; extend
  // again rather than skipping the pass.
  //
  // Re-derived 2026-09-09: the apron
  // pulls coastFrame's blendEnd out to APRON_BLEND_END inside the trail's
  // z-window, which moves roadOffsetD's dr and hence the road/trailhead's
  // world x for every seed, PROBE_SEED included — trailhead moved from
  // (x=−248.63, z=0) to (x=−209.23, z=0). Chunks re-derived the same way:
  // [-8, 0]/[-8, -1] -> [-7, 0]/[-7, -1].
  //
  // Re-derived AGAIN 2026-09-09 and back where they
  // started: the apron was never supposed to move the highway, and it no
  // longer does (`coastFrame` hands the road its own un-aproned window), so
  // the trailhead is at (x=−248.63, z=0) again — bit for bit — and its props
  // are back in [-8, 0]/[-8, -1]. `forest.test.ts`'s coverage case is what
  // caught it: with the chunks left at [-7, ·] the trailhead pass emitted
  // nothing into the probe and could have been changed without moving a single
  // level id.
  //
  // Re-derived 2026-09-11: TRAILHEAD_U 44 → 9 moves the
  // trailhead 35 m toward the road for every seed, PROBE_SEED included —
  // (x=−283.63, z=0), chunk [-9, 0], not [-8, ·]. The car also left the
  // departure frame for the ROAD frame (CAR_ROAD_U/CAR_ROAD_Z), so it no
  // longer shares the post/sign's offsets at all. Measured for PROBE_SEED:
  // post (x=−288.57, z=0.81) in [-10, 0]; sign (x=−284.93, z=5.69) and the
  // car (x=−285.73, z=12) both in [-9, 0]. `forest.test.ts`'s coverage case
  // is what would have caught a stale window here: with the old [-8, ·]
  // chunks left in place, pass 8 emits nothing into the probe at all.
  //
  // Re-derived 2026-09-11: the post and the
  // sign left the DEPARTURE frame for the ROAD frame too, so all three props
  // now stand at a fixed u beside the pad and their chunks are a property of
  // the road rather than of the graph's departure bearing. Measured for
  // PROBE_SEED: post (x=−282.64, z=−7) in [-9, -1]; sign (x=−281.63, z=7) and
  // the car (x=−285.72, z=12) both in [-9, 0]. The WINDOW IS UNCHANGED: two of
  // the three props still land in it, so `forest.test.ts`'s coverage case
  // still moves when pass 8 is removed, and every prop constant is a pass
  // tunable in `registryDigest` besides. Widening it to [-9, -1] for the post
  // alone would churn every level id for nothing.
  [-10, 0],
  [-9, 0],
  // Extended 2026-09-15 for pass 9 (signs): a junction post for PROBE_SEED.
  // Measured: the graph for 0x0badf00d stands posts at (x=75.98, z=-166) in
  // [2, -6], two more in [8, -9] and one in [13, -10]; one chunk is enough for
  // the coverage case, and the cheapest is taken.
  [2, -6],
];

/**
 * Prop coordinates are rounded to this before hashing, for the same reason the
 * field samples are quantized: the digest must compare geometry, not the last bit
 * of a float. 4 mm is far coarser than any plausible float difference at these
 * magnitudes and far finer than any change worth refusing a connection over.
 */
const PROP_QUANTUM = 1 / 256;

// Reads a double's two 32-bit halves without allocating per value. Byte order is
// stated explicitly rather than taken from the host: this digest is compared
// between peers, so a big-endian one would otherwise disagree about a world it
// generates identically.
const tunableBits = new DataView(new ArrayBuffer(8));

function mixString(h: number, s: string): number {
  let out = h;
  for (let i = 0; i < s.length; i++) out = Math.imul(out ^ s.charCodeAt(i), FNV_PRIME);
  return out;
}

/**
 * Digest of what `passes` actually emit over the probe — column heights and every
 * prop's material and quantized bounds, in generation order.
 *
 * Deliberately mixes in nothing but generated output. Folding in pass ids or names
 * here would make the per-pass coverage check in `forest.test.ts` vacuous: removing
 * a pass would change the digest through its name whether or not it had emitted
 * anything into the probe region. Registry identity is `registryDigest`'s job.
 *
 * Exported for that check, which needs to generate the probe from a subset.
 */
export function probeDigest(passes: readonly Pass[]): number {
  let h = FNV_OFFSET;
  for (const [cx, cz] of PROBE_CHUNKS) {
    const chunk = generateChunkWith(passes, PROBE_SEED, cx, cz);
    for (const column of chunk.columns) h = Math.imul(h ^ column, FNV_PRIME);
    for (const prop of chunk.props) {
      h = mixString(h, prop.material);
      for (const v of [
        prop.box.min.x,
        prop.box.min.y,
        prop.box.min.z,
        prop.box.max.x,
        prop.box.max.y,
        prop.box.max.z,
      ]) {
        h = Math.imul(h ^ (Math.round(v / PROP_QUANTUM) | 0), FNV_PRIME);
      }
    }
    // Length, so a pass that emits a prefix of another's output is still distinct.
    h = Math.imul(h ^ chunk.props.length, FNV_PRIME);
  }
  return h | 0;
}

/**
 * Digest of the registry's declared shape — every pass's id, name and tunables.
 *
 * Covers what `probeDigest` structurally cannot. Two gaps, both real:
 *
 * A pass added, removed or renumbered whose features fall entirely outside the
 * probe region leaves the sampled geometry untouched.
 *
 * More importantly, a threshold on a *rare* feature moves too little geometry to
 * sample. Measured on the retired ramp pass, whose gate rolled once per
 * plateau-edge cell: the probe region held 93 such rolls, so raising RAMP_CHANCE
 * by 0.01 was expected to flip well under one of them, and measurement confirmed
 * it flipped none. Enlarging the probe did not fix it — at 36 chunks there were
 * 335 rolls, one landed in the band, and its ramp was clipped away before it
 * reached the digest. Rarity sets the floor, not probe size. Today's single
 * elevation pass has no rare features, but this is why the mechanism stays: the
 * feature passes returning at id 6 and above will have them again.
 *
 * Hashing the declared values sidesteps sampling entirely: the change is caught
 * because the number differs, not because the world visibly differs.
 *
 * Keys are sorted, so reordering a literal is not treated as a change.
 */
export function registryDigest(passes: readonly Pass[]): number {
  let h = FNV_OFFSET;
  for (const pass of passes) {
    h = Math.imul(h ^ pass.id, FNV_PRIME);
    h = mixString(h, pass.name);
    for (const key of Object.keys(pass.tunables).sort()) {
      h = mixString(h, key);
      // Exact bits, unlike the geometry digest, which rounds. Prop coordinates are
      // computed from noise and could in principle differ in the last bit between
      // engines; a tunable is a literal in the source, parsed to the same double
      // everywhere, so there is no last bit to forgive. Rounding here would only
      // create a blind spot — at 1e-6 resolution a change smaller than that slips
      // through, which is measurable and was.
      tunableBits.setFloat64(0, pass.tunables[key] as number, true);
      h = Math.imul(h ^ tunableBits.getUint32(0, true), FNV_PRIME);
      h = Math.imul(h ^ tunableBits.getUint32(4, true), FNV_PRIME);
    }
  }
  return h | 0;
}

// A property of the bundle, not of any world, so it is computed once. Measured
// against the montane generator (the previous figures here predated it): the
// four probe chunks cost about 13 ms cold, and the first createForest measures
// 13–15 ms all in against about 0.21 ms for every one after it.
//
// Those are cold, once-per-process numbers and are dominated by JIT warm-up,
// not by the field. Warmed, a chunk generates in about 0.76 ms against the
// 1.384 ms the forest generator cost — an earlier estimate predicted 5–10 ms and was
// wrong in the useful direction, because the same step that made the field
// ~5× more expensive per sample also retired the four prop passes.
//
// Keyed on the pass count rather than cached outright. Passes register at import
// time, so in the running game the cache is filled once and never stale — but a
// pass registered after the first call would otherwise be silently absent from the
// hash, which is the exact class of bug this whole file exists to prevent.
// `registerPass` only ever appends, so the count is a sufficient key for that.
//
// The active terrain variant is the second key, and unlike the pass count it
// really does change at runtime: `/terrain` swaps the elevation pipeline long
// after import, which changes both what the probe generates and what the
// elevation pass declares as tunables. A cache keyed on the count alone would
// hand back montane's digest for a plain world and desync peers in silence.
let cachedPassHash: number | null = null;
let cachedPassCount = -1;
let cachedVariant = "";

/** Digest of every registered pass: what they emit, and which ones there are. */
export function passHash(): number {
  const passes = registeredPasses();
  const variant = activeTerrainVariantName();
  if (cachedPassHash === null || cachedPassCount !== passes.length || cachedVariant !== variant) {
    cachedPassHash = Math.imul(probeDigest(passes) ^ registryDigest(passes), FNV_PRIME) | 0;
    cachedPassCount = passes.length;
    cachedVariant = variant;
  }
  return cachedPassHash;
}

export function createForest(seed: number): Forest {
  const fieldHash = fieldHashOf(seed);
  const passes = passHash();
  return {
    seed,
    grid: createChunkGrid(seed),
    fieldHash,
    passHash: passes,
    // Kept as two separate components rather than one combined digest, so a
    // mismatch report says which half differs: the fields, or the passes.
    levelId: `forest/${GEN_VERSION}/${activeTerrainVariantName()}/${seed}/${fieldHash}/${passes}`,
  };
}
