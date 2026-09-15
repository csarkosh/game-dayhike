import { describe, expect, it } from "vitest";
import { createWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { Button, NO_CARRIER, NO_ITEM, Outcome, type InputCommand } from "../../src/sim/types.js";
import { PLAYER_HALF, RESPAWN_SECONDS } from "../../src/sim/constants.js";
import {
  CAR_RADIUS, ITEM_INTERACTABLE_BASE, ITEM_RADIUS, SIGN_OUT_TICKS,
  installRegister, pickUp, putDown, retrievedCount, signedOutCount, type Register,
} from "../../src/sim/register.js";
import { resolveInteract } from "../../src/sim/interact.js";

const flat = parseLevel({
  id: "flat",
  brushes: [{ min: [-200, -1, -200], max: [200, 0, 200], material: "concrete" }],
  playerSpawns: [[0, 0.9, 0], [0, 0.9, -5]],
  enemySpawns: [],
});
const input = (over: Partial<InputCommand> = {}): InputCommand =>
  ({ seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over });

/** Two hikers: one at (0, 0, 20), one at (40, 0, 0); the box at (0, 1, -20), the car at (30, 0.8, -20). */
function register(): Register {
  const site = (kind: "summit" | "meadow", name: string, x: number, z: number) =>
    ({ kind, name, x, y: 0, z, progress: 1 });
  return {
    hikers: [
      { id: 0, name: "Dana Whitcombe", site: site("summit", "the summit", 0, 20) },
      { id: 1, name: "Owen Marsh", site: site("meadow", "the meadow", 40, 0) },
    ],
    box: { x: 0, y: 1, z: -20 },
    car: { x: 30, y: 0.8, z: -20 },
  };
}

function world() {
  const w = createWorld(flat, 1);
  installRegister(w, register());
  const p = spawnPlayer(w);
  for (let i = 0; i < 120; i++) tickWorld(w, new Map()); // land
  return { w, p };
}
/** Stands the player facing +z at (x, z), on the ground. */
function standAt(p: { pos: { x: number; y: number; z: number }; yaw: number; pitch: number }, x: number, z: number, yaw = 0) {
  p.pos = { x, y: 0.9, z }; p.yaw = yaw; p.pitch = 0;
}

describe("pick up and put down", () => {
  it("picks an item up when it is in reach and the hands are empty, and marks it retrieved once", () => {
    const { w, p } = world();
    standAt(p, 0, 18); // the summit item at z = 20 is 2 m ahead
    const target = resolveInteract(w, p);
    expect(target?.id).toBe(ITEM_INTERACTABLE_BASE);
    target!.onInteract(p.id);
    expect(p.carrying).toBe(0);
    expect(w.state.items[0]).toMatchObject({ carrier: p.id, pickedUp: true });
    expect(retrievedCount(w.state)).toBe(1);
    // Carried: nobody else can reach for it.
    tickWorld(w, new Map());
    expect(w.interactables.get(ITEM_INTERACTABLE_BASE)!.enabled).toBe(false);
  });

  it("refuses a second item while carrying, and a dead player altogether", () => {
    const { w, p } = world();
    pickUp(w, p.id, 0);
    pickUp(w, p.id, 1);
    expect(p.carrying).toBe(0);
    expect(w.state.items[1]!.carrier).toBe(NO_CARRIER);
    putDown(w, p);
    p.health = 0;
    pickUp(w, p.id, 1);
    expect(p.carrying).toBe(NO_ITEM);
  });

  it("puts the item down at the feet, where anyone can pick it up again without raising the count", () => {
    const { w, p } = world();
    pickUp(w, p.id, 0);
    standAt(p, 7, -3);
    putDown(w, p);
    expect(p.carrying).toBe(NO_ITEM);
    expect(w.state.items[0]).toMatchObject({ carrier: NO_CARRIER, pos: { x: 7, y: 0.9 - PLAYER_HALF.y + ITEM_RADIUS, z: -3 } });
    const other = spawnPlayer(w);
    pickUp(w, other.id, 0);
    expect(other.carrying).toBe(0);
    expect(retrievedCount(w.state)).toBe(1);
  });

  it("drops the carried item where a player dies", () => {
    const { w, p } = world();
    pickUp(w, p.id, 0);
    standAt(p, 12, 12);
    p.signOutTicks = 40;
    p.health = 0;
    tickWorld(w, new Map());
    expect(p.respawnTimer).toBeCloseTo(RESPAWN_SECONDS, 6);
    expect(p.carrying).toBe(NO_ITEM);
    expect(p.signOutTicks).toBe(0);
    expect(w.state.items[0]!.carrier).toBe(NO_CARRIER);
    expect(w.state.items[0]!.pos.x).toBeCloseTo(12, 6);
    expect(w.state.items[0]!.pos.z).toBeCloseTo(12, 6);
  });
});

describe("the sign-out", () => {
  const holding = (id: number) => new Map([[id, input({ buttons: Button.Interact })]]);

  it("signs the hiker out after SIGN_OUT_TICKS of Interact held at the box while carrying", () => {
    const { w, p } = world();
    pickUp(w, p.id, 0);
    standAt(p, 0, -22); // the box at z = -20 is 2 m ahead, at chest height
    for (let i = 0; i < SIGN_OUT_TICKS - 1; i++) tickWorld(w, holding(p.id));
    expect(p.signOutTicks).toBe(SIGN_OUT_TICKS - 1);
    expect(w.state.items[0]!.signedOut).toBe(false);
    tickWorld(w, holding(p.id));
    expect(w.state.items[0]!.signedOut).toBe(true);
    expect(p.carrying).toBe(NO_ITEM);
    expect(p.signOutTicks).toBe(0);
    expect(signedOutCount(w.state)).toBe(1);
    // Gone from the world: nothing to reach for.
    expect(w.interactables.get(ITEM_INTERACTABLE_BASE)!.enabled).toBe(false);
  });

  it("resets the hold when Interact is released, when the box leaves reach, and with empty hands", () => {
    const { w, p } = world();
    pickUp(w, p.id, 0);
    standAt(p, 0, -22);
    for (let i = 0; i < 100; i++) tickWorld(w, holding(p.id));
    expect(p.signOutTicks).toBe(100);
    tickWorld(w, new Map([[p.id, input()]]));
    expect(p.signOutTicks).toBe(0);
    for (let i = 0; i < 100; i++) tickWorld(w, holding(p.id));
    standAt(p, 0, -30);
    tickWorld(w, holding(p.id));
    expect(p.signOutTicks).toBe(0);
    standAt(p, 0, -22);
    putDown(w, p);
    for (let i = 0; i < 10; i++) tickWorld(w, holding(p.id));
    expect(p.signOutTicks).toBe(0);
  });
});

describe("the win", () => {
  it("is every hiker signed out and every living player at the car, and not before", () => {
    const { w, p } = world();
    const other = spawnPlayer(w);
    for (const item of w.state.items) item.signedOut = true;
    standAt(p, 30, -22);
    standAt(other, 100, 100);
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Playing);
    standAt(other, 30 + CAR_RADIUS - 0.5, -20);
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Won);
  });

  it("does not wait for the dead, and needs at least one living player", () => {
    const { w, p } = world();
    const other = spawnPlayer(w);
    for (const item of w.state.items) item.signedOut = true;
    standAt(p, 30, -22);
    other.health = 0;
    standAt(other, 100, 100);
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Won);
    const { w: w2, p: p2 } = world();
    for (const item of w2.state.items) item.signedOut = true;
    p2.health = 0;
    tickWorld(w2, new Map());
    expect(w2.state.outcome).toBe(Outcome.Playing);
  });

  it("needs every hiker, not most of them", () => {
    const { w, p } = world();
    w.state.items[0]!.signedOut = true;
    standAt(p, 30, -22);
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Playing);
  });
});

describe("a client's predicted world", () => {
  it("never runs the rules: the host decides who holds what", () => {
    const w = createWorld(flat, 1, false);
    installRegister(w, register());
    const p = spawnPlayer(w);
    pickUp(w, p.id, 0);
    standAt(p, 0, -22);
    for (let i = 0; i < SIGN_OUT_TICKS + 5; i++) tickWorld(w, new Map([[p.id, input({ buttons: Button.Interact })]]));
    expect(w.state.items[0]!.signedOut).toBe(false);
    expect(p.signOutTicks).toBe(0);
  });
});
