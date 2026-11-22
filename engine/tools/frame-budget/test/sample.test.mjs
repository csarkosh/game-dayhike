import { describe, expect, it } from "vitest";
import { judgement } from "../lib/budget.mjs";
import { byView, flagsFor, keep, localDate, medianOf, pairDeltas, pairOrder, parseGpuUtil, summarise, table } from "../lib/sample.mjs";

const mk = (view, build, mean, extra = {}) => ({ view, build, mean, p95: mean + 5, canvas: { start: [1, 1], end: [1, 1] }, load: 1, ...extra });

describe("sample", () => {
  it("summarises frames as a mean and a 95th percentile", () => {
    const frames = Array.from({ length: 100 }, (_, i) => 10 + (i % 10)); // 10..19
    expect(summarise(frames)).toEqual({ n: 100, mean: 14.5, p95: 19 });
    expect(() => summarise([1, 2, 3])).toThrow(/10/);
  });
  it("takes medians, odd and even, and refuses none", () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
    expect(() => medianOf([])).toThrow();
  });
  it("flags a moved scale and a loaded machine, and keeps the rest", () => {
    const row = (canvasEnd, load) => ({ view: "forest", build: "A", mean: 20, p95: 25, canvas: { start: [1470, 956], end: canvasEnd }, load });
    expect(flagsFor(row([1470, 956], 1.2))).toEqual([]);
    expect(flagsFor(row([1279, 832], 1.2))).toEqual(["scale-moved"]);
    expect(flagsFor(row([1470, 956], 9.8))).toEqual(["loaded"]);
    expect(flagsFor(row([1470, 956], 2.5))).toEqual(["loaded"]);
    expect(flagsFor(row([1279, 832], 9.8))).toEqual(["scale-moved", "loaded"]);
    expect(flagsFor(row([1470, 956], null))).toEqual([]);
    expect(keep([row([1470, 956], 1), row([1279, 832], 1)])).toHaveLength(1);
  });
  it("groups the kept rows by view", () => {
    const m = byView([mk("a", "A", 1), mk("a", "B", 2), mk("b", "A", 3, { load: 9 })]);
    expect([...m.keys()]).toEqual(["a"]);
    expect(m.get("a")).toHaveLength(2);
  });
  it("interleaves pairs A B B A", () => {
    expect(pairOrder(1)).toEqual(["A", "B"]);
    expect(pairOrder(2)).toEqual(["A", "B", "B", "A"]);
    expect(pairOrder(3)).toEqual(["A", "B", "B", "A", "A", "B"]);
  });
  it("reports each pair's delta and their median", () => {
    const rows = [["A", 20], ["B", 18], ["B", 18.5], ["A", 21], ["A", 20.2], ["B", 17.8]].map(([build, mean]) => mk("forest", build, mean));
    const d = pairDeltas(rows);
    expect(d.pairs.map((p) => p.delta)).toEqual([-2, -2.5, -2.4]);
    expect(d.median).toBe(-2.4);
  });
  it("writes a table line a view and the tier's verdict", () => {
    const rows = [mk("forest", "A", 20, { p95: 26 })];
    const over = { meanMs: 19.5, p95Ms: 27, label: "the bars" };
    expect(table(rows, judgement(rows, over))).toBe(
      "forest  n=1/1  mean 20 ms  p95 26 ms  OVER (B 19.5/27)\nverdict: OVER the bars; worst forest at 20 ms mean, 26 ms p95",
    );
    expect(table(rows, judgement(rows, { ...over, meanMs: 21 }))).toMatch(/under \(B 21\/27\)\nverdict: under the bars/);
    expect(table(rows)).toBe("forest  n=1/1  mean 20 ms  p95 26 ms");
    const flagged = [...rows, mk("forest", "A", 99, { load: 9 })];
    expect(table(flagged)).toBe("forest  n=1/2  mean 20 ms  p95 26 ms");
    const allFlagged = [mk("forest", "A", 99, { load: 9 })];
    expect(table(allFlagged, judgement(allFlagged, over))).toBe("verdict: not judged: no row without a flag");
  });
  it("writes a date in this machine's zone", () => {
    expect(localDate(new Date(2026, 9, 21, 23, 30))).toBe("2026-10-21");
    expect(localDate(new Date(2026, 0, 2, 0, 5))).toBe("2026-01-02");
  });
});

describe("parseGpuUtil", () => {
  it("reads the figure after the key", () => {
    expect(parseGpuUtil('{"PerformanceStatistics" = {"Device Utilization %"=13,"Renderer Utilization %"=4}}')).toBe(13);
  });
  it("is null without the key", () => {
    expect(parseGpuUtil("nothing here")).toBeNull();
  });
});
