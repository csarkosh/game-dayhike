import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { NO_STITCH, PATCH_FAR_SPACING, PATCH_NEAR_SPACING, PATCH_WIDE_SPACING, facePatchGeometry, type FacePatch } from "../../../src/game/facePatches.js";
import {
  PATCH_SPACINGS, createMarkedRun, createPatchPool, firstDifference, patchIndexCapacity, patchIndexCount, patchVertexCount, writePatchTriangles,
  type DrawnPatch,
} from "../../../src/game/lite/patchPool.js";
import { PATCH_POOL_VERTICES, patchPlace } from "../../../src/game/lite/terrainMeshes.js";

/** A band's triangles as a patch has them: a grid of `n` squares a side, two triangles a square, in the game's winding. */
function gridTriangles(spacing: number): Uint16Array {
  const n = Math.round(16 / spacing);
  const side = n + 1;
  const out = new Uint16Array(n * n * 6);
  let k = 0;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const a = iz * side + ix;
      out.set([a, a + 1, a + side, a + 1, a + side + 1, a + side], k);
      k += 6;
    }
  }
  return out;
}

const PATTERNS = new Map<number, Uint16Array>(PATCH_SPACINGS.map((spacing) => [spacing, gridTriangles(spacing)]));
/** The world the patches' own tests look at. */
const SEED = 627994160;

