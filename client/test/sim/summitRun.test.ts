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
import { WATCH_SALT } from "../../src/sim/watcher.js";
import { escalationTargets } from "../../src/game/escalation.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

/**
 * One run end to end on a real forest world, so this file carries a timeout
 * the way `summit.test.ts` does: the first `createForest` on a seed runs past
 * vitest's 5 s default whenever it shares the machine with the other forest
 * suites.
 */
const SUITE = { timeout: timeLimit(120_000) };

describe("one run on the seed `hollow`", SUITE, () => {
  it("climbs the stem, finds the body, is hunted, reaches the road, and wins", () => {
    const seed = seedFromToken("hollow");
    const w = createForestWorld(createForest(seed));
    // The sightings below are the ones in the trees, at the reach's range:
    // the first showings, on the trail, are watcher.test.ts's.
    w.watcher!.active = true;
    w.watcher!.bold = 0;
    // The haunt's shades are haunt.test.ts's: this run pins the Hollows.
    w.haunt!.active = false;
    const p = spawnPlayer(w);
    const graph = w.trail!;
    const chain = stemNodes(graph);
    const at = (n: number) => { const node = graph.nodes[n]!; p.pos = { x: node.x, y: elevationAt(seed, node.x, node.z) + 0.9, z: node.z }; };
    // The climb is every stem node outside the discovery radius, not simply
    // "all but the last": on `hollow` the node before the crest stands 11.3 m
    // from the body, inside the 12 m radius, so standing there IS the find.
    const body = w.search!.body.pos;
    const climb = chain.filter((n) => {
      const node = graph.nodes[n]!;
      const dx = node.x - body.x, dz = node.z - body.z;
      return Math.sqrt(dx * dx + dz * dz) > DISCOVERY_RADIUS;
    });
    // Only the last stride or two is the find: the walk below is the match.
    expect(climb).toEqual(chain.slice(0, climb.length));
    expect(climb.length).toBeGreaterThan(chain.length - 4);
    /**
     * A sighting where the player stands: facing the next stem node up, with
     * the record's rest run out, the watcher shows within 120 ticks at the
     * range the stand's reach sets, the only enemy and a Watch; then a half
     * turn puts it behind, and it is gone the next tick with a new rest drawn.
     */
    const sighting = (n: number, range: number) => {
      const here = graph.nodes[n]!, next = graph.nodes[chain[chain.indexOf(n) + 1]!]!;
      p.yaw = Math.atan2(next.x - here.x, next.z - here.z);
      p.pitch = 0;
      w.watcher!.rest = 0;
      let shown = -1;
      for (let t = 1; t <= 120 && shown < 0; t++) {
        tickWorld(w, new Map());
        if (w.watcher!.id !== -1) shown = t;
      }
      expect(shown, `at ${n}`).toBeGreaterThan(0);
      const seen = [...w.state.enemies.values()];
      expect(seen, `at ${n}`).toHaveLength(1);
      expect(seen[0]!.ai, `at ${n}`).toBe(AiState.Watch);
      expect(seen[0]!.targetId, `at ${n}`).toBe(p.id);
      const d = Math.sqrt((seen[0]!.pos.x - p.pos.x) ** 2 + (seen[0]!.pos.z - p.pos.z) ** 2);
      expect(Math.abs(d - range), `at ${n}: ${d} m`).toBeLessThanOrEqual(0.5);
      p.yaw += Math.PI;
      tickWorld(w, new Map());
      expect(w.state.enemies.size, `at ${n}`).toBe(0);
      expect(w.watcher!.id, `at ${n}`).toBe(-1);
      expect(w.watcher!.rest, `at ${n}`).toBeGreaterThanOrEqual(8);
      expect(w.watcher!.rest, `at ${n}`).toBeLessThanOrEqual(60);
      expect(w.state.phase, `at ${n}`).toBe(Phase.Climb);
    };
    // Up the stem, node by node: the world input rises and nothing hunts.
    // The only enemy the climb ever has is the watcher, and it is seen twice
    // on the way: a quarter of the way up at node 5, where its reach puts it
    // 67 m out, and at the top fork, node 36, 25 m out. Every showing spends
    // an entity id, which nothing below pins. 2026-09-29: the stem below
    // u = 308 m is a new line from the pad (the trail leaves the pad inland
    // now), so the stand a quarter of the way up is node 5, climb 0.27, and
    // the top fork, where it was, is one id lower.
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
      expect(w.state.enemies.size).toBeLessThanOrEqual(1);
      for (const e of w.state.enemies.values()) expect(e.ai).toBe(AiState.Watch);
      if (n === 5) sighting(n, 66.77);
      if (n === 36) sighting(n, 25);
    }
    expect(w.watcher!.rng.rngSeed).not.toBe((seed ^ WATCH_SALT) | 0);
    // Rose, not merely never fell: the pad reads nothing, the last node short
    // of the find reads nearly everything.
    expect(first).toBeLessThan(0.05);
    expect(last).toBeGreaterThan(0.9);
    // The crest: the find.
    at(chain[chain.length - 1]!);
    tickWorld(w, new Map());
    expect(w.state.phase).toBe(Phase.Chase);
    expect(escalationTargets(w.state, p.id, graph, w.boxes, w.ground).world).toBe(1);
    // No watcher survives the flip: the summit Hollow is the only enemy.
    expect(w.watcher!.id).toBe(-1);
    expect(w.state.enemies.size).toBe(1);
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
    expect(guide.length).toBe(55);
    expect(guide[53]).toBe(1);
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
    // guide's next node; five branches closed, a Hollow in each. 2026-09-29:
    // four forks cut where there were five, and five branches closed where
    // there were six. The graph has the five forks it had, but at the
    // strand's fork, 78, the guide keeps to the strand down to the stem at
    // fork 53 where it took the rung to the stem before, so it never comes
    // to the rung's other end, fork 77.
    expect(fired).toEqual([[36, "on the way to 36"], [21, "on the way to 21"], [78, "on the way to 78"], [53, "on the way to 53"]]);
    expect([...w.cut!.cuts]).toEqual([[36, 42], [21, 54], [78, 74], [53, 3]]);
    expect([...w.cut!.closed]).toEqual([27, 20, 21, 80, 53]);
    expect(w.state.enemies.size).toBe(6);
    // The walk is far faster than any Hollow, so fork 53's is still stepping
    // out: the player waits at node 1, off the corridor, until the whole pack
    // hunts them. The wait is measured on the terrain, not derived: that Hollow
    // walked 76 ticks to its mouth on real ground (a flat 9 m at 6.3 m/s to
    // the 1.5 m waypoint radius would be 71), stood 60, and seven of those
    // ticks had already gone by on the walk down.
    let waited = 0;
    while (waited < Math.round((FORK_EMERGE_MAX_S + FORK_REVEAL_S) / TICK_DT) && [...w.state.enemies.values()].some((e) => e.ai === AiState.Emerge)) {
      step("waiting at 1");
      waited++;
    }
    // 129 with the fork's 1 s stand as first built; 2.5 s (FORK_REVEAL_S) is 90 ticks more.
    expect(waited).toBe(220);
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
    expect(w.state.enemies.size).toBe(6);
    for (const e of w.state.enemies.values()) expect(isOnCorridor(w, e.pos.x, e.pos.z)).toBe(false);
  });
});
