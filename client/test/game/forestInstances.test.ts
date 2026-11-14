import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { FADE_NONE_IN, FADE_NONE_OUT } from "../../src/game/distanceFade.js";
import { NEAR_RADIUS, SEAM_FAR, SEAM_FILL, SEAM_LOD0, SEAM_LOD1, UNDERSTORY_RADIUS, farTreeScale, seamNear } from "../../src/game/forestField.js";
import {
  IMPOSTOR_SLICE, deadwoodMatrixBuffer, deadwoodMeasure, deadwoodRoleBuffer, fadeBandsBuffer, forestFadeBands, groundGradBuffer,
  impostorFadeBuffer, impostorMatrixSlices, impostorQuad, nurseBuffers, partitionImpostors, snagImpostorQuad, treeFoliageBuffer,
  treeMatrixBuffer,
} from "../../src/game/forestInstances.js";
import { NURSE_FERN, nursePlants } from "../../src/game/nurseLog.js";
import { finish } from "../../src/game/syncJobs.js";
import { elevationAt } from "../../src/sim/terrain.js";
import { COHORT_GIANT, COHORT_LOG, COHORT_SAPLING, COHORT_SNAG, type TreeInstance } from "../../src/sim/vegetation.js";

const SEED = 0x51de;

function tree(over: Partial<TreeInstance> = {}): TreeInstance {
  return { x: 10, z: -20, groundH: 3, groundDx: 0, groundDz: 0, species: 0, scale: 2, cohort: COHORT_GIANT, hash: 0.25, variant: 0, ...over };
}

/** The matrix at instance `i` of `buf`, as its sixteen floats. */
const at = (buf: Float32Array, i: number): number[] => [...buf.subarray(i * 16, i * 16 + 16)];
/** A column's length: the scale an instance draws its model's axis at. */
const columnLength = (m: number[], c: number): number => Math.hypot(m[c * 4] as number, m[c * 4 + 1] as number, m[c * 4 + 2] as number);

/** A trunk lying along x from -2 to 2, a metre through, its section a ring of eight vertices at each of 21 stations. */
function trunk(): number[] {
  const positions: number[] = [];
  for (let s = 0; s <= 20; s++) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      positions.push(-2 + s * 0.2, 0.5 * Math.sin(a), 0.5 * Math.cos(a));
    }
  }
  return positions;
}

describe("the forest's fade bands", () => {
  it("hand each ring to the next and the last to the billboards, at the default near radius", () => {
    const fades = forestFadeBands(NEAR_RADIUS);
    const near = seamNear(NEAR_RADIUS);
    expect(fades.nearSeam).toEqual(near);
    expect(fades.lods).toEqual([
      [...FADE_NONE_IN, ...SEAM_LOD0],
      [...SEAM_LOD0, ...SEAM_LOD1],
      [...SEAM_LOD1, ...near],
    ]);
    expect(fades.lod1Out).toEqual(SEAM_LOD1);
    expect(fades.deadwood).toEqual([...FADE_NONE_IN, ...near]);
    expect(fades.impostorLattice).toEqual([...near, ...SEAM_FAR]);
    expect(fades.impostorFill).toEqual([...near, ...SEAM_FILL]);
    expect(fades.understory).toEqual([...FADE_NONE_IN, UNDERSTORY_RADIUS * 0.8, UNDERSTORY_RADIUS]);
  });

  it("clip a ring's out-band to the near seam where the tier's radius reaches its fixed edge", () => {
    const low = 70;
    const fades = forestFadeBands(low);
    const near = seamNear(low);
    // Ring 0 ends inside the radius and is left; ring 1's fixed edge is the radius itself.
    expect(fades.lods[0]).toEqual([...FADE_NONE_IN, ...SEAM_LOD0]);
    expect(fades.lods[1]).toEqual([...SEAM_LOD0, ...near]);
    expect(fades.lod1Out).toEqual(near);
    expect(fades.lods[2]).toEqual([...SEAM_LOD1, ...near]);
  });

  it("are one quad an instance, the same for a bucket's every instance", () => {
    const bands = forestFadeBands(NEAR_RADIUS).lods[1];
    expect([...fadeBandsBuffer(3, bands)]).toEqual([...bands, ...bands, ...bands]);
    expect(fadeBandsBuffer(0, bands)).toHaveLength(0);
  });

  it("are the lattice's bands then the fill's on a billboard, in the order its matrices are written", () => {
    const fades = forestFadeBands(NEAR_RADIUS);
    const buf = impostorFadeBuffer(2, 1, fades);
    expect([...buf]).toEqual([...fades.impostorLattice, ...fades.impostorLattice, ...fades.impostorFill]);
    expect(fades.impostorLattice[3]).toBeGreaterThan(fades.impostorFill[3]);
    expect(FADE_NONE_OUT[0]).toBeGreaterThan(fades.impostorLattice[3]);
  });
});

