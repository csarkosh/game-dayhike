import { describe, expect, it } from "vitest";
import { parseLevel } from "../../src/sim/level.js";
import { createWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { targetPopulation } from "../../src/sim/director.js";
import type { InputCommand } from "../../src/sim/types.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

describe("the director, switched off for now", () => {
  it("wants no enemies for any number of players", () => {
    for (let n = 0; n <= 8; n++) expect(targetPopulation(n)).toBe(0);
  });
  it("spawns nothing over ten seconds on a level that has spawn points", () => {
    const world = createWorld(parseLevel(sandbox01), 42);
    const p = spawnPlayer(world);
    const inputs = new Map<number, InputCommand>([[p.id, { seq: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 }]]);
    for (let i = 0; i < 600; i++) tickWorld(world, inputs);
    expect(world.state.enemies.size).toBe(0);
  });
});
