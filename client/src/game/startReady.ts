/**
 * The start-time gate: when a hike just built is ready to be looked at, as
 * the tier switch judges a renderer mid-hike (`rendererSwap.ts`), run once
 * at the start so the intro playing over it knows when the world is whole.
 */
import type { LoadProgress } from "./loadProgress.js";

/** The longest the start waits for the world before it calls it ready anyway (ms). */
export const READY_MAX_MS = 60_000;

/**
 * Resolves once the renderer's world is in (`Renderer.whenReady`); then the
 * bar reads ready. Never later than `maxMs` after the wait began, whatever
 * is still to come.
 * A start whose first builds are stepped under the intro's film
 * (`firstBuilds.ts`) is not ready until they are done (`firstBuilds`): the
 * world must not be seen filling in by a player who skips the film.
 */
export async function startReady(input: {
  /** The hike's renderer, asked when its world is in. */
  renderer: { whenReady(maxMs: number): Promise<void> };
  progress: LoadProgress | null;
  maxMs: number;
  /** The start's first builds, done: asked for once the scene is ready, by when every model
   * that readiness waits for has landed and queued its fill. Absent or null where none are stepped. */
  firstBuilds?: (() => Promise<void>) | null;
}): Promise<void> {
  const began = Date.now();
  await input.renderer.whenReady(input.maxMs);
  // The wait is bounded by what is left of the limit: a build that never ends must not hold the intro past it.
  const left = (): number => input.maxMs - (Date.now() - began);
  if (input.firstBuilds !== undefined && input.firstBuilds !== null) await within(input.firstBuilds(), left());
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
