/**
 * The cover map with no engine: what a registered mesh is to the rain and
 * what its texel holds, the colour the map is cleared to, the camera that
 * looks straight down on it, and where it stands and when it is drawn again.
 * `rainParams.ts` has the map's constants and the step rule; a shell that
 * draws the map (`rainMap.ts` on Babylon.js) takes every value from here.
 *
 * Renderer-only by design, as `rainParams.ts` is: nothing here may migrate
 * into sim/ or a tunables registry.
 */
import { RAIN_MAP, mapCentre, type Vec3 } from "./rainParams.js";

/** What a registered mesh is to the rain: ground that may carry canopy, a
 * roof that stops it, or a surface it lands on and falls through. */
export type RainMapKind = "terrain" | "hard" | "water";

/** The clear colour: a height far below any world, open to the rain. */
export const RAIN_MAP_CLEAR = { height: -1000, transmission: 1, lift: 0 } as const;

/**
 * A texel as a mesh of `kind` writes it: the surface's world height, its
 * transmission and its ceiling's lift. Ground under a canopy of `canopy`
 * (the terrain's per-vertex density, 0 to 1) lets through
 * `1 - canopyBlock × canopy` and lifts its ceiling `canopyLift` metres where
 * there is any canopy at all; water is open; anything else stops the rain.
 * The height shader's fragment, mirrored.
 */
export function rainMapTexel(kind: RainMapKind, height: number, canopy = 0): { height: number; transmission: number; lift: number } {
  if (kind === "terrain") return { height, transmission: 1 - RAIN_MAP.canopyBlock * canopy, lift: canopy >= 0.01 ? RAIN_MAP.canopyLift : 0 };
  return { height, transmission: kind === "water" ? 1 : 0, lift: 0 };
}

/**
 * The map's camera: orthographic over the map's extent, `height` above its
 * centre and looking straight down as far below it, so the view's x is the
 * world's x and its y the world's z, and the picture's u runs along x and
 * its v along z.
 */
export const RAIN_MAP_CAMERA = { half: RAIN_MAP.extent / 2, near: 1, far: 2 * RAIN_MAP.height, height: RAIN_MAP.height } as const;

/** Where the map stands, and whether it is to be drawn again. */
export type RainMapPlace = {
  /** The centre the map was last drawn at (NaN before the first `update`). */
  readonly centre: Readonly<Vec3>;
  /** Moves the map to `player` by the step rule (`mapCentre`); true when it did, or when a `redraw` was asked for:
   * the map is to be drawn again. The first update places it. */
  update(player: Vec3): boolean;
  /** The next `update` draws the map again where it stands, moved or not. */
  redraw(): void;
};

/** A map not yet placed. */
export function createRainMapPlace(): RainMapPlace {
  const centre: Vec3 = { x: Number.NaN, y: Number.NaN, z: Number.NaN };
  const next: Vec3 = { x: 0, y: 0, z: 0 };
  /** Set by `redraw`: the next `update` draws the map though it has not moved. */
  let stale = false;
  return {
    centre,
    update(player) {
      if (Number.isNaN(centre.x)) {
        next.x = player.x;
        next.y = player.y;
        next.z = player.z;
      } else {
        mapCentre(centre, player, next);
        if (next.x === centre.x && next.z === centre.z && !stale) return false;
      }
      stale = false;
      centre.x = next.x;
      centre.y = next.y;
      centre.z = next.z;
      return true;
    },
    redraw() {
      stale = true;
    },
  };
}
