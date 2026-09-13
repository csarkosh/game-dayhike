import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { elevationAt } from "../../src/sim/terrain.js";
import { treesInRect, COHORT_GIANT, COHORT_SAPLING } from "../../src/sim/vegetation.js";
import { conformDisplacement, GROUND_CONFORM_RAMP } from "../../src/game/groundConformPlugin.js";

const SEED = 0x5eed1;

/** Base plate radius within the first 0.1 m above the origin, measured from
 * the shipped GLBs: giant_fir and giant_pine both 0.59 m, conifer_a 0.27 m. The
 * plate is FLAT — full radius is reached within 10 cm — which is the whole
 * cause of the artifact. */
const PLATE = { [COHORT_GIANT]: 0.59, [COHORT_SAPLING]: 0.27 } as Record<number, number>;
/** Model-space height of the plate's outer edge. */
const PLATE_Y = 0.05;

function percentile(v: readonly number[], f: number): number {
  const a = [...v].sort((p, q) => p - q);
  return a[Math.min(a.length - 1, Math.floor(f * a.length))] as number;
}

/** Worst daylight under the plate: the largest amount by which the drawn base
 * sits above the true ground, sampled at 24 azimuths and two radii — exactly
 * how the artifact was originally measured. */
function daylight(cohort: number, conform: boolean): number[] {
  const list = treesInRect(SEED, -120, -120, 120, 120).filter((t) => t.cohort === cohort);
  // Back to > 10: the sapling count in this rect dropped 14 → 9 at one point
  // when the trail graph moved, and TRAIL_CLEAR 3 → 6 brought it back to 13
  // (measured at the shipped head) by keeping trees off the bench cut's bank
  // entirely rather than off its bed alone.
  expect(list.length).toBeGreaterThan(10);
  return list.map((t) => {
    const R = (PLATE[cohort] as number) * t.scale;
    let worst = 0;
    for (let i = 0; i < 24; i++) {
      const th = (i / 24) * Math.PI * 2;
      for (const f of [0.5, 1]) {
        const ox = Math.cos(th) * R * f;
        const oz = Math.sin(th) * R * f;
        const disp = conform
          ? conformDisplacement(ox, oz, PLATE_Y, t.groundDx, t.groundDz)
          : 0;
        const gap = t.groundH + disp - elevationAt(SEED, t.x + ox, t.z + oz);
        if (gap > worst) worst = gap;
      }
    }
    return worst;
  });
}

describe("the conform closes the daylight under flat root plates", () => {
  it("takes giants from a median 0.61 m gap to nothing", () => {
    const before = daylight(COHORT_GIANT, false);
    const after = daylight(COHORT_GIANT, true);
    expect(percentile(before, 0.5)).toBeGreaterThan(0.5);
    expect(percentile(before, 0.9)).toBeGreaterThan(1.0);
    expect(percentile(after, 0.5)).toBeLessThanOrEqual(0.01);
    expect(percentile(after, 0.9)).toBeLessThanOrEqual(0.35);
  });

  it("closes saplings too", () => {
    const after = daylight(COHORT_SAPLING, true);
    // Back to <= 0.01: with TRAIL_CLEAR = 6 no sapling stands on a corridor
    // bank in this rect and the p90 measures 0.0011 at the shipped head, an
    // order of magnitude under the original ceiling. The worst sapling stands
    // 126.53 m from the nearest trail edge.
    expect(percentile(after, 0.9)).toBeLessThanOrEqual(0.01);
  });

  it("leaves the p99 and the worst case honestly imperfect", () => {
    // A plane cannot follow broken ground under a 3 m plate. These are the
    // limit of the approach, recorded so a future change that makes them
    // WORSE is visible rather than silently absorbed.
    //
    // Both ceilings are BACK to earlier values, from a point where the whole
    // trail graph moved and put this rect's worst giant 4.16 m from a
    // corridor centreline — just outside TRAIL_CORRIDOR_HALF, standing on the
    // bench cut's own bank,
    // which no flat root plate can follow: p99 2.30, max 7.28. Widening this
    // test's ceilings recorded that artefact rather than removing it, so the
    // fix went where the artefact was: TRAIL_CLEAR 3 → 6 keeps every trunk 2 m
    // clear of the corridor's outer edge. Re-measured at the SHIPPED head
    // (ASCENT_LEG_DZ_MIN 113, fan 9 × 20): p99 0.8172, max 2.3027, and the
    // worst giant in the rect now stands 130.39 m from the nearest trail edge —
    // the tail is ordinary broken ground again, not the trail's bank.
    const after = daylight(COHORT_GIANT, true);
    expect(percentile(after, 0.99)).toBeLessThanOrEqual(1.0);
    expect(Math.max(...after)).toBeLessThanOrEqual(2.5);
  });

  it("does nothing at all on flat ground", () => {
    for (const y of [0, PLATE_Y, GROUND_CONFORM_RAMP * 0.5]) {
      expect(conformDisplacement(3, -2, y, 0, 0)).toBe(0);
    }
  });
});
