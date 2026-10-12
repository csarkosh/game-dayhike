import { describe, it, expect } from "vitest";
import { createTrace, FORK_RADIUS, forkAt, nearestEdge, placeAt, TRACE_EVERY_TICKS, type TraceFrame } from "../../src/game/trace.js";
import type { TrailGraph } from "../../src/sim/trail.js";
import type { PlayerState } from "../../src/sim/types.js";

// A graph by hand: a stem of three nodes along -z with a fork at node 1,
// where a loop edge leaves to node 3 and comes back to node 2.
//
//   0 (0,0) ── 1 (0,-100) ── 2 (0,-200)
//               \ 3 (60,-150) /
const GRAPH = {
  nodes: [
    { x: 0, z: 0, h: 0, u: 0 },
    { x: 0, z: -100, h: 0, u: 0 },
    { x: 0, z: -200, h: 0, u: 0 },
    { x: 60, z: -150, h: 0, u: 0 },
  ],
  edges: [
    { a: 0, b: 1, kind: "stem", profile: new Float64Array(0), progress0: 0, progress1: 0.5 },
    { a: 1, b: 2, kind: "stem", profile: new Float64Array(0), progress0: 0.5, progress1: 1 },
    { a: 1, b: 3, kind: "loop", profile: new Float64Array(0), progress0: 0.5, progress1: 0.5 },
    { a: 3, b: 2, kind: "loop", profile: new Float64Array(0), progress0: 0.5, progress1: 0.5 },
  ],
  trailhead: { x: 0, z: 0, u: 0 },
  summit: 2,
  stem: [0, 1],
  loops: [{ kind: "meadow", featureId: 7, edges: [2, 3], junctionA: 1, junctionB: 2 }],
  features: [{ id: 7, kind: "meadow", x: 60, z: -150, radius: 20, rise: 0 }],
  stemLen: 200,
  fallbacks: 0,
  forks: [1, 2],
  homeDist: [0, 100, 200, 178],
  shortestHome: 200,
} as unknown as TrailGraph;

function player(x: number, z: number, over: Partial<{ health: number; lamp: boolean; yaw: number; stare: number }> = {}): PlayerState {
  return {
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: over.yaw ?? 0,
    health: over.health ?? 100,
    lamp: { on: over.lamp ?? false, charge: 1 },
    stare: over.stare ?? 0,
    safe: false,
    deathPos: null,
  } as unknown as PlayerState;
}

const frame = (tick: number, over: Partial<TraceFrame> = {}): TraceFrame => ({ tick, offTrail: 0, lens: 0, near: 0, sprinting: false, progress: 0.3, cuts: null, ...over });

describe("the geometry", () => {
  it("finds the nearest edge, a fork within its radius, and a place's disc", () => {
    expect(nearestEdge(GRAPH, 0, -50)).toEqual({ edge: 0, dist: 0 });
    expect(nearestEdge(GRAPH, 5, -150).edge).toBe(1);
    expect(nearestEdge(GRAPH, 40, -130).edge).toBe(2);
    expect(nearestEdge(GRAPH, 100, -50).dist).toBeCloseTo(100, 5);
    expect(forkAt(GRAPH, 0, -100)).toBe(1);
    expect(forkAt(GRAPH, FORK_RADIUS - 1, -100)).toBe(1);
    expect(forkAt(GRAPH, FORK_RADIUS + 1, -100)).toBe(-1);
    expect(forkAt(GRAPH, 0, -50)).toBe(-1);
    expect(placeAt(GRAPH.features, 60, -150)?.id).toBe(7);
    expect(placeAt(GRAPH.features, 85, -150)).toBeNull();
  });
});

