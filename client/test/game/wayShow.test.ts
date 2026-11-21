import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createWorld, type World } from "../../src/sim/world.js";
import { parseLevel } from "@csarkosh/engine/sim/level";
import { Outcome, Phase } from "../../src/sim/types.js";
import { makeWay } from "../../src/sim/wayDown.js";
import { THRESHOLD_AT_S } from "../../src/game/cutscene.js";
import { WAY_DIM, WAY_FADE_S, wayDimAt, wayLevelFor } from "../../src/game/wayLevel.js";
import { CLOUD_TRAIL_EDGE_M, CLOUD_TRAIL_FADE_M, WAY_MIST_EDGE_M, WAY_MIST_FADE_M, cloudGroundMap } from "@csarkosh/engine/game/cloudParams";

/** A file of the client, wherever the suite is run from (the gate runs it from the repository's root). */
const clientFile = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

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
  it("is thin from the line to where the way's banks begin and whole past them: wider than the trail's", () => {
    expect([WAY_MIST_EDGE_M, WAY_MIST_FADE_M]).toEqual([2.5, 7]);
    expect(WAY_MIST_EDGE_M).toBeGreaterThan(CLOUD_TRAIL_EDGE_M);
    expect(WAY_MIST_FADE_M).toBeGreaterThan(CLOUD_TRAIL_FADE_M);
    // A line along x through the map's centre: the share off it by its distance, with the way's edge and fade.
    const g = cloudGroundMap(() => 0, 0, 0, (_x, z) => Math.abs(z), 64, 128, WAY_MIST_EDGE_M, WAY_MIST_FADE_M);
    const at = (z: number): number => g.data[(Math.floor((z / 128 + 0.5) * 64) * 64 + 32) * 4 + 3]!;
    expect(at(1)).toBe(0);
    expect(at(9)).toBe(255);
    expect(at(4)).toBeGreaterThan(0);
    expect(at(4)).toBeLessThan(at(6));
    // The trail's own edge and fade are the default still.
    const t = cloudGroundMap(() => 0, 0, 0, (_x, z) => Math.abs(z), 64, 128);
    expect(t.data[(Math.floor((7 / 128 + 0.5) * 64) * 64 + 32) * 4 + 3]).toBe(255);
  });
});

describe("the renderer and the app", () => {
  const renderer = readFileSync(clientFile("src/game/lite/renderer.ts"), "utf8");
  const chain = readFileSync(clientFile("../engine/src/game/lite/postChain.ts"), "utf8");
  const app = readFileSync(clientFile("src/app.ts"), "utf8");

  it("the renderer makes the way's mist once, for a forest, toned for the tier's colour path, and disposes it", () => {
    expect(renderer.match(/createLiteWayLight\(/g)).toHaveLength(1);
    expect(renderer).toContain("const wayLight = forest === null ? null : createLiteWayLight(engine, scene, wayPath, jobs, uploads);");
    expect(renderer).toContain('const wayPath: WayColourPath = chained ? "post" : "material";');
    expect(renderer).toContain("made.wayLight?.dispose();");
  });

  it("the renderer dims the frame by the mist's level on both colour paths and gives the mist the dim to undo", () => {
    // With no chain the exposure every material ends with carries it, beside the stare's.
    expect(renderer).toContain("(chained ? light.exposure : light.exposure * sightUnder(shownStare.level) * wayDimAt(wayLevel))");
    // With one the grade's does.
    expect(renderer).toContain("standing.chain?.setDim(wayDimAt(wayLevel));\n        standing.chain?.update(");
    expect(chain).toContain("if (dim !== 1) record = { ...record, exposure: record.exposure * dim };");
    // The way's mist is a shade of the ground mist's own colour, which every tier has, and drifts on the frame's clock.
    expect(renderer).toContain("const wayMist = cloudColourUnder(nearColour);");
    expect(renderer).toContain("standing.wayLight.update(wayLevel, 1 / wayDimAt(wayLevel), wayMist, seconds, chaseCast);");
  });

  it("the renderer feeds the ground cloud's map the way in place of the trail while the mist is up, and builds it again when that changes", () => {
    expect(renderer).toContain("const over = way !== null && wayLevel > 0 ? way : null;");
    expect(renderer).toContain("if (cloudGroundDue(cloudGroundAt, pose.x, pose.z) || (over !== null) !== wayMistBuilt) {");
    // Only as far as the mist's fade reaches: 4,096 places a rebuild, most of them far from the way.
    expect(renderer).toContain("(x, z) => wayDistanceWithin(over, x, z, WAY_MIST_FADE_M), CLOUD_GROUND_SIZE, CLOUD_GROUND_SPAN, WAY_MIST_EDGE_M, WAY_MIST_FADE_M)");
  });

  it("the app gives every renderer the world's way, and the level every frame; a renderer still being made takes the way when it stands", () => {
    expect(app).toContain("if (wayGivenTo !== renderer || wayGiven !== world.way) {");
    // With the ground the players stand on (the sim's field, the walkable rock in it), not the bare elevation.
    expect(app).toContain("renderer.setWay(world.way, (x, z) => ground.heightAt(x, z));");
    expect(app).toContain("renderer.setWayLevel(wayShown);");
    expect(app).toContain("wayShown = wayHeld ?? wayLevelFor(world, sceneInto, wayShown, dt);");
    expect(renderer).toContain("standing?.wayLight?.setWay(next, heightAt);");
    expect(renderer).toContain("if (way !== null && wayHeightAt !== null) wayLight?.setWay(way, wayHeightAt);\n    standing = made;");
  });

  it("the app reports the way once it is settled: its length, its straight line and whether it is the fallback", () => {
    expect(app).toContain('telemetry.event("way", { length: Math.round(way.length), straight: Math.round(way.straight), fallback: way.fallback, tick: world.state.tick });');
    expect(app.match(/telemetry\.event\("way"/g)).toHaveLength(1);
  });
});
