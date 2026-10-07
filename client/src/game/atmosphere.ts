import type { Scene } from "@babylonjs/core/scene.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Nullable } from "@babylonjs/core/types.js";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
// Non-`.pure` import, load-bearing exactly as lighting.ts documents: the
// wrapper registers the plugin-manager machinery this module depends on.
import {
  RegisterMaterialPlugin,
  UnregisterMaterialPlugin,
} from "@babylonjs/core/Materials/materialPluginManager.js";
import atmosphereFragment from "./shaders/atmosphereFog.fragment.fx?raw";
import type { Rgb } from "./colour.js";
import { HOLLOW_MATERIAL } from "./hollowLook.js";
import type { WeatherParams } from "./weather.js";
import type { SkyState } from "./skyState.js";
import {
  atmosphereUnder, fogGradientUnder, GRADIENT_STEPS, type AtmosphereRecord,
} from "./atmosphereParams.js";
import {
  CLOUD_GLOW, CLOUD_GLOW_POWER, CLOUD_GROUND_SIZE, CLOUD_GROUND_SPAN, CLOUD_NEAR_M, CLOUD_NOISE_LARGE_M, CLOUD_NOISE_SIZE, CLOUD_NOISE_SMALL_M,
  CLOUD_RANGE, CLOUD_SEAT, CLOUD_SIGMA, CLOUD_WIND_MPS, cloudColourUnder, cloudHeightUnder, cloudNoiseMap, type CloudGround,
} from "./cloudParams.js";

/**
 * The regex key that replaces Babylon's fog line. `fogFragment` reads
 * `color.rgb=mix(vFogColor,color.rgb,fog);` and pbr.fragment includes it as
 * `#include<fogFragment>(color,finalColor)`, so the expanded text names
 * `finalColor`. atmosphere.test.ts pins this against the installed include.
 */
export const ATMOSPHERE_FOG_ANCHOR = "!finalColor\\.rgb=mix\\(vFogColor,finalColor\\.rgb,fog\\);";
const ATMOSPHERE_FOG_CODE = "finalColor.rgb=atmosphereFog(finalColor.rgb,fog);";

/** Module-level so every material's plugin instance reads one truth, the cel.ts precedent. */
let current: AtmosphereRecord | null = null;
/** The ground cloud's map (cloudParams.ts, noise in R and G, the ground in B), and its state for the frame. */
let cloudMapTexture: RawTexture | null = null;
export type CloudState = {
  /** The density knob, 0 to 1 (cloudDensityUnder), the steps the tier marches (0: no cloud), and the haunt's level, which the cloud stands taller by. */
  density: number;
  steps: number;
  haunt: number;
  /** The clock, seconds, for the wind. */
  seconds: number;
  /** The cloud's colour, linear. */
  colour: Rgb;
  /** The ground map's centre, base and range (cloudGroundMap). */
  ground: { centreX: number; centreZ: number; base: number; range: number };
};
let cloud: CloudState = { density: 0, steps: 0, haunt: 0, seconds: 0, colour: { r: 0, g: 0, b: 0 }, ground: { centreX: 0, centreZ: 0, base: 0, range: 1 } };
/** Whether a registration is live: from `createAtmosphere` until its dispose. */
let registered = false;

/**
 * Takes back a registration no `dispose` will: a renderer whose build threw
 * after `createAtmosphere` never returned the atmosphere to dispose. Left
 * registered, the plugin would reach every material the next renderer makes.
 */
export function releaseAtmosphere(): void {
  if (!registered) return;
  UnregisterMaterialPlugin("Atmosphere");
  registered = false;
  current = null;
  cloudMapTexture = null;
}

class AtmospherePlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // Priority 200, no defines, enabled immediately: the uniform decides.
    super(material, "Atmosphere", 200, undefined, true, true);
  }

  override getClassName(): string {
    return "AtmospherePlugin";
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("atmCloudMap");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "atmOn", size: 1, type: "float" },
        { name: "atmHeightDensity", size: 1, type: "float" },
        { name: "atmHeightFalloff", size: 1, type: "float" },
        { name: "atmReferenceLevel", size: 1, type: "float" },
        { name: "atmGradientScale", size: 1, type: "float" },
        { name: "atmSunPower", size: 1, type: "float" },
        { name: "atmSunWeight", size: 1, type: "float" },
        { name: "atmSunDir", size: 3, type: "vec3" },
        { name: "atmSunColour", size: 3, type: "vec3" },
        { name: "atmFarColour", size: 3, type: "vec3" },
        { name: "atmCloudDensity", size: 1, type: "float" },
        { name: "atmCloudSteps", size: 1, type: "float" },
        { name: "atmCloudRange", size: 1, type: "float" },
        { name: "atmCloudFalloff", size: 1, type: "float" },
        { name: "atmCloudSeat", size: 1, type: "float" },
        { name: "atmCloudGroundRange", size: 1, type: "float" },
        { name: "atmCloudNear", size: 1, type: "float" },
        { name: "atmCloudNoiseScale", size: 2, type: "vec2" },
        { name: "atmCloudWind", size: 2, type: "vec2" },
        { name: "atmCloudGlow", size: 2, type: "vec2" },
        { name: "atmCloudColour", size: 3, type: "vec3" },
        { name: "atmCloudGroundRect", size: 4, type: "vec4" },
      ],
      fragment: [
        "uniform float atmOn;",
        "uniform float atmHeightDensity;",
        "uniform float atmHeightFalloff;",
        "uniform float atmReferenceLevel;",
        "uniform float atmGradientScale;",
        "uniform float atmSunPower;",
        "uniform float atmSunWeight;",
        "uniform vec3 atmSunDir;",
        "uniform vec3 atmSunColour;",
        "uniform vec3 atmFarColour;",
        "uniform float atmCloudDensity;",
        "uniform float atmCloudSteps;",
        "uniform float atmCloudRange;",
        "uniform float atmCloudFalloff;",
        "uniform float atmCloudSeat;",
        "uniform float atmCloudGroundRange;",
        "uniform float atmCloudNear;",
        "uniform vec2 atmCloudNoiseScale;",
        "uniform vec2 atmCloudWind;",
        "uniform vec2 atmCloudGlow;",
        "uniform vec3 atmCloudColour;",
        "uniform vec4 atmCloudGroundRect;",
      ].join("\n"),
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    // Bound whenever it exists, the effect on or off: the sampler is always in
    // the shader (every read of it is gated on `atmOn`, not on a define), and
    // WebGPU validates every binding a pipeline declares on every draw, so
    // before the first `update` a draw would declare a sampler nothing bound.
    // Binding it while off changes no pixel.
    if (cloudMapTexture !== null) uniformBuffer.setTexture("atmCloudMap", cloudMapTexture);
    const r = current;
    if (r === null || cloudMapTexture === null) {
      uniformBuffer.updateFloat("atmOn", 0);
      uniformBuffer.updateFloat("atmCloudSteps", 0);
      return;
    }
    // The cloud: off (no steps) while it has no density or no maps.
    const c = cloud;
    const on = c.density > 0.002;
    uniformBuffer.updateFloat("atmCloudSteps", on ? c.steps : 0);
    uniformBuffer.updateFloat("atmCloudDensity", CLOUD_SIGMA * c.density);
    uniformBuffer.updateFloat("atmCloudRange", CLOUD_RANGE);
    uniformBuffer.updateFloat("atmCloudFalloff", 1 / cloudHeightUnder(c.haunt));
    uniformBuffer.updateFloat("atmCloudSeat", CLOUD_SEAT);
    uniformBuffer.updateFloat("atmCloudGroundRange", c.ground.range);
    uniformBuffer.updateFloat("atmCloudNear", CLOUD_NEAR_M);
    uniformBuffer.updateFloat2("atmCloudNoiseScale", 1 / CLOUD_NOISE_LARGE_M, 1 / CLOUD_NOISE_SMALL_M);
    const wind = (c.seconds * CLOUD_WIND_MPS) / CLOUD_NOISE_LARGE_M;
    uniformBuffer.updateFloat2("atmCloudWind", wind % 1, (wind * 0.6) % 1);
    uniformBuffer.updateFloat2("atmCloudGlow", CLOUD_GLOW, CLOUD_GLOW_POWER);
    uniformBuffer.updateFloat3("atmCloudColour", c.colour.r, c.colour.g, c.colour.b);
    uniformBuffer.updateFloat4("atmCloudGroundRect", c.ground.centreX, c.ground.centreZ, 1 / CLOUD_GROUND_SPAN, c.ground.base);
    uniformBuffer.updateFloat("atmOn", 1);
    uniformBuffer.updateFloat("atmHeightDensity", r.heightDensity);
    uniformBuffer.updateFloat("atmHeightFalloff", r.heightFalloff);
    uniformBuffer.updateFloat("atmReferenceLevel", r.referenceLevel);
    uniformBuffer.updateFloat("atmGradientScale", r.gradientScale);
    uniformBuffer.updateFloat("atmSunPower", r.sunPower);
    uniformBuffer.updateFloat("atmSunWeight", r.sunWeight);
    uniformBuffer.updateFloat3("atmSunDir", r.sunDir.x, r.sunDir.y, r.sunDir.z);
    uniformBuffer.updateFloat3("atmSunColour", r.sunColour.r, r.sunColour.g, r.sunColour.b);
    uniformBuffer.updateFloat3("atmFarColour", r.farColour.r, r.farColour.g, r.farColour.b);
  }

  override getCustomCode(shaderType: string): Nullable<{ [pointName: string]: string }> {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: atmosphereFragment,
      [ATMOSPHERE_FOG_ANCHOR]: ATMOSPHERE_FOG_CODE,
    };
  }
}