describe("the forest's instance lists", () => {
  it("stand a tree plumb at its place, at its scale, yawed by its hash", () => {
    const list = [tree(), tree({ x: -4, z: 9, groundH: 12.5, scale: 3.5, hash: 0.5, groundDx: 0.4, groundDz: -0.2 })];
    const buf = treeMatrixBuffer(list, false);
    expect(buf).toHaveLength(32);
    list.forEach((t, i) => {
      const m = at(buf, i);
      expect(m.slice(12, 16)).toEqual([Math.fround(t.x), Math.fround(t.groundH), Math.fround(t.z), 1]);
      for (const c of [0, 1, 2]) expect(columnLength(m, c)).toBeCloseTo(t.scale, 5);
      // Plumb whatever the slope: the model's up stays the world's.
      expect(m.slice(4, 8)).toEqual([0, Math.fround(t.scale), 0, 0]);
      // The yaw about the vertical: the model's +X lands on (cos, −sin).
      const yaw = t.hash * Math.PI * 2;
      expect(m[0]).toBeCloseTo(t.scale * Math.cos(yaw), 5);
      expect(m[2]).toBeCloseTo(-t.scale * Math.sin(yaw), 5);
    });
  });

  it("lean an understory plant onto the ground's normal", () => {
    const t = tree({ groundDx: 0.3, groundDz: -0.4 });
    const m = at(treeMatrixBuffer([t], true), 0);
    const inv = t.scale / Math.sqrt(1 + 0.3 * 0.3 + 0.4 * 0.4);
    expect(m[4]).toBeCloseTo(-0.3 * inv, 5);
    expect(m[5]).toBeCloseTo(inv, 5);
    expect(m[6]).toBeCloseTo(0.4 * inv, 5);
  });

  it("carry each tree's ground gradient, two floats an instance", () => {
    const buf = groundGradBuffer([tree({ groundDx: 0.25, groundDz: -0.5 }), tree({ groundDx: -1, groundDz: 2 })]);
    expect([...buf]).toEqual([0.25, -0.5, -1, 2]);
  });

  it("carry the ground's colour and the sky's openness for a tinting profile, four floats an instance", () => {
    const buf = treeFoliageBuffer(SEED, [tree(), tree({ x: 400, z: 250 })]);
    expect(buf).toHaveLength(8);
    for (let i = 0; i < 2; i++) {
      for (let k = 0; k < 3; k++) expect(buf[i * 4 + k]).toBeGreaterThan(0);
      expect(buf[i * 4 + 3]).toBeGreaterThanOrEqual(0);
      expect(buf[i * 4 + 3]).toBeLessThanOrEqual(1);
    }
  });

  it("tell a fallen log from a standing snag, a float an instance", () => {
    const list = [tree({ cohort: COHORT_SNAG }), tree({ cohort: COHORT_LOG }), tree({ cohort: COHORT_LOG }), tree({ cohort: COHORT_SNAG })];
    expect([...deadwoodRoleBuffer(list)]).toEqual([0, 1, 1, 0]);
  });

  it("stand a snag on its base along the ground's normal and lay a log along its trunk", () => {
    const measure = deadwoodMeasure(trunk());
    const snag = tree({ cohort: COHORT_SNAG, x: 30, z: 40, scale: 2, groundH: elevationAt(SEED, 30, 40) });
    const log = tree({ cohort: COHORT_LOG, x: -60, z: 15, scale: 1.5, hash: 0.1 });
    const mirrored = { ...log, variant: 1 };
    const buf = deadwoodMatrixBuffer(SEED, [snag, log, mirrored], measure.snagBaseOffset, measure.logMinX, measure.logMaxX, measure.logSeat);
    // The snag: the model's +X (its trunk) stands up, and its origin is half a trunk over the ground.
    const s = at(buf, 0);
    expect(s[1]).toBeCloseTo(snag.scale, 5);
    expect(s[12]).toBe(Math.fround(snag.x));
    expect(s[13]).toBeCloseTo(snag.groundH + measure.snagBaseOffset * snag.scale, 5);
    // The log: its trunk lies near the horizontal along its hashed yaw.
    const l = at(buf, 1);
    expect(Math.abs(l[1] as number)).toBeLessThan(0.9 * log.scale);
    expect(columnLength(l, 0)).toBeCloseTo(log.scale, 5);
    // The second draw is the same log mirrored across its trunk's plane: its third axis turned over.
    const m = at(buf, 2);
    expect(m.slice(0, 8)).toEqual(l.slice(0, 8));
    expect(m.slice(8, 11)).toEqual(l.slice(8, 11).map((v) => -v));
    expect(m.slice(12)).toEqual(l.slice(12));
  });

  it("stand what grows on a log plumb on its top line, by kind", () => {
    const measure = deadwoodMeasure(trunk());
    const logs = Array.from({ length: 40 }, (_, i) => tree({ cohort: COHORT_LOG, x: i * 9, z: -i * 5, hash: (i * 0.137) % 1, scale: 1.4 }));
    const list = [tree({ cohort: COHORT_SNAG }), ...logs];
    const matrices = deadwoodMatrixBuffer(SEED, list, measure.snagBaseOffset, measure.logMinX, measure.logMaxX, measure.logSeat);
    const nurse = nurseBuffers(list, matrices, measure.logMinX, measure.logMaxX, measure.logTop, measure.logSeat.diameter);
    const plants = logs.flatMap((t) => nursePlants(t.hash, measure.logMinX, measure.logMaxX));
    const ferns = plants.filter((p) => p.kind === NURSE_FERN);
    expect(ferns.length).toBeGreaterThan(0);
    expect(nurse.ferns).toHaveLength(16 * ferns.length);
    expect(nurse.seedlings).toHaveLength(16 * (plants.length - ferns.length));
    ferns.forEach((plant, i) => {
      const m = at(nurse.ferns, i);
      expect(m.slice(4, 8)).toEqual([0, Math.fround(plant.scale), 0, 0]);
    });
  });

  it("turn each billboard's face to the camera, the lattice first, and grow a far lattice card", () => {
    const near = tree({ x: 0, z: 100, scale: 3 });
    const far = tree({ x: 1500, z: 0, scale: 3 });
    const fill = tree({ x: -80, z: -80, scale: 1 });
    const centreY = 6;
    const buf = finish(impostorMatrixSlices([near, far], [fill], centreY, 0, 0));
    expect(buf).toHaveLength(48);
    [near, far, fill].forEach((t, i) => {
      const m = at(buf, i);
      const dist = Math.hypot(t.x, t.z);
      const [across, up] = i < 2 ? farTreeScale(dist) : [1, 1];
      expect(columnLength(m, 0)).toBeCloseTo(t.scale * across, 4);
      expect(columnLength(m, 1)).toBeCloseTo(t.scale * up, 4);
      expect(m[13]).toBeCloseTo(t.groundH + centreY * t.scale * up, 4);
      // The quad's face is its −Z: it points from the tree to the camera.
      expect(-(m[8] as number) / columnLength(m, 2)).toBeCloseTo(-t.x / dist, 5);
      expect(-(m[10] as number) / columnLength(m, 2)).toBeCloseTo(-t.z / dist, 5);
    });
    expect(farTreeScale(1500)[0]).toBeGreaterThan(1);
  });

  it("compose a bucket's billboards over several slices, the same floats as at once", () => {
    const many = Array.from({ length: IMPOSTOR_SLICE * 2 + 3 }, (_, i) => tree({ x: 200 + i, z: 300 - i }));
    const slices = impostorMatrixSlices(many, [], 5, 1, 2);
    let steps = 0;
    let step = slices.next();
    while (step.done !== true) {
      steps++;
      step = slices.next();
    }
    expect(steps).toBe(2);
    expect([...step.value]).toEqual([...finish(impostorMatrixSlices(many, [], 5, 1, 2))]);
  });

  it("split the billboards by the bucket that draws them: giant sets, sapling species, then the snags", () => {
    const giantFir = tree({ species: 0 });
    const giantPine = tree({ species: 1, variant: 1 });
    const unloaded = tree({ species: 7 });
    const sapling = tree({ cohort: COHORT_SAPLING, species: 2 });
    const strangeSapling = tree({ cohort: COHORT_SAPLING, species: 3 });
    const snag = tree({ cohort: COHORT_SNAG });
    const log = tree({ cohort: COHORT_LOG });
    const giantSlot = (t: TreeInstance): number => (t.species === 0 ? 0 : t.species === 1 ? 1 + t.variant : -1);
    const slots = partitionImpostors([giantFir, giantPine, unloaded, sapling, strangeSapling, snag, log], giantSlot, 3, 3);
    expect(slots).toHaveLength(7);
    expect(slots[0]).toEqual([giantFir]);
    expect(slots[1]).toEqual([]);
    expect(slots[2]).toEqual([giantPine]);
    expect(slots[5]).toEqual([sapling]);
    expect(slots[6]).toEqual([snag]);
    expect(slots.flat()).not.toContain(log);
    expect(slots.flat()).not.toContain(unloaded);
    expect(slots.flat()).not.toContain(strangeSapling);
  });
});

