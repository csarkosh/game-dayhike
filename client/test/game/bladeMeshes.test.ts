import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import "../../src/sim/passes/index.js";
import {
  BLADE_ALBEDO, BLADE_CHARACTERS, BLADE_VERTS, bladeAlive, bladeClumpGeometry, bladeCountFor,
  bladeSecondRandom,
} from "../../src/game/bladeClump.js";
import {
  BLADE_CHARACTER_COUNT, BLADE_REBUILD_CELL, BLADE_SIZE_BASE, BLADE_SIZE_COUNT, BLADE_SIZE_FULL, BLADE_SIZE_THIN,
  bladeTierBands, createBladeCollector,
} from "../../src/game/bladeField.js";
import {
  BLADE_CANOPY_HEIGHT, BLADE_STRENGTH_HEIGHT, bladeHeightScale, bladeMeshName, createBladeMeshes,
} from "../../src/game/bladeMeshes.js";
import { instanceMatrixFor, trampleFrame } from "../../src/game/clutterMeshes.js";
import { FoliagePlugin } from "../../src/game/foliagePlugin.js";
import { CULL_MOVE, CULL_TURN, cullPlanes, type CullPose } from "../../src/game/grassCull.js";
import { bladeReach, extentSeen, thresholdWalk } from "./helpers/cullReach.js";
import { seedFromToken } from "../../src/game/seed.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";

// The open-field census point: every tier and every character is present.
const SEED = 1;
const CAM = { x: 35, z: 21335 };

function bufferFor(spy: { mock: { calls: unknown[][]; instances: unknown[] } }, mesh: Mesh, kind: string): Float32Array | null {
  for (let k = spy.mock.calls.length - 1; k >= 0; k--) {
    const call = spy.mock.calls[k]!;
    if (spy.mock.instances[k] === mesh && call[0] === kind) return call[1] as Float32Array;
  }
  return null;
}

describe("bladeHeightScale", () => {
  it("draws floor grass under a closed canopy at three-quarter height, from one cut not two", () => {
    expect(BLADE_CANOPY_HEIGHT).toBe(1);
    expect(BLADE_STRENGTH_HEIGHT).toEqual([0.5, 1]);
    expect(bladeHeightScale(0.5, 1)).toBeCloseTo(0.75, 6);
    expect(bladeHeightScale(1, 1)).toBeCloseTo(1, 6);
    expect(bladeHeightScale(0, 0)).toBeCloseTo(0.5, 6);
    // the canopy no longer scales height on its own
    expect(bladeHeightScale(0.5, 0)).toBeCloseTo(bladeHeightScale(0.5, 1), 6);
  });
});

