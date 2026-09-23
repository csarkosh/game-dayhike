import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import "../../src/sim/passes/index.js";
import { CLUTTER_CLASS_COUNT, CLUTTER_GRASS, CLUTTER_LITTER, CLUTTER_MEADOW, CLUTTER_ROCK } from "../../src/sim/clutter.js";
import { bladeFieldCovers } from "../../src/game/bladeField.js";
import { clutterFadeEdges, clutterSeamEdges } from "../../src/game/clutterField.js";
import { CLUTTER_SINK, createClutterMeshes, instanceMatrixFor, LITTER_VARIANT_SCALE, trampleFrame } from "../../src/game/clutterMeshes.js";
import { DistanceFadePlugin } from "../../src/game/distanceFadePlugin.js";
import { FoliagePlugin } from "../../src/game/foliagePlugin.js";
import { forestDensity } from "../../src/sim/vegetation.js";
import { macroNoise, macroTint } from "../../src/game/groundHexParams.js";
import { activeTerrainVariant, elevationSampleAt } from "../../src/sim/terrain.js";
import { surfaceAlbedo } from "../../src/game/terrainSurface.js";
import { trampleAt } from "../../src/game/trailBenchParams.js";

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
      const trample = trampleAt(activeTerrainVariant().trailDistance!(seed, x, z)).tint;
      expect(foliage[i * 4]!).toBeCloseTo(expectedR * trample.r, 5);
      expect(foliage[i * 4 + 1]!).toBeCloseTo(expectedG * trample.g, 5);
      expect(foliage[i * 4 + 2]!).toBeCloseTo(expectedB * trample.b, 5);
    }
    meshes.dispose();
    engine.dispose();
  });

  it("tramples the grass beside the bench: shorter, leaning away, stained; untouched past the band", () => {
    const seed = 1234;
    const rt = activeTerrainVariant().trailDistance!;
    const near = { cls: CLUTTER_GRASS, x: 0, z: 0, groundH: 0, groundDx: 0, groundDz: 0, scale: 1, variant: 0, hash: 0.3 };
    // Find a point 0.9 m from the trail and one 3 m away by scanning a stem edge's neighbourhood.
    const g = activeTerrainVariant().trailGraph!(seed);
    const e = g.edges[g.stem[1]!]!, a = g.nodes[e.a]!, b = g.nodes[e.b]!;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const L = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
    const p09 = { ...near, x: mx + nx * 0.9, z: mz + nz * 0.9 };
    const p3 = { ...near, x: mx + nx * 3, z: mz + nz * 3 };
    const rt09 = rt(seed, p09.x, p09.z);
    expect(rt09).toBeCloseTo(0.9, 3);
    // trampleFrame writes into one reusable scratch object rather than
    // allocating: copy the fields this test compares out of it before
    // calling again, the same discipline the rebuild itself follows.
    const t09src = trampleFrame(seed, p09);
    const t09 = { height: t09src.height, lean: t09src.lean, ax: t09src.ax, az: t09src.az, tint: { ...t09src.tint } };
    const t3 = trampleFrame(seed, p3);
    // trampleAt is deterministic and pure, so feeding it the SAME measured
    // trail distance the implementation itself reads (rather than the
    // literal 0.9 the point was constructed from, which the graph's
    // sqrt/hypot chain can only approximate to within a few ULPs) is what
    // makes an exact `toEqual` on the tint meaningful.
    const want = trampleAt(rt09);
    expect(t09.height).toBeCloseTo(want.height, 6);
    expect(t09.lean).toBeCloseTo(want.lean, 6);
    expect(t09.tint).toEqual(want.tint);
    // The away direction points from the bed toward the card.
    expect(t09.ax * nx + t09.az * nz).toBeGreaterThan(0.99);
    expect(t3).toEqual({ height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } });
  });

  it("leans the trampled card's top along the away direction, not into the bed", () => {
    // Matrix-level, not gradient-level: builds the exact matrix the rebuild
    // writes (via the production `instanceMatrixFor`) and transforms the
    // card's local top by it, so a wrong-signed lean axis shows up as the
    // top landing on the wrong side rather than merely as a sign the
    // gradient math happened to cancel out.
    const white = { r: 1, g: 1, b: 1 };
    const inst = { cls: CLUTTER_GRASS, x: 0, z: 0, groundH: 0, groundDx: 0, groundDz: 0, scale: 1, variant: 0, hash: 0 };
    const buf = new Float32Array(16);
    const top = new Vector3(0, 1, 0);

    // height 0.55 scales the local top before the lean rotates it, so its
    // horizontal excursion is height·sin(lean) ≈ 0.1886, not sin(lean) —
    // a shorter, more-trampled blade's tip travels less far sideways for
    // the same lean angle. cos(lean) then loses the same height factor
    // before the -CLUTTER_SINK sink is added by the translation.
    instanceMatrixFor(inst, { height: 0.55, lean: 0.35, ax: 1, az: 0, tint: white }, buf);
    let world = Vector3.TransformCoordinates(top, Matrix.FromArray(buf));
    expect(world.x).toBeGreaterThan(0.15); // toward +x, the away direction — not the −0.19 a bed-ward lean would land
    expect(world.y).toBeGreaterThan(0.4);
    expect(world.y).toBeLessThan(0.6);

    instanceMatrixFor(inst, { height: 0.55, lean: 0.35, ax: 0, az: 1, tint: white }, buf);
    world = Vector3.TransformCoordinates(top, Matrix.FromArray(buf));
    expect(world.z).toBeGreaterThan(0.15);

    instanceMatrixFor(inst, { height: 1, lean: 0, ax: 0, az: 0, tint: white }, buf);
    world = Vector3.TransformCoordinates(top, Matrix.FromArray(buf));
    expect(world.x).toBeCloseTo(0, 6);
    expect(world.y).toBeCloseTo(1 - CLUTTER_SINK, 6);
    expect(world.z).toBeCloseTo(0, 6);
  });

  it("scales the litter variants to pebbles and a twig, on top of the sim's own scale", () => {
    expect(LITTER_VARIANT_SCALE).toEqual([1, 1, 0.3]);
    expect(CLUTTER_LITTER).toBe(8);
    // Built through the production instanceMatrixFor with the identity
    // frame (no lean, no trample) and flat ground (no tilt), so the matrix's
    // column length is exactly the instance's own final scale: rotation is
    // orthonormal, so it never changes a column's length, only its direction.
    const IDENTITY_FRAME = { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } };
    const colLen = (buf: Float32Array, col: number): number => Math.hypot(buf[col * 4]!, buf[col * 4 + 1]!, buf[col * 4 + 2]!);
    const base = { x: 0, z: 0, groundH: 0, groundDx: 0, groundDz: 0, scale: 0.5, hash: 0.2 };
    const buf = new Float32Array(16);
    instanceMatrixFor({ ...base, cls: CLUTTER_LITTER, variant: 2 }, IDENTITY_FRAME, buf);
    expect(colLen(buf, 0)).toBeCloseTo(0.5 * 0.3, 6);
    instanceMatrixFor({ ...base, cls: CLUTTER_LITTER, variant: 0 }, IDENTITY_FRAME, buf);
    expect(colLen(buf, 0)).toBeCloseTo(0.5, 6);
    // Only the litter class reads LITTER_VARIANT_SCALE: a grass instance
    // drawing the same variant index is untouched by the table.
    instanceMatrixFor({ ...base, cls: CLUTTER_GRASS, variant: 2 }, IDENTITY_FRAME, buf);
    expect(colLen(buf, 0)).toBeCloseTo(0.5, 6);
  });

  it("lists litter among the tilted classes: it seats onto sloped ground, unlike grass", () => {
    const IDENTITY_FRAME = { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } };
    const buf = new Float32Array(16);
    const sloped = { x: 0, z: 0, groundH: 0, groundDx: 0.6, groundDz: 0, scale: 0.4, hash: 0, variant: 0 };
    instanceMatrixFor({ ...sloped, cls: CLUTTER_LITTER }, IDENTITY_FRAME, buf);
    // Seated onto the slope, the Y column tips away from purely vertical.
    expect(Math.abs(buf[4]!) + Math.abs(buf[6]!)).toBeGreaterThan(0.01);
    instanceMatrixFor({ ...sloped, cls: CLUTTER_GRASS }, IDENTITY_FRAME, buf);
    // Grass never tilts: its Y column stays purely vertical (yaw only).
    expect(buf[4]).toBeCloseTo(0, 9);
    expect(buf[6]).toBeCloseTo(0, 9);
  });
});

