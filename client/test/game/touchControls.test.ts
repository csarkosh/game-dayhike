import { describe, it, expect } from "vitest";
import {
  createTouchModel,
  STICK_RADIUS,
  STICK_HIT_RADIUS,
  STICK_MARGIN,
  LOOK_RATE,
  DOUBLE_TAP_MS,
  TAP_MAX_MS,
  TAP_MAX_TRAVEL,
  IDLE_AFTER_MS,
  type TouchModel,
} from "../../src/game/touchControls.js";
import { Button } from "../../src/sim/types.js";

const VIEW = { width: 800, height: 400 };
/** The fixed stick's base, pinned where the tests below put their fingers. */
const BASE = { x: 100, y: 300, r: STICK_HIT_RADIUS };

function model(onPause: () => void = () => undefined): TouchModel {
  const m = createTouchModel(VIEW, { onPause });
  m.setStickBase(BASE);
  return m;
}

describe("stick", () => {
  it("takes a finger that lands on the base, anchored at the base centre, reading zero at the centre", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    expect(m.state.stick).toEqual({ anchorX: 100, anchorY: 300, dx: 0, dy: 0 });
    expect(m.moveX).toBe(0);
    expect(m.moveZ).toBe(0);
  });

  it("deflects at once when the finger lands off-centre on the base", () => {
    const m = model();
    m.down({ id: 1, x: 100 + STICK_RADIUS, y: 300, hit: "canvas" }, 0);
    expect(m.state.stick?.dx).toBeCloseTo(STICK_RADIUS, 5);
    expect(m.moveX).toBeCloseTo(1, 5);
  });

  it("ignores a finger outside the base, even on the left of the screen", () => {
    const m = model();
    m.down({ id: 1, x: 100 + STICK_HIT_RADIUS + 1, y: 300, hit: "canvas" }, 0);
    expect(m.state.stick).toBeNull();
    m.up(1, 5);
    m.down({ id: 2, x: 20, y: 60, hit: "canvas" }, 10);
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

  it("gives a second finger the look role while the stick is held, even one landing on the base", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.down({ id: 2, x: 120, y: 300, hit: "canvas" }, 10);
    m.move(2, 220, 300, 20);
    expect(m.state.stick?.anchorX).toBe(100);
    expect(m.state.stick?.dx).toBe(0);
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

describe("the default base", () => {
  it("sits at the bottom-left of the viewport and follows a resize until the layer measures it", () => {
    const m = createTouchModel(VIEW, { onPause: () => undefined });
    const cx = STICK_MARGIN + STICK_RADIUS;
    m.down({ id: 1, x: cx, y: VIEW.height - STICK_MARGIN - STICK_RADIUS, hit: "canvas" }, 0);
    expect(m.state.stick).toEqual({ anchorX: cx, anchorY: VIEW.height - STICK_MARGIN - STICK_RADIUS, dx: 0, dy: 0 });
    m.up(1, 5);
    m.resize({ width: 400, height: 800 });
    m.down({ id: 2, x: cx, y: VIEW.height - STICK_MARGIN - STICK_RADIUS, hit: "canvas" }, 10); // where it used to be
    expect(m.state.stick).toBeNull();
    m.up(2, 15);
    m.down({ id: 3, x: cx, y: 800 - STICK_MARGIN - STICK_RADIUS, hit: "canvas" }, 20);
    expect(m.state.stick?.anchorY).toBe(800 - STICK_MARGIN - STICK_RADIUS);
  });

  it("a measured base wins over the default and survives a resize", () => {
    const m = createTouchModel(VIEW, { onPause: () => undefined });
    m.setStickBase({ x: 500, y: 100, r: 40 });
    m.resize({ width: 400, height: 800 });
    m.down({ id: 1, x: 500, y: 100, hit: "canvas" }, 0);
    expect(m.state.stick?.anchorX).toBe(500);
  });
});

describe("sprint: double-tap and hold the stick", () => {
  it("sprints while the second stick finger stays down, inside the window", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.up(1, 80);
    m.down({ id: 2, x: 110, y: 300, hit: "canvas" }, 200);
    expect(m.sprinting).toBe(true);
    expect(m.takeButtons() & Button.Sprint).toBe(Button.Sprint);
    m.move(2, 160, 300, 220);
    expect(m.moveX).toBeGreaterThan(0);
    m.up(2, 900);
    expect(m.sprinting).toBe(false);
    expect(m.takeButtons() & Button.Sprint).toBe(0);
  });

  it("does not sprint when the second down is outside the window", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.up(1, 80);
    m.down({ id: 2, x: 110, y: 300, hit: "canvas" }, DOUBLE_TAP_MS + 1);
    expect(m.sprinting).toBe(false);
  });

  it("sprints when the second down lands at exactly DOUBLE_TAP_MS, since the check is <=", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.up(1, 80);
    m.down({ id: 2, x: 110, y: 300, hit: "canvas" }, DOUBLE_TAP_MS);
    expect(m.sprinting).toBe(true);
  });
});

describe("jump: double-tap the look zone", () => {
  it("latches one Jump edge on the second tap's down, taken once", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.up(1, 50);
    m.down({ id: 2, x: 602, y: 201, hit: "canvas" }, 200);
    expect(m.takeButtons() & Button.Jump).toBe(Button.Jump);
    expect(m.takeButtons() & Button.Jump).toBe(0);
  });

  it("does not jump when the first press was a drag", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.move(1, 600 + TAP_MAX_TRAVEL + 1, 200, 20);
    m.up(1, 50);
    m.down({ id: 2, x: 600, y: 200, hit: "canvas" }, 200);
    expect(m.takeButtons() & Button.Jump).toBe(0);
  });

  it("does not jump when the first press was held too long", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.up(1, TAP_MAX_MS + 1);
    m.down({ id: 2, x: 600, y: 200, hit: "canvas" }, TAP_MAX_MS + 100);
    expect(m.takeButtons() & Button.Jump).toBe(0);
  });

  it("does not jump on a single tap, and a third tap starts a new pair", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.up(1, 50);
    expect(m.takeButtons() & Button.Jump).toBe(0);
    m.down({ id: 2, x: 600, y: 200, hit: "canvas" }, 200);
    m.up(2, 250);
    expect(m.takeButtons() & Button.Jump).toBe(Button.Jump);
    m.down({ id: 3, x: 600, y: 200, hit: "canvas" }, 400);
    expect(m.takeButtons() & Button.Jump).toBe(0);
  });

  it("still looks while tapping: the drag of the second finger turns the camera", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.up(1, 50);
    m.down({ id: 2, x: 600, y: 200, hit: "canvas" }, 200);
    m.move(2, 640, 200, 220);
    expect(m.takeLook().yaw).toBeCloseTo(40 * LOOK_RATE, 9);
  });

  it("a cancelled look pointer never counts as a tap", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.cancel(1, 100); // within TAP_MAX_MS, but cancelled rather than released
    m.down({ id: 2, x: 600, y: 200, hit: "canvas" }, 200); // 100ms after the cancel
    expect(m.takeButtons() & Button.Jump).toBe(0);
  });

  it("a tap held for exactly TAP_MAX_MS still counts, since the check is <=", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.up(1, TAP_MAX_MS);
    m.down({ id: 2, x: 600, y: 200, hit: "canvas" }, 200);
    expect(m.takeButtons() & Button.Jump).toBe(Button.Jump);
  });
});

