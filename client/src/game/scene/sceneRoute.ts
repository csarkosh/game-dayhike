/**
 * The scene route: a staged scene (the intro, or the title loop's tour) on
 * its fixed world, with no local player, the way the title page's backdrop
 * ran until the still replaced it. `?t` seeks and `?step` holds a frame; `window.dayhikeScene` lets a
 * recorder seek and draw one frame at a time. Everything built here is
 * disposed on leaving the route.
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { Scene as BabylonScene } from "@babylonjs/core/scene.js";
import sandbox01 from "../../../levels/sandbox01.json" with { type: "json" };
import { parseLevel } from "../../sim/level.js";
import { createForest } from "../../sim/forest.js";
import { createWorld } from "../../sim/world.js";
import type { WorldState } from "../../sim/types.js";
import { DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, elevationAt, setActiveTerrainVariant, type LakeSource } from "../../sim/terrain.js";
import { coveFor } from "../../sim/olympic.js";
import { trailheadPlaces } from "../../sim/trailhead.js";
import { createCharacterPool, type CharacterPool } from "../characterModel.js";
import { loadContainer, loadUntilAborted } from "../modelLoad.js";
import { modelUrl } from "../assetUrls.js";
import { placeStaticModel, type PlacedModel } from "../staticModel.js";
import { createRenderer } from "../renderer.js";
import type { QualityTier } from "../quality.js";
import { seedFromToken } from "../seed.js";
import { carYaw, createCarShadowPatch, createTrailheadMeshes, type CarShadowPatch } from "../trailheadMeshes.js";
import { createSignMeshes } from "../signMeshes.js";
import { boardDrawingOf, type BoardPainter } from "../boardPaint.js";
import { BOARD_IMAGE_URLS } from "../boardImages.js";
import { POSTER_LAST_SEEN } from "../posterPanel.js";
import { SUMMIT_LABEL, TRAIL_NAME, signPosts } from "../../sim/signs.js";
import { signSites } from "../../sim/placeNames.js";
import { terrainMaterialFor } from "../renderer.js";
import { whenSceneReady } from "../rendererSwap.js";
import { READY_MAX_MS } from "../startReady.js";
import { createCaptionPanel } from "./captions.js";
import { createCordTube } from "./cordTube.js";
import { INTRO_CAR, INTRO_HOUR, INTRO_RANGER, INTRO_SEED_TOKEN, INTRO_WEATHER, introScene } from "./intro.js";
import { createSceneClock, type SceneClock } from "./sceneClock.js";
import { createScenePlayer } from "./scenePlayer.js";
import { TITLE_HOUR, TITLE_SEED_TOKEN, TITLE_WEATHER, titleScene, type TitleWorld } from "./title.js";
import { carModelOf, dimCabParts, type CarModel, type StageDeps } from "./sceneStage.js";

export type DayhikeScene = {
  seek(t: number): void;
  frame(): Promise<void>;
  time(): number;
  /** Resolves once the intro's ranger and car have loaded or failed, or the
   * title's world is in around its first camera: a recorder waits on it. */
  ready: Promise<void>;
  engine(): "webgpu" | "webgl2";
};
export type SceneRun = { dispose(): void; worldState(): WorldState; scene(): BabylonScene; hasWildlife: boolean };
export type SceneName = "intro" | "title";
export type SceneRouteDeps = {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  tier: QualityTier;
  engine?: AbstractEngine;
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
};

/** How dark the film car's patch is against the hike's parked car's (its alpha). */
const FILM_PATCH_DARKNESS = 0.5;

const BLACK_STYLE = "position:absolute;inset:0;background:#000;pointer-events:none;z-index:29;";

async function loadFilmCar(scene: BabylonScene, signal: AbortSignal): Promise<PlacedModel | null> {
  try {
    const container = await loadUntilAborted(() => loadContainer(modelUrl(`models/${INTRO_CAR}.glb`), scene), signal);
    return placeStaticModel(container, INTRO_CAR, 0, 0, 0, 0);
  } catch (error) {
    if (!signal.aborted) console.warn(`scene: the car did not load (${error instanceof Error ? error.message : String(error)}); its boxes stand in`);
    return null;
  }
}

