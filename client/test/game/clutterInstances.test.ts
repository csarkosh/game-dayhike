import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import {
  CLUTTER_BOULDER, CLUTTER_BUSH, CLUTTER_CLASS_COUNT, CLUTTER_DRIFTLOG, CLUTTER_DRIFTWOOD, CLUTTER_FERN, CLUTTER_GRASS, CLUTTER_LITTER,
  CLUTTER_MEADOW, CLUTTER_ROCK,
} from "../../src/sim/clutter.js";
import { BOULDER_A_BASE_H, BOULDER_B_BASE_H, BOULDER_SINK } from "../../src/sim/passes/clutter.js";
import { activeTerrainVariant } from "../../src/sim/terrain.js";
import { forestDensity } from "../../src/sim/vegetation.js";
import {
  CLUTTER_MODEL_IDS, CLUTTER_SINK, CUT_CLASSES, DRIFTLOG_SINK, FOLIAGE_BY_CLASS, LITTER_VARIANT_SCALE, clutterLodNames, clutterNearLodName,
  cutModel, cutOf, cutsFor, instanceMatrixFor, seatDriftLogs, trampleFrame, writeFoliage,
} from "../../src/game/clutterInstances.js";
import { FOLIAGE_PROFILES } from "../../src/game/foliageUniforms.js";
import { transformPoint } from "@csarkosh/engine/game/instancePose";
import { trunkSeat } from "@csarkosh/engine/game/logSeat";
import { ROCK_CUTS } from "@csarkosh/engine/game/rockRelief";
import { trampleAt } from "../../src/game/trailBenchParams.js";

const IDENTITY_FRAME = { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } };

