import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, createWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import type { World } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, elevationAt } from "../../src/sim/terrain.js";
import { AiState, Button, Outcome, Phase } from "../../src/sim/types.js";
import { isOnCorridor } from "../../src/sim/containment.js";
import { homeDistances, forksOf, pathLength } from "../../src/sim/trailRoute.js";
import { segmentDistance } from "../../src/sim/trail.js";
import type { TrailEdge, TrailGraph, TrailNode } from "../../src/sim/trail.js";
import { SUMMIT_REVEAL_S, FORK_EMERGE_MAX_S, FORK_REVEAL_S } from "../../src/sim/hollow.js";
import { TICK_DT } from "../../src/sim/constants.js";
import {
  FORK_CUT_RADIUS, FORK_MOUTH_DIST, FORK_SPAWN_CLEAR, FORK_SPAWN_DIST, FORK_SPAWN_MIN,
  FORK_SPAWN_PLAYER_CLEAR, GUIDE_REJOIN_SLACK, drawGuide, forkSpawn, openBranch, stepCuts, triggerEdge,
} from "../../src/sim/cut.js";
import type { CutRecord } from "../../src/sim/cut.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

type Brush = { min: [number, number, number]; max: [number, number, number]; material: string };
const FLOOR: Brush = { min: [-600, -1, -600], max: [600, 0, 600], material: "concrete" };
const level = parseLevel({ id: "flat", brushes: [FLOOR], playerSpawns: [[0, 0.9, 0]], enemySpawns: [] });

/** A hand graph with every derived field filled in, on no particular world. */
function hand(nodes: TrailNode[], edges: TrailEdge[], summit: number, stem: number[]): TrailGraph {
  const homeDist = homeDistances(nodes, edges);
  return {
    nodes, edges, trailhead: { x: 0, z: 0, u: 0 }, summit, stem, loops: [], features: [], stemLen: 0, fallbacks: 0,
    forks: forksOf(nodes.length, edges), homeDist, shortestHome: homeDist[summit]!,
  };
}
const edge = (a: number, b: number): TrailEdge =>
  ({ a, b, kind: "loop", profile: new Float64Array([0, 0]), progress0: 0, progress1: 0 });

/**
 * The sandbox trail, flat but for two node heights. The stem runs along +x,
 * pad 0 (0,0) → 1 (100,0) → fork 2 (200,0) → fork 3 (400,0) → crest 4 (500,0).
 * Fork 2 and fork 3 share the stem edge between them, and are joined again by
 * a strand above (node 5 at (300,80)) and one below (node 8 at (300,−80)),
 * mirror images. Fork 2 also has a dead-end spur to 6 (200,−50) and a detour
 * to 7 (100, z7) that runs on to the pad; 7 also joins node 1, making both 1
 * and 7 forks. Edge indices, which the tests name:
 *   0 0–1  1 1–2  2 2–3  3 3–4  4 2–5  5 5–3  6 2–6  7 2–7  8 7–0  9 1–7  10 2–8  11 8–3
 * With z7 = 40 the detour's legs are 107.7 m and 1–7 is 40 m.
 */
function sandbox(z7 = 40): TrailGraph {
  const nodes: TrailNode[] = [
    { x: 0, z: 0, h: 0, u: 0 }, { x: 100, z: 0, h: 0, u: 0 }, { x: 200, z: 0, h: 10, u: 0 }, { x: 400, z: 0, h: 0, u: 0 },
    { x: 500, z: 0, h: 0, u: 0 }, { x: 300, z: 80, h: 20, u: 0 }, { x: 200, z: -50, h: 0, u: 0 }, { x: 100, z: z7, h: 0, u: 0 },
    { x: 300, z: -80, h: 0, u: 0 },
  ];
  const edges = [
    edge(0, 1), edge(1, 2), edge(2, 3), edge(3, 4), edge(2, 5), edge(5, 3), edge(2, 6), edge(2, 7), edge(7, 0), edge(1, 7),
    edge(2, 8), edge(8, 3),
  ];
  return hand(nodes, edges, 4, [0, 1, 2, 3]);
}
/** A road-less flat world carrying `graph` as its trail. */
function sandboxWorld(graph: TrailGraph = sandbox()): World {
  const w = createWorld(level, 1);
  w.trail = graph;
  return w;
}
/** The guide the sandbox tests assume: crest 4 → 3 → up the strand to 2 → the detour → pad. */
const guide = (closed: number[] = []): CutRecord => ({ guide: [4, 3, 5, 2, 7, 0], cuts: new Map(), closed: new Set(closed) });
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

describe("the constants", () => {
  it("are the spec's", () => {
    expect(FORK_CUT_RADIUS).toBe(14);
    expect(FORK_SPAWN_DIST).toBe(12);
    expect(FORK_MOUTH_DIST).toBe(3);
    expect(FORK_SPAWN_CLEAR).toBe(1);
    expect(FORK_SPAWN_MIN).toBe(2);
    expect(FORK_SPAWN_PLAYER_CLEAR).toBe(2);
    expect(FORK_REVEAL_S).toBe(2.5);
    expect(FORK_EMERGE_MAX_S).toBe(6);
    expect(GUIDE_REJOIN_SLACK).toBe(60);
  });

  it("start every world with no cut", () => {
    expect(sandboxWorld().cut).toBeNull();
  });
});

describe("the sandbox graph", () => {
  it("is what the tests below assume", () => {
    const g = sandbox();
    expect(g.forks).toEqual([1, 2, 3, 7]);
    expect(g.shortestHome).toBe(500);
    expect(pathLength(g, guide().guide)).toBeCloseTo(571.5, 0);
  });
});

