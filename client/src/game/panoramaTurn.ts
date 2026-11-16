/**
 * The shore panorama's numbers and its turn, with no engine: the picture's
 * size and its sectors, the eye's height and the reach of the picture up the
 * lake's cylinder, the frustum a sector is seen through, which way a sector
 * faces, the turn (which sector a frame draws, and how many are left of the
 * capture running) and when a capture is asked for. The shell on Babylon.js
 * (`lakePanorama.ts`, and the renderer that arms it) takes its values from
 * here; the ground in the picture is the mirror's stand-in
 * (`mirrorGround.ts`).
 */
import { SKYLINE_EYE_UP } from "./lakeSkyline.js";

export const PANORAMA_WIDTH = 1024, PANORAMA_HEIGHT = 128, PANORAMA_SECTORS = 16;
/** A sector's column of the picture, texels across. */
export const PANORAMA_SECTOR_WIDTH = PANORAMA_WIDTH / PANORAMA_SECTORS;
/** The capture's eye over the level (m): the skyline's own, so the panorama
 * and the skyline that masks it see the shore from one place. */
export const PANORAMA_EYE_UP = SKYLINE_EYE_UP;
/**
 * The height over the level the capture reaches on the cylinder of the
 * lake's radius (m): the texture's v is a hit's height over this. It holds
 * the tallest giant (17.18 m model × GIANT_SCALE_MAX 4.1 = 70.4 m) standing
 * at the forest's edge 8 m past the rim of the smallest lake (25 m), on
 * ground 8 m over the level: seen from the eye 0.4 m up, its crown crosses
 * the cylinder at 0.4 + 25 × (70.4 + 8 − 0.4) / 33 = 59.5 m. Anything taller
 * clamps to the top row, the crowns.
 */
export const PANORAMA_HEIGHT_M = 64;
/** The capture camera's near and far planes (m): nothing it draws stands
 * within half a metre of the lake's centre, and the forest's impostors reach
 * 2 km. */
export const PANORAMA_NEAR = 0.5, PANORAMA_FAR = 2500;

/** A sector's frustum as its projection's three terms: the focal term across, the focal term up, and the shift up. */
export type PanoramaFrustum = { across: number; up: number; shift: number };

/**
 * The frustum a sector of a lake of `radius` is seen through, into `out`: a
 * sector's turn across, tan(π / PANORAMA_SECTORS) either side, and from the
 * level to PANORAMA_HEIGHT_M over it on the cylinder of the lake's radius,
 * seen from PANORAMA_EYE_UP over the level. The frustum is shifted up rather
 * than tilted, so the picture's rows run linearly with height on the
 * cylinder.
 */
export function panoramaFrustum(radius: number, out: PanoramaFrustum): PanoramaFrustum {
  out.across = 1 / Math.tan(Math.PI / PANORAMA_SECTORS);
  // The tangents of the frustum's lowest and highest elevations.
  const bottom = -PANORAMA_EYE_UP / radius;
  const top = (PANORAMA_HEIGHT_M - PANORAMA_EYE_UP) / radius;
  out.up = 2 / (top - bottom);
  out.shift = -(top + bottom) / (top - bottom);
  return out;
}

/** The yaw of sector `sector`'s middle (rad): 0 faces +z, a quarter turn +x. */
export function sectorYaw(sector: number): number {
  return ((sector + 0.5) * 2 * Math.PI) / PANORAMA_SECTORS;
}

/** What a frame does of the turn: nothing (no capture runs), a hold (one runs, and its target cannot draw yet), or a sector. */
export const TURN_IDLE = -1, TURN_HOLD = -2;

/**
 * The turn: the sector the next draw is of, and how many are still to draw in
 * the capture running. The strip holds a whole turn when the count runs out:
 * a rearm gives sixteen more from the current sector, so one that lands
 * mid-capture continues the turn rather than restarting it, and every column
 * is at most sixteen frames old however often it is asked for.
 */
export type PanoramaTurn = {
  /** Asks for a whole turn from the sector next due. */
  rearm(): void;
  /** A frame: the sector it draws, TURN_HOLD while a capture runs and `ready` says its target cannot draw, TURN_IDLE with none running. */
  step(ready: boolean): number;
  /** Sectors still to draw in the capture running. */
  readonly remaining: number;
  /** Ends the capture running; a rearm after it asks for nothing. */
  end(): void;
};

export function createPanoramaTurn(): PanoramaTurn {
  let sector = 0;
  let remaining = 0;
  let ended = false;
  return {
    rearm() {
      if (!ended) remaining = PANORAMA_SECTORS;
    },
    step(ready) {
      if (remaining <= 0) return TURN_IDLE;
      if (!ready) return TURN_HOLD;
      const drawn = sector;
      sector = (sector + 1) % PANORAMA_SECTORS;
      remaining--;
      return drawn;
    },
    get remaining() {
      return remaining;
    },
    end() {
      ended = true;
      remaining = 0;
    },
  };
}

/**
 * When a capture is asked for: whenever the light hands over a new sky state
 * (the sky's image is taken again with it), and once what the picture draws
 * can draw after any of it landed late (at first, the forest's first fill
 * settling, a billboard or a cliff bucket joining the list).
 */
export type PanoramaArming<Sky> = {
  /** Something the picture draws has landed: a capture is owed once the target is ready. */
  landed(): void;
  /** Whether a capture is owed and the caller is to ask whether the target is ready. */
  readonly pending: boolean;
  /** A frame under `sky` (null before the first), with the target `ready` or not: whether to rearm the turn. */
  step(sky: Sky | null, ready: boolean): boolean;
};

export function createPanoramaArming<Sky>(): PanoramaArming<Sky> {
  let seen: Sky | null = null;
  let pending = true;
  return {
    landed() {
      pending = true;
    },
    get pending() {
      return pending;
    },
    step(sky, ready) {
      const skyMoved = sky !== null && sky !== seen;
      if (skyMoved) seen = sky;
      const nowReady = pending && ready;
      if (nowReady) pending = false;
      return skyMoved || nowReady;
    },
  };
}
