import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import "../../src/sim/passes/index.js";
import type { ClutterInstance } from "../../src/sim/clutter.js";
import {
  CLIFF_CELL, CLIFF_MODEL_BASE, CLIFF_MODEL_DEPTH, CLIFF_MODEL_FRONT, CLIFF_MODEL_HEIGHT,
  CLIFF_MODEL_RIGHT, CLIFF_MODEL_WIDTH, CLIFF_MODELS, CLIFF_SINK, CLIFF_TILT_MAX, cliffFacing,
} from "../../src/sim/cliffField.js";
import { CLIFF_FADE_BAND, CLIFF_RINGS, cliffBands, cliffOrigin, collectCliffs } from "../../src/game/cliffField.js";
import { CLIFF_LOD_NODES, cliffMeshName, createCliffMeshes } from "../../src/game/cliffMeshes.js";
import { trampleFrame, writeFoliage } from "../../src/game/clutterMeshes.js";
import { seatOnGroundCapped } from "../../src/game/groundTilt.js";
import { CliffTintPlugin } from "../../src/game/cliffTintPlugin.js";
import { DistanceFadePlugin } from "../../src/game/distanceFadePlugin.js";

/** Counts the shell's tint writes, so the per-instance memo is observable:
 * the wrapper stands between `cliffMeshes.ts` and the real writer. */
const spied = vi.hoisted(() => ({ foliage: 0 }));
vi.mock("../../src/game/clutterMeshes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/game/clutterMeshes.js")>();
  return {
    ...actual,
    writeFoliage: (...args: Parameters<typeof actual.writeFoliage>) => {
      spied.foliage++;
      return actual.writeFoliage(...args);
    },
  };
});

/** The scarp fixture, not one of the census worlds' worst discs: those have
 * no steep rock within 60 m of their own centres, so their LOD0 band is
 * empty (cliffField.test.ts measures both). Here all three bands are
 * populated, which is what a bucket fill has to be judged on. */
const SEED = 627994160;
const CAM = { x: -340, z: -897 };

/** The real GLBs, read from disk the way catalogModels.test.ts does. */
function loader(scene: Scene) {
  registerBuiltInLoaders();
  return (output: string) => {
    const bytes = readFileSync(new URL(`../../assets/${output}`, import.meta.url));
    return loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
  };
}

/** The same instance with the sink taken back out of `groundH`: the height
 * of the ground the module stands on, which is what its tint is read at. */
function unsunk(m: ClutterInstance): ClutterInstance {
  return { ...m, groundH: m.groundH + CLIFF_SINK * m.scale * (CLIFF_MODEL_HEIGHT[m.variant] as number) };
}

function bufferFor(spy: { mock: { calls: unknown[][]; instances: unknown[] } }, mesh: Mesh, kind: string): Float32Array | null {
  for (let k = spy.mock.calls.length - 1; k >= 0; k--) {
    const call = spy.mock.calls[k]!;
    if (spy.mock.instances[k] === mesh && call[0] === kind) return call[1] as Float32Array;
  }
  return null;
}

// The thin-instance spy below is on `Mesh.prototype`, so a case that fails
// before its own `mockRestore` would hand the next case a spy already holding
// its calls — and the next case's first assertion is that nothing has been
// called yet. Restored here so one real failure stays one failure.
afterEach(() => { vi.restoreAllMocks(); });

