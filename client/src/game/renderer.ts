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
import { forestDensity } from "../sim/vegetation.js";
import { PLAYER_EYE_OFFSET } from "../sim/constants.js";
import { createViewBob } from "./viewBob.js";
import { FOG_DISTANCE } from "../sim/forestConstants.js";
import { CHARACTER_IDS, EntityViews } from "./entityViews.js";
import { budgetLights, budgetMaterial, createHeadlamp, setLamp } from "./headlamp.js";
import { lampUnder } from "./lampParams.js";
import { windRecordUnder, type WindRecord } from "./windParams.js";
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
import { createLighting } from "./lighting.js";
import { createAtmosphere, releaseAtmosphere } from "./atmosphere.js";
import { createPost, fxSupportedBy } from "./post.js";
import { lensSmooth, lensStrengthUnder } from "./lensParams.js";
import { postFeaturesFor } from "./postParams.js";
import { createSkinShading } from "./skin.js";
import { attachTerrainTexture, enableRoadPaint, enableTrailPaint, enableFeaturePaint, setTerrainRain, setTerrainSward, setTerrainWetness } from "./terrainTexture.js";
import type { WeatherParams } from "./weather.js";
import { wetSurfaceUnder } from "./weather.js";
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
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { attachWater } from "./waterPlugin.js";
import { createWaterPlants } from "./waterPlants.js";
import { WATER_GROUP, createWaterFrame, waterFrameSupported } from "./waterFrame.js";
import { WATER_ROWS, lakeSkin, lakeWaterRow, waterSkinOffset } from "./waterShading.js";
import { attachWet, setWetLine, setWetWeather, wetCapOf, wetLineFor, type WetBody } from "./wetPlugin.js";
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
import { createCliffMeshes } from "./cliffMeshes.js";
import { createWildlifeMeshes } from "./wildlifeMeshes.js";
import type { PlayerPoint, WildlifeEvent } from "./wildlifeBehaviour.js";
import type { MatchState, View } from "./wildlifeDirector.js";
import type { ListenerPose } from "./ambientAudio.js";
import { createMistMeshes, type MistMeshes } from "./mistMeshes.js";
import { createRain, type Rain, type RainLamp } from "./rain.js";
import { createRainMap } from "./rainMap.js";
import { createRainSplash, type RainSplash } from "./rainSplash.js";
import { createMotes, type Motes } from "./motes.js";
import { createPropMeshes, type MeshRegistry, type PropShadows } from "./propMeshes.js";
import { buildOrUndo } from "./rendererSwap.js";

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
 * scrolling bump texture samples.
 */
function applyWaterGeometry(mesh: Mesh, geometry: WaterGeometry): void {
  const data = new VertexData();
  data.positions = geometry.positions;
  data.indices = geometry.indices;
  data.normals = geometry.normals;
  data.uvs = geometry.uvs;
  data.applyToMesh(mesh, true);
  mesh.setVerticesData("bedDepth", geometry.bedDepth, true, 1);
}

/** Rows of the bed grid baked per frame: a whole 256² grid measured 260 to 295 ms. */
const BED_ROWS_PER_FRAME = 1;

export type Water = {
  /** One mesh per ring, coarsening outward — four draw calls, capped by design.
   * NEVER added to the shadow caster list: water neither casts nor receives. */
  readonly meshes: readonly Mesh[];
  /** One surface per lake (`lakeSurface`), static, on its lake's own material. */
  readonly lakeMeshes: readonly Mesh[];
  /** True when the high tier's path is on: opaque in `WATER_GROUP`, reading the
   * opaque pass through the surface (`waterFrame.ts`), so a wet object's own
   * depth is attenuated by the water and the wet plugin need not darken it. */
  readonly high: boolean;
  update(camX: number, camZ: number, seconds: number): void;
  /** Per frame from the wind record: the 0..1 speed and the direction it blows toward. */
  setWind(wind01: number, dir: [number, number]): void;
  /** Per frame from the weather: the rain, 0 to 1, that rings the surface. */
  setRain(rain: number): void;
  dispose(): void;
};

/** The see-through effects a camera moves among: rain (its streaks and
 * drips), its splashes, motes and the mist banks. */
