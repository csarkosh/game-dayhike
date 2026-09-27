/**
 * A test's time limit guards against a hang; it says nothing about speed. The
 * same test takes longer on a slower or busier machine, so every explicit limit
 * in the client suite goes through `timeLimit`, which multiplies it by the
 * machine's factor from the TEST_TIME_SCALE environment variable. Unset, the
 * factor is exactly 1 and every limit is the literal written at the call site.
 * The config scales vitest's default limits by the same factor
 * (`vite.config.ts`), and only when vitest is running.
 *
 * The variable is read on the first call, never on import, so a bad value in a
 * shell cannot break `vite dev` or `vite build`, which load the same config.
 *
 * A test that asserts on elapsed time is a different thing: its bar is about
 * speed and does not scale. Those carry the `wall-clock` tag instead.
 */

/**
 * The largest factor accepted. Node turns a timer delay above 2^31-1 ms (about
 * 24.8 days) into 1 ms, so a factor large enough to "switch the limits off"
 * would make them fire at once instead. Ten keeps the longest limit in the
 * suite (600 s) at 100 minutes, far below that ceiling.
 */
export const MAX_TIME_SCALE = 10;

/** Parses TEST_TIME_SCALE: unset is 1; anything but a decimal in (0, MAX_TIME_SCALE] throws. */
export function parseTimeScale(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const value = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim()) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `TEST_TIME_SCALE must be a positive number such as 1, 1.5 or 3 (it multiplies every test time limit); got ${JSON.stringify(raw)}`,
    );
  }
  if (value > MAX_TIME_SCALE) {
    throw new Error(
      `TEST_TIME_SCALE must be at most ${MAX_TIME_SCALE}; got ${JSON.stringify(raw)}. Node turns a timer longer than 2^31-1 ms into 1 ms, so a larger factor could make a limit fire at once instead of never`,
    );
  }
  return value;
}

let scale: number | undefined;

/** `ms` multiplied by TEST_TIME_SCALE: the limit to pass to a test, suite, hook or wait. */
export function timeLimit(ms: number): number {
  scale ??= parseTimeScale(process.env.TEST_TIME_SCALE);
  return ms * scale;
}
