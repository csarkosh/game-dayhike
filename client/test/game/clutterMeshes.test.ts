import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import "../../src/sim/passes/index.js";
import { CLUTTER_CLASS_COUNT, CLUTTER_GRASS, CLUTTER_ROCK } from "../../src/sim/clutter.js";
import { clutterFadeEdges, clutterSeamEdges } from "../../src/game/clutterField.js";
import { createClutterMeshes } from "../../src/game/clutterMeshes.js";
import { DistanceFadePlugin } from "../../src/game/distanceFadePlugin.js";
import { FoliagePlugin } from "../../src/game/foliagePlugin.js";
import { forestDensity } from "../../src/sim/vegetation.js";
import { macroNoise, macroTint } from "../../src/game/groundHexParams.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import { surfaceAlbedo } from "../../src/game/terrainSurface.js";

describe("createClutterMeshes attaches the distance fade", () => {
  it("puts the plugin on every bucket material and a constant fadeBands per bucket", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    // Two variants, two LODs per class; each mesh has its own material so a
    // wrong per-class edge cannot hide behind sharing. Alpha-tested, the way
    // every real clutter material with an alpha-cutout card is (foliage,
    // grass, flower, bush) — so the "plugin on every bucket material"
    // assertion below keeps meaning something given that opaque materials
    // skip the plugin entirely. One bucket (class 1, variant 1,
    // LOD 0) is left OPAQUE on purpose: it proves the opaque skip still
    // uploads that bucket's fadeBands buffer even with no plugin attached.
    const assets: Mesh[][][][] = [];
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      assets.push([0, 1].map((variant) => [0, 1].map((lod) => {
        const mesh = CreateBox(`c${cls}v${variant}l${lod}`, { size: 0.5 }, scene);
        mesh.material = new PBRMaterial(mesh.name, scene);
        if (!(cls === 1 && variant === 1 && lod === 0)) {
          mesh.material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
        }
        return [mesh];
      })));
    }
    const clutter = createClutterMeshes(scene, 1, { assets, radiusScale: 0.6 });

    // Babylon has no `thinInstanceGetBuffer`; read what reached the GPU
    // through a prototype-level spy instead — the `forestMeshes.test.ts`
    // "gradient to the GPU" test's shape, widened from one mesh to all of
    // them since this test's 32 meshes share no single instance to spy on.
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    clutter.update(2500, 2500);

    // spy.mock.calls[k] and spy.mock.instances[k] are parallel arrays: the
    // `this` Babylon bound each call to. `applyBucket` only calls
    // `thinInstanceSetBuffer` when a bucket has grown, which every non-empty
    // bucket does on this first `update`, so each such mesh appears exactly
    // once per buffer kind.
    function fadeBandsFor(mesh: Mesh): Float32Array | null {
      for (let k = spy.mock.calls.length - 1; k >= 0; k--) {
        const call = spy.mock.calls[k]!;
        if (spy.mock.instances[k] === mesh && call[0] === "fadeBands") {
          return call[1] as Float32Array;
        }
      }
      return null;
    }

    let seen = 0;
    let nonEmpty = 0; // guard: the loop below must actually reach the fadeBands assertions somewhere
    let sawOpaqueBucket = false; // guard: the opaque exception below must actually run
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const edge = clutterFadeEdges(cls, 0.6);
      const seam = clutterSeamEdges(cls, 0.6);
      for (const [variant, perLod] of assets[cls]!.entries()) {
        perLod.forEach((meshes, lod) => {
          const isOpaqueBucket = cls === 1 && variant === 1 && lod === 0;
          for (const mesh of meshes) {
            const plugin = mesh.material!.pluginManager?.getPlugin("DistanceFade");
            if (isOpaqueBucket) {
              // Opaque materials skip the plugin: needAlphaTesting() is
              // false, so attachDistanceFade skips it — no discard, no
              // early-Z cost — but the per-instance fadeBands buffer still
              // uploads, because every bucket writes it regardless (an
              // opaque shader simply never reads the attribute).
              expect(plugin, mesh.name).toBeNull();
            } else {
              expect(plugin, mesh.name).toBeInstanceOf(DistanceFadePlugin);
            }
            seen++;
            if (mesh.thinInstanceCount === 0) continue;
            nonEmpty++;
            if (isOpaqueBucket) sawOpaqueBucket = true;
            const bands = fadeBandsFor(mesh);
            expect(bands, mesh.name).not.toBeNull();
            // Math.fround, not toBeCloseTo: the buffer is float32 (the
            // forestMeshes.test.ts "gradient to the GPU" precedent), so this
            // is the exact value that reaches the GPU.
            const expected = (lod === 0
              ? [-2, -1, seam.start, seam.end]
              : [seam.start, seam.end, edge.start, edge.end]
            ).map(Math.fround);
            for (let i = 0; i < mesh.thinInstanceCount; i++) {
              expect(Array.from(bands!.subarray(i * 4, i * 4 + 4)), `${mesh.name}#${i}`).toEqual(expected);
            }
          }
        });
      }
    }
    expect(seen).toBe(CLUTTER_CLASS_COUNT * 4);
    expect(nonEmpty).toBeGreaterThan(0);
    expect(sawOpaqueBucket).toBe(true);
    clutter.dispose();
    engine.dispose();
  });
});

