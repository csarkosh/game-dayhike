/**
 * Changing the tier of a hike in progress: the renderer is disposed and built
 * again at the new tier on a fresh canvas, while the session, its
 * connections, the input and the HUD carry on (design §9).
 *
 * **The old renderer goes first.** Each renderer makes a GPU device of its
 * own and holds its scene on it; the old one is disposed before the new one
 * is built, so the page never holds two scenes at once. Falling back
 * therefore means rebuilding the running tier, not keeping the old object.
 *
 * **Always a fresh canvas.** A canvas leaves with the renderer whose device
 * its context was configured for, and a rung that failed may leave one whose
 * context is lost: every rung takes a canvas of its own.
 *
 * **A failure never leaves a renderer behind.** Each rung that fails is taken
 * down whole before the next is tried, and the ladder ends at low, the tier
 * least likely to fail; only then does the throw go up.
 *
 * **The renderer makes its own engine** from the canvas it is built on and
 * lets it go with itself. A ladder is handed tiers and no engine, and nothing
 * here decides, remembers or disposes one.
 *
 * **Only a standing engine is listened to.** The old engine's watcher is
 * taken off before anything of it is disposed (`unwatch`), so a disposed
 * engine is never heard as a failing one, and the new renderer's own watch
 * (`Renderer.ownWatch`) is put on only once its rung stands (`watch`): a
 * rung that failed is never watched.
 */
import type { WatchEngine } from "@csarkosh/engine/game/engineWatch";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import type { Renderer } from "./rendererTypes.js";
import type { TierChoice } from "@csarkosh/engine/game/tierChoice";

/**
 * How long the Settings Apply's "Applying…" ground waits for the new scene
 * before lifting anyway, counted from the end of the renderer's build. It
 * covers a player on the pause screen who asked for the switch. Sized for the
 * slowest build measured: in Chrome on an Apple M4 at 6× CPU throttling the
 * build took about 4.2 s and the forest was whole 3.2–6.1 s past a 10 s bound
 * (16.1 s after the build at most), so that bound lifted the cover on bare
 * hillside in 12 switches of 12. 20 s covers the slowest with margin. It
 * stays a bound: a model or a layer that never settles holds the cover this
 * long and no longer, and on a machine slower still the cover lifts here and
 * the forest fills in after.
 */
export const APPLY_SWAP_READY_MAX_MS = 20_000;

/**
 * How long the governor's screen over its switch waits for the new scene,
 * counted the same way. Shorter than the Apply's because of whom it covers: a
 * player in the middle of play who did not ask, without sight or controls, in
 * a world that goes on around them (a party, a hunt). There a forest that
 * fills in after the lift costs less than ten more seconds of that. On a slow
 * machine the cover lifts here and the forest may fill in after.
 */
export const GOVERNOR_SWAP_READY_MAX_MS = 10_000;

/** A renderer and the canvas it draws on. `R` is the renderer as the caller
 * holds it: the hike's, or the game's own with its scene, which a swap hands
 * back as it was built. */
export type Swappable<R extends Renderer = Renderer> = { renderer: R; canvas: HTMLCanvasElement };

/** A canvas a hike's renderer is built on, as the page hands one over. It
 * carries no engine: the renderer makes its own from it. A canvas is made at
 * once, so it takes nothing of the bound a switch's cover waits under: the
 * new scene's wait (`Renderer.whenReady`) is given the bound whole. */
export type EngineOnCanvas = { canvas: HTMLCanvasElement };

/** A ladder's rungs: `first`, then each tier of `later`, none twice. */
function ladderOf(first: QualityTier, later: readonly QualityTier[]): QualityTier[] {
  return [...new Set<QualityTier>([first, ...later])];
}

