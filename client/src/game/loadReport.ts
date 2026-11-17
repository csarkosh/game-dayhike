/**
 * Where the game's loads report to the loading bar (`loadProgress.ts`), with
 * no engine: the progress model set while an intro is up, and the hooks the
 * loads call (a model's start, bytes and settle through `modelLoad.ts`; a
 * ground map, an albedo or a wildlife call here by name; a shader compiled).
 * Nothing is reported when no bar is up.
 *
 * Kept apart from the model loader so that what only reports (the page, a
 * hike, the wildlife's calls) loads no renderer's library to do it.
 */
import { MODEL_COUNT } from "./assetUrls.js";
import type { LoadProgress } from "./loadProgress.js";

/** The models stage's total: every model a hike loads (the far forest, the
 * clutter, the wildlife, the people and the placed things; not the film's
 * own), so the line can say `n of N` from its first word. */
export const MODEL_TOTAL = MODEL_COUNT;

let progress: LoadProgress | null = null;
/** The progress model the loads report to while an intro is up; null otherwise. */
export function setLoadProgress(p: LoadProgress | null): void {
  progress = p;
  p?.total("models", MODEL_TOTAL);
}
/** The progress model the loads report to, for the other hooks. */
export function reportProgress(): LoadProgress | null {
  return progress;
}

let compiles = 0;
/** A shader the WebGL2 engine compiled: one of the bar's shaders, a stage
 * with no total, since nothing says ahead how many the world will ask for. */
export function reportCompile(): void {
  const p = progress;
  if (p === null) return;
  const id = `c${compiles++}`;
  p.start("shaders", id);
  p.done("shaders", id);
}

/**
 * The ground's downloads for the loading bar: the twelve maps
 * (`groundMaps.ts`), the six albedos (`terrainTexture.ts`) and the six
 * wildlife calls (`wildlifeAudio.ts`) are one stage of 24, told by name as
 * each starts and lands. Nothing to report when no bar is up.
 */
export const GROUND_STAGE_TOTAL = 24;

export function reportLayer(what: "start" | "done", id: string): void {
  const p = reportProgress();
  if (p === null) return;
  p.total("ground", GROUND_STAGE_TOTAL);
  if (what === "start") p.start("ground", id);
  else p.done("ground", id);
}
