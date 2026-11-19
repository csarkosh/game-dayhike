import { describe, expect, it } from "vitest";
import { INTRO_DURATION, INTRO_HOUR, INTRO_WEATHER } from "../../../src/game/scene/intro.js";
import { BLACK_STYLE, FILM_PATCH_DARKNESS, routeWorld } from "../../../src/game/scene/routeWorld.js";
import { TITLE_HOUR, TITLE_WEATHER } from "../../../src/game/scene/title.js";

describe("the scene route's world", () => {
  it("is the intro's: its hour and weather, the film's scene with its car, the board and the posts, and no parked car", () => {
    const route = routeWorld("intro");
    expect(route.title).toBe(false);
    expect(route.hour).toBe(INTRO_HOUR);
    expect(route.weather).toBe(INTRO_WEATHER);
    expect(route.scene.duration).toBe(INTRO_DURATION);
    expect(route.scene.car).not.toBeNull();
    expect(route.scene.actors).toHaveLength(1);
    expect(route.trailheadSites.car).toBeUndefined();
    expect(route.posts.length).toBeGreaterThan(0);
    expect(route.board.urls).toBeDefined();
    expect(route.groundH(route.trailheadSites.board.x, route.trailheadSites.board.z)).toBeTypeOf("number");
    // No local player, and nothing steps it: the route reads the world as it stands.
    expect(route.world.state.players.size).toBe(0);
    expect(route.forest.seed).toBe(route.seed);
  });

  it("is the title's: its own seed, hour and weather, a tour with no one in it, and the hike's parked car", () => {
    const route = routeWorld("title");
    expect(route.title).toBe(true);
    expect(route.hour).toBe(TITLE_HOUR);
    expect(route.weather).toBe(TITLE_WEATHER);
    expect(route.scene.car).toBeNull();
    expect(route.scene.actors).toHaveLength(0);
    expect(route.trailheadSites.car).toBeDefined();
    expect(route.seed).not.toBe(routeWorld("intro").seed);
  });

  it("is the same world each time it is asked for", () => {
    const a = routeWorld("intro"), b = routeWorld("intro");
    expect(a.seed).toBe(b.seed);
    expect(a.posts).toEqual(b.posts);
    expect(a.scene.camera(20)).toEqual(b.scene.camera(20));
    expect(a.scene.car!(20)).toEqual(b.scene.car!(20));
  });

  it("holds the film's patch at half the parked car's darkness, and the black over the picture and under the caption", () => {
    expect(FILM_PATCH_DARKNESS).toBe(0.5);
    expect(BLACK_STYLE).toContain("z-index:29");
    expect(BLACK_STYLE).toContain("background:#000");
  });
});
