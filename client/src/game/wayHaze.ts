/**
 * The chase's haze (docs/gameplay/2026-11-13-the-way-down.md) on the tiers
 * with no post chain (phones): the woods above the way's mist stand in a
 * haze of the mist's own colour, so the trunks and the crowd fall away into
 * it as they do on the tiers that march the night's ground mist through the
 * whole frame. It is drawn by no pass and no mesh. Every material on these
 * tiers already draws the air between the eye and itself
 * (`shaders/atmosphere/fog.wgsl`); this moves that air's numbers while the
 * way's mist is up: how thick it is, and the colour it shows. Computed with
 * no engine; the renderer applies it to the air's record a frame.
 */
import type { AtmosphereUniforms } from "@csarkosh/engine/game/atmosphereParams";

/**
 * The air's density when the way's mist is whole (by the fog's factor a
 * trunk 40 m off keeps about three fifths of itself and one 100 m off
 * almost none), and the haze's colour as a share of
 * the way's own mist's, so the mist on the ground is the thicker, paler
 * part of one air.
 */
export const WAY_HAZE_DENSITY = 0.012;
export const WAY_HAZE_SHARE = 0.82;

/**
 * The air (`air`, as the frame's weather and sky set it) under the way's
 * mist at `level` (0 none, 1 whole): its density toward WAY_HAZE_DENSITY,
 * never under the weather's own, and its colours (the gradient's far end
 * and the glow toward the sun) toward WAY_HAZE_SHARE of the way's mist's
 * colour (`mist`, wayLightGeometry.ts `wayTint` on the material path). At no
 * level nothing is changed. Writes `air` in place and returns it.
 */
export function wayHazeInto(air: AtmosphereUniforms, level: number, mist: readonly [number, number, number]): AtmosphereUniforms {
  if (level <= 0) return air;
  const share = level >= 1 ? 1 : level;
  const density = air.atmBaseDensity[0];
  if (density < WAY_HAZE_DENSITY) air.atmBaseDensity[0] = density + (WAY_HAZE_DENSITY - density) * share;
  for (let i = 0; i < 3; i++) {
    const to = (mist[i] as number) * WAY_HAZE_SHARE;
    air.atmFarColour[i] = (air.atmFarColour[i] as number) + (to - (air.atmFarColour[i] as number)) * share;
    air.atmSunColour[i] = (air.atmSunColour[i] as number) + (to - (air.atmSunColour[i] as number)) * share;
  }
  return air;
}
