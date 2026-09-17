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
  FLICK_MIN_SPEED,
  FLICK_FULL_SPEED,
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

/**
 * A look drag at a steady speed in CSS px/s, one move per 60 Hz frame, lifted a
 * frame after the last move. The lift frame counts toward the release speed, so
 * it reads about a sixth under `vx`. Returns the lift time.
 */
function swipe(
  m: TouchModel,
  o: { id?: number; vx: number; vy?: number; at?: number; frames?: number; holdMs?: number },
): number {
  const id = o.id ?? 1;
  const at = o.at ?? 0;
  const frames = o.frames ?? 6;
  const step = 1000 / 60;
  m.down({ id, x: 400, y: 200, hit: "canvas" }, at);
  let t = at;
  for (let i = 1; i <= frames; i++) {
    t = at + i * step;
    m.move(id, 400 + (o.vx * (i * step)) / 1000, 200 + ((o.vy ?? 0) * (i * step)) / 1000, t);
  }
  const liftAt = t + (o.holdMs ?? step);
  m.up(id, liftAt);
  m.takeLook(); // the drag itself; only the coast is left to measure
  return liftAt;
}

/** Ticks from `from` for `ms` at `fps`, draining look each frame; the summed turn. */
function coast(m: TouchModel, from: number, ms: number, fps = 60): { yaw: number; pitch: number } {
  const total = { yaw: 0, pitch: 0 };
  const frames = Math.round((ms * fps) / 1000);
  for (let i = 1; i <= frames; i++) {
    m.tick(from + (i * 1000) / fps);
    const look = m.takeLook();
    total.yaw += look.yaw;
    total.pitch += look.pitch;
  }
  return total;
}

describe("flick: a fast look swipe keeps turning after the lift", () => {
  it("a slow swipe stops dead on the lift", () => {
    const m = model();
    const lift = swipe(m, { vx: FLICK_MIN_SPEED * 0.75 });
    expect(coast(m, lift, 2000)).toEqual({ yaw: 0, pitch: 0 });
  });

  it("a fast flick keeps turning the way the finger went, on both axes", () => {
    const m = model();
    const lift = swipe(m, { vx: -1500, vy: -600 });
    const turn = coast(m, lift, 2000);
    expect(turn.yaw).toBeLessThan(-0.5);
    expect(turn.pitch).toBeLessThan(0);
  });

  it("turns further the harder the flick", () => {
    const medium = model();
    const hard = model();
    const a = coast(medium, swipe(medium, { vx: 1200 }), 3000).yaw;
    const b = coast(hard, swipe(hard, { vx: 2200 }), 3000).yaw;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a * 1.5);
  });

  it("a swipe just over the floor barely coasts, so there is no step at the threshold", () => {
    const soft = model();
    const firm = model();
    const barely = coast(soft, swipe(soft, { vx: FLICK_MIN_SPEED * 1.3 }), 3000).yaw;
    const full = coast(firm, swipe(firm, { vx: FLICK_FULL_SPEED * 1.2 }), 3000).yaw;
    expect(barely).toBeGreaterThan(0);
    expect(barely).toBeLessThan(full * 0.1);
  });

  it("lingers, then comes to rest", () => {
    const m = model();
    const lift = swipe(m, { vx: 2000 });
    expect(coast(m, lift, 150).yaw).toBeGreaterThan(0);
    coast(m, lift + 150, 3000);
    expect(coast(m, lift + 3150, 1000)).toEqual({ yaw: 0, pitch: 0 });
  });

  it("turns the same amount whatever the frame rate", () => {
    const slow = model();
    const fast = model();
    const a = coast(slow, swipe(slow, { vx: 1800 }), 4000, 30).yaw;
    const b = coast(fast, swipe(fast, { vx: 1800 }), 4000, 144).yaw;
    expect(Math.abs(a - b)).toBeLessThan(a * 0.02);
  });

  it("does not coast when the finger stopped before it lifted", () => {
    const m = model();
    const lift = swipe(m, { vx: 2000, holdMs: 80 });
    expect(coast(m, lift, 2000)).toEqual({ yaw: 0, pitch: 0 });
  });

  it("does not coast from a cancelled pointer", () => {
    const m = model();
    m.down({ id: 1, x: 400, y: 200, hit: "canvas" }, 0);
    m.move(1, 440, 200, 16);
    m.move(1, 480, 200, 32);
    m.cancel(1, 40);
    m.takeLook();
    expect(coast(m, 40, 2000)).toEqual({ yaw: 0, pitch: 0 });
  });

  it("does not coast from a quick tap that shifted a few px", () => {
    const m = model();
    m.down({ id: 1, x: 400, y: 200, hit: "canvas" }, 0);
    m.move(1, 400 + TAP_MAX_TRAVEL - 1, 200, 5);
    m.up(1, 8);
    m.takeLook();
    expect(coast(m, 8, 2000)).toEqual({ yaw: 0, pitch: 0 });
  });

  it("a new finger in the look zone catches the spin", () => {
    const m = model();
    const lift = swipe(m, { vx: 2000 });
    coast(m, lift, 50);
    m.down({ id: 2, x: 500, y: 200, hit: "canvas" }, lift + 60);
    expect(coast(m, lift + 60, 2000)).toEqual({ yaw: 0, pitch: 0 });
  });

  it("the stick and the lamp leave the spin alone", () => {
    const m = model();
    const lift = swipe(m, { vx: 2000 });
    m.down({ id: 2, x: 100, y: 300, hit: "canvas" }, lift + 5);
    m.down({ id: 3, x: 0, y: 0, hit: "lamp" }, lift + 5);
    expect(coast(m, lift, 500).yaw).toBeGreaterThan(0);
  });

  it("stopCoast ends the spin, for the pause menu", () => {
    const m = model();
    const lift = swipe(m, { vx: 2000 });
    coast(m, lift, 50);
    m.stopCoast();
    expect(coast(m, lift + 50, 2000)).toEqual({ yaw: 0, pitch: 0 });
  });
});
