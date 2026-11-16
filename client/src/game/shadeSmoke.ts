/**
 * The shades' smoke (docs/gameplay/2026-10-06-the-mist-shades.md, amended
 * 2026-10-20): a plugin on each figure's flat material in the shade mask
 * (shadeSilhouette.ts), so a shade, a lunge or a Hollow is drawn into the
 * mask through smoke of its own. It comes in and goes out through a rising
 * noise, patch by patch, its lower body first and its feet always lost in the
 * mist, never growing or shrinking; and while it stands, its outline swells
 * and draws in along its normals and frays where its surface turns from the
 * eye, so the figure is never still. The noise is in the world's metres, so it
 * stays on the figure as the eye turns. Renderer-only; the GLSL lives in
 * shaders/shadeSmoke*.fx so shaderHygiene.test.ts covers it.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import noise from "./shaders/shadeSmokeNoise.fx?raw";
import vertexWorldPos from "./shaders/shadeSmokeWorldPos.vertex.fx?raw";
import fragmentColour from "./shaders/shadeSmokeColour.fragment.fx?raw";
import { shadeSmokeUniforms } from "./shadeMaskParams.js";

// The smoke's numbers are made with no engine (`shadeMaskParams.ts`).
export { SHADE_SMOKE_FEET, SHADE_SMOKE_FOLD_S, SHADE_SMOKE_FRAY, SHADE_SMOKE_RISE, SHADE_SMOKE_SCALE, SHADE_SMOKE_SOFT, SHADE_SMOKE_SWELL_M } from "./shadeMaskParams.js";

export class ShadeSmokePlugin extends MaterialPluginBase {
  /** How far in the figure is: 0 nothing, 1 whole. */
  presence = 1;
  /** The smoke's clock, seconds, folded at SHADE_SMOKE_FOLD_S. */
  time = 0;
  /** The figure's feet and its height, metres, for its feet in the mist and its lower body first. */
  feetY = 0;
  height = 1;

  constructor(material: Material) {
    super(material, "ShadeSmoke", 240, { SHADESMOKE: false });
    this._enable(true);
  }

  override getClassName(): string {
    return "ShadeSmokePlugin";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.SHADESMOKE = true;
  }

  // The mask's material is unlit, so Babylon would leave the normals out: the swell and the fraying need them.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefinesBeforeAttributes(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines._needNormals = true;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string; fragment: string } {
    const declared = `
#ifdef SHADESMOKE
uniform vec4 shadeSmoke;
uniform vec2 shadeSmokeEdge;
#endif
`;
    return {
      ubo: [
        { name: "shadeSmoke", size: 4, type: "vec4" },
        { name: "shadeSmokeEdge", size: 2, type: "vec2" },
      ],
      vertex: declared,
      fragment: declared,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    const u = shadeSmokeUniforms(this.presence, this.time, this.feetY, this.height);
    uniformBuffer.updateFloat4("shadeSmoke", u.shadeSmoke[0], u.shadeSmoke[1], u.shadeSmoke[2], u.shadeSmoke[3]);
    uniformBuffer.updateFloat2("shadeSmokeEdge", u.shadeSmokeEdge[0], u.shadeSmokeEdge[1]);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") return { CUSTOM_VERTEX_DEFINITIONS: noise, CUSTOM_VERTEX_UPDATE_WORLDPOS: vertexWorldPos };
    if (shaderType === "fragment") return { CUSTOM_FRAGMENT_DEFINITIONS: noise, CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: fragmentColour };
    return null;
  }
}

/** The plugin on `material`, made once. */
export function attachShadeSmoke(material: Material): ShadeSmokePlugin {
  const had = material.pluginManager?.getPlugin("ShadeSmoke") as ShadeSmokePlugin | null | undefined;
  return had ?? new ShadeSmokePlugin(material);
}
