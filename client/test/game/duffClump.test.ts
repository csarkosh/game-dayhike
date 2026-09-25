import { describe, expect, it } from "vitest";
import {
  DUFF_ALBEDO, DUFF_BRANCH, DUFF_CHARACTERS, DUFF_CHARACTER_COUNT, DUFF_CLUMP_RADIUS, DUFF_HEIGHT_MAX, DUFF_LEAF, DUFF_TIER_COUNTS, DUFF_TWIG,
  DUFF_VERTEX_BUDGET,
  duffClumpGeometry, duffClumpMaxHeight, duffClumpReach, duffVertexCount,
} from "../../src/game/duffClump.js";
import { DUFF_PAD, DUFF_REACH, DUFF_TIER_BAND, DUFF_TIER_EDGE } from "../../src/game/duffField.js";
import { BLADE_TIP_TINT, BLADE_VERTS } from "../../src/game/bladeClump.js";

describe("the duff characters", () => {
  it("tints the leaf tan, not red: the litter's own hue in linear terms", () => {
    // A leaf's albedo is DUFF_ALBEDO × the leaf character's tint. The
    // litter in the reference photographs is tan/rust: linear g/r ≈ 0.67
    // and b/r ≈ 0.33. The previous tint (1.15, 0.80, 0.45) gave g/r 0.48,
    // which read as red-brown on a black floor.
    const leaf = DUFF_CHARACTERS[DUFF_LEAF]!;
    expect(leaf.tint).toEqual({ r: 1.05, g: 1.05, b: 0.9 });
    const r = DUFF_ALBEDO.r * leaf.tint.r;
    const g = DUFF_ALBEDO.g * leaf.tint.g;
    const b = DUFF_ALBEDO.b * leaf.tint.b;
    expect(g / r).toBeGreaterThanOrEqual(0.6);
    expect(g / r).toBeLessThanOrEqual(0.8);
    expect(b / r).toBeGreaterThanOrEqual(0.25);
    expect(b / r).toBeLessThanOrEqual(0.45);
  });

  it("match the spec", () => {
    expect(DUFF_CHARACTER_COUNT).toBe(3);
    expect(DUFF_CHARACTERS[DUFF_TWIG]!.length).toEqual([0.10, 0.25]);
    expect(DUFF_CHARACTERS[DUFF_TWIG]!.pieces).toEqual([3, 5]);
    expect(DUFF_CHARACTERS[DUFF_TWIG]!.width).toBe(0.006);
    expect(DUFF_CHARACTERS[DUFF_BRANCH]!.length).toEqual([0.30, 0.60]);
    expect(DUFF_CHARACTERS[DUFF_BRANCH]!.pieces).toEqual([1, 1]);
    expect(DUFF_CHARACTERS[DUFF_LEAF]!.pieces).toEqual([14, 22]);
    expect(DUFF_CHARACTERS[DUFF_LEAF]!.length).toEqual([0.12, 0.20]);
    expect(DUFF_CHARACTERS[DUFF_LEAF]!.width).toBe(0.04);
    expect(DUFF_CLUMP_RADIUS).toBe(0.5);
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

  it("spans exactly twice its declared width at the base: width is a half-width", () => {
    // `width` on DuffCharacter is documented as a half-width (the strip
    // writer places a ring's two side vertices at ±width from the root), so
    // the base ring's own two vertices — the first two a piece's strip
    // writes, at height fraction 0 — sit exactly `2 * width` apart
    // horizontally, before any lift or yaw touches them (layDown leaves a
    // root vertex untouched, since its "along" component is zero). A leaf
    // piece is unforked, so every BLADE_VERTS-vertex block in the clump's
    // geometry is one piece's own strip, root-first.
    const leaf = DUFF_CHARACTERS[DUFF_LEAF]!;
    const g = duffClumpGeometry(leaf, 1);
    const pieces = g.positions.length / 3 / BLADE_VERTS;
    expect(Number.isInteger(pieces)).toBe(true);
    for (let p = 0; p < pieces; p++) {
      const first = p * BLADE_VERTS;
      const x0 = g.positions[first * 3]!, z0 = g.positions[first * 3 + 2]!;
      const x1 = g.positions[(first + 1) * 3]!, z1 = g.positions[(first + 1) * 3 + 2]!;
      const span = Math.hypot(x1 - x0, z1 - z0);
      expect(span).toBeGreaterThanOrEqual(leaf.width - 1e-9);
      expect(span).toBeLessThanOrEqual(2 * leaf.width + 0.001);
      expect(span).toBeCloseTo(2 * leaf.width, 6); // positions are float32
    }
  });

  it("lies on the ground: every vertex inside the clump's derived reach and under the height cap, and lifted at most a little", () => {
    for (const ch of DUFF_CHARACTERS) {
      const reach = duffClumpReach(ch);
      const g = duffClumpGeometry(ch, 3);
      for (let v = 0; v < g.positions.length / 3; v++) {
        const x = g.positions[v * 3]!, y = g.positions[v * 3 + 1]!, z = g.positions[v * 3 + 2]!;
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(reach + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(DUFF_HEIGHT_MAX + 1e-9);
      }
    }
  });

  it("bounds a real sample: duffClumpReach and duffClumpMaxHeight are true bounds, with margin to spare", () => {
    // A large sample (a tier multiplier, not a piece count — see the vertex-
    // budget test below) so a piece's parameters approach their own extremes
    // many times over; the assertions must hold regardless of how close a
    // sample happens to get, since duffClumpReach and duffClumpMaxHeight are
    // derived analytically from the character's own numbers, not fitted to
    // a sample. `worstHeight` is checked with a strict `<`, not `<=` plus a
    // tolerance: the generator clamps to DUFF_HEIGHT_MAX, so a permissive
    // bound on the clamped output can never fail even once the clamp starts
    // firing — only a strict bound on the achieved value catches that.
    const SAMPLE = 20_000;
    for (const ch of DUFF_CHARACTERS) {
      const reach = duffClumpReach(ch);
      const maxHeight = duffClumpMaxHeight(ch);
      expect(maxHeight).toBeLessThan(DUFF_HEIGHT_MAX);

      const g = duffClumpGeometry(ch, SAMPLE);
      let worstReach = 0, worstHeight = 0;
      for (let v = 0; v < g.positions.length / 3; v++) {
        const x = g.positions[v * 3]!, y = g.positions[v * 3 + 1]!, z = g.positions[v * 3 + 2]!;
        worstReach = Math.max(worstReach, Math.hypot(x, z));
        worstHeight = Math.max(worstHeight, y);
      }
      expect(worstReach).toBeLessThanOrEqual(reach + 1e-9);
      expect(worstHeight).toBeLessThan(DUFF_HEIGHT_MAX);
      console.log(
        `duff ${ch.name}: reach ${reach.toFixed(6)} m (sampled ${worstReach.toFixed(6)} m, ` +
        `margin ${(reach - worstReach).toFixed(6)} m); height-cap margin ${(DUFF_HEIGHT_MAX - maxHeight).toFixed(6)} m ` +
        `analytic, ${(DUFF_HEIGHT_MAX - worstHeight).toFixed(6)} m sampled`,
      );
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

  it("is deterministic: positions, normals, colours, the collapse attribute and the index buffer all repeat", () => {
    const a = duffClumpGeometry(DUFF_CHARACTERS[DUFF_TWIG]!, 3);
    const b = duffClumpGeometry(DUFF_CHARACTERS[DUFF_TWIG]!, 3);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.normals)).toEqual(Array.from(b.normals));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.blade)).toEqual(Array.from(b.blade));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });

  it("stays under the vertex budget over the high tier's reach at full strength", () => {
    // 1 m lattice, near disc to the tier edge + pad, far annulus to the reach + pad.
    // `count` is the tier multiplier (DUFF_TIER_COUNTS), not a piece count.
    const e = DUFF_TIER_EDGE, r = DUFF_REACH.high, pad = DUFF_PAD;
    const near = Math.PI * (e + pad) ** 2, far = Math.PI * ((r + pad) ** 2 - Math.max(0, e - DUFF_TIER_BAND - pad) ** 2);
    let worst = 0;
    for (const ch of DUFF_CHARACTERS) {
      worst = Math.max(worst, near * duffVertexCount(ch, DUFF_TIER_COUNTS.high[0]) + far * duffVertexCount(ch, DUFF_TIER_COUNTS.high[1]));
    }
    expect(worst).toBeLessThan(DUFF_VERTEX_BUDGET);
    expect(worst).toBeGreaterThan(DUFF_VERTEX_BUDGET * 0.5); // the budget is a real bound, not a formality
  });
});
