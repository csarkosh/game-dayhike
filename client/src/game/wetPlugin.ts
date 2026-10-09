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
import fragmentLights from "./shaders/wetLights.fragment.fx?raw";
import fragmentWeather from "./shaders/wetWeather.fragment.fx?raw";
import { clamp01 } from "./colour.js";
import type { WaterBody } from "./waterShading.js";
import { SWASH_COLUMNS, SWASH_STRIDE } from "./swashTable.js";

export const WET_ALBEDO = 0.4;
export const WET_ROUGHNESS = 0.15;
export const WET_BAND = 0.1;
/** The still swash band above a body's level (spec §6.1). */
export const WET_LINE_ABOVE = 0.3;

/** Radius cap for the sea: 1e6 + 1 and 1e6 + 3 are distinct in fp32, 1e9 + 1 is not (smoothstep needs distinct edges). */
export const WET_RADIUS_MAX = 1e6;

/** The swash's damp ground: its albedo factor and the roughness it is held to at most. */
export const WET_DAMP_ALBEDO = 0.7;
export const WET_DAMP_ROUGHNESS = 0.5;
/** The swash's ground dries over this (s): soaked for WET_SOAKED_S after a
 * sheet, damp by a third of it, dry by all of it (SWASH_DRY_S). */
export const WET_DRY_S = 60;
export const WET_SOAKED_S = 0.5;
/** The foam speckle on the swash's band: its weight toward white, fading
 * over WET_SPECKLE_S after a sheet (SWASH_SPECKLE_S); the share of its
 * WET_SPECKLE_CELL cells it covers, faded to that share between
 * WET_SPECKLE_NEAR and WET_SPECKLE_FAR metres from the eye. */
export const WET_SPECKLE = 0.2;
export const WET_SPECKLE_S = 10;
export const WET_SPECKLE_CELL = 0.05;
export const WET_SPECKLE_COVER = 0.25;
export const WET_SPECKLE_NEAR = 10;
export const WET_SPECKLE_FAR = 25;
/** The cove's swash fades into the bays' still line over ± this about each
 * of its ends, as its ground does (COVE_END_BLEND). */
export const WET_COVE_END = 30;
/** The vec4s of `wetSwash`: two columns of the swash's table each. */
export const WET_SWASH_VECS = SWASH_COLUMNS / 2;
/** No cove: a half-width so far below zero that the cove's share is 0 at every z. */
export const WET_NO_COVE = -1e6;

export const WET_ROUGHNESS_ANCHOR = "!float roughness=reflectivityOut\\.roughness;";
export const WET_ROUGHNESS_CODE =
  "float roughness=mix(mix(reflectivityOut.roughness, min(reflectivityOut.roughness, WET_DAMP_ROUGHNESS), wetDamp), WET_ROUGHNESS, wetW);";

/** The porosity cap of each kind of material the weather wets. */
export const WET_CAP = {
  bark: 1,
  deadwood: 1,
  duff: 1,
  fungus: 1,
  prop: 1,
  rock: 0.5,
  cliff: 0.5,
  leaf: 0.3,
} as const;

// Module-level like the foliage plugin's wind: every plugin reads one
// wetness, written once per frame by the renderer.
let weatherWet = 0;

/** Per frame: the weather's wetness in [0, 1], for every attached plugin. */
export function setWetWeather(wetness: number): void {
  weatherWet = clamp01(wetness);
}

// Module-level as the weather's wetness is: one cove and one table for the
// page, bound by every plugin.
const wetCove: [number, number, number, number] = [0, WET_NO_COVE, 0, 0];
const wetSwash = new Float32Array(WET_SWASH_VECS * 4);
for (let i = 1; i < wetSwash.length; i += 2) wetSwash[i] = WET_DRY_S;

/** The cove the swash's table runs along, for every attached plugin: its
 * centre z, its half-width, the face's toe (signed coast distance, m) and the
 * face's grade. No cove when any is not finite. */
