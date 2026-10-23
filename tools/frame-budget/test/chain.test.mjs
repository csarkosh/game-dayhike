import { describe, expect, it } from "vitest";
import { capMinutes, expandJobs, parseChainArgs } from "../lib/chain.mjs";

const queue = {
  base: "https://a.example/dayhike/",
  machine: "g4dn.xlarge",
  jobs: [
    { name: "cull", against: "https://b.example/dayhike/", views: ["trailhead", "forest"] },
    { name: "night", tier: "medium", against: "https://c.example/dayhike/", views: "forest-night", shot: true },
    { name: "steady", tier: "high", pairs: 1 },
  ],
};

describe("chain", () => {
  it("expands each experiment to one job a tier, with the harness's arguments", () => {
    const jobs = expandJobs(queue);
    expect(jobs.map((j) => j.id)).toEqual(["cull-medium", "cull-high", "night-medium", "steady-high"]);
    expect(jobs[0].args).toEqual(["--base", queue.base, "--tier", "medium", "--machine", "g4dn.xlarge", "--against", "https://b.example/dayhike/", "--views", "trailhead,forest"]);
    expect(jobs[2].args).toContain("--shot");
    expect(jobs[3].args).toEqual(["--base", queue.base, "--tier", "high", "--machine", "g4dn.xlarge", "--pairs", "1"]);
  });
  it("refuses a nameless job, a tier outside the two, and two jobs on one rows file", () => {
    expect(() => expandJobs({ base: "x", jobs: [{ against: "y" }] })).toThrow(/name/);
    expect(() => expandJobs({ base: "x", jobs: [{ name: "a", tier: "low" }] })).toThrow(/medium or high/);
    expect(() => expandJobs({ base: "x", jobs: [{ name: "a", tier: "high" }, { name: "a", tiers: ["high"] }] })).toThrow(/a-high/);
  });
  it("caps a job by its page loads", () => {
    const [cull, , , steady] = expandJobs(queue);
    // 2 views x 3 pairs x 2 sides = 12 loads at 103 s, plus 10 minutes.
    expect(capMinutes(cull)).toBe(31);
    // 7 views x 1 pair x 1 side = 7 loads.
    expect(capMinutes(steady)).toBe(23);
  });
  it("parses the ports and the queue", () => {
    expect(parseChainArgs(["--queue", "q.json", "--ports", "9333, 9334", "--retries", "2"])).toEqual({ queue: "q.json", ports: [9333, 9334], retries: 2, dryRun: false });
    expect(() => parseChainArgs(["--ports", "9333"])).toThrow(/--queue/);
    expect(() => parseChainArgs(["--queue", "q", "--ports", "x"])).toThrow(/--ports/);
  });
});
