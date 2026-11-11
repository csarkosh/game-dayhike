import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { raycastGround } from "../../src/sim/collision.js";
import { GROUND_RAY_REFINEMENTS, GROUND_RAY_STEP } from "../../src/sim/constants.js";
import type { GroundField } from "../../src/sim/ground.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

/** A small deterministic generator, so the rays are the same every run. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The march as it was before the field answered for a point (to 2026-11-09): the sign of the ray's
 * height less the ground's, the whole height asked at every step and every halving.
 */
function byHeights(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, maxDist: number, ground: GroundField): number | null {
  const gapAt = (t: number): number => origin.y + dir.y * t - ground.heightAt(origin.x + dir.x * t, origin.z + dir.z * t);
  if (gapAt(0) <= 0) return 0;
  let previous = 0;
  for (let t = GROUND_RAY_STEP; previous < maxDist; t += GROUND_RAY_STEP) {
    const capped = t > maxDist ? maxDist : t;
    if (gapAt(capped) > 0) {
      previous = capped;
      continue;
    }
    let above = previous;
    let below = capped;
    for (let i = 0; i < GROUND_RAY_REFINEMENTS; i++) {
      const mid = (above + below) / 2;
      if (gapAt(mid) > 0) above = mid;
      else below = mid;
    }
    return below;
  }
  return null;
}

describe("the ground ray by the field's own test of a point", { timeout: timeLimit(240_000) }, () => {
  const world = createForestWorld(createForest(seedFromToken("atmo")));
  const ground = world.ground!;
  const body = world.search!.body.pos;

  it("says a point is above the ground exactly where its height says so, the rock's layer asked or not", () => {
    const rand = mulberry(7);
    let over = 0;
    let under = 0;
    for (let i = 0; i < 4000; i++) {
      const x = body.x - 140 * rand() + 20;
      const z = body.z + 100 * (rand() - 0.5);
      const h = ground.heightAt(x, z);
      // Around the surface, where the layer decides, and well clear of it either way.
      const y = h + (i % 4 === 0 ? 6 * (rand() - 0.5) : 0.02 * (rand() - 0.5));
      const expected = y - h > 0;
      expect(ground.above!(x, y, z)).toBe(expected);
      if (expected) over++;
      else under++;
    }
    expect(over).toBeGreaterThan(500);
    expect(under).toBeGreaterThan(500);
  });

  it("meets the ground where the ray by heights does, to the bit, on sight lines over rock, trail and forest floor", () => {
    const rand = mulberry(14);
    let hits = 0;
    let clears = 0;
    for (let i = 0; i < 1200; i++) {
      // Sight lines as the game casts them: from an eye a little over the ground to a point a
      // little over it, 3 to 80 m off, around the crest and down the stem.
      const ax = body.x - 120 * rand() + 20 * (rand() - 0.5);
      const az = body.z + 80 * (rand() - 0.5);
      const reach = 3 + 77 * rand();
      const turn = Math.PI * 2 * rand();
      const bx = ax + Math.cos(turn) * reach;
      const bz = az + Math.sin(turn) * reach;
      const from = { x: ax, y: ground.heightAt(ax, az) + 0.2 + 1.6 * rand(), z: az };
      const to = { x: bx, y: ground.heightAt(bx, bz) + 0.2 + 1.6 * rand(), z: bz };
      const d = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2 + (to.z - from.z) ** 2);
      const dir = { x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d };
      const expected = byHeights(from, dir, d, ground);
      expect(raycastGround(from, dir, d, ground)).toBe(expected);
      if (expected === null) clears++;
      else hits++;
    }
    // Both outcomes are in the sample, so the agreement is not of one kind alone.
    expect(hits).toBeGreaterThan(100);
    expect(clears).toBeGreaterThan(100);
  });

  it("tests the same points as the ray by heights, and answers each ray as it does", () => {
    let whole = 0;
    let points = 0;
    const counted: GroundField = {
      ...ground,
      heightAt: (x, z) => ground.heightAt(x, z),
      above: (x, y, z) => {
        points++;
        return ground.above!(x, y, z);
      },
    };
    const plain: GroundField = { heightAt: (x, z) => { whole++; return ground.heightAt(x, z); }, normalAt: ground.normalAt };
    const rand = mulberry(3);
    for (let i = 0; i < 200; i++) {
      const ax = body.x - 100 * rand();
      const az = body.z + 60 * (rand() - 0.5);
      const from = { x: ax, y: ground.heightAt(ax, az) + 1.6, z: az };
      const turn = Math.PI * 2 * rand();
      const dir = { x: Math.cos(turn), y: 0.02, z: Math.sin(turn) };
      expect(raycastGround(from, dir, 40, counted)).toBe(raycastGround(from, dir, 40, plain));
    }
    // The same points either way.
    expect(points).toBe(whole);
  });
});
