import { describe, expect, it } from "vitest";
import {
  BLADE_ALBEDO, BLADE_CHARACTERS, BLADE_CLUMP_RADIUS, BLADE_LUMA, BLADE_RINGS, BLADE_SOFT, BLADE_TIER_COUNTS,
  BLADE_TIP_TINT, BLADE_TRIS, BLADE_VERTEX_BUDGET, BLADE_VERTS, FLOWER_PALETTE,
  bladeAlive, bladeClumpGeometry, bladeSecondRandom, bladeVertexCount,
} from "../../src/game/bladeClump.js";
import {
  BLADE_CELL, BLADE_CHARACTER_COUNT, BLADE_FINE, BLADE_FLOWER, BLADE_PAD, BLADE_REACH, BLADE_TIER_BAND, BLADE_TIER_EDGE,
  BLADE_TUSSOCK, BLADE_WEED,
} from "../../src/game/bladeField.js";

describe("the character and tier tables", () => {
  it("match the spec", () => {
    expect(BLADE_CHARACTERS.length).toBe(BLADE_CHARACTER_COUNT);
    expect(BLADE_RINGS).toBe(3);
    expect(BLADE_VERTS).toBe(7);
    expect(BLADE_TRIS).toBe(5);
    expect(BLADE_CLUMP_RADIUS).toBe(0.35);
    expect(BLADE_ALBEDO).toEqual({ r: 0.03, g: 0.04, b: 0.013 });
    expect(BLADE_TIP_TINT).toEqual({ r: 0.95, g: 0.95, b: 0.75 });
    expect(BLADE_LUMA).toBe(0.3);
    expect(BLADE_SOFT).toBe(0.15);
    expect(BLADE_TIER_COUNTS.high).toEqual([[100, 40, 16], [80, 28, 12], [12, 8, 4], [100, 32, 12]]);
    expect(BLADE_TIER_COUNTS.medium).toEqual([[50, 20, 8], [40, 14, 6], [6, 4, 2], [50, 16, 6]]);
    expect(BLADE_CHARACTERS[BLADE_FINE]!.tip).toBe("none");
    expect(BLADE_CHARACTERS[BLADE_TUSSOCK]!.tip).toBe("seed");
    expect(BLADE_CHARACTERS[BLADE_WEED]!.width).toBe(0.03);
    expect(BLADE_CHARACTERS[BLADE_FLOWER]!.tip).toBe("flower");
    expect(BLADE_CHARACTERS[BLADE_FLOWER]!.heads).toEqual([1, 3]);
    expect(FLOWER_PALETTE.length).toBe(4);
  });

  it("keeps the high tier's field under the vertex budget", () => {
    const fine = BLADE_CHARACTERS[BLADE_FINE]!;
    const counts = BLADE_TIER_COUNTS.high[BLADE_FINE]!;
    const [e0, e1] = BLADE_TIER_EDGE;
    const cells = (rOut: number, rIn: number) => Math.PI * (rOut * rOut - rIn * rIn) / (BLADE_CELL * BLADE_CELL);
    const clumps = [
      cells(e0 + BLADE_PAD, 0),
      cells(e1 + BLADE_PAD, Math.max(0, e0 - BLADE_TIER_BAND - BLADE_PAD)),
      cells(BLADE_REACH + BLADE_PAD, Math.max(0, e1 - BLADE_TIER_BAND - BLADE_PAD)),
    ];
    let total = 0;
    for (let t = 0; t < 3; t++) total += clumps[t]! * bladeVertexCount(fine, counts[t]!);
    expect(total).toBeLessThan(BLADE_VERTEX_BUDGET);
    expect(total).toBeGreaterThan(BLADE_VERTEX_BUDGET * 0.5); // the budget is a real bound, not a formality
  });
});

