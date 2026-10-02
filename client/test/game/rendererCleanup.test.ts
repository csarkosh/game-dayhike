import { describe, it, expect, vi } from "vitest";

// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader would fetch the ground's layer images and decode them, which a suite
// under Node cannot (`groundMaps.test.ts` hands the loader its own decoder).
// Mocked here, at the module boundary, rather than by touching `renderer.ts`.
vi.mock("../../src/game/groundMaps.js", () => ({
  reportLayer: () => undefined,
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
// below can build a whole `Renderer` anyway.
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  return { Engine: mod.NullEngine };
});

// The lighting is made to throw part-way through the build, after the engine,
// the scene and the atmosphere's plugin registration already exist.
vi.mock("../../src/game/lighting.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/game/lighting.js")>("../../src/game/lighting.js");
  return { ...actual, createLighting: () => { throw new Error("no lighting"); } };
});

import "../../src/sim/passes/index.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { createRenderer } from "../../src/game/renderer.js";
import type { Level } from "../../src/sim/level.js";

const LEVEL: Level = { id: "renderer-cleanup", brushes: [], playerSpawns: [], enemySpawns: [] };
const FAKE_CANVAS = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;

describe("a renderer whose build throws part-way", () => {
  it("disposes its engine and takes back the atmosphere's registration before the throw goes up", () => {
    expect(() => createRenderer(FAKE_CANVAS, LEVEL, null, { tier: "medium" })).toThrow("no lighting");
    expect(EngineStore.Instances.length).toBe(0);
    // Nothing the failed build registered reaches a material made afterwards.
    const engine = new NullEngine();
    try {
      const material = new PBRMaterial("after", new Scene(engine));
      expect(material.pluginManager?.getPlugin("Atmosphere") ?? null).toBe(null);
    } finally {
      engine.dispose();
    }
  });
});

describe("a renderer on an engine it is given (WebGPU's), whose build throws part-way", () => {
  it("disposes the given engine too, and takes back the atmosphere's registration", () => {
    const given = new NullEngine();
    expect(() => createRenderer(FAKE_CANVAS, LEVEL, null, { tier: "medium", engine: given })).toThrow("no lighting");
    expect(given.isDisposed).toBe(true);
    expect(EngineStore.Instances.length).toBe(0);
    const engine = new NullEngine();
    try {
      const material = new PBRMaterial("after", new Scene(engine));
      expect(material.pluginManager?.getPlugin("Atmosphere") ?? null).toBe(null);
    } finally {
      engine.dispose();
    }
  });
});

