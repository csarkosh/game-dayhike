import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";

import type { Level } from "../sim/level.js";
import type { WorldState } from "../sim/types.js";
import type { Forest } from "../sim/forest.js";
import { PLAYER_EYE_OFFSET } from "../sim/constants.js";
import { createViewBob } from "./viewBob.js";
import { FOG_DISTANCE } from "../sim/forestConstants.js";
import { EntityViews } from "./entityViews.js";
import { budgetLights, createHeadlamp, setLamp } from "./headlamp.js";
import {
  createRingSamples,
  holeCellsFor,
  ringGeometry,
  updateRingSamples,
  RING_COUNT,
  type RingGeometry,
  type RingSamples,
} from "./clipmap.js";
import { createLighting } from "./lighting.js";
import { createStylize } from "./stylize.js";
import { createCelShading } from "./cel.js";
import { createSkinShading } from "./skin.js";
import { attachTerrainTexture, enableRoadPaint, enableTrailPaint, enableFeaturePaint } from "./terrainTexture.js";
import type { StyleName } from "./stylizeParams.js";
import type { WeatherParams } from "./weather.js";
import { wetSurfaceUnder } from "./weather.js";
import { tierFor, type QualityTier } from "./quality.js";
import { activeTerrainVariant } from "../sim/terrain.js";
import { fbm2 } from "../sim/field.js";
import {
  createWaterRingSamples,
  updateWaterRingSamples,
  waterColorAt,
  waterHoleCellsFor,
  waterRingGeometry,
  WATER_RING_COUNT,
  type WaterGeometry,
  type WaterRingSamples,
} from "./water.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { POND_DEPTH } from "../sim/features.js";
import { createForestMeshes } from "./forestMeshes.js";
import { NEAR_RADIUS } from "./forestField.js";
import { createClutterMeshes } from "./clutterMeshes.js";
import { createWildlifeMeshes } from "./wildlifeMeshes.js";
import type { PlayerPoint, WildlifeEvent } from "./wildlifeBehaviour.js";
import type { ListenerPose } from "./ambientAudio.js";
import { createMistMeshes } from "./mistMeshes.js";
import { createRain } from "./rain.js";
import { createPropMeshes } from "./propMeshes.js";

const MATERIAL_COLORS: Record<string, [number, number, number]> = {
  concrete: [0.42, 0.44, 0.47],
  wall: [0.3, 0.32, 0.38],
  platform: [0.36, 0.42, 0.5],
  step: [0.4, 0.46, 0.54],
  crate: [0.55, 0.42, 0.26],
  pillar: [0.48, 0.36, 0.36],
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
  // Base values recorded so wetness can scale them absolutely rather than
  // compounding a relative factor frame after frame.
  mat.metadata = {
    baseAlbedo: [mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b] as [number, number, number],
    baseRoughness: mat.roughness,
  };
  cache.set(name, mat);
  return mat;
}

/**
 * Wet ground reads darker and glossier. A uniform luminance scale on the
 * material albedo — deliberately not a hue tint, which would apply the palette
 * twice (see the comment on `terrainMaterialFor`); vertex colours are untouched.
 * Tree/prop asset materials are excluded by construction: they are not in this
 * cache.
 */
