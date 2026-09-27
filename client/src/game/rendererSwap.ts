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
 * **A failure never leaves a renderer behind.** Each rung that fails is taken
 * down whole before the next is tried, and the ladder ends at low, the tier
 * least likely to fail; only then does the throw go up.
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
import type { TierChoice } from "./tierChoice.js";

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

const TIER_NAMES: Record<QualityTier, string> = { high: "High", medium: "Medium", low: "Low" };

/**
 * The swap, synchronously, in design §9.3's order: stop the loop; dispose the
 * scene extras while their scene lives; dispose the renderer (its engine loses
 * its context); then, on a fresh canvas in the old one's place, build at the
 * target tier, put the view back, rebuild the extras, rebind the listeners and
 * run the loop.
 *
 * A rung that fails, in its build or in anything after it, is taken down
 * whole (the renderer it built, and with it the engine and the atmosphere's
 * registration, or else the engine it was given) and the next rung is tried
 * on another fresh canvas (a failed one may hold a lost or a WebGPU context):
 * the target, then `fallbackTier` (the tier that was running), then low, the
 * tier least likely to fail, the last two on WebGL2. Only when every rung
 * fails does the last throw go up, with nothing of any of them left alive.
 */
export function swapRenderer(
  current: Swappable,
  target: { tier: QualityTier; engine: AbstractEngine | null; fallbackTier: QualityTier },
  bindings: SwapBindings,
): Swappable & { tier: QualityTier; fellBack: boolean } {
  current.renderer.engine.stopRenderLoop(bindings.loop);
  bindings.extras.dispose();
  current.renderer.dispose();
  const ladder = [...new Set<QualityTier>([target.tier, target.fallbackTier, "low"])];
  let canvas = current.canvas;
  let failure: unknown = new Error("no tier to build");
  for (const [rung, tier] of ladder.entries()) {
    const engine = rung === 0 ? target.engine : null;
    canvas = replaceCanvas(canvas, bindings.freshCanvas());
    let renderer: Renderer | null = null;
    try {
      renderer = bindings.build(canvas, tier, engine);
      bindings.restore(renderer);
      bindings.extras.build(renderer);
      bindings.rebind(canvas);
      renderer.engine.runRenderLoop(bindings.loop);
      return { renderer, canvas, tier, fellBack: rung > 0 };
    } catch (error) {
      failure = error;
      console.error(`quality: the ${tier} renderer could not be ${renderer === null ? "built" : "started"}.`, error);
      takeDown(renderer, engine, bindings);
    }
  }
  throw failure;
}

/** Disposes what a failed rung left: what was built into its scene and the
 * renderer (its engine and registration with it), or the engine it was given
 * when no renderer was built. Each on its own, so one failing keeps no other. */
function takeDown(renderer: Renderer | null, engine: AbstractEngine | null, bindings: SwapBindings): void {
  const steps =
    renderer === null ? [() => engine?.dispose()] : [() => bindings.extras.dispose(), () => renderer.dispose()];
  for (const step of steps) {
    try {
      step();
    } catch {
      /* the rest is still taken down */
    }
  }
}

/**
 * What a live switch leaves: the choice is kept only when the switch reached
 * the tier asked for. After a fallback the choice stays as it was (the running
 * tier came from it), rather than the running tier being written as a choice
 * of its own, which would turn an Auto player into a fixed-tier one the probe
 * and the governor never act for.
 */
export function switchOutcome(
  chosen: TierChoice,
  got: { tier: QualityTier; fellBack: boolean },
): { save: TierChoice | null; line: string | null } {
  return got.fellBack
    ? { save: null, line: `Could not switch; still using ${TIER_NAMES[got.tier]}.` }
    : { save: chosen, line: null };
}

/**
 * The hike's first renderer: the tier asked for on the page's canvas, and on a
 * throw each later tier in `tiers` (the class's start tier, then low) on a
 * fresh canvas in the failed one's place. A renderer whose build throws
 * disposes its own engine and registration (`createRenderer`), so a failed
 * rung leaves nothing; the last throw goes up when every rung fails.
 * `engine`, made for `canvas`, is the first rung's; the later ones are WebGL2.
 */
export function buildFirstRenderer(
  canvas: HTMLCanvasElement,
  tiers: readonly QualityTier[],
  bindings: Pick<SwapBindings, "build" | "freshCanvas">,
  engine: AbstractEngine | null = null,
): Swappable & { tier: QualityTier; fellBack: boolean } {
  let current = canvas;
  let failure: unknown = new Error("no tier to build");
  for (const [rung, tier] of tiers.entries()) {
    if (rung > 0) current = replaceCanvas(current, bindings.freshCanvas());
    try {
      return { renderer: bindings.build(current, tier, rung === 0 ? engine : null), canvas: current, tier, fellBack: rung > 0 };
    } catch (error) {
      failure = error;
      console.error(`quality: the ${tier} renderer could not be built at the hike's start.`, error);
    }
  }
  throw failure;
}

/**
 * Resolves once `scene` is ready with nothing waiting to load and `layers` has
 * settled, or after `maxMs` (a model that never arrives must not hold the
 * screen), or at the next poll once the scene is disposed. A renderer torn
 * down while its scene's BRDF texture is still expanding keeps that scene
 * undisposed until `releaseEngine` lets it go, so for that time this goes on
 * polling it, and `isReady()` runs against the torn-down scene, which is
 * harmless. `layers` is what fills in on its
 * own time outside the scene's own count (the forest's billboard bakes,
 * `Renderer.forestReady`); a layer that fails counts as settled. Polled every
 * 100 ms rather than through `executeWhenReady`, which calls straight back on
 * a ready scene and would spin while items are still waiting.
 */
export function whenSceneReady(
  scene: Scene,
  maxMs = SWAP_READY_MAX_MS,
  layers: Promise<unknown> = Promise.resolve(),
): Promise<void> {
  return new Promise((resolve) => {
    let layersIn = false;
    void layers.then(
      () => { layersIn = true; },
      () => { layersIn = true; },
    );
    let poll: ReturnType<typeof setTimeout> | undefined;
    const cap = setTimeout(finish, maxMs);
    function finish(): void {
      clearTimeout(cap);
      clearTimeout(poll);
      resolve();
    }
    const check = (): void => {
      if (scene.isDisposed || (layersIn && scene.isReady() && scene.getWaitingItemsCount() === 0)) finish();
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
