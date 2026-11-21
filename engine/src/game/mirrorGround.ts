/**
 * The ground as a lake's reflections draw it, with no engine: the terrain is
 * far too costly to draw again with its own material, so in the mirror and
 * in the shore's panorama it is one flat lit colour, darker under the
 * canopy, fogged as the scene fogs. The mirror and the panorama
 * (`lite/lakeMirror.ts`, `lite/lakePanorama.ts`) take the colour and the
 * shade from here.
 */
import { NEEDLE_BED } from "./terrainSurface.js";
import { ambientCollapseUnder, type WeatherParams } from "./weather.js";

/** How much darker the ground draws under a full canopy in a lake's reflections: `lakeMirrorTerrain.fragment.glsl`'s LAKE_MIRROR_CANOPY_SHADE. */
export const MIRROR_CANOPY_SHADE = 0.5;

/** The sky as the ground's colour in a lake's reflections reads it. */
export type MirrorGroundSky = {
  sunIntensity: number; sunDir: { y: number }; fillIntensity: number;
  sunColour: { r: number; g: number; b: number }; fillColour: { r: number; g: number; b: number };
};

/**
 * The colour the lake's reflections light their ground with (the terrain's
 * stand-in), into `out`: the forest floor's needle bed under the sun on
 * level ground and the fill, as the lighting sets them from `sky`, the fill
 * collapsing with the weather's dread as the lighting's does.
 */
export function mirrorGroundColour<T extends { r: number; g: number; b: number }>(sky: MirrorGroundSky, weather: WeatherParams, out: T): T {
  const sun = sky.sunIntensity * Math.max(0, sky.sunDir.y);
  const fill = sky.fillIntensity * ambientCollapseUnder(weather);
  out.r = NEEDLE_BED.r * (sky.sunColour.r * sun + sky.fillColour.r * fill);
  out.g = NEEDLE_BED.g * (sky.sunColour.g * sun + sky.fillColour.g * fill);
  out.b = NEEDLE_BED.b * (sky.sunColour.b * sun + sky.fillColour.b * fill);
  return out;
}
