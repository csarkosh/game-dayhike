/**
 * Where the game's loads report to the loading bar (`loadProgress.ts`), with
 * no engine: the progress model set while an intro is up, and the hooks the
 * loads call (a model, a ground map, an albedo or a wildlife call here by
 * name). Nothing is reported when no bar is up.
 *
 * Kept apart from the loaders so that what only reports (the page, a
 * hike, the wildlife's calls) loads no renderer's library to do it.
 */
import { modelBytes } from "./assetUrls.js";
import type { LoadProgress } from "@csarkosh/engine/game/loadProgress";

let progress: LoadProgress | null = null;
/** The models asked for under the bar that is up, by url: the models stage's total is their count. */
let models = new Set<string>();

/** The progress model the loads report to while an intro is up; null otherwise. */
export function setLoadProgress(p: LoadProgress | null): void {
  progress = p;
  models = new Set();
}
/** The progress model the loads report to, for the other hooks. */
export function reportProgress(): LoadProgress | null {
  return progress;
}

/**
 * What a load tells the bar after its start. Both are quiet unless the bar
 * the load started under is still the one up, so a load that outlives its
 * hike tells nothing to the next hike's bar; and a load ended by its owner's
 * signal does not land: whoever asks for the same file again lands it.
 */
export type LoadTold = {
  /** Every byte of the file is in: what is left is the reading of it. */
  fetched(bytes: number): void;
  /** The load has ended: its thing is made, or could not be. */
  landed(): void;
};

const QUIET: LoadTold = { fetched: () => undefined, landed: () => undefined };

/**
 * Names the models a loader is going to fetch, where it does not ask for
 * them all at once (`lite/wildlifeMeshes.ts` fetches its birds one after
 * another), so the stage's total holds them from the first.
 */
export function expectModels(urls: readonly string[]): void {
  if (progress === null) return;
  for (const url of urls) models.add(url);
  progress.total("models", models.size);
}

/**
 * A model's download for the loading bar, told as it starts: every model a
 * renderer fetches passes through here (the forest, the clutter, the cliffs,
 * the animals, the people, the placed things and a scene's actors), by its
 * url, which is the file's own, so a file fetched again under the same bar
 * counts once. The stage's total is the count of the models asked for so
 * far, whatever the tier, the world and the hikers make that; the catalog's
 * `bytes` weigh the download before the first byte lands.
 */
export function reportModel(url: string, signal: AbortSignal): LoadTold {
  const p = progress;
  if (p === null) return QUIET;
  models.add(url);
  p.total("models", models.size);
  p.start("models", url, modelBytes(url));
  return {
    fetched(bytes) {
      if (progress === p && !signal.aborted) p.bytes("models", url, bytes, bytes);
    },
    landed() {
      if (progress === p && !signal.aborted) p.done("models", url);
    },
  };
}

/**
 * `load` as a model's download told to the bar: its start now, its bytes
 * when `load` says they are in, and its landing when `load` settles. A model
 * that could not be fetched or read lands too: the hike goes on without it,
 * and the bar with it.
 */
export function modelLoadTold<T>(url: string, signal: AbortSignal, load: (fetched: (bytes: number) => void) => Promise<T>): Promise<T> {
  const told = reportModel(url, signal);
  return load(told.fetched).finally(told.landed);
}

/**
 * The ground's downloads for the loading bar: the twelve maps and the six
 * albedos (`lite/groundTextures.ts`) and the six
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

/** One of the ground's images, told as its fetch starts; `landed` when it is decoded, or could not be. */
export function reportGroundImage(url: string, signal: AbortSignal): Pick<LoadTold, "landed"> {
  const p = progress;
  if (p === null) return QUIET;
  reportLayer("start", url);
  return {
    landed() {
      if (progress === p && !signal.aborted) p.done("ground", url);
    },
  };
}
