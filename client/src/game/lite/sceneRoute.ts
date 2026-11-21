/**
 * The scene route on Babylon Lite: a staged scene (the intro, or the title
 * loop's tour) on its fixed world (`scene/routeWorld.ts`), with no local
 * player, drawn by the hike's own renderer. `?t` seeks and `?step` holds a
 * frame; `window.dayhikeScene` lets a recorder seek and draw one frame at a
 * time. Everything built here is let go on leaving the route.
 *
 * The renderer is asked for what stands at the trailhead as the hike asks
 * it (`liteSceneryOf`): the posts and the board, the title's parked car,
 * and for the intro the scene's own car and its actor, which the stage
 * (`sceneStage.ts`) stands each frame. An ask made before the renderer
 * stands is answered when it does.
 *
 * **After a cut the world is drawn in before the frame that counts.** The
 * world streams in round a camera over frames, as jobs the renderer runs a
 * share of in each `sync` and hands to the GPU within each frame's budget,
 * and a job a crossing began hands over within a few frames of it; the
 * models a new place asks for land when they land. So a recorder's frame
 * after a cut draws the frames a cut is given (`cameraJump.ts`), then goes
 * on drawing while a model is still to land or the renderer's scenery says
 * the world streamed in the last frame, until a run of frames has streamed
 * nothing, and then draws the frame.
 *
 * **And no frame counts before the renderer's world is in.** The intro is
 * ready once its ranger and its car have loaded, which may be before the
 * renderer's own world stands (`Renderer.whenReady`: its models landed, its
 * first lists drawn, every far tree's bake settled). The far trees are the
 * last of it: every tree past the near radius is a billboard, the
 * billboards join the scene together once the last of their bakes has
 * settled, and until then they are neither a model to land nor a hand-over
 * of the streamed world. So a recorder's frame asked for before the world
 * is in is drawn in the same way, cut or no cut: frames, a turn of the page
 * after each, until the world is in and a run of them has streamed nothing.
 * A camera moved less far than a cut (`JUMP_M`) but further than a shell's
 * cell is built for at once by every shell, in the frame that moved it.
 */
import catalog from "../../../assets/catalog.json" with { type: "json" };
import type { WorldState } from "../../sim/types.js";
import { resolveCharacterAssets } from "../characterAssets.js";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import type { FreecamView, Renderer } from "../rendererTypes.js";
import { SETTLE_MAX_MS, WARM_FRAMES, cameraJumped } from "../scene/cameraJump.js";
import { createCaptionPanel } from "../scene/captions.js";
import { INTRO_RANGER } from "../scene/intro.js";
import { BLACK_STYLE, FILM_PATCH_DARKNESS, routeWorld, type DayhikeScene, type SceneName } from "../scene/routeWorld.js";
import { createSceneClock, type SceneClock } from "../scene/sceneClock.js";
import { createScenePlayer } from "../scene/scenePlayer.js";
import type { SkyTable } from "@csarkosh/engine/game/skyTable";
import { sunAltitudeDeg } from "@csarkosh/engine/game/skyWait";
import { startSkySource } from "@csarkosh/engine/game/skyWorker";
import { READY_MAX_MS } from "@csarkosh/engine/game/startReady";
import { SYNC_LATE_FRAMES_MAX } from "@csarkosh/engine/game/syncJobs";
import { createLiteRenderer } from "./renderer.js";
import { liteSceneryOf, type LiteActor, type LiteTrailhead } from "./sceneryMeshes.js";
import { stageLiteFrame, type LiteStageDeps } from "./sceneStage.js";

/** The run of frames with nothing streamed after which the world is in: a crossing's job streams from the frame that finds it, and a quiet run of `SYNC_LATE_FRAMES_MAX` frames and two more is a world no job waits on. */
export const SETTLE_FRAMES = SYNC_LATE_FRAMES_MAX + 2;
/** Frames drawn at a stretch while the world streams in, before the page is given a turn: a model lands, a worker answers, only between two of the page's tasks. */
export const SETTLE_STRETCH = 8;

