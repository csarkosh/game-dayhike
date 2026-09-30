// client/src/game/wetPlugin.ts
/**
 * The wet plugin: below one wet line, a surface is darker (× WET_ALBEDO) and
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
import type { WaterBody } from "./waterShading.js";

export const WET_ALBEDO = 0.4;
export const WET_ROUGHNESS = 0.15;
export const WET_BAND = 0.1;
/** The still swash band above a body's level (spec §6.1). */
export const WET_LINE_ABOVE = 0.3;

/** Radius cap for the sea: 1e6 + 1 and 1e6 + 3 are distinct in fp32, 1e9 + 1 is not (smoothstep needs distinct edges). */
export const WET_RADIUS_MAX = 1e6;

export const WET_ROUGHNESS_ANCHOR = "!float roughness=reflectivityOut\\.roughness;";
const WET_ROUGHNESS_CODE = "float roughness=mix(reflectivityOut.roughness, WET_ROUGHNESS, wetW);";

export type WetBody = WaterBody & { x: number; z: number; radius: number };

const attached = new Set<WetPlugin>();

export class WetPlugin extends MaterialPluginBase {
  line = -1e6;
  level = -1e6;
  centre: [number, number] = [0, 0];
  radius = 0;
  kd: [number, number, number] = [0, 0, 0];
  attenuate = true;

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

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "wetLine", size: 1, type: "float" },
        { name: "wetLevel", size: 1, type: "float" },
        { name: "wetCentre", size: 2, type: "vec2" },
        { name: "wetRadius", size: 1, type: "float" },
        { name: "wetKd", size: 3, type: "vec3" },
        { name: "wetAttenuate", size: 1, type: "float" },
      ],
      fragment: ["uniform float wetLine;", "uniform float wetLevel;", "uniform vec2 wetCentre;", "uniform float wetRadius;", "uniform vec3 wetKd;", "uniform float wetAttenuate;"].join("\n"),
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat("wetLine", this.line);
    uniformBuffer.updateFloat("wetLevel", this.level);
    uniformBuffer.updateFloat2("wetCentre", this.centre[0], this.centre[1]);
    uniformBuffer.updateFloat("wetRadius", Math.min(this.radius, WET_RADIUS_MAX));
    uniformBuffer.updateFloat3("wetKd", this.kd[0], this.kd[1], this.kd[2]);
    uniformBuffer.updateFloat("wetAttenuate", this.attenuate ? 1 : 0);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: fragmentLights,
      [WET_ROUGHNESS_ANCHOR]: WET_ROUGHNESS_CODE,
    };
  }
}

/**
 * Attaches once per material; a later call returns the plugin already there.
 * PBR only: the roughness anchor and `surfaceAlbedo` are PBR's, so any other
 * material (a loaded model's StandardMaterial, say) is left alone and gets null.
 */
export function attachWet(material: Material): WetPlugin | null {
  if (!(material instanceof PBRMaterial)) return null;
  const existing = material.pluginManager?.getPlugin("Wet");
  if (existing instanceof WetPlugin) return existing;
  return new WetPlugin(material);
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
