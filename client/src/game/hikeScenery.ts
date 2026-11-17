/**
 * The scenery a hike places once, outside its renderer's own shells: the
 * fingerposts at the junctions, the trailhead's car and board, the film's
 * car that takes the parked car's place for the end scene, and the body at
 * the crest. All of it from the session's world and the seed the sim used,
 * built in the scene of the renderer it is given: the one being built, which
 * during a live change of tier is not yet the one running. The hike holds
 * what is built here by what it can ask of it and no more, and disposes it
 * while its scene lives (`SwapBindings.extras`).
 *
 * On Babylon.js it is built into the renderer's scene. The hike's own
 * renderer on Babylon Lite has no such scene (`sceneRendererOf` null): it is
 * asked for the same pieces at the same places (`liteSceneryOf`) and draws
 * them itself, the film's car in the parked car's place among them, which
 * it hands back for the end scene to drive. A renderer that is neither gets
 * no signs, no film car and a body that is nothing.
 */
import { activeTerrainVariant, elevationAt } from "../sim/terrain.js";
import { signSites } from "../sim/placeNames.js";
import { SUMMIT_LABEL, TRAIL_NAME, signPosts } from "../sim/signs.js";
import { trailheadPlaces } from "../sim/trailhead.js";
import type { Vec3 } from "../sim/types.js";
import type { World } from "../sim/world.js";
import { BOARD_IMAGE_URLS } from "./boardImages.js";
import { boardDrawingOf } from "./boardDraw.js";
import { createBodyMesh } from "./bodyMesh.js";
import { loadUntilAborted } from "./modelLoad.js";
import { POSTER_LAST_SEEN } from "./posterPanel.js";
import { liteSceneryOf, type LiteTrailhead } from "./lite/sceneryMeshes.js";
import { sceneRendererOf, terrainMaterialFor, type Renderer } from "./renderer.js";
import { createSignMeshes, type SignMeshes } from "./signMeshes.js";
import { defaultModelLoader, placeStaticModel } from "./staticModel.js";
import { FILM_CAR_NAME, FILM_CAR_OUTPUT, createTrailheadMeshes, type CarHandle, type TrailheadMeshes } from "./trailheadMeshes.js";

/** The junction posts and the trailhead's car and board, as the hike holds them. */
export type HikeSigns = {
  /** The trailhead's car as it stands, for the end scene to drive
   * (`EndSceneSetup.car`, `TrailheadMeshes.car`); null while only its box
   * stands, or with no car at all. */
  car(): CarHandle | null;
  /** Whether the film's car stands in the parked car's place, with its parts. */
  filmCarIn(): boolean;
  /** Whether the film's car is still in its first frames (`TrailheadMeshes.warm`). */
  warm(): boolean;
  dispose(): void;
};

/** The trailhead each set of signs was built with, for the film's car to be placed in. */
const trailheads = new WeakMap<HikeSigns, TrailheadMeshes>();
/** The same on the hike's own renderer on Babylon Lite. */
const liteTrailheads = new WeakMap<HikeSigns, LiteTrailhead>();

/**
 * Junction posts, and the trailhead's car and board, from the same seed the
 * sim used, in `renderer`'s scene. Null for a world with no one to search
 * for, no trail or no road, and for a renderer with no Babylon scene.
 */
