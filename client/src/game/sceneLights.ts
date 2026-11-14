/**
 * The scene's light as numbers, for a sky state (an hour under a weather,
 * `skyStateFor`) and that weather: the sun's direction, colour and
 * intensity and how dark its shadows are, the hemisphere fill's colours and
 * intensity, the image-based light's intensity, and the colour of the air
 * the fog and the cleared frame take. `lighting.ts` sets Babylon's lights,
 * fog and environment from these; this module loads no Babylon.
 */
import type { Rgb } from "./colour.js";
import type { Vec3 } from "./sky.js";
import { SKY_IBL_SCALE, type SkyState } from "./skyState.js";
import { ambientCollapseUnder, shadowDarknessUnder, type WeatherParams } from "./weather.js";

/**
 * The least of the sun's light a cast shadow keeps: the shadow generator's
 * darkness (0 a black shadow, 1 none) never falls under this. With the
 * weather's own darkness at 0 under a clear sky, a shadowed face had only the
 * sky's light, and on the steep faces the shadows of the relief's joints
 * and slabs read as noise. Measured from the sky state, the image-based light
 * as the dome's irradiance over π and the sun as PBR's diffuse, a face
 * leaning 55° toward the sun, shadowed, kept 34 %, 36 % and 32 % of its lit
 * value at 08:00, noon and 15:00, and level ground 35 %, 25 % and 29 %; at
 * 0.17 the face keeps 45 %, 47 % and 43 %, the ground 46 %, 38 % and 41 %.
 * It is the generator's, so it holds for every receiver, not the faces
 * alone. Cloud lightens the shadows already: bright weather's 0.45 is above
 * it and keeps its own, as does every weather past it.
 */
export const SHADOW_FLOOR = 0.17;

/** The shadow generator's darkness under `w`: the weather's, held at
 * SHADOW_FLOOR or above. */
export function sunShadowDarkness(w: WeatherParams): number {
  return Math.max(SHADOW_FLOOR, shadowDarknessUnder(w));
}

/** The fill's light from below: none. The fill is the sky's light alone. */
export const FILL_GROUND: Readonly<Rgb> = Object.freeze({ r: 0, g: 0, b: 0 });
/** The fill's highlight colour: white, whatever the sky's colour. */
export const FILL_SPECULAR: Readonly<Rgb> = Object.freeze({ r: 1, g: 1, b: 1 });

export type SceneLights = {
  /** The sun, a directional light. */
  sun: {
    /** The direction its light travels: away from the sun (`sunTravel`). */
    direction: Vec3;
    /** Its colour, luma 1, diffuse and highlight alike. */
    colour: Rgb;
    intensity: number;
    /** How much of the sun's light a cast shadow keeps: 0 a black shadow, 1 none (`sunShadowDarkness`). */
    shadowDarkness: number;
  };
  /** The fill, a hemispheric light: the sky's light on level ground by day and moonlight by night. */
  fill: {
    /** Toward the sky: straight up. */
    direction: Vec3;
    /** The light from the sky's side. */
    colour: Rgb;
    /** The light from the ground's side (`FILL_GROUND`). */
    groundColour: Rgb;
    /** The highlight's colour (`FILL_SPECULAR`). */
    specular: Rgb;
    /** The sky state's, times what the dread leaves of the ambient light. */
    intensity: number;
  };
  /** The image-based light's intensity (the dome's capture): it collapses with the fill. */
  environmentIntensity: number;
  /** The fog's colour and the cleared frame's: the air over the horizon away from the sun, under the weather's mist. */
  air: Rgb;
};

/**
 * The direction the sun's light travels for a direction toward the sun: its
 * negation. A directional light is aimed along the way its light goes;
 * backwards, the world is lit from underground at noon. Fills and returns
 * `out` (a vector of its own when none is given).
 */
export function sunTravel(toSun: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  out.x = -toSun.x;
  out.y = -toSun.y;
  out.z = -toSun.z;
  return out;
}

/** The scene's light under `w` for the sky state `sky` (made under the same weather). */
export function sceneLightsUnder(w: WeatherParams, sky: SkyState): SceneLights {
  // The dread's collapse of the ambient light takes the fill and the probe's
  // share together, so the top plateau reads as the light going, not the
  // fill alone dimming.
  const collapse = ambientCollapseUnder(w);
  return {
    sun: {
      direction: sunTravel(sky.sunDir),
      colour: { r: sky.sunColour.r, g: sky.sunColour.g, b: sky.sunColour.b },
      intensity: sky.sunIntensity,
      shadowDarkness: sunShadowDarkness(w),
    },
    fill: {
      direction: { x: 0, y: 1, z: 0 },
      colour: { r: sky.fillColour.r, g: sky.fillColour.g, b: sky.fillColour.b },
      groundColour: { ...FILL_GROUND },
      specular: { ...FILL_SPECULAR },
      intensity: sky.fillIntensity * collapse,
    },
    environmentIntensity: collapse * SKY_IBL_SCALE,
    air: { r: sky.mistAir.r, g: sky.mistAir.g, b: sky.mistAir.b },
  };
}
