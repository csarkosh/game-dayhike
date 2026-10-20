import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { seedFromToken } from "../../src/game/seed.js";
import { createForest } from "../../src/sim/forest.js";
import { elevationAt, activeTerrainVariant } from "../../src/sim/terrain.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { isOnCorridor, roadOffset } from "../../src/sim/containment.js";
import { ROAD_CORRIDOR_HALF } from "../../src/sim/road.js";
import { ENEMY_HALF, PLAYER_HALF, TICK_DT } from "../../src/sim/constants.js";
import { spawnHollow } from "../../src/sim/hollow.js";
import { Phase } from "../../src/sim/types.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** The walk down the stem from the crest, on 50 seeds, is `hollowWalkSweep.ts`. */
describe("the Hollow walks the stem on real terrain", () => {
  /**
   * A Hollow that finds itself inside the corridor walks straight out to the
   * nearest edge, ignoring its route until it is clear, instead of freezing:
   * the refusal path never reaches `stepMovement`, so a Hollow refused every
   * step would not move at all — not even fall.
   *
   * It cannot walk in today, but the trail's lower stretch is inside the
   * corridor on many seeds (the trailhead is at u = 9), so anything that
   * spawns a Hollow on the trail can put one there.
   *
   * From the centreline the walk out is the corridor's half-width, 30 m at
   * 6.3 m/s: 4.8 s on each of these three, `hollow29` and `hollow18` being
   * the seeds whose trails hug the corridor longest, which no longer matters
   * to the time. `hollowCorridor.test.ts` walks the case that used to freeze —
   * a route into the woods that starts at the trailhead, deeper inside.
   *
   * It starts 30 m along the road from the pad, where nothing stands between
   * the road and the woods. Started at the pad's own place, on `hollow18` it
   * walks into the road-side face of the car, which has stood at the pad
   * since 2026-09-28, and stays there at u = 5.6 for all 1200 ticks: the
   * sidestep `walkToward` keeps for this never begins. Traced tick by tick,
   * the Hollow meets the face square on (inside the corridor it heads along
   * x alone), and each tick it is carried about 2 cm into the box and put
   * back; at 25 m from its goal those 2 cm move the squared distance by
   * about 0.9, far over STUCK_EPSILON (0.01), so every other tick reads as
   * progress, the stuck timer never passes 0.02 s of its 1.5 s, and no
   * strafe starts. On `hollow0` it meets the car off the square and slides
   * round it, 2.2 s late. That is a fault in the stuck test, older than the
   * car's move and not mended here. No Hollow is ever put on the road
   * behind the car: none steps onto the corridor, and none spawns on it
   * short of the trail.
   */
  it("walks out of the road corridor instead of freezing on it", () => {
    for (const token of ["hollow0", "hollow29", "hollow18"]) {
      const seed = seedFromToken(token);
      const w = createForestWorld(createForest(seed));
      w.haunt!.active = false;
      // The chase is already on, as it is whenever a Hollow is walking: the
      // target below stands on the body, so otherwise `stepSummit` would read
      // the find on the first tick and step a second Hollow out beside them,
      // which kills them in a few seconds and leaves this one with nobody to
      // walk toward (summit.ts).
      w.state.phase = Phase.Chase;
      const graph = w.trail!;
      // The target is the crest, far up the stem and well out of the corridor.
      const crest = graph.nodes[graph.summit]!;
      const p = spawnPlayer(w);
      p.pitch = 1.4;
      p.pos = { x: crest.x, y: elevationAt(seed, crest.x, crest.z) + PLAYER_HALF.y, z: crest.z };
      // On the road's centreline, 30 m along it from the pad: u = 0, as deep
      // in as it goes, and clear of the car and the board.
      const roadCenterX = activeTerrainVariant().roadCenterX!;
      const sz = graph.trailhead.z + 30;
      const sx = roadCenterX(seed, sz);
      const h = spawnHollow(w, { x: sx, y: elevationAt(seed, sx, sz) + ENEMY_HALF.y, z: sz }, p.id, 0);
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
  }, timeLimit(120_000));
});
