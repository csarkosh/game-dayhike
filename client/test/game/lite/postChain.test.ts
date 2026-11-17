import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chainTargetsStand } from "../../../src/game/lite/postChain.js";

const src = readFileSync(new URL("../../../src/game/lite/postChain.ts", import.meta.url), "utf8");

describe("the post chain's targets on Babylon Lite", () => {
  /** A scene's depth and resolve as Lite hands them: an object each, made again only with the target. */
  const made = (): { depth: object; resolve: object } => ({ depth: {}, resolve: {} });

  it("stand through a recording that left the scene's own targets as they were: a hiker's lamp joining makes none again", () => {
    const scene = made();
    const built = { depth: scene.depth, resolve: scene.resolve };
    for (let recording = 0; recording < 12; recording++) expect(chainTargetsStand(built, scene.depth, scene.resolve)).toBe(true);
  });

  it("are made again when the scene's are: its depth or its resolve is another object after a resize", () => {
    const scene = made();
    const built = { depth: scene.depth, resolve: scene.resolve };
    const resized = made();
    expect(chainTargetsStand(built, resized.depth, resized.resolve)).toBe(false);
    expect(chainTargetsStand(built, scene.depth, resized.resolve)).toBe(false);
    expect(chainTargetsStand(built, resized.depth, scene.resolve)).toBe(false);
  });

  it("are made for the first recording, and not while the scene has no target of its own yet", () => {
    const scene = made();
    expect(chainTargetsStand(null, scene.depth, scene.resolve)).toBe(false);
    const built = { depth: scene.depth, resolve: scene.resolve };
    expect(chainTargetsStand(built, null, scene.resolve)).toBe(false);
    expect(chainTargetsStand(built, scene.depth, null)).toBe(false);
  });

  it("keeps the scene's own two targets while the frame's size stands, and asks before it lets its own go", () => {
    expect(src).toContain('createRenderTarget({ lbl: "post_scene", format: POST_FORMAT, dFormat: POST_DEPTH_FORMAT, samples: MSAA_SAMPLES, size: frameSize, keep: true });');
    expect(src).toContain('createRenderTarget({ lbl: "post_scene_resolved", format: POST_FORMAT, samples: 1, size: frameSize, keep: true });');
    // The question comes first: a recording that is no resize destroys nothing, and the anti-aliasing's history is not started again.
    expect(src).toContain("    if (chainTargetsStand(madeFor, own.depthTexture, scene)) return;\n    release();");
    expect(src.split("taaFrame.reset()").length).toBe(2);
  });

  it("keeps the frame's own target on the tier with no chain too: the hike makes that pass as Lite's own would be, into a target that stands", () => {
    const renderer = readFileSync(new URL("../../../src/game/lite/renderer.ts", import.meta.url), "utf8");
    // No pass of Lite's own on any tier: its target is made again at every recording of the frame's passes.
    expect(renderer).toContain("    const scene = createSceneContext(engine, { defaultRenderTask: false });");
    // Lite's own pass, by its own numbers: the canvas's format, a depth and stencil buffer, the engine's samples a
    // pixel, the surface's size, resolved into the canvas.
    expect(renderer).toContain('createRenderTarget({ lbl: "scene-color", format: engine.format, dFormat: "depth24plus-stencil8", samples: FRAME_SAMPLES, size: engine, keep: true });');
    expect(renderer).toContain('addTask(scene, createRenderTask({ name: "scene", rt: samples, rst: engine.scRT, clr: true }, engine, scene));');
    expect(renderer).toContain("createEngine(canvas, { msaaSamples: chained ? 1 : FRAME_SAMPLES,");
  });
});
