/**
 * The sea on Babylon Lite: its seven rings round the world's centre, as the
 * game lays them on Babylon.js (`createWater`'s rings in `renderer.ts`),
 * from what the game draws them with, computed with no engine: the rings'
 * samples of the ground (`water.ts`) and the lattice they are drawn as
 * (`seaLattice.ts`), the swell and the wind sea (`oceanFrame.ts`,
 * `oceanWindSea.ts`), the sea's edge on the cove (`seaEdge.ts`), the
 * surface's numbers (`waterSurface.ts`) and its uniforms by name
 * (`seaUniforms.ts`). The shading is `seaPlugin.ts`'s.
 *
 * - **The sea is one blended draw, and none out of view.** The seven rings
 *   are one mesh made once, a vertex its place in its ring's lattice, placed
 *   by the vertex stage; on Babylon.js they are seven meshes, each made
 *   again as it moves. A ring has water where the ground under one of its
 *   cells is below the level (or, along the cove, within the swash's climb
 *   of it), and the box of those cells is what a view is tested against, as
 *   the game culls a ring by it: the mesh is shown while the view holds one
 *   ring's box.
 * - **A ring that moves sends the depths under its vertices** (a layer of
 *   one table, 66 KB) and nothing else: where it and its hole stand are the
 *   frame's (`frameBlock.ts`).
 * - **What moves every frame is the frame's block**: the swell's phases,
 *   the wind sea's numbers, the clock, the bump's drift. The material's own
 *   buffer is written when the bed's square moves.
 * - **The swash's table is sent on a frame that shows the sea**, a row of
 *   8 KB, and the coastline's row of the swell's tables when the camera has
 *   moved a kilometre along the coast (16.6 KB, where the game sends the
 *   whole of its tables).
 * - **The edge is stepped every frame, shown or not**: the wet ground reads
 *   the swash's table, and the surf is heard by it.
 * - **The wind sea's field is the loop** on the tiers that draw one, baked
 *   in the game's worker (`oceanLoopStart.ts`) and sent once when it lands,
 *   64 frames of 128 texels a side; until then the sea is the swell alone.
 *   A tier whose own field is the FFT draws the loop, as the game does
 *   where the FFT is not to be had.
 * - **In the rain's cover map it is open water, at rest**: the same mesh
 *   through the map's material and a plugin that places the lattice at the
 *   level, drawn there by the map's own word while the map's square
 *   reaches its water, whatever the view holds.
 * - **Among the see-through draws it stands before the lakes**
 *   (`drawOrder.ts`), the rings laid outermost first.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, createRenderTexture2D, createTexture2DArray, createTexture2DFromPixels, disposeMeshGpu,
  markMaterialUboDirty, removeFromScene, setMeshVisible, updateTextureRegion,
  type EngineContext, type MaterialPlugin, type Mesh, type PluginUniformBlock, type SceneContext, type Texture2D, type Texture2DArray,
} from "@babylonjs/lite";
import { boxInPlanes, cornersPastBox, type ViewPlane } from "../lakeSeen.js";
import { createOceanFrame, type WindSeaDrawn } from "../oceanFrame.js";
import { OCEAN_ATLAS_ROWS, OCEAN_ROW_COAST, OCEAN_TABLE_SAMPLES } from "../oceanTables.js";
import type { OceanField } from "../oceanWaves.js";
import { startLoopWorker, type LoopStarter } from "../oceanLoopStart.js";
import { LOOP_FRAMES, LOOP_N } from "../oceanSpectrum.js";
import { createSeaWindLag, loopTimeAfter } from "../oceanWindSea.js";
import type { QualityTier } from "../quality.js";
import { createSeaEdgeStep, type SeaEdgeStep } from "../seaEdge.js";
import { SEA_SIDE, seaBedDepths, seaLattice, seaRingRecords, seaWetBounds } from "../seaLattice.js";
import { emptySeaFrameUniforms, emptySeaUniforms, seaFrameUniforms, seaUniforms, type SeaFrameUniforms } from "../seaUniforms.js";
import { SWASH_FACE_LIFT_M } from "../swashRunUp.js";
import { SWASH_COLUMNS } from "../swashTable.js";
import { WATER_RING_COUNT, createWaterRingSamples, seaFaceZ, updateWaterRingSamples, waterHoleCellsFor, type WaterRingSamples } from "../water.js";
import { WATER_BUMP_SIZE, waterBumpData } from "../waterBump.js";
import { WATER_ROWS, roughnessFor, waterSkinOffset } from "../waterShading.js";
import { advanceWater, createBumpDrift, createWaterSurface, setWaterCove, setWaterWind } from "../waterSurface.js";
import type { WindRecord } from "../windParams.js";
import { SEE_THROUGH_ORDER } from "./drawOrder.js";
import type { FrameUploads } from "./frameUploads.js";
import { seaPlugin, seaRestPlugin } from "./seaPlugin.js";
import type { SeaLook } from "./seaWgsl.js";
import type { LiteWaterBed } from "./waterBed.js";

/** What a tier's sea is drawn with beside its swell: the ripple bump for the wind sea on low, the baked loop above it. */
export function seaLookFor(tier: QualityTier): SeaLook {
  return { bump: tier === "low", loop: tier !== "low" };
}

