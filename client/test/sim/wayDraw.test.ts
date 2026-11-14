import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForestWorld, type World } from "../../src/sim/world.js";
import { createForest } from "../../src/sim/forest.js";
import { seedFromToken } from "../../src/game/seed.js";
import { DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { GROUND_NORMAL_Y, PLAYER_HALF, STEP_HEIGHT } from "../../src/sim/constants.js";
import { boxesNear } from "../../src/sim/boxSource.js";
import { lakeShoreInto, newLakeShore } from "../../src/sim/lakeShape.js";
import type { Vec3 } from "../../src/sim/types.js";
import type { WayDown } from "../../src/sim/wayDown.js";
import { stemAhead } from "../../src/sim/trailRoute.js";
import { DISCOVERY_RADIUS, emergePoint } from "../../src/sim/summit.js";
import {
  WAY_APART_M, WAY_BACK_MAX_M, WAY_BODY_CLEAR_M, WAY_CREST_CLEAR_M, WAY_LONG_RATIO, WAY_MAX_M, WAY_MAX_RATIO, WAY_START_M, WAY_MIN_RATIO, WAY_STRAIGHT_MAX_M, WAY_TARGET_M,
  drawWay, drawWayNow, wayTarget,
} from "../../src/sim/wayDraw.js";
import { STRAIGHT_SLACK_M, wayRules } from "./helpers/wayRules.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** A file of the client, wherever the suite is run from (the gate runs it from the repository's root). */
const clientFile = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

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

  /** Where a party coming up the stem stands at the find: a discovery's radius down it from the crest. */
  const stand = (): { x: number; z: number } => {
    const g = world.trail!, c = g.nodes[g.summit]!;
    return stemAhead(g, c.x, c.z, -WAY_START_M)!;
  };

  it("runs from where the party stands at the find, on the stem below the crest, to the pad", () => {
    const g = world.trail!, s = stand();
    expect(WAY_START_M).toBe(DISCOVERY_RADIUS);
    expect(way.fallback).toBe(false);
    expect(Math.hypot(way.xs[0]! - s.x, way.zs[0]! - s.z)).toBeLessThan(0.5);
    expect(Math.hypot(way.xs.at(-1)! - g.trailhead.x, way.zs.at(-1)! - g.trailhead.z)).toBeLessThan(6);
    expect(way.straight).toBeCloseTo(Math.hypot(s.x - g.trailhead.x, s.z - g.trailhead.z), 1);
  });

  it("leaves the crest on the party's side: never over the body, never round behind it where the Hollow steps out", () => {
    const g = world.trail!, c = g.nodes[g.summit]!, s = stand();
    expect([WAY_BODY_CLEAR_M, WAY_CREST_CLEAR_M]).toEqual([8, 22]);
    const hollow = emergePoint(world, { x: c.x, y: 0, z: c.z }, { x: s.x, y: 0, z: s.z });
    for (let i = 0; i < way.xs.length; i++) {
      const x = way.xs[i]!, z = way.zs[i]!;
      const d = Math.hypot(x - c.x, z - c.z);
      // A metre and a half of give: the line's points are its cells' centres averaged.
      expect(d, `point ${i}`).toBeGreaterThan(WAY_BODY_CLEAR_M - 1.5);
      const behind = (x - c.x) * (s.x - c.x) + (z - c.z) * (s.z - c.z) < 0;
      if (behind) expect(d, `point ${i}`).toBeGreaterThan(WAY_CREST_CLEAR_M - 1.5);
      expect(Math.hypot(x - hollow.x, z - hollow.z), `point ${i}`).toBeGreaterThan(WAY_START_M);
    }
  });

  it("is the target's length, bends, never heads back and never doubles on itself", () => {
    const r = wayRules(way, world.trail!.trailhead);
    expect(r.length).toBeGreaterThan(r.target * 0.9);
    expect(r.length).toBeLessThan(r.target * 1.1);
    expect(r.longestStraight).toBeLessThanOrEqual(WAY_STRAIGHT_MAX_M + STRAIGHT_SLACK_M);
    expect(r.worstBack).toBeLessThanOrEqual(WAY_BACK_MAX_M);
    expect(r.length).toBeLessThanOrEqual(WAY_MAX_M);
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
    const s = stand();
    expect([w.xs[0], w.zs[0]]).toEqual([Math.fround(s.x), Math.fround(s.z)]);
  });

  it("draws nothing for a world with no trail or no ground", () => {
    expect(drawWayNow({ ...world, trail: null } as World)).toBeNull();
    expect(drawWayNow({ ...world, ground: null } as World)).toBeNull();
  });
});

