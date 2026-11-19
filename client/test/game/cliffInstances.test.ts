import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { CLIFF_MODELS, CLIFF_TILT_MAX, cliffFacing } from "../../src/sim/cliffField.js";
import type { ClutterInstance } from "../../src/sim/clutter.js";
import { CLIFF_FADE_BAND, CLIFF_RINGS, cliffBands, cliffOrigin, collectCliffs } from "../../src/game/cliffField.js";
import { CLIFF_FAR_LOD, CLIFF_GROUND_TINT, CLIFF_LOD_NODES, cliffInstanceMatrix, cliffSeat, createCliffLists } from "../../src/game/cliffInstances.js";
import { FADE_NONE_IN } from "../../src/game/distanceFade.js";
import { seatOnGroundCapped } from "../../src/game/groundTilt.js";
import { CLIFF_LAID } from "../sim/helpers/cliffLaid.js";

// The scarp fixture of the cliff shell's test: all three rings hold modules.
const SEED = 627994160;
const CAM = { x: -340, z: -897 };
const every = (): boolean => true;

describe("a cliff module's seat", () => {
  it("faces as the field drew it and leans with the slope no further than the cap", () => {
    const inst: ClutterInstance = { cls: 0, x: 3, z: 4, groundH: 10, groundDx: 1.2, groundDz: -0.4, scale: 2, variant: 0, hash: 0.37 };
    const q = { x: 0, y: 0, z: 0, w: 1 };
    cliffSeat(inst, q);
    const f = cliffFacing(inst.groundDx, inst.groundDz, inst.hash);
    const want = { x: 0, y: 0, z: 0, w: 1 };
    seatOnGroundCapped(Math.atan2(f.fx, f.fz), inst.groundDx, inst.groundDz, CLIFF_TILT_MAX, want);
    expect(q).toEqual(want);
    const m = new Float32Array(16);
    cliffInstanceMatrix(inst, m);
    // Its place as the field gave it, no sink of its own; a uniform scale on every axis.
    expect([m[12], m[13], m[14]]).toEqual([3, 10, 4]);
    for (const column of [0, 1, 2]) expect(Math.hypot(m[column * 4] as number, m[column * 4 + 1] as number, m[column * 4 + 2] as number)).toBeCloseTo(2, 5);
    expect(CLIFF_GROUND_TINT).toBe(0.5);
  });
});

describe("the cliff field's lists", () => {
  it("are one a model and a ring, each with the ground's tint, the far ring's with the bands it dithers out across", () => {
    const lists = createCliffLists(SEED, "high", CLIFF_LAID);
    expect(lists.lists.length).toBe(CLIFF_MODELS.length);
    for (const row of lists.lists) {
      expect(row.length).toBe(CLIFF_LOD_NODES.length);
      row.forEach((list, lod) => expect(list.streams).toEqual({ bands: lod === CLIFF_FAR_LOD, foliage: true, strength: false }));
    }
    const reach = CLIFF_RINGS.high[2];
    expect(lists.farBands).toEqual([...FADE_NONE_IN, reach - CLIFF_FADE_BAND, reach]);
  });

  it("fill each list with its ring's modules of its model, nearest first, seated, tinted, the far ring's banded", () => {
    const lists = createCliffLists(SEED, "high", CLIFF_LAID);
    lists.rebuild(CAM.x, CAM.z, every);
    const origin = cliffOrigin(CAM.x, CAM.z);
    const bands = cliffBands(collectCliffs(SEED, CAM.x, CAM.z, CLIFF_RINGS.high[2], CLIFF_LAID), origin.x, origin.z, CLIFF_RINGS.high);
    const scratch = new Float32Array(16);
    bands.forEach((band, lod) => {
      expect(band.length).toBeGreaterThan(0);
      const cursor = [0, 0];
      for (const m of band) {
        const list = lists.lists[m.variant]![lod]!;
        const i = cursor[m.variant]!++;
        cliffInstanceMatrix(m, scratch);
        expect([...list.buf.subarray(i * 16, i * 16 + 16)]).toEqual([...scratch]);
        // A colour and the sky's openness: never the black that means no tint.
        expect(Math.max(list.foliage[i * 4] as number, list.foliage[i * 4 + 1] as number, list.foliage[i * 4 + 2] as number)).toBeGreaterThan(1 / 255);
        if (lod === CLIFF_FAR_LOD) expect([...list.bands.subarray(i * 4, i * 4 + 4)]).toEqual([...lists.farBands]);
      }
      cursor.forEach((count, model) => expect(lists.lists[model]![lod]!.count).toBe(count));
    });
    // The near rings carry no bands at all.
    expect(lists.lists[0]![0]!.bands.length).toBe(0);
  });

  it("leave alone a list nothing draws, and lay nothing at the shipped density", () => {
    const lists = createCliffLists(SEED, "high", CLIFF_LAID);
    lists.rebuild(CAM.x, CAM.z, (model) => model === 0);
    expect(lists.lists[0]!.some((list) => list.count > 0)).toBe(true);
    expect(lists.lists[1]!.every((list) => list.count === 0 && list.buf.length === 0)).toBe(true);
    const shipped = createCliffLists(SEED, "high");
    shipped.rebuild(CAM.x, CAM.z, every);
    expect(shipped.lists.flat().every((list) => list.count === 0)).toBe(true);
  });
});