export function createHikeSigns(renderer: Renderer, world: World, seed: number): HikeSigns | null {
  const built = sceneRendererOf(renderer);
  const lite = built === null ? liteSceneryOf(renderer) : null;
  if (built === null && lite === null) return null;
  const search = world.search;
  const variant = activeTerrainVariant();
  const graph = variant.trailGraph?.(seed);
  const roadCenterX = variant.roadCenterX;
  if (search === null || graph === undefined || roadCenterX === undefined) return null;
  const places = trailheadPlaces(graph, roadCenterX, seed);
  const groundH = (x: number, z: number): number => elevationAt(seed, x, z);
  // The places the posts name: the summit where the body lies, and every
  // pond and meadow, never under the missing hiker's own first name.
  const hikerFirst = search.hiker.name.split(" ")[0] as string;
  const sites = signSites(seed, graph.features, hikerFirst, search.body.pos);
  const trailheadSites = { car: { site: places.car, trailhead: graph.trailhead }, board: places.board };
  const board = boardDrawingOf({
    seed,
    trailName: TRAIL_NAME,
    hikerName: search.hiker.name,
    lastSeen: POSTER_LAST_SEEN,
    graph,
    places: sites,
    summitName: SUMMIT_LABEL,
    roadCenterX,
    urls: BOARD_IMAGE_URLS,
  });
  if (built === null) {
    // The hike's own renderer on Babylon Lite draws the same scenery from the same places (`lite/sceneryMeshes.ts`),
    // and hands out the car as it stands there for the end scene to drive.
    const host = lite as NonNullable<typeof lite>;
    const litePosts = host.signs(signPosts(graph, sites), groundH);
    const liteTrailhead = host.trailhead(trailheadSites, groundH, board);
    const liteSigns: HikeSigns = {
      car: () => liteTrailhead.car(),
      filmCarIn: () => liteTrailhead.filmCarIn(),
      warm: () => liteTrailhead.warm(),
      dispose() {
        litePosts.dispose();
        liteTrailhead.dispose();
      },
    };
    liteTrailheads.set(liteSigns, liteTrailhead);
    return liteSigns;
  }
  const { scene, shadows, cover } = built;
  const posts: SignMeshes = createSignMeshes(
    scene,
    signPosts(graph, sites),
    groundH,
    { materialFor: (name) => terrainMaterialFor(scene, name), shadows, cover },
  );
  const trailhead = createTrailheadMeshes(
    scene,
    trailheadSites,
    groundH,
    {
      materialFor: (name) => terrainMaterialFor(scene, name),
      board,
      shadows,
      cover,
    },
  );
  const signs: HikeSigns = {
    car: () => trailhead.car(),
    filmCarIn: () => (trailhead.car()?.model ?? null) !== null,
    warm: () => trailhead.warm(),
    dispose() {
      posts.dispose();
      trailhead.dispose();
    },
  };
  trailheads.set(signs, trailhead);
  return signs;
}

/**
 * Fetches the film's car (`trailheadMeshes.ts` `swapCar`), the parked car's
 * double with wheels and a door, into `renderer`'s scene and puts it in the
 * parked car's place at `signs`' trailhead. Ends quietly when `signal`
 * aborts, the car that arrives after it disposed; a fetch or a placing that
 * fails says so once and leaves the parked car.
 */
export function loadFilmCar(renderer: Renderer, signs: HikeSigns, signal: AbortSignal): void {
  const liteTrailhead = liteTrailheads.get(signs);
  if (liteTrailhead !== undefined) {
    liteTrailhead.filmCar(signal);
    return;
  }
  const trailhead = trailheads.get(signs);
  if (trailhead === undefined) return;
  const built = sceneRendererOf(renderer);
  if (built === null) return;
  const { scene } = built;
  loadUntilAborted(() => defaultModelLoader(scene)(FILM_CAR_OUTPUT), signal).then(
    (container) => {
      if (signal.aborted) {
        container.dispose();
        return;
      }
      try {
        trailhead.swapCar(placeStaticModel(container, FILM_CAR_NAME, 0, 0, 0, 0));
      } catch (error) {
        console.warn(`end: the film's car could not be placed (${error instanceof Error ? error.message : String(error)}); the parked car stays`);
      }
    },
    (error: unknown) => {
      if (!signal.aborted) console.warn(`end: the film's car did not load (${error instanceof Error ? error.message : String(error)}); the parked car stays`);
    },
  );
}

/**
 * The crucified hiker at the crest (`bodyMesh.ts`), in `renderer`'s scene,
 * shadowed with the rest of the scenery placed once.
 */
export function createHikeBody(renderer: Renderer, body: { pos: Vec3; yaw: number }): { dispose(): void } {
  const built = sceneRendererOf(renderer);
  if (built === null) return liteSceneryOf(renderer)?.body(body) ?? { dispose: () => undefined };
  return createBodyMesh(built.scene, body, { shadows: built.shadows });
}
