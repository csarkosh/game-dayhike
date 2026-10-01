/**
 * The splashes: short-lived crown rings where the rain lands, on the cover
 * map's surface (`rainMap.ts`) in a disc around the eye.
 *
 * One thin-instanced unit quad per splash, the matrices identities and a
 * static per-instance seed, placed each frame by the vertex stage of a small
 * material plugin (`SplashPlugin`) on an unlit, alpha-blended Standard
 * material, as the streaks are (`rain.ts`, `rainPlugin.ts`). A plugin on a
 * Standard material rather than a ShaderMaterial: the material brings the
 * fog, the blend, the thin-instance includes and the plugin numbering the
 * WGSL map keys on (`pluginNumbers.ts`) as the streaks' does, and the ring
 * needs nothing of its own beyond a vertex placement and a fragment mask.
 *
 * A splash is a seed (three hashes in [0, 1) and a size factor) and a cycle:
 * `t = time / life + seed.x`, its cycle `floor(t)` and its phase `fract(t)`.
 * Each cycle a hash of the seed and the cycle picks a point in a disc of
 * SPLASH.radius around the eye, uniform in area (`r = radius × sqrt(h)`), and
 * the map gives the point's height and transmission; a point the map does not
 * hold is collapsed to nothing. The quad faces the camera, SPLASH.size wide
 * by the seed, growing with the phase. Its alpha is the phase's remainder,
 * the map's transmission (none under a roof, a third under canopy), the rain
 * value, and a backlight: half always, half when the sun or the headlamp is
 * behind the ring (the sun's share is the view's agreement with the light's
 * travel, zero once the sun is down; the lamp's the inverse-square cone term
 * the streaks use, the sum bounded at 1). The fragment draws the ring from
 * the quad's own coordinates: a band at a radius that grows with the phase.
 *
 * The time folds at SPLASH_FOLD_S, a whole number of lives, and the cycle is
 * counted modulo SPLASH_CYCLES, so the fold moves no ring. The hash is Dave
 * Hoskins' sine-free `hash22`, whose inputs stay in the hundreds. The colour
 * is the streaks': the fog colour lifted by RAIN_MILK, set each frame. The
 * mesh draws just before the streaks (its alphaIndex one under theirs), in
 * the same group, depth-tested but not written, always active, never picked,
 * never a shadow caster or receiver, its bounding info unsynced.
 *
 * Renderer-only by design: nothing here may migrate into sim/ or a tunables
 * registry.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
// Non-.pure path, load-bearing (Babylon 9 split — see lighting.ts).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Material } from "@babylonjs/core/Materials/material.js";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";

import { clamp01 } from "./colour.js";
import type { WeatherParams } from "./weather.js";
import type { QualityTier } from "./quality.js";
import type { RainLamp } from "./rain.js";
import type { RainMap } from "./rainMap.js";
import {
  RAIN_LAMP_GAIN, RAIN_MAP, RAIN_MILK, SPLASH, SPLASH_CYCLES, SPLASH_TIERS, rainSeeds, splashCountUnder, splashFold,
} from "./rainParams.js";

/** A GLSL float literal: always with a decimal point, so `10` is `10.0`. */
function lit(v: number): string {
  const s = String(v);
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
}

/** The seed buffer's hash seed: the splashes' layout is the same on every load. */
const SPLASH_SEED = 0x53706c73;

/** The sun's backlight fades in over this much of the sun's height (the
 * sine of its elevation): none once it is down. */
const SUN_UP = 0.1;

const SPLASH_VERTEX_DEFS = `
#ifdef SPLASH
attribute vec4 splashSeed;
varying float vSplashAlpha;
varying float vSplashPhase;
varying vec2 vSplashUv;
uniform sampler2D splashMapSampler;
vec2 splashHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
#endif
`;

// The plane is MeshBuilder's unit plane: `position.xy` in [-0.5, 0.5]. The
// camera-facing basis is the view crossed with world up (a ring is never seen
// from straight above at the eye's own height: the cross product's length
// guards it anyway).
const SPLASH_VERTEX_POSITION = `
#ifdef SPLASH
{
  float sT = splashTime / ${lit(SPLASH.life)} + splashSeed.x;
  float sCycle = mod(floor(sT), ${lit(SPLASH_CYCLES)});
  float sPhase = fract(sT);
  vec2 sH = splashHash(splashSeed.yz + sCycle);
  float sR = ${lit(SPLASH.radius)} * sqrt(sH.x);
  float sA = 6.2831853 * sH.y;
  vec2 sXZ = splashCam.xz + vec2(cos(sA), sin(sA)) * sR;
  vec2 sMu = (sXZ - splashMapCentre) / splashMapExtent + 0.5;
  vec4 sMap = texture2D(splashMapSampler, sMu);
  float sIn = step(0.0, sMu.x) * step(sMu.x, 1.0) * step(0.0, sMu.y) * step(sMu.y, 1.0);
  vec3 sp = vec3(sXZ.x, sMap.r, sXZ.y);
  vec3 sToCam = splashCam - sp;
  float sDist = max(length(sToCam), 0.001);
  vec3 sView = sToCam / sDist;
  vec3 sSide = cross(vec3(0.0, 1.0, 0.0), sView);
  vec3 sRight = sSide / max(length(sSide), 0.001);
  vec3 sUp = cross(sView, sRight);
  float sSize = mix(${lit(SPLASH.size[0])}, ${lit(SPLASH.size[1])}, splashSeed.w) * (0.5 + sPhase) * sIn;
  positionUpdated = sp + (sRight * position.x + sUp * position.y) * sSize;
  float sSunT = max(dot(sView, splashSun), 0.0);
  vec3 sToLamp = sp - splashLampPos;
  float sLampD2 = dot(sToLamp, sToLamp);
  float sCos = dot(sToLamp, splashLampDir) / sqrt(max(sLampD2, 0.0001));
  float sCone = smoothstep(splashLamp.y, 0.5 + 0.5 * splashLamp.y, sCos);
  float sLampT = splashLamp.x * sCone / (1.0 + sLampD2);
  float sBack = min(sSunT + sLampT, 1.0);
  vSplashAlpha = (1.0 - sPhase) * sMap.g * splashRain * (0.5 + 0.5 * sBack) * sIn;
  vSplashPhase = sPhase;
  vSplashUv = position.xy + 0.5;
}
#endif
`;

