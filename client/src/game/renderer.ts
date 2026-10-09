import { Engine } from "@babylonjs/core/Engines/engine.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import type { SpotLight } from "@babylonjs/core/Lights/spotLight.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import type { RenderingManager } from "@babylonjs/core/Rendering/renderingManager.js";
import type { ObjectRenderer } from "@babylonjs/core/Rendering/objectRenderer.js";
import type { AsyncPipelines } from "./asyncPipelines.js";

import type { Level } from "../sim/level.js";
import type { Vec3, WorldState } from "../sim/types.js";
import { AiState } from "../sim/types.js";
import type { Forest } from "../sim/forest.js";
import { isHollow } from "../sim/hollow.js";
import { STARE_LENS_REST, stareSide, stepStareLens, type StareLens } from "./stareLens.js";
import { endingPose, type EndingBase, type EndingKind } from "./ending.js";
import { createShadeSilhouette } from "./shadeSilhouette.js";
import { CLOUD_GROUND_REBUILD_M, CLOUD_STEPS_HIGH, CLOUD_STEPS_MEDIUM, cloudDensityUnder, cloudGroundMap } from "./cloudParams.js";
import { createDroppedCap, droppedCapAt } from "./droppedItem.js";
import { CAP_SCENE_S, SHOTS, SUMMIT_SCENE_S, capPose, summitShot, type SceneBase, type SceneContext } from "./cutscene.js";
import { forestDensity } from "../sim/vegetation.js";
import { MAX_PLAYERS, PLAYER_EYE_OFFSET, PLAYER_HALF } from "../sim/constants.js";
import { createViewBob } from "./viewBob.js";
import { FOG_DISTANCE } from "../sim/forestConstants.js";
import { CHARACTER_IDS, EntityViews } from "./entityViews.js";
import { budgetLights, budgetMaterial, createHeadlamp, setLamp } from "./headlamp.js";
import { lampUnder } from "./lampParams.js";
import { windRecordUnder, type WindRecord } from "./windParams.js";
import { sharedSeconds } from "./oceanWindSea.js";
import { setFoliageWind, FOLIAGE_PLAYERS, FOLIAGE_PLAYER_PARKED } from "./foliagePlugin.js";
import {
  createRingSamples,
  holeCellsFor,
  ringGeometryBuffers,
  ringGeometrySlices,
  ringSampleSlices,
  commitRingMove,
  prepareRingMove,
  snapOrigin,
  BASE_SPACING,
  RING_COUNT,
  WEIGHTS2_STRIDE,
  type RingArrays,
  type RingGeometry,
  type RingMove,
  type RingSamples,
} from "./clipmap.js";
import { createCrossing, createSyncJobs, crossingAt, finish, stepSlices, type Slices, type SyncJobs } from "./syncJobs.js";
import { createLighting, DEFAULT_HOUR, sunAltitudeDeg, whenSkyHeld } from "./lighting.js";
import type { SkyState } from "./skyState.js";
import { luma } from "./colour.js";
import type { SkyTable } from "./skyTable.js";
import { startSkySource, type SkySource } from "./skyWorker.js";
import { createAtmosphere, releaseAtmosphere } from "./atmosphere.js";
import { createPost, fxSupportedBy } from "./post.js";
import { lensSmooth, lensStrengthUnder } from "./lensParams.js";
import { postFeaturesFor } from "./postParams.js";
import { createSkinShading } from "./skin.js";
import { attachTerrainTexture, enableRoadPaint, enableTrailPaint, enableFeaturePaint, setTerrainRain, setTerrainSward, setTerrainWetness } from "./terrainTexture.js";
import type { WeatherParams, WeatherPresetName } from "./weather.js";
import { ambientCollapseUnder, DEFAULT_WEATHER, wetSurfaceUnder } from "./weather.js";
import { detectTier, type QualityTier } from "./quality.js";
import { activeTerrainVariant, elevationAt, type LakeSource } from "../sim/terrain.js";
import { fbm2 } from "../sim/field.js";
import {
  createWaterRingSamples,
  updateWaterRingSamples,
  waterHoleCellsFor,
  waterRingGeometry,
  wetBounds,
  WATER_RING_COUNT,
  WATER_UV_SCALE,
  type WaterGeometry,
  type WaterRingSamples,
} from "./water.js";
import { SWASH_FACE_LIFT_M, SWASH_G } from "./swashRunUp.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { attachWater, type WaterPlugin } from "./waterPlugin.js";
import { createOcean } from "./oceanRender.js";
import { createWaterPlants } from "./waterPlants.js";
import { WATER_GROUP, createWaterFrame, waterFrameSupported } from "./waterFrame.js";
import { WATER_ROWS, lakeSkin, lakeWaterRow, waterSkinOffset } from "./waterShading.js";
import { attachWet, setWetCove, setWetLine, setWetSwash, setWetWeather, wetCapOf, wetLineFor, type WetBody } from "./wetPlugin.js";
import { SWELL_COMPONENTS } from "./oceanSwell.js";
import { swellPhases } from "./oceanWaves.js";
import { coastProfilesFor } from "./oceanTables.js";
import { COVE_FACE_GRADE, COVE_TOE_DEPTH, coveFor } from "../sim/olympic.js";
import { SwashTable, type SwashCove } from "./swashTable.js";
import { createSwashTexture } from "./swashTexture.js";
import { LIP_SPEED_MAX, LIP_SPEED_MIN, LipTracker, lipProfile } from "./oceanBreaker.js";
import { createOceanLip, type OceanLip } from "./oceanLip.js";
import { SURF_SPRAY_BURSTS, SURF_SPRAY_RANGE_M, createSurfSpray, type SurfSpray } from "./surfSpray.js";
import { SILENT_SURF_SOUND, createSurfSound, fillSurfSound, type SurfSound } from "./surfSound.js";
import {
  BED_GRID,
  bakeBed,
  bakeRows,
  bedNeedsRebake,
  bedOutsideSquare,
  bedSquareHasWater,
  beginBake,
  createBedGrid,
  POND_DISC_MARGIN,
  type BedBake,
} from "./bedHeight.js";
import { createForestMeshes, type BakePipelines, type ImpostorBake } from "./forestMeshes.js";
import { NEAR_RADIUS } from "./forestField.js";
import { createClutterMeshes } from "./clutterMeshes.js";
import type { CullPose } from "./grassCull.js";
import { createBladeMeshes } from "./bladeMeshes.js";
import { createDuffMeshes } from "./duffMeshes.js";
import { CLIFF_LOD_NODES, createCliffMeshes } from "./cliffMeshes.js";
import { createWildlifeMeshes } from "./wildlifeMeshes.js";
import type { PlayerPoint, WildlifeEvent } from "./wildlifeBehaviour.js";
import type { MatchState, View } from "./wildlifeDirector.js";
import type { ListenerPose } from "./ambientAudio.js";
import { createMistMeshes, type MistMeshes } from "./mistMeshes.js";
import { createRain, type Rain, type RainLamp } from "./rain.js";
import { createRainMap } from "./rainMap.js";
import { createRainSplash, type RainSplash } from "./rainSplash.js";
import { createMotes, type Motes } from "./motes.js";
import { createWaterLife, type WaterLife, type WaterLifeFrame } from "./waterLife.js";
import type { WaterLifeSound } from "./waterLifeAudio.js";
import { createPropMeshes, type MeshRegistry, type PropShadows } from "./propMeshes.js";
import { buildOrUndo } from "./rendererSwap.js";
import { calmShare, isRough, roughShare, smearPx, SLOPE_PAW_DEG } from "./lakeCalm.js";
import { createLakeMirror, createLakeMirrorTerrain, MIRROR_MOTION_SMEAR, mirrorMotion } from "./lakeMirror.js";
import { createLakePanorama, createSkylineTexture } from "./lakePanorama.js";
import { SKYLINE_SHADE, skylineElevations, skylineTrees } from "./lakeSkyline.js";
import { NEEDLE_BED } from "./terrainSurface.js";

const MATERIAL_COLORS: Record<string, [number, number, number]> = {
  concrete: [0.42, 0.44, 0.47],
  wall: [0.3, 0.32, 0.38],
  platform: [0.36, 0.42, 0.5],
  step: [0.4, 0.46, 0.54],
  crate: [0.55, 0.42, 0.26],
  pillar: [0.48, 0.36, 0.36],
  // The trailhead's car and kiosk, in the crate's and the pillar's colours
  // wherever their boxes are drawn.
  car: [0.55, 0.42, 0.26],
  kiosk: [0.48, 0.36, 0.36],
  signpost: [0.45, 0.33, 0.2],
  default: [0.5, 0.5, 0.5],
};

/**
 * Roughness per material name. Ideally roughness would vary across a
 * surface, which needs a texture or a node material; this step ships one value
 * per material and does not yet meet that rule. Recorded rather than glossed
 * over — it closes with the triplanar upgrade, where roughness comes from the
 * same projection as albedo.
 */
const MATERIAL_ROUGHNESS: Record<string, number> = {
  terrain: 0.95,
  default: 0.9,
};

/**
 * One material cache per scene, so `terrainMaterialFor` is usable from a test
 * that never builds a renderer. Weak, so disposing a scene does not leave its
 * materials reachable from module scope.
 */
const MATERIAL_CACHES = new WeakMap<Scene, Map<string, PBRMaterial>>();

function materialCacheFor(scene: Scene): Map<string, PBRMaterial> {
  const existing = MATERIAL_CACHES.get(scene);
  if (existing) return existing;
  const created = new Map<string, PBRMaterial>();
  MATERIAL_CACHES.set(scene, created);
  return created;
}

/**
 * One PBR material per name, cached.
 *
 * Terrain is the exception in the palette: its albedo stays white because the
 * mesh carries per-vertex colour, and PBR multiplies the two. Tinting the
 * material as well would apply the palette twice.
 */
export function terrainMaterialFor(scene: Scene, name: string): PBRMaterial {
  const cache = materialCacheFor(scene);
  const existing = cache.get(name);
  if (existing) return existing;

  const mat = new PBRMaterial(`mat_${name}`, scene);
  if (name === "terrain") {
    mat.albedoColor = new Color3(1, 1, 1);
    // Ground textures ride the terrain material only.
    attachTerrainTexture(scene, mat);
  } else {
    const rgb = MATERIAL_COLORS[name] ?? (MATERIAL_COLORS.default as [number, number, number]);
    mat.albedoColor = new Color3(rgb[0], rgb[1], rgb[2]);
  }
  // Nothing in this world is metal. Terrain, bark, foliage and stone are all
  // dielectric, and metallic ground is the classic PBR mistake — it reads as wet
  // plastic under any environment.
  mat.metallic = 0;
  mat.roughness = MATERIAL_ROUGHNESS[name] ?? (MATERIAL_ROUGHNESS.default as number);
  // Darker and glossy below the wet line of the nearest body (spec §6).
  attachWet(mat);
  // Base values recorded so wetness can scale them absolutely rather than
  // compounding a relative factor frame after frame.
  mat.metadata = {
    baseAlbedo: [mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b] as [number, number, number],
    baseRoughness: mat.roughness,
  };
  cache.set(name, mat);
  return mat;
}

/** The scales of a material the wet plugin's rule wets: its base, untouched. */
const WET_BY_PLUGIN = { albedoScale: 1, roughnessScale: 1 } as const;

/**
 * Wet ground reads darker and glossier. A uniform luminance scale on the
 * material albedo — deliberately not a hue tint, which would apply the palette
 * twice (see the comment on `terrainMaterialFor`); vertex colours are untouched.
 * Tree/prop asset materials are excluded by construction: they are not in this
 * cache. A cached material a prop box has given a porosity cap (`propMeshes.ts`)
 * is wetted by the wet plugin's rule instead, so it is held at its base here.
 */
export function applyWetness(scene: Scene, w: WeatherParams): void {
  const scales = wetSurfaceUnder(w);
  for (const mat of materialCacheFor(scene).values()) {
    const base = mat.metadata as
      | { baseAlbedo: [number, number, number]; baseRoughness: number }
      | null;
    if (!base) continue;
    const { albedoScale, roughnessScale } = wetCapOf(mat) > 0 ? WET_BY_PLUGIN : scales;
    mat.albedoColor.set(
      base.baseAlbedo[0] * albedoScale,
      base.baseAlbedo[1] * albedoScale,
      base.baseAlbedo[2] * albedoScale,
    );
    mat.roughness = base.baseRoughness * roughnessScale;
  }
}

/**
 * One updatable mesh per clipmap ring. White albedo + vertex colours, exactly
 * as chunk terrain was: PBR multiplies the two, so tinting the material as
 * well would apply the palette twice.
 */
export function createClipmapMesh(scene: Scene, name: string): Mesh {
  const mesh = new Mesh(name, scene);
  mesh.useVertexColors = true;
  mesh.material = terrainMaterialFor(scene, "terrain");
  mesh.receiveShadows = true;
  mesh.isPickable = false;
  return mesh;
}

/**
 * Uploads a ring's buffers. Exported because this wiring is exactly what
 * silently fails: colours computed and never uploaded look identical to
 * colours never computed, and nothing in the frame reports it.
 */
export function applyRingGeometry(mesh: Mesh, geometry: RingGeometry): void {
  const data = new VertexData();
  // Typed arrays straight through, NOT via Array.from. `VertexData` fields are
  // `FloatArray` (`number[] | Float32Array`) and `IndicesArray` (which includes
  // `Uint32Array`), so these assign directly — and `Geometry.setVerticesData`
  // converts a plain Array *back* to a Float32Array when `updatable` is set
  // (`geometry.js:185-188`). Going through Array.from would copy ~264k elements
  // per ring twice, once into boxed doubles, on the frame-sync path.
  data.positions = geometry.positions;
  data.indices = geometry.indices;
  // Smooth normals from the elevation field's analytic gradient, not Babylon's
  // per-face pass: `clipmap.ts` evaluates the same pure function on both sides
  // of every ring boundary, so shared edges match to the bit.
  data.normals = geometry.normals;
  data.colors = geometry.colors;
  // `updatable` is a DYNAMIC_DRAW hint, nothing more — it does NOT make this
  // rewrite in place. `setVerticesData` builds a new VertexBuffer and disposes
  // the old one on every call, because that is the only path `applyToMesh`
  // offers. The hint is still right: a ring's buffers are replaced wholesale
  // every time it scrolls, which for ring 0 is every 2 m of camera travel.
  data.applyToMesh(mesh, true);
  // Custom vertex attributes for the ground-texture plugin (terrainTexture.ts).
  // VertexData has no field for these, so they go on the mesh directly — same
  // typed arrays, same vertex order, uploaded with the rest of the buffers.
  // MUST come after applyToMesh above: applyToMesh disposes and rebuilds the
  // mesh's vertex buffers, so a setVerticesData call placed before it would
  // be discarded rather than merged.
  mesh.setVerticesData("terrainWeights", geometry.weights, true, 4);
  mesh.setVerticesData("terrainWeights2", geometry.weights2, true, WEIGHTS2_STRIDE);
  mesh.setVerticesData("terrainCover", geometry.cover, true, 1);
}

export type Clipmap = {
  /** One mesh per ring, coarsening outward. Also the whole shadow-caster set. */
  readonly meshes: readonly Mesh[];
  /** The first build, as slices: each ring sampled whole (one slice a ring,
   * its level told to `onRing` once it is), then every ring's geometry made
   * and uploaded as a rebuild's is. Run once, by whoever made the clipmap
   * `deferred`; before it, `update` does nothing. */
  firstBuild(onRing?: (level: number) => void): Slices;
  update(camX: number, camZ: number): void;
  /** The camera position the rings' buffers were last built for. */
  readonly view: { readonly x: number; readonly z: number };
  /** Vertices whose lifted height the last rebuild computed itself, over
   * every ring it moved; a move prepared ahead computed its own before.
   * For the tests. */
  readonly lifted: number;
  /** Ring moves the last rebuild took from moves prepared ahead. For the
   * tests. */
  readonly prepared: number;
  dispose(): void;
};

/** Ring 0's snap step (m): `snapOrigin` puts it on a lattice of twice its
 * 1 m spacing, and every coarser ring moves only when ring 0 does. */
const CLIPMAP_STEP = 2;

/** What uploading one ring's buffers takes (ms): about a millisecond a ring
 * in a browser profile of a walk, on the medium tier of an Apple M4. The
 * clipmap's job says so before its last slice (`syncJobs.ts`). */
const CLIPMAP_UPLOAD_MS = 1;

/**
 * The seven-ring clipmap that draws generated terrain, as a unit that owns its
 * ring state and re-emits what the camera invalidates.
 *
 * Split out of `createRenderer` so it is reachable from a test: `createRenderer`
 * builds a real `Engine`, which throws "WebGL not supported" under Node, but
 * this takes only a `Scene` and so runs on a `NullEngine`. The re-emit rule
 * below is the one genuinely subtle thing in the renderer, and leaving it
 * sealed inside a closure would have left it permanently untestable.
 *
 * Given `jobs`, a one-step crossing at a walk becomes a job (`syncJobs.ts`):
 * the rings move and re-emit in slices over the frames that follow, and every
 * ring that re-emits is uploaded in the job's last slice, together, so no
 * frame draws one ring moved against a neighbour that has not. Without it, and
 * at the crossings `crossingAt` builds at once, the whole rebuild runs in the
 * frame of the crossing, as it always did.
 *
 * Moving a ring is mostly sampling the strip it moves onto, a few
 * milliseconds a ring whatever its spacing, and where the camera crosses a
 * line of a coarse ring's lattice five or six rings move at once. So, as idle
 * work, the clipmap prepares each ring's next move ahead — onto the line the
 * camera, on its present heading, will reach first (`prepareRingMove`) — and
 * a rebuild that finds its move prepared from the ring as it stands commits
 * it in one step instead of sampling. What it commits is exactly what the
 * move would make; a guess the camera does not follow is dropped.
 */
