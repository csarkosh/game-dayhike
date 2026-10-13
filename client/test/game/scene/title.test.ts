import { describe, expect, it } from "vitest";
import { TITLE_DURATION, TITLE_HOUR, TITLE_SHOTS, TITLE_WEATHER, titleScene, type TitleWorld } from "../../../src/game/scene/title.js";
import { evaluate } from "../../../src/game/scene/timeline.js";
import { FOV_MAX, FOV_MIN } from "../../../src/game/scene/shots.js";

/** A test world: the sea west of x = -300 at level 0, the ground rising 0.1 m a metre inland, a lake
 * at (200, 400) whose water is at 50 m with a round 30 m rim, a meadow at (400, 200), the peak at (900, 600). */
const world: TitleWorld = {
  ground: (x) => Math.max(0, (x + 300) * 0.1),
  seaLevel: 0,
  coastlineX: () => -300,
  cove: { z0: 0, halfWidth: 150 },
  water: { x: 200, z: 400, level: 50, rim: () => 30 },
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

  it("drifts over the meadow from 20 m above its rim, toward the peak", () => {
    const from = camAt(world, 7);
    const to = camAt(world, 13.999);
    // The rim on the side away from the peak: 40 m from the centre, back along the start-to-peak line.
    expect(Math.hypot(from.x - 400, from.z - 200)).toBeCloseTo(40, 6);
    expect(from.x).toBeCloseTo(364.54, 2);
    expect(from.z).toBeCloseTo(181.49, 2);
    // Looking along that line, at the far rim.
    expect(from.yaw).toBeCloseTo(1.0896, 4);
    expect(to.yaw).toBeCloseTo(1.0896, 4);
    expect(from.y - world.ground(from.x, from.z)).toBeCloseTo(20, 6);
    // The drift holds its height while the test world's ground rises 0.1 m a metre under it.
    for (let t = 7; t < 14; t += 0.5) {
      const c = camAt(world, t);
      expect(c.y - world.ground(c.x, c.z)).toBeGreaterThan(18.5);
      expect(c.y - world.ground(c.x, c.z)).toBeLessThanOrEqual(20);
    }
    expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeCloseTo(11.998, 3);
    expect(Math.hypot(to.x - 400, to.z - 200)).toBeLessThan(Math.hypot(from.x - 400, from.z - 200));
  });

  it("glides over the forest, well above the ground, where the world has no meadow", () => {
    for (let t = 7; t < 14; t += 0.5) {
      const c = camAt({ ...world, meadow: null }, t);
      expect(c.y - world.ground(c.x, c.z)).toBeGreaterThan(30);
    }
  });

  it("looks across the lake's narrow axis from its lower shore, 5 m up, drifting along the shore", () => {
    // A round lake's long axis is the start-to-peak line, so its narrow axis lies across it; the test
    // world's ground rises with x, so the lower shore is the one at the smaller x.
    const mid = camAt(world, 17.5);
    expect(Math.hypot(mid.x - 200, mid.z - 400)).toBeCloseTo(55, 6);
    expect(mid.x).toBeLessThan(200);
    expect(mid.y - Math.max(50, world.ground(mid.x, mid.z))).toBeCloseTo(5, 6);
    // Looking at the higher shore, across the start-to-peak line: along (0.4628, -0.8864).
    expect(Math.sin(mid.yaw)).toBeCloseTo(0.4628, 3);
    expect(Math.cos(mid.yaw)).toBeCloseTo(-0.8864, 3);
    const [from, to] = [camAt(world, 14), camAt(world, 20.999)];
    expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeCloseTo(11.998, 3);
    expect(to.y).toBe(from.y);
  });

  it("finds a long lake's long axis and stands on its lower narrow side", () => {
    // 50 m from the centre along z, 10 m across in x; the ground rises with x, so the lower side is -x.
    const c = camAt({ ...world, water: { ...world.water!, rim: (a) => 30 + 20 * Math.cos(2 * a) } }, 17.5);
    expect(c.x).toBeCloseTo(165, 6);
    expect(c.z).toBeCloseTo(400, 6);
    expect(c.y).toBeCloseTo(55, 6);
    expect(Math.sin(c.yaw)).toBeCloseTo(1, 6);
  });

  it("frames a meadow where the world has no lake, and the hills where it has neither", () => {
    const meadow = camAt({ ...world, water: null }, 17);
    expect(Math.hypot(meadow.x - 400, meadow.z - 200)).toBeLessThan(100);
    const m0 = camAt({ ...world, water: null }, 14);
    expect(Math.hypot(m0.x - 400, m0.z - 200)).toBeCloseTo(65, 6);
    expect(m0.y - world.ground(m0.x, m0.z)).toBeCloseTo(5, 6);
    const hills = camAt({ ...world, water: null, meadow: null }, 17);
    expect(Math.hypot(hills.x + 230, hills.z - 10)).toBeLessThan(15);
  });

  it("rises at the trail's start", () => {
    const [a, b] = [camAt(world, 22), camAt(world, 27)];
    expect(Math.hypot(a.x + 230, a.z - 10)).toBeLessThan(15);
    expect(b.y).toBeGreaterThan(a.y);
  });

  it("pushes toward the summit from 100 m short of it, 45 m up", () => {
    const start = camAt(world, 28);
    expect(Math.hypot(start.x - 900, start.z - 600)).toBeCloseTo(100, 6);
    expect(start.y - world.ground(start.x, start.z)).toBeCloseTo(45, 6);
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
