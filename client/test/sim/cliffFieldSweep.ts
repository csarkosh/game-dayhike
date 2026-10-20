import { expect } from "vitest";
import "../../src/sim/passes/index.js";
import { CLIFF_CELL, CLIFF_RUN_REACH, cliffCellPoint, cliffCellRuns } from "../../src/sim/cliffField.js";
import { CLIFF_LAID } from "./helpers/cliffLaid.js";
import { seedPart } from "../helpers/seedPart.js";

/**
 * The placement's reach on real worlds, beside `cliffField.test.ts`'s tests
 * of the placement. Every module every cell lays within 463.84 m of the
 * origin, on 200 worlds, against the bound the chunk pass and the collector
 * walk by. The residual this walk once also measured — solid hanging over
 * ground the probes never cleared — is retired by the colliders of the cliff
 * pass (`passes/cliffsSweep.ts`), which contain the whole solid. 200 worlds
 * built, about a second each with the valley lakes, and read cell by cell:
 * 251 s, and about 300 s on a CI runner, which made the sweep, as one test,
 * one of the floors under the client suite; vitest hands out files, not
 * tests, so it runs in four parts of fifty worlds (`seedPart`), each a file
 * of its own and each held to its own counts.
 */

/** The parts the sweep is split into, one test file each (`cliffFieldSweep.part<k>.test.ts`). */
export const PLACEMENT_PARTS = 4;

/** The 200 worlds, seeds 1 to 200. */
const WORLDS = Array.from({ length: 200 }, (_, i) => i + 1);

/** What a part pins: the modules its worlds lay, and the farthest a run carried one. */
type PartPins = { laid: number; farthest: number };

/**
 * The counts' history, over the 200 worlds whole. 2026-09-29: 405 laid before
 * the trail left the pad inland. The placement reads the terrain and nothing
 * else, and the trail's bed is cut into the terrain: the trail is another
 * line on 122 of these worlds, and on 9 of them the ground by the old line or
 * the new one opens or shuts a cell's gate. 11 modules went and 32 came,
 * every one within 31.2 m of one line or the other. The farthest carry reads
 * as it did. 2026-09-30: 426 before the lakes and the cove. They are ground
 * the placement reads, and 49 more modules stand on the worlds they change.
 * 2026-10-10: 475 before the valley lakes, whose shores, banks and aprons are
 * other ground than the round ponds' dishes, and whose trails run elsewhere;
 * net 3 more modules (475 to 478) stand on the worlds they change, and none
 * on a lake's ground (one did, on world 147's outer bank, 479 laid).
 *
 * Measured on 2026-10-19 when the sweep was split, part k taking world k and
 * then every fourth: the parts' laid sum to the 478 the sweep was held to
 * whole, and the farthest of their farthest, part 3's, is its 50.59 m, the
 * farthest a run carried a module across these worlds, of the 63.84 the
 * constants allow. A part with no counts here fails naming what it measured, in this
 * table's shape, so a change to the split or to the worlds re-pins from one
 * run.
 */
const PART_PINS: Record<number, PartPins> = {
  1: { laid: 207, farthest: 48.88681647639339 },
  2: { laid: 66, farthest: 50.028708760227936 },
  3: { laid: 149, farthest: 50.594476156076325 },
  4: { laid: 56, farthest: 47.86116045186907 },
};

/**
 * One part of the sweep: its fifty worlds read cell by cell, every module
 * held to `CLIFF_RUN_REACH` from its cell's point as the whole sweep held
 * them, and the part's count and farthest carry held to its own.
 */
export function checkPlacementPart(part: number): void {
  let laid = 0, farthest = 0;
  const w = 400 + CLIFF_RUN_REACH;
  for (const seed of seedPart(WORLDS, part, PLACEMENT_PARTS)) {
    for (let cj = Math.floor(-w / CLIFF_CELL); cj <= Math.floor(w / CLIFF_CELL); cj++) {
      for (let ci = Math.floor(-w / CLIFF_CELL); ci <= Math.floor(w / CLIFF_CELL); ci++) {
        const run = cliffCellRuns(seed, ci, cj, CLIFF_LAID);
        if (run.length === 0) continue;
        const home = cliffCellPoint(seed, ci, cj);
        for (const m of run) {
          laid++;
          const reach = Math.hypot(m.x - home.x, m.z - home.z);
          farthest = Math.max(farthest, reach);
          expect(reach).toBeLessThanOrEqual(CLIFF_RUN_REACH);
        }
      }
    }
  }
  const measured: PartPins = { laid, farthest };
  const pins = PART_PINS[part];
  if (pins === undefined) throw new Error(`no counts for part ${part} of ${PLACEMENT_PARTS}; it measured ${JSON.stringify(measured)}`);
  expect(laid).toBe(pins.laid);
  expect(farthest).toBeCloseTo(pins.farthest, 9);
}