describe("triggerEdge", () => {
  // Fork 1 at (100, 0): edge 0 runs to the pad along −x, edge 1 up the stem
  // along +x, edge 9 to node 7 along +z.
  it("is the nearest incident edge, ties to the lower index", () => {
    const g = sandbox();
    expect(triggerEdge(g, 1, 100, 0)).toBe(0); // on the node: every edge at 0
    expect(triggerEdge(g, 1, 103, 3)).toBe(1); // 3 m from edge 1 and from edge 9
    expect(triggerEdge(g, 1, 100, 20)).toBe(9);
    expect(triggerEdge(g, 1, 90, 2)).toBe(0);
  });

  it("is -1 off every branch, and the corridor's half-width is on", () => {
    const g = sandbox();
    expect(triggerEdge(g, 1, 100, -7)).toBe(0); // 7 m from all three: on
    expect(triggerEdge(g, 1, 100, -8)).toBe(-1); // 8 m from the fork, on no branch
    expect(triggerEdge(g, 1, 120, -15)).toBe(-1);
  });

  it("is -1 on the next edge along, which comes within the half-width of a branch at their shared node", () => {
    // (95, 35) is 5 m from edge 9 (the rung 1–7) and 2.8 m from edge 8 (7–0),
    // the detour's leg: a player there is on the leg, not on fork 1's rung,
    // and fork 7 owns the leg.
    const g = sandbox();
    expect(triggerEdge(g, 1, 95, 35)).toBe(-1);
    expect(triggerEdge(g, 7, 95, 35)).toBe(8);
  });

  it("never reads a closed branch as the arrival", () => {
    // The rung 1–7 (edge 9) closed: a player on it is nobody's arrival, and a
    // player on the fork's node arrives by the lowest open edge instead.
    const g = sandbox();
    expect(triggerEdge(g, 1, 100, 20, new Set([9]))).toBe(-1);
    expect(triggerEdge(g, 1, 100, 0, new Set([0]))).toBe(1);
    // Fork 7 from the rung's far end, node 1: on the rung while it is open,
    // on nothing of 7's once it is closed.
    expect(triggerEdge(g, 7, 100, 0)).toBe(9);
    expect(triggerEdge(g, 7, 100, 0, new Set([9]))).toBe(-1);
  });
});

describe("openBranch on the guide", () => {
  it("opens the guide's edge out of a fork reached by the guide's edge in", () => {
    const g = sandbox();
    expect(openBranch(g, guide(), 3, 3)).toBe(5); // 4 → 3, out along the strand to 5
    expect(openBranch(g, guide(), 2, 4)).toBe(7); // 5 → 2, out along the detour to 7
  });

  it("judges the fork like a stray's when the guide's edge out is already closed", () => {
    // 2's detour (edge 7) closed elsewhere: of what is left, only the stem to
    // node 1 reaches the pad without coming back through 2.
    expect(openBranch(sandbox(), guide([7]), 2, 4)).toBe(1);
  });

  it("judges the fork like a stray's when the guide beyond its edge out no longer reaches the pad", () => {
    // Node 7's way on (edge 8) and its rung (edge 9) closed by a cut at 7
    // before the guide came to 2: the detour is still open but leads only to
    // Hollows, so the stem to node 1 opens instead. With the rung alone
    // closed the detour still reaches the pad, and stays the guide's.
    expect(openBranch(sandbox(), guide([8, 9]), 2, 4)).toBe(1);
    expect(openBranch(sandbox(), guide([9]), 2, 4)).toBe(7);
  });
});

describe("openBranch off the guide", () => {
  it("opens the shortest way home on the residual graph", () => {
    // Fork 1 reached from 7 (edge 9): the pad is 100 m by edge 0; edge 1 is
    // 100 m to fork 2 and then 215 m round the detour, past the slack.
    expect(openBranch(sandbox(), guide(), 1, 9)).toBe(0);
  });

  it("prefers, within the slack, the branch that meets the guide sooner", () => {
    // Fork 1 reached from 2 (edge 1). Edge 0 reaches the pad in 100 m and
    // meets the guide there, at 100 m. Edge 9 costs 40 + 107.7 = 147.7 m,
    // within 60 m of it, and meets the guide at node 7 after 40 m: it opens.
    expect(openBranch(sandbox(), guide(), 1, 1)).toBe(9);
    // Fork 2 reached from its dead end (edge 6): the stem to 1 and the pad is
    // 200 m and meets the guide at the pad; the detour is 215.4 m and meets
    // it at 7 after 107.7 m.
    expect(openBranch(sandbox(), guide(), 2, 6)).toBe(7);
  });

  it("takes the cheaper branch once the sooner one is past the slack", () => {
    // Node 7 at z = 70: edge 9 is 70 m and the detour's leg 122.07 m, so edge
    // 9 costs 192.07 m against edge 0's 100 m — 32 m past the slack.
    expect(openBranch(sandbox(70), guide(), 1, 1)).toBe(0);
  });

  it("breaks an exact tie toward the lower edge index", () => {
    // Fork 3 reached up the stem from 2 (edge 2): the crest is a dead end, and
    // the two strands are mirror images — 128.06 m to 5 or 8, then 128.06 m
    // back to fork 2 and 200 m home. With a guide that runs down the stem and
    // touches neither strand, both meet it at 2 after 256.1 m: an exact tie in
    // cost and in rejoin, and the lower index wins.
    const stem: CutRecord = { guide: [4, 3, 2, 7, 0], cuts: new Map(), closed: new Set() };
    expect(openBranch(sandbox(), stem, 3, 2)).toBe(5);
    // With the guide on the lower strand instead, the rejoin decides, not the index.
    const mirror: CutRecord = { guide: [4, 3, 8, 2, 7, 0], cuts: new Map(), closed: new Set() };
    expect(openBranch(sandbox(), mirror, 3, 2)).toBe(11);
  });

  it("never opens a closed edge, and is -1 once every other edge is closed or unreachable", () => {
    const g = sandbox();
    expect(openBranch(g, guide([9]), 1, 1)).toBe(0);
    expect(openBranch(g, guide([0, 9]), 1, 1)).toBe(-1);
    // Both ways into the pad closed: nothing anywhere reaches it.
    expect(openBranch(g, guide([0, 8]), 2, 1)).toBe(-1);
  });

  it("falls back to a way home through the fork for a climber the upper trail hangs on, never a dead end", () => {
    // Fork 2 reached from below (edge 1) with the detour closed: the stem up,
    // both strands and the spur all lead nowhere but back through 2 and down
    // the arrival. Costed that way the strands tie at 456.1 m; the stem up is
    // 600 m, past the slack; the 50 m spur would be cheapest of all at 300 m
    // but is a dead end, and is never a way home. The upper strand meets the
    // guide at 5 in 128.06 m, the lower only at 2 in 256.1 m.
    expect(openBranch(sandbox(), guide([7]), 2, 1)).toBe(4);
  });

  it("never offers the edge two forks share once the first fork closed it", () => {
    const g = sandbox();
    // Fork 3 reached down the strand from 5 (edge 5, the guide's edge OUT, so
    // not the guide case): the shared stem to 2 is 400 m home and meets the
    // guide at 2 in 200 m; the lower strand is 456 m, within the slack, but
    // meets the guide at 2 only after 256 m.
    expect(openBranch(g, guide(), 3, 5)).toBe(2);
    // The same fork after fork 2 closed the shared edge: the lower strand.
    expect(openBranch(g, guide([2]), 3, 5)).toBe(11);
  });
});

