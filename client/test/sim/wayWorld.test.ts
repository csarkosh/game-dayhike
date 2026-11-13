import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, createWorld, spawnPlayer, tickWorld, type World } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { seedFromToken } from "../../src/game/seed.js";
import { DEFAULT_TERRAIN_VARIANT, elevationAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { Phase } from "../../src/sim/types.js";
import { drawWayNow, stepWay, wayOf } from "../../src/sim/wayDraw.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
const seed = seedFromToken("hollow");
const SUITE = { timeout: timeLimit(120_000) };
const forestWorld = (authoritative = true): World => createForestWorld(createForest(seed), authoritative);
const tick = (w: World, n: number): void => { for (let i = 0; i < n; i++) tickWorld(w, new Map()); };

describe("the world's way down", SUITE, () => {
  it("a forest world starts with a draw waiting and no way, on the host and on a client", () => {
    for (const w of [forestWorld(), forestWorld(false)]) {
      expect(w.way).toBeNull();
      expect(w.wayDraw).not.toBeNull();
    }
  });

  it("stepWay spends its budget, finishes over several calls, and leaves the way drawNow gives", () => {
    const w = forestWorld();
    // A clock that moves half a millisecond each time it is read.
    let t = 0, calls = 0;
    const now = (): number => (t += 0.5);
    while (!stepWay(w, 1.5, now)) calls++;
    expect(calls).toBeGreaterThan(2);
    expect(w.wayDraw).toBeNull();
    const whole = drawWayNow(forestWorld())!;
    expect(Array.from(w.way!.xs)).toEqual(Array.from(whole.xs));
    expect(Array.from(w.way!.zs)).toEqual(Array.from(whole.zs));
    // Settled: another step is true at once and reads no clock.
    const read = t;
    expect(stepWay(w, 1.5, now)).toBe(true);
    expect(t).toBe(read);
  });

  it("wayOf finishes a draw that is part way through, and gives the same way after", () => {
    const w = forestWorld();
    // One slice: the clock passes the budget at its first reading after it.
    let t = 0;
    expect(stepWay(w, 0.1, () => (t += 1))).toBe(false);
    expect(w.way).toBeNull();
    const way = wayOf(w);
    expect(way).not.toBeNull();
    expect(w.wayDraw).toBeNull();
    expect(wayOf(w)).toBe(way);
  });

  it("the chase begins with the way settled on the host, whatever was drawn before", () => {
    const w = forestWorld();
    w.haunt!.active = false;
    const p = spawnPlayer(w);
    const body = w.search!.body.pos;
    p.pos = { x: body.x - 5, y: elevationAt(seed, body.x - 5, body.z) + 0.9, z: body.z };
    tick(w, 1);
    expect(w.state.phase).toBe(Phase.Scene);
    expect(w.way).toBeNull();
    for (let i = 0; i < 3000 && w.state.phase === Phase.Scene; i++) tick(w, 1);
    expect(w.state.phase).toBe(Phase.Chase);
    expect(w.way).not.toBeNull();
    expect(w.way!.fallback).toBe(false);
  });

  it("the app steps the draw every frame on the host and on a client, from ten seconds in", () => {
    const app = readFileSync("src/app.ts", "utf8");
    expect(app).toContain("      syncWayDraw(host.world, state);\n      syncAtmosphere(host.world, state, host.localEntityId, dt);");
    expect(app).toContain("      syncWayDraw(client.world, state);\n      syncAtmosphere(client.world, state, client.localEntityId, dt);");
    expect(app).toContain("if (world.wayDraw === null || state.tick < WAY_DRAW_FROM_TICK) return;");
    expect(app).toContain("const WAY_DRAW_FROM_TICK = 600;");
  });

  it("a level with no forest has no way and no draw", () => {
    const w = createWorld(parseLevel({ id: "flat", brushes: [{ min: [-50, -1, -50], max: [50, 0, 50], material: "concrete" }], playerSpawns: [[0, 0.9, 0]], enemySpawns: [] }), 1);
    expect(w.way).toBeNull();
    expect(w.wayDraw).toBeNull();
    expect(wayOf(w)).toBeNull();
    expect(stepWay(w, 1.5, () => 0)).toBe(true);
  });

  it("a peaceful world, which has no chase, draws none", () => {
    const w = createForestWorld(createForest(seed), true, true);
    expect(w.wayDraw).toBeNull();
    expect(wayOf(w)).toBeNull();
  });
});
