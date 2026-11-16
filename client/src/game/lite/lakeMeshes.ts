/**
 * The lakes' water on Babylon Lite: one surface a lake, as the game lays it
 * on Babylon.js (`createWater`'s lakes in `renderer.ts`), from what the game
 * draws them with, computed with no engine: the surface's grid and the
 * bed's depth under each vertex (`lakeSurfaceGrid.ts`), the bed's square
 * following the camera (`bedFollow.ts`, in `waterBed.ts`), the ripple bump and its drift
 * (`waterBump.ts`, `waterSurface.ts`), each lake's numbers
 * (`waterSurface.ts`), its calm by the hour and the weather's name
 * (`lakeCalmFrame.ts`), its skyline (`lakeSkyline.ts`) and whether a view
 * holds it (`lakeSeen.ts`). The shading is `lakePlugin.ts`'s.
 *
 * - **A lake is one blended draw, and none out of view.** Lite culls no
 *   mesh, so each surface is shown only while the view holds its lake
 *   (`lakeDrawnFrom`: its square in the view's planes, and then its shore,
 *   or the eye beside it).
 * - **A lake writes nothing while nothing of its own moves.** What moves
 *   every frame (the lakes' time, the wind's integral, the bump's drift) is
 *   the frame's block, which is written once a frame whatever is drawn. A
 *   lake's own buffer is written when its calm, its cat's-paws, its
 *   roughness, its shade or the bed's square has moved, and only while it
 *   is shown: one that moved out of view is written when it comes back.
 * - **The bed's square is one texture**, the sea's too (`waterBed.ts`),
 *   which the renderer steps once a frame before the lakes read where it
 *   stands.
 * - **Among the see-through draws it stands where the game's does**: after
 *   the rain (`drawOrder.ts`). Its vertices are laid in the world's own
 *   coordinates, so the mesh stands at the origin as the others do and its
 *   place alone orders it.
 *
 * The surface stands 2 cm over the lake's level, as the game's does.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, createRenderTexture2D, createTexture2DFromPixels, disposeMeshGpu, markMaterialUboDirty,
  removeFromScene, setMeshVisible, updateTextureRegion,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type PluginUniformBlock, type SceneContext, type Texture2D,
} from "@babylonjs/lite";
import type { LakeSource } from "../../sim/terrain.js";
import { LAKE_SURFACE_REACH } from "../bedHeight.js";
import { lakeCalmUnder, type CalmFade, type LakeCalmFrame } from "../lakeCalmFrame.js";
import { lakeSunShare } from "../lakeRipples.js";
import { lakeDrawnFrom, lakeViewPoints, type ViewPlane } from "../lakeSeen.js";
import { SKYLINE_SHADE, SKYLINE_TEXELS, skylineElevations, skylineTexels, skylineTrees } from "../lakeSkyline.js";
import { LAKE_SURFACE_SPACING, lakeSurfaceDepths, lakeSurfaceGrid } from "../lakeSurfaceGrid.js";
import type { PreparedLakeSurface } from "../preparedScene.js";
import type { QualityTier } from "../quality.js";
import { SUN_PEAK } from "../sky.js";
import type { SkyState } from "../skyState.js";
import { WATER_BUMP_SIZE, waterBumpData } from "../waterBump.js";
import { lakeSkin, lakeWaterRow, roughnessFor, waterSkinOffset } from "../waterShading.js";
import {
  advanceWater, createBumpDrift, createWaterSurface, emptyLakeUniforms, emptyWaterFrameUniforms, lakeUniforms, setWaterCalm, setWaterLakeBody,
  setWaterLakeTime, setWaterPawCover, setWaterShade, setWaterWind, waterFrameUniforms, waterRoughnessDue,
  type LakeUniforms, type WaterFrameUniforms, type WaterSurface,
} from "../waterSurface.js";
import type { WeatherParams } from "../weather.js";
import type { WindRecord } from "../windParams.js";
import { SEE_THROUGH_ORDER } from "./drawOrder.js";
import type { FrameUploads } from "./frameUploads.js";
import { lakePlugin } from "./lakePlugin.js";
import type { CoverRegistry } from "./rainMap.js";
import type { LiteWaterBed } from "./waterBed.js";

/** How far over its lake's level a surface stands, metres. */
export const LAKE_SURFACE_LIFT = 0.02;

