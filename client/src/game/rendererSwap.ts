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
 * on a fresh canvas that `bindings.freshCanvas` then hands out first. A rung
 * on a given engine that fails may be that engine's fault: its tier is built
 * again on WebGL2 before the ladder goes down a tier, and only once it stands
 * there is the fault the engine's (`engineFailed`, which the caller remembers
 * so the rule gives WebGL2 from then on); a tier that fails on WebGL2 too is
 * the tier's fault, and nothing is held against the engine. Every later rung
 * is WebGL2, the last one always. That is the rule's engine for each of them
 * but one: the rule gives WebGL2 to a tier below one it gave WebGL2, and to
 * every tier once a failure is remembered (`engineChoice.test.ts`). The one
 * exception is a switch down to low whose WebGL2 build fails: its ladder is
 * low, then the tier that was running, and that last rung, which the rule
 * may give WebGPU, is built on WebGL2, the engine least likely to fail and
 * one the swap need not wait for.
 *
 * **Only a standing engine is listened to.** The old engine's watcher is
 * taken off before anything of it is disposed (`unwatch`), so a disposed
 * engine is never heard as a failing one, and the new engine's is put on only
 * once its rung stands (`watch`): a rung that failed is never watched.
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AsyncPipelines } from "./asyncPipelines.js";
import type { QualityTier } from "./quality.js";
import type { Renderer } from "./renderer.js";
import type { TierChoice } from "./tierChoice.js";

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

export type Swappable = { renderer: Renderer; canvas: HTMLCanvasElement };

/** Listens to a WebGPU engine for the failures the game answers
 * (`watchWebGpu`, `gpuEngine.ts`); the function returned stops listening. */
export type WatchEngine = (engine: AbstractEngine, onFailure: (reason: "pipeline" | "lost") => void) => () => void;

/** The WebGPU module's watchers (`gpuEngine.ts`): its failures
 * (`watchWebGpu`); the frames that made a render pipeline, or left a draw out
 * while one was made (`watchPipelines`); the pipelines an engine makes
 * asynchronously, for the renderer built on it (`asyncPipelinesOf`, null where
 * it makes them as Babylon does); and the start's reveal, held until a frame
 * leaves nothing out (`revealWhenWhole`). */
export type EngineWatchers = {
  failures: WatchEngine;
  pipelines(engine: AbstractEngine, onCreated: () => void): () => void;
  asyncPipelines(engine: AbstractEngine): AsyncPipelines | null;
  reveal(engine: AbstractEngine, lift: () => void): () => void;
};

/** A renderer's canvas and the engine made for it: WebGPU with its module's
 * watchers, or WebGL2 (`engine` and `watchers` null), which the renderer
 * makes itself. */
export type EngineOnCanvas = { canvas: HTMLCanvasElement; engine: AbstractEngine | null; watchers: EngineWatchers | null };

/**
 * The least a switch's new scene waits under the cover for its models, ground
 * maps and bakes, whatever the engine's making took of the bound: without it a
 * late engine would lift the cover at once on a scene still loading.
 */
export const SWAP_SCENE_MIN_MS = 5_000;

/**
 * The engine a switch builds on, made within its cover's bound, and what is
 * left of the bound for the new scene's wait (`whenSceneReady`), never less
 * than `SWAP_SCENE_MIN_MS`, so the cover stays up no longer than the bound its
 * caller names, plus that floor where the engine ate into it, plus the build
 * itself. A
 * switch into WebGPU can otherwise wait up to 10 s for the engine, and 10 s
 * more for the translators, before the bound starts. `make` is told, through
 * `wanted`, whether its engine is still wanted. One not made within `boundMs`
 * is let go of when it arrives; the switch takes WebGL2 at its tier on a fresh
 * canvas (`late`), with nothing of it remembered against the engine, which was
 * slow rather than broken: `wanted` reads false from then on, so a failure the
 * late start meets records nothing, and the next switch or load tries it again.
 */
