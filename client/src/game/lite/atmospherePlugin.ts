/**
 * The atmosphere as a material plugin on Babylon Lite: the air between the
 * eye and a surface, drawn by the surface's own material (`atmosphereParams.ts`
 * has the arithmetic and says what the air is; `cloudParams.ts` the ground
 * cloud). Where it goes in:
 *
 * - The fog is applied to the lit colour at the point before the final
 *   colour is composed, ahead of the display curve. Lite's scene fog stays
 *   off.
 * - The distance fog's density is a uniform of the plugin's
 *   (`atmBaseDensity`).
 * - With `atmOn` under a half the lit colour passes as it is, with no air at
 *   all. `atmOn` is 0 only while there is no record to draw the air by
 *   (`atmosphereUniforms`): before the sky's first slices are held
 *   (`lite/worldLight.ts`), or before the renderer's first frame is
 *   written. The hike's loop starts only once the sky is held
 *   (`Renderer.skyReady`), so no frame a player sees is drawn that way.
 *   The record's numbers are all 0 then, and the haze, whose constants are
 *   not, would darken the colour were it not for the early return.
 * - The uniforms are read as `material.<name>`, under the names
 *   `atmosphereUniforms` gives them; or, given the frame's block
 *   (`frameBlock.ts`), from the block, for the air is the same for every
 *   material and moves with the frame.
 * - The ground cloud is marched here only where the plugin is asked to
 *   (`cloud`): where a post chain marches it once a pixel, as the game's
 *   does (`postChain.ts`), a material draws none, and carries neither the
 *   march nor the cloud's map.
 */
import type { MaterialPlugin, PluginUniformBlock, Texture2D } from "@babylonjs/lite";
import type { AtmosphereUniforms } from "../atmosphereParams.js";
import { DISPLAY_ENCODE_WGSL, GRADE_BLOCK, MATERIAL_GRADE_WGSL } from "./displayCurve.js";
import { frameReads } from "./frameBlock.js";
import { uniformFields, writeUniforms } from "./pluginUniforms.js";
import cloudFogSource from "../shaders/atmosphere/cloudFog.wgsl?raw";
import fogSource from "../shaders/atmosphere/fog.wgsl?raw";
import cloudSource from "../shaders/atmosphere/cloud.wgsl?raw";
import foggedColourSource from "../shaders/atmosphere/foggedColour.wgsl?raw";
import gradeSource from "../shaders/atmosphere/grade.wgsl?raw";
import { fill, wgsl } from "../shaders/shaderText.js";

const atmWgsl = (cloud: boolean): string => fill(wgsl(fogSource), { cloudDefs: cloud ? ATM_CLOUD_WGSL : "", cloudFog: cloud ? wgsl(cloudFogSource) : "return fogged;" });

/** The ground cloud's march, as the far softening's pass has it too (`postWgsl.ts`). */
const ATM_CLOUD_WGSL = wgsl(cloudSource);

/** The plugin's place among a material's: after every plugin that shades the surface. */
export const ATMOSPHERE_PRIORITY = 900;

/**
 * The plugin, drawing the air by `uniforms`: one record, filled in place
 * every frame (`atmosphereUniforms`) and read whenever the material's
 * uniforms are written. `cloudMap` is the ground cloud's map
 * (`cloudNoiseMap`), repeating, read bilinearly. Given `shared`, the frame's
 * block, the air is read from it and the material carries none of it: the
 * renderer writes the block once a frame from the same record. `cloud`
 * false leaves the ground cloud to a post chain: the material marches none
 * and binds no map. `grade`: the tier has no post chain, and the material
 * grades its own colour as Babylon.js's image processing does there
 * (`displayCurve.ts`): the vignette on the fogged colour ahead of the tone
 * map, the colour curves and the dither after Lite's display curve.
 * `curve`: Lite's materials do not end with that curve (the page has
 * drawn a tier with a chain, and Lite's linear output is the whole page's
 * from then), so the plugin encodes the colour for the display itself,
 * ahead of the curves.
 */
export function atmospherePlugin(
  uniforms: AtmosphereUniforms, cloudMap: Texture2D, shared?: PluginUniformBlock, cloud = true, grade = false, curve = false,
): MaterialPlugin {
  if (grade && shared === undefined) throw new Error("the material path's grade is read from the frame's block");
  if (curve && !grade) throw new Error("the display curve is laid on by the material path's grade");
  const definitions = `${shared === undefined ? atmWgsl(cloud) : frameReads(atmWgsl(cloud))}${grade ? MATERIAL_GRADE_WGSL : ""}${curve ? DISPLAY_ENCODE_WGSL : ""}`;
  return {
    name: "Atmosphere",
    priority: ATMOSPHERE_PRIORITY,
    getCustomCode: (stage) =>
      stage === "fragment"
        ? {
          CUSTOM_FRAGMENT_DEFINITIONS: definitions,
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: fill(wgsl(foggedColourSource), { vignette: grade ? "color=gradeVignette(color,input.clipPos.xy);" : "" }),
          // After Lite's own display curve, last in the fragment.
          ...(grade ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: fill(wgsl(gradeSource), { encode: curve ? `color=displayEncoded(color,${GRADE_BLOCK}.frameContrast);` : "" }) } : {}),
        }
        : null,
    ...(shared === undefined
      ? {
        getUniforms: () => ({ ubo: uniformFields(uniforms) }),
        writeUbo(data: Float32Array, offsets: ReadonlyMap<string, number>) {
          writeUniforms(data, offsets, uniforms);
        },
      }
      : { getUniformBlocks: () => [shared] }),
    ...(cloud
      ? {
        getSamplers: () => [{ texture: "atmCloudMap", sampler: "atmCloudMapSampler" }],
        bindTextures(out: { texture: Texture2D }[]) {
          out.push({ texture: cloudMap });
        },
        getActiveTextures(out: Texture2D[]) {
          out.push(cloudMap);
        },
      }
      : {}),
    // A material that marches no cloud is another program: the two are told apart.
    defines: { cloud, grade, curve },
  };
}
