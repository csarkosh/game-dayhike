/**
 * A renderer's own watch on the engine it made for itself.
 *
 * The page watches an engine it made and handed to a renderer with that
 * engine's own module (`EngineWatchers.failures`, `gpuEngine.ts`). A renderer
 * that makes its engine from its canvas is the only one that can hear it
 * fail, so it keeps one of these and offers its `watch` as
 * `Renderer.ownWatch`: the hike's ladders put it on once the renderer stands
 * (`rendererSwap.ts`), and a failure told here is answered as any engine's
 * is, by a live rebuild of the renderer (`answerFailures`).
 *
 * As `watchWebGpu` has it, each reason is told once an engine, and only to
 * who is listening. One difference: a failure that came before anyone
 * listened is told to the first who does, a turn later, since this engine is
 * made after its renderer is handed back.
 *
 * No engine: the renderer calls `fail` from its engine's own events.
 */
import type { EngineHandle } from "./engineHandle.js";

/** Why an engine failed under a renderer, as the hike answers it (`answerFailures`). */
export type EngineFailure = "pipeline" | "lost";

/** Listens to an engine for the failures the game answers; the function
 * returned stops listening. */
export type WatchEngine = (engine: EngineHandle, onFailure: (reason: EngineFailure) => void) => () => void;

export type EngineWatch = {
  /** Whether the engine has failed for `reason`. */
  failed(reason: EngineFailure): boolean;
  /** The watch the hike puts on (`Renderer.ownWatch`); the engine it is called with is the renderer's own handle. */
  readonly watch: WatchEngine;
  /** Tells every listener of a failure, once a reason. */
  fail(reason: EngineFailure): void;
  /** Lets every listener go: a renderer disposed tells no one. */
  close(): void;
};

export function createEngineWatch(): EngineWatch {
  const told = new Set<EngineFailure>();
  const heard = new Set<(reason: EngineFailure) => void>();
  /** The failures no listener has been told of yet. */
  const owed = new Set<EngineFailure>();
  let closed = false;
  return {
    failed: (reason) => told.has(reason),
    watch: (_engine, onFailure) => {
      if (closed) return () => undefined;
      heard.add(onFailure);
      if (owed.size > 0) {
        const late = [...owed];
        owed.clear();
        queueMicrotask(() => {
          if (heard.has(onFailure)) for (const reason of late) onFailure(reason);
        });
      }
      return () => void heard.delete(onFailure);
    },
    fail(reason) {
      if (closed || told.has(reason)) return;
      told.add(reason);
      if (heard.size === 0) {
        owed.add(reason);
        return;
      }
      for (const tell of [...heard]) tell(reason);
    },
    close() {
      closed = true;
      heard.clear();
      owed.clear();
    },
  };
}