export function startSceneRoute(deps: SceneRouteDeps, search: { t: number | null; step: number | null }, name: SceneName = "intro"): SceneRun {
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  const now = deps.now ?? (() => performance.now());
  const raf = deps.raf ?? ((fn) => requestAnimationFrame(fn));
  const title = name === "title";
  const seed = seedFromToken(title ? TITLE_SEED_TOKEN : INTRO_SEED_TOKEN);
  const level = parseLevel(sandbox01);
  const forest = createForest(seed);
  const world = createWorld(level, seed, false);
  const clock: SceneClock = createSceneClock(now);
  const renderer = createRenderer(deps.canvas, level, forest, { tier: deps.tier, engine: deps.engine, clock: () => clock.time() * 1000, wildlife: false });
  renderer.setWeather(title ? TITLE_WEATHER : INTRO_WEATHER, 0);
  renderer.setHour(title ? TITLE_HOUR : INTRO_HOUR);
  const worldIn = deps.worldIn ?? ((maxMs: number) => whenSceneReady(renderer.scene, maxMs, renderer.forestReady));

  const variant = activeTerrainVariant();
  const graph = variant.trailGraph?.(seed);
  const roadCenterX = variant.roadCenterX;
  if (graph === undefined || roadCenterX === undefined) throw new Error("the scene's world has no road or trail");
  const places = trailheadPlaces(graph, roadCenterX, seed);
  const groundH = (x: number, z: number): number => elevationAt(seed, x, z);
  const titleWorld = (): TitleWorld => {
    const lake = (variant.waterBodies?.(seed) ?? []).find((b): b is LakeSource => b.kind === "lake") ?? null;
    const meadow = graph.features.find((f) => f.kind === "meadow") ?? null;
    const peak = graph.features[0]!;
    const cove = coveFor(seed);
    return {
      ground: groundH,
      seaLevel: variant.waterLevel ?? 0,
      // Signed, positive inland, and one to one with x: the shoreline is where it is 0.
      coastlineX: (z) => -(variant.coastDistance?.(seed, 0, z) ?? 0),
      cove: { z0: cove.z0, halfWidth: cove.halfWidth },
      water: lake === null ? null : { x: lake.x, z: lake.z, radius: lake.radius, level: lake.level },
      meadow: meadow === null ? null : { x: meadow.x, z: meadow.z, radius: meadow.radius },
      peak: { x: peak.x, z: peak.z, radius: peak.radius },
      start: places.start,
    };
  };
  const road = { centerX: (z: number) => roadCenterX(seed, z), groundY: groundH };
  const scene = title
    ? titleScene(titleWorld())
    : introScene(road, {
        car: places.car,
        start: places.start,
        board: places.board,
        direction: carYaw(places.car, graph.trailhead) === 0 ? 1 : -1,
      });

  // The trailhead as the hike draws it: the board with its poster and the
  // fingerposts, from the world's own search, so the film frames what a
  // player meets. The title's tour has the hike's parked car too; in the
  // intro the scene's car moves and the hike's is not there.
  const found = world.search;
  const hikerFirst = found === null ? "" : (found.hiker.name.split(" ")[0] as string);
  const sites = found === null ? [] : signSites(seed, graph.features, hikerFirst, found.body.pos);
  const posts = createSignMeshes(renderer.scene, signPosts(graph, sites), groundH, {
    materialFor: (name) => terrainMaterialFor(renderer.scene, name),
    shadows: renderer.shadows,
    cover: renderer.cover,
  });
  const trailheadSites = title ? { car: { site: places.car, trailhead: graph.trailhead }, board: places.board } : { board: places.board };
  const trailhead = createTrailheadMeshes(renderer.scene, trailheadSites, groundH, {
    materialFor: (name) => terrainMaterialFor(renderer.scene, name),
    board: boardDrawingOf({
      seed,
      trailName: TRAIL_NAME,
      hikerName: found?.hiker.name ?? "",
      lastSeen: POSTER_LAST_SEEN,
      graph,
      places: sites,
      summitName: SUMMIT_LABEL,
      roadCenterX,
      urls: BOARD_IMAGE_URLS,
    }),
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
  const ready = title ? worldIn(READY_MAX_MS) : Promise.all([rangerLoaded, carLoaded]).then(() => undefined);

  const black = document.createElement("div");
  black.className = "scene-black";
  black.setAttribute("style", BLACK_STYLE);
  black.style.opacity = "1";
  deps.container.append(black);
  const captions = createCaptionPanel(deps.container);
  const stage: StageDeps = {
    setFreecam: (view) => renderer.setFreecam(view),
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
  const player = createScenePlayer(scene, clock, stage);
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
  };
  const loop = (): void => {
    if (disposed || !looping) return;
    drawOneFrame();
    raf(loop);
  };
  raf(loop);

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
    // picture has been presented and a screenshot reads it.
    frame: () =>
      new Promise<void>((resolve) => {
        looping = false;
        drawOneFrame();
        raf(() => resolve());
      }),
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
    },
  };
}
