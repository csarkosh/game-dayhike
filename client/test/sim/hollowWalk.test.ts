import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { seedFromToken } from "../../src/game/seed.js";
import { createForest } from "../../src/sim/forest.js";
import { elevationAt } from "../../src/sim/terrain.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { isOnCorridor } from "../../src/sim/containment.js";
import { ENEMY_HALF, PLAYER_HALF, TICK_DT } from "../../src/sim/constants.js";
import { HOLLOW_HUNT_SPEED, hollowsOf, spawnHollow } from "../../src/sim/hollow.js";

/**
 * The trail is walkable by `stepMovement` at the enemy hull: a Hollow that
 * steps out at the crest and hunts a player waiting at the bottom comes down
 * the whole stem and reaches them. The player looks at the ground so the
 * stare cannot end the run first, and the loop stops on contact.
 *
 * They wait at the treeline, not at the pad: the pad is inside the road
 * corridor, where a Hollow refuses to step (containment.ts), so the pad is
 * the one place on the stem this gate could never be met. The walk is the
 * whole stem bar its last few metres either way.
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
      // The trail node nearest the pad along the trail that is clear of the
      // corridor: the first ground the Hollow is allowed to stand on.
      let wait = crest;
      let nearestHome = Infinity;
      for (let n = 0; n < graph.nodes.length; n++) {
        const node = graph.nodes[n]!;
        const home = graph.homeDist[n]!;
        if (home >= nearestHome || isOnCorridor(w, node.x, node.z)) continue;
        nearestHome = home;
        wait = node;
      }
      p.pos = { x: wait.x, y: elevationAt(seed, wait.x, wait.z) + PLAYER_HALF.y, z: wait.z };
      spawnHollow(w, { x: crest.x, y: elevationAt(seed, crest.x, crest.z) + ENEMY_HALF.y, z: crest.z }, p.id, 0);
      const budget = Math.ceil(((graph.stemLen * 1.8 + 100) / HOLLOW_HUNT_SPEED) / TICK_DT);
      let t = 0;
      while (t < budget && p.health > 0) {
        tickWorld(w, new Map());
        t++;
      }
      const h = hollowsOf(w)[0]!;
      const d = Math.sqrt((h.pos.x - p.pos.x) ** 2 + (h.pos.z - p.pos.z) ** 2);
      expect(d, `seed ${token}: the Hollow stands ${d.toFixed(1)} m from its target after ${t} ticks (stem ${graph.stemLen.toFixed(0)} m)`).toBeLessThan(3);
    }
  }, 300_000);
});
