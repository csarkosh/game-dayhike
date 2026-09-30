/**
 * One way for every model load in the game to end when the shell that started
 * it is disposed.
 *
 * Disposing a scene does not end a load against it. Babylon aborts the
 * request the scene tracks, and a load whose request is aborted never settles;
 * a load that had not yet reached its request (its loader module was still
 * being imported, or a sequential loop started it after the teardown) runs to
 * the end against the disposed scene and rejects "Scene has been disposed".
 * The first shape leaves the shell waiting on a promise that never ends; the
 * second prints as a failure, and sequential loops carry on fetching the rest
 * of their list for a scene nothing will draw.
 *
 * So each shell that loads models (a field of props, a pool, a placed model)
 * holds an `AbortController` and aborts it first thing in its `dispose`, and
 * every load it starts goes through `loadUntilAborted` with that signal:
 *
 * - once aborted, a load is not started at all;
 * - a load in flight at the abort rejects at once with `signal.reason`, so the
 *   shell's `catch` sees it and returns quietly (`signal.aborted` is true);
 * - what the abandoned load does later is absorbed here: a container that
 *   lands is disposed, a rejection is dropped, so neither is adopted by a
 *   disposed shell nor reported as unhandled.
 *
 * An abandoned load is dropped, not cancelled: Babylon's loader takes no
 * signal, so the work it has already begun carries on to its end. A load that
 * was still waiting on the loader module when it was abandoned goes on to
 * request its file and downloads it whole before it rejects; during a live
 * tier change that download can run alongside the new renderer's request for
 * the same file. A renderer torn down in the first second or so of its life
 * keeps its scene alive until that scene's BRDF texture has expanded
 * (`releaseEngine` in `renderer.ts`): until then the requests already made
 * against the scene are not aborted either, and go on downloading and parsing
 * into it; each container that lands is disposed here.
 *
 * A load that fails while its shell lives rejects with its own error, exactly
 * as before, and is reported however that shell reports it.
 */
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { LoadProgress } from "./loadProgress.js";
import { MODEL_COUNT, assetBytes } from "./assetUrls.js";

/** The models stage's total: every model the build ships, since a hike
 * loads them all (the far forest, the clutter, the wildlife, the people and
 * the placed things), so the line can say `n of N` from its first word. */
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

/** Babylon's container loader, with the progress option the loads pass. */
export type ContainerLoader = (
  url: string,
  scene: Scene,
  options?: { onProgress?: (e: { loaded: number; total: number }) => void },
) => Promise<AssetContainer>;

/** The catalog `output` a hashed model url was built from: `/…/tree.giant_fir-Ab12Cd34.glb` is `models/tree.giant_fir.glb`. */
function outputOf(url: string): string {
  const name = url.split("?")[0]!.split("/").pop() ?? "";
  return "models/" + name.replace(/-[A-Za-z0-9_-]{8}(\.glb)$/, "$1");
}

/**
 * The one loader every model passes through: forest, clutter, cliffs, birds,
 * creatures, characters, signs, the trailhead and the body. It reports the
 * start, the bytes as they land and the settle to the progress model when one
 * is set, keyed by the url, which is hashed and so unique; the catalog's
 * `bytes`, where the export wrote them, give the size before the first byte
 * lands. Every site calls it inside its own `loadUntilAborted`, so a
 * teardown ends the load the same way whichever shell started it.
 */
export function loadContainer(url: string, scene: Scene, load: ContainerLoader = loadAssetContainerAsync): Promise<AssetContainer> {
  const p = progress;
  p?.start("models", url, assetBytes(outputOf(url)));
  const pending = load(url, scene, {
    onProgress: (e) => p?.bytes("models", url, e.loaded, e.total > 0 ? e.total : undefined),
  });
  return pending.finally(() => p?.done("models", url));
}

export function loadUntilAborted(
  start: () => Promise<AssetContainer>,
  signal: AbortSignal,
): Promise<AssetContainer> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<AssetContainer>((resolve, reject) => {
    let ended = false;
    const onAbort = (): void => {
      if (ended) return;
      ended = true;
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    let pending: Promise<AssetContainer>;
    try {
      pending = start();
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (container) => {
        signal.removeEventListener("abort", onAbort);
        if (ended) {
          // Nothing watches this chain, so a throw here would surface as an
          // unhandled rejection: the scene it was made for is gone, and there
          // is nothing left to report to.
          try {
            container.dispose();
          } catch {
            /* dropped with the load */
          }
          return;
        }
        ended = true;
        resolve(container);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        if (ended) return;
        ended = true;
        reject(error);
      },
    );
  });
}
