/**
 * The terrain's material as plugins on Babylon Lite's PBR material: the
 * ground's layers blended by the mesh's weights, the road, the made
 * features and the trail painted over them, the far cover, and the wet
 * surfaces (`terrainUniforms.ts` has the numbers each is drawn with,
 * `terrainTables.ts` the float tables, `groundLayers.ts` the layers' images,
 * `terrainVertices.ts` what a terrain mesh carries a vertex). The WGSL is in
 * `shaders/terrain/`, imported with `?raw`.
 *
 * Where the WGSL goes into the material:
 *
 * - Lite has split the base colour into albedo and F0 before the blend
 *   runs, so the blend starts again from the base colour and a last plugin
 *   (`terrainSplitPlugin`, after the wet look) makes the split with the
 *   terrain's F0 and specular weight.
 * - The far cover's sun term is at Lite's point inside its own light loop.
 * - The layer weights, the cover and the vertex colour ride in the mesh's
 *   plugin vertex data, one interleaved buffer (`terrainVertexData`).
 * - Every texture shares one sampler: a stage has sixteen, and the material
 *   reads eleven textures. A layer's albedo is a one-layer array, and the
 *   three float tables are read with `textureLoad` at the texel a nearest
 *   read lands on.
 * - The WGSL samples inside branches and loops, so the fragment module turns
 *   the derivative-uniformity diagnostic off for itself.
 */
import type { MaterialPlugin, PluginUniformBlock, Texture2D, Texture2DArray } from "@babylonjs/lite";
import { finish, sliceDue, type Slices } from "@csarkosh/engine/game/syncJobs";
import { emptyTerrainUniforms, layerMeanInverse, type TerrainUniforms } from "@csarkosh/engine/game/terrainUniforms";
import { TERRAIN_ATTRIBUTES, TERRAIN_VERTEX_SIZES, type TerrainVertices } from "@csarkosh/engine/game/terrainVertices";
import type { WetUniforms } from "@csarkosh/engine/game/wetSurface";
import { frameReads, ownFields } from "./frameBlock.js";
import { uniformFields, writeUniforms, type UniformField } from "@csarkosh/engine/game/lite/pluginUniforms";
import { WET_FIELDS, WET_WEATHER, WET_WGSL, writeWetUniforms } from "@csarkosh/engine/game/lite/wetWgsl";
import defsSource from "../shaders/terrain/defs.wgsl?raw";
import mainBeginSource from "../shaders/terrain/mainBegin.wgsl?raw";
import blendSource from "../shaders/terrain/blend.wgsl?raw";
import roadSource from "../shaders/terrain/road.wgsl?raw";
import featureSource from "../shaders/terrain/feature.wgsl?raw";
import trailSource from "../shaders/terrain/trail.wgsl?raw";
import farLightSource from "../shaders/terrain/farLight.wgsl?raw";
import sunSource from "../shaders/terrain/sun.wgsl?raw";
import wetLightsSource from "../shaders/terrain/wetLights.wgsl?raw";
import splitSource from "../shaders/terrain/split.wgsl?raw";
import { fill, wgsl } from "@csarkosh/engine/game/shaders/shaderText";
import derivativeUniformitySource from "../shaders/diagnostic/derivativeUniformity.wgsl?raw";

/**
 * The material's uniforms: the terrain's own by name (`terrainUniforms`),
 * and the material's albedo, which the road paint lays its colours over as
 * the blend lays the layers' (`terrainSurfaceUnder`: white, scaled by the
 * weather's wetness).
 */
export type TerrainMaterialUniforms = TerrainUniforms & { terrainAlbedo: [number, number, number] };

/** A record of the right shape, every component zero, the albedo white. */
export function emptyTerrainMaterialUniforms(): TerrainMaterialUniforms {
  return { ...emptyTerrainUniforms(), terrainAlbedo: [1, 1, 1] };
}

/** The plugin's fields: one a uniform, in the record's order. */
export const TERRAIN_FIELDS: readonly UniformField[] = uniformFields(emptyTerrainMaterialUniforms());

// The WGSL below reads each uniform by its bare name; in the material's
// buffer it is `material.<name>`.
const uniformNames = new RegExp(`\\b(${TERRAIN_FIELDS.map((field) => field.name).join("|")})\\b`, "g");
const bind = (wgsl: string): string => wgsl.replace(uniformNames, "material.$1");

