import { describe, expect, it } from "vitest";
import { BARK_SKY, CROWN_SKY, TREE_SPECULAR_WEIGHT, treeSkyLook } from "../../src/game/forestLookParams.js";

describe("a tree material's share of the sky", () => {
  it("is the trunk's for a bark, with the trees' specular weight whatever its file carries", () => {
    expect(treeSkyLook(false, null)).toEqual({ sky: BARK_SKY, specularWeight: TREE_SPECULAR_WEIGHT });
    expect(treeSkyLook(false, 0.9)).toEqual({ sky: BARK_SKY, specularWeight: TREE_SPECULAR_WEIGHT });
  });

  it("is the crown's for a crown, which keeps its file's weight and takes the trees' where the file gives none", () => {
    expect(treeSkyLook(true, 0.045)).toEqual({ sky: CROWN_SKY, specularWeight: 0.045 });
    expect(treeSkyLook(true, 0)).toEqual({ sky: CROWN_SKY, specularWeight: 0 });
    expect(treeSkyLook(true, null)).toEqual({ sky: CROWN_SKY, specularWeight: TREE_SPECULAR_WEIGHT });
  });

  it("hides more of the sky from a trunk than from a crown", () => {
    expect(BARK_SKY).toBeLessThan(CROWN_SKY);
  });
});