describe("the steep ground's patches as one mesh on Babylon Lite", () => {
  it("sizes a slot as its band's grid, and the list of triangles for the finest band's share", () => {
    expect([...PATCH_SPACINGS]).toEqual([PATCH_NEAR_SPACING, PATCH_FAR_SPACING, PATCH_WIDE_SPACING]);
    expect(PATCH_SPACINGS.map(patchVertexCount)).toEqual([33 * 33, 17 * 17, 9 * 9]);
    expect(PATCH_SPACINGS.map(patchIndexCount)).toEqual([32 * 32 * 6, 16 * 16 * 6, 8 * 8 * 6]);
    // Whatever bands fill a pool, their triangles fit the list made for it, which is whole triangles.
    for (const vertices of [81, 1089, 24_000, 72_000]) {
      const room = patchIndexCapacity(vertices);
      expect(room % 3).toBe(0);
      for (const spacing of PATCH_SPACINGS) expect(Math.floor(vertices / patchVertexCount(spacing)) * patchIndexCount(spacing)).toBeLessThanOrEqual(room);
    }
  });

  it("is the game's own patch at each spacing: as many vertices, and the band's triangles whatever the ground", () => {
    // A cell with steep ground, as the patches' own tests name one.
    for (const spacing of PATCH_SPACINGS) {
      const patch = facePatchGeometry(SEED, -24, -57, spacing, NO_STITCH) as FacePatch;
      expect(patch).not.toBeNull();
      expect(patch.vertexCount).toBe(patchVertexCount(spacing));
      expect(patch.positions.length).toBe(patchVertexCount(spacing) * 3);
      expect([...patch.indices]).toEqual([...gridTriangles(spacing)]);
      // A stitched patch moves vertices, never triangles.
      const stitched = facePatchGeometry(SEED, -24, -57, spacing, { west: true, east: true, north: true, south: true, open: 255 }) as FacePatch;
      expect([...stitched.indices]).toEqual([...patch.indices]);
    }
  });

  it("hands a patch a slot of its band's size, the next never used, until the pool has no room for one", () => {
    const pool = createPatchPool(1089 + 289 + 81 + 80);
    const near = pool.take(PATCH_NEAR_SPACING);
    const far = pool.take(PATCH_FAR_SPACING);
    const wide = pool.take(PATCH_WIDE_SPACING);
    expect([near, far, wide]).toEqual([{ at: 0, spacing: 0.5 }, { at: 1089, spacing: 1 }, { at: 1378, spacing: 2 }]);
    expect([pool.top, pool.taken, pool.capacity]).toEqual([1459, 3, 1539]);
    // Eighty vertices are left: no band's grid fits.
    for (const spacing of PATCH_SPACINGS) expect(pool.take(spacing)).toBeNull();
    expect(pool.taken).toBe(3);
  });

  it("gives the run a patch let go to the next patch that fits, in place, and joins runs let go side by side", () => {
    const pool = createPatchPool(10_000);
    const slots = [pool.take(1), pool.take(1), pool.take(2), pool.take(0.5)].map((slot) => slot as NonNullable<typeof slot>);
    const [farA, farB, wide, near] = slots as [(typeof slots)[number], (typeof slots)[number], (typeof slots)[number], (typeof slots)[number]];
    const top = pool.top;
    expect([farA.at, farB.at, wide.at, near.at, top]).toEqual([0, 289, 578, 659, 1748]);
    // The second far patch and the wide one beside it go: one run of 370 vertices.
    pool.free(farB);
    pool.free(wide);
    expect(pool.taken).toBe(2);
    // A near patch does not fit it: it stands past everything.
    expect(pool.take(0.5)).toEqual({ at: top, spacing: 0.5 });
    // A far patch takes the run's start, and a wide one what is left of it; the pool grows no further for them.
    expect(pool.take(1)).toEqual({ at: 289, spacing: 1 });
    expect(pool.take(2)).toEqual({ at: 578, spacing: 2 });
    expect(pool.top).toBe(top + 1089);
    // Three wide patches fit where a far one stood, and the fourth does not.
    pool.free(farA);
    expect([pool.take(2), pool.take(2), pool.take(2)].map((slot) => slot?.at)).toEqual([0, 81, 162]);
    expect(pool.take(2)).toEqual({ at: top + 1089, spacing: 2 });
  });

  it("ends where its last patch ends: what is let go at the end is taken from the end again", () => {
    const pool = createPatchPool(10_000);
    const first = pool.take(1) as NonNullable<ReturnType<typeof pool.take>>;
    const second = pool.take(0.5) as NonNullable<ReturnType<typeof pool.take>>;
    const third = pool.take(2) as NonNullable<ReturnType<typeof pool.take>>;
    expect(pool.top).toBe(289 + 1089 + 81);
    pool.free(third);
    expect(pool.top).toBe(289 + 1089);
    // The middle one let go is a run inside; the first after it joins that run, and with nothing left the pool is empty.
    pool.free(second);
    expect(pool.top).toBe(289);
    pool.free(first);
    expect([pool.top, pool.taken]).toEqual([0, 0]);
    // Sixty walks of patches in and out, in whatever order, leave the pool where it was.
    for (let i = 0; i < 60; i++) {
      const held = [pool.take(2), pool.take(1), pool.take(i % 3 === 0 ? 0.5 : 2)].map((slot) => slot as NonNullable<typeof slot>);
      for (const at of i % 2 === 0 ? [0, 1, 2] : [1, 2, 0]) pool.free(held[at] as (typeof held)[number]);
    }
    expect([pool.top, pool.taken]).toEqual([0, 0]);
    expect(pool.take(0.5)).toEqual({ at: 0, spacing: 0.5 });
  });

  it("says which slot a patch would take without taking it", () => {
    const pool = createPatchPool(289 + 81);
    expect(pool.peek(1)).toEqual({ at: 0, spacing: 1 });
    expect(pool.taken).toBe(0);
    const far = pool.take(1) as NonNullable<ReturnType<typeof pool.take>>;
    expect(pool.peek(2)).toEqual({ at: 289, spacing: 2 });
    // No room for a second far patch, until the first is let go: then that slot is the one.
    expect(pool.peek(1)).toBeNull();
    pool.free(far);
    expect(pool.peek(1)).toEqual(far);
    expect(pool.take(1)).toEqual(far);
  });

  it("counts a frame's marks of the plugin vertex data as the one run Lite sends: first mark to last", () => {
    const run = createMarkedRun();
    expect(run.begins(7)).toBe(true);
    // The first mark of a frame is itself.
    expect(run.cost(7, 1000, 1400)).toBe(400 * 4);
    expect(run.mark(7, 1000, 1400)).toBe(400 * 4);
    expect(run.begins(7)).toBe(false);
    // One beside it adds its own floats; one inside the run adds none; one far off adds everything between.
    expect(run.mark(7, 1400, 1500)).toBe(100 * 4);
    expect(run.mark(7, 1100, 1200)).toBe(0);
    expect(run.cost(7, 9000, 9100)).toBe((9100 - 1500) * 4);
    expect(run.cost(7, 0, 100)).toBe(1000 * 4);
    // Asking marks nothing, and the next frame's run begins again.
    expect(run.mark(7, 1500, 1600)).toBe(100 * 4);
    expect(run.begins(8)).toBe(true);
    expect(run.mark(8, 9000, 9100)).toBe(100 * 4);
    expect(run.cost(8, 9100, 9200)).toBe(100 * 4);
  });

  it("grows without moving a slot, and never shrinks", () => {
    const pool = createPatchPool(289);
    const first = pool.take(1);
    expect(pool.take(1)).toBeNull();
    pool.grow(600);
    expect(pool.capacity).toBe(600);
    expect(pool.take(1)).toEqual({ at: 289, spacing: 1 });
    expect(first).toEqual({ at: 0, spacing: 1 });
    expect(() => pool.grow(100)).toThrow(/does not shrink/);
  });

  it("starts each tier's pool with room for more than a slot of every band", () => {
    for (const vertices of Object.values(PATCH_POOL_VERTICES)) expect(vertices).toBeGreaterThan(8 * 1089);
    expect(PATCH_POOL_VERTICES.low).toBeLessThan(PATCH_POOL_VERTICES.medium);
    expect(PATCH_POOL_VERTICES.medium).toBeLessThanOrEqual(PATCH_POOL_VERTICES.high);
  });

  it("writes the triangles of the patches drawn in the order of their places, each band's pattern moved to its slot", () => {
    const pool = createPatchPool(10_000);
    const take = (spacing: number) => pool.take(spacing) as NonNullable<ReturnType<typeof pool.take>>;
    // Built in an order that is not their places': the far cell first, then two wide ones, then the near one.
    const drawn: DrawnPatch[] = [
      { slot: take(1), place: patchPlace(3, 7) },
      { slot: take(2), place: patchPlace(9, 0) },
      { slot: take(2), place: patchPlace(-30, 5) },
      { slot: take(0.5), place: patchPlace(3, 6) },
    ];
    const built = [...drawn];
    const out = new Uint32Array(patchIndexCapacity(10_000)).fill(0xffffffff);
    const count = writePatchTriangles(drawn, PATTERNS, out);
    expect(count).toBe(1536 + 384 + 384 + 6144);
    // By place: cell (-30, 5) is column 2 of its period, then (3, 6), (3, 7), (9, 0).
    expect(drawn).toEqual([built[2], built[3], built[0], built[1]]);
    let at = 0;
    for (const patch of drawn) {
      const pattern = PATTERNS.get(patch.slot.spacing) as Uint16Array;
      const run = out.subarray(at, at + pattern.length);
      for (let i = 0; i < pattern.length; i++) {
        if (run[i] !== (pattern[i] as number) + patch.slot.at) throw new Error(`index ${at + i} is ${run[i]}, not ${(pattern[i] as number) + patch.slot.at}`);
      }
      // Every index of a patch lies in its own slot.
      expect(Math.min(...run)).toBe(patch.slot.at);
      expect(Math.max(...run)).toBe(patch.slot.at + patchVertexCount(patch.slot.spacing) - 1);
      at += pattern.length;
    }
    // Past the list nothing is written.
    expect(out[count]).toBe(0xffffffff);
  });

  it("keeps two patches at one place in the order they came, and says what it cannot write", () => {
    const pool = createPatchPool(10_000);
    const a = { slot: pool.take(2) as NonNullable<ReturnType<typeof pool.take>>, place: patchPlace(1, 1) };
    const b = { slot: pool.take(2) as NonNullable<ReturnType<typeof pool.take>>, place: patchPlace(33, 33) };
    expect(a.place).toBe(b.place);
    const drawn = [b, a];
    const out = new Uint32Array(768);
    expect(writePatchTriangles(drawn, PATTERNS, out)).toBe(768);
    expect(drawn).toEqual([b, a]);
    expect(out[0]).toBe(b.slot.at);
    expect(() => writePatchTriangles([a, b], PATTERNS, new Uint32Array(700))).toThrow(/do not fit/);
    expect(() => writePatchTriangles([a], new Map(), out)).toThrow(/no triangles/);
  });

  it("finds where a list first differs from the one before it, so a set sends its triangles from there", () => {
    const a = Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(firstDifference(a, Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]), 9)).toBe(9);
    expect(firstDifference(a, Uint32Array.from([0, 1, 2, 9, 4, 5, 6, 7, 8]), 9)).toBe(3);
    // Within the first `count` alone: a list that only grew or shrank differs from nowhere in what both hold.
    expect(firstDifference(a, Uint32Array.from([0, 1, 2, 3, 4, 5, 0, 0, 0]), 6)).toBe(6);
    expect(firstDifference(a, a, 0)).toBe(0);
  });
});
