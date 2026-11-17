/**
 * The scene route's world, with no engine: the fixed world a staged scene
 * (the intro, or the title loop's tour) plays on, the scene itself, and what
 * stands at its trailhead. Whoever draws the route builds a renderer on
 * `level` and `forest`, sets `hour` and `weather`, asks for the posts, the
 * board and (the title's tour) the hike's parked car at these places, and
 * steps `scene`; nothing here draws.
 *
 * The world has no local player and is never stepped: the route syncs its
 * renderer to `world.state` as it stands.
 */
import sandbox01 from "../../../levels/sandbox01.json" with { type: "json" };
import { parseLevel, type Level } from "../../sim/level.js";
import { createForest, type Forest } from "../../sim/forest.js";
import { createWorld, type World } from "../../sim/world.js";
import { DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, elevationAt, setActiveTerrainVariant, type LakeSource } from "../../sim/terrain.js";
import { coveFor } from "../../sim/olympic.js";
import { trailheadPlaces } from "../../sim/trailhead.js";
import { SUMMIT_LABEL, TRAIL_NAME, signPosts, type SignPost } from "../../sim/signs.js";
import { signSites } from "../../sim/placeNames.js";
import { boardDrawingOf, type BoardDrawing } from "../boardDraw.js";
import { BOARD_IMAGE_URLS } from "../boardImages.js";
import { lakeRimRadii, rimAt } from "../lakeSkyline.js";
import { POSTER_LAST_SEEN } from "../posterPanel.js";
import { carYaw, type TrailheadSites } from "../sceneryParts.js";
import { seedFromToken } from "../seed.js";
import type { WeatherParams } from "../weather.js";
import { INTRO_HOUR, INTRO_SEED_TOKEN, INTRO_WEATHER, introScene } from "./intro.js";
import type { Scene } from "./timeline.js";
import { TITLE_HOUR, TITLE_SEED_TOKEN, TITLE_WEATHER, titleScene, type TitleWorld } from "./title.js";

export type SceneName = "intro" | "title";

/** What a recorder drives the route by (`window.dayhikeScene`). */
export type DayhikeScene = {
  seek(t: number): void;
  frame(): Promise<void>;
  time(): number;
  /** Resolves once the sky's first slices are in and the intro's ranger and
   * car have loaded or failed, or the title's world is in around its first
   * camera: a recorder waits on it. */
  ready: Promise<void>;
  engine(): "webgpu" | "webgl2";
};

/** How dark the film car's patch is against the hike's parked car's (its alpha). */
export const FILM_PATCH_DARKNESS = 0.5;

/** The black a scene fades from and to: over the picture, under the caption. */
export const BLACK_STYLE = "position:absolute;inset:0;background:#000;pointer-events:none;z-index:29;";

/** The title's lake: its rim's distance from the centre by azimuth, the farthest shore a ray
 * crosses; the shape's mean radius in a direction no shore lies, as where the centre stands on
 * dry ground, put in before the directions are blended so no reading falls toward zero. */
export function titleWater(lake: LakeSource): { x: number; z: number; level: number; rim: (a: number) => number } {
  const rims = lakeRimRadii(lake.shape).map((r) => (r > 0 ? r : lake.shape.meanRadius));
  return { x: lake.x, z: lake.z, level: lake.level, rim: (a) => rimAt(rims, a) };
}

export type RouteWorld = {
  title: boolean;
  seed: number;
  level: Level;
  forest: Forest;
  world: World;
  hour: number;
  weather: WeatherParams;
  scene: Scene;
  groundH(x: number, z: number): number;
  /** The fingerposts, as the hike stands them. */
  posts: SignPost[];
  /** The board, and for the title's tour the hike's parked car: in the intro the scene's car moves and the hike's is not there. */
  trailheadSites: TrailheadSites;
  /** What the board's face carries. */
  board: BoardDrawing;
};

/** The world of the scene named `name`, on the default terrain. Throws where that terrain has no road or trail. */
export function routeWorld(name: SceneName): RouteWorld {
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  const title = name === "title";
  const seed = seedFromToken(title ? TITLE_SEED_TOKEN : INTRO_SEED_TOKEN);
  const level = parseLevel(sandbox01);
  const forest = createForest(seed);
  const world = createWorld(level, seed, false);

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
      water: lake === null ? null : titleWater(lake),
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
  // player meets.
  const found = world.search;
  const hikerFirst = found === null ? "" : (found.hiker.name.split(" ")[0] as string);
  const sites = found === null ? [] : signSites(seed, graph.features, hikerFirst, found.body.pos);
  const trailheadSites: TrailheadSites = title ? { car: { site: places.car, trailhead: graph.trailhead }, board: places.board } : { board: places.board };
  const board = boardDrawingOf({
    seed,
    trailName: TRAIL_NAME,
    hikerName: found?.hiker.name ?? "",
    lastSeen: POSTER_LAST_SEEN,
    graph,
    places: sites,
    summitName: SUMMIT_LABEL,
    roadCenterX,
    urls: BOARD_IMAGE_URLS,
  });
  return {
    title, seed, level, forest, world, hour: title ? TITLE_HOUR : INTRO_HOUR, weather: title ? TITLE_WEATHER : INTRO_WEATHER, scene, groundH,
    posts: signPosts(graph, sites), trailheadSites, board,
  };
}
