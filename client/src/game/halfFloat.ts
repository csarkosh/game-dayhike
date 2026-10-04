/**
 * IEEE 754 binary16, the half float: the texel format of an RGBA16F texture.
 * WebGL2 and WebGPU both take a half-float texture's data as 16-bit words, so
 * the float data the sky's table holds is packed here before it goes up
 * (`skyDome.ts`), every frame of a weather fade. Pure and Babylon-free.
 *
 * Packed from the bits of the value as a float32, shifted and rounded as
 * integers: no logarithm and no division per channel.
 */

const HALF_INFINITY = 0x7c00;
const HALF_NAN = 0x7e00;
const HALF_ONE = 0x3c00;
/** float32 bits: the exponent field of +infinity and NaN, and the magnitude mask. */
const FLOAT_INFINITY = 0x7f800000;
const FLOAT_MAGNITUDE = 0x7fffffff;
/** The float32 bits of 2^-14, the smallest normal half. */
const FLOAT_HALF_MIN_NORMAL = 0x38800000;
/** The float32 bits of 2^16: from there every magnitude is past the largest finite half, 65504. */
const FLOAT_HALF_OVERFLOW = 0x47800000;
/** Rebias from float32's exponent (127) to binary16's (15), in place in the bits. */
const REBIAS = (127 - 15) << 23;
/** The float32 mantissa bits a half drops (23 - 10), and half of their step. */
const DROPPED = 13;
const DROPPED_MASK = (1 << DROPPED) - 1;
const DROPPED_HALF = 1 << (DROPPED - 1);

/** One float32's bits, read through a shared buffer. */
const scratchFloat = new Float32Array(1);
const scratchBits = new Uint32Array(scratchFloat.buffer);

/**
 * The binary16 bits of float32 magnitude bits `m` (sign cleared), rounded to
 * the nearest half with a tie to the even one. `tie` breaks an exact tie
 * instead: 1 rounds it up, -1 down, 0 to even (the bits are the value).
 */
function halfOfMagnitude(m: number, tie: number): number {
  if (m >= FLOAT_INFINITY) return m > FLOAT_INFINITY ? HALF_NAN : HALF_INFINITY;
  if (m >= FLOAT_HALF_OVERFLOW) return HALF_INFINITY;
  let half: number;
  let rest: number;
  let halfway: number;
  if (m >= FLOAT_HALF_MIN_NORMAL) {
    // A normal half: rebias the exponent and drop 13 mantissa bits. A carry
    // out of the mantissa steps the exponent, up to infinity past 65504.
    half = (m - REBIAS) >>> DROPPED;
    rest = m & DROPPED_MASK;
    halfway = DROPPED_HALF;
  } else {
    // A subnormal half, in steps of 2^-24: the full mantissa, its leading 1
    // restored, shifted by how far the exponent lies below 2^-14. Below 2^-25
    // (a shift past 24) everything rounds to 0; float32's own subnormals too.
    const exponent = m >>> 23;
    const shift = 126 - exponent;
    if (shift > 24 || exponent === 0) return 0;
    const mantissa = (m & 0x7fffff) | 0x800000;
    half = mantissa >>> shift;
    rest = mantissa & ((1 << shift) - 1);
    halfway = 1 << (shift - 1);
  }
  if (rest > halfway || (rest === halfway && (tie > 0 || (tie === 0 && (half & 1) === 1)))) half += 1;
  return half;
}

/**
 * The binary16 bits of `value`, rounded to the nearest half with a tie to the
 * even one, as a GPU rounds. Past 65504 by half a step or more it is infinity;
 * NaN is the quiet NaN; a negative zero keeps its sign. A value that is not a
 * float32 is read as the nearest one, and where that one falls exactly on a
 * tie between two halves, the value's side of it decides, so nothing is
 * rounded twice.
 */
export function toHalf(value: number): number {
  scratchFloat[0] = value;
  const bits = scratchBits[0] as number;
  const sign = (bits >>> 16) & 0x8000;
  const magnitude = bits & FLOAT_MAGNITUDE;
  if (magnitude > FLOAT_INFINITY) return HALF_NAN;
  const nearest = scratchFloat[0] as number;
  const tie = nearest === value ? 0 : Math.abs(value) > Math.abs(nearest) ? 1 : -1;
  return sign | halfOfMagnitude(magnitude, tie);
}

/**
 * RGB triples packed as RGBA halves, alpha 1: the data an RGBA16F texture
 * takes, each channel times `scale` (1 if unset). Into `out` when given, which
 * must hold four halves for each triple (a RangeError otherwise), so a caller
 * that packs every frame allocates nothing; else into a new array. Returns the
 * array packed into.
 */
export function rgbToHalfRgba(rgb: Float32Array, out?: Uint16Array, scale = 1): Uint16Array {
  const texels = Math.floor(rgb.length / 3);
  if (out !== undefined && out.length !== texels * 4) {
    throw new RangeError(`${texels} RGB triples pack into ${texels * 4} halves; the output holds ${out.length}`);
  }
  out ??= new Uint16Array(texels * 4);
  for (let i = 0; i < texels; i++) {
    out[i * 4] = toHalf((rgb[i * 3] as number) * scale);
    out[i * 4 + 1] = toHalf((rgb[i * 3 + 1] as number) * scale);
    out[i * 4 + 2] = toHalf((rgb[i * 3 + 2] as number) * scale);
    out[i * 4 + 3] = HALF_ONE;
  }
  return out;
}
