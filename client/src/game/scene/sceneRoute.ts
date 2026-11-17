/**
 * The scene route: a staged scene (the intro, or the title loop's tour) on
 * its fixed world, with no local player, the way the title page's backdrop
 * ran until the still replaced it. `?t` seeks and `?step` holds a frame; `window.dayhikeScene` lets a
 * recorder seek and draw one frame at a time. Everything built here is
 * disposed on leaving the route.
 */
import type { Scene as BabylonScene } from "@babylonjs/core/scene.js";
import type { WorldState } from "../../sim/types.js";
import type { EngineHandle } from "../engineHandle.js";
import { createCharacterPool, type CharacterPool } from "../characterModel.js";
import { loadContainer, loadUntilAborted } from "../modelLoad.js";
import { modelUrl } from "../assetUrls.js";
import { placeStaticModel, type PlacedModel } from "../staticModel.js";
import { createRenderer } from "../renderer.js";
import type { SkyTable } from "../skyTable.js";
import { startSkySource } from "../skyWorker.js";
import { sunAltitudeDeg } from "../skyWait.js";
import type { QualityTier } from "../quality.js";
import { createCarShadowPatch, createTrailheadMeshes, type CarShadowPatch } from "../trailheadMeshes.js";
import { createSignMeshes } from "../signMeshes.js";
import type { BoardPainter } from "../boardPaint.js";
import { terrainMaterialFor, type FreecamView } from "../renderer.js";
import { whenSceneReady } from "../sceneReady.js";
import { READY_MAX_MS } from "../startReady.js";
import { SETTLE_MAX_MS, WARM_FRAMES, cameraJumped } from "./cameraJump.js";
import { createCaptionPanel } from "./captions.js";
import { createCordTube } from "./cordTube.js";
import { INTRO_CAR, INTRO_RANGER } from "./intro.js";
import { BLACK_STYLE, FILM_PATCH_DARKNESS, routeWorld, type DayhikeScene, type SceneName } from "./routeWorld.js";
import { createSceneClock, type SceneClock } from "./sceneClock.js";
import { createScenePlayer } from "./scenePlayer.js";
import { carModelOf, dimCabParts, stageFrame, type CarModel, type StageDeps } from "./sceneStage.js";

// The route's world, its names and what a recorder drives it by are the route's own with no engine (`routeWorld.ts`); named from here too.
export { titleWater } from "./routeWorld.js";
export type { DayhikeScene, SceneName } from "./routeWorld.js";
export type SceneRun = { dispose(): void; worldState(): WorldState; scene(): BabylonScene; hasWildlife: boolean };
/** What the page gives the route: where it draws, at which tier, and the
 * engine made for its canvas (absent, the renderer makes WebGL2's). */
export type ScenePage = {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  tier: QualityTier;
  engine?: EngineHandle;
};
export type SceneRouteDeps = ScenePage & {
  now?: () => number;
  loadCar?: (scene: BabylonScene) => Promise<PlacedModel | null>;
  pool?: CharacterPool;
  raf?: (fn: (ms: number) => void) => number;
  /** The board's painter; a test with no canvas hands in its own. */
  paint?: BoardPainter;
  /** Resolves when the world is in around the camera, or at `maxMs`. By
   * default the scene's own readiness and the forest's layers; under Node's
   * null engine the scene never says it is ready, so a test hands in its own. */
  worldIn?: (maxMs: number) => Promise<void>;
  /** The sky's slices. Absent, the route makes its own, from its hour
   * outward (`startSkySource`), and stops them on leaving; a test hands in a
   * table of its own. */
  skyTable?: SkyTable;
};

async function loadFilmCar(scene: BabylonScene, signal: AbortSignal): Promise<PlacedModel | null> {
  try {
    const container = await loadUntilAborted(() => loadContainer(modelUrl(`models/${INTRO_CAR}.glb`), scene), signal);
    return placeStaticModel(container, INTRO_CAR, 0, 0, 0, 0);
  } catch (error) {
    if (!signal.aborted) console.warn(`scene: the car did not load (${error instanceof Error ? error.message : String(error)}); its boxes stand in`);
    return null;
  }
}

/**
 * The route as the page runs it: `startSceneRoute` on what the page has,
 * left by `dispose`. What a test or a recorder reads of the route (its
 * world, its scene) is `startSceneRoute`'s own.
 */
export function runSceneRoute(page: ScenePage, search: { t: number | null; step: number | null }, name: SceneName = "intro"): { dispose(): void } {
  return startSceneRoute(page, search, name);
}

