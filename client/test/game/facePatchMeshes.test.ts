import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import "../../src/sim/passes/index.js";
import { createAtmosphere } from "../../src/game/atmosphere.js";
import { terrainMaterialFor } from "../../src/game/renderer.js";
import { FACE_PATCH_MATERIAL, createFacePatches } from "../../src/game/facePatchMeshes.js";
import { PATCH_REACH, facePatchCells, facePatchStitch, type PatchCell } from "../../src/game/facePatches.js";
import { TerrainTexturePlugin } from "../../src/game/terrainTexture.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** The scarp by the road, and the reference pose's camera over it. */
const SEED = 627994160;
const CAM = { x: -370, z: -900 };

let engine: NullEngine | null = null;

afterEach(() => {
  engine?.dispose();
  engine = null;
});

function scene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

function terrainPlugin(scene: Scene, name: string): TerrainTexturePlugin {
  return terrainMaterialFor(scene, name).pluginManager?.getPlugin("TerrainTexture") as TerrainTexturePlugin;
}

function patchMeshes(s: Scene): Mesh[] {
  return s.meshes.filter((m) => m.name.startsWith("facePatch_")) as Mesh[];
}

describe("the face patches' material", () => {
  it("is the ground's material, with its plugins, sharing its arrays, a depth offset ahead", () => {
    const s = scene();
    // The atmosphere registers its plugin before any material is made, as
    // the renderer does, and it reaches this material as the ground's.
    const atmosphere = createAtmosphere(s, 4000);
    const mat = terrainMaterialFor(s, FACE_PATCH_MATERIAL);
    const plugin = terrainPlugin(s, FACE_PATCH_MATERIAL);
    expect(plugin).toBeInstanceOf(TerrainTexturePlugin);
    expect(mat.pluginManager?.getPlugin("Wet")).toBeTruthy();
    expect(mat.pluginManager?.getPlugin("Atmosphere")).toBeTruthy();
    expect(terrainMaterialFor(s, "terrain").pluginManager?.getPlugin("Atmosphere")).toBeTruthy();
    expect(mat.albedoColor.r).toBe(1);
    expect(mat.albedoColor.g).toBe(1);
    expect(mat.albedoColor.b).toBe(1);
    expect(mat.metallic).toBe(0);
    expect(mat.roughness).toBe(terrainMaterialFor(s, "terrain").roughness);
    expect(mat.zOffset).toBe(-1);
    expect(mat.zOffsetUnits).toBe(-120);
    // The ground's own material is left where it was.
    expect(terrainMaterialFor(s, "terrain").zOffset).toBe(0);
    expect(terrainMaterialFor(s, "terrain").zOffsetUnits).toBe(0);
    // One set of normal and RAH arrays between the two.
    const ground = terrainPlugin(s, "terrain");
    expect(plugin.groundArrays.normals).toBe(ground.groundArrays.normals);
    expect(plugin.groundArrays.rah).toBe(ground.groundArrays.rah);
    atmosphere.dispose();
  });

  it("binds the ground's arrays as they are swapped for the real ones", () => {
    const s = scene();
    terrainMaterialFor(s, FACE_PATCH_MATERIAL);
    const plugin = terrainPlugin(s, FACE_PATCH_MATERIAL);
    const ground = terrainPlugin(s, "terrain");
    const placeholder = { normals: ground.groundArrays.normals, rah: ground.groundArrays.rah };
    // The ground's arrays swap their fields in place when the decodes land.
    const normals = RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, s);
    const rah = RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, s);
    ground.groundArrays.normals = normals;
    ground.groundArrays.rah = rah;
    expect(plugin.groundArrays.normals).toBe(normals);
    expect(plugin.groundArrays.rah).toBe(rah);
    expect(plugin.groundArrays.normals).not.toBe(placeholder.normals);
    // The view owns nothing: disposing it leaves the ground's arrays alone.
    plugin.groundArrays.dispose();
    expect(ground.groundArrays.normals).toBe(normals);
    expect(normals.getInternalTexture()).not.toBeNull();
  });

  it("is given the world's paint by the patches, as the ground's is by the clipmap", () => {
    const s = scene();
    const mat = terrainMaterialFor(s, FACE_PATCH_MATERIAL);
    expect(terrainPlugin(s, FACE_PATCH_MATERIAL).roadEnabled).toBe(false);
    const patches = createFacePatches(s, SEED, "high", mat);
    expect(terrainPlugin(s, FACE_PATCH_MATERIAL).roadEnabled).toBe(true);
    patches.dispose();
  });
});

