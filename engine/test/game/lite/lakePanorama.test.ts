import { describe, expect, it } from "vitest";
import { sourceText } from "../../helpers/source.js";

const src = (name: string): string => sourceText(`game/${name}`);

describe("the ground in a lake's shore panorama on Babylon Lite", () => {
  it("draws a sector only on a frame that reads the picture, straight into the sector's column, which the pass clears alone: the engine's half", () => {
    const text = src("lite/lakePanorama.ts");
    expect(text).toContain("if (sky === null || !read) return false;");
    // The column is the camera's viewport, as the capture recorded on Babylon.js has it.
    expect(text).toContain("camera.viewport = { x: (held * PANORAMA_SECTOR_WIDTH) / PANORAMA_WIDTH, y: 0, width: PANORAMA_SECTOR_WIDTH / PANORAMA_WIDTH, height: 1 };");
    expect(text).toContain("clr: true, clrColor: { r: 0, g: 0, b: 0, a: 0 }, autoMirror: false, clearViewport: true, alphaWhereDrawn: true,");
    // Another lake's shore is emptied whole by the first sector of the new one's; every other sector clears its column alone.
    expect(text).toContain("config.clearViewport = !clearDue;");
    // No pass of the hike's own copies a sector, and none is made for it.
    expect(text).not.toContain("createCustomTask");
    expect(text).not.toContain("beginRenderPass");
    // The pass is the scene's only for the frame that draws a sector.
    expect(text).toContain("task.enabled = false;");
    expect(src("lite/renderer.ts")).toContain("standing.panorama?.frameDrawn();");
  });

  it("draws a lake's plants by its own word, whatever the frame's view holds of them: a sector's frame shows none for it", () => {
    // The pass's word on a mesh outranks the mesh's own, which the view sets.
    expect(src("lite/lakePanorama.ts")).toContain("      if (always === true) setTaskMeshVisible(task, mesh, true);");
    const renderer = src("lite/renderer.ts");
    expect(renderer).toContain("for (const mesh of waterPlants.meshes) (mirror ?? panorama)?.own.add(mesh, true);");
    // The frame's own pass shows each kind by the view alone.
    expect(renderer).toContain("standing.waterPlants?.seen(planes);");
    const plants = src("lite/waterPlantMeshes.ts");
    expect(plants).toContain("    seen(planes) {");
    expect(plants).toContain("        let now = false;");
  });
});
