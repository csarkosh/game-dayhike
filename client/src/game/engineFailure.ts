/**
 * What the page does when the engine drawing a hike fails, and when a hike
 * cannot be started on its WebGPU engine: always a live rebuild of the
 * renderer or a start on WebGL2, never a reload, which would end a party (a
 * host's reload ends the room). Babylon-free and page-free: the renderer,
 * the cover, the storage and the URL come in as dependencies, as the
 * governor's `actOnDrop` takes them, so every sequence is tested with plain
 * objects (`engineFailure.test.ts`).
 */
import {
  NOTICE_RESTARTED,
  NOTICE_SWITCHED,
  failureSwap,
  fallbackHolds,
  readFallback,
  recordFailure,
  writeFallback,
  type EngineEnv,
  type EngineName,
} from "./engineChoice.js";
import { GOVERNOR_SWAP_READY_MAX_MS, type EngineOnCanvas } from "./rendererSwap.js";

/** The work under way on a hike's renderer (a switch of tier, the
 * governor's drop, a rebuild after a failure): one at a time. */
export type Serial = {
  /** Nothing is under way. */
  readonly idle: boolean;
  /** Runs `task` as work under way until it settles. */
  track<T>(task: Promise<T>): Promise<T>;
  /** Resolves once nothing is under way. */
  settled(): Promise<void>;
};

export function createSerial(): Serial {
  const busy = new Set<Promise<unknown>>();
  return {
    get idle() {
      return busy.size === 0;
    },
    track(task) {
      busy.add(task);
      const settle = (): void => void busy.delete(task);
      task.then(settle, settle);
      return task;
    },
    async settled() {
      while (busy.size > 0) await Promise.allSettled([...busy]);
    },
  };
}

/**
 * A cover over play: `show` raises the opaque screen, `hold` holds the
 * controls and gives back how to free them, and `whenEnded` calls its
 * function when the hike's session ends. The function returned lifts the
 * cover once: when called, or at once when the session ends, so the ending
 * is never hidden.
 */
export function coverWith(deps: {
  show(): { dispose(): void };
  hold(): () => void;
  whenEnded(lift: () => void): () => void;
}): () => void {
  const screen = deps.show();
  const release = deps.hold();
  let lifted = false;
  let stopListening = (): void => undefined;
  const lift = (): void => {
    if (lifted) return;
    lifted = true;
    stopListening();
    screen.dispose();
    release();
  };
  stopListening = deps.whenEnded(lift);
  return lift;
}

/** What answering a failure needs of the hike. */
export type FailureDeps = {
  serial: Serial;
  /** False once the hike is gone, its renderer broken or its session ending. */
  alive(): boolean;
  /** The engine the running renderer draws with. */
  running(): unknown;
  /** Whether the running renderer draws with WebGPU. */
  runningOnWebGpu(): boolean;
  /** Stops listening to the running engine. */
  unwatch(): void;
  /** Remembers the failure for the next engine the rule gives (the page's
   * record, and the URL's pin where needed: `recordEngineFailure`). Its line
   * is the one that engine would earn; the line shown is chosen from the
   * engine the rebuild ends on. */
  record(reason: "pipeline" | "lost"): string;
  /** Covers play; the function returned lifts it. */
  cover(): () => void;
  /** Stops the render loop on the failed engine. */
  stopLoop(): void;
  /** Rebuilds the renderer at the running tier on the engine the rule now
   * gives it (the live switch), waiting at most `readyMaxMs` for its new
   * scene; rejects when no tier builds. */
  rebuild(readyMaxMs: number): Promise<void>;
  flash(line: string): void;
  log(line: string): void;
};

/**
 * The hike's answer to a failure of its running WebGPU engine, reported by
 * its watcher (`watchWebGpu`): the watcher comes off first (the rebuild then
 * disposes the engine, and a disposed engine is not a failing one), the
 * failure is remembered, and once any switch under way has settled, the
 * renderer is rebuilt at the running tier on the engine the rule now gives
 * it, under a cover over play, with the loop stopped on the failed engine.
 * A report from an engine that is no longer the running one, or one already
 * answered, changes nothing more; so does one whose engine a switch already
 * left while it waited. The HUD's line says what the rebuild ended on:
 * restarted on WebGPU, switched to WebGL2. The cover lifts on every outcome;
 * a rebuild that throws shows no line.
 */