export function setWetCove(z0: number, halfWidth: number, toeD: number, faceGrade: number): void {
  const finite = Number.isFinite(z0) && Number.isFinite(halfWidth) && Number.isFinite(toeD) && Number.isFinite(faceGrade);
  wetCove[0] = finite ? z0 : 0;
  wetCove[1] = finite ? halfWidth : WET_NO_COVE;
  wetCove[2] = finite ? toeD : 0;
  wetCove[3] = finite ? faceGrade : 0;
}

/**
 * Per frame: the swash's table (`SwashTable.data`, (front, thickness, reach,
 * age) a column), packed for every attached plugin into the one array they
 * bind: (reach, age) of columns 2i and 2i + 1 in `wetSwash[i]`. A reach that
 * is not a finite number reads as none, an age as dry; nothing is made.
 */
export function setWetSwash(data: Float32Array): void {
  for (let c = 0; c < SWASH_COLUMNS; c++) {
    const reach = data[c * SWASH_STRIDE + 2];
    const age = data[c * SWASH_STRIDE + 3];
    wetSwash[c * 2] = reach !== undefined && Number.isFinite(reach) ? Math.max(0, reach) : 0;
    wetSwash[c * 2 + 1] = age !== undefined && Number.isFinite(age) ? Math.max(0, age) : WET_DRY_S;
  }
}

export type WetBody = WaterBody & { x: number; z: number; radius: number };

const attached = new Set<WetPlugin>();

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
    uniformBuffer.updateFloat("wetLine", this.line);
    uniformBuffer.updateFloat("wetLevel", this.level);
    uniformBuffer.updateFloat2("wetCentre", this.centre[0], this.centre[1]);
    uniformBuffer.updateFloat("wetRadius", Math.min(this.radius, WET_RADIUS_MAX));
    uniformBuffer.updateFloat3("wetKd", this.kd[0], this.kd[1], this.kd[2]);
    uniformBuffer.updateFloat("wetAttenuate", this.attenuate ? 1 : 0);
    uniformBuffer.updateFloat("wetWeather", weatherWet);
    uniformBuffer.updateFloat("wetCap", this.cap);
    uniformBuffer.updateFloat4("wetCove", wetCove[0], wetCove[1], wetCove[2], wetCove[3]);
    // updateFloatArray, not updateArray: without uniform buffers the latter
    // sets the array as floats, the former as the vec4s it is. With no cove
    // the share is 0 at every z and the table is never read, so its 4 KB are
    // written once and then left.
    if (wetCove[1] !== WET_NO_COVE || !this.swashWritten) {
      uniformBuffer.updateFloatArray("wetSwash", wetSwash);
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

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * The medium and low tiers' per-channel darkening by the water above a point,
 * as wetLights.fragment.fx computes it: exp(−2·(kd − mean kd)·depth), capped
 * at 1, where the depth below `level` is held to the body's footprint (1 inside,
 * 0 from 3 m past the rim, blended from 1 m, `wetInside` in wet.fragment.fx).
 * `radius` is capped at WET_RADIUS_MAX as the uniform is.
 */
export function wetResidual(
  kd: readonly [number, number, number],
  level: number,
  y: number,
  centre: readonly [number, number],
  radius: number,
  xz: readonly [number, number],
): [number, number, number] {
  const r = Math.min(radius, WET_RADIUS_MAX);
  const inside = 1 - smoothstep(r + 1, r + 3, Math.hypot(xz[0] - centre[0], xz[1] - centre[1]));
  const depth = Math.max(0, level - y) * inside;
  const mean = (kd[0] + kd[1] + kd[2]) / 3;
  const ch = (k: number): number => Math.min(1, Math.exp(-2 * (k - mean) * depth));
  return [ch(kd[0]), ch(kd[1]), ch(kd[2])];
}

/** GLSL's mix: x · (1 − a) + y · a. */
function mix(x: number, y: number, a: number): number {
  return x * (1 - a) + y * a;
}

/** 1 below the line, 0 above it, blended over WET_BAND: `wetBelow` in wet.fragment.fx. */
export function wetBelowLine(y: number, line: number): number {
  return 1 - smoothstep(line - WET_BAND * 0.5, line + WET_BAND * 0.5, y);
}