/** The far cover's band, metres from the eye: the low tier's, and the other tiers' (`terrainCoverFor`). */
const FAR_BAND_LOW = "14.4,18.0";
const FAR_BAND_FULL = "24.0,30.0";

const DEFS = wgsl(defsSource);

const MAIN_BEGIN = wgsl(mainBeginSource);

/** One over a ground layer's mean colour, as the blend multiplies its texel by it: the layer's own colour made neutral (`LAYER_MEAN_RGB`). */
const meanInv = (layer: Parameters<typeof layerMeanInverse>[0]): string => `vec3<f32>(${layerMeanInverse(layer).join(",")})`;

// The blend. It starts from the material's colour times the vertex colour.
const BLEND = fill(wgsl(blendSource), { grassMeanInv: meanInv("grass"), floorMeanInv: meanInv("floor"), sandMeanInv: meanInv("sand"), pebbleMeanInv: meanInv("pebble"), rockMeanInv: meanInv("rock") });

// The road, its bands mirrored in `roadPaint.ts`. The centreline table is read at its texel.
const ROAD = wgsl(roadSource);

// The made features.
const FEATURE = wgsl(featureSource);

// The trail, its bands mirrored in `trailPaint.ts`. The segment table's three reads are at their texels: a cell's row
// (2 + cell row), the segment row 0, the arc-length row 1; the best segment is kept as its column.
const TRAIL = wgsl(trailSource);

// The far cover's light, then what the PBR shader does after the point: its
// reflectivity block takes the material's roughness times terrainRough, and its geometry block reads the
// normal the blend left (Lite read N for these before the point).
const FAR_LIGHT = wgsl(farLightSource);

// The far cover's answer to the sun: a directional light's Lambert term scaled by the far cover's. Lite
// has added the plain term by this point of its light loop, so the sum takes the difference.
const SUN = wgsl(sunSource);

/** The textures the material reads: each layer's albedo a one-layer array,
 * the normals and the RAH maps six layers each (`groundLayers.ts`), and the
 * three float tables (`terrainTables.ts`). */
export type TerrainTextures = {
  grass: Texture2DArray; floor: Texture2DArray; rock: Texture2DArray; sand: Texture2DArray; pebble: Texture2DArray;
  normals: Texture2DArray; rah: Texture2DArray; asphalt: Texture2DArray;
  roadCenter: Texture2D; trailTable: Texture2D; featureTex: Texture2D;
};

/** The textures in the order the plugin declares and binds them, by the name
 * the WGSL reads each under: the eight arrays, then the three tables. */
export const TERRAIN_TEXTURE_ORDER: readonly (readonly [string, keyof TerrainTextures])[] = [
  ["terrainGrass", "grass"], ["terrainFloor", "floor"], ["terrainRock", "rock"], ["terrainSand", "sand"], ["terrainPebble", "pebble"],
  ["terrainNormals", "normals"], ["terrainRAH", "rah"], ["roadAsphalt", "asphalt"],
  ["roadCenter", "roadCenter"], ["trailTable", "trailTable"], ["featureTex", "featureTex"],
];
/** How many of them are layer arrays, sampled; the rest are tables, fetched. */
export const TERRAIN_ARRAY_TEXTURES = 8;

/** Which of the paints a world has: a world with no road, no trail or no
 * made features leaves that paint's statements out, and its table is never read. */
export type TerrainPaints = { road: boolean; trail: boolean; features: boolean };

/**
 * A terrain vertex's own data in the mesh's plugin vertex buffer: the two
 * weight sets, the cover and the vertex colour, by the name the vertex stage
 * reads each under, with the varying it is handed on as, how many floats it
 * is and the float it starts at.
 */
export const TERRAIN_VERTEX_LAYOUT = (() => {
  const parts = [
    { name: TERRAIN_ATTRIBUTES.weights, floats: TERRAIN_VERTEX_SIZES.weights, varying: "vTerrainW" },
    { name: TERRAIN_ATTRIBUTES.weights2, floats: TERRAIN_VERTEX_SIZES.weights2, varying: "vTerrainW2" },
    { name: TERRAIN_ATTRIBUTES.cover, floats: TERRAIN_VERTEX_SIZES.cover, varying: "vTerrainCover" },
    { name: "terrainColor", floats: TERRAIN_VERTEX_SIZES.colors, varying: "vTerrainColor" },
  ];
  let offset = 0;
  return parts.map((part) => {
    const at = offset;
    offset += part.floats;
    return { ...part, offset: at };
  });
})();