export function answerFailures(deps: FailureDeps): (engine: unknown, reason: "pipeline" | "lost") => Promise<void> {
  const answered = new Set<unknown>();
  return async (engine, reason) => {
    if (answered.has(engine) || engine !== deps.running()) return;
    answered.add(engine);
    deps.unwatch();
    if (!deps.alive()) return;
    deps.log(`WebGPU: ${reason === "lost" ? "the device was lost" : "a GPU error"}; rebuilding the renderer.`);
    deps.record(reason);
    await deps.serial.settled();
    // A switch under way may already have left the failed engine.
    if (!deps.alive() || deps.running() !== engine) return;
    await deps.serial.track(
      (async (): Promise<void> => {
        const lift = deps.cover();
        try {
          deps.stopLoop();
          // A rebuild nobody asked for, in the middle of play: the cover
          // lifts on the governor's bound, as its drop's does.
          await deps.rebuild(GOVERNOR_SWAP_READY_MAX_MS);
        } catch (error) {
          deps.log(`WebGPU: the renderer could not be rebuilt after a failure: ${String(error)}`);
          return;
        } finally {
          lift();
        }
        if (deps.alive()) deps.flash(deps.runningOnWebGpu() ? NOTICE_RESTARTED : NOTICE_SWITCHED);
      })(),
    );
  };
}

/**
 * Remembers a failure of a WebGPU engine for this browser and Babylon version
 * (`recordFailure`) and, where the rule would otherwise give WebGPU again
 * (storage refused the record, or `?engine=webgpu` outranks it), pins
 * `engine=webgl2` in this tab's URL (`failureSwap`). The HUD's line for the
 * engine the rule now gives.
 */
export function recordEngineFailure(
  reason: "pipeline" | "lost",
  page: { storage: Storage | null; env: EngineEnv; now: number; override: EngineName | null; pin(): void },
): string {
  const record = recordFailure(readFallback(page.storage), reason, page.env, page.now);
  const stored = writeFallback(page.storage, record);
  const act = failureSwap({ stored, holds: fallbackHolds(record, page.env, page.now), reason, override: page.override });
  if (act.pin) page.pin();
  return act.notice;
}

/**
 * Starts a hike on `first`, and where it throws on a WebGPU engine, starts it
 * again on WebGL2 on a fresh canvas that takes the place of every canvas the
 * first start left (`place`). The game is handed one recorder of WebGPU
 * failures for its life (`start`'s `engineFailed`). While a start is under
 * way, a fault its ladder finds is the start's: held against the engine
 * once, and only once the WebGL2 start stands, and the game then shows the
 * line. Once the start has returned, every failure of the hike is recorded
 * as it comes (`deps.engineFailed`). A throw on WebGL2, or from the WebGL2
 * start, goes up: the fault is not the engine's.
 */
export function startOnEngine<G extends { notify(line: string): void }>(
  first: EngineOnCanvas,
  deps: {
    /** Starts the game on `onCanvas`, handing it `engineFailed` for every
     * WebGPU failure it meets. */
    start(onCanvas: EngineOnCanvas, engineFailed: (reason: "pipeline" | "lost") => string): G;
    engineFailed(reason: "pipeline" | "lost"): string;
    freshCanvas(): HTMLCanvasElement;
    place(canvas: HTMLCanvasElement): void;
    log(message: string, error: unknown): void;
  },
): G {
  let line: string | null = null;
  const once = (): string => (line ??= deps.engineFailed("pipeline"));
  let starting = false;
  const record = (reason: "pipeline" | "lost"): string =>
    starting && reason === "pipeline" ? once() : deps.engineFailed(reason);
  const start = (onCanvas: EngineOnCanvas): G => {
    starting = true;
    try {
      return deps.start(onCanvas, record);
    } finally {
      starting = false;
    }
  };
  try {
    return start(first);
  } catch (error) {
    if (first.engine === null) throw error;
    deps.log("WebGPU: the game could not be started on it; starting it on WebGL2.", error);
    const fresh = deps.freshCanvas();
    deps.place(fresh);
    const game = start({ canvas: fresh, engine: null, watchers: null });
    game.notify(once());
    return game;
  }
}
