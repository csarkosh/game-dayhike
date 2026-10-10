/**
 * Which lake the renderer serves, Babylon-free (spec §10.3). A world has up
 * to four lakes; the mirror (high) and the panorama (medium) are one each and
 * serve the nearest lake by the camera's ground distance past its bound,
 * moving to another only once it is LAKE_RETARGET_LEAD nearer, so a camera
 * between two never flaps them. Each lake's life runs while the camera
 * stands within LAKE_LIFE_REACH past its bound. Made once for a world's
 * lakes: every call reads and writes records made then, and allocates
 * nothing.
 */

/** How much nearer (m) another lake must be before the served lake moves to it. */
export const LAKE_RETARGET_LEAD = 20;
/** How far past a lake's bound (m) the camera may stand with its life running. */
export const LAKE_LIFE_REACH = 250;

/** A lake as the choice reads it: its index in the world's list, its centre and its bound. */
export type LakeRecord = { readonly index: number; readonly x: number; readonly z: number; readonly bound: number };

export type LakeChoice = {
  /** The lakes' records, in the world's order: the objects `choose` returns. */
  readonly lakes: readonly LakeRecord[];
  /** Whether each lake's life runs, by index, as the last `choose` left it: 1 within LAKE_LIFE_REACH past its bound. */
  readonly live: Uint8Array;
  /** The lake served for a camera at (x, z): the one served before unless another is LAKE_RETARGET_LEAD nearer; null in a world with none. Fills `live`. */
  choose(x: number, z: number): LakeRecord | null;
};

export function createLakeChoice(lakes: readonly { x: number; z: number; bound: number }[]): LakeChoice {
  const records: LakeRecord[] = lakes.map((l, index) => ({ index, x: l.x, z: l.z, bound: l.bound }));
  const live = new Uint8Array(records.length);
  const away = new Float64Array(records.length);
  let served = -1;
  return {
    lakes: records,
    live,
    choose(x, z) {
      let nearest = -1;
      for (let i = 0; i < records.length; i++) {
        const r = records[i] as LakeRecord;
        const d = Math.max(0, Math.hypot(x - r.x, z - r.z) - r.bound);
        away[i] = d;
        live[i] = d <= LAKE_LIFE_REACH ? 1 : 0;
        if (nearest < 0 || d < (away[nearest] as number)) nearest = i;
      }
      if (nearest < 0) return null;
      if (served < 0 || (away[nearest] as number) <= (away[served] as number) - LAKE_RETARGET_LEAD) served = nearest;
      return records[served] as LakeRecord;
    },
  };
}