describe("createFacePatches", () => {
  it("uploads the terrain plugin's attributes, with the clipmap's strides, on each patch", () => {
    const s = scene();
    const patches = createFacePatches(s, SEED, "high", terrainMaterialFor(s, FACE_PATCH_MATERIAL));
    patches.update(CAM.x, CAM.z);
    const mesh = patchMeshes(s)[0] as Mesh;
    const wanted: string[] = [];
    terrainPlugin(s, FACE_PATCH_MATERIAL).getAttributes(wanted, s, mesh);
    expect(wanted).toEqual(["terrainWeights", "terrainWeights2", "terrainCover"]);
    const kinds = mesh.getVerticesDataKinds();
    for (const kind of [VertexBuffer.PositionKind, VertexBuffer.NormalKind, VertexBuffer.ColorKind, ...wanted]) {
      expect(kinds).toContain(kind);
    }
    expect(mesh.getVertexBuffer("terrainWeights")?.getSize()).toBe(4);
    expect(mesh.getVertexBuffer("terrainWeights2")?.getSize()).toBe(4);
    expect(mesh.getVertexBuffer("terrainCover")?.getSize()).toBe(1);
    expect(mesh.getVertexBuffer(VertexBuffer.ColorKind)?.getSize()).toBe(4);
    expect(mesh.useVertexColors).toBe(true);
    expect(mesh.material).toBe(terrainMaterialFor(s, FACE_PATCH_MATERIAL));
    expect(mesh.receiveShadows).toBe(true);
    expect(mesh.isPickable).toBe(false);
    expect(mesh.isWorldMatrixFrozen).toBe(true);
    patches.dispose();
  }, timeLimit(60_000));

  it("builds the reach at the scarp, then only what a cell's crossing changes", () => {
    const s = scene();
    const casting = new Set<AbstractMesh>();
    // The reflections and the rain's map: each sees every patch built and
    // every one dropped, as the shadow map does.
    const reflected = new Set<AbstractMesh>();
    const rained = new Set<AbstractMesh>();
    const calls = { reflectionsAdded: 0, reflectionsRemoved: 0, rainAdded: 0, rainRemoved: 0 };
    const patches = createFacePatches(s, SEED, "high", terrainMaterialFor(s, FACE_PATCH_MATERIAL), {
      shadows: { add: (m) => casting.add(m), remove: (m) => casting.delete(m) },
      reflections: {
        add: (m) => { calls.reflectionsAdded++; reflected.add(m); },
        remove: (m) => { calls.reflectionsRemoved++; reflected.delete(m); },
      },
      rain: {
        add: (m) => { calls.rainAdded++; rained.add(m); },
        remove: (m) => { calls.rainRemoved++; rained.delete(m); },
      },
    });
    // The camera's cell (−24, −57), walked from its centre: 1,961 cells in
    // reach, 362 of them with steep ground.
    // 2026-10-12: 317 cells and 140 with steep ground before the wide band.
    patches.update(CAM.x, CAM.z);
    expect(patches.builds()).toBe(1961);
    expect(patches.meshCount()).toBe(362);
    expect(patchMeshes(s).length).toBe(362);
    expect(casting.size).toBe(362);
    expect(calls).toEqual({ reflectionsAdded: 362, reflectionsRemoved: 0, rainAdded: 362, rainRemoved: 0 });
    expect(reflected).toEqual(new Set(patchMeshes(s)));
    expect(rained).toEqual(new Set(patchMeshes(s)));

    // A metre on, in the same cell: nothing.
    const before = new Set(patchMeshes(s));
    patches.update(CAM.x + 1, CAM.z);
    expect(patches.builds()).toBe(1961);
    expect(new Set(patchMeshes(s))).toEqual(before);

    // A cell east: the cells that entered, and those that changed band, or
    // stitch or open neighbours with a patch to rebuild; an empty cell whose
    // stitch changed is still empty and is kept.
    const crossing = { entered: 0, rebuilt: 0, keptEmpty: 0 };
    const was = new Map<number, { spacing: number; stitch: string; empty: boolean }>();
    const named = new Set(patchMeshes(s).map((m) => m.name));
    const from = facePatchCells(-24 * 16 + 8, -57 * 16 + 8, PATCH_REACH.high);
    facePatchStitch(from).forEach((st, i) => {
      const c = from[i] as PatchCell;
      was.set(c.ci * 65536 + c.cj, { spacing: c.spacing, stitch: JSON.stringify(st), empty: !named.has(`facePatch_${c.ci}_${c.cj}`) });
    });
    const to = facePatchCells(-23 * 16 + 8, -57 * 16 + 8, PATCH_REACH.high);
    facePatchStitch(to).forEach((st, i) => {
      const c = to[i] as PatchCell;
      const w = was.get(c.ci * 65536 + c.cj);
      if (w === undefined) crossing.entered++;
      else if (w.spacing !== c.spacing) crossing.rebuilt++;
      else if (w.stitch !== JSON.stringify(st)) {
        if (w.empty) crossing.keptEmpty++;
        else crossing.rebuilt++;
      }
    });
    // 2026-10-12: 49 builds (366), 119 kept, before the open neighbours
    // joined the stitch and empty cells were kept across a stitch's change;
    // then 21 entered, 45 rebuilt and 51 kept empty before the wide band.
    expect(crossing).toEqual({ entered: 51, rebuilt: 91, keptEmpty: 201 });
    patches.update(CAM.x + 16, CAM.z);
    expect(patches.builds()).toBe(1961 + crossing.entered + crossing.rebuilt);
    // 2026-10-12: 383 builds, 147 meshes, 99 kept before the wide band.
    expect(patches.builds()).toBe(2103);
    expect(patches.meshCount()).toBe(368);
    expect(patchMeshes(s).length).toBe(368);
    expect(casting.size).toBe(368);
    const after = new Set(patchMeshes(s));
    let kept = 0;
    for (const m of before) if (after.has(m)) kept++;
    expect(kept).toBe(310);
    // 58 patches built at the crossing, 52 dropped.
    expect(calls).toEqual({ reflectionsAdded: 420, reflectionsRemoved: 52, rainAdded: 420, rainRemoved: 52 });
    expect(reflected).toEqual(after);
    expect(rained).toEqual(after);

    patches.dispose();
    expect(patches.meshCount()).toBe(0);
    expect(patchMeshes(s).length).toBe(0);
    expect(casting.size).toBe(0);
    expect(calls).toEqual({ reflectionsAdded: 420, reflectionsRemoved: 420, rainAdded: 420, rainRemoved: 420 });
    expect(reflected.size).toBe(0);
    expect(rained.size).toBe(0);
  }, timeLimit(120_000));
});