export async function engineWithinBound(
  make: (wanted: () => boolean) => Promise<EngineOnCanvas>,
  boundMs: number,
  deps: { now(): number; setTimer(fn: () => void, ms: number): () => void; webgl2(): EngineOnCanvas },
): Promise<{ onCanvas: EngineOnCanvas; leftMs: number; late: boolean }> {
  const from = deps.now();
  let wanted = true;
  const making = make(() => wanted);
  let clear: () => void = () => undefined;
  const late = new Promise<null>((resolve) => {
    clear = deps.setTimer(() => resolve(null), Math.max(0, boundMs));
  });
  const first = await Promise.race([making, late]).finally(() => clear());
  if (first === null) {
    wanted = false;
    void making.then(
      (made) => made.engine?.dispose(),
      () => undefined,
    );
    return { onCanvas: deps.webgl2(), leftMs: SWAP_SCENE_MIN_MS, late: true };
  }
  return { onCanvas: first, leftMs: Math.max(SWAP_SCENE_MIN_MS, boundMs - (deps.now() - from)), late: false };
}

/** One rung of a ladder: a tier, and the engine made for it (null: WebGL2). */
type Rung = { tier: QualityTier; engine: AbstractEngine | null; watch: WatchEngine | null };

/** `first`, then its tier again on WebGL2 when `first` has an engine of its
 * own, then each of `later` on WebGL2, none twice. */
function ladderOf(first: Rung, later: readonly QualityTier[]): Rung[] {
  const rungs = [first];
  const webgl2 = (tier: QualityTier): Rung => ({ tier, engine: null, watch: null });
  if (first.engine !== null) rungs.push(webgl2(first.tier));
  for (const tier of later) if (!rungs.some((r) => r.tier === tier && r.engine === null)) rungs.push(webgl2(tier));
  return rungs;
}

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
  /** Stops listening to the running engine, before anything of it goes. */
  unwatch(): void;
  /** Starts listening to a renderer's engine, given as its rung's, with that
   * engine's own detector, once the rung stands. */
  watch(renderer: Renderer, detector: WatchEngine): void;
  /** A rung on a given engine failed: the engine's fault, for the caller to
   * remember. `error` is the rung's throw. */
  engineFailed(error: unknown): void;
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
 * registration; a build that threw has released its own) and the next rung is tried
 * on another fresh canvas (a failed one may hold a lost or a WebGPU context):
 * the target, then `fallbackTier` (the tier that was running), then low, the
 * tier least likely to fail, the last two on WebGL2. Only when every rung
 * fails does the last throw go up, with nothing of any of them left alive.
 */
export function swapRenderer(
  current: Swappable,
  target: { tier: QualityTier; engine: AbstractEngine | null; watch?: WatchEngine | null; fallbackTier: QualityTier },
  bindings: SwapBindings,
): Swappable & { tier: QualityTier; fellBack: boolean; engineFellBack: boolean } {
  // The engine made for the target is the swap's until its rung's build takes
  // it (`createRenderer` releases it if that throws): a throw before then (the
  // old renderer's dispose, a fresh canvas) disposes it here, once.
  let unowned = target.engine;
  try {
    return climb(current, target, bindings, () => {
      unowned = null;
    });
  } catch (error) {
    try {
      unowned?.dispose();
    } catch {
      /* the throw that matters goes up */
    }
    throw error;
  }
}

/** `swapRenderer`'s steps; `taken` is called as the given engine's rung
 * hands it to the build. */
