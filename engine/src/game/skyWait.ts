/**
 * The hour a renderer starts at, and the wait for the sky: whether the sky's
 * table (`skyTable.ts`) holds the slices an hour's sky state is made from,
 * and a promise of the moment it does. Whatever lights the world from the
 * sky state (`skyState.ts`) waits here before its first frame; this module
 * loads no Babylon.
 */
import { sunPositionAt } from "./sky.js";
import { NOON_ALTITUDE_DEG, type SkyTable } from "./skyTable.js";

/** Matches the `/time` command's `defaultValue` in `commands.ts`. */
export const DEFAULT_HOUR = 12;

/**
 * The sun's altitude at `hour`, in degrees: the altitude the sky's table is
 * read at. Below the lowest slice the table serves the lowest slice
 * (`sliceBracket`), so the deep night needs no slice of its own.
 */
export function sunAltitudeDeg(hour: number): number {
  return (Math.asin(sunPositionAt(hour).y) * 180) / Math.PI;
}

/**
 * Whether `table` holds what the sky state at `hour` is made from: the
 * slices either side of noon, which fix the scale and the adaptation, and
 * those either side of the hour's sun.
 */
export function skyHeld(table: SkyTable, hour: number): boolean {
  return table.has(NOON_ALTITUDE_DEG) && table.has(sunAltitudeDeg(hour));
}

/** How long a wait for the sky goes on before it says so in the console. */
export const SKY_WAIT_WARN_MS = 10_000;

/**
 * Resolves once `skyHeld(table, hour())` holds. `hour` is read again at every
 * slice that arrives, so an hour changed while the first slices are made is
 * the one waited for. Still waiting `SKY_WAIT_WARN_MS` after it began, it
 * warns once, and waits on: a page whose slices never come is held, not shown
 * unlit, but not in silence. Once `options.signal` is aborted it stops
 * listening to the table and never resolves: what waited on it has gone.
 */
export function whenSkyHeld(table: SkyTable, hour: () => number, options: { signal?: AbortSignal } = {}): Promise<void> {
  return new Promise((resolve) => {
    const signal = options.signal;
    if (signal?.aborted) return;
    if (skyHeld(table, hour())) {
      resolve();
      return;
    }
    const warning = setTimeout(() => {
      console.warn(`the sky's slices have not arrived after ${SKY_WAIT_WARN_MS / 1000} s; still waiting for them`);
    }, SKY_WAIT_WARN_MS);
    const stop = (): void => {
      off();
      clearTimeout(warning);
      signal?.removeEventListener("abort", stop);
    };
    const off = table.onChange(() => {
      if (!skyHeld(table, hour())) return;
      stop();
      resolve();
    });
    signal?.addEventListener("abort", stop, { once: true });
  });
}
