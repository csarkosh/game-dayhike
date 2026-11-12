/**
 * The start-time gate: when a hike just built is ready to be looked at, as
 * the tier switch judges a renderer mid-hike (`rendererSwap.ts`), run once
 * at the start so the intro playing over it knows when the world is whole.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { whenSceneReady } from "./rendererSwap.js";
import type { LoadProgress } from "./loadProgress.js";

/** The longest the start waits for the world before it calls it ready anyway (ms). */
export const READY_MAX_MS = 60_000;

/**
 * Resolves once the scene is ready with nothing in flight and the forest's
 * layers are in (`forestReady`), then, on WebGPU, once a whole frame has
 * drawn with no draw left out (`reveal`); then the bar reads ready. Never
 * later than `maxMs` after the scene test began, whatever is still to come.
 * A start whose first builds are stepped under the intro's film
 * (`firstBuilds.ts`) is not ready until they are done (`firstBuilds`): the
 * world must not be seen filling in by a player who skips the film.
 */
export async function startReady(input: {
  scene: Scene;
  forestReady: Promise<unknown>;
  reveal: Promise<void> | null;
  progress: LoadProgress | null;
  maxMs: number;
  /** The start's first builds, done; absent or null where none are stepped. */
  firstBuilds?: Promise<void> | null;
}): Promise<void> {
  const began = Date.now();
  await whenSceneReady(input.scene, input.maxMs, input.forestReady);
  // Each wait is bounded by what is left of the limit: a build that never ends, or a frame that
  // never comes whole (a pipeline that never lands), must not hold the intro past it.
  const left = (): number => input.maxMs - (Date.now() - began);
  if (input.firstBuilds !== undefined && input.firstBuilds !== null) await within(input.firstBuilds, left());
  if (input.reveal !== null) await within(input.reveal, left());
  input.progress?.gate();
}

/** Waits for `what`, `leftMs` at most. */
async function within(what: Promise<void>, leftMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, leftMs));
  });
  try {
    await Promise.race([what, cap]);
  } finally {
    clearTimeout(timer);
  }
}
