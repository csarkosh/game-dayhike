/**
 * The trunk shaded as one round (2026-10-27): a bark material reads the sun's
 * cast shadow at the trunk's axis, not at each of its own pixels.
 *
 * Read per pixel, the canopy's shadow fell across a trunk in hard-edged
 * patches: the map's texels, 5 cm in the forest, resolved on a surface that
 * curves away a few centimetres at a time, so a trunk was half lit and half
 * dark down a sharp line, and the patches crawled as the sun or the player
 * moved. A trunk is one thing at any height: either the canopy shades it
 * there or it does not. So the texel every pixel reads is the one over the
 * trunk's axis at the pixel's own height (`vPositionFromLight`'s `xy`, from
 * Babylon's `shadowsVertex`, written again at the end of the vertex stage
 * from the axis point, through the instance's `finalWorld`); the depth it
 * compares stays its own (`z`, and `vDepthMetric`), so the trunk's lit side
 * is as near the sun as the map's own record of it and never shadows itself,
 * and its dark side, deeper, is dark by its normal already. Around the
 * trunk the shadow is then uniform; along it, the canopy's shade crosses it
 * softly, the generator's percentage-closer filter's width. No cost: the
 * same shadow reads, at another texel, and no uniform of its own.
 *
 * Every light's cascade varyings are written, guarded by that light's
 * `SHADOWCSM` define, so the plugin reads no light index: in the game the sun
 * is light 1 (the headlamp is made first), in a bake it is light 0, and only
 * the sun casts. `lightMatrix{X}` is a plain uniform on both of Babylon's
 * paths (the uniform-buffer one and WebGL2's), which is why the depth, whose
 * `depthValues` is named differently on each, is left as it was.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Nullable } from "@babylonjs/core/types.js";

/** Babylon's default `maxSimultaneousLights`: the light indices the varyings are written for. */
const LIGHTS = 4;

/** The vertex code at `CUSTOM_VERTEX_MAIN_END`: each cascade's texel from the axis point, for each light that has cascades. */
export function barkShadeVertexCode(): string {
  const perLight = Array.from({ length: LIGHTS }, (_, x) =>
    `#if defined(SHADOWCSM${x})\n` +
    `for (int i = 0; i < SHADOWCSMNUM_CASCADES${x}; i++) { vPositionFromLight${x}[i].xy = (lightMatrix${x}[i] * barkAxis).xy; }\n` +
    "#endif\n",
  ).join("");
  return (
    "#if defined(BARK_SHADE) && defined(SHADOWS)\n" +
    "{\n" +
    "vec4 barkAxis = finalWorld * vec4(0.0, positionUpdated.y, 0.0, 1.0);\n" +
    perLight +
    "}\n" +
    "#endif\n"
  );
}

export class BarkShadePlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "BarkShade", 220, { BARK_SHADE: false }, true, true);
    this._enable(true);
  }

  override getClassName(): string {
    return "BarkShadePlugin";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.BARK_SHADE = true;
  }

  override getCustomCode(shaderType: string): Nullable<{ [pointName: string]: string }> {
    if (shaderType !== "vertex") return null;
    return { CUSTOM_VERTEX_MAIN_END: barkShadeVertexCode() };
  }
}

/** Attach once per material; later calls are no-ops (a species' buckets share a material). */
export function attachBarkShade(material: Material): void {
  if (material.pluginManager?.getPlugin("BarkShade")) return;
  new BarkShadePlugin(material);
}
