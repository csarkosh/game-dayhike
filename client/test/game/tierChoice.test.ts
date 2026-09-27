import { describe, it, expect, afterEach } from "vitest";
import {
  pageStorage,
  parseProbeOverride,
  parseTierOverride,
  readAutoRecord,
  readChoice,
  resolveTier,
  writeAutoRecord,
  writeChoice,
} from "../../src/game/tierChoice.js";
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
  v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 1,
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

describe("the probe override", () => {
  it("reads ?probe=high or medium", () => {
    expect(parseProbeOverride("?probe=high")).toBe("high");
    expect(parseProbeOverride("?probe=medium")).toBe("medium");
    expect(parseProbeOverride("?probe=low")).toBe(null);
    expect(parseProbeOverride("")).toBe(null);
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
    const none: AutoRecord = { v: 1, gpu: "", cls: "unknown", browser: 0, attempts: 3, verdict: null };
    expect(writeAutoRecord(s, none)).toBe(true);
    expect(readAutoRecord(s)).toEqual({ v: 1, gpu: "", cls: "unknown", browser: 0, attempts: 3, verdict: null });
    const governor: AutoRecord = { v: 1, gpu: "nvidia/ampere", cls: "discrete-modern", browser: 153, attempts: 0,
      verdict: { tier: "low", source: "governor", pixels: 1_405_320, at: 1_790_000_000_000 } };
    expect(writeAutoRecord(s, governor)).toBe(true);
    expect(readAutoRecord(s)).toEqual({ v: 1, gpu: "nvidia/ampere", cls: "discrete-modern", browser: 153, attempts: 0,
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

  it("reads nothing from a record or a verdict of another shape", () => {
    const s = memoryStorage();
    const bad = [
      { ...RECORD, verdict: { ...RECORD.verdict, tier: "ultra" } },
      { ...RECORD, verdict: { ...RECORD.verdict, source: "guess" } },
      { ...RECORD, verdict: { ...RECORD.verdict, at: "yesterday" } },
      { ...RECORD, attempts: null },
      { ...RECORD, cls: "quantum" },
      { ...RECORD, cls: "constructor" },
      { v: 1, gpu: "Apple GPU", browser: 26, attempts: 1, verdict: null },
      null,
      [],
    ];
    for (const value of bad) {
      s.setItem("dayhike.quality.auto", JSON.stringify(value));
      expect(readAutoRecord(s)).toBe(null);
    }
  });

  it("drops a reading that does not read back whole, and keeps the verdict and the attempts", () => {
    const s = memoryStorage();
    const withInfinity: AutoRecord = { ...RECORD, verdict: { ...RECORD.verdict!, readings: [
      { tier: "high", frames: 120, meanMs: Number.POSITIVE_INFINITY, p95Ms: 33.4, pixels: 2_073_600, engine: "webgl2" },
      { tier: "medium", frames: 120, meanMs: 16.7, p95Ms: 17.1, pixels: 2_073_600, engine: "webgl2" },
    ] } };
    expect(writeAutoRecord(s, withInfinity)).toBe(true);
    expect(readAutoRecord(s)).toEqual({
      v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 1,
      verdict: { tier: "medium", source: "probe", pixels: 2_073_600, at: 1_790_000_000_000,
        readings: [{ tier: "medium", frames: 120, meanMs: 16.7, p95Ms: 17.1, pixels: 2_073_600, engine: "webgl2" }] },
    });
    s.setItem("dayhike.quality.auto", JSON.stringify({ ...RECORD, verdict: { ...RECORD.verdict, readings: "none" } }));
    expect(readAutoRecord(s)).toEqual({
      v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 1,
      verdict: { tier: "medium", source: "probe", pixels: 2_073_600, at: 1_790_000_000_000 },
    });
  });
});

describe("pageStorage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("gives the page's storage, null where there is none, and null where its accessor throws", () => {
    const s = memoryStorage();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: s });
    expect(pageStorage()).toBe(s);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
    expect(pageStorage()).toBe(null);
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(pageStorage()).toBe(null);
  });
});

describe("the player's choice", () => {
  it("is Auto until one is saved, and round-trips under dayhike.quality", () => {
    const s = memoryStorage();
    expect(readChoice(s)).toEqual({ choice: "auto", stored: true });
    expect(writeChoice(s, "high")).toBe(true);
    expect(s.getItem("dayhike.quality")).toBe("high");
    expect(readChoice(s)).toEqual({ choice: "high", stored: true });
    expect(writeChoice(s, "auto")).toBe(true);
    expect(readChoice(s)).toEqual({ choice: "auto", stored: true });
    s.setItem("dayhike.quality", "ultra");
    expect(readChoice(s)).toEqual({ choice: "auto", stored: true });
  });

  it("falls back to Auto, not remembered, where storage is missing or throws", () => {
    expect(readChoice(null)).toEqual({ choice: "auto", stored: false });
    expect(readChoice(throwingStorage())).toEqual({ choice: "auto", stored: false });
    expect(writeChoice(throwingStorage(), "low")).toBe(false);
    expect(writeChoice(null, "low")).toBe(false);
  });
});

describe("resolveTier", () => {
  it("puts the override over the choice and the choice over Auto", () => {
    expect(resolveTier({ override: "low", choice: "high", auto: "medium" })).toEqual({ tier: "low", source: "override" });
    expect(resolveTier({ override: null, choice: "high", auto: "medium" })).toEqual({ tier: "high", source: "choice" });
    expect(resolveTier({ override: null, choice: "auto", auto: "medium" })).toEqual({ tier: "medium", source: "auto" });
  });
});