export function createClipmap(scene: Scene, seed: number, jobs?: SyncJobs, options: { deferred?: boolean } = {}): Clipmap {
  const rings: RingSamples[] = [];
  const meshes: Mesh[] = [];
  /** The origins each ring's buffers were built from: its own, the finer
   * ring's (its hole) and the coarser ring's (its border blend). */
  const drawn: { x: number; z: number; fx: number; fz: number; cx: number; cz: number }[] = [];
  const crossing = createCrossing();
  const view = { x: 0, z: 0 };

  /**
   * Whether ring `level`'s buffers are stale: it moved, the finer ring inside
   * it moved (the hole in its index buffer follows the finer ring's
   * footprint), or the coarser ring outside it moved (its border blends to the
   * coarser ring's samples, `coarseHeight`).
   *
   * The last clause never adds an emit the first two do not already make:
   * `snapOrigin` puts ring L on a lattice of 2^(L+1), and any camera crossing
   * of a multiple of 2^(L+1) is also a crossing of 2^L, so a ring moving
   * always implies the ring inside it moved. It is kept so the rule reads off
   * what the buffers depend on rather than off that lattice fact: a job
   * dropped half done leaves some rings moved and none re-emitted, and the
   * next rebuild must still find every ring whose inputs changed since it
   * was last drawn.
   */
  function stale(level: number): boolean {
    const ring = rings[level] as RingSamples;
    const finer = level > 0 ? (rings[level - 1] as RingSamples) : null;
    const coarser = level < RING_COUNT - 1 ? (rings[level + 1] as RingSamples) : null;
    const d = drawn[level];
    return d === undefined || d.x !== ring.originX || d.z !== ring.originZ ||
      (finer !== null && (d.fx !== finer.originX || d.fz !== finer.originZ)) ||
      (coarser !== null && (d.cx !== coarser.originX || d.cz !== coarser.originZ));
  }

  /** Ring `level`'s buffers made again into `out`, in slices. */
  function geometrySlices(level: number, out: RingGeometry): Slices {
    const ring = rings[level] as RingSamples;
    const finer = level > 0 ? (rings[level - 1] as RingSamples) : null;
    // The border blends to the coarser ring's samples, so every ring must
    // have moved before any ring emits. The outermost ring meets nothing and
    // passes null. Ring 0 draws solid; every coarser ring cuts a hole where
    // the finer ring covers it.
    const coarser = level < RING_COUNT - 1 ? (rings[level + 1] as RingSamples) : null;
    return ringGeometrySlices(ring, finer === null ? null : holeCellsFor(ring, finer), coarser, out);
  }

  function markDrawn(level: number): void {
    const ring = rings[level] as RingSamples;
    const finer = level > 0 ? (rings[level - 1] as RingSamples) : null;
    const coarser = level < RING_COUNT - 1 ? (rings[level + 1] as RingSamples) : null;
    drawn[level] = {
      x: ring.originX, z: ring.originZ,
      fx: finer?.originX ?? NaN, fz: finer?.originZ ?? NaN,
      cx: coarser?.originX ?? NaN, cz: coarser?.originZ ?? NaN,
    };
  }

  /** The buffers each ring's mesh draws, and the ones its next re-emit
   * writes, swapped as it is uploaded: a job in progress never writes an
   * array a mesh holds. */
  const front: (RingGeometry | null)[] = [];
  const back: (RingGeometry | null)[] = [];
  /** The one spare set of sample arrays the rings' moves share
   * (`ringSampleSlices`). */
  const spare: RingArrays[] = [];
  let lifted = 0;
  let preparedUsed = 0;
  /** Each ring's next move, prepared ahead, or null. */
  const prepared: (RingMove | null)[] = [];
  /** The origin each ring is expected to move to next (NaN: none), which
   * `prepared` is worked out for. */
  const expectX = new Float64Array(RING_COUNT).fill(NaN);
  const expectZ = new Float64Array(RING_COUNT).fill(NaN);
  /** The camera's last move between two frames: its heading. */
  let headingX = 0;
  let headingZ = 0;

  /** Hands back a prepared move that is not for ring `level` as it stands,
   * going to (ox, oz) — or, with `onTheWay`, going part of the way there:
   * along one axis of a step that also goes along the other. */
  function dropPrepared(level: number, ox: number, oz: number, onTheWay = false): void {
    const p = prepared[level];
    if (p === null || p === undefined) return;
    const ring = rings[level] as RingSamples;
    if (p.moves === ring.moves) {
      if (p.originX === ox && p.originZ === oz) return;
      if (onTheWay && (p.originX === ox || p.originX === ring.originX) && (p.originZ === oz || p.originZ === ring.originZ)) return;
    }
    spare.push(p.arrays);
    prepared[level] = null;
  }

  /**
   * Where each ring moves next if the camera at (camX, camZ) keeps its
   * heading: across whichever of its lattice's lines, x or z, the camera
   * reaches first. Ring L's origin steps by 2·spacing as the camera crosses
   * origin + 64·spacing going down or origin + 66·spacing going up. Returns
   * whether any ring's expectation changed.
   */
  function expect(camX: number, camZ: number): boolean {
    let changed = false;
    for (let level = 0; level < RING_COUNT; level++) {
      const ring = rings[level] as RingSamples;
      const s = ring.spacing;
      const tx = headingX > 0 ? (ring.originX + 66 * s - camX) / headingX
        : headingX < 0 ? (camX - (ring.originX + 64 * s)) / -headingX : Infinity;
      const tz = headingZ > 0 ? (ring.originZ + 66 * s - camZ) / headingZ
        : headingZ < 0 ? (camZ - (ring.originZ + 64 * s)) / -headingZ : Infinity;
      let ex = NaN;
      let ez = NaN;
      if (tx < Infinity || tz < Infinity) {
        ex = tx <= tz ? ring.originX + Math.sign(headingX) * 2 * s : ring.originX;
        ez = tx <= tz ? ring.originZ : ring.originZ + Math.sign(headingZ) * 2 * s;
      }
      if (!Object.is(ex, expectX[level]) || !Object.is(ez, expectZ[level])) changed = true;
      expectX[level] = ex;
      expectZ[level] = ez;
    }
    return changed;
  }

  /** Idle work: each ring's expected move prepared, finer rings first. An
   * expectation a rebuild has since overtaken (the ring already stands
   * there) waits for `aim` to renew it. */
  function* prepare(): Slices {
    for (let level = 0; level < RING_COUNT; level++) {
      const ring = rings[level] as RingSamples;
      const ex = expectX[level] as number;
      const ez = expectZ[level] as number;
      if (Number.isNaN(ex) || (ex === ring.originX && ez === ring.originZ)) continue;
      dropPrepared(level, ex, ez);
      if (prepared[level] !== null) continue;
      prepared[level] = yield* prepareRingMove(ring, seed, ex, ez, spare);
    }
  }

  /** Re-aims the idle work at the camera's next moves, when they changed. */
  function aim(camX: number, camZ: number, force: boolean): void {
    if (jobs === undefined || jobs.pending(owner)) return;
    if (expect(camX, camZ) || force) jobs.idle(owner, prepare());
  }

  /** The rebuild for a camera at (camX, camZ): every ring's samples moved,
   * then each stale ring's buffers made, each in slices of its own, then all
   * of them uploaded in the last slice. */
  function* build(camX: number, camZ: number): Slices {
    let computed = 0;
    let used = 0;
    for (let level = 0; level < RING_COUNT; level++) {
      const ring = rings[level] as RingSamples;
      const ox = snapOrigin(camX, ring.spacing);
      const oz = snapOrigin(camZ, ring.spacing);
      // A ring that stays keeps its prepared move for when it does go.
      if (ox === ring.originX && oz === ring.originZ) continue;
      // A move prepared along one axis of a step along both — the camera
      // crossed an x line and a z line of the ring's lattice before its
      // rebuild ran — is committed, and the move samples only the rest of
      // the way: the samples are functions of where they are, so two moves
      // make what one would.
      dropPrepared(level, ox, oz, true);
      const p = prepared[level];
      if (p !== null && p !== undefined) {
        commitRingMove(ring, p, spare);
        prepared[level] = null;
        used++;
      }
      if (yield* ringSampleSlices(ring, seed, camX, camZ, spare)) computed += ring.lifted;
    }
    const made: number[] = [];
    for (let level = 0; level < RING_COUNT; level++) {
      if (!stale(level)) continue;
      const out = back[level] ?? ringGeometryBuffers(level > 0);
      back[level] = out;
      yield* geometrySlices(level, out);
      made.push(level);
    }
    // The uploads are one step, and the only long one.
    if (made.length > 0) yield CLIPMAP_UPLOAD_MS * made.length;
    for (const level of made) {
      applyRingGeometry(meshes[level] as Mesh, back[level] as RingGeometry);
      const drawnBefore = front[level] ?? null;
      front[level] = back[level] ?? null;
      back[level] = drawnBefore;
      markDrawn(level);
    }
    lifted = computed;
    preparedUsed = used;
    view.x = camX;
    view.z = camZ;
    // The rings stand somewhere new: aim the idle work at their next moves.
    if (!Number.isNaN(crossing.lastX)) aim(crossing.lastX, crossing.lastZ, true);
  }

  const owner = {};
  for (let level = 0; level < RING_COUNT; level++) {
    meshes.push(createClipmapMesh(scene, `clipmap_${level}`));
    front.push(null);
    back.push(null);
    prepared.push(null);
  }

  /** The rings sampled at the origin, one a slice, then built as `build`
   * builds them: the first build's sampling is the one `build` skips, since
   * a ring made at the origin already stands there. */
  function* firstBuild(onRing?: (level: number) => void): Slices {
    if (rings.length === RING_COUNT) return;
    for (let level = 0; level < RING_COUNT; level++) {
      rings.push(createRingSamples(seed, level, 0, 0));
      onRing?.(level);
      yield;
    }
    yield* build(0, 0);
  }
  if (options.deferred !== true) finish(firstBuild());

  // The terrain material is shared and seedless; the road's centerline table
  // is per world, so the clipmap, which knows the seed, turns it on.
  enableRoadPaint(scene, terrainMaterialFor(scene, "terrain"), seed);
  enableTrailPaint(scene, terrainMaterialFor(scene, "terrain"), seed);
  enableFeaturePaint(scene, terrainMaterialFor(scene, "terrain"), seed);

  return {
    meshes,
    firstBuild,
    update(camX, camZ) {
      if (rings.length < RING_COUNT) return;
      const hx = camX - crossing.lastX;
      const hz = camZ - crossing.lastZ;
      if ((hx !== 0 || hz !== 0) && !Number.isNaN(hx) && !Number.isNaN(hz)) {
        headingX = hx;
        headingZ = hz;
      }
      const kind = crossingAt(
        crossing, camX, camZ, snapOrigin(camX, BASE_SPACING), snapOrigin(camZ, BASE_SPACING), CLIPMAP_STEP,
        jobs !== undefined,
      );
      if (kind === "none") {
        aim(camX, camZ, false);
        return;
      }
      if (kind === "later") {
        (jobs as SyncJobs).begin(owner, build(camX, camZ));
        return;
      }
      jobs?.cancel(owner);
      finish(build(camX, camZ));
    },
    view,
    get lifted() {
      return lifted;
    },
    get prepared() {
      return preparedUsed;
    },
    dispose() {
      jobs?.cancel(owner);
      jobs?.idle(owner, null);
      for (const mesh of meshes) mesh.dispose();
    },
  };
}

/** Bump-texture UV drift per second — u and v deliberately unequal so the
 * ripples drift diagonally instead of tracking an axis. */
export const WATER_UV_SCROLL = [0.015, 0.011] as const;

/**
 * Runtime-generated 256² ripple normal map from `fbm2` finite differences.
 * The tile is NOT seamless — a mild seam every `WATER_UV_SCALE` metres under
 * motion is accepted at this fidelity bar (the motion is cosmetic);
 * the vertex ramp and low roughness dominate the read.
 */
function createWaterBump(scene: Scene): RawTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const f = 12 / size; // ~12 ripples per WATER_UV_SCALE tile
  const amp = 2.5;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const h0 = fbm2(x * f, z * f, 0x77aa, 3);
      const nx = (fbm2((x + 1) * f, z * f, 0x77aa, 3) - h0) * amp * size * f;
      const nz = (fbm2(x * f, (z + 1) * f, 0x77aa, 3) - h0) * amp * size * f;
      const inv = 1 / Math.hypot(nx, nz, 1);
      const at = (z * size + x) * 4;
      data[at] = Math.round((-nx * inv * 0.5 + 0.5) * 255);
      data[at + 1] = Math.round((-nz * inv * 0.5 + 0.5) * 255);
      data[at + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[at + 3] = 255;
    }
  }
  const tex = RawTexture.CreateRGBATexture(
    data,
    size,
    size,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/**
 * Uploads a water ring's buffers. Mirrors `applyRingGeometry` — same typed
 * arrays straight through, same `updatable` reasoning — plus the UV set the
 * scrolling bump texture samples, and what the vertex stage stitches the
 * ring's waves to the coarser ring's with (`oceanMorph`, `oceanCoarse`).
 */
function applyWaterGeometry(mesh: Mesh, geometry: WaterGeometry): void {
  const data = new VertexData();
  data.positions = geometry.positions;
  data.indices = geometry.indices;
  data.normals = geometry.normals;
  data.uvs = geometry.uvs;
  data.applyToMesh(mesh, true);
  mesh.setVerticesData("bedDepth", geometry.bedDepth, true, 1);
  mesh.setVerticesData("oceanMorph", geometry.oceanMorph, true, 1);
  mesh.setVerticesData("oceanCoarse", geometry.oceanCoarse, true, 2);
}

/** Rows of the bed grid baked per frame: a whole 256² grid measured 260 to 295 ms. */
const BED_ROWS_PER_FRAME = 1;

export type Water = {
  /** One mesh per ring, coarsening outward — seven draw calls, capped by design.
   * NEVER added to the shadow caster list: water neither casts nor receives. */
  readonly meshes: readonly Mesh[];
  /** One surface per lake (`lakeSurface`), static, on its lake's own material. */
  readonly lakeMeshes: readonly Mesh[];
  /** Each lake's material's water plugin, index-aligned with `lakeMeshes`:
   * what the lake's reflections and its calm are handed each frame. */
  readonly lakePlugins: readonly WaterPlugin[];
  /** True when the high tier's path is on: opaque in `WATER_GROUP`, reading the
   * opaque pass through the surface (`waterFrame.ts`), so a wet object's own
   * depth is attenuated by the water and the wet plugin need not darken it. */
  readonly high: boolean;
  /** Per frame: the camera's place, the sea's shared seconds and the hour (12 when absent), which the sea's waves read. */
  update(camX: number, camZ: number, seconds: number, hour?: number): void;
  /** Per frame from the wind record: the 0..1 speed and the direction it blows toward. */
  setWind(wind01: number, dir: [number, number]): void;
  /** Per frame from the weather: the rain, 0 to 1, that rings the surface. */
  setRain(rain: number): void;
  /** The sea's edge on the cove, made with the sea and moved by `update`. */
  readonly edge: SeaEdge;
  dispose(): void;
};

/**
 * The sea's edge on the cove (`docs/rendering/2026-10-08-sea-edge-design.md`):
 * the swash's table and the breaker's tracker on every tier, read by the sea's
 * sheet, the wet ground and the surf's sound; the swept curl and the spray on
 * the high tier alone. Everything here moves on the sea's shared seconds.
 */
export type SeaEdge = {
  /** The cove as the swash, the breaker and the shaders read it. */
  readonly cove: SwashCove;
  /** The swash's run-up a metre of shore, refilled by `Water.update`. */
  readonly table: SwashTable;
  /** The table as the sea's sheet reads it, uploaded after each fill. */
  readonly swash: { readonly texture: RawTexture; update(): void; dispose(): void };
  /** The plunging crests and this frame's plunges. */
  readonly tracker: LipTracker;
  /** The swept curl, on the high tier; null on the others. */
  readonly lip: OceanLip | null;
  /** The spray of the plunges, on the high tier; null on the others. */
  readonly spray: SurfSpray | null;
  /** The swell's significant height (m), as the sea's binding holds it (`swell[3]`). */
  readonly hs: number;
  /** Whether the table holds its first fill: until then the sea draws no
   * sheet and no curl, the wet ground keeps its still line and the surf is
   * silent. */
  readonly filled: boolean;
};

/** The see-through effects a camera moves among: rain (its streaks and
 * drips), its splashes, motes, the mist banks, the lake's insects and the
 * surf's spray. */
export type SeeThroughEffects = {
  rain: Rain | null;
  splash: RainSplash | null;
  motes: Motes | null;
  mist: MistMeshes | null;
  waterLife: WaterLife | null;
  spray?: SurfSpray | null;
};

/**
 * The rendering group the see-through effects draw in: the water's own on its
 * high path, else 0. They write no depth, so drawn in group 0 the opaque water
 * of group 1 would paint over them and its copy would show them under the
 * surface. In the water's group they draw after it (Babylon draws a group's
 * opaque meshes before its particles and transparent meshes), depth-tested
 * against it and against group 0's kept depth, and out of the copy.
 */
export function effectsGroupFor(water: Water | null): number {
  return water?.high === true ? WATER_GROUP : 0;
}

/**
 * The local headlamp as the rain reads it, into `out` (reused, never
 * allocated per frame): its world position and direction, which the lamp
 * computes from its parent's world matrix (the camera's), its intensity (0
 * when off), its cone angle and its colour.
 */
export function lampForRain(lamp: SpotLight, out: RainLamp): RainLamp {
  lamp.computeTransformedInformation();
  const pos = lamp.getAbsolutePosition();
  const dir = lamp.transformedDirection ?? lamp.direction;
  out.x = pos.x;
  out.y = pos.y;
  out.z = pos.z;
  out.dx = dir.x;
  out.dy = dir.y;
  out.dz = dir.z;
  out.intensity = lamp.intensity;
  out.angle = lamp.angle;
  out.r = lamp.diffuse.r;
  out.g = lamp.diffuse.g;
  out.b = lamp.diffuse.b;
  return out;
}

export function setEffectsGroup(group: number, effects: SeeThroughEffects): void {
  if (effects.rain !== null) {
    effects.rain.mesh.renderingGroupId = group;
    if (effects.rain.drips !== null) effects.rain.drips.renderingGroupId = group;
  }
  if (effects.splash !== null) effects.splash.mesh.renderingGroupId = group;
  for (const system of effects.motes?.systems ?? []) system.renderingGroupId = group;
  for (const mesh of effects.mist?.meshes ?? []) mesh.renderingGroupId = group;
  for (const mesh of effects.waterLife?.meshes ?? []) mesh.renderingGroupId = group;
  if (effects.spray != null) effects.spray.mesh.renderingGroupId = group;
}

/**
 * The sky behind a swarm seen level, 0 to 1, which the midges darken against
 * (`midgeSwarms.ts`): the luminance of the dome's horizon away from the sun
 * (`SkyState.horizonAway`), the side where a speck reads dark rather than
 * glinting. It is in the scene's adapted units with the cloud deck and the
 * night's floor already in it: 0.03 at night, 0.25 a quarter hour after
 * sunset, 0.53 at sunrise and sunset, 0.71 at clear noon, held at 1 in a clear
 * late afternoon (1.22 at 17:00). 0 before the sky's first slices.
 */
export function skyLumaOf(sky: SkyState | null): number {
  return sky === null ? 0 : Math.min(1, luma(sky.horizonAway));
}

/** The world size of one pixel a metre from the lens: the view's height at a
 * metre, `2·tan(fov / 2)`, over the render's height in pixels. */
export function pixelAtOneMetre(fov: number, renderHeight: number): number {
  return (2 * Math.tan(fov / 2)) / Math.max(1, renderHeight);
}

/** The lake's surface as its calm leaves it this frame (`lakeCalmUnder`). */
export type LakeCalmFrame = {
  /** The glass's share of the lake, 0 to 1: the calm share at the hour,
   * faded from one preset's to the next's, times what the rough leaves. */
  share: number;
  /** Past the rough's steps (`isRough`): rain, or a strong wind on an exposed lake. */
  rough: boolean;
  /** How rough the whole surface is, 0 to 1 (`roughShare`): the steps eased into ramps. */
  roughShare: number;
  /** How much of the lake the cat's-paws cover, 0 to 1: eased to 1 as it turns rough. */
  cover: number;
  /** The vertical smear (px) of the shore's image inside a full paw, for the frame's height and lens: the shader scales it by the paw mask. */
  smearPx: number;
};

/** The shelter at which the cat's-paws cover everything the glass leaves:
 * the clear high lake's (`lakeWaterRow` at murk 0). A sheltered lake's
 * cover is scaled down by its own shelter over this. */
export const PAW_COVER_SHELTER = 0.3;

/**
 * The glass's share at `hour` faded from `from` to the preset `to` by `t` (0
 * to 1, a weather fade's progress; exact at the ends, as `lerpWeather` is,
 * and a progress that is not a number is the start): `from` is a preset, or
 * the share a fade began at when it took over from another mid-way.
 */
export function fadedCalmShare(hour: number, from: WeatherPresetName | number, to: WeatherPresetName, t: number): number {
  const k = t > 0 ? Math.min(1, t) : 0;
  const a = typeof from === "number" ? from : calmShare(hour, from);
  const b = calmShare(hour, to);
  return k === 1 ? b : a + (b - a) * k;
}

/**
 * The lake's calm this frame into `out` (one record, refilled): the calm
 * share at `hour` faded from `from` (a preset, or the share a fade began at)
 * to the preset `to` by `t` (`fadedCalmShare`), the surface rough under `weather` and
 * the wind's 0..1 speed on a lake of `shelter`, the paws' cover
 * `(1 − share) · shelter / PAW_COVER_SHELTER`, and the smear of a paw's
 * slope for a frame `frameHeightPx` tall seen through `fov` (vertical,
 * radians). As the surface turns rough (`roughShare`, r) the share is
 * scaled by 1 − r and the cover eased to 1 by r: rough all over, the share
 * is 0 and the paws cover the lake.
 */
export function lakeCalmUnder(
  hour: number,
  from: WeatherPresetName | number,
  to: WeatherPresetName,
  t: number,
  weather: WeatherParams,
  wind01: number,
  shelter: number,
  frameHeightPx: number,
  fov: number,
  out: LakeCalmFrame,
): LakeCalmFrame {
  const share = fadedCalmShare(hour, from, to, t);
  const r = roughShare(weather, wind01, shelter);
  const cover = Math.min(1, Math.max(0, ((1 - share) * shelter) / PAW_COVER_SHELTER));
  out.rough = isRough(weather, wind01, shelter);
  out.roughShare = r;
  out.share = share * (1 - r);
  out.cover = cover + (1 - cover) * r;
  out.smearPx = smearPx(SLOPE_PAW_DEG, frameHeightPx, fov);
  return out;
}

/**
 * The colour the lake's reflections light their ground with (the terrain's
 * stand-in, `lakeMirrorColour`), into `out`: the forest floor's needle bed
 * under the sun on level ground and the fill, as `lighting.ts` sets them
 * from `sky`, the fill collapsing with the weather's dread as the lighting's
 * does.
 */
export function lakeMirrorColourOf(sky: SkyState, weather: WeatherParams, out: Color3): Color3 {
  const sun = sky.sunIntensity * Math.max(0, sky.sunDir.y);
  const fill = sky.fillIntensity * ambientCollapseUnder(weather);
  out.r = NEEDLE_BED.r * (sky.sunColour.r * sun + sky.fillColour.r * fill);
  out.g = NEEDLE_BED.g * (sky.sunColour.g * sun + sky.fillColour.g * fill);
  out.b = NEEDLE_BED.b * (sky.sunColour.b * sun + sky.fillColour.b * fill);
  return out;
}

/** The suffix of a cliff bucket's name at its coarsest LOD (`cliffMeshName`):
 * the ring the lake's reflections draw. */
const CLIFF_FAR_SUFFIX = `_l${CLIFF_LOD_NODES.length - 1}`;
/** The suffix of a cliff bucket's name at LOD1: the ring (to 160 m on high)
 * that holds a lake's shore stacks, which the high mirror draws as well. */
const CLIFF_LOD1_SUFFIX = "_l1";

/** `value` and every object it holds, frozen. */
function frozenThrough<T extends object>(value: T): T {
  for (const held of Object.values(value)) if (typeof held === "object" && held !== null) frozenThrough(held);
  Object.freeze(value);
  return value;
}

/** What a world without the lake's life sounds like, and a frame that did
 * not step it: nothing. Frozen through, as every caller is handed this one
 * object. */
const SILENT_WATER_LIFE: WaterLifeSound = frozenThrough({
  hums: [], hums_n: 0, pitch: 0, rustles: [], frogCalls: [],
  bed: { level: 0, duck: [1, 1], points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }] },
});

