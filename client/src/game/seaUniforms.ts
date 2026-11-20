/**
 * The sea's uniforms by the names its shaders read them under, with no
 * engine, for the sea's plugin, which binds uniforms by name
 * (`lite/seaPlugin.ts`), from the records the game computes
 * (`OceanNumbers`, `WaterSurface`).
 *
 * Two records. What is the world's and the bed's (`SeaUniforms`): the
 * level, the water's colour, the bed's square, the swell's direction,
 * period and height, the headlands' tips, the cove, the wind sea's pivot
 * and the swell's components; it moves only when the bed's square does. And
 * what moves with the frame (`SeaFrameUniforms`): the swell's phases, the
 * coastline row's place and the wind sea's mode, the wind sea's numbers, the
 * clock, the wind's direction integrated over the run, how far the ripple
 * bump has slid under the low tier's sea, and where each ring of the
 * lattice stands (`seaLattice.ts`).
 */
import type { OceanNumbers } from "./oceanFrame.js";
import { SEA_RING_FLOATS } from "@csarkosh/engine/game/seaLattice";
import { WATER_RING_COUNT } from "@csarkosh/engine/game/water";
import type { BumpDrift, WaterSurface } from "@csarkosh/engine/game/waterSurface";

/** The vec4s of the swell's components (`oceanK`). */
export const SEA_COMPONENT_VECS = 12;

/** What the sea's material reads that is the world's own. */
export type SeaUniforms = {
  waterLevel: Float32Array;
  waterKd: Float32Array;
  waterBed: Float32Array;
  waterBedTexels: Float32Array;
  waterSkin: Float32Array;
  oceanSwell: Float32Array;
  oceanTips: Float32Array;
  oceanWindPivot: Float32Array;
  oceanCove: Float32Array;
  /** The swell's components, `SEA_COMPONENT_VECS` vec4s. */
  oceanK: Float32Array;
};

/** The sea's own uniforms, zeros. */
export function emptySeaUniforms(): SeaUniforms {
  const f = (n: number): Float32Array => new Float32Array(n);
  return {
    waterLevel: f(1), waterKd: f(3), waterBed: f(4), waterBedTexels: f(1), waterSkin: f(2), oceanSwell: f(4), oceanTips: f(4), oceanWindPivot: f(4),
    oceanCove: f(4), oceanK: f(SEA_COMPONENT_VECS * 4),
  };
}

/**
 * Fills `out` from the sea's `surface` at `level` and its `ocean`. Returns
 * whether any value moved: a material whose uniforms stand as they were is
 * not written again.
 */
export function seaUniforms(surface: WaterSurface, level: number, ocean: OceanNumbers, out: SeaUniforms): boolean {
  let moved = false;
  const put = (to: Float32Array, at: number, value: number): void => {
    const next = Math.fround(value);
    if (to[at] !== next) {
      to[at] = next;
      moved = true;
    }
  };
  const extent = surface.bedTexels * surface.bedSpacing;
  put(out.waterLevel, 0, level);
  for (let i = 0; i < 3; i++) put(out.waterKd, i, surface.row.kd[i] as number);
  put(out.waterBed, 0, surface.bedOrigin[0]);
  put(out.waterBed, 1, surface.bedOrigin[1]);
  put(out.waterBed, 2, 1 / extent);
  put(out.waterBed, 3, surface.bedSpacing);
  put(out.waterBedTexels, 0, surface.bedTexels);
  put(out.waterSkin, 0, surface.skin[0]);
  put(out.waterSkin, 1, surface.skin[1]);
  for (let i = 0; i < 4; i++) {
    put(out.oceanSwell, i, ocean.swell[i] as number);
    put(out.oceanTips, i, ocean.tips[i] as number);
    put(out.oceanWindPivot, i, ocean.windPivot[i] as number);
    put(out.oceanCove, i, surface.cove[i] as number);
  }
  for (let i = 0; i < out.oceanK.length; i++) put(out.oceanK, i, ocean.components[i] as number);
  return moved;
}

/** What the sea's material reads that moves with the frame. */
export type SeaFrameUniforms = {
  oceanPhase0: Float32Array;
  oceanPhase1: Float32Array;
  oceanPhase2: Float32Array;
  oceanCoast: Float32Array;
  oceanWind: Float32Array;
  oceanWindDir: Float32Array;
  oceanWindStats: Float32Array;
  /** The sea's clock, seconds (`waterTime` on the sea's material). */
  seaTime: Float32Array;
  /** The wind's direction integrated over the run, seconds (`waterWindTime` on the sea's material). */
  seaWindTime: Float32Array;
  /** How far the ripple bump has slid under the low tier's sea, tiles. */
  seaBumpOffset: Float32Array;
  /** Each ring's origin and hole (`seaRingRecords`), a vec4 a ring. */
  seaRings: Float32Array;
};

/** The sea's frame uniforms, zeros. */
export function emptySeaFrameUniforms(): SeaFrameUniforms {
  const f = (n: number): Float32Array => new Float32Array(n);
  return {
    oceanPhase0: f(4), oceanPhase1: f(4), oceanPhase2: f(4), oceanCoast: f(4), oceanWind: f(4), oceanWindDir: f(4), oceanWindStats: f(4),
    seaTime: f(1), seaWindTime: f(2), seaBumpOffset: f(2), seaRings: f(WATER_RING_COUNT * SEA_RING_FLOATS),
  };
}

/**
 * Fills `out` from the sea's `ocean`, its `surface` and the bump's `drift`.
 * The rings' records are `out.seaRings`, which whoever moves the rings
 * writes in place.
 */
export function seaFrameUniforms(ocean: OceanNumbers, surface: WaterSurface, drift: BumpDrift, out: SeaFrameUniforms): SeaFrameUniforms {
  for (let i = 0; i < 4; i++) {
    out.oceanPhase0[i] = ocean.phases[i] as number;
    out.oceanPhase1[i] = ocean.phases[4 + i] as number;
    out.oceanPhase2[i] = ocean.phases[8 + i] as number;
    out.oceanCoast[i] = ocean.coast[i] as number;
    out.oceanWind[i] = ocean.wind[i] as number;
    out.oceanWindDir[i] = ocean.windDir[i] as number;
    out.oceanWindStats[i] = ocean.windStats[i] as number;
  }
  out.seaTime[0] = surface.time;
  out.seaWindTime[0] = surface.windTime[0];
  out.seaWindTime[1] = surface.windTime[1];
  out.seaBumpOffset[0] = drift.sea[0];
  out.seaBumpOffset[1] = drift.sea[1];
  return out;
}