/** What the sea is made with. */
export type SeaOptions = {
  /** Where the rings are first centred: the hike's start. */
  start: { x: number; z: number };
  /** The air's plugin, one a material. */
  air: () => MaterialPlugin;
  /** The frame's block. */
  shared: PluginUniformBlock;
  /** The sea's level. */
  waterLevel: number;
  /** The bed's square, which the renderer steps before each `update`. */
  bed: LiteWaterBed;
  /** The rings' samples, the swell's field and the bump's picture made ahead. */
  rings?: WaterRingSamples[] | null;
  ocean?: OceanField | null;
  bump?: Uint8Array | null;
  /** The rain's cover map, which the sea stands in as open water, placed by the plugin handed with it. */
  cover?: { add(mesh: Mesh, place: MaterialPlugin): void; remove(mesh: Mesh): void; show?(mesh: Mesh, shown: boolean): void };
  /** How the wind sea's loop is baked: the game's worker unless said. */
  startLoop?: LoopStarter;
  uploads?: FrameUploads;
};

/** A frame as the sea reads it. */
export type SeaFrame = {
  /** Where the world is centred: the player, or the camera in freecam. */
  centreX: number;
  centreZ: number;
  /** The view's planes, and its eight corners (`viewCorners`). */
  planes: readonly ViewPlane[];
  corners: ArrayLike<number>;
  /** The shared seconds the sea moves on, and the frame's length on the renderer's clock. */
  seconds: number;
  dt: number;
  wind: WindRecord;
  hour: number;
  /**
   * The square (its centre and half its side, metres) the rain's cover map is drawn over with this frame; null on a
   * frame that does not draw it. A sea that reaches into it is drawn in the map whatever the view holds, and one that
   * does not is left out of it.
   */
  cover: { x: number; z: number; half: number } | null;
};

export type LiteSea = {
  readonly mesh: Mesh;
  /** What moves the sea, as the last `update` left it: the frame's block is written from it. */
  readonly frame: SeaFrameUniforms;
  /** The sea's edge on the cove: the swash's table and the breaker's tracker, stepped by `update`. */
  readonly edge: SeaEdgeStep;
  /** The swell's significant height (m). */
  readonly hs: number;
  /** A frame: the rings, the swell and the wind sea, the edge, and whether the sea is shown. */
  update(frame: SeaFrame): void;
  /** Whether the last `update` showed the sea, and the rings it found water in. */
  readonly shown: boolean;
  readonly wetRings: number;
  /** Times a ring's depths, the swash's table and the coastline's row were sent, and the material's own buffer marked. */
  readonly ringUploads: number;
  readonly swashUploads: number;
  readonly coastUploads: number;
  readonly marks: number;
  /** How the wind sea is drawn: 0 with no field, 1 the loop once it has landed. */
  readonly windMode: 0 | 1;
  dispose(): void;
};

/** A table of 32-bit floats, four a texel, read at a whole texel. */
function floatTable(engine: EngineContext, width: number, height: number): Texture2D {
  return createRenderTexture2D(engine, width, height, { format: "rgba32float", minFilter: "nearest", magFilter: "nearest" });
}