describe("createBladeMeshes", () => {
  it("builds one mesh per character and tier on three tier materials, opaque, shadowed, plugged", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    expect(blades.meshes.length).toBe(BLADE_CHARACTER_COUNT * 3 * BLADE_SIZE_COUNT);
    const materials = new Set<PBRMaterial>();
    const bands = bladeTierBands();
    for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
      for (let t = 0; t < 3; t++) {
        for (let size = 0; size < BLADE_SIZE_COUNT; size++) {
          const mesh = scene.getMeshByName(bladeMeshName(ch, t, size)) as Mesh;
          expect(mesh).toBeInstanceOf(Mesh);
          const g = bladeClumpGeometry(BLADE_CHARACTERS[ch]!, bladeCountFor("high", ch, t, size));
          expect(mesh.getTotalVertices()).toBe(g.positions.length / 3);
          expect(mesh.getVerticesData("blade")).not.toBeNull();
          expect(mesh.receiveShadows).toBe(true);
          expect(mesh.isPickable).toBe(false);
          expect(mesh.alwaysSelectAsActiveMesh).toBe(true);
          const mat = mesh.material as PBRMaterial;
          materials.add(mat);
          expect(mat.needAlphaTesting()).toBe(false);
          expect(mat.needAlphaBlending()).toBe(false);
          expect(mat.backFaceCulling).toBe(false);
          expect([mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b]).toEqual([BLADE_ALBEDO.r, BLADE_ALBEDO.g, BLADE_ALBEDO.b]);
          const foliage = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
          expect(foliage).toBeInstanceOf(FoliagePlugin);
          expect(foliage.bladeEdges).toEqual(bands[t]);
          expect(mat.pluginManager!.getPlugin("FoliageLight")).not.toBeNull();
          expect(mat.pluginManager!.getPlugin("DistanceFade") ?? null).toBeNull();
        }
      }
    }
    // One material per tier, shared by its twelve character-size buckets.
    expect(materials.size).toBe(3);
    blades.dispose();
    for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
      for (let t = 0; t < 3; t++) {
        for (let size = 0; size < BLADE_SIZE_COUNT; size++) expect(scene.getMeshByName(bladeMeshName(ch, t, size))).toBeNull();
      }
    }
    for (const mat of materials) expect(scene.getMaterialByName(mat.name)).toBeNull();
    engine.dispose();
  });

  it("fills each bucket with its tier's cells of its character, nearest first, with the cards' matrix and tint and the strength", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    blades.update(CAM.x, CAM.z);
    blades.cull(null);
    const tiers = createBladeCollector(SEED).collect(CAM.x, CAM.z);
    const lists = [tiers.fine, tiers.mid, tiers.coarse];
    let checked = 0;
    for (let t = 0; t < 3; t++) {
      for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
        for (let size = 0; size < BLADE_SIZE_COUNT; size++) {
          const cells = lists[t]!.filter((c) => c.character === ch && c.size === size);
          const mesh = scene.getMeshByName(bladeMeshName(ch, t, size)) as Mesh;
          expect(mesh.thinInstanceCount).toBe(cells.length);
          if (cells.length === 0) continue;
          const matrices = bufferFor(spy, mesh, "matrix")!;
          const tints = bufferFor(spy, mesh, "foliage")!;
          const strengths = bufferFor(spy, mesh, "bladeStrength")!;
          expect(bufferFor(spy, mesh, "fadeBands")).toBeNull();
          const buf = new Float32Array(16);
          for (let i = 0; i < Math.min(cells.length, 20); i++) {
            const c = cells[i]!;
            expect(strengths[i]).toBe(Math.fround(c.strength));
            expect(c.strength).toBeLessThanOrEqual(1);
            // The matrix is the cards' own, with the strength's and the canopy's height folded in.
            const frame = trampleFrame(SEED, c);
            const heightScale = bladeHeightScale(c.strength, c.canopy);
            instanceMatrixFor(c, { height: frame.height * heightScale, lean: frame.lean, ax: frame.ax, az: frame.az, tint: frame.tint }, buf);
            for (let k = 0; k < 16; k++) expect(matrices[i * 16 + k]).toBeCloseTo(buf[k]!, 5);
            expect(tints[i * 4 + 3]).toBeCloseTo(1 - 0.5 * c.canopy, 5);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
    spy.mockRestore();
    blades.dispose();
    engine.dispose();
  });

  it("routes each cell to the bucket of its character, tier and size", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    blades.update(CAM.x, CAM.z);
    blades.cull(null);
    const tiers = createBladeCollector(SEED).collect(CAM.x, CAM.z);
    const lists = [tiers.fine, tiers.mid, tiers.coarse];
    for (let t = 0; t < 3; t++) {
      for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
        for (let size = 0; size < BLADE_SIZE_COUNT; size++) {
          const want = lists[t]!.filter((c) => c.character === ch && c.size === size).length;
          const mesh = scene.getMeshByName(bladeMeshName(ch, t, size)) as Mesh;
          expect(mesh.thinInstanceCount).toBe(want);
        }
      }
    }
    // At the census point the interior is boosted: full clumps outnumber thin ones in the fine tier.
    const full = tiers.fine.filter((c) => c.size === BLADE_SIZE_FULL).length;
    const thin = tiers.fine.filter((c) => c.size === BLADE_SIZE_THIN).length;
    expect(full).toBeGreaterThan(thin);
    blades.dispose();
    engine.dispose();
  });

  it("rebuilds on a 1 m crossing and not inside one", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "medium" });
    const spy = vi.spyOn(Mesh.prototype, "thinInstancePartialBufferUpdate");
    const set = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    blades.update(CAM.x, CAM.z);
    blades.cull(null);
    const afterFirst = set.mock.calls.length + spy.mock.calls.length;
    expect(set.mock.calls.length).toBeGreaterThan(0);
    blades.update(CAM.x + 0.4, CAM.z + 0.4);
    blades.cull(null);
    expect(set.mock.calls.length + spy.mock.calls.length).toBe(afterFirst);
    blades.update(CAM.x + BLADE_REBUILD_CELL, CAM.z);
    blades.cull(null);
    expect(set.mock.calls.length + spy.mock.calls.length).toBeGreaterThan(afterFirst);
    spy.mockRestore();
    set.mockRestore();
    blades.dispose();
    engine.dispose();
  });

  it("uses the medium counts on medium", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "medium" });
    const mesh = scene.getMeshByName(bladeMeshName(0, 0, BLADE_SIZE_BASE)) as Mesh;
    const g = bladeClumpGeometry(BLADE_CHARACTERS[0]!, bladeCountFor("medium", 0, 0, BLADE_SIZE_BASE));
    expect(mesh.getTotalVertices()).toBe(g.positions.length / 3);
    blades.dispose();
    engine.dispose();
  });

  it("collapses a blade to one world point, and leaves it whole, as `bladeAlive` says", () => {
    const g = bladeClumpGeometry(BLADE_CHARACTERS[0]!, 16);
    const cell = { cls: 6, x: 3, z: -7, groundH: 12, groundDx: 0, groundDz: 0, scale: 1, variant: 0, hash: 0.37 };
    const buf = new Float32Array(16);
    instanceMatrixFor(cell, { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } }, buf);
    const m = Matrix.FromArray(buf);
    // The first blade: its vertices are [0, BLADE_VERTS), and its record names
    // the root it collapses to, its hand-off random, and (through the root) the
    // second random the strength cut reads.
    const rootX = g.blade[0]!, rootZ = g.blade[1]!, random = g.blade[2]!;
    const second = bladeSecondRandom(rootX, rootZ);
    const root = Vector3.TransformCoordinates(new Vector3(rootX, 0, rootZ), m);
    // Past the tier's collapse band (grow and thin both 1), with a strength no
    // blade is cut by, the blade is gone; inside the tier (thin 0) with a
    // strength its second random clears, it is whole.
    const gone = bladeAlive(random, second, 1, 1, 1);
    const whole = bladeAlive(random, second, second + 1e-3, 1, 0);
    expect(gone).toBe(0);
    expect(whole).toBe(1);
    for (let v = 0; v < BLADE_VERTS; v++) {
      const world = Vector3.TransformCoordinates(new Vector3(g.positions[v * 3]!, g.positions[v * 3 + 1]!, g.positions[v * 3 + 2]!), m);
      // The shader's own mix: worldPos = root + (worldPos - root) * alive.
      expect(root.add(world.subtract(root).scale(gone)).subtract(root).length()).toBeLessThan(1e-6);
      expect(root.add(world.subtract(root).scale(whole)).subtract(world).length()).toBeLessThan(1e-6);
    }
  });
});

