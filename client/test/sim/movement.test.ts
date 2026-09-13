import { describe, it, expect } from "vitest";
import { stepMovement, wishDirection, type MoveState } from "../../src/sim/movement.js";
import type { Aabb } from "../../src/sim/level.js";
import type { InputCommand } from "../../src/sim/types.js";
import { Button } from "../../src/sim/types.js";
import { TICK_DT, WALK_SPEED, SPRINT_SPEED } from "../../src/sim/constants.js";

const floor: Aabb = { min: { x: -50, y: -1, z: -50 }, max: { x: 50, y: 0, z: 50 } };
const ledge: Aabb = { min: { x: 5, y: 0, z: -10 }, max: { x: 15, y: 0.45, z: 10 } };
const tallWall: Aabb = { min: { x: 5, y: 0, z: -10 }, max: { x: 15, y: 3, z: 10 } };
const sideWall: Aabb = { min: { x: -50, y: 0, z: 5 }, max: { x: 50, y: 3, z: 6 } };

function input(over: Partial<InputCommand> = {}): InputCommand {
  return { seq: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over };
}

function onGround(x = 0, z = 0): MoveState {
  return { pos: { x, y: 0.9, z }, vel: { x: 0, y: 0, z: 0 }, grounded: true };
}

function run(state: MoveState, cmd: InputCommand, boxes: Aabb[], ticks: number): MoveState {
  let s = state;
  for (let i = 0; i < ticks; i++) s = stepMovement(s, cmd, TICK_DT, boxes);
  return s;
}

