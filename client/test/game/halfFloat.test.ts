import { describe, it, expect } from "vitest";
import { rgbToHalfRgba, toHalf } from "../../src/game/halfFloat.js";

/** A half's value, decoded the long way: sign, exponent and mantissa. */
function fromHalf(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 31) return mantissa === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

describe("toHalf", () => {
  it("encodes the known binary16 values exactly", () => {
    expect(toHalf(0)).toBe(0x0000);
    expect(toHalf(-0)).toBe(0x8000);
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(0.5)).toBe(0x3800);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(-65504)).toBe(0xfbff);
    // The smallest normal, a subnormal, the smallest subnormal.
    expect(toHalf(2 ** -14)).toBe(0x0400);
    expect(toHalf(2 ** -15)).toBe(0x0200);
    expect(toHalf(2 ** -24)).toBe(0x0001);
    // Values that are not halves round to the nearest: 0.1 is 0.0999755859375.
    expect(toHalf(0.1)).toBe(0x2e66);
    expect(toHalf(1 / 3)).toBe(0x3555);
  });

  it("rounds a tie to the even half and anything past it to the nearer", () => {
    // 1 + 2^-11 lies halfway between 1 (0x3c00) and the next half (0x3c01).
    expect(toHalf(1 + 2 ** -11)).toBe(0x3c00);
    expect(toHalf(1 + 3 * 2 ** -11)).toBe(0x3c02);
    expect(toHalf(1 + 2 ** -11 + 2 ** -20)).toBe(0x3c01);
    // Halves are 2 apart from 2048: 2049 ties to 2048, 2051 to 2052.
    expect(toHalf(2049)).toBe(0x6800);
    expect(toHalf(2051)).toBe(0x6802);
    // Among the subnormals: half a step ties to 0, a step and a half to 2.
    expect(toHalf(2 ** -25)).toBe(0x0000);
    expect(toHalf(3 * 2 ** -25)).toBe(0x0002);
    expect(toHalf(2 ** -26)).toBe(0x0000);
    // Just under the smallest normal rounds up into it.
    expect(toHalf(2 ** -14 - 2 ** -25)).toBe(0x0400);
  });

  it("overflows to infinity from half a step past 65504, and keeps NaN a NaN", () => {
    expect(toHalf(65519)).toBe(0x7bff);
    expect(toHalf(65520)).toBe(0x7c00);
    expect(toHalf(1e6)).toBe(0x7c00);
    expect(toHalf(-1e6)).toBe(0xfc00);
    expect(toHalf(Infinity)).toBe(0x7c00);
    expect(toHalf(-Infinity)).toBe(0xfc00);
    expect(toHalf(Number.NaN)).toBe(0x7e00);
  });

  it("rounds a value that is not a float32 by its own side of a tie, never twice", () => {
    // Each is read as the float32 1 + 2^-11, a tie between 0x3c00 and 0x3c01.
    expect(toHalf(1 + 2 ** -11 + 2 ** -40)).toBe(0x3c01);
    expect(toHalf(1 + 2 ** -11 - 2 ** -40)).toBe(0x3c00);
    // Among the subnormals, either side of half a step.
    expect(toHalf(2 ** -25 + 2 ** -60)).toBe(0x0001);
    expect(toHalf(2 ** -25 - 2 ** -60)).toBe(0x0000);
    // Either side of 65520, the tie between 65504 and infinity.
    expect(toHalf(65520 - 2 ** -20)).toBe(0x7bff);
    expect(toHalf(65520 + 2 ** -20)).toBe(0x7c00);
    expect(toHalf(-(65520 - 2 ** -20))).toBe(0xfbff);
  });

  it("gives back every finite half from its own value", () => {
    for (let bits = 0; bits < 0x10000; bits++) {
      if (((bits >> 10) & 0x1f) === 31) continue;
      expect(toHalf(fromHalf(bits))).toBe(bits);
    }
  });
});

describe("rgbToHalfRgba", () => {
  it("packs each RGB triple as four halves, alpha 1", () => {
    const packed = rgbToHalfRgba(new Float32Array([0, 1, -2, 0.5, 65504, 2 ** -24]));
    expect(packed).toBeInstanceOf(Uint16Array);
    expect([...packed]).toEqual([0x0000, 0x3c00, 0xc000, 0x3c00, 0x3800, 0x7bff, 0x0001, 0x3c00]);
  });

  it("packs each channel times the scale it is given, alpha still 1", () => {
    const packed = rgbToHalfRgba(new Float32Array([0.25, 1, -2, 1e-7, 3e4, 0]), undefined, 4);
    expect([...packed]).toEqual([0x3c00, 0x4400, 0xc800, 0x3c00, 0x0007, 0x7c00, 0x0000, 0x3c00]);
    const out = new Uint16Array(8);
    expect(rgbToHalfRgba(new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]), out, 0.5)).toBe(out);
    expect([...out]).toEqual([0x3400, 0x3400, 0x3400, 0x3c00, 0x3400, 0x3400, 0x3400, 0x3c00]);
  });

  it("packs a whole slice: 32 x 64 texels to 8192 halves", () => {
    expect(rgbToHalfRgba(new Float32Array(32 * 64 * 3)).length).toBe(32 * 64 * 4);
  });

  it("fills and returns an output it is given, every word of it", () => {
    const out = new Uint16Array(8).fill(0xffff);
    const packed = rgbToHalfRgba(new Float32Array([0, 1, -2, 0.5, 65504, 2 ** -24]), out);
    expect(packed).toBe(out);
    expect([...out]).toEqual([0x0000, 0x3c00, 0xc000, 0x3c00, 0x3800, 0x7bff, 0x0001, 0x3c00]);
  });

  it("refuses an output that is not four halves for each RGB triple", () => {
    const rgb = new Float32Array(6);
    expect(() => rgbToHalfRgba(rgb, new Uint16Array(7))).toThrow(RangeError);
    expect(() => rgbToHalfRgba(rgb, new Uint16Array(9))).toThrow(RangeError);
    expect(() => rgbToHalfRgba(rgb, new Uint16Array(6))).toThrow(RangeError);
  });
});
