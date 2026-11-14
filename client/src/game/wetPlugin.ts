// client/src/game/wetPlugin.ts
/**
 * The wet plugin: what water and weather do to a surface.
 *
 * The wet line: below one wet line, a surface is darker (× WET_ALBEDO) and
 * glossy (WET_ROUGHNESS), and on the medium and low tiers darkened per
 * channel by the water above it (spec §6). On the terrain material, the
 * props' and the player's. One wet line at a time — the nearest body's —
 * pushed to every attached plugin by `setWetLine`. Renderer-only; the GLSL
 * lives in shaders/wet*.fx so shaderHygiene.test.ts covers it.
 *
 * The roughness is rewritten by a regex key on Babylon's own
 * `float roughness=reflectivityOut.roughness;` line rather than on the
 * reflectivity call, because the terrain plugin already rewrites that call
 * (terrainTexture.ts) and a second rewrite of it would not match.
 *
 * The swash: inside the pebble cove the wet line is each shore column's,
 * from the swash's table (`swashTable.ts`): below the line a column's sheet
 * last climbed to, the ground is soaked as under the still line for
 * WET_SOAKED_S, then damp (× WET_DAMP_ALBEDO, rough at most
 * WET_DAMP_ROUGHNESS) by a third of WET_DRY_S, and dry by WET_DRY_S, with a
 * speckle of foam above the still sea for WET_SPECKLE_S. The still line
 * stands under it, and the bays keep it alone, blended over the cove's ends.
 * The table reaches every plugin as a uniform array, (reach, age) two
 * columns a vec4, packed once a frame by `setWetSwash`: the terrain's
 * fragment stage binds every texture it may, so no sampler is added.
 *
 * The weather: every material with a porosity cap above 0 darkens and
 * glosses with the weather's wetness by Lagarde's porosity rule, the
 * porosity read from the material's own final roughness and held to the
 * cap (`WET_CAP`: 1 for bark, deadwood, duff and the props, 0.5 for rock
 * and the cliffs, 0.3 for leaves and grass cards, which glaze more than
 * they darken). The wetness is one value for the page, written once a
 * frame by `setWetWeather` and read by every plugin at bind, as the
 * foliage plugin's wind is. The rule runs at
 * CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS, inside the reflectivity
 * block: CUSTOM_FRAGMENT_BEFORE_LIGHTS comes BEFORE that block in Babylon's
 * PBR fragment, when no roughness has been read yet, and after the block
 * `surfaceAlbedo` is overwritten from the block's result, so the one place
 * that has the final roughness and a writable albedo together is inside
 * it. The hook exists in the metallic workflow only, which every material
 * here uses (a GLB's, and one made with `metallic` and `roughness` set); a
 * specular-workflow material compiles with the rule left out. The cap
 * defaults to 0, so the terrain, the brushes and the player, which take the
 * wet line only, are unchanged, and the terrain keeps its own trail-paint
 * wetness.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import fragmentDefs from "./shaders/wet.fragment.fx?raw";
// In the lights chunk the footprint of a lake is its shore on the terrain
// (featurePaint.ts, featureWetInside), on every other material the body's disc.
// The note lives here, not in the chunk: a chunk's comments are part of the
// recorded text of every shader the plugin rides on.
import fragmentLights from "./shaders/wetLights.fragment.fx?raw";
import fragmentWeather from "./shaders/wetWeather.fragment.fx?raw";
import { clamp01 } from "./colour.js";
import { WET_NO_COVE, WET_SWASH_VECS, emptyWetUniforms, wetUniforms, type WetState } from "./wetSurface.js";

// The look's numbers, the page's wetness, cove and swash table, the wet line
// and the look's TypeScript twins are `wetSurface.ts`'s, which loads no
// Babylon; named from here too.
export * from "./wetSurface.js";

export const WET_ROUGHNESS_ANCHOR = "!float roughness=reflectivityOut\\.roughness;";
export const WET_ROUGHNESS_CODE =
  "float roughness=mix(mix(reflectivityOut.roughness, min(reflectivityOut.roughness, WET_DAMP_ROUGHNESS), wetDamp), WET_ROUGHNESS, wetW);";

const attached = new Set<WetPlugin>();

/** The uniforms of the bind under way (`wetUniforms`), filled again at each: one record for every plugin. */
const bound = emptyWetUniforms();

export class WetPlugin extends MaterialPluginBase {
  line = -1e6;
  level = -1e6;
  centre: [number, number] = [0, 0];
  radius = 0;
  kd: [number, number, number] = [0, 0, 0];
  attenuate = true;
  /** The porosity cap, in [0, 1]: 0 leaves the weather's wetness unread. */
  cap = 0;
  /** Whether a bind has written the swash's table yet: with no cove it is written once, then left. */
  private swashWritten = false;

