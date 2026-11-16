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
 *   sea with it, and the wind sea's loop, on the tier that bakes one.
 * - **Its vertex data is none**: a vertex is its place in the lattice.
 */
import type { MaterialPlugin, PluginUniformBlock, Texture2D, Texture2DArray } from "@babylonjs/lite";
import { SEA_COMPONENT_VECS, type SeaUniforms } from "../seaUniforms.js";
import { frameReads } from "./frameBlock.js";
import { WATER_PRIORITY } from "./lakePlugin.js";
import { uniformFields, writeUniforms, type UniformField } from "./pluginUniforms.js";
import { SEA_ALBEDO_WGSL, SEA_BUMP_WGSL, SEA_COMPOSE_WGSL, SEA_RAIN_WGSL, SEA_VERTEX_WGSL, seaLightsWgsl, seaShadeWgsl, seaSurfaceWgsl, type SeaLook } from "./seaWgsl.js";
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
  /** The wind sea's loop, a layer a frame, where the look reads it. */
  loop: Texture2DArray | null;
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
 * and by the frame's block `shared`, from `textures`, with `look`.
 */
export function seaPlugin(uniforms: SeaUniforms, textures: SeaTextures, shared: PluginUniformBlock, look: SeaLook): MaterialPlugin {
  if (look.bump !== (textures.bump !== null) || look.loop !== (textures.loop !== null)) throw new Error("the sea's look and its pictures disagree");
  const surface = frameReads(seaSurfaceWgsl(look));
  const fields = seaFields(uniforms);
  return {
    name: "SeaWater",
    priority: WATER_PRIORITY,
    defines: { loop: look.loop, bump: look.bump },
    getFragmentDirectives: () => "diagnostic(off,derivative_uniformity);",
    getCustomCode: (stage) =>
      stage === "fragment"
        ? {
          CUSTOM_FRAGMENT_DEFINITIONS: frameReads(WATER_DEFS_WGSL + SEA_RAIN_WGSL) + surface + frameReads(seaShadeWgsl(look)),
          CUSTOM_FRAGMENT_BEFORE_LIGHTS: frameReads((look.bump ? SEA_BUMP_WGSL : SEA_ALBEDO_WGSL) + seaLightsWgsl(look) + WATER_SPLIT_WGSL),
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: SEA_COMPOSE_WGSL,
        }
        : { CUSTOM_VERTEX_DEFINITIONS: surface, CUSTOM_VERTEX_MAIN_END: frameReads(SEA_VERTEX_WGSL) },
    getVaryings: () => [
      { name: "vBedDepth", type: "f32" }, { name: "vWaterViewDepth", type: "f32" }, { name: "vOceanXZ", type: "vec2<f32>" },
      { name: "vOceanSwellA", type: "vec4<f32>" }, { name: "vOceanSwellB", type: "vec4<f32>" },
    ],
    getUniforms: () => ({ ubo: fields }),
    getUniformBlocks: () => [shared],
    getSamplers: () => [
      { texture: "oceanAtlas", sampleType: "unfilterable-float" as const, visibility: BOTH },
      { texture: "oceanSwash", sampleType: "unfilterable-float" as const, visibility: BOTH },
      { texture: "seaBed", textureType: "texture_2d_array<f32>" as const, sampleType: "unfilterable-float" as const, visibility: "vertex" as const },
      { texture: "waterBedHeight", sampleType: "unfilterable-float" as const },
      ...(look.bump ? [{ texture: "waterBump", sampler: "waterBumpSampler" }] : []),
      ...(look.loop ? [{ texture: "oceanWindDisp", sampler: "oceanWindDispSampler", textureType: "texture_2d_array<f32>" as const, visibility: BOTH }] : []),
    ],
    writeUbo(data, offsets) {
      const { oceanK, ...scalars } = uniforms;
      writeUniforms(data, offsets, scalars);
      const at = offsets.get("oceanK");
      if (at === undefined) throw new Error("no uniform oceanK in the material's buffer");
      data.set(oceanK, at / 4);
    },
    bindTextures(out) {
      out.push({ texture: textures.atlas, sampler: false }, { texture: textures.swash, sampler: false }, { texture: textures.ringBeds, sampler: false }, { texture: textures.bed, sampler: false });
      if (textures.bump !== null) out.push({ texture: textures.bump });
      if (textures.loop !== null) out.push({ texture: textures.loop });
    },
    getActiveTextures(out) {
      out.push(textures.atlas, textures.swash, textures.ringBeds, textures.bed);
      if (textures.bump !== null) out.push(textures.bump);
      if (textures.loop !== null) out.push(textures.loop);
    },
  };
}
