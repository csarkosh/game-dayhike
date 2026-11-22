import { describe, expect, it } from "vitest";
import { WATER_BUMP_SIZE, waterBumpData } from "../../src/game/waterBump.js";

describe("the water's ripple bump, as data", () => {
  it("is the 256² picture the water has always drawn, to the byte", () => {
    const data = waterBumpData();
    expect(WATER_BUMP_SIZE).toBe(256);
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(WATER_BUMP_SIZE * WATER_BUMP_SIZE * 4);
    // FNV-1a over every byte, taken from the texture the water uploaded before this function was
    // split from it (2026-11-12): moving the arithmetic must not change one.
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      h ^= data[i] as number;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    expect(h).toBe(3263495704);
    expect(Array.from(data.slice(0, 8))).toEqual([104, 84, 245, 255, 71, 91, 236, 255]);
  });

  it("is a constant: no world enters it, and each call makes its own array", () => {
    const a = waterBumpData();
    const b = waterBumpData();
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
  });
});
