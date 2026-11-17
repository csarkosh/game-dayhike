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
 *   whole texel, the bed's heights and the skyline's elevations. On the
 *   tier with a shore panorama (`lakePanorama.ts`) it is a fourth, read
 *   round the turn through a sampler of its own, and the material carries
 *   the read of it; on the others it carries neither.
 * - **On the tier that reads through its water** it carries two more, the
 *   frame kept behind it and that frame's depth (`waterBehind.ts`), and the
 *   read of them in the place of the alpha; its material is then opaque and
 *   its mesh drawn after the scene's pass is broken (`lakeMeshes.ts`). They
 *   are the pass's, not the material's: handed on as they stand whenever the
 *   bindings are made, and never counted among the material's own.
 * - **Its vertex data** is one float a vertex: the depth of the bed under
 *   it, which stands in outside the bed's square.
 */
import type { MaterialPlugin, PluginUniformBlock, Texture2D } from "@babylonjs/lite";
import type { LakeUniforms } from "../waterSurface.js";
import { frameReads } from "./frameBlock.js";
import { uniformFields, writeUniforms } from "./pluginUniforms.js";
import type { WaterBehind } from "./waterBehind.js";
import {
  LAKE_LENS_WGSL, LAKE_PANORAMA_WGSL, LAKE_RIPPLES_WGSL, LAKE_SHORE_WGSL, WATER_BUMP_WGSL, WATER_DEFS_WGSL, WATER_SPLIT_WGSL, WATER_THROUGH_DEFS_WGSL,
  WATER_THROUGH_FINAL_WGSL, WATER_VERTEX_WGSL, lakeComposeWgsl, lakeLightsWgsl,
} from "./waterWgsl.js";

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
  /** The shore's panorama, on the tier that draws one: half floats, repeating round the turn. */
  panorama?: Texture2D;
  /** The frame behind the surface, on the tier that reads through it. */
  behind?: WaterBehind;
};

/**
 * The plugin, drawing a lake by `uniforms` (`lakeUniforms`: one record,
 * filled in place and read whenever the material's uniforms are written)
 * and by the frame's block `shared`, from `textures`.
 */
export function lakePlugin(uniforms: LakeUniforms, textures: LakeTextures, shared: PluginUniformBlock): MaterialPlugin {
  const { panorama, behind } = textures;
  const through = behind !== undefined;
  return {
    name: "LakeWater",
    priority: WATER_PRIORITY,
    getFragmentDirectives: () => "diagnostic(off,derivative_uniformity);",
    getCustomCode: (stage) =>
      stage === "fragment"
        ? {
          CUSTOM_FRAGMENT_DEFINITIONS: frameReads(
            WATER_DEFS_WGSL + LAKE_RIPPLES_WGSL + LAKE_SHORE_WGSL + (panorama === undefined ? "" : LAKE_PANORAMA_WGSL) + (through ? WATER_THROUGH_DEFS_WGSL + LAKE_LENS_WGSL : ""),
          ),
          CUSTOM_FRAGMENT_BEFORE_LIGHTS: frameReads(WATER_BUMP_WGSL + lakeLightsWgsl(through) + WATER_SPLIT_WGSL),
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: frameReads(lakeComposeWgsl(panorama !== undefined)),
          // After the air's fog, which is laid at the point before: nothing follows it on a tier with a post chain.
          ...(through ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: WATER_THROUGH_FINAL_WGSL } : {}),
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
      ...(panorama === undefined ? [] : [{ texture: "waterPanorama", sampler: "waterPanoramaSampler" }]),
      ...(through ? [{ texture: "waterKept", sampler: "waterKeptSampler" }, { texture: "waterKeptDepth", sampleType: "unfilterable-float" as const }] : []),
    ],
    writeUbo(data, offsets) {
      writeUniforms(data, offsets, uniforms);
    },
    bindTextures(out) {
      out.push({ texture: textures.bump }, { texture: textures.bed, sampler: false }, { texture: textures.skyline, sampler: false });
      if (panorama !== undefined) out.push({ texture: panorama });
      if (behind !== undefined) out.push({ texture: behind.colour() }, { texture: behind.depth(), sampler: false });
    },
    getActiveTextures(out) {
      out.push(textures.bump, textures.bed, textures.skyline);
      if (panorama !== undefined) out.push(panorama);
    },
  };
}