describe("wishDirection", () => {
  it("faces +Z at yaw 0", () => {
    const d = wishDirection(0, 1, 0);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(1, 6);
  });

  it("strafes toward +X at yaw 0", () => {
    const d = wishDirection(1, 0, 0);
    expect(d.x).toBeCloseTo(1, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it("rotates forward toward +X at yaw 90 degrees", () => {
    const d = wishDirection(0, 1, Math.PI / 2);
    expect(d.x).toBeCloseTo(1, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it("clamps diagonal input so it is never faster than straight", () => {
    const d = wishDirection(1, 1, 0);
    expect(Math.sqrt(d.x * d.x + d.z * d.z)).toBeCloseTo(1, 6);
  });
});

describe("gravity and ground", () => {
  it("falls and comes to rest on the floor", () => {
    const s = run(
      { pos: { x: 0, y: 5, z: 0 }, vel: { x: 0, y: 0, z: 0 }, grounded: false },
      input(),
      [floor],
      120,
    );
    expect(s.pos.y).toBeGreaterThan(0.89);
    expect(s.pos.y).toBeLessThan(0.91);
    expect(s.grounded).toBe(true);
    expect(s.vel.y).toBeCloseTo(0, 6);
  });

  it("does not sink through the floor over a long idle", () => {
    const s = run(onGround(), input(), [floor], 600);
    expect(s.pos.y).toBeGreaterThan(0.89);
    expect(s.grounded).toBe(true);
  });
});

describe("running", () => {
  it("accelerates to walk speed and no further", () => {
    const s = run(onGround(), input({ moveZ: 1 }), [floor], 180);
    expect(Math.sqrt(s.vel.x * s.vel.x + s.vel.z * s.vel.z)).toBeCloseTo(WALK_SPEED, 3);
    expect(s.pos.z).toBeGreaterThan(15);
  });

  it("sprints to the higher cap, and drops back to the walk when released", () => {
    const speedOf = (st: MoveState): number =>
      Math.sqrt(st.vel.x * st.vel.x + st.vel.z * st.vel.z);

    const sprinting = run(
      onGround(),
      input({ moveZ: 1, buttons: Button.Sprint }),
      [floor],
      180,
    );
    expect(speedOf(sprinting)).toBeCloseTo(SPRINT_SPEED, 3);
    expect(SPRINT_SPEED).toBeGreaterThan(WALK_SPEED);

    // Releasing sprint does not teleport you back down: friction bleeds the
    // excess off, so the speed falls to the walk cap rather than snapping.
    const released = run(sprinting, input({ moveZ: 1 }), [floor], 180);
    expect(speedOf(released)).toBeCloseTo(WALK_SPEED, 3);
  });

  it("carries a sprint into a jump rather than bleeding it off midair", () => {
    // AIR_ACCEL is tiny, so this is about the cap not clamping you down while
    // your feet are off the ground — not about gaining speed in the air.
    const sprinting = run(
      onGround(),
      input({ moveZ: 1, buttons: Button.Sprint }),
      [floor],
      180,
    );
    const airborne = run(
      sprinting,
      input({ moveZ: 1, buttons: Button.Sprint | Button.Jump }),
      [floor],
      6,
    );
    expect(airborne.grounded).toBe(false);
    const speed = Math.sqrt(airborne.vel.x * airborne.vel.x + airborne.vel.z * airborne.vel.z);
    expect(speed).toBeGreaterThan(WALK_SPEED);
  });

  it("stops at a wall instead of passing through", () => {
    const s = run(onGround(), input({ moveZ: 1 }), [floor, sideWall], 180);
    // Wall face at z=5, player half-depth 0.4, so contact rests near z=4.6.
    expect(s.pos.z).toBeGreaterThan(4.5);
    expect(s.pos.z).toBeLessThan(4.61);
    expect(s.grounded).toBe(true);
  });

  it("slides along a wall approached diagonally", () => {
    const s = run(onGround(), input({ moveX: 1, moveZ: 1 }), [floor, sideWall], 180);
    expect(s.pos.z).toBeLessThan(4.61);
    expect(s.pos.x).toBeGreaterThan(10);
  });
});

describe("step-up", () => {
  it("climbs a 0.45m ledge and stands on top of it", () => {
    // 90 ticks is far enough to mount the ledge but not walk off its far end.
    const s = run(onGround(), input({ moveX: 1 }), [floor, ledge], 90);
    expect(s.pos.x).toBeGreaterThan(5);
    // Ledge top 0.45 + half-height 0.9 + skin
    expect(s.pos.y).toBeGreaterThan(1.34);
    expect(s.pos.y).toBeLessThan(1.36);
    expect(s.grounded).toBe(true);
  });

  it("walks off the far end of the ledge and lands back on the floor", () => {
    const s = run(onGround(), input({ moveX: 1 }), [floor, ledge], 200);
    expect(s.pos.x).toBeGreaterThan(15.4);
    expect(s.pos.y).toBeGreaterThan(0.89);
    expect(s.pos.y).toBeLessThan(0.91);
  });

  it("never climbs a 3m wall", () => {
    let s = onGround();
    let maxY = s.pos.y;
    for (let i = 0; i < 300; i++) {
      s = stepMovement(s, input({ moveX: 1 }), TICK_DT, [floor, tallWall]);
      maxY = Math.max(maxY, s.pos.y);
    }
    expect(s.pos.x).toBeLessThan(4.61);
    expect(maxY).toBeLessThan(0.91);
  });
});

describe("jumping", () => {
  it("rises then lands back on the floor", () => {
    let s = stepMovement(onGround(), input({ buttons: Button.Jump }), TICK_DT, [floor]);
    let peak = s.pos.y;
    for (let i = 0; i < 120; i++) {
      s = stepMovement(s, input(), TICK_DT, [floor]);
      peak = Math.max(peak, s.pos.y);
    }
    expect(peak).toBeGreaterThan(2.0);
    expect(peak).toBeLessThan(2.3);
    expect(s.grounded).toBe(true);
    expect(s.pos.y).toBeLessThan(0.91);
  });

  it("cannot jump while airborne", () => {
    let s = stepMovement(onGround(), input({ buttons: Button.Jump }), TICK_DT, [floor]);
    const airborne = { ...s };
    s = stepMovement(airborne, input({ buttons: Button.Jump }), TICK_DT, [floor]);
    expect(s.vel.y).toBeLessThan(airborne.vel.y);
  });
});

describe("determinism", () => {
  it("produces identical results from identical inputs", () => {
    const start: MoveState = { pos: { x: 0, y: 5, z: 0 }, vel: { x: 0, y: 0, z: 0 }, grounded: false };
    const cmd = input({ moveX: 0.5, moveZ: 1 });
    const a = run({ ...start, pos: { ...start.pos }, vel: { ...start.vel } }, cmd, [floor, ledge], 600);
    const b = run({ ...start, pos: { ...start.pos }, vel: { ...start.vel } }, cmd, [floor, ledge], 600);
    expect(a).toEqual(b);
  });

  it("does not mutate the state passed in", () => {
    const s = onGround();
    const before = JSON.stringify(s);
    stepMovement(s, input({ moveZ: 1 }), TICK_DT, [floor]);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("wading", () => {
  function terminalSpeed(waterLevel: number | null): number {
    let s = onGround();
    const cmd = input({ moveZ: 1 });
    for (let i = 0; i < 240; i++) {
      s = stepMovement(s, cmd, TICK_DT, [floor], undefined, waterLevel);
    }
    return Math.sqrt(s.vel.x * s.vel.x + s.vel.z * s.vel.z);
  }

  it("feet at the waterline lose nothing, and null means dry", () => {
    // The dry path itself must be bit-untouched — that is proven by every
    // pre-existing movement test, which still calls stepMovement WITHOUT the
    // new argument. Here: waterline exactly at the feet is submergence 0.
    expect(terminalSpeed(0)).toBeCloseTo(terminalSpeed(null), 10);
  });

  it("full submergence scales speed to the wade floor", () => {
    const ratio = terminalSpeed(1.3) / terminalSpeed(null);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.5);
  });

  it("half submergence sits between", () => {
    const ratio = terminalSpeed(0.65) / terminalSpeed(null);
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(0.85);
  });
});
