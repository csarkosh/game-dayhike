import { describe, expect, it } from "vitest";
import { budgetFor, estimatesAgree, kFor, proEstimate } from "../lib/budget.mjs";
import { calibrate, provenance } from "../budget.mjs";
import { localDate } from "../lib/sample.mjs";

const row = (view, mean, tier, extra = {}) => ({
  view, tier, build: "A", mean, p95: mean + 6, canvas: { start: [1, 1], end: [1, 1] }, load: 1, flags: [], sha: "abc", time: "2026-10-21T19:45:00Z", ...extra,
});
const info = { machine: "rig", gpu: "g", browser: "b" };

describe("calibrate", () => {
  const air = [row("a", 20, "medium"), row("b", 30, "medium"), row("a", 40, "high"), row("b", 44, "high")];
  const rig = [row("a", 24, "medium"), row("b", 36, "medium", { time: "2026-10-22T04:38:00Z" }), row("a", 80, "high")];

  it("sets a medium tier's budget from k and gives no Pro estimates", () => {
    const { k, record, estimates } = calibrate(air, rig, "medium", 1, info);
    expect(k.k).toBe(kFor(rig.slice(0, 2), air.slice(0, 2)).k);
    expect(record.meanMs).toBe(budgetFor(k.k, 1).meanMs);
    expect(record).toMatchObject({ tier: "medium", machine: "rig", gpu: "g", browser: "b", factor: 1, airWarm: true, commit: "abc" });
    expect(record.date).toBe(localDate(new Date("2026-10-22T04:38:00Z")));
    expect(estimates).toBeNull();
  });
  it("gives the high tier the Pro's two estimates and whether they agree", () => {
    const { k, record, estimates } = calibrate(air, rig, "high", 1.5, info);
    expect(record.meanMs).toBe(budgetFor(k.k, 1.5).meanMs);
    expect(estimates.fromM3Max).toEqual([12, 15]);
    expect(estimates.fromAir).toBeCloseTo(proEstimate(42, 1.5), 6);
    expect(estimates.agree).toBe(estimatesAgree(estimates.fromAir, 13.5));
  });
  it("takes the build from the kept rows' one sha, and refuses rows of two builds", () => {
    expect(() => calibrate(air, [...rig, row("b", 40, "medium", { sha: "def" })], "medium", 1, info)).toThrow(/2 builds \(abc, def\)/);
    // A flagged row of another build is not kept, so it does not count.
    expect(calibrate(air, [...rig, row("b", 40, "medium", { sha: "def", load: 9 })], "medium", 1, info).record.commit).toBe("abc");
    expect(() => provenance([row("a", 1, "medium", { sha: null })])).toThrow(/no build sha/);
  });
  it("dates the record by the latest kept row, in this machine's zone", () => {
    const rows = [row("a", 1, "medium", { time: "2026-10-21T19:45:00Z" }), row("a", 1, "medium", { time: "2026-10-22T04:38:00Z" })];
    expect(provenance(rows)).toEqual({ commit: "abc", date: localDate(new Date("2026-10-22T04:38:00Z")) });
    // Not the UTC date: on the Pacific coast the latest row is still the 21st.
    const zone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(provenance(rows).date).toBe("2026-10-21");
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});
