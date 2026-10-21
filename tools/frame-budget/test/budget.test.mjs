import { describe, expect, it } from "vitest";
import { budgetFor, budgetRecord, estimatesAgree, kFor, proEstimate, verdict } from "../lib/budget.mjs";

const row = (view, mean) => ({ view, build: "A", mean, p95: mean + 6, canvas: { start: [1, 1], end: [1, 1] }, load: 1 });

describe("budget", () => {
  it("takes k as the median of the views' ratios, with the spread and the views missing on one side", () => {
    const air = [row("a", 20), row("a", 22), row("b", 30), row("c", 10), row("d", 5)];
    const rig = [row("a", 25.2), row("b", 42), row("c", 11), row("e", 9)];
    const k = kFor(rig, air);
    expect(k.perView).toEqual({ a: 1.2, b: 1.4, c: 1.1 });
    expect(k.k).toBe(1.2);
    expect(k.spread).toEqual([1.1, 1.4]);
    expect(k.missing.sort()).toEqual(["d", "e"]);
  });
  it("sets the budgets from the bars, the factor and k", () => {
    expect(budgetFor(1.2)).toEqual({ meanMs: 19.2, p95Ms: 26.4 });
    expect(budgetFor(1.2, 1.5)).toEqual({ meanMs: 28.8, p95Ms: 39.6 });
  });
  it("judges a tier by its worst view on either bar", () => {
    const v = verdict([row("a", 18), row("b", 19)], { meanMs: 19.2, p95Ms: 24 });
    expect(v.views.b).toEqual({ meanMs: 19, p95Ms: 25, over: true });
    expect(v.worst).toBe("b");
    expect(v.over).toBe(true);
    expect(verdict([row("a", 18)], { meanMs: 19.2, p95Ms: 26.4 }).over).toBe(false);
  });
  it("estimates the Pro from the Air by the factor, and says whether two estimates agree", () => {
    expect(proEstimate(40)).toBeCloseTo(37.5, 3);
    expect(estimatesAgree(37.5, 15)).toBe(false);
    expect(estimatesAgree(25, 15)).toBe(true);
  });
  it("keeps the inputs and the budgets they give", () => {
    const r = budgetRecord({ tier: "medium", machine: "rig", gpu: "g", browser: "b", k: 1.2, spread: [1.1, 1.4], factor: 1, airWarm: 21, date: "2026-10-21", commit: "abc" });
    expect(r).toEqual({ tier: "medium", machine: "rig", gpu: "g", browser: "b", k: 1.2, spread: [1.1, 1.4], factor: 1, airWarm: 21, date: "2026-10-21", commit: "abc", meanMs: 19.2, p95Ms: 26.4 });
  });
});
