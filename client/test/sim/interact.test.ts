import { describe, expect, it } from "vitest";
import { parseLevel } from "../../src/sim/level.js";
import { createWorld, spawnPlayer } from "../../src/sim/world.js";
import {
  INTERACT_REACH, pressedEdges, resolveInteract, type Interactable,
} from "../../src/sim/interact.js";
import { PLAYER_EYE_OFFSET } from "../../src/sim/constants.js";
import { Button } from "../../src/sim/types.js";

const flat = parseLevel({
  id: "flat",
  brushes: [{ min: [-60, -1, -60], max: [60, 0, 60], material: "concrete" }],
  playerSpawns: [[0, 0.9, 0]],
  enemySpawns: [],
});

function worldWith(...items: Omit<Interactable, "onInteract">[]) {
  const world = createWorld(flat, 1);
  const hits: number[] = [];
  for (const it of items) world.interactables.set(it.id, { ...it, onInteract: (p) => hits.push(p * 1000 + it.id) });
  const player = spawnPlayer(world);
  player.pos = { x: 0, y: 0.9, z: 0 }; player.yaw = 0; player.pitch = 0; // eye at (0, 1.6, 0) looking +Z
  return { world, player, hits };
}

describe("pressedEdges", () => {
  it("reports only the bits that turned on", () => {
    expect(pressedEdges(0, Button.Interact)).toBe(Button.Interact);
    expect(pressedEdges(Button.Interact, Button.Interact)).toBe(0);
    expect(pressedEdges(Button.Interact, 0)).toBe(0);
    expect(pressedEdges(Button.Jump, Button.Jump | Button.Lamp)).toBe(Button.Lamp);
  });
});

describe("resolveInteract", () => {
  it("returns null with nothing registered", () => {
    const { world, player } = worldWith();
    expect(resolveInteract(world, player)).toBeNull();
  });
  it("finds a thing straight ahead within reach", () => {
    const { world, player } = worldWith({ id: 7, pos: { x: 0, y: 1.6, z: 2 }, radius: 0.3, kind: 1 });
    expect(resolveInteract(world, player)?.id).toBe(7);
  });
  it("ignores a thing beyond reach, measured to its surface", () => {
    const far = { id: 7, pos: { x: 0, y: 1.6, z: INTERACT_REACH + 0.3 + 0.05 }, radius: 0.3, kind: 1 };
    expect(resolveInteract(worldWith(far).world, worldWith(far).player)).toBeNull();
    const near = { ...far, pos: { x: 0, y: 1.6, z: INTERACT_REACH + 0.3 - 0.05 } };
    const w = worldWith(near); expect(resolveInteract(w.world, w.player)?.id).toBe(7);
  });
  it("ignores a thing outside the facing cone", () => {
    // 2 m ahead but 2 m to the side is 45° off the ray — past the 35° cone.
    const w = worldWith({ id: 7, pos: { x: 2, y: 1.6, z: 2 }, radius: 0.3, kind: 1 });
    expect(resolveInteract(w.world, w.player)).toBeNull();
  });
  it("picks the nearest of two in reach", () => {
    const w = worldWith(
      { id: 1, pos: { x: 0, y: 1.6, z: 2.2 }, radius: 0.2, kind: 1 },
      { id: 2, pos: { x: 0, y: 1.6, z: 1.2 }, radius: 0.2, kind: 1 },
    );
    expect(resolveInteract(w.world, w.player)?.id).toBe(2);
  });
  it("measures from the eye, not the feet", () => {
    // Directly above the eye line by 1.4 m at 1 m out is 54° up — out of the cone
    // from the eye, but it would be inside a cone drawn from the feet.
    const w = worldWith({ id: 7, pos: { x: 0, y: 0.9 + PLAYER_EYE_OFFSET + 1.4, z: 1 }, radius: 0.1, kind: 1 });
    expect(resolveInteract(w.world, w.player)).toBeNull();
  });
  it("resolves the debug pad marker geometry app.ts registers, facing +X", () => {
    // The exact fixture app.ts uses for the trailhead pad marker: a player at
    // the origin turned to face +X (yaw = PI/2) finds it dead ahead in reach.
    const w = worldWith({ id: 1, pos: { x: 2, y: 1.6, z: 0 }, radius: 0.5, kind: 0 });
    w.player.yaw = Math.PI / 2;
    expect(resolveInteract(w.world, w.player)?.id).toBe(1);
  });
});