describe("a clutter instance's matrix and tint", () => {
  it("tramples the grass beside the bench: shorter, leaning away, stained; untouched past the band", () => {
    const seed = 1234;
    const rt = activeTerrainVariant().trailDistance!;
    const near = { cls: CLUTTER_GRASS, x: 0, z: 0, groundH: 0, groundDx: 0, groundDz: 0, scale: 1, variant: 0, hash: 0.3 };
    // Find a point 0.9 m from the trail and one 3 m away by scanning a stem edge's neighbourhood.
    const g = activeTerrainVariant().trailGraph!(seed);
    const e = g.edges[g.stem[1]!]!, a = g.nodes[e.a]!, b = g.nodes[e.b]!;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const L = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
    const p09 = { ...near, x: mx + nx * 0.9, z: mz + nz * 0.9 };
    const p3 = { ...near, x: mx + nx * 3, z: mz + nz * 3 };
    const rt09 = rt(seed, p09.x, p09.z);
    expect(rt09).toBeCloseTo(0.9, 3);
    // trampleFrame writes into one reusable scratch object rather than
    // allocating: copy the fields this test compares out of it before
    // calling again, the same discipline the rebuild itself follows.
    const t09src = trampleFrame(seed, p09);
    const t09 = { height: t09src.height, lean: t09src.lean, ax: t09src.ax, az: t09src.az, tint: { ...t09src.tint } };
    const t3 = trampleFrame(seed, p3);
    // trampleAt is deterministic and pure, so feeding it the SAME measured
    // trail distance the implementation itself reads (rather than the
    // literal 0.9 the point was constructed from, which the graph's
    // sqrt/hypot chain can only approximate to within a few ULPs) is what
    // makes an exact `toEqual` on the tint meaningful.
    const want = trampleAt(rt09);
    expect(t09.height).toBeCloseTo(want.height, 6);
    expect(t09.lean).toBeCloseTo(want.lean, 6);
    expect(t09.tint).toEqual(want.tint);
    // The away direction points from the bed toward the card.
    expect(t09.ax * nx + t09.az * nz).toBeGreaterThan(0.99);
    expect(t3).toEqual({ height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } });
  });

  it("leans the trampled card's top along the away direction, not into the bed", () => {
    // Matrix-level, not gradient-level: builds the exact matrix the rebuild
    // writes (via the production `instanceMatrixFor`) and transforms the
    // card's local top by it, so a wrong-signed lean axis shows up as the
    // top landing on the wrong side rather than merely as a sign the
    // gradient math happened to cancel out.
    const white = { r: 1, g: 1, b: 1 };
    const inst = { cls: CLUTTER_GRASS, x: 0, z: 0, groundH: 0, groundDx: 0, groundDz: 0, scale: 1, variant: 0, hash: 0 };
    const buf = new Float32Array(16);
    const world = { x: 0, y: 0, z: 0 };

    // height 0.55 scales the local top before the lean rotates it, so its
    // horizontal excursion is height·sin(lean) ≈ 0.1886, not sin(lean) —
    // a shorter, more-trampled blade's tip travels less far sideways for
    // the same lean angle. cos(lean) then loses the same height factor
    // before the -CLUTTER_SINK sink is added by the translation.
    instanceMatrixFor(inst, { height: 0.55, lean: 0.35, ax: 1, az: 0, tint: white }, buf);
    transformPoint(buf, 0, 0, 1, 0, world);
    expect(world.x).toBeGreaterThan(0.15); // toward +x, the away direction — not the −0.19 a bed-ward lean would land
    expect(world.y).toBeGreaterThan(0.4);
    expect(world.y).toBeLessThan(0.6);

    instanceMatrixFor(inst, { height: 0.55, lean: 0.35, ax: 0, az: 1, tint: white }, buf);
    transformPoint(buf, 0, 0, 1, 0, world);
    expect(world.z).toBeGreaterThan(0.15);

    instanceMatrixFor(inst, { height: 1, lean: 0, ax: 0, az: 0, tint: white }, buf);
    transformPoint(buf, 0, 0, 1, 0, world);
    expect(world.x).toBeCloseTo(0, 6);
    expect(world.y).toBeCloseTo(1 - CLUTTER_SINK, 6);
    expect(world.z).toBeCloseTo(0, 6);
  });

  it("scales the litter variants to pebbles and a twig, on top of the sim's own scale", () => {
    expect(LITTER_VARIANT_SCALE).toEqual([1, 1, 0.3]);
    expect(CLUTTER_LITTER).toBe(8);
    // Built through the production instanceMatrixFor with the identity
    // frame (no lean, no trample) and flat ground (no tilt), so the matrix's
    // column length is exactly the instance's own final scale: rotation is
    // orthonormal, so it never changes a column's length, only its direction.
    const IDENTITY_FRAME = { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } };
    const colLen = (buf: Float32Array, col: number): number => Math.hypot(buf[col * 4]!, buf[col * 4 + 1]!, buf[col * 4 + 2]!);
    const base = { x: 0, z: 0, groundH: 0, groundDx: 0, groundDz: 0, scale: 0.5, hash: 0.2 };
    const buf = new Float32Array(16);
    instanceMatrixFor({ ...base, cls: CLUTTER_LITTER, variant: 2 }, IDENTITY_FRAME, buf);
    expect(colLen(buf, 0)).toBeCloseTo(0.5 * 0.3, 6);
    instanceMatrixFor({ ...base, cls: CLUTTER_LITTER, variant: 0 }, IDENTITY_FRAME, buf);
    expect(colLen(buf, 0)).toBeCloseTo(0.5, 6);
    // Only the litter class reads LITTER_VARIANT_SCALE: a grass instance
    // drawing the same variant index is untouched by the table.
    instanceMatrixFor({ ...base, cls: CLUTTER_GRASS, variant: 2 }, IDENTITY_FRAME, buf);
    expect(colLen(buf, 0)).toBeCloseTo(0.5, 6);
  });

  it("lists litter among the tilted classes: it seats onto sloped ground, unlike grass", () => {
    const IDENTITY_FRAME = { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } };
    const buf = new Float32Array(16);
    const sloped = { x: 0, z: 0, groundH: 0, groundDx: 0.6, groundDz: 0, scale: 0.4, hash: 0, variant: 0 };
    instanceMatrixFor({ ...sloped, cls: CLUTTER_LITTER }, IDENTITY_FRAME, buf);
    // Seated onto the slope, the Y column tips away from purely vertical.
    expect(Math.abs(buf[4]!) + Math.abs(buf[6]!)).toBeGreaterThan(0.01);
    instanceMatrixFor({ ...sloped, cls: CLUTTER_GRASS }, IDENTITY_FRAME, buf);
    // Grass never tilts: its Y column stays purely vertical (yaw only).
    expect(buf[4]).toBeCloseTo(0, 9);
    expect(buf[6]).toBeCloseTo(0, 9);
  });

  it("stands a card at its place, turned by its hash, sunk two centimetres, and sinks a boulder by its collider's seat", () => {
    const buf = new Float32Array(16);
    const base = { x: 7, z: -3, groundH: 12, groundDx: 0, groundDz: 0, scale: 2, hash: 0.25, variant: 0 };
    instanceMatrixFor({ ...base, cls: CLUTTER_GRASS }, IDENTITY_FRAME, buf);
    expect([buf[12], buf[13], buf[14]]).toEqual([7, Math.fround(12 - CLUTTER_SINK), -3]);
    // A quarter turn about up: the model's x lands on the world's -z, at the instance's scale.
    expect(buf[0]).toBeCloseTo(0, 6);
    expect(buf[2]).toBeCloseTo(-2, 6);
    expect(buf[5]).toBeCloseTo(2, 6);
    instanceMatrixFor({ ...base, cls: CLUTTER_BOULDER, variant: 0 }, IDENTITY_FRAME, buf);
    expect(buf[13]).toBeCloseTo(12 - BOULDER_SINK * BOULDER_A_BASE_H * 2, 5);
    instanceMatrixFor({ ...base, cls: CLUTTER_BOULDER, variant: 1 }, IDENTITY_FRAME, buf);
    expect(buf[13]).toBeCloseTo(12 - BOULDER_SINK * BOULDER_B_BASE_H * 2, 5);
  });

  it("lays a drift log across the beach's fall line on its trunk's underside, as its model measures", () => {
    // A trunk along x, half a metre through, its axis at y 0.25: its underside is level at y 0.
    const positions: number[] = [];
    for (let s = 0; s <= 20; s++) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        positions.push(-2 + s * 0.2, 0.25 + 0.25 * Math.sin(a), 0.25 * Math.cos(a));
      }
    }
    const seat = trunkSeat(positions);
    seatDriftLogs(positions);
    // No positions leave the seat as measured.
    seatDriftLogs([]);
    const buf = new Float32Array(16);
    const log = { cls: CLUTTER_DRIFTLOG, x: 0, z: 0, groundH: 1, groundDx: 0, groundDz: 0.2, scale: 1, hash: 0.5, variant: 0 };
    instanceMatrixFor(log, IDENTITY_FRAME, buf);
    expect(buf[13]).toBeCloseTo(1 - (seat.a + DRIFTLOG_SINK * seat.diameter), 5);
    // The beach falls along z; a log whose hash swings it nowhere lies along x, on the beach's plane.
    expect(Math.abs(buf[0] as number)).toBeGreaterThan(0.99);
    expect(Math.abs(buf[2] as number)).toBeLessThan(0.05);
  });

  it("writes the ground's colour under the instance and the sky's openness over it, stained by the bench's frame", () => {
    const seed = 1234;
    const inst = { cls: CLUTTER_GRASS, x: 100, z: 100, groundH: 5, groundDx: 0.1, groundDz: 0, scale: 1, variant: 0, hash: 0.3 };
    const plain = new Float32Array(4);
    const stained = new Float32Array(4);
    writeFoliage(seed, inst, plain, 0, IDENTITY_FRAME);
    writeFoliage(seed, inst, stained, 0, { ...IDENTITY_FRAME, tint: { r: 0.5, g: 0.25, b: 1 } });
    expect(plain[3]).toBeCloseTo(1 - forestDensity(seed, 100, 100), 6);
    expect(plain[0]).toBeGreaterThan(0);
    expect(stained[0]).toBeCloseTo((plain[0] as number) * 0.5, 6);
    expect(stained[1]).toBeCloseTo((plain[1] as number) * 0.25, 6);
    expect(stained[2]).toBeCloseTo(plain[2] as number, 6);
    expect(stained[3]).toBe(plain[3]);
  });
});