/** Floats a vertex in the plugin vertex buffer. */
export const TERRAIN_VERTEX_FLOATS = TERRAIN_VERTEX_LAYOUT.reduce((sum, part) => sum + part.floats, 0);

/**
 * A terrain mesh's plugin vertex data: `vertices`' weights, cover and colours
 * interleaved a vertex (`TERRAIN_VERTEX_LAYOUT`). Fills and returns `out`
 * where it is the right length, so a ring written again makes nothing; else
 * an array of its own.
 */
export function terrainVertexData(vertices: TerrainVertices, out?: Float32Array | null): Float32Array {
  return finish(terrainVertexDataSlices(vertices, out));
}

/** Vertices copied between two looks at the scheduler's clock (`sliceDue`): a few thousand floats. */
const COPY_BLOCK = 2048;

/** `terrainVertexData` in slices, each ended by the scheduler's clock between two blocks of vertices. */
export function* terrainVertexDataSlices(vertices: TerrainVertices, out?: Float32Array | null): Slices<Float32Array> {
  const count = vertices.positions.length / TERRAIN_VERTEX_SIZES.positions;
  const length = count * TERRAIN_VERTEX_FLOATS;
  const data = out !== undefined && out !== null && out.length === length ? out : new Float32Array(length);
  const sources = [vertices.weights, vertices.weights2, vertices.cover, vertices.colors];
  for (let p = 0; p < TERRAIN_VERTEX_LAYOUT.length; p++) {
    const part = TERRAIN_VERTEX_LAYOUT[p] as (typeof TERRAIN_VERTEX_LAYOUT)[number];
    const source = sources[p] as Float32Array;
    for (let i = 0; i < count; i++) {
      const from = i * part.floats;
      const to = i * TERRAIN_VERTEX_FLOATS + part.offset;
      for (let k = 0; k < part.floats; k++) data[to + k] = source[from + k] as number;
      if (i % COPY_BLOCK === COPY_BLOCK - 1 && sliceDue(COPY_UNITS)) yield;
    }
  }
  return data;
}

/** The units of work (`sliceDue`) a block of `COPY_BLOCK` vertices' copy counts: about as long as eight terrain samples. */
const COPY_UNITS = 8;

const VERTEX_FORMATS = ["float32", "float32x2", "float32x3", "float32x4"] as const;
const VERTEX_TYPES = ["f32", "vec2<f32>", "vec3<f32>", "vec4<f32>"] as const;

/**
 * The terrain's plugin: the blend, the paints `paints` names, and the far
 * cover with its sun term, drawn by `values` (one record, filled in place
 * every frame and read whenever the material's uniforms are written) and
 * `textures`. `farLow`: the far cover takes the low tier's band. Given
 * `shared`, the frame's block (`frameBlock.ts`), the whole record is read
 * from it and the material carries none: the terrain's two materials are
 * drawn by the one record, which the renderer writes to the block once a
 * frame.
 */
