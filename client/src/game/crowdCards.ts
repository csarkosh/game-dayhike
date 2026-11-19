/**
 * The crowd's cards (docs/gameplay/2026-11-13-the-way-down.md): the bodies
 * of the crowd's figures, each a flat shape of a Hollow. One mesh, drawn
 * twice. In the frame it is a dark body with a rim the mist lights, so a
 * figure shows against the pale mist and against the black woods alike (on
 * the tiers whose woods are near black a darkness alone showed nothing). In
 * the shade mask (`lite/shadeMask.ts`) it is a shade, which the grade or the
 * veil blurs into a darkness as it does the sim's own. Past the mist's reach
 * only a figure's eyes are left (crowdEyes.ts). This file is the cards'
 * numbers and how a frame's vertices are written, computed with no engine;
 * `lite/crowdCardMeshes.ts` makes the mesh and its two materials from it.
 *
 * The stages' text is `shaders/crowdCard/`. Each vertex is at its figure's
 * feet in the world and carries its corner of the card (x: -1 to 1 across,
 * y: 0 to 1 up), the figure's height in metres and how much of it is there;
 * the card is half as wide as it is tall and stands upright, turned about
 * the vertical to face the camera. The fragment draws the figure's shape in
 * shares of its height: a torso broader at the shoulders, a head, long arms,
 * legs, and the antlers, the same on both sides of its middle. It leans a
 * little on a slow beat of its own (its phase and its rate ride with the
 * vertex), and its feet are lost in the mist. In the mask (`crowdPass` 0) it
 * is written into the mask's red as a shade is; in the frame (`crowdPass` 1)
 * it is a dark body that hides what is behind it, with a faint, wide rim the
 * mist lights (`crowdTint`), blended premultiplied as the way's mist is: a
 * darkness the mist catches the edge of, never a drawn line.
 */
import { presenceOf, type CrowdFigure } from "./crowdField.js";
import { SHADE_FAR_M, SHADE_FAR_SHARE, SHADE_NEAR_M } from "./entityPoses.js";
import { HOLLOW_FIGURE_M } from "./hollowLook.js";
import { hash2 } from "../sim/field.js";

/** A card's width, as a share of its height (the vertex and fragment stages lay the figure out in a half of this either side of its middle). */
export const CROWD_CARD_WIDE = 0.5;
/** The seconds the shader's clock folds at, so its sines keep their precision. */
export const CROWD_CARD_FOLD_S = 1000;
/** Metres from the eye a crowd shade is still a card: past the mist's reach (crowdField.ts CROWD_MIST_M, 30) by enough that the body is gone before the card is. */
export const CROWD_CARDS_TO_M = 36;
/** Vertices a card (one quad), and the floats of each of a vertex's three attributes: its place, its corner and height and level, its stir. */
/** How much more of itself a figure that kills (`CrowdFigure.kills`) is than one of the crowd's: a body nothing shows through (the frame draws a card at three quarters of its level). */
export const CROWD_CARD_KILLS = 1.3;
export const CROWD_CARD_VERTICES = 4;
export const CROWD_CARD_FLOATS = { position: 3, card: 4, stir: 2 } as const;

const CORNERS: readonly [number, number][] = [[-1, 0], [1, 0], [-1, 1], [1, 1]];

/** The cards' vertices, for `most` cards: what a frame is written into. */
export type CrowdCardVertices = { positions: Float32Array; cards: Float32Array; stirs: Float32Array };

/** Room for `most` cards, every one nothing. */
export function crowdCardVertices(most: number): CrowdCardVertices {
  const vertices = most * CROWD_CARD_VERTICES;
  return { positions: new Float32Array(vertices * 3), cards: new Float32Array(vertices * 4), stirs: new Float32Array(vertices * 2) };
}

/** The triangles of `most` cards: a quad a card. */
export function crowdCardIndices(most: number): Uint32Array {
  const indices = new Uint32Array(most * 6);
  for (let q = 0; q < most; q++) indices.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
  return indices;
}

/** The shader's clock at the screen's `seconds`, folded so its sines keep their precision. */
export function crowdCardTime(seconds: number): number {
  return seconds % CROWD_CARD_FOLD_S;
}

/**
 * A frame's cards into `out`: the figures and the ground's height under
 * each, the eye, the screen's seconds, the figures another drawer holds
 * (`skip`), and the band of metres from the eye a card is drawn in, `from`
 * to under `to`. A card is fainter with distance, as a shade of the sim's is
 * (entityPoses.ts). The cards not used are nothing. Returns the cards
 * written, `most` at the most.
 */
export function writeCrowdCards(
  out: CrowdCardVertices, most: number, figures: readonly CrowdFigure[], heights: readonly number[], eye: { readonly x: number; readonly y: number; readonly z: number },
  seconds: number, skip: ReadonlySet<number>, from: number, to: number,
): number {
  const { positions, cards, stirs } = out;
  let drawn = 0;
  for (let i = 0; i < figures.length && drawn < most; i++) {
    const f = figures[i] as CrowdFigure;
    if (skip.has(f.id)) continue;
    const ground = heights[i] as number;
    const dx = f.x - eye.x, dy = ground - eye.y, dz = f.z - eye.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < from || d >= to) continue;
    const t = Math.max(0, Math.min(1, (d - SHADE_NEAR_M) / (SHADE_FAR_M - SHADE_NEAR_M)));
    const level = presenceOf(f, seconds) * (1 - (1 - SHADE_FAR_SHARE) * t) * (f.kills === true ? CROWD_CARD_KILLS : 1);
    const phase = hash2(f.id, 6, 0) * 2 * Math.PI, rate = 0.5 + f.pace * 0.5;
    for (let c = 0; c < 4; c++) {
      const v = drawn * 4 + c, corner = CORNERS[c] as [number, number];
      positions[v * 3] = f.x;
      positions[v * 3 + 1] = ground;
      positions[v * 3 + 2] = f.z;
      cards[v * 4] = corner[0];
      cards[v * 4 + 1] = corner[1];
      cards[v * 4 + 2] = HOLLOW_FIGURE_M * f.size;
      cards[v * 4 + 3] = level;
      stirs[v * 2] = phase;
      stirs[v * 2 + 1] = rate;
    }
    drawn++;
  }
  cards.fill(0, drawn * 16);
  return drawn;
}
