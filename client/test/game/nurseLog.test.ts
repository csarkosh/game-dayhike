import { describe, expect, it } from "vitest";
import {
  MOSS_TINT, NURSE_FERN, NURSE_FERN_SCALE, NURSE_FERNS_MAX, NURSE_SEEDLING, NURSE_SEEDLING_SCALE, NURSE_SEEDLINGS_MAX,
  NURSE_SHARE, mossColours, nursePlants, seedlingGeometry,
} from "../../src/game/nurseLog.js";
import { trunkTop } from "../../src/game/logSeat.js";

describe("nursePlants", () => {
  it("is a pure function of the log's hash", () => {
    for (const hash of [0, 0.123, 0.5, 0.999]) expect(nursePlants(hash, -2, 2)).toEqual(nursePlants(hash, -2, 2));
  });

  it("makes NURSE_SHARE of the logs nurse logs, each with ferns and seedlings in their bands and off the trunk's ends", () => {
    let nurse = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const plants = nursePlants((i + 0.5) / N, -2, 2);
      if (plants.length === 0) continue;
      nurse++;
      const ferns = plants.filter((p) => p.kind === NURSE_FERN);
      const seedlings = plants.filter((p) => p.kind === NURSE_SEEDLING);
      expect(ferns.length).toBeGreaterThanOrEqual(2);
      expect(ferns.length).toBeLessThanOrEqual(NURSE_FERNS_MAX);
      expect(seedlings.length).toBeGreaterThanOrEqual(2);
      expect(seedlings.length).toBeLessThanOrEqual(NURSE_SEEDLINGS_MAX);
      for (const p of plants) {
        const band = p.kind === NURSE_FERN ? NURSE_FERN_SCALE : NURSE_SEEDLING_SCALE;
        expect(p.scale).toBeGreaterThanOrEqual(band[0]);
        expect(p.scale).toBeLessThanOrEqual(band[1]);
        expect(Math.abs(p.along)).toBeLessThan(2 - 0.4);
        expect(Math.abs(p.side)).toBeLessThan(0.25);
      }
    }
    expect(nurse / N).toBeGreaterThan(NURSE_SHARE - 0.05);
    expect(nurse / N).toBeLessThan(NURSE_SHARE + 0.05);
  });
});

describe("mossColours", () => {
  it("leaves the underside bark and greens the upper side", () => {
    const positions = [0, 0, 0, 0.5, 1, 0.2, 1, 0.5, -0.1];
    const normals = [0, -1, 0, 0, 1, 0, 1, 0, 0];
    const c = mossColours(positions, normals);
    expect(Array.from(c.slice(0, 4))).toEqual([1, 1, 1, 1]);
    // Up-facing: toward the tint, greener than red, never past it.
    expect(c[5]!).toBeGreaterThan(1);
    expect(c[5]!).toBeLessThanOrEqual(MOSS_TINT[1]);
    expect(c[4]!).toBeLessThan(1);
    expect(c[7]).toBe(1);
    // A side face carries a little: between bark and the top's.
    expect(c[9]!).toBeGreaterThanOrEqual(1);
    expect(c[9]!).toBeLessThan(c[5]!);
  });
});

describe("seedlingGeometry", () => {
  it("is a metre tall on its foot, with whole arrays and unit normals", () => {
    const g = seedlingGeometry();
    const verts = g.positions.length / 3;
    expect(g.normals.length).toBe(verts * 3);
    expect(g.colors.length).toBe(verts * 4);
    expect(g.indices.length % 3).toBe(0);
    let minY = Infinity, maxY = -Infinity, maxR = 0;
    for (let i = 0; i < verts; i++) {
      minY = Math.min(minY, g.positions[i * 3 + 1]!);
      maxY = Math.max(maxY, g.positions[i * 3 + 1]!);
      maxR = Math.max(maxR, Math.hypot(g.positions[i * 3]!, g.positions[i * 3 + 2]!));
      expect(Math.hypot(g.normals[i * 3]!, g.normals[i * 3 + 1]!, g.normals[i * 3 + 2]!)).toBeCloseTo(1, 5);
    }
    for (const i of g.indices) expect(i).toBeLessThan(verts);
    expect(maxY).toBe(1);
    expect(minY).toBeGreaterThan(-0.05);
    expect(maxR).toBeLessThan(0.4);
  });
});

describe("trunkTop", () => {
  it("fits the top of a trunk whose section is a box climbing along X", () => {
    const out: number[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = -2 + i * 0.1;
      for (const z of [-0.2, 0.2]) out.push(x, 0.1 + 0.05 * x, z, x, 0.6 + 0.05 * x, z);
    }
    const top = trunkTop(out);
    expect(top.b).toBeCloseTo(0.05, 2);
    expect(Math.abs(top.a - 0.6)).toBeLessThan(0.05 * 0.25 + 1e-6);
  });
});
