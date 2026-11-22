/**
 * One part of a sweep's seeds, for a sweep split across test files so each
 * part runs on a worker of its own: a sweep over hundreds of worlds is one
 * test, and vitest hands out files, not tests, so one long file sets the
 * floor under the whole suite however many workers or shards it has. Part
 * `part` (from 1) of `parts` takes every `parts`-th seed from the `part`-th
 * on, so each part draws from the whole list (`trailGateSeeds.ts`'s three
 * kinds alike), and the parts together are the list, each seed once.
 */
export function seedPart<T>(seeds: readonly T[], part: number, parts: number): T[] {
  if (!Number.isInteger(parts) || parts < 1 || !Number.isInteger(part) || part < 1 || part > parts) {
    throw new Error(`no part ${part} of ${parts}`);
  }
  return seeds.filter((_, i) => i % parts === part - 1);
}
