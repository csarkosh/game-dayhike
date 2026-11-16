/**
 * The sea's water as a material plugin on Babylon Lite: Lite's PBR with the
 * sea's waves and shading spliced in (`seaWgsl.ts` has the WGSL, the game's
 * GLSL statement for statement, over the water's own definitions in
 * `waterWgsl.ts`; `waterPlugin.ts` with an ocean is the same plugin on
 * Babylon.js): the lattice's vertices placed on their rings and moved by
 * the swell, the swash's sheet lifting the sea up the cove's face, the depth
 * of water under each pixel, the swell's normal with the wind sea on it, the
 * rain's rings, the one alpha it is blended by, the white water and the
 * plunging lip, and the roughness of the slopes its normal leaves undrawn.
 *
 * - **Its numbers** are two records by name (`seaUniforms.ts`): the sea's
 *   own (`SeaUniforms`), in the material's buffer, written when the bed's
 *   square moves; and what moves with the frame, which is the frame's block
 *   (`frameBlock.ts`).
 * - **Its tables** are read at a whole texel, by both stages where a stage
 *   needs them: the swell's atlas and the swash's row (32-bit floats, four a
 *   texel), the depth of water under each ring's vertices (a layer a ring,
 *   the vertex stage's alone) and the bed's heights (the fragment's).
 * - **Its pictures** are the ripple bump, on the tier that draws the wind
 *   sea with it, and the wind sea's field on the tiers that draw one: the
 *   baked loop's frames, or the displacement and the slopes of the cascades
 *   computed each frame (`seaFft.ts`), with the loop's frames in the
 *   displacement's place where those cannot be had. What `textures` holds
 *   is read whenever the material's bindings are made.
 * - **Its vertex data is none**: a vertex is its place in the lattice.
 * - **The plunging lip's strip wears the same plugin with another vertex
 *   stage** (`lip`; `waterPlugin.ts` made with `lip` on Babylon.js): its
 *   vertices are placed from the crests the breaker's tracker found and the
 *   baked cross-section, two more tables its vertex stage reads at a whole
 *   texel, in place of the rings' depths, which it has none of. Everything
 *   else, the sea's numbers, its pictures and its shading, is the sea's.
 */
import type { MaterialPlugin, PluginUniformBlock, Texture2D, Texture2DArray } from "@babylonjs/lite";
import { SEA_COMPONENT_VECS, type SeaUniforms } from "../seaUniforms.js";
import { frameReads } from "./frameBlock.js";
import { WATER_PRIORITY } from "./lakePlugin.js";
import { uniformFields, writeUniforms, type UniformField } from "./pluginUniforms.js";
import {
  SEA_ALBEDO_WGSL, SEA_BUMP_WGSL, SEA_COMPOSE_WGSL, SEA_LIP_SHAPE_WGSL, SEA_LIP_VERTEX_WGSL, SEA_RAIN_WGSL, SEA_VERTEX_WGSL, seaLightsWgsl, seaRestVertexWgsl,
  seaShadeWgsl, seaSurfaceWgsl,
  type SeaLook,
} from "./seaWgsl.js";
import { WATER_DEFS_WGSL, WATER_SPLIT_WGSL } from "./waterWgsl.js";

/** The pictures and tables the sea's material reads. */
export type SeaTextures = {
  /** The swell's tables (`oceanTables.ts`): four 32-bit floats a texel. */
  atlas: Texture2D;
  /** The swash's table (`swashTable.ts`): one row, four 32-bit floats a texel. */
  swash: Texture2D;
  /** The depth of water under each ring's vertices: a layer a ring, one 32-bit float a texel. */
  ringBeds: Texture2DArray;
  /** The bed's heights, one 32-bit float a texel (`bedFollow.ts`). */
  bed: Texture2D;
  /** The ripple bump, where the look reads it. */
  bump: Texture2D | null;
  /** The wind sea's displacement where the look reads a field: the loop's frames, a layer a frame, or the cascades', a layer a cascade. */
  windDisp: Texture2DArray | null;
  /** The cascades' slopes, a layer a cascade, where the look reads the cascades. */
  windSlope: Texture2DArray | null;
};

/** The tables the plunging lip's strip is placed from, four 32-bit floats a texel each. */
export type LipTables = {
  /** The crests (`LipTracker`'s state as the strip reads it, `closeFreeSlots`): a row a slot, a texel a column. */
  state: Texture2D;
  /** The baked cross-section (`lipProfile`): a row a keyframe, a texel a vertex. */
  profile: Texture2D;
};

const BOTH = "vertex-fragment" as const;

/** The sea's own uniforms as fields: every one read by both stages, the swell's components as bits. */
export function seaFields(uniforms: SeaUniforms): UniformField[] {
  const { oceanK: _components, ...scalars } = uniforms;
  void _components;
  return [...uniformFields(scalars, BOTH), { name: "oceanK", type: `array<vec4<u32>,${SEA_COMPONENT_VECS}>`, visibility: BOTH }];
}

/**
 * The plugin, drawing the sea by `uniforms` (`seaUniforms`: one record,
 * filled in place and read whenever the material's uniforms are written)
 * and by the frame's block `shared`, from `textures`, with `look`. With
 * `lip` it is the plunging lip's strip's: the same sea, its vertices placed
 * from the strip's two tables.
 */
