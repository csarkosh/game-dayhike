/**
 * A hike's world, prepared off the page's thread: a module worker, which Vite
 * bundles from the `new Worker(new URL(...), { type: "module" })` in
 * `worldPrep.ts`. It runs the sim's own code for the hike that is about to
 * start and posts back the two longest computations a world's build opens
 * with, each as it is made: what the terrain variant prepares for the seed
 * (on the default terrain the bowl: the trail graph, the landmarks, the
 * features), and the pass hash, which probes ten chunks at a seed of its own
 * and builds a second trail to do it; and after them the collision chunks
 * the hike's first spawn reads. The page installs them into the sim's
 * caches (`worldPrep.ts`), and its build then finds them made.
 *
 * The pass hash stays what it is on the page: computed at run time, by this
 * build's passes, in the browser that will play the hike. A worker of the
 * page is that browser's engine.
 *
 * A second request, once the page knows the tier it will draw at, asks for
 * the hike's first scene (`preparedScene.ts`): everything the first renderer
 * samples from the ground around the start, the terrain's rings and the
 * water's among it. It is posted with its typed arrays transferred, never
 * copied, and this thread does not touch them again. It finds the bowl the
 * first request made in this thread's own cache.
 *
 * The ground is sampled here as on the page: through the field kernel
 * (`sim/fieldKernel.ts`), which this thread instantiates for itself as it
 * starts.
 *
 * The sim's passes register as they are imported, so that import comes first.
 */
import "../sim/passes/index.js";
import { generateChunk, type Chunk } from "../sim/chunk.js";
import { fieldKernelReady } from "../sim/fieldKernel.js";
import { PLAYER_HALF } from "../sim/constants.js";
import { passHash, passHashKey } from "../sim/forest.js";
import { spawnChunkCells } from "../sim/spawn.js";
import { activeTerrainVariant, setActiveTerrainVariant } from "../sim/terrain.js";
import { prepareScene, sceneTransfer, type PreparedScene } from "./preparedScene.js";
import type { QualityTier } from "./quality.js";

/** `skip`: what the page already holds and the worker leaves out. */
export type WorldPrepRequest = { id: number; seed: number; variant: string; skip?: { prepared?: boolean; passHash?: boolean } };
/** The hike's first scene at `tier`: told from the world's request by its `kind`. */
export type WorldSceneRequest = { id: number; kind: "scene"; seed: number; variant: string; tier: QualityTier };
export type WorldPrepReply =
  | { id: number; kind: "prepared"; seed: number; variant: string; prepared: unknown }
  | { id: number; kind: "passHash"; hash: number; passCount: number; variant: string }
  | { id: number; kind: "chunks"; seed: number; variant: string; chunks: Chunk[] }
  | { id: number; kind: "scene"; scene: PreparedScene }
  | { id: number; kind: "done" }
  | { id: number; kind: "failed"; message: string };

/**
 * The request's results, posted in order: what the variant prepares for the
 * seed (where it prepares anything), the pass hash, the chunks the first
 * spawn reads, then `done`; either of the first two left out where the
 * request says the page holds it. A terrain
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
    // The chunks the hike's first spawn reads, for the grid the page is about to make (`installChunks`):
    // sent whatever the page holds, since every hike makes its grid anew. None on a terrain with no trailhead.
    const chunks = spawnChunkCells(seed, PLAYER_HALF).map(({ cx, cz }) => generateChunk(seed, cx, cz));
    if (chunks.length > 0) post({ id, kind: "chunks", seed, variant, chunks });
    post({ id, kind: "done" });
  } catch (error) {
    post({ id, kind: "failed", message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * The scene request's results: the scene, posted with every one of its typed
 * arrays' buffers in the transfer list, then `done`. An unknown terrain, a
 * sampling that throws or a scene that cannot be posted is one `failed`, and
 * nothing after it.
 */
export function prepareSceneReply(
  request: WorldSceneRequest, post: (reply: WorldPrepReply, transfer: ArrayBuffer[]) => void,
): void {
  const { id } = request;
  try {
    const scene = prepareScene(request.seed, request.variant, request.tier);
    post({ id, kind: "scene", scene }, sceneTransfer(scene));
    post({ id, kind: "done" }, []);
  } catch (error) {
    post({ id, kind: "failed", message: error instanceof Error ? error.message : String(error) }, []);
  }
}

// Only inside a worker: under Node, where a test imports `prepareWorld`, and
// on a page, there is no WorkerGlobalScope.
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === "function") {
  // This thread's field kernel (`sim/fieldKernel.ts`), made as the worker starts: every sample of the ground the
  // requests below take goes through it.
  fieldKernelReady();
  self.onmessage = (event: MessageEvent<WorldPrepRequest | WorldSceneRequest>): void => {
    const request = event.data;
    if ("kind" in request) prepareSceneReply(request, (reply, transfer) => self.postMessage(reply, { transfer }));
    else prepareWorld(request, (reply) => self.postMessage(reply));
  };
}
