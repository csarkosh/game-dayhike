/**
 * Changing the tier of a hike in progress: the renderer is disposed and built
 * again at the new tier on a fresh canvas, while the session, its
 * connections, the input and the HUD carry on (design §9).
 *
 * **The old renderer goes first.** The renderer is written for one live
 * instance per page: the atmosphere registers its material plugin globally by
 * name and keeps its record in module state, and the skin shading keeps
 * module switches, so building the new renderer beside the old one would have
 * the old one's dispose unregister the new one's plugin. Falling back
 * therefore means rebuilding the running tier, not keeping the old object.
 *
 * **Always a fresh canvas.** A canvas holds one kind of context for life, so
 * an engine change needs one anyway; taking it for every swap keeps one path,
 * and the old context, lost on dispose, takes every GPU object of the old
 * scene with it.
 *
 * **The engine is the caller's.** `target.engine` is an engine made for the new
 * tier before the swap starts (null: the renderer makes its own WebGL2 one).
 * Nothing here decides the engine: the WebGPU rule, where it applies, makes it
 * on a fresh canvas that `bindings.freshCanvas` then hands out first.
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { QualityTier } from "./quality.js";
import type { Renderer } from "./renderer.js";

/** How long the "Applying…" ground waits for the new scene before lifting anyway. */
export const SWAP_READY_MAX_MS = 10_000;

export type Swappable = { renderer: Renderer; canvas: HTMLCanvasElement };

/** What the game gives a swap: how to build, where, and what to put back. */
export type SwapBindings = {
  /** A renderer at `tier` on `canvas`, on `engine` when one is given. */
  build(canvas: HTMLCanvasElement, tier: QualityTier, engine: AbstractEngine | null): Renderer;
  /** A canvas not yet in the page. */
  freshCanvas(): HTMLCanvasElement;
  /** What the game builds into the scene outside the renderer (the signs, the
   * body at the crest): disposed with the old scene, built again in the new. */
  extras: { dispose(): void; build(renderer: Renderer): void };
  /** Moves the canvas's listeners (input, touch) to the new canvas. */
  rebind(canvas: HTMLCanvasElement): void;
  /** Puts the view back: the hour, the weather, the console's toggles, the
   * free camera. */
  restore(renderer: Renderer): void;
  /** The render loop, stopped on the old engine and run on the new. */
  loop(): void;
};

function replaceCanvas(old: HTMLCanvasElement, fresh: HTMLCanvasElement): HTMLCanvasElement {
  old.replaceWith(fresh);
  // The browser must never scroll, zoom or select on the game canvas.
  fresh.style.touchAction = "none";
  return fresh;
}

/**
 * The swap, synchronously, in design §9.3's order: stop the loop; dispose the
 * scene extras while their scene lives; dispose the renderer (its engine loses
 * its context); a fresh canvas in the old one's place; build at the target
 * tier; put the view back, rebuild the extras, rebind the listeners, run the
 * loop. A build that throws disposes the engine it was given and rebuilds
 * `fallbackTier` on WebGL2 on another fresh canvas (the first may hold a
 * WebGPU context); a second throw goes up.
 */
export function swapRenderer(
  current: Swappable,
  target: { tier: QualityTier; engine: AbstractEngine | null; fallbackTier: QualityTier },
  bindings: SwapBindings,
): Swappable & { tier: QualityTier; fellBack: boolean } {
  current.renderer.engine.stopRenderLoop(bindings.loop);
  bindings.extras.dispose();
  current.renderer.dispose();
  let canvas = replaceCanvas(current.canvas, bindings.freshCanvas());
  let renderer: Renderer;
  let tier = target.tier;
  let fellBack = false;
  try {
    renderer = bindings.build(canvas, target.tier, target.engine);
  } catch (error) {
    try {
      target.engine?.dispose();
    } catch {
      /* the engine is being dropped either way */
    }
    console.error(`quality: the ${target.tier} renderer could not be built; rebuilding ${target.fallbackTier}.`, error);
    canvas = replaceCanvas(canvas, bindings.freshCanvas());
    renderer = bindings.build(canvas, target.fallbackTier, null);
    tier = target.fallbackTier;
    fellBack = true;
  }
  bindings.restore(renderer);
  bindings.extras.build(renderer);
  bindings.rebind(canvas);
  renderer.engine.runRenderLoop(bindings.loop);
  return { renderer, canvas, tier, fellBack };
}

/**
 * Resolves once `scene` is ready with nothing waiting to load, or after
 * `maxMs` (a model that never arrives must not hold the screen), or at once for
 * a disposed scene. Polled every 100 ms rather than through
 * `executeWhenReady`, which calls straight back on a ready scene and would
 * spin while items are still waiting.
 */
export function whenSceneReady(scene: Scene, maxMs = SWAP_READY_MAX_MS): Promise<void> {
  return new Promise((resolve) => {
    let poll: ReturnType<typeof setTimeout> | undefined;
    const cap = setTimeout(finish, maxMs);
    function finish(): void {
      clearTimeout(cap);
      clearTimeout(poll);
      resolve();
    }
    const check = (): void => {
      if (scene.isDisposed || (scene.isReady() && scene.getWaitingItemsCount() === 0)) finish();
      else poll = setTimeout(check, 100);
    };
    check();
  });
}

/**
 * Runs `build`, handing it `made`, through which it registers how to undo each
 * thing it makes. If `build` throws, everything registered is undone, newest
 * first, each undo in its own `try` so one that fails does not keep the rest,
 * and the throw goes up. A game that fails part-way through its start leaves
 * nothing behind: above all no engine and no global plugin registration, which
 * the next renderer (the landing's backdrop, say) would meet.
 */
export function buildOrUndo<T>(build: (made: (undo: () => void) => void) => T): T {
  const undo: (() => void)[] = [];
  try {
    return build((step) => undo.push(step));
  } catch (error) {
    for (const step of undo.reverse()) {
      try {
        step();
      } catch {
        /* keep undoing the rest */
      }
    }
    throw error;
  }
}
