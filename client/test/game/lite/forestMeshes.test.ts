import { describe, expect, it } from "vitest";
import { impostorQuad } from "../../../src/game/forestInstances.js";
import { cardGeometry, cardNormals } from "../../../src/game/lite/forestMeshes.js";

describe("a billboard's card on Babylon Lite", () => {
  it("is the tree's quad about its origin, facing -z, its coordinates laid as the bake's rows: the first at the top", () => {
    const quad = impostorQuad({ x: -3, y: 0, z: -2 }, { x: 3, y: 20, z: 2 });
    const card = cardGeometry(quad);
    expect([...card.positions]).toEqual([-3, -10, 0, 3, -10, 0, 3, 10, 0, -3, 10, 0]);
    expect([...card.normals]).toEqual([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]);
    // u runs with x; v is 1 at the foot and 0 at the top.
    expect([...card.uvs]).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
    expect([...card.indices]).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("turns over both axes of the bake's normal map for the frame its material reads it in, and keeps the rest", () => {
    const baked = new Uint8Array([128, 128, 255, 255, 200, 40, 180, 255, 0, 255, 128, 7]);
    const turned = cardNormals(baked);
    expect([...turned]).toEqual([127, 127, 255, 255, 55, 215, 180, 255, 255, 0, 128, 7]);
    // A new picture: the bake's own is left as it was read.
    expect(baked[0]).toBe(128);
    expect([...cardNormals(turned)]).toEqual([...baked]);
  });
});
