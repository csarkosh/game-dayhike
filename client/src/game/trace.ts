/**
 * Where a player went and what they chose, for telemetry: a sample every
 * `TRACE_EVERY_TICKS` of sim time when they have moved, and a row at each
 * transition — the nearest trail edge changing (the route), a fork reached,
 * a named place entered or left, the trail left or regained, the headlamp
 * switched — with nothing computed per frame but one integer compare. The
 * geometry runs on the sample, once every two seconds: a few dozen
 * point-to-segment distances over the trail graph's edges, and a disc test
 * per feature. Pure over the graph and the state, so it is tested on a graph
 * drawn by hand.
 *
 * `sim/` is read here and never written; nothing feeds back.
 */

import type { Feature } from "../sim/features.js";
import type { TrailGraph } from "../sim/trail.js";
import type { PlayerState } from "../sim/types.js";

/** Sim ticks between samples: two seconds at 60 Hz. */
export const TRACE_EVERY_TICKS = 120;
/** Metres a player must have moved for a sample to be worth a row. */
export const TRACE_MIN_MOVE = 1;
/** Metres from a fork node within which the player is "at" it. */
export const FORK_RADIUS = 6;

export type TraceFields = Record<string, string | number | boolean>;

/** What the trace reads of the frame beside the player: the escalation's view of the trail and the Hollow. */
export type TraceFrame = {
  tick: number;
  /** The local player's distance past the corridor, 0 on the trail to 1 well off it. */
  offTrail: number;
  /** The dread lens, 0 to 1. */
  lens: number;
  /** The nearest Hollow's closeness, 0 to 1. */
  near: number;
  sprinting: boolean;
  /** The party's climb, 0 to 1, ratcheted. */
  progress: number;
  /** The forks the chase has cut so far, host only; null elsewhere. */
  cuts: ReadonlyMap<number, number> | null;
};

/** The nearest edge's index, and the distance to it, over straight node-to-node edges. */
export function nearestEdge(graph: TrailGraph, x: number, z: number): { edge: number; dist: number } {
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < graph.edges.length; i++) {
    const e = graph.edges[i]!;
    const a = graph.nodes[e.a]!;
    const b = graph.nodes[e.b]!;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    let t = len2 === 0 ? 0 : ((x - a.x) * abx + (z - a.z) * abz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (a.x + abx * t);
    const dz = z - (a.z + abz * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return { edge: best, dist: Math.sqrt(bestD2) };
}

/** The fork node within `radius` metres, nearest first, or -1. */
export function forkAt(graph: TrailGraph, x: number, z: number, radius: number = FORK_RADIUS): number {
  let best = -1;
  let bestD2 = radius * radius;
  for (const node of graph.forks) {
    const n = graph.nodes[node]!;
    const dx = x - n.x;
    const dz = z - n.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = node;
    }
  }
  return best;
}

/** The feature whose disc holds the point, or null. The peak counts: its dome is the crest's ground. */
export function placeAt(features: readonly Feature[], x: number, z: number): Feature | null {
  for (const f of features) {
    const dx = x - f.x;
    const dz = z - f.z;
    if (dx * dx + dz * dz <= f.radius * f.radius) return f;
  }
  return null;
}

export type TraceEvent = { n: string; fields: TraceFields };

export type Trace = {
  /**
   * One frame: returns the rows due, usually none. Called every frame; costs
   * one compare until the sample is due.
   */
  step(self: PlayerState | undefined, frame: TraceFrame): TraceEvent[];
};

const round = (v: number, places: number): number => {
  const k = 10 ** places;
  return Math.round(v * k) / k;
};

/**
 * The trace for one match, from its trail graph and the names of its places
 * (a feature's id to its name; a place with no name is reported by its kind).
 */
export function createTrace(graph: TrailGraph | null, names: ReadonlyMap<number, string>): Trace {
  let lastTick = -TRACE_EVERY_TICKS;
  let lastX = Number.NaN;
  let lastZ = Number.NaN;
  let edge = -1;
  let fork = -1;
  let place = -1;
  let off = false;
  let lamp: boolean | null = null;
  let cutsSeen = 0;
  const features = graph?.features ?? [];
  return {
    step(self, frame) {
      if (self === undefined || frame.tick - lastTick < TRACE_EVERY_TICKS) return [];
      lastTick = frame.tick;
      const out: TraceEvent[] = [];
      const x = self.pos.x;
      const z = self.pos.z;
      const moved = Number.isNaN(lastX) || Math.hypot(x - lastX, z - lastZ) >= TRACE_MIN_MOVE;

      // The lamp and the cuts are decisions that need no movement.
      if (lamp !== self.lamp.on) {
        if (lamp !== null) out.push({ n: "lamp", fields: { tick: frame.tick, on: self.lamp.on, p: round(frame.progress, 3) } });
        lamp = self.lamp.on;
      }
      if (frame.cuts !== null && frame.cuts.size > cutsSeen) {
        let i = 0;
        for (const [node, open] of frame.cuts) {
          if (i++ < cutsSeen) continue;
          out.push({ n: "cut", fields: { tick: frame.tick, node, open } });
        }
        cutsSeen = frame.cuts.size;
      }
      if (!moved) return out;
      lastX = x;
      lastZ = z;

      out.push({
        n: "pos",
        fields: {
          tick: frame.tick,
          x: round(x, 1),
          z: round(z, 1),
          yaw: round(self.yaw, 2),
          p: round(frame.progress, 3),
          hp: self.health,
          lamp: self.lamp.on,
          sprint: frame.sprinting,
          off: round(frame.offTrail, 2),
          lens: round(frame.lens, 2),
          near: round(frame.near, 2),
          stare: round(self.stare, 2),
        },
      });

      if (graph !== null) {
        const nearest = nearestEdge(graph, x, z);
        if (nearest.edge !== edge) {
          edge = nearest.edge;
          const e = graph.edges[edge];
          if (e !== undefined) out.push({ n: "edge", fields: { tick: frame.tick, edge, kind: e.kind, a: e.a, b: e.b, p: round(frame.progress, 3) } });
        }
        const atFork = forkAt(graph, x, z);
        if (atFork !== fork) {
          fork = atFork;
          if (fork !== -1) out.push({ n: "fork", fields: { tick: frame.tick, node: fork, p: round(frame.progress, 3) } });
        }
        const here = placeAt(features, x, z);
        const id = here === null ? -1 : here.id;
        if (id !== place) {
          if (place !== -1) {
            const left = features.find((f) => f.id === place);
            out.push({ n: "place", fields: { tick: frame.tick, id: place, kind: left?.kind ?? "", name: names.get(place) ?? "", in: false } });
          }
          if (here !== null) out.push({ n: "place", fields: { tick: frame.tick, id, kind: here.kind, name: names.get(id) ?? "", in: true } });
          place = id;
        }
      }

      const offNow = frame.offTrail > 0;
      if (offNow !== off) {
        off = offNow;
        out.push({ n: off ? "offtrail" : "ontrail", fields: { tick: frame.tick, x: round(x, 1), z: round(z, 1), p: round(frame.progress, 3) } });
      }
      return out;
    },
  };
}
