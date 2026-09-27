/**
 * The names the fingerposts give the places a trail leads to: every pond and
 * meadow the loops go round gets one, drawn by the world seed so every peer
 * reads the same signs. The draw has its own stream (`worldSeed ^
 * NAMES_SALT`), apart from the world's and the missing hiker's, so naming a
 * place moves no other draw.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { Feature } from "./features.js";
import { FIRST_NAMES } from "./hikerNames.js";
import { SUMMIT_LABEL } from "./signs.js";
import { nextRandom } from "./types.js";

export const NAMES_SALT = 0x504c4143;
/** Stands in a name for a first name, drawn when the name is. */
const FIRST = "<First>";

export const POND_NAMES: readonly string[] = [
  "Old Lake", "Mirror Pond", "Still Lake", "Black Tarn", "Hidden Lake", `${FIRST}'s Pond`,
];
export const MEADOW_NAMES: readonly string[] = [
  "High Meadow", "Bear Meadow", "Long Meadow", "Fern Meadow", "Deer Meadow", `${FIRST}'s Meadow`,
];

/**
 * A name for every pond and meadow in `features`, keyed by feature id, in the
 * features' own order. No name is used twice, and a "<First>'s" name never
 * takes the missing hiker's first name (nor one another place already has),
 * so the poster's name is never a place on the map.
 */
export function placeNames(worldSeed: number, features: readonly Feature[], hikerFirstName: string): Map<number, string> {
  const rng = { rngSeed: (worldSeed ^ NAMES_SALT) | 0 };
  const left = { pond: [...POND_NAMES], meadow: [...MEADOW_NAMES] };
  const firsts = FIRST_NAMES.filter((n) => n !== hikerFirstName);
  const out = new Map<number, string>();
  for (const f of features) {
    if (f.kind !== "pond" && f.kind !== "meadow") continue;
    const pool = left[f.kind];
    if (pool.length === 0) continue;
    let name = pool.splice(Math.floor(nextRandom(rng) * pool.length), 1)[0] as string;
    if (name.includes(FIRST)) {
      const first = firsts.splice(Math.floor(nextRandom(rng) * firsts.length), 1)[0] as string;
      name = name.replace(FIRST, first);
    }
    out.set(f.id, name);
  }
  return out;
}

export type PlaceSite = { name: string; x: number; z: number };

/**
 * The places the fingerposts name, besides the trailhead: "Summit" where the
 * body lies, and every named pond and meadow at its centre.
 */
export function signSites(
  worldSeed: number, features: readonly Feature[], hikerFirstName: string, summit: { x: number; z: number },
): PlaceSite[] {
  const names = placeNames(worldSeed, features, hikerFirstName);
  const sites: PlaceSite[] = [{ name: SUMMIT_LABEL, x: summit.x, z: summit.z }];
  for (const f of features) {
    const name = names.get(f.id);
    if (name !== undefined) sites.push({ name, x: f.x, z: f.z });
  }
  return sites;
}
