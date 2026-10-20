import { expect } from "vitest";
import "../../../src/sim/passes/index.js";
import type { Aabb } from "../../../src/sim/level.js";
import { elevationSampleAt } from "../../../src/sim/terrain.js";
import { CLIFF_CELL, CLIFF_RUN_REACH, cliffCellRuns, type CliffPoint } from "../../../src/sim/cliffField.js";
import { cliffBuryFace, cliffModuleBoxes } from "../../../src/sim/passes/cliffs.js";
import { drawnShell, seat } from "../helpers/cliffSolid.js";
import { CLIFF_LAID } from "../helpers/cliffLaid.js";
import { seedPart } from "../../helpers/seedPart.js";

/** Containment is exact up to the rounding of one rotation: every lattice
 * point is a convex combination of the corners its box bounds. */
const EPS = 1e-9;

function inside(b: Aabb, x: number, y: number, z: number): boolean {
  return x >= b.min.x - EPS && x <= b.max.x + EPS
    && y >= b.min.y - EPS && y <= b.max.y + EPS
    && z >= b.min.z - EPS && z <= b.max.z + EPS;
}

/** How far below a box's top the terrain along its uphill face may read
 * and still count as burying it. The pass reads the terrain at most
 * `CLIFF_BURY_SAMPLE` apart and moves the face until every reading is at or
 * above the top; this test reads four times as densely, so between the
 * pass's readings a curving hillside could dip a little. Measured over 40
 * worlds at this density: it never dips at all. 5 cm is far below anything a
 * hull could stand in. */
const CLIFF_BURY_TOLERANCE = 0.05;

/**
 * The colliders over the 200-world sweep, beside `cliffs.test.ts`'s tests
 * of the pass. The lattice §11's residual was swept on
 * (`cliffFieldSweep.ts`), extended from the sink line down to the model's
 * base (which sits a little below its origin, `CLIFF_MODEL_BASE`) and up to
 * its true top: the faces of each module's whole drawn box at 1 m, the
 * buried part included, seated as the renderer seats it, over every module
 * within 400 m of the origin on 200 worlds. The lean drops the front of the
 * base below the sunk origin, where the downhill ground can lie lower still,
 * so the part the sink was meant to bury can stand in the open. Each point
 * must lie inside one of the module's own boxes, in all three axes, so
 * nothing drawn stands outside what collides.
 *
 * The same sweep holds the burial (§12.5 of the design): along every box's
 * uphill face, read every quarter metre, the hillside stands at or above the
 * box's top, less CLIFF_BURY_TOLERANCE — except where the face stopped at
 * CLIFF_BURY_MAX, which is counted.
 *
 * 200 worlds built, about a second each with the valley lakes, and read cell
 * by cell: 252 to 261 s, and about 240 s on a CI runner, which made the
 * sweep, as one test, one of the floors under the client suite; vitest hands
 * out files, not tests, so it runs in four parts of fifty worlds
 * (`seedPart`), each a file of its own and each held to its own counts.
 */

/** The parts the sweep is split into, one test file each (`cliffsSweep.part<k>.test.ts`). */
export const COLLIDER_PARTS = 4;

/** The 200 worlds, seeds 1 to 200. */
const WORLDS = Array.from({ length: 200 }, (_, i) => i + 1);

/** What a part pins: its modules, the points of their drawn solids, their boxes and the face reads along them. */
type PartPins = { modules: number; points: number; boxes: number; faceReads: number };