export function terrainPlugin(
  values: TerrainMaterialUniforms, textures: TerrainTextures, farLow: boolean, paints: TerrainPaints, shared?: PluginUniformBlock,
): MaterialPlugin {
  const before = BLEND + (paints.road ? ROAD : "") + (paints.features ? FEATURE : "") + (paints.trail ? TRAIL : "") + FAR_LIGHT;
  const reads = (wgsl: string): string => (shared === undefined ? wgsl : frameReads(wgsl));
  const stride = TERRAIN_VERTEX_FLOATS * 4;
  return {
    name: "TerrainTexture",
    priority: 200,
    defines: { farLow, road: paints.road, trail: paints.trail, features: paints.features },
    getFragmentDirectives: () => wgsl(derivativeUniformitySource),
    getCustomCode: (stage) =>
      stage === "fragment"
        ? {
            CUSTOM_FRAGMENT_DEFINITIONS: reads(bind(DEFS.replace("FAR_BAND", farLow ? FAR_BAND_LOW : FAR_BAND_FULL))),
            CUSTOM_FRAGMENT_MAIN_BEGIN: reads(MAIN_BEGIN),
            CUSTOM_FRAGMENT_BEFORE_LIGHTS: reads(bind(before)),
            CUSTOM_FRAGMENT_LIGHT: reads(SUN),
          }
        : { CUSTOM_VERTEX_MAIN_END: TERRAIN_VERTEX_LAYOUT.map((part) => `out.${part.varying}=${part.name};`).join("") },
    getVertexAttributes: () =>
      TERRAIN_VERTEX_LAYOUT.map((part) => ({
        name: part.name,
        type: VERTEX_TYPES[part.floats - 1] as string,
        format: VERTEX_FORMATS[part.floats - 1] as GPUVertexFormat,
        stride,
        offset: part.offset * 4,
      })),
    getVaryings: () => TERRAIN_VERTEX_LAYOUT.map((part) => ({ name: part.varying, type: VERTEX_TYPES[part.floats - 1] as "f32" | "vec4<f32>" })),
    ...(shared === undefined ? { getUniforms: () => ({ ubo: [...TERRAIN_FIELDS] }) } : { getUniformBlocks: () => [shared] }),
    getSamplers: () =>
      TERRAIN_TEXTURE_ORDER.map(([name], i) => ({
        texture: name,
        ...(i === 0 ? { sampler: "terrainSmp" } : {}),
        ...(i < TERRAIN_ARRAY_TEXTURES ? { textureType: "texture_2d_array<f32>" as const } : { sampleType: "unfilterable-float" as const }),
      })),
    writeUbo(data, offsets) {
      if (shared === undefined) writeUniforms(data, offsets, values);
    },
    bindTextures(out) {
      TERRAIN_TEXTURE_ORDER.forEach(([, key], i) => out.push(i === 0 ? { texture: textures[key] } : { texture: textures[key], sampler: false }));
    },
    getActiveTextures(out) {
      for (const [, key] of TERRAIN_TEXTURE_ORDER) out.push(textures[key]);
    },
  };
}

// The wet look as the terrain draws it (a tarn's own shore decides what is inside it), then the wet
// look's roughness. After the terrain's statements at the point.
const WET_LIGHTS_TERRAIN = wgsl(wetLightsSource);

/** The wet plugin's fields: one a uniform, in the record's order, the swash's table last. */
export const TERRAIN_WET_FIELDS: readonly UniformField[] = WET_FIELDS;

/**
 * The wet look on the terrain, drawn by `values` (`wetUniforms`: one record,
 * filled in place and read whenever the material's uniforms are written).
 * After the terrain's plugin, whose feature table it reads.
 */
export function terrainWetPlugin(values: WetUniforms, shared?: PluginUniformBlock): MaterialPlugin {
  const reads = (wgsl: string): string => (shared === undefined ? wgsl : frameReads(wgsl));
  // Given the frame's block, the wet line and the weather are read from it: the material's own is its cap.
  const fields = shared === undefined ? TERRAIN_WET_FIELDS : ownFields(TERRAIN_WET_FIELDS);
  return {
    name: "Wet",
    priority: 240,
    getCustomCode: (stage) =>
      stage === "fragment"
        ? {
          CUSTOM_FRAGMENT_DEFINITIONS: reads(WET_WGSL),
          CUSTOM_FRAGMENT_UPDATE_DIFFUSE: reads(WET_WEATHER),
          CUSTOM_FRAGMENT_BEFORE_LIGHTS: reads(WET_LIGHTS_TERRAIN),
        }
        : null,
    getUniforms: () => ({ ubo: [...fields] }),
    ...(shared === undefined ? {} : { getUniformBlocks: () => [shared] }),
    writeUbo(data, offsets) {
      if (shared === undefined) writeWetUniforms(data, offsets, values);
      else writeUniforms(data, offsets, { wetCap: values.wetCap });
    },
  };
}

/**
 * The split of the base colour into albedo and F0, with the terrain's F0 and
 * specular weight in it: Babylon's legacy energy conservation for a
 * dielectric. Last at the point, after the wet look's albedo.
 */
export function terrainSplitPlugin(): MaterialPlugin {
  return {
    name: "TerrainSplit",
    priority: 250,
    getCustomCode: (stage) =>
      stage === "fragment"
        ? { CUSTOM_FRAGMENT_BEFORE_LIGHTS: wgsl(splitSource) }
        : null,
  };
}