describe("foliage attribute and plugin", () => {
  const RADIUS_SCALE = 0.6;

  /** Bucket meshes per class/variant/lod, with ONE material per class/variant
   * shared across its two LOD buckets — the production shape (a card GLB's
   * two LOD buckets share one material), which is what makes the "far
   * bucket's edges also govern the near bucket" behaviour observable here. */
  function buildWithAssets(): { meshes: ReturnType<typeof createClutterMeshes>; assets: Mesh[][][][]; seed: number; engine: NullEngine } {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const seed = 1;
    const assets: Mesh[][][][] = [];
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      assets.push([0, 1].map((variant) => {
        const material = new PBRMaterial(`foliage-c${cls}v${variant}`, scene);
        material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
        return [0, 1].map((lod) => {
          const mesh = CreateBox(`foliage-c${cls}v${variant}l${lod}`, { size: 0.5 }, scene);
          mesh.material = material;
          return [mesh];
        });
      }));
    }
    const meshes = createClutterMeshes(scene, seed, { assets, radiusScale: RADIUS_SCALE });
    return { meshes, assets, seed, engine };
  }

  it("attaches the foliage plugin to the swaying classes only, with the far bucket's edges", () => {
    const { meshes, assets, engine } = buildWithAssets();
    const grassNear = assets[CLUTTER_GRASS]![0]![0]![0]!;
    const rockNear = assets[CLUTTER_ROCK]![0]![0]![0]!;
    const plugin = grassNear.material!.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    expect(plugin).toBeInstanceOf(FoliagePlugin);
    expect(rockNear.material!.pluginManager?.getPlugin("Foliage") ?? null).toBeNull();
    const edge = clutterFadeEdges(CLUTTER_GRASS, RADIUS_SCALE);
    expect(plugin.edges).toEqual([edge.start, edge.end]);
    meshes.dispose();
    engine.dispose();
  });

  it("writes the ground colour and the canopy shade per grass instance", () => {
    const { meshes, assets, seed, engine } = buildWithAssets();
    const grassNear = assets[CLUTTER_GRASS]![0]![0]![0]!;
    // Reads back the buffer of `kind` most recently pushed to `mesh` through
    // `thinInstanceSetBuffer` — the same GPU-bound spy the "distance fade"
    // test above uses, standing in for the `thinInstanceGetBuffer` accessor
    // Babylon 9.18 does not expose.
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    function bufferFor(mesh: Mesh, kind: string): Float32Array | null {
      for (let k = spy.mock.calls.length - 1; k >= 0; k--) {
        const call = spy.mock.calls[k]!;
        if (spy.mock.instances[k] === mesh && call[0] === kind) return call[1] as Float32Array;
      }
      return null;
    }
    // Near the origin, where the sim's own tests find grass reliably —
    // (2500, 2500) (the "distance fade" test's camera above) is far enough
    // out that this seed's terrain gates grass to zero there.
    meshes.update(100, 100);
    const count = grassNear.thinInstanceCount;
    expect(count).toBeGreaterThan(0);
    const matrices = bufferFor(grassNear, "matrix")!;
    const foliage = bufferFor(grassNear, "foliage")!;
    expect(matrices).not.toBeNull();
    expect(foliage).not.toBeNull();
    for (let i = 0; i < Math.min(count, 8); i++) {
      const x = matrices[i * 16 + 12]!;
      const z = matrices[i * 16 + 14]!;
      const shade = foliage[i * 4 + 3]!;
      expect(shade).toBeCloseTo(1 - 0.5 * forestDensity(seed, x, z), 5);
      // RGB is the palette colour surfaceAlbedo returns for that spot,
      // multiplied by the floor's macro tint so a tuft and the ground under it agree.
      const sample = elevationSampleAt(seed, x, z);
      const slope = Math.hypot(sample.dx, sample.dz);
      const canopy = forestDensity(seed, x, z);
      const baseColor = surfaceAlbedo(seed, x, z, sample.h, slope, canopy);
      const ny = 1 / Math.sqrt(1 + sample.dx * sample.dx + sample.dz * sample.dz);
      const tint = macroTint(macroNoise(x, z), 1 - ny);
      const expectedR = baseColor.r * tint.r;
      const expectedG = baseColor.g * tint.g;
      const expectedB = baseColor.b * tint.b;
      expect(foliage[i * 4]!).toBeCloseTo(expectedR, 5);
      expect(foliage[i * 4 + 1]!).toBeCloseTo(expectedG, 5);
      expect(foliage[i * 4 + 2]!).toBeCloseTo(expectedB, 5);
    }
    meshes.dispose();
    engine.dispose();
  });
});