describe("which model a clutter class draws", () => {
  it("names a model a variant for every class but the three built in code", () => {
    expect(CLUTTER_MODEL_IDS.length).toBe(CLUTTER_CLASS_COUNT);
    expect(CLUTTER_MODEL_IDS.filter((ids) => ids.length === 0).length).toBe(3);
    expect(CLUTTER_MODEL_IDS[CLUTTER_LITTER]).toEqual(["clutter.rock_a", "clutter.rock_b", "clutter.driftwood"]);
  });

  it("draws the ferns, the bushes and the drift logs a level coarser than the rest", () => {
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const coarser = cls === CLUTTER_FERN || cls === CLUTTER_BUSH || cls === CLUTTER_DRIFTLOG;
      expect(clutterLodNames(cls), `class ${cls}`).toEqual(coarser ? ["LOD1", "LOD2"] : ["LOD0", "LOD1"]);
    }
  });

  it("gives the swaying classes a profile and the stones, the wood and the fungus none", () => {
    expect(FOLIAGE_BY_CLASS.get(CLUTTER_GRASS)).toBe(FOLIAGE_PROFILES.GRASS);
    expect(FOLIAGE_BY_CLASS.get(CLUTTER_MEADOW)).toBe(FOLIAGE_PROFILES.MEADOW);
    expect(FOLIAGE_BY_CLASS.get(CLUTTER_FERN)).toBe(FOLIAGE_PROFILES.UNDERSTORY);
    for (const cls of [CLUTTER_ROCK, CLUTTER_BOULDER, CLUTTER_DRIFTWOOD, CLUTTER_LITTER, CLUTTER_DRIFTLOG]) expect(FOLIAGE_BY_CLASS.has(cls)).toBe(false);
  });

  // Under the blades the meadow cards are the cover and the blades the
  // detail, and every near card costs its vertices whether the dither keeps
  // it or not: the meadow's near band draws LOD1 there, half of LOD0's.
  it("draws the meadow's near band on LOD1 under the blades, LOD0 otherwise", () => {
    expect(clutterNearLodName(CLUTTER_MEADOW, true)).toBe("LOD1");
    expect(clutterNearLodName(CLUTTER_MEADOW, false)).toBe("LOD0");
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      if (cls === CLUTTER_MEADOW) continue;
      expect(clutterNearLodName(cls, true)).toBe("LOD0");
      expect(clutterNearLodName(cls, false)).toBe("LOD0");
    }
  });
});

