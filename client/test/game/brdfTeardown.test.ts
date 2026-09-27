import { describe, it, expect, vi } from "vitest";

// `terrainTexture.ts` builds `RawTexture2DArray`s NullEngine cannot create
// (`rendererSwap.test.ts` says why); the flat placeholders stand in.
vi.mock("../../src/game/groundMaps.js", () => ({
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));

// A NullEngine that reports what a WebGL2 browser does: half-float render
// targets with linear filtering. With them, Babylon expands every scene's BRDF
// lookup texture from RGBD through a post-process, asynchronously
// (`RGBDTextureTools.ExpandRGBDTexture`), exactly as it does in the browser; a
// bare NullEngine reports neither, and skips the expansion.
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  class FloatTargetEngine extends mod.NullEngine {
    constructor() {
      super();
      const caps = this.getCaps();
      caps.textureHalfFloatRender = true;
      caps.textureHalfFloatLinearFiltering = true;
    }
  }
  return { Engine: FloatTargetEngine };
});

import "../../src/sim/passes/index.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { RGBDTextureTools } from "@babylonjs/core/Misc/rgbdTextureTools.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { createRenderer } from "../../src/game/renderer.js";
import type { Level } from "../../src/sim/level.js";

// One brush, so the scene has a PBR material and with it a BRDF texture.
const LEVEL: Level = {
  id: "brdf-teardown",
  brushes: [{ box: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, material: "concrete" }],
  playerSpawns: [],
  enemySpawns: [],
} as unknown as Level;
const nullCanvas = (): HTMLCanvasElement =>
  ({ renderWidth: 1600, renderHeight: 900 }) as unknown as HTMLCanvasElement;

const expanding = (t: BaseTexture | null): boolean => t !== null && t.getInternalTexture()?.isReady === false;

async function unhandledDuring(run: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const onUnhandled = (reason: unknown): void => { seen.push(String(reason)); };
  process.on("unhandledRejection", onUnhandled);
  try {
    await run();
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  return seen;
}

describe("a renderer disposed while its scene's BRDF texture is still being expanded", () => {
  it("lets the expansion finish before its scene goes: no unhandled rejection, and the engine then released", async () => {
    const seen = await unhandledDuring(async () => {
      const r = createRenderer(nullCanvas(), LEVEL, null, { tier: "medium" });
      expect(expanding(r.scene.environmentBRDFTexture)).toBe(true);
      r.dispose();
      await new Promise((res) => setTimeout(res, 300));
    });
    expect(seen).toEqual([]);
    expect(EngineStore.Instances.length).toBe(0);
  });

  it("releases the engine at the bound when the expansion never finishes", async () => {
    // An expansion that starts and never ends.
    const expand = vi.spyOn(RGBDTextureTools, "ExpandRGBDTexture").mockImplementation((texture) => {
      const internal = texture.getInternalTexture();
      if (internal !== null) internal.isReady = false;
    });
    try {
      const r = createRenderer(nullCanvas(), LEVEL, null, { tier: "medium" });
      expect(expanding(r.scene.environmentBRDFTexture)).toBe(true);
      r.dispose();
      await new Promise((res) => setTimeout(res, 100));
      expect(EngineStore.Instances.length).toBe(1);
      expect(r.scene.isDisposed).toBe(false);
      await new Promise((res) => setTimeout(res, 2000));
      expect(EngineStore.Instances.length).toBe(0);
      expect(r.scene.isDisposed).toBe(true);
    } finally {
      expand.mockRestore();
    }
  }, 10_000);
});
