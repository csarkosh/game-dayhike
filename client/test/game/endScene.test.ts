import { describe, it, expect } from "vitest";
import {
  arrived, carDistance, carHeard, carSpeed, endBeats, endCar, endShot, endShotIndex, headlampAt, laneAt, roadRelease,
  type EndShotContext, type LampAim,
} from "../../src/game/endScene.js";
import { doorSpot } from "../../src/sim/trailhead.js";

/** A straight road along z, its centreline at x 0, on flat ground at 0; the car on its shoulder at the pad, nose to +z. */
const road = { centerX: () => 0, groundY: () => 0 };
const site = { x: 6.9, z: 0 };
const door = { x: 8.4, z: 0.5 };

function ctx(over: Partial<EndShotContext> = {}): EndShotContext {
  return { runner: { x: 20, y: 0, z: 10, yaw: 0 }, eyeY: 1.6, site, groundY: 0, direction: 1, road, door, arrival: null, pursuitFrom: null, ...over };
}

describe("the end scene's shots", () => {
  it("runs the run to 2.5 s, the pursuit to the arrival, the engine 5.5 s and the road after, for an arrival at 3.2 s", () => {
    expect([0, 1, 2.4, 2.5, 3.1, 3.2, 8.6, 8.8, 20.6, 30].map((t) => endShotIndex(t, 3.2))).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3, 3]);
    // Still running: no arrival yet keeps the run and the pursuit, until the cap at 10 s.
    expect([2.4, 2.5, 9.9, 10, 15.4, 15.5].map((t) => endShotIndex(t, null))).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it("skips the pursuit for an arrival at 1.0 s, before the run's cut", () => {
    expect([0, 0.9, 1, 2.5, 6.4, 6.5, 18.5].map((t) => endShotIndex(t, 1))).toEqual([0, 0, 2, 2, 2, 3, 3]);
  });

  it("films each shot on its lens: 24 mm, 32 mm, 32 mm, 24 mm", () => {
    const a = ctx({ arrival: 3.2 });
    expect([1, 3, 5, 12].map((t) => endShot(t, a).fov)).toEqual([0.57, 0.43, 0.43, 0.57]);
    expect([1, 3, 5, 12].map((t) => endShot(t, a).shot)).toEqual([0, 1, 2, 3]);
    expect(endShot(12, a).live).toBe(false);
  });

  it("carries shot 1 behind the runner, to their right and over their eye, aimed at the door at their eye's height", () => {
    const s = endShot(1, ctx());
    expect(s.x).toBeCloseTo(21.321891583212775, 9);
    expect(s.y).toBeCloseTo(2.1, 9);
    expect(s.z).toBeCloseTo(11.858118037755196, 9);
    expect(s.yaw).toBeCloseTo(-2.291877519079126, 9);
    expect(s.pitch).toBeCloseTo(0.029054608667581642, 9);
  });

  it("locks shot 2 off at the car's inland rear corner, out toward where the runner was at the cut, aimed at their chest", () => {
    const runner = { x: 12, y: 0, z: 4, yaw: 0 };
    const s = endShot(3, ctx({ runner, pursuitFrom: { x: 20, z: -9 } }));
    expect(s.x).toBeCloseTo(8.676519114754443, 9);
    expect(s.y).toBeCloseTo(0.7, 9);
    expect(s.z).toBeCloseTo(-2.781367054824161, 9);
    expect(s.yaw).toBeCloseTo(0.45568830929096177, 9);
    expect(s.pitch).toBeCloseTo(-0.07928278323704707, 9);
    // Ahead of the corner, out to the inland side alone: never forward along the car's flank.
    const ahead = endShot(3, ctx({ runner, pursuitFrom: { x: 16, z: 7 } }));
    // 2026-10-12: 8.461354843955473, -1.5499268233187946 before shot 2 kept to the quarter
    // away from the car.
    expect([ahead.x, ahead.y, ahead.z]).toEqual([expect.closeTo(8.8, 9), expect.closeTo(0.7, 9), expect.closeTo(-2.3, 9)]);
    expect(ahead.yaw).toBeCloseTo(0.4699766384170079, 9);
  });

  it("stands shot 2 out on the diagonal from the corner when the runner was ahead on the road, never in the car", () => {
    const runner = { x: 12, y: 0, z: 4, yaw: 0 };
    const s = endShot(3, ctx({ runner, pursuitFrom: { x: 3, z: 10 } }));
    expect([s.x, s.y, s.z]).toEqual([expect.closeTo(8.507106781186549, 9), expect.closeTo(0.7, 9), expect.closeTo(-3.0071067811865473, 9)]);
    // Facing −z, the rear is toward +z.
    const back = endShot(3, ctx({ runner, direction: -1, pursuitFrom: { x: 3, z: -10 } }));
    expect([back.x, back.y, back.z]).toEqual([expect.closeTo(8.507106781186549, 9), expect.closeTo(0.7, 9), expect.closeTo(3.0071067811865473, 9)]);
    expect(back.yaw).toBeCloseTo(1.293840813354631, 9);
  });

  it("locks shot 3 off low on the far shoulder 7 m ahead, turning to keep the car's nose as it comes past", () => {
    const parked = endShot(1, ctx({ arrival: 1 }));
    expect([parked.x, parked.y, parked.z]).toEqual([-6.9, 0.6, 7]);
    expect(parked.yaw).toBeCloseTo(1.8990543815219507, 9);
    expect(parked.pitch).toBeCloseTo(0.006859351644531735, 9);
    const passing = endShot(5.6, ctx({ arrival: 1 }));
    expect([passing.x, passing.y, passing.z]).toEqual([-6.9, 0.6, 7]);
    expect(passing.yaw).toBeCloseTo(1.3942638245007737, 9);
    expect(passing.pitch).toBeCloseTo(0.0077614352476271875, 9);
  });

  it("starts shot 4 14 m over the car looking down, carries it 2 s, leaves it in the air and tilts up to the road ahead", () => {
    const a = ctx({ arrival: 1 });
    const start = endShot(6.5, a);
    expect(start.x).toBeCloseTo(4.422028982899653, 9);
    expect(start.y).toBeCloseTo(14, 9);
    expect(start.z).toBeCloseTo(14.7175, 9);
    expect(start.yaw).toBeCloseTo(-0.24959405435408413, 9);
    expect(start.pitch).toBeCloseTo(1.55, 9);
    // Still over the car at the release, 40.6 m along.
    const carried = endShot(8.5, a);
    expect([carried.x, carried.y, carried.z, carried.yaw]).toEqual([expect.closeTo(1.8, 9), expect.closeTo(14, 9), expect.closeTo(40.6, 9), 0]);
    expect(carried.pitch).toBeCloseTo(1.4396296296296296, 9);
    // Released: held where the car was at the release, the car 54.6 m along beneath it.
    const released = endShot(9.5, a);
    expect([released.x, released.y, released.z, released.yaw]).toEqual([expect.closeTo(1.8, 9), expect.closeTo(14, 9), expect.closeTo(40.6, 9), 0]);
    expect(endCar(8.5, road, site, 1).z).toBeCloseTo(54.6, 9);
    expect(released.pitch).toBeCloseTo(1.3171875, 9);
    const end = endShot(18.5, a);
    expect(end.pitch).toBeCloseTo(0.06, 9);
    expect(end.z).toBeCloseTo(40.6, 9);
    // The release made once for the scene is the one made each frame.
    const once = endShot(9.5, { ...a, held: roadRelease(road, site, 1) });
    expect([once.x, once.y, once.z, once.yaw]).toEqual([released.x, released.y, released.z, released.yaw]);
    // Past the end the last pose holds.
    const after = endShot(40, a);
    expect([after.x, after.y, after.z, after.yaw, after.pitch]).toEqual([end.x, end.y, end.z, end.yaw, end.pitch]);
  });
});

