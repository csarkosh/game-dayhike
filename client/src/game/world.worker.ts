/**
 * A hike's world, prepared off the page's thread: a module worker, which Vite
 * bundles from the `new Worker(new URL(...), { type: "module" })` in
 * `worldPrep.ts`. It runs the sim's own code for the hike that is about to
 * start and posts back the two longest computations a world's build opens
 * with, each as it is made: what the terrain variant prepares for the seed
 * (on the default terrain the bowl: the trail graph, the landmarks, the
 * features), and the pass hash, which probes ten chunks at a seed of its own
 * and builds a second trail to do it. The page installs them into the sim's
 * caches (`worldPrep.ts`), and its build then finds them made.
 *
 * The pass hash stays what it is on the page: computed at run time, by this
 * build's passes, in the browser that will play the hike. A worker of the
 * page is that browser's engine.
 *
 * The sim's passes register as they are imported, so that import comes first.
 */
import "../sim/passes/index.js";
import { passHash, passHashKey } from "../sim/forest.js";
import { activeTerrainVariant, setActiveTerrainVariant } from "../sim/terrain.js";

/** `skip`: what the page already holds and the worker leaves out. */
export type WorldPrepRequest = { id: number; seed: number; variant: string; skip?: { prepared?: boolean; passHash?: boolean } };
export type WorldPrepReply =
  | { id: number; kind: "prepared"; seed: number; variant: string; prepared: unknown }
  | { id: number; kind: "passHash"; hash: number; passCount: number; variant: string }
  | { id: number; kind: "done" }
  | { id: number; kind: "failed"; message: string };

/**
 * The request's results, posted in order: what the variant prepares for the
 * seed (where it prepares anything), the pass hash, then `done`; either left
 * out where the request says the page holds it. A terrain
 * the sim does not know, a computation that throws or a result that cannot be
 * posted ends the run with one `failed`, and nothing after it.
 */
export function prepareWorld(request: WorldPrepRequest, post: (reply: WorldPrepReply) => void): void {
  const { id, seed, variant } = request;
  try {
    setActiveTerrainVariant(variant);
    const prepared = request.skip?.prepared === true ? undefined : activeTerrainVariant().prepare?.(seed);
    if (prepared !== undefined) post({ id, kind: "prepared", seed, variant, prepared });
    if (request.skip?.passHash !== true) post({ id, kind: "passHash", hash: passHash(), ...passHashKey() });
    post({ id, kind: "done" });
  } catch (error) {
    post({ id, kind: "failed", message: error instanceof Error ? error.message : String(error) });
  }
}

// Only inside a worker: under Node, where a test imports `prepareWorld`, and
// on a page, there is no WorkerGlobalScope.
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === "function") {
  self.onmessage = (event: MessageEvent<WorldPrepRequest>): void => {
    prepareWorld(event.data, (reply) => self.postMessage(reply));
  };
}