describe("cutsFor and cutOf", () => {
  it("gives the cut classes ROCK_CUTS and every other class exactly one", () => {
    expect(cutsFor(CLUTTER_ROCK)).toBe(ROCK_CUTS);
    expect(cutsFor(CLUTTER_BOULDER)).toBe(ROCK_CUTS);
    expect(cutsFor(CLUTTER_GRASS)).toBe(1);
    expect(cutsFor(CLUTTER_DRIFTWOOD)).toBe(1);
    expect(CUT_CLASSES.has(CLUTTER_ROCK)).toBe(true);
    expect(CUT_CLASSES.has(CLUTTER_BOULDER)).toBe(true);
    expect(CUT_CLASSES.has(CLUTTER_GRASS)).toBe(false);
  });

  it("reads the cut from the hash's own low end, spread across the whole range", () => {
    // inst.hash is a float in [0, 1) (sim/clutter.ts), not an integer: a
    // naive `hash & (cuts - 1)` would coerce every one of these to 0 via
    // ToInt32 and put every rock in cut 0, which is exactly the bug this
    // test is here to catch.
    const base = { x: 0, z: 0, groundH: 0, groundDx: 0, groundDz: 0, scale: 1, variant: 0, cls: CLUTTER_ROCK };
    expect(cutOf({ ...base, hash: 0 })).toBe(0);
    expect(cutOf({ ...base, hash: 0.24 })).toBe(0);
    expect(cutOf({ ...base, hash: 0.26 })).toBe(1);
    expect(cutOf({ ...base, hash: 0.51 })).toBe(2);
    expect(cutOf({ ...base, hash: 0.99 })).toBe(3);
    // A non-cut class always reads cut 0, whatever the hash.
    expect(cutOf({ ...base, cls: CLUTTER_GRASS, hash: 0.99 })).toBe(0);
  });

  it("keys a cut's planes on the class and the variant together", () => {
    expect(cutModel(CLUTTER_ROCK, 0)).not.toBe(cutModel(CLUTTER_BOULDER, 0));
    expect(cutModel(CLUTTER_ROCK, 1)).toBe(CLUTTER_ROCK * 16 + 1);
  });
});
