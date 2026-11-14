import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TIER_SIZES, resolveViews } from "../../frame-budget/lib/views.mjs";
import { SIZES, STILL_COMMANDS, parseArgs, stillViewUrl } from "../lib/args.mjs";

const stills = JSON.parse(readFileSync(new URL("../../previews/stills.json", import.meta.url), "utf8"));
const config = JSON.parse(readFileSync(new URL("../../frame-budget/views.json", import.meta.url), "utf8"));

const NEEDED = ["--a", "http://localhost:5173/dayhike", "--b", "https://b.example/dayhike", "--out", "/tmp/out"];

describe("the comparison's arguments", () => {
  it("takes the two builds and the directory, and defaults the rest", () => {
    expect(parseArgs(NEEDED)).toEqual({
      a: "http://localhost:5173/dayhike",
      b: "https://b.example/dayhike",
      out: "/tmp/out",
      views: [],
      tier: "high",
      engine: undefined,
      settle: 30,
      frames: 320,
      remote: undefined,
      floor: false,
    });
  });

  it("takes every option", () => {
    const o = parseArgs([...NEEDED, "--views", "forest,trailhead,", "--tier", "low", "--engine", "webgl2", "--settle", "12.5", "--frames", "64", "--remote", "9333", "--floor"]);
    expect(o.views).toEqual(["forest", "trailhead"]);
    expect(o.tier).toBe("low");
    expect(o.engine).toBe("webgl2");
    expect(o.settle).toBe(12.5);
    expect(o.frames).toBe(64);
    expect(o.remote).toBe(9333);
    expect(o.floor).toBe(true);
    expect(parseArgs([...NEEDED, "--settle", "0"]).settle).toBe(0);
  });

  it("refuses what it cannot run with, saying which", () => {
    expect(() => parseArgs(["--b", "http://b", "--out", "o"])).toThrow(/--a is required/);
    expect(() => parseArgs(["--a", "http://a", "--out", "o"])).toThrow(/--b is required/);
    expect(() => parseArgs(["--a", "http://a", "--b", "http://b"])).toThrow(/--out is required/);
    expect(() => parseArgs([...NEEDED, "--tier", "ultra"])).toThrow(/--tier must be low, medium, high, got ultra/);
    expect(() => parseArgs([...NEEDED, "--engine", "metal"])).toThrow(/webgpu or webgl2, not metal/);
    expect(() => parseArgs([...NEEDED, "--settle", "soon"])).toThrow(/--settle needs seconds/);
    expect(() => parseArgs([...NEEDED, "--settle", "-1"])).toThrow(/--settle needs seconds/);
    expect(() => parseArgs([...NEEDED, "--frames", "0"])).toThrow(/--frames needs a whole number of at least 1, got 0/);
    expect(() => parseArgs([...NEEDED, "--frames", "1.5"])).toThrow(/--frames needs a whole number/);
    expect(() => parseArgs([...NEEDED, "--remote", "rig"])).toThrow(/--remote needs a whole number/);
    expect(() => parseArgs([...NEEDED, "--views"])).toThrow(/--views needs a value/);
    expect(() => parseArgs([...NEEDED, "--views", "--floor"])).toThrow(/--views needs a value/);
    expect(() => parseArgs([...NEEDED, "--pairs", "3"])).toThrow(/unknown option --pairs/);
    expect(() => parseArgs([...NEEDED, "forest"])).toThrow(/unknown option forest/);
    expect(() => parseArgs(["--a", "localhost:5173", "--b", "http://b", "--out", "o"])).toThrow(/--a needs an http or https URL/);
  });

  it("shoots each tier at the frame budget's size, and low at medium's", () => {
    expect(SIZES.medium).toEqual(TIER_SIZES.medium);
    expect(SIZES.high).toEqual(TIER_SIZES.high);
    expect(SIZES.low).toEqual(TIER_SIZES.medium);
  });
});

describe("the link a view is shot at", () => {
  const { view, still } = resolveViews(config, stills, ["forest"])[0];

  it("is the frame budget's with the wind held, in the measurement mode", () => {
    expect(STILL_COMMANDS).toEqual(["wind 0"]);
    expect(stillViewUrl("http://localhost:5173/dayhike/", stills.game, "low", view, still)).toBe(
      "http://localhost:5173/dayhike/game/0f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b?cmd=seed%20atmo;freecam%20250%20-500%201.09;escalation%200;unsettle%200;wind%200&tier=low&telemetry=off&gpuTime",
    );
  });

  it("forces the engine only when asked", () => {
    expect(stillViewUrl("https://a.example/dayhike", stills.game, "high", view, still)).not.toContain("engine=");
    expect(stillViewUrl("https://a.example/dayhike", stills.game, "high", view, still, { engine: "webgpu" })).toMatch(/;wind%200&tier=high&telemetry=off&gpuTime&engine=webgpu$/);
  });

  it("holds the wind in a first-person view and a look as well", () => {
    const night = resolveViews(config, stills, ["forest-night"])[0];
    expect(stillViewUrl("https://a.example/dayhike", stills.game, "medium", night.view, night.still)).toContain("?cmd=seed%20atmo;stand%20250%20-500%201.09;escalation%201;unsettle%200;lamp;wind%200&tier=medium");
    const chase = resolveViews(config, stills, ["chase"])[0];
    expect(stillViewUrl("https://a.example/dayhike", stills.game, "medium", chase.view, chase.still)).toContain("?cmd=seed%20atmo;summit;wind%200&tier=medium");
  });
});
