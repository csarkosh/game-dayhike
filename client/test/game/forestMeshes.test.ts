import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
// A value import, not a type-only one: the fadeBands tests spy on
// `Mesh.prototype.thinInstanceSetBuffer` (the clutterMeshes.test.ts idiom) —
// the impostor planes this file asserts about are built inside
// `createForestMeshes`, so there is no instance to spy on beforehand.
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
// Type augmentation for `thinInstanceCount` etc.; forestMeshes.ts carries the
// load-bearing side-effect import for runtime.
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
// Olympic is the active variant these coordinates were probed against: the
// forest camera below stands in real forest, the ocean camera over open water.
import "../../src/sim/olympic.js";
import {
  setActiveTerrainVariant,
  registerTerrainVariant,
  terrainVariantNames,
  elevationAt,
  elevationSampleAt,
} from "../../src/sim/terrain.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { TargetCamera } from "@babylonjs/core/Cameras/targetCamera.js";
import {
  collectBands,
  NEAR_RADIUS,
  SEAM_FAR,
  SEAM_FILL,
  SEAM_LOD0,
  SEAM_LOD1,
  seamNear,
  UNDERSTORY_RADIUS,
} from "../../src/game/forestField.js";
import {
  COHORT_GIANT,
  COHORT_LOG,
  COHORT_SNAG,
  forestDensity,
  TREE_CELL,
  type TreeInstance,
} from "../../src/sim/vegetation.js";
import { DistanceFadePlugin, fadeBands, fadeVisibility } from "../../src/game/distanceFadePlugin.js";
import { attachFoliage, FOLIAGE_PROFILES, FoliagePlugin } from "../../src/game/foliagePlugin.js";
import {
  createForestMeshes,
  defaultBakeImpostor,
  IMPOSTOR_BAKE_FAIL_MS,
  IMPOSTOR_BAKE_WARN_MS,
  type BakeOptions,
  type BarkTextureLoader,
  type SpeciesMeshes,
} from "../../src/game/forestMeshes.js";
import { textureUrl } from "../../src/game/assetUrls.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { LOG_SINK } from "../../src/game/logSeat.js";
import { macroNoise, macroTint } from "../../src/game/groundHexParams.js";
import { whenSkyHeld } from "../../src/game/lighting.js";
import { createSkyTable } from "../../src/game/skyTable.js";
import { skyFixture } from "./helpers/skyFixture.js";
import { surfaceAlbedo } from "../../src/game/terrainSurface.js";
import { wetCapOf } from "../../src/game/wetPlugin.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant("olympic");

/**
 * A test-only variant with a genuinely, exactly sloping ground plane —
 * h = SLOPE_BASE_H + SLOPE_GRADE·x, so `elevationAt` at any two points gives
 * an exact, hand-computable answer, unlike Olympic's fbm-curved terrain
 * (real, but its curvature over an ~8 m log makes a tight tolerance flaky).
 * `dx`/`dz` are exact too, so forestDensity's `grade` term sees a real,
 * moderate slope rather than an inconsistent one.
 * Registered once at module load, guarded so a test re-run (watch mode)
 * doesn't hit `registerTerrainVariant`'s duplicate-name throw.
 */
const SLOPE_VARIANT = "test_linear_slope";
const SLOPE_GRADE = 0.15;
const SLOPE_BASE_H = 60;
if (!terrainVariantNames().includes(SLOPE_VARIANT)) {
  registerTerrainVariant({
    name: SLOPE_VARIANT,
    tunables: { SLOPE_GRADE, SLOPE_BASE_H },
    sample: (_seed, x) => ({ h: SLOPE_BASE_H + SLOPE_GRADE * x, dx: SLOPE_GRADE, dz: 0 }),
  });
}

const SEED = 0x5eed;
/** Stands in forest: `forestField.test.ts` proves collectBands(SEED, 1, 1)
 * fills near/understory/impostors, and (probed directly for this file)
 * ALSO fills saplings (79) and deadwood (57) — every bucket the forest can
 * draw is non-empty here, which is what the draw-call budget test needs. */
const FOREST_CAM = { x: 1, z: 1 };
/** Same tree cell as FOREST_CAM (TREE_CELL = 10), different camera point. */
const SAME_CELL_CAM = { x: 5, z: 5 };
/** Open water: collectBands yields empty bands here. */
const OCEAN_CAM = { x: -6000, z: 0 };

/** Two box siblings (bark + canopy), the second parented under the first, so
 * `geometryMeshes` (forestMeshes.ts) gathers both — this mirrors how
 * Babylon's glTF loader ACTUALLY materialises a multi-primitive mesh: as
 * separate sibling `Mesh` objects (one `SubMesh` each), never as one mesh
 * with two submeshes. A stub that emitted a single box per LOD (as this file
 * used to) undercounts every real giant/sapling bucket by half a draw call's
 * worth of meshes, which is why the budget test below used to measure far
 * fewer draw calls than production actually issues. */
function pairedBoxes(prefix: string, scene: Scene): Mesh {
  const bark = MeshBuilder.CreateBox(`${prefix}_bark`, { size: 1 }, scene);
  const canopy = MeshBuilder.CreateBox(`${prefix}_canopy`, { size: 1 }, scene);
  canopy.parent = bark;
  // Both siblings carry a material, as every production GLB does: the plugin
  // attaches (`attachGroundConform`, `attachDistanceFade`) are all gated on
  // `if (mesh.material)`, so a null-material LOD stub would let a missing
  // attach pass unnoticed — the reason `stubAssets`' understory box has always
  // had one. Canopy is alpha-tested (a real canopy card discards), bark is
  // left OPAQUE (a real bark mesh does not) — only the alpha-tested sibling
  // should pick up `attachDistanceFade`'s plugin.
  for (const mesh of [bark, canopy]) mesh.material = new PBRMaterial(`${mesh.name}_mat`, scene);
  canopy.material!.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
  return bark;
}

/** The seven-GLB stub-asset factory: two giant species (lods + understory),
 * two sapling species (a full LOD ladder each, like the giants), and one
 * deadwood mesh (standing in for `deadwood.snag`'s LOD2) — the NullEngine
 * escape hatch for all four cohorts. Giant and sapling LODs are bark+canopy
 * sibling pairs (see `pairedBoxes`); understory and deadwood are genuinely
 * single-material in production (one material each in the shipped files), so
 * they stay single boxes. */
function stubAssets(scene: Scene): {
  giants: SpeciesMeshes[];
  saplings: SpeciesMeshes[];
  deadwood: Mesh;
} {
  // Understory alone gets a real material (production GLBs always carry
  // one): `adoptSpecies` gates both `attachFoliage` and the plugin-composition
  // it protects against behind `if (mesh.material)`, so a null-material stub
  // would trivially "pass" a plugin-absence check without exercising the
  // path this design actually protects against. Alpha-tested, like every
  // real understory card — this is how `attachDistanceFade` gates on it.
  const box = (name: string): Mesh => {
    const mesh = MeshBuilder.CreateBox(name, { size: 1 }, scene);
    mesh.material = new PBRMaterial(`${name}_mat`, scene);
    mesh.material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    return mesh;
  };
  return {
    giants: [0, 1].map((s) => ({
      lods: [
        pairedBoxes(`s${s}_lod0`, scene),
        pairedBoxes(`s${s}_lod1`, scene),
        pairedBoxes(`s${s}_lod2`, scene),
      ] as [Mesh, Mesh, Mesh],
      understory: box(`s${s}_under`),
    })),
    saplings: [0, 1].map((s) => ({
      lods: [
        pairedBoxes(`sap${s}_lod0`, scene),
        pairedBoxes(`sap${s}_lod1`, scene),
        pairedBoxes(`sap${s}_lod2`, scene),
      ] as [Mesh, Mesh, Mesh],
    })),
    // Long and thin along local X — like the real `deadwood.snag` bbox
    // (4.048 × 1.050 × 1.049 m) — not a cube: a cube's lateral (Z) extent
    // would rival its half-length, which would swamp the log-pitch ground-
    // contact test below with lateral-offset error instead of exercising
    // the along-axis slope-following it exists to check. It carries a
    // material for the same reason every other stub does: `adoptBucket`'s
    // `attachDistanceFade` is gated on `if (mesh.material)`, so a
    // null-material deadwood stub would let a missing attach pass unnoticed.
    deadwood: (() => {
      const mesh = MeshBuilder.CreateBox("deadwood", { width: 8, height: 1, depth: 1 }, scene);
      mesh.material = new PBRMaterial("deadwood_mat", scene);
      return mesh;
    })(),
  };
}

/** The shape `vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer")` returns, as
 * far as `uploadedBuffer` needs it: parallel calls/instances arrays. */
type BufferSpy = { mock: { calls: unknown[][]; instances: unknown[] } };