/** The mean of the lip's throw over the wave's speed (`LIP_SPEED_MIN`..`LIP_SPEED_MAX`): the spray's launch. */
const SPRAY_THROW = (LIP_SPEED_MIN + LIP_SPEED_MAX) / 2;

/** A player's position in their slot: the sim's own, y the body's centre. */
export type SlotPoint = { x: number; y: number; z: number };

export type PlayerSlots = {
  /**
   * Seats `players` and returns each slot's player's position, undefined for
   * an empty slot: one array, refilled in place by every call.
   */
  fill(players: ReadonlyMap<number, { readonly id: number; readonly pos: Vec3 }>): readonly (SlotPoint | undefined)[];
};

/**
 * `count` slots the players keep for as long as they are in the world, for
 * the lake's life, which keeps a head swarm and a speed by index: a list
 * rebuilt in the Map's order would close up when a player leaves and hand
 * theirs to the next. A player who leaves frees their slot; one who joins
 * takes the lowest slot free before this call, never one it freed, so a slot
 * stands empty for a frame between two players. Players past the last slot go
 * without. Allocates nothing per call beyond the Map's iterator.
 */
export function createPlayerSlots(count: number): PlayerSlots {
  const ids: number[] = new Array<number>(count).fill(0);
  const taken: boolean[] = new Array<boolean>(count).fill(false);
  const freed: boolean[] = new Array<boolean>(count).fill(false);
  const points: SlotPoint[] = [];
  for (let s = 0; s < count; s++) points.push({ x: 0, y: 0, z: 0 });
  const out: (SlotPoint | undefined)[] = new Array<SlotPoint | undefined>(count).fill(undefined);
  return {
    fill(players) {
      for (let s = 0; s < count; s++) {
        freed[s] = false;
        if (taken[s] && !players.has(ids[s]!)) {
          taken[s] = false;
          freed[s] = true;
          out[s] = undefined;
        }
      }
      for (const p of players.values()) {
        let at = -1;
        for (let s = 0; s < count; s++) {
          if (taken[s] && ids[s] === p.id) {
            at = s;
            break;
          }
        }
        if (at < 0) {
          for (let s = 0; s < count; s++) {
            if (!taken[s] && !freed[s]) {
              at = s;
              break;
            }
          }
          if (at < 0) continue;
          taken[at] = true;
          ids[at] = p.id;
        }
        const q = points[at]!;
        q.x = p.pos.x;
        q.y = p.pos.y;
        q.z = p.pos.z;
        out[at] = q;
      }
      return out;
    },
  };
}

/** Spacing (m) of a lake surface's vertices: fine enough that the per-vertex
 * depth follows the shelf and its drop. */
export const LAKE_SURFACE_SPACING = 2;

/**
 * One lake's surface: a flat polar grid over the lake at its level, rings from
 * the centre out to the rim plus `POND_DISC_MARGIN`, carrying the same
 * per-vertex `bedDepth` the ring meshes carry (`waterRingGeometry`), read from
 * the sim's own ground under each vertex, so the shelf, the drop and the marsh
 * draw as the sim has them. Where the ground stands above the water the
 * material discards, as it does on the sea's land. A disc, not a square: past
 * the rim the basin's apron blends back to the hillside, and on the downhill
 * side that ground lies below the lake's level, so a square's corners would
 * draw water hanging over the slope outside the lake. It carries the rings'
 * UVs, in world metres over `WATER_UV_SCALE`, so the ripple bump samples a
 * real tile and its pattern runs on from the rings'. Static: a lake's ground
 * does not scroll with the camera.
 *
 * Exported so it is reachable from a test without a full `createWater` call.
 */
export function lakeSurface(scene: Scene, mat: PBRMaterial, lake: LakeSource, seed: number, index: number): Mesh {
  const g = lakeSurfaceGrid(lake.radius + POND_DISC_MARGIN, lake.x, lake.z);
  const vertexCount = g.positions.length / 3;
  const depths = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const wx = lake.x + (g.positions[i * 3] as number);
    const wz = lake.z + (g.positions[i * 3 + 2] as number);
    depths[i] = Math.max(0, lake.level - elevationAt(seed, wx, wz));
  }
  const mesh = new Mesh(`pond_${index}`, scene);
  const data = new VertexData();
  data.positions = g.positions;
  data.normals = g.normals;
  data.uvs = g.uvs;
  data.indices = g.indices;
  data.applyToMesh(mesh, false);
  mesh.setVerticesData("bedDepth", depths, false, 1);
  mesh.position.set(lake.x, lake.level + 0.02, lake.z);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.metadata = { waterLevel: lake.level };
  // Culled by its box, as the sea's rings are: the default sphere-only test
  // keeps a disc in view from anywhere within its half-diagonal of its
  // centre, looking away or not, and the lake's mirror runs only while it is.
  mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_STANDARD;
  mesh.freezeWorldMatrix();
  return mesh;
}

/** A lake surface's rings and segments for an outer radius `ext`: rings no
 * further apart than `LAKE_SURFACE_SPACING`, and enough segments that the
 * outer ring's chord is no longer than it. */
export function lakeSurfaceShape(ext: number): { rings: number; segments: number } {
  return {
    rings: Math.ceil(ext / LAKE_SURFACE_SPACING),
    segments: Math.ceil((2 * Math.PI * ext) / LAKE_SURFACE_SPACING),
  };
}

/** The flat polar grid of radius `ext`, centred on the origin: the centre
 * vertex, then each ring's segments outward; a fan round the centre, quads
 * between rings, wound as `CreateGround` winds its faces, to face up. Its UVs
 * are the rings' (`waterRingGeometry`): the vertex's world position, the grid
 * standing at (`cx`, `cz`), over `WATER_UV_SCALE`. */
function lakeSurfaceGrid(
  ext: number, cx: number, cz: number,
): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const { rings, segments } = lakeSurfaceShape(ext);
  const vertexCount = rings * segments + 1;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  for (let v = 0; v < vertexCount; v++) normals[v * 3 + 1] = 1;
  for (let r = 1; r <= rings; r++) {
    const rad = (ext * r) / rings;
    for (let s = 0; s < segments; s++) {
      const a = (2 * Math.PI * s) / segments;
      const v = 1 + (r - 1) * segments + s;
      positions[v * 3] = rad * Math.cos(a);
      positions[v * 3 + 2] = rad * Math.sin(a);
    }
  }
  for (let v = 0; v < vertexCount; v++) {
    uvs[v * 2] = (cx + (positions[v * 3] as number)) / WATER_UV_SCALE;
    uvs[v * 2 + 1] = (cz + (positions[v * 3 + 2] as number)) / WATER_UV_SCALE;
  }
  const indices = new Uint32Array(segments * 3 + (rings - 1) * segments * 6);
  let k = 0;
  const at = (r: number, s: number): number => 1 + (r - 1) * segments + (s % segments);
  for (let s = 0; s < segments; s++) {
    indices[k++] = 0;
    indices[k++] = at(1, s);
    indices[k++] = at(1, s + 1);
  }
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = at(r, s), b = at(r, s + 1), c = at(r + 1, s), d = at(r + 1, s + 1);
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }
  return { positions, normals, uvs, indices };
}

/**
 * The seven-ring camera-following ocean surface. Same shape as `createClipmap`
 * — rings array, `emitRing`, moved-or-finer-moved re-emit — because the hole
 * in a coarser ring tracks the finer ring's footprint exactly as the terrain
 * clipmap's does. Takes only a `Scene` so it runs under `NullEngine`.
 *
 * `lakes` adds one surface per lake on its own material, drawn by its murk
 * (`lakeSurface`).
 *
 * The bed height texture is baked and uploaded here, at (`camX`, `camZ`), so no
 * frame is drawn with the material not ready (the plugin is not ready until it
 * has a texture); `update` then re-centres it a row a frame into a spare grid,
 * only where a body can reach the new square (`bedSquareHasWater`), and starts
 * over when the camera leaves the square a bake is for before it ends.
 *
 * On the high tier, where the engine can make the frame (`waterFrameSupported`:
 * WebGPU, a multisampled first pass, so the post chain must exist first), the
 * water is opaque in `WATER_GROUP` and reads the opaque pass behind it from the
 * frame; elsewhere, high included, it is the blended water of the medium tier.
 */