describe("forkSpawn on a world without ground", () => {
  it("stands 12 m into the branch, on the bed interpolated between the nodes", () => {
    const w = sandboxWorld();
    // Fork 2 (h 10) up the strand to 5 (h 20), 128.06 m: 12 m in is 0.0937 of the way.
    const s = forkSpawn(w, 2, 4)!;
    expect(dist(s, { x: 200, z: 0 })).toBeCloseTo(12, 9);
    expect(s.x).toBeCloseTo(209.37, 2);
    expect(s.z).toBeCloseTo(7.5, 2);
    expect(s.y).toBeCloseTo(11.837, 3);
    // Down the spur to 6 (h 0), 50 m along −z: 12 m in.
    expect(forkSpawn(w, 2, 6)).toEqual({ x: 200, y: expect.closeTo(8.5, 9), z: -12 });
  });

  it("keeps FORK_SPAWN_CLEAR short of a branch too short for 12 m, and cannot close one under 3 m", () => {
    const spur = (len: number) => hand([{ x: 0, z: 0, h: 0, u: 0 }, { x: len, z: 0, h: len, u: 0 }], [edge(0, 1)], 1, [0]);
    expect(forkSpawn(sandboxWorld(spur(50)), 0, 0)).toEqual({ x: 12, y: expect.closeTo(12.9, 9), z: 0 });
    expect(forkSpawn(sandboxWorld(spur(10)), 0, 0)).toEqual({ x: 9, y: expect.closeTo(9.9, 9), z: 0 });
    expect(forkSpawn(sandboxWorld(spur(3.5)), 0, 0)).toEqual({ x: 2.5, y: expect.closeTo(3.4, 9), z: 0 });
    expect(forkSpawn(sandboxWorld(spur(2.9)), 0, 0)).toBeNull();
  });

  it("steps past a living player standing where it would spawn, and never past the branch's end", () => {
    const w = sandboxWorld();
    const p = spawnPlayer(w);
    p.pos = { x: 200, y: 0.9, z: -12 };
    // Down the spur, a quarter metre at a time, until the player is 2 m off.
    expect(forkSpawn(w, 2, 6)).toEqual({ x: 200, y: expect.closeTo(8.1, 9), z: -14 });
    p.health = 0;
    expect(forkSpawn(w, 2, 6)).toEqual({ x: 200, y: expect.closeTo(8.5, 9), z: -12 });
    // A 14 m branch admits 12 to 13 m; a player at 12.5 m covers all of it.
    const short = hand([{ x: 0, z: 0, h: 0, u: 0 }, { x: 14, z: 0, h: 0, u: 0 }], [edge(0, 1)], 1, [0]);
    const ws = sandboxWorld(short);
    const q = spawnPlayer(ws);
    q.pos = { x: 12.5, y: 0.9, z: 0 };
    expect(forkSpawn(ws, 0, 0)).toBeNull();
    q.pos = { x: 30, y: 0.9, z: 0 };
    expect(forkSpawn(ws, 0, 0)).toEqual({ x: 12, y: 0.9, z: 0 });
  });
});

/**
 * The real forest, one seed throughout, with the timeout the other forest
 * suites carry: the first `createForest` on a seed runs past vitest's 5 s
 * default whenever it shares the machine with them.
 */
const SUITE = { timeout: timeLimit(120_000) };
const seed = seedFromToken("hollow");
// The haunt is off in these: they pin the Hollows alone (haunt.test.ts has the shades).
const forestWorld = () => { const w = createForestWorld(createForest(seed)); w.haunt!.active = false; return w; };
const edgeBetween = (g: TrailGraph, u: number, v: number) =>
  g.edges.findIndex((e) => (e.a === u && e.b === v) || (e.a === v && e.b === u));