describe("one clump per character and tier", () => {
  for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
    for (let t = 0; t < 3; t++) {
      const character = BLADE_CHARACTERS[ch]!;
      const count = BLADE_TIER_COUNTS.high[ch]![t]!;
      const g = bladeClumpGeometry(character, count);
      const vertexCount = g.positions.length / 3;

      it(`${character.name} tier ${t}: counts, roots, heights, normals, attribute, determinism`, () => {
        expect(vertexCount).toBe(bladeVertexCount(character, count));
        expect(g.normals.length).toBe(vertexCount * 3);
        expect(g.colors.length).toBe(vertexCount * 4);
        expect(g.blade.length).toBe(vertexCount * 4);
        for (const i of g.indices) expect(i).toBeLessThan(vertexCount);
        // Every blade's first two vertices sit at y = 0 inside the disc and
        // straddle their root; every vertex of a blade names the same root
        // and random; the height fraction rises to 1 at the tip.
        for (let b = 0; b < count; b++) {
          const v0 = b * BLADE_VERTS;
          for (const v of [v0, v0 + 1]) {
            expect(g.positions[v * 3 + 1]).toBe(0);
            const rx = g.blade[v * 4]!, rz = g.blade[v * 4 + 1]!;
            expect(Math.hypot(rx, rz)).toBeLessThanOrEqual(BLADE_CLUMP_RADIUS + 1e-9);
            expect(Math.hypot(g.positions[v * 3]! - rx, g.positions[v * 3 + 2]! - rz)).toBeCloseTo(character.width, 6);
          }
          for (let v = v0; v < v0 + BLADE_VERTS; v++) {
            expect(g.blade[v * 4]).toBe(g.blade[v0 * 4]);
            expect(g.blade[v * 4 + 1]).toBe(g.blade[v0 * 4 + 1]);
            expect(g.blade[v * 4 + 2]).toBe(g.blade[v0 * 4 + 2]);
          }
          const tip = v0 + BLADE_VERTS - 1;
          expect(g.blade[tip * 4 + 3]).toBe(1);
          const h = g.positions[tip * 3 + 1]!;
          expect(h).toBeGreaterThanOrEqual(character.height[0]);
          expect(h).toBeLessThanOrEqual(character.height[1]);
        }
        for (let v = 0; v < vertexCount; v++) {
          expect(Math.hypot(g.normals[v * 3]!, g.normals[v * 3 + 1]!, g.normals[v * 3 + 2]!)).toBeCloseTo(1, 6);
          expect(g.colors[v * 4 + 3]).toBe(1);
        }
        const again = bladeClumpGeometry(character, count);
        expect(Array.from(again.positions)).toEqual(Array.from(g.positions));
      });

      it(`${character.name} tier ${t}: the tip feature`, () => {
        const bladeVerts = count * BLADE_VERTS;
        if (character.tip === "none") {
          expect(vertexCount).toBe(bladeVerts);
        } else if (character.tip === "seed") {
          // One more strip per blade, continuing from its tip, straw-tinted.
          expect(vertexCount).toBe(bladeVerts + count * BLADE_VERTS);
          for (let b = 0; b < count; b++) {
            const parent = b * BLADE_VERTS;
            const parentTip = parent + BLADE_VERTS - 1;
            const head = bladeVerts + b * BLADE_VERTS;
            // The head's own first ring starts exactly at its blade's tip,
            // and every one of its vertices still names that blade's root
            // and random, so it collapses with it.
            expect(g.positions[head * 3 + 1]).toBeCloseTo(g.positions[parentTip * 3 + 1]!, 6);
            for (let k = 0; k < BLADE_VERTS; k++) {
              expect(g.blade[(head + k) * 4]).toBe(g.blade[parent * 4]);
              expect(g.blade[(head + k) * 4 + 1]).toBe(g.blade[parent * 4 + 1]);
              expect(g.blade[(head + k) * 4 + 2]).toBe(g.blade[parent * 4 + 2]);
            }
          }
          const v = bladeVerts; // the first seed head's first vertex
          expect(g.colors[v * 4]).toBeGreaterThan(g.colors[v * 4 + 2]!); // straw: red above blue
        } else {
          // Heads: 1–3 per clump, each a stem strip plus five petal strips
          // (BLADE_VERTS vertices apiece, six strips a head).
          const perHead = 6 * BLADE_VERTS;
          const heads = (vertexCount - bladeVerts) / perHead;
          expect(Number.isInteger(heads)).toBe(true);
          expect(heads).toBeGreaterThanOrEqual(character.heads![0]);
          expect(heads).toBeLessThanOrEqual(character.heads![1]);
          const stem = bladeVerts; // the first head's stem
          const rosette = stem + BLADE_VERTS; // the first head's first petal strip
          // The petal names the same root and random as its own stem, so the
          // whole head collapses together.
          for (let k = 0; k < BLADE_VERTS; k++) {
            expect(g.blade[(rosette + k) * 4]).toBe(g.blade[stem * 4]);
            expect(g.blade[(rosette + k) * 4 + 1]).toBe(g.blade[stem * 4 + 1]);
            expect(g.blade[(rosette + k) * 4 + 2]).toBe(g.blade[stem * 4 + 2]);
          }
          const c = [g.colors[rosette * 4]!, g.colors[rosette * 4 + 1]!, g.colors[rosette * 4 + 2]!];
          expect(FLOWER_PALETTE.some((p) => Math.abs(p.r - c[0]!) < 1e-6 && Math.abs(p.g - c[1]!) < 1e-6 && Math.abs(p.b - c[2]!) < 1e-6)).toBe(true);
          const y = g.positions[rosette * 3 + 1]!;
          expect(y).toBeGreaterThanOrEqual(0.3 - 0.04);
          expect(y).toBeLessThanOrEqual(0.45 + 0.04);
        }
      });
    }
  }

  it("tints by character and spreads the luma per blade", () => {
    const fine = bladeClumpGeometry(BLADE_CHARACTERS[BLADE_FINE]!, 40);
    const weed = bladeClumpGeometry(BLADE_CHARACTERS[BLADE_WEED]!, 12);
    // The weed's tint is bluer than the fine grass's at the root.
    expect(weed.colors[2]! / weed.colors[0]!).toBeGreaterThan(fine.colors[2]! / fine.colors[0]!);
    const lumas = new Set<number>();
    for (let b = 0; b < 40; b++) lumas.add(Math.round(fine.colors[b * BLADE_VERTS * 4]! * 1e6));
    expect(lumas.size).toBeGreaterThan(20);
  });
});

