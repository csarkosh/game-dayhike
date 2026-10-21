import { describe, expect, it } from "vitest";
import { budgetFor, estimatesAgree, kFor, proEstimate } from "../lib/budget.mjs";
import { calibrate } from "../budget.mjs";

const row = (view, mean, tier) => ({ view, tier, build: "A", mean, p95: mean + 6, canvas: { start: [1, 1], end: [1, 1] }, load: 1, flags: [] });
const info = { machine: "rig", gpu: "g", browser: "b", date: "2026-10-21", commit: "abc" };

describe("calibrate", () => {
  const air = [row("a", 20, "medium"), row("b", 30, "medium"), row("a", 40, "high"), row("b", 44, "high")];
  const rig = [row("a", 24, "medium"), row("b", 36, "medium"), row("a", 80, "high")];

  it("sets a medium tier's budget from k and gives no Pro estimates", () => {
    const { k, record, estimates } = calibrate(air, rig, "medium", 1, info);
    expect(k.k).toBe(kFor(rig.slice(0, 2), air.slice(0, 2)).k);
    expect(record.meanMs).toBe(budgetFor(k.k, 1).meanMs);
    expect(record).toMatchObject({ tier: "medium", machine: "rig", gpu: "g", browser: "b", factor: 1, airWarm: true, date: "2026-10-21", commit: "abc" });
    expect(estimates).toBeNull();
  });
  it("gives the high tier the Pro's two estimates and whether they agree", () => {
    const { k, record, estimates } = calibrate(air, rig, "high", 1.5, info);
    expect(record.meanMs).toBe(budgetFor(k.k, 1.5).meanMs);
    expect(estimates.fromM3Max).toEqual([12, 15]);
    expect(estimates.fromAir).toBeCloseTo(proEstimate(42, 1.5), 6);
    expect(estimates.agree).toBe(estimatesAgree(estimates.fromAir, 13.5));
  });
});
