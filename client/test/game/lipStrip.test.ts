import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { COVE_END_BLEND } from "@csarkosh/engine/sim/olympic";
import { LIP_COLUMNS, LIP_PROFILE_VERTS, LIP_RANGE_M, LIP_SLOTS } from "@csarkosh/engine/game/oceanBreaker";
import { LIP_COARSE_M, LIP_FINE_M, closeFreeSlots, lipColumns, lipNear, lipReach, lipStripGeometry } from "@csarkosh/engine/game/lipStrip";
import type { SwashCove } from "@csarkosh/engine/game/swashTable";
import { OCEAN_BOUND } from "@csarkosh/engine/game/water";

const COVE: SwashCove = { z0: 12, halfWidth: 90, toeD: -30, faceGrade: 0.1, coastX: (z) => -400 + 0.05 * z };

describe("the plunging lip's strip", () => {
  it("covers the cove's width and its end blends, a column a metre near and every other one far", () => {
    const fine = lipColumns(COVE, LIP_FINE_M);
    const coarse = lipColumns(COVE, LIP_COARSE_M);
    expect(fine[0]).toBe(LIP_COLUMNS / 2 - (COVE.halfWidth + COVE_END_BLEND));
    expect(fine[fine.length - 1]).toBe(LIP_COLUMNS / 2 + COVE.halfWidth + COVE_END_BLEND);
    expect(coarse.length).toBe(Math.ceil(fine.length / 2));
    expect(coarse.every((c, i) => c === fine[2 * i])).toBe(true);
  });

  it("carries a column's world z, its slot and its section's vertex in each position, the sections joined in quads", () => {
    const { positions, indices } = lipStripGeometry(COVE, LIP_FINE_M);
    const columns = lipColumns(COVE, LIP_FINE_M);
    expect(positions.length).toBe(columns.length * LIP_SLOTS * LIP_PROFILE_VERTS * 3);
    expect(indices.length).toBe((columns.length - 1) * LIP_SLOTS * (LIP_PROFILE_VERTS - 1) * 6);
    // The first vertex of the second slot's second column.
    const o = (columns.length + 1) * LIP_PROFILE_VERTS * 3;
    expect([positions[o], positions[o + 1], positions[o + 2]]).toEqual([COVE.z0 - LIP_COLUMNS / 2 + (columns[1] as number), 1, 0]);
    let most = 0;
    for (const i of indices) most = Math.max(most, i);
    expect(most).toBe(positions.length / 3 - 1);
    // No triangle joins the two slots.
    const slotOf = (v: number): number => Math.floor(v / (columns.length * LIP_PROFILE_VERTS));
    for (let t = 0; t < indices.length; t += 3) {
      expect(slotOf(indices[t] as number)).toBe(slotOf(indices[t + 2] as number));
    }
  });

  it("closes a free slot on the live crest beside it, and says whether any slot is live", () => {
    const data = new Float32Array(LIP_COLUMNS * LIP_SLOTS * 4);
    const out = new Float32Array(data.length);
    expect(closeFreeSlots(data, out)).toBe(false);
    // Column 100 of slot 0 in mid-plunge; 101 a free slot left at another crest.
    data.set([-12, 0.5, 1.5, 1], 100 * 4);
    data.set([-3, 0, 2, 1], 101 * 4);
    expect(closeFreeSlots(data, out)).toBe(true);
    expect(Array.from(out.subarray(100 * 4, 100 * 4 + 4))).toEqual([-12, 0.5, 1.5, 1]);
    expect(Array.from(out.subarray(101 * 4, 101 * 4 + 4))).toEqual([-12, 0, 0, 0]);
    expect(Array.from(out.subarray(98 * 4, 98 * 4 + 4))).toEqual([-12, 0, 0, 0]);
    // Past two columns a free slot keeps what it holds, as does the other slot.
    expect(Array.from(out.subarray(103 * 4, 103 * 4 + 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(out.subarray((LIP_COLUMNS + 101) * 4, (LIP_COLUMNS + 101) * 4 + 4))).toEqual([0, 0, 0, 0]);
    // The tracker's own state is left as it was.
    expect(Array.from(data.subarray(101 * 4, 101 * 4 + 4))).toEqual([-3, 0, 2, 1]);
  });

  it("is tested against the box of every place a vertex can take, and hands a camera the fine strip within its range of the face", () => {
    const reach = lipReach(COVE, 0);
    const columns = lipColumns(COVE, LIP_FINE_M);
    expect(reach.zFirst).toBe(COVE.z0 - LIP_COLUMNS / 2 + (columns[0] as number));
    expect(reach.zLast).toBe(COVE.z0 - LIP_COLUMNS / 2 + (columns[columns.length - 1] as number));
    expect(reach.min[0]).toBeLessThanOrEqual(COVE.coastX(reach.zFirst) + COVE.toeD - 2 * OCEAN_BOUND);
    expect(reach.max[0]).toBeGreaterThanOrEqual(COVE.coastX(reach.zLast) + 2 * OCEAN_BOUND);
    expect([reach.min[1], reach.max[1]]).toEqual([-OCEAN_BOUND, 2 * OCEAN_BOUND]);
    expect(reach.faceX.length).toBe(columns.length);
    const faceAt = COVE.coastX(COVE.z0) + COVE.toeD / 2;
    expect(lipNear(reach, faceAt + LIP_RANGE_M - 1, COVE.z0)).toBe(true);
    expect(lipNear(reach, faceAt + LIP_RANGE_M + 1, COVE.z0)).toBe(false);
  });
});