export type SeeThroughEffects = { rain: Rain | null; splash: RainSplash | null; motes: Motes | null; mist: MistMeshes | null };

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
 * The four-ring camera-following ocean surface. Same shape as `createClipmap`
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
  seaMat.bumpTexture = bump;
  for (const mat of lakeMats) mat.bumpTexture = bump;

  // Cosmetic drift: scroll the bump's UV offset each frame by the clock's
  // delta, not per-frame constants, so the ripple speed survives
  // refresh-rate differences, and a scene's own clock (`now`) moves the
  // water in step with it, or holds it on a held frame. One texture, so
  // one scroll drives both materials.
  let last = now();
  const scroll = scene.onBeforeRenderObservable.add(() => {
    const at = now();
    const dt = Math.max(0, at - last) / 1000;
    last = at;
    bump.uOffset += WATER_UV_SCROLL[0] * dt;
    bump.vOffset += WATER_UV_SCROLL[1] * dt;
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
  // cells, not the whole plane: a flat plane at the level is in view from
  // almost anywhere, which would ask for the high tier's copy inland too.
  function emitRing(level: number): void {
    const ring = rings[level] as WaterRingSamples;
    const finer = level > 0 ? (rings[level - 1] as WaterRingSamples) : null;
    const mesh = meshes[level] as Mesh;
    const geometry = waterRingGeometry(ring, finer === null ? null : waterHoleCellsFor(ring, finer), waterLevel);
    applyWaterGeometry(mesh, geometry);
    const bounds = wetBounds(geometry);
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

  return {
    meshes,
    lakeMeshes,
    high,
    update(camX, camZ, seconds) {
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
      for (const p of plugins) p.time = seconds;
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
      for (const p of plugins) p.setWind(wind01, dir);
    },
    setRain(rain) {
      for (const p of plugins) p.rain = rain;
    },
    dispose() {
      scene.onBeforeRenderObservable.remove(scroll);
      for (const mesh of meshes) mesh.dispose();
      for (const mesh of lakeMeshes) mesh.dispose();
      bump.dispose();
      bedTexture?.dispose();
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
   * Where the camera is and which way it looks, in Babylon's left-handed world
   * — `wildlifeAudio.ts` mirrors it for Web Audio. One reused object: this is
   * read every frame and its nine numbers are copied straight into AudioParams.
   */
  listener(): ListenerPose;
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
  // ~5.8 km out and the skybox is 8 km across, so Babylon's default clips the
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
  const lighting = createLighting(scene, { tier, viewDistance: FOG_DISTANCE, colourPath: postFeatures.colourPath });
  partOf(lighting);
  const clock = options.clock ?? (() => performance.now());
  const post = createPost(scene, camera, postFeatures, { now: clock });
  partOf(post);
  let unsettle = 1;
  /** The rain on the lens, smoothed (lensParams.ts). */
  let lensStrength = 0;
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
  }
  const cover: MeshRegistry = {
    add: (mesh) => rainMap?.register(mesh, "hard"),
    remove: (mesh) => rainMap?.unregister(mesh),
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
          shadows: {
            add: (mesh) => lighting.addShadowMesh(mesh),
            remove: (mesh) => lighting.removeShadowMesh(mesh),
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
  setEffectsGroup(effectsGroupFor(water), { rain, splash: rainSplash, motes, mist });

  const views = new EntityViews(scene);
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

  return {
    scene,
    engine,
    camera,
    views,
    shadows: { add: lighting.addShadowMesh, remove: lighting.removeShadowMesh },
    cover,
    forestReady: forestMeshes?.ready ?? Promise.resolve(),
    sync(state, localId, alpha, frame = { dt: 0, sprinting: false }) {
      // Weather follows the fade, so surfaces wet and dry smoothly. A handful
      // of materials x four property writes: cheap enough to do every frame.
      // Read once: `lighting.weather` is a getter that allocates a fresh copy
      // per call, and this reads it several times a frame otherwise. Read
      // BEFORE the views sync, which needs the lamp state derived from it.
      const weather = lighting.weather;
      const seconds = clock() / 1000;
      const lampState = lampUnder(weather, seconds);
      // The one wind record every moving thing reads this frame: the
      // weather-driven speed, or the `/wind` override in its place. The
      // players bend it — `windPlayers` is reused, not allocated, and absent
      // slots are parked far off in XZ so the bend never reaches them.
      wind = windRecordUnder(weather, seconds, windOverride ?? undefined);
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

      applyWetness(scene, weather);
      setTerrainWetness(scene, terrainMaterialFor(scene, "terrain"), weather.wetness);
      setTerrainRain(scene, terrainMaterialFor(scene, "terrain"), weather.rain, seconds);
      water?.setRain(weather.rain);
      setWetWeather(weather.wetness);
      atmosphere.update(weather, lighting.hour);
      const stare = state.players.get(localId)?.stare ?? 0;
      // Rain on the lens: strongest looking up, cleared under the canopy,
      // smoothed over a second. The camera's pose is last frame's (it is set
      // below), one frame behind, which the smoothing hides.
      if (forest !== null && !(Math.hypot(camera.position.x - lensCanopyX, camera.position.z - lensCanopyZ) <= 1)) {
        lensCanopyX = camera.position.x;
        lensCanopyZ = camera.position.z;
        lensCanopy = forestDensity(forest.seed, lensCanopyX, lensCanopyZ);
      }
      lensStrength = lensSmooth(lensStrength, lensStrengthUnder(weather.rain, camera.rotation.x, lensCanopy), engine.getDeltaTime() / 1000);
      post.update(weather, lighting.hour, unsettle, stare, lensStrength);

      if (freecam !== null) {
        // The clipmap follows the *camera* here, not the player. Anchored to
        // the player, flying 500 m away shows void with no error.
        clipmap?.update(freecam.x, freecam.z);
        water?.update(freecam.x, freecam.z, seconds);
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
        mist?.update(freecam.x, freecam.z, weather, atmosphere.midColour(), wind, seconds);
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
        motes?.update(camera.position, weather, lighting.hour, atmosphere.nearColour(), wind);
        jobs.run();
        return;
      }

      const local = state.players.get(localId);
      if (local) {
        clipmap?.update(local.pos.x, local.pos.z);
        water?.update(local.pos.x, local.pos.z, seconds);
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
        mist?.update(local.pos.x, local.pos.z, weather, atmosphere.midColour(), wind, seconds);
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
        // A hike after a scene draws with the game's lens again.
        camera.fov = GAME_FOV;
        setLamp(localLamp, local.lamp.on, lampState);
        rainMap?.update(local.pos);
        rain.update(camera.position, camera.rotation.y, weather, wind, engine.getDeltaTime() / 1000, lampForRain(localLamp, rainLamp));
        rainSplash?.update(camera.position, weather, rainLamp, lighting.sunDirection, seconds);
        motes?.update(camera.position, weather, lighting.hour, atmosphere.nearColour(), wind);
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
      localLamp.dispose();
      for (const m of brushMeshes) m.dispose();
      // Before the meshes in its list: a render target's list is not told of
      // a dispose.
      rainMap?.dispose();
      clipmap?.dispose();
      water?.dispose();
      waterPlants?.dispose();
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
      lighting.dispose();
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
