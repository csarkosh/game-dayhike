// Types for `timeLimit.mjs`, which a Vite config and the tests' helper (`testing/timeLimit.ts`) import.

/** The largest factor accepted. */
export declare const MAX_TIME_SCALE: number;
/** Parses TEST_TIME_SCALE: unset is 1; anything but a decimal in (0, MAX_TIME_SCALE] throws. */
export declare function parseTimeScale(raw: string | undefined): number;
/** `ms` multiplied by TEST_TIME_SCALE: the limit to pass to a test, suite, hook or wait. */
export declare function timeLimit(ms: number): number;