describe("bladeAlive, the mirror of the grow-in, the collapse and the strength cut", () => {
  it("is whole between the bands, absent before the grow-in and after the collapse", () => {
    for (const r of [0, 0.01, 0.5, 0.85, 0.999]) {
      expect(bladeAlive(r, 0.5, 1, 1, 0)).toBe(1);
      expect(bladeAlive(r, 0.5, 1, 0, 0)).toBe(0);
      expect(bladeAlive(r, 0.5, 1, 1, 1)).toBe(0);
    }
  });
  it("hands off complementary halves across a band: the inner keeps the high randoms, the outer the low", () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      let inner = 0, outer = 0, both = 0;
      const n = 200;
      for (let i = 0; i < n; i++) {
        const r = i / n;
        const a = bladeAlive(r, 0, 1, 1, t); // the inner tier: no grow-in, collapsing at t
        const b = bladeAlive(r, 0, 1, t, 0); // the outer tier: growing at t, no collapse
        inner += a; outer += b; if (a > 0 && b > 0) both++;
      }
      // Together they carry one clump's worth, within the soft window's width.
      expect((inner + outer) / n).toBeGreaterThan(1 - BLADE_SOFT);
      expect((inner + outer) / n).toBeLessThan(1 + BLADE_SOFT);
      expect(both / n).toBeLessThan(BLADE_SOFT + 0.01);
    }
  });
  it("cuts blades by the strength on the second random, not the hand-off random", () => {
    expect(bladeAlive(0.9, 0.2, 0.25, 1, 0)).toBe(1);
    expect(bladeAlive(0.9, 0.3, 0.25, 1, 0)).toBe(0);
    expect(bladeSecondRandom(0.1, 0.2)).toBeGreaterThanOrEqual(0);
    expect(bladeSecondRandom(0.1, 0.2)).toBeLessThan(1);
    expect(bladeSecondRandom(0.1, 0.2)).not.toBe(bladeSecondRandom(0.11, 0.2));
  });
});