/** What is made ahead of a lake, where the world's worker made it: its surface and its skyline. */
export type LakeMade = { surface?: PreparedLakeSurface | null; skyline?: Float32Array | null };

/** What the lakes are made with. */
export type LakeOptions = {
  /** The bed's square, which the renderer steps before each `update`. */
  bed: LiteWaterBed;
  /** The air's plugin, one a material. */
  air: () => MaterialPlugin;
  /** The frame's block. */
  shared: PluginUniformBlock;
  /** The weather's preset as the calm follows it: the renderer's, which names it; stepped here, a frame at a time. */
  calm: CalmFade;
  /** The rain's cover map, which every surface stands in as open water. */
  cover?: CoverRegistry;
  /** Each lake's pieces made ahead, by its place in the list. */
  made?: readonly (LakeMade | null)[];
  /** The bump's picture made ahead. */
  bump?: Uint8Array | null;
  uploads?: FrameUploads;
};

/** A frame as the lakes read it. */
export type LakeFrame = {
  /** The eye and the way it looks. */
  eye: { readonly x: number; readonly y: number; readonly z: number };
  forward: { readonly fx: number; readonly fy: number; readonly fz: number };
  /** The view's planes. */
  planes: readonly ViewPlane[];
  /** The shared seconds the water moves on, and the frame's length on the renderer's clock. */
  seconds: number;
  dt: number;
  weather: WeatherParams;
  wind: WindRecord;
  hour: number;
  /** The sky's state and the scene's share of the image-based light; null before the sky's first slices. */
  sky: SkyState | null;
  environmentIntensity: number;
  /** The frame's height in pixels and the lens's vertical field of view. */
  frameHeight: number;
  fov: number;
  /**
   * The square (its centre and half its side, metres) the rain's cover map is drawn over with this frame; null on a
   * frame that does not draw it. A lake that reaches into it is shown for the frame whatever the view holds: a
   * hidden mesh is in no pass, the map's among them.
   */
  cover: { x: number; z: number; half: number } | null;
};

export type LiteLakes = {
  /** Each lake's surface, by its place in the list. */
  readonly meshes: readonly Mesh[];
  /** What every lake reads alike, as the last `update` left it: the frame's block is written from it. */
  readonly frame: WaterFrameUniforms;
  /** A frame: where the bed stands, the calm, each lake's numbers and whether it is shown. */
  update(frame: LakeFrame): void;
  /** Lakes shown by the last `update`. */
  readonly shown: number;
  /** Times a lake's own buffer was marked to be written. */
  readonly marks: number;
  dispose(): void;
};

type Lake = {
  source: LakeSource;
  surface: WaterSurface;
  uniforms: LakeUniforms;
  material: PbrMaterialProps;
  mesh: Mesh;
  /** Half the side of the surface's square, and the shore's points a view is tested against. */
  half: number;
  points: Float32Array;
  shown: boolean;
  /** The lake's own buffer stands behind its record: marked when it is next shown. */
  stale: boolean;
};

/** A table of one 32-bit float a texel, read at a whole texel. */
function floatTable(engine: EngineContext, width: number, height: number): Texture2D {
  return createRenderTexture2D(engine, width, height, { format: "r32float", minFilter: "nearest", magFilter: "nearest" });
}

/**
 * The surfaces of `lakes` in world `seed` on `tier`, made after the scene
 * is registered. A world with no lake makes nothing and is not handed here.
 */
