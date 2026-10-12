/**
 * The trail of a world, rebuilt from its seed for the admin page's drawing.
 *
 * The world is deterministic from the seed and the sim is plain TypeScript,
 * so the page can build the trail graph itself — the same code the game
 * runs, about half a second — and draw the players' samples over the trail
 * they walked, with the forks and the named places. Built in a worker
 * (`trail.worker.ts`) so the page stays responsive; the result is the plain
 * shape below, which crosses the worker boundary as a message.
 *
 * A world version names its generator (`forest/<gen>/<variant>/...`): a
 * trail drawn by this build for a session on another generation may differ,
 * and the page says so beside the drawing.
 */

import "../sim/passes/index.js";
import { GEN_VERSION } from "../sim/forest.js";
import { hikerNames } from "../sim/hikerNames.js";
import { placeNames } from "../sim/placeNames.js";
import { activeTerrainVariant, setActiveTerrainVariant, terrainVariantNames } from "../sim/terrain.js";

export type DrawableTrail = {
  nodes: { x: number; z: number }[];
  edges: { a: number; b: number; kind: string }[];
  forks: number[];
  /** Edge indices, pad to crest, in order. */
  stem: number[];
  trailhead: { x: number; z: number };
  summit: number;
  features: { id: number; kind: string; x: number; z: number; radius: number; name: string }[];
  stemLen: number;
};

/** The generation and the terrain variant a world version names, or null for one of another shape. */
export function parseWorld(world: string): { gen: number; variant: string } | null {
  const parts = world.split("/");
  if (parts.length < 3 || parts[0] !== "forest") return null;
  const gen = Number(parts[1]);
  const variant = parts[2] ?? "";
  return Number.isFinite(gen) && variant !== "" ? { gen, variant } : null;
}

/** Whether this build's generator is the one the world version names. */
export function sameGeneration(world: string): boolean {
  return parseWorld(world)?.gen === GEN_VERSION;
}

/** The trail for a world and seed, or null for a variant this build does not have. */
export function buildTrailFor(world: string, seed: number): DrawableTrail | null {
  const parsed = parseWorld(world);
  if (parsed === null || !terrainVariantNames().includes(parsed.variant)) return null;
  setActiveTerrainVariant(parsed.variant);
  const graph = activeTerrainVariant().trailGraph?.(seed);
  if (graph === undefined) return null;
  const hikerFirst = (hikerNames(seed, 1)[0] ?? "").split(" ")[0] ?? "";
  const names = placeNames(seed, graph.features, hikerFirst);
  return {
    nodes: graph.nodes.map((n) => ({ x: n.x, z: n.z })),
    edges: graph.edges.map((e) => ({ a: e.a, b: e.b, kind: e.kind })),
    forks: [...graph.forks],
    stem: [...graph.stem],
    trailhead: { x: graph.trailhead.x, z: graph.trailhead.z },
    summit: graph.summit,
    features: graph.features.map((f) => ({ id: f.id, kind: f.kind, x: f.x, z: f.z, radius: f.radius, name: names.get(f.id) ?? "" })),
    stemLen: graph.stemLen,
  };
}

/** A worker's request and its answer. */
export type TrailRequest = { world: string; seed: number };
export type TrailAnswer = { world: string; seed: number; trail: DrawableTrail | null };
