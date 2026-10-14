import { describe, it, expect } from "vitest";
import {
  ALDER_BARK,
  BARK_FOOTPRINT,
  barkOutputs,
  barkSize,
  barkTransform,
  CONIFER_A_BARK,
  CONIFER_B_BARK,
  GIANT_FIR_BARK,
  GIANT_PINE_CEDAR_BARK,
  GIANT_PINE_METASEQUOIA_BARK,
  GIANT_SETS,
  inGiantSet,
  QUARTER_TURN,
  SAPLING_BARKS,
} from "../../src/game/barkParams.js";

describe("the bark sets", () => {
  it("have the scans' footprints, the cedar's and the alder's plates twice as tall as wide", () => {
    expect(BARK_FOOTPRINT).toEqual({
      pine: { width: 2.0, height: 2.0 },
      metasequoia: { width: 1.94, height: 1.94 },
      cedar: { width: 1.0, height: 2.0 },
      alder: { width: 0.5, height: 1.0 },
    });
  });

  it("name the three maps of a set at a size by the catalog's outputs", () => {
    expect(barkOutputs("pine", "2k")).toEqual({
      colour: "textures/bark.pine.2k.ktx2",
      normal: "textures/bark.pine.2k.normal.ktx2",
      arm: "textures/bark.pine.2k.arm.ktx2",
    });
    expect(barkOutputs("cedar", "1k")).toEqual({
      colour: "textures/bark.cedar.1k.ktx2",
      normal: "textures/bark.cedar.1k.normal.ktx2",
      arm: "textures/bark.cedar.1k.arm.ktx2",
    });
  });
});

describe("each tree's dressing", () => {
  it("is the set chosen for it, tiled from its measured size", () => {
    expect(GIANT_FIR_BARK).toEqual({ set: "pine", along: "v", alongRepeat: 6.3, roundRepeat: 1.7, fine: true });
    expect(GIANT_PINE_METASEQUOIA_BARK).toEqual({ set: "metasequoia", along: "u", alongRepeat: 1.6, roundRepeat: 1.0, fine: true });
    expect(GIANT_PINE_CEDAR_BARK).toEqual({ set: "cedar", along: "u", alongRepeat: 1.5, roundRepeat: 1.9, fine: true });
    expect(ALDER_BARK).toEqual({ set: "alder", along: "v", alongRepeat: 2.2, roundRepeat: 3.7, fine: true });
    expect(CONIFER_A_BARK).toEqual({ set: "pine", along: "u", alongRepeat: 1.2, roundRepeat: 0.23, fine: false });
    expect(CONIFER_B_BARK).toEqual({ set: "metasequoia", along: "u", alongRepeat: 1.6, roundRepeat: 0.15, fine: false });
  });

  it("lays the fir's and the alder's sets straight, and turns the pine family's a quarter so the plates stand up the trunk", () => {
    expect(barkTransform(GIANT_FIR_BARK)).toEqual({ uScale: 1.7, vScale: 6.3, wAng: 0 });
    expect(barkTransform(ALDER_BARK)).toEqual({ uScale: 3.7, vScale: 2.2, wAng: 0 });
    expect(QUARTER_TURN).toBe(Math.PI / 2);
    expect(barkTransform(GIANT_PINE_METASEQUOIA_BARK)).toEqual({ uScale: 1.6, vScale: 1.0, wAng: Math.PI / 2 });
    expect(barkTransform(GIANT_PINE_CEDAR_BARK)).toEqual({ uScale: 1.5, vScale: 1.9, wAng: Math.PI / 2 });
    expect(barkTransform(CONIFER_A_BARK)).toEqual({ uScale: 1.2, vScale: 0.23, wAng: Math.PI / 2 });
    expect(barkTransform(CONIFER_B_BARK)).toEqual({ uScale: 1.6, vScale: 0.15, wAng: Math.PI / 2 });
  });

  it("wears 2k on the high tier where it stands near, 1k otherwise", () => {
    expect(barkSize("high", GIANT_FIR_BARK)).toBe("2k");
    expect(barkSize("high", GIANT_PINE_CEDAR_BARK)).toBe("2k");
    expect(barkSize("high", ALDER_BARK)).toBe("2k");
    expect(barkSize("high", CONIFER_A_BARK)).toBe("1k");
    expect(barkSize("high", CONIFER_B_BARK)).toBe("1k");
    for (const tier of ["medium", "low"] as const) {
      for (const bark of [GIANT_FIR_BARK, GIANT_PINE_METASEQUOIA_BARK, GIANT_PINE_CEDAR_BARK, ALDER_BARK, CONIFER_A_BARK, CONIFER_B_BARK]) {
        expect(barkSize(tier, bark), `${tier} ${bark.set}`).toBe("1k");
      }
    }
  });
});

describe("the giants' bucket sets", () => {
  it("are the fir's one and the pine's two, in species order", () => {
    expect(GIANT_SETS).toEqual([
      { species: 0, variant: null, bark: GIANT_FIR_BARK },
      { species: 1, variant: 0, bark: GIANT_PINE_METASEQUOIA_BARK },
      { species: 1, variant: 1, bark: GIANT_PINE_CEDAR_BARK },
    ]);
  });

  it("take a fir of either variant, and a pine by its variant", () => {
    const [fir, pine0, pine1] = GIANT_SETS as [(typeof GIANT_SETS)[number], (typeof GIANT_SETS)[number], (typeof GIANT_SETS)[number]];
    expect([inGiantSet(fir, 0, 0), inGiantSet(fir, 0, 1), inGiantSet(fir, 1, 0)]).toEqual([true, true, false]);
    expect([inGiantSet(pine0, 1, 0), inGiantSet(pine0, 1, 1), inGiantSet(pine0, 0, 0)]).toEqual([true, false, false]);
    expect([inGiantSet(pine1, 1, 0), inGiantSet(pine1, 1, 1), inGiantSet(pine1, 0, 1)]).toEqual([false, true, false]);
  });

  it("the saplings wear one bark each: the conifers their giants' sets, the alder its own", () => {
    expect(SAPLING_BARKS).toEqual([CONIFER_A_BARK, CONIFER_B_BARK, ALDER_BARK]);
  });
});