const SPLASH_FRAGMENT_DEFS = `
#ifdef SPLASH
varying float vSplashAlpha;
varying float vSplashPhase;
varying vec2 vSplashUv;
#endif
`;

// The ring: a band 0.15 wide (in the quad's diameter) at a radius that grows
// from 0.3 to 1 over the life.
const SPLASH_FRAGMENT_BEFORE_FRAGCOLOR = `
#ifdef SPLASH
{
  float sD = length(vSplashUv - 0.5) * 2.0;
  float sRing = 1.0 - smoothstep(0.0, 0.15, abs(sD - (0.3 + 0.7 * vSplashPhase)));
  color.a *= sRing * vSplashAlpha;
}
#endif
`;

export class SplashPlugin extends MaterialPluginBase {
  /** The folded running time, seconds. */
  time = 0;
  /** The eye. */
  camX = 0;
  camY = 0;
  camZ = 0;
  /** The rain value. */
  rain = 0;
  /** The direction the sun's light travels, scaled by how far up the sun is
   * (0 once it is down). */
  sunX = 0;
  sunY = 0;
  sunZ = 0;
  /** The headlamp: position, direction, intensity (already scaled to alpha)
   * and the cosine of its half-angle. */
  lampX = 0;
  lampY = 0;
  lampZ = 0;
  lampDirX = 0;
  lampDirY = 0;
  lampDirZ = 1;
  lampIntensity = 0;
  lampCosHalf = 1;
  /** The cover map (`rainMap.ts`) and the centre it was drawn at. */
  map: BaseTexture | null = null;
  mapCentreX = 0;
  mapCentreZ = 0;

  constructor(material: Material) {
    super(material, "Splash", 230, { SPLASH: false });
    this._enable(true);
  }

  override getClassName(): string {
    return "SplashPlugin";
  }

  // One line, for the eslint-disable reason foliagePlugin.ts records.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.SPLASH = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push("splashSeed");
  }

  // Always listed: Babylon gathers a plugin's samplers once, when the
  // material's uniform layout is built (`rainPlugin.ts` says why).
  override getSamplers(samplers: string[]): void {
    samplers.push("splashMapSampler");
  }

  override getActiveTextures(activeTextures: BaseTexture[]): void {
    if (this.map !== null) activeTextures.push(this.map);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return texture === this.map;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string; fragment: string } {
    return {
      ubo: [
        { name: "splashTime", size: 1, type: "float" },
        { name: "splashCam", size: 3, type: "vec3" },
        { name: "splashRain", size: 1, type: "float" },
        { name: "splashSun", size: 3, type: "vec3" },
        { name: "splashLampPos", size: 3, type: "vec3" },
        { name: "splashLampDir", size: 3, type: "vec3" },
        { name: "splashLamp", size: 2, type: "vec2" },
        { name: "splashMapCentre", size: 2, type: "vec2" },
        { name: "splashMapExtent", size: 1, type: "float" },
      ],
      vertex: `
#ifdef SPLASH
uniform float splashTime;
uniform vec3 splashCam;
uniform float splashRain;
uniform vec3 splashSun;
uniform vec3 splashLampPos;
uniform vec3 splashLampDir;
uniform vec2 splashLamp;
uniform vec2 splashMapCentre;
uniform float splashMapExtent;
#endif
`,
      fragment: "",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloat("splashTime", this.time);
    uniformBuffer.updateFloat3("splashCam", this.camX, this.camY, this.camZ);
    uniformBuffer.updateFloat("splashRain", this.rain);
    uniformBuffer.updateFloat3("splashSun", this.sunX, this.sunY, this.sunZ);
    uniformBuffer.updateFloat3("splashLampPos", this.lampX, this.lampY, this.lampZ);
    uniformBuffer.updateFloat3("splashLampDir", this.lampDirX, this.lampDirY, this.lampDirZ);
    uniformBuffer.updateFloat2("splashLamp", this.lampIntensity, this.lampCosHalf);
    uniformBuffer.updateFloat2("splashMapCentre", this.mapCentreX, this.mapCentreZ);
    uniformBuffer.updateFloat("splashMapExtent", RAIN_MAP.extent);
    if (this.map !== null) uniformBuffer.setTexture("splashMapSampler", this.map);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return { CUSTOM_VERTEX_DEFINITIONS: SPLASH_VERTEX_DEFS, CUSTOM_VERTEX_UPDATE_POSITION: SPLASH_VERTEX_POSITION };
    }
    if (shaderType === "fragment") {
      return { CUSTOM_FRAGMENT_DEFINITIONS: SPLASH_FRAGMENT_DEFS, CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: SPLASH_FRAGMENT_BEFORE_FRAGCOLOR };
    }
    return null;
  }
}

