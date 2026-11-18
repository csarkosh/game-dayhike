/**
 * The midges' look and their one draw's inputs, with no engine: the glints'
 * and the speck's numbers the stages hold as literals, a frame of the
 * midges as the lake's life fills it (`waterLifeScene.ts`), the instances
 * laid out once by row and slot, and a frame's uniforms by the names the
 * stages read them under. `lite/midgeMeshes.ts` draws them.
 */
import { MIDGE_SWARMS_MAX, SWARM_ROW_FLOATS } from "./midgeMotion.js";

/** The forward scatter's lobe: the cosine between the view and the sun raised to this. */
export const MIDGE_LOBE_POWER = 8;
/** The wing's flash: the positive half of its sinusoid raised to this, a narrow pulse. */
export const MIDGE_FLASH_POWER = 24;
/** The flash's weight beside the lobe's. */
export const MIDGE_FLASH_GAIN = 0.5;
/** The sky's glint at its fullest, looking level toward the sun's azimuth:
 * its share of the horizon's colour toward the sun. */
export const MIDGE_SKY_GLINT = 0.6;
/** The sky glint's lobe: the cosine between the view and the sun's azimuth,
 * level, raised to this, a broad lobe as the glow along the horizon is. */
export const MIDGE_SKY_LOBE_POWER = 2;
/** The least coverage a midge enlarged to its fewest pixels keeps near the
 * eye, so a close swarm's midge reads as a dot, not a ghost. */
export const MIDGE_ALPHA_FLOOR = 0.6;
/** The floor holds whole to this many metres from the eye… */
export const MIDGE_FLOOR_NEAR = 6;
/** …and falls linearly to nothing here and beyond, so a far midge keeps only
 * its card's own coverage of its pixels (0.07 at 20 m with a pixel 1.1 mm
 * across at 1 m): a faint speck, and a swarm across the water no solid blob. */
export const MIDGE_FLOOR_FAR = 15;
/** How much of the background a speck hides against the brightest sky. */
export const MIDGE_DARK = 0.9;
/** Khronos PBR Neutral's published constants, as Babylon's image processing
 * and the sky dome's stage have them: where compression starts, and how far
 * a compressed colour desaturates. */
export const MIDGE_NEUTRAL_START = 0.76;
export const MIDGE_NEUTRAL_DESATURATION = 0.15;

/** One frame of the midges: the eye, the shared clock, the sun, the sky and the table. */
export type MidgeFrame = {
  eyeX: number; eyeY: number; eyeZ: number;
  /** Shared seconds. */
  time: number;
  /** A unit vector toward the sun. */
  sunX: number; sunY: number; sunZ: number;
  /** The sun's colour times its intensity. */
  sunR: number; sunG: number; sunB: number;
  /** The dome's horizon toward the sun as it draws it level, in the scene's
   * units (`SkyState.horizonToward` blended toward `mistAir` by
   * `mistWeight`): the light of the sky's glint. */
  glowR: number; glowG: number; glowB: number;
  night: number; skyLuma: number;
  /** The world size of one pixel at 1 m from the eye. */
  pixelAt1m: number;
  /** SWARM_ROW_FLOATS · MIDGE_SWARMS_MAX, packed by `packSwarm`. */
  table: Float32Array;
};

/**
 * The midges' instances, laid out once: row r gets `blocks[r]` instances,
 * slots 0 to `blocks[r] - 1`, a (row, slot) pair an instance in `slots`. A
 * slot at or above its row's count for the frame collapses in the vertex
 * stage, so the counts change in the table and never here.
 */
export function midgeSlots(blocks: readonly number[]): { slots: Float32Array; total: number } {
  if (blocks.length > MIDGE_SWARMS_MAX) throw new Error(`the midges: ${blocks.length} rows, the table holds ${MIDGE_SWARMS_MAX}`);
  let total = 0;
  for (const block of blocks) total += block;
  const slots = new Float32Array(total * 2);
  let at = 0;
  blocks.forEach((block, row) => {
    for (let slot = 0; slot < block; slot++) {
      slots[at++] = row;
      slots[at++] = slot;
    }
  });
  return { slots, total };
}

/**
 * The sphere a row of the table `table` keeps its midges in, into `out` (x,
 * y, z, radius); false for a row that draws none (no midge, or no presence).
 * A midge strays its swarm's radius along each of the ground's axes and the
 * taller of the radius and the column's height up or down (`midge.vertex.fx`).
 */
export function swarmSphere(table: Float32Array, row: number, out: [number, number, number, number]): boolean {
  const o = row * SWARM_ROW_FLOATS;
  if (!((table[o + 5] as number) > 0) || !((table[o + 6] as number) > 0)) return false;
  const radius = table[o + 3] as number;
  const up = Math.max(radius, table[o + 4] as number);
  out[0] = table[o] as number;
  out[1] = table[o + 1] as number;
  out[2] = table[o + 2] as number;
  out[3] = Math.hypot(radius, radius, up);
  return true;
}

/** The floats of the swarms' table: SWARM_ROW_FLOATS a row, MIDGE_SWARMS_MAX rows. */
export const MIDGE_TABLE_FLOATS = SWARM_ROW_FLOATS * MIDGE_SWARMS_MAX;

/**
 * A frame of the midges as one run of floats, for a renderer that hands the
 * stages everything in one buffer: five vec4s (the eye and the clock; the
 * way to the sun and the night; the sun's light and the sky's luminance;
 * the sky's glow and a pixel's size at a metre; the exposure, whether the
 * stage tones its light, the contrast, and a float unused), then the table.
 */
export const MIDGE_HEAD_FLOATS = 20;
export const MIDGE_FRAME_FLOATS = MIDGE_HEAD_FLOATS + MIDGE_TABLE_FLOATS;

/** Packs the frame `f` into `out` (`MIDGE_FRAME_FLOATS` long), toned by `exposure` and `contrast` where `toned`. */
export function packMidgeFrame(f: MidgeFrame, exposure: number, toned: boolean, contrast: number, out: Float32Array): Float32Array {
  out[0] = f.eyeX;
  out[1] = f.eyeY;
  out[2] = f.eyeZ;
  out[3] = f.time;
  out[4] = f.sunX;
  out[5] = f.sunY;
  out[6] = f.sunZ;
  out[7] = f.night;
  out[8] = f.sunR;
  out[9] = f.sunG;
  out[10] = f.sunB;
  out[11] = f.skyLuma;
  out[12] = f.glowR;
  out[13] = f.glowG;
  out[14] = f.glowB;
  out[15] = f.pixelAt1m;
  out[16] = exposure;
  out[17] = toned ? 1 : 0;
  out[18] = contrast;
  out[19] = 0;
  out.set(f.table, MIDGE_HEAD_FLOATS);
  return out;
}
