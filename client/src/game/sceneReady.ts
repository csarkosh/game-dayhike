/**
 * When a scene of Babylon.js is ready to be looked at: what the renderer on
 * Babylon.js answers `Renderer.whenReady` with, and what the scene route on
 * it waits on. The scene's own check makes every effect a material lacks in
 * one call, so it is walked first, a few milliseconds a task, and asked
 * after; the wait is bounded by whoever put a cover up.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { effectsWaitingOn } from "./effectTurns.js";

/** How long a task of the readiness walk works before it gives the thread back (ms). */
export const READY_WALK_SLICE_MS = 8;

/** What the readiness walk runs on: the clock, how it gives the thread back and a task's length (for the
 * tests), and `stopped`, which ends the walk at the next mesh once it says so. */
export type ReadyWalkDeps = { now?: () => number; turn?: () => Promise<void>; sliceMs?: number; stopped?: () => boolean };

/**
 * Checks each of the scene's meshes as `scene.isReady()` would
 * (`mesh.isReady(true)`, under the active camera's render pass), which makes
 * the effect of a material that has none, and gives the thread back (`turn`)
 * whenever `sliceMs` have passed in a task. `scene.isReady()` makes every
 * such effect in its one call, and on a phone the effects of the materials
 * no frame had drawn yet were a stop of a quarter of a second; a check that
 * makes an effect is far longer than a slice, so here each is a task of its
 * own, and the scene's own check then finds them made. (On WebGPU a PBR
 * effect is only asked for here and made in a task of the engine's queue,
 * `effectTurns.ts`, so a slice asks for many.) The meshes are the
 * scene's as the walk begins; one disposed meanwhile is left out, a check
 * that throws is left to the scene's own to report, and a scene disposed
 * meanwhile, or a wait that has lifted (`deps.stopped`), ends the walk.
 */
export async function walkSceneReady(scene: Scene, deps: ReadyWalkDeps = {}): Promise<void> {
  const now = deps.now ?? ((): number => performance.now());
  const turn = deps.turn ?? ((): Promise<void> => new Promise((given) => setTimeout(given, 0)));
  const sliceMs = deps.sliceMs ?? READY_WALK_SLICE_MS;
  let since = now();
  for (const mesh of [...scene.meshes]) {
    if (scene.isDisposed || deps.stopped?.() === true) return;
    if (mesh.isDisposed() || mesh.subMeshes === undefined || mesh.subMeshes === null || mesh.subMeshes.length === 0) continue;
    const engine = scene.getEngine();
    const pass = engine.currentRenderPassId;
    engine.currentRenderPassId = scene.activeCamera?.renderPassId ?? pass;
    try {
      mesh.isReady(true);
    } catch {
      // Not ready, as far as this walk can say: the scene's own check decides.
    } finally {
      engine.currentRenderPassId = pass;
    }
    if (now() - since >= sliceMs) {
      await turn();
      since = now();
    }
  }
}

/**
 * Resolves once `scene` is ready with nothing waiting to load and `layers` has
 * settled, or after `maxMs` (a model that never arrives must not hold the
 * screen), or at the next poll once the scene is disposed. `maxMs` has no
 * default: it is the bound of whoever put the cover up
 * (`APPLY_SWAP_READY_MAX_MS`, `GOVERNOR_SWAP_READY_MAX_MS`). A renderer torn
 * down while its scene's BRDF texture is still expanding keeps that scene
 * undisposed until `releaseEngine` lets it go, so for that time this goes on
 * polling it, and `isReady()` runs against the torn-down scene, which is
 * harmless. `layers` is what fills in on its
 * own time outside the scene's own count (the forest's billboard bakes,
 * `Renderer.forestReady`); a layer that fails counts as settled. Polled every
 * 100 ms rather than through `executeWhenReady`, which calls straight back on
 * a ready scene and would spin while items are still waiting. Each poll walks
 * the scene's meshes first, a few milliseconds a task (`walkSceneReady`), so
 * the scene's own check, asked after it, makes no effect of its own; the cap
 * lifts though a walk is between two tasks, and that walk then stops. The
 * scene is not ready while any of its engine's effects still waits its turn
 * (`effectsWaitingOn`): the scene's own check cannot see one that waits
 * behind the effect its material already had.
 */
export function whenSceneReady(
  scene: Scene,
  maxMs: number,
  layers: Promise<unknown> = Promise.resolve(),
  deps: ReadyWalkDeps = {},
): Promise<void> {
  return new Promise((resolve) => {
    let layersIn = false;
    void layers.then(
      () => { layersIn = true; },
      () => { layersIn = true; },
    );
    let poll: ReturnType<typeof setTimeout> | undefined;
    let lifted = false;
    const cap = setTimeout(finish, maxMs);
    function finish(): void {
      lifted = true;
      clearTimeout(cap);
      clearTimeout(poll);
      resolve();
    }
    const check = async (): Promise<void> => {
      // The layers as this poll found them: the scene is asked only when it was walked first.
      const walked = layersIn && !scene.isDisposed;
      // A walk still between two tasks when the cap lifts the wait goes no further: no effect is made under play.
      if (walked) await walkSceneReady(scene, { ...deps, stopped: () => lifted });
      if (lifted) return;
      // The engine's effects still waiting their turn (`effectTurns.ts`) are not in the scene's own
      // count: a material draws with the effect it had, and says ready, until its new one is.
      const queued = effectsWaitingOn((scene as { getEngine?: () => unknown }).getEngine?.());
      if (scene.isDisposed || (walked && scene.isReady() && scene.getWaitingItemsCount() === 0 && queued === 0)) finish();
      else poll = setTimeout(() => void check(), 100);
    };
    void check();
  });
}