export type Atmosphere = {
  /**
   * Recomputes the record from the weather and the sky state the lighting
   * last applied (`Lighting.sky`), and the gradient (the colours the mist
   * banks and motes read) when that state is a new one or a weather axis moved.
   */
  update(weather: WeatherParams, sky: SkyState): void;
  /** The last update's record; null before the first, while the plugin is off. */
  readonly record: AtmosphereRecord | null;
  readonly gradientBuilds: number;
  /** The gradient's middle colour, for mist banks. */
  midColour(): Rgb;
  /** The gradient's near-end colour, for motes. */
  nearColour(): Rgb;
  /**
   * The ground cloud for the frame (cloudParams.ts): its density knob, the
   * tier's steps, and the clock. Its colour is the gradient's near end lifted
   * toward grey (cloudColourUnder), so it is dark by night and pale by day.
   */
  setCloud(density: number, steps: number, seconds: number, haunt?: number): void;
  /** The ground the cloud rests on, rebuilt round a place (cloudGroundMap). */
  setCloudGround(ground: CloudGround): void;
  /** The cloud's state as last set, for tests and the console. */
  readonly cloud: CloudState;
  dispose(): void;
};

/**
 * Registers the plugin factory. MUST run before any PBR material exists —
 * RegisterMaterialPlugin only reaches materials created afterwards. The
 * factory declines non-PBR materials (the sky dome, mist, particles) by
 * returning null, and declines the Hollow's PBR material by name: it keeps fog
 * off, and the plugin's spliced code reads `vFogColor`, which Babylon declares
 * only while the FOG define is set, so with the plugin attached that material
 * would fail to compile on an undeclared identifier (entityViews.ts says why
 * fog stays off).
 *
 * The gradient is drawn by the shader as a curve on the far colour; the list
 * here is the mist banks' and motes' colours. The cloud map is the plugin's
 * one texture (its doc comment in the shader says why one).
 */
export function createAtmosphere(scene: Scene, viewDistance: number): Atmosphere {
  RegisterMaterialPlugin("Atmosphere", (material) =>
    material instanceof PBRMaterial && material.name !== HOLLOW_MATERIAL ? new AtmospherePlugin(material) : null,
  );
  registered = true;
  let record: AtmosphereRecord | null = null;
  let gradient: Rgb[] = [];
  let lastSky: SkyState | null = null;
  let lastWeather = "";
  let builds = 0;
  // The cloud's map: the tiling noise in R and G, the ground in B, flat at 0
  // until the first build. Nothing reads it before the first update (the
  // plugin is off while `current` is null), but WebGPU validates every
  // binding a pipeline declares, so the texture exists from the start.
  const cloudMap = cloudNoiseMap();
  const map = RawTexture.CreateRGBATexture(
    cloudMap, CLOUD_NOISE_SIZE, CLOUD_NOISE_SIZE, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Engine.TEXTURETYPE_UNSIGNED_BYTE,
  );
  map.name = "atmCloudMap";
  map.wrapU = Texture.WRAP_ADDRESSMODE;
  map.wrapV = Texture.WRAP_ADDRESSMODE;
  cloudMapTexture = map;

  return {
    get record() {
      return record;
    },
    get gradientBuilds() {
      return builds;
    },
    update(weather, sky) {
      record = atmosphereUnder(weather, sky, viewDistance);
      current = record;
      // The sky state and the five weather axes are the whole input to the
      // gradient. The lighting makes a new state at each apply (an hour, a
      // weather, a fade's tick, a slice arriving), so a fade rebuilds every
      // tick (256 texels, trivial) and a still frame never does.
      const weatherKey = `${weather.cloudCover}|${weather.mist}|${weather.rain}|${weather.wetness}|${weather.dread}`;
      if (sky !== lastSky || weatherKey !== lastWeather) {
        gradient = fogGradientUnder(weather, sky);
        const far = gradient[GRADIENT_STEPS - 1] as Rgb;
        // Non-PBR materials (mist, rain) still read Babylon's fog colour.
        scene.fogColor = new Color3(far.r, far.g, far.b);
        scene.fogDensity = record.baseDensity;
        lastSky = sky;
        lastWeather = weatherKey;
        builds += 1;
      }
    },
    midColour() {
      return gradient[GRADIENT_STEPS >> 1] ?? { r: 0, g: 0, b: 0 };
    },
    nearColour() {
      return gradient[0] ?? { r: 0, g: 0, b: 0 };
    },
    setCloud(density, steps, seconds, haunt = 0) {
      cloud = { ...cloud, density: Math.max(0, Math.min(1, density)), steps, seconds, haunt: Math.max(0, Math.min(1, haunt)), colour: cloudColourUnder(gradient[0] ?? { r: 0, g: 0, b: 0 }) };
    },
    setCloudGround(g) {
      for (let i = 0; i < CLOUD_GROUND_SIZE * CLOUD_GROUND_SIZE; i++) cloudMap[i * 4 + 2] = g.data[i * 4] as number;
      map.update(cloudMap);
      cloud = { ...cloud, ground: { centreX: g.centreX, centreZ: g.centreZ, base: g.base, range: g.range } };
    },
    get cloud() {
      return cloud;
    },
    dispose() {
      UnregisterMaterialPlugin("Atmosphere");
      registered = false;
      current = null;
      cloudMapTexture = null;
      map.dispose();
    },
  };
}