describe("the cards beside the blade field", () => {
  function build(nearBlades: boolean): { scene: Scene; assets: Mesh[][][][]; clutter: ReturnType<typeof createClutterMeshes>; engine: NullEngine } {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const assets: Mesh[][][][] = [];
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      assets.push([0, 1].map((variant) => {
        const material = new PBRMaterial(`near-c${cls}v${variant}`, scene);
        material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
        return [0, 1].map((lod) => {
          const mesh = CreateBox(`near-c${cls}v${variant}l${lod}`, { size: 0.5 }, scene);
          mesh.material = material;
          return [mesh];
        });
      }));
    }
    const clutter = createClutterMeshes(scene, 1, { assets, nearBlades });
    return { scene, assets, clutter, engine };
  }
  function bufferFor(spy: { mock: { calls: unknown[][]; instances: unknown[] } }, mesh: Mesh, kind: string): Float32Array | null {
    for (let k = spy.mock.calls.length - 1; k >= 0; k--) {
      const call = spy.mock.calls[k]!;
      if (spy.mock.instances[k] === mesh && call[0] === kind) return call[1] as Float32Array;
    }
    return null;
  }

  // The blade field may only ADD cover to the near field, never take it away.
  // It grows on the GRASS gate while the meadow's cards were placed by the
  // MEADOW gate, so a card is only redundant where the field actually covers
  // it — and the grass cards, which the field does not replace at all, have to
  // keep drawing the whole way in. Suppressing either on reach alone strips
  // the near field bare wherever the grass gate is under the field's floor,
  // which is most of the world: the player walks forward and the ground in
  // front of them empties out.
  it("only drops a near card where the blade field actually covers it", () => {
    // An open-field point where the meadow carpet is dense.
    for (const nearBlades of [true, false]) {
      const { assets, clutter, engine } = build(nearBlades);
      const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
      clutter.update(35, 21335);
      const meadowNear = assets[CLUTTER_MEADOW]![0]![0]![0]!;
      const meadowFar = assets[CLUTTER_MEADOW]![0]![1]![0]!;
      const grassNear = assets[CLUTTER_GRASS]![0]![0]![0]!;
      expect(meadowFar.thinInstanceCount).toBeGreaterThan(0);
      if (nearBlades) {
        // Every meadow near card still standing must sit on ground the field
        // does not cover; the field takes the rest.
        const buf = bufferFor(spy, meadowNear, "matrix")!;
        for (let i = 0; i < meadowNear.thinInstanceCount; i++) {
          const x = buf[i * 16 + 12] as number;
          const z = buf[i * 16 + 14] as number;
          expect(bladeFieldCovers(1, x, z)).toBe(false);
        }
      } else {
        expect(meadowNear.thinInstanceCount).toBeGreaterThan(0);
      }
      // The grass near cards draw all the way in either way: same fade, no
      // in-band cut-out that the blades would have to fill and often cannot.
      expect(grassNear.thinInstanceCount).toBeGreaterThan(0);
      const grassSeam = clutterSeamEdges(CLUTTER_GRASS);
      const want = [-2, -1, grassSeam.start, grassSeam.end].map(Math.fround);
      expect(Array.from(bufferFor(spy, grassNear, "fadeBands")!.subarray(0, 4))).toEqual(want);
      spy.mockRestore();
      clutter.dispose();
      engine.dispose();
    }
  });


  it("has no blade bucket of its own any more", () => {
    const { scene, clutter, engine } = build(true);
    clutter.update(35, 21335);
    expect(scene.meshes.some((m) => m.name.includes("clutter_blades"))).toBe(false);
    clutter.dispose();
    engine.dispose();
  });
});