/** The wet look at a point, as wetLights.fragment.fx makes it: how wet (the
 * still line's weight, or the swash's soaked one where higher), how damp,
 * and the speckle's weight before its cells' mask. */
export type WetLook = { wet: number; damp: number; speckle: number };

/**
 * The wet look at height y and world z, as wetLights.fragment.fx makes it
 * from the still line `line`, the body's `level`, the footprint's `inside`
 * and the bound cove and table (`wetCove`, `wetSwash`, as `setWetCove` and
 * `setWetSwash` pack them): the TypeScript twin of `wetShore` and the lines
 * that take it. Refills `out`.
 */
export function wetLookAt(
  y: number, z: number, line: number, level: number, inside: number,
  cove: readonly [number, number, number, number], swash: Float32Array, out: WetLook,
): WetLook {
  const share = 1 - smoothstep(cove[1] - WET_COVE_END, cove[1] + WET_COVE_END, Math.abs(z - cove[0]));
  const c = Math.floor(Math.min(Math.max(z - cove[0] + SWASH_COLUMNS / 2, 0), SWASH_COLUMNS - 1) + 0.5);
  const reach = swash[c * 2] as number;
  const age = swash[c * 2 + 1] as number;
  const band = wetBelowLine(y, level + reach * cove[3]) * share;
  const soaked = 1 - smoothstep(WET_SOAKED_S, WET_DRY_S / 3, age);
  const damp = smoothstep(WET_SOAKED_S, WET_DRY_S / 3, age) - smoothstep(WET_DRY_S / 3, WET_DRY_S, age);
  const fresh = Math.min(1, Math.max(0, 1 - age / WET_SPECKLE_S));
  const above = 1 - wetBelowLine(y, level);
  const wet = Math.max(wetBelowLine(y, line) * inside, soaked * band * inside);
  out.wet = wet;
  out.damp = damp * band * inside * (1 - wet);
  out.speckle = WET_SPECKLE * fresh * above * band * inside;
  return out;
}

/** The albedo factor a look gives (before the speckle and the water above): `mix(1, WET_ALBEDO, wet) · mix(1, WET_DAMP_ALBEDO, damp)`. */
export function wetAlbedoFactor(look: WetLook): number {
  return mix(1, WET_ALBEDO, look.wet) * mix(1, WET_DAMP_ALBEDO, look.damp);
}

/** The roughness a look gives a surface of roughness r, as WET_ROUGHNESS_CODE writes it. */
export function wetRoughnessOf(r: number, look: WetLook): number {
  return mix(mix(r, Math.min(r, WET_DAMP_ROUGHNESS), look.damp), WET_ROUGHNESS, look.wet);
}

/** How far past its rim a pond still claims the wet line over the sea, metres. */
const POND_REACH = 40;

/**
 * The nearest body's wet line and kd for a point. The sea (infinite radius) is
 * everywhere at distance zero, so it is the fallback: a finite body wins only
 * within POND_REACH of its rim, the nearest such body.
 */
export type WetState = {
  line: number;
  level: number;
  kd: [number, number, number];
  centre: [number, number];
  radius: number;
};

export function wetLineFor(bodies: readonly WetBody[], x: number, z: number): WetState {
  let best: WetBody | null = null;
  let bestD = POND_REACH;
  let fallback: WetBody | null = null;
  for (const b of bodies) {
    if (!Number.isFinite(b.radius)) { fallback ??= b; continue; }
    const d = Math.max(0, Math.hypot(x - b.x, z - b.z) - b.radius);
    if (d <= bestD) { bestD = d; best = b; }
  }
  const pick = best ?? fallback;
  if (pick === null) return { line: -1e6, level: -1e6, kd: [0, 0, 0], centre: [0, 0], radius: 0 };
  return { line: pick.level + WET_LINE_ABOVE, level: pick.level, kd: pick.kd, centre: [pick.x, pick.z], radius: Math.min(pick.radius, WET_RADIUS_MAX) };
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
