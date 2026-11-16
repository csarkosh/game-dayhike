import { beforeAll, describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import type { BoardDrawing } from "../../src/game/boardDraw.js";
import { createHikeBody, createHikeSigns, loadFilmCar } from "../../src/game/hikeScenery.js";
import type { SceneryHost } from "../../src/game/lite/sceneryMeshes.js";
import type { Renderer } from "../../src/game/renderer.js";
import type { TrailheadSites } from "../../src/game/sceneryParts.js";
import { signSites } from "../../src/sim/placeNames.js";
import { buildSearch } from "../../src/sim/search.js";
import { signPosts, type SignPost } from "../../src/sim/signs.js";
import { activeTerrainVariant, elevationAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { trailheadPlaces } from "../../src/sim/trailhead.js";
import type { World } from "../../src/sim/world.js";

const SEED = 627994160;
beforeAll(() => setActiveTerrainVariant("olympic"));

/** A world with the search the session installs, for `SEED`. */
function searched(): World {
  const variant = activeTerrainVariant();
  const graph = variant.trailGraph?.(SEED);
  const roadCenterX = variant.roadCenterX;
  if (graph === undefined || roadCenterX === undefined) throw new Error("the terrain has no trail or no road");
  const places = trailheadPlaces(graph, roadCenterX, SEED);
  return { search: buildSearch({ seed: SEED, graph, groundH: (x, z) => elevationAt(SEED, x, z), board: places.board, car: places.car }) } as unknown as World;
}

/** A renderer that draws its own scenery, as the hike's on Babylon Lite does, and what it was asked for. */
function liteRenderer() {
  const asked = {
    posts: [] as (readonly SignPost[])[], sites: [] as TrailheadSites[], boards: [] as BoardDrawing[], bodies: [] as { pos: { x: number; y: number; z: number }; yaw: number }[],
    film: [] as AbortSignal[], disposed: [] as string[], ground: Number.NaN,
  };
  const scenery: SceneryHost = {
    signs(posts, groundH) {
      asked.posts.push(posts);
      asked.ground = groundH(10, 20);
      return { dispose: () => void asked.disposed.push("signs") };
    },
    trailhead(sites, _groundH, board) {
      asked.sites.push(sites);
      asked.boards.push(board);
      return { filmCar: (signal) => void asked.film.push(signal), filmCarIn: () => asked.film.length > 0, dispose: () => void asked.disposed.push("trailhead") };
    },
    body(body) {
      asked.bodies.push(body);
      return { dispose: () => void asked.disposed.push("body") };
    },
  };
  return { renderer: { scenery } as unknown as Renderer, asked };
}

describe("the scenery a hike places once, on the hike's own renderer", () => {
  it("asks that renderer for the posts and the trailhead the renderer on Babylon.js would be built, from the same seed", () => {
    const world = searched();
    const { renderer, asked } = liteRenderer();
    const signs = createHikeSigns(renderer, world, SEED);
    expect(signs).not.toBeNull();
    const variant = activeTerrainVariant();
    const graph = variant.trailGraph?.(SEED) as NonNullable<ReturnType<NonNullable<typeof variant.trailGraph>>>;
    const search = world.search as NonNullable<World["search"]>;
    const sites = signSites(SEED, graph.features, search.hiker.name.split(" ")[0] as string, search.body.pos);
    expect(asked.posts).toEqual([signPosts(graph, sites)]);
    expect(asked.posts[0]?.length).toBeGreaterThan(0);
    expect(asked.ground).toBe(elevationAt(SEED, 10, 20));
    const places = trailheadPlaces(graph, variant.roadCenterX as NonNullable<typeof variant.roadCenterX>, SEED);
    expect(asked.sites).toEqual([{ car: { site: places.car, trailhead: graph.trailhead }, board: places.board }]);
    // The board's face names the trail and the missing hiker.
    expect(asked.boards[0]?.text.title).toBe("TRAIL 14");
    expect(asked.boards[0]?.text.poster.name).toBe(search.hiker.name);
    expect(asked.boards[0]?.seed).toBe(SEED);
  });

  it("stands the film's car in the parked car's place through the trailhead it was handed, and plays no scene with it yet", () => {
    const { renderer, asked } = liteRenderer();
    const signs = createHikeSigns(renderer, searched(), SEED) as NonNullable<ReturnType<typeof createHikeSigns>>;
    expect(signs.filmCarIn()).toBe(false);
    const loads = new AbortController();
    loadFilmCar(renderer, signs, loads.signal);
    expect(asked.film).toEqual([loads.signal]);
    expect(signs.filmCarIn()).toBe(true);
    // No scene is played by that renderer: the car it would drive is not handed out, and none is in its first frames.
    expect(signs.car()).toBeNull();
    expect(signs.warm()).toBe(false);
    signs.dispose();
    expect(asked.disposed).toEqual(["signs", "trailhead"]);
  });

  it("asks it for the body at the crest, and lets go of what it was handed", () => {
    const { renderer, asked } = liteRenderer();
    const at = { pos: { x: 1, y: 2, z: 3 }, yaw: 0.5 };
    const body = createHikeBody(renderer, at);
    expect(asked.bodies).toEqual([at]);
    body.dispose();
    expect(asked.disposed).toEqual(["body"]);
  });

  it("builds nothing for a renderer that is neither", () => {
    const neither = {} as unknown as Renderer;
    expect(createHikeSigns(neither, searched(), SEED)).toBeNull();
    expect(() => createHikeBody(neither, { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }).dispose()).not.toThrow();
  });

  it("builds no signs for a world with no one to search for", () => {
    const { renderer, asked } = liteRenderer();
    expect(createHikeSigns(renderer, { search: null } as unknown as World, SEED)).toBeNull();
    expect(asked.posts).toEqual([]);
  });
});