describe("the car", () => {
  it("stands parked at the site, square to the road, to the pull-away at 2.6 s", () => {
    expect(endCar(2.6, road, site, 1)).toEqual({ x: 6.9, y: 0, z: 0, yaw: 0, wheelSpin: 0, doorOpen: 0, wheelTurn: 0, steer: 0, handset: "cradle" });
    expect(endCar(0, road, site, -1)).toEqual({ x: 6.9, y: 0, z: 0, yaw: Math.PI, wheelSpin: 0, doorOpen: 0, wheelTurn: 0, steer: 0, handset: "cradle" });
    expect(carSpeed(2.6)).toBe(0);
  });

  it("pulls away at 3.5 m/s² to 14 m/s: 7 m at 4.6 s, 28 m at 6.6 s, 42 m at 7.6 s", () => {
    expect(carDistance(4.6)).toBeCloseTo(7, 9);
    expect(carDistance(6.6)).toBeCloseTo(28, 9);
    expect(carDistance(7.6)).toBeCloseTo(42, 9);
    expect(carSpeed(4.6)).toBeCloseTo(7, 9);
    expect(carSpeed(6.6)).toBeCloseTo(14, 9);
    expect(carSpeed(9)).toBe(14);
    expect(endCar(4.6, road, site, 1).z).toBeCloseTo(7, 9);
    expect(endCar(7.6, road, site, 1).z).toBeCloseTo(42, 9);
    expect(endCar(7.6, road, site, -1).z).toBeCloseTo(-42, 9);
    expect(endCar(7.6, road, site, 1).wheelSpin).toBeCloseTo(120.68965517241381, 9);
  });

  it("eases off the shoulder onto its lane over the first 30 m, on the same side of the road either way it faces", () => {
    expect([0, 15, 30, 60].map((d) => laneAt(d, 6.9))).toEqual([6.9, expect.closeTo(4.35, 9), expect.closeTo(1.8, 9), expect.closeTo(1.8, 9)]);
    expect([0, 15, 30].map((d) => laneAt(d, -6.9))).toEqual([-6.9, expect.closeTo(-4.35, 9), expect.closeTo(-1.8, 9)]);
    // The same x on the inland side, driving either way.
    expect(endCar(4.6, road, site, 1).x).toBeCloseTo(6.196577777777779, 9);
    expect(endCar(4.6, road, site, -1).x).toBeCloseTo(6.196577777777779, 9);
    expect(endCar(7.6, road, site, 1).x).toBeCloseTo(1.8, 9);
    expect(endCar(7.6, road, site, -1).x).toBeCloseTo(1.8, 9);
  });

  it("heads along the road the way it faces, angled across by the lane change, and straight once in its lane", () => {
    expect(endCar(4.6, road, site, 1).yaw).toBeCloseTo(-0.18048116140626563, 9);
    expect(endCar(4.6, road, site, -1).yaw).toBeCloseTo(3.3220738149960587, 9);
    expect(endCar(7.6, road, site, 1).yaw).toBeCloseTo(0, 9);
    expect(endCar(7.6, road, site, -1).yaw).toBeCloseTo(3.141592653589793, 9);
  });

  it("puts the door on the car's inland side, ahead of its centre the way it faces", () => {
    expect(doorSpot(site, 1)).toEqual({ x: 8.4, z: 0.5 });
    expect(doorSpot(site, -1)).toEqual({ x: 8.4, z: -0.5 });
  });

  it("lights its headlamps at its nose, 1.2 m apart and 0.7 m up, aimed ahead and 0.1 rad down", () => {
    const out: LampAim = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };
    expect(headlampAt({ x: 6.9, y: 0, z: 0, yaw: 0 }, 1, out)).toEqual({
      x: 7.5, y: 0.7, z: 2.3, dx: 0, dy: expect.closeTo(-0.09983341664682815, 12), dz: expect.closeTo(0.9950041652780257, 12),
    });
    const back = headlampAt({ x: 6.9, y: 0, z: 0, yaw: Math.PI }, -1, out);
    expect([back.x, back.y, back.z, back.dz]).toEqual([expect.closeTo(7.5, 9), 0.7, expect.closeTo(-2.3, 9), expect.closeTo(-0.9950041652780257, 12)]);
  });

  it("is heard from the camera in the ear's own frame, as far from it as it is", () => {
    const out = { x: 0, y: 0, z: 0 };
    expect(carHeard({ x: 0, y: 1, z: 0, fx: 0, fy: 0, fz: 1 }, { x: 3, y: 1, z: 4 }, out)).toEqual({ x: 3, y: 0, z: 4 });
    const down = carHeard({ x: 0, y: 14, z: 0, fx: 0, fy: -Math.sin(1.55), fz: Math.cos(1.55) }, { x: 0, y: 0, z: 10 }, out);
    expect(down.x).toBeCloseTo(0, 9);
    expect(down.y).toBeCloseTo(9.706710052650276, 9);
    expect(down.z).toBeCloseTo(14.204920976681922, 9);
    expect(Math.hypot(down.x, down.y, down.z)).toBeCloseTo(17.204650534085253, 9);
  });
});

