/**
 * The hike's renderer, made: the one way the hike has to a renderer, at its
 * start and for every swap after. It loads Babylon Lite, through the
 * renderer drawn with it, and nothing else that draws.
 */
import type { Forest } from "@csarkosh/engine/sim/forest";
import type { Level } from "@csarkosh/engine/sim/level";
import { createLiteRenderer } from "@csarkosh/engine/game/lite/renderer";
import type { Renderer } from "./hikeRendererTypes.js";
import { hikeParts } from "./lite/hikeParts.js";
import type { RendererOptions } from "@csarkosh/engine/game/rendererTypes";

/**
 * A hike's renderer, as the hike holds it: the one drawn with Babylon Lite
 * (`lite/renderer.ts`), from a canvas, a world and its options; its engine
 * it makes for itself. The hike makes its first renderer and each one
 * a swap builds through this, so nothing it holds names what draws the
 * world.
 */
export function createHikeRenderer(
  canvas: HTMLCanvasElement,
  level: Level,
  forest: Forest | null = null,
  options: RendererOptions = {},
): Renderer {
  return createLiteRenderer(canvas, level, forest, options, hikeParts);
}
