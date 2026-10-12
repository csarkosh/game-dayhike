/**
 * The engine a hike leaves for the next one on the page, with its canvas.
 *
 * A hike's end used to dispose its engine, and with it the GPU context and
 * every shader compiled in it: the next hike, started from the same page,
 * compiled them all again. Now the renderer standing at the end retires
 * (`Renderer.retire`): its scene goes and its engine is kept here, one at a
 * time, and the next hike that asks for the same engine at the same tier
 * takes it up on its canvas. The tier is part of the match because a WebGPU
 * engine is made for one (its shipped translations are the tier's), and so
 * that a cached shader is only ever met again by the materials it was
 * compiled for.
 *
 * Babylon counts the materials using each compiled effect and releases the
 * effect, its program gone, when the count reaches nought, some of them a
 * frame after their material's dispose; a scene's dispose takes them all. So
 * as the renderer retires, before anything of its scene goes, each effect of
 * the engine that compiled cleanly is held once more here (`pinShaders`): it
 * outlives the scene in its engine's cache, where the next hike's materials
 * find it, and goes with the engine. Only those: an effect still compiling,
 * or one that failed, goes as it would have, and a running hike holds and
 * releases its effects exactly as before.
 *
 * A WebGPU engine is handed to the next hike as an engine; a WebGL2 one, which
 * the game otherwise never makes outside the renderer, is left on its canvas
 * for the renderer to take up (`adoptEngine`), so everything that reads "no
 * engine given" as WebGL2 reads it so still.
 */
import type { Effect } from "@babylonjs/core/Materials/effect.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { QualityTier } from "./quality.js";
import type { EngineOnCanvas, EngineWatchers } from "./rendererSwap.js";

/** An engine kept between hikes: its canvas, the WebGPU module's watchers
 * (null on WebGL2) and the tier it was last drawing. */
export type KeptEngine = { canvas: HTMLCanvasElement; engine: AbstractEngine; watchers: EngineWatchers | null; tier: QualityTier };

let kept: KeptEngine | null = null;
/** WebGL2 engines handed out on their canvas, for the renderer to take up. */
const onCanvas = new WeakMap<HTMLCanvasElement, AbstractEngine>();

/** The effects held here, per engine, each once however many hikes keep it. */
const pinned = new WeakMap<AbstractEngine, WeakSet<Effect>>();

/** What a pinned effect holds that was only for its compile. */
type CompileTime = { _processCodeAfterIncludes?: unknown; onCompiled?: unknown; onError?: unknown };

/**
 * Holds once more each effect of `engine` that is ready and compiled without
 * an error (above), so a scene's dispose leaves it in the engine's cache.
 * Babylon has no public count for this: the effect's own `_refCount`, which
 * `createEffect` raises on a cache hit and `Effect.dispose` lowers.
 *
 * A pinned effect must hold nothing of the hike that compiled it, or it
 * holds the whole hike: the material plugin manager hands every compile a
 * `processCodeAfterIncludes` whose closure is the manager, and the manager's
 * material has the scene — one pinned effect kept an entire retired world
 * alive. Those hooks are dropped — but only with `strip`, which the one
 * retire's sweep passes, never a mid-hike one. A ready effect's hooks are
 * not spent while its hike runs: a mesh's first draw with a vertex buffer
 * that is not of floats makes Babylon process the effect's source again
 * (`checkNonFloatVertexBuffers`), through `processCodeAfterIncludes`, and an
 * effect stripped of it before that draw came out of the reprocess with no
 * plugin code at all — bindings shifted, the pipeline refused, the hike
 * swapped to WebGL2. At the retire the scene is going and no more of its
 * draws come, so there the hooks are the compile's leavings and dropping
 * them frees the world.
 */
export function pinShaders(engine: AbstractEngine, strip = false): void {
  const held = pinned.get(engine) ?? new WeakSet<Effect>();
  pinned.set(engine, held);
  const cache = (engine as unknown as { _compiledEffects: Record<string, Effect & { _refCount: number }> })._compiledEffects;
  for (const effect of Object.values(cache)) {
    if (!effect.isReady() || effect.getCompilationError() !== "") continue;
    if (!held.has(effect)) {
      effect._refCount++;
      held.add(effect);
    }
    if (!strip) continue;
    const compile = effect as unknown as CompileTime;
    compile._processCodeAfterIncludes = undefined;
    compile.onCompiled = null;
    compile.onError = null;
  }
}

/** Keeps `next` for the next hike; one kept before it is released. */
export function keepEngine(next: KeptEngine, release: (engine: AbstractEngine) => void): void {
  const before = kept;
  kept = next;
  if (before !== null && before.engine !== next.engine) release(before.engine);
}

/**
 * The kept engine as the next hike's engine on its canvas, where it is the
 * engine asked for (`webgpu`) at `tier` and still standing; else null, the
 * kept engine released, since a hike that will not use it needs its memory.
 */
export function takeEngine(webgpu: boolean, tier: QualityTier, release: (engine: AbstractEngine) => void): EngineOnCanvas | null {
  const was = kept;
  kept = null;
  if (was === null || was.engine.isDisposed) return null;
  if (was.engine.isWebGPU !== webgpu || was.tier !== tier) {
    release(was.engine);
    return null;
  }
  if (webgpu) return { canvas: was.canvas, engine: was.engine, watchers: was.watchers };
  onCanvas.set(was.canvas, was.engine);
  return { canvas: was.canvas, engine: null, watchers: null };
}

/** The WebGL2 engine handed out on `canvas` (`takeEngine`), once; null where
 * there is none or it has gone since. */
export function adoptEngine(canvas: HTMLCanvasElement): AbstractEngine | null {
  const engine = onCanvas.get(canvas) ?? null;
  onCanvas.delete(canvas);
  return engine !== null && !engine.isDisposed ? engine : null;
}

/** Releases the kept engine, if any. */
export function dropEngine(release: (engine: AbstractEngine) => void): void {
  const was = kept;
  kept = null;
  if (was !== null) release(was.engine);
}
