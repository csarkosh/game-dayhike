/**
 * A test's time limit guards against a hang; it says nothing about speed. The
 * same test takes longer on a slower or busier machine, so every explicit limit
 * in the suites goes through `timeLimit`, which multiplies it by the machine's
 * factor from the TEST_TIME_SCALE environment variable. Unset, the factor is
 * exactly 1 and every limit is the literal written at the call site. The config
 * scales vitest's default limits by the same factor (`vite.config.ts`).
 *
 * A test that asserts on elapsed time is a different thing: its bar is about
 * speed and does not scale. Those carry the `wall-clock` tag instead.
 */

/** Parses TEST_TIME_SCALE: unset is 1; anything but a positive finite decimal throws. */
export function parseTimeScale(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const value = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim()) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `TEST_TIME_SCALE must be a positive number such as 1, 1.5 or 3 (it multiplies every test time limit); got ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

const SCALE = parseTimeScale(process.env.TEST_TIME_SCALE);

/** `ms` multiplied by TEST_TIME_SCALE: the limit to pass to a test, suite or hook. */
export function timeLimit(ms: number): number {
  return ms * SCALE;
}
