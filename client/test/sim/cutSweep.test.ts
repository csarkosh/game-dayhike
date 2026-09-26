import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { AiState, Outcome, Phase } from "../../src/sim/types.js";
import { isOnCorridor } from "../../src/sim/containment.js";
import { GUIDE_MAX, GUIDE_MIN, homeDistances, pathLength } from "../../src/sim/trailRoute.js";
import { FORK_CUT_RADIUS } from "../../src/sim/cut.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

/** What one seed's descent measured, checked per seed and summed below. */
type Descent = {
  inBand: boolean;
  /** Forks standing on the road corridor. */
  corridorForks: number[];
  /** Every Hollow at the end, the summit's included. */
  pack: number;
};

/**
 * One player walks the guide crest → pad by teleport, as `summitRun.test.ts`
 * does on `hollow`: for every guide node, one tick standing on the edge into
 * it FORK_CUT_RADIUS − 1 m short of the node (or on the node before, when the
 * edge is shorter), then one tick on the node. The walk ends the first tick
 * the player is safe: on a seed whose trail runs inside the corridor before
 * the pad that is the treeline, and the match is won there.
 *
 * On every tick: every Hollow that stepped out this tick is Emerge, off the
 * corridor, at least 2 m from the player, and 2–12 m from its fork; every
 * fork cut this tick that is on the guide opened the guide's next node, and
 * the open branch's far node reaches the pad on the residual graph as it
 * stands after the cut. A fork off the guide is never reached by this walk,
 * and the walk asserts it is never cut: the trigger has to be on one of the
 * fork's branches, and this walk is only ever on the guide's.
 */
function descend(token: string): Descent {
  const w = createForestWorld(createForest(seedFromToken(token)));
  const p = spawnPlayer(w);
  const g = w.trail!;
  const at = (x: number, z: number) => { p.pos = { x, y: w.ground!.heightAt(x, z) + 0.9, z }; };
  const body = w.register!.body.pos;
  at(body.x - 5, body.z);
  tickWorld(w, new Map());
  expect(w.state.phase, token).toBe(Phase.Chase);
  const guide = w.cut!.guide;
  expect(guide[0], token).toBe(g.summit);
  expect(guide[guide.length - 1], token).toBe(0);
  expect(new Set(guide).size, token).toBe(guide.length);
  const metres = pathLength(g, guide);
  const inBand = metres >= GUIDE_MIN * g.shortestHome && metres <= GUIDE_MAX * g.shortestHome;
  const corridorForks = g.forks.filter((f) => isOnCorridor(w, g.nodes[f]!.x, g.nodes[f]!.z));

  const judged = new Set<number>();
  const step = (where: string) => {
    const label = `seed ${token}, ${where}`;
    const before = w.state.enemies.size;
    tickWorld(w, new Map());
    for (const h of [...w.state.enemies.values()].slice(before)) {
      expect(h.ai, label).toBe(AiState.Emerge);
      expect(isOnCorridor(w, h.pos.x, h.pos.z), label).toBe(false);
      expect(dist(h.pos, p.pos), label).toBeGreaterThanOrEqual(2);
      // 12 m in, to rounding: the spawn is a point on the bed measured back.
      const fromFork = dist(h.pos, h.emergeTo!);
      expect(fromFork, label).toBeGreaterThanOrEqual(2);
      expect(fromFork, label).toBeLessThanOrEqual(12 + 1e-9);
    }
    const residual = g.edges.filter((_, ei) => !w.cut!.closed.has(ei));
    const home = homeDistances(g.nodes, residual);
    for (const [fork, open] of w.cut!.cuts) {
      if (judged.has(fork)) continue;
      judged.add(fork);
      const i = guide.indexOf(fork);
      expect(i, `${label}: fork ${fork} cut off the guide`).toBeGreaterThan(0);
      if (corridorForks.includes(fork)) {
        expect(open, label).toBe(-1);
        continue;
      }
      expect(open, `${label}: fork ${fork}`).toBe(guide[i + 1]);
      expect(home[open], `${label}: fork ${fork} opened ${open}`).not.toBe(Infinity);
    }
  };

  for (let i = 1; i < guide.length && w.state.outcome === Outcome.Playing; i++) {
    const prev = g.nodes[guide[i - 1]!]!, node = g.nodes[guide[i]!]!;
    const len = dist(prev, node);
    const f = Math.min(FORK_CUT_RADIUS - 1, len) / len;
    at(node.x + (prev.x - node.x) * f, node.z + (prev.z - node.z) * f);
    step(`on the way to node ${guide[i]}`);
    if (w.state.outcome !== Outcome.Playing) break;
    at(node.x, node.z);
    step(`at node ${guide[i]}`);
  }
  expect(w.state.outcome, token).toBe(Outcome.Won);
  expect(p.health, token).toBeGreaterThan(0);
  return { inBand, corridorForks, pack: w.state.enemies.size };
}

/**
 * The cut on fifty seeds, walked as above, with the timeout `hollowWalk.test.ts`
 * carries for the same fifty worlds. The floors are what the walk measured on
 * 2026-09-25, pinned; the shares are the trail builder's and the guide's, not
 * the cut's, and moving them is the density follow-up.
 */
describe("the cut on fifty seeds", () => {
  it("walks the guide home on every seed, and cuts only what the guide reaches", () => {
    const runs: Descent[] = [];
    for (let i = 0; i < 50; i++) runs.push(descend(`hollow${i}`));
    const inBand = runs.filter((r) => r.inBand).length;
    const packs = runs.map((r) => r.pack).sort((a, b) => a - b);
    // The lower of the two middle values: what half the seeds at least send.
    const median = packs[24]!;
    const largest = packs[49]!;
    const corridor = runs.map((r, i) => (r.corridorForks.length > 0 ? `hollow${i}` : null)).filter((t) => t !== null);
    console.info(`[cutSweep] guide in band ${inBand}/50; pack at the pad median ${median}, largest ${largest}; a fork on the corridor: ${corridor.join(", ") || "none"}`);
    // The guide lands in its band on 29 of the 50; the rest walk the longest
    // route found under the cap, as the summit design's §3.5 allows.
    expect(inBand).toBeGreaterThanOrEqual(29);
    // The pack at the pad, the summit Hollow counted: the median world sends
    // five, the busiest eleven. One seed, `hollow29`, stands a fork on the
    // corridor, and that fork is never cut.
    expect(median).toBeGreaterThanOrEqual(5);
    expect(largest).toBeGreaterThanOrEqual(11);
    expect(corridor).toEqual(["hollow29"]);
  }, 300_000);
});
