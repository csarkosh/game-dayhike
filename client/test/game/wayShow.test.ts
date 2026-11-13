import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWorld, type World } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { Outcome, Phase } from "../../src/sim/types.js";
import { makeWay } from "../../src/sim/wayDown.js";
import { THRESHOLD_AT_S } from "../../src/game/cutscene.js";
import { WAY_DIM, WAY_FADE_S, wayDimAt, wayLevelFor } from "../../src/game/wayLevel.js";
import { CLOUD_TRAIL_EDGE_M, CLOUD_TRAIL_FADE_M, WAY_MIST_EDGE_M, WAY_MIST_FADE_M, cloudGroundMap } from "../../src/game/cloudParams.js";

const FLOOR = { min: [-300, -1, -300] as [number, number, number], max: [300, 0, 300] as [number, number, number], material: "concrete" };
/** A flat world in `phase`, with a straight way or none. */
function world(phase: Phase, way = true): World {
  const w = createWorld(parseLevel({ id: "flat", brushes: [FLOOR], playerSpawns: [[0, 0.9, 0]], enemySpawns: [] }), 1);
  w.state.phase = phase;
  if (way) w.way = makeWay([{ x: 0, z: 0 }, { x: 200, z: 0 }], 200, false);
  return w;
}

describe("the way's light, when", () => {
  it("names the design's dim and its fade", () => {
    expect([WAY_DIM, WAY_FADE_S, THRESHOLD_AT_S]).toEqual([0.5, 2, 17]);
  });

  it("waits for the threshold, rises over two seconds, and holds through the chase", () => {
    const scene = world(Phase.Scene);
    expect(wayLevelFor(scene, 16.9, 0, 0.1)).toBe(0);
    expect(wayLevelFor(scene, 17, 0, 0.5)).toBeCloseTo(0.25, 6);
    expect(wayLevelFor(scene, 20, 0.9, 0.5)).toBe(1);
    // A scene the app is not timing (a peer admitted during it): nothing until the chase.
    expect(wayLevelFor(scene, null, 0, 0.5)).toBe(0);
    const chase = world(Phase.Chase);
    expect(wayLevelFor(chase, null, 0.9, 0.5)).toBe(1);
    expect(wayLevelFor(chase, null, 1, 5)).toBe(1);
  });

  it("falls away on the climb, and once the match is decided", () => {
    expect(wayLevelFor(world(Phase.Climb), null, 1, 0.5)).toBeCloseTo(0.75, 6);
    const won = world(Phase.Chase);
    won.state.outcome = Outcome.Won;
    expect(wayLevelFor(won, null, 1, 0.5)).toBeCloseTo(0.75, 6);
    expect(wayLevelFor(won, null, 0.1, 0.5)).toBe(0);
  });

  it("never rises on a world with no way", () => {
    expect(wayLevelFor(world(Phase.Chase, false), null, 0, 1)).toBe(0);
    expect(wayLevelFor(world(Phase.Scene, false), 18, 0, 1)).toBe(0);
  });

  it("dims the frame outside it to half at its whole, and not at all at none", () => {
    expect(wayDimAt(0)).toBe(1);
    expect(wayDimAt(1)).toBe(WAY_DIM);
    expect(wayDimAt(0.5)).toBeCloseTo(0.75, 6);
  });
});

describe("the mist over the way", () => {
  it("is thin from the line to the walls' foot and whole by their rim: wider than the trail's", () => {
    expect([WAY_MIST_EDGE_M, WAY_MIST_FADE_M]).toEqual([2, 5.5]);
    expect(WAY_MIST_EDGE_M).toBeGreaterThan(CLOUD_TRAIL_EDGE_M);
    expect(WAY_MIST_FADE_M).toBeGreaterThan(CLOUD_TRAIL_FADE_M);
    // A line along x through the map's centre: the share off it by its distance, with the way's edge and fade.
    const g = cloudGroundMap(() => 0, 0, 0, (_x, z) => Math.abs(z), 64, 128, WAY_MIST_EDGE_M, WAY_MIST_FADE_M);
    const at = (z: number): number => g.data[(Math.floor((z / 128 + 0.5) * 64) * 64 + 32) * 4 + 3]!;
    expect(at(1)).toBe(0);
    expect(at(7)).toBe(255);
    expect(at(3)).toBeGreaterThan(0);
    expect(at(3)).toBeLessThan(at(5));
    // The trail's own edge and fade are the default still.
    const t = cloudGroundMap(() => 0, 0, 0, (_x, z) => Math.abs(z), 64, 128);
    expect(t.data[(Math.floor((5 / 128 + 0.5) * 64) * 64 + 32) * 4 + 3]).toBe(255);
  });
});

describe("the renderer and the app", () => {
  const renderer = readFileSync("src/game/renderer.ts", "utf8");
  const app = readFileSync("src/app.ts", "utf8");

  it("the renderer makes the light once, for a forest, registers it, and disposes it", () => {
    expect(renderer.match(/createWayLight\(/g)).toHaveLength(1);
    expect(renderer).toContain("partOf(wayLight);");
    expect(renderer).toContain("wayLight?.dispose();");
  });

  it("the renderer dims the frame by the light's level on both colour paths and gives the light the dim to undo", () => {
    expect(renderer).toContain("const wayDim = wayDimAt(wayLevel);");
    expect(renderer).toContain("lighting.setDim(wayDim);");
    expect(renderer).toContain("post.setDim(wayDim);");
    expect(renderer).toContain("wayLight?.update(camera.position, wayLevel, 1 / wayDim);");
  });

  it("the renderer feeds the mist's ground map the way in place of the trail while the light is up", () => {
    expect(renderer).toContain("const wayMist = way !== null && wayLevel > 0;");
    expect(renderer).toContain("const over = wayMist ? way : null;");
    expect(renderer).toContain("(x, z) => wayDistance(over, x, z), CLOUD_GROUND_SIZE, CLOUD_GROUND_SPAN, WAY_MIST_EDGE_M, WAY_MIST_FADE_M)");
  });

  it("the app gives every renderer the world's way, and the level every frame", () => {
    expect(app).toContain("if (wayGivenTo !== renderer || wayGiven !== world.way) {");
    expect(app).toContain("renderer.setWay(world.way);");
    expect(app).toContain("renderer.setWayLevel(wayShown);");
    expect(app).toContain("wayShown = wayHeld ?? wayLevelFor(world, sceneInto, wayShown, dt);");
  });
});