describe("what the forest measures from its models", () => {
  it("is the dead trees' box, the snag's base, the log's ends and its trunk's lines", () => {
    const m = deadwoodMeasure(trunk());
    expect(m.min.x).toBeCloseTo(-2, 6);
    expect(m.max.x).toBeCloseTo(2, 6);
    expect(m.snagBaseOffset).toBe(-m.min.x);
    expect([m.logMinX, m.logMaxX]).toEqual([m.min.x, m.max.x]);
    expect(m.logSeat.diameter).toBeGreaterThan(0.5);
    expect(m.logSeat.a).toBeLessThan(0);
    expect(m.logTop.a).toBeGreaterThan(0);
  });

  it("measures no model as no trunk", () => {
    const m = deadwoodMeasure([]);
    expect(m.logSeat).toEqual({ a: 0, b: 0, diameter: 0 });
    expect(m.logTop).toEqual({ a: 0, b: 0 });
  });

  it("sizes a tree's billboard by its height and its widest horizontal extent, centred on its box", () => {
    expect(impostorQuad({ x: -2, y: -0.5, z: -3 }, { x: 2, y: 11.5, z: 4 })).toEqual({ width: 7, height: 12, centreY: 5.5 });
    // A box of no extent is held off zero, so a quad is never degenerate.
    expect(impostorQuad({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toEqual({ width: 0.01, height: 0.01, centreY: 0 });
  });

  it("sizes the snag's billboard in the stood-up frame: the trunk's length its height", () => {
    const m = deadwoodMeasure(trunk());
    const quad = snagImpostorQuad(m);
    expect(quad.height).toBeCloseTo(4, 5);
    expect(quad.width).toBeCloseTo(1, 5);
    expect(quad.centreY).toBeCloseTo(m.snagBaseOffset + (m.min.x + m.max.x) / 2, 9);
  });
});