/** No wind sea's field is drawn: its statistics are nothing. */
const NO_WIND_STATS: readonly [number, number, number, number] = [0, 0, 0, 0];

/**
 * The sea of world `seed` on `tier`, made after the scene is registered. A
 * world with no sea level makes none and is not handed here.
 */
export function createLiteSea(engine: EngineContext, scene: SceneContext, seed: number, tier: QualityTier, options: SeaOptions): LiteSea {
  const { uploads, bed, waterLevel } = options;
  const look = seaLookFor(tier);

  // The swell and the wind sea, the edge on the cove, and the surface's numbers.
  const ocean = createOceanFrame(seed, tier, options.ocean);
  const lag = createSeaWindLag();
  // What is drawn of the wind sea: no field here, and the sea's own state from the first frame's wind on.
  const windSea: WindSeaDrawn = {
    sea: { u10: 0, dir: [1, 0], hs: 0, tp: 0, onshore: 1, onshoreWeight: 1, coverage: 0, loopScale: 0, loopRate: 0 }, mode: 0, loopTime: 0, stats: NO_WIND_STATS,
  };
  const edge = createSeaEdgeStep(seed, ocean.field);
  const surface = createWaterSurface(WATER_ROWS.sea);
  // The sea's skin stays off; its offset seeds the white water's lace and whitecaps, so two worlds' foam differs.
  surface.skin = [0, waterSkinOffset(seed)];
  surface.bedTexels = bed.texels;
  surface.bedSpacing = bed.spacing;
  setWaterCove(surface, edge.cove.z0, edge.cove.halfWidth, edge.cove.toeD, edge.cove.faceGrade);
  const drift = createBumpDrift();
  const own = emptySeaUniforms();
  const frameValues = emptySeaFrameUniforms();

  // The tables: the swell's atlas, the swash's row, a layer of depths a ring.
  const { tables } = ocean.field;
  const atlas = floatTable(engine, tables.width, tables.rows);
  updateTextureRegion(engine, atlas, tables.data, { width: tables.width, height: tables.rows, bytesPerRow: tables.width * 16 });
  uploads?.count("textures", tables.data.byteLength);
  const coastRow = {
    y: OCEAN_ROW_COAST, width: OCEAN_TABLE_SAMPLES, height: 1, bytesPerRow: OCEAN_TABLE_SAMPLES * 16, dataOffset: OCEAN_ROW_COAST * OCEAN_TABLE_SAMPLES * 16,
  };
  if (tables.width !== OCEAN_TABLE_SAMPLES || tables.rows !== OCEAN_ATLAS_ROWS) throw new Error("the swell's tables are not the size the sea's shader reads");
  const swash = floatTable(engine, SWASH_COLUMNS, 1);
  const swashRow = { width: SWASH_COLUMNS, height: 1, bytesPerRow: SWASH_COLUMNS * 16 };
  const ringBeds = createTexture2DArray(engine, SEA_SIDE, SEA_SIDE, WATER_RING_COUNT, {
    format: "r32float", mipMaps: false, addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", minFilter: "nearest", magFilter: "nearest",
  });
  const ringLayer = { layer: 0, width: SEA_SIDE, height: SEA_SIDE, bytesPerRow: SEA_SIDE * 4 };
  const depths = new Float32Array(SEA_SIDE * SEA_SIDE);
  let bump: Texture2D | null = null;
  if (look.bump) {
    const bumpData = options.bump ?? waterBumpData();
    bump = createTexture2DFromPixels(engine, bumpData, WATER_BUMP_SIZE, WATER_BUMP_SIZE, {
      addressModeU: "repeat", addressModeV: "repeat", minFilter: "linear", magFilter: "linear", mipMaps: true,
    });
    uploads?.count("textures", bumpData.byteLength);
  }

  const material = createPbrMaterial({
    baseColorFactor: [WATER_ROWS.sea.lInf[0], WATER_ROWS.sea.lInf[1], WATER_ROWS.sea.lInf[2], 1], metallicFactor: 0,
    roughnessFactor: roughnessFor(0, WATER_ROWS.sea.shelter),
    // One alpha blends it over what lies under it; seen from either side, as the game leaves it unculled.
    alphaBlend: true, doubleSided: true, usePhysicalLightFalloff: true,
  });
  // The wind sea's loop: its frames' table made now and filled when the worker answers; the sea is the swell alone
  // until then. Without a worker, or if the bake fails, it never arrives.
  let loop: Texture2DArray | null = null;
  let loopMade: { heightStd: number; slopeVar: number } | null = null;
  let loopTime = 0;
  const loopStats: [number, number, number, number] = [0, 0, 0, 0];
  const abort = new AbortController();
  if (look.loop) {
    const frames = createTexture2DArray(engine, LOOP_N, LOOP_N, LOOP_FRAMES, {
      format: "rgba16float", mipMaps: false, addressModeU: "repeat", addressModeV: "repeat", minFilter: "linear", magFilter: "linear",
    });
    loop = frames;
    (options.startLoop ?? startLoopWorker)(seed, abort.signal).then((reply) => {
      if (disposed || reply.n !== LOOP_N || reply.frames !== LOOP_FRAMES) return;
      updateTextureRegion(engine, frames, reply.data, { width: LOOP_N, height: LOOP_N, layerCount: LOOP_FRAMES, bytesPerRow: LOOP_N * 8, rowsPerImage: LOOP_N });
      uploads?.count("textures", reply.data.byteLength);
      loopMade = { heightStd: reply.heightStd, slopeVar: reply.slopeVar };
    }).catch(() => undefined);
  }
  material.plugins = [seaPlugin(own, { atlas, swash, ringBeds, bed: bed.texture, bump, loop }, options.shared, look), options.air()];

  // The lattice, made once: the rings outermost first.
  const lattice = seaLattice();
  const mesh = createMeshFromData(engine, "sea", lattice.positions, lattice.normals, lattice.indices, lattice.uvs);
  mesh.material = material;
  mesh.renderOrder = SEE_THROUGH_ORDER.sea;
  uploads?.count("geometry", lattice.positions.byteLength + lattice.normals.byteLength + lattice.uvs.byteLength + lattice.indices.byteLength, 4);
  uploads?.made();
  // Hidden until a view holds water.
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);
  options.cover?.add(mesh, seaRestPlugin(options.shared, waterLevel));

  // The rings' samples of the ground, and the box each has water in.
  const rings: WaterRingSamples[] = [];
  for (let level = 0; level < WATER_RING_COUNT; level++) {
    rings.push(options.rings?.[level] ?? createWaterRingSamples(seed, level, options.start.x, options.start.z));
  }
  const boxes: (ReturnType<typeof seaWetBounds>)[] = rings.map(() => null);
  const moved: boolean[] = rings.map(() => true);
  const wet = new Uint8Array(SEA_SIDE * SEA_SIDE);
  const faceZ = seaFaceZ(seed);
  let wetRings = 0;
  let ringUploads = 0;
  let swashUploads = 0;
  let coastUploads = 0;
  let marks = 0;
  let shown = false;
  let stale = true;
  let bedSeen = -1;
  let disposed = false;

  /** The rings that moved, and those round a ring that moved: their depths sent, their boxes found again, the records written. */
  function placeRings(): void {
    let any = false;
    for (let level = 0; level < WATER_RING_COUNT; level++) {
      const ring = rings[level] as WaterRingSamples;
      const finerMoved = level > 0 && (moved[level - 1] as boolean);
      if (moved[level] as boolean) {
        ringLayer.layer = level;
        updateTextureRegion(engine, ringBeds, seaBedDepths(ring, waterLevel, depths), ringLayer);
        uploads?.stream("textures", depths.byteLength);
        ringUploads++;
      }
      // A ring that has not moved may still hold a hole cut for the finer ring's old footprint.
      if ((moved[level] as boolean) || finerMoved) {
        boxes[level] = seaWetBounds(ring, level > 0 ? waterHoleCellsFor(ring, rings[level - 1] as WaterRingSamples) : null, waterLevel, SWASH_FACE_LIFT_M, faceZ, wet);
        any = true;
      }
    }
    if (!any) return;
    seaRingRecords(rings, frameValues.seaRings);
    wetRings = 0;
    for (const box of boxes) if (box !== null) wetRings++;
  }
  placeRings();

  return {
    mesh,
    frame: frameValues,
    edge,
    get hs() {
      return ocean.numbers.swell[3];
    },
    get shown() {
      return shown;
    },
    get wetRings() {
      return wetRings;
    },
    get ringUploads() {
      return ringUploads;
    },
    get swashUploads() {
      return swashUploads;
    },
    get coastUploads() {
      return coastUploads;
    },
    get marks() {
      return marks;
    },
    get windMode() {
      return windSea.mode === 0 ? 0 : 1;
    },
    update(f) {
      if (disposed) return;
      for (let level = 0; level < WATER_RING_COUNT; level++) moved[level] = updateWaterRingSamples(rings[level] as WaterRingSamples, seed, f.centreX, f.centreZ);
      placeRings();
      if (bedSeen !== bed.sent) {
        bedSeen = bed.sent;
        surface.bedOrigin = [bed.originX, bed.originZ];
      }
      const windDir: [number, number] = [f.wind.dirX, f.wind.dirZ];
      setWaterWind(surface, f.wind.speed, windDir);
      advanceWater(surface, f.seconds, true);
      // The swell's phases and the wind sea's state, the sea following its wind a minute behind.
      const rowWritten = ocean.update(f.centreZ, f.seconds, f.wind.speed, windDir, f.hour, (blowing) => {
        windSea.sea = lag.step(blowing, f.seconds);
        if (loopMade !== null) {
          // The loop's own clock, run at the sea's rate, and what the shaders normalise the loop by at this wind.
          loopTime = loopTimeAfter(loopTime, lag.dt, windSea.sea);
          loopStats[0] = loopMade.heightStd * windSea.sea.loopScale;
          loopStats[1] = loopMade.slopeVar;
          windSea.mode = 1;
          windSea.loopTime = loopTime;
          windSea.stats = loopStats;
        }
        return windSea;
      });
      if (rowWritten) {
        updateTextureRegion(engine, atlas, tables.data, coastRow);
        uploads?.stream("textures", coastRow.bytesPerRow);
        coastUploads++;
      }
      // The sea's edge, on the same seconds and swell, under the onshore weight the wind has this frame.
      edge.step(f.seconds, ocean.numbers.windDir[3]);
      // The low tier's bump slides at a fixed rate.
      drift.step(f.dt, f.wind.speed, windDir, look.bump, false);
      seaFrameUniforms(ocean.numbers, surface, drift, frameValues);
      if (seaUniforms(surface, waterLevel, ocean.numbers, own)) stale = true;
      // The frame's own pass draws the sea while the view holds a ring's water; the cover map has its own word, said on
      // each frame that draws it: whether its square reaches a ring's water.
      let seen = false;
      let covered = false;
      for (const box of boxes) {
        if (box === null) continue;
        covered ||= f.cover !== null
          && box.min[0] < f.cover.x + f.cover.half && box.max[0] > f.cover.x - f.cover.half && box.min[2] < f.cover.z + f.cover.half && box.max[2] > f.cover.z - f.cover.half;
        // A ring's box is kilometres across: the planes alone keep one that lies wholly beside the view.
        seen ||= boxInPlanes(box.min[0], box.min[1], box.min[2], box.max[0], box.max[1], box.max[2], f.planes)
          && !cornersPastBox(box.min[0], box.min[1], box.min[2], box.max[0], box.max[1], box.max[2], f.corners);
      }
      if (f.cover !== null) options.cover?.show?.(mesh, covered);
      if (seen !== shown) {
        shown = seen;
        setMeshVisible(mesh, shown);
      }
      if (!shown) return;
      // The sheet up the cove's face, as the table stands this frame.
      updateTextureRegion(engine, swash, edge.table.data, swashRow);
      uploads?.count("textures", edge.table.data.byteLength);
      swashUploads++;
      if (stale) {
        stale = false;
        markMaterialUboDirty(material);
        uploads?.marked();
        marks++;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      options.cover?.remove(mesh);
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
      uploads?.dropped();
    },
  };
}
