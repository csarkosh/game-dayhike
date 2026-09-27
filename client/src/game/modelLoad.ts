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
 * A load that fails while its shell lives rejects with its own error, exactly
 * as before, and is reported however that shell reports it.
 */
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";

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
          container.dispose();
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