export function startSceneRoute(deps: SceneRouteDeps, search: { t: number | null; step: number | null }, name: SceneName = "intro"): SceneRun {
  const now = deps.now ?? (() => performance.now());
  const raf = deps.raf ?? ((fn) => requestAnimationFrame(fn));
  // The fixed world, the scene and what stands at its trailhead: the route's own with no engine (`routeWorld.ts`).
  const { title, level, forest, world, hour, weather, scene, groundH, posts: signPosts, trailheadSites, board } = routeWorld(name);
  const clock: SceneClock = createSceneClock(now);
  // The sky's slices, from the route's hour outward: handed in, or made here
  // and stopped on leaving the route.
  const ownSky = deps.skyTable === undefined ? startSkySource(sunAltitudeDeg(hour)) : null;
  const renderer = createRenderer(deps.canvas, level, forest, {
    tier: deps.tier, engine: deps.engine, clock: () => clock.time() * 1000, wildlife: false, skyTable: deps.skyTable ?? ownSky?.table,
  });
  renderer.setWeather(weather, 0);
  renderer.setHour(hour);
  const worldIn = deps.worldIn ?? ((maxMs: number) => whenSceneReady(renderer.scene, maxMs, renderer.forestReady));

  // The trailhead as the hike draws it: the board with its poster and the
  // fingerposts. The title's tour has the hike's parked car too; in the
  // intro the scene's car moves and the hike's is not there.
  const posts = createSignMeshes(renderer.scene, signPosts, groundH, {
    materialFor: (name) => terrainMaterialFor(renderer.scene, name),
    shadows: renderer.shadows,
    cover: renderer.cover,
  });
  const trailhead = createTrailheadMeshes(renderer.scene, trailheadSites, groundH, {
    materialFor: (name) => terrainMaterialFor(renderer.scene, name),
    board,
    shadows: renderer.shadows,
    cover: renderer.cover,
    ...(deps.paint === undefined ? {} : { paint: deps.paint }),
  });

  const loads = new AbortController();
  const pool = deps.pool ?? createCharacterPool();
  let disposed = false;
  // The film's ranger and car are the intro's alone: the title's tour has no one in it.
  const rangerLoaded = title ? Promise.resolve() : pool.load(renderer.scene, [INTRO_RANGER]);
  let car: CarModel | null = null;
  let carModel: PlacedModel | null = null;
  let carPatch: CarShadowPatch | null = null;
  let cordTube: ReturnType<typeof createCordTube> | null = null;
  const carLoaded = title ? Promise.resolve() : (deps.loadCar ?? ((s) => loadFilmCar(s, loads.signal)))(renderer.scene).then((placed) => {
    if (placed === null || disposed) {
      placed?.dispose();
      return;
    }
    carModel = placed;
    car = carModelOf(placed, (line) => console.warn(line));
    dimCabParts(car);
    cordTube = createCordTube(renderer.scene);
    stage.cord = cordTube;
    // `stage` is made below, before this promise can resolve.
    stage.car = car;
    for (const mesh of placed.meshes) renderer.shadows.add(mesh);
    // The dark under the car that the mist's light leaves, as under the hike's
    // parked car; without it a car on the road stands on it like a cut-out.
    // Fogged by the atmosphere as the road is, so it fades with it far off,
    // and lighter than the parked car's: the film's light is all sky.
    carPatch = createCarShadowPatch(renderer.scene, { x: 0, z: 0 }, () => 0, { moving: true, atmosphere: true, darkness: FILM_PATCH_DARKNESS });
    carPatch.mesh.name = "film_car_shadow";
    carPatch.mesh.parent = placed.node;
  });
  const loaded = title ? worldIn(READY_MAX_MS) : Promise.all([rangerLoaded, carLoaded]).then(() => undefined);
  const ready = Promise.all([renderer.skyReady(), loaded]).then(() => undefined);

  const black = document.createElement("div");
  black.className = "scene-black";
  black.setAttribute("style", BLACK_STYLE);
  black.style.opacity = "1";
  deps.container.append(black);
  const captions = createCaptionPanel(deps.container);
  /** The camera the stage last set, and the one the last drawn frame was drawn from. */
  let lastView: FreecamView | null = null;
  let drawnView: FreecamView | null = null;
  const stage: StageDeps = {
    setFreecam: (view) => {
      lastView = view;
      renderer.setFreecam(view);
    },
    setDepthOfField: (on) => renderer.setDepthOfField(on),
    actor: (id) => pool.acquire(1, id),
    car,
    hand: () => pool.acquire(1, INTRO_RANGER)?.joint("hand_r") ?? null,
    captions,
    black: (amount) => {
      black.style.opacity = String(amount);
    },
    warn: (line) => console.warn(line),
  };
  const player = createScenePlayer(scene, clock, { frame: (frame) => stageFrame(frame, stage), dispose: () => captions.dispose() });
  if (search.step !== null) player.step(search.step);
  else if (search.t !== null) player.seek(search.t);

  // The loop runs on a held frame too (a held clock makes every tick the
  // same frame), so a page opened at a step shows it; a recorder's `frame()`
  // stops the loop and draws each frame itself.
  let looping = true;
  /** One frame, inside the engine's own frame brackets: `beginFrame` is
   * where the engine measures its delta time and `endFrame` is what
   * presents a WebGPU frame, which a bare `scene.render()` does neither of. */
  const drawOneFrame = (): void => {
    renderer.engine.beginFrame();
    player.tick();
    renderer.sync(world.state, -1, 0);
    renderer.scene.render();
    renderer.engine.endFrame();
    drawnView = lastView;
  };
  const loop = (): void => {
    if (disposed || !looping) return;
    drawOneFrame();
    raf(loop);
  };
  // No frame before the sky's first slices are in (`Renderer.skyReady`):
  // until then the lighting has applied nothing.
  void renderer.skyReady().then(() => {
    if (!disposed) raf(loop);
  });

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
    // picture has been presented and a screenshot reads it. After a cut the
    // world is drawn in first (`cameraJump.ts`).
    frame: async () => {
      looping = false;
      const before = drawnView;
      drawOneFrame();
      if (lastView !== null && cameraJumped(before, lastView)) {
        for (let i = 0; i < WARM_FRAMES; i += 1) drawOneFrame();
        await worldIn(SETTLE_MAX_MS);
        drawOneFrame();
      }
      await new Promise<void>((resolve) => raf(() => resolve()));
    },
    time: () => player.time(),
    ready,
    engine: () => (renderer.engine.isWebGPU ? "webgpu" : "webgl2"),
  };
  (globalThis as { dayhikeScene?: DayhikeScene }).dayhikeScene = api;

  return {
    worldState: () => world.state,
    scene: () => renderer.scene,
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
      posts.dispose();
      trailhead.dispose();
      pool.dispose();
      cordTube?.dispose();
      carPatch?.dispose();
      carModel?.dispose();
      renderer.dispose();
      ownSky?.dispose();
    },
  };
}
