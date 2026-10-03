/**
 * The sea's waves as the water material reads them: the swell's tables as
 * one texture (`oceanTables.ts`), and the values that move each frame on the
 * shared clock, written in place into the binding the sea's water plugin
 * holds (`OceanBinding`): what the shaders read the swell from, the same
 * tables `swellAt` reads on the CPU.
 *
 * The coastline row covers 12,480 m along z; it is written again around the
 * camera, and the texture uploaded, whenever the camera has moved more than
 * `OCEAN_COAST_RECENTRE` along z from where it was last written, so it always
 * reaches past the outermost water ring.
 *
 * Renderer-only; the maths is in the Babylon-free modules it reads.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import type { QualityTier } from "./quality.js";
import { SWELL_COMPONENTS, SWELL_COMPONENTS_LOW, type SwellComponent } from "./oceanSwell.js";
import { OCEAN_COAST_RECENTRE, OCEAN_COAST_STEP, coastProfilesFor, writeCoastRow } from "./oceanTables.js";
import { oceanFieldFor, swellPhases } from "./oceanWaves.js";
import { windSeaStateFor } from "./oceanWindSea.js";
import { oceanArrayPlaceholder, type OceanBinding, type WaterPlugin } from "./waterPlugin.js";
import { createWindSeaSource, type GpuStarter, type LoopStarter } from "./oceanWindSource.js";
import { coveFor } from "../sim/olympic.js";

/**
 * Where an absent headland tip is written (x, metres, at z = 0): far inland.
 * The swell travels toward +x, so every point of the world lies up-swell of
 * it and its shadow falls on none: the shelter it gives is 1 everywhere.
 */
export const OCEAN_NO_TIP = 1e9;

export type Ocean = {
  /** The swell's tables, RGBA32F, `OCEAN_TABLE_SAMPLES` × `OCEAN_ATLAS_ROWS`, nearest, clamped. */
  atlas: RawTexture;
  /** The wind sea's displacement and slopes, texture 2D arrays. */
  windDisp: BaseTexture;
  windSlope: BaseTexture;
  /** How the wind sea is drawn: 0 low (normals), 1 the loop, 2 the GPU FFT. */
  windMode: 0 | 1 | 2;
  /** Per frame: the camera, the shared seconds, the game's wind (0..1 and the
   * direction it blows toward), the hour (0–24), and whether the sea is drawn
   * (the high tier's FFT is stepped only then; drawn when not said). */
  update(
    camX: number, camZ: number, seconds: number, wind01: number, windDir: [number, number], hour: number, drawn?: boolean,
  ): void;
  /** Points the plugin at this ocean's binding, whose values `update` moves. */
  bind(plugin: WaterPlugin): void;
  dispose(): void;
};

/** The cove's headland tips as the uniform holds them: up to two, and an
 * absent one at (`OCEAN_NO_TIP`, 0). */
export function oceanTipsFor(tips: readonly (readonly [number, number])[]): [number, number, number, number] {
  const out: [number, number, number, number] = [OCEAN_NO_TIP, 0, OCEAN_NO_TIP, 0];
  for (let i = 0; i < Math.min(2, tips.length); i++) {
    const tip = tips[i] as readonly [number, number];
    out[i * 2] = tip[0];
    out[i * 2 + 1] = tip[1];
  }
  return out;
}

/**
 * The swell's components as the shaders read them, the `oceanK` uniforms:
 * (k0x, k0z, q0, a0) a component, twelve vec4s, the floats the atlas's
 * components row holds for the same components (`buildOceanTables`), so the
 * shaders read the same values as `swellAt`; zeros past those there are.
 */
export function oceanComponentsFor(components: readonly SwellComponent[]): Float32Array {
  const out = new Float32Array(SWELL_COMPONENTS * 4);
  for (let c = 0; c < Math.min(components.length, SWELL_COMPONENTS); c++) {
    const comp = components[c] as SwellComponent;
    out[c * 4] = comp.k0x;
    out[c * 4 + 1] = comp.k0z;
    out[c * 4 + 2] = comp.q0;
    out[c * 4 + 3] = comp.a0;
  }
  return out;
}

/**
 * The sea's waves for a world and a tier: the low tier draws the eight
 * largest of the swell's twelve components, the others all twelve. The wind
 * sea is the tier's (`oceanWindSource.ts`): the FFT on high, the loop baked
 * in a worker on medium and wherever the FFT cannot be had, none on low; its
 * textures are the scene's 1×1 array placeholder until a field is ready.
 * `wind` replaces how the fields are started (the tests', under Node).
 */