/** Attach the splash plugin to a material once; a second call returns the first's. */
export function attachSplash(material: Material): SplashPlugin {
  const existing = material.pluginManager?.getPlugin("Splash") as SplashPlugin | null | undefined;
  if (existing) return existing;
  return new SplashPlugin(material);
}

export type RainSplash = {
  mesh: Mesh;
  plugin: SplashPlugin;
  /** The cover map the rings land on (`rainMap.ts`), or null for none, under
   * which nothing is drawn. */
  setMap(map: RainMap | null): void;
  /** `sunDir` is the direction the sun's light travels (the directional
   * light's); `seconds` the running time. */
  update(
    camPos: { x: number; y: number; z: number },
    w: WeatherParams,
    lamp: RainLamp,
    sunDir: { x: number; y: number; z: number },
    seconds: number,
  ): void;
  dispose(): void;
};

/** The splashes on the tiers that draw them (SPLASH_TIERS); null on the rest. */
export function createRainSplash(scene: Scene, tier: QualityTier): RainSplash | null {
  const count = SPLASH_TIERS[tier];
  if (count === 0) return null;

  const mat = new StandardMaterial("mat_rain_splash", scene);
  mat.disableLighting = true;
  // Unlit, the colour is the diffuse colour plus the emissive, clamped: the
  // diffuse must be black for the emissive set each frame to be the colour.
  mat.diffuseColor.set(0, 0, 0);
  mat.emissiveColor.set(1, 1, 1);
  // Under 1, so the material blends: Babylon reads the blend from the alpha
  // and no texture carries one here. The ring's alpha is the fragment's.
  mat.alpha = 0.999;
  mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  mat.fogEnabled = true;
  const plugin = attachSplash(mat);

  const mesh = MeshBuilder.CreatePlane("rain_splashes", { size: 1 }, scene);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  // Just before the streaks in the blended sort (`rain.ts`).
  mesh.alphaIndex = Number.MAX_SAFE_INTEGER - 1;
  const matrices = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    matrices[i * 16] = 1;
    matrices[i * 16 + 5] = 1;
    matrices[i * 16 + 10] = 1;
    matrices[i * 16 + 15] = 1;
  }
  mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
  mesh.thinInstanceSetBuffer("splashSeed", rainSeeds(count, SPLASH_SEED), 4, true);
  mesh.setEnabled(false);

  let map: RainMap | null = null;

  return {
    mesh,
    plugin,
    setMap(next) {
      map = next;
      plugin.map = next === null ? null : next.texture;
    },
    update(camPos, w, lamp, sunDir, seconds) {
      const drawn = map === null ? 0 : splashCountUnder(w.rain, tier);
      if (drawn === 0) {
        mesh.setEnabled(false);
        return;
      }
      mesh.thinInstanceCount = drawn;
      mesh.setEnabled(true);

      plugin.time = splashFold(seconds);
      plugin.camX = camPos.x;
      plugin.camY = camPos.y;
      plugin.camZ = camPos.z;
      plugin.rain = clamp01(w.rain);
      // The light travels down while the sun is up: its height is -y.
      const up = clamp01(-sunDir.y / SUN_UP);
      plugin.sunX = sunDir.x * up;
      plugin.sunY = sunDir.y * up;
      plugin.sunZ = sunDir.z * up;
      plugin.lampX = lamp.x;
      plugin.lampY = lamp.y;
      plugin.lampZ = lamp.z;
      plugin.lampDirX = lamp.dx;
      plugin.lampDirY = lamp.dy;
      plugin.lampDirZ = lamp.dz;
      plugin.lampIntensity = lamp.intensity * RAIN_LAMP_GAIN;
      plugin.lampCosHalf = Math.cos(lamp.angle / 2);
      if (map !== null) {
        plugin.mapCentreX = map.centre.x;
        plugin.mapCentreZ = map.centre.z;
      }

      const fog = scene.fogColor;
      mat.emissiveColor.set(
        clamp01(fog.r * RAIN_MILK.gain + RAIN_MILK.lift),
        clamp01(fog.g * RAIN_MILK.gain + RAIN_MILK.lift),
        clamp01(fog.b * RAIN_MILK.gain + RAIN_MILK.lift),
      );
    },
    dispose() {
      mesh.dispose();
      mat.dispose();
    },
  };
}
