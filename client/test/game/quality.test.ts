import { describe, it, expect } from "vitest";
import { QUALITY, tierFor, type Capabilities, type QualityTier } from "../../src/game/quality.js";

describe("QUALITY", () => {
  it("matches the quality tier table", () => {
    // Pins the specified values: hardware scaling, shadow map sizes, LOD
    // bias, texture mip caps, and SSAO flags. Also pins cascade counts so
    // they cannot drift silently; note that `high`'s cascade count is a
    // tuning value, not a fixed requirement. It was 4 (Babylon's default)
    // until production measurement showed the old-growth canopy's
    // alpha-tested fragments across four 2048² cascade maps cost ~5 ms/frame
    // at a deep forest camera; 2 cascades restores a locked 60 fps.
    expect(QUALITY.low).toEqual({
      hardwareScaling: 1.5,
      shadowMapSize: 0,
      shadowCascades: 0,
      lodBias: 1,
      textureMipCap: 512,
      ssao: false,
    });
    expect(QUALITY.medium).toEqual({
      hardwareScaling: 1,
      shadowMapSize: 1024,
      shadowCascades: 1,
      lodBias: 0,
      textureMipCap: 1024,
      ssao: false,
    });
    expect(QUALITY.high).toEqual({
      hardwareScaling: 1,
      shadowMapSize: 2048,
      shadowCascades: 2,
      lodBias: 0,
      textureMipCap: 0,
      ssao: true,
    });
  });

  it("turns shadows off only at low", () => {
    expect(QUALITY.low.shadowMapSize).toBe(0);
    expect(QUALITY.medium.shadowMapSize).toBeGreaterThan(0);
    expect(QUALITY.high.shadowMapSize).toBeGreaterThan(QUALITY.medium.shadowMapSize);
  });
});

describe("tierFor", () => {
  const RANK: Record<QualityTier, number> = { low: 0, medium: 1, high: 2 };

  it("sends mobile to low regardless of reported cores", () => {
    expect(tierFor({ cores: 16, memoryGb: 16, mobile: true })).toBe("low");
  });

  it("gives a workstation high", () => {
    expect(tierFor({ cores: 16, memoryGb: 32, mobile: false })).toBe("high");
  });

  it("gives a weak laptop low", () => {
    expect(tierFor({ cores: 2, memoryGb: 4, mobile: false })).toBe("low");
  });

  it("never rewards weaker hardware with a higher tier", () => {
    // Catches ordering regressions that the point-example tests might miss. A
    // hand-written threshold ladder is easy to get non-monotonic, and the symptom
    // — one machine in a hundred picking the wrong tier — would never be noticed.
    // This depends on the point examples to rule out degenerate answers.
    const grid: Capabilities[] = [];
    for (const cores of [1, 2, 4, 6, 8, 12, 16, 32]) {
      for (const memoryGb of [1, 2, 4, 8, 16, 32]) {
        grid.push({ cores, memoryGb, mobile: false });
      }
    }
    for (const a of grid) {
      for (const b of grid) {
        if (a.cores <= b.cores && a.memoryGb <= b.memoryGb) {
          expect(RANK[tierFor(a)]).toBeLessThanOrEqual(RANK[tierFor(b)]);
        }
      }
    }
  });

  it("is deterministic", () => {
    const caps: Capabilities = { cores: 8, memoryGb: 8, mobile: false };
    expect(tierFor(caps)).toBe(tierFor(caps));
  });
});
