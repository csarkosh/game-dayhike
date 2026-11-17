import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { impostorQuad } from "../../../src/game/forestInstances.js";
import { cardGeometry, cardNormals } from "../../../src/game/lite/forestMeshes.js";

describe("a billboard's card on Babylon Lite", () => {
  it("is the tree's quad about its origin, facing -z, its coordinates laid as the bake's rows: the first at the foot", () => {
    const quad = impostorQuad({ x: -3, y: 0, z: -2 }, { x: 3, y: 20, z: 2 });
    const card = cardGeometry(quad);
    expect([...card.positions]).toEqual([-3, -10, 0, 3, -10, 0, 3, 10, 0, -3, 10, 0]);
    expect([...card.normals]).toEqual([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]);
    // u runs with x; v is 0 at the foot and 1 at the top.
    expect([...card.uvs]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    expect([...card.indices]).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("turns over the x of the bake's normal map for the frame its material reads it in, and keeps the rest", () => {
    const baked = new Uint8Array([128, 128, 255, 255, 200, 40, 180, 255, 0, 255, 128, 7]);
    const turned = cardNormals(baked);
    expect([...turned]).toEqual([127, 128, 255, 255, 55, 40, 180, 255, 255, 255, 128, 7]);
    // A new picture: the bake's own is left as it was read.
    expect(baked[0]).toBe(128);
    expect([...cardNormals(turned)]).toEqual([...baked]);
  });
});

/**
 * Lite builds every renderable of a scene again, with its pipelines and its
 * bind groups, when a mesh in a new material joins the scene, and records
 * the frame's passes again. A card that joined as its own bake landed did
 * that once a bake: seven times a forest.
 */
describe("the billboards' cards joining the scene on Babylon Lite", () => {
  const source = readFileSync(fileURLToPath(new URL("../../../src/game/lite/forestMeshes.ts", import.meta.url)), "utf8");
  const bake = source.slice(source.indexOf("async function bakeBillboard("), source.indexOf("  function dress("));

  it("are not made by a bake as it lands: the bake keeps its pictures for the step that makes every card", () => {
    expect(bake.length).toBeGreaterThan(500);
    expect(bake).not.toMatch(/\bdress\(/);
    expect(bake).not.toContain("fillBillboard(");
    expect(bake).toContain("landedCards.push({ board, slot, albedo: fields.albedo, normal: fields.normal });");
  });

  it("are made together once the last bake has settled, whether it landed or failed, and the models are adopted", () => {
    // Counted where a bake is asked for and where it ends, on every path out of it.
    expect(source).toContain("    baking++;\n    bakes.push(bakeBillboard(made, slot, box, pose, meshes));");
    expect(bake).toMatch(/finally \{[^}]*baking--;\s*if \(baking === 0 && adopted\) dressLanded\(\);/);
    // Bakes that all settled before the models were adopted are made as the adoption ends.
    expect(source).toContain("    adopted = true;\n    // Every bake is asked for by now: cards whose bakes all settled first are made here.\n    if (baking === 0) dressLanded();");
    // One place makes a card, and a forest that has gone or lost its device makes none.
    expect(source.match(/\bdress\(card\.board, card\.slot/g)).toHaveLength(1);
    expect(source.match(/\bdress\(board, /g)).toBeNull();
    expect(source).toContain("    const cards = landedCards.splice(0);\n    if (disposed || abandoned) return;");
  });

  it("say `ready` only once they are made, and keep the time their own bake took", () => {
    expect(bake).toContain("board.bake.ms = performance.now() - board.startedAt;");
    expect(bake).not.toContain('board.bake.state = "ready"');
    expect(source).toContain('      card.board.bake.state = "ready";');
  });
});
