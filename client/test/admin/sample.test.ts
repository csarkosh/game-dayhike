import { describe, it, expect, vi } from "vitest";
import { sampleSource } from "../../src/admin/sample.js";
import type { DrawableTrail } from "../../src/admin/trail.js";

// A trail of three nodes up a straight stem: enough for the sample to walk sessions on.
const TRAIL: DrawableTrail = {
  nodes: [{ x: 0, z: 0 }, { x: 0, z: 60 }, { x: 0, z: 120 }],
  edges: [{ a: 0, b: 1, kind: "stem" }, { a: 1, b: 2, kind: "stem" }],
  forks: [],
  stem: [0, 1],
  trailhead: { x: 0, z: 0 },
  summit: 2,
  features: [],
  stemLen: 120,
};

describe("the sample's paths come from the trail builder it is given", () => {
  it("asks the builder for the sample's world once, and walks its sessions on the trail it answers", async () => {
    const trailFor = vi.fn<(world: string, seed: number) => Promise<DrawableTrail | null>>(() => Promise.resolve(TRAIL));
    const source = sampleSource(trailFor);
    const rows = await source.query("paths", 7);
    await source.query("paths", 30);
    expect(trailFor).toHaveBeenCalledTimes(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.sid)).size).toBe(14);
    // Every walked sample sits on the given trail's line (x = 0, give or take the wander and the stray).
    const samples = rows.filter((r) => typeof r.x === "number");
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((r) => Math.abs(Number(r.x)) <= 30)).toBe(true);
  });

  it("answers no paths when the builder has no trail for the world", async () => {
    const source = sampleSource(() => Promise.resolve(null));
    expect(await source.query("paths", 7)).toEqual([]);
  });
});
