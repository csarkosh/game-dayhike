import { sunPositionAt } from "../../../src/game/sky.js";
import { SLICE_ALTITUDES_DEG } from "../../../src/game/skyModel.js";
import { buildSkyTableSync, NOON_ALTITUDE_DEG, sliceBracket, type SkyTable } from "../../../src/game/skyTable.js";

/** The hours the suite's sky tests read: night, sunrise, the morning, noon,
 * the afternoon, the run through sunset and twilight, and night again. */
export const SKY_FIXTURE_HOURS: readonly number[] = [0, 6, 8, 12, 15, 17, 18, 18.25, 18.5, 19, 21, 22];

let table: SkyTable | null = null;

/**
 * One table per test file, built once on first call with buildSkyTableSync:
 * the noon bracket plus the slices bracketing the sun's altitude at
 * SKY_FIXTURE_HOURS, as `sliceBracket` names them, so `has` is true at each.
 * These 17 slices take about 0.15 s; every slice would take more than twice
 * that in every file that reads the sky.
 */
export function skyFixture(): SkyTable {
  if (table === null) {
    const indices = new Set<number>(sliceBracket(NOON_ALTITUDE_DEG));
    for (const hour of SKY_FIXTURE_HOURS) {
      for (const index of sliceBracket((Math.asin(sunPositionAt(hour).y) * 180) / Math.PI)) indices.add(index);
    }
    table = buildSkyTableSync([...indices].sort((a, b) => a - b).map((index) => SLICE_ALTITUDES_DEG[index] as number));
  }
  return table;
}
