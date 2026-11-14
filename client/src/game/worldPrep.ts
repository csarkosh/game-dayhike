/**
 * The page's side of a hike's world made off its thread: starts the module
 * worker (`world.worker.ts`) for the hike that is about to start, and takes
 * what it sends into the sim's own caches as it arrives: what the terrain
 * prepares for the seed (the bowl, with the trail), the pass hash, and the
 * chunks the first spawn reads, which wait for the hike's chunk grid
 * (`installChunks`). The world's build then finds them made, where it would
 * have stopped the page to make them.
 *
 * The hike always starts. Where there is no Worker, it cannot be made, it
 * fails, it sends what cannot be read or it has not finished in
 * `WORLD_PREP_TIMEOUT_MS`, `ready` resolves all the same and the build makes
 * for itself whatever was not installed, as it always did. What the page
 * already holds (a second hike on the page: the pass hash; the same hike
 * again: the bowl too) the worker is not asked for, and where it holds both
 * no worker is started.
 *
 * The worker that finished the world is kept, with the bowl it made, for one
 * more request: the hike's first scene at the tier the page decides on
 * (`scene`, `preparedScene.ts`), which the build then takes in place of
 * sampling the ground itself. It is ended when that request settles, when
 * the hike is left, or when it fails. The same rule holds there: no scene to
 * be had is a null, never a rejection, and the build samples as it always did.
 */
import { installChunks } from "../sim/chunkGrid.js";
import { fieldKernelReady } from "../sim/fieldKernel.js";
import { installPassHash, passHashCachedFor } from "../sim/forest.js";
import { terrainVariant } from "../sim/terrain.js";
import type { PreparedScene } from "./preparedScene.js";
import type { QualityTier } from "./quality.js";
import type { WorldPrepReply, WorldPrepRequest, WorldSceneRequest } from "./world.worker.js";

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
  /** How many of the spawn's chunks were installed for the hike's grid. */
  chunks: number;
  /** Milliseconds from the start to the end. */
  ms: number;
};

export type WorldPrep = {
  readonly ready: Promise<WorldPrepOutcome>;
  /**
   * The hike's first scene at `tier`, sampled by the worker once the world is
   * ready; null where there is none to be had. Asked once: a later call is
   * the first's promise, whatever its tier. Never rejects.
   */
  scene(tier: QualityTier): Promise<PreparedScene | null>;
  /** Ends the worker and lets go of the scene: the hike was left, or its build has taken what it wanted. */
  dispose(): void;
};

/** The console's line for an outcome, beside the start's own (`launchLine`):
 * how the worker ended, in how long, and what the page took from it. */
export function worldPrepLine(outcome: WorldPrepOutcome): string {
  const took = [
    outcome.prepared ? "the trail" : null,
    outcome.passHash ? "the level check" : null,
    outcome.chunks > 0 ? `${outcome.chunks} chunk${outcome.chunks === 1 ? "" : "s"}` : null,
  ].filter((part) => part !== null);
  const list = took.length === 0 ? "nothing" : took.length === 1 ? took[0] : `${took.slice(0, -1).join(", ")} and ${took.at(-1)}`;
  return `world prep: ${outcome.why} in ${Math.round(outcome.ms)} ms, ${list} installed`;
}

/** The console's line for the scene: whether the worker made one for `tier`, and how long the start waited for it. */
export function sceneLine(tier: QualityTier, scene: PreparedScene | null, ms: number): string {
  return `world scene: ${scene === null ? "none" : "made"} for ${tier} in ${Math.round(ms)} ms`;
}

let lastId = 0;

/**
 * Starts the worker (new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" }))
 * with one request, for `input.seed` on the terrain `input.variant`. A reply
 * is taken only when it is this request's, for this seed and terrain; a pass
 * hash made over another count of passes than this thread's is refused
 * (`installPassHash`). `ready` never rejects, and nothing is installed after
 * it has resolved.
 *
 * `scene(tier)` then asks the same worker for the hike's first scene, with a
 * time limit of its own from the asking; where the page held the world
 * already (`cached`), it starts a worker for the scene alone. A scene is
 * taken only when it is that request's, for this seed, terrain and tier.
 * `dispose` ends the worker and settles whatever is waited for.
 */
