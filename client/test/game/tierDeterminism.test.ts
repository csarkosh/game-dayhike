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
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, serializeWorldState, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import type { Level } from "../../src/sim/level.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { createRenderer } from "../../src/game/renderer.js";
import type { QualityTier } from "../../src/game/quality.js";
import { timeLimit } from "../helpers/timeLimit.js";

const LEVEL: Level = { id: "tier-determinism", brushes: [], playerSpawns: [], enemySpawns: [] };
const FAKE_CANVAS = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;
const ATMO = 627994160;

/**
 * One forest world, one player walking for 120 ticks, drawn after every tick
 * by a renderer on `tier`, or by none. `blades` says whether that renderer
 * built the blade field, which only medium and high draw: it shows each run
 * really drew on its own tier, so the state comparison cannot pass by every
 * renderer quietly building the same one.
 */
function run(tier: QualityTier | null): { state: string; passHash: number; blades: boolean | null } {
  const forest = createForest(ATMO);
  const world = createForestWorld(forest);
  const player = spawnPlayer(world);
  const renderer = tier === null ? null : createRenderer(FAKE_CANVAS, LEVEL, forest, { tier });
  try {
    for (let t = 0; t < 120; t++) {
      tickWorld(world, new Map([[player.id, { seq: t + 1, moveX: 0, moveZ: 1, yaw: 0.3, pitch: 0, buttons: 0 }]]));
      renderer?.sync(world.state, player.id, 0.5, { dt: 1 / 60, sprinting: false });
    }
    const scene = renderer === null ? null : EngineStore.LastCreatedScene;
    const blades = scene === null ? null : scene.meshes.some((mesh) => mesh.name.startsWith("blade_clumps"));
    return { state: serializeWorldState(world.state), passHash: forest.passHash, blades };
  } finally {
    renderer?.dispose();
  }
}

describe("the tier is drawing only", () => {
  it("steps one world, to the byte, whatever tier draws it or none", () => {
    const bare = run(null);
    // The pass hash `groundGradient.test.ts` pins: the world with the car at
    // the pad and the board at the trail's entrance.
    expect(bare.passHash).toBe(-2079813416);
    expect(bare.blades).toBe(null);
    const drawn = { low: run("low"), medium: run("medium"), high: run("high") };
    for (const got of [drawn.low, drawn.medium, drawn.high]) {
      expect(got.state).toBe(bare.state);
      expect(got.passHash).toBe(-2079813416);
    }
    expect([drawn.low.blades, drawn.medium.blades, drawn.high.blades]).toEqual([false, true, true]);
  }, timeLimit(120_000));
});
