import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { startGame, type GameOptions } from "../../src/app.js";

describe("a hike whose start throws before its first renderer is built", () => {
  it("disposes the WebGPU engine made for it, which no renderer owns yet", () => {
    const engine = new NullEngine();
    // Under node there is no page: reading the address, the first thing the
    // start does after the level, throws before any renderer is built.
    expect(typeof (globalThis as { location?: unknown }).location).toBe("undefined");
    const options = { engine, tier: "high", tierSource: "auto", fallbackTiers: [] } as unknown as GameOptions;
    expect(() => startGame({} as HTMLCanvasElement, "epic-panda-fun", options)).toThrow();
    expect(engine.isDisposed).toBe(true);
    expect(EngineStore.Instances.length).toBe(0);
  });
});