/** The gate's portrait still: 1200 × 2029 at a vertical field of view of 1.4 rad. */
const PORTRAIT = 1200 / 2029;
/** The two gate poses (`__fcSet(x, y, z, yaw, pitch)` on the `atmo` seed). */
const GATE_SEED = seedFromToken("atmo");
const CANOPY: CullPose = { x: 123, y: 110.87, z: -105.5, yaw: 1.571, pitch: 0.3, fov: 1.4, aspect: PORTRAIT };
const MEADOW: CullPose = { x: 369, y: 51.01, z: -855, yaw: 0, pitch: 0.3, fov: 1.4, aspect: PORTRAIT };

/** A bucket mesh's tier, character and size, from its name. */
function bucketOf(mesh: Mesh): { c: number; t: number; s: number } {
  const [, c, t, s] = /_c(\d)_t(\d)_s(\d)$/.exec(mesh.name)!.map(Number);
  return { c: c!, t: t!, s: s! };
}

describe("the blade field culled to the frustum", () => {
  const POSE = { x: CAM.x, y: 0, z: CAM.z, yaw: 1.571, pitch: 0.3, fov: 1.4, aspect: PORTRAIT };

  it("draws each bucket's kept prefix, uploads only it, and adds no mesh", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    const set = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    blades.update(CAM.x, CAM.z);
    const meshCount = scene.meshes.length;
    const pose = { ...POSE, y: elevationSampleAt(SEED, CAM.x, CAM.z).h + 1.6 };
    const partial = vi.spyOn(Mesh.prototype, "thinInstancePartialBufferUpdate");
    const whole = vi.spyOn(Mesh.prototype, "thinInstanceBufferUpdated");
    blades.cull(pose);
    const planes = new Float32Array(20);
    cullPlanes(pose, planes);
    const tiers = createBladeCollector(SEED).collect(CAM.x, CAM.z);
    const lists = [tiers.fine, tiers.mid, tiers.coarse];
    let drawn = 0, collected = 0, enabled = 0;
    for (const mesh of blades.meshes) {
      const { c, t, s } = bucketOf(mesh);
      const cells = lists[t]!.filter((cell) => cell.character === c && cell.size === s);
      collected += cells.length;
      // The kept cells are those whose translation the planes keep, in list order.
      const want = cells.filter((cell) => {
        const y = cell.groundH - 0.02; // the translation instanceMatrixFor writes: the ground less the sink
        for (let p = 0; p < 20; p += 4) if (planes[p]! * cell.x + planes[p + 1]! * y + planes[p + 2]! * cell.z + planes[p + 3]! < -1.5) return false;
        return true;
      });
      expect(mesh.isEnabled() ? mesh.thinInstanceCount : 0).toBe(want.length);
      if (!mesh.isEnabled()) continue;
      enabled++;
      drawn += want.length;
      const matrices = bufferFor(set, mesh, "matrix")!;
      const got: number[][] = [];
      for (let i = 0; i < mesh.thinInstanceCount; i++) got.push([matrices[i * 16 + 12]!, matrices[i * 16 + 14]!]);
      expect(got).toEqual(want.map((cell) => [cell.x, cell.z].map(Math.fround)));
      // The strength and the foliage prefixes are the kept cells' own.
      const strengths = bufferFor(set, mesh, "bladeStrength")!;
      const foliage = bufferFor(set, mesh, "foliage")!;
      want.forEach((cell, i) => {
        expect(strengths[i]).toBe(Math.fround(cell.strength));
        expect(foliage[i * 4 + 3]).toBeCloseTo(1 - 0.5 * cell.canopy, 5);
      });
    }
    // The prefix is a fraction of what was collected: about a fifth at this pose.
    expect(collected).toBe(6319);
    expect(drawn).toBe(1741);
    expect(drawn / collected).toBeLessThan(0.35);
    // Only prefixes are uploaded, never more than the kept count, never whole.
    expect(partial.mock.calls.length).toBe(enabled * 3);
    for (let k = 0; k < partial.mock.calls.length; k++) {
      const [, len, offset] = partial.mock.calls[k]!;
      expect(offset).toBe(0);
      expect(len as number).toBeLessThanOrEqual((partial.mock.instances[k] as unknown as Mesh).thinInstanceCount);
    }
    expect(whole).not.toHaveBeenCalled();
    // A second call at the same pose does nothing, nor does a look-around inside the thresholds.
    partial.mockClear();
    blades.cull(pose);
    blades.cull({ ...pose, yaw: pose.yaw + 0.05, pitch: pose.pitch - 0.05, x: pose.x + 0.3 });
    expect(partial).not.toHaveBeenCalled();
    // The draw count is the buckets' own: no mesh is added, and none that drew
    // the collected set whole is enabled that was not before.
    expect(scene.meshes.length).toBe(meshCount);
    blades.cull(null);
    const wholeEnabled = blades.meshes.filter((m) => m.isEnabled()).length;
    expect(wholeEnabled).toBe(26);
    expect(enabled).toBe(24);
    expect(enabled).toBeLessThanOrEqual(wholeEnabled);
    partial.mockRestore(); whole.mockRestore(); set.mockRestore();
    blades.dispose(); engine.dispose();
  }, 60_000);

  it("refilters after every rebuild, even with the camera still", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    const pose = { ...POSE, y: elevationSampleAt(SEED, CAM.x, CAM.z).h + 1.6 };
    blades.update(CAM.x, CAM.z);
    blades.cull(pose);
    const partial = vi.spyOn(Mesh.prototype, "thinInstancePartialBufferUpdate");
    blades.update(CAM.x + BLADE_REBUILD_CELL, CAM.z);
    blades.cull(pose);
    expect(partial.mock.calls.length).toBeGreaterThan(0);
    partial.mockClear();
    blades.cull(pose);
    expect(partial).not.toHaveBeenCalled();
    partial.mockRestore();
    blades.dispose(); engine.dispose();
  }, 60_000);

  // A WebGL context restore rebuilds each GPU buffer from the data it last
  // took, which after a prefix upload is the prefix alone. The shell hands
  // every mesh its full drawn buffers again and cuts afresh. NullEngine has no
  // GL buffers, so this proves the hand-back and the recut, not the GPU sizes.
  it("hands every mesh its full drawn buffers again after a context restore, and cuts afresh", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    const set = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    const pose = { ...POSE, y: elevationSampleAt(SEED, CAM.x, CAM.z).h + 1.6 };
    blades.update(CAM.x, CAM.z);
    blades.cull(pose);
    const before = blades.meshes.map((m) => (m.isEnabled() ? m.thinInstanceCount : 0));
    const drawnBufs = blades.meshes.map((m) => bufferFor(set, m, "matrix"));
    set.mockClear();
    engine.onContextRestoredObservable.notifyObservers(engine);
    let handed = 0;
    blades.meshes.forEach((mesh, b) => {
      if (drawnBufs[b] === null) return;
      handed++;
      // The same full-capacity arrays, every kind.
      expect(bufferFor(set, mesh, "matrix")).toBe(drawnBufs[b]);
      expect(bufferFor(set, mesh, "foliage")!.length * 4).toBe(drawnBufs[b]!.length);
      expect(bufferFor(set, mesh, "bladeStrength")!.length * 16).toBe(drawnBufs[b]!.length);
      expect(drawnBufs[b]!.length).toBeGreaterThanOrEqual(before[b]! * 16);
    });
    expect(handed).toBe(26);
    // The same pose cuts again, to the same prefixes.
    const partial = vi.spyOn(Mesh.prototype, "thinInstancePartialBufferUpdate");
    blades.cull(pose);
    expect(partial.mock.calls.length).toBe(72);
    expect(blades.meshes.map((m) => (m.isEnabled() ? m.thinInstanceCount : 0))).toEqual(before);
    partial.mockRestore();
    // Disposed, the shell no longer listens.
    blades.dispose();
    set.mockClear();
    engine.onContextRestoredObservable.notifyObservers(engine);
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
    engine.dispose();
  }, 60_000);

  it("keeps, at the two gate poses, the cells the widened frustum holds, and pins how many", () => {
    const counts: number[] = [];
    const draws: number[] = [];
    for (const pose of [CANOPY, MEADOW]) {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const blades = createBladeMeshes(scene, GATE_SEED, { quality: "high" });
      blades.update(pose.x, pose.z);
      blades.cull(null);
      const all = blades.meshes.reduce((n, m) => n + (m.isEnabled() ? m.thinInstanceCount : 0), 0);
      const drawsAll = blades.meshes.filter((m) => m.isEnabled()).length;
      blades.cull(pose);
      const kept = blades.meshes.reduce((n, m) => n + (m.isEnabled() ? m.thinInstanceCount : 0), 0);
      const drawsKept = blades.meshes.filter((m) => m.isEnabled()).length;
      counts.push(kept, all);
      draws.push(drawsKept, drawsAll);
      // One pass's JS, forced by alternating two poses past the threshold. Reported, not asserted.
      const t0 = performance.now();
      const N = 40;
      for (let i = 0; i < N; i++) blades.cull({ ...pose, yaw: pose.yaw + (i % 2 === 0 ? 0.1 : 0) });
      console.log(`blade cull pass at (${pose.x}, ${pose.z}): ${((performance.now() - t0) / N).toFixed(3)} ms, kept ${kept} of ${all}`);
      blades.dispose(); engine.dispose();
    }
    // Canopy: the profile counted 6,131 collected and 1,063 inside the exact frustum.
    expect(counts).toEqual([1614, 6131, 1752, 6587]);
    // Blade draws, culled and whole: the profile counted 20 live buckets at the canopy pose.
    expect(draws).toEqual([20, 20, 12, 12]);
  }, 60_000);

  it("never leaves out a cell any part of which the camera can see, on threshold walks at both gate fields", () => {
    const reach = bladeReach();
    let seenCells = 0, holds = 0;
    for (const base of [CANOPY, MEADOW]) {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const set = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
      const partial = vi.spyOn(Mesh.prototype, "thinInstancePartialBufferUpdate");
      const blades = createBladeMeshes(scene, GATE_SEED, { quality: "high" });
      blades.update(base.x, base.z);
      const tiers = createBladeCollector(GATE_SEED).collect(base.x, base.z);
      const lists = [tiers.fine, tiers.mid, tiers.coarse];
      const cellsOf = blades.meshes.map((mesh) => {
        const { c, t, s } = bucketOf(mesh);
        return lists[t]!.filter((cell) => cell.character === c && cell.size === s);
      });
      for (const { cut, views } of thresholdWalk(base, 12, 12345, CULL_TURN, CULL_MOVE)) {
        blades.cull(cut);
        for (const view of views) {
          // Under every threshold: the cut is reused, nothing uploaded.
          partial.mockClear();
          blades.cull({ x: view.x, y: view.y, z: view.z, yaw: view.yaw, pitch: view.pitch, fov: view.fov, aspect: view.aspect });
          expect(partial).not.toHaveBeenCalled();
          holds++;
          blades.meshes.forEach((mesh, b) => {
            const drawnKeys = new Set<string>();
            if (mesh.isEnabled()) {
              const m = bufferFor(set, mesh, "matrix")!;
              for (let i = 0; i < mesh.thinInstanceCount; i++) drawnKeys.add(`${m[i * 16 + 12]},${m[i * 16 + 14]}`);
            }
            for (const cell of cellsOf[b]!) {
              if (extentSeen(view, cell.x, cell.groundH, cell.z, reach)) {
                seenCells++;
                expect(drawnKeys.has(`${Math.fround(cell.x)},${Math.fround(cell.z)}`)).toBe(true);
              }
            }
          });
        }
      }
      set.mockRestore(); partial.mockRestore();
      blades.dispose(); engine.dispose();
    }
    expect(holds).toBe(96);
    expect(seenCells).toBeGreaterThan(50000);
  }, 180_000);
});
