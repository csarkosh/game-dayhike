/**
 * The colour type and the two helpers that `sky.ts` and the ground-albedo code
 * that will follow it both need. It exists so neither of those has to import
 * the other for a type alias — ground albedo and the sun have no business
 * depending on each other.
 */

export type Rgb = { r: number; g: number; b: number };

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Linear interpolation per channel. `t` is not clamped; callers already have.
 * `t` of exactly 0 or 1 returns a copy of the endpoint rather than a
 * float-recomputed one, so callers get the endpoint colour bit-for-bit without
 * aliasing whatever object the caller passed in.
 */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  if (t === 0) return { ...a };
  if (t === 1) return { ...b };
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** Rec. 709 relative luminance. The weights sum to 1, so grey maps to itself. */
export function luma(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * Pulls a colour toward its own luminance. `k` of exactly 0 returns a copy of
 * the input (via `mixRgb`), which is what lets weather's clear state reproduce
 * the sunny palette bit-for-bit.
 */
export function desaturateRgb(c: Rgb, k: number): Rgb {
  const l = luma(c);
  return mixRgb(c, { r: l, g: l, b: l }, k);
}