describe("the guide on the seed `hollow`", SUITE, () => {
  it("is drawn crest to pad from the world RNG, once, visiting no node twice", () => {
    const w = forestWorld();
    expect(w.cut).toBeNull();
    expect(w.state.rngSeed).toBe(2032433950);
    const rec = drawGuide(w);
    // 2026-09-29: the trail leaves the pad inland, and below node 9 it is
    // another trail. The crest was node 36, the guide 54 nodes and 2013 m,
    // and the world's RNG after it 1201198389.
    expect(w.state.rngSeed).toBe(-1262203094);
    expect(rec.guide[0]).toBe(35);
    expect(rec.guide[rec.guide.length - 1]).toBe(0);
    expect(rec.guide.length).toBe(55);
    expect(new Set(rec.guide).size).toBe(55);
    expect(Math.abs(pathLength(w.trail!, rec.guide) - 1988)).toBeLessThanOrEqual(1);
    expect(rec.cuts.size).toBe(0);
    expect(rec.closed.size).toBe(0);
  });

  it("meets its forks in order and, walked by the rules, closes five edges", () => {
    const w = forestWorld();
    const g = w.trail!;
    // 2026-09-29: [2, 22, 37, 78, 79] before the trail left the pad inland.
    // The pond's loop and the stem above node 9 are where they were, each
    // node and edge numbered one lower: the hub is 21 and the fork above it
    // 36. Below node 9 the stem and its braid are others: the stem's lowest
    // fork is 53, and the forks 77 and 78 share a rung.
    expect(g.forks).toEqual([21, 36, 53, 77, 78]);
    const rec = drawGuide(w);
    const forks: number[] = [];
    const closedInOrder: number[] = [];
    for (let i = 1; i + 1 < rec.guide.length; i++) {
      const n = rec.guide[i]!;
      if (!g.forks.includes(n)) continue;
      forks.push(n);
      const arrival = edgeBetween(g, rec.guide[i - 1]!, n);
      const open = openBranch(g, rec, n, arrival);
      expect(open, `fork ${n}`).toBe(edgeBetween(g, n, rec.guide[i + 1]!));
      for (let ei = 0; ei < g.edges.length; ei++) {
        const e = g.edges[ei]!;
        if ((e.a !== n && e.b !== n) || ei === arrival || ei === open || rec.closed.has(ei)) continue;
        const s = forkSpawn(w, n, ei);
        expect(s, `fork ${n} edge ${ei}`).not.toBeNull();
        expect(isOnCorridor(w, s!.x, s!.z), `fork ${n} edge ${ei}`).toBe(false);
        rec.closed.add(ei);
        closedInOrder.push(ei);
      }
      rec.cuts.set(n, rec.guide[i + 1]!);
    }
    // The guide meets four of the five: it comes down the strand past 78 and
    // joins the stem at 53, below 77.
    expect(forks).toEqual([36, 21, 78, 53]);
    expect(closedInOrder).toEqual([27, 20, 21, 80, 53]);
    expect([...rec.cuts]).toEqual([[36, 42], [21, 54], [78, 74], [53, 3]]);
  });

  it("judges a stray's arrival on the residual graph, and a climber's through the fork", () => {
    const w = forestWorld();
    const g = w.trail!;
    const rec = drawGuide(w);
    // Fork 53 is the stem's lowest fork, and the whole trail above hangs on it.
    // Reached from the strand (edge 77), the stem down (edge 3) is the way
    // home; the stem up (edge 53) leads only back through 53. Reached from
    // below by a climber (edge 3), no branch reaches the pad but through 53:
    // the strand to node 76, which is the guide's own way down to the fork,
    // opens over the stem up.
    expect(openBranch(g, rec, 53, 77)).toBe(3);
    expect(openBranch(g, rec, 53, 3)).toBe(77);
    // The hub 21 from the strand, edge 54: the stem down (edge 20), never the loop (edge 36).
    expect(openBranch(g, rec, 21, 54)).toBe(20);
    // Fork 77 from the stem below (edge 5): the rung across to 78 (edge 80), not the stem up (edge 78).
    expect(openBranch(g, rec, 77, 5)).toBe(80);
  });
});

