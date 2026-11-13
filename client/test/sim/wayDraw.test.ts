import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForestWorld, type World } from "../../src/sim/world.js";
import { createForest } from "../../src/sim/forest.js";
import { seedFromToken } from "../../src/game/seed.js";
import { DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { GROUND_NORMAL_Y } from "../../src/sim/constants.js";
import { lakeShoreInto, newLakeShore } from "../../src/sim/lakeShape.js";
import type { Vec3 } from "../../src/sim/types.js";
import type { WayDown } from "../../src/sim/wayDown.js";
import {
  WAY_APART_M, WAY_BACK_MAX_M, WAY_LONG_RATIO, WAY_MAX_M, WAY_MAX_RATIO, WAY_MIN_RATIO, WAY_STRAIGHT_MAX_M, WAY_TARGET_M,
  drawWay, drawWayNow, wayTarget,
} from "../../src/sim/wayDraw.js";
import { wayRules } from "./helpers/wayRules.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
const seed = seedFromToken("hollow");
/** One real forest world, built once: the first build runs past vitest's default limit. */
const SUITE = { timeout: timeLimit(120_000) };

describe("the way's aim", () => {
  it("names the design's numbers", () => {
    expect([WAY_TARGET_M, WAY_MAX_RATIO, WAY_MIN_RATIO, WAY_MAX_M, WAY_STRAIGHT_MAX_M, WAY_BACK_MAX_M, WAY_APART_M]).toEqual([840, 2, 1.12, 1150, 40, 10, 25]);
  });

  it("sets the target from the straight line: twice a short one, 840 m, or just over a long one", () => {
    expect(wayTarget(260)).toBe(520);
    expect(wayTarget(500)).toBe(840);
    expect(wayTarget(900)).toBeCloseTo(1008, 6);
  });

  it("winds a very long line less, to keep under the most a way may be while it can", () => {
    expect(wayTarget(1057)).toBe(WAY_MAX_M);
    expect(wayTarget(1200)).toBeCloseTo(WAY_LONG_RATIO * 1200, 6);
  });
});

describe("drawing the way down", SUITE, () => {
  let world: World;
  let way: WayDown;
  beforeAll(() => {
    world = createForestWorld(createForest(seed));
    way = drawWayNow(world) as WayDown;
  }, timeLimit(120_000));

  it("runs from the crest to the pad", () => {
    const g = world.trail!, s = g.nodes[g.summit]!;
    expect(way.fallback).toBe(false);
    expect(Math.hypot(way.xs[0]! - s.x, way.zs[0]! - s.z)).toBeLessThan(6);
    expect(Math.hypot(way.xs.at(-1)! - g.trailhead.x, way.zs.at(-1)! - g.trailhead.z)).toBeLessThan(6);
    expect(way.straight).toBeCloseTo(Math.hypot(s.x - g.trailhead.x, s.z - g.trailhead.z), 1);
  });

  it("is the target's length, bends, never heads back and never doubles on itself", () => {
    const r = wayRules(way, world.trail!.trailhead);
    expect(r.length).toBeGreaterThan(r.target * 0.9);
    expect(r.length).toBeLessThan(r.target * 1.1);
    expect(r.longestStraight).toBeLessThanOrEqual(WAY_STRAIGHT_MAX_M);
    expect(r.worstBack).toBeLessThanOrEqual(WAY_BACK_MAX_M);
    expect(r.closestApart).toBeGreaterThanOrEqual(WAY_APART_M);
  });

  it("keeps to ground a player can run: no lake, no sea, no slope they would slide on", () => {
    const n: Vec3 = { x: 0, y: 0, z: 0 };
    const shore = newLakeShore();
    const bodies = activeTerrainVariant().waterBodies?.(seed) ?? [];
    const steep: number[][] = [];
    for (let i = 0; i < way.xs.length; i++) {
      const x = way.xs[i]!, z = way.zs[i]!;
      for (const b of bodies) if (b.kind === "lake") expect(lakeShoreInto(shore, b.shape, x, z).s).toBeLessThanOrEqual(0);
      if (world.waterLevel !== null) expect(world.ground!.heightAt(x, z)).toBeGreaterThan(world.waterLevel);
      // The least normal a player can stand on there: the ground's, or the walkable rock's where its plates are.
      world.ground!.normalAt(x, z, n);
      steep.push([i, n.y, world.ground!.standNormalY?.(x, z) ?? GROUND_NORMAL_Y]);
    }
    expect(steep.filter(([, y, least]) => y! <= least!)).toEqual([]);
  });

  it("is the same drawn whole or in slices, and the same twice", () => {
    const gen = drawWay(world);
    let r = gen.next(), slices = 0;
    while (r.done !== true) {
      r = gen.next();
      slices++;
    }
    expect(slices).toBeGreaterThan(3);
    const again = r.value as WayDown;
    expect(Array.from(again.xs)).toEqual(Array.from(way.xs));
    expect(Array.from(again.zs)).toEqual(Array.from(way.zs));
  });

  it("falls back to the trail's stem, and says so, when nothing else gets through", () => {
    const steep = (_x: number, _z: number, out: Vec3): void => { out.x = 1; out.y = 0; out.z = 0; };
    const walled = { ...world, ground: { ...world.ground!, normalAt: steep } } as World;
    const w = drawWayNow(walled) as WayDown;
    expect(w.fallback).toBe(true);
    expect(w.length).toBeGreaterThan(w.straight);
    const g = world.trail!, s = g.nodes[g.summit]!;
    expect([w.xs[0], w.zs[0]]).toEqual([Math.fround(s.x), Math.fround(s.z)]);
  });

  it("draws nothing for a world with no trail or no ground", () => {
    expect(drawWayNow({ ...world, trail: null } as World)).toBeNull();
    expect(drawWayNow({ ...world, ground: null } as World)).toBeNull();
  });
});

describe("the way's arithmetic", () => {
  it("is only what every browser rounds alike: no trig, no powers, no logs", () => {
    const text = readFileSync("src/sim/wayDraw.ts", "utf8") + readFileSync("src/sim/wayDown.ts", "utf8");
    expect(text).not.toMatch(/Math\.(sin|cos|tan|atan2?|asin|acos|exp|pow|log\w*|hypot|cbrt)\b/);
    expect(text).not.toMatch(/[\w)\]]\s*\*\*\s*[\w(]/);
  });
});
