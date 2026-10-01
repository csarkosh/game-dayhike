import "../../../src/sim/olympic.js";
import { bowlFor } from "../../../src/sim/olympic.js";
import type { Feature } from "../../../src/sim/features.js";
import { LOBBY_SEEDS } from "../trailGateSeeds.js";

/** The first lobby world with a pond `pred` accepts, and the pond. Each world
 * tried is a bowl build (about half a second), so call it inside a test. */
export function firstPondWorld(pred: (f: Feature) => boolean = () => true): { seed: number; pond: Feature } {
  for (const seed of LOBBY_SEEDS) {
    const pond = bowlFor(seed).features.find((f) => f.kind === "pond" && pred(f));
    if (pond !== undefined) return { seed, pond };
  }
  throw new Error("no such pond in the lobby worlds");
}