describe("createCliffMeshes", () => {
  it("builds three buckets per model from the GLBs' LOD roots, tinted, shadowed, the far one dithering", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const cliffs = createCliffMeshes(scene, SEED, { quality: "high", loader: loader(scene) });
    expect(cliffs.meshes.length).toBe(0);
    await cliffs.ready;
    expect(cliffs.meshes.length).toBe(CLIFF_MODELS.length * 3);
    for (const [model] of CLIFF_MODELS.entries()) {
      const mats = new Set<PBRMaterial>();
      for (let lod = 0; lod < 3; lod++) {
        const mesh = scene.getMeshByName(cliffMeshName(model, lod)) as Mesh;
        expect(mesh).toBeInstanceOf(Mesh);
        expect(mesh.getTotalVertices()).toBeGreaterThan(0);
        expect(mesh.isPickable).toBe(false);
        expect(mesh.alwaysSelectAsActiveMesh).toBe(true);
        expect(mesh.receiveShadows).toBe(true);
        // The LOD root's transform is baked away: the thin-instance matrix
        // is the only transform a module wears.
        expect(mesh.parent).toBeNull();
        const mat = mesh.material as PBRMaterial;
        mats.add(mat);
        expect(mat.pluginManager!.getPlugin("CliffTint")).toBeInstanceOf(CliffTintPlugin);
        if (lod === 2) expect(mat.pluginManager!.getPlugin("DistanceFade")).toBeInstanceOf(DistanceFadePlugin);
        else expect(mat.pluginManager!.getPlugin("DistanceFade") ?? null).toBeNull();
      }
      // LOD0 and LOD1 share the GLB's material; the far bucket has its own.
      expect(mats.size).toBe(2);
    }
    // LOD0 and LOD1 cast; the far bucket does not.
    expect(cliffs.casterMeshes.length).toBe(CLIFF_MODELS.length * 2);
    for (const m of cliffs.casterMeshes) expect(/_l[01]$/.test(m.name)).toBe(true);
    cliffs.dispose();
    for (const [model] of CLIFF_MODELS.entries()) {
      for (let lod = 0; lod < 3; lod++) expect(scene.getMeshByName(cliffMeshName(model, lod))).toBeNull();
    }
    engine.dispose();
  });

  it("pins the model tables against the loaded LOD0 meshes", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const cliffs = createCliffMeshes(scene, SEED, { quality: "high", loader: loader(scene) });
    await cliffs.ready;
    for (const [model] of CLIFF_MODELS.entries()) {
      const mesh = scene.getMeshByName(cliffMeshName(model, 0)) as Mesh;
      const b = mesh.getBoundingInfo().boundingBox;
      expect(b.maximum.x - b.minimum.x).toBeCloseTo(CLIFF_MODEL_WIDTH[model] as number, 1);
      expect(b.maximum.y - b.minimum.y).toBeCloseTo(CLIFF_MODEL_HEIGHT[model] as number, 1);
      expect(b.maximum.z - b.minimum.z).toBeCloseTo(CLIFF_MODEL_DEPTH[model] as number, 1);
      // Where the origin sits inside those extents, not just how big they are:
      // the probes are measured from the origin, so a re-export that re-centred
      // or mirrored a model would move the solid out from under them.
      expect(b.maximum.z).toBeCloseTo(CLIFF_MODEL_FRONT[model] as number, 1);
      expect(b.maximum.x).toBeCloseTo(CLIFF_MODEL_RIGHT[model] as number, 1);
      // And where the base sits: a little below the origin, which the
      // colliders bound from.
      expect(b.minimum.y).toBeCloseTo(CLIFF_MODEL_BASE[model] as number, 1);
    }
    cliffs.dispose();
    engine.dispose();
  });

  it("fills each bucket with its band, matrices seated nearly plumb, with tint and fade bands", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    const cliffs = createCliffMeshes(scene, SEED, { quality: "high", loader: loader(scene) });
    await cliffs.ready;
    cliffs.update(CAM.x, CAM.z);
    const rings = CLIFF_RINGS.high;
    const o = cliffOrigin(CAM.x, CAM.z);
    const bands = cliffBands(collectCliffs(SEED, CAM.x, CAM.z, rings[2]), o.x, o.z, rings);
    // Measured at this scarp, and the same split cliffField.test.ts pins for
    // this origin.
    expect(bands.map((b) => b.length)).toEqual([59, 70, 173]);
    // Measured here too, by [model][lod]. Runs alternate the two models, so
    // both stand in every ring the face reaches.
    const COUNTS: readonly (readonly [number, number, number])[] = [[27, 32, 79], [32, 38, 94]];
    // Teeth: each of the three rings is exercised by at least one model.
    for (let lod = 0; lod < 3; lod++) expect(COUNTS.some((row) => (row[lod] as number) > 0)).toBe(true);
    const mat = new Float32Array(16);
    const fol = new Float32Array(4);
    const rot = new Quaternion();
    const scale = new Vector3();
    const pos = new Vector3();
    const world = new Matrix();
    for (const [model] of CLIFF_MODELS.entries()) {
      for (let lod = 0; lod < 3; lod++) {
        const mesh = scene.getMeshByName(cliffMeshName(model, lod)) as Mesh;
        const want = bands[lod]!.filter((m) => m.variant === model);
        expect(want.length).toBe(COUNTS[model]![lod] as number);
        expect(mesh.thinInstanceCount).toBe(want.length);
        expect(mesh.isEnabled()).toBe(want.length > 0);
        const matrices = bufferFor(spy, mesh, "matrix")!;
        const tints = bufferFor(spy, mesh, "foliage")!;
        expect(matrices.length).toBe(want.length * 16);
        expect(tints.length).toBe(want.length * 4);
        for (const [i, m] of want.entries()) {
          // Uniform scale, the capped lean, and the origin's own height — the
          // sink already rides in `groundH`, so no `CLUTTER_SINK` here.
          // The yaw is the field's facing turned back into an angle: forward
          // is (sin yaw, cos yaw).
          const f = cliffFacing(m.groundDx, m.groundDz, m.hash);
          seatOnGroundCapped(Math.atan2(f.fx, f.fz), m.groundDx, m.groundDz, CLIFF_TILT_MAX, rot);
          scale.copyFromFloats(m.scale, m.scale, m.scale);
          pos.copyFromFloats(m.x, m.groundH, m.z);
          Matrix.ComposeToRef(scale, rot, pos, world);
          world.copyToArray(mat);
          expect(Array.from(matrices.subarray(i * 16, i * 16 + 16))).toEqual(Array.from(mat));
          // The tint reads the ground's OWN height, not the sunk one.
          const onGround = unsunk(m);
          writeFoliage(SEED, onGround, fol, 0, trampleFrame(SEED, onGround));
          expect(Array.from(tints.subarray(i * 4, i * 4 + 4))).toEqual(Array.from(fol));
        }
        const fade = bufferFor(spy, mesh, "fadeBands");
        if (lod === 2) {
          expect(fade!.length).toBe(want.length * 4);
          expect(Array.from(fade!.subarray(0, 4))).toEqual([-2, -1, rings[2] - CLIFF_FADE_BAND, rings[2]]);
        } else {
          expect(fade).toBeNull();
        }
      }
    }
    spy.mockRestore();
    cliffs.dispose();
    engine.dispose();
  });

  it("rebuilds only when the snapped origin moves, and remembers the eye until the models land", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    const cliffs = createCliffMeshes(scene, SEED, { quality: "medium", loader: loader(scene) });
    cliffs.update(CAM.x, CAM.z);
    expect(spy).not.toHaveBeenCalled();
    await cliffs.ready;
    const afterLoad = spy.mock.calls.length;
    expect(afterLoad).toBeGreaterThan(0);
    cliffs.update(CAM.x + CLIFF_CELL / 4, CAM.z);
    expect(spy.mock.calls.length).toBe(afterLoad);
    cliffs.update(CAM.x + CLIFF_CELL, CAM.z);
    expect(spy.mock.calls.length).toBeGreaterThan(afterLoad);
    spy.mockRestore();
    cliffs.dispose();
    engine.dispose();
  });

  it("tints an instance once and re-uses it when the next rebuild meets it again", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const cliffs = createCliffMeshes(scene, SEED, { quality: "high", loader: loader(scene) });
    await cliffs.ready;
    const rings = CLIFF_RINGS.high;
    const inReach = (x: number, z: number): Set<string> => {
      const o = cliffOrigin(x, z);
      const bands = cliffBands(collectCliffs(SEED, x, z, rings[2]), o.x, o.z, rings);
      return new Set(bands.flat().map((m) => `${m.x},${m.z}`));
    };
    spied.foliage = 0;
    cliffs.update(CAM.x, CAM.z);
    const first = inReach(CAM.x, CAM.z);
    // Measured at this scarp: the modules across the three rings.
    expect(first.size).toBe(302);
    expect(spied.foliage).toBe(302);
    // Four cells north: the collector hands back the very same instance
    // objects for every cell it already holds, so only what the move brought
    // into the rings is tinted — measured here.
    spied.foliage = 0;
    cliffs.update(CAM.x, CAM.z - 4 * CLIFF_CELL);
    const second = inReach(CAM.x, CAM.z - 4 * CLIFF_CELL);
    const fresh = [...second].filter((k) => !first.has(k));
    expect(second.size).toBe(316);
    expect(fresh.length).toBe(17);
    expect(spied.foliage).toBe(17);
    cliffs.dispose();
    engine.dispose();
  }, 300_000);

  it("refuses a LOD root that holds more than one geometry mesh", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const twoMeshLod = (): Promise<AssetContainer> => {
      const container = new AssetContainer(scene);
      for (const name of CLIFF_LOD_NODES) {
        const root = new TransformNode(name, scene);
        container.transformNodes.push(root);
        // LOD0 holds two geometry meshes: the shape a GLB must never ship,
        // because only the first would ever be drawn.
        for (let i = 0; i < (name === "LOD0" ? 2 : 1); i++) {
          const part = CreateBox(`${name}_part${i}`, { size: 1 }, scene);
          part.parent = root;
          container.meshes.push(part);
        }
      }
      // Built in the scene, as any node must be; handed over the way a loaded
      // container arrives, with the shell's `addAllToScene` putting them back.
      container.removeAllFromScene();
      return Promise.resolve(container);
    };
    const cliffs = createCliffMeshes(scene, SEED, { quality: "high", loader: twoMeshLod });
    await expect(cliffs.ready).rejects.toThrow(/LOD0/);
    cliffs.dispose();
    engine.dispose();
  });

  it("names the LOD roots the models ship", () => {
    expect(CLIFF_LOD_NODES).toEqual(["LOD0", "LOD1", "LOD2"]);
  });
});
