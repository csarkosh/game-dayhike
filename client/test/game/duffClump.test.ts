import { describe, expect, it } from "vitest";
import {
  DUFF_ALBEDO, DUFF_BRANCH, DUFF_CHARACTERS, DUFF_CHARACTER_COUNT, DUFF_CLUMP_RADIUS, DUFF_HEIGHT_MAX, DUFF_LEAF, DUFF_TIER_COUNTS, DUFF_TWIG,
  duffClumpGeometry, duffVertexCount,
} from "../../src/game/duffClump.js";
import { BLADE_TIP_TINT } from "../../src/game/bladeClump.js";

describe("the duff characters", () => {
  it("match the spec", () => {
    expect(DUFF_CHARACTER_COUNT).toBe(3);
    expect(DUFF_CHARACTERS[DUFF_TWIG]!.length).toEqual([0.10, 0.25]);
    expect(DUFF_CHARACTERS[DUFF_TWIG]!.pieces).toEqual([2, 3]);
    expect(DUFF_CHARACTERS[DUFF_BRANCH]!.length).toEqual([0.30, 0.60]);
    expect(DUFF_CHARACTERS[DUFF_BRANCH]!.pieces).toEqual([1, 1]);
    expect(DUFF_CHARACTERS[DUFF_LEAF]!.pieces).toEqual([4, 6]);
    expect(DUFF_CLUMP_RADIUS).toBe(0.3);
    expect(DUFF_HEIGHT_MAX).toBe(0.12);
    expect(DUFF_ALBEDO).toEqual({ r: 0.16, g: 0.11, b: 0.06 });
  });
});

describe("duffClumpGeometry", () => {
  it("builds every character from strips: the declared vertex count, closed index ranges, unit normals", () => {
    for (const ch of DUFF_CHARACTERS) {
      for (const count of [1, 3]) {
        const g = duffClumpGeometry(ch, count);
        const n = duffVertexCount(ch, count);
        expect(g.positions.length).toBe(n * 3);
        expect(g.normals.length).toBe(n * 3);
        expect(g.colors.length).toBe(n * 4);
        expect(g.blade.length).toBe(n * 4);
        expect(g.indices.length % 3).toBe(0);
        for (const i of g.indices) expect(i).toBeLessThan(n);
        for (let v = 0; v < n; v++) {
          const l = Math.hypot(g.normals[v * 3]!, g.normals[v * 3 + 1]!, g.normals[v * 3 + 2]!);
          expect(l).toBeCloseTo(1, 6);
        }
      }
    }
  });

  it("lies on the ground: every vertex inside the clump disc and under the height cap, and lifted at most a little", () => {
    for (const ch of DUFF_CHARACTERS) {
      const g = duffClumpGeometry(ch, 3);
      for (let v = 0; v < g.positions.length / 3; v++) {
        const x = g.positions[v * 3]!, y = g.positions[v * 3 + 1]!, z = g.positions[v * 3 + 2]!;
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(DUFF_CLUMP_RADIUS + ch.length[1] + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(DUFF_HEIGHT_MAX + 1e-9);
      }
    }
  });

  it("colours every piece inside its character's palette", () => {
    // The strip writer tints root→tip toward BLADE_TIP_TINT (createStripWriter's
    // `strip`), so the lower bound has to admit that gradient as well as the
    // per-piece luma spread: at the tip, a channel reaches tint · (1 - spread) ·
    // BLADE_TIP_TINT's own channel, not just tint · (1 - spread). The gradient
    // only darkens (BLADE_TIP_TINT's channels are all ≤ 1), so the upper bound
    // is unaffected.
    for (const ch of DUFF_CHARACTERS) {
      const g = duffClumpGeometry(ch, 3);
      for (let v = 0; v < g.colors.length / 4; v++) {
        const r = g.colors[v * 4]!, gg = g.colors[v * 4 + 1]!, b = g.colors[v * 4 + 2]!;
        expect(r).toBeGreaterThanOrEqual(ch.tint.r * (1 - ch.tintSpread) * BLADE_TIP_TINT.r - 1e-9);
        expect(r).toBeLessThanOrEqual(ch.tint.r * (1 + ch.tintSpread) + 1e-9);
        expect(gg).toBeGreaterThan(0);
        expect(b).toBeGreaterThan(0);
        expect(g.colors[v * 4 + 3]).toBe(1);
      }
    }
  });

  it("carries the collapse attribute: every vertex names its piece's root and a random in [0, 1)", () => {
    const g = duffClumpGeometry(DUFF_CHARACTERS[DUFF_LEAF]!, 2);
    for (let v = 0; v < g.blade.length / 4; v++) {
      expect(Math.hypot(g.blade[v * 4]!, g.blade[v * 4 + 1]!)).toBeLessThanOrEqual(DUFF_CLUMP_RADIUS + 1e-9);
      expect(g.blade[v * 4 + 2]).toBeGreaterThanOrEqual(0);
      expect(g.blade[v * 4 + 2]).toBeLessThan(1);
    }
  });

  it("is deterministic", () => {
    const a = duffClumpGeometry(DUFF_CHARACTERS[DUFF_TWIG]!, 3);
    const b = duffClumpGeometry(DUFF_CHARACTERS[DUFF_TWIG]!, 3);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });

  it("stays under the vertex budget over the high tier's reach at full strength", () => {
    // 1 m lattice, near disc to 6 m + pad, far annulus to 12 m + pad, both padded 2.83 m.
    // `count` is the tier multiplier (DUFF_TIER_COUNTS), not a piece count.
    const pad = Math.SQRT2 * 2;
    const near = Math.PI * (6 + pad) ** 2, far = Math.PI * ((12 + pad) ** 2 - Math.max(0, 6 - 1.5 - pad) ** 2);
    let worst = 0;
    for (const ch of DUFF_CHARACTERS) {
      worst = Math.max(worst, near * duffVertexCount(ch, DUFF_TIER_COUNTS.high[0]) + far * duffVertexCount(ch, DUFF_TIER_COUNTS.high[1]));
    }
    expect(worst).toBeLessThan(120_000);
  });
});
