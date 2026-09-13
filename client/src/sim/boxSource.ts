import type { Vec3 } from "./types.js";
import type { Aabb } from "./level.js";

/**
 * A spatial source of collision boxes. `near` returns everything that could
 * overlap the region — it may over-report, never under-report.
 *
 * Implementations are free to return a reused scratch buffer, so callers must
 * iterate it immediately and must never retain it across a second query.
 */
export type BoxSource = {
  near(min: Vec3, max: Vec3): readonly Aabb[];
};

/**
 * Either a whole level's box list or a spatial source.
 *
 * A union rather than an interface with two implementations, purely so that
 * every existing caller passing a plain array keeps compiling. Hand-authored
 * levels have a dozen brushes and gain nothing from a broadphase.
 */
export type BoxProvider = readonly Aabb[] | BoxSource;

export function boxesNear(p: BoxProvider, min: Vec3, max: Vec3): readonly Aabb[] {
  // Array.isArray widens a readonly array to any[], hence the cast back.
  return Array.isArray(p) ? (p as readonly Aabb[]) : (p as BoxSource).near(min, max);
}
