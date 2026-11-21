/**
 * The sea's waves as numbers, with no engine: what the sea's material reads
 * its swell and its wind sea from each frame, kept and stepped here. The
 * swell's field for the world and the tier (`oceanWaves.ts`), its tables,
 * whose coastline row follows the camera along z, the phases on the shared
 * clock, and the wind sea's state for the wind as it blows and as the sea
 * follows it. The sea's meshes (`lite/seaMeshes.ts`) take these as records
 * of uniforms by name (`seaUniforms.ts`), beside the textures they make of
 * the tables and the wind sea's field.
 */
import { coveFor } from "../sim/olympic.js";
import { SWELL_COMPONENTS, SWELL_COMPONENTS_LOW, type SwellComponent } from "./oceanSwell.js";
import { OCEAN_COAST_RECENTRE, OCEAN_COAST_STEP, coastProfilesFor, writeCoastRow } from "./oceanTables.js";
import { oceanFieldFor, swellPhases, type OceanField } from "./oceanWaves.js";
import { windSeaStateFor, type WindSeaState } from "./oceanWindSea.js";
import type { QualityTier } from "./quality.js";

/**
 * Where an absent headland tip is written (x, metres, at z = 0): far inland.
 * The swell travels toward +x, so every point of the world lies up-swell of
 * it and its shadow falls on none: the shelter it gives is 1 everywhere.
 */
export const OCEAN_NO_TIP = 1e9;