describe("forkSpawn on the seed `hollow`", SUITE, () => {
  it("stands 12 m into every branch of every fork, off the corridor, on the ground", () => {
    const w = forestWorld();
    const g = w.trail!;
    let branches = 0;
    for (const f of g.forks) {
      const node = g.nodes[f]!;
      for (let ei = 0; ei < g.edges.length; ei++) {
        const e = g.edges[ei]!;
        if (e.a !== f && e.b !== f) continue;
        branches++;
        const s = forkSpawn(w, f, ei)!;
        expect(s, `fork ${f} edge ${ei}`).not.toBeNull();
        expect(isOnCorridor(w, s.x, s.z), `fork ${f} edge ${ei}`).toBe(false);
        // Fork 36's loop edge 41 is 9.97 m long: its spawn stands a metre
        // short of the far node, rounded down to a sample, 8.75 m in.
        expect(Math.abs(dist(s, node) - (f === 36 && ei === 41 ? 9 : 12)), `fork ${f} edge ${ei}`).toBeLessThanOrEqual(0.3);
        expect(s.y, `fork ${f} edge ${ei}`).toBeCloseTo(elevationAt(seed, s.x, s.z) + 0.9, 9);
      }
    }
    expect(branches).toBe(16);
  });

  it("moves 2 m past a player standing 12 m down the branch", () => {
    const w = forestWorld();
    const g = w.trail!;
    const fork = g.nodes[36]!;
    const clear = forkSpawn(w, 36, 27)!;
    expect(dist(clear, fork)).toBeCloseTo(12, 9);
    // The player stands 11.9 m along the bed of edge 27, which runs 15.95 m
    // from fork 36 to node 27: a spawn at 12 m is on them, and the first
    // sample 2 m clear of them is 14 m in.
    const far = g.nodes[27]!;
    const len = dist(fork, far);
    const p = spawnPlayer(w);
    p.pos = { x: fork.x + (far.x - fork.x) * (11.9 / len), y: clear.y, z: fork.z + (far.z - fork.z) * (11.9 / len) };
    const moved = forkSpawn(w, 36, 27)!;
    expect(dist(moved, p.pos)).toBeGreaterThanOrEqual(2);
    expect(dist(moved, fork)).toBeCloseTo(14, 9);
  });

  it("stops a metre short of the corridor, and cannot close a branch that enters it at once", () => {
    const w = forestWorld();
    const g = w.trail!;
    const roadX = activeTerrainVariant().roadCenterX!(seed, 0);
    // A synthetic fork `out` metres east of the corridor's edge, with a branch
    // running straight west to a node `inside` metres past that edge, on the
    // road; the graph's own nodes are untouched.
    const branch = (out: number, inside: number) => {
      const a = { x: roadX + 30 + out, z: 0, h: elevationAt(seed, roadX + 30 + out, 0), u: 0 };
      const b = { x: roadX + 30 - inside, z: 0, h: elevationAt(seed, roadX + 30 - inside, 0), u: 0 };
      const nodes = [...g.nodes, a, b];
      const edges = [...g.edges, edge(nodes.length - 2, nodes.length - 1)];
      w.trail = { ...g, nodes, edges };
      const s = forkSpawn(w, nodes.length - 2, edges.length - 1);
      return s === null ? null : { in: a.x - s.x, onCorridor: isOnCorridor(w, s.x, s.z) };
    };
    // 8.1 m out: the first sample on the corridor is 8.25 m in, so the spawn stands 7.25 m in.
    expect(branch(8.1, 20)).toEqual({ in: expect.closeTo(7.25, 9), onCorridor: false });
    // 1.6 m out: the first sample on the corridor is 1.75 m in, leaving 0.75 m — under FORK_SPAWN_MIN.
    expect(branch(1.6, 20)).toBeNull();
    // A fork standing on the corridor itself.
    expect(branch(-10, 20)).toBeNull();
    // A 12.6 m branch whose far node stands 1.05 m inside the corridor: the
    // branch's end would cap the spawn at 11.6 m, between samples and 0.05 m
    // from safe ground. The end rounds down to the 11.5 m sample, and the
    // corridor, first seen at 11.75 m, pulls the spawn back to 10.75 m.
    expect(branch(11.55, 1.05)).toEqual({ in: expect.closeTo(10.75, 9), onCorridor: false });
  });
});

/**
 * The cut in the tick: the flip draws the guide, and every Chase tick judges
 * the forks. The player is teleported, and every approach stands on the
 * fork's in-edge FORK_CUT_RADIUS − 1 m short of it for one tick before the
 * node, because on the node every incident edge ties at distance 0. The
 * last three cases drive a player with real input instead.
 */
