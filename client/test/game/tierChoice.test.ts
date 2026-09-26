import { describe, it, expect } from "vitest";
import { parseTierOverride, readAutoRecord, resolveTier, writeAutoRecord } from "../../src/game/tierChoice.js";
import type { AutoRecord } from "../../src/game/quality.js";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

function throwingStorage(): Storage {
  const fail = () => { throw new Error("SecurityError"); };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

const RECORD: AutoRecord = {
  v: 1, gpu: "Apple GPU", browser: 26, attempts: 1,
  verdict: { tier: "medium", source: "probe", pixels: 2_073_600, at: 1_790_000_000_000,
    readings: [{ tier: "high", frames: 120, meanMs: 23.96, p95Ms: 33.4, pixels: 2_073_600, engine: "webgl2" }] },
};

describe("the override", () => {
  it("reads ?tier= and nothing else", () => {
    expect(parseTierOverride("?tier=high")).toBe("high");
    expect(parseTierOverride("?cmd=seed%20atmo&tier=low")).toBe("low");
    expect(parseTierOverride("?tier=ultra")).toBe(null);
    expect(parseTierOverride("")).toBe(null);
  });
});

describe("the Auto record's storage", () => {
  it("round-trips a record under dayhike.quality.auto", () => {
    const s = memoryStorage();
    expect(writeAutoRecord(s, RECORD)).toBe(true);
    expect(s.getItem("dayhike.quality.auto")).not.toBe(null);
    expect(readAutoRecord(s)).toEqual(RECORD);
  });

  it("round-trips a record with no verdict, and a governor verdict with no readings", () => {
    const s = memoryStorage();
    const none: AutoRecord = { v: 1, gpu: "", browser: 0, attempts: 3, verdict: null };
    expect(writeAutoRecord(s, none)).toBe(true);
    expect(readAutoRecord(s)).toEqual({ v: 1, gpu: "", browser: 0, attempts: 3, verdict: null });
    const governor: AutoRecord = { v: 1, gpu: "nvidia/ampere", browser: 153, attempts: 0,
      verdict: { tier: "low", source: "governor", pixels: 1_405_320, at: 1_790_000_000_000 } };
    expect(writeAutoRecord(s, governor)).toBe(true);
    expect(readAutoRecord(s)).toEqual({ v: 1, gpu: "nvidia/ampere", browser: 153, attempts: 0,
      verdict: { tier: "low", source: "governor", pixels: 1_405_320, at: 1_790_000_000_000 } });
  });

  it("reads nothing from bad JSON, a record of another shape, no storage, or a storage that throws", () => {
    const s = memoryStorage();
    s.setItem("dayhike.quality.auto", "{not json");
    expect(readAutoRecord(s)).toBe(null);
    s.setItem("dayhike.quality.auto", JSON.stringify({ v: 1, gpu: "x" }));
    expect(readAutoRecord(s)).toBe(null);
    expect(readAutoRecord(null)).toBe(null);
    expect(readAutoRecord(throwingStorage())).toBe(null);
    expect(writeAutoRecord(throwingStorage(), RECORD)).toBe(false);
    expect(writeAutoRecord(null, RECORD)).toBe(false);
  });

  it("reads nothing from a verdict or a reading of another shape", () => {
    const s = memoryStorage();
    const bad = [
      { ...RECORD, verdict: { ...RECORD.verdict, tier: "ultra" } },
      { ...RECORD, verdict: { ...RECORD.verdict, source: "guess" } },
      { ...RECORD, verdict: { ...RECORD.verdict, at: "yesterday" } },
      { ...RECORD, verdict: { ...RECORD.verdict, readings: "none" } },
      { ...RECORD, verdict: { ...RECORD.verdict, readings: [{ tier: "high", frames: 120 }] } },
      { ...RECORD, attempts: null },
      null,
      [],
    ];
    for (const value of bad) {
      s.setItem("dayhike.quality.auto", JSON.stringify(value));
      expect(readAutoRecord(s)).toBe(null);
    }
  });
});

describe("resolveTier", () => {
  it("puts the override over the choice and the choice over Auto", () => {
    expect(resolveTier({ override: "low", choice: "high", auto: "medium" })).toEqual({ tier: "low", source: "override" });
    expect(resolveTier({ override: null, choice: "high", auto: "medium" })).toEqual({ tier: "high", source: "choice" });
    expect(resolveTier({ override: null, choice: "auto", auto: "medium" })).toEqual({ tier: "medium", source: "auto" });
  });
});