export function startWorldPrep(
  input: { seed: number; variant: string },
  deps: { now?: () => number; timeoutMs?: number } = {},
): WorldPrep {
  const now = deps.now ?? ((): number => performance.now());
  const limit = deps.timeoutMs ?? WORLD_PREP_TIMEOUT_MS;
  // The page's own field kernel (`sim/fieldKernel.ts`), made as the hike's route is entered and not inside the
  // build's first sample of the ground. Where the page cannot have one the sim samples by its TypeScript.
  fieldKernelReady();
  const from = now();
  const id = ++lastId;
  const installed = { prepared: false, passHash: false, chunks: 0 };
  let worker: Worker | null = null;
  /** The limit on whichever request is out: the world's, then the scene's. */
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The world's request is over: `ready` has resolved. */
  let ended = false;
  let disposed = false;
  let resolve: (outcome: WorldPrepOutcome) => void = () => undefined;
  const ready = new Promise<WorldPrepOutcome>((r) => {
    resolve = r;
  });
  /** The scene's request: its promise once asked, and what settles it while it is out. */
  let asked: Promise<PreparedScene | null> | null = null;
  let wanted: { id: number; tier: QualityTier; settle(scene: PreparedScene | null): void } | null = null;

  /** Ends the worker, if there is one, and the limit that is running. */
  function stop(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (worker === null) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  }

  function end(why: WorldPrepOutcome["why"]): void {
    if (ended) return;
    ended = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    // A worker that finished is kept, with the world it made, for the scene.
    if (why !== "done") stop();
    resolve({ why, ...installed, ms: now() - from });
  }

  /** The worker is of no more use: whatever is waited for is settled without it. */
  function fail(): void {
    end("failed");
    wanted?.settle(null);
    stop();
  }

  function take(reply: WorldPrepReply): void {
    if (reply.id !== id) return;
    if (reply.kind === "prepared") {
      if (reply.seed !== input.seed || reply.variant !== input.variant) return;
      installed.prepared = terrainVariant(reply.variant)?.install?.(reply.seed, reply.prepared) === true;
    } else if (reply.kind === "passHash") {
      if (reply.variant !== input.variant) return;
      installed.passHash = installPassHash(reply.hash, { passCount: reply.passCount, variant: reply.variant });
    } else if (reply.kind === "chunks") {
      if (reply.seed !== input.seed || reply.variant !== input.variant) return;
      installed.chunks = installChunks(reply.seed, reply.variant, reply.chunks) ? reply.chunks.length : 0;
    } else if (reply.kind === "done") {
      end("done");
    } else if (reply.kind === "failed") {
      fail();
    }
  }

  function takeScene(reply: WorldPrepReply): void {
    if (wanted === null || reply.id !== wanted.id) return;
    if (reply.kind === "scene") {
      const { scene } = reply;
      if (scene.seed !== input.seed || scene.variant !== input.variant || scene.tier !== wanted.tier) return;
      wanted.settle(scene);
    } else if (reply.kind === "done" || reply.kind === "failed") {
      // Done with no scene taken: it sent none that was this request's.
      wanted.settle(null);
    }
  }

  /** A worker with this wrapper listening, or null where none can be had. */
  function listen(): Worker | null {
    if (typeof Worker === "undefined") return null;
    let made: Worker;
    try {
      made = new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return null;
    }
    made.onmessage = (event: MessageEvent<WorldPrepReply>): void => {
      try {
        if (ended) takeScene(event.data);
        else take(event.data);
      } catch {
        fail();
      }
    };
    made.onerror = fail;
    made.onmessageerror = fail;
    return made;
  }

  function scene(tier: QualityTier): Promise<PreparedScene | null> {
    asked ??= ready.then((outcome) => new Promise<PreparedScene | null>((done) => {
      if (disposed) return done(null);
      // The page held the world, so no worker was started: one for the scene alone.
      if (outcome.why === "cached") worker = listen();
      else if (outcome.why !== "done") return done(null);
      if (worker === null) return done(null);
      const mine = {
        id: ++lastId,
        tier,
        settle(made: PreparedScene | null): void {
          if (wanted !== mine) return;
          wanted = null;
          stop();
          done(made);
        },
      };
      wanted = mine;
      timer = setTimeout(() => mine.settle(null), limit);
      try {
        const request: WorldSceneRequest = { id: mine.id, kind: "scene", seed: input.seed, variant: input.variant, tier };
        worker.postMessage(request);
      } catch {
        mine.settle(null);
      }
    }));
    return asked;
  }

  const variant = terrainVariant(input.variant);
  const skip = {
    prepared: variant?.prepare === undefined || variant.isPrepared?.(input.seed) === true,
    passHash: passHashCachedFor(input.variant),
  };
  if (skip.prepared && skip.passHash) {
    end("cached");
  } else {
    worker = listen();
    if (worker === null) {
      end("no-worker");
    } else {
      timer = setTimeout(() => end("timeout"), limit);
      try {
        const request: WorldPrepRequest = { id, seed: input.seed, variant: input.variant, skip };
        worker.postMessage(request);
      } catch {
        end("failed");
      }
    }
  }
  return {
    ready,
    scene,
    dispose(): void {
      disposed = true;
      end("disposed");
      wanted?.settle(null);
      stop();
      asked = null;
    },
  };
}