describe("createForestMeshes under NullEngine", () => {
  const engines: NullEngine[] = [];
  // The harness's default bake is null (NullEngine render targets lie), and
  // a null bake now reports itself; kept out of the output here, and read
  // back by the tests about it.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    // Prototype-level spies (`uploadedBuffer`'s) MUST be torn down even when
    // the test that installed one failed first: `vi.spyOn` on an inherited
    // method returns the EXISTING spy if the prototype already carries one, so
    // a leaked spy silently turns a later test's per-instance spy into a
    // whole-scene one — which is how a leak shows up as "the giant bucket
    // uploaded the deadwood matrices".
    vi.restoreAllMocks();
    for (const e of engines.splice(0)) e.dispose();
  });

  function build(
    nearRadius?: number,
    // Same shape as `ForestMeshesOptions.bakeImpostor`: the bake options (the
    // forest's abort signal) third and the optional bake pose fourth — the
    // snag's billboard is baked from an upright clone. Defaults to a null
    // bake, which disables the bucket: NullEngine render targets lie, so no
    // test may rely on pixels.
    bakeImpostor: (
      mesh: Mesh,
      scene: Scene,
      options?: BakeOptions,
      pose?: Quaternion,
    ) => Texture | null | Promise<Texture | null> = () => null,
  ) {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    const assets = stubAssets(scene);
    const forest = createForestMeshes(scene, SEED, { assets, bakeImpostor, nearRadius });
    return { scene, assets, forest };
  }

  it("gives the nurse log's fern the cover's tint and contrast, on the plain material it wears there", () => {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    const fern = MeshBuilder.CreateBox("nurse_fern", { size: 1 }, scene);
    const loaded = new PBRMaterial("understory.fern.material0", scene);
    loaded.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    fern.material = loaded;
    const forest = createForestMeshes(scene, SEED, { assets: { ...stubAssets(scene), nurseFern: fern }, bakeImpostor: () => null });
    // The copy made for the log takes the texture and sets its own colour:
    // the understory fern's tint, (0.0851, 0.0841, 0.0252) / (0.0700,
    // 0.1035, 0.0165), none of it at the cap, at the nurse shade of 1. The
    // material as loaded is left white and never draws.
    const worn = fern.material as PBRMaterial;
    expect(worn).not.toBe(loaded);
    expect(worn.name).toBe("understory.fern.material0_nurse");
    expect(worn.albedoColor.r).toBeCloseTo(1.21571, 5);
    expect(worn.albedoColor.g).toBeCloseTo(0.81256, 5);
    expect(worn.albedoColor.b).toBeCloseTo(1.52727, 5);
    expect([loaded.albedoColor.r, loaded.albedoColor.g, loaded.albedoColor.b]).toEqual([1, 1, 1]);
    // The cards' contrast rides the foliage plugin, under the nurse profile
    // (no wind, no tint, no root darkening, the card's own normals), with
    // the sun's cut at the constant: the log's fern receives no cast shadow.
    const plugin = worn.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    expect(plugin).toBeInstanceOf(FoliagePlugin);
    expect(plugin.contrast).toBe(0.6);
    expect(plugin.canopySun).toBe(0.4);
    expect(loaded.pluginManager?.getPlugin("Foliage") ?? null).toBeNull();
    forest.dispose();
  });

  /** A 1×1 stand-in for a successful bake. */
  function stubBakeTexture(scene: Scene): Texture {
    return RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
  }

  function impostorPlanes(scene: Scene): Mesh[] {
    return scene.meshes.filter((m) => m.name.startsWith("forest_impostor")) as Mesh[];
  }

  /** Mirrors `forestMeshes.ts`'s internal (unexported) `ringOutBand`: a
   * ring's own out-band, clipped to the near seam when its fixed edge would
   * otherwise sit past `nearRadius` — the same clip "clips ring 1's out-band
   * to the near seam at a low nearRadius" (below) exercises on the fade
   * bands themselves. */
  const ringOutBand = (
    nearRadius: number,
    s: readonly [number, number],
  ): readonly [number, number] => (s[1] <= nearRadius ? s : seamNear(nearRadius));

  it("is ready only once every billboard bake has settled, baked or given up", async () => {
    const bakes: ((texture: Texture | null) => void)[] = [];
    const { forest } = build(undefined, () => new Promise<Texture | null>((resolve) => bakes.push(resolve)));
    let ready = false;
    void forest.ready.then(() => { ready = true; });
    await new Promise((r) => setTimeout(r, 20));
    // Three giant bucket sets (the pine wears two barks), two sapling
    // species and the snag: six billboards.
    expect(bakes.length).toBe(6);
    expect(ready).toBe(false);
    for (const settle of bakes.slice(0, 5)) settle(null);
    await new Promise((r) => setTimeout(r, 20));
    expect(ready).toBe(false);
    bakes[5]!(null);
    await new Promise((r) => setTimeout(r, 20));
    expect(ready).toBe(true);
  });

  it("stays inside the 40-draw-call vegetation budget", () => {
    const { scene, forest } = build();
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    // FOREST_CAM fills every bucket kind at once — near, understory,
    // saplings, deadwood AND impostors — so this measures the true maximum,
    // not a partial scene that happens to undercount.
    forest.update(FOREST_CAM.x, FOREST_CAM.z);

    // THE BUDGET, structurally: every bucket mesh the forest built and gave a
    // thin-instance buffer, whether or not that buffer holds instances at this
    // camera. This is the number no camera can exceed. A multi-primitive glTF
    // mesh (bark + canopy) loads as separate SIBLING `Mesh` objects, one
    // `SubMesh` each — never one mesh with two submeshes — so each pair is 2
    // draw calls: 3 giant bucket sets (the fir, the pine in each of its two
    // barks) × 3 LODs × 2 siblings (18) + 2 sapling
    // species × 3 LODs × 2 siblings (12) + 2 understory (2) + 6 impostor
    // planes, 3 giant sets + 2 saplings + 1 snag (6) + 1 deadwood bucket (1) = 39,
    // and the nurse logs' seedling (1) = 40. The stubs still carry the
    // one-a-tree understory the shipped forest has retired, and no nurse
    // fern: the shipped forest draws 18 + 12 + 6 + 1 + the nurse logs' fern
    // and seedling (2) = 39.
    // The budget was raised 30 → 32 at one point when saplings and snags
    // gained billboards: three planes, immaterial against the 250-call frame
    // ceiling; and 33 → 40 for the pine's second bark: its three LOD pairs
    // and its billboard.
    const bucketMeshes = new Set<Mesh>();
    for (let k = 0; k < spy.mock.calls.length; k++) {
      if (spy.mock.calls[k]![0] === "matrix") bucketMeshes.add(spy.mock.instances[k] as Mesh);
    }
    const inventory = [...bucketMeshes].reduce((n, m) => n + m.subMeshes.length, 0);
    expect(inventory).toBe(40);
    expect(inventory).toBeLessThanOrEqual(40);

    // AND what this camera actually reaches: buckets whose instance buffer is
    // non-empty. Note the filter is `thinInstanceCount > 0`, NOT "enabled" —
    // it counts the five impostor planes even though the default stub bake
    // returns null and leaves them disabled, so this is the count a
    // production frame (where the bake lands) would issue, not what this
    // NullEngine harness would draw. At this camera exactly one sapling
    // sibling pair is empty (probed via `collectBands(SEED, 1, 1)`: sapling
    // ring counts are [1, 0] / [2, 1] / [1, 2] by species, so only species-1's
    // LOD0 ring is), leaving 32 − 2 = 30. At one point this measured 27
    // before the three new billboard planes were added (+3), and seam
    // padding had already filled species-0's LOD2 sapling ring (+2 over the
    // 25 an earlier gate left). Had each fill list taken a plane of its own,
    // this camera would measure 35 and the inventory above would be 37 —
    // the two reasons both lists share one plane.
    const buckets = scene.meshes.filter((m) => (m as Mesh).thinInstanceCount > 0);
    const calls = buckets.reduce((n, m) => n + (m as Mesh).subMeshes.length, 0);
    // Re-anchored 2026-09-09 from 30: a later trail-graph change (anti-overlap
    // invariant, hard slope ceiling, fork half-chord cap) moved the trail
    // graph, which moves the carved ground and the trees rejected off it, and
    // at this camera one more sapling sibling pair comes up empty. The
    // INVENTORY above -- the number no camera can exceed -- is unchanged at 32.
    // Re-anchored again 2026-09-09 from 28: a later change stopped the trail
    // builder reading the wall's rim spline (it plans the ascent against a
    // nominal hillside grade, ending it at a fixed ASCENT_END_U instead),
    // which moves the graph and the carved ground under it again -- the
    // empty sapling sibling pair from the entry above fills back in.
    // Re-anchored again 2026-09-09 from 30: a chord predicate (every
    // candidate trail edge is checked against the pre-trail ground along its
    // chord, with ASCENT_LEG_DZ_MIN/ASCENT_MAX_LEGS re-tuned to keep clearing
    // it) moves the graph again, and at this camera one sapling sibling pair
    // comes up empty again. The INVENTORY above is unchanged at 32.
    // Re-anchored again 2026-09-09 from 28: the fallback ranking became a
    // true lexicographic (cap, gap, chord) comparison and ASCENT_LEG_DZ_MIN
    // moved again (100 -> 90) against a 219-seed walkability scan; at this
    // camera the sapling sibling pair that was empty is full again.
    // Re-anchored again 2026-09-09 from 30: TRAIL_CLEAR 3 -> 6 rejects trees
    // out to 2 m past the corridor's edge, the fork fan widened, and
    // ASCENT_LEG_DZ_MIN swept to 113; the same sapling sibling pair at this
    // camera comes up empty again. The INVENTORY above is unchanged at 32,
    // which is what this test is really guarding.
    // Re-anchored again 2026-09-09 from 28: a later change pulls
    // coastFrame's blendEnd out to APRON_BLEND_END inside the trail's
    // z-window and frees the cliff terraces off the ground there —
    // the terrain this camera sees, and the graph carved into it, both
    // change shape again, emptying more sapling sibling pairs at this
    // camera. The INVENTORY above is unchanged at 32.
    // Re-anchored 2026-10-04 from 22: a nurse log in reach, and its seedlings'
    // bucket with it. The INVENTORY above is 33.
    // Re-anchored 2026-10-14 from 23: the pine's instances at this camera
    // are split between its two barks, each bucket set with its own three
    // LOD pairs and billboard. The INVENTORY above is 40.
    expect(calls).toBe(30);
    expect(calls).toBeLessThanOrEqual(inventory);
  });

  it("draws snags and fallen logs from one bucket", () => {
    // Still ONE geometry bucket for both dead-tree roles inside the near
    // radius. Beyond it the SNAG half continues as a billboard on its own
    // plane (`forest_impostor_snag`, which carries no "deadwood" in its name);
    // a ~1 m log is sub-pixel out there and simply ends at the near seam.
    const { scene, forest } = build();
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    const deadwood = scene.meshes.filter((m) => m.name.includes("deadwood"));
    expect(deadwood.length).toBe(1);
    expect((deadwood[0] as Mesh).thinInstanceCount).toBeGreaterThan(0);
  });

  it("stands snags on their base — never half-buried", () => {
    const { assets, forest } = build();
    // The stub deadwood mesh is an 8×1×1 box (see `stubAssets`): its local
    // bounds are exactly [-4, 4] on X and [-0.5, 0.5] on Y/Z.
    const spy = vi.spyOn(assets.deadwood, "thinInstanceSetBuffer");
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    // thinInstanceSetBuffer(kind, data, stride, staticBuffer) — index 1 is
    // the buffer, index 0 the kind string. Filter by kind rather than taking
    // the last call: the deadwood bucket uploads a second per-instance buffer
    // ("fadeBands") after its matrices, so the last call is not the matrix one.
    const buf = spy.mock.calls.filter((c) => c[0] === "matrix").pop()![1] as Float32Array;

    // `createBandCollector` is output-identical to this pure function
    // (forestField.ts), and `rebuild()` passes `bands.deadwood` straight
    // into the buffer builder with no reordering, so index i here IS
    // instance i of the captured buffer.
    const bands = collectBands(SEED, FOREST_CAM.x, FOREST_CAM.z);
    expect(bands.deadwood.length).toBe(buf.length / 16);

    let checkedSnags = 0;
    for (let i = 0; i < bands.deadwood.length; i++) {
      const t = bands.deadwood[i]!;
      // Fallen logs are checked separately below (real terrain's curvature
      // over an ~8 m log makes a tight origin-only tolerance meaningless —
      // see "seats a fallen log's far end on the slope beneath it").
      if (t.cohort === COHORT_LOG) continue;
      checkedSnags++;

      const m = Matrix.FromArray(buf, i * 16);
      // Snags stand, but on sloped ground they stand on the ground's NORMAL,
      // so the base face is parallel to the hillside rather than to world XZ.
      // Checking the lowest corner would therefore measure the tilt, not the
      // seating. The base face centre is the point that must touch: local X
      // minimum (the rolled trunk's foot), centred in Y and Z.
      const foot = Vector3.TransformCoordinates(new Vector3(-4, 0, 0), m);
      expect(Math.abs(foot.y - elevationAt(SEED, foot.x, foot.z))).toBeLessThan(0.05);
    }
    expect(checkedSnags).toBeGreaterThan(0);
  });

  it("seats a fallen log's far end on the slope beneath it, not just its origin", () => {
    // This is the test that would have caught the original bug: the old
    // ground-contact check above only ever sampled terrain at the instance
    // ORIGIN's x/z (`t.groundH`), which is enough for a narrow vertical
    // snag but not for an ~8 m horizontal log, whose far end can be well
    // off the origin's height on a slope. `SLOPE_VARIANT` gives an exact,
    // hand-computable slope so the assertion tolerance can stay tight
    // without real terrain's fbm curvature making it flaky.
    setActiveTerrainVariant(SLOPE_VARIANT);
    try {
      const { assets, forest } = build();
      const spy = vi.spyOn(assets.deadwood, "thinInstanceSetBuffer");
      forest.update(FOREST_CAM.x, FOREST_CAM.z);
      expect(spy.mock.calls.length).toBeGreaterThan(0);
      // By kind, not the last call — "fadeBands" follows the matrices.
      const buf = spy.mock.calls.filter((c) => c[0] === "matrix").pop()![1] as Float32Array;

      const bands = collectBands(SEED, FOREST_CAM.x, FOREST_CAM.z);
      expect(bands.deadwood.length).toBe(buf.length / 16);
      // The genuinely sloping terrain this test exists for.
      expect(bands.deadwood.some((t) => t.cohort === COHORT_LOG)).toBe(true);

      // The stub box's local X (-4..4) is the trunk's long axis (the
      // production asset's convention — see `deadwoodMatrixBuffer`); its
      // local Y minimum (-0.5) is the trunk's underside. For each LOG
      // instance, both ends of that underside line must lie the log's sink
      // (LOG_SINK of the box's 1 m diameter, at the instance's scale) under
      // the terrain sampled AT THEIR OWN world x/z — not at the instance
      // origin's x/z: a fallen log has settled into the floor (logSeat.ts).
      let checkedLogs = 0;
      for (let i = 0; i < bands.deadwood.length; i++) {
        const t = bands.deadwood[i]!;
        if (t.cohort !== COHORT_LOG) continue;
        checkedLogs++;

        const m = Matrix.FromArray(buf, i * 16);
        for (const endX of [-4, 4]) {
          const world = Vector3.TransformCoordinates(new Vector3(endX, -0.5, 0), m);
          const ground = elevationAt(SEED, world.x, world.z);
          // Well above float32 rounding, and well below both the ~0.18-1.05
          // m the live-engine bug measured and the ~1.26 m this harness's
          // own pre-fix placement (t.groundH + baseOffset*scale, no pitch)
          // measures at this same camera and slope.
          // Within 2 cm a unit of scale: a log is 2.2 to 4.25 of them.
          expect(Math.abs(world.y - (ground - LOG_SINK * t.scale))).toBeLessThan(0.02 * t.scale);
        }
      }
      expect(checkedLogs).toBeGreaterThan(0);
    } finally {
      // Global registry state (see terrain.test.ts's afterEach): every
      // other test in this file expects "olympic" active.
      setActiveTerrainVariant("olympic");
    }
  });

  it("fills near, understory, sapling and impostor buckets at a forest camera", () => {
    const { scene, assets, forest } = build();
    forest.update(FOREST_CAM.x, FOREST_CAM.z);

    const nearCount = forest.casterMeshes.reduce((sum, m) => sum + m.thinInstanceCount, 0);
    expect(nearCount).toBeGreaterThan(0);

    const underCount = assets.giants.reduce(
      (sum, a) => sum + (a.understory?.thinInstanceCount ?? 0),
      0,
    );
    expect(underCount).toBeGreaterThan(0);

    // Six billboards: one per giant bucket set (the pine's two barks), one
    // per sapling species, one for the snag cohort — see `impostorPlanes`.
    const impostors = scene.meshes.filter((m) => m.name.startsWith("forest_impostor"));
    expect(impostors.length).toBe(6);
    expect(impostors.reduce((sum, m) => sum + (m as Mesh).thinInstanceCount, 0)).toBeGreaterThan(0);

    const sapCount = assets.saplings.reduce(
      (sum, a) => sum + a.lods.reduce((s2, m) => s2 + m.thinInstanceCount, 0),
      0,
    );
    expect(sapCount).toBeGreaterThan(0);
  });

  // This test builds its own forest and calls `forest.update` itself, so it
  // does not have to share FOREST_CAM with the ~30 other assertions in this
  // file — a test-local camera is enough. FOREST_CAM = (1, 1) sits inside the
  // apron's z-window (|z| < APRON_Z_HALF = 700) and, once the coast blend
  // widened there, stopped holding meaningful sapling cover ([0, 10, 69]
  // collapsed to [0, 0, 1] for both species). LOD_CAM sits at the SAME x,
  // well outside the window (|z| = 1400 > 700, matching where
  // groundGradient.test.ts's own censuses probe) so later coastal-blend
  // changes cannot move it out from under this test again. This is the only
  // guard on the shipped LOD0-only sapling fix, so it is restored rather than
  // left skipped.
  it("distributes saplings across LOD rings — regeneration is no longer LOD0-only", () => {
    // Regression test for the production framerate fix: with a
    // single LOD0 bucket, every sapling inside NEAR_RADIUS rendered at full
    // 2,171/2,163-triangle detail. At LOD_CAM, measured counts are [14, 45,
    // 74] (LOD0/1/2) — rings 1+2 (119) comfortably outnumber ring 0 (14),
    // which is what the old, single-bucket behaviour could never produce.
    const LOD_CAM = { x: FOREST_CAM.x, z: -1400 };
    const { assets, forest } = build();
    forest.update(LOD_CAM.x, LOD_CAM.z);
    const countAt = (lod: number) =>
      assets.saplings.reduce((sum, a) => sum + (a.lods[lod] as Mesh).thinInstanceCount, 0);
    expect(countAt(1)).toBeGreaterThan(0);
    expect(countAt(2)).toBeGreaterThan(0);
    // The old behaviour put every sapling in LOD0; rings 1+2 outnumbering
    // LOD0 pins that the split actually routes by distance.
    expect(countAt(1) + countAt(2)).toBeGreaterThan(countAt(0));
  });

  it("does not rebuild when the bands origin has not moved", () => {
    const { assets, forest } = build();
    const bucket = assets.giants[0]?.lods[0] as Mesh;
    const spy = vi.spyOn(bucket, "thinInstanceSetBuffer");
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    const calls = spy.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    // Same tree cell, different camera point: origin unchanged, no rebuild.
    forest.update(SAME_CELL_CAM.x, SAME_CELL_CAM.z);
    expect(spy.mock.calls.length).toBe(calls);
    // Crossing to a different cell rebuilds again.
    forest.update(FOREST_CAM.x + 200, FOREST_CAM.z);
    expect(spy.mock.calls.length).toBeGreaterThan(calls);
  });

  it("zeroes every bucket at an ocean camera", () => {
    const { scene, forest } = build();
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    forest.update(OCEAN_CAM.x, OCEAN_CAM.z);
    for (const mesh of scene.meshes) {
      expect((mesh as Mesh).thinInstanceCount).toBe(0);
      // A zero-count bucket must be disabled: with no thin instances Babylon
      // would fall back to drawing the bare bucket mesh at the origin.
      expect(mesh.isEnabled()).toBe(false);
    }
  });

  it("exposes exactly the giants' LOD0 bucket as shadow casters", () => {
    // LOD1 was dropped from the caster set at one point (measured ~2 ms of
    // cascade re-render, and its shadows read as unreadable in closed-canopy
    // interiors), so only LOD0 remains — see the comment at
    // `casterMeshes.push` in `adoptSpecies`.
    const { scene, assets, forest } = build();
    const expected = new Set<Mesh>();
    for (const species of assets.giants) {
      // Each LOD stub is a bark+canopy sibling pair (`pairedBoxes`); the
      // production bucket — and so `casterMeshes` — is BOTH siblings, not
      // just the bark root the stub asset handle points at.
      const lodRoot = species.lods[0];
      expected.add(lodRoot);
      for (const child of lodRoot.getChildMeshes(false)) expected.add(child as Mesh);
    }
    // And the pine's second bark's LOD0 pair, cloned from its first.
    for (const name of ["s1_lod0_bark_cedar", "s1_lod0_bark_cedar.s1_lod0_canopy"]) {
      const clone = scene.getMeshByName(name) as Mesh | null;
      expect(clone, name).not.toBeNull();
      expected.add(clone!);
    }
    expect(expected.size).toBe(6);
    expect(new Set(forest.casterMeshes)).toEqual(expected);
  });

  it("lists the giants' and the saplings' LOD1 and LOD2 buckets and the six billboards for the lake's reflections, and empties them on dispose", () => {
    const { scene, assets, forest } = build();
    const bucketsAt = (lod: number): Set<Mesh> => {
      const expected = new Set<Mesh>();
      for (const species of [...assets.giants, ...assets.saplings]) {
        // Both siblings of each bark+canopy pair, as for the casters.
        const lodRoot = species.lods[lod]!;
        expected.add(lodRoot);
        for (const child of lodRoot.getChildMeshes(false)) expected.add(child as Mesh);
      }
      // And the pine's second bark's pair, cloned from its first.
      for (const name of [`s1_lod${lod}_bark_cedar`, `s1_lod${lod}_bark_cedar.s1_lod${lod}_canopy`]) {
        expected.add(scene.getMeshByName(name) as Mesh);
      }
      return expected;
    };
    expect(new Set(forest.lod2Meshes)).toEqual(bucketsAt(2));
    expect(forest.lod2Meshes).toHaveLength(10);
    expect(forest.impostorMeshes.map((m) => m.name)).toEqual([
      "forest_impostor_giant_0",
      "forest_impostor_giant_1",
      "forest_impostor_giant_2",
      "forest_impostor_sapling_0",
      "forest_impostor_sapling_1",
      "forest_impostor_snag",
    ]);
    forest.dispose();
    expect([forest.lod2Meshes.length, forest.impostorMeshes.length]).toEqual([0, 0]);
  });

  it("honours a reduced nearRadius: the LOD2 ring shrinks, LOD0/1 do not", () => {
    // LOD_RING_1/NEAR_RADIUS tightened to 85/120 at one point (was 120/200),
    // so the old "low" value
    // 140 now sits ABOVE the new default and would widen rather than shrink
    // the LOD2 annulus. 100 sits between the new LOD_RING_1 (85, so LOD0/1
    // stay at full width) and NEAR_RADIUS (120, so LOD2 genuinely shrinks) —
    // the same relative shape the original 140/200/120 triple had.
    const low = build(100);
    low.forest.update(FOREST_CAM.x, FOREST_CAM.z);
    const full = build();
    full.forest.update(FOREST_CAM.x, FOREST_CAM.z);
    const countAt = (giants: SpeciesMeshes[], lod: number) =>
      giants.reduce((sum, a) => sum + (a.lods[lod] as Mesh).thinInstanceCount, 0);
    // The inner rings (42/85 m) are inside both radii — identical counts —
    // while the LOD2 annulus shrinks from 85..120 to 85..100.
    expect(countAt(low.assets.giants, 0)).toBe(countAt(full.assets.giants, 0));
    expect(countAt(low.assets.giants, 1)).toBe(countAt(full.assets.giants, 1));
    expect(countAt(low.assets.giants, 2)).toBeGreaterThan(0);
    expect(countAt(low.assets.giants, 2)).toBeLessThan(countAt(full.assets.giants, 2));
  });

  it("a null bake leaves the impostor buckets disabled — no grey quads", () => {
    const { scene, forest } = build(); // default bake stub returns null
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    const planes = impostorPlanes(scene);
    expect(planes.length).toBe(6);
    for (const plane of planes) {
      // The buffer is still built (counts stay observable) but the bucket
      // must never draw: untextured alpha-test material = opaque grey quads.
      expect(plane.isEnabled()).toBe(false);
    }
    expect(planes.reduce((sum, m) => sum + m.thinInstanceCount, 0)).toBeGreaterThan(0);
  });

  it("a synchronous bake texture enables the impostor buckets", () => {
    const { scene, forest } = build(undefined, (_mesh, s) => stubBakeTexture(s));
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    const planes = impostorPlanes(scene);
    expect(planes.length).toBe(6);
    for (const plane of planes) {
      expect(plane.thinInstanceCount).toBeGreaterThan(0);
      expect(plane.isEnabled()).toBe(true);
      expect((plane.material as PBRMaterial).albedoTexture).not.toBeNull();
    }
  });

  it("an async bake enables the buckets when it lands, without another update", async () => {
    const { scene, forest } = build(undefined, (_mesh, s) => Promise.resolve(stubBakeTexture(s)));
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    const planes = impostorPlanes(scene);
    // Bake still pending: instances buffered, nothing drawn.
    for (const plane of planes) expect(plane.isEnabled()).toBe(false);
    await Promise.resolve(); // let the bake promise settle
    for (const plane of planes) {
      expect(plane.thinInstanceCount).toBeGreaterThan(0);
      expect(plane.isEnabled()).toBe(true);
    }
  });

  it("an async null bake (or a failed one) leaves the buckets disabled", async () => {
    const rejected = build(undefined, () => Promise.reject(new Error("shader died")));
    rejected.forest.update(FOREST_CAM.x, FOREST_CAM.z);
    const resolvedNull = build(undefined, () => Promise.resolve(null));
    resolvedNull.forest.update(FOREST_CAM.x, FOREST_CAM.z);
    await Promise.resolve();
    await Promise.resolve(); // rejection handler hops one extra microtask
    for (const { scene } of [rejected, resolvedNull]) {
      for (const plane of impostorPlanes(scene)) expect(plane.isEnabled()).toBe(false);
    }
  });

  it("never lets a bake drop the far forest without a word: a null bake names its billboard, and is recorded", () => {
    const errors = vi.mocked(console.error);
    errors.mockClear();
    let call = 0;
    // The first bake is the first giant species' (giant_0); it alone fails.
    const { scene, forest } = build(undefined, (_mesh, s) => (call++ === 0 ? null : stubBakeTexture(s)));
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual(["forest impostor: no bake for forest_impostor_giant_0"]);
    expect(forest.impostorBakes().map((b) => [b.name, b.state])).toEqual([
      ["forest_impostor_giant_0", "failed"],
      ["forest_impostor_giant_1", "ready"],
      ["forest_impostor_giant_2", "ready"],
      ["forest_impostor_sapling_0", "ready"],
      ["forest_impostor_sapling_1", "ready"],
      ["forest_impostor_snag", "ready"],
    ]);
    const planes = impostorPlanes(scene);
    expect(planes.find((p) => p.name === "forest_impostor_giant_0")!.isEnabled()).toBe(false);
    expect(planes.find((p) => p.name === "forest_impostor_giant_1")!.isEnabled()).toBe(true);
  });

  it("lands a slow bake whenever it comes, and records it as baking until then", async () => {
    const errors = vi.mocked(console.error);
    errors.mockClear();
    let land: (() => void) | null = null;
    const { scene, forest } = build(undefined, (_mesh, s) =>
      new Promise<Texture | null>((resolve) => {
        const previous = land;
        land = () => {
          previous?.();
          resolve(stubBakeTexture(s));
        };
      }),
    );
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    expect(forest.impostorBakes().map((b) => b.state)).toEqual(["baking", "baking", "baking", "baking", "baking", "baking"]);
    for (const plane of impostorPlanes(scene)) expect(plane.isEnabled()).toBe(false);
    land!();
    await Promise.resolve();
    expect(forest.impostorBakes().map((b) => b.state)).toEqual(["ready", "ready", "ready", "ready", "ready", "ready"]);
    for (const plane of impostorPlanes(scene)) expect(plane.isEnabled()).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  });

  it("aborts a bake still pending when the forest is disposed, and says nothing of it", async () => {
    const errors = vi.mocked(console.error);
    errors.mockClear();
    const signals: (AbortSignal | undefined)[] = [];
    const resolvers: ((t: Texture | null) => void)[] = [];
    const { forest } = build(undefined, (_mesh, _s, options) => {
      signals.push(options?.signal);
      return new Promise<Texture | null>((resolve) => resolvers.push(resolve));
    });
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    expect(signals.length).toBe(6);
    expect(signals.every((sg) => sg !== undefined && !sg.aborted)).toBe(true);
    forest.dispose();
    expect(signals.every((sg) => sg!.aborted)).toBe(true);
    for (const resolve of resolvers) resolve(null);
    await Promise.resolve();
    expect(errors).not.toHaveBeenCalled();
  });

  it("hands every bake the pipelines it was given, so a bake on WebGPU keeps only a render that left nothing out", () => {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    const pipelines = {
      takeSkipped: () => 0,
      guarded: (render: () => void): boolean => {
        render();
        return true;
      },
    };
    const given: unknown[] = [];
    const forest = createForestMeshes(scene, SEED, {
      assets: stubAssets(scene),
      pipelines,
      bakeImpostor: (_mesh, _s, options) => {
        given.push(options?.pipelines);
        return null;
      },
    });
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    expect(given.length).toBe(6);
    expect(given.every((p) => p === pipelines)).toBe(true);
    forest.dispose();
  });

  it("hands every bake the renderer's sky, so none bakes under Babylon's default lights", () => {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    const sky = new Promise<void>(() => undefined);
    const given: unknown[] = [];
    const forest = createForestMeshes(scene, SEED, {
      assets: stubAssets(scene),
      sky,
      bakeImpostor: (_mesh, _s, options) => {
        given.push(options?.sky);
        return null;
      },
    });
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    expect(given.length).toBe(6);
    expect(given.every((held) => held === sky)).toBe(true);
    forest.dispose();
  });

  it("dispose leaves the scene meshless and is idempotent", () => {
    const { scene, forest } = build();
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    forest.dispose();
    expect(scene.meshes.length).toBe(0);
    expect(() => forest.dispose()).not.toThrow();
    expect(scene.meshes.length).toBe(0);
  });

  /** What a bucket actually uploaded, by kind. Babylon has no
   * `thinInstanceGetBuffer`, so this pairs `spy.mock.calls[k]` with
   * `spy.mock.instances[k]` (the `this` Babylon bound call k to) — the
   * `clutterMeshes.test.ts` idiom, needed here because the impostor planes are
   * built inside `createForestMeshes` and cannot be spied on individually.
   * One `update` is one rebuild, so each mesh appears once per kind. */
  function uploadedBuffer(spy: BufferSpy, mesh: Mesh, kind: string): Float32Array | null {
    for (let k = 0; k < spy.mock.calls.length; k++) {
      const call = spy.mock.calls[k] as unknown[];
      if (spy.mock.instances[k] === mesh && call[0] === kind) return call[1] as Float32Array;
    }
    return null;
  }

  it("attaches the distance fade to every alpha-tested bucket material, impostors included, and skips opaque ones except forced deadwood", () => {
    const { scene, forest } = build();
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    // Every stub bucket carries a material (`pairedBoxes`, `stubAssets`) and so
    // does every impostor plane `createForestMeshes` built, so this sweeps the
    // whole scene rather than naming the buckets one at a time — a bucket kind
    // added later cannot quietly skip the attach.
    // `attachDistanceFade` only attaches where `needAlphaTesting()` is true
    // (bark stays opaque, canopy/understory/impostors alpha-test), except
    // `deadwood`, forced in `forestMeshes.ts`'s `adoptBucket`.
    const withMaterial = scene.meshes.filter((m) => m.material !== null);
    expect(withMaterial.length).toBeGreaterThan(0);
    expect(withMaterial.some((m) => m.name.startsWith("forest_impostor_"))).toBe(true);
    let sawAlphaTested = false;
    let sawOpaqueSkipped = false;
    for (const mesh of withMaterial) {
      const mat = mesh.material!;
      const plugin = mat.pluginManager?.getPlugin("DistanceFade");
      if (mesh.name === "deadwood" || mesh.name === "nurse_seedling") {
        // Forced: the logs, and the seedling that ends with them.
        expect(mat.needAlphaTesting(), mesh.name).toBe(false);
        expect(plugin, mesh.name).toBeInstanceOf(DistanceFadePlugin);
      } else if (mat.needAlphaTesting()) {
        sawAlphaTested = true;
        expect(plugin, mesh.name).toBeInstanceOf(DistanceFadePlugin);
      } else {
        sawOpaqueSkipped = true;
        expect(plugin, mesh.name).toBeNull();
      }
    }
    expect(sawAlphaTested).toBe(true);
    expect(sawOpaqueSkipped).toBe(true);
  });

  it("caps the weather's wetting by what alpha-tests: crown cards, understory and impostors as leaf, opaque bark as bark, deadwood as deadwood", () => {
    const { scene, forest } = build();
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    // The choice reads `needAlphaTesting()` on the stub pair (`pairedBoxes`:
    // canopy MASK, bark opaque), the modes the shipped tree files carry. A
    // crown shipped as BLEND or a bark shipped as MASK would take the other
    // cap, which only a look at the shipped files can catch.
    const withMaterial = scene.meshes.filter((m) => m.material !== null);
    let barks = 0;
    let leaves = 0;
    for (const mesh of withMaterial) {
      const mat = mesh.material!;
      const cap = wetCapOf(mat);
      if (mesh.name === "deadwood") {
        expect(cap, mesh.name).toBe(1);
      } else if (mesh.name === "nurse_seedling") {
        // Needles, though its material is opaque: a leaf's cap.
        expect(cap, mesh.name).toBe(0.3);
      } else if (mat.needAlphaTesting()) {
        leaves++;
        expect(cap, mesh.name).toBe(0.3);
      } else {
        barks++;
        expect(cap, mesh.name).toBe(1);
      }
    }
    expect(barks).toBeGreaterThan(0);
    expect(leaves).toBeGreaterThan(0);
    expect(withMaterial.filter((m) => m.name.startsWith("forest_impostor_")).map((m) => wetCapOf(m.material!))).toEqual([0.3, 0.3, 0.3, 0.3, 0.3, 0.3]);
  });

  it("gives bark, crown and billboard their share of the sky, and the specular weight to bark, billboards and crowns that ship none", () => {
    const { scene, forest } = build();
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    // Swept like the wet caps above, by what alpha-tests: the stub pair's
    // canopy is MASK, its bark opaque, as the shipped tree files are. Every
    // stub material starts at Babylon's defaults (a share of 1, a weight of 1),
    // as a material shipped without a specular weight does, so the crowns take
    // the bark's weight too.
    const withMaterial = scene.meshes.filter((m) => m.material !== null);
    let barks = 0;
    let crowns = 0;
    let billboards = 0;
    for (const mesh of withMaterial) {
      const mat = mesh.material as PBRMaterial;
      if (mesh.name.startsWith("forest_impostor_")) {
        billboards++;
        // The full share: the canopy's cut is in the baked colour.
        expect(mat.environmentIntensity, mesh.name).toBe(1);
        expect(mat.metallicF0Factor, mesh.name).toBe(0.04);
      } else if (mesh.name === "deadwood") {
        // The snag and the logs: bark.
        expect(mat.environmentIntensity, mesh.name).toBe(0.35);
        expect(mat.metallicF0Factor, mesh.name).toBe(0.04);
      } else if (mesh.name === "nurse_seedling" || mesh.name.endsWith("_under")) {
        // Not trees: left as they were. The understory takes the canopy's cut
        // of the sky per instance, in its foliage plugin's shader, so its
        // material keeps the full share or the cut would land twice.
        expect(mat.environmentIntensity, mesh.name).toBe(1);
      } else if (mat.needAlphaTesting()) {
        crowns++;
        expect(mat.environmentIntensity, mesh.name).toBe(0.6);
        expect(mat.metallicF0Factor, mesh.name).toBe(0.04);
      } else {
        barks++;
        expect(mat.environmentIntensity, mesh.name).toBe(0.35);
        expect(mat.metallicF0Factor, mesh.name).toBe(0.04);
      }
    }
    // Two giants and two saplings, three LODs each, one bark and one crown a
    // LOD, and the pine's second bark's three LODs again (its bark clone
    // shaded as a bark, its crown the shared one).
    expect(barks).toBe(15);
    expect(crowns).toBe(15);
    expect(billboards).toBe(6);
  });

  it("sets the trees' share before the bake clones them, so the billboards bake the trees as they stand near", () => {
    // What each bake's source hierarchy carries at the moment the bake is
    // kicked: `defaultBakeImpostor` clones those materials then (the clone
    // carrying the values is pinned in the readiness-gate describe).
    const seen: { name: string; sky: number; weight: number }[] = [];
    build(undefined, (mesh) => {
      for (const m of [mesh, ...(mesh.getChildMeshes(false) as Mesh[])]) {
        const mat = m.material as PBRMaterial;
        seen.push({ name: m.name, sky: mat.environmentIntensity, weight: mat.metallicF0Factor });
      }
      return null;
    });
    expect(seen).toEqual([
      { name: "s0_lod1_bark", sky: 0.35, weight: 0.04 },
      { name: "s0_lod1_canopy", sky: 0.6, weight: 0.04 },
      { name: "s1_lod1_bark", sky: 0.35, weight: 0.04 },
      { name: "s1_lod1_canopy", sky: 0.6, weight: 0.04 },
      // The pine's second bark, on clones of its LOD1 pair.
      { name: "s1_lod1_bark_cedar", sky: 0.35, weight: 0.04 },
      { name: "s1_lod1_bark_cedar.s1_lod1_canopy", sky: 0.6, weight: 0.04 },
      { name: "sap0_lod1_bark", sky: 0.35, weight: 0.04 },
      { name: "sap0_lod1_canopy", sky: 0.6, weight: 0.04 },
      { name: "sap1_lod1_bark", sky: 0.35, weight: 0.04 },
      { name: "sap1_lod1_canopy", sky: 0.6, weight: 0.04 },
      { name: "deadwood", sky: 0.35, weight: 0.04 },
    ]);
  });

  it("carries the trees' share onto LOD2's split material, which the lake's mirror draws, a crown's shipped weight kept", () => {
    // The shipped files share one material per primitive across the LODs
    // (see the split test below); LOD2's clone is made after the share is set.
    // The crown ships a weight, as the conifers' crowns do, so it keeps it.
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    const crown = new PBRMaterial("shared_crown", scene);
    crown.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    crown.metallicF0Factor = 0.02;
    const bark = new PBRMaterial("shared_bark", scene);
    const lod = (i: number): Mesh => {
      const b = MeshBuilder.CreateBox(`shared_lod${i}_bark`, { size: 1 }, scene);
      b.material = bark;
      const c = MeshBuilder.CreateBox(`shared_lod${i}_canopy`, { size: 1 }, scene);
      c.material = crown;
      c.parent = b;
      return b;
    };
    const lods = [lod(0), lod(1), lod(2)] as [Mesh, Mesh, Mesh];
    const deadwood = MeshBuilder.CreateBox("deadwood", { size: 1 }, scene);
    deadwood.material = new PBRMaterial("deadwood_mat", scene);
    const forest = createForestMeshes(scene, SEED, {
      assets: { giants: [{ lods }], saplings: [], deadwood },
      bakeImpostor: () => null,
    });
    const lod2 = forest.lod2Meshes.map((m) => m.material as PBRMaterial);
    expect(lod2.map((m) => m.name)).toEqual(["shared_bark_lod2", "shared_crown_lod2"]);
    expect(lod2.map((m) => m.environmentIntensity)).toEqual([0.35, 0.6]);
    expect(lod2.map((m) => m.metallicF0Factor)).toEqual([0.04, 0.02]);
    expect(crown.metallicF0Factor).toBe(0.02);
  });

  it("brings the alder's bark and crown, which ship no specular weight, to the bark's", async () => {
    // The shipped model through the glTF loader, as production loads it: its
    // bark (opaque) and its crown (MASK) carry no specular extension, so both
    // load at Babylon's weight of 1.
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    registerBuiltInLoaders();
    const bytes = readFileSync(new URL("../../assets/models/tree.alder.glb", import.meta.url));
    const container = await loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
    container.addAllToScene();
    const nodes = [...container.transformNodes, ...container.meshes];
    // `lodMeshes`' gathering: the LOD's geometry meshes under its first one.
    const lodRoot = (name: string): Mesh => {
      const root = nodes.find((n) => n.name === name);
      expect(root, name).toBeDefined();
      const meshes = root!.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
      for (const m of meshes) m.parent = null;
      for (const m of meshes.slice(1)) m.parent = meshes[0]!;
      return meshes[0]!;
    };
    const lods = [lodRoot("LOD0"), lodRoot("LOD1"), lodRoot("LOD2")] as [Mesh, Mesh, Mesh];
    const barkMat = container.materials.find((m) => m.name === "tree.alder.material1") as PBRMaterial;
    const crownMat = container.materials.find((m) => m.name === "tree.alder.material0") as PBRMaterial;
    expect(barkMat.needAlphaTesting()).toBe(false);
    expect(crownMat.needAlphaTesting()).toBe(true);
    expect(barkMat.metallicF0Factor).toBe(1);
    expect(crownMat.metallicF0Factor).toBe(1);

    const deadwood = MeshBuilder.CreateBox("deadwood", { size: 1 }, scene);
    deadwood.material = new PBRMaterial("deadwood_mat", scene);
    createForestMeshes(scene, SEED, {
      assets: { giants: [], saplings: [{ lods }], deadwood },
      bakeImpostor: () => null,
    });
    expect(barkMat.environmentIntensity).toBe(0.35);
    expect(barkMat.metallicF0Factor).toBe(0.04);
    expect(crownMat.environmentIntensity).toBe(0.6);
    expect(crownMat.metallicF0Factor).toBe(0.04);
  }, timeLimit(60000));

  it("attaches the foliage plugin to LOD0 and LOD1 of giants and saplings, never LOD2 or the impostor", () => {
    const { scene, assets } = build();
    // Each stub LOD root is a bark+canopy sibling pair (`pairedBoxes`); the
    // production bucket is every geometry-bearing mesh under the root, not
    // just the root the stub asset handle points at (the same expansion
    // "exposes exactly the giants' LOD0 bucket as shadow casters", above,
    // relies on).
    const bucketMeshes = (root: Mesh): Mesh[] => [root, ...(root.getChildMeshes(false) as Mesh[])];
    for (const species of [...assets.giants, ...assets.saplings]) {
      for (const lod of [0, 1] as const) {
        for (const mesh of bucketMeshes(species.lods[lod])) {
          expect(mesh.material!.pluginManager?.getPlugin("Foliage"), mesh.name).toBeTruthy();
        }
      }
      for (const mesh of bucketMeshes(species.lods[2])) {
        expect(mesh.material!.pluginManager?.getPlugin("Foliage") ?? null, mesh.name).toBeNull();
      }
    }
    // LOD0 sits entirely inside SEAM_LOD1 (it hands over to LOD1 at
    // SEAM_LOD0, well short of it), so the single plugin's edges — shared
    // with LOD1's material in the stub only coincidentally, but always in
    // production (see the shared-material test below) — is
    // `ringOutBand(SEAM_LOD1)`, the SAME clip its own bucket's fade band
    // uses, not the raw `SEAM_LOD1`: at the default tier ring 1's fixed edge
    // (85) is still inside `NEAR_RADIUS` (120), so the clip is a no-op and
    // this equals SEAM_LOD1 — the low-tier case below is where it bites.
    const lod1Root = assets.giants[0]!.lods[1];
    const plugin = lod1Root.material!.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    expect(plugin.edges).toEqual(ringOutBand(NEAR_RADIUS, SEAM_LOD1));
    for (const plane of impostorPlanes(scene)) {
      expect(plane.material!.pluginManager?.getPlugin("Foliage") ?? null).toBeNull();
    }
  });

  it("writes the ground colour and the sky's openness per understory instance", () => {
    const { assets, forest } = build();
    const under = assets.giants[0]!.understory!;
    const spy = vi.spyOn(under, "thinInstanceSetBuffer");
    forest.update(FOREST_CAM.x, FOREST_CAM.z);

    // Filter by kind rather than taking the last call: the understory bucket
    // pushes three per-instance buffers now (matrix, fadeBands, foliage).
    const matrices = spy.mock.calls.filter((c) => c[0] === "matrix").pop()![1] as Float32Array;
    const call = spy.mock.calls.filter((c) => c[0] === "foliage").pop();
    expect(call, "the understory bucket must upload a foliage buffer").toBeDefined();
    const foliage = call![1] as Float32Array;
    const count = matrices.length / 16;
    expect(count).toBeGreaterThan(0);
    // Four floats an instance, the stride clutterMeshes.ts uses.
    expect(call![2]).toBe(4);
    expect(foliage.length).toBe(4 * count);
    for (let i = 0; i < Math.min(count, 8); i++) {
      const x = matrices[i * 16 + 12] as number;
      const z = matrices[i * 16 + 14] as number;
      expect(foliage[i * 4 + 3]!).toBeCloseTo(1 - forestDensity(SEED, x, z), 5);
      // RGB is the palette colour for that spot, multiplied by the floor's
      // macro tint so a tuft and the ground under it agree.
      const sample = elevationSampleAt(SEED, x, z);
      const slope = Math.hypot(sample.dx, sample.dz);
      const canopy = forestDensity(SEED, x, z);
      const baseColor = surfaceAlbedo(SEED, x, z, sample.h, slope, canopy);
      const ny = 1 / Math.sqrt(1 + sample.dx * sample.dx + sample.dz * sample.dz);
      const tint = macroTint(macroNoise(x, z), 1 - ny);
      const expectedR = baseColor.r * tint.r;
      const expectedG = baseColor.g * tint.g;
      const expectedB = baseColor.b * tint.b;
      expect(foliage[i * 4]!).toBeCloseTo(expectedR, 5);
      expect(foliage[i * 4 + 1]!).toBeCloseTo(expectedG, 5);
      expect(foliage[i * 4 + 2]!).toBeCloseTo(expectedB, 5);
    }
  });

  it("binds a foliage buffer on every bucket whose foliage plugin declares the attribute", () => {
    // The architectural half of the same defect: a tinting profile makes the
    // shader READ the attribute, so any bucket that declares it must also fill
    // it — Babylon otherwise leaves it at the generic (0, 0, 0, 1) and the
    // fragment stage mixes the root toward black.
    const { scene, forest } = build();
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    forest.update(FOREST_CAM.x, FOREST_CAM.z);

    const uploaded = new Map<Mesh, Set<string>>();
    for (let k = 0; k < spy.mock.calls.length; k++) {
      const mesh = spy.mock.instances[k] as Mesh;
      let kinds = uploaded.get(mesh);
      if (kinds === undefined) {
        kinds = new Set<string>();
        uploaded.set(mesh, kinds);
      }
      kinds.add(spy.mock.calls[k]![0] as string);
    }

    let checked = 0;
    for (const [mesh, kinds] of uploaded) {
      const plugin = mesh.material?.pluginManager?.getPlugin("Foliage") as FoliagePlugin | undefined;
      if (!plugin) continue;
      // The plugin's own contract, not a guess at which profile tints: a
      // tinting profile is exactly one whose `getAttributes` asks for it.
      const attributes: string[] = [];
      plugin.getAttributes(attributes, scene, mesh);
      if (!attributes.includes("foliage")) continue;
      checked++;
      expect(kinds.has("foliage"), mesh.name).toBe(true);
      // The understory receives no cast shadows, so the canopy's cut of the
      // sun is the plugin's, at its constant.
      expect(mesh.receiveShadows, mesh.name).toBe(false);
      expect(plugin.canopySun, mesh.name).toBe(0.4);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("clips LOD1's sway to the near seam too, at a low nearRadius where its bucket's out-band clips", () => {
    // Same low tier as "clips ring 1's out-band to the near seam..." below:
    // SEAM_LOD1's fixed edge (85) sits past LOW_NEAR (70), so the bucket's
    // OWN out-band clips to seamNear(70) — the sway must clip with it, or
    // LOD1 would keep swaying at full amplitude past where its instances are
    // already dissolving into the impostor.
    const LOW_NEAR = 70;
    const { assets } = build(LOW_NEAR);
    const plugin = assets.giants[0]!.lods[1].material!.pluginManager!.getPlugin(
      "Foliage",
    ) as FoliagePlugin;
    expect(plugin.edges).toEqual(ringOutBand(LOW_NEAR, SEAM_LOD1));
    expect(plugin.edges).toEqual(seamNear(LOW_NEAR));
    expect(plugin.edges).not.toEqual(SEAM_LOD1);
  });

  it("splits LOD2 off a material it shares with LOD0/LOD1 before any plugin attaches, so it never inherits the sway", () => {
    // The shipped tree GLBs (verified directly, outside this suite) reuse ONE
    // material per primitive across every LOD root — unlike this file's
    // `pairedBoxes` stub, where each LOD gets its own fresh material. Mimic
    // that sharing here: three boxes, one material object underneath all of
    // them, exactly as a real asset's LOD0/1/2 do.
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    const sharedMat = new PBRMaterial("shared_mat", scene);
    sharedMat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    const lod0 = MeshBuilder.CreateBox("shared_lod0", { size: 1 }, scene);
    lod0.material = sharedMat;
    const lod1 = MeshBuilder.CreateBox("shared_lod1", { size: 1 }, scene);
    lod1.material = sharedMat;
    const lod2 = MeshBuilder.CreateBox("shared_lod2", { size: 1 }, scene);
    lod2.material = sharedMat;
    const deadwood = MeshBuilder.CreateBox("deadwood", { size: 1 }, scene);
    deadwood.material = new PBRMaterial("deadwood_mat", scene);

    createForestMeshes(scene, SEED, {
      assets: {
        giants: [{ lods: [lod0, lod1, lod2] }],
        saplings: [],
        deadwood,
      },
      bakeImpostor: () => null,
    });

    // LOD0 and LOD1 keep pointing at the one shared object — only LOD2 moves.
    expect(lod0.material).toBe(sharedMat);
    expect(lod1.material).toBe(sharedMat);
    expect(lod2.material).not.toBe(sharedMat);
    expect(lod0.material!.pluginManager?.getPlugin("Foliage")).toBeTruthy();
    expect(lod2.material!.pluginManager?.getPlugin("Foliage") ?? null).toBeNull();
    // The split must not cost LOD2 the plugins every bucket material still
    // needs: `Material.clone()` cannot reconstruct a plugin outside
    // Babylon's own class registry (it throws trying), so the split has to
    // happen before ANY custom plugin attaches — the clone must still end up
    // with its own, independently attached ground conform and distance fade.
    expect(lod2.material!.pluginManager?.getPlugin("GroundConform")).toBeTruthy();
    expect(lod2.material!.pluginManager?.getPlugin("DistanceFade")).toBeTruthy();
  });

  it("writes a constant fadeBands per bucket: seams inward and outward, edges for understory and logs", () => {
    const { scene, assets, forest } = build();
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    const bandsOf = (mesh: Mesh): number[] => {
      const buf = uploadedBuffer(spy, mesh, "fadeBands");
      expect(buf, mesh.name).not.toBeNull();
      return Array.from(buf!.subarray(0, 4));
    };
    // Math.fround, not toBeCloseTo: the buffer is float32, so these are the
    // exact values that reach the GPU — and UNDERSTORY_RADIUS * 0.8 is
    // 52.000000000000007 in float64, which an exact float64 compare would miss.
    const quad = (...v: number[]): number[] => v.map(Math.fround);

    const giant0 = assets.giants[0]!;
    // LOD0 fades only OUT (nothing precedes it); each next ring fades in where
    // the previous faded out, and LOD2 hands over to the impostor at the near
    // seam. Saplings ride the same ring edges.
    expect(bandsOf(giant0.lods[0])).toEqual(quad(-2, -1, ...SEAM_LOD0));
    expect(bandsOf(giant0.lods[1])).toEqual(quad(...SEAM_LOD0, ...SEAM_LOD1));
    expect(bandsOf(giant0.lods[2])).toEqual(quad(...SEAM_LOD1, ...seamNear(NEAR_RADIUS)));
    // FOREST_CAM's sapling LOD1 ring is empty at this camera ([0, 0, 1], the
    // widened coastal blend, not a code change here), so a guard on
    // `thinInstanceCount > 0` here never ran. Build a second scene at
    // LOD_CAM — the same off-apron camera the "distributes saplings across
    // LOD rings" test above uses, where LOD1 measures 45 — assert it really
    // has content, THEN check the bands, so a future empty bucket fails
    // loudly instead of the guard silently going dead again.
    const LOD_CAM = { x: FOREST_CAM.x, z: -1400 };
    const { assets: lodAssets, forest: lodForest } = build();
    lodForest.update(LOD_CAM.x, LOD_CAM.z);
    const sapLod1 = lodAssets.saplings[0]!.lods[1];
    expect(sapLod1.thinInstanceCount, "sapling LOD1 bucket").toBeGreaterThan(0);
    expect(bandsOf(sapLod1)).toEqual(quad(...SEAM_LOD0, ...SEAM_LOD1));
    // Understory and deadwood have no outer band to hand over to: they thin
    // out at their own disc edge (understory) and at the near seam (logs).
    expect(bandsOf(giant0.understory!)).toEqual(
      quad(-2, -1, UNDERSTORY_RADIUS * 0.8, UNDERSTORY_RADIUS),
    );
    expect(bandsOf(assets.deadwood)).toEqual(quad(-2, -1, ...seamNear(NEAR_RADIUS)));

    const planes = scene.meshes.filter((m) => m.name.startsWith("forest_impostor_")) as Mesh[];
    expect(planes.map((m) => m.name).sort()).toEqual([
      "forest_impostor_giant_0",
      "forest_impostor_giant_1",
      "forest_impostor_giant_2",
      "forest_impostor_sapling_0",
      "forest_impostor_sapling_1",
      "forest_impostor_snag",
    ]);

    // The impostor plane is the one bucket whose bands are NOT constant, and
    // the reason `fadeBands` is per-instance at all: the on-lattice list and
    // the off-lattice fill list share one plane, one material and one bake
    // (six more meshes would break the draw-call budget), and they end at
    // different ranges. On-lattice entries come first.
    const bands = collectBands(SEED, FOREST_CAM.x, FOREST_CAM.z);
    const isGiant0 = (t: TreeInstance) => t.cohort === COHORT_GIANT && t.species === 0;
    const lattice = bands.impostors.filter(isGiant0).length;
    const fill = bands.impostorsFill.filter(isGiant0).length;
    expect(lattice).toBeGreaterThan(0);
    expect(fill).toBeGreaterThan(0);
    const giantPlane = scene.meshes.find((m) => m.name === "forest_impostor_giant_0") as Mesh;
    const buf = uploadedBuffer(spy, giantPlane, "fadeBands");
    expect(buf).not.toBeNull();
    expect(buf!.length).toBe((lattice + fill) * 4);
    const latticeBands = quad(...seamNear(NEAR_RADIUS), ...SEAM_FAR);
    const fillBands = quad(...seamNear(NEAR_RADIUS), ...SEAM_FILL);
    let sawLattice = 0;
    let sawFill = 0;
    for (let i = 0; i < lattice + fill; i++) {
      const got = Array.from(buf!.subarray(i * 4, i * 4 + 4));
      if (i < lattice) {
        expect(got, `instance ${i}`).toEqual(latticeBands);
        sawLattice++;
      } else {
        expect(got, `instance ${i}`).toEqual(fillBands);
        sawFill++;
      }
    }
    expect([sawLattice, sawFill]).toEqual([lattice, fill]);
  });

  it("clips ring 1's out-band to the near seam at a low nearRadius, leaves ring 0 alone", () => {
    // Low tier's nearRadius (renderer.ts: round(NEAR_RADIUS * 140/240) = 70).
    // Ring 1's fixed out-band SEAM_LOD1 = [76, 85] sits past 70 m, so
    // unclipped it would stay fully visible past the near radius while the
    // impostor has already faded fully in over seamNear(70) = [50, 70] —
    // every such giant drawn twice from 70 to 85 m. Ring 0's fixed out-band
    // SEAM_LOD0 = [36, 42] is still inside 70 m, so it is untouched.
    const LOW_NEAR = 70;
    const { assets, forest } = build(LOW_NEAR);
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    const bandsOf = (mesh: Mesh): number[] => {
      const buf = uploadedBuffer(spy, mesh, "fadeBands");
      expect(buf, mesh.name).not.toBeNull();
      return Array.from(buf!.subarray(0, 4));
    };
    const quad = (...v: number[]): number[] => v.map(Math.fround);
    const giant0 = assets.giants[0]!;
    expect(bandsOf(giant0.lods[0])).toEqual(quad(-2, -1, ...SEAM_LOD0));
    expect(bandsOf(giant0.lods[1])).toEqual(quad(...SEAM_LOD0, ...seamNear(LOW_NEAR)));
    expect(bandsOf(giant0.lods[2])).toEqual(quad(...SEAM_LOD1, ...seamNear(LOW_NEAR)));
  });

  it("no two of ring0/ring1/ring2/impostor are both fully visible across a low near seam (pure check)", () => {
    // Same shape `forestMeshes.ts`'s `adoptSpecies` builds at nearRadius 70:
    // ring 1's out-band clipped to the near seam (85 > 70), ring 0's left
    // alone (42 <= 70), ring 2 and the impostor's in-band both at the near
    // seam. Before this fix, ring1 = fadeBands(SEAM_LOD0, SEAM_LOD1) would
    // overlap the impostor's in-band at full visibility across 70-76 m.
    const LOW_NEAR = 70;
    const near = seamNear(LOW_NEAR);
    const ring0 = fadeBands(null, SEAM_LOD0);
    const ring1 = fadeBands(SEAM_LOD0, near);
    const ring2 = fadeBands(SEAM_LOD1, near);
    const impostor = fadeBands(near, SEAM_FAR);
    const buckets = [ring0, ring1, ring2, impostor];
    for (let d = 30; d <= 130; d += 0.5) {
      const visibilities = buckets.map((b) => fadeVisibility(d, b));
      const fullyVisible = visibilities.filter((v) => v === 1).length;
      expect(fullyVisible, `d=${d}: [${visibilities.join(", ")}]`).toBeLessThanOrEqual(1);
    }
  });

  it("bakes an impostor per sapling species and one for the snag, standing up", () => {
    const poses: (Quaternion | null)[] = [];
    const { scene, forest } = build(undefined, (_mesh, s, _options, pose) => {
      poses.push(pose ?? null);
      return stubBakeTexture(s);
    });
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    // Six bakes: 3 giant bucket sets, 2 sapling species, 1 snag.
    expect(poses.length).toBe(6);
    const posed = poses.filter((p): p is Quaternion => p !== null);
    expect(posed.length).toBe(1);
    // The snag alone is posed, by the same +90° roll `deadwoodMatrixBuffer`
    // applies — `deadwood.snag` is modelled lying down, and an un-posed bake
    // would billboard a felled trunk against a standing one.
    expect(posed[0]!.equalsWithEpsilon(Quaternion.FromEulerAngles(0, 0, Math.PI / 2), 1e-6)).toBe(
      true,
    );

    const named = (prefix: string) => scene.meshes.filter((m) => m.name.startsWith(prefix)).length;
    expect(named("forest_impostor_giant_")).toBe(3);
    expect(named("forest_impostor_sapling_")).toBe(2);
    expect(named("forest_impostor_snag")).toBe(1);
  });

  it("seats the snag billboard on the ground, at half the standing trunk's height", () => {
    const { scene, forest } = build(undefined, (_mesh, s) => stubBakeTexture(s));
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    const plane = scene.meshes.find((m) => m.name === "forest_impostor_snag") as Mesh;

    // The stub deadwood mesh is an 8 × 1 × 1 box lying along local X (see
    // `stubAssets`). Rolled upright the billboard is 8 m tall and 1 m across —
    // the local Y/Z extents give the width, local X the height.
    const half = plane.getBoundingInfo().boundingBox.extendSize;
    expect(half.x * 2).toBeCloseTo(1, 6);
    expect(half.y * 2).toBeCloseTo(8, 6);

    // ...and its CENTRE stands 4 m (half the trunk) above the ground, not 8:
    // the quad is origin-centred while the instance sits at the trunk's foot.
    const buf = uploadedBuffer(spy, plane, "matrix");
    expect(buf).not.toBeNull();
    const bands = collectBands(SEED, FOREST_CAM.x, FOREST_CAM.z);
    const isSnag = (t: TreeInstance) => t.cohort === COHORT_SNAG;
    // On-lattice first, then the off-lattice fill — the order `rebuild`
    // concatenates them in, and the order the fadeBands test above relies on.
    const snags = [...bands.impostors.filter(isSnag), ...bands.impostorsFill.filter(isSnag)];
    expect(snags.length).toBeGreaterThan(0);
    expect(buf!.length / 16).toBe(snags.length);
    for (let i = 0; i < snags.length; i++) {
      const t = snags[i]!;
      // Translation Y is element 13 of a Babylon world matrix.
      expect(buf![i * 16 + 13], `instance ${i}`).toBeCloseTo(t.groundH + 4 * t.scale, 2);
    }
  });

  describe("props that rest on the ground take its normal", () => {
    /** Column 1 of a world matrix is the model's up axis after rotation. */
    function upAxis(buf: Float32Array, i: number): Vector3 {
      return new Vector3(buf[i * 16 + 4] as number, buf[i * 16 + 5] as number, buf[i * 16 + 6] as number);
    }

    it("tilts the understory onto the slope while giants stay plumb", () => {
      setActiveTerrainVariant(SLOPE_VARIANT);
      try {
        const { assets, forest } = build();
        const giantSpy = vi.spyOn(assets.giants[0]!.lods[0], "thinInstanceSetBuffer");
        const underSpy = vi.spyOn(assets.giants[0]!.understory!, "thinInstanceSetBuffer");
        forest.update(FOREST_CAM.x, FOREST_CAM.z);

        // Filter by kind rather than taking the last call: the giant and
        // sapling buckets carry a second per-instance buffer ("groundGrad"),
        // after which the last call on those meshes is no longer the matrix one.
        const giantBuf = giantSpy.mock.calls.filter((c) => c[0] === "matrix").pop()![1] as Float32Array;
        const underBuf = underSpy.mock.calls.filter((c) => c[0] === "matrix").pop()![1] as Float32Array;
        expect(giantBuf.length).toBeGreaterThan(0);
        expect(underBuf.length).toBeGreaterThan(0);

        // SLOPE_VARIANT: dx = 0.15, dz = 0, so the normal is (-0.15, 1, 0)/‖·‖.
        // `ComposeToRef` bakes each instance's (non-unit) scale into every
        // matrix column, `upAxis`'s column-1 read included, so the raw column
        // must be normalized before it is comparable to a unit-vector normal —
        // otherwise this compares a scale-3.9-ish vector to a unit one and
        // fails for every real instance, tilt or no tilt.
        const inv = 1 / Math.sqrt(1 + 0.15 * 0.15);
        const up = upAxis(underBuf, 0).normalize();
        expect(up.x).toBeCloseTo(-0.15 * inv, 5);
        expect(up.y).toBeCloseTo(inv, 5);
        expect(up.z).toBeCloseTo(0, 5);

        // A conifer grows plumb whatever the hillside does.
        const giantUp = upAxis(giantBuf, 0).normalize();
        expect(giantUp.x).toBeCloseTo(0, 6);
        expect(giantUp.y).toBeCloseTo(1, 6);
        expect(giantUp.z).toBeCloseTo(0, 6);
      } finally {
        setActiveTerrainVariant("olympic");
      }
    });

    it("leans a snag with the hill and still seats its foot", () => {
      setActiveTerrainVariant(SLOPE_VARIANT);
      try {
        const { assets, forest } = build();
        const spy = vi.spyOn(assets.deadwood, "thinInstanceSetBuffer");
        forest.update(FOREST_CAM.x, FOREST_CAM.z);
        const buf = spy.mock.calls.filter((c) => c[0] === "matrix").pop()![1] as Float32Array;
        const bands = collectBands(SEED, FOREST_CAM.x, FOREST_CAM.z);

        const inv = 1 / Math.sqrt(1 + 0.15 * 0.15);
        let checked = 0;
        for (let i = 0; i < bands.deadwood.length; i++) {
          const t = bands.deadwood[i]!;
          if (t.cohort !== COHORT_SNAG) continue;
          checked++;
          const m = Matrix.FromArray(buf, i * 16);
          // The rolled trunk's own axis is local X; after the ground tilt it
          // must point along the ground normal, not straight up.
          const axis = Vector3.TransformNormal(new Vector3(1, 0, 0), m).normalize();
          expect(axis.x).toBeCloseTo(-0.15 * inv, 4);
          expect(axis.y).toBeCloseTo(inv, 4);
          // And the foot still touches: this is what the raised origin's
          // normal-Y correction buys. Without it the whole snag floats.
          const foot = Vector3.TransformCoordinates(new Vector3(-4, 0, 0), m);
          expect(Math.abs(foot.y - elevationAt(SEED, foot.x, foot.z))).toBeLessThan(0.05);
        }
        expect(checked).toBeGreaterThan(0);
      } finally {
        setActiveTerrainVariant("olympic");
      }
    });

    it("rolls a log so both of its flanks meet the ground", () => {
      setActiveTerrainVariant(SLOPE_VARIANT);
      try {
        const { assets, forest } = build();
        const spy = vi.spyOn(assets.deadwood, "thinInstanceSetBuffer");
        forest.update(FOREST_CAM.x, FOREST_CAM.z);
        const buf = spy.mock.calls.filter((c) => c[0] === "matrix").pop()![1] as Float32Array;
        const bands = collectBands(SEED, FOREST_CAM.x, FOREST_CAM.z);

        // The existing far-end test walks the underside CENTRELINE (local z = 0),
        // which a pitch alone already seats. This walks the two FLANKS, which
        // only an axial roll can seat — a log lying across the fall line has one
        // flank in the air until it rolls.
        let checked = 0;
        for (let i = 0; i < bands.deadwood.length; i++) {
          const t = bands.deadwood[i]!;
          if (t.cohort !== COHORT_LOG) continue;
          checked++;
          const m = Matrix.FromArray(buf, i * 16);
          for (const flank of [-0.5, 0.5]) {
            const p = Vector3.TransformCoordinates(new Vector3(0, -0.5, flank), m);
            // Each flank lies the log's sink under its own ground (LOG_SINK of the box's 1 m diameter).
            expect(Math.abs(p.y - (elevationAt(SEED, p.x, p.z) - LOG_SINK * t.scale))).toBeLessThan(0.12);
          }
        }
        expect(checked).toBeGreaterThan(0);
      } finally {
        setActiveTerrainVariant("olympic");
      }
    });
  });

  describe("the tree buckets carry the gradient to the GPU", () => {
    it("uploads a groundGrad buffer matching each giant instance", () => {
      const { assets, forest } = build();
      const spy = vi.spyOn(assets.giants[0]!.lods[0], "thinInstanceSetBuffer");
      forest.update(FOREST_CAM.x, FOREST_CAM.z);

      const matrixBuf = spy.mock.calls.filter((c) => c[0] === "matrix").pop()![1] as Float32Array;
      const gradCall = spy.mock.calls.filter((c) => c[0] === "groundGrad").pop();
      expect(gradCall).toBeDefined();
      expect(gradCall![2]).toBe(2);
      const gradBuf = gradCall![1] as Float32Array;
      expect(gradBuf.length).toBe((matrixBuf.length / 16) * 2);

      // `rebuild` filters bands.near[lod] by species, in order, and hands the
      // result straight to both buffer builders — so index i here IS instance i.
      const bands = collectBands(SEED, FOREST_CAM.x, FOREST_CAM.z);
      const list = bands.near[0]!.filter((t) => t.species === 0);
      expect(list.length).toBe(matrixBuf.length / 16);
      expect(list.length).toBeGreaterThan(0);
      for (let i = 0; i < list.length; i++) {
        // Math.fround, not toBeCloseTo: the buffer is float32, so this is the
        // exact value that reaches the GPU, and an exact check is what catches
        // a swapped dx/dz — which a tolerance would wave through wherever the
        // two happen to be close.
        expect(gradBuf[i * 2]).toBe(Math.fround(list[i]!.groundDx));
        expect(gradBuf[i * 2 + 1]).toBe(Math.fround(list[i]!.groundDz));
      }
    });

    it("leaves understory and deadwood without one — they are tilted, not conformed", () => {
      const { scene, assets, forest } = build();
      const underSpy = vi.spyOn(assets.giants[0]!.understory!, "thinInstanceSetBuffer");
      const deadSpy = vi.spyOn(assets.deadwood, "thinInstanceSetBuffer");
      forest.update(FOREST_CAM.x, FOREST_CAM.z);
      expect(underSpy.mock.calls.length).toBeGreaterThan(0);
      expect(deadSpy.mock.calls.length).toBeGreaterThan(0);
      expect(underSpy.mock.calls.some((c) => c[0] === "groundGrad")).toBe(false);
      expect(deadSpy.mock.calls.some((c) => c[0] === "groundGrad")).toBe(false);

      // Absence of the buffer proves nothing about the PLUGIN — that's the
      // composition risk this design accounts for: understory's material
      // already carries WindPlugin, and two vertex plugins on one material is
      // exactly what conforming-not-tilting understory would have produced.
      expect(
        assets.giants[0]!.understory!.material!.pluginManager?.getPlugin("GroundConform"),
      ).toBeFalsy();
      // Deadwood is seated and tilted wholly on the CPU
      // (`deadwoodMatrixBuffer`): no conform, and no wind either — a dead
      // trunk does not sway.
      const deadMat = assets.deadwood.material!;
      expect(deadMat.pluginManager?.getPlugin("GroundConform")).toBeFalsy();
      expect(deadMat.pluginManager?.getPlugin("Wind")).toBeFalsy();

      const impostors = scene.meshes.filter((m) => m.name.startsWith("forest_impostor"));
      expect(impostors.length).toBeGreaterThan(0);
      for (const impostor of impostors) {
        expect(impostor.material?.pluginManager?.getPlugin("GroundConform")).toBeFalsy();
      }
    });
  });
});

/**
 * Structural tests for the production bake path. NullEngine cannot prove
 * pixels (its render targets lie), and it compiles shaders synchronously, so
 * it also cannot reproduce the bug these guard against: effects that are not
 * yet compiled for the RTT's OWN render pass, where a one-shot render
 * silently skips every submesh and bakes a blank texture. What IS honestly
 * testable is the gate ordering — `render()` must not run until the RTT
 * itself reports `isReadyForRendering()` (the only check that evaluates
 * readiness under the bake camera and the RTT's render pass id) — so these
 * spy on the RenderTargetTexture prototype and script the gate.
 */
describe("the trees' bark", () => {
  const engines: NullEngine[] = [];
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const e of engines.splice(0)) e.dispose();
  });

  function barkScene() {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    return { scene, assets: stubAssets(scene) };
  }

  /** A bark map loader that records every load, a 1×1 texture each, and
   * keeps its callbacks: a test lands or fails a map when it chooses. */
  function recordingLoader() {
    const loads: { url: string; colour: boolean; texture: Texture; onLoad: () => void; onError: () => void }[] = [];
    const load: BarkTextureLoader = (url, s, colour, onLoad, onError) => {
      const texture = RawTexture.CreateRGBATexture(new Uint8Array([128, 128, 128, 255]), 1, 1, s);
      loads.push({ url, colour, texture, onLoad, onError });
      return texture;
    };
    return { loads, load };
  }

  /** A 1×1 stand-in for a map a tree's file carried. */
  function fileMap(scene: Scene): Texture {
    return RawTexture.CreateRGBATexture(new Uint8Array([200, 150, 100, 255]), 1, 1, scene);
  }

  it("dresses every bark material in its set: the three maps on, the file's transform and maps off, the crown and the loader's flags untouched", () => {
    const { scene, assets } = barkScene();
    const { loads, load } = recordingLoader();
    // The fir's LOD0 bark as its file ships it: a colour and a normal JPEG
    // read through the conifers' transform (a tenth of the atlas), the glTF
    // loader's normal flags, and vertex tangents.
    const firBark = assets.giants[0]!.lods[0];
    const firMat = firBark.material as PBRMaterial;
    const fileColour = fileMap(scene);
    const fileNormal = fileMap(scene);
    for (const map of [fileColour, fileNormal]) {
      map.vOffset = 0.9;
      map.uScale = 1.2;
      map.vScale = 0.1;
    }
    firMat.albedoTexture = fileColour;
    firMat.bumpTexture = fileNormal;
    firMat.invertNormalMapX = true;
    firMat.invertNormalMapY = false;
    const firCrown = firBark.getChildMeshes(false)[0] as Mesh;
    for (const mesh of [firBark, firCrown]) {
      mesh.setVerticesData(VertexBuffer.TangentKind, new Float32Array(mesh.getTotalVertices() * 4), false, 4);
    }
    const crownMat = firCrown.material as PBRMaterial;

    createForestMeshes(scene, SEED, { assets, bakeImpostor: () => null, loadTexture: load, tier: "high" });

    // Three maps a bark material: the fir's three LODs, the pine's three in
    // each of its two barks, the two saplings' three each: 15 materials, 45 maps.
    expect(loads.length).toBe(45);
    // The fir wears the pine set at 2k on the high tier.
    expect(firMat.albedoTexture).toBe(loads[0]!.texture);
    expect(loads[0]).toMatchObject({ url: textureUrl("textures/bark.pine.2k.ktx2"), colour: true });
    expect(firMat.bumpTexture).toBe(loads[1]!.texture);
    expect(loads[1]).toMatchObject({ url: textureUrl("textures/bark.pine.2k.normal.ktx2"), colour: false });
    expect(firMat.bumpTexture!.level).toBe(1);
    expect(firMat.metallicTexture).toBe(loads[2]!.texture);
    expect(loads[2]).toMatchObject({ url: textureUrl("textures/bark.pine.2k.arm.ktx2"), colour: false });
    // The ARM map's channels named, the multipliers at 1 so the map is the surface.
    expect(firMat.useAmbientOcclusionFromMetallicTextureRed).toBe(true);
    expect(firMat.useRoughnessFromMetallicTextureGreen).toBe(true);
    expect(firMat.useRoughnessFromMetallicTextureAlpha).toBe(false);
    expect(firMat.useMetallnessFromMetallicTextureBlue).toBe(true);
    expect(firMat.metallic).toBe(1);
    expect(firMat.roughness).toBe(1);
    // The colour map under the sets' one tone (`BARK_TONE`).
    expect([firMat.albedoColor.r, firMat.albedoColor.g, firMat.albedoColor.b]).toEqual([0.68, 0.68, 0.7]);
    expect(firMat.ambientTexture).toBeNull();
    expect(firMat.ambientTextureStrength).toBe(1);
    // The loader's normal flags stay: the set's normal map is in the file's convention.
    expect([firMat.invertNormalMapX, firMat.invertNormalMapY]).toEqual([true, false]);
    // The set tiles from the primitive's UVs at the dressing's repeats: the
    // fir runs `v` up the trunk, so no turn.
    for (const map of [firMat.albedoTexture, firMat.bumpTexture, firMat.metallicTexture] as Texture[]) {
      expect([map.uOffset, map.vOffset, map.uScale, map.vScale, map.wAng]).toEqual([0, 0, 1.7, 6.3, 0]);
      expect([map.wrapU, map.wrapV]).toEqual([Texture.WRAP_ADDRESSMODE, Texture.WRAP_ADDRESSMODE]);
    }
    // The file's maps are gone from the scene and the GPU.
    for (const map of [fileColour, fileNormal]) {
      expect(scene.textures).not.toContain(map);
      expect(map.getInternalTexture()).toBeNull();
    }
    // The bark's tangents are gone, so the normal map's frame follows its
    // own coordinates; the crown keeps its own, and its material is as it was.
    expect(firBark.isVerticesDataPresent(VertexBuffer.TangentKind)).toBe(false);
    expect(firCrown.isVerticesDataPresent(VertexBuffer.TangentKind)).toBe(true);
    expect(firCrown.material).toBe(crownMat);
    expect(crownMat.metallicTexture).toBeNull();
    expect(crownMat.albedoTexture).toBeNull();
    expect([crownMat.albedoColor.r, crownMat.albedoColor.g, crownMat.albedoColor.b]).toEqual([1, 1, 1]);
  });

  it("gives the pine its two barks: the metasequoia on its own material, the cedar on a clone over clones of its meshes, geometry of their own, that share the crown", () => {
    const { scene, assets } = barkScene();
    const { loads, load } = recordingLoader();
    createForestMeshes(scene, SEED, { assets, bakeImpostor: () => null, loadTexture: load, tier: "high" });
    const pineLod0 = assets.giants[1]!.lods[0];
    const pineMat = pineLod0.material as PBRMaterial;
    const pineCrown = pineLod0.getChildMeshes(false)[0] as Mesh;
    const urlOf = (map: { uniqueId: number } | null): string => loads.find((l) => l.texture === map)!.url;
    expect(urlOf(pineMat.albedoTexture)).toBe(textureUrl("textures/bark.metasequoia.2k.ktx2"));
    expect(urlOf(pineMat.bumpTexture)).toBe(textureUrl("textures/bark.metasequoia.2k.normal.ktx2"));
    expect(urlOf(pineMat.metallicTexture)).toBe(textureUrl("textures/bark.metasequoia.2k.arm.ktx2"));
    // The pine runs `u` up the trunk: the set is turned a quarter.
    const colour = pineMat.albedoTexture as Texture;
    expect([colour.uScale, colour.vScale, colour.wAng]).toEqual([1.6, 1.0, 1.5707963267948966]);

    const cedarBark = scene.getMeshByName("s1_lod0_bark_cedar") as Mesh;
    const cedarCrown = scene.getMeshByName("s1_lod0_bark_cedar.s1_lod0_canopy") as Mesh;
    expect(cedarBark).not.toBeNull();
    expect(cedarCrown).not.toBeNull();
    // The clone has geometry of its own (Babylon keeps thin-instance buffers
    // on the geometry), shares the crown's material, and wears its own bark
    // material.
    expect(cedarBark.geometry).not.toBe(pineLod0.geometry);
    expect(cedarCrown.geometry).not.toBe(pineCrown.geometry);
    expect(cedarCrown.material).toBe(pineCrown.material);
    const cedarMat = cedarBark.material as PBRMaterial;
    expect(cedarMat).not.toBe(pineMat);
    expect(cedarMat.name).toBe("s1_lod0_bark_mat_cedar");
    expect(urlOf(cedarMat.albedoTexture)).toBe(textureUrl("textures/bark.cedar.2k.ktx2"));
    expect(urlOf(cedarMat.bumpTexture)).toBe(textureUrl("textures/bark.cedar.2k.normal.ktx2"));
    expect(urlOf(cedarMat.metallicTexture)).toBe(textureUrl("textures/bark.cedar.2k.arm.ktx2"));
    const cedarColour = cedarMat.albedoTexture as Texture;
    expect([cedarColour.uScale, cedarColour.vScale, cedarColour.wAng]).toEqual([1.5, 1.9, 1.5707963267948966]);
    // The clone wears the sets' one tone, as its source does.
    expect([cedarMat.albedoColor.r, cedarMat.albedoColor.g, cedarMat.albedoColor.b]).toEqual([0.68, 0.68, 0.7]);
    expect([pineMat.albedoColor.r, pineMat.albedoColor.g, pineMat.albedoColor.b]).toEqual([0.68, 0.68, 0.7]);
    // The saplings: 1k on every tier, the conifers in their giants' sets.
    const sap = (s: number): PBRMaterial => assets.saplings[s]!.lods[0].material as PBRMaterial;
    expect(urlOf(sap(0).albedoTexture)).toBe(textureUrl("textures/bark.pine.1k.ktx2"));
    expect(urlOf(sap(1).albedoTexture)).toBe(textureUrl("textures/bark.metasequoia.1k.ktx2"));
    // Every bark material of the scene has its three maps.
    const dressed = scene.materials.filter((m): m is PBRMaterial => m instanceof PBRMaterial && m.metallicTexture !== null);
    expect(dressed.length).toBe(15);
    for (const m of dressed) {
      expect(m.albedoTexture, m.name).not.toBeNull();
      expect(m.bumpTexture, m.name).not.toBeNull();
      expect([m.albedoColor.r, m.albedoColor.g, m.albedoColor.b], m.name).toEqual([0.68, 0.68, 0.7]);
    }
    // The cedar's clone was made of the dressed metasequoia material, with
    // copies of its three maps: all three copies are disposed with the file's
    // own, the ARM map's too. The scene holds the loader's 45 maps and, of
    // its own, PBR's BRDF lookup alone (named with a counter of the process's).
    const own = scene.textures.filter((t) => !t.name.startsWith("data:EnvironmentBRDFTexture"));
    expect(own.filter((t) => !loads.some((l) => l.texture === t)).map((t) => t.name)).toEqual([]);
    expect(own.length).toBe(45);
  });

  it("gives the pine's second set geometry of its own, so a rebuild of one set never takes the other's instance buffers", () => {
    const { scene, assets } = barkScene();
    const { load } = recordingLoader();
    const forest = createForestMeshes(scene, SEED, { assets, bakeImpostor: () => null, loadTexture: load });
    // The two sets' LOD meshes, bark and crown: six each.
    const first: Mesh[] = [];
    const second: Mesh[] = [];
    for (const lod of [0, 1, 2] as const) {
      const bark = assets.giants[1]!.lods[lod];
      first.push(bark, bark.getChildMeshes(false)[0] as Mesh);
      second.push(
        scene.getMeshByName(`s1_lod${lod}_bark_cedar`) as Mesh,
        scene.getMeshByName(`s1_lod${lod}_bark_cedar.s1_lod${lod}_canopy`) as Mesh,
      );
    }
    expect(first.length).toBe(6);
    expect(second.length).toBe(6);
    for (const mesh of [...first, ...second]) expect(mesh.geometry, mesh.name).not.toBeNull();
    // Twelve geometries for twelve meshes: none shared across the sets.
    expect(new Set(first.map((m) => m.geometry)).size).toBe(6);
    expect(new Set(second.map((m) => m.geometry)).size).toBe(6);
    expect(new Set([...first, ...second].map((m) => m.geometry)).size).toBe(12);

    // Two rebuilds, a cell apart: the first set's count and matrix buffer
    // are its own after the second, not the second set's. Babylon binds the
    // geometry's `world0` buffer when it draws, so that buffer must be the
    // one the first set's last upload made.
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    const counts = (): number[][] => [first, second].map((set) => set.filter((_m, k) => k % 2 === 0).map((m) => m.thinInstanceCount));
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    expect(counts()).toEqual([[27, 48, 58], [19, 52, 67]]);
    // One cell over: both barks stand there too, at counts of their own, so
    // a count left from the first camera would show.
    const moved = { x: FOREST_CAM.x + TREE_CELL, z: FOREST_CAM.z };
    forest.update(moved.x, moved.z);
    expect(counts()).toEqual([[26, 52, 58], [18, 52, 68]]);
    const bands = collectBands(SEED, moved.x, moved.z);
    const count = (list: readonly TreeInstance[], variant: number): number =>
      list.filter((t) => t.cohort === COHORT_GIANT && t.species === 1 && t.variant === variant).length;
    const lastMatrix = (mesh: Mesh): Float32Array | null => {
      let found: Float32Array | null = null;
      for (let k = 0; k < spy.mock.calls.length; k++) {
        if (spy.mock.instances[k] === mesh && spy.mock.calls[k]![0] === "matrix") found = spy.mock.calls[k]![1] as Float32Array;
      }
      return found;
    };
    let metasequoia = 0;
    for (const lod of [0, 1, 2] as const) {
      const bark = assets.giants[1]!.lods[lod];
      const clone = scene.getMeshByName(`s1_lod${lod}_bark_cedar`) as Mesh;
      expect(bark.thinInstanceCount, `pine LOD${lod}`).toBe(count(bands.near[lod] as TreeInstance[], 0));
      expect(clone.thinInstanceCount, `cedar LOD${lod}`).toBe(count(bands.near[lod] as TreeInstance[], 1));
      for (const mesh of [bark, clone]) {
        const uploaded = lastMatrix(mesh);
        expect(uploaded, mesh.name).not.toBeNull();
        expect(uploaded!.length).toBe(mesh.thinInstanceCount * 16);
        const world0 = mesh.geometry!.getVertexBuffer("world0");
        expect(world0, mesh.name).not.toBeNull();
        expect(world0!.isDisposed, mesh.name).toBe(false);
        expect(world0!.getWrapperBuffer().getData(), mesh.name).toBe(uploaded);
      }
      metasequoia += bark.thinInstanceCount;
    }
    expect(metasequoia).toBeGreaterThan(0);
  });

  it("disposes the LOD2 split's copies of the bark maps with the forest", () => {
    // A shipped file's LOD ladder shares one bark material, so LOD2 is
    // split onto a clone of the dressed material, which copies the three
    // maps: those copies are the forest's to dispose, with the clone.
    const { scene } = barkScene();
    const { loads, load } = recordingLoader();
    const sharedMat = new PBRMaterial("shared_mat", scene);
    const lods = [0, 1, 2].map((lod) => {
      const mesh = MeshBuilder.CreateBox(`shared_lod${lod}`, { size: 1 }, scene);
      mesh.material = sharedMat;
      return mesh;
    }) as [Mesh, Mesh, Mesh];
    const deadwood = MeshBuilder.CreateBox("deadwood", { size: 1 }, scene);
    deadwood.material = new PBRMaterial("deadwood_mat", scene);
    const before = scene.textures.length;
    const forest = createForestMeshes(scene, SEED, {
      assets: { giants: [{ lods }], saplings: [], deadwood },
      bakeImpostor: () => null,
      loadTexture: load,
    });
    expect(loads.length).toBe(3);
    expect(lods[2].material).not.toBe(sharedMat);
    // The loader's three maps and the split's three copies.
    expect(scene.textures.length - before).toBe(6);
    forest.dispose();
    expect(scene.textures.length - before).toBe(0);
  });

  it("wears 1k everywhere on the medium and low tiers", () => {
    for (const tier of ["medium", "low"] as const) {
      const { scene, assets } = barkScene();
      const { loads, load } = recordingLoader();
      createForestMeshes(scene, SEED, { assets, bakeImpostor: () => null, loadTexture: load, tier });
      expect(loads.length).toBe(45);
      expect(loads.filter((l) => l.url.includes(".1k.")).length).toBe(45);
      expect(loads.filter((l) => l.url.includes(".2k.")).length).toBe(0);
    }
  });

  it("hands each tree's bake the promise of its bark set, which settles once every map has loaded or failed; the snag's bake gets none", async () => {
    const { scene, assets } = barkScene();
    const { loads, load } = recordingLoader();
    const given: (Promise<void> | undefined)[] = [];
    createForestMeshes(scene, SEED, {
      assets,
      loadTexture: load,
      bakeImpostor: (_mesh, _s, options) => {
        given.push(options?.textures);
        return null;
      },
    });
    // Three giant sets, two saplings, the snag.
    expect(given.length).toBe(6);
    for (const held of given.slice(0, 5)) expect(held).toBeInstanceOf(Promise);
    expect(given[5]).toBeUndefined();
    // The fir's set is its first three LODs' nine maps, the first nine loads.
    let landed = false;
    void given[0]!.then(() => { landed = true; });
    for (const l of loads.slice(0, 8)) l.onLoad();
    await new Promise((r) => setTimeout(r, 10));
    expect(landed).toBe(false);
    // A map that fails to load settles the set too: a missing file never blocks the forest.
    loads[8]!.onError();
    await new Promise((r) => setTimeout(r, 10));
    expect(landed).toBe(true);
  });

  it("splits the pine's trees between its two barks by their variant, and keeps the fir's whole", () => {
    const { scene, assets } = barkScene();
    const { load } = recordingLoader();
    const forest = createForestMeshes(scene, SEED, { assets, bakeImpostor: () => null, loadTexture: load });
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    const bands = collectBands(SEED, FOREST_CAM.x, FOREST_CAM.z);
    const count = (list: readonly TreeInstance[], species: number, variant: number | null): number =>
      list.filter((t) => t.cohort === COHORT_GIANT && t.species === species && (variant === null || t.variant === variant)).length;
    let cedar = 0;
    let metasequoia = 0;
    for (const lod of [0, 1, 2] as const) {
      const near = bands.near[lod] as TreeInstance[];
      expect(assets.giants[0]!.lods[lod].thinInstanceCount, `fir LOD${lod}`).toBe(count(near, 0, null));
      const pine = assets.giants[1]!.lods[lod].thinInstanceCount;
      const clone = (scene.getMeshByName(`s1_lod${lod}_bark_cedar`) as Mesh).thinInstanceCount;
      expect(pine, `pine LOD${lod}`).toBe(count(near, 1, 0));
      expect(clone, `cedar LOD${lod}`).toBe(count(near, 1, 1));
      expect(pine + clone).toBe(count(near, 1, null));
      metasequoia += pine;
      cedar += clone;
    }
    // Both barks stand at this camera.
    expect(metasequoia).toBeGreaterThan(0);
    expect(cedar).toBeGreaterThan(0);
    // And the billboards beyond the near band split the same way.
    const far = [...bands.impostors, ...bands.impostorsFill];
    const plane = (name: string): number => (scene.getMeshByName(name) as Mesh).thinInstanceCount;
    expect(plane("forest_impostor_giant_0")).toBe(count(far, 0, null));
    expect(plane("forest_impostor_giant_1")).toBe(count(far, 1, 0));
    expect(plane("forest_impostor_giant_2")).toBe(count(far, 1, 1));
    expect(plane("forest_impostor_giant_2")).toBeGreaterThan(0);
  });

  it("disposes the bark maps with the forest", () => {
    const { scene, assets } = barkScene();
    const { loads, load } = recordingLoader();
    const forest = createForestMeshes(scene, SEED, { assets, bakeImpostor: () => null, loadTexture: load });
    expect(loads.length).toBe(45);
    for (const l of loads) expect(scene.textures).toContain(l.texture);
    forest.dispose();
    for (const l of loads) {
      expect(scene.textures).not.toContain(l.texture);
      expect(l.texture.getInternalTexture()).toBeNull();
    }
  });
});