describe("the cut in the tick", SUITE, () => {
  const tick = (w: World, n = 1) => { for (let i = 0; i < n; i++) tickWorld(w, new Map()); };
  /** A player's position standing on the bed `metres` along the edge from node `from` toward node `to`. */
  const along = (w: World, from: number, to: number, metres: number) => {
    const g = w.trail!;
    const a = g.nodes[from]!, b = g.nodes[to]!;
    const len = dist(a, b);
    const x = a.x + (b.x - a.x) * (metres / len), z = a.z + (b.z - a.z) * (metres / len);
    return { x, y: w.ground!.heightAt(x, z) + 0.9, z };
  };
  const onNode = (w: World, n: number) => along(w, n, n === 0 ? 1 : 0, 0);
  /** The flip: a player at the body, one tick — the scene, the summit Hollow, the guide; then the reveal's seconds, and the chase. */
  const chase = (token = "hollow") => {
    const w = createForestWorld(createForest(seedFromToken(token)));
    w.haunt!.active = false;
    const p = spawnPlayer(w);
    const body = w.search!.body.pos;
    p.pos = { x: body.x - 5, y: w.ground!.heightAt(body.x - 5, body.z) + 0.9, z: body.z };
    tick(w);
    expect(w.state.phase).toBe(Phase.Scene);
    expect(w.state.enemies.size).toBe(1);
    tick(w, Math.round(SUMMIT_REVEAL_S / TICK_DT) + 2);
    expect(w.state.phase).toBe(Phase.Chase);
    return { w, p };
  };
  /** The node the guide reaches `fork` from. */
  const before = (w: World, fork: number) => { const g = w.cut!.guide; return g[g.indexOf(fork) - 1]!; };
  /** Every Hollow but the summit's, in id order. */
  const forkHollows = (w: World) => [...w.state.enemies.values()].slice(1);
  /** The Hollow's centre over the bed FORK_MOUTH_DIST in from `fork` along edge `ei`: its branch's mouth. */
  const mouthAt = (w: World, fork: number, ei: number) => {
    const e = w.trail!.edges[ei]!;
    const at = along(w, fork, e.a === fork ? e.b : e.a, 3);
    return { x: at.x, y: expect.closeTo(at.y, 9), z: at.z };
  };
  const onEdge = (w: World, ei: number, at: { x: number; z: number }) => {
    const g = w.trail!;
    const e = g.edges[ei]!;
    return segmentDistance(g.nodes[e.a]!.x, g.nodes[e.a]!.z, g.nodes[e.b]!.x, g.nodes[e.b]!.z, at.x, at.z);
  };

  it("draws the guide on the flip, and keeps the one it drew", () => {
    const w = forestWorld();
    const p = spawnPlayer(w);
    tick(w, 3);
    expect(w.cut).toBeNull();
    const body = w.search!.body.pos;
    p.pos = { x: body.x - 5, y: w.ground!.heightAt(body.x - 5, body.z) + 0.9, z: body.z };
    tick(w);
    expect(w.state.phase).toBe(Phase.Scene);
    const rec = w.cut!;
    expect(rec.guide[0]).toBe(35);
    expect(rec.guide[rec.guide.length - 1]).toBe(0);
    expect(rec.guide.length).toBe(55);
    expect(rec.cuts.size).toBe(0);
    expect(rec.closed.size).toBe(0);
    tick(w, 5);
    expect(w.cut).toBe(rec);
  });

  it("cuts fork 36 the first tick a living, unsafe player is 12 m up its guide branch, not at 16 m, and only once", () => {
    const { w, p } = chase();
    const g = w.trail!;
    // The guide reaches 36 from 28 by edge 35, 56.7 m long.
    expect(before(w, 36)).toBe(28);
    expect(edgeBetween(g, 28, 36)).toBe(35);
    p.pos = along(w, 36, 28, 16);
    tick(w);
    expect(p.safe).toBe(false);
    expect(w.cut!.cuts.size).toBe(0);
    expect(w.state.enemies.size).toBe(1);
    p.pos = along(w, 36, 28, 12);
    tick(w);
    expect([...w.cut!.cuts]).toEqual([[36, 42]]);
    expect([...w.cut!.closed]).toEqual([27]);
    expect(w.state.enemies.size).toBe(2);
    // Judged once: on the node, where every branch ties, and after it, nothing more.
    p.pos = onNode(w, 36);
    tick(w, 3);
    expect(w.cut!.cuts.size).toBe(1);
    expect(w.cut!.closed.size).toBe(1);
    expect(w.state.enemies.size).toBe(2);
  });

  it("closes edge 27 at fork 36 with one Hollow stepping out of it toward its mouth", () => {
    const { w, p } = chase();
    const node = w.trail!.nodes[36]!;
    p.pos = along(w, 36, 28, 8);
    tick(w);
    const hs = forkHollows(w);
    expect(hs).toHaveLength(1);
    const h = hs[0]!;
    expect(h.ai).toBe(AiState.Emerge);
    expect(h.targetId).toBe(p.id);
    expect(h.stateTimer).toBe(6);
    expect(h.emergeTo).toEqual(mouthAt(w, 36, 27));
    expect(dist(h.emergeTo!, node)).toBeCloseTo(3, 9);
    expect(onEdge(w, 27, h.emergeTo!)).toBeCloseTo(0, 9);
    expect(isOnCorridor(w, h.pos.x, h.pos.z)).toBe(false);
    expect(dist(h.pos, node)).toBeCloseTo(12, 9);
    expect(onEdge(w, 27, h.pos)).toBeCloseTo(0, 9);
    expect(h.pos.y).toBeCloseTo(w.ground!.heightAt(h.pos.x, h.pos.z) + 0.9, 9);
    // And it walks: a second later it is well on its way to the mouth.
    tick(w, 60);
    expect(h.ai).toBe(AiState.Emerge);
    expect(dist(h.pos, node)).toBeLessThan(8);
  });

  it("takes the nearest player on a branch as the trigger, ties to the lower id", () => {
    const near = chase();
    const q = spawnPlayer(near.w);
    near.p.pos = along(near.w, 36, 28, 8);
    q.pos = along(near.w, 36, 28, 5);
    tick(near.w);
    expect(forkHollows(near.w).map((h) => h.targetId)).toEqual([q.id]);
    const tie = chase();
    const r = spawnPlayer(tie.w);
    tie.p.pos = along(tie.w, 36, 28, 8);
    r.pos = along(tie.w, 36, 28, 8);
    tick(tie.w);
    expect(forkHollows(tie.w).map((h) => h.targetId)).toEqual([tie.p.id]);
  });

  it("closes two branches at the hub 21, with a Hollow in each", () => {
    const { w, p } = chase();
    const g = w.trail!;
    // The guide reaches 21 from 37 by edge 36, 22.8 m long.
    expect(before(w, 21)).toBe(37);
    expect(edgeBetween(g, 37, 21)).toBe(36);
    p.pos = along(w, 21, 37, 8);
    tick(w);
    expect([...w.cut!.cuts]).toEqual([[21, 54]]);
    expect([...w.cut!.closed]).toEqual([20, 21]);
    const hs = forkHollows(w);
    expect(hs).toHaveLength(2);
    const node = g.nodes[21]!;
    for (const h of hs) {
      expect(h.ai).toBe(AiState.Emerge);
      expect(h.targetId).toBe(p.id);
      expect(isOnCorridor(w, h.pos.x, h.pos.z)).toBe(false);
      expect(dist(h.pos, node)).toBeCloseTo(12, 9);
    }
    // One in each closed branch, in edge order, each bound for its own branch's mouth.
    expect(onEdge(w, 20, hs[0]!.pos)).toBeCloseTo(0, 9);
    expect(onEdge(w, 21, hs[1]!.pos)).toBeCloseTo(0, 9);
    expect(hs[0]!.emergeTo).toEqual(mouthAt(w, 21, 20));
    expect(hs[1]!.emergeTo).toEqual(mouthAt(w, 21, 21));
    p.pos = onNode(w, 21);
    tick(w, 3);
    expect(w.cut!.cuts.size).toBe(1);
    expect(w.state.enemies.size).toBe(3);
  });

  it("judges two forks reached on one tick in node order, the second on the first's residual graph", () => {
    // Forks 77 and 78 share the rung, edge 80. p arrives at 77 from below by
    // the stem (edge 5) and q at 78 along the guide from 73 (edge 74), on the
    // same tick. Judged first, 77 opens the rung across to 78 (edge 80) and
    // closes the stem up (edge 78); 78 then keeps its guide way out, the
    // strand down to 74 (edge 79), and closes its remaining branch, which is
    // the rung 77 just opened. The Hollow in 77's branch and the one in 78's
    // each hunt their own trigger.
    const { w, p } = chase();
    const g = w.trail!;
    const q = spawnPlayer(w);
    expect(edgeBetween(g, 5, 77)).toBe(5);
    expect(edgeBetween(g, 77, 78)).toBe(80);
    expect(before(w, 78)).toBe(73);
    expect(edgeBetween(g, 73, 78)).toBe(74);
    p.pos = along(w, 77, 5, 8);
    q.pos = along(w, 78, 73, 8);
    tick(w);
    expect([...w.cut!.cuts]).toEqual([[77, 78], [78, 74]]);
    expect([...w.cut!.closed]).toEqual([78, 80]);
    const hs = forkHollows(w);
    expect(hs.map((h) => h.targetId)).toEqual([p.id, q.id]);
    expect(onEdge(w, 78, hs[0]!.pos)).toBeCloseTo(0, 9);
    expect(onEdge(w, 80, hs[1]!.pos)).toBeCloseTo(0, 9);
  });

  it("triggers nothing for a player near a fork but on none of its branches", () => {
    const { w, p } = chase();
    const g = w.trail!;
    const node = g.nodes[36]!;
    // 8 m west of fork 36, inside the radius: none of its three branches
    // comes within 7 m of the point — beside the fork, in the woods.
    p.pos = { x: node.x - 8, y: w.ground!.heightAt(node.x - 8, node.z) + 0.9, z: node.z };
    tick(w);
    expect(p.safe).toBe(false);
    expect(dist(p.pos, node)).toBeCloseTo(8, 9);
    for (let ei = 0; ei < g.edges.length; ei++) {
      const e = g.edges[ei]!;
      if (e.a === 36 || e.b === 36) expect(onEdge(w, ei, p.pos), `edge ${ei}`).toBeGreaterThan(7);
    }
    expect(triggerEdge(g, 36, p.pos.x, p.pos.z)).toBe(-1);
    expect(w.cut!.cuts.size).toBe(0);
    expect(w.state.enemies.size).toBe(1);
  });

  it("triggers nothing for a dead player on the branch", () => {
    const { w, p } = chase();
    const q = spawnPlayer(w);
    q.health = 0;
    q.pos = along(w, 36, 28, 8);
    tick(w);
    // The match goes on: p is alive at the crest, out of every fork's reach.
    expect(w.state.outcome).toBe(Outcome.Playing);
    expect(p.health).toBe(100);
    expect(w.cut!.cuts.size).toBe(0);
    expect(w.state.enemies.size).toBe(1);
  });

  it("never cuts a fork on the corridor, and a safe player never triggers one", () => {
    // 2026-09-29: this was tried on the world `hollow29`, whose fork 1 stood
    // on the corridor. The shore is closed to the trail's search now, but
    // for the doorway inland of the pad, and that world has no fork at all.
    // The rule stands, and is tried on a fork hung on the corridor by hand:
    // 8 m from the road's centreline and 40 m along it from the pad, with a
    // branch each way along the road and one inland, which leaves the
    // corridor after 22 m.
    const { w, p } = chase();
    const g = w.trail!;
    const at = (u: number, z: number): TrailNode => {
      const x = activeTerrainVariant().roadCenterX!(seed, z) + u;
      return { x, z, h: elevationAt(seed, x, z), u };
    };
    const fork = g.nodes.length;
    const nodes = [...g.nodes, at(8, 40), at(8, 80), at(8, 10), at(60, 40)];
    const edges = [...g.edges, edge(fork, fork + 1), edge(fork, fork + 2), edge(fork, fork + 3)];
    w.trail = { ...g, nodes, edges, forks: [...g.forks, fork] };
    const node = nodes[fork]!;
    expect(isOnCorridor(w, node.x, node.z)).toBe(true);
    // A second player stays out at the crest, far from every fork, so the
    // match goes on while p stands on safe ground.
    const q = spawnPlayer(w);
    q.pos = { ...p.pos };
    // Its branch to the north runs along the road: 8 m out is safe ground,
    // and a safe player is nobody's trigger — the fork is not even judged.
    p.pos = along(w, fork, fork + 1, 8);
    tick(w);
    expect(p.safe).toBe(true);
    expect(w.state.outcome).toBe(Outcome.Playing);
    expect(w.cut!.cuts.size).toBe(0);
    // Its branch inland leaves the corridor after 22 m, well past the
    // trigger's 9: nobody within reach of this fork is ever prey. Were one —
    // a corridor fork within nine metres of the treeline — the fork is
    // recorded with nothing closed and no Hollow on safe ground: the rule
    // run by hand, the player marked prey where they stand.
    p.pos = along(w, fork, fork + 3, 8);
    tick(w);
    expect(p.safe).toBe(true);
    expect(w.cut!.cuts.size).toBe(0);
    p.safe = false;
    stepCuts(w);
    expect([...w.cut!.cuts]).toEqual([[fork, -1]]);
    expect(w.cut!.closed.size).toBe(0);
    expect(w.state.enemies.size).toBe(1);
    tick(w, 3);
    expect(w.state.enemies.size).toBe(1);
  });

  it("never cuts on a client's world", () => {
    const w = createForestWorld(createForest(seed), false);
    const p = spawnPlayer(w);
    const body = w.search!.body.pos;
    p.pos = { x: body.x - 5, y: w.ground!.heightAt(body.x - 5, body.z) + 0.9, z: body.z };
    tick(w);
    expect(w.state.phase).toBe(Phase.Climb);
    expect(w.cut).toBeNull();
    // Handed the host's state, it still never judges a fork.
    w.state.phase = Phase.Chase;
    w.cut = drawGuide(w);
    p.pos = along(w, 36, 28, 8);
    tick(w, 3);
    expect(w.cut.cuts.size).toBe(0);
    expect(w.state.enemies.size).toBe(0);
    // Only the tick refuses it: the rule itself does not read the flag.
    stepCuts(w);
    expect(w.cut.cuts.size).toBe(1);
  });

  it("leaves a branch with no room for a Hollow open, and out of the count", () => {
    const { w, p } = chase();
    const g = w.trail!;
    const node = g.nodes[36]!;
    // A 2.9 m spur hung on fork 36: a metre short of its end leaves 1.75 m,
    // under FORK_SPAWN_MIN, so no Hollow can step out of it.
    const spur = { x: node.x, z: node.z + 2.9, h: node.h, u: node.u };
    w.trail = { ...g, nodes: [...g.nodes, spur], edges: [...g.edges, edge(36, g.nodes.length)] };
    expect(forkSpawn(w, 36, g.edges.length)).toBeNull();
    p.pos = along(w, 36, 28, 8);
    tick(w);
    expect([...w.cut!.cuts]).toEqual([[36, 42]]);
    expect([...w.cut!.closed]).toEqual([27]);
    expect(w.state.enemies.size).toBe(2);
  });

  /**
   * A player driven by real input down the guide through fork 36: in by edge
   * 35 from 10 m out, aimed at the node, then at node 42 down edge 41. The
   * summit Hollow is removed after the flip so the only Hollow is the fork's.
   * Returns the tick the cut fired, the first tick the Hollow was behind the
   * player (farther from node 42 than they are) once they had passed the node,
   * the first tick it hunted, and the tick the player was touched, each
   * counted from the drive's first tick; -1 for what never came.
   */
  const drive = (mode: "sprint" | "walk" | "stop") => {
    const { w, p } = chase();
    const g = w.trail!;
    w.state.enemies.clear();
    const fork = g.nodes[36]!, next = g.nodes[42]!;
    p.pos = along(w, 36, 28, 10);
    let cut = -1, passed = -1, behind = -1, hunt = -1, touched = -1;
    let target = fork, moving = true;
    for (let t = 1; t <= 300 && touched < 0 && (mode === "stop" || hunt < 0 || t <= hunt + 1); t++) {
      if (mode === "stop" && dist(p.pos, fork) < 0.5) moving = false;
      // The one atan2 here is the test's own aim, not the sim's.
      const yaw = Math.atan2(target.x - p.pos.x, target.z - p.pos.z);
      tickWorld(w, new Map([[p.id, { seq: t, moveX: 0, moveZ: moving ? 1 : 0, yaw, pitch: 0.2, buttons: mode === "sprint" ? Button.Sprint : 0 }]]));
      if (cut < 0 && w.cut!.cuts.size > 0) cut = t;
      if (passed < 0 && dist(p.pos, fork) < 1) { passed = t; target = next; }
      const h = forkHollows(w)[0] ?? [...w.state.enemies.values()][0];
      if (h !== undefined && passed >= 0 && behind < 0 && dist(h.pos, next) > dist(p.pos, next)) behind = t;
      if (h !== undefined && hunt < 0 && h.ai === AiState.Hunt) hunt = t;
      if (p.health <= 0) touched = t;
    }
    return { cut, passed, behind, hunt, touched, health: p.health, cuts: [...w.cut!.cuts] };
  };

  // The arithmetic behind the three cases below, measured on the terrain:
  // the cut fires at 14 m; the Hollow steps out 12 m down edge 27 and walks
  // 9 m to its mouth, 3 m in — 7.5 m to the 1.5 m waypoint radius at 6.3 m/s
  // is 71 ticks, 77 on the ground — stands 150 (FORK_REVEAL_S 2.5), and hunts
  // 227 ticks after the cut. A sprinter (7 m/s) is on the node 80 ticks after
  // the cut, a walker (5.25 m/s) 106; both are down edge 41 before the Hollow
  // stands, and it is behind them from the moment they are farther down that
  // edge than its mouth is: 107 ticks after the cut for the sprinter, 142 for
  // the walker. The fork was cut at 9 m with a 1 s stand as first built; the
  // buffer is the haunt's (docs/gameplay/2026-10-06-the-haunt.md §3).

  it("a sprinter through fork 36 passes the node alive and has the Hollow behind them before it hunts", () => {
    const r = drive("sprint");
    expect(r.cuts).toEqual([[36, 42]]);
    expect(r.passed - r.cut).toBe(80);
    expect(r.behind - r.cut).toBe(107);
    expect(r.hunt - r.cut).toBe(227);
    expect(r.touched).toBe(-1);
    expect(r.health).toBe(100);
  });

  it("a walker through fork 36 passes the node alive too, the Hollow behind them as it starts to hunt", () => {
    const r = drive("walk");
    expect(r.cuts).toEqual([[36, 42]]);
    expect(r.passed - r.cut).toBe(106);
    expect(r.behind - r.cut).toBe(142);
    expect(r.hunt - r.cut).toBe(227);
    expect(r.touched).toBe(-1);
    expect(r.health).toBe(100);
  });

  it("a player who stops on fork 36 is touched from its mouth, 3 m away, once it hunts", () => {
    // Standing at the node, 3 m from the mouth: the hunt closes the 2.1 m to
    // contact reach from a standstill, 38 ticks after it starts.
    const r = drive("stop");
    expect(r.cuts).toEqual([[36, 42]]);
    expect(r.hunt - r.cut).toBe(227);
    expect(r.touched - r.cut).toBe(265);
    expect(r.health).toBe(0);
  });
});
