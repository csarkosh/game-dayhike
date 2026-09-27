import { describe, it, expect, vi } from "vitest";

// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader builds a `RawTexture2DArray`, which NullEngine cannot create (the
// same gap `groundMaps.test.ts` documents and works around with its own
// factory injection). Mocked here, at the module boundary, rather than by
// touching `renderer.ts`.
vi.mock("../../src/game/groundMaps.js", () => ({
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    // `getSize` mirrors the real `BaseTexture` surface `bindForSubMesh` reads
    // (`terrainReliefOn`'s placeholder-vs-real signature) — present here so a
    // future test that exercises binding fails on the plugin code, not on a
    // mock that is missing a method the real texture always has.
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));

// `createRenderer` builds a real WebGL `Engine`, which needs a canvas and a
// context this suite does not have. Substituted with `NullEngine` at the
// module boundary — same trick as the `groundMaps` mock above — so the test
// below can build a whole `Renderer` on each tier anyway.
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  return { Engine: mod.NullEngine };
});

// The terrain field lives behind the variant registry; a test that builds a
// forest without `app.ts` has to register the passes itself.
import "../../src/sim/passes/index.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { buildProbeScene } from "../../src/game/probeScene.js";
import { PROBE_SCREEN_LINE } from "../../src/game/probeScreen.js";

const FAKE_CANVAS = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;

describe("buildProbeScene", () => {
  it("puts the camera on the canopy pose at the tier asked, and leaves no engine behind", () => {
    const probe = buildProbeScene(FAKE_CANVAS, "medium");
    probe.frame();
    const cam = probe.renderer.camera;
    expect(cam.position.x).toBeCloseTo(123, 6);
    expect(cam.position.z).toBeCloseTo(-105.5, 6);
    expect(cam.position.y).toBeCloseTo(110.87, 2);
    expect(cam.rotation.y).toBeCloseTo(1.571, 6);
    expect(cam.rotation.x).toBeCloseTo(0.3, 6);
    expect(probe.renderer.scene.meshes.some((mesh) => mesh.name.startsWith("blade_clumps"))).toBe(true);
    probe.dispose();
    expect(EngineStore.Instances.length).toBe(0);
  }, 60_000);
});

describe("the probe screen", () => {
  it("says what the wait is for", () => {
    expect(PROBE_SCREEN_LINE).toBe("Setting up graphics…");
  });
});