export function applyWetness(scene: Scene, w: WeatherParams): void {
  const { albedoScale, roughnessScale } = wetSurfaceUnder(w);
  for (const mat of materialCacheFor(scene).values()) {
    const base = mat.metadata as
      | { baseAlbedo: [number, number, number]; baseRoughness: number }
      | null;
    if (!base) continue;
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
  mesh.setVerticesData("terrainWeights2", geometry.weights2, true, 2);
}

export type Clipmap = {
  /** One mesh per ring, coarsening outward. Also the whole shadow-caster set. */
  readonly meshes: readonly Mesh[];
  update(camX: number, camZ: number): void;
  dispose(): void;
};

/**
 * The seven-ring clipmap that draws generated terrain, as a unit that owns its
 * ring state and re-emits what the camera invalidates.
 *
 * Split out of `createRenderer` so it is reachable from a test: `createRenderer`
 * builds a real `Engine`, which throws "WebGL not supported" under Node, but
 * this takes only a `Scene` and so runs on a `NullEngine`. The re-emit rule
 * below is the one genuinely subtle thing in the renderer, and leaving it
 * sealed inside a closure would have left it permanently untestable.
 */
export function createClipmap(scene: Scene, seed: number): Clipmap {
  const rings: RingSamples[] = [];
  const meshes: Mesh[] = [];

  function emitRing(level: number): void {
    const ring = rings[level] as RingSamples;
    const finer = level > 0 ? (rings[level - 1] as RingSamples) : null;
    // The border blends to the coarser ring's samples, so every ring must
    // exist before any ring emits — hence the two loops
    // below. The outermost ring meets nothing and passes null.
    const coarser = level < RING_COUNT - 1 ? (rings[level + 1] as RingSamples) : null;
    applyRingGeometry(
      meshes[level] as Mesh,
      // Ring 0 draws solid; every coarser ring cuts a hole where the finer ring
      // covers it.
      ringGeometry(ring, finer === null ? null : holeCellsFor(ring, finer), coarser),
    );
  }

  for (let level = 0; level < RING_COUNT; level++) {
    rings.push(createRingSamples(seed, level, 0, 0));
    meshes.push(createClipmapMesh(scene, `clipmap_${level}`));
  }
  for (let level = 0; level < RING_COUNT; level++) emitRing(level);

  // The terrain material is shared and seedless; the road's centerline table
  // is per world, so the clipmap, which knows the seed, turns it on.
  enableRoadPaint(scene, terrainMaterialFor(scene, "terrain"), seed);
  enableTrailPaint(scene, terrainMaterialFor(scene, "terrain"), seed);
  enableFeaturePaint(scene, terrainMaterialFor(scene, "terrain"), seed);

  return {
    meshes,
    update(camX, camZ) {
      const moved: boolean[] = [];
      for (let level = 0; level < RING_COUNT; level++) {
        moved.push(updateRingSamples(rings[level] as RingSamples, seed, camX, camZ));
      }
      // A ring re-emits when it moved, or when the finer ring inside it moved —
      // the hole in its index buffer follows the finer ring's footprint, so a
      // ring that has not moved itself can still be holding a stale hole.
      //
      // Necessary and sufficient, and there is deliberately no outward clause:
      // `snapOrigin` puts ring L on a lattice of 2^(L+1), and any camera
      // crossing of a multiple of 2^(L+1) is also a crossing of 2^L, so a ring
      // moving always implies the ring inside it moved. Nothing a coarser ring
      // does can invalidate a finer one.
      //
      // A finer ring's border now also reads the coarser ring's samples
      // (`coarseHeight`, for the chord that avoids seams at the lift). That
      // dependency is discharged by the same lattice fact, not a new one:
      // `moved[level+1]` (the coarser ring) implies `moved[level]` (the ring
      // whose border reads it), and the loop above refreshes every ring's
      // samples before any ring below emits, so a finer ring's emit always
      // sees the coarser ring's post-move samples. A change to `snapOrigin`'s
      // snap, or a ring placed on a lattice other than 2^(L+1), would break
      // that implication, need an outward clause here, and open seams no
      // unit test covers.
      for (let level = 0; level < RING_COUNT; level++) {
        if (moved[level] || (level > 0 && (moved[level - 1] as boolean))) emitRing(level);
      }
    },
    dispose() {
      for (const mesh of meshes) mesh.dispose();
    },
  };
}

/** Bump-texture UV drift per second — u and v deliberately unequal so the
 * ripples drift diagonally instead of tracking an axis. */
const WATER_UV_SCROLL = [0.015, 0.011] as const;

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
  data.colors = geometry.colors;
  data.uvs = geometry.uvs;
  data.applyToMesh(mesh, true);
}

