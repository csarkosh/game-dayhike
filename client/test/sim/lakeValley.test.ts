import { describe, expect, it } from "vitest";
import {
  lakeApronEnd, lakeOutline, lakeShoreInto, newLakeShore, valleyLakeShape, type LakeShape,
} from "../../src/sim/lakeShape.js";
import { hash3 } from "../../src/sim/field.js";
import { featureDraw, POND_RADIUS_MAX, POND_RADIUS_MIN } from "../../src/sim/features.js";
import { LOBBY_SEEDS } from "./trailGateSeeds.js";
import { median, outlineMetrics } from "./helpers/outlineMetrics.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** A hillside rising 0.1 toward +x: its contour runs along z, its uphill side is +x. */
const plane = (x: number): number => 100 + 0.1 * x;
const draw = (seed: number): LakeShape =>
  valleyLakeShape(seed, 1, 300, 50, featureDraw(seed, 1, 0, POND_RADIUS_MIN, POND_RADIUS_MAX), 0.1, 0, plane);

describe("a valley lake's draw", { timeout: timeLimit(180_000) }, () => {
  it("is a pure function of the seed, the feature and the ground", () => {
    expect(draw(LOBBY_SEEDS[3]!)).toEqual(draw(LOBBY_SEEDS[3]!));
  });

  it("lays its spine along the contour, its head uphill, its length 2w(L:W − 1) from the quantile draw", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 40)) {
      const shape = draw(seed);
      expect([shape.headX, shape.headZ]).toEqual([1, 0]);
      expect(Math.abs(shape.px[1]! - shape.px[0]!), `seed ${seed}`).toBeLessThan(1e-9);
      // The spec's quantile table and stadium formulas, on the draw's own hash.
      const u = hash3(1, 0, 0, seed ^ 0x1a4e);
      const lw = u < 0.5 ? 2.2 + (3.8 - 2.2) * 2 * u : 3.8 + (5.2 - 3.8) * (2 * u - 1);
      const R = featureDraw(seed, 1, 0, POND_RADIUS_MIN, POND_RADIUS_MAX);
      const w = R * Math.sqrt(Math.PI / (4 * (lw - 1) + Math.PI));
      let length = 0;
      for (let i = 0; i + 1 < shape.px.length; i++) length += Math.hypot(shape.px[i + 1]! - shape.px[i]!, shape.pz[i + 1]! - shape.pz[i]!);
      expect(length, `seed ${seed}`).toBeCloseTo(2 * w * (lw - 1), 9);
      expect([3, 4], `seed ${seed}`).toContain(shape.px.length);
      // The head end is the uphill end, the wider by (1 + τ) / (1 − τ).
      const last = shape.px.length - 1;
      const tau = 0.3 * hash3(1, 1, 0, seed ^ 0x1a4e);
      const [head, tail] = plane(shape.px[last]!) > plane(shape.px[0]!) ? [last, 0] : [0, last];
      expect(shape.width[head]! / shape.width[tail]!, `seed ${seed}`).toBeCloseTo((1 + tau) / (1 - tau), 9);
    }
  });

  it("holds water at its centre and drains downhill through its spout", () => {
    for (const seed of LOBBY_SEEDS) {
      const shape = draw(seed);
      expect(lakeShoreInto(newLakeShore(), shape, shape.cx, shape.cz).s, `seed ${seed}`).toBeGreaterThan(0);
      expect(shape.spout, `seed ${seed}`).not.toBeNull();
      expect(shape.spout!.bx, `seed ${seed}`).toBeLessThan(shape.spout!.ax);
      expect(shape.level).toBe(0);
      expect(shape.murk).toBe(0.5);
    }
  });

  it("fits the apron to the ground: 30 m all round on a 0.1 grade", () => {
    const shape = draw(LOBBY_SEEDS[0]!);
    expect(shape.apron[0]).toBeCloseTo(30, 9);
    for (let k = 1; k < 7; k++) expect(shape.apron[k]).toBeCloseTo(0, 9);
  });

  it("is bounded: at 720 directions a quarter metre inside its bound every point lies past its apron's end", () => {
    const r = newLakeShore();
    for (const seed of LOBBY_SEEDS.slice(0, 20)) {
      const shape = draw(seed);
      for (let k = 0; k < 720; k++) {
        const a = (k * Math.PI) / 360, d = shape.bound - 0.25;
        lakeShoreInto(r, shape, shape.cx + Math.cos(a) * d, shape.cz + Math.sin(a) * d);
        expect(-r.s, `seed ${seed} direction ${k}`).toBeGreaterThanOrEqual(lakeApronEnd(shape, r));
      }
    }
  });

  it("stretches its shore distance within 0.6 to 1.6 at nine points in ten wherever |s| ≤ 20 m, off the spine's ridge (spec §4.4, §13.2)", () => {
    // On the spine itself s has a ridge (the medial axis) where ∇s is not a
    // stretch of anything, so the band is read where s ≤ sMax / 2.
    let outside = 0, total = 0;
    const r = newLakeShore();
    for (const seed of LOBBY_SEEDS) {
      const shape = draw(seed);
      for (let z = shape.cz - shape.bound; z <= shape.cz + shape.bound; z += 2) {
        for (let x = shape.cx - shape.bound; x <= shape.cx + shape.bound; x += 2) {
          lakeShoreInto(r, shape, x, z);
          if (!(Math.abs(r.s) <= 20) || r.s > shape.sMax / 2) continue;
          total++;
          const g = Math.hypot(r.sx, r.sz);
          if (g < 0.6 || g > 1.6) outside++;
        }
      }
    }
    console.info(`[lakeValley] |∇s| outside 0.6–1.6: ${outside} of ${total}`);
    expect(outside / total).toBeLessThanOrEqual(0.1);
  });

  it("meets the valley family's shape targets over the 200 lobby seeds (spec §13.2), outlined at 1 m", () => {
    const sdi: number[] = [], convexity: number[] = [], lw: number[] = [];
    for (const seed of LOBBY_SEEDS) {
      const o = lakeOutline(draw(seed), 1);
      const m = outlineMetrics(o.xs, o.zs);
      sdi.push(m.sdi); convexity.push(m.convexity); lw.push(m.lw);
    }
    console.info(`[lakeValley] medians: SDI ${median(sdi).toFixed(3)}, convexity ${median(convexity).toFixed(3)}, L:W ${median(lw).toFixed(3)}`);
    expect(median(sdi)).toBeGreaterThanOrEqual(1.3);
    expect(median(sdi)).toBeLessThanOrEqual(1.7);
    expect(median(convexity)).toBeGreaterThanOrEqual(0.78);
    expect(median(convexity)).toBeLessThanOrEqual(0.88);
    expect(median(lw)).toBeGreaterThanOrEqual(1.9);
    expect(median(lw)).toBeLessThanOrEqual(2.5);
  });
});
