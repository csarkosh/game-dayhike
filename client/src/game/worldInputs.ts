/**
 * The two things a hike's world is made from, read off its address: the seed
 * and the terrain. One rule, so the world's worker (`worldPrep.ts`), started
 * before the game is, prepares the world the build then makes.
 */
import "../sim/passes/index.js";
import { DEFAULT_TERRAIN_VARIANT, terrainVariantNames } from "../sim/terrain.js";
import { registerTerrainVariants } from "./commands.js";
import { lastEntry, parseScript, splitEntries } from "./script.js";
import { seedFromToken } from "./seed.js";

/**
 * The seed and the terrain variant of the hike at `token` whose address has
 * the query `search`. The seed is the script's (`?cmd=`) last `seed` entry,
 * else the token's: a later entry wins, so `seed a;seed b` is `b`, the one
 * entry a write-back would leave in the address. The terrain is its last
 * `terrain` entry where the sim has a variant of that name, else the default:
 * a name it does not have (an address edited by hand) is the default, not a
 * failure. The command layer is told the sim's variants first, since the
 * script drops an entry it cannot validate and a page that has parsed nothing
 * yet knows no terrain.
 */
export function worldInputs(token: string, search: string): { seed: number; variant: string } {
  registerTerrainVariants(terrainVariantNames());
  const { entries } = parseScript(new URLSearchParams(search).get("cmd") ?? "");
  const { world } = splitEntries(entries);
  const seedEntry = lastEntry(world, "seed");
  const requested = lastEntry(world, "terrain")?.args[0];
  return {
    seed: seedFromToken(seedEntry ? (seedEntry.args[0] as string) : token),
    variant: requested !== undefined && terrainVariantNames().includes(requested) ? requested : DEFAULT_TERRAIN_VARIANT,
  };
}
