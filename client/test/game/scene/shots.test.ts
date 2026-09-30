import { describe, expect, it } from "vitest";
import { FILM_FOV, FOV_MAX, FOV_MIN, cutList, ease, fade, follow, hold, holdLookingAt, lookAt, push } from "../../../src/game/scene/shots.js";

describe("shots", () => {
  it("looks from a point at a point: yaw 0 faces +z, positive pitch looks down", () => {
    const ahead = lookAt({ x: 0, y: 2, z: 0 }, { x: 0, y: 2, z: 10 });
    expect(ahead.yaw).toBe(0);
    expect(ahead.pitch).toBe(0);
    expect(ahead.fov).toBe(FILM_FOV);
    const right = lookAt({ x: 0, y: 2, z: 0 }, { x: 10, y: 2, z: 0 });
    expect(right.yaw).toBeCloseTo(Math.PI / 2, 6);
    const down = lookAt({ x: 0, y: 12, z: 0 }, { x: 0, y: 2, z: 10 });
    expect(down.pitch).toBeCloseTo(Math.PI / 4, 6);
    expect(FILM_FOV).toBe(0.43);
    expect(FOV_MIN).toBe(0.1);
    expect(FOV_MAX).toBe(0.57);
  });

  it("holds a pose, and holds a point of view on a moving target", () => {
    const p = lookAt({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 30 }, 0.3);
    expect(hold(p)(5)).toEqual(p);
    const track = holdLookingAt({ x: 0, y: 2, z: 0 }, (t) => ({ x: 10, y: 2, z: 10 * t }), 0.3);
    expect(track(0).yaw).toBeCloseTo(Math.PI / 2, 6);
    expect(track(1).yaw).toBeCloseTo(Math.PI / 4, 6);
  });

  it("follows a target with an offset in its own frame", () => {
    const car = (t: number) => ({ x: 5, y: 0, z: 10 * t, yaw: 0 });
    const behind = follow(car, () => ({ x: -2, y: 1.5, z: -8 }));
    const f = behind(1);
    expect(f.x).toBe(3);
    expect(f.y).toBe(1.5);
    expect(f.z).toBe(2);
    expect(f.yaw).toBe(0);
    const turned = follow(() => ({ x: 0, y: 0, z: 0, yaw: Math.PI / 2 }), () => ({ x: 0, y: 1, z: -8 }));
    expect(turned(0).x).toBeCloseTo(-8, 6);
    expect(turned(0).z).toBeCloseTo(0, 6);
  });

  it("pushes from a point to a point over its seconds with an ease, then holds", () => {
    const p = push({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 4 }, 2, { x: 0, y: 1, z: 100 });
    expect(p(0).z).toBe(0);
    expect(p(1).z).toBe(2);
    expect(p(2).z).toBe(4);
    expect(p(3).z).toBe(4);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(0.25)).toBe(0.15625);
  });

  it("cuts between shots by time, each shot's clock starting at its cut", () => {
    const a = hold(lookAt({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 }));
    const b = push({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, 5, { x: 0, y: 1, z: 100 });
    const camera = cutList([{ from: 0, to: 3, shot: a }, { from: 3, to: 8, shot: b }]);
    expect(camera(2).z).toBe(0);
    expect(camera(3).z).toBe(0);
    expect(camera(5.5).z).toBe(5);
    expect(camera(20).z).toBe(10);
  });

  it("fades in from black and out to black", () => {
    const black = fade(2, 57, 60);
    expect(black(0)).toBe(1);
    expect(black(1)).toBe(0.5);
    expect(black(30)).toBe(0);
    expect(black(58.5)).toBe(0.5);
    expect(black(60)).toBe(1);
  });
});
