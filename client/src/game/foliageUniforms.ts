/**
 * What a foliage material is drawn with (`lite/forestPlugins.ts` says what the
 * foliage's vertex and fragment stages do, and draws it): the constants its
 * shaders mirror, the profiles, which cover is matched to the ground, the
 * frame's wind and the players that bend it, and the uniforms as one record
 * by name. Loads no engine.
 */
import { FADE_NONE_IN, FADE_NONE_OUT } from "@csarkosh/engine/game/distanceFade";
import type { BladeEdges } from "./bladeField.js";
import type { WindRecord } from "@csarkosh/engine/game/windParams";

/** The foliage's WGSL is written with these (`lite/forestPlugins.ts`). */
export const FOLIAGE_TILT = 0.04;
export const FOLIAGE_BEND = 0.25;
export const FOLIAGE_BEND_R = 0.6;
export const FOLIAGE_SINK = 0.5;
export const FOLIAGE_CLUMP_LUMA = 0.16;
export const FOLIAGE_CLUMP_CELL = 1.5;
/** The share of the sky's light the canopy takes from a card under full
 * density (`lite/forestPlugins.ts`). The trees' bark takes 0.65 and their
 * crowns 0.4 (`forestLookParams.ts`); the ground under a canopy sees the sky
 * through the trunks' gaps, less than a crown does, so a little under the
 * crown's cut. */
export const FOLIAGE_CANOPY_SKY = 0.4;
/** The share of the sun's light the canopy takes, under full density, from a
 * card that receives no cast shadow: it stands in for the shadow the trees
 * would cast on it. A card is taller than the floor and catches the gaps,
 * so it keeps 0.6. Bound as the `foliageCanopySun` uniform, 0 for a material
 * whose meshes receive cast shadows (`sunShadowed` of `foliageLook`). */
export const FOLIAGE_CANOPY_SUN = 0.4;
export const FOLIAGE_PLAYERS = 5;
/** XZ magnitude a parked (absent) player slot sits at. The bend reads only
 * `windPlayers[i].xz` (`lite/forestPlugins.ts`), so a slot parked below the
 * world at this origin's XZ would still be a live bender there — parking has
 * to move the slot's XZ, not its Y. */
export const FOLIAGE_PLAYER_PARKED = 1e6;

export type FoliageProfile = {
  /** Unitless multiplier on the record's fractions (grass 0.06 m of tip = 1). */
  amp: number;
  /** Ground-tint weight at the root; > 0 turns on FOLIAGE_TINT and the attribute. */
  groundTint: number;
  /** Albedo factor at the root. */
  rootAO: number;
  /** Weight of the card's own normal at the root (0 = the ground's up). */
  normalRoot: number;
  tilt: boolean;
  bend: boolean;
  /** The blade clump mesh: the `blade` attribute is declared, each blade
   * shrinks to its root across `edges` in place of the far sink, and the
   * motion weight ignores the edge term. */
  blades: boolean;
  /** World-space up added to `vNormalW` at the hook where it runs (already
   * transformed to world space, not the vertex normal before transform),
   * then the sum renormalised — 1.0 puts a horizontal normal at 45°. Blades
   * only: the blade mesh's own normals lie flat (y = 0), so the bias is what
   * lets a blade take the sun the way the turf under it does; the card
   * models already carry normals of their own, so every card profile keeps
   * this at 0. */
  normalUp: number;
};

export const FOLIAGE_PROFILES = {
  GRASS: { amp: 1.0, groundTint: 0.6, rootAO: 0.6, normalRoot: 0, tilt: true, bend: true, blades: false, normalUp: 0 },
  MEADOW: { amp: 1.0, groundTint: 0.7, rootAO: 0.65, normalRoot: 0, tilt: true, bend: true, blades: false, normalUp: 0 },
  FLOWER: { amp: 0.83, groundTint: 0.4, rootAO: 0.65, normalRoot: 0, tilt: true, bend: true, blades: false, normalUp: 0 },
  BUSH: { amp: 0.5, groundTint: 0.3, rootAO: 0.75, normalRoot: 0, tilt: false, bend: true, blades: false, normalUp: 0 },
  UNDERSTORY: { amp: 0.67, groundTint: 0.4, rootAO: 0.7, normalRoot: 0, tilt: false, bend: true, blades: false, normalUp: 0 },
  TREE: { amp: 0.33, groundTint: 0, rootAO: 1, normalRoot: 0.6, tilt: false, bend: false, blades: false, normalUp: 0 },
  BLADES: { amp: 1.0, groundTint: 0.7, rootAO: 0.65, normalRoot: 0, tilt: true, bend: true, blades: true, normalUp: 1.0 },
  /** Reeds and cattails: the blade builder's strips, whose normals lie flat,
   * so the blades' up-bias; no ground tint (their colours are their own), no
   * per-blade cut and no tilt, so the shader variant is the trees'. */
  REEDS: { amp: 0.5, groundTint: 0, rootAO: 0.75, normalRoot: 0, tilt: false, bend: true, blades: false, normalUp: 1.0 },
  /** Dead leaves, twigs and small branches: no wind (amp 0 — litter does not
   * sway), no tilt or bend, but still the per-piece `blades` cut so a thin
   * cell's clump can lose pieces the way a thin sward loses blades. Ground
   * tint at half, not 0.7: on the mid-brown floor (NEEDLE_BED) half seats the
   * pieces into it, where 0.7 pulled them fully into the ground colour. */
  DUFF: { amp: 0, groundTint: 0.5, rootAO: 0.75, normalRoot: 0, tilt: false, bend: false, blades: true, normalUp: 0.5 },
  /** The fern on a nurse log: a card a metre off the ground, which takes no
   * ground tint, no root darkening (rootAO 1) and keeps its own normals to
   * the root (normalRoot 1), and is too small to need the wind (amp 0, no
   * tilt, no bend). It wears the plugin for the cards' contrast
   * (`foliageLook`'s `contrast`), which lives in the fragment block. */
  NURSE: { amp: 0, groundTint: 0, rootAO: 1, normalRoot: 1, tilt: false, bend: false, blades: false, normalUp: 0 },
} as const satisfies Record<string, FoliageProfile>;

