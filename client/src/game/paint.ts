/**
 * Runs `fn` after the browser has painted the next frame.
 *
 * A tap handler that starts a long synchronous job (building a world, tearing
 * a renderer down) never lets the page paint the pressed state it set a line
 * earlier: the browser is busy until the job ends, so the player sees nothing
 * happen and taps again. A `requestAnimationFrame` callback runs before that
 * frame paints, which is too early; a timer queued from inside it runs once
 * the frame is on screen, which is exactly when the job may start.
 */
export function afterNextPaint(fn: () => void): void {
  requestAnimationFrame(() => setTimeout(fn, 0));
}
