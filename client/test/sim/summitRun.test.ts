import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, elevationAt } from "../../src/sim/terrain.js";
import { AiState, Outcome, Phase } from "../../src/sim/types.js";
import { TICK_DT } from "../../src/sim/constants.js";
import { stemNodes } from "../../src/sim/trailRoute.js";
import { DISCOVERY_RADIUS } from "../../src/sim/summit.js";
import { SUMMIT_REVEAL_S } from "../../src/sim/hollow.js";
import { escalationTargets } from "../../src/game/escalation.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

/**
 * One run end to end on a real forest world, so this file carries a timeout
 * the way `summit.test.ts` does: the first `createForest` on a seed runs past
 * vitest's 5 s default whenever it shares the machine with the other forest
 * suites.
 */
const SUITE = { timeout: 120_000 };

describe("one run on the seed `hollow`", SUITE, () => {
  it("climbs the stem, finds the body, is hunted, reaches the road, and wins", () => {
    const seed = seedFromToken("hollow");
    const w = createForestWorld(createForest(seed));
    const p = spawnPlayer(w);
    const graph = w.trail!;
    const chain = stemNodes(graph);
    const at = (n: number) => { const node = graph.nodes[n]!; p.pos = { x: node.x, y: elevationAt(seed, node.x, node.z) + 0.9, z: node.z }; };
    // The climb is every stem node outside the discovery radius, not simply
    // "all but the last": on `hollow` the node before the crest stands 11.3 m
    // from the body, inside the 12 m radius, so standing there IS the find.
    const body = w.register!.body.pos;
    const climb = chain.filter((n) => {
      const node = graph.nodes[n]!;
      const dx = node.x - body.x, dz = node.z - body.z;
      return Math.sqrt(dx * dx + dz * dz) > DISCOVERY_RADIUS;
    });
    // Only the last stride or two is the find: the walk below is the match.
    expect(climb).toEqual(chain.slice(0, climb.length));
    expect(climb.length).toBeGreaterThan(chain.length - 4);
    // Up the stem, node by node: the world input rises and nothing hunts.
    let first = -1;
    let last = -1;
    for (const n of climb) {
      at(n);
      tickWorld(w, new Map());
      const world = escalationTargets(w.state, p.id, graph, w.boxes, w.ground).world;
      expect(world).toBeGreaterThanOrEqual(last);
      if (first < 0) first = world;
      last = world;
      expect(w.state.phase).toBe(Phase.Climb);
      expect(w.state.enemies.size).toBe(0);
    }
    // Rose, not merely never fell: the pad reads nothing, the last node short
    // of the find reads nearly everything.
    expect(first).toBeLessThan(0.05);
    expect(last).toBeGreaterThan(0.9);
    // The crest: the find.
    at(chain[chain.length - 1]!);
    tickWorld(w, new Map());
    expect(w.state.phase).toBe(Phase.Chase);
    expect(escalationTargets(w.state, p.id, graph, w.boxes, w.ground).world).toBe(1);
    const h = [...w.state.enemies.values()][0]!;
    expect(h.ai).toBe(AiState.Emerge);
    for (let i = 0; i < Math.round(SUMMIT_REVEAL_S / TICK_DT) + 1; i++) tickWorld(w, new Map());
    expect(h.ai).toBe(AiState.Hunt);
    expect(h.targetId).toBe(p.id);
    // Home: the pad is on the corridor.
    at(0);
    tickWorld(w, new Map());
    expect(p.safe).toBe(true);
    expect(w.state.outcome).toBe(Outcome.Won);
    expect(p.health).toBeGreaterThan(0);
  });
});
