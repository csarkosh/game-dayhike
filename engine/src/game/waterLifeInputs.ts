/**
 * What the lakes' life is handed a frame that is not its own to work out,
 * with no engine: the sky behind a swarm, a pixel's size at a metre, the
 * players by slots they keep, and the sound of a world with no such life.
 * Whoever steps the life (`waterLifeScene.ts`) fills its frame from these.
 */
import type { Vec3 } from "../sim/core.js";
import { luma } from "./colour.js";
import type { SkyState } from "./skyState.js";
import type { WaterLifeSound } from "./waterLifeAudio.js";

/** `value` and every object it holds, frozen. */
function frozenThrough<T extends object>(value: T): T {
  for (const held of Object.values(value)) if (typeof held === "object" && held !== null) frozenThrough(held);
  return Object.freeze(value);
}

/**
 * The sky behind a swarm seen level, 0 to 1, which the midges darken against
 * (`midgeLook.ts`): the luminance of the dome's horizon away from the sun
 * (`SkyState.horizonAway`), the side where a speck reads dark rather than
 * glinting. It is in the scene's adapted units with the cloud deck and the
 * night's floor already in it: 0.03 at night, 0.25 a quarter hour after
 * sunset, 0.53 at sunrise and sunset, 0.71 at clear noon, held at 1 in a clear
 * late afternoon (1.22 at 17:00). 0 before the sky's first slices.
 */
export function skyLumaOf(sky: SkyState | null): number {
  return sky === null ? 0 : Math.min(1, luma(sky.horizonAway));
}

/** The world size of one pixel a metre from the lens: the view's height at a
 * metre, `2·tan(fov / 2)`, over the render's height in pixels. */
export function pixelAtOneMetre(fov: number, renderHeight: number): number {
  return (2 * Math.tan(fov / 2)) / Math.max(1, renderHeight);
}

/** What a world without the lake's life sounds like, and a frame that did
 * not step it: nothing. Frozen through, as every caller is handed this one
 * object. */
export const SILENT_WATER_LIFE: WaterLifeSound = frozenThrough({
  hums: [], hums_n: 0, pitch: 0, rustles: [], frogCalls: [],
  bed: { level: 0, duck: [1, 1], points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }] },
});

/** A player's position in their slot: the sim's own, y the body's centre. */
export type SlotPoint = { x: number; y: number; z: number };

export type PlayerSlots = {
  /**
   * Seats `players` and returns each slot's player's position, undefined for
   * an empty slot: one array, refilled in place by every call.
   */
  fill(players: ReadonlyMap<number, { readonly id: number; readonly pos: Vec3 }>): readonly (SlotPoint | undefined)[];
};

/**
 * `count` slots the players keep for as long as they are in the world, for
 * the lake's life, which keeps a head swarm and a speed by index: a list
 * rebuilt in the Map's order would close up when a player leaves and hand
 * theirs to the next. A player who leaves frees their slot; one who joins
 * takes the lowest slot free before this call, never one it freed, so a slot
 * stands empty for a frame between two players. Players past the last slot go
 * without. Allocates nothing per call beyond the Map's iterator.
 */
export function createPlayerSlots(count: number): PlayerSlots {
  const ids: number[] = new Array<number>(count).fill(0);
  const taken: boolean[] = new Array<boolean>(count).fill(false);
  const freed: boolean[] = new Array<boolean>(count).fill(false);
  const points: SlotPoint[] = [];
  for (let s = 0; s < count; s++) points.push({ x: 0, y: 0, z: 0 });
  const out: (SlotPoint | undefined)[] = new Array<SlotPoint | undefined>(count).fill(undefined);
  return {
    fill(players) {
      for (let s = 0; s < count; s++) {
        freed[s] = false;
        if (taken[s] && !players.has(ids[s]!)) {
          taken[s] = false;
          freed[s] = true;
          out[s] = undefined;
        }
      }
      for (const p of players.values()) {
        let at = -1;
        for (let s = 0; s < count; s++) {
          if (taken[s] && ids[s] === p.id) {
            at = s;
            break;
          }
        }
        if (at < 0) {
          for (let s = 0; s < count; s++) {
            if (!taken[s] && !freed[s]) {
              at = s;
              break;
            }
          }
          if (at < 0) continue;
          taken[at] = true;
          ids[at] = p.id;
        }
        const q = points[at]!;
        q.x = p.pos.x;
        q.y = p.pos.y;
        q.z = p.pos.z;
        out[at] = q;
      }
      return out;
    },
  };
}
