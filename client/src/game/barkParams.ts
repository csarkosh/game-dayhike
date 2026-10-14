/**
 * Which bark each tree wears and how it tiles. Babylon-free and on the
 * architecture test's BABYLON_FREE_FILES list; `forestMeshes.ts` dresses
 * every tree's bark material from these as the models land.
 *
 * Four bark sets ship as KTX2 (`client/assets/textures/bark.<set>.<size>…`,
 * `docs/rendering/2026-10-14-tree-bark-textures.md`): a colour map, a normal
 * map and an ARM map (occlusion, roughness, metalness in red, green and
 * blue), each at 2k and at 1k. A set is a scan of a plate of bark with a
 * footprint in metres (`BARK_FOOTPRINT`), so a tree's repeat is derived
 * from the footprint and the tree's own measured size, not tuned by eye
 * first: so many plates up the trunk as the trunk is tall, so many round it
 * as it is wide. Every number here is a starting value in the model's own
 * metres (an instance is drawn at its sim scale, which multiplies the plate
 * with it); each is one literal to change.
 *
 * The trees' bark primitives were measured on the shipped files. Two
 * families unwrap their trunks differently: the fir and the alder run `v`
 * up the trunk and `u` round it; the pine and both saplings run `u` up the
 * trunk and `v` round it, and on those the set is turned a quarter
 * (`barkTransform`) so the plates stand up the trunk as they do in the scan.
 */

/** The four sets, by the tree each was chosen for: a mature fir's plated
 * bark (the scan is of a pine), a cedar's and a metasequoia's fibrous bark
 * for the giant pine, and a smooth lenticelled bark for the alder. */
export type BarkSet = "pine" | "metasequoia" | "cedar" | "alder";

/** The two sizes a set ships at: 2048² and 1024². */
export type BarkSize = "2k" | "1k";

/** What every bark set's colour map is multiplied by, linear: the scans are
 * warmer and brighter than the trunks read under the canopy, so the whole is
 * taken to about two thirds (Y 0.681) with the red and the green held under
 * the blue, which takes the scans' warmth down. One tone for the four sets,
 * so they sit together. */
export const BARK_TONE: { readonly r: number; readonly g: number; readonly b: number } = { r: 0.68, g: 0.68, b: 0.7 };

/** A set's scan footprint (m): `width` round the trunk, `height` up it. The
 * cedar's and the alder's plates are 1 : 2 (twice as tall as wide) squashed
 * into a square file, which is why their heights are twice their widths
 * here: the repeat up the trunk covers twice the length the repeat round it
 * does. The alder's is an estimate; its scan has no published footprint. */
export const BARK_FOOTPRINT: Readonly<Record<BarkSet, { readonly width: number; readonly height: number }>> = {
  pine: { width: 2.0, height: 2.0 },
  metasequoia: { width: 1.94, height: 1.94 },
  cedar: { width: 1.0, height: 2.0 },
  alder: { width: 0.5, height: 1.0 },
};

/** How one tree model wears one set. */
export type BarkDressing = {
  set: BarkSet;
  /** The axis of the bark primitive's UVs that runs up the trunk. */
  along: "u" | "v";
  /** Repeats of the set's height per unit of the along axis: the trunk's
   * length over the footprint's height, over the UV range the trunk spans. */
  alongRepeat: number;
  /** Repeats of the set's width per unit of the round axis: the trunk's
   * girth over the footprint's width, over the UV range one turn spans. */
  roundRepeat: number;
  /** Wears the 2k size on the high tier; the 1k size otherwise. */
  fine: boolean;
};

/** `tree.giant_fir`: the bark primitive stands 12.6 m (−0.33 to 12.25 m)
 * and `v` runs up it over about 1.0; the trunk is 3.4 m round at the base
 * (1.19 × 0.96 m) and one turn spans `u` 0 to 1.0 (the primitive's `u`
 * reaches 1.29 on its branches). Pine set, 2.0 × 2.0 m:
 * along 12.6 / 2.0 / 1.0 = 6.3, round 3.4 / 2.0 / 1.0 = 1.7. */
export const GIANT_FIR_BARK: BarkDressing = { set: "pine", along: "v", alongRepeat: 6.3, roundRepeat: 1.7, fine: true };

/** `tree.giant_pine`, first of its two barks: the bark primitive stands
 * 15.4 m (−0.33 to 15.09 m) and `u` runs up it over 5.0 (its rings' `u`
 * climbs 0.7, 1.4, 2.0 … 4.6 with the height); the trunk is 3.75 m round
 * at the base (1.21 × 1.18 m) and `v` spans 2.0 round it. Metasequoia set,
 * 1.94 × 1.94 m: along 15.4 / 1.94 / 5.0 = 1.6, round 3.75 / 1.94 / 2.0 = 1.0. */
export const GIANT_PINE_METASEQUOIA_BARK: BarkDressing = { set: "metasequoia", along: "u", alongRepeat: 1.6, roundRepeat: 1.0, fine: true };

