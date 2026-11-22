import { describe, expect, it } from "vitest";
import { sourceText } from "../../helpers/source.js";

describe("the cover map's texel on Babylon Lite", () => {
  it("has its own word on the water: a lake or the sea is drawn in the map while its square reaches it, and shown to the frame by the view alone", () => {
    const read = (name: string): string => sourceText(`game/lite/${name}`);
    expect(read("rainMap.ts")).toContain("      if (!disposed && registered.has(mesh)) setTaskMeshVisible(task, mesh, shown);");
    // Each says the map's word on a frame that draws the map, and shows its mesh to the frame's own pass by the view.
    const lakes = read("lakeMeshes.ts");
    expect(lakes).toContain("        if (f.cover !== null) {\n          options.cover?.show?.(lake.mesh, Math.abs(source.shape.cx - f.cover.x) < lake.half + f.cover.half && Math.abs(source.shape.cz - f.cover.z) < lake.half + f.cover.half);");
    expect(lakes).toContain("        const shown = seen;");
    const sea = read("seaMeshes.ts");
    expect(sea).toContain("      if (f.cover !== null) options.cover?.show?.(mesh, covered);");
    // The frame's own pass shows the sea by the view alone (`held`), which is also what steps its wind waves.
    expect(sea).toContain("      if (held !== shown) {\n        shown = held;");
    expect(sea).not.toContain("covered || held");
    // The renderer hands both the map's word.
    expect(read("renderer.ts").split("show: (mesh, shown) => rainMap.show(mesh, shown)").length).toBe(3);
  });
});
