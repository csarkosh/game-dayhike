import { describe, expect, it } from "vitest";
import { TITLE_DURATION, TITLE_HOUR, TITLE_SHOTS, TITLE_WEATHER, titleScene, type TitleWorld } from "../../../src/game/scene/title.js";
import { evaluate } from "../../../src/game/scene/timeline.js";
import { FOV_MAX, FOV_MIN } from "../../../src/game/scene/shots.js";

/** A test world: the sea west of x = -300 at level 0, the ground rising 0.1 m a metre inland, a lake
 * at (200, 400) whose water is at 50 m, a meadow at (400, 200), the peak at (900, 600). */
const world: TitleWorld = {
  ground: (x) => Math.max(0, (x + 300) * 0.1),
  seaLevel: 0,
  coastlineX: () => -300,
  cove: { z0: 0, halfWidth: 150 },
  water: { x: 200, z: 400, radius: 30, level: 50 },
  meadow: { x: 400, z: 200, radius: 40 },
  peak: { x: 900, z: 600, radius: 60 },
  start: { x: -230, z: 10, yaw: 1.4 },
};
const camAt = (w: TitleWorld, t: number) => evaluate(titleScene(w), t).camera;

describe("the title scene", () => {
  it("is five shots of seven seconds on whole seconds, in the overcast at a held hour, with no one in it", () => {
    expect(TITLE_DURATION).toBe(35);
    expect(TITLE_SHOTS.map((s) => [s.from, s.to])).toEqual([[0, 7], [7, 14], [14, 21], [21, 28], [28, 35]]);
    expect([TITLE_WEATHER.cloudCover, TITLE_WEATHER.mist, TITLE_HOUR]).toEqual([0.8, 0.25, 15]);
    const frame = evaluate(titleScene(world), 10);
    expect([frame.actors.length, frame.car, frame.caption, frame.black]).toEqual([0, null, null, 0]);
  });

  it("frames the cove from low over its water, looking along the beach", () => {
    const c = camAt(world, 3);
    expect(c.x).toBeLessThan(-350);
    expect(Math.abs(c.z)).toBeLessThan(150);
    expect(Math.cos(c.yaw)).toBeGreaterThan(0.8);
    expect(Math.sin(c.yaw)).toBeGreaterThan(0);
  });

  it("glides over the forest, well above the ground", () => {
    for (let t = 7; t < 14; t += 0.5) {
      const c = camAt(world, t);
      expect(c.y - world.ground(c.x, c.z)).toBeGreaterThan(30);
    }
  });

  it("looks across the lake from beyond its shore", () => {
    const c = camAt(world, 17);
    expect(Math.hypot(c.x - 200, c.z - 400)).toBeLessThan(90);
    expect(Math.hypot(c.x - 200, c.z - 400)).toBeGreaterThan(30);
  });

  it("frames a meadow where the world has no lake, and the hills where it has neither", () => {
    const meadow = camAt({ ...world, water: null }, 17);
    expect(Math.hypot(meadow.x - 400, meadow.z - 200)).toBeLessThan(100);
    const hills = camAt({ ...world, water: null, meadow: null }, 17);
    expect(Math.hypot(hills.x + 230, hills.z - 10)).toBeLessThan(15);
  });

  it("rises at the trail's start", () => {
    const [a, b] = [camAt(world, 22), camAt(world, 27)];
    expect(Math.hypot(a.x + 230, a.z - 10)).toBeLessThan(15);
    expect(b.y).toBeGreaterThan(a.y);
  });

  it("pushes toward the summit", () => {
    const [a, b] = [camAt(world, 29), camAt(world, 34)];
    expect(Math.hypot(b.x - 900, b.z - 600)).toBeLessThan(Math.hypot(a.x - 900, a.z - 600));
  });

  it("moves slowly in every shot, under 2 m/s and 0.12 rad/s, and never under the ground or the water", () => {
    const scene = titleScene(world);
    for (const { from, to } of TITLE_SHOTS) {
      for (let t = from; t + 1 / 24 < to; t += 1 / 24) {
        const [a, b] = [evaluate(scene, t).camera, evaluate(scene, t + 1 / 24).camera];
        expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * 24).toBeLessThan(2);
        const dYaw = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
        expect(Math.hypot(dYaw, b.pitch - a.pitch) * 24).toBeLessThan(0.12);
        expect(a.fov).toBeGreaterThanOrEqual(FOV_MIN);
        expect(a.fov).toBeLessThanOrEqual(FOV_MAX);
        expect(a.y).toBeGreaterThan(Math.max(world.ground(a.x, a.z), world.seaLevel) + 1);
      }
    }
  });
});
