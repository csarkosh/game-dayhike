import { describe, expect, it } from "vitest";
import { createHostSession } from "../../src/net/hostSession.js";
import { parseLevel } from "../../src/sim/level.js";
import { Button, type InputCommand } from "../../src/sim/types.js";
import { spawnPlayer, createWorld } from "../../src/sim/world.js";

const flat = parseLevel({ id: "flat", brushes: [{ min: [-60, -1, -60], max: [60, 0, 60], material: "concrete" }], playerSpawns: [[0, 0.9, 0]], enemySpawns: [] });
const input = (over: Partial<InputCommand> = {}): InputCommand => ({ seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over });

describe("the headlamp", () => {
  it("spawns off with a full charge", () => {
    const p = spawnPlayer(createWorld(flat, 1));
    expect(p.lamp).toEqual({ on: false, charge: 1 });
  });
  it("toggles on the press edge and ignores the hold", () => {
    const host = createHostSession(flat, 1);
    const me = () => host.world.state.players.get(host.localEntityId)!.lamp.on;
    for (let i = 0; i < 4; i++) host.tick(input({ buttons: Button.Lamp }));
    expect(me()).toBe(true);
    host.tick(input());
    host.tick(input({ buttons: Button.Lamp }));
    expect(me()).toBe(false);
  });
  it("keeps its charge at 1 for now — no drain yet", () => {
    const host = createHostSession(flat, 1);
    host.tick(input({ buttons: Button.Lamp }));
    for (let i = 0; i < 600; i++) host.tick(input());
    expect(host.world.state.players.get(host.localEntityId)!.lamp.charge).toBe(1);
  });
});
