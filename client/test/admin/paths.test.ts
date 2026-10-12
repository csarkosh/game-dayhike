import { describe, it, expect } from "vitest";
import { sessionsOf } from "../../src/admin/paths.js";
import type { Row } from "../../src/admin/source.js";
import { buildTrailFor, parseWorld, sameGeneration } from "../../src/admin/trail.js";
import { GEN_VERSION } from "../../src/sim/forest.js";
import { DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("parseWorld", () => {
  it("reads the generation and the variant from a world version", () => {
    expect(parseWorld("forest/8/olympic/-1771299565/88812")).toEqual({ gen: 8, variant: "olympic" });
    expect(parseWorld("sandbox01")).toBeNull();
    expect(sameGeneration(`forest/${GEN_VERSION}/${DEFAULT_TERRAIN_VARIANT}/1/2`)).toBe(true);
    expect(sameGeneration(`forest/${GEN_VERSION - 1}/${DEFAULT_TERRAIN_VARIANT}/1/2`)).toBe(false);
  });
});

describe("buildTrailFor", () => {
  it(
    "rebuilds a world's trail from its seed, with its forks and named places, and refuses a variant it does not have",
    () => {
      const trail = buildTrailFor(`forest/${GEN_VERSION}/${DEFAULT_TERRAIN_VARIANT}/-1771299565/88812`, 123456);
      expect(trail).not.toBeNull();
      expect(trail!.nodes.length).toBeGreaterThan(10);
      expect(trail!.edges.every((e) => e.a < trail!.nodes.length && e.b < trail!.nodes.length)).toBe(true);
      expect(trail!.forks.length).toBeGreaterThan(0);
      expect(trail!.stemLen).toBeGreaterThan(500);
      for (const f of trail!.features) expect(typeof f.name).toBe("string");
      expect(buildTrailFor(`forest/${GEN_VERSION}/nowhere/1/2`, 1)).toBeNull();
    },
    timeLimit(20_000),
  );
});

describe("sessionsOf", () => {
  it("groups a world's rows into sessions with their samples, marks and what they did", () => {
    const rows: Row[] = [
      { sid: "a", n: "match_start", tick: 0, role: "host" },
      { sid: "a", n: "pos", tick: 120, x: 1, z: -2, yaw: 0, p: 0.1, hp: 100, lamp: false, sprint: false, off: 0, lens: 0, near: 0 },
      { sid: "a", n: "edge", tick: 120, edge: 2, kind: "loop" },
      { sid: "a", n: "edge", tick: 180, edge: 3, kind: "loop" },
      { sid: "a", n: "place", tick: 240, id: 7, kind: "meadow", name: "Old Meadow", in_place: true },
      { sid: "a", n: "pos", tick: 240, x: 5, z: -40, yaw: 1, p: 0.4, hp: 100, lamp: true, sprint: true, off: 0.5, lens: 0.2, near: 0 },
      { sid: "a", n: "offtrail", tick: 240, x: 5, z: -40 },
      { sid: "a", n: "hollow_seen", tick: 300, x: 0, z: 0 },
      { sid: "a", n: "death", tick: 360, x: 6, z: -50, cause: "hollow" },
      { sid: "b", n: "pos", tick: 120, x: 0, z: 0, p: 0.05, hp: 100 },
      { sid: "b", n: "outcome", tick: 900, result: "won" },
    ];
    const sessions = sessionsOf(rows);
    expect(sessions.map((s) => s.sid)).toEqual(["b", "a"]);
    const a = sessions[1]!;
    expect(a).toMatchObject({ role: "host", farthest: 0.4, died: true, walkedLoop: true, offTrail: true, lamp: true, places: ["Old Meadow"], ticks: 360 });
    expect(a.samples.map((p) => p.tick)).toEqual([120, 240]);
    expect(a.marks.map((m) => [m.n, m.x, m.z])).toEqual([
      ["offtrail", 5, -40],
      ["hollow_seen", 5, -40],
      ["death", 6, -50],
    ]);
    expect(sessions[0]).toMatchObject({ result: "won", died: false, farthest: 0.05 });
  });
});
