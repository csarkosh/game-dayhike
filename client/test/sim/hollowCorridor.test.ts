import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, elevationAt, activeTerrainVariant } from "../../src/sim/terrain.js";
import { AiState, Phase } from "../../src/sim/types.js";
import { ENEMY_HALF } from "../../src/sim/constants.js";
import { spawnHollow } from "../../src/sim/hollow.js";
import { stemNodes } from "../../src/sim/trailRoute.js";
import { isOnCorridor, roadOffset } from "../../src/sim/containment.js";
import { ROAD_CORRIDOR_HALF } from "../../src/sim/road.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
const seed = seedFromToken("hollow");

/**
 * A real forest world, so this file carries a timeout the way `summit.test.ts`
 * does: `createForest` memoises per seed, but the first build runs past
 * vitest's 5 s default whenever it shares the machine with the other forest
 * suites.
 */
const SUITE = { timeout: 120_000 };

/** The chase on the seed `hollow`, with one living player standing at (x, z), looking at the ground. */
function chase(x: number, z: number) {
  const w = createForestWorld(createForest(seed));
  // Already the chase, as it is whenever a Hollow is walking: nobody here is
  // near the body, but the phase is the one these rules run in.
  w.state.phase = Phase.Chase;
  const p = spawnPlayer(w);
  p.pitch = 1.4;
  p.pos = { x, y: elevationAt(seed, x, z) + 0.9, z };
  return { w, p };
}
const roadX = (z: number) => activeTerrainVariant().roadCenterX!(seed, z);
const uOf = (o: { x: number; z: number }) => o.x - roadX(o.z);

describe("a Hollow on the road corridor", SUITE, () => {
  it("walks straight out to the treeline, then takes up the hunt from there", () => {
    // The trail's lower end is inside the corridor: the trailhead stands at
    // u = 9, and on this seed the first stem node above it is at u = 36. A
    // Hollow put down at u = 15 by the pad — where the pack's later spawns on
    // the trail's lower stretch can put one — hunting a player at that first
    // node, routes through the trailhead, which is DEEPER inside. Every step
    // along that route would take it nearer the road, and it once stood there
    // for good: refused every step, and a refused step moves nothing.
    const w0 = createForestWorld(createForest(seed));
    const th = w0.trail!.trailhead;
    const first = w0.trail!.nodes[stemNodes(w0.trail!)[1]!]!;
    expect(uOf(th)).toBeCloseTo(9, 6);
    expect(uOf(first)).toBeCloseTo(36, 6);

    const { w, p } = chase(first.x, first.z);
    const hx = roadX(th.z) + 15;
    const h = spawnHollow(w, { x: hx, y: elevationAt(seed, hx, th.z) + ENEMY_HALF.y, z: th.z }, p.id, 0);
    expect(isOnCorridor(w, h.pos.x, h.pos.z)).toBe(true);

    let out = -1;
    let back = -1;
    let killed = -1;
    for (let t = 0; t < 900; t++) {
      const before = { x: h.pos.x, z: h.pos.z };
      tickWorld(w, new Map());
      if (t === 0) expect(h.route[0], "its route starts at the trailhead").toBe(0);
      expect(p.safe, `tick ${t}`).toBe(false);
      const on = isOnCorridor(w, h.pos.x, h.pos.z);
      if (on && out < 0) {
        // Moving every tick it is inside, from the first: 0.0175 m is what
        // one tick of acceleration from rest gives, and it only grows.
        const dx = h.pos.x - before.x, dz = h.pos.z - before.z;
        expect(Math.sqrt(dx * dx + dz * dz), `stood still on the corridor at tick ${t}`).toBeGreaterThan(0.01);
      }
      if (!on && out < 0) out = t;
      if (on && out >= 0 && back < 0) back = t;
      if (p.health <= 0) { killed = t; break; }
    }
    // 15 m to the edge at 6.3 m/s is 2.4 s: out on tick 146, and never back.
    expect(out, `still on the corridor, at u = ${uOf(h.pos).toFixed(2)}`).toBeGreaterThanOrEqual(140);
    expect(out).toBeLessThanOrEqual(300);
    expect(back, `left the corridor at tick ${out} and was back on it at tick ${back}`).toBe(-1);
    // Then the hunt, from where it came out: contact on tick 494, well inside 15 s.
    expect(killed, `never reached its target: ${Math.sqrt((h.pos.x - p.pos.x) ** 2 + (h.pos.z - p.pos.z) ** 2).toFixed(1)} m off`).toBeGreaterThan(out);
    expect(killed).toBeLessThanOrEqual(900);
  });

  it("from outside, never steps onto it, and stands at the treeline facing the pad", () => {
    // Its prey stands 200 m down the road, a metre outside the corridor on
    // the same side, and the road bends 6.5 m toward the Hollow's side over
    // that stretch: the straight line to them cuts across the corridor, so
    // the very first step of the approach would land inside. From a hair
    // outside the line, that step is refused, and so is every one after it.
    const th = createForestWorld(createForest(seed)).trail!.trailhead;
    const pz = th.z - 200;
    const { w, p } = chase(roadX(pz) + ROAD_CORRIDOR_HALF + 1, pz);
    const hx = roadX(th.z) + ROAD_CORRIDOR_HALF + 0.0001;
    const h = spawnHollow(w, { x: hx, y: elevationAt(seed, hx, th.z) + ENEMY_HALF.y, z: th.z }, p.id, 0);
    h.approach = true;
    const spawn = { ...h.pos };
    for (let t = 0; t < 120; t++) {
      tickWorld(w, new Map());
      expect(p.safe, `tick ${t}`).toBe(false);
      expect(h.ai, `tick ${t}`).toBe(AiState.Hunt);
      expect(isOnCorridor(w, h.pos.x, h.pos.z), `on the corridor at tick ${t}`).toBe(false);
      // A refused step touches nothing, gravity included.
      expect(h.pos, `moved at tick ${t}`).toEqual(spawn);
    }
    expect(roadOffset(w, h.pos.x, h.pos.z)).toBeCloseTo(30.0001, 4);
    // The pad is straight down -x from there; its prey is off at nearly -z.
    expect(h.yaw).toBeCloseTo(-1.5708, 4);
    expect(p.health).toBe(100);
  });
});
