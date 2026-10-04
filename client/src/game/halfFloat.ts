/**
 * IEEE 754 binary16, the half float: the texel format of an RGBA16F texture.
 * WebGL2 and WebGPU both take a half-float texture's data as 16-bit words, so
 * the float data the sky's table holds is packed here before it goes up
 * (`skyDome.ts`). Pure and Babylon-free.
 */

/** The largest finite half, 65504, is (2 - 2^-10) * 2^15. */
const HALF_MAX_EXPONENT = 15;
/** The smallest normal half is 2^-14; below it the halves are subnormal, in steps of 2^-24. */
const HALF_MIN_NORMAL = 2 ** -14;
const HALF_SUBNORMAL_STEP = 2 ** -24;
const HALF_INFINITY = 0x7c00;
const HALF_NAN = 0x7e00;
const HALF_ONE = 0x3c00;

/** Rounds to the nearest integer, a tie to the even one. */
function roundEven(x: number): number {
  const floor = Math.floor(x);
  const rest = x - floor;
  if (rest > 0.5) return floor + 1;
  if (rest < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * The binary16 bits of `value`, rounded to the nearest half with a tie to the
 * even one, as a GPU rounds. Rounded straight from the double, so nothing is
 * rounded twice. Past 65504 by half a step or more it is infinity; NaN is the
 * quiet NaN; a negative zero keeps its sign.
 */
export function toHalf(value: number): number {
  if (Number.isNaN(value)) return HALF_NAN;
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const magnitude = Math.abs(value);
  if (magnitude === Infinity) return sign | HALF_INFINITY;
  if (magnitude < HALF_MIN_NORMAL) {
    // A subnormal, in whole steps. 1024 steps is the smallest normal, whose
    // bits are exactly 1024: a value that rounds up into it lands on them.
    return sign | roundEven(magnitude / HALF_SUBNORMAL_STEP);
  }
  let exponent = Math.floor(Math.log2(magnitude));
  // Math.log2 may land a hair off at an exact power of two: settle it so
  // 2^exponent <= magnitude < 2^(exponent + 1).
  if (2 ** exponent > magnitude) exponent -= 1;
  else if (2 ** (exponent + 1) <= magnitude) exponent += 1;
  // Exact: a division by a power of two, and a value in [1, 2) less 1.
  let mantissa = roundEven((magnitude / 2 ** exponent - 1) * 1024);
  if (mantissa === 1024) {
    mantissa = 0;
    exponent += 1;
  }
  if (exponent > HALF_MAX_EXPONENT) return sign | HALF_INFINITY;
  return sign | ((exponent + 15) << 10) | mantissa;
}

/** RGB triples packed as RGBA halves, alpha 1: the data an RGBA16F texture takes. */
export function rgbToHalfRgba(rgb: Float32Array): Uint16Array {
  const texels = Math.floor(rgb.length / 3);
  const out = new Uint16Array(texels * 4);
  for (let i = 0; i < texels; i++) {
    out[i * 4] = toHalf(rgb[i * 3] ?? 0);
    out[i * 4 + 1] = toHalf(rgb[i * 3 + 1] ?? 0);
    out[i * 4 + 2] = toHalf(rgb[i * 3 + 2] ?? 0);
    out[i * 4 + 3] = HALF_ONE;
  }
  return out;
}
