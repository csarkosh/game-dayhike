import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/game/groundMaps.js", () => ({
  reportLayer: () => undefined,
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>("@babylonjs/core/Engines/nullEngine.js");
  return { Engine: mod.NullEngine };
});

import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createWorld } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { createRenderer } from "../../src/game/renderer.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };
import { timeLimit } from "../helpers/timeLimit.js";

const nullCanvas = (): HTMLCanvasElement => ({ renderWidth: 1600, renderHeight: 900 }) as unknown as HTMLCanvasElement;

describe("the renderer's film camera", () => {
  it("takes a field of view and a roll from the free camera's view, and keeps the game's lens without them", () => {
    const level = parseLevel(sandbox01);
    const forest = createForest(4242);
    const world = createWorld(level, 4242, false);
    const clock = vi.fn(() => 5000);
    const r = createRenderer(nullCanvas(), level, forest, { tier: "low", clock });
    r.setFreecam({ x: 0, y: 30, z: 0, yaw: 0.2, pitch: 0.1, fov: 0.43, roll: 0.05 });
    r.sync(world.state, -1, 0);
    expect(r.camera.fov).toBe(0.43);
    expect(r.camera.rotation.z).toBe(0.05);
    r.setFreecam({ x: 0, y: 30, z: 0, yaw: 0.2, pitch: 0.1 });
    r.sync(world.state, -1, 0);
    expect(r.camera.fov).toBe(1.4);
    expect(r.camera.rotation.z).toBe(0);
    expect(clock).toHaveBeenCalled();
    r.dispose();
  }, timeLimit(60_000));
});