describe("the arrival and the beats", () => {
  it("arrives within 0.9 m of the door, or at the run's 10 s cap", () => {
    const at = { x: 0, z: 0 };
    expect(arrived({ x: 0.9, z: 0 }, at, 1)).toBe(true);
    expect(arrived({ x: 0, z: -0.91 }, at, 1)).toBe(false);
    expect(arrived({ x: 30, z: 0 }, at, 9.9)).toBe(false);
    expect(arrived({ x: 30, z: 0 }, at, 10)).toBe(true);
  });

  it("pulls away 2.6 s after the arrival, the title at 7.5 s, the dark at 15.5 s, the landing at 20.5 s; nothing before it", () => {
    const none = { title: false, fade: false, landing: false, pullAway: false };
    expect(endBeats(5, null)).toEqual(none);
    expect(endBeats(0.5, 1)).toEqual(none);
    expect(endBeats(3.5, 1)).toEqual({ title: false, fade: false, landing: false, pullAway: false });
    expect(endBeats(3.6, 1)).toEqual({ title: false, fade: false, landing: false, pullAway: true });
    expect(endBeats(8.5, 1)).toEqual({ title: true, fade: false, landing: false, pullAway: true });
    expect(endBeats(16.5, 1)).toEqual({ title: true, fade: true, landing: false, pullAway: true });
    expect(endBeats(21.5, 1)).toEqual({ title: true, fade: true, landing: true, pullAway: true });
    expect(endBeats(21.4, 1)).toEqual({ title: true, fade: true, landing: false, pullAway: true });
  });
});
