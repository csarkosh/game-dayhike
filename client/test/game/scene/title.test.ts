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

  it("drifts along the forest floor beside the trail, off its bed, looking ahead", () => {
    // 52 m along the start's heading (yaw 1.4) and 10 m to its right, 1.4 m over the higher end of
    // the drift (the test world's ground rises with x).
    const from = camAt(world, 7);
    expect(from.x).toBeCloseTo(-177.057, 3);
    expect(from.z).toBeCloseTo(8.984, 3);
    expect(from.y).toBeCloseTo(14.877, 3);
    const to = camAt(world, 13.999);
    expect(to.x).toBeCloseTo(-165.232, 2);
    expect(to.z).toBeCloseTo(11.023, 2);
    expect(to.y).toBe(from.y);
    // Looking along the trail's line: yaw 1.4, at a point 20 m ahead 1.2 m over the ground.
    expect(from.yaw).toBeCloseTo(1.4, 4);
    expect(to.yaw).toBeCloseTo(1.4, 4);
    expect(from.pitch).toBeCloseTo(-0.0294, 4);
  });

  it("looks across the lake's narrow axis from its higher shore, 6 m up, drifting along the shore", () => {
    // A round lake's long axis is the start-to-peak line, so its narrow axis lies across it; the test
    // world's ground rises with x, so the higher shore is the one at the larger x. The drift starts at
    // the stand, 18 m beyond the rim, and runs 12 m along the long axis; 6 m over the higher end.
    const from = camAt(world, 14);
    expect(from.x).toBeCloseTo(222.216, 3);
    expect(from.z).toBeCloseTo(357.451, 3);
    expect(from.y).toBeCloseTo(59.285, 3);
    const to = camAt(world, 20.999);
    expect(to.x).toBeCloseTo(232.853, 2);
    expect(to.z).toBeCloseTo(363.005, 2);
    expect(to.y).toBe(from.y);
    // Looking at the lower shore's water's edge 5 m past its rim, across the start-to-peak line:
    // along (-0.4628, 0.8864), and down to the level.
    expect(Math.sin(from.yaw)).toBeCloseTo(-0.4628, 3);
    expect(Math.cos(from.yaw)).toBeCloseTo(0.8864, 3);
    expect(from.pitch).toBeCloseTo(0.0995, 4);
  });

  it("finds a long lake's long axis and stands on its higher narrow side", () => {
    // 50 m from the centre along z, 10 m across in x; the ground rises with x, so the higher side is +x.
    const c = camAt({ ...world, water: { ...world.water!, rim: (a) => 30 + 20 * Math.cos(2 * a) } }, 14);
    expect(c.x).toBeCloseTo(228, 6);
    expect(c.z).toBeCloseTo(400, 6);
    expect(c.y).toBeCloseTo(58.8, 6);
    expect(Math.sin(c.yaw)).toBeCloseTo(-1, 6);
  });

  it("frames a meadow where the world has no lake, and the hills where it has neither", () => {
    const meadow = camAt({ ...world, water: null }, 17);
    expect(Math.hypot(meadow.x - 400, meadow.z - 200)).toBeLessThan(100);
    const m0 = camAt({ ...world, water: null }, 14);
    expect(Math.hypot(m0.x - 400, m0.z - 200)).toBeCloseTo(58, 6);
    expect(m0.y - world.ground(m0.x, m0.z)).toBeCloseTo(6, 6);
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