export function createWater(
  scene: Scene,
  seed: number,
  waterLevel: number,
  lakes: readonly LakeSource[] = [],
  tier: QualityTier = "medium",
  camX = 0,
  camZ = 0,
  now: () => number = () => performance.now(),
): Water {
  const high = tier === "high" && waterFrameSupported(scene);
  // White albedo is the plugin's business now: it sets the row's colour.
  const seaMat = new PBRMaterial("mat_water_sea", scene);
  seaMat.backFaceCulling = false;
  const seaPlugin = attachWater(seaMat, WATER_ROWS.sea);
  // The sea's skin stays off (x = 0); its offset seeds the white water's lace
  // and whitecaps (oceanShade.fragment.fx), so two worlds' foam differs.
  seaPlugin.skin = [0, waterSkinOffset(seed)];
  // The sea's waves, bound before any draw: the swell's tables and what moves
  // each frame. The lakes have none (no `OCEAN` on their materials).
  const ocean = createOcean(scene, seed, tier);
  ocean.bind(seaPlugin);
  // The wind as `setWind` last had it: the sea's waves are given it in
  // `update`, and the lakes' ripple drifts by it.
  let seaWind = 0;
  let seaWindDir: [number, number] = [1, 0];
  // One material per lake, on the row its murk gives (a world has at most one).
  const lakeMats = lakes.map((_, i) => {
    const mat = new PBRMaterial(`mat_water_lake_${i}`, scene);
    mat.backFaceCulling = false;
    return mat;
  });
  const lakePlugins = lakes.map((l, i) => attachWater(lakeMats[i] as PBRMaterial, lakeWaterRow(l.murk)));
  lakePlugins.forEach((p, i) => {
    p.skin = [lakeSkin((lakes[i] as LakeSource).murk), waterSkinOffset(seed)];
  });
  const plugins = [seaPlugin, ...lakePlugins];
  for (const mat of [seaMat, ...lakeMats]) {
    // High: the surface writes its own colour, the transmission read from the
    // frame's copy of what lies behind it. Otherwise one alpha blends it.
    mat.transparencyMode = high ? PBRMaterial.PBRMATERIAL_OPAQUE : PBRMaterial.PBRMATERIAL_ALPHABLEND;
    mat.needDepthPrePass = false;
  }
  budgetMaterial(seaMat);
  for (const mat of lakeMats) budgetMaterial(mat);

  // Every water mesh, rings and lake surfaces, filled below.
  const waterMeshes: Mesh[] = [];
  // The copy of the opaque pass, on the high tier. It follows the target's
  // size by itself, so the plugins hold its colour and its `screen` once.
  // It runs only in a frame whose culling kept a water mesh (the group also
  // holds rain, motes and mist).
  const inView = (): boolean => {
    const active = scene.getActiveMeshes();
    for (const mesh of waterMeshes) if (active.contains(mesh)) return true;
    return false;
  };
  // The frame points the plugins at its depth itself: a far placeholder
  // until its first copy, the resolved depth from then on.
  const frame = high ? createWaterFrame(scene, scene.getEngine(), inView, plugins) : null;
  if (frame !== null) {
    for (const p of plugins) {
      p.sceneTexture = frame.scene;
      p.screen = frame.screen;
    }
  }
  const group = high ? WATER_GROUP : 0;

  const bump = createWaterBump(scene);
  // The sea's normal is its waves' on high and medium (oceanSurface.fx): PBR's
  // bump stays on the low tier's sea alone, where it draws the wind sea, and on
  // every lake. The lakes' ripple drifts with the wind and the sea's does not,
  // so where both read one (the low tier) the lakes have a bump of their own.
  const lakeBump = tier === "low" && lakes.length > 0 ? createWaterBump(scene) : bump;
  if (tier === "low") seaMat.bumpTexture = bump;
  for (const mat of lakeMats) mat.bumpTexture = lakeBump;
  /** The scroll's speed, tiles a second: what a lake's ripple drifts at in a full wind. */
  const lakeDrift = Math.hypot(WATER_UV_SCROLL[0], WATER_UV_SCROLL[1]);

  // Cosmetic drift: scroll the bump's UV offset each frame by the clock's
  // delta, not per-frame constants, so the ripple speed survives
  // refresh-rate differences, and a scene's own clock (`now`) moves the
  // water in step with it, or holds it on a held frame. The low tier's sea
  // at a fixed rate; the lakes' downwind at the wind's speed (the sample
  // runs against the offset, so the offset runs upwind), as `setWind` last
  // had it.
  let last = now();
  const scroll = scene.onBeforeRenderObservable.add(() => {
    const at = now();
    const dt = Math.max(0, at - last) / 1000;
    last = at;
    if (tier === "low") {
      bump.uOffset += WATER_UV_SCROLL[0] * dt;
      bump.vOffset += WATER_UV_SCROLL[1] * dt;
    }
    if (lakes.length > 0) {
      lakeBump.uOffset -= seaWindDir[0] * seaWind * lakeDrift * dt;
      lakeBump.vOffset -= seaWindDir[1] * seaWind * lakeDrift * dt;
    }
  });

  const { texels, spacing } = BED_GRID[tier];
  let grid = createBedGrid(texels, spacing);
  let spare = createBedGrid(texels, spacing);
  let bake: BedBake | null = null;
  // The last square found out of every body's reach: not asked again until
  // the camera's square changes.
  let dryX = Number.NaN;
  let dryZ = Number.NaN;
  let firstUpdate = true;
  let bedTexture: RawTexture | null = null;
  function uploadBed(): void {
    if (bedTexture === null) {
      bedTexture = RawTexture.CreateRTexture(
        grid.heights,
        texels,
        texels,
        scene,
        false,
        false,
        Texture.NEAREST_SAMPLINGMODE,
        Constants.TEXTURETYPE_FLOAT,
      );
      bedTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
      bedTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
    } else {
      bedTexture.update(grid.heights);
    }
    // origin and texture change together, in this call, before any draw
    for (const p of plugins) {
      p.bedTexture = bedTexture;
      p.bedOrigin = [grid.originX, grid.originZ];
      p.bedTexels = texels;
      p.bedSpacing = spacing;
    }
  }
  for (const p of plugins) p.octaves = tier === "low" ? 1 : 2;
  // The first fill is at load, before any frame is shown: the whole grid at once.
  bakeBed(grid, seed, camX, camZ);
  uploadBed();

  const rings: WaterRingSamples[] = [];
  const meshes: Mesh[] = [];

  // A ring with no wet cell is off, and a wet ring's bounds are its wet
  // cells, not the whole plane: a plane at the level is in view from almost
  // anywhere, which would ask for the high tier's copy inland too. The
  // bounds hold the waves: `OCEAN_BOUND` past the wet cells every way, and
  // the stitch's move of up to a cell besides, across. Ground up to
  // `SWASH_FACE_LIFT_M` above the level counts as wet, so the rings that
  // cover the cove's face draw the swash up it.
  function emitRing(level: number): void {
    const ring = rings[level] as WaterRingSamples;
    const finer = level > 0 ? (rings[level - 1] as WaterRingSamples) : null;
    const mesh = meshes[level] as Mesh;
    const geometry = waterRingGeometry(ring, finer === null ? null : waterHoleCellsFor(ring, finer), waterLevel);
    applyWaterGeometry(mesh, geometry);
    const bounds = wetBounds(geometry, ring.h, SWASH_FACE_LIFT_M);
    mesh.setEnabled(bounds !== null);
    // Never refreshBoundingInfo after this: it would put back the whole plane.
    if (bounds !== null) mesh.setBoundingInfo(new BoundingInfo(Vector3.FromArray(bounds.min), Vector3.FromArray(bounds.max)));
  }

  for (let level = 0; level < WATER_RING_COUNT; level++) {
    rings.push(createWaterRingSamples(seed, level, camX, camZ));
    const mesh = new Mesh(`water_${level}`, scene);
    mesh.useVertexColors = false;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.material = seaMat;
    mesh.metadata = { waterLevel };
    mesh.renderingGroupId = group;
    // The wet box is what must be tested: the default sphere-only test never culls a camera inside the sphere.
    mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_STANDARD;
    meshes.push(mesh);
    emitRing(level);
  }

  // One surface per lake, on its own material. Static — no
  // ring-style re-emit, since a lake's ground does not scroll with the camera —
  // so they need no place in `meshes` (the doc'd one-per-ring,
  // shadow-caster-exempt set); they are disposed alongside it instead.
  const lakeMeshes: Mesh[] = lakes.map((l, i) => lakeSurface(scene, lakeMats[i] as PBRMaterial, l, seed, i));
  for (const mesh of lakeMeshes) mesh.renderingGroupId = group;
  waterMeshes.push(...meshes, ...lakeMeshes);

  // The sea's edge on the cove: the swash's table and the breaker's tracker
  // on the swell the sea draws (its tier's components), the table's texture
  // the sea's sheet reads, the spray on the high tier, and the swept curl on
  // the high tier's own path (WebGPU, where the FFT can draw the wind sea).
  // The curl shows only while the FFT does: in any other wind mode the
  // sea's fragment lip draws, and the two never draw together.
  const profiles = coastProfilesFor(seed);
  const coveOf = coveFor(seed);
  const cove: SwashCove = {
    z0: coveOf.z0,
    halfWidth: coveOf.halfWidth,
    toeD: -COVE_TOE_DEPTH / COVE_FACE_GRADE,
    faceGrade: COVE_FACE_GRADE,
    coastX: (z) => profiles.coastlineX(z),
  };
  const table = new SwashTable(ocean.field, cove);
  const swash = createSwashTexture(scene, table);
  const tracker = new LipTracker(ocean.field, cove);
  seaPlugin.setCove(cove.z0, cove.halfWidth, cove.toeD, cove.faceGrade);
  const lip = high ? createOceanLip(scene, () => seaMat, tracker, lipProfile(), cove, waterLevel) : null;
  if (lip !== null) {
    lip.fine.renderingGroupId = group;
    lip.coarse.renderingGroupId = group;
    // The high path's copy runs for a frame whose culling kept the curl too.
    waterMeshes.push(lip.fine, lip.coarse);
  }
  const spray = tier === "high" ? createSurfSpray(scene, group) : null;
  // The frame's phases of the sea's swell, the wind as the spray reads it,
  // and the plunges a frame has thrown spray for: made once, refilled.
  const edgePhases = new Float32Array(SWELL_COMPONENTS);
  const sprayWind: WindRecord = { dirX: 1, dirZ: 0, speed: 0, lean: 0, gustAmp: 0, flutterAmp: 0, time: 0 };
  const thrown = new Uint8Array(tracker.plunges.d.length);
  let filled = false;

  /**
   * Spray for this frame's plunges within SURF_SPRAY_RANGE_M of the camera,
   * nearest first, SURF_SPRAY_BURSTS at most: each thrown landward from the
   * crest's top at the lip's throw, the mean of 1.3 to 1.5 times the
   * shallow-water speed of a wave of the plunge's height. While the curl is
   * shown (made, and the FFT drawing the wind sea) it is thrown along the
   * swell's travel, as the curl throws its lip; otherwise along the face's
   * normal, as the sea's fragment lip, which draws then, tilts.
   */
  function throwSpray(sprayOf: SurfSpray, camX: number, camZ: number, seconds: number): void {
    const plunges = tracker.plunges;
    const curl = lip !== null && ocean.windMode === 2;
    const count = Math.min(plunges.count, thrown.length);
    thrown.fill(0, 0, count);
    for (let k = 0; k < SURF_SPRAY_BURSTS; k++) {
      let best = -1;
      let bestDist = SURF_SPRAY_RANGE_M;
      for (let i = 0; i < count; i++) {
        if (thrown[i] === 1) continue;
        const z = plunges.z[i] as number;
        const dist = Math.hypot(cove.coastX(z) + (plunges.d[i] as number) - camX, z - camZ);
        if (dist <= bestDist) {
          best = i;
          bestDist = dist;
        }
      }
      if (best < 0) return;
      thrown[best] = 1;
      const z = plunges.z[best] as number;
      const height = Math.max(0, plunges.height[best] as number);
      // The coast runs along z with the land toward +x: its landward normal.
      const slope = (cove.coastX(z + 1) - cove.coastX(z - 1)) / 2;
      sprayOf.burst(
        cove.coastX(z) + (plunges.d[best] as number), waterLevel + height, z,
        curl ? ocean.field.travel[0] : 1, curl ? ocean.field.travel[1] : -slope,
        SPRAY_THROW * Math.sqrt(SWASH_G * height), seconds,
      );
    }
  }

  const edge: SeaEdge = {
    cove,
    table,
    swash,
    tracker,
    lip,
    spray,
    get hs() {
      return seaPlugin.ocean?.swell[3] ?? 0;
    },
    get filled() {
      return filled;
    },
  };

  // Whether the last frame drew the sea: its culling kept one of the sea's
  // rings (never a disabled ring, one outside the frustum, or a lake).
  // `update` runs before this frame is culled, so this is the frame before's
  // answer, a frame late: the high tier's FFT is stepped only while it is
  // true, and the first frame the sea comes back into sight shows the last
  // field the FFT made.
  const seaDrawn = (): boolean => {
    const active = scene.getActiveMeshes();
    for (const mesh of meshes) if (active.contains(mesh)) return true;
    return false;
  };

  return {
    meshes,
    lakeMeshes,
    lakePlugins,
    high,
    update(camX, camZ, seconds, hour = 12) {
      const moved: boolean[] = [];
      for (let level = 0; level < WATER_RING_COUNT; level++) {
        moved.push(updateWaterRingSamples(rings[level] as WaterRingSamples, seed, camX, camZ));
      }
      // Moved-or-finer-moved, exactly as `createClipmap`: a ring that has not
      // moved itself can still be holding a hole cut for the finer ring's old
      // footprint. No outward clause needed for the same lattice reason.
      for (let level = 0; level < WATER_RING_COUNT; level++) {
        if (moved[level] || (level > 0 && (moved[level - 1] as boolean))) emitRing(level);
      }
      // The bed re-centres a row a frame into the spare grid (a whole 256²
      // bake is 260 to 295 ms) and swaps in when complete.
      if (firstUpdate) {
        // The camera's real start is only known now: if it is outside the grid
        // made at creation, fill the whole grid at once (at load, before the
        // first frame is shown) rather than draw ~256 frames on the wrong bed.
        firstUpdate = false;
        if (bakeBed(grid, seed, camX, camZ)) uploadBed();
      }
      // A bake whose square the camera has already left (a teleport, a fast
      // ride) would swap in a bed for somewhere else: start over. Only the
      // whole square counts: leaving its inner half is what starts a bake, and
      // dropping on that would never let steady motion finish one.
      if (bake !== null && bedOutsideSquare(bake.originX, bake.originZ, texels, spacing, camX, camZ)) bake = null;
      if (bake === null && bedNeedsRebake(grid, camX, camZ)) {
        const next = beginBake(spare, camX, camZ);
        // Where no body reaches the new square the current bed is kept: outside
        // it the ring's per-vertex depth stands in, and there is no water there.
        if (next.originX !== dryX || next.originZ !== dryZ) {
          if (bedSquareHasWater(next, spare, lakes, waterLevel, seed)) bake = next;
          else [dryX, dryZ] = [next.originX, next.originZ];
        }
      }
      if (bake !== null && bakeRows(spare, seed, bake, BED_ROWS_PER_FRAME)) {
        [grid, spare] = [spare, grid];
        bake = null;
        uploadBed();
      }
      for (const p of plugins) p.advance(seconds);
      ocean.update(camX, camZ, seconds, seaWind, seaWindDir, hour, seaDrawn());
      // The sea's edge, on the same seconds and swell, under the onshore
      // weight the ocean has just written for its wind sea (`windSeaStateFor`).
      swellPhases(ocean.field, seconds, edgePhases);
      table.update(seconds, edgePhases);
      tracker.update(seconds, edgePhases, seaPlugin.ocean?.windDir[3] ?? 0);
      swash.update();
      if (!filled) {
        // The sheet from the first fill on: an empty swash until then.
        filled = true;
        seaPlugin.setSwash(swash.texture);
      }
      if (lip !== null) {
        if (ocean.windMode === 2) {
          lip.update(camX, camZ);
        } else {
          lip.fine.setEnabled(false);
          lip.coarse.setEnabled(false);
        }
      }
      if (spray !== null) {
        throwSpray(spray, camX, camZ, seconds);
        spray.update(seconds, sprayWind);
      }
      // The copy's depth is linearised with the camera's planes, read each
      // frame: the active camera can change (the freecam, a cutscene).
      const camera = scene.activeCamera;
      if (frame !== null && camera !== null) {
        for (const p of plugins) {
          p.nearFar[0] = camera.minZ;
          p.nearFar[1] = camera.maxZ;
        }
      }
    },
    setWind(wind01, dir) {
      seaWind = wind01;
      seaWindDir = dir;
      sprayWind.speed = wind01;
      sprayWind.dirX = dir[0];
      sprayWind.dirZ = dir[1];
      for (const p of plugins) p.setWind(wind01, dir);
    },
    setRain(rain) {
      for (const p of plugins) p.rain = rain;
    },
    edge,
    dispose() {
      scene.onBeforeRenderObservable.remove(scroll);
      for (const mesh of meshes) mesh.dispose();
      for (const mesh of lakeMeshes) mesh.dispose();
      lip?.dispose();
      spray?.dispose();
      // The sea lets go of the table's texture first: it binds what it holds on its next draw.
      seaPlugin.setSwash(null);
      swash.dispose();
      // The wet ground's cove goes with the table: none until a sea's next fill.
      setWetCove(Number.NaN, 0, 0, 0);
      bump.dispose();
      if (lakeBump !== bump) lakeBump.dispose();
      bedTexture?.dispose();
      ocean.dispose();
      frame?.dispose();
      seaMat.dispose();
      for (const mat of lakeMats) mat.dispose();
    },
  };
}

/** The free camera's view; `fov` (rad, vertical) and `roll` (rad) are a film
 * shot's, absent for the game's own lens and no roll. */
export type FreecamView = { x: number; y: number; z: number; yaw: number; pitch: number; fov?: number; roll?: number };

/** The game's own lens (rad, vertical). */
export const GAME_FOV = 1.4;

/** This frame's view inputs that come from neither the world nor the clock. */
export type FrameView = { dt: number; sprinting: boolean };

/**
 * Fills `out` with a camera pose for the audio listener, in Babylon's world.
 *
 * yaw 0 faces +Z and positive pitch looks DOWN — the same convention
 * `UniversalCamera.rotation` carries and `viewBob.ts`'s right vector already
 * assumes — so forward is (sin yaw·cos pitch, −sin pitch, cos yaw·cos pitch) and
 * up is world up. Roll (the walking cue's) is deliberately dropped: it tilts the
 * image, not the ears.
 *
 * Pulled out of the closure below so the trigonometry — the part a sign error
 * hides in, and which would otherwise need a real WebGL canvas to reach — is
 * unit-testable on its own.
 */
export function writeListenerPose(
  out: ListenerPose,
  x: number, y: number, z: number,
  yaw: number, pitch: number,
): void {
  const cp = Math.cos(pitch);
  out.x = x;
  out.y = y;
  out.z = z;
  out.fx = Math.sin(yaw) * cp;
  out.fy = -Math.sin(pitch);
  out.fz = Math.cos(yaw) * cp;
  out.ux = 0;
  out.uy = 1;
  out.uz = 0;
}

export type Renderer = {
  scene: Scene;
  engine: AbstractEngine;
  camera: UniversalCamera;
  views: EntityViews;
  /** The shadow registry, for scenery placed once outside the renderer (the trailhead and the body). */
  shadows: PropShadows;
  /** The rain's cover map, for the same scenery: a mesh added is hard cover
   * (`rainMap.ts`); nothing on the tiers without a map. */
  cover: MeshRegistry;
  /** Resolves once the forest's first fill, billboards included, is drawn
   * (`ForestMeshes.ready`); at once in a world without a forest. */
  readonly forestReady: Promise<void>;
  /** Resolves once the sky's table holds the slices the lighting needs:
   * those either side of noon and of the hour the renderer is set to, read
   * again as each slice arrives (`whenSkyHeld`). Until then the lighting has
   * applied nothing, so no start draws a frame before it (the hike's, a
   * swap's, the scene routes', the tier check's) and the forest bakes no
   * billboard before it (`BakeOptions.sky`). Callers while it waits share
   * one wait; for a renderer disposed first it never resolves. */
  skyReady(): Promise<void>;
  /**
   * `frame` carries this frame's local, non-simulated view inputs — its
   * duration in seconds and whether sprint is held. Only the walking cue reads
   * them: its ease and landing dip are the one genuinely time-based part of the
   * render path, and sprint is input state the world snapshot does not carry.
   */
  sync(state: WorldState, localId: number, alpha: number, frame?: FrameView): void;
  /**
   * This frame's wildlife events, DRAINED: the shell's own list is emptied and
   * its contents handed over in a reused array, so calling this twice in a frame
   * yields the events once. Copying rather than returning the live list is what
   * makes that unambiguous — the alternative, handing out the shell's array and
   * clearing it later, has no moment at which "later" is both after the caller
   * read it and before the next `sync` appended to it. Empty for a
   * hand-authored level, which has no wildlife at all.
   */
  wildlifeEvents(): readonly WildlifeEvent[];
  /**
   * The wildlife director's own sighting log — `wildlifeMeshes.ts`'s
   * `directorLog()`, read straight through. Empty for a hand-authored level
   * (no wildlife shell at all) and empty for as long as nothing has been
   * arranged for the player to see; a test seam, not something `app.ts` reads.
   */
  wildlifeDirectorLog(): readonly number[];
  /**
   * Whether this world has a wildlife shell at all. False for a hand-authored
   * level, which has no forest and therefore no animals — and so nothing for the
   * audio shell to voice, no reason to fetch its clips, and no reason to write
   * the listener every frame.
   */
  readonly hasWildlife: boolean;
  /**
   * Whether this world has the lake's insects and frogs (`waterLife.ts`): a
   * forest world with a lake, the animals not turned off. False, `app.ts`
   * builds no audio for them.
   */
  readonly hasWaterLife: boolean;
  /**
   * The lake's life as heard on the last `sync` (`WaterLife.sound`): one
   * reused object, read by `app.ts` after each `sync`. Silent, never null,
   * without a lake, and after any `sync` that did not step it (the player's
   * branch with no local player), so no frame's calls are voiced twice.
   */
  waterLifeSound(): WaterLifeSound;
  /**
   * Whether this world has the sea's surf to hear (`surfSound.ts`): whether it
   * has a sea, on every tier, so a renderer swapped in on another tier says the
   * same. Fixed at the renderer's creation; false, `app.ts` builds no audio for it.
   */
  readonly hasSea: boolean;
  /**
   * The surf as heard on the last `sync`: one reused record, read by
   * `app.ts` after each `sync`. Silent and frozen (`SILENT_SURF_SOUND`), never
   * null, without a sea, before the swash's first fill and after any `sync`
   * that did not step it (the player's branch with no local player), so no
   * frame's plunges or backwash are voiced twice.
   */
  surfSound(): SurfSound;
  /**
   * Where the camera is and which way it looks, in Babylon's left-handed world
   * — `wildlifeAudio.ts` mirrors it for Web Audio. One reused object: this is
   * read every frame and its nine numbers are copied straight into AudioParams.
   */
  listener(): ListenerPose;
  /** The local player's stare as `sync` last stepped it, for the audio (stareAudio.ts). */
  stare(): StareLens;
  /** The chase's cast, 0 to 1 (escalation.ts): the grade pulls the frame toward burgundy by it. */
  setChase(cast: number): void;
  /** The haunt, 0 to 1 (escalation.ts): the pale mist at the player's sides comes in by it. */
  setHaunt(level: number): void;
  /** Hold the ground cloud's density at a level (0 to 1) whatever the night, or null to let the night set it; returns the density now drawn. */
  setMist(density: number | null): number;
  /** How far the mist has come in, 0 to 1 (acts.ts): the ground cloud rises by it, after the night. */
  setMistIn(level: number): void;
  /** The end for this player (ending.ts): the camera is the ending's from now, won or died. Once; a second call changes nothing. */
  setEnding(kind: EndingKind): void;
  /** A scene (cutscene.ts): the camera is the scene's from now; the summit's five shots for SUMMIT_SCENE_S (`at` the body, with the Hollow's feet and the party's eye); the cap's for CAP_SCENE_S, turned to it. */
  setScene(kind: "summit" | "cap", at: { x: number; y: number; z: number }, more?: { hollow: { x: number; y: number; z: number }; party: { x: number; y: number; z: number } }): void;
  /**
   * A world point as CSS pixels on the canvas, with its distance from the
   * camera, or null when it is behind the camera. Drives the interact prompt.
   */
  project(pos: Vec3): { x: number; y: number; depth: number } | null;
  resize(): void;
  dispose(): void;
  setFreecam(view: FreecamView | null): void;
  setWireframe(on: boolean): void;
  setSkinShading(on: boolean): void;
  setHour(hour: number): void;
  setWeather(next: WeatherParams, fadeSeconds?: number): void;
  /** The hour and the weather together, the weather at once, applied once
   * (`Lighting.setView`). */
  setView(hour: number, weather: WeatherParams): void;
  /** The weather preset the console set, which the lake's calm reads by
   * name (`calmShare`): its share fades from the last preset's to this one's
   * over `fadeSeconds` (3 absent, as `setWeather`'s), at once at 0. The
   * escalation's weather departs from it and keeps it. */
  setWeatherName(name: WeatherPresetName, fadeSeconds?: number): void;
  /** 0 switches the walking cue off; 1 is the tuned default. */
  setBobScale(scale: number): void;
  /** 0 silences the lens-side dread effects; 1 is full. */
  setUnsettle(level: number): void;
  /** The wind record computed by the last `sync` (weather-driven, or the
   * `/wind` override) — what `foliagePlugin.ts`'s players bend into and what
   * `ambientAudio.ts`'s wind bed hears. */
  wind(): WindRecord;
  /** How wet the canopy is, 0 to 1, as the rain stepped it on the last
   * `sync` (`canopyWaterStep`, `weather.ts`): what the drips are drawn from
   * and what `ambientAudio.ts`'s drip layer hears, one value for both. */
  canopyWater(): number;
  /** The canopy over the camera, 0 to 1, as the lens read it on the last
   * `sync` (`forestDensity`, read again once the camera has moved a metre):
   * what keeps the rain off the lens and what `ambientAudio.ts`'s drip layer
   * hears, one read for both. In freecam it is the camera's canopy, not the
   * player's: the drips hear what the lens sees. */
  canopyOver(): number;
  /** `null` restores the weather-driven speed; otherwise clamped to [0, 1]
   * and used in place of it (the `/wind` command). */
  setWindOverride(level: number | null): void;
  /** The far forest's billboard bakes as they stand (`ForestMeshes.impostorBakes`):
   * still baking, ready or failed, and how long each took. Empty without a
   * forest, or until its models have loaded. */
  impostorBakes(): readonly ImpostorBake[];
  /** Depth of field on or off, for a film shot's insert. The post chain has
   * no depth of field today, so this is nothing yet; the insert's blur is
   * the recording's. */
  setDepthOfField(on: boolean): void;
  /** The first clipmap build, for a renderer made with `deferClipmap`:
   * stepped, a macrotask between every `yieldEvery` slices so the page
   * paints between, each ring's level told to `onRing` as it is sampled.
   * Nothing to do without a forest, or once it has run; a renderer disposed
   * while it runs ends it quietly, no slice touching the scene it lost. */
  buildFirstClipmap(yieldEvery: number, onRing?: (level: number) => void): Promise<void>;
  /** The first clipmap build run whole, for a start with nothing to paint
   * between its slices. */
  buildClipmapNow(): void;
};

