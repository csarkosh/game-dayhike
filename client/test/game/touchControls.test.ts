import { describe, it, expect } from "vitest";
import {
  createTouchModel,
  STICK_RADIUS,
  LOOK_RATE,
  type TouchModel,
} from "../../src/game/touchControls.js";

const VIEW = { width: 800, height: 400 };

function model(onPause = () => undefined): TouchModel {
  return createTouchModel(VIEW, { onPause });
}

describe("stick", () => {
  it("anchors where the first finger lands in the left 45% and reads zero until it moves", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    expect(m.state.stick).toEqual({ anchorX: 100, anchorY: 300, dx: 0, dy: 0 });
    expect(m.moveX).toBe(0);
    expect(m.moveZ).toBe(0);
  });

  it("does not anchor on a finger that lands right of the zone", () => {
    const m = model();
    m.down({ id: 1, x: 400, y: 300, hit: "canvas" }, 0); // 0.5 * width
    expect(m.state.stick).toBeNull();
  });

  it("maps the thumb offset to axes over the radius, screen-up being forward", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.move(1, 100 + STICK_RADIUS, 300 - STICK_RADIUS, 16);
    // Diagonal at the rim: magnitude clamps to 1, direction kept.
    expect(m.moveX).toBeCloseTo(Math.SQRT1_2, 5);
    expect(m.moveZ).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("reads zero inside the dead zone and ramps from its edge", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.move(1, 100 + STICK_RADIUS * 0.1, 300, 16);
    expect(m.moveX).toBe(0);
    m.move(1, 100 + STICK_RADIUS * 0.575, 300, 32); // halfway between dead zone and rim
    expect(m.moveX).toBeCloseTo(0.5, 5);
  });

  it("stops the drawn thumb at the rim while the finger keeps going", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.move(1, 100 + STICK_RADIUS * 3, 300, 16);
    expect(m.state.stick?.dx).toBeCloseTo(STICK_RADIUS, 5);
    expect(m.moveX).toBeCloseTo(1, 5);
  });

  it("clears on up and on cancel", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.move(1, 150, 300, 16);
    m.up(1, 32);
    expect(m.state.stick).toBeNull();
    expect(m.moveX).toBe(0);
    m.down({ id: 2, x: 100, y: 300, hit: "canvas" }, 40);
    m.move(2, 150, 300, 48);
    m.cancel(2, 56);
    expect(m.state.stick).toBeNull();
    expect(m.moveX).toBe(0);
  });

  it("gives a second finger in the zone the look role while the stick is held", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.down({ id: 2, x: 200, y: 300, hit: "canvas" }, 10);
    m.move(2, 300, 300, 20);
    expect(m.state.stick?.anchorX).toBe(100);
    expect(m.takeLook().yaw).toBeCloseTo(100 * LOOK_RATE, 9);
  });
});

describe("look", () => {
  it("accumulates drag in radians and drains once", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.move(1, 650, 180, 16);
    m.move(1, 660, 180, 32);
    expect(m.takeLook()).toEqual({ yaw: 60 * LOOK_RATE, pitch: -20 * LOOK_RATE });
    expect(m.takeLook()).toEqual({ yaw: 0, pitch: 0 });
  });

  it("keeps a released finger from moving the camera", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.up(1, 16);
    m.move(1, 700, 200, 32);
    expect(m.takeLook()).toEqual({ yaw: 0, pitch: 0 });
  });

  it("tracks pointers by id, so a stick thumb and a look finger never swap", () => {
    const m = model();
    m.down({ id: 7, x: 100, y: 300, hit: "canvas" }, 0);
    m.down({ id: 9, x: 600, y: 200, hit: "canvas" }, 5);
    m.move(9, 620, 200, 10);
    m.move(7, 130, 300, 10);
    expect(m.state.stick?.dx).toBe(30);
    expect(m.takeLook().yaw).toBeCloseTo(20 * LOOK_RATE, 9);
  });
});

describe("resize", () => {
  it("re-evaluates the stick zone against the new width", () => {
    const m = model();
    m.resize({ width: 400, height: 800 });
    m.down({ id: 1, x: 190, y: 700, hit: "canvas" }, 0); // 0.475 of 400: outside
    expect(m.state.stick).toBeNull();
    m.up(1, 5);
    m.down({ id: 2, x: 170, y: 700, hit: "canvas" }, 10); // 0.425: inside
    expect(m.state.stick?.anchorX).toBe(170);
  });
});