/** The sea's numbers. The tuples are the shader's vec4 uniforms, in order. */
export type OceanNumbers = {
  /** The swell's twelve phases, radians (`swellPhases`), zeros past the drawn count. */
  phases: Float32Array;
  /** The swell's components, (k0x, k0z, q0, a0) a component, twelve vec4s
   * (`oceanComponentsFor`): the `oceanK` uniforms, constant for the world. */
  components: Float32Array;
  /** The swell's unit direction of travel (x, z), its peak period (s) and its significant height (m). */
  swell: [number, number, number, number];
  /** The cove's two headland tips, (x0, z0, x1, z1); an absent one far inland (`OCEAN_NO_TIP`). */
  tips: [number, number, number, number];
  /** The coastline row's first z (m), its step (m), the swell components drawn, and the wind sea's mode (0 low, 1 loop, 2 FFT). */
  coast: [number, number, number, number];
  /** The wind sea's fully developed height (m), the loop's length scale, the loop's time (s), the whitecap coverage:
   * the sea's, at the speed it follows a minute behind its wind (`lagSeaWind`). */
  wind: [number, number, number, number];
  /** The wind sea's direction (x, z), its wind speed U10 (m/s), and the onshore weight (0 to 1). */
  windDir: [number, number, number, number];
  /** What the shaders normalise the drawn wind sea by: its height's standard
   * deviation (m) at the wind, fully developed, before its share near shore,
   * then each field's slope variance (the loop's alone, or the FFT's three
   * cascades'); zeros where none is drawn (`windSeaField.ts`). */
  windStats: [number, number, number, number];
  /** The point the wind sea's fields turn about as the wind turns, (x, z, 0, 0): the cove's waterline centre,
   * where the sea is seen up close, so nothing slides there (`oceanWindFrame`). */
  windPivot: [number, number, number, number];
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

/** The wind sea as it is drawn this frame, which whoever makes its field says (`windSeaField.ts`, as `lite/seaMeshes.ts` hands it on). */
export type WindSeaDrawn = {
  /** The sea's own state, at the speed it follows its wind. */
  sea: WindSeaState;
  /** 0: none drawn; 1: the loop; 2: the FFT. */
  mode: 0 | 1 | 2;
  /** The loop's time (s). */
  loopTime: number;
  /** `OceanNumbers.windStats`. */
  stats: readonly [number, number, number, number];
};

export type OceanFrame = {
  /** The swell the sea draws, the tier's count of its components. Its coastline row is the one `update` moves with the camera. */
  readonly field: OceanField;
  /** The numbers, written in place by `update`. */
  readonly numbers: OceanNumbers;
  /**
   * A frame: the camera's z, the shared seconds, the game's wind (0..1 and
   * the direction it blows toward) and the hour (0 to 24). `windSea` is
   * handed the wind sea's state for the wind as it blows now and says what
   * is drawn of it. True when the tables' coastline row was written again:
   * whoever holds the tables as a texture sends the row.
   */
  update(camZ: number, seconds: number, wind01: number, windDir: [number, number], hour: number, windSea: (blowing: WindSeaState) => WindSeaDrawn): boolean;
};

/**
 * The sea's waves for a world and a tier: the low tier draws the eight
 * largest of the swell's twelve components, the others all twelve. `made`
 * is the world's field for the tier made ahead (`preparedScene.ts`), taken
 * as the sea's own; absent or null, it is made here.
 */
export function createOceanFrame(seed: number, tier: QualityTier, made?: OceanField | null): OceanFrame {
  const field = made ?? oceanFieldFor(seed, tier === "low" ? SWELL_COMPONENTS_LOW : SWELL_COMPONENTS);
  const profiles = coastProfilesFor(seed);
  const { tables } = field;
  const cove = coveFor(seed);
  // The field's coastline row is about the cove's middle (`oceanFieldFor`):
  // the first update moves it to the camera if the camera is far from there.
  let coastCentreZ = cove.z0;
  // The wind sea's fields turn with the wind about the cove's waterline
  // centre, where the sea is seen up close, so nothing slides there.
  const numbers: OceanNumbers = {
    phases: new Float32Array(12),
    components: oceanComponentsFor(field.components),
    swell: [field.travel[0], field.travel[1], field.tp, field.hs],
    tips: oceanTipsFor(field.tips),
    coast: [tables.coastOriginZ, OCEAN_COAST_STEP, field.count, 0],
    wind: [0, 0, 0, 0],
    windDir: [1, 0, 0, 0],
    windStats: [0, 0, 0, 0],
    windPivot: [profiles.coastlineX(cove.z0), cove.z0, 0, 0],
  };
  return {
    field,
    numbers,
    update(camZ, seconds, wind01, windDir, hour, windSea) {
      let rowWritten = false;
      if (Math.abs(camZ - coastCentreZ) > OCEAN_COAST_RECENTRE) {
        coastCentreZ = camZ;
        writeCoastRow(tables, profiles, coastCentreZ);
        numbers.coast[0] = tables.coastOriginZ;
        rowWritten = true;
      }
      swellPhases(field, seconds, numbers.phases);
      const blowing = windSeaStateFor(wind01, windDir, hour);
      // The tier's wind sea: its field and mode, the loop's time (0 while no
      // loop is drawn) and the numbers the shaders normalise it by; and the
      // sea's own state, at the speed the sea follows, a minute behind its
      // wind's (`lagSeaWind`).
      const drawn = windSea(blowing);
      const sea = drawn.sea;
      // The fully developed height, uncut: `windSeaShare` takes the share of it that the fetch allows.
      numbers.wind[0] = sea.hs;
      numbers.wind[1] = sea.loopScale;
      numbers.wind[3] = sea.coverage;
      // The wind as it blows now: its direction turns the fields, and its
      // speed sets the roughness, whose short slopes follow it within seconds.
      numbers.windDir[0] = blowing.dir[0];
      numbers.windDir[1] = blowing.dir[1];
      numbers.windDir[2] = blowing.u10;
      numbers.windDir[3] = blowing.onshoreWeight;
      numbers.coast[3] = drawn.mode;
      numbers.wind[2] = drawn.loopTime;
      for (let i = 0; i < 4; i++) numbers.windStats[i] = drawn.stats[i] as number;
      return rowWritten;
    },
  };
}