export function createLiteLakes(
  engine: EngineContext, scene: SceneContext, seed: number, lakes: readonly LakeSource[], tier: QualityTier, options: LakeOptions,
): LiteLakes {
  const { uploads } = options;
  // The ripple's picture is a constant: every lake's first octave and, on the tiers with two, its second.
  const bumpData = options.bump ?? waterBumpData();
  const bump = createTexture2DFromPixels(engine, bumpData, WATER_BUMP_SIZE, WATER_BUMP_SIZE, {
    addressModeU: "repeat", addressModeV: "repeat", minFilter: "linear", magFilter: "linear", mipMaps: true,
  });
  uploads?.count("textures", bumpData.byteLength);
  const { bed } = options;
  /** The bed's square the lakes' records were last written for. */
  let bedSeen = -1;
  const drift = createBumpDrift();
  const { calm } = options;
  const calmFrame: LakeCalmFrame = { share: 0, rough: false, roughShare: 0, cover: 0, smearPx: 0 };
  const frameValues = emptyWaterFrameUniforms();
  const shade: [number, number, number] = [0, 0, 0];
  let marks = 0;
  let shownCount = 0;
  let disposed = false;

  const made: Lake[] = lakes.map((source, index) => {
    const row = lakeWaterRow(source.murk);
    const surface = createWaterSurface(row);
    surface.octaves = tier === "low" ? 1 : 2;
    surface.skin = [lakeSkin(source.murk), waterSkinOffset(seed)];
    surface.bedTexels = bed.texels;
    surface.bedSpacing = bed.spacing;
    setWaterLakeBody(surface, source.x, source.level, source.z, source.shape.meanRadius);
    const uniforms = emptyLakeUniforms();
    // The skyline's elevations from the lake's centre, one row.
    const ahead = options.made?.[index] ?? null;
    const elevations = skylineTexels(ahead?.skyline ?? skylineElevations(source, seed, skylineTrees(source, seed)));
    const skyline = floatTable(engine, SKYLINE_TEXELS, 1);
    updateTextureRegion(engine, skyline, elevations, { width: SKYLINE_TEXELS, height: 1, bytesPerRow: SKYLINE_TEXELS * 4 });
    uploads?.count("textures", elevations.byteLength);
    const material = createPbrMaterial({
      baseColorFactor: [row.lInf[0], row.lInf[1], row.lInf[2], 1], metallicFactor: 0, roughnessFactor: roughnessFor(0, row.shelter),
      // One alpha blends it over what lies under it; seen from either side, as the game leaves it unculled.
      alphaBlend: true, doubleSided: true, usePhysicalLightFalloff: true,
    });
    material.plugins = [lakePlugin(uniforms, { bump, bed: bed.texture, skyline }, options.shared), options.air()];
    // The surface's grid about the lake's centre, laid in the world's coordinates: the mesh stands at the origin.
    const grid = ahead?.surface ?? lakeSurfaceGrid(source.shape);
    const depths = ahead?.surface?.depths ?? lakeSurfaceDepths(seed, source, grid.positions);
    const positions = new Float32Array(grid.positions.length);
    for (let v = 0; v < positions.length; v += 3) {
      positions[v] = (grid.positions[v] as number) + source.shape.cx;
      positions[v + 1] = (grid.positions[v + 1] as number) + source.level + LAKE_SURFACE_LIFT;
      positions[v + 2] = (grid.positions[v + 2] as number) + source.shape.cz;
    }
    const mesh = createMeshFromData(engine, `pond_${index}`, positions, grid.normals, grid.indices, grid.uvs);
    mesh.material = material;
    mesh.pluginVertexData = depths;
    mesh.renderOrder = SEE_THROUGH_ORDER.water;
    uploads?.count("geometry", positions.byteLength + grid.normals.byteLength + grid.uvs.byteLength + grid.indices.byteLength, 4);
    uploads?.count("pluginVertices", depths.byteLength);
    uploads?.made();
    // Hidden until a view holds it.
    setMeshVisible(mesh, false);
    addToScene(scene, mesh);
    options.cover?.add(mesh);
    return {
      source, surface, uniforms, material, mesh,
      half: source.shape.shoreMax + LAKE_SURFACE_REACH + LAKE_SURFACE_SPACING,
      points: lakeViewPoints(source.shape, source.level),
      shown: false, stale: true,
    };
  });

  /** Where the bed's square now stands, to every lake's record. */
  function readBed(): void {
    if (bedSeen === bed.sent) return;
    bedSeen = bed.sent;
    for (const lake of made) lake.surface.bedOrigin = [bed.originX, bed.originZ];
  }
  readBed();

  return {
    meshes: made.map((lake) => lake.mesh),
    frame: frameValues,
    get shown() {
      return shownCount;
    },
    get marks() {
      return marks;
    },
    update(f) {
      if (disposed) return;
      readBed();
      calm.step(f.dt);
      // The lakes' bump drifts downwind at the wind's speed.
      const windDir: [number, number] = [f.wind.dirX, f.wind.dirZ];
      drift.step(f.dt, f.wind.speed, windDir, false, true);
      // The forest's shade under the skyline: the sky's horizon away from the sun, by the scene's share of the sky's light.
      if (f.sky !== null) {
        shade[0] = f.sky.horizonAway.r * SKYLINE_SHADE * f.environmentIntensity;
        shade[1] = f.sky.horizonAway.g * SKYLINE_SHADE * f.environmentIntensity;
        shade[2] = f.sky.horizonAway.b * SKYLINE_SHADE * f.environmentIntensity;
      }
      const sun = f.sky === null ? 0 : lakeSunShare(f.sky.sunIntensity, f.sky.sunDir.y, SUN_PEAK);
      shownCount = 0;
      for (const lake of made) {
        const { surface, source } = lake;
        setWaterWind(surface, f.wind.speed, windDir);
        surface.rain = f.weather.rain;
        surface.sun = sun;
        advanceWater(surface, f.seconds, false);
        const c = lakeCalmUnder(f.hour, calm.from, calm.to, calm.progress, f.weather, f.wind.speed, surface.row.shelter, f.frameHeight, f.fov, calmFrame);
        setWaterLakeTime(surface, f.wind.time);
        setWaterPawCover(surface, c.cover);
        // With no mirror the shore's weight is 1 until the surface is rough all over, where the share has already reached 0.
        setWaterCalm(surface, c.share, c.roughShare < 1 ? 1 : 0, c.smearPx);
        if (f.sky !== null) setWaterShade(surface, shade);
        const roughness = waterRoughnessDue(surface, lake.material.roughnessFactor ?? null, f.wind.speed);
        if (roughness !== null) {
          lake.material.roughnessFactor = roughness;
          lake.stale = true;
        }
        if (lakeUniforms(surface, source.level, { panorama: false, skyline: f.sky !== null }, lake.uniforms)) lake.stale = true;
        const covered = f.cover !== null
          && Math.abs(source.shape.cx - f.cover.x) < lake.half + f.cover.half && Math.abs(source.shape.cz - f.cover.z) < lake.half + f.cover.half;
        const shown = covered || lakeDrawnFrom(
          source.shape, source.level, lake.half, lake.points, f.planes, f.eye.x, f.eye.y, f.eye.z, f.forward.fx, f.forward.fy, f.forward.fz,
        );
        if (shown !== lake.shown) {
          lake.shown = shown;
          setMeshVisible(lake.mesh, shown);
        }
        if (shown) {
          shownCount++;
          if (lake.stale) {
            lake.stale = false;
            markMaterialUboDirty(lake.material);
            uploads?.marked();
            marks++;
          }
        }
      }
      // Every lake's frame values are one lake's: the wind, the clock and the rain are the page's.
      const first = made[0];
      if (first !== undefined) waterFrameUniforms(first.surface, drift, frameValues);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const lake of made) {
        options.cover?.remove(lake.mesh);
        removeFromScene(scene, lake.mesh);
        disposeMeshGpu(lake.mesh);
        uploads?.dropped();
      }
    },
  };
}
