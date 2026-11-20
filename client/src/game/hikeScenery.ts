/**
 * The scenery a hike places once, outside its renderer's own shells: the
 * fingerposts at the junctions, the trailhead's car and board, the film's
 * car that takes the parked car's place for the end scene, and the body at
 * the crest. All of it from the session's world and the seed the sim used,
 * asked of the renderer it is given: the one being built, which during a
 * live change of tier is not yet the one running. The hike holds what it is
 * handed here by what it can ask of it and no more, and lets go of it while
 * that renderer stands (`SwapBindings.extras`).
 *
 * The hike's renderer draws its own scenery (`liteSceneryOf`,
 * `lite/sceneryMeshes.ts`): it is asked for each piece at its place and
 * draws it itself, the film's car in the parked car's place among them,
 * which it hands back for the end scene to drive. A renderer with no
 * scenery to ask gets no signs, no film car and a body that is nothing.
 * Nothing here loads an engine: the renderer is held by its type, and its
 * scenery by what the hike asks of it.
 */
import { activeTerrainVariant, elevationAt } from "@csarkosh/engine/sim/terrain";
import { signSites } from "../sim/placeNames.js";
import { SUMMIT_LABEL, TRAIL_NAME, signPosts } from "../sim/signs.js";
import { trailheadPlaces } from "../sim/trailhead.js";
import type { Vec3 } from "../sim/types.js";
import type { World } from "../sim/world.js";
import { BOARD_IMAGE_URLS } from "./boardImages.js";
import { boardDrawingOf } from "./boardDraw.js";
import { POSTER_LAST_SEEN } from "./posterPanel.js";
import { liteSceneryOf, type LiteTrailhead } from "./lite/sceneryMeshes.js";
import type { Renderer } from "./rendererTypes.js";
import type { CarHandle } from "./scenePlay.js";

/** The junction posts and the trailhead's car and board, as the hike holds them. */
export type HikeSigns = {
  /** The trailhead's car as it stands, for the end scene to drive
   * (`EndSceneSetup.car`, `LiteTrailhead.car`); null while only its box
   * stands, or with no car at all. */
  car(): CarHandle | null;
  /** Whether the film's car stands in the parked car's place, with its parts. */
  filmCarIn(): boolean;
  /** Whether the film's car is still in its first frames (`LiteTrailhead.warm`). */
  warm(): boolean;
  dispose(): void;
};

/** The trailhead each set of signs was asked for with, for the film's car to be stood in. */
const trailheads = new WeakMap<HikeSigns, LiteTrailhead>();

/**
 * Junction posts, and the trailhead's car and board, from the same seed the
 * sim used, asked of `renderer`'s scenery. Null for a world with no one to
 * search for, no trail or no road, and for a renderer with no scenery to ask.
 */
export function createHikeSigns(renderer: Renderer, world: World, seed: number): HikeSigns | null {
  const host = liteSceneryOf(renderer);
  if (host === null) return null;
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
  // The renderer draws the scenery from these places (`lite/sceneryMeshes.ts`), and hands out the car as it stands
  // there for the end scene to drive.
  const posts = host.signs(signPosts(graph, sites), groundH);
  const trailhead = host.trailhead(trailheadSites, groundH, board);
  const signs: HikeSigns = {
    car: () => trailhead.car(),
    filmCarIn: () => trailhead.filmCarIn(),
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
 * Asks for the film's car, the parked car's double with wheels and a door,
 * to stand in the parked car's place at `signs`' trailhead. `renderer` is
 * the one the signs were asked of: its trailhead is found by the signs it
 * handed out. Ends quietly when `signal` aborts; a fetch or a placing that
 * fails is said once by the trailhead and leaves the parked car.
 */
export function loadFilmCar(renderer: Renderer, signs: HikeSigns, signal: AbortSignal): void {
  void trailheads.get(signs)?.filmCar(signal);
}

/** The crucified hiker at the crest, asked of `renderer`'s scenery; nothing for a renderer with none. */
export function createHikeBody(renderer: Renderer, body: { pos: Vec3; yaw: number }): { dispose(): void } {
  return liteSceneryOf(renderer)?.body(body) ?? { dispose: () => undefined };
}