export type Water = {
  /** One mesh per ring, coarsening outward — four draw calls, capped by design.
   * NEVER added to the shadow caster list: water neither casts nor receives. */
  readonly meshes: readonly Mesh[];
  update(camX: number, camZ: number): void;
  dispose(): void;
};

export type Pond = { x: number; z: number; radius: number; height: number };

/**
 * Builds one flat disc over a pond, shaded like the sea's shoreline: the ring
 * meshes bake depth into per-vertex colour+alpha (`waterRingGeometry`), so the
 * disc needs the same treatment rather than a flat tint, or a pond would read
 * as a plain coloured puddle next to the ocean's graded shore.
 *
 * `basinD` (sim/features.ts) carves the pond's ground as
 * `height − POND_DEPTH·(1 − (q/R)²)²` for q < R — the same profile, evaluated
 * here in the disc's LOCAL frame (pre-rotation XY, z unused) so `r` is the
 * distance from the disc's centre before `rotation.x` lays it flat.
 *
 * Exported so it is reachable from a test without a full `createWater` call.
 */
export function pondDisc(scene: Scene, mat: PBRMaterial, pond: Pond, index: number): Mesh {
  const disc = MeshBuilder.CreateDisc(`pond_${index}`, { radius: pond.radius + 1, tessellation: 48 }, scene);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(pond.x, pond.height + 0.02, pond.z);
  disc.material = mat;
  disc.isPickable = false;
  disc.receiveShadows = false;

  const positions = disc.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
  const vertexCount = positions.length / 3;
  const colors = new Float32Array(vertexCount * 4);
  const R = pond.radius;
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const r = Math.hypot(x, y);
    const u = 1 - (r / R) * (r / R);
    const depth = POND_DEPTH * u * u;
    const c = waterColorAt(depth);
    colors[i * 4] = c.r;
    colors[i * 4 + 1] = c.g;
    colors[i * 4 + 2] = c.b;
    colors[i * 4 + 3] = c.a;
  }
  disc.setVerticesData(VertexBuffer.ColorKind, colors, false, 4);
  disc.useVertexColors = true;
  disc.hasVertexAlpha = true;
  disc.freezeWorldMatrix();
  return disc;
}

/**
 * The four-ring camera-following ocean surface. Same shape as `createClipmap`
 * — rings array, `emitRing`, moved-or-finer-moved re-emit — because the hole
 * in a coarser ring tracks the finer ring's footprint exactly as the terrain
 * clipmap's does. Takes only a `Scene` so it runs under `NullEngine`.
 *
 * `ponds` adds one flat, depth-shaded disc per pond feature, sharing this
 * water's material — the trail system's made ponds otherwise have no water at
 * all, just the basin ground `basinD` carved.
 */
