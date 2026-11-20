import { describe, expect, it, vi } from "vitest";
import { elevationSampleAt, terrainVariant } from "@csarkosh/engine/sim/terrain";
import type { CoastOverlay } from "@csarkosh/engine/sim/olympic";

/**
 * The coast as the engine has it, with no place laid over it or with one of a test's own: what
 * a second game starts from. Each world here is a sim of its own, as another thread's is, since
 * a thread registers the coast once; the world every other test sees is Day Hike's, the coast
 * with the mountain on it (`test/helpers/dayhikeWorld.ts`).
 */
async function coastWith(place: CoastOverlay | null) {
  vi.resetModules();
  const olympic = await import("@csarkosh/engine/sim/olympic");
  const terrain = await import("@csarkosh/engine/sim/terrain");
  olympic.registerOlympic(place);
  return { olympic, terrain, variant: terrain.activeTerrainVariant() };
}

const SEED = 627994160;

describe("the coast with no place laid over it", () => {
  it("is a terrain with a sea, a road and a cove, and no trail, lake, landmark, strip or clearing", async () => {
    const { variant } = await coastWith(null);
    expect(variant.name).toBe("olympic");
    expect(variant.waterBodies?.(SEED)).toEqual([{ kind: "sea", level: 0 }]);
    expect(variant.roadCenterX?.(SEED, 0)).toBeTypeOf("number");
    expect(variant.coveMask?.(SEED, -300, 0)).toBeTypeOf("number");
    expect([variant.trailGraph, variant.trailDistance, variant.sceneryLandmarks, variant.landmarkMask, variant.featureMask]).toEqual([
      undefined, undefined, undefined, undefined, undefined,
    ]);
    expect([variant.prepare, variant.install, variant.isPrepared, variant.shoreStrip, variant.clearing]).toEqual([
      undefined, undefined, undefined, undefined, undefined,
    ]);
  });

  it("reads the shore's rules from the ground alone", async () => {
    const { terrain } = await coastWith(null);
    expect(terrain.shoreStrip(SEED, -350, 0)).toBe(0);
    expect(terrain.shoreHeight(SEED, -350, 0, 4)).toBe(4);
  });

  it("declares none of the mountain's tunables, and every one of its own that Day Hike's world declares", async () => {
    const dayhike = terrainVariant("olympic")?.tunables ?? {};
    const { variant } = await coastWith(null);
    for (const [key, value] of Object.entries(variant.tunables)) expect(dayhike[key], key).toBe(value);
    const mountains = Object.keys(dayhike).filter((key) => !(key in variant.tunables));
    expect(mountains.length).toBeGreaterThan(40);
    expect(mountains).toEqual(expect.arrayContaining(["TRAIL_Z_ANCHOR", "BOWL_U_MAX", "TRAIL_GRID_CELL", "TRAIL_SINK", "APRON_BLEND_END"]));
  });

  it("is Day Hike's ground to the bit wherever the mountain does not reach", async () => {
    // Day Hike's world first, from this file's own registry; then the plain coast, in a registry of its own.
    const places: [number, number][] = [];
    for (let i = 0; i < 40; i++) places.push([-600 + i * 37.5, 4000 + i * 211.25], [-600 + i * 37.5, -3000 - i * 173.5]);
    const withMountain = places.map(([x, z]) => elevationSampleAt(SEED, x, z));
    const { terrain } = await coastWith(null);
    expect(places.map(([x, z]) => terrain.elevationSampleAt(SEED, x, z))).toEqual(withMountain);
  });

  it("differs from Day Hike's where the mountain stands", async () => {
    const graph = terrainVariant("olympic")?.trailGraph?.(SEED);
    const summit = graph?.nodes[graph.summit];
    if (summit === undefined) throw new Error("Day Hike's world has a trail to a summit");
    const dayhike = elevationSampleAt(SEED, summit.x, summit.z).h;
    const { terrain } = await coastWith(null);
    // The peak is a dome raised on the massif: the plain coast stands tens of metres lower there.
    expect(dayhike - terrain.elevationSampleAt(SEED, summit.x, summit.z).h).toBeGreaterThan(20);
  });
});

describe("a place laid over the coast", () => {
  /** A mesa: the ground raised 40 m within 100 m of a point 600 m inland of the road, and a lake named beside it. */
  const mesa = (centre: { x: number; z: number }): CoastOverlay => ({
    tunables: { MESA_RISE: 40, MESA_RADIUS: 100 },
    shapeD(_seed, x, z, _u, _uDz, base) {
      const dx = x - centre.x;
      const dz = z - centre.z;
      return dx * dx + dz * dz < 100 * 100 ? { h: base.h + 40, dx: base.dx, dz: base.dz } : base;
    },
    trailDistance: (_seed, x, z) => Math.abs(x - centre.x) + Math.abs(z - centre.z),
    shoreStrip: { lift: 9, forestFloor: 1, at: (_seed, _x, z) => (z > 900 && z < 1000 ? 0.5 : 0) },
    clearing: { z: centre.z, x: () => centre.x },
  });

  it("has its ground over the coast's inside its reach and the coast's own outside it", async () => {
    const plain = await coastWith(null);
    const road = plain.variant.roadCenterX?.(SEED, 2000) as number;
    const centre = { x: road + 600, z: 2000 };
    const inside = plain.terrain.elevationSampleAt(SEED, centre.x + 10, centre.z - 20);
    const outside = plain.terrain.elevationSampleAt(SEED, centre.x + 300, centre.z);
    const laid = await coastWith(mesa(centre));
    expect(laid.terrain.elevationSampleAt(SEED, centre.x + 10, centre.z - 20)).toEqual({ h: inside.h + 40, dx: inside.dx, dz: inside.dz });
    expect(laid.terrain.elevationSampleAt(SEED, centre.x + 300, centre.z)).toEqual(outside);
  });

  it("is cut by the road's corridor like any other ground", async () => {
    const plain = await coastWith(null);
    const road = plain.variant.roadCenterX?.(SEED, 2000) as number;
    const onRoad = plain.terrain.elevationSampleAt(SEED, road, 2000);
    // A mesa centred on the road itself: the corridor is the last stage, so the road's bed stays where it was.
    const laid = await coastWith(mesa({ x: road, z: 2000 }));
    expect(laid.terrain.elevationSampleAt(SEED, road, 2000).h).toBe(onRoad.h);
    expect(laid.terrain.elevationSampleAt(SEED, road + 60, 2000).h).toBeGreaterThan(plain.terrain.elevationSampleAt(SEED, road + 60, 2000).h + 30);
  });

  it("joins its tunables to the coast's and answers what the world asks of the place", async () => {
    const plain = (await coastWith(null)).variant.tunables;
    const laid = await coastWith(mesa({ x: 500, z: 2000 }));
    expect(laid.variant.tunables).toEqual({ ...plain, MESA_RISE: 40, MESA_RADIUS: 100 });
    expect(laid.variant.trailDistance?.(SEED, 503, 2004)).toBe(7);
    expect(laid.variant.clearing).toEqual({ z: 2000, x: expect.any(Function) });
    expect(laid.terrain.shoreStrip(SEED, 0, 950)).toBe(0.5);
    expect(laid.terrain.shoreHeight(SEED, 0, 950, 4)).toBe(8.5);
    expect(laid.terrain.shoreHeight(SEED, 0, 500, 4)).toBe(4);
  });

  it("is registered once a thread", async () => {
    const { olympic } = await coastWith(null);
    expect(() => olympic.registerOlympic(null)).toThrow(/already registered/);
  });
});