  constructor(material: Material) {
    super(material, "Wet", 240, { WET: false });
    attached.add(this);
    this._enable(true);
  }

  override getClassName(): string {
    return "WetPlugin";
  }

  override dispose(forceDisposeTextures?: boolean): void {
    attached.delete(this);
    super.dispose(forceDisposeTextures);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.WET = true;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string; arraySize?: number }[]; fragment: string } {
    return {
      ubo: [
        { name: "wetLine", size: 1, type: "float" },
        { name: "wetLevel", size: 1, type: "float" },
        { name: "wetCentre", size: 2, type: "vec2" },
        { name: "wetRadius", size: 1, type: "float" },
        { name: "wetKd", size: 3, type: "vec3" },
        { name: "wetAttenuate", size: 1, type: "float" },
        { name: "wetWeather", size: 1, type: "float" },
        { name: "wetCap", size: 1, type: "float" },
        // The swash's cove and its table, two columns a vec4.
        { name: "wetCove", size: 4, type: "vec4" },
        { name: "wetSwash", size: 4, type: "vec4", arraySize: WET_SWASH_VECS },
      ],
      fragment: [
        "uniform float wetLine;", "uniform float wetLevel;", "uniform vec2 wetCentre;", "uniform float wetRadius;",
        "uniform vec3 wetKd;", "uniform float wetAttenuate;", "uniform float wetWeather;", "uniform float wetCap;",
        "uniform vec4 wetCove;", `uniform vec4 wetSwash[${WET_SWASH_VECS}];`,
      ].join("\n"),
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    const u = wetUniforms(this, bound);
    uniformBuffer.updateFloat("wetLine", u.wetLine[0]);
    uniformBuffer.updateFloat("wetLevel", u.wetLevel[0]);
    uniformBuffer.updateFloat2("wetCentre", u.wetCentre[0], u.wetCentre[1]);
    uniformBuffer.updateFloat("wetRadius", u.wetRadius[0]);
    uniformBuffer.updateFloat3("wetKd", u.wetKd[0], u.wetKd[1], u.wetKd[2]);
    uniformBuffer.updateFloat("wetAttenuate", u.wetAttenuate[0]);
    uniformBuffer.updateFloat("wetWeather", u.wetWeather[0]);
    uniformBuffer.updateFloat("wetCap", u.wetCap[0]);
    uniformBuffer.updateFloat4("wetCove", u.wetCove[0], u.wetCove[1], u.wetCove[2], u.wetCove[3]);
    // updateFloatArray, not updateArray: without uniform buffers the latter
    // sets the array as floats, the former as the vec4s it is. With no cove
    // the share is 0 at every z and the table is never read, so its 4 KB are
    // written once and then left.
    if (u.wetCove[1] !== WET_NO_COVE || !this.swashWritten) {
      uniformBuffer.updateFloatArray("wetSwash", u.wetSwash);
      this.swashWritten = true;
    }
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: fragmentLights,
      CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS: fragmentWeather,
      [WET_ROUGHNESS_ANCHOR]: WET_ROUGHNESS_CODE,
    };
  }
}

/**
 * Attaches once per material; a later call returns the plugin already there.
 * PBR only: the roughness anchor and `surfaceAlbedo` are PBR's, so any other
 * material (a loaded model's StandardMaterial, say) is left alone and gets null.
 * `cap` is the material's porosity cap for the weather's wetting (`WET_CAP`),
 * written whenever it is given, so a material two buckets share takes the
 * cap of whichever attached it last (they give the same one), and a call
 * without one leaves the cap as it was.
 */
export function attachWet(material: Material, cap?: number): WetPlugin | null {
  if (!(material instanceof PBRMaterial)) return null;
  const existing = material.pluginManager?.getPlugin("Wet");
  const plugin = existing instanceof WetPlugin ? existing : new WetPlugin(material);
  if (cap !== undefined) plugin.cap = clamp01(cap);
  return plugin;
}

/** The porosity cap a material carries: 0 without the plugin. */
export function wetCapOf(material: Material): number {
  const plugin = material.pluginManager?.getPlugin("Wet");
  return plugin instanceof WetPlugin ? plugin.cap : 0;
}

/** Per frame: one wet line for every attached plugin. `attenuate` is false on the high tier. */
export function setWetLine(w: WetState, attenuate: boolean): void {
  for (const p of attached) {
    p.line = w.line;
    p.level = w.level;
    p.kd = w.kd;
    p.centre = w.centre;
    p.radius = w.radius;
    p.attenuate = attenuate;
  }
}
