import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { seedFromToken } from "../../src/game/seed.js";
import { createForest } from "../../src/sim/forest.js";
import { elevationAt, activeTerrainVariant } from "../../src/sim/terrain.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import type { World } from "../../src/sim/world.js";
import { isOnCorridor, roadOffset } from "../../src/sim/containment.js";
import { ROAD_CORRIDOR_HALF } from "../../src/sim/road.js";
import { ENEMY_HALF, PLAYER_HALF, TICK_DT } from "../../src/sim/constants.js";
import { HOLLOW_HUNT_SPEED, hollowsOf, spawnHollow } from "../../src/sim/hollow.js";

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
 */
describe("the Hollow walks the stem on real terrain", () => {
  it("reaches its target at the treeline from the crest on 50 seeds", () => {
    for (let i = 0; i < 50; i++) {
      const token = `hollow${i}`;
      const seed = seedFromToken(token);
      const w = createForestWorld(createForest(seed));
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
  }, 300_000);

  /**
   * The corridor rule is on the road offset, not on the destination alone, so
   * a Hollow that finds itself inside walks out instead of freezing: the
   * refusal path never reaches `stepMovement`, so a Hollow refused every step
   * would not move at all — not even fall.
   *
   * It cannot walk in today, but the trail's lower stretch is inside the
   * corridor on many seeds (the trailhead is at u = 9), so anything that
   * spawns a Hollow on the trail can put one there.
   *
   * It walks out along the trail rather than making a beeline, so the time is
   * the trail's: 4.8 s on `hollow0`, 14.4 s on `hollow29` and 15.2 s on
   * `hollow18`, the slowest of the 50 — those two are the seeds whose trails
   * hug the corridor. Over all 50, half are out within 4.9 s.
   */
  it("walks out of the road corridor instead of freezing on it", () => {
    for (const token of ["hollow0", "hollow29", "hollow18"]) {
      const seed = seedFromToken(token);
      const w = createForestWorld(createForest(seed));
      const graph = w.trail!;
      // The target is the crest, far up the stem and well out of the corridor.
      const crest = graph.nodes[graph.summit]!;
      const p = spawnPlayer(w);
      p.pitch = 1.4;
      p.pos = { x: crest.x, y: elevationAt(seed, crest.x, crest.z) + PLAYER_HALF.y, z: crest.z };
      // On the road's centreline by the pad: u = 0, as deep in as it goes.
      const roadCenterX = activeTerrainVariant().roadCenterX!;
      const th = graph.trailhead;
      const sx = roadCenterX(seed, th.z);
      const h = spawnHollow(w, { x: sx, y: elevationAt(seed, sx, th.z) + ENEMY_HALF.y, z: th.z }, p.id, 0);
      expect(isOnCorridor(w, h.pos.x, h.pos.z), `seed ${token}`).toBe(true);

      let out = -1;
      let back = -1;
      const budget = Math.round(20 / TICK_DT);
      for (let t = 0; t < budget; t++) {
        tickWorld(w, new Map());
        const on = isOnCorridor(w, h.pos.x, h.pos.z);
        if (!on && out < 0) out = t;
        if (on && out >= 0 && back < 0) back = t;
      }
      const u = roadOffset(w, h.pos.x, h.pos.z) as number;
      expect(out, `seed ${token}: still on the corridor after ${budget} ticks, at u = ${u.toFixed(1)}`).toBeGreaterThanOrEqual(0);
      expect(back, `seed ${token}: left the corridor at tick ${out} and was back on it at tick ${back}`).toBe(-1);
      expect(u, `seed ${token}`).toBeGreaterThan(ROAD_CORRIDOR_HALF);
    }
  }, 120_000);
});