describe("createTrace", () => {
  it("samples every two seconds only once the player has moved, and names the route's transitions once each", () => {
    const names = new Map([[7, "Old Meadow"]]);
    const trace = createTrace(GRAPH, names);
    // The first sample: at the trailhead, on edge 0, nothing else.
    const first = trace.step(player(0, -2), frame(0));
    expect(first.map((e) => e.n)).toEqual(["pos", "edge"]);
    expect(first[0]!.fields).toMatchObject({ tick: 0, x: 0, z: -2, hp: 100, lamp: false, p: 0.3 });
    expect(first[1]!.fields).toMatchObject({ edge: 0, kind: "stem", a: 0, b: 1 });
    // Not due yet: one compare, nothing.
    expect(trace.step(player(0, -50), frame(TRACE_EVERY_TICKS - 1))).toEqual([]);
    // Due, but the player stood still: nothing.
    expect(trace.step(player(0, -2.5), frame(TRACE_EVERY_TICKS))).toEqual([]);
    // At the fork: a sample and the fork, same edge so no edge row.
    const atFork = trace.step(player(0, -100), frame(2 * TRACE_EVERY_TICKS));
    expect(atFork.map((e) => e.n)).toEqual(["pos", "fork"]);
    expect(atFork[1]!.fields).toMatchObject({ node: 1 });
    // Onto the loop and into the meadow: the edge changes, the fork is left, the place is entered by name.
    const onLoop = trace.step(player(50, -140), frame(3 * TRACE_EVERY_TICKS, { sprinting: true }));
    expect(onLoop.map((e) => e.n)).toEqual(["pos", "edge", "place"]);
    expect(onLoop[0]!.fields).toMatchObject({ sprint: true });
    expect(onLoop[1]!.fields).toMatchObject({ edge: 2, kind: "loop" });
    expect(onLoop[2]!.fields).toMatchObject({ id: 7, kind: "meadow", name: "Old Meadow", in: true });
    // Out of the meadow and off the trail: the place is left, and the trail.
    // (Still nearest to the loop's first edge, so no edge row.)
    const away = trace.step(player(120, -150), frame(4 * TRACE_EVERY_TICKS, { offTrail: 0.6 }));
    expect(away.map((e) => e.n)).toEqual(["pos", "place", "offtrail"]);
    expect(away[1]!.fields).toMatchObject({ id: 7, in: false });
    // Back on it: ontrail once, and the same edge is not announced again.
    const back = trace.step(player(3, -180), frame(5 * TRACE_EVERY_TICKS));
    expect(back.map((e) => e.n)).toEqual(["pos", "edge", "ontrail"]);
    expect(back[1]!.fields).toMatchObject({ edge: 1 });
  });

  it("reports the lamp and the chase's cuts whether or not the player moved", () => {
    const trace = createTrace(GRAPH, new Map());
    trace.step(player(0, -2), frame(0));
    // Still, lamp on: one lamp row and nothing else.
    expect(trace.step(player(0, -2), frame(TRACE_EVERY_TICKS))).toEqual([]);
    const lampOn = trace.step(player(0, -2, { lamp: true }), frame(2 * TRACE_EVERY_TICKS));
    expect(lampOn).toEqual([{ n: "lamp", fields: { tick: 2 * TRACE_EVERY_TICKS, on: true, p: 0.3 } }]);
    // The host's cuts, each once, in the order they were made.
    const cuts = new Map<number, number>([[1, 3]]);
    const cut1 = trace.step(player(0, -2, { lamp: true }), frame(3 * TRACE_EVERY_TICKS, { cuts }));
    expect(cut1).toEqual([{ n: "cut", fields: { tick: 3 * TRACE_EVERY_TICKS, node: 1, open: 3 } }]);
    cuts.set(2, -1);
    const cut2 = trace.step(player(0, -2, { lamp: true }), frame(4 * TRACE_EVERY_TICKS, { cuts }));
    expect(cut2).toEqual([{ n: "cut", fields: { tick: 4 * TRACE_EVERY_TICKS, node: 2, open: -1 } }]);
    expect(trace.step(player(0, -2, { lamp: true }), frame(5 * TRACE_EVERY_TICKS, { cuts }))).toEqual([]);
  });

  it("samples without a graph, naming no route", () => {
    const trace = createTrace(null, new Map());
    expect(trace.step(player(3, 4), frame(0)).map((e) => e.n)).toEqual(["pos"]);
  });
});
