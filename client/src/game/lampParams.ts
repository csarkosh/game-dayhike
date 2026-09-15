import { mixRgb, type Rgb } from "./colour.js";
import { dreadLensUnder, dreadWorldUnder, type WeatherParams } from "./weather.js";

/**
 * The tuned lamp, in Babylon's light units against a sun of ~4 at noon: 400
 * lifts the dusk bed from 28 to 110 (8-bit luminance) with the forest and
 * far trail untouched; 150 barely read and 1000 was a searchlight. Lives here
 * rather than in headlamp.ts so this module stays Babylon-free; headlamp.ts
 * re-exports both.
 */
export const LAMP_INTENSITY = 400;
export const LAMP_COLOUR: readonly [number, number, number] = [1.0, 0.92, 0.78];

/**
 * How the headlamp misbehaves under dread: dimmer and dirtier on the top
 * plateau, with sparse flicker bursts driven by the lens dread. Pure and
 * Babylon-free (`headlamp.ts` re-exports only numbers); `setLamp` applies
 * it. Exact at `clear`: full intensity, the tuned colour, no flicker.
 *
 * The flicker is a hashed telegraph signal, not noise: time is cut into
 * LAMP_FLICKER_CELL-second cells, each cell draws one hashed value, and a
 * cell is a burst when that value falls under LAMP_FLICKER_CHANCE × dread.
 * Bursts are therefore rare, discrete events with a random depth, which is
 * what keeps a flicker an event rather than a hum (Amnesia: The Bunker's
 * lights, Thomas Grip's rule that a frequent cue becomes a rule).
 */

export type LampState = { intensity: number; colour: Rgb };

/** Intensity lost on the top dread plateau. */
export const LAMP_DREAD_DIM = 0.4;
/** Dirty tungsten the lamp colour is pulled to on the top plateau. */
export const LAMP_DREAD_TINT: Rgb = { r: 1.0, g: 0.72, b: 0.42 };
/** Seconds per flicker cell. */
export const LAMP_FLICKER_CELL = 0.125;
/** Probability that a cell is a burst at full lens dread. */
export const LAMP_FLICKER_CHANCE = 0.14;
/** Largest fraction of intensity a burst removes. */
export const LAMP_FLICKER_DEPTH = 0.55;

/** The lamp as tuned, before any dread. */
export const LAMP_DEFAULT: LampState = Object.freeze({
  intensity: LAMP_INTENSITY,
  colour: Object.freeze({ r: LAMP_COLOUR[0], g: LAMP_COLOUR[1], b: LAMP_COLOUR[2] }),
});

/** A hash of an integer cell to [0, 1). Trigonometry is fine here: this is renderer-only. */
function cellHash(cell: number, salt: number): number {
  const x = Math.sin(cell * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The flicker multiplier at time `t` for a lens dread in [0, 1]: exactly 1
 * outside a burst (and always at dread 0), otherwise 1 minus a random depth
 * up to LAMP_FLICKER_DEPTH.
 */
export function lampFlicker(t: number, dread: number): number {
  if (dread <= 0) return 1;
  const cell = Math.floor(t / LAMP_FLICKER_CELL);
  if (cellHash(cell, 1) >= LAMP_FLICKER_CHANCE * dread) return 1;
  return 1 - LAMP_FLICKER_DEPTH * cellHash(cell, 2);
}

export function lampUnder(w: WeatherParams, t: number): LampState {
  const world = dreadWorldUnder(w);
  const lens = dreadLensUnder(w);
  if (world === 0 && lens === 0) return LAMP_DEFAULT;
  return {
    intensity: LAMP_INTENSITY * (1 - LAMP_DREAD_DIM * world) * lampFlicker(t, lens),
    colour: mixRgb(LAMP_DEFAULT.colour, LAMP_DREAD_TINT, world),
  };
}
