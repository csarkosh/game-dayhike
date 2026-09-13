import { describe, it, expect } from "vitest";
import {
  CHROMATIC_ABERRATION_AMOUNT, CHROMATIC_ABERRATION_RADIAL, ETCH_NOISE_SIZE, etchNoiseTexels,
  LINE_FOG_TINT, OUTLINE, outlineLineColour, stylizeFeaturesFor,
  celBandCurve, CEL_BANDS, CEL_SOFTNESS, DEFAULT_STYLE, STYLE_NAMES,
} from "../../src/game/stylizeParams.js";
import { luma } from "../../src/game/colour.js";

describe("tier → feature map", () => {
  it("low gets no passes, medium depth-only lines, high normal-aware lines", () => {
    expect(stylizeFeaturesFor("low")).toEqual({ pipeline: false, outline: "off" });
    expect(stylizeFeaturesFor("medium")).toEqual({ pipeline: true, outline: "depth" });
    expect(stylizeFeaturesFor("high")).toEqual({ pipeline: true, outline: "normal" });
  });
});

describe("outline line colour", () => {
  it("is black in black air and near-black tinted by the fog otherwise", () => {
    expect(outlineLineColour({ r: 0, g: 0, b: 0 })).toEqual({ r: 0, g: 0, b: 0 });
    const fog = { r: 0.58, g: 0.6, b: 0.62 };
    const line = outlineLineColour(fog);
    expect(line.r).toBeCloseTo(fog.r * LINE_FOG_TINT, 12);
    expect(line.g).toBeCloseTo(fog.g * LINE_FOG_TINT, 12);
    expect(line.b).toBeCloseTo(fog.b * LINE_FOG_TINT, 12);
    expect(luma(line)).toBeLessThan(0.2);
  });
});

describe("etch noise", () => {
  it("is deterministic, RGBA, opaque, and actually varies", () => {
    const a = etchNoiseTexels(64);
    expect(a).toEqual(etchNoiseTexels(64));
    expect(a.length).toBe(64 * 64 * 4);
    for (let i = 3; i < a.length; i += 256) expect(a[i]).toBe(255);
    const greys = new Set<number>();
    for (let i = 0; i < a.length; i += 4) greys.add(a[i] as number);
    expect(greys.size).toBeGreaterThan(16);
  });

  it("defaults to the shipped size and keeps every channel a byte", () => {
    expect(ETCH_NOISE_SIZE).toBe(256);
    const a = etchNoiseTexels(32);
    for (let i = 0; i < a.length; i += 4) {
      expect(a[i]).toBeGreaterThanOrEqual(0);
      expect(a[i]).toBeLessThanOrEqual(255);
    }
  });
});

describe("tuning constants exist and are sane", () => {
  it("outline tuning is positive and in range", () => {
    expect(OUTLINE.lineStrength).toBeGreaterThan(0);
    expect(OUTLINE.lineStrength).toBeLessThanOrEqual(1);
    expect(OUTLINE.depthThreshold).toBeGreaterThan(0);
    expect(OUTLINE.normalThreshold).toBeGreaterThan(0);
    expect(OUTLINE.noiseScale).toBeGreaterThan(0);
    expect(CHROMATIC_ABERRATION_AMOUNT).toBeGreaterThan(0);
    // Load-bearing: Babylon's radialIntensity defaults to 0, which makes the
    // aberration screen-uniform instead of radial. Zero here would
    // silently revert to that default.
    expect(CHROMATIC_ABERRATION_RADIAL).toBeGreaterThan(0);
  });
});

describe("celBandCurve — the painted-light quantizer", () => {
  it("is zero at and below zero — the zero guard keeps unlit surfaces black", () => {
    expect(celBandCurve(0)).toBe(0);
    expect(celBandCurve(-1)).toBe(0);
  });

  it("is monotonic non-decreasing, non-negative, and finite across the HDR range", () => {
    let prev = 0;
    for (let l = 0; l <= 20; l += 0.005) {
      const v = celBandCurve(l);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it("flattens inside a band and steps near the band's top edge", () => {
    // Parametric in CEL_BANDS/CEL_SOFTNESS so a future retune cannot silently
    // move the samples into the wrong band, as the hardcoded 3-band points did.
    // Band 0 interior: f well below the soft-rise window, so the plateau is
    // exactly flat. Rise region: f just under 1, where the curve climbs to meet
    // the next band's centre.
    const unfold = (t: number) => t / (1 - t);
    const at = (f: number) => celBandCurve(unfold(f / CEL_BANDS));
    const midSpread = Math.abs(at(0.6) - at(0.3));
    const edgeSpread = Math.abs(at(1 - CEL_SOFTNESS * 0.2) - at(1 - CEL_SOFTNESS * 2));
    expect(edgeSpread).toBeGreaterThan(3 * midSpread);
    // At full strength the plateau is exactly flat; at partial strength this bound must be revisited alongside the constant.
    expect(midSpread).toBeLessThanOrEqual(1e-9);
  });

  it("never exceeds the top band-centre ceiling", () => {
    // Quantized targets cap at the top band's centre, folded (CEL_BANDS-0.5)/CEL_BANDS,
    // which unfolds to 3.0 at two bands. Output stays under max(input, ceiling).
    const ceiling = (CEL_BANDS - 0.5) / CEL_BANDS / (1 - (CEL_BANDS - 0.5) / CEL_BANDS);
    expect(ceiling).toBeCloseTo(3.0, 12);
    for (let l = 0; l <= 20; l += 0.01) {
      expect(celBandCurve(l)).toBeLessThanOrEqual(Math.max(l, ceiling) + 1e-9);
    }
  });
});

describe("style names", () => {
  it("ships etched and cel, defaulting to etched", () => {
    expect(STYLE_NAMES).toEqual(["etched", "cel"]);
    expect(DEFAULT_STYLE).toBe("etched");
  });
});
