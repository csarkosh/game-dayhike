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
import type { WeatherParams } from "./weather.js";
import {
  atmosphereUnder, fogGradientUnder, GRADIENT_STEPS, type AtmosphereRecord,
} from "./atmosphereParams.js";

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
let gradientTexture: RawTexture | null = null;

class AtmospherePlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // Priority 200, no defines, enabled immediately: the uniform decides.
    super(material, "Atmosphere", 200, undefined, true, true);
  }

  override getClassName(): string {
    return "AtmospherePlugin";
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("atmGradient");
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
        "uniform sampler2D atmGradient;",
      ].join("\n"),
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    const r = current;
    if (r === null || gradientTexture === null) {
      uniformBuffer.updateFloat("atmOn", 0);
      return;
    }
    uniformBuffer.updateFloat("atmOn", 1);
    uniformBuffer.updateFloat("atmHeightDensity", r.heightDensity);
    uniformBuffer.updateFloat("atmHeightFalloff", r.heightFalloff);
    uniformBuffer.updateFloat("atmReferenceLevel", r.referenceLevel);
    uniformBuffer.updateFloat("atmGradientScale", r.gradientScale);
    uniformBuffer.updateFloat("atmSunPower", r.sunPower);
    uniformBuffer.updateFloat("atmSunWeight", r.sunWeight);
    uniformBuffer.updateFloat3("atmSunDir", r.sunDir.x, r.sunDir.y, r.sunDir.z);
    uniformBuffer.updateFloat3("atmSunColour", r.sunColour.r, r.sunColour.g, r.sunColour.b);
    uniformBuffer.setTexture("atmGradient", gradientTexture);
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
  /** Recomputes the record and, if hour or weather changed, the gradient texture. */
  update(weather: WeatherParams, hour: number): void;
  readonly record: AtmosphereRecord;
  readonly gradientBuilds: number;
  /** The gradient's middle colour, for mist banks. */
  midColour(): Rgb;
  dispose(): void;
};

function gradientTexels(gradient: Rgb[]): Uint8Array {
  const data = new Uint8Array(GRADIENT_STEPS * 4);
  for (let i = 0; i < GRADIENT_STEPS; i++) {
    const c = gradient[i] as Rgb;
    data[i * 4] = Math.round(Math.min(1, Math.max(0, c.r)) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, c.g)) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, c.b)) * 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}

/**
 * Registers the plugin factory. MUST run before any PBR material exists —
 * RegisterMaterialPlugin only reaches materials created afterwards. The
 * factory declines non-PBR materials (sky, mist, particles) by returning null.
 *
 * The gradient is a 256x1 RGBA8 strip in LINEAR space (the grade pass
 * tone-maps after it); the finish pass's dither hides its 8-bit steps.
 */
export function createAtmosphere(scene: Scene, viewDistance: number): Atmosphere {
  RegisterMaterialPlugin("Atmosphere", (material) =>
    material instanceof PBRMaterial ? new AtmospherePlugin(material) : null,
  );
  let record = atmosphereUnder({ cloudCover: 0, mist: 0, rain: 0, wetness: 0, dread: 0 }, 12, viewDistance);
  let gradient: Rgb[] = [];
  let lastKey = "";
  let builds = 0;
  const tex = RawTexture.CreateRGBATexture(
    gradientTexels(fogGradientUnder({ cloudCover: 0, mist: 0, rain: 0, wetness: 0, dread: 0 }, 12)),
    GRADIENT_STEPS, 1, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Engine.TEXTURETYPE_UNSIGNED_BYTE,
  );
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  gradientTexture = tex;

  return {
    get record() {
      return record;
    },
    get gradientBuilds() {
      return builds;
    },
    update(weather, hour) {
      record = atmosphereUnder(weather, hour, viewDistance);
      current = record;
      // The five weather axes and the hour are the whole input to the
      // gradient; a fade rebuilds every tick (256 texels, trivial), a still
      // frame never does.
      const key = `${hour}|${weather.cloudCover}|${weather.mist}|${weather.rain}|${weather.wetness}|${weather.dread}`;
      if (key !== lastKey) {
        gradient = fogGradientUnder(weather, hour);
        tex.update(gradientTexels(gradient));
        const far = gradient[GRADIENT_STEPS - 1] as Rgb;
        // Non-PBR materials (mist, rain) still read Babylon's fog colour.
        scene.fogColor = new Color3(far.r, far.g, far.b);
        scene.fogDensity = record.baseDensity;
        lastKey = key;
        builds += 1;
      }
    },
    midColour() {
      return gradient[GRADIENT_STEPS >> 1] ?? { r: 0, g: 0, b: 0 };
    },
    dispose() {
      UnregisterMaterialPlugin("Atmosphere");
      current = null;
      gradientTexture = null;
      tex.dispose();
    },
  };
}
