import { expect } from "vitest";
import "../../src/sim/passes/index.js";
import { seedFromToken } from "../../src/game/seed.js";
import { createForest } from "../../src/sim/forest.js";
import { elevationAt } from "../../src/sim/terrain.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import type { World } from "../../src/sim/world.js";
import { isOnCorridor } from "../../src/sim/containment.js";
import { ENEMY_HALF, PLAYER_HALF, TICK_DT } from "../../src/sim/constants.js";
import { HOLLOW_HUNT_SPEED, hollowsOf, spawnHollow } from "../../src/sim/hollow.js";
import { Phase } from "../../src/sim/types.js";
import { seedPart } from "../helpers/seedPart.js";

/**
 * Where the trail crosses the treeline: the point on the stem nearest the pad,
 * measured along the trail, that is clear of the road corridor.
 *
 * A point, sampled every half metre along the stem's edges, not one of its
 * nodes. The nodes are far too coarse a stand-in — on `hollow29` the first stem
 * node clear of the corridor is 304 m up a 397 m stem, while the trail itself
 * leaves the corridor at 84 m.
 */
function treeline(world: World): { x: number; z: number; home: number } | null {
  const g = world.trail;
  if (g === null) return null;
  for (const ei of g.stem) {
    const e = g.edges[ei] as (typeof g.edges)[number];
    const homeA = g.homeDist[e.a] as number;
    const homeB = g.homeDist[e.b] as number;
    // Pad-side end first: `stem` is ordered pad → crest, but an edge's own a/b
    // need not be, and the home distance says which end is which.
    const [from, to, home] =
      homeA <= homeB
        ? [g.nodes[e.a] as (typeof g.nodes)[number], g.nodes[e.b] as (typeof g.nodes)[number], homeA]
        : [g.nodes[e.b] as (typeof g.nodes)[number], g.nodes[e.a] as (typeof g.nodes)[number], homeB];
    const len = Math.sqrt((to.x - from.x) ** 2 + (to.z - from.z) ** 2);
    const steps = Math.max(1, Math.ceil(len / 0.5));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const x = from.x + (to.x - from.x) * f;
      const z = from.z + (to.z - from.z) * f;
      if (!isOnCorridor(world, x, z)) return { x, z, home: home + len * f };
    }
  }
  return null;
}

/** The parts the walk is split into, one test file each (`hollowWalkSweep.part<k>.test.ts`). */
export const HOLLOW_WALK_PARTS = 2;

/** The fifty worlds, `hollow0` to `hollow49`. */
const TOKENS = Array.from({ length: 50 }, (_, i) => `hollow${i}`);

/**
 * The trail is walkable by `stepMovement` at the enemy hull: a Hollow that
 * steps out at the crest and hunts a player waiting at the bottom comes down
 * the stem and reaches them. The player looks at the ground so the stare
 * cannot end the run first, and the loop stops on contact.
 *
 * They wait at the treeline, not at the pad, because the pad sits inside the
 * road corridor and a Hollow refuses to step onto it (containment.ts) — the
 * pad is the one place on the stem this gate could never be met. What is
 * walked is the stem above the treeline: 97.7 % of it on the median seed of
 * the 50, and 78.9 % on the worst, `hollow29`, whose trail runs inside the
 * corridor for its first 84 m. That floor is the trail's shape, not the
 * Hollow's reach.
 *
 * Every check is a seed's own, so the parts check together what the walk
 * whole did (`seedPart`): vitest hands out files, not tests, and as one test
 * the fifty walks took about 125 s on a CI runner, one of the floors under
 * the client suite. The walk out of the corridor stays in `hollowWalk.test.ts`.
 */
export function checkHollowWalkPart(part: number): void {
  for (const token of seedPart(TOKENS, part, HOLLOW_WALK_PARTS)) {
    const seed = seedFromToken(token);
    const w = createForestWorld(createForest(seed));
    w.haunt!.active = false;
    // The chase is on, as it is whenever a Hollow hunts: on the climb the
    // watcher would show behind this walk once its rest ran out (watcher.ts).
    w.state.phase = Phase.Chase;
    const p = spawnPlayer(w);
    p.pitch = 1.4;
    const graph = w.trail!;
    const crest = graph.nodes[graph.summit]!;
    const wait = treeline(w);
    expect(wait, `seed ${token}: no point on the stem is clear of the road corridor`).not.toBeNull();
    const at = wait!;
    p.pos = { x: at.x, y: elevationAt(seed, at.x, at.z) + PLAYER_HALF.y, z: at.z };
    spawnHollow(w, { x: crest.x, y: elevationAt(seed, crest.x, crest.z) + ENEMY_HALF.y, z: crest.z }, p.id, 0);
    const budget = Math.ceil(((graph.stemLen * 1.8 + 100) / HOLLOW_HUNT_SPEED) / TICK_DT);
    let t = 0;
    while (t < budget && p.health > 0) {
      tickWorld(w, new Map());
      t++;
    }
    const h = hollowsOf(w)[0]!;
    const d = Math.sqrt((h.pos.x - p.pos.x) ** 2 + (h.pos.z - p.pos.z) ** 2);
    const walked = ((1 - at.home / graph.stemLen) * 100).toFixed(0);
    expect(d, `seed ${token}: the Hollow stands ${d.toFixed(1)} m from its target after ${t} ticks (${walked}% of the ${graph.stemLen.toFixed(0)} m stem)`).toBeLessThan(3);
  }
}
