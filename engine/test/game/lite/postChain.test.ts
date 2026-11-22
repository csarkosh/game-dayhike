import { describe, expect, it } from "vitest";
import { sourceText } from "../../helpers/source.js";

const src = sourceText("game/lite/postChain.ts");

describe("the post chain's targets on Babylon Lite", () => {
  it("keeps the scene's own two targets while the frame's size stands, and asks before it lets its own go", () => {
    expect(src).toContain('createRenderTarget({ lbl: "post_scene", format: POST_FORMAT, dFormat: POST_DEPTH_FORMAT, samples: MSAA_SAMPLES, size: frameSize, keep: true });');
    expect(src).toContain('createRenderTarget({ lbl: "post_scene_resolved", format: POST_FORMAT, samples: 1, size: frameSize, keep: true });');
    // The question comes first: a recording that is no resize destroys nothing, and the anti-aliasing's history is not started again.
    expect(src).toContain("    if (chainTargetsStand(madeFor, own.depthTexture, scene)) return;\n    release();");
    expect(src.split("taaFrame.reset()").length).toBe(2);
  });

  it("keeps the frame's own target on the tier with no chain too: the hike makes that pass as Lite's own would be, into a target that stands", () => {
    const renderer = sourceText("game/lite/renderer.ts");
    // No pass of Lite's own on any tier: its target is made again at every recording of the frame's passes.
    expect(renderer).toContain("    const scene = createSceneContext(engine, { defaultRenderTask: false });");
    // Lite's own pass, by its own numbers: the canvas's format, a depth and stencil buffer, the engine's samples a
    // pixel, the surface's size, resolved into the canvas.
    expect(renderer).toContain('createRenderTarget({ lbl: "scene-color", format: engine.format, dFormat: "depth24plus-stencil8", samples: FRAME_SAMPLES, size: engine, keep: true });');
    expect(renderer).toContain('addTask(scene, createRenderTask({ name: "scene", rt: samples, rst: engine.scRT, clr: true }, engine, scene));');
    expect(renderer).toContain("createEngine(canvas, { msaaSamples: chained ? 1 : FRAME_SAMPLES,");
  });
});
