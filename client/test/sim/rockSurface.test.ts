import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createGroundField } from "../../src/sim/ground.js";
import { activeTerrainVariant, elevationAt, elevationSampleAt } from "../../src/sim/terrain.js";
import { trailDistance } from "../../src/sim/trail.js";
import { groundReliefD, groundWalkD } from "../../src/sim/faceRelief.js";
import {
  GROUND_DEPTH, GROUND_LOUD_CELL, GROUND_TRAIL_CLEAR_HI, GROUND_TRAIL_CLEAR_LO, ROCK_SURFACE_TUNABLES, cornerLoudness,
  depthUnderBend, faceMask, groundBend, loudnessAt, rockLayerAt, rockOfSlope, trailClearAt,
} from "../../src/sim/rockSurface.js";
import * as rock from "../../src/sim/rockSurface.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** The scarp by the road: the faces' reference world; its rocky hillside above the trail at (−168, −1740). */
const SEED = 627994160;
const HILL = { x: -168, z: -1740 };

describe("the rock layer", () => {
  it("is nothing, exactly, where the surface paints no rock", () => {
    const ground = createGroundField(SEED);
    // The road's flat under the scarp, and the flat south of it.
    for (const [x, z] of [[-370, -900], [-29 * 16 + 8, -81 * 16 + 8], [0, 0]] as const) {
      const s = elevationSampleAt(SEED, x, z);
      expect(rockOfSlope(Math.sqrt(s.dx * s.dx + s.dz * s.dz))).toBe(0);
      expect(rockLayerAt(SEED, x, z, s)).toEqual({ rise: 0, dx: 0, dz: 0 });
      expect(ground.heightAt(x, z)).toBe(s.h);
    }
  });

  it("stands up to GROUND_DEPTH over the rocky hillside, as a vertical thickness, and never below the ground", () => {
    let most = 0;
    let risen = 0;
    for (let iz = 0; iz <= 16; iz++) {
      for (let ix = 0; ix <= 16; ix++) {
        const x = HILL.x - 8 + ix;
        const z = HILL.z - 8 + iz;
        const s = elevationSampleAt(SEED, x, z);
        const g2 = s.dx * s.dx + s.dz * s.dz;
        const layer = rockLayerAt(SEED, x, z, s);
        expect(layer.rise).toBeGreaterThanOrEqual(0);
        expect(layer.rise).toBeLessThanOrEqual(GROUND_DEPTH * Math.sqrt(1 + g2) + 1e-9);
        if (layer.rise > 0) risen++;
        most = Math.max(most, layer.rise);
      }
    }
    expect(risen).toBeGreaterThan(200);
    expect(most).toBeGreaterThan(0.5);
  }, timeLimit(20_000));

  it("is the drawn rock's push on a plate's top: the walking twin's value, masked and scaled as the patches scale it", () => {
    const x = HILL.x;
    const z = HILL.z;
    const s = elevationSampleAt(SEED, x, z);
    const g2 = s.dx * s.dx + s.dz * s.dz;
    const g = Math.sqrt(g2);
    const mask = rockOfSlope(g) * (1 - faceMask(g)) * loudnessAt(SEED, x, z);
    const depth = depthUnderBend(GROUND_DEPTH, groundBend(SEED, x, z, s), 1);
    const twin = groundWalkD(SEED, x, z);
    const layer = rockLayerAt(SEED, x, z, s);
    expect(layer.rise).toBeCloseTo((mask * depth * Math.sqrt(1 + g2) * (twin.v + 1)) / 2, 12);
    // The drawn field is within the range of the twin: a shard's tip above
    // it, a joint's ramp either side of a fracture.
    const drawn = groundReliefD(SEED, x, z);
    expect(Math.abs(drawn.v - twin.v)).toBeLessThanOrEqual(2);
  });

  it("is smooth to walk: the layer's gradient over the hillside stays under the base slope's own", () => {
    // Along 200 m of the slope at 10 cm, the surface the player stands on
    // never steps: the greatest rise between neighbours is a ramp, not a
    // fracture, where the drawn rock steps up to a metre in 15 cm.
    const ground = createGroundField(SEED);
    let steepest = 0;
    let prev = ground.heightAt(HILL.x - 100, HILL.z);
    for (let i = 1; i <= 2000; i++) {
      const h = ground.heightAt(HILL.x - 100 + i * 0.1, HILL.z);
      steepest = Math.max(steepest, Math.abs(h - prev) / 0.1);
      prev = h;
    }
    expect(steepest).toBeLessThan(3);
  }, timeLimit(20_000));

  it("reads the loudness at the lattice's corners once, and interpolates it across a cell without a step", () => {
    const ci = Math.floor(HILL.x / GROUND_LOUD_CELL);
    const cj = Math.floor(HILL.z / GROUND_LOUD_CELL);
    const corner = cornerLoudness(SEED, ci, cj);
    expect(cornerLoudness(SEED, ci, cj)).toBe(corner);
    expect(loudnessAt(SEED, ci * GROUND_LOUD_CELL, cj * GROUND_LOUD_CELL)).toBe(corner);
    // Across the cell's east line, the two cells read the same doubles.
    const x = (ci + 1) * GROUND_LOUD_CELL;
    const z = cj * GROUND_LOUD_CELL + 5;
    expect(loudnessAt(SEED, x, z)).toBe(loudnessAt(SEED, x, z));
    expect(Math.abs(loudnessAt(SEED, x - 1e-6, z) - loudnessAt(SEED, x + 1e-6, z))).toBeLessThan(1e-5);
  });

  it("keeps off the trail's bed: nothing within the clearance of an edge, the whole beyond it", () => {
    const trail = activeTerrainVariant().trailGraph?.(SEED);
    if (trail === undefined) throw new Error("no trail");
    expect(trailClearAt(null, 0, 0)).toBe(1);
    // Every node of the graph is on a bed: no clearance there.
    let onBed = 0;
    for (const n of trail.nodes) {
      expect(trailClearAt(trail, n.x, n.z)).toBe(0);
      const s = elevationSampleAt(SEED, n.x, n.z);
      expect(rockLayerAt(SEED, n.x, n.z, s, trail)).toEqual({ rise: 0, dx: 0, dz: 0 });
      onBed++;
    }
    expect(onBed).toBeGreaterThan(10);
    // The hillside is far from any edge: the clearance is whole, and the
    // layer there is the layer without a graph.
    expect(trailDistance(trail, HILL.x, HILL.z)).toBeGreaterThan(GROUND_TRAIL_CLEAR_HI);
    expect(trailClearAt(trail, HILL.x, HILL.z)).toBe(1);
    const s = elevationSampleAt(SEED, HILL.x, HILL.z);
    expect(rockLayerAt(SEED, HILL.x, HILL.z, s, trail)).toEqual(rockLayerAt(SEED, HILL.x, HILL.z, s));
    // The ground field with the graph stands the player on the bed's ground.
    const with_ = createGroundField(SEED, trail);
    const n0 = trail.nodes[0]!;
    expect(with_.heightAt(n0.x, n0.z)).toBe(elevationSampleAt(SEED, n0.x, n0.z).h);
    expect(with_.standNormalY?.(n0.x, n0.z)).toBe(0.7);
    expect(GROUND_TRAIL_CLEAR_LO).toBeLessThan(GROUND_TRAIL_CLEAR_HI);
  }, timeLimit(60_000));

  it("is deterministic: the ground field answers the same doubles twice", () => {
    const a = createGroundField(SEED);
    const b = createGroundField(SEED);
    for (let i = 0; i < 50; i++) {
      const x = HILL.x - 20 + i * 0.8;
      const z = HILL.z + 3;
      expect(Object.is(a.heightAt(x, z), b.heightAt(x, z))).toBe(true);
    }
  });

  it("leaves the elevation field itself alone", () => {
    expect(elevationAt(SEED, HILL.x, HILL.z)).toBe(elevationSampleAt(SEED, HILL.x, HILL.z).h);
  });

  it("holds every constant by name in the tunables the elevation pass declares", () => {
    for (const [k, v] of Object.entries(rock)) {
      if (typeof v === "number") expect(ROCK_SURFACE_TUNABLES[k], k).toBe(v);
    }
    expect(ROCK_SURFACE_TUNABLES.GROUND_WALK_BORDER).toBe(1.5);
    expect(ROCK_SURFACE_TUNABLES.GROUND_PLATE_CELL).toBe(2);
    expect(ROCK_SURFACE_TUNABLES.FACE_COLUMN_CELL).toBeUndefined();
  });
});