export function seaPlugin(uniforms: SeaUniforms, textures: SeaTextures, shared: PluginUniformBlock, look: SeaLook, lip: LipTables | null = null): MaterialPlugin {
  const fft = look.fft === true;
  if (look.bump !== (textures.bump !== null) || look.loop !== (textures.windDisp !== null) || fft !== (textures.windSlope !== null) || (fft && !look.loop)) {
    throw new Error("the sea's look and its pictures disagree");
  }
  const surface = frameReads(seaSurfaceWgsl(look));
  const fields = seaFields(uniforms);
  return {
    name: lip === null ? "SeaWater" : "SeaLip",
    priority: WATER_PRIORITY,
    // A tier below the cascades' keeps the two it had.
    defines: { loop: look.loop, bump: look.bump, ...(fft ? { fft } : {}), ...(lip !== null ? { lip: true } : {}) },
    getFragmentDirectives: () => "diagnostic(off,derivative_uniformity);",
    getCustomCode: (stage) =>
      stage === "fragment"
        ? {
          CUSTOM_FRAGMENT_DEFINITIONS: frameReads(WATER_DEFS_WGSL + SEA_RAIN_WGSL) + surface + frameReads(seaShadeWgsl(look)),
          CUSTOM_FRAGMENT_BEFORE_LIGHTS: frameReads((look.bump ? SEA_BUMP_WGSL : SEA_ALBEDO_WGSL) + seaLightsWgsl(look) + WATER_SPLIT_WGSL),
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: SEA_COMPOSE_WGSL,
        }
        : lip === null
          ? { CUSTOM_VERTEX_DEFINITIONS: surface, CUSTOM_VERTEX_MAIN_END: frameReads(SEA_VERTEX_WGSL) }
          : { CUSTOM_VERTEX_DEFINITIONS: surface + frameReads(SEA_LIP_SHAPE_WGSL), CUSTOM_VERTEX_MAIN_END: frameReads(SEA_LIP_VERTEX_WGSL) },
    getVaryings: () => [
      { name: "vBedDepth", type: "f32" }, { name: "vWaterViewDepth", type: "f32" }, { name: "vOceanXZ", type: "vec2<f32>" },
      { name: "vOceanSwellA", type: "vec4<f32>" }, { name: "vOceanSwellB", type: "vec4<f32>" },
    ],
    getUniforms: () => ({ ubo: fields }),
    getUniformBlocks: () => [shared],
    getSamplers: () => [
      { texture: "oceanAtlas", sampleType: "unfilterable-float" as const, visibility: BOTH },
      { texture: "oceanSwash", sampleType: "unfilterable-float" as const, visibility: BOTH },
      ...(lip === null
        ? [{ texture: "seaBed", textureType: "texture_2d_array<f32>" as const, sampleType: "unfilterable-float" as const, visibility: "vertex" as const }]
        : [
          { texture: "oceanLipState", sampleType: "unfilterable-float" as const, visibility: "vertex" as const },
          { texture: "oceanLipProfile", sampleType: "unfilterable-float" as const, visibility: "vertex" as const },
        ]),
      { texture: "waterBedHeight", sampleType: "unfilterable-float" as const },
      ...(look.bump ? [{ texture: "waterBump", sampler: "waterBumpSampler" }] : []),
      ...(look.loop ? [{ texture: "oceanWindDisp", sampler: "oceanWindDispSampler", textureType: "texture_2d_array<f32>" as const, visibility: BOTH }] : []),
      ...(fft ? [{ texture: "oceanWindSlope", textureType: "texture_2d_array<f32>" as const }] : []),
    ],
    writeUbo(data, offsets) {
      const { oceanK, ...scalars } = uniforms;
      writeUniforms(data, offsets, scalars);
      const at = offsets.get("oceanK");
      if (at === undefined) throw new Error("no uniform oceanK in the material's buffer");
      data.set(oceanK, at / 4);
    },
    bindTextures(out) {
      out.push({ texture: textures.atlas, sampler: false }, { texture: textures.swash, sampler: false });
      if (lip === null) out.push({ texture: textures.ringBeds, sampler: false });
      else out.push({ texture: lip.state, sampler: false }, { texture: lip.profile, sampler: false });
      out.push({ texture: textures.bed, sampler: false });
      if (textures.bump !== null) out.push({ texture: textures.bump });
      if (textures.windDisp !== null) out.push({ texture: textures.windDisp });
      if (textures.windSlope !== null) out.push({ texture: textures.windSlope, sampler: false });
    },
    getActiveTextures(out) {
      out.push(textures.atlas, textures.swash);
      if (lip === null) out.push(textures.ringBeds);
      else out.push(lip.state, lip.profile);
      out.push(textures.bed);
      if (textures.bump !== null) out.push(textures.bump);
      if (textures.windDisp !== null) out.push(textures.windDisp);
      if (textures.windSlope !== null) out.push(textures.windSlope);
    },
  };
}

/**
 * The sea in the rain's cover map: the plugin that places the lattice's
 * vertices for the map's own material, at rest at `waterLevel`, from the
 * rings' records in the frame's block `shared`.
 */
export function seaRestPlugin(shared: PluginUniformBlock, waterLevel: number): MaterialPlugin {
  return {
    name: "SeaAtRest",
    priority: WATER_PRIORITY,
    defines: { level: waterLevel },
    getCustomCode: (stage) => (stage === "vertex" ? { CUSTOM_VERTEX_MAIN_END: frameReads(seaRestVertexWgsl(waterLevel)) } : null),
    getUniformBlocks: () => [shared],
  };
}
