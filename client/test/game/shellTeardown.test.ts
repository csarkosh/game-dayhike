import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A model that has already been parsed, against a scene that is still alive,
 * and is held back until `release`: the shape of a container that lands after
 * the shell that asked for it was disposed. Unlike a load against a disposed
 * scene, this one does not fail by itself, so only the shell's own guard stands
 * between it and the shell adopting it. Every call reads the shipped file from
 * disk by its name (Babylon cannot fetch a URL under Node).
 */
const held = vi.hoisted(() => {
  const state = {
    calls: [] as string[],
    parsed: [] as { meshes: import("@babylonjs/core/Meshes/abstractMesh.js").AbstractMesh[] }[],
    release: (): void => undefined,
    released: Promise.resolve(),
    reset(): void {
      state.calls.length = 0;
      state.parsed.length = 0;
      state.released = new Promise<void>((resolve) => {
        state.release = resolve;
      });
    },
  };
  return state;
});
vi.mock("@babylonjs/core/Loading/sceneLoader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@babylonjs/core/Loading/sceneLoader.js")>();
  return {
    ...actual,
    loadAssetContainerAsync: async (url: unknown, scene: import("@babylonjs/core/scene.js").Scene) => {
      const name = String(url).split("/").pop()!.split("?")[0]!;
      held.calls.push(name);
      const bytes = readFileSync(new URL(`../../assets/models/${name}`, import.meta.url));
      const container = await actual.loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
      held.parsed.push({ meshes: [...container.meshes] });
      await held.released;
      return container;
    },
  };
});

import "../../src/sim/passes/index.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import catalog from "../../assets/catalog.json" with { type: "json" };
import { createCreaturePool, resolveCreatureAssets } from "../../src/game/creatureModel.js";
import { createCliffMeshes } from "../../src/game/cliffMeshes.js";
import { createBodyMesh } from "../../src/game/bodyMesh.js";
import { createSignMeshes } from "../../src/game/signMeshes.js";
import { createTrailheadMeshes } from "../../src/game/trailheadMeshes.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import { timeLimit } from "../helpers/timeLimit.js";

// The seam loaders below call Babylon's loader directly, past the shells'
// own registration.
registerBuiltInLoaders();

let engine: NullEngine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
});
function freshScene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

/** The seam loaders the shells take, through the held loader above. */
const heldLoader = (scene: Scene) => (output: string): Promise<AssetContainer> => loadAssetContainerAsync(output, scene);

async function untilParsed(count: number): Promise<void> {
  while (held.parsed.length < count) await new Promise((r) => setTimeout(r, 10));
}

/** Whether `p` settles within a few turns of the event loop. */
async function settlesSoon(p: Promise<unknown>): Promise<boolean> {
  return Promise.race([p.then(() => true, () => true), new Promise<boolean>((r) => setTimeout(() => r(false), 200))]);
}

/** Every mesh the held containers brought is disposed, and none is in `scene`. */
function nothingAdopted(scene: Scene): { live: number; inScene: number } {
  const meshes = held.parsed.flatMap((p) => p.meshes);
  return {
    live: meshes.filter((m) => !m.isDisposed()).length,
    inScene: meshes.filter((m) => scene.meshes.includes(m)).length,
  };
}

describe("a container that lands after its shell was disposed", () => {
  it("is not kept by the creature pool, and the pool fetches nothing more", async () => {
    held.reset();
    const scene = freshScene();
    const first = resolveCreatureAssets(catalog)[0]!;
    const pool = createCreaturePool();
    const loading = pool.load(scene);
    await untilParsed(1);
    pool.dispose();
    held.release();
    await loading;
    await new Promise((r) => setTimeout(r, 50));
    expect(pool.has(first.id)).toBe(false);
    expect(held.calls.length).toBe(1);
    expect(nothingAdopted(scene)).toEqual({ live: 0, inScene: 0 });
  }, timeLimit(60_000));

  it("is not adopted by the cliff modules", async () => {
    held.reset();
    const scene = freshScene();
    const cliff = createCliffMeshes(scene, 12345, { quality: "high", loader: heldLoader(scene) });
    await untilParsed(1);
    cliff.dispose();
    held.release();
    await cliff.ready;
    await new Promise((r) => setTimeout(r, 50));
    expect(cliff.meshes.length).toBe(0);
    expect(held.calls.length).toBe(1);
    expect(nothingAdopted(scene)).toEqual({ live: 0, inScene: 0 });
  }, timeLimit(60_000));
});

describe("a placed model disposed with its model in flight", () => {
  const POSTS = [{ x: 0, z: 0, arms: [{ dx: 0, dz: 1, names: ["Trailhead"], ranks: [0] }] }];
  const SITES = {
    car: { site: { x: 10, z: 20 }, trailhead: { x: 1, z: 32 } },
    board: { x: 6, z: 39, fx: 0, fz: -1, ax: 1, az: 0 },
  };
  const groundH = (): number => 2;
  const places = {
    body: (scene: Scene) => createBodyMesh(scene, { pos: { x: 4, y: 1, z: -7 }, yaw: 0.6 }, { loader: heldLoader(scene) }),
    signs: (scene: Scene) =>
      createSignMeshes(scene, POSTS, groundH, {
        materialFor: (name) => new StandardMaterial(`box_${name}`, scene),
        paint: (s, name) => new PBRMaterial(name, s),
        loader: heldLoader(scene),
      }),
    trailhead: (scene: Scene) =>
      createTrailheadMeshes(scene, SITES, groundH, {
        materialFor: (name) => new StandardMaterial(`box_${name}`, scene),
        lines: ["MISSING"],
        paint: (s, name) => new PBRMaterial(name, s),
        loader: heldLoader(scene),
      }),
  };
  // The body loads one model; the signs (post and arm) and the trailhead
  // (car and kiosk) two each.
  const LOADS = { body: 1, signs: 2, trailhead: 2 } as const;

  for (const which of ["body", "signs", "trailhead"] as const) {
    it(`${which}: ends its loads at the dispose, starts none afterwards and places nothing that lands late`, async () => {
      held.reset();
      const scene = freshScene();
      const placed = places[which](scene);
      await untilParsed(LOADS[which]);
      placed.dispose();
      // Its loads are held: only the abort can have ended them.
      expect(await settlesSoon(placed.ready)).toBe(true);
      held.release();
      await new Promise((r) => setTimeout(r, 50));
      expect(held.calls.length).toBe(LOADS[which]);
      expect(nothingAdopted(scene)).toEqual({ live: 0, inScene: 0 });
    }, timeLimit(60_000));
  }
});
