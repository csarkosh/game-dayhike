/**
 * The page's side of a hike's world made off its thread: starts the module
 * worker (`world.worker.ts`) for the hike that is about to start, and takes
 * what it sends into the sim's own caches as it arrives: what the terrain
 * prepares for the seed (the bowl, with the trail) and the pass hash. The
 * world's build then finds both made, where it would have stopped the page
 * to make them.
 *
 * The hike always starts. Where there is no Worker, it cannot be made, it
 * fails, it sends what cannot be read or it has not finished in
 * `WORLD_PREP_TIMEOUT_MS`, `ready` resolves all the same and the build makes
 * for itself whatever was not installed, as it always did. What the page
 * already holds (a second hike on the page: the pass hash; the same hike
 * again: the bowl too) the worker is not asked for, and where it holds both
 * no worker is started.
 */
import { installPassHash, passHashCachedFor } from "../sim/forest.js";
import { terrainVariant } from "../sim/terrain.js";
import type { WorldPrepReply, WorldPrepRequest } from "./world.worker.js";

/** How long the start waits for the worker before the page makes the world
 * itself. A phone makes both in about two seconds; this is for a worker that
 * never answers, not a slow one. */
export const WORLD_PREP_TIMEOUT_MS = 30_000;

export type WorldPrepOutcome = {
  /** How it ended: the worker finished (`done`); the page held everything
   * already (`cached`); no worker could be started; it failed; it ran out of
   * time; or the hike was left. */
  why: "done" | "cached" | "no-worker" | "failed" | "timeout" | "disposed";
  /** Whether the terrain's prepared value was installed here. */
  prepared: boolean;
  /** Whether the pass hash was installed here. */
  passHash: boolean;
  /** Milliseconds from the start to the end. */
  ms: number;
};

export type WorldPrep = { readonly ready: Promise<WorldPrepOutcome>; dispose(): void };

let lastId = 0;

/**
 * Starts the worker (new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" }))
 * with one request, for `input.seed` on the terrain `input.variant`. A reply
 * is taken only when it is this request's, for this seed and terrain; a pass
 * hash made over another count of passes than this thread's is refused
 * (`installPassHash`). `onStep` hears of each result as it is taken or
 * refused. `ready` never rejects; `dispose` ends the worker, and nothing is
 * installed after `ready` has resolved.
 */
export function startWorldPrep(
  input: { seed: number; variant: string },
  deps: { now?: () => number; timeoutMs?: number; onStep?: (kind: "prepared" | "passHash") => void } = {},
): WorldPrep {
  const now = deps.now ?? ((): number => performance.now());
  const from = now();
  const id = ++lastId;
  const installed = { prepared: false, passHash: false };
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ended = false;
  let resolve: (outcome: WorldPrepOutcome) => void = () => undefined;
  const ready = new Promise<WorldPrepOutcome>((r) => {
    resolve = r;
  });

  function end(why: WorldPrepOutcome["why"]): void {
    if (ended) return;
    ended = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (worker !== null) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    resolve({ why, ...installed, ms: now() - from });
  }

  function take(reply: WorldPrepReply): void {
    if (ended || reply.id !== id) return;
    if (reply.kind === "prepared") {
      if (reply.seed !== input.seed || reply.variant !== input.variant) return;
      installed.prepared = terrainVariant(reply.variant)?.install?.(reply.seed, reply.prepared) === true;
      deps.onStep?.("prepared");
    } else if (reply.kind === "passHash") {
      if (reply.variant !== input.variant) return;
      installed.passHash = installPassHash(reply.hash, { passCount: reply.passCount, variant: reply.variant });
      deps.onStep?.("passHash");
    } else {
      end(reply.kind === "done" ? "done" : "failed");
    }
  }

  const variant = terrainVariant(input.variant);
  const skip = {
    prepared: variant?.prepare === undefined || variant.isPrepared?.(input.seed) === true,
    passHash: passHashCachedFor(input.variant),
  };
  if (skip.prepared && skip.passHash) {
    end("cached");
  } else if (typeof Worker === "undefined") {
    end("no-worker");
  } else {
    try {
      worker = new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" });
    } catch {
      worker = null;
    }
    if (worker === null) {
      end("no-worker");
    } else {
      worker.onmessage = (event: MessageEvent<WorldPrepReply>): void => {
        try {
          take(event.data);
        } catch {
          end("failed");
        }
      };
      worker.onerror = (): void => end("failed");
      worker.onmessageerror = (): void => end("failed");
      timer = setTimeout(() => end("timeout"), deps.timeoutMs ?? WORLD_PREP_TIMEOUT_MS);
      try {
        const request: WorldPrepRequest = { id, seed: input.seed, variant: input.variant, skip };
        worker.postMessage(request);
      } catch {
        end("failed");
      }
    }
  }
  return { ready, dispose: () => end("disposed") };
}