export function createWater(
  scene: Scene,
  seed: number,
  waterLevel: number,
  ponds: readonly Pond[] = [],
): Water {
  // One material for all four rings. White albedo: the vertex colours carry
  // the depth ramp, and PBR multiplies the two.
  const mat = new PBRMaterial("mat_water", scene);
  mat.albedoColor = new Color3(1, 1, 1);
  mat.metallic = 0;
  mat.roughness = 0.12;
  mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  const bump = createWaterBump(scene);
  mat.bumpTexture = bump;

  // Cosmetic drift: scroll the bump's UV offset each frame. Delta
  // time, not per-frame constants, so the ripple speed survives refresh-rate
  // differences.
  const scroll = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    bump.uOffset += WATER_UV_SCROLL[0] * dt;
    bump.vOffset += WATER_UV_SCROLL[1] * dt;
  });

  const rings: WaterRingSamples[] = [];
  const meshes: Mesh[] = [];

  function emitRing(level: number): void {
    const ring = rings[level] as WaterRingSamples;
    const finer = level > 0 ? (rings[level - 1] as WaterRingSamples) : null;
    applyWaterGeometry(
      meshes[level] as Mesh,
      waterRingGeometry(ring, finer === null ? null : waterHoleCellsFor(ring, finer), waterLevel),
    );
  }

  for (let level = 0; level < WATER_RING_COUNT; level++) {
    rings.push(createWaterRingSamples(seed, level, 0, 0));
    const mesh = new Mesh(`water_${level}`, scene);
    mesh.useVertexColors = true;
    mesh.hasVertexAlpha = true;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.material = mat;
    meshes.push(mesh);
    emitRing(level);
  }

  // One flat, depth-shaded disc per pond feature, sharing this water's
  // material. Static — no ring-style re-emit, since a
  // pond's ground does not scroll with the camera — so they need no place in
  // `meshes` (the doc'd one-per-ring, shadow-caster-exempt set); they are
  // disposed alongside it instead.
  const pondMeshes: Mesh[] = ponds.map((p, i) => pondDisc(scene, mat, p, i));

  return {
    meshes,
    update(camX, camZ) {
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
    },
    dispose() {
      scene.onBeforeRenderObservable.remove(scroll);
      for (const mesh of meshes) mesh.dispose();
      for (const mesh of pondMeshes) mesh.dispose();
      bump.dispose();
      mat.dispose();
    },
  };
}

/**
 * Reads what the browser will admit to. Deliberately conservative and
 * deliberately overridable — the detected tier is meant to be a default,
 * not a verdict.
 */
function detectTier(): QualityTier {
  const nav = globalThis.navigator as
    | { hardwareConcurrency?: number; deviceMemory?: number; userAgent?: string }
    | undefined;
  return tierFor({
    cores: nav?.hardwareConcurrency ?? 4,
    memoryGb: nav?.deviceMemory ?? 4,
    mobile: /Mobi|Android|iPhone|iPad/.test(nav?.userAgent ?? ""),
  });
}

export type FreecamView = { x: number; y: number; z: number; yaw: number; pitch: number };

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
  engine: Engine;
  camera: UniversalCamera;
  views: EntityViews;
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
  resize(): void;
  dispose(): void;
  setFreecam(view: FreecamView | null): void;
  setWireframe(on: boolean): void;
  setSkinShading(on: boolean): void;
  setHour(hour: number): void;
  setWeather(next: WeatherParams, fadeSeconds?: number): void;
  setStyle(name: StyleName): void;
  /** 0 switches the walking cue off; 1 is the tuned default. */
  setBobScale(scale: number): void;
};