export type LiteSceneRun = { dispose(): void; worldState(): WorldState; hasWildlife: boolean };
/** What the page gives the route: where it draws and at which tier. The renderer makes its own engine from the canvas. */
export type LiteScenePage = { canvas: HTMLCanvasElement; container: HTMLElement; tier: QualityTier };
export type LiteSceneRouteDeps = LiteScenePage & {
  now?: () => number;
  raf?: (fn: (ms: number) => void) => number;
  /** The renderer; a test hands in its own. */
  renderer?: (canvas: HTMLCanvasElement, world: ReturnType<typeof routeWorld>, options: { tier: QualityTier; clock: () => number; wildlife: false; skyTable: SkyTable }) => Renderer;
  /** The sky's slices. Absent, the route makes its own, from its hour outward, and stops them on leaving. */
  skyTable?: SkyTable;
};

/** The route as the page runs it, left by `dispose`. */
export function runLiteSceneRoute(page: LiteScenePage, search: { t: number | null; step: number | null }, name: SceneName = "intro"): { dispose(): void } {
  return startLiteSceneRoute(page, search, name);
}

export function startLiteSceneRoute(deps: LiteSceneRouteDeps, search: { t: number | null; step: number | null }, name: SceneName = "intro"): LiteSceneRun {
  const now = deps.now ?? (() => performance.now());
  const raf = deps.raf ?? ((fn) => requestAnimationFrame(fn));
  // The fixed world, the scene and what stands at its trailhead: the route's own with no engine.
  const route = routeWorld(name);
  const { title, world, hour, weather, scene, groundH } = route;
  const clock: SceneClock = createSceneClock(now);
  const ownSky = deps.skyTable === undefined ? startSkySource(sunAltitudeDeg(hour)) : null;
  const skyTable = deps.skyTable ?? (ownSky as NonNullable<typeof ownSky>).table;
  const options = { tier: deps.tier, clock: () => clock.time() * 1000, wildlife: false as const, skyTable };
  const renderer = deps.renderer?.(deps.canvas, route, options) ?? createLiteRenderer(deps.canvas, route.level, route.forest, options);
  renderer.setWeather(weather, 0);
  renderer.setHour(hour);

  // The trailhead as the hike draws it: the board with its poster and the fingerposts. The title's tour has the
  // hike's parked car too; in the intro the scene's car moves and the hike's is not there.
  const host = liteSceneryOf(renderer);
  const posts = host?.signs(route.posts, groundH) ?? null;
  const trailhead: LiteTrailhead | null = host?.trailhead(route.trailheadSites, groundH, route.board) ?? null;
  const loads = new AbortController();
  let disposed = false;
  // The film's ranger and car are the intro's alone: the title's tour has no one in it.
  const rangerUrl = title ? undefined : resolveCharacterAssets(catalog).find((asset) => asset.id === INTRO_RANGER)?.url;
  const ranger: LiteActor | null = rangerUrl === undefined ? null : (host?.actor(rangerUrl) ?? null);
  const carLoaded = title || trailhead === null ? Promise.resolve() : trailhead.filmCar(loads.signal, { darkness: FILM_PATCH_DARKNESS });
  /** Whether the renderer's world is in (its models landed, its first lists drawn, every far tree's bake settled), or its bound has passed. */
  let worldStands = false;
  const stands = renderer.whenReady(READY_MAX_MS).then(() => {
    worldStands = true;
  });
  const loaded = title ? stands : Promise.all([ranger?.settled, carLoaded]).then(() => undefined);
  const ready = Promise.all([renderer.skyReady(), loaded]).then(() => undefined);
  /** Whether the scene's actor stands in the scene, or never will: the scene is built again as it joins, and no frame is drawn of it meanwhile. */
  let cast = ranger === null;
  void ranger?.settled.then(() => {
    cast = true;
  });

  const black = document.createElement("div");
  black.className = "scene-black";
  black.setAttribute("style", BLACK_STYLE);
  black.style.opacity = "1";
  deps.container.append(black);
  const captions = createCaptionPanel(deps.container);
  /** The camera the stage last set, and the one the last drawn frame was drawn from. */
  let lastView: FreecamView | null = null;
  let drawnView: FreecamView | null = null;
  const stage: LiteStageDeps = {
    setFreecam: (view) => {
      lastView = view;
      renderer.setFreecam(view);
    },
    setDepthOfField: (on) => renderer.setDepthOfField(on),
    actor: (id) => (id === INTRO_RANGER ? ranger : null),
    car: () => trailhead?.car() ?? null,
    hand: () => ranger,
    captions,
    black: (amount) => {
      black.style.opacity = String(amount);
    },
    warn: (line) => console.warn(line),
  };
  const player = createScenePlayer(scene, clock, { frame: (frame) => stageLiteFrame(frame, stage), dispose: () => captions.dispose() });
  if (search.step !== null) player.step(search.step);
  else if (search.t !== null) player.seek(search.t);

  // The loop runs on a held frame too (a held clock makes every tick the
  // same frame), so a page opened at a step shows it; a recorder's `frame()`
  // stops the loop and draws each frame itself.
  let looping = true;
  const drawOneFrame = (): void => {
    player.tick();
    renderer.sync(world.state, -1, 0);
    if (cast) renderer.drawFrame();
    drawnView = lastView;
  };
  const loop = (): void => {
    if (disposed || !looping) return;
    drawOneFrame();
    raf(loop);
  };
  // No frame before the sky's first slices are in and the renderer stands: until then it draws nothing.
  void renderer.skyReady().then(() => {
    if (!disposed) raf(loop);
  });
  const nextFrame = (): Promise<void> => new Promise<void>((resolve) => raf(() => resolve()));
  /**
   * Draws the world in round the camera: frames drawn until `SETTLE_FRAMES`
   * running have streamed nothing with the renderer's world in and no model
   * still to land, or `maxMs` once the world is in (the wait for the world
   * has the renderer's own bound).
   */
  const worldIn = async (maxMs: number): Promise<void> => {
    let by = now() + maxMs;
    let quiet = 0;
    let stretch = 0;
    while (!disposed && now() < by) {
      drawOneFrame();
      // The settling's bound begins once the world is in.
      if (!worldStands) by = now() + maxMs;
      // What lands (a model, a bake) lands between two of the page's tasks: a turn after each frame meanwhile.
      const landing = !worldStands || renderer.waitingItems() > 0;
      quiet = landing || host?.streaming() === true ? 0 : quiet + 1;
      if (quiet >= SETTLE_FRAMES) return;
      stretch += 1;
      if (stretch >= SETTLE_STRETCH || landing) {
        stretch = 0;
        await nextFrame();
      }
    }
  };

  const onVisibility = (): void => player.hidden(document.visibilityState === "hidden");
  document.addEventListener("visibilitychange", onVisibility);
  const onResize = (): void => renderer.resize();
  window.addEventListener("resize", onResize);

  const api: DayhikeScene = {
    seek: (t) => {
      player.seek(t);
      clock.hold();
    },
    // Drawn now, and resolved on the animation frame after, when the
    // picture has been presented and a screenshot reads it. After a cut, and
    // while the renderer's world is not in yet, the world is drawn in first.
    frame: async () => {
      looping = false;
      const before = drawnView;
      drawOneFrame();
      const cut = lastView !== null && cameraJumped(before, lastView);
      if (cut) for (let i = 0; i < WARM_FRAMES; i += 1) drawOneFrame();
      if (cut || !worldStands) {
        await worldIn(SETTLE_MAX_MS);
        drawOneFrame();
      }
      await nextFrame();
    },
    time: () => player.time(),
    ready,
    engine: () => "webgpu",
  };
  (globalThis as { dayhikeScene?: DayhikeScene }).dayhikeScene = api;

  return {
    worldState: () => world.state,
    hasWildlife: renderer.hasWildlife,
    dispose() {
      if (disposed) return;
      disposed = true;
      loads.abort();
      delete (globalThis as { dayhikeScene?: DayhikeScene }).dayhikeScene;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      player.dispose();
      black.remove();
      posts?.dispose();
      ranger?.dispose();
      trailhead?.dispose();
      renderer.dispose();
      ownSky?.dispose();
    },
  };
}