export type RendererOptions = {
  tier?: QualityTier;
  /** An engine already made for `canvas`: WebGPU on the tiers where it fits
   * (`engineChoice.ts`, `gpuEngine.ts`). Absent, the WebGL2 engine is made
   * here as always. Either way the renderer owns it and disposes it. */
  engine?: AbstractEngine;
  /** The pipelines that WebGPU engine makes asynchronously
   * (`asyncPipelines.ts`): its scene's rendering groups are their scope
   * (`scopeRenderingGroups`), its impostor bakes keep only a render that left
   * nothing out, and the renderer takes the patch off before its engine goes.
   * Absent on WebGL2, where nothing of it happens. */
  pipelines?: AsyncPipelines;
  /** The clock (ms) the wind, the post effects and everything that moves
   * with time read; `performance.now` absent. A scene stepped a frame at a
   * time hands in its own, so the grass and the water move in step with it. */
  clock?: () => number;
  /** Leave the clipmap's first build to `buildFirstClipmap` or
   * `buildClipmapNow`, so a start can step it between paints; the renderer
   * draws no terrain until one has run. Absent, it is built here as always. */
  deferClipmap?: boolean;
  /** The wildlife shell: absent or true, as the world's forest allows; false, none at
   * all (a scene recorded a frame at a time, which the director's own steps would not follow). */
  wildlife?: boolean;
  /** The sky's slices (`skyTable.ts`): the page's table, made once for its
   * life (`app.ts`) and handed to every renderer it builds, so a swap of
   * tier makes none of them again. Absent, the renderer starts a source of
   * its own (`startSkySource`) and stops it on dispose. */
  skyTable?: SkyTable;
};

/** What the impostor bakes read of the pipelines and the scope: the draws a
 * render left out, and the scope's guard around a render. None on WebGL2. */
function bakePipelines(pipelines: AsyncPipelines | null, scope: GroupScope | null): BakePipelines | undefined {
  if (pipelines === null || scope === null) return undefined;
  return { takeSkipped: () => pipelines.takeSkipped(), guarded: scope.guarded };
}

/**
 * Opens the scope of `pipelines` around each rendering group's draws in
 * `scene` (`onBeforeRenderingGroupObservable` to
 * `onAfterRenderingGroupObservable`, which bracket the mesh, sprite and
 * particle draws of every group, for the camera and for every render
 * target): a draw there may be left out while its pipeline is made. Clears,
 * post-processes and layers draw outside the groups and stay synchronous, so
 * no frame is shown without its final composite. A target drawn once
 * (`REFRESHRATE_RENDER_ONCE`, such as the reflection probe) is a render that
 * is kept, so its groups stay outside the scope too, on Babylon's synchronous
 * path.
 *
 * The scope cannot stay open: a throw inside a group skips the group's
 * after-observer, so every group still open is shut as each frame of the
 * scene begins (`onBeforeRenderObservable`), and a render outside the scene's
 * frames (the impostor bake's) goes through `guarded`, which shuts what its
 * render left open, even as it throws, inside the patch's own guard
 * (`AsyncPipelines.guard`): false where a draw left out escaped it and the
 * patch came off. Returns `off`, which takes the scope off, and `guarded`.
 */
export type GroupScope = { off(): void; guarded(render: () => void): boolean };

export function scopeRenderingGroups(scene: Scene, pipelines: Pick<AsyncPipelines, "enter" | "leave" | "guard">): GroupScope {
  /** The target that owns each rendering manager met, or null for the scene's own. */
  const owners = new WeakMap<RenderingManager, ObjectRenderer | null>();
  const drawnOnce = (manager: RenderingManager): boolean => {
    if (manager === scene.renderingManager) return false;
    let owner = owners.get(manager);
    if (owner === undefined) {
      owner = scene.objectRenderers.find((r) => r.renderingManager === manager) ?? null;
      owners.set(manager, owner);
    }
    return owner !== null && owner.refreshRate === RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  };
  /** Whether each group now open entered the scope, innermost last. */
  const open: boolean[] = [];
  const before = scene.onBeforeRenderingGroupObservable.add((info) => {
    const scoped = !drawnOnce(info.renderingManager);
    open.push(scoped);
    if (scoped) pipelines.enter();
  });
  const after = scene.onAfterRenderingGroupObservable.add(() => {
    if (open.pop() === true) pipelines.leave();
  });
  /** Shuts every group opened past the first `depth`, innermost first. */
  const shutTo = (depth: number): void => {
    while (open.length > depth) if (open.pop() === true) pipelines.leave();
  };
  const frame = scene.onBeforeRenderObservable.add(() => shutTo(0));
  return {
    off() {
      scene.onBeforeRenderingGroupObservable.remove(before);
      scene.onAfterRenderingGroupObservable.remove(after);
      scene.onBeforeRenderObservable.remove(frame);
    },
    guarded(render) {
      const depth = open.length;
      try {
        return pipelines.guard(render);
      } finally {
        shutTo(depth);
      }
    },
  };
}

/** The most polls a renderer's engine waits, past its `dispose`, for a scene's
 * BRDF lookup texture to finish expanding (`releaseEngine`). One browser
 * reading put the end of the expansion about 0.9 s after a renderer's build,
 * about 56 polls of 16 ms; this is a little over twice that. */
export const BRDF_SETTLE_POLLS = 125;

/** The wait between two of those polls. */
const BRDF_POLL_MS = 16;

/** Whether some scene of `engine` has a BRDF lookup texture still being
 * expanded: loading, or decoding from RGBD into half float. */
function brdfExpanding(engine: AbstractEngine): boolean {
  return engine.scenes.some((scene) =>
    [scene.environmentBRDFTexture, scene.environmentFuzzBRDFTexture].some(
      (texture) => texture !== null && texture !== undefined && texture.getInternalTexture()?.isReady === false,
    ),
  );
}

/**
 * Disposes `engine`, and its scenes with it, at once, or, while a scene's
 * BRDF lookup texture is still being expanded, as soon as that has finished,
 * checking every 16 ms, for at most `polls` checks.
 *
 * Every PBR material asks its scene for the BRDF lookup texture, and Babylon
 * makes it on first request, then expands it from RGBD into half float
 * through a post-process, asynchronously: the image loads, the decode
 * shader's module is imported, its effect compiles, and a callback renders
 * through `texture.getScene().postProcessManager`
 * (`RGBDTextureTools.ExpandRGBDTexture`). Dispose the scene before that
 * callback runs and the texture's scene is null by then: the callback throws a
 * TypeError inside a promise nothing handles, which prints as "Uncaught (in
 * promise)". That window is the first second or so of a renderer's life.
 *
 * So a renderer torn down inside it keeps its whole scene and its engine
 * alive until the expansion has finished. The parts the renderer disposes
 * itself are gone at once, in order, and nothing draws the scene; but what
 * lives in the scene lives on with it until it goes: model requests still in
 * flight go on downloading and parsing into it (the shells that asked for them
 * have already dropped them), and the ground maps go on downloading. A live
 * tier change builds the new renderer at once, so the old context stays alive
 * beside it, off the page, for as long as the expansion takes.
 *
 * The bound counts polls that run, not time since the dispose: the expansion
 * advances only while the main thread is free, and during a swap the new
 * renderer's build holds the thread for seconds on a slow machine, which a
 * bound in time would spend before the first poll. Once the polls run out the
 * engine goes regardless, and anything the expansion then throws is reported,
 * not hidden. An engine something else has already disposed is left alone.
 */
export function releaseEngine(engine: AbstractEngine, polls = BRDF_SETTLE_POLLS): void {
  if (engine.isDisposed) return;
  if (!brdfExpanding(engine)) {
    engine.dispose();
    return;
  }
  let left = polls;
  const poll = (): void => {
    if (engine.isDisposed) return;
    left--;
    if (brdfExpanding(engine) && left > 0) {
      setTimeout(poll, BRDF_POLL_MS);
      return;
    }
    engine.dispose();
  };
  setTimeout(poll, BRDF_POLL_MS);
}