describe("defaultBakeImpostor readiness gate", () => {
  const engines: NullEngine[] = [];
  afterEach(() => {
    // Even after a test that failed while faking them.
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const e of engines.splice(0)) e.dispose();
  });

  function bakeScene() {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox("s0_lod1", { size: 2 }, scene);
    return { scene, mesh };
  }

  it("renders only after the RTT reports ready under its own pass, on a dedicated camera", async () => {
    const { scene, mesh } = bakeScene();
    const sequence: string[] = [];
    let gateCalls = 0;
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockImplementation(() => {
      sequence.push("gate");
      return ++gateCalls >= 3; // not ready twice — the shape of async compilation
    });
    let cameraAtRender: unknown = "never rendered";
    vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(function (
      this: RenderTargetTexture,
    ) {
      sequence.push("render");
      cameraAtRender = this.activeCamera;
    });

    const texture = await defaultBakeImpostor(mesh, scene);

    expect(texture).not.toBeNull();
    // Every gate check precedes the single render — no render on a false gate.
    expect(sequence).toEqual(["gate", "gate", "gate", "render"]);
    // The bake frames with its own camera, never the scene camera (whose
    // state — layer mask, maxZ — belongs to the player).
    const camera = cameraAtRender as { name: string } | null;
    expect(camera?.name).toBe("forest_impostor_bake_cam");
    expect(cameraAtRender).not.toBe(scene.activeCamera);
  });

  it("frames the bake from the POSED clone, so a felled snag bakes standing up", async () => {
    const { scene } = bakeScene();
    // The `deadwood.snag` shape: modelled lying down, long axis on local X.
    const snag = MeshBuilder.CreateBox("deadwood", { width: 8, height: 1, depth: 1 }, scene);
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(true);
    const cameras: TargetCamera[] = [];
    vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(function (
      this: RenderTargetTexture,
    ) {
      cameras.push(this.activeCamera as TargetCamera);
    });

    // Un-posed, the ortho frustum is 8 wide by 1 tall — a log on its side.
    await defaultBakeImpostor(snag, scene);
    // Posed by the roll `deadwoodMatrixBuffer` applies, it is 1 by 8: the
    // framing must read the CLONE's bounds after the pose, not the source
    // mesh's, or the standing snag's billboard is a felled one squashed into
    // a landscape quad.
    await defaultBakeImpostor(snag, scene, undefined, Quaternion.FromEulerAngles(0, 0, Math.PI / 2));

    expect(cameras.length).toBe(2);
    const extents = cameras.map((c) => [c.orthoRight! - c.orthoLeft!, c.orthoTop! - c.orthoBottom!]);
    expect(extents[0]![0]).toBeCloseTo(8, 4);
    expect(extents[0]![1]).toBeCloseTo(1, 4);
    expect(extents[1]![0]).toBeCloseTo(1, 4);
    expect(extents[1]![1]).toBeCloseTo(8, 4);
    // The pose is not allowed to survive on the caller's mesh.
    expect(snag.rotationQuaternion).toBeNull();
  });

  it("clones the bake mesh's material away from the source, so a plugin `adoptSpecies` attaches to the source afterward never reaches the bake", async () => {
    // The real bake path is unreachable through `createForestMeshes`'s stub
    // assets: `build()` always injects a `bakeImpostor` stub in place of
    // `defaultBakeImpostor` (NullEngine render targets lie), so the material
    // split inside `defaultBakeImpostor` itself never runs for any test that
    // goes through `adoptSpecies`. Exercising `defaultBakeImpostor` directly,
    // with the same RTT-prototype spies the other tests in this describe use
    // to make it safe under NullEngine, is the only way to cover it.
    const { scene, mesh } = bakeScene();
    const srcMat = new PBRMaterial("src_mat", scene);
    mesh.material = srcMat;
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(true);
    let renderListAtRender: Mesh[] = [];
    vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(function (
      this: RenderTargetTexture,
    ) {
      renderListAtRender = [...(this.renderList ?? [])] as Mesh[];
    });

    const texture = await defaultBakeImpostor(mesh, scene);

    expect(texture).not.toBeNull();
    expect(renderListAtRender.length).toBeGreaterThan(0);
    for (const m of renderListAtRender) expect(m.material, m.name).not.toBe(srcMat);

    // Mirrors `adoptSpecies`: the bake is kicked off first, and only
    // afterward does the source material pick up Foliage — a plugin outside
    // Babylon's class registry, which `Material.clone()` cannot reconstruct
    // once one is already attached (the same reason `adoptSpecies` splits
    // LOD2's material before its own plugins attach). Since the bake mesh
    // already has its own material clone by now, attaching Foliage to the
    // source afterward must never reach it.
    attachFoliage(srcMat, FOLIAGE_PROFILES.TREE, 10);
    expect(srcMat.pluginManager?.getPlugin("Foliage")).toBeTruthy(); // the check below is not vacuous
    for (const m of renderListAtRender) {
      expect(m.material!.pluginManager?.getPlugin("Foliage") ?? null, m.name).toBeNull();
    }
  });

  it("hands the bake clones the source material's share of the sky and specular weight", async () => {
    // `adoptSpecies` sets both before it kicks the bake, so the billboard
    // bakes the tree under the near trees' values: the clone must copy them.
    const { scene, mesh } = bakeScene();
    const srcMat = new PBRMaterial("src_mat", scene);
    srcMat.environmentIntensity = 0.35;
    srcMat.metallicF0Factor = 0.04;
    mesh.material = srcMat;
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(true);
    let rendered: { sky: number; weight: number }[] = [];
    vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(function (this: RenderTargetTexture) {
      rendered = (this.renderList ?? []).map((m) => {
        const mat = m.material as PBRMaterial;
        expect(mat).not.toBe(srcMat);
        return { sky: mat.environmentIntensity, weight: mat.metallicF0Factor };
      });
    });

    expect(await defaultBakeImpostor(mesh, scene)).not.toBeNull();
    expect(rendered).toEqual([{ sky: 0.35, weight: 0.04 }]);
  });

  it("waits past the old five seconds, warns once at thirty, and bakes when the gate opens", async () => {
    expect(IMPOSTOR_BAKE_WARN_MS).toBe(30_000);
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    const { scene, mesh } = bakeScene();
    let polls = 0;
    // A compile as slow as the translated shaders were: 2,500 polls of 16 ms.
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockImplementation(() => ++polls > 2_500);
    vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pending = defaultBakeImpostor(mesh, scene);
    await vi.advanceTimersByTimeAsync(41_000);
    expect(await pending).not.toBeNull();
    // A warning, not an error: a routine cold WebGPU bake crosses 30 s and lands.
    expect(warnings.mock.calls.map((c) => String(c[0]))).toEqual(["forest impostor bake still waiting after 30 s: s0_lod1"]);
    expect(errors).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("gives up at two minutes, loudly, rather than poll for the life of the page", async () => {
    expect(IMPOSTOR_BAKE_FAIL_MS).toBe(120_000);
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    const { scene, mesh } = bakeScene();
    const gate = vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(false);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pending = defaultBakeImpostor(mesh, scene);
    await vi.advanceTimersByTimeAsync(119_900);
    expect(errors).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toBeNull();
    expect(warnings).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual(["forest impostor bake gave up after 120 s: s0_lod1"]);
    const polls = gate.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(gate.mock.calls.length).toBe(polls);
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
    vi.useRealTimers();
  });

  it("resolves null on a shader error once Babylon has no fallback left, and says so", async () => {
    const { scene, mesh } = bakeScene();
    const gate = vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(false);
    vi.spyOn(SubMesh.prototype, "_getDrawWrapper").mockReturnValue({
      effect: { getCompilationError: () => "ERROR: 0:1: 'x' : undeclared identifier", allFallbacksProcessed: () => true },
    } as never);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await defaultBakeImpostor(mesh, scene)).toBeNull();
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([
      "forest impostor bake failed: s0_lod1: ERROR: 0:1: 'x' : undeclared identifier",
    ]);
    // Readiness is asked first, and was not there.
    expect(gate).toHaveBeenCalledTimes(1);
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
  });

  it("keeps waiting while Babylon still has a fallback to compile, and bakes when it does", async () => {
    // A PBR effect whose compile failed retries with fewer defines on the same
    // effect, the error still set until the retry lands.
    const { scene, mesh } = bakeScene();
    let polls = 0;
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockImplementation(() => ++polls > 5);
    vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(() => undefined);
    vi.spyOn(SubMesh.prototype, "_getDrawWrapper").mockReturnValue({
      effect: { getCompilationError: () => "ERROR: too many uniforms", allFallbacksProcessed: () => false },
    } as never);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await defaultBakeImpostor(mesh, scene)).not.toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("bakes a ready effect even with an old error on it, as Babylon draws one whose recompile failed", async () => {
    const { scene, mesh } = bakeScene();
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(true);
    vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(() => undefined);
    vi.spyOn(SubMesh.prototype, "_getDrawWrapper").mockReturnValue({
      effect: { getCompilationError: () => "ERROR: an old one", allFallbacksProcessed: () => true },
    } as never);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await defaultBakeImpostor(mesh, scene)).not.toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("renders nothing while the sky's table is empty, and bakes once the slices the lighting needs are held", async () => {
    const { scene, mesh } = bakeScene();
    const gate = vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(true);
    const render = vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(() => undefined);
    const table = createSkyTable();
    const pending = defaultBakeImpostor(mesh, scene, { sky: whenSkyHeld(table, () => 12) });
    await new Promise((r) => setTimeout(r, 50));
    expect(render).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
    // The slices either side of noon: noon's sky is held.
    const fixture = skyFixture();
    table.add(fixture.blendAt(74));
    table.add(fixture.blendAt(76));
    expect(await pending).not.toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("renders nothing until the species' bark set has landed, and bakes then", async () => {
    const { scene, mesh } = bakeScene();
    const gate = vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(true);
    const render = vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(() => undefined);
    let land = (): void => undefined;
    const textures = new Promise<void>((resolve) => {
      land = resolve;
    });
    const pending = defaultBakeImpostor(mesh, scene, { textures });
    await new Promise((r) => setTimeout(r, 50));
    expect(render).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
    land();
    expect(await pending).not.toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("waits for the sky and the bark set both, and stops waiting for the bark when aborted", async () => {
    const { scene, mesh } = bakeScene();
    const render = vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const abort = new AbortController();
    const pending = defaultBakeImpostor(mesh, scene, {
      signal: abort.signal,
      sky: Promise.resolve(),
      textures: new Promise<void>(() => undefined),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(render).not.toHaveBeenCalled();
    abort.abort();
    expect(await pending).toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
  });

  it("stops waiting for the sky when aborted, disposes the target, and logs nothing", async () => {
    const { scene, mesh } = bakeScene();
    const render = vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const abort = new AbortController();
    const pending = defaultBakeImpostor(mesh, scene, { signal: abort.signal, sky: new Promise<void>(() => undefined) });
    await new Promise((r) => setTimeout(r, 20));
    abort.abort();
    expect(await pending).toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
  });

  it("counts its bounds from the sky's arrival, not from its start", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    const { scene, mesh } = bakeScene();
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(false);
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let arrive = (): void => undefined;
    const sky = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    const abort = new AbortController();
    const pending = defaultBakeImpostor(mesh, scene, { signal: abort.signal, sky });
    await vi.advanceTimersByTimeAsync(40_000);
    arrive();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(warnings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(warnings).toHaveBeenCalledTimes(1);
    abort.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBeNull();
    vi.useRealTimers();
  });

  it("waits on the bark set for its bound at most, then warns once and bakes with the file's own bark", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    const { scene, mesh } = bakeScene();
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(true);
    const render = vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A map whose upload never settles: the set's promise never does.
    const pending = defaultBakeImpostor(mesh, scene, { textures: new Promise<void>(() => undefined) });
    await vi.advanceTimersByTimeAsync(119_900);
    expect(render).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).not.toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
    expect(warnings.mock.calls.map((c) => String(c[0]))).toEqual([
      "forest impostor bake waited 120 s for the bark set, and bakes the file's own: s0_lod1",
    ]);
    expect(errors).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("stops polling when aborted, disposes the target, and logs nothing", async () => {
    const { scene, mesh } = bakeScene();
    const gate = vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(false);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const abort = new AbortController();
    const pending = defaultBakeImpostor(mesh, scene, { signal: abort.signal });
    await new Promise((r) => setTimeout(r, 50));
    abort.abort();
    expect(await pending).toBeNull();
    const calls = gate.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(gate.mock.calls.length).toBe(calls);
    expect(errors).not.toHaveBeenCalled();
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
  });

  it("reads a compile failure where Babylon keeps it (a canary on the installed engine)", () => {
    const require = createRequire(import.meta.url);
    const subMesh = readFileSync(require.resolve("@babylonjs/core/Meshes/subMesh.pure.js"), "utf8");
    // The per-pass draw wrapper, looked up without creating one.
    expect(subMesh).toContain("    _getDrawWrapper(passId, createIfNotExisting = false) {");
    const effect = readFileSync(require.resolve("@babylonjs/core/Materials/effect.pure.js"), "utf8");
    expect(effect).toContain("    getCompilationError() {\n        return this._compilationError;");
    // An error is final only once every fallback has been tried.
    expect(effect).toContain("    allFallbacksProcessed() {\n        return this._allFallbacksProcessed;");
  });

  it("an abort ends the bake at the next poll: nothing rendered, the RTT gone", async () => {
    const { scene, mesh } = bakeScene();
    const loads = new AbortController();
    let polls = 0;
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockImplementation(() => {
      polls++;
      if (polls === 2) loads.abort();
      return false;
    });
    const renderSpy = vi.spyOn(RenderTargetTexture.prototype, "render");

    const texture = await defaultBakeImpostor(mesh, scene, { signal: loads.signal });

    expect(texture).toBeNull();
    expect(polls).toBe(2);
    expect(renderSpy).not.toHaveBeenCalled();
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
  });

  it("an abort during the wait ends the bake before it polls the torn-down scene again", async () => {
    const { scene, mesh } = bakeScene();
    const loads = new AbortController();
    let polls = 0;
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockImplementation(() => {
      polls++;
      // The teardown lands while the bake sleeps between polls; were the
      // next poll to run, it would find the scene ready and render into it.
      if (polls === 1) setTimeout(() => loads.abort(), 0);
      return polls > 1;
    });
    const renderSpy = vi.spyOn(RenderTargetTexture.prototype, "render");

    const texture = await defaultBakeImpostor(mesh, scene, { signal: loads.signal });

    expect(texture).toBeNull();
    expect(polls).toBe(1);
    expect(renderSpy).not.toHaveBeenCalled();
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
  });

  it("an abort before the bake starts polls nothing and renders nothing", async () => {
    const { scene, mesh } = bakeScene();
    const loads = new AbortController();
    loads.abort();
    const pollSpy = vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(true);
    const renderSpy = vi.spyOn(RenderTargetTexture.prototype, "render");

    const texture = await defaultBakeImpostor(mesh, scene, { signal: loads.signal });

    expect(texture).toBeNull();
    expect(pollSpy).toHaveBeenCalledTimes(0);
    expect(renderSpy).not.toHaveBeenCalled();
  });
});
