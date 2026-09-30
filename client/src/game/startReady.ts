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
 */
export async function startReady(input: {
  scene: Scene;
  forestReady: Promise<unknown>;
  reveal: Promise<void> | null;
  progress: LoadProgress | null;
  maxMs: number;
}): Promise<void> {
  const began = Date.now();
  await whenSceneReady(input.scene, input.maxMs, input.forestReady);
  if (input.reveal !== null) {
    // The reveal is bounded too: a frame that never comes whole (a pipeline
    // that never lands) must not hold the intro past the limit.
    const left = Math.max(0, input.maxMs - (Date.now() - began));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, left);
    });
    try {
      await Promise.race([input.reveal, cap]);
    } finally {
      clearTimeout(timer);
    }
  }
  input.progress?.gate();
}