/** `tree.giant_pine`, second bark, the same primitive: cedar set, 1.0 m
 * wide and 2.0 m tall (the 1 : 2 plate): along 15.4 / 2.0 / 5.0 = 1.5,
 * round 3.75 / 1.0 / 2.0 = 1.9. */
export const GIANT_PINE_CEDAR_BARK: BarkDressing = { set: "cedar", along: "u", alongRepeat: 1.5, roundRepeat: 1.9, fine: true };

/** `tree.alder`: the trunk stands 4.0 m and `v` runs up it at about 0.45 a
 * metre, 1.8 over the trunk; it is 0.5 m round (0.16 m through) and one
 * turn spans `u` 0 to 0.27. Alder set, 0.5 m wide and 1.0 m tall (the 1 : 2
 * plate): along 4.0 / 1.0 / 1.8 = 2.2, round 0.5 / 0.5 / 0.27 = 3.7. */
export const ALDER_BARK: BarkDressing = { set: "alder", along: "v", alongRepeat: 2.2, roundRepeat: 3.7, fine: true };

/** `tree.conifer_a`, the fir sapling: the bark primitive stands 8.1 m and
 * `u` runs up it over 3.5; the trunk is 0.9 m round (0.26 × 0.32 m) and `v`
 * spans 2.0 (−1 to 1) round it. Its giant's pine set:
 * along 8.1 / 2.0 / 3.5 = 1.2, round 0.9 / 2.0 / 2.0 = 0.23. */
export const CONIFER_A_BARK: BarkDressing = { set: "pine", along: "u", alongRepeat: 1.2, roundRepeat: 0.23, fine: false };

/** `tree.conifer_b`, the pine sapling: the bark primitive stands 9.5 m and
 * `u` runs up it over 3.0; the trunk is 1.0 m round (0.35 × 0.29 m) and `v`
 * spans 3.5 (−2.5 to 1) round it. Metasequoia set:
 * along 9.5 / 1.94 / 3.0 = 1.6, round 1.0 / 1.94 / 3.5 = 0.15. */
export const CONIFER_B_BARK: BarkDressing = { set: "metasequoia", along: "u", alongRepeat: 1.6, roundRepeat: 0.15, fine: false };

/** The giants' bucket sets, one a bark: `species` is `TreeInstance.species`
 * (0 the fir, 1 the pine), and `variant` the `TreeInstance.variant` the set
 * draws, or null for every variant, where the species has one bark. The
 * pine's two barks are mixed tree by tree. In species order, so the sets of
 * the species that have loaded are a prefix of this list. */
export const GIANT_SETS: readonly { readonly species: number; readonly variant: number | null; readonly bark: BarkDressing }[] = [
  { species: 0, variant: null, bark: GIANT_FIR_BARK },
  { species: 1, variant: 0, bark: GIANT_PINE_METASEQUOIA_BARK },
  { species: 1, variant: 1, bark: GIANT_PINE_CEDAR_BARK },
];

/** The saplings' barks by `TreeInstance.species`: the two conifers, then the alder (`SPECIES_ALDER`). */
export const SAPLING_BARKS: readonly BarkDressing[] = [CONIFER_A_BARK, CONIFER_B_BARK, ALDER_BARK];

/** Whether a giant of `species` and `variant` belongs to the bucket set `set`. */
export function inGiantSet(set: { species: number; variant: number | null }, species: number, variant: number): boolean {
  return set.species === species && (set.variant === null || set.variant === variant);
}

/** The size a dressing wears on a tier: 2k for the fine ones on the high
 * tier (the giants and the alder, which stand near), 1k otherwise (a sapling
 * is never close enough for more, and the lower tiers keep texture memory). */
export function barkSize(tier: "low" | "medium" | "high", dressing: BarkDressing): BarkSize {
  return tier === "high" && dressing.fine ? "2k" : "1k";
}

/** The catalog `output` of each of a set's three maps at a size. */
export function barkOutputs(set: BarkSet, size: BarkSize): { colour: string; normal: string; arm: string } {
  const base = `textures/bark.${set}.${size}`;
  return { colour: `${base}.ktx2`, normal: `${base}.normal.ktx2`, arm: `${base}.arm.ktx2` };
}

/** A quarter turn: the set's height laid along the bark primitive's `u`. */
export const QUARTER_TURN = Math.PI / 2;

/** The texture transform a dressing sets on each of its three maps: the
 * scales in the primitive's own UV axes, and the turn that lays the set's
 * height up the trunk where the trunk runs along `u`. A scale applies to
 * the primitive's axis before the turn, so `uScale` is always the repeat
 * along `u`, whichever way `u` runs. */
export function barkTransform(dressing: BarkDressing): { uScale: number; vScale: number; wAng: number } {
  return dressing.along === "v"
    ? { uScale: dressing.roundRepeat, vScale: dressing.alongRepeat, wAng: 0 }
    : { uScale: dressing.alongRepeat, vScale: dressing.roundRepeat, wAng: QUARTER_TURN };
}
