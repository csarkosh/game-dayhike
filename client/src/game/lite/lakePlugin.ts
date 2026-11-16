/**
 * A lake's water as a material plugin on Babylon Lite: Lite's PBR with what
 * a lake's surface is about spliced in (`waterWgsl.ts` has the WGSL, the
 * game's GLSL statement for statement; `waterPlugin.ts` is the same plugin
 * on Babylon.js): the depth of the bed under each pixel, the waterline, the
 * ripples and the rain's rings on its normal, the one alpha it is blended
 * by, the skin on a murky lake, and the shore's shade under the skyline in
 * place of the sky's reflection where the water is glass.
 *
 * - **Its numbers** are two records by name (`waterSurface.ts`): the lake's
 *   own (`LakeUniforms`), in the material's buffer, written when one moves;
 *   and what every lake reads alike and moves with the frame, which is the
 *   frame's block (`frameBlock.ts`).
 * - **Its pictures** are three: the ripple bump, repeating and filtered
 *   through its smaller levels; and two tables of 32-bit floats read at a
 *   whole texel, the bed's heights and the skyline's elevations.
 * - **Its vertex data** is one float a vertex: the depth of the bed under
 *   it, which stands in outside the bed's square.
 */
import type { MaterialPlugin, PluginUniformBlock, Texture2D } from "@babylonjs/lite";
import type { LakeUniforms } from "../waterSurface.js";
import { frameReads } from "./frameBlock.js";
import { uniformFields, writeUniforms } from "./pluginUniforms.js";
import { LAKE_COMPOSE_WGSL, LAKE_LIGHTS_WGSL, LAKE_RIPPLES_WGSL, LAKE_SHORE_WGSL, WATER_BUMP_WGSL, WATER_DEFS_WGSL, WATER_SPLIT_WGSL, WATER_VERTEX_WGSL } from "./waterWgsl.js";

/** The plugin's place among a material's: before the air's, which is laid over what it shades. */
export const WATER_PRIORITY = 230;

/** The pictures a lake's material reads. */
export type LakeTextures = {
  /** The ripple bump (`waterBumpData`): repeating, with its smaller levels. */
  bump: Texture2D;
  /** The bed's heights, one 32-bit float a texel (`bedFollow.ts`). */
  bed: Texture2D;
  /** The skyline's elevations, one 32-bit float a texel in one row (`skylineTexels`). */
  skyline: Texture2D;
};

/**
 * The plugin, drawing a lake by `uniforms` (`lakeUniforms`: one record,
 * filled in place and read whenever the material's uniforms are written)
 * and by the frame's block `shared`, from `textures`.
 */
export function lakePlugin(uniforms: LakeUniforms, textures: LakeTextures, shared: PluginUniformBlock): MaterialPlugin {
  return {
    name: "LakeWater",
    priority: WATER_PRIORITY,
    getFragmentDirectives: () => "diagnostic(off,derivative_uniformity);",
    getCustomCode: (stage) =>
      stage === "fragment"
        ? {
          CUSTOM_FRAGMENT_DEFINITIONS: frameReads(WATER_DEFS_WGSL + LAKE_RIPPLES_WGSL + LAKE_SHORE_WGSL),
          CUSTOM_FRAGMENT_BEFORE_LIGHTS: frameReads(WATER_BUMP_WGSL + LAKE_LIGHTS_WGSL + WATER_SPLIT_WGSL),
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: frameReads(LAKE_COMPOSE_WGSL),
        }
        : { CUSTOM_VERTEX_MAIN_END: WATER_VERTEX_WGSL },
    getVertexAttributes: () => [{ name: "bedDepth", type: "f32", format: "float32", stride: 4, offset: 0 }],
    getVaryings: () => [{ name: "vBedDepth", type: "f32" }, { name: "vWaterViewDepth", type: "f32" }],
    getUniforms: () => ({ ubo: uniformFields(uniforms) }),
    getUniformBlocks: () => [shared],
    getSamplers: () => [
      { texture: "waterBump", sampler: "waterBumpSampler" },
      { texture: "waterBedHeight", sampleType: "unfilterable-float" as const },
      { texture: "waterSkyline", sampleType: "unfilterable-float" as const },
    ],
    writeUbo(data, offsets) {
      writeUniforms(data, offsets, uniforms);
    },
    bindTextures(out) {
      out.push({ texture: textures.bump }, { texture: textures.bed, sampler: false }, { texture: textures.skyline, sampler: false });
    },
    getActiveTextures(out) {
      out.push(textures.bump, textures.bed, textures.skyline);
    },
  };
}