describe("buttons", () => {
  it("lamp latches one edge on release and reports pressed while down", () => {
    const m = model();
    m.down({ id: 1, x: 40, y: 200, hit: "lamp" }, 0);
    expect(m.state.lampPressed).toBe(true);
    expect(m.takeButtons() & Button.Lamp).toBe(0);
    m.up(1, 60);
    expect(m.state.lampPressed).toBe(false);
    expect(m.takeButtons() & Button.Lamp).toBe(Button.Lamp);
    expect(m.takeButtons() & Button.Lamp).toBe(0);
  });

  it("a cancelled lamp press toggles nothing and clears the pressed state", () => {
    const m = model();
    m.down({ id: 1, x: 40, y: 200, hit: "lamp" }, 0);
    m.cancel(1, 60);
    expect(m.takeButtons() & Button.Lamp).toBe(0);
    expect(m.state.lampPressed).toBe(false);
  });

  it("pause fires the hook on release, not on press", () => {
    let pauses = 0;
    const m = model(() => pauses++);
    m.down({ id: 1, x: 780, y: 20, hit: "pause" }, 0);
    expect(pauses).toBe(0);
    m.up(1, 60);
    expect(pauses).toBe(1);
  });

  it("a lamp press does not anchor the stick even when it lands on the base", () => {
    const m = model();
    m.down({ id: 1, x: 40, y: 200, hit: "lamp" }, 0);
    expect(m.state.stick).toBeNull();
  });

  it("interact from the prompt: an edge on down and the bit while held", () => {
    const m = model();
    m.interactDown();
    expect(m.takeButtons() & Button.Interact).toBe(Button.Interact);
    expect(m.takeButtons() & Button.Interact).toBe(Button.Interact);
    m.interactUp();
    expect(m.takeButtons() & Button.Interact).toBe(0);
  });

  it("mirrors the lamp state it is told", () => {
    const m = model();
    m.setLampOn(true);
    expect(m.state.lampOn).toBe(true);
  });
});

describe("idle", () => {
  it("is idle after three seconds without a touch and wakes on any down", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.up(1, 50);
    m.tick(IDLE_AFTER_MS);
    expect(m.state.idle).toBe(false);
    m.tick(IDLE_AFTER_MS + 51);
    expect(m.state.idle).toBe(true);
    m.down({ id: 2, x: 600, y: 200, hit: "canvas" }, IDLE_AFTER_MS + 60);
    expect(m.state.idle).toBe(false);
  });
});
