/**
 * Ground-layer wind sway: a vertex-stage material plugin
 * shared by the meadow, grass, flower, and bush clutter materials and the forest
 * understory. Renderer-only by design — no constant here may migrate into sim/ or
 * a tunables registry: sway is cosmetic, peers need not agree on phase, and wind
 * must not move the level id.
 *
 * Amplitude scales with (localY / meshHeight)² — bases anchored, tips move — and
 * phase comes from WORLD position so neighbouring instances ride a travelling
 * wave rather than moving in lockstep. That is why the injection point is
 * CUSTOM_VERTEX_UPDATE_WORLDPOS (after `worldPos = finalWorld * position`, so the
 * thin-instance matrix has been applied) and not CUSTOM_VERTEX_UPDATE_POSITION.
 * Verified directly against `node_modules/@babylonjs/core/Shaders/pbr.vertex.js`
 * (Babylon 9.18): `#define CUSTOM_VERTEX_UPDATE_POSITION` sits before
 * `#include<instancesVertex>` (the thin-instance matrix multiply), while
 * `vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);` runs first and
 * `#define CUSTOM_VERTEX_UPDATE_WORLDPOS` follows it, right before
 * `gl_Position=viewProjection*worldPos;` — so `worldPos` and `positionUpdated`
 * are both in scope at the WORLDPOS hook, which is what the GLSL below reads.
 *
 * Time is wrapped at WIND_TIME_WRAP seconds and every temporal frequency below is
 * an exact multiple of 2π / WIND_TIME_WRAP, so the wrap is phase-continuous (no
 * visible snap) and the float32 sin() argument never grows past ~3800.
 *
 * None of the affected meshes cast shadows (boulders are the only clutter
 * casters; understory never casts), so there is no shadow-depth mismatch.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";

/** Wrap period (s). Every ω below is 2π·n / WIND_TIME_WRAP for integer n. */
const WIND_TIME_WRAP = 300;

/** Per-class tip amplitudes (m) — game-side constants, tuned by eye in the
 * running game, deliberately NOT sim tunables. */
export const WIND_AMP_MEADOW = 0.06;
export const WIND_AMP_GRASS = 0.06;
export const WIND_AMP_FLOWER = 0.05;
export const WIND_AMP_BUSH = 0.03;
export const WIND_AMP_UNDERSTORY = 0.04;

// ω constants (rad/s), exact multiples of 2π/300:
//   gust      n=18  → 0.376991…  (0.06 Hz — a ~25 m wave at ~1.5 m/s)
//   gust 2nd  n=42  → 0.879646…
//   flutter   n=600 → 12.566371… (2 Hz leaf flutter)
const WIND_GLSL = `
#ifdef WIND
float windH = clamp(positionUpdated.y / windMeshHeight, 0.0, 1.0);
float windK = windH * windH * windAmp;
float windPhase = worldPos.x * 0.24 + worldPos.z * 0.08 + windTime * 0.3769911184;
float windGust = sin(windPhase) + 0.6 * sin(worldPos.x * 0.56 + windTime * 0.8796459430);
float windFlutter = sin(worldPos.x * 2.1 + worldPos.z * 1.7 + windTime * 12.5663706144);
worldPos.x += windK * (0.75 * windGust + 0.25 * windFlutter);
worldPos.z += windK * (0.35 * windGust - 0.2 * windFlutter);
#endif
`;

export class WindPlugin extends MaterialPluginBase {
  private readonly _amp: number;
  private readonly _meshHeight: number;

  constructor(material: Material, tipAmplitude: number, meshHeight: number) {
    super(material, "Wind", 200, { WIND: false });
    this._amp = tipAmplitude;
    this._meshHeight = meshHeight;
    this._enable(true);
  }

  override getClassName(): string {
    return "WindPlugin";
  }

  // `scene` and `mesh` are part of MaterialPluginBase's required override
  // signature even though a per-material constant define needs neither; TS's
  // own noUnusedParameters exempts the leading underscore, only this project's
  // eslint config (tseslint recommended, no argsIgnorePattern) does not — the
  // `cel.ts` precedent.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.WIND = true;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string } {
    return {
      ubo: [
        { name: "windTime", size: 1, type: "float" },
        { name: "windAmp", size: 1, type: "float" },
        { name: "windMeshHeight", size: 1, type: "float" },
      ],
      vertex: `
#ifdef WIND
uniform float windTime;
uniform float windAmp;
uniform float windMeshHeight;
#endif
`,
    };
  }

  // Same signature-vs-eslint story as `prepareDefines` above: the trailing
  // three are Babylon's contract, and only `uniformBuffer` is needed here.
  // One line, deliberately: `eslint-disable-next-line` covers only the line
  // that follows it, so a wrapped parameter list would leave the unused three
  // unsuppressed.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloat("windTime", (performance.now() / 1000) % WIND_TIME_WRAP);
    uniformBuffer.updateFloat("windAmp", this._amp);
    uniformBuffer.updateFloat("windMeshHeight", this._meshHeight);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    return shaderType === "vertex" ? { CUSTOM_VERTEX_UPDATE_WORLDPOS: WIND_GLSL } : null;
  }
}

/** Attach the wind plugin to a material once; further calls are no-ops (LOD
 * levels share materials after the pipeline's dedup, so attach is reached more
 * than once per material). */
export function attachWind(material: Material, tipAmplitude: number, meshHeight: number): void {
  if (material.pluginManager?.getPlugin("Wind")) return;
  new WindPlugin(material, tipAmplitude, meshHeight);
}