describe("a way that leaves its meander for one of its copies", SUITE, () => {
  // On these two worlds something stands across the near ground, and the cheapest line crosses to a copy of the
  // meander 80 m to the side and back. Each crossing was a straight diagonal, 62 m and 60 m by the rules' measure.
  // On the other two the wood is thick: the trunks on the line took the search's rounds, and none were left to bend with.
  for (const token of ["hollow16", "hollow24", "hollow46", "hollow49"]) {
    it(`bends every long straight stretch on ${token}: none measures over the design's 40 m and its give`, () => {
      const w = createForestWorld(createForest(seedFromToken(token)));
      const way = drawWayNow(w) as WayDown;
      expect(way.fallback).toBe(false);
      const r = wayRules(way, w.trail!.trailhead);
      expect(r.longestStraight).toBeLessThanOrEqual(WAY_STRAIGHT_MAX_M + STRAIGHT_SLACK_M);
      // And it is still a way of its length that never doubles on itself.
      expect(r.length).toBeGreaterThan(r.target * 0.9);
      expect(r.length).toBeLessThan(r.target * 1.25);
      expect(r.closestApart).toBeGreaterThanOrEqual(WAY_APART_M);
    }, timeLimit(120_000));
  }
});

describe("a way through fallen wood", SUITE, () => {
  it("has nothing a runner cannot step over standing on its line: the line as smoothed, not only the cells it was found through", () => {
    // On this world the smoothed line cut a corner across a fallen trunk's boxes, which the cells it was found
    // through had gone round, and a runner aimed down the line stood against the trunk until the chase took them.
    const w = createForestWorld(createForest(seedFromToken("hollow39")));
    const way = drawWayNow(w) as WayDown;
    expect(way.fallback).toBe(false);
    const on: number[] = [];
    for (let k = 1; k + 1 < way.xs.length; k++) {
      const x = way.xs[k] as number, z = way.zs[k] as number, h = w.ground!.heightAt(x, z);
      const lo = { x: x - PLAYER_HALF.x, y: h - 1, z: z - PLAYER_HALF.z }, hi = { x: x + PLAYER_HALF.x, y: h + 2 * PLAYER_HALF.y, z: z + PLAYER_HALF.z };
      for (const b of boxesNear(w.boxes, lo, hi)) {
        if (b.max.x < lo.x || b.min.x > hi.x || b.max.z < lo.z || b.min.z > hi.z) continue;
        if (b.max.y - h <= STEP_HEIGHT || b.min.y > hi.y) continue;
        on.push(Math.round(way.cum[k] as number));
        break;
      }
    }
    expect(on).toEqual([]);
  }, timeLimit(120_000));
});

describe("the way's arithmetic", () => {
  it("is only what every browser rounds alike: no trig, no powers, no logs", () => {
    const text = readFileSync(clientFile("src/sim/wayDraw.ts"), "utf8") + readFileSync(clientFile("src/sim/wayDown.ts"), "utf8");
    expect(text).not.toMatch(/Math\.(sin|cos|tan|atan2?|asin|acos|exp|pow|log\w*|hypot|cbrt)\b/);
    expect(text).not.toMatch(/[\w)\]]\s*\*\*\s*[\w(]/);
  });
});