/**
 * The cover that is matched to the ground (2026-10-27): the grass, the
 * meadow and the blades, and the ferns of the understory. A matched card
 * is drawn most of the way to the ground's own colour at its root
 * (`vFoliage`, the ground tint) over its whole height, is matte, and receives
 * the trees' cast shadows as the ground does (its canopy cut is the shadow's,
 * so `foliageCanopySun` binds 0, and the shadow floor is not held); it keeps
 * its own texture and normal. The cover read lighter than the terrain it
 * stood on: a card's texture is its own green, lit under a flat cut of the
 * sun where the ground beside it stood in the canopy's real shadow. The
 * owner chose the shadowed, matte cover over the flat cut (2026-10-26,
 * "option B"); that preview replaced the card's colour and normal outright,
 * which made the near cover one flat carpet, so the colour is mixed and the
 * normal kept.
 */
const MATCHED_PROFILES: ReadonlySet<FoliageProfile> = new Set<FoliageProfile>([FOLIAGE_PROFILES.GRASS, FOLIAGE_PROFILES.MEADOW, FOLIAGE_PROFILES.BLADES]);
/** The understory's ferns, matched by their material's name: their profile (`UNDERSTORY`) is the bushes' too. The nurse log's fern wears the same name under its own profile and is not matched: it receives no cast shadow. */
const MATCHED_MATERIAL = /^understory\.fern/;
/** Whether `material` under `profile` is matched to the ground (`MATCHED_PROFILES`, and the ferns of the understory). */
export function foliageMatched(material: { readonly name: string }, profile: FoliageProfile | undefined): boolean {
  if (profile === undefined) return false;
  return MATCHED_PROFILES.has(profile) || (profile === FOLIAGE_PROFILES.UNDERSTORY && MATCHED_MATERIAL.test(material.name));
}

// Module-level: every material's plugin reads one truth,
// written once per frame by the renderer.
let wind: WindRecord = { dirX: 1, dirZ: 0, speed: 0, lean: 0, gustAmp: 0, flutterAmp: 0, time: 0 };
/** 5 × xyz; unused slots parked a thousand kilometres away in XZ, where no
 * origin is within the bend radius. */
const players = new Float32Array(FOLIAGE_PLAYERS * 3);
for (let i = 0; i < FOLIAGE_PLAYERS; i++) {
  players[i * 3] = FOLIAGE_PLAYER_PARKED;
  players[i * 3 + 2] = FOLIAGE_PLAYER_PARKED;
}

/** `positions` is 5 × xyz and replaces the whole array wholesale — it does
 * not merge with the existing parked defaults. A caller with fewer than 5
 * active players must park each absent slot itself, at
 * `(FOLIAGE_PLAYER_PARKED, 0, FOLIAGE_PLAYER_PARKED)`, the same convention
 * this module's own initial state uses. */
export function setFoliageWind(record: WindRecord, positions: Float32Array): void {
  wind = record;
  players.set(positions.subarray(0, FOLIAGE_PLAYERS * 3));
}

/** How `attachFoliage` decides the material's cut of the sun by the canopy,
 * and how much of its texture's contrast it keeps. */
export type FoliageOptions = {
  /** The material's meshes receive cast shadows (`receiveShadows`), so the
   * canopy's cut of the sun is theirs already and the uniform binds 0. Off,
   * the uniform binds `FOLIAGE_CANOPY_SUN`. */
  sunShadowed?: boolean;
  /** The share of the texture's own colour kept, the rest the ground cover's
   * green (`FOLIAGE_CARD_GREEN` in `lite/forestPlugins.ts`): 1, the default, is
   * the texture as it is. The card models pass `FOLIAGE_CARD_CONTRAST`
   * (`coverAlbedoParams.ts`), whose tint puts each texture's mean at the
   * green, so the mix compresses the texture's contrast around its mean and
   * lifts the shade baked into its dark texels, which a gain cannot. Bound
   * as the `foliageContrast` uniform. */
  contrast?: number;
};