/** What the game gives a swap: how to build, where, and what to put back. */
export type SwapBindings<R extends Renderer = Renderer> = {
  /** A renderer at `tier` on `canvas`, which makes its own engine from it. */
  build(canvas: HTMLCanvasElement, tier: QualityTier): R;
  /** A canvas not yet in the page. */
  freshCanvas(): HTMLCanvasElement;
  /** What the game builds into the scene outside the renderer (the signs, the
   * body at the crest): disposed with the old scene, built again in the new. */
  extras: { dispose(): void; build(renderer: R): void };
  /** Moves the canvas's listeners (input, touch) to the new canvas. */
  rebind(canvas: HTMLCanvasElement): void;
  /** Puts the view back: the hour, the weather, the console's toggles, the
   * free camera. */
  restore(renderer: R): void;
  /** The render loop, stopped on the old engine and run on the new once its
   * sky is held. */
  loop(): void;
  /** Stops listening to the running engine, before anything of it goes. */
  unwatch(): void;
  /** Starts listening to a renderer's engine with the renderer's own watch
   * (`Renderer.ownWatch`), once its rung stands. */
  watch(renderer: R, detector: WatchEngine): void;
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
 * scene extras while their scene lives; dispose the renderer (its engine goes
 * with it); then, on a fresh canvas in the old one's place, build at the
 * target tier, put the view back, rebuild the extras, rebind the listeners and
 * run the loop once the new renderer's sky is held (`Renderer.skyReady`), so
 * no frame of it is drawn under a sky it does not have yet.
 *
 * A rung that fails, in its build or in anything after it, is taken down
 * whole (the renderer it built, and with it its engine; a build that threw
 * has let go of its own) and the next rung is tried on another fresh canvas:
 * the target, then `fallbackTier` (the tier that was running), then low, the
 * tier least likely to fail. Only when every rung fails does the last throw
 * go up, with nothing of any of them left alive.
 */
export function swapRenderer<R extends Renderer>(
  current: Swappable<R>,
  target: { tier: QualityTier; fallbackTier: QualityTier },
  bindings: SwapBindings<R>,
): Swappable<R> & { tier: QualityTier; fellBack: boolean } {
  current.renderer.stopLoop(bindings.loop);
  bindings.unwatch();
  bindings.extras.dispose();
  current.renderer.dispose();
  let canvas = current.canvas;
  let failure: unknown = new Error("no tier to build");
  for (const tier of ladderOf(target.tier, [target.fallbackTier, "low"])) {
    canvas = replaceCanvas(canvas, bindings.freshCanvas());
    let renderer: R | null = null;
    /** Whether this rung stands: a throw after its loop is promised takes it down. */
    let stands = true;
    try {
      renderer = bindings.build(canvas, tier);
      bindings.restore(renderer);
      bindings.extras.build(renderer);
      bindings.rebind(canvas);
      // Its loop, and so its first frame, waits for its sky (`Renderer.skyReady`),
      // which never comes for a renderer disposed first; a sky already held
      // starts it a turn later, so a rung taken down in this turn starts none.
      const standing = renderer;
      void standing.skyReady().then(() => {
        if (stands && !standing.engine.isDisposed) standing.runLoop(bindings.loop);
      });
      if (renderer.ownWatch != null) bindings.watch(renderer, renderer.ownWatch);
      return { renderer, canvas, tier, fellBack: tier !== target.tier };
    } catch (error) {
      stands = false;
      failure = error;
      console.error(`quality: the ${tier} renderer could not be ${renderer === null ? "built" : "started"}.`, error);
      takeDown(renderer, bindings);
    }
  }
  throw failure;
}

/** Disposes what a failed rung left: what was built into its scene and the
 * renderer (its engine with it). A rung whose build threw left nothing: a
 * build that throws lets go of what it made. Each on its own, so one failing
 * keeps no other. */
function takeDown<R extends Renderer>(renderer: R | null, bindings: SwapBindings<R>): void {
  if (renderer === null) return;
  const steps = [() => bindings.extras.dispose(), () => renderer.dispose()];
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
 * fresh canvas in the failed one's place. A renderer whose build throws lets
 * go of what it made, so a failed rung leaves nothing; the last throw goes up
 * when every rung fails. The rung that stands is listened to through the
 * renderer's own watch (`watch`).
 */
export function buildFirstRenderer<R extends Renderer>(
  canvas: HTMLCanvasElement,
  tiers: readonly QualityTier[],
  bindings: Pick<SwapBindings<R>, "build" | "freshCanvas" | "watch">,
): Swappable<R> & { tier: QualityTier; fellBack: boolean } {
  const [asked = "low", ...later] = tiers;
  let current = canvas;
  let failure: unknown = new Error("no tier to build");
  for (const [rung, tier] of ladderOf(asked, later).entries()) {
    if (rung > 0) current = replaceCanvas(current, bindings.freshCanvas());
    try {
      const renderer = bindings.build(current, tier);
      if (renderer.ownWatch != null) bindings.watch(renderer, renderer.ownWatch);
      return { renderer, canvas: current, tier, fellBack: tier !== asked };
    } catch (error) {
      failure = error;
      console.error(`quality: the ${tier} renderer could not be built at the hike's start.`, error);
    }
  }
  throw failure;
}

/**
 * Resolves once the renderer standing, `standing()`, has its sky held
 * (`Renderer.skyReady`). A renderer a swap disposes never resolves its wait,
 * so each swap, told through `swapped()` (a promise that resolves at the next
 * swap), hands the wait to the renderer that replaced it: the hike's start,
 * which waits for its first renderer's sky, is not stranded by a swap made
 * meanwhile (a live rebuild after a WebGPU failure, say). Never resolves
 * while the renderer standing is one disposed without a swap: the hike has
 * ended.
 */
export async function whenStandingSkyHeld(standing: () => Renderer, swapped: () => Promise<void>): Promise<void> {
  for (;;) {
    const renderer = standing();
    const held = await Promise.race([renderer.skyReady().then(() => true), swapped().then(() => false)]);
    if (held && standing() === renderer) return;
  }
}

/**
 * Runs `build`, handing it `made`, through which it registers how to undo each
 * thing it makes. If `build` throws, everything registered is undone, newest
 * first, each undo in its own `try` so one that fails does not keep the rest,
 * and the throw goes up. A game that fails part-way through its start leaves
 * nothing behind: above all no engine, whose device the page would go on
 * holding beside the next renderer's.
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
