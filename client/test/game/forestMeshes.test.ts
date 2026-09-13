import { describe, it, expect, afterEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
// A value import, not a type-only one: the fadeBands tests spy on
// `Mesh.prototype.thinInstanceSetBuffer` (the clutterMeshes.test.ts idiom) —
// the impostor planes this file asserts about are built inside
// `createForestMeshes`, so there is no instance to spy on beforehand.
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
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
import { COHORT_GIANT, COHORT_LOG, COHORT_SNAG, type TreeInstance } from "../../src/sim/vegetation.js";
import { DistanceFadePlugin, fadeBands, fadeVisibility } from "../../src/game/distanceFadePlugin.js";
import {
  createForestMeshes,
  defaultBakeImpostor,
  type SpeciesMeshes,
} from "../../src/game/forestMeshes.js";

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
  // one): `adoptSpecies` gates both `attachWind` and the plugin-composition
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
    // Same shape as `ForestMeshesOptions.bakeImpostor`: `timeoutMs` is the
    // third parameter (the readiness-gate tests below pass it positionally)
    // and the optional bake pose is the fourth — the snag's billboard is baked
    // from an upright clone. Defaults to a null bake, which disables the
    // bucket: NullEngine render targets lie, so no test may rely on pixels.
    bakeImpostor: (
      mesh: Mesh,
      scene: Scene,
      timeoutMs?: number,
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

  /** A 1×1 stand-in for a successful bake. */
  function stubBakeTexture(scene: Scene): Texture {
    return RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
  }

  function impostorPlanes(scene: Scene): Mesh[] {
    return scene.meshes.filter((m) => m.name.startsWith("forest_impostor")) as Mesh[];
  }

  it("stays inside the 32-draw-call vegetation budget", () => {
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
    // draw calls: 2 giant species × 3 LODs × 2 siblings (12) + 2 sapling
    // species × 3 LODs × 2 siblings (12) + 2 understory (2) + 5 impostor
    // planes, 2 giants + 2 saplings + 1 snag (5) + 1 deadwood bucket (1) = 32.
    // The budget was raised 30 → 32 at one point when saplings and snags
    // gained billboards: three planes, immaterial against the 250-call frame
    // ceiling.
    const bucketMeshes = new Set<Mesh>();
    for (let k = 0; k < spy.mock.calls.length; k++) {
      if (spy.mock.calls[k]![0] === "matrix") bucketMeshes.add(spy.mock.instances[k] as Mesh);
    }
    const inventory = [...bucketMeshes].reduce((n, m) => n + m.subMeshes.length, 0);
    expect(inventory).toBe(32);
    expect(inventory).toBeLessThanOrEqual(32);

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
    expect(calls).toBe(22);
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
      // instance, both ends of that underside line must sit on the terrain
      // sampled AT THEIR OWN world x/z — not at the instance origin's x/z.
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
          expect(Math.abs(world.y - ground)).toBeLessThan(0.05);
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

    // Five billboards now: one per giant species, one per sapling
    // species, one for the snag cohort — see `impostorPlanes`.
    const impostors = scene.meshes.filter((m) => m.name.startsWith("forest_impostor"));
    expect(impostors.length).toBe(5);
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
    const { assets, forest } = build();
    const expected = new Set<Mesh>();
    for (const species of assets.giants) {
      // Each LOD stub is a bark+canopy sibling pair (`pairedBoxes`); the
      // production bucket — and so `casterMeshes` — is BOTH siblings, not
      // just the bark root the stub asset handle points at.
      const lodRoot = species.lods[0];
      expected.add(lodRoot);
      for (const child of lodRoot.getChildMeshes(false)) expected.add(child as Mesh);
    }
    expect(new Set(forest.casterMeshes)).toEqual(expected);
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
    expect(planes.length).toBe(5);
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
    expect(planes.length).toBe(5);
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
      if (mesh.name === "deadwood") {
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
      "forest_impostor_sapling_0",
      "forest_impostor_sapling_1",
      "forest_impostor_snag",
    ]);

    // The impostor plane is the one bucket whose bands are NOT constant, and
    // the reason `fadeBands` is per-instance at all: the on-lattice list and
    // the off-lattice fill list share one plane, one material and one bake
    // (five more meshes would break the draw-call budget), and they end at
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
    const { scene, forest } = build(undefined, (_mesh, s, _timeoutMs, pose) => {
      poses.push(pose ?? null);
      return stubBakeTexture(s);
    });
    forest.update(FOREST_CAM.x, FOREST_CAM.z);
    // Five bakes: 2 giant species, 2 sapling species, 1 snag.
    expect(poses.length).toBe(5);
    const posed = poses.filter((p): p is Quaternion => p !== null);
    expect(posed.length).toBe(1);
    // The snag alone is posed, by the same +90° roll `deadwoodMatrixBuffer`
    // applies — `deadwood.snag` is modelled lying down, and an un-posed bake
    // would billboard a felled trunk against a standing one.
    expect(posed[0]!.equalsWithEpsilon(Quaternion.FromEulerAngles(0, 0, Math.PI / 2), 1e-6)).toBe(
      true,
    );

    const named = (prefix: string) => scene.meshes.filter((m) => m.name.startsWith(prefix)).length;
    expect(named("forest_impostor_giant_")).toBe(2);
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
            expect(Math.abs(p.y - elevationAt(SEED, p.x, p.z))).toBeLessThan(0.12);
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
describe("defaultBakeImpostor readiness gate", () => {
  const engines: NullEngine[] = [];
  afterEach(() => {
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
    await defaultBakeImpostor(snag, scene, 5000, Quaternion.FromEulerAngles(0, 0, Math.PI / 2));

    expect(cameras.length).toBe(2);
    const extents = cameras.map((c) => [c.orthoRight! - c.orthoLeft!, c.orthoTop! - c.orthoBottom!]);
    expect(extents[0]![0]).toBeCloseTo(8, 4);
    expect(extents[0]![1]).toBeCloseTo(1, 4);
    expect(extents[1]![0]).toBeCloseTo(1, 4);
    expect(extents[1]![1]).toBeCloseTo(8, 4);
    // The pose is not allowed to survive on the caller's mesh.
    expect(snag.rotationQuaternion).toBeNull();
  });

  it("a gate that never opens times out to null and disposes the blank RTT", async () => {
    const { scene, mesh } = bakeScene();
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockImplementation(() => false);
    const renderSpy = vi.spyOn(RenderTargetTexture.prototype, "render");

    const texture = await defaultBakeImpostor(mesh, scene, 40);

    // Null (bucket stays disabled) beats baking — and shipping — a blank.
    expect(texture).toBeNull();
    expect(renderSpy).not.toHaveBeenCalled();
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
  });
});