/**
 * `forest` is null for hand-authored levels. Passing it alongside `level` rather
 * than instead of it keeps the brush path below working unchanged: a forest world
 * carries a stub level with an empty `brushes` array, so that loop is simply a
 * no-op and sandbox01 still draws the same geometry it always did. It is lit
 * differently now — there is one lighting path, and the sandbox takes it too.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  level: Level,
  forest: Forest | null = null,
  options: RendererOptions = {},
): Renderer {
  // The context is lost when the engine is disposed, so a renderer that is
  // replaced (a live tier change, the landing's backdrop giving way to the
  // game) frees every GPU object of its scene at once, including any the
  // scene failed to delete. An engine handed in (WebGPU) is owned the same
  // way: disposed with the renderer, or here when the build throws.
  const engine = options.engine ?? new Engine(canvas, true, { stencil: true, loseContextOnDispose: true }, true);
  try {
    // Every part the build has made is disposed, newest first, when a later
    // part throws: the same teardown `dispose` gives a whole renderer, so the
    // shells already loading models abort their loads rather than run on
    // against the scene the engine takes down below.
    return buildOrUndo((made) => buildRenderer(engine, level, forest, options, made));
  } catch (error) {
    // A build that throws part-way never hands back a renderer to dispose:
    // its engine (and the scene on it) and the atmosphere's global plugin
    // registration would outlive it, and the next renderer would meet them.
    releaseAtmosphere();
    releaseEngine(engine);
    throw error;
  }
}

function buildRenderer(
  engine: AbstractEngine,
  level: Level,
  forest: Forest | null,
  options: RendererOptions,
  made: (undo: () => void) => void,
): Renderer {
  const scene = new Scene(engine);
  /** Disposes `part` if a later part of the build throws. */
  const partOf = (part: { dispose(): void } | null): void => {
    if (part !== null) made(() => part.dispose());
  };
  // On a WebGPU engine that makes its pipelines asynchronously, the scene's
  // rendering groups are where a draw may be left out while its pipeline is
  // made. Taken off, and the patch with it, before the engine goes: here if
  // the build throws, in `dispose` otherwise.
  const pipelines = options.pipelines ?? null;
  const scope = pipelines === null ? null : scopeRenderingGroups(scene, pipelines);
  const releasePipelines = (): void => {
    scope?.off();
    pipelines?.remove();
  };
  made(releasePipelines);
  // Sun + fill already occupy two of every material's default four light
  // slots; without raising the cap, only the first two of the local lamp and
  // up to MAX_PLAYERS remote lamps ever light anything. Before any material
  // exists, so it also catches every material a GLB load adds later.
  budgetLights(scene);

  // Atmosphere plugin registration. BEFORE anything creates a material:
  // RegisterMaterialPlugin only reaches materials constructed after it runs.
  const atmosphere = createAtmosphere(scene, FOG_DISTANCE);

  const skinShading = createSkinShading(scene);
  partOf(skinShading);

  // Never call attachControl: this camera is driven entirely by sim state.
  const camera = new UniversalCamera("player", new Vector3(0, 2, 0), scene);
  camera.minZ = 0.05;
  // Far plane moves with the fog: the outermost ring's corner is
  // ~5.8 km out and the sky dome is 8 km across, so Babylon's default clips the
  // entire distant view away.
  camera.maxZ = 10000;
  camera.fov = GAME_FOV;

  // The local player's headlamp, camera-parented so it needs no per-frame
  // position write: a child of the camera inherits its rotation, so +Z local
  // is the view direction.
  const localLamp = createHeadlamp(scene, "lamp_local");
  localLamp.parent = camera;
  localLamp.position.set(0, 0, 0);
  localLamp.direction.set(0, 0, 1);
  partOf(localLamp);

  // The walking cue (`viewBob.ts`). Render-only: it offsets the eye, never the
  // sim position Interact traces from.
  const bob = createViewBob();

  // After the camera, deliberately. A UniversalCamera makes itself
  // `scene.activeCamera` when there is none, and several Babylon shadow settings
  // early-return while that is null. Nothing in `lighting.ts` depends on it
  // today, but the ordering costs nothing and removes the trap.
  //
  // Fog, clear colour, the sun and the ambient fill all live there now, for the
  // brush path as well as the forest — one lit world is worth more than the
  // sandbox's old dark clear colour.
  const tier = options.tier ?? detectTier(globalThis.navigator);
  // Who owns colour is decided once, before lighting and the post chain are
  // built, from the tier and the float-target capability.
  const postFeatures = postFeaturesFor(tier, fxSupportedBy(engine));
  // The sky's slices: the page's table or, given none, a source of this
  // renderer's own, started at the default hour (the slices either side of
  // noon come first whatever the hour) and stopped with the renderer.
  let ownSky: SkySource | null = null;
  let skyTable: SkyTable;
  if (options.skyTable !== undefined) {
    skyTable = options.skyTable;
  } else {
    ownSky = startSkySource(sunAltitudeDeg(DEFAULT_HOUR));
    skyTable = ownSky.table;
  }
  partOf(ownSky);
  const lighting = createLighting(scene, { tier, viewDistance: FOG_DISTANCE, colourPath: postFeatures.colourPath, sky: skyTable });
  partOf(lighting);
  /** Aborted on dispose, or as a build that throws is undone: a wait for the
   * sky then stops listening and never resolves. */
  const disposal = new AbortController();
  made(() => disposal.abort());
  /** The wait for the sky its callers share while it is pending, so a sky
   * that never comes is warned of once. */
  let skyWait: Promise<void> | null = null;
  /** `Renderer.skyReady`: the table holds what the lighting needs at the hour it is set to, read again at each slice. */
  const skyReady = (): Promise<void> => {
    skyWait ??= whenSkyHeld(skyTable, () => lighting.hour, { signal: disposal.signal }).then(() => {
      skyWait = null;
    });
    return skyWait;
  };
  const clock = options.clock ?? (() => performance.now());
  const post = createPost(scene, camera, postFeatures, { now: clock });
  partOf(post);
  let unsettle = 1;
  /** The rain on the lens, smoothed (lensParams.ts). */
  let lensStrength = 0;
  /** The local player's stare as their screen and ears take it (stareLens.ts). */
  let stareLens: StareLens = STARE_LENS_REST;
  /** The chase's cast (escalation.ts), as the app last set it. */
  let chaseCast = 0;
  /** What the ending asks of the pass: the picture's softness and the dark's closing, 0 to 1, posed after the pass reads them, so a frame late. */
  let endBlur = 0;
  let endClose = 0;
  /** The ending, once begun: its kind, when it began, and the pose it began from, taken on its first frame. */
  let ending: { kind: EndingKind; since: number; base: EndingBase | null } = { kind: "won", since: -1, base: null };
  /** The summit scene, while it plays: when it began, the eye it began from, and the body it looks at. */
  let summitScene: { kind: "summit" | "cap"; since: number; base: SceneBase | null; body: { x: number; y: number; z: number }; more: { hollow: { x: number; y: number; z: number }; party: { x: number; y: number; z: number } } | null } | null = null;
  /** The scene's lens this frame, or null for the game's; and the summit's shot, -1 outside one. */
  let sceneFov: number | null = null;
  let sceneShot = -1;
  const stareAt = new Vector3();
  // The forest's density over the camera, a full terrain sample: taken
  // again only once the camera has moved a metre from where it was taken.
  let lensCanopyX = Number.NaN;
  let lensCanopyZ = Number.NaN;
  let lensCanopy = 0;

  // A forest draws terrain instead of brushes. Guarded here rather than relying on
  // the caller to pass an empty level: app.ts passes the parsed sandbox01 so it
  // stays available as the fallback, and without this guard its 64x64 floor and
  // 6 m perimeter walls get drawn straight through the middle of the forest.
  const brushMeshes: Mesh[] = [];
  for (const [i, brush] of forest === null ? level.brushes.entries() : []) {
    const size = {
      x: brush.box.max.x - brush.box.min.x,
      y: brush.box.max.y - brush.box.min.y,
      z: brush.box.max.z - brush.box.min.z,
    };
    const mesh = MeshBuilder.CreateBox(
      `brush_${i}`,
      { width: size.x, height: size.y, depth: size.z },
      scene,
    );
    mesh.position.set(
      brush.box.min.x + size.x / 2,
      brush.box.min.y + size.y / 2,
      brush.box.min.z + size.z / 2,
    );
    mesh.material = terrainMaterialFor(scene, brush.material);
    mesh.freezeWorldMatrix();
    lighting.addShadowMesh(mesh);
    brushMeshes.push(mesh);
  }
  made(() => {
    for (const m of brushMeshes) m.dispose();
  });

  // The rebuilds a crossing starts — the terrain's rings, the ground cover's
  // lists — run as jobs over the frames after it, under a per-frame budget
  // (`syncJobs.ts`), rather than whole in the frame of the crossing. `sync`
  // runs this frame's share once every shell has seen the view.
  const jobs = createSyncJobs(() => performance.now());

  // ---- Generated terrain: geometry clipmap -------------------------------
  //
  // Rendering follows the CAMERA, kilometres out, with no chunk generation at
  // all — the rings sample the elevation field directly.
  // Collision chunks still follow the player through world.boxes, untouched.
  // Ring meshes are also the complete shadow-caster set: seven meshes,
  // bounded, which closes the old grows-without-bound caster list.
  const clipmap = forest === null ? null : createClipmap(scene, forest.seed, jobs, { deferred: options.deferClipmap });
  partOf(clipmap);
  if (clipmap !== null) {
    for (const mesh of clipmap.meshes) lighting.addShadowMesh(mesh);
  }

  // Water rides the same guard as the clipmap: hand-authored (brush) levels
  // have no forest, so they get no water either. A forest world gets
  // water exactly when its variant declares a sea level. Deliberately NOT
  // added to the shadow caster list — water neither casts nor receives.
  const waterLevel = forest === null ? undefined : activeTerrainVariant().waterLevel;
  const lakes: readonly LakeSource[] =
    forest !== null
      ? (activeTerrainVariant().waterBodies?.(forest.seed).filter((b): b is LakeSource => b.kind === "lake") ?? [])
      : [];
  const water =
    forest !== null && waterLevel !== undefined
      ? createWater(scene, forest.seed, waterLevel, lakes, tier, level.playerSpawns[0]?.x ?? 0, level.playerSpawns[0]?.z ?? 0, clock)
      : null;
  partOf(water);
  // A murky lake's reeds, cattails and lilies: placed by the sim, built here.
  const waterPlants = forest !== null && lakes.length > 0 ? createWaterPlants(scene, forest.seed, lakes) : null;
  partOf(waterPlants);
  // The midges, the dragonflies and the frogs of the world's lake: cosmetic
  // like the animals, so under their guard too (a scene recorded a frame at a
  // time has neither). None of their meshes casts a shadow. The midges are
  // toned for the frame's colour path, as the lighting's dome is.
  const firstLake = lakes[0];
  const waterLife =
    forest !== null && firstLake !== undefined && options.wildlife !== false
      ? createWaterLife(scene, forest.seed, firstLake, tier, postFeatures.colourPath)
      : null;
  partOf(waterLife);

  // The wet line follows the nearest body, sea or pond. No bodies, no call.
  const wetBodies: WetBody[] = [];
  if (forest !== null && waterLevel !== undefined) {
    wetBodies.push({ ...WATER_ROWS.sea, level: waterLevel, x: 0, z: 0, radius: Number.POSITIVE_INFINITY });
  }
  for (const l of lakes) {
    wetBodies.push({ ...lakeWaterRow(l.murk), level: l.level, x: l.x, z: l.z, radius: l.radius });
  }
  const updateWet = (x: number, z: number): void => {
    if (wetBodies.length === 0) return;
    const w = wetLineFor(wetBodies, x, z);
    // The wet plugin darkens below the level only where the water cannot
    // attenuate what stands in it by its own depth: everywhere but high's path.
    setWetLine(w, water?.high !== true);
    // The moving wet line on the cove: the cove and the swash's table for
    // every wet material (module-level, as the line is), once a frame from
    // the table's first fill.
    const edge = water?.edge;
    if (edge === undefined || !edge.filled) return;
    const cove = edge.cove;
    setWetCove(cove.z0, cove.halfWidth, cove.toeD, cove.faceGrade);
    setWetSwash(edge.table.data);
  };

  // The rain's cover map, on the tiers that draw one, over the terrain the
  // clipmap draws: the rings and the water are in it from here, the props
  // below and the scenery placed outside the renderer through `cover`, the
  // cliffs' near buckets once their GLBs land (the loop in `sync`).
  const rainMap = forest !== null ? createRainMap(scene, tier) : null;
  partOf(rainMap);
  if (rainMap !== null) {
    // The two inner rings cover the map's square (ring 0 alone is 128 m
    // across); the outer five are clipped whole and cost their draws on WebGL2.
    for (const mesh of clipmap?.meshes.slice(0, 2) ?? []) rainMap.register(mesh, "terrain");
    for (const mesh of water?.meshes ?? []) rainMap.register(mesh, "water");
    for (const mesh of water?.lakeMeshes ?? []) rainMap.register(mesh, "water");
    // Not the swept curl: its positions are not places, so the rings stand for the face.
  }
  // The lake's reflection of its shore, by tier: on high a mirror drawn in
  // each frame the glass shows (`lakeMirror.ts`), on medium a panorama of the
  // shore captured whenever the sky's probe is (`lakePanorama.ts`) under the
  // skyline, on low the skyline alone (`lakeSkyline.ts`). The lake's material
  // reads whichever there is; a world without a lake makes none of them.
  const lakeMesh = water?.lakeMeshes[0] ?? null;
  const lakePlugin = water?.lakePlugins[0] ?? null;
  const reflected = forest !== null && firstLake !== undefined && lakeMesh !== null && lakePlugin !== null;
  const lakeMirror = reflected && tier === "high" ? createLakeMirror(scene, firstLake, engine.isNDCHalfZRange) : null;
  partOf(lakeMirror);
  const lakePanorama = reflected && tier === "medium" ? createLakePanorama(scene, firstLake) : null;
  partOf(lakePanorama);
  const lakeSkyline =
    reflected && tier !== "high" ? createSkylineTexture(scene, skylineElevations(firstLake, forest.seed, skylineTrees(firstLake, forest.seed))) : null;
  partOf(lakeSkyline);
  // The ground in either: the five inner rings (to the ridges past ring 3's
  // 512 m) through a cheap lit stand-in, never the terrain's own material.
  // The mirror owns its own; the panorama's is made here.
  const panoramaTerrain = lakePanorama !== null ? createLakeMirrorTerrain(scene) : null;
  partOf(panoramaTerrain);
  const mirrorTerrain = lakeMirror?.terrainMaterial ?? panoramaTerrain;
  for (const mesh of clipmap?.meshes.slice(0, 5) ?? []) {
    lakeMirror?.register(mesh, mirrorTerrain);
    lakePanorama?.register(mesh, mirrorTerrain);
  }
  // The reeds and the lilies on their own materials; the midges and the
  // dragonflies move, so only the mirror drawn each frame holds them.
  for (const mesh of waterPlants?.meshes ?? []) {
    lakeMirror?.register(mesh, null);
    lakePanorama?.register(mesh, null);
  }
  for (const mesh of waterLife?.meshes ?? []) lakeMirror?.register(mesh, null);
  if (reflected) {
    lakePlugin.setLakeBody(firstLake.x, firstLake.level, firstLake.z, firstLake.radius);
    if (lakePanorama !== null) lakePlugin.setPanorama(lakePanorama.texture);
  }
  /** The lake's shelter (`lakeWaterRow`): how far its cat's-paws spread. */
  const lakeShelter = firstLake !== undefined ? lakeWaterRow(firstLake.murk).shelter : 0;
  const cover: MeshRegistry = {
    add: (mesh) => {
      rainMap?.register(mesh, "hard");
      // The shore's props stand in the lake's reflections as they are.
      lakeMirror?.register(mesh, null);
      lakePanorama?.register(mesh, null);
    },
    remove: (mesh) => {
      rainMap?.unregister(mesh);
      lakeMirror?.unregister(mesh);
      lakePanorama?.unregister(mesh);
    },
  };

  // Every chunk prop the sim collides with, drawn: the trailhead's placeholder
  // car, post and sign used to be pure collision boxes, an invisible wall no
  // player could see coming. Rides the same forest
  // guard as the water above it — hand-authored levels have no chunk grid.
  const propMeshes =
    forest !== null
      ? createPropMeshes(
          scene,
          forest.grid,
          (name) => terrainMaterialFor(scene, name),
          {
            // Direct method references, not pass-through arrows: `Lighting`'s
            // methods close over local state (the shadow generator) rather than
            // reading `this`, so nothing is lost by handing them over bare.
            add: lighting.addShadowMesh,
            remove: lighting.removeShadowMesh,
          },
          cover,
        )
      : null;
  partOf(propMeshes);

  // Trees ride the same guard as the clipmap and water: hand-authored levels
  // have no forest and get none. Low tier shrinks the near (full-geometry)
  // band; the impostor annulus grows to match.
  // NEAR_RADIUS · (140/240) — the low tier's ORIGINAL ratio against the near
  // band, preserved
  // rather than left as the stale literal 140: NEAR_RADIUS itself shrank
  // 240→120 across two retunes, and a fixed 140 low-tier override had
  // drifted to sit ABOVE the new default — an inversion where "low" quality
  // rendered farther than full. Deriving it as a fraction of NEAR_RADIUS
  // keeps the two coupled, so the next NEAR_RADIUS retune carries this along
  // automatically instead of silently re-inverting it again. Still 70 at the
  // current NEAR_RADIUS of 120.
  const lowTierNearRadius = Math.round(NEAR_RADIUS * (140 / 240));
  const forestMeshes =
    forest !== null
      ? createForestMeshes(scene, forest.seed, {
        nearRadius: tier === "low" ? lowTierNearRadius : undefined,
        pipelines: bakePipelines(pipelines, scope),
        // The billboards bake under the sky's light, never Babylon's defaults.
        sky: skyReady(),
        jobs,
      })
      : null;
  partOf(forestMeshes);
  // Forest shadow casters (the LOD0 bucket only) cannot be registered here: the GLBs load
  // asynchronously, so `casterMeshes` starts empty and fills once. sync()
  // below registers new entries as they appear — append-only, so a plain
  // high-water mark is enough.
  let forestCastersRegistered = 0;

  // Ground clutter rides the same guard as the forest above it: hand-authored
  // levels have no forest and get no grass, rocks, boulders, driftwood or
  // fungus. Low tier shrinks every class radius to 60%, the clutter analogue
  // of the forest's near-band tier rule. High and medium draw the blade field
  // over the meadow's near cards, which dither in from the eye beneath it;
  // low keeps the cards alone, whose 1.5× scaling is where blades resolve
  // worst. The same tiers cull the grass class's cards to the view, as the
  // blades are (the hook below); low draws them whole.
  const clutterMeshes =
    forest !== null
      ? createClutterMeshes(scene, forest.seed, {
        radiusScale: tier === "low" ? 0.6 : undefined,
        nearBlades: tier !== "low",
        cull: tier !== "low",
        jobs,
      })
      : null;
  partOf(clutterMeshes);
  // The near field of blade grass, on the tiers that can afford it; it
  // rebuilds on its own 1 m crossing and draws over the meadow's near cards
  // as detail rather than taking their place.
  const bladeMeshes = forest !== null && tier !== "low" ? createBladeMeshes(scene, forest.seed, { quality: tier, jobs }) : null;
  partOf(bladeMeshes);
  // The terrain's sward floor is the shaded ground between those blades, so it
  // runs exactly where they are drawn: off on the low tier. Without a forest
  // there is no clipmap, and the terrain material is not built for it.
  if (forest !== null) setTerrainSward(scene, terrainMaterialFor(scene, "terrain"), bladeMeshes !== null);
  // The near field of dead leaves, twigs and small branches, on the same
  // tiers as the blades beside it: what the grass field thins out, this fills
  // in, so the ground reads full rather than bare. Low tier draws neither.
  const duffMeshes = forest !== null && tier !== "low" ? createDuffMeshes(scene, forest.seed, { quality: tier, jobs }) : null;
  partOf(duffMeshes);
  // Rock-wall modules on the faces too steep to stand on, on every tier —
  // the field carries a ring set per tier. Renderer-only: it reads the
  // simulation and touches nothing in it.
  const cliffMeshes = forest !== null ? createCliffMeshes(scene, forest.seed, { quality: tier }) : null;
  partOf(cliffMeshes);
  // A failed GLB fetch rejects `ready`; log it once here so it is not an
  // unhandled rejection. The shell keeps working with whatever loaded — a
  // partial load just leaves the loaded model's buckets rebuilding, the
  // other model's buckets never appearing.
  cliffMeshes?.ready.catch((error: unknown) => {
    console.error(`cliff modules: keeping whatever loaded — ${String(error)}`);
  });
  // The blades and the grass class's cards are culled to the view here, once
  // the camera's pose for the frame is final (the view bob and the freecam
  // included) and before Babylon picks the active meshes; the shells refilter
  // only after a rebuild or when the view has moved past grassCull.ts's
  // thresholds. The pose is the render camera's own, not the fields' centre.
  const cullPose: CullPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 1.4, aspect: 1 };
  if (bladeMeshes !== null || clutterMeshes !== null) {
    scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
      const p = camera.globalPosition;
      cullPose.x = p.x;
      cullPose.y = p.y;
      cullPose.z = p.z;
      cullPose.yaw = camera.rotation.y;
      cullPose.pitch = camera.rotation.x;
      // The view bob's roll, which walking and sprinting put on the camera.
      cullPose.roll = camera.rotation.z;
      cullPose.fov = camera.fov;
      cullPose.aspect = engine.getAspectRatio(camera);
      bladeMeshes?.cull(cullPose);
      clutterMeshes?.cull(cullPose);
    });
  }
  // Same late-registration story as the forest's casters: the eleven clutter
  // GLBs load asynchronously, so the boulder buckets appear in `casterMeshes`
  // some frames after creation.
  let clutterCastersRegistered = 0;
  // The cliff modules' own GLBs, loaded independently of the clutter's.
  let cliffCastersRegistered = 0;
  // What the lake's reflections take of the forest and the cliffs as their
  // GLBs land, by the same high-water marks.
  let forestImpostorsReflected = 0;
  let forestLod2Reflected = 0;
  let cliffsReflected = 0;

  // Wildlife rides the forest guard like the clutter above it: hand-authored
  // levels have no forest and get no animals. Low tier scales every species'
  // disc to 60%, the same tier rule clutter takes. Its casters need no late
  // registration loop, unlike the two shells above: a creature's meshes come
  // and go with the animal, so the shell registers and unregisters each one
  // itself through the pair handed in here.
  const wildlife =
    forest !== null && options.wildlife !== false
      ? createWildlifeMeshes(scene, forest.seed, {
          radiusScale: tier === "low" ? 0.6 : undefined,
          now: clock,
          // The animals go to the shadows, and to the lake's mirror on high,
          // as they come and go.
          shadows: {
            add: (mesh) => {
              lighting.addShadowMesh(mesh);
              if (mesh instanceof Mesh) lakeMirror?.register(mesh, null);
            },
            remove: (mesh) => {
              lighting.removeShadowMesh(mesh);
              if (mesh instanceof Mesh) lakeMirror?.unregister(mesh);
            },
          },
        })
      : null;
  partOf(wildlife);

  // The player positions wildlife reacts to, rebuilt in place every frame: at
  // most five entries, and `stepUnit` runs over them once per unit per tick, so
  // this allocates nothing per frame beyond the Map iterator.
  // `wildlifePlayerPool` keeps the point objects alive across the truncation of
  // the view array handed to the shell.
  const wildlifePlayerPool: PlayerPoint[] = [];
  const wildlifePlayers: PlayerPoint[] = [];
  function playersOf(state: WorldState): readonly PlayerPoint[] {
    let n = 0;
    for (const p of state.players.values()) {
      let q = wildlifePlayerPool[n];
      if (q === undefined) {
        q = { x: 0, z: 0 };
        wildlifePlayerPool[n] = q;
      }
      q.x = p.pos.x;
      q.z = p.pos.z;
      wildlifePlayers[n] = q;
      n++;
    }
    wildlifePlayers.length = n;
    return wildlifePlayers;
  }

  // The drained event list and the listener pose, both reused across frames for
  // the same reason `wildlifePlayers` is: `app.ts` reads them once per frame and
  // copies out of them immediately, so one object each allocates nothing.
  const wildlifeEventDrain: WildlifeEvent[] = [];
  const listenerPose: ListenerPose = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0 };

  // The wildlife director's view of this frame, reused across both camera
  // paths below rather than a fresh object built at each call site — the
  // `wildlifePlayers` idiom again. `view` is filled from whichever position
  // is authoritative this frame (the sim's `local.pos`/`local.yaw`/`local.pitch`,
  // never the camera's own transform, which for the player path is still last
  // frame's until the view-bob offset below is computed); `match` from the
  // world state and the nearest Hollow.
  const wildlifeView: View = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 0, aspect: 0 };
  const wildlifeMatch: MatchState = { phase: 0, hollowDistance: Infinity, hollowHunting: false, inWorld: true, hour: 0, mist: 0 };
  const wildlifeDirectorArg = { view: wildlifeView, match: wildlifeMatch };
  /**
   * Finds the nearest Hollow (`isHollow`: `AiState` Emerge, Hunt, Stand or Watch) to
   * (x, z) and writes its distance and hunting state into `wildlifeMatch` —
   * `Infinity`/`false` when there is none. The woods go quiet near it and
   * fall silent outright while it hunts (`wildlifeDirector.ts`'s `relaxFor`):
   * a fiction requirement, not an optimisation, so a cue is never staged
   * competing with the one thing the player is supposed to be looking at.
   *
   * Nearest only: a second, farther Hollow actually hunting is masked by a
   * nearer one merely standing or emerging, which only relaxes the cadence
   * rather than silencing it outright. In practice there is one Hollow at a
   * time, so this is a known shape of the single-Hollow match rather than an
   * oversight, not a case this needs to handle today.
   */
  function findHollow(state: WorldState, x: number, z: number): void {
    let distance = Infinity;
    let hunting = false;
    for (const e of state.enemies.values()) {
      if (!isHollow(e)) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d < distance) { distance = d; hunting = e.ai === AiState.Hunt; }
    }
    wildlifeMatch.hollowDistance = distance;
    wildlifeMatch.hollowHunting = hunting;
  }

  // Mist rides the same guard as the forest: hand-authored levels get no
  // valley haze, and a forest world seeds the bank placement with the same
  // seed the forest and clipmap use.
  const mist = forest !== null ? createMistMeshes(scene, forest.seed, tier) : null;
  partOf(mist);

  // Rain is universal, unlike the forest-gated effects above: weather applies
  // to hand-authored levels too, and a disabled rain mesh is free.
  const rain = createRain(scene, tier);
  partOf(rain);
  rain.setMap(rainMap);
  // The splashes land on the map: a tier without one draws none.
  const rainSplash = createRainSplash(scene, tier);
  partOf(rainSplash);
  rainSplash?.setMap(rainMap);
  const rainLamp: RainLamp = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, intensity: 0, angle: 0, r: 1, g: 1, b: 1 };
  const motes = createMotes(scene, tier);
  partOf(motes);
  setEffectsGroup(effectsGroupFor(water), { rain, splash: rainSplash, motes, mist, waterLife, spray: water?.edge.spray ?? null });

  const views = new EntityViews(scene);
  // The haunt's shades: soft figures in a pale mist on the post tiers (the
  // mask the grade reads), the Hollow fading in and out on the low tier.
  const silhouette = forest !== null && postFeatures.pipeline ? createShadeSilhouette(scene, camera) : null;
  partOf(silhouette);
  views.softShades = silhouette !== null;
  // The ground cloud (cloudParams.ts): the night's mist as a volume the
  // atmosphere marches through, on the post tiers, resting on a height map
  // of the ground round the eye that is rebuilt as the eye moves.
  const cloudSteps = forest !== null && postFeatures.pipeline ? (postFeatures.halation ? CLOUD_STEPS_HIGH : CLOUD_STEPS_MEDIUM) : 0;
  // The missing hiker's cap, beside the trail (droppedItem.ts).
  const capGraph = forest !== null ? activeTerrainVariant().trailGraph?.(forest.seed) ?? null : null;
  const capAt = capGraph !== null && forest !== null ? droppedCapAt(capGraph, forest.seed) : null;
  const droppedCap = capAt !== null && forest !== null ? createDroppedCap(scene, capAt, elevationAt(forest.seed, capAt.x, capAt.z)) : null;
  partOf(droppedCap);
  let cloudGroundAt: { x: number; z: number } | null = null;
  let cloudHold: number | null = null;
  let cloudDensity = 0;
  let mistIn = 0;
  let hauntLevel = 0;
  partOf(views);
  // Fire and forget: the other hikers and the Hollow render as capsules until
  // this resolves, and a model that fails to load stays a capsule for good.
  // Only the rangers and the Hollow are fetched, not every character listed.
  void views.models.load(scene, CHARACTER_IDS);

  let freecam: FreecamView | null = null;

  // The `/wind` override, and the one wind record every moving thing reads —
  // recomputed once per `sync` below and read back by `wind()` and by
  // `app.ts`'s `ambient.setWind`. `windPlayers` is reused rather than
  // allocated per frame: `sync` runs every frame, and this is its only
  // per-frame array.
  let windOverride: number | null = null;
  let wind: WindRecord = windRecordUnder(lighting.weather, 0);
  const windPlayers = new Float32Array(FOLIAGE_PLAYERS * 3);

  // Each player in the slot they keep, for the lake's life.
  const playerSlots = createPlayerSlots(MAX_PLAYERS);
  // The lake's life's frame, reused across both camera paths as the
  // director's view is.
  const waterLifeFrame: WaterLifeFrame = {
    camX: 0, camY: 0, camZ: 0,
    tick: 0, dt: 0, time: 0,
    players: [],
    weather: lighting.weather, hour: lighting.hour, wind,
    sky: null, skyLuma: 0, pixelAt1m: 0,
    hollowDistance: Infinity,
  };
  /** Whether this frame's `sync` stepped the lake's life: the sound of a
   * frame that did not is silence, never the last stepped frame's calls and
   * rustles again. */
  let waterLifeStepped = false;
  /**
   * Steps the lake's life (`waterLife.ts`) from the camera as this frame's
   * branch has left it: its place and its lens, the players by their slots,
   * the shared seconds the swarms move on, the hour, the weather, the wind,
   * the sun, the sky behind a swarm, and the Hollow's distance from the
   * branch's own point (`findHollow`, run before it in both branches). After
   * the motes, in both branches; nothing without a lake.
   */
  function updateWaterLife(state: WorldState, dt: number, time: number, weather: WeatherParams, sky: SkyState | null): void {
    if (waterLife === null) return;
    const f = waterLifeFrame;
    f.camX = camera.position.x;
    f.camY = camera.position.y;
    f.camZ = camera.position.z;
    f.tick = state.tick;
    f.dt = dt;
    f.time = time;
    f.players = playerSlots.fill(state.players);
    f.weather = weather;
    f.hour = lighting.hour;
    f.wind = wind;
    f.sky = sky;
    f.skyLuma = skyLumaOf(sky);
    f.pixelAt1m = pixelAtOneMetre(camera.fov, engine.getRenderHeight());
    f.hollowDistance = wildlifeMatch.hollowDistance;
    waterLife.update(f);
    waterLifeStepped = true;
  }

  /** The surf as heard, one record refilled each frame (`surfSound.ts`), and where it is heard from. */
  const surf: SurfSound = createSurfSound();
  const surfListener = { x: 0, y: 0, z: 0 };
  /** Whether this frame's `sync` stepped the surf: the sound of a frame that
   * did not is silence, never the last stepped frame's plunges again. */
  let surfStepped = false;
  /**
   * Fills the surf's record from the sea's edge as this frame's `water.update`
   * left it, heard from the camera as this frame's branch has placed it, under
   * the canopy the lens read (`lensCanopy`). After the lake's reflections, in
   * both branches; nothing without a sea or before the swash's first fill.
   */
  function updateSurf(dt: number): void {
    const edge = water?.edge;
    if (edge === undefined || !edge.filled || waterLevel === undefined) return;
    surfListener.x = camera.position.x;
    surfListener.y = camera.position.y;
    surfListener.z = camera.position.z;
    fillSurfSound(surf, surfListener, edge.tracker, edge.table, edge.cove, waterLevel, edge.hs, lensCanopy, dt);
    surfStepped = true;
  }

  /** The lake's calm, one record refilled each frame (`lakeCalmUnder`). */
  const lakeCalm: LakeCalmFrame = { share: 0, rough: false, roughShare: 0, cover: 0, smearPx: 0 };
  // The eye's travel since the frame before, for the mirror's held frames'
  // smear: the eye last seen, whether one was, and the smoothed travel.
  const lastEye = new Vector3();
  let eyeSeen = false;
  let mirrorMotionM = 0;
  /** What the calm fades from (a preset, or the share a fade took over at)
   * and the preset it fades to, and the fade's length and progress (s):
   * `setWeatherName`. */
  let calmFrom: WeatherPresetName | number = DEFAULT_WEATHER;
  let calmTo: WeatherPresetName = DEFAULT_WEATHER;
  let calmFadeS = 0;
  let calmElapsedS = 0;
  /** The sky state the panorama was last armed under: the lighting makes a
   * new one at each apply that re-arms the sky's probe (`Lighting.sky`). */
  let panoramaSky: SkyState | null = null;
  /** A capture asked for once the panorama's target is ready to render: at
   * first, when every registered mesh can draw, and again whenever content
   * lands late (the forest's first fill settling, a billboard or a cliff
   * added to the panorama's list). The readiness walk runs only while one
   * is pending. */
  let panoramaPending = lakePanorama !== null;
  if (lakePanorama !== null) {
    // Settled either way: what landed is what the capture can draw.
    const landed = (): void => {
      panoramaPending = true;
    };
    void forestMeshes?.ready.then(landed, landed);
  }
  /** The low tier's forest colour under the skyline, and the reflections' ground colour: reused. */
  const skylineShade: [number, number, number] = [0, 0, 0];
  const mirrorColour = new Color3(0, 0, 0);
  /**
   * The lake's surface and reflection for the frame (`lakeCalm.ts`): the
   * calm share at the hour under the preset (through a fade), the surface
   * rough or not, the cat's-paws' cover and the smear at their edge; on high
   * the mirror armed when the lake's disc is in this frame's view of an `eye`
   * (false with no local player) and the glass shows, drawn this frame or
   * every third, and the weight 0 in any frame it is not armed (its image is
   * up to two frames stale); on
   * medium the panorama re-armed whenever the lighting hands over a new sky
   * state (the probe re-armed with it), and whenever content lands late and
   * its target is then ready to render (at first, the forest's first fill
   * settling, a billboard or a cliff bucket added to its list), and a
   * sector captured; the
   * skyline's forest colour from the sky, raw (the shader scales it). After
   * the camera is placed for the frame, in both branches, so a pass that
   * draws is from this frame's view and one that holds is at most two frames
   * behind it; nothing without a lake.
   */
  function updateLake(weather: WeatherParams, sky: SkyState | null, eye: boolean): void {
    if (lakePlugin === null || lakeMesh === null) return;
    if (calmFadeS > 0) {
      calmElapsedS += engine.getDeltaTime() / 1000;
      if (calmElapsedS >= calmFadeS) {
        calmFrom = calmTo;
        calmFadeS = 0;
      }
    }
    const fade = calmFadeS > 0 ? calmElapsedS / calmFadeS : 1;
    const c = lakeCalmUnder(lighting.hour, calmFrom, calmTo, fade, weather, wind.speed, lakeShelter, engine.getRenderHeight(), camera.fov, lakeCalm);
    // This frame's frustum, the camera placed for the frame: never a frame
    // late. Without an eye the lake is in no view.
    let inView = false;
    if (eye) {
      camera.getViewMatrix();
      camera.getProjectionMatrix();
      lakeMesh.computeWorldMatrix();
      inView = camera.isInFrustum(lakeMesh);
    }
    // Without a mirror the weight is 1 until the surface is rough all over,
    // where the ramped share has already reached 0: no step in the image.
    const armed = lakeMirror !== null ? lakeMirror.update(camera, inView, c.share) : c.roughShare < 1;
    lakePlugin.setLakeTime(wind.time);
    lakePlugin.setPawCover(c.cover);
    lakePlugin.setCalm(c.share, armed ? 1 : 0, c.smearPx);
    // The mirror is read only while armed: drawn this frame, or holding the last image.
    if (lakeMirror !== null) lakePlugin.setMirror(armed ? lakeMirror.texture : null, lakeMirror.viewProjection);
    // The held frames' lag as the eye's travel over them, smoothed, as the
    // smear's pixels times metres: none when the eye is still, none on the
    // tiers without a mirror.
    if (lakeMirror !== null) {
      const eyeStep = eye && eyeSeen ? Vector3.Distance(camera.position, lastEye) : 0;
      lastEye.copyFrom(camera.position);
      eyeSeen = eye;
      mirrorMotionM = mirrorMotion(mirrorMotionM, eyeStep);
      lakePlugin.setMirrorMotion(MIRROR_MOTION_SMEAR * mirrorMotionM * engine.getRenderHeight());
    }
    let capturing = false;
    if (lakePanorama !== null) {
      const skyMoved = sky !== null && sky !== panoramaSky;
      if (skyMoved) panoramaSky = sky;
      const nowReady = panoramaPending && lakePanorama.texture.isReadyForRendering();
      if (nowReady) panoramaPending = false;
      // A rearm mid-capture continues the turn: once a frame at most.
      if (skyMoved || nowReady) lakePanorama.rearm();
      capturing = lakePanorama.update();
    }
    if (sky === null) return;
    if (lakeSkyline !== null) {
      skylineShade[0] = sky.horizonAway.r * SKYLINE_SHADE;
      skylineShade[1] = sky.horizonAway.g * SKYLINE_SHADE;
      skylineShade[2] = sky.horizonAway.b * SKYLINE_SHADE;
      lakePlugin.setSkyline(lakeSkyline, skylineShade);
    }
    if (lakeMirror !== null && armed) {
      lakeMirrorColourOf(sky, weather, mirrorColour);
      lakeMirror.setTerrainColour(mirrorColour.r, mirrorColour.g, mirrorColour.b);
    }
    if (panoramaTerrain !== null && capturing) {
      panoramaTerrain.setColor3("lakeMirrorColour", lakeMirrorColourOf(sky, weather, mirrorColour));
    }
  }

  return {
    scene,
    engine,
    camera,
    views,
    shadows: { add: lighting.addShadowMesh, remove: lighting.removeShadowMesh },
    cover,
    forestReady: forestMeshes?.ready ?? Promise.resolve(),
    skyReady,
    sync(state, localId, alpha, frame = { dt: 0, sprinting: false }) {
      // Nothing has stepped the lake's life or the surf this frame yet.
      waterLifeStepped = false;
      surfStepped = false;
      // Weather follows the fade, so surfaces wet and dry smoothly. A handful
      // of materials x four property writes: cheap enough to do every frame.
      // Read once: `lighting.weather` is a getter that allocates a fresh copy
      // per call, and this reads it several times a frame otherwise. Read
      // BEFORE the views sync, which needs the lamp state derived from it.
      const weather = lighting.weather;
      const seconds = clock() / 1000;
      // The sea's time, and the wind's: the simulation's tick and this frame's
      // fraction of the next, so every peer's waves break together and its
      // wind sea blows the same way. A scene that hands in its own clock keeps it.
      const oceanSeconds = options.clock !== undefined ? seconds : sharedSeconds(state.tick, alpha);
      const lampState = lampUnder(weather, seconds);
      // The one wind record every moving thing reads this frame: the
      // weather-driven speed, or the `/wind` override in its place. The
      // players bend it — `windPlayers` is reused, not allocated, and absent
      // slots are parked far off in XZ so the bend never reaches them.
      wind = windRecordUnder(weather, oceanSeconds, windOverride ?? undefined);
      let n = 0;
      windPlayers.fill(0);
      for (let i = 0; i < FOLIAGE_PLAYERS; i++) {
        windPlayers[i * 3] = FOLIAGE_PLAYER_PARKED;
        windPlayers[i * 3 + 2] = FOLIAGE_PLAYER_PARKED;
      }
      for (const p of state.players.values()) {
        if (n === FOLIAGE_PLAYERS) break;
        windPlayers[n * 3] = p.pos.x;
        windPlayers[n * 3 + 1] = p.pos.y;
        windPlayers[n * 3 + 2] = p.pos.z;
        n++;
      }
      setFoliageWind(wind, windPlayers);
      water?.setWind(wind.speed, [wind.dirX, wind.dirZ]);
      views.sync(state, localId, alpha, lampState, frame.dt);
      if (silhouette !== null) {
        silhouette.sync(views.shades());
        post.setShades(silhouette.texture, silhouette.any());
      }
      if (cloudSteps > 0 && forest !== null) {
        if (cloudGroundAt === null || Math.hypot(camera.position.x - cloudGroundAt.x, camera.position.z - cloudGroundAt.z) > CLOUD_GROUND_REBUILD_M) {
          cloudGroundAt = { x: camera.position.x, z: camera.position.z };
          const trailAt = activeTerrainVariant().trailDistance;
          atmosphere.setCloudGround(cloudGroundMap((x, z) => elevationAt(forest.seed, x, z), cloudGroundAt.x, cloudGroundAt.z, trailAt === undefined ? null : (x, z) => trailAt(forest.seed, x, z)));
        }
        cloudDensity = cloudHold ?? cloudDensityUnder(lighting.sky?.night ?? 0, hauntLevel, chaseCast) * mistIn;
        atmosphere.setCloud(cloudDensity, cloudSteps, seconds, hauntLevel);
      }

      // Late caster registration: the forest's LOD0/1 buckets exist only once
      // its GLBs have loaded, so new entries are picked up here.
      if (forestMeshes !== null) {
        for (; forestCastersRegistered < forestMeshes.casterMeshes.length; forestCastersRegistered++) {
          lighting.addShadowMesh(forestMeshes.casterMeshes[forestCastersRegistered] as Mesh);
        }
      }
      // Clutter's casters are its boulder buckets only — everything else is
      // sub-metre set dressing that never enters the shadow map.
      if (clutterMeshes !== null) {
        for (; clutterCastersRegistered < clutterMeshes.casterMeshes.length; clutterCastersRegistered++) {
          lighting.addShadowMesh(clutterMeshes.casterMeshes[clutterCastersRegistered] as Mesh);
        }
      }
      // The cliff modules' near buckets, once their two GLBs have loaded:
      // shadow casters, and hard cover for the rain. The bucket meshes are
      // registered once; their instances come and go inside them.
      if (cliffMeshes !== null) {
        for (; cliffCastersRegistered < cliffMeshes.casterMeshes.length; cliffCastersRegistered++) {
          const bucket = cliffMeshes.casterMeshes[cliffCastersRegistered] as Mesh;
          lighting.addShadowMesh(bucket);
          rainMap?.register(bucket, "hard");
        }
      }
      // The lake's reflections take the forest's billboards and, the mirror
      // alone, its LOD2 buckets on their own material (the panorama leaves
      // the near trees out, and the mirror leaves the LOD1 buckets out: 2 ms
      // a draw at 4K), and the cliffs' far buckets, as their GLBs land. The
      // mirror takes the cliffs' LOD1 buckets too, on their own material,
      // where the stacks on a lake's shore stand; their LOD0 buckets are left
      // out.
      if (lakeMirror !== null || lakePanorama !== null) {
        if (forestMeshes !== null) {
          for (; forestImpostorsReflected < forestMeshes.impostorMeshes.length; forestImpostorsReflected++) {
            const plane = forestMeshes.impostorMeshes[forestImpostorsReflected] as Mesh;
            lakeMirror?.register(plane, null);
            lakePanorama?.register(plane, null);
            // The far forest has landed: the panorama is taken again.
            if (lakePanorama !== null) panoramaPending = true;
          }
          for (; forestLod2Reflected < forestMeshes.lod2Meshes.length; forestLod2Reflected++) {
            lakeMirror?.register(forestMeshes.lod2Meshes[forestLod2Reflected] as Mesh, null);
          }
        }
        if (cliffMeshes !== null) {
          for (; cliffsReflected < cliffMeshes.meshes.length; cliffsReflected++) {
            const bucket = cliffMeshes.meshes[cliffsReflected] as Mesh;
            if (bucket.name.endsWith(CLIFF_LOD1_SUFFIX)) lakeMirror?.register(bucket, null);
            if (!bucket.name.endsWith(CLIFF_FAR_SUFFIX)) continue;
            lakeMirror?.register(bucket, null);
            lakePanorama?.register(bucket, null);
            if (lakePanorama !== null) panoramaPending = true;
          }
        }
      }

      applyWetness(scene, weather);
      setTerrainWetness(scene, terrainMaterialFor(scene, "terrain"), weather.wetness);
      setTerrainRain(scene, terrainMaterialFor(scene, "terrain"), weather.rain, seconds);
      water?.setRain(weather.rain);
      setWetWeather(weather.wetness);
      // The haze reads the sky state the lighting last applied; there is
      // none until the table holds its first slices.
      const sky = lighting.sky;
      if (sky !== null) atmosphere.update(weather, sky);
      // The stare's lens: the dead have none, and the Hollow nearest the aim
      // is the side its darkness closes from. The camera's pose is last
      // frame's, as for the lens's rain below, and the lens's own ease hides it.
      const starer = state.players.get(localId);
      const stare = starer !== undefined && starer.health > 0 ? starer.stare : 0;
      let side: { x: number; y: number; cos: number } | null = null;
      if (stare > 0) {
        const view = camera.getViewMatrix();
        for (const e of state.enemies.values()) {
          if (!isHollow(e)) continue;
          stareAt.set(e.pos.x, e.pos.y, e.pos.z);
          Vector3.TransformCoordinatesToRef(stareAt, view, stareAt);
          const s = stareSide(stareAt.x, stareAt.y, stareAt.z);
          if (s !== null && (side === null || s.cos > side.cos)) side = s;
        }
      }
      stareLens = stepStareLens(stareLens, stare, side, engine.getDeltaTime() / 1000);
      // Rain on the lens: strongest looking up, cleared under the canopy,
      // smoothed over a second. The camera's pose is last frame's (it is set
      // below), one frame behind, which the smoothing hides.
      if (forest !== null && !(Math.hypot(camera.position.x - lensCanopyX, camera.position.z - lensCanopyZ) <= 1)) {
        lensCanopyX = camera.position.x;
        lensCanopyZ = camera.position.z;
        lensCanopy = forestDensity(forest.seed, lensCanopyX, lensCanopyZ);
      }
      lensStrength = lensSmooth(lensStrength, lensStrengthUnder(weather.rain, camera.rotation.x, lensCanopy), engine.getDeltaTime() / 1000);
      // The stare dims the frame's exposure: the lighting's on the material
      // path, so a weather fade's applies keep it; the grade's on the post path.
      lighting.setStare(stareLens.level);
      // Before the sky's first slices there is no night factor; the day's 0
      // stands in, for frames no one sees.
      // The death's closing dark rides the stare's shade, driven to full.
      const shown = endClose > 0 ? { ...stareLens, level: Math.max(stareLens.level, endClose), phase: 0.9 } : stareLens;
      lighting.setStare(shown.level);
      post.update(weather, lighting.hour, sky?.night ?? 0, unsettle, shown, lensStrength, chaseCast, endBlur);

      if (freecam !== null) {
        // The clipmap follows the *camera* here, not the player. Anchored to
        // the player, flying 500 m away shows void with no error.
        clipmap?.update(freecam.x, freecam.z);
        water?.update(freecam.x, freecam.z, oceanSeconds, lighting.hour);
        updateWet(freecam.x, freecam.z);
        propMeshes?.update(freecam.x, freecam.z);
        forestMeshes?.update(freecam.x, freecam.z);
        cliffMeshes?.update(freecam.x, freecam.z);
        clutterMeshes?.update(freecam.x, freecam.z);
        bladeMeshes?.update(freecam.x, freecam.z);
        duffMeshes?.update(freecam.x, freecam.z);
        wildlifeView.x = freecam.x;
        wildlifeView.y = freecam.y;
        wildlifeView.z = freecam.z;
        wildlifeView.yaw = freecam.yaw;
        wildlifeView.pitch = freecam.pitch;
        wildlifeView.fov = camera.fov;
        wildlifeView.aspect = engine.getAspectRatio(camera);
        findHollow(state, freecam.x, freecam.z);
        wildlifeMatch.phase = state.phase;
        wildlifeMatch.inWorld = true;
        wildlifeMatch.hour = lighting.hour;
        wildlifeMatch.mist = weather.mist;
        wildlife?.update(freecam.x, freecam.z, state.tick, playersOf(state), weather, lighting.hour, wildlifeDirectorArg);
        // The mist banks and the motes take their colour from the haze's
        // gradient, which is black until the sky's first slices are in.
        if (sky !== null) mist?.update(freecam.x, freecam.z, weather, atmosphere.midColour(), wind, seconds);
        camera.position.set(freecam.x, freecam.y, freecam.z);
        camera.rotation.set(freecam.pitch, freecam.yaw, freecam.roll ?? 0);
        camera.fov = freecam.fov ?? GAME_FOV;
        setLamp(localLamp, false);
        // Flying is not walking. Dropping the stride here also means the jump
        // back to the player's own position is never read as one enormous step.
        bob.reset();
        // The map follows the camera here, as the clipmap does.
        rainMap?.update(camera.position);
        rain.update(camera.position, camera.rotation.y, weather, wind, engine.getDeltaTime() / 1000, lampForRain(localLamp, rainLamp));
        rainSplash?.update(camera.position, weather, rainLamp, lighting.sunDirection, seconds);
        if (sky !== null) motes?.update(camera.position, weather, lighting.hour, atmosphere.nearColour(), wind);
        updateWaterLife(state, frame.dt, oceanSeconds, weather, sky);
        updateLake(weather, sky, true);
        updateSurf(frame.dt);
        jobs.run();
        return;
      }

      const local = state.players.get(localId);
      if (local) {
        clipmap?.update(local.pos.x, local.pos.z);
        water?.update(local.pos.x, local.pos.z, oceanSeconds, lighting.hour);
        updateWet(local.pos.x, local.pos.z);
        propMeshes?.update(local.pos.x, local.pos.z);
        forestMeshes?.update(local.pos.x, local.pos.z);
        cliffMeshes?.update(local.pos.x, local.pos.z);
        clutterMeshes?.update(local.pos.x, local.pos.z);
        bladeMeshes?.update(local.pos.x, local.pos.z);
        duffMeshes?.update(local.pos.x, local.pos.z);
        // The sim's own eye, not the camera's: the camera's position/rotation
        // below still hold last frame's transform at this point in `sync`
        // (the view-bob offset is computed after this), and the bob's own
        // wobble is cosmetic — a few centimetres well inside the invariant's
        // margin — not the sim-authoritative position the director should
        // judge visibility against.
        wildlifeView.x = local.pos.x;
        wildlifeView.y = local.pos.y + PLAYER_EYE_OFFSET;
        wildlifeView.z = local.pos.z;
        wildlifeView.yaw = local.yaw;
        wildlifeView.pitch = local.pitch;
        wildlifeView.fov = camera.fov;
        wildlifeView.aspect = engine.getAspectRatio(camera);
        findHollow(state, local.pos.x, local.pos.z);
        wildlifeMatch.phase = state.phase;
        wildlifeMatch.inWorld = true;
        wildlifeMatch.hour = lighting.hour;
        wildlifeMatch.mist = weather.mist;
        wildlife?.update(local.pos.x, local.pos.z, state.tick, playersOf(state), weather, lighting.hour, wildlifeDirectorArg);
        // As on the free camera: no mist or motes before the sky's slices.
        if (sky !== null) mist?.update(local.pos.x, local.pos.z, weather, atmosphere.midColour(), wind, seconds);
        const offset = bob.update(
          {
            x: local.pos.x,
            z: local.pos.z,
            speed: Math.sqrt(local.vel.x * local.vel.x + local.vel.z * local.vel.z),
            velY: local.vel.y,
            grounded: local.grounded,
            sprinting: frame.sprinting,
          },
          frame.dt,
        );
        // Lateral bob rides the camera's right vector. yaw 0 faces +Z and
        // increases toward +X (`sim/movement.ts` wishDirection), so forward is
        // (sin, 0, cos) and right is (cos, 0, -sin).
        const right = Math.cos(local.yaw);
        const rightZ = -Math.sin(local.yaw);
        camera.position.set(
          local.pos.x + offset.dx * right,
          local.pos.y + PLAYER_EYE_OFFSET + offset.dy,
          local.pos.z + offset.dx * rightZ,
        );
        // Babylon UniversalCamera Euler order puts pitch on x and yaw on y,
        // and its default forward is +Z, which matches the sim convention.
        // Roll goes on z — the only thing that ever writes it.
        camera.rotation.set(local.pitch, local.yaw, offset.roll);
        // The summit scene: from the flip's frame the camera is the scene's,
        // from the eye the player had then, for the reveal's seconds.
        sceneFov = null;
        sceneShot = -1;
        if (summitScene !== null && ending.since < 0) {
          const t = seconds - summitScene.since;
          if (t >= (summitScene.kind === "summit" ? SUMMIT_SCENE_S : CAP_SCENE_S)) summitScene = null;
          else {
            summitScene.base ??= { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: local.yaw, pitch: local.pitch };
            if (summitScene.kind === "summit" && summitScene.more !== null) {
              const ctx: SceneContext = { base: summitScene.base, body: summitScene.body, hollow: summitScene.more.hollow, party: summitScene.more.party };
              const shot = summitShot(t, ctx);
              camera.position.set(shot.x, shot.y, shot.z);
              camera.rotation.set(shot.pitch, shot.yaw, 0);
              sceneFov = shot.fov;
              sceneShot = shot.shot;
            } else {
              const pose = capPose(t, summitScene.base, summitScene.body);
              camera.position.set(pose.x, pose.y, pose.z);
              camera.rotation.set(pose.pitch, pose.yaw, 0);
            }
          }
        }
        // The local body stands in the summit's shots, until the last returns to its eye.
        views.showLocal = sceneShot >= 0 && sceneShot < SHOTS.length - 1;
        // The end: from its first frame the camera is the ending's, from the
        // pose the player had then, and the pass takes its blur and its dark.
        if (ending.since >= 0) {
          ending.base ??= { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: local.yaw, pitch: local.pitch, feetY: local.pos.y - PLAYER_HALF.y };
          const pose = endingPose(ending.kind, seconds - ending.since, ending.base);
          camera.position.set(pose.x, pose.y, pose.z);
          camera.rotation.set(pose.pitch, pose.yaw, pose.roll);
          endBlur = pose.blur;
          endClose = pose.close;
        }
        // A hike after a scene draws with the game's lens again; a shot of the summit's with its own.
        camera.fov = sceneFov ?? GAME_FOV;
        // In the summit's shots the lamp on the lens is off: the body's own lights them (entityViews.ts).
        setLamp(localLamp, local.lamp.on && !views.showLocal, lampState);
        rainMap?.update(local.pos);
        rain.update(camera.position, camera.rotation.y, weather, wind, engine.getDeltaTime() / 1000, lampForRain(localLamp, rainLamp));
        rainSplash?.update(camera.position, weather, rainLamp, lighting.sunDirection, seconds);
        if (sky !== null) motes?.update(camera.position, weather, lighting.hour, atmosphere.nearColour(), wind);
        updateWaterLife(state, frame.dt, oceanSeconds, weather, sky);
        updateLake(weather, sky, true);
        updateSurf(frame.dt);
      } else {
        // No eye this frame: the mirror is disarmed, never drawn from a stale view.
        updateLake(weather, sky, false);
      }
      // This frame's share of the rebuilds the updates above began, once
      // every shell has seen the view.
      jobs.run();
    },
    hasWildlife: wildlife !== null,
    wildlifeEvents() {
      const source = wildlife?.events;
      let n = 0;
      if (source !== undefined) {
        for (const e of source) wildlifeEventDrain[n++] = e;
        source.length = 0;
      }
      wildlifeEventDrain.length = n;
      return wildlifeEventDrain;
    },
    wildlifeDirectorLog() {
      return wildlife?.directorLog() ?? [];
    },
    hasWaterLife: waterLife !== null,
    waterLifeSound() {
      return waterLife !== null && waterLifeStepped ? waterLife.sound() : SILENT_WATER_LIFE;
    },
    hasSea: water !== null,
    surfSound() {
      return surfStepped ? surf : SILENT_SURF_SOUND;
    },
    stare() {
      return stareLens;
    },
    setChase(cast) {
      chaseCast = Math.max(0, Math.min(1, cast));
    },
    setHaunt(level) {
      hauntLevel = Math.max(0, Math.min(1, level));
    },
    setMist(density) {
      cloudHold = density === null ? null : Math.max(0, Math.min(1, density));
      return cloudHold ?? cloudDensity;
    },
    setMistIn(level) {
      mistIn = Math.max(0, Math.min(1, level));
    },
    setScene(kind, at, more) {
      summitScene = { kind, since: clock() / 1000, base: null, body: { x: at.x, y: at.y, z: at.z }, more: more ?? null };
    },
    setEnding(kind) {
      if (ending.since >= 0) return;
      ending = { kind, since: clock() / 1000, base: null };
    },
    listener() {
      // `camera.rotation` rather than the sim's yaw/pitch: it is set on both of
      // sync's branches, so freecam is heard from where it flies rather than
      // from the player's abandoned body.
      writeListenerPose(
        listenerPose,
        camera.position.x, camera.position.y, camera.position.z,
        camera.rotation.y, camera.rotation.x,
      );
      return listenerPose;
    },
    project(pos) {
      const p = new Vector3(pos.x, pos.y, pos.z);
      const view = Vector3.TransformCoordinates(p, camera.getViewMatrix());
      if (view.z <= camera.minZ) return null;
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      // scene.getTransformMatrix() is only refreshed inside scene.render(),
      // and this runs before that each frame (syncPrompt, ahead of render),
      // so it would read last frame's camera. getViewMatrix() above already
      // refreshed the view half; getProjectionMatrix() refreshes the other
      // half, and getTransformationMatrix() multiplies the two fresh, off the
      // camera rather than the scene's once-a-frame cache.
      camera.getProjectionMatrix();
      const s = Vector3.Project(p, Matrix.IdentityReadOnly, camera.getTransformationMatrix(), camera.viewport.toGlobal(w, h));
      // Render pixels to CSS pixels: the hardware scaling level makes them differ.
      const canvasEl = engine.getRenderingCanvas();
      const cw = canvasEl?.clientWidth ?? w;
      const ch = canvasEl?.clientHeight ?? h;
      return { x: (s.x / w) * cw, y: (s.y / h) * ch, depth: Vector3.Distance(p, camera.position) };
    },
    resize() {
      engine.resize();
    },
    dispose() {
      views.dispose();
      silhouette?.dispose();
      droppedCap?.dispose();
      localLamp.dispose();
      for (const m of brushMeshes) m.dispose();
      // Before the meshes in its list: a render target's list is not told of
      // a dispose.
      rainMap?.dispose();
      // The lake's material lets go of each target first: it binds what it
      // holds on its next draw.
      if (lakeMirror !== null) lakePlugin?.setMirror(null, lakeMirror.viewProjection);
      if (lakePanorama !== null) lakePlugin?.setPanorama(null);
      if (lakeSkyline !== null) lakePlugin?.setSkyline(null, skylineShade);
      lakeMirror?.dispose();
      lakePanorama?.dispose();
      panoramaTerrain?.dispose();
      lakeSkyline?.dispose();
      clipmap?.dispose();
      water?.dispose();
      waterPlants?.dispose();
      waterLife?.dispose();
      propMeshes?.dispose();
      forestMeshes?.dispose();
      clutterMeshes?.dispose();
      bladeMeshes?.dispose();
      duffMeshes?.dispose();
      cliffMeshes?.dispose();
      wildlife?.dispose();
      mist?.dispose();
      rain.dispose();
      rainSplash?.dispose();
      motes?.dispose();
      post.dispose();
      skinShading.dispose();
      // A wait for the sky ends unresolved: nothing waits on what has gone.
      disposal.abort();
      lighting.dispose();
      // After the lighting, which stops listening to its table first.
      ownSky?.dispose();
      atmosphere.dispose();
      // Before the engine, which may wait for its BRDF texture: nothing of a
      // renderer that has gone asks for a pipeline, and nothing it asked for
      // is started or stored (a swap's new engine compiles alone).
      releasePipelines();
      // The scene goes with its engine, once its BRDF texture is settled.
      releaseEngine(engine);
    },
    setFreecam(view) {
      freecam = view;
    },
    impostorBakes() {
      return forestMeshes?.impostorBakes() ?? [];
    },
    setDepthOfField() {
      // No depth of field in the post chain today (see the type's note).
    },
    async buildFirstClipmap(yieldEvery, onRing) {
      if (clipmap !== null) await stepSlices(clipmap.firstBuild(onRing), yieldEvery, () => scene.isDisposed);
    },
    buildClipmapNow() {
      if (clipmap !== null) finish(clipmap.firstBuild());
    },
    setHour(hour) {
      lighting.setHour(hour);
    },
    setWeather(next, fadeSeconds) {
      lighting.setWeather(next, fadeSeconds);
    },
    setView(hour, weather) {
      lighting.setView(hour, weather);
    },
    setWeatherName(name, fadeSeconds = 3) {
      if (fadeSeconds <= 0) {
        calmFrom = name;
        calmTo = name;
        calmFadeS = 0;
        calmElapsedS = 0;
        return;
      }
      // A fade taken over mid-way starts from the share it had reached.
      calmFrom = calmFadeS > 0 ? fadedCalmShare(lighting.hour, calmFrom, calmTo, calmElapsedS / calmFadeS) : calmTo;
      calmTo = name;
      calmFadeS = fadeSeconds;
      calmElapsedS = 0;
    },
    setBobScale(scale) {
      bob.setScale(scale);
    },
    setUnsettle(level) {
      unsettle = Math.min(1, Math.max(0, level));
    },
    setWireframe(on) {
      // Scene-wide rather than per material, so it covers the clipmap rings and
      // brushes without the renderer keeping a list of what it created.
      scene.forceWireframe = on;
    },
    setSkinShading(on) {
      skinShading.setEnabled(on);
    },
    wind() {
      return wind;
    },
    canopyWater() {
      return rain.canopyWater;
    },
    canopyOver() {
      return lensCanopy;
    },
    setWindOverride(level) {
      windOverride = level === null ? null : Math.min(1, Math.max(0, level));
    },
  };
}