function climb(
  current: Swappable,
  target: { tier: QualityTier; engine: AbstractEngine | null; watch?: WatchEngine | null; fallbackTier: QualityTier },
  bindings: SwapBindings,
  taken: () => void,
): Swappable & { tier: QualityTier; fellBack: boolean; engineFellBack: boolean } {
  current.renderer.engine.stopRenderLoop(bindings.loop);
  bindings.unwatch();
  bindings.extras.dispose();
  current.renderer.dispose();
  const ladder = ladderOf({ tier: target.tier, engine: target.engine, watch: target.watch ?? null }, [target.fallbackTier, "low"]);
  let canvas = current.canvas;
  let failure: unknown = new Error("no tier to build");
  /** A given engine's rung's throw, held against the engine only once its
   * tier stands on WebGL2 (`engineFaultShown`). */
  let engineThrow: { tier: QualityTier; error: unknown } | null = null;
  for (const { tier, engine, watch } of ladder) {
    canvas = replaceCanvas(canvas, bindings.freshCanvas());
    let renderer: Renderer | null = null;
    try {
      if (engine !== null) taken();
      renderer = bindings.build(canvas, tier, engine);
      bindings.restore(renderer);
      bindings.extras.build(renderer);
      bindings.rebind(canvas);
      renderer.engine.runRenderLoop(bindings.loop);
      if (engine !== null && watch !== null) bindings.watch(renderer, watch);
      engineFaultShown(engineThrow, tier, bindings);
      return { renderer, canvas, tier, fellBack: tier !== target.tier, engineFellBack: target.engine !== null && engine === null };
    } catch (error) {
      failure = error;
      console.error(`quality: the ${tier} renderer could not be ${renderer === null ? "built" : "started"}.`, error);
      takeDown(renderer, bindings);
      if (engine !== null) engineThrow = { tier, error };
    }
  }
  throw failure;
}

/**
 * Holds a given engine's rung's throw against the engine (`engineFailed`),
 * once, when the rung that stands is its tier on WebGL2: only then is the
 * fault known to be the engine's. Where the tier fails on WebGL2 too, the
 * fault is the tier's, and nothing is held against the engine.
 */
function engineFaultShown(
  engineThrow: { tier: QualityTier; error: unknown } | null,
  standing: QualityTier,
  bindings: Pick<SwapBindings, "engineFailed">,
): void {
  if (engineThrow !== null && engineThrow.tier === standing) bindings.engineFailed(engineThrow.error);
}

/** Disposes what a failed rung left: what was built into its scene and the
 * renderer (its engine and registration with it). A rung whose build threw
 * left nothing: `createRenderer` has already released the engine it was
 * given (`releaseEngine`, which waits for the scene's BRDF lookup texture), so
 * it is not disposed again here, which would be at once and bring back the
 * throw that wait prevents. Each on its own, so one failing keeps no other. */
function takeDown(renderer: Renderer | null, bindings: SwapBindings): void {
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
 * fresh canvas in the failed one's place. A renderer whose build throws
 * disposes its own engine and registration (`createRenderer`), so a failed
 * rung leaves nothing; the last throw goes up when every rung fails.
 * `first` is the engine made for `canvas` for the first tier, with its
 * detector: where its rung fails, that tier is built again on WebGL2 before
 * the ladder goes down, as in a swap, and the fault is held against the engine
 * (`engineFailed`) only once the tier stands there; where it stands, it is
 * listened to (`watch`).
 */
export function buildFirstRenderer(
  canvas: HTMLCanvasElement,
  tiers: readonly QualityTier[],
  bindings: Pick<SwapBindings, "build" | "freshCanvas" | "watch" | "engineFailed">,
  first: { engine: AbstractEngine; watch: WatchEngine | null } | null = null,
): Swappable & { tier: QualityTier; fellBack: boolean; engineFellBack: boolean } {
  const [asked = "low", ...later] = tiers;
  const ladder = ladderOf({ tier: asked, engine: first?.engine ?? null, watch: first?.watch ?? null }, later);
  let current = canvas;
  let failure: unknown = new Error("no tier to build");
  let engineThrow: { tier: QualityTier; error: unknown } | null = null;
  for (const [rung, { tier, engine, watch }] of ladder.entries()) {
    if (rung > 0) current = replaceCanvas(current, bindings.freshCanvas());
    try {
      const renderer = bindings.build(current, tier, engine);
      if (engine !== null && watch !== null) bindings.watch(renderer, watch);
      engineFaultShown(engineThrow, tier, bindings);
      return { renderer, canvas: current, tier, fellBack: tier !== asked, engineFellBack: first !== null && engine === null };
    } catch (error) {
      failure = error;
      console.error(`quality: the ${tier} renderer could not be built at the hike's start.`, error);
      if (engine !== null) engineThrow = { tier, error };
    }
  }
  throw failure;
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
 * a ready scene and would spin while items are still waiting.
 */
export function whenSceneReady(
  scene: Scene,
  maxMs: number,
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
