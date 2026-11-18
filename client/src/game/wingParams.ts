/**
 * A wing's beat, as numbers: the angle a wing is turned through about its
 * body's forward axis, amp·sin(ωt + phase), the clock it is counted on and
 * the share of it a vertex takes by how far out along the wing it lies. The
 * stage that turns the vertices is each renderer's own (`lite/wingPlugin.ts` on
 * Babylon.js); this is what both turn them by.
 *
 * Renderer-only by design: no constant here may migrate into sim/ or a
 * tunables registry.
 */

/** Wrap period (s). Every ω a wing beats at is 2π·n / WING_TIME_WRAP, so the wrap is phase-continuous. */
export const WING_TIME_WRAP = 300;

/** The wings' clock at `ms` on the page's: seconds, wrapped. */
export function wingTime(ms: number): number {
  return (ms / 1000) % WING_TIME_WRAP;
}

/** The half span a material's wings are measured against: a model with no width beats against one metre. */
export function wingHalfSpan(halfSpan: number): number {
  return halfSpan > 0 ? halfSpan : 1;
}

/** The angle at time `t` (s) of a wing of `phase` and `amp` beating at `omega` (rad/s): amp·sin(ω·t + phase). */
export function wingAngle(t: number, phase: number, amp: number, omega: number): number {
  return amp * Math.sin((t % WING_TIME_WRAP) * omega + phase);
}
