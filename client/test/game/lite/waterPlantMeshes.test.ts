import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import "@csarkosh/engine/sim/olympic";
import { firstPondWorld, lakeOf } from "../../sim/helpers/lakes.js";
import { boxInPlanes } from "@csarkosh/engine/game/lakeSeen";
import { cameraAxes, restAxes, restPlanes, viewPlanes } from "@csarkosh/engine/game/lite/cameraPose";
import { LILY_AROUND_M, PLANT_SLACK_M, REED_AROUND_M, REED_TOP_M } from "../../../src/game/lite/waterPlantMeshes.js";
import { waterPlantPlacements } from "@csarkosh/engine/game/waterPlantField";
import { PLANT_CELL_M, REED_CHARACTERS, plantBoxes, waterPlantLists } from "@csarkosh/engine/game/waterPlantShapes";
import { timeLimit } from "../../helpers/timeLimit.js";

/** The view's planes from (x, y, z) at `yaw`, level, through a lens 1.4 rad tall and 1.5 wide. */
function view(x: number, y: number, z: number, yaw: number) {
  return viewPlanes({ x, y, z, yaw, pitch: 0, roll: 0 }, cameraAxes(yaw, 0, 0, restAxes()), 1.4, 1.5, 0.1, 2500, restPlanes());
}

describe("a lake's plants shown by the view on Babylon Lite", { timeout: timeLimit(60_000) }, () => {
  const { seed } = firstPondWorld((f) => (f.murk ?? 0) >= 0.8);
  const lake = lakeOf(seed);
  const lists = waterPlantLists(seed, [lake], [waterPlantPlacements(seed, lake)]);

  it("boxes a mesh's plants by 16 m cells of the ground, each box holding its plants with their reach", () => {
    for (const [list, around, above] of [[lists.reeds[0], REED_AROUND_M, REED_TOP_M], [lists.pads, LILY_AROUND_M, PLANT_SLACK_M]] as const) {
      if (list === undefined || list.count === 0) continue;
      const boxes = plantBoxes(list, around, PLANT_SLACK_M, above);
      expect(boxes.length % 6).toBe(0);
      expect(boxes.length / 6).toBeLessThanOrEqual(list.count);
      for (let at = 0; at < boxes.length; at += 6) {
        expect((boxes[at + 3] as number) - (boxes[at] as number)).toBeLessThanOrEqual(PLANT_CELL_M + 2 * around + 1e-3);
      }
      for (let i = 0; i < list.count; i++) {
        const x = list.matrices[i * 16 + 12] as number, y = list.matrices[i * 16 + 13] as number, z = list.matrices[i * 16 + 14] as number;
        let held = false;
        for (let at = 0; at < boxes.length && !held; at += 6) {
          held = x - around >= (boxes[at] as number) - 1e-3 && x + around <= (boxes[at + 3] as number) + 1e-3 && z - around >= (boxes[at + 2] as number) - 1e-3
            && z + around <= (boxes[at + 5] as number) + 1e-3 && y - PLANT_SLACK_M >= (boxes[at + 1] as number) - 1e-3 && y + above <= (boxes[at + 4] as number) + 1e-3;
        }
        expect(held, `plant ${i}`).toBe(true);
      }
    }
    for (const character of REED_CHARACTERS) expect(character.height[1] * 1.1).toBeLessThan(REED_TOP_M);
    expect(plantBoxes({ matrices: new Float32Array(0), count: 0 }, 1, 1, 1)).toHaveLength(0);
  });

  it("holds a box in a view that faces it and not in one that faces away", () => {
    const boxes = plantBoxes(lists.pads.count > 0 ? lists.pads : (lists.reeds.find((l) => l.count > 0) as { matrices: Float32Array; count: number }), 1, PLANT_SLACK_M, 1);
    const cx = ((boxes[0] as number) + (boxes[3] as number)) / 2, cy = boxes[4] as number, cz = ((boxes[2] as number) + (boxes[5] as number)) / 2;
    const inView = (planes: ReturnType<typeof view>): boolean => boxInPlanes(boxes[0] as number, boxes[1] as number, boxes[2] as number, boxes[3] as number, boxes[4] as number, boxes[5] as number, planes);
    expect(inView(view(cx, cy + 2, cz - 40, 0))).toBe(true);
    expect(inView(view(cx, cy + 2, cz - 40, Math.PI))).toBe(false);
    expect(inView(view(cx, cy + 0.5, cz, 0))).toBe(true);
  });
});