/** A foliage material's own numbers: its profile, its model's height, its
 * cut of the sun by the canopy, the share of its texture's contrast it
 * keeps, and the bands its bucket's shell sets. */
export type FoliageLook = {
  readonly profile: FoliageProfile;
  /** The model's bounding height (m at scale 1): the height fraction's measure. */
  readonly meshHeight: number;
  /** `FOLIAGE_CANOPY_SUN`, or 0 for a material whose meshes receive cast shadows or that is matched to the ground. */
  readonly canopySun: number;
  /** The share of the texture kept over the cover's green, 1 for a texture left as it is. */
  readonly contrast: number;
  /** Outer fade of the bucket; motion reaches zero at its end. */
  edges: readonly [number, number];
  /** The blades profile's hand-off: (grow-in start, grow-in end, collapse start, collapse end), metres from the eye. */
  bladeEdges: BladeEdges;
};

/**
 * The look of a material named `name` under `profile`, its model
 * `meshHeight` tall: the canopy's cut of the sun is `FOLIAGE_CANOPY_SUN`
 * unless the material's meshes receive cast shadows (`sunShadowed`) or it is
 * matched to the ground, whose cut is the shadow's; the contrast is 1 unless
 * given. Its edges fade nowhere until the shell sets them.
 */
export function foliageLook(name: string, profile: FoliageProfile, meshHeight: number, options: FoliageOptions = {}): FoliageLook {
  const matched = foliageMatched({ name }, profile);
  return {
    profile,
    meshHeight,
    canopySun: matched || options.sunShadowed === true ? 0 : FOLIAGE_CANOPY_SUN,
    contrast: options.contrast ?? 1,
    edges: FADE_NONE_OUT,
    bladeEdges: [FADE_NONE_IN[0], FADE_NONE_IN[1], FADE_NONE_OUT[0], FADE_NONE_OUT[1]],
  };
}

/** The foliage's uniforms by name, each its components in order; the
 * players are five positions, xyz each. */
export type FoliageUniforms = {
  windDir: [number, number];
  windLean: [number];
  windGust: [number];
  windFlutter: [number];
  windTime: [number];
  windEye: [number, number, number];
  windPlayers: Float32Array;
  foliageAmp: [number];
  foliageHeight: [number];
  foliageTint: [number];
  foliageRootAO: [number];
  foliageCanopySun: [number];
  foliageContrast: [number];
  foliageNormalRoot: [number];
  foliageNormalUp: [number];
  foliageFlags: [number, number];
  foliageEdges: [number, number];
  foliageBladeEdges: [number, number, number, number];
};

/** A record of the right shape, every component zero; the players are the page's one array. */
export function emptyFoliageUniforms(): FoliageUniforms {
  return {
    windDir: [0, 0], windLean: [0], windGust: [0], windFlutter: [0], windTime: [0], windEye: [0, 0, 0],
    windPlayers: players,
    foliageAmp: [0], foliageHeight: [0], foliageTint: [0], foliageRootAO: [0], foliageCanopySun: [0], foliageContrast: [0],
    foliageNormalRoot: [0], foliageNormalUp: [0], foliageFlags: [0, 0], foliageEdges: [0, 0], foliageBladeEdges: [0, 0, 0, 0],
  };
}

/**
 * The uniforms `look`'s material is drawn with this frame, into `out`: the
 * page's wind and players (`setFoliageWind`), the eye (the origin where
 * there is none), and the look's own numbers.
 */
export function foliageUniforms(look: FoliageLook, eye: { x: number; y: number; z: number } | null | undefined, out: FoliageUniforms): FoliageUniforms {
  const p = look.profile;
  out.windDir[0] = wind.dirX;
  out.windDir[1] = wind.dirZ;
  out.windLean[0] = wind.lean;
  out.windGust[0] = wind.gustAmp;
  out.windFlutter[0] = wind.flutterAmp;
  out.windTime[0] = wind.time;
  out.windEye[0] = eye?.x ?? 0;
  out.windEye[1] = eye?.y ?? 0;
  out.windEye[2] = eye?.z ?? 0;
  out.windPlayers = players;
  out.foliageAmp[0] = p.amp;
  out.foliageHeight[0] = look.meshHeight;
  out.foliageTint[0] = p.groundTint;
  out.foliageRootAO[0] = p.rootAO;
  out.foliageCanopySun[0] = look.canopySun;
  out.foliageContrast[0] = look.contrast;
  out.foliageNormalRoot[0] = p.normalRoot;
  out.foliageNormalUp[0] = p.normalUp;
  out.foliageFlags[0] = p.tilt ? 1 : 0;
  out.foliageFlags[1] = p.bend ? 1 : 0;
  out.foliageEdges[0] = look.edges[0];
  out.foliageEdges[1] = look.edges[1];
  out.foliageBladeEdges[0] = look.bladeEdges[0];
  out.foliageBladeEdges[1] = look.bladeEdges[1];
  out.foliageBladeEdges[2] = look.bladeEdges[2];
  out.foliageBladeEdges[3] = look.bladeEdges[3];
  return out;
}
