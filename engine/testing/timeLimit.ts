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
 *
 * The helper itself is `vite/timeLimit.mjs`, plain JavaScript, so that a Vite config can load the
 * same one from an installed package; a test takes it from here.
 */
export { MAX_TIME_SCALE, parseTimeScale, timeLimit } from "../vite/timeLimit.mjs";
