/**
 * The crowd's eyes (docs/gameplay/2026-11-13-the-way-down.md): a pair of
 * small lights for each figure of the crowd. Past the mist's reach they are
 * all there is of a figure, and they carry through the mist and get smaller
 * with distance, which is what makes the crowd read as deep. One mesh and
 * one draw for every pair: a quad an eye, its vertices rewritten each frame
 * (a few hundred numbers), placed in the vertex stage so the pair always
 * faces the camera. This file is the eyes' numbers and how a frame's
 * vertices are written, computed with no engine; `lite/crowdEyeMeshes.ts`
 * makes the mesh and the material from it.
 *
 * The stages' text is `shaders/crowdEyes/`. Each vertex is at its figure's
 * head in the world and carries its corner of the quad (x, y: -1 to 1), the
 * eye's half width in metres, and how far to the side of the figure's
 * middle this eye sits, so the pair is spread across the screen. The
 * fragment is a soft round light, its colour times its level (the vertex
 * colour's alpha), added to what lies behind.
 */
import type { Rgb } from "@csarkosh/engine/game/colour";
import { presenceOf, type CrowdFigure } from "./crowdField.js";
import { HOLLOW_EYE_COLOR, HOLLOW_FIGURE_M } from "./hollowLook.js";

/** The crowd's eyes run from pale to a dull ember by a figure's `warm`: never the Hollow's red, which is what tells a figure that kills from the crowd. */
export const CROWD_EYE_PALE: Rgb = { r: 0.78, g: 0.82, b: 0.74 };
export const CROWD_EYE_EMBER: Rgb = { r: 0.9, g: 0.42, b: 0.16 };
/** An eye's half width and the pair's spread, in metres at a Hollow's size; the share of a figure's height its eyes sit at; and how bright a wholly lit eye is. */
export const CROWD_EYE_M = 0.09;
export const CROWD_EYE_APART_M = 0.34;
export const CROWD_EYE_HEIGHT = 0.72;
export const CROWD_EYE_GAIN = 1.6;
/** A figure that kills (`CrowdFigure.kills`) has the Hollow's red, this many times as bright and as large as a figure of the crowd's: red eyes in the mist are what a runner reads. */
export const CROWD_EYE_KILLS_GAIN = 2;
export const CROWD_EYE_KILLS_SIZE = 1.7;
/** A figure that has its player (`CrowdFigure.reach`) opens its eyes on them: this many times as bright and as large at its whole reach. */
export const CROWD_EYE_REACH_GAIN = 2;
export const CROWD_EYE_REACH_SIZE = 1.5;
/** Metres from the eye over which a pair dims to half and no further: it carries through the mist. */
export const CROWD_EYE_DIM_M: readonly [number, number] = [40, 120];
/** Vertices a pair (two quads), and the floats of each of a vertex's three attributes: its place, its corner and size, its colour. */
export const CROWD_EYE_VERTICES = 8;
export const CROWD_EYE_FLOATS = { position: 3, eye: 4, colour: 4 } as const;

/** A figure's eye colour for its `warm`, 0 pale to 1 ember. */
export function crowdEyeColour(warm: number): Rgb {
  return {
    r: CROWD_EYE_PALE.r + (CROWD_EYE_EMBER.r - CROWD_EYE_PALE.r) * warm,
    g: CROWD_EYE_PALE.g + (CROWD_EYE_EMBER.g - CROWD_EYE_PALE.g) * warm,
    b: CROWD_EYE_PALE.b + (CROWD_EYE_EMBER.b - CROWD_EYE_PALE.b) * warm,
  };
}

const CORNERS: readonly [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

/** The eyes' vertices, for `most` pairs: what a frame is written into. */
export type CrowdEyeVertices = { positions: Float32Array; eyes: Float32Array; colours: Float32Array };

/** Room for `most` pairs, every one nothing: no size and no light. */
export function crowdEyeVertices(most: number): CrowdEyeVertices {
  const vertices = most * CROWD_EYE_VERTICES;
  return { positions: new Float32Array(vertices * 3), eyes: new Float32Array(vertices * 4), colours: new Float32Array(vertices * 4) };
}

/** The triangles of `most` pairs: two quads a pair. */
export function crowdEyeIndices(most: number): Uint32Array {
  const indices = new Uint32Array(most * 12);
  for (let q = 0; q < most * 2; q++) indices.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
  return indices;
}

/**
 * A frame's eyes into `out`: the figures and the ground's height under each
 * (`heights`, in step with them), the eye, the screen's seconds, and the
 * figures another drawer holds (`skip`: a model has eyes of its own). The
 * pairs not used are nothing. Returns the pairs written, `most` at the most.
 */
export function writeCrowdEyes(
  out: CrowdEyeVertices, most: number, figures: readonly CrowdFigure[], heights: readonly number[], eye: { readonly x: number; readonly y: number; readonly z: number },
  seconds: number, skip: ReadonlySet<number>,
): number {
  const { positions, eyes, colours } = out;
  let drawn = 0;
  for (let i = 0; i < figures.length && drawn < most; i++) {
    const f = figures[i] as CrowdFigure;
    if (skip.has(f.id)) continue;
    const reach = f.reach ?? 0;
    const y = (heights[i] as number) + HOLLOW_FIGURE_M * f.size * CROWD_EYE_HEIGHT;
    const dx = f.x - eye.x, dy = y - eye.y, dz = f.z - eye.z;
    const far = (Math.sqrt(dx * dx + dy * dy + dz * dz) - CROWD_EYE_DIM_M[0]) / (CROWD_EYE_DIM_M[1] - CROWD_EYE_DIM_M[0]);
    const t = far <= 0 ? 0 : far >= 1 ? 1 : far * far * (3 - 2 * far);
    const kills = f.kills === true;
    const level = f.eyes * presenceOf(f, seconds) * CROWD_EYE_GAIN * (1 - 0.5 * t) * (kills ? CROWD_EYE_KILLS_GAIN : 1) * (1 + (CROWD_EYE_REACH_GAIN - 1) * reach);
    const colour = kills ? HOLLOW_EYE_COLOR : crowdEyeColour(f.warm);
    for (let e = 0; e < 2; e++) {
      for (let c = 0; c < 4; c++) {
        const v = (drawn * 2 + e) * 4 + c, corner = CORNERS[c] as [number, number];
        positions[v * 3] = f.x;
        positions[v * 3 + 1] = y;
        positions[v * 3 + 2] = f.z;
        eyes[v * 4] = corner[0];
        eyes[v * 4 + 1] = corner[1];
        eyes[v * 4 + 2] = CROWD_EYE_M * f.size * (kills ? CROWD_EYE_KILLS_SIZE : 1) * (1 + (CROWD_EYE_REACH_SIZE - 1) * reach);
        eyes[v * 4 + 3] = (e === 0 ? -0.5 : 0.5) * CROWD_EYE_APART_M * f.size;
        colours[v * 4] = colour.r;
        colours[v * 4 + 1] = colour.g;
        colours[v * 4 + 2] = colour.b;
        colours[v * 4 + 3] = level;
      }
    }
    drawn++;
  }
  // The pairs not used are nothing: no size and no light.
  eyes.fill(0, drawn * 32);
  colours.fill(0, drawn * 32);
  return drawn;
}
