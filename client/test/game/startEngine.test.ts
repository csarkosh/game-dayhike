import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { startGame, type GameOptions } from "../../src/app.js";

describe("a hike whose start throws before its first renderer is built", () => {
  it("is handed no engine: the start's options have no place for one, and one slipped in is not the start's to let go", () => {
    let letGo = 0;
    const engine = { isDisposed: false, dispose: () => void letGo++ };
    // @ts-expect-error a hike's renderer makes its own engine from its canvas: the start is handed none.
    const key: keyof GameOptions = "engine";
    // Under node there is no page: reading the address, the first thing the
    // start does after the level, throws before any renderer is built.
    expect(typeof (globalThis as { location?: unknown }).location).toBe("undefined");
    const options = { [key]: engine, tier: "high", tierSource: "auto", fallbackTiers: [] } as unknown as GameOptions;
    expect(() => startGame({} as HTMLCanvasElement, "epic-panda-fun", options)).toThrow();
    // The start made nothing and owns nothing: there is no engine of its own to dispose, and it reads none.
    expect(letGo).toBe(0);
  });
});