export function createOcean(
  scene: Scene,
  seed: number,
  tier: QualityTier,
  wind: { startLoop?: LoopStarter; startGpu?: GpuStarter } = {},
): Ocean {
  const field = oceanFieldFor(seed, tier === "low" ? SWELL_COMPONENTS_LOW : SWELL_COMPONENTS);
  const profiles = coastProfilesFor(seed);
  const { tables } = field;
  const cove = coveFor(seed);
  // The field's coastline row is about the cove's middle (`oceanFieldFor`):
  // the first update moves it to the camera if the camera is far from there.
  let coastCentreZ = cove.z0;
  const atlas = new RawTexture(
    tables.data,
    tables.width,
    tables.rows,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Texture.NEAREST_SAMPLINGMODE,
    Constants.TEXTURETYPE_FLOAT,
  );
  atlas.name = "oceanAtlas";
  atlas.wrapU = Texture.CLAMP_ADDRESSMODE;
  atlas.wrapV = Texture.CLAMP_ADDRESSMODE;
  const placeholder = oceanArrayPlaceholder(scene);
  const windMode = 0;
  const windSea = createWindSeaSource(scene, seed, tier, wind.startLoop, wind.startGpu);
  // The wind sea's fields turn with the wind about the cove's waterline
  // centre, where the sea is seen up close, so nothing slides there.
  const binding: OceanBinding = {
    atlas,
    windDisp: placeholder,
    windSlope: placeholder,
    phases: new Float32Array(12),
    components: oceanComponentsFor(field.components),
    swell: [field.travel[0], field.travel[1], field.tp, field.hs],
    tips: oceanTipsFor(field.tips),
    coast: [tables.coastOriginZ, OCEAN_COAST_STEP, field.count, windMode],
    wind: [0, 0, 0, 0],
    windDir: [1, 0, 0, 0],
    windStats: [0, 0, 0, 0],
    windPivot: [profiles.coastlineX(cove.z0), cove.z0, 0, 0],
  };
  return {
    atlas,
    // What the binding holds, which follows the wind sea's field as it comes.
    get windDisp() {
      return binding.windDisp;
    },
    get windSlope() {
      return binding.windSlope;
    },
    get windMode() {
      return binding.coast[3] as 0 | 1 | 2;
    },
    update(camX, camZ, seconds, wind01, windDir, hour, drawn = true) {
      if (Math.abs(camZ - coastCentreZ) > OCEAN_COAST_RECENTRE) {
        coastCentreZ = camZ;
        writeCoastRow(tables, profiles, coastCentreZ);
        // The whole atlas, 466 KB, once a kilometre at most.
        atlas.update(tables.data);
        binding.coast[0] = tables.coastOriginZ;
      }
      swellPhases(field, seconds, binding.phases);
      const blowing = windSeaStateFor(wind01, windDir, hour);
      // The tier's wind sea: its field and mode, the loop's time (0 while no
      // loop is drawn) and the numbers the shaders normalise it by; and the
      // sea's own state, at the speed the sea follows, a minute behind its
      // wind's (`lagSeaWind`).
      const sea = windSea.update(blowing, seconds, drawn);
      // The fully developed height, uncut: `windSeaShare` takes the share of it that the fetch allows.
      binding.wind[0] = sea.hs;
      binding.wind[1] = sea.loopScale;
      binding.wind[3] = sea.coverage;
      // The wind as it blows now: its direction turns the fields, and its
      // speed sets the roughness, whose short slopes follow it within seconds.
      binding.windDir[0] = blowing.dir[0];
      binding.windDir[1] = blowing.dir[1];
      binding.windDir[2] = blowing.u10;
      binding.windDir[3] = blowing.onshoreWeight;
      binding.windDisp = windSea.disp ?? placeholder;
      binding.windSlope = windSea.slope ?? placeholder;
      binding.coast[3] = windSea.mode;
      binding.wind[2] = windSea.loopTime;
      for (let i = 0; i < 4; i++) binding.windStats[i] = windSea.stats[i] as number;
    },
    bind(plugin) {
      plugin.ocean = binding;
    },
    dispose() {
      // The placeholder is the scene's, shared, and goes with the scene.
      atlas.dispose();
      windSea.dispose();
    },
  };
}
