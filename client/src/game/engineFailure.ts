/**
 * What the page does when the engine drawing a hike fails: always a live
 * rebuild of the renderer, never a reload, which would end a party (a host's
 * reload ends the room). No engine and no page: the renderer and the cover
 * come in as dependencies, as the governor's `actOnDrop` takes them, so
 * every sequence is tested with plain objects (`engineFailure.test.ts`).
 */
import { GOVERNOR_SWAP_READY_MAX_MS } from "./rendererSwap.js";

/** How long the HUD shows the line after a swap that answered a failure. */
export const FALLBACK_NOTICE_MS = 6_000;

/** The HUD's line once a rebuild has answered a failure. */
export const NOTICE_RESTARTED = "Graphics restarted after a GPU error.";

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
  /** Stops listening to the running engine. */
  unwatch(): void;
  /** Ends the running renderer's asynchronous work on the failed engine at
   * once and quietly (`Renderer.abandon`): the billboard bakes and the
   * pipelines being made, which would otherwise poll the dead engine until
   * the rebuild disposes the renderer and report failures of their own. */
  abandon(): void;
  /** Tells the page of the failure (its row; `main.ts`'s `engineFailed`). */
  record(reason: "pipeline" | "lost"): void;
  /** Covers play; the function returned lifts it. */
  cover(): () => void;
  /** Stops the render loop on the failed engine. */
  stopLoop(): void;
  /** Rebuilds the renderer at the running tier on a new engine of its own
   * (the live switch), waiting at most `readyMaxMs` for its new scene;
   * rejects when no tier builds. */
  rebuild(readyMaxMs: number): Promise<void>;
  flash(line: string): void;
  log(line: string): void;
  /** Whether the hike is to end and build no renderer again: a lost device
   * that is one too many in too short a time (`lossBound.ts`). Absent: never. */
  ends?(reason: "pipeline" | "lost"): boolean;
  /** Ends the hike with its line, where `ends` said so. */
  end?(): void;
  /** How a rebuild came out, once it has: `failure` is null where it ran to
   * its end, else the throw's text where no tier could be built. */
  rebuilt?(reason: "pipeline" | "lost", failure: string | null): void;
};

/**
 * The hike's answer to a failure of its running WebGPU engine, reported by
 * its watcher (`Renderer.ownWatch`): the watcher comes off first (the rebuild
 * then disposes the engine, and a disposed engine is not a failing one), the
 * renderer's work still in flight on the engine ends (`abandon`, so one
 * failure is one report), the failure is told to the page, and once any
 * switch under way has settled, the renderer is rebuilt at the running tier
 * on a new engine of its own, under a cover over play, with the loop stopped
 * on the failed engine. A report from an engine that is not the running
 * one, or one already answered, changes nothing more; so does one whose
 * engine a switch already left while it waited. The HUD then says the
 * graphics restarted (`NOTICE_RESTARTED`). The cover lifts on every outcome;
 * a rebuild that throws shows no line. Where the failure is one too many
 * (`ends`), it is remembered and the hike ends with its line (`end`): no
 * cover, no rebuild. How each rebuild came out is told (`rebuilt`).
 */
export function answerFailures(deps: FailureDeps): (engine: unknown, reason: "pipeline" | "lost") => Promise<void> {
  const answered = new Set<unknown>();
  return async (engine, reason) => {
    if (answered.has(engine) || engine !== deps.running()) return;
    answered.add(engine);
    deps.unwatch();
    deps.abandon();
    if (!deps.alive()) return;
    if (deps.ends?.(reason) === true) {
      deps.log("WebGPU: the device was lost once too often; ending the hike.");
      deps.record(reason);
      deps.end?.();
      return;
    }
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
          deps.rebuilt?.(reason, String(error));
          return;
        } finally {
          lift();
        }
        deps.rebuilt?.(reason, null);
        if (deps.alive()) deps.flash(NOTICE_RESTARTED);
      })(),
    );
  };
}