/**
 * The counts' history, over the 200 worlds whole. 2026-09-29: 206 modules,
 * 106996 points, 834 boxes and 21975 face reads before the trail left the
 * pad inland. The modules moved with the ground the trail's bed is cut into,
 * on 9 of the 200 worlds (`cliffFieldSweep.ts` has the count of them);
 * nothing drawn stands outside its boxes, no face is capped and none is
 * exposed, as before. 2026-09-30: 228 modules before the lakes and the cove,
 * which are ground the placement reads: 231 modules, 119158 points, 934
 * boxes and 24476 face reads. Nothing is capped or exposed, as before.
 * 2026-10-10: 231 modules before the valley lakes, other ground the
 * placement reads (`cliffFieldSweep.ts` has the count), and no module stands
 * on a lake's ground: 234 modules, 120636 points, 947 boxes and 24832 face
 * reads. Nothing is capped or exposed, as before: the one module the valley
 * lakes first stood on world 147's outer bank, its uphill face over the
 * lake's basin, capped and exposed 24 face reads.
 *
 * Measured on 2026-10-19 when the sweep was split, part k taking world k and
 * then every fourth: the parts' counts sum to the 234 modules, 120636 points,
 * 947 boxes and 24832 face reads the sweep was held to whole, and each part
 * holds what nothing may exceed as the whole did: no point outside, no face
 * capped, none exposed. A part with no counts here fails naming what it
 * measured, in this table's shape, so a change to the split or to the
 * worlds re-pins from one run.
 */
const PART_PINS: Record<number, PartPins> = {
  1: { modules: 107, points: 59918, boxes: 455, faceReads: 12950 },
  2: { modules: 25, points: 14764, boxes: 108, faceReads: 2692 },
  3: { modules: 78, points: 36288, boxes: 298, faceReads: 7261 },
  4: { modules: 24, points: 9666, boxes: 86, faceReads: 1929 },
};

/**
 * One part of the sweep: its worlds' modules within 400 m of the origin,
 * every drawn point held inside the module's boxes and every uphill face
 * held buried as the whole sweep held them, and the part's counts held to
 * its own.
 */
export function checkColliderPart(part: number): void {
  const r = 400;
  const w = r + CLIFF_RUN_REACH;
  const p: CliffPoint = { x: 0, y: 0, z: 0 };
  let modules = 0, points = 0, boxes = 0, outside = 0, capped = 0, faceReads = 0, exposed = 0;
  for (const seed of seedPart(WORLDS, part, COLLIDER_PARTS)) {
    for (let cj = Math.floor(-w / CLIFF_CELL); cj <= Math.floor(w / CLIFF_CELL); cj++) {
      for (let ci = Math.floor(-w / CLIFF_CELL); ci <= Math.floor(w / CLIFF_CELL); ci++) {
        for (const m of cliffCellRuns(seed, ci, cj, CLIFF_LAID)) {
          if (Math.hypot(m.x, m.z) >= r) continue;
          modules++;
          const built = cliffModuleBoxes(seed, m);
          const own = built.boxes;
          boxes += own.length;
          capped += built.capped;
          const { axis, sign } = cliffBuryFace(m);
          const sx = axis === 0 ? sign : 0, sz = axis === 1 ? sign : 0;
          for (const b of own) {
            const lo = sx !== 0 ? b.min.z : b.min.x, hi = sx !== 0 ? b.max.z : b.max.x;
            const at = sx > 0 ? b.max.x : sx < 0 ? b.min.x : sz > 0 ? b.max.z : b.min.z;
            const n = Math.ceil((hi - lo) / 0.25);
            for (let i = 0; i <= n; i++) {
              const t = lo + ((hi - lo) * i) / n;
              const h = sx !== 0 ? elevationSampleAt(seed, at, t).h : elevationSampleAt(seed, t, at).h;
              faceReads++;
              if (h < b.max.y - CLIFF_BURY_TOLERANCE) exposed++;
            }
          }
          for (const [lx, ly, lz] of drawnShell(m.variant, m.scale, 1)) {
            seat(m, lx, ly, lz, p);
            points++;
            const x = m.x + p.x, y = m.groundH + p.y, z = m.z + p.z;
            if (!own.some((b) => inside(b, x, y, z))) outside++;
          }
        }
      }
    }
  }
  expect(outside).toBe(0);
  const measured: PartPins = { modules, points, boxes, faceReads };
  const pins = PART_PINS[part];
  if (pins === undefined) throw new Error(`no counts for part ${part} of ${COLLIDER_PARTS}; it measured ${JSON.stringify(measured)}, ${capped} capped, ${exposed} exposed`);
  expect(modules).toBe(pins.modules);
  expect(points).toBe(pins.points);
  expect(boxes).toBe(pins.boxes);
  expect(capped).toBe(0);
  expect(exposed).toBe(0);
  expect(faceReads).toBe(pins.faceReads);
}
