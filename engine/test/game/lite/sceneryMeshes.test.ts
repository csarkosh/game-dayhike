import { describe, expect, it } from "vitest";
import { sourceText } from "../../helpers/source.js";

describe("the parts of a car a pose turns, on Babylon Lite", () => {
  it("numbers a turned mesh's vertices once, when the mesh is made, and stands the mesh in the rain's cover map under the same turns: the engine's half", () => {
    const renderer = sourceText("game/lite/renderer.ts");
    expect(renderer).toContain('{ add: (mesh, place) => rainMap.register(mesh, "hard", place), remove: (mesh) => rainMap.unregister(mesh) }');
  });
});