export type RendererOptions = { tier?: QualityTier };

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
  const engine = new Engine(canvas, true, { stencil: true }, true);
  const scene = new Scene(engine);
  // Sun + fill already occupy two of every material's default four light
  // slots; without raising the cap, only the first two of the local lamp and
  // up to MAX_PLAYERS remote lamps ever light anything. Before any material
  // exists, so it also catches every material a GLB load adds later.
  budgetLights(scene);

  // Cel-spike plugin registration. BEFORE anything creates
  // a material: RegisterMaterialPlugin only reaches materials constructed
  // after it runs, and the first PBR materials appear a few lines down.
  const cel = createCelShading(scene);
  const skinShading = createSkinShading(scene);

  // Never call attachControl: this camera is driven entirely by sim state.
  const camera = new UniversalCamera("player", new Vector3(0, 2, 0), scene);
  camera.minZ = 0.05;
  // Far plane moves with the fog: the outermost ring's corner is
  // ~5.8 km out and the skybox is 8 km across, so Babylon's default clips the
  // entire distant view away.
  camera.maxZ = 10000;
  camera.fov = 1.4;

  // The local player's headlamp, camera-parented so it needs no per-frame
  // position write: a child of the camera inherits its rotation, so +Z local
  // is the view direction.
  const localLamp = createHeadlamp(scene, "lamp_local");
  localLamp.parent = camera;
  localLamp.position.set(0, 0, 0);
  localLamp.direction.set(0, 0, 1);

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
  const tier = options.tier ?? detectTier();
  const lighting = createLighting(scene, { tier, viewDistance: FOG_DISTANCE });

  // The stylization layer: vignette, grain, chromatic
  // aberration, etched outlines — tier-gated internally, capability-guarded,
  // and a no-op shell where neither applies.
  const stylize = createStylize(scene, camera, tier);

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

  // ---- Generated terrain: geometry clipmap -------------------------------
  //
  // Rendering follows the CAMERA, kilometres out, with no chunk generation at
  // all — the rings sample the elevation field directly.
  // Collision chunks still follow the player through world.boxes, untouched.
  // Ring meshes are also the complete shadow-caster set: seven meshes,
  // bounded, which closes the old grows-without-bound caster list.
  const clipmap = forest === null ? null : createClipmap(scene, forest.seed);
  if (clipmap !== null) {
    for (const mesh of clipmap.meshes) lighting.addShadowMesh(mesh);
  }

  // Water rides the same guard as the clipmap: hand-authored (brush) levels
  // have no forest, so they get no water either. A forest world gets
  // water exactly when its variant declares a sea level. Deliberately NOT
  // added to the shadow caster list — water neither casts nor receives.
  const waterLevel = forest === null ? undefined : activeTerrainVariant().waterLevel;
  const ponds: readonly Pond[] =
    forest !== null
      ? (activeTerrainVariant().trailGraph?.(forest.seed).features.filter((f) => f.kind === "pond") ?? [])
      : [];
  const water =
    forest !== null && waterLevel !== undefined
      ? createWater(scene, forest.seed, waterLevel, ponds)
      : null;

  // Every chunk prop the sim collides with, drawn: the trailhead's placeholder
  // car, post and sign used to be pure collision boxes, an invisible wall no
  // player could see coming. Rides the same forest
  // guard as the water above it — hand-authored levels have no chunk grid.
  const propMeshes =
    forest !== null
      ? createPropMeshes(scene, forest.grid, (name) => terrainMaterialFor(scene, name), {
          // Direct method references, not pass-through arrows: `Lighting`'s
          // methods close over local state (the shadow generator) rather than
          // reading `this`, so nothing is lost by handing them over bare.
          add: lighting.addShadowMesh,
          remove: lighting.removeShadowMesh,
        })
      : null;

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
      ? createForestMeshes(scene, forest.seed, { nearRadius: tier === "low" ? lowTierNearRadius : undefined })
      : null;
  // Forest shadow casters (the LOD0 bucket only) cannot be registered here: the GLBs load
  // asynchronously, so `casterMeshes` starts empty and fills once. sync()
  // below registers new entries as they appear — append-only, so a plain
  // high-water mark is enough.
  let forestCastersRegistered = 0;

  // Ground clutter rides the same guard as the forest above it: hand-authored
  // levels have no forest and get no grass, rocks, boulders, driftwood or
  // fungus. Low tier shrinks every class radius to 60%, the clutter analogue
  // of the forest's near-band tier rule.
  const clutterMeshes =
    forest !== null
      ? createClutterMeshes(scene, forest.seed, { radiusScale: tier === "low" ? 0.6 : undefined })
      : null;
  // Same late-registration story as the forest's casters: the eleven clutter
  // GLBs load asynchronously, so the boulder buckets appear in `casterMeshes`
  // some frames after creation.
  let clutterCastersRegistered = 0;

  // Wildlife rides the forest guard like the clutter above it: hand-authored
  // levels have no forest and get no animals. Low tier scales every species'
  // disc to 60%, the same tier rule clutter takes. Its casters need no late
  // registration loop, unlike the two shells above: a creature's meshes come
  // and go with the animal, so the shell registers and unregisters each one
  // itself through the pair handed in here.
  const wildlife =
    forest !== null
      ? createWildlifeMeshes(scene, forest.seed, {
          radiusScale: tier === "low" ? 0.6 : undefined,
          shadows: {
            add: (mesh) => lighting.addShadowMesh(mesh),
            remove: (mesh) => lighting.removeShadowMesh(mesh),
          },
        })
      : null;

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

  // Mist rides the same guard as the forest: hand-authored levels get no
  // valley haze, and a forest world seeds the bank placement with the same
  // seed the forest and clipmap use.
  const mist = forest !== null ? createMistMeshes(scene, forest.seed, tier) : null;

  // Rain is universal, unlike the forest-gated effects above: weather applies
  // to hand-authored levels too, and a stopped particle system is free.
  const rain = createRain(scene, tier);

  const views = new EntityViews(scene);
  // Fire and forget: enemies render as capsules until this resolves, and stay
  // capsules forever if there is no shipped model or it fails to load.
  void views.models.load(scene);

  let freecam: FreecamView | null = null;

  return {
    scene,
    engine,
    camera,
    views,
    sync(state, localId, alpha, frame = { dt: 0, sprinting: false }) {
      views.sync(state, localId, alpha);

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

      // Weather follows the fade, so surfaces wet and dry smoothly. A handful
      // of materials x four property writes: cheap enough to do every frame.
      // Read once: `lighting.weather` is a getter that allocates a fresh copy
      // per call, and this reads it three times a frame otherwise.
      const weather = lighting.weather;
      applyWetness(scene, weather);
      stylize.update(weather);

      if (freecam !== null) {
        // The clipmap follows the *camera* here, not the player. Anchored to
        // the player, flying 500 m away shows void with no error.
        clipmap?.update(freecam.x, freecam.z);
        water?.update(freecam.x, freecam.z);
        propMeshes?.update(freecam.x, freecam.z);
        forestMeshes?.update(freecam.x, freecam.z);
        clutterMeshes?.update(freecam.x, freecam.z);
        wildlife?.update(freecam.x, freecam.z, state.tick, playersOf(state), weather, lighting.hour);
        mist?.update(freecam.x, freecam.z, weather);
        camera.position.set(freecam.x, freecam.y, freecam.z);
        camera.rotation.set(freecam.pitch, freecam.yaw, 0);
        setLamp(localLamp, false);
        // Flying is not walking. Dropping the stride here also means the jump
        // back to the player's own position is never read as one enormous step.
        bob.reset();
        rain.update(camera.position, weather);
        return;
      }

      const local = state.players.get(localId);
      if (local) {
        clipmap?.update(local.pos.x, local.pos.z);
        water?.update(local.pos.x, local.pos.z);
        propMeshes?.update(local.pos.x, local.pos.z);
        forestMeshes?.update(local.pos.x, local.pos.z);
        clutterMeshes?.update(local.pos.x, local.pos.z);
        wildlife?.update(local.pos.x, local.pos.z, state.tick, playersOf(state), weather, lighting.hour);
        mist?.update(local.pos.x, local.pos.z, weather);
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
        setLamp(localLamp, local.lamp.on);
        rain.update(camera.position, weather);
      }
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
    resize() {
      engine.resize();
    },
    dispose() {
      views.dispose();
      localLamp.dispose();
      for (const m of brushMeshes) m.dispose();
      clipmap?.dispose();
      water?.dispose();
      propMeshes?.dispose();
      forestMeshes?.dispose();
      clutterMeshes?.dispose();
      wildlife?.dispose();
      mist?.dispose();
      rain.dispose();
      stylize.dispose();
      skinShading.dispose();
      cel.dispose();
      lighting.dispose();
      scene.dispose();
      engine.dispose();
    },
    setFreecam(view) {
      freecam = view;
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
    setStyle(name) {
      cel.setEnabled(name === "cel");
    },
    setWireframe(on) {
      // Scene-wide rather than per material, so it covers the clipmap rings and
      // brushes without the renderer keeping a list of what it created.
      scene.forceWireframe = on;
    },
    setSkinShading(on) {
      skinShading.setEnabled(on);
    },
  };
}
