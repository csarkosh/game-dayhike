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
import { FORK_EMERGE_MAX_S, FORK_REVEAL_S, SUMMIT_REVEAL_S } from "../../src/sim/hollow.js";
import { FORK_CUT_RADIUS } from "../../src/sim/cut.js";
import { isOnCorridor } from "../../src/sim/containment.js";
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

    // Down the guide, node by node, the way the seed sweep walks every seed
    // (cutSweep.test.ts): for every guide node one tick on the edge into it,
    // FORK_CUT_RADIUS − 1 m short of the node (or on the node before, when
    // the edge is shorter; none of this guide's is), then one tick on the
    // node. The pad's edge in is the road's: 8 m short of the pad is inside
    // the corridor, so the last stride is the pad itself, below. The player
    // is prey the whole way down, and no Hollow ever stands on the corridor.
    const guide = w.cut!.guide;
    expect(guide[0]).toBe(chain[chain.length - 1]);
    expect(guide.length).toBe(54);
    expect(guide[52]).toBe(1);
    const place = (x: number, z: number) => { p.pos = { x, y: elevationAt(seed, x, z) + 0.9, z }; };
    /** Each fork's cut, with where the player stood when it fired. */
    const fired: Array<[number, string]> = [];
    const step = (where: string) => {
      const hollows = w.state.enemies.size, judged = w.cut!.cuts.size;
      tickWorld(w, new Map());
      expect(p.health, where).toBe(100);
      expect(p.safe, where).toBe(false);
      for (const e of w.state.enemies.values()) expect(isOnCorridor(w, e.pos.x, e.pos.z), where).toBe(false);
      const forks = [...w.cut!.cuts.keys()].slice(judged);
      for (const f of forks) fired.push([f, where]);
      // Whoever stepped out this tick is emerging, and bound for the mouth of
      // a branch of one of the forks just cut, 3 m in from it.
      for (const e of [...w.state.enemies.values()].slice(hollows)) {
        expect(e.ai, where).toBe(AiState.Emerge);
        const mouth = e.emergeTo!;
        expect(forks.some((f) => { const n = graph.nodes[f]!; return Math.abs(Math.sqrt((n.x - mouth.x) ** 2 + (n.z - mouth.z) ** 2) - 3) < 1e-9; }), where).toBe(true);
      }
    };
    for (let i = 1; i + 1 < guide.length; i++) {
      const prev = graph.nodes[guide[i - 1]!]!, node = graph.nodes[guide[i]!]!;
      const len = Math.sqrt((node.x - prev.x) ** 2 + (node.z - prev.z) ** 2);
      const f = Math.min(FORK_CUT_RADIUS - 1, len) / len;
      place(node.x + (prev.x - node.x) * f, node.z + (prev.z - node.z) * f);
      step(`on the way to ${guide[i]}`);
      at(guide[i]!);
      step(`at ${guide[i]}`);
    }
    // Every fork on the guide, cut as the guide reaches it, opening the
    // guide's next node; six branches closed, a Hollow in each.
    expect(fired).toEqual([[37, "on the way to 37"], [22, "on the way to 22"], [79, "on the way to 79"], [78, "on the way to 78"], [2, "on the way to 2"]]);
    expect([...w.cut!.cuts]).toEqual([[37, 43], [22, 54], [79, 78], [78, 7], [2, 1]]);
    expect([...w.cut!.closed]).toEqual([28, 21, 22, 80, 79, 78]);
    expect(w.state.enemies.size).toBe(7);
    // The walk is far faster than any Hollow, so fork 2's is still stepping
    // out: the player waits at node 1, off the corridor, until the whole pack
    // hunts them. The wait is measured on the terrain, not derived: that Hollow
    // walked 77 ticks to its mouth on real ground (a flat 9 m at 6.3 m/s to
    // the 1.5 m waypoint radius would be 71), stood 60, and four of those
    // ticks had already gone by on the walk down.
    let waited = 0;
    while (waited < Math.round((FORK_EMERGE_MAX_S + FORK_REVEAL_S) / TICK_DT) && [...w.state.enemies.values()].some((e) => e.ai === AiState.Emerge)) {
      step("waiting at 1");
      waited++;
    }
    expect(waited).toBe(133);
    for (const e of w.state.enemies.values()) {
      expect(e.ai).toBe(AiState.Hunt);
      expect(e.targetId).toBe(p.id);
    }
    // Home: the pad is on the corridor.
    at(0);
    tickWorld(w, new Map());
    expect(p.safe).toBe(true);
    expect(w.state.outcome).toBe(Outcome.Won);
    expect(p.health).toBeGreaterThan(0);
    expect(w.state.enemies.size).toBe(7);
    for (const e of w.state.enemies.values()) expect(isOnCorridor(w, e.pos.x, e.pos.z)).toBe(false);
  });
});
