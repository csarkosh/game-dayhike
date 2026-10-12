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
import {
  NO_STITCH, PATCH_REACH, facePatchCells, facePatchCover, facePatchGeometry, facePatchStitch, type PatchCell,
} from "../../src/game/facePatches.js";
import { createSyncJobs, type SyncJobs } from "../../src/game/syncJobs.js";
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

/** The patches drawn: a patch built and not yet shown is hidden. */
function patchMeshes(s: Scene): Mesh[] {
  return s.meshes.filter((m) => m.name.startsWith("facePatch_") && m.isEnabled(false)) as Mesh[];
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
    const patches = createFacePatches(s, SEED, "high", terrainMaterialFor(s, FACE_PATCH_MATERIAL), undefined, {
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

/** A frame at 60 frames a second (ms). */
const FRAME_MS = 1000 / 60;
/** On foot, m/s (`WALK_SPEED`). */
const WALKING = 5.25;

/**
 * Jobs on a stepped clock: each frame's share starts a frame after the last,
 * and every reading within it advances it a tenth of a millisecond, so every
 * slice is charged that and a slice said to take more waits as it would.
 */
function steppedJobs(): { jobs: SyncJobs; frame(): void } {
  let now = 0;
  let frames = 0;
  const jobs = createSyncJobs(() => (now += 0.1));
  return {
    jobs,
    /** One frame: its share run, and the clock on to the next. */
    frame() {
      jobs.run();
      frames++;
      now = Math.max(now, frames * FRAME_MS);
    },
  };
}

describe("createFacePatches, as jobs", () => {
  /** The patches with jobs, and every registry's meshes as a set. */
  function made(s: Scene, jobs: SyncJobs): { patches: ReturnType<typeof createFacePatches>; casting: Set<AbstractMesh>; reflected: Set<AbstractMesh>; rained: Set<AbstractMesh> } {
    const casting = new Set<AbstractMesh>();
    const reflected = new Set<AbstractMesh>();
    const rained = new Set<AbstractMesh>();
    const patches = createFacePatches(s, SEED, "high", terrainMaterialFor(s, FACE_PATCH_MATERIAL), jobs, {
      shadows: { add: (m) => casting.add(m), remove: (m) => casting.delete(m) },
      reflections: { add: (m) => reflected.add(m), remove: (m) => reflected.delete(m) },
      rain: { add: (m) => rained.add(m), remove: (m) => rained.delete(m) },
    });
    return { patches, casting, reflected, rained };
  }

  it("builds the near band at the first update and the rest over the frames after it, never late", () => {
    const s = scene();
    const t = steppedJobs();
    const { patches, casting } = made(s, t.jobs);
    expect(patches.cover()).toBeNull();
    patches.update(CAM.x, CAM.z);
    // The 29 cells within 48 m of the camera's cell's centre, 20 of them
    // with steep ground; the cover names what they cover.
    expect(patches.builds()).toBe(29);
    expect(patches.meshCount()).toBe(20);
    expect(casting.size).toBe(20);
    expect(patches.cover()).toEqual({ x: -376, z: -904, reach: 48 - 16 * Math.SQRT2, fine: 48, cell: 16 });
    const counts: number[] = [];
    let frames = 0;
    while (patches.meshCount() === 20 && frames < 1000) {
      patches.update(CAM.x, CAM.z);
      t.frame();
      frames++;
      expect(t.jobs.last.late).toBe(0);
      // The share and one slice, never a cell's slice past the share.
      expect(t.jobs.last.slices).toBeLessThanOrEqual(41);
      counts.push(patches.meshCount());
    }
    // 1,932 far and wide cells, a slice each, said to take 2 ms and 0.5 ms:
    // drawn in the 63rd frame after the first.
    expect(frames).toBe(63);
    expect(patches.builds()).toBe(1961);
    expect(patches.meshCount()).toBe(362);
    expect(casting).toEqual(new Set(patchMeshes(s)));
    // Drawn in the last slice, whole: 20 in every frame before it.
    expect(counts.filter((n) => n !== 20)).toEqual([362]);
    expect(counts.length).toBe(63);
    expect(patches.cover()).toEqual(facePatchCover(CAM.x, CAM.z, PATCH_REACH.high));
    patches.dispose();
  }, timeLimit(120_000));

  /** Frames of `update` at (x, z) and a share each until `done`, at most
   * `most`: how many it took. */
  function framesUntil(t: ReturnType<typeof steppedJobs>, update: () => void, done: () => boolean, most: number): number {
    let frames = 0;
    while (!done() && frames < most) {
      update();
      t.frame();
      frames++;
    }
    return frames;
  }

  it("builds a walk's crossing ahead, and draws it whole in the crossing's frame, nothing built in it", () => {
    const s = scene();
    const t = steppedJobs();
    const { patches, casting, reflected, rained } = made(s, t.jobs);
    // The camera's cell (−24, −57), at its west edge, walking east: 15 m to
    // its east line, 172 frames at a walk.
    const at = { x: -383, z: CAM.z };
    patches.update(at.x, at.z);
    framesUntil(t, () => patches.update(at.x, at.z), () => patches.meshCount() === 362, 1000);
    const before = new Set(patchMeshes(s));
    const step = WALKING / 60;
    /** Per frame from the first step: builds, meshes drawn, and whether the
     * update itself built. */
    const log: { builds: number; drawn: number; crossed: boolean }[] = [];
    for (let f = 0; f < 200; f++) {
      at.x += step;
      const was = { builds: patches.builds(), drawn: patches.meshCount() };
      patches.update(at.x, at.z);
      const crossed = Math.floor(at.x / 16) !== Math.floor((at.x - step) / 16);
      // An update builds nothing and draws nothing new, the crossing's too.
      expect(patches.builds()).toBe(was.builds);
      expect(patches.meshCount()).toBe(was.drawn);
      if (patches.meshCount() === 362) expect(new Set(patchMeshes(s))).toEqual(before);
      t.frame();
      expect(t.jobs.last.late).toBe(0);
      log.push({ builds: patches.builds(), drawn: patches.meshCount(), crossed });
    }
    const crossing = log.findIndex((l) => l.crossed);
    // The east line, x = −368, in the 172nd frame of the walk.
    expect(crossing).toBe(171);
    // The 142 cells the crossing builds (51 entered, 91 changed) all built
    // ahead, in the frames before it, by the 1,961 of the first set.
    expect(log[crossing - 1]).toEqual({ builds: 2103, drawn: 362, crossed: false });
    // Drawn in the crossing's own frame, its share, well inside the six
    // frames a job may take: nothing built in it.
    expect(log.findIndex((l) => l.drawn !== 362)).toBe(crossing);
    expect(log[crossing]).toEqual({ builds: 2103, drawn: 368, crossed: true });
    // Then the idle work builds ahead for the next line, x = −352: 140 cells
    // over the 23 frames after it, none of them drawn.
    expect(log.slice(crossing).filter((l) => l.drawn !== 368)).toEqual([]);
    expect(log.findIndex((l) => l.builds === 2243) - crossing).toBe(23);
    expect(log[log.length - 1]?.builds).toBe(2243);
    const after = new Set(patchMeshes(s));
    expect(after.size).toBe(368);
    let kept = 0;
    for (const m of before) if (after.has(m)) kept++;
    expect(kept).toBe(310);
    // Every registry swapped in that slice.
    expect(casting).toEqual(after);
    expect(reflected).toEqual(after);
    expect(rained).toEqual(after);
    expect(patches.cover()).toEqual(facePatchCover(-367, CAM.z, PATCH_REACH.high));
    // What is built ahead is hidden until its crossing applies it: 56 of
    // the 140 have steep ground.
    const hidden = s.meshes.filter((m) => m.name.startsWith("facePatch_") && !m.isEnabled(false));
    expect(hidden.length).toBe(56);
    expect(hidden.some((m) => casting.has(m) || reflected.has(m) || rained.has(m))).toBe(false);
    patches.dispose();
    expect(s.meshes.filter((m) => m.name.startsWith("facePatch_")).length).toBe(0);
    expect(casting.size).toBe(0);
  }, timeLimit(120_000));

  it("begins a crossing it did not build ahead again at a second, keeping what it built, and draws it whole, never late", () => {
    const s = scene();
    const t = steppedJobs();
    const { patches, casting } = made(s, t.jobs);
    // Standing in cell (−24, −57), by its north-east corner: no heading, so
    // nothing is built ahead.
    const at = { x: -368.2, z: -896.2 };
    patches.update(at.x, at.z);
    framesUntil(t, () => patches.update(at.x, at.z), () => patches.meshCount() === 362, 1000);
    const before = new Set(patchMeshes(s));
    expect(patches.builds()).toBe(1961);
    // A step east into cell (−23, −57): a job, nothing built by the update.
    at.x += 0.4;
    patches.update(at.x, at.z);
    expect(patches.builds()).toBe(1961);
    const drawn: number[] = [];
    for (let f = 0; f < 3; f++) {
      patches.update(at.x, at.z);
      t.frame();
      expect(t.jobs.last.late).toBe(0);
      drawn.push(patches.meshCount());
    }
    // Three frames on, the old set still drawn, two of the new one's cells
    // built: the set worked out in the first, then a near cell a frame, its
    // slice longer than a frame's share.
    expect(drawn).toEqual([362, 362, 362]);
    expect(new Set(patchMeshes(s))).toEqual(before);
    expect(patches.builds()).toBe(1963);
    expect(patches.cover()).toEqual(facePatchCover(-376, -904, PATCH_REACH.high));
    // A step north into cell (−23, −56) before it is drawn: the job begins
    // again for that cell, and what it built and the new set wants as it
    // was built is kept.
    at.z += 0.4;
    // Until it is drawn, the old set is, whole: the cover says which.
    const frames = framesUntil(t, () => {
      patches.update(at.x, at.z);
      expect(new Set(patchMeshes(s))).toEqual(before);
    }, () => patches.cover()?.x !== -376, 1000);
    expect(t.jobs.last.late).toBe(0);
    // The new set wants 190 cells built, one of them as the first job built
    // it: 189 more, over 23 frames.
    expect(frames).toBe(23);
    expect(patches.builds()).toBe(1963 + 189);
    expect(patches.cover()).toEqual(facePatchCover(at.x, at.z, PATCH_REACH.high));
    // What a set built at once for that cell draws.
    const s2 = new Scene(engine as NullEngine);
    const direct = createFacePatches(s2, SEED, "high", terrainMaterialFor(s2, FACE_PATCH_MATERIAL));
    direct.update(at.x, at.z);
    expect(patches.meshCount()).toBe(direct.meshCount());
    expect(new Set(patchMeshes(s).map((m) => m.name))).toEqual(new Set(patchMeshes(s2).map((m) => m.name)));
    expect(casting).toEqual(new Set(patchMeshes(s)));
    direct.dispose();
    patches.dispose();
  }, timeLimit(120_000));

  it("keeps what it built ahead for one heading when the camera turns, until a set is drawn", () => {
    const s = scene();
    const t = steppedJobs();
    const { patches } = made(s, t.jobs);
    // By the north-east corner of cell (−24, −57).
    const at = { x: -368.3, z: -896.3 };
    patches.update(at.x, at.z);
    framesUntil(t, () => patches.update(at.x, at.z), () => patches.meshCount() === 362, 1000);
    /** Frames at (x, z) until the idle work has nothing left, at most 300. */
    const settle = (): void => {
      let quiet = 0;
      for (let f = 0; f < 300 && quiet < 3; f++) {
        patches.update(at.x, at.z);
        t.frame();
        quiet = t.jobs.last.idle === 0 ? quiet + 1 : 0;
      }
    };
    const hidden = (): number => s.meshes.filter((m) => m.name.startsWith("facePatch_") && !m.isEnabled(false)).length;
    // Facing east: the 142 cells of cell (−23, −57)'s set built ahead.
    at.x += 0.01;
    settle();
    expect([patches.builds(), hidden()]).toEqual([2103, 58]);
    // Facing north: the 106 cells of cell (−24, −56)'s set not built as it
    // wants them, 47 with a patch, and the east's kept.
    at.z += 0.01;
    settle();
    expect([patches.builds(), hidden()]).toEqual([2209, 105]);
    // Facing east again: nothing built again, nothing let go.
    at.x += 0.01;
    settle();
    expect([patches.builds(), hidden()]).toEqual([2209, 105]);
    // Over the east line: drawn in its frame, and what was built for the
    // north let go.
    at.x += 0.3;
    patches.update(at.x, at.z);
    t.frame();
    expect(patches.meshCount()).toBe(368);
    expect(hidden()).toBe(0);
    patches.dispose();
  }, timeLimit(120_000));

  it("does nothing once disposed, and leaves no mesh behind", () => {
    const s = scene();
    const t = steppedJobs();
    const { patches } = made(s, t.jobs);
    patches.update(CAM.x, CAM.z);
    t.frame();
    patches.dispose();
    // A walk on after it: nothing built, nothing aimed, nothing drawn.
    for (let f = 0; f < 20; f++) {
      patches.update(CAM.x + f * 0.5, CAM.z);
      t.frame();
    }
    // The near band's 29 and the job's first frame's 19, no more.
    expect(patches.builds()).toBe(48);
    expect(patches.meshCount()).toBe(0);
    expect(patches.cover()).toBeNull();
    expect(s.meshes.filter((m) => m.name.startsWith("facePatch_")).length).toBe(0);
  }, timeLimit(120_000));

  it("builds a jump of more than a cell and the free camera's boost at once, whatever is pending", () => {
    const s = scene();
    const t = steppedJobs();
    const { patches, casting } = made(s, t.jobs);
    patches.update(CAM.x, CAM.z);
    // The rest of the first set still to come: a jump two cells east.
    t.frame();
    const was = patches.builds();
    patches.update(CAM.x + 32, CAM.z);
    // 29 near cells, then 19 in the job's first frame; at the jump, 1,940
    // of the new set's 1,961, the other 21 drawn or built as it wants them.
    expect([was, patches.builds() - was]).toEqual([48, 1940]);
    expect(patches.meshCount()).toBe(373);
    expect(casting).toEqual(new Set(patchMeshes(s)));
    expect(patches.cover()).toEqual(facePatchCover(CAM.x + 32, CAM.z, PATCH_REACH.high));
    // Nothing left to draw.
    for (let f = 0; f < 10; f++) {
      patches.update(CAM.x + 32, CAM.z);
      t.frame();
      expect(patches.meshCount()).toBe(373);
    }
    // The free camera's boost, 2.4 m a frame, across the next line east: at
    // once too.
    patches.update(CAM.x + 32 + 2.4, CAM.z);
    expect(patches.cover()?.x).toBe(-328);
    expect(casting).toEqual(new Set(patchMeshes(s)));
    patches.dispose();
  }, timeLimit(120_000));
});

describe("createFacePatches, as jobs, on this machine's clock", () => {
  /** Frame times (ms) as max and mean, to a tenth. */
  function spread(ms: number[]): { max: number; mean: number } {
    const round = (v: number): number => Math.round(v * 10) / 10;
    return { max: round(Math.max(...ms)), mean: round(ms.reduce((a, b) => a + b, 0) / ms.length) };
  }

  it("keeps the first update to the near band, and a crossing's frames to the share and a slice", { tags: ["wall-clock"], timeout: timeLimit(120_000) }, () => {
    const s = scene();
    const jobs = createSyncJobs(() => performance.now());
    const patches = createFacePatches(s, SEED, "high", terrainMaterialFor(s, FACE_PATCH_MATERIAL), jobs);
    // The ground's tables are made on their first sample, which in the game
    // the terrain's first build pays.
    facePatchGeometry(SEED, 0, 0, 2, NO_STITCH);
    /** One frame of `update` at (x, z) and the share: its time (ms). */
    const frame = (x: number, z: number): number => {
      const t0 = performance.now();
      patches.update(x, z);
      jobs.run();
      return performance.now() - t0;
    };
    // The first update, from the west edge of the reference pose's cell.
    const at = { x: -383, z: CAM.z };
    const t0 = performance.now();
    patches.update(at.x, at.z);
    const first = performance.now() - t0;
    const filling: number[] = [];
    while (patches.meshCount() === 20 && filling.length < 10_000) filling.push(frame(at.x, at.z));
    // The work's time: the frames run back to back.
    const filled = performance.now() - t0;
    // A walk east to the cell's east line, 172 frames, and 30 on: the idle
    // work builds the crossing ahead, and the crossing's frame draws it.
    const walking: number[] = [];
    let crossed = -1;
    for (let f = 0; f < 202; f++) {
      const was = patches.cover()?.x;
      at.x += WALKING / 60;
      walking.push(frame(at.x, at.z));
      if (crossed < 0 && patches.cover()?.x !== was) crossed = f;
    }
    // Facing west, the idle work building the cell west, then a step east
    // over the next line: nothing built ahead for it, the job's frames until
    // it is drawn.
    at.x = -352.2;
    frame(at.x, at.z);
    at.x -= 0.01;
    for (let f = 0; f < 600 && (jobs.last.idle > 0 || f < 2); f++) frame(at.x, at.z);
    at.x += 0.41;
    const unforeseen: number[] = [];
    while (patches.cover()?.x !== -344 && unforeseen.length < 10_000) unforeseen.push(frame(at.x, at.z));
    // On the development machine: the first update 99 to 101 ms, where it
    // built every cell at once in about 600; the far and wide bands 605 to
    // 636 ms over 159 to 166 frames, a frame 3.2 ms on average and 4.5 to
    // 5.2 at most; the walk 1.1 ms a frame on average, 4.3 at most, and the
    // crossing's frame 2.6 to 3.2 ms, where it took about 120; the crossing
    // not built ahead 34 to 36 frames, 3.2 to 3.4 ms a frame on average and
    // 4.1 to 6.3 at most. The bars leave room for a busier machine and still
    // catch a crossing built in one frame again.
    expect(crossed).toBe(171);
    expect(first).toBeLessThan(200);
    expect(walking[crossed]).toBeLessThan(10);
    for (const ms of [filling, walking, unforeseen]) {
      expect(spread(ms).mean).toBeLessThan(8);
      expect(spread(ms).max).toBeLessThan(20);
    }
    expect(filled).toBeLessThan(1500);
    patches.dispose();
  });
});
