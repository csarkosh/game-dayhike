import { describe, it, expect } from "vitest";
import "../../src/sim/olympic.js";
import { COVE_END_BLEND, coveFor, coveProfileD, shoreProfileD } from "../../src/sim/olympic.js";
import { activeTerrainVariant } from "../../src/sim/terrain.js";
import {
  OCEAN_ATLAS_ROWS, OCEAN_COAST_SAMPLES, OCEAN_COAST_STEP, OCEAN_D_MIN, OCEAN_D_STEP, OCEAN_DRY_DEPTH,
  OCEAN_ROW_BAY_FIRST, OCEAN_ROW_BAY_PROFILE, OCEAN_ROW_COAST, OCEAN_ROW_COMPONENTS, OCEAN_ROW_COVE_FIRST,
  OCEAN_ROW_COVE_PROFILE, OCEAN_TABLE_SAMPLES,
  buildOceanTables, coastProfilesFor, deepWeight, writeCoastRow, type CoastProfiles, type OceanTables,
} from "../../src/game/oceanTables.js";
import { refraction, shoalingFactor, waveNumber, weggelCoefficients, OCEAN_G } from "../../src/game/oceanPhysics.js";
import { swellComponents, swellStateFor, type SwellComponent } from "../../src/game/oceanSwell.js";
import { LOBBY_SEEDS } from "../sim/trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = LOBBY_SEEDS[0] as number;

/** Channel `ch` of texel `i` in `row`. */
function texel(t: OceanTables, row: number, i: number, ch: number): number {
  return t.data[(row * t.width + i) * 4 + ch] as number;
}

/** The world's own swell, its profiles and its tables about the cove. */
function world(seed: number): { profiles: CoastProfiles; components: SwellComponent[]; tables: OceanTables } {
  const state = swellStateFor(seed);
  const components = swellComponents(seed, state);
  const profiles = coastProfilesFor(seed);
  return { profiles, components, tables: buildOceanTables(profiles, components, 0) };
}

/** A component's onshore wavenumber at d, straight from the physics: the integrand of Ψ. */
function knAt(c: SwellComponent, depth: (d: number) => { depth: number }, shelfBreakD: number, d: number): number {
  const w = deepWeight(d, shelfBreakD);
  if (w === 1) return c.k0x;
  const k0 = Math.hypot(c.k0x, c.k0z);
  const h = Math.max(depth(d).depth, OCEAN_DRY_DEPTH);
  return refraction(k0, c.k0z, (1 - w) * waveNumber(c.omega, h) + w * k0).kn;
}

describe("coastProfilesFor", () => {
  const p = coastProfilesFor(SEED);

  it("reads the bays' and the cove's bed from the terrain's own profiles, depth positive at sea", () => {
    for (const d of [-900, -400, -100, -24, -3, 0, 12]) {
      expect(p.bayDepth(d).depth).toBe(-shoreProfileD(d).v);
      expect(p.bayDepth(d).slope).toBe(Math.abs(shoreProfileD(d).dd));
      expect(p.coveDepth(d).depth).toBe(-coveProfileD(d).v);
      expect(p.coveDepth(d).slope).toBe(Math.abs(coveProfileD(d).dd));
    }
    // The waterline at d = 0; the cove's toe 2 m down at 24 m out, on the 1:50 bed beyond it.
    expect(p.bayDepth(0).depth).toBeCloseTo(0, 12);
    expect(p.coveDepth(0).depth).toBeCloseTo(0, 12);
    expect(p.coveDepth(-100).depth).toBeCloseTo(3.52, 12);
    expect(p.coveDepth(-100).slope).toBeCloseTo(0.02, 12);
    expect(p.bayDepth(-100).slope).toBeCloseTo(0.015, 12);
  });

  it("finds each profile's shelf break, where it reaches 8 m", () => {
    expect(p.shelfBreakD.bay).toBeCloseTo(-532.5833333, 6);
    expect(p.shelfBreakD.cove).toBeCloseTo(-324, 6);
  });

  it("takes the coastline from the variant's coastDistance, the same for any x", () => {
    const coastDistance = activeTerrainVariant().coastDistance!;
    for (const z of [-2000, -135, 0, 77, 1500]) {
      expect(p.coastlineX(z)).toBeCloseTo(0 - coastDistance(SEED, 0, z), 9);
      expect(p.coastlineX(z)).toBeCloseTo(123 - coastDistance(SEED, 123, z), 9);
    }
  });

  it("windows the cove along the shore exactly as the sim does: 1 at its centre, 0 past its ends' blend", () => {
    const cove = coveFor(SEED);
    expect(p.coveWeight(cove.z0)).toBe(1);
    expect(p.coveWeight(cove.z0 + cove.halfWidth)).toBeCloseTo(0.5, 12);
    expect(p.coveWeight(cove.z0 - cove.halfWidth - COVE_END_BLEND)).toBe(0);
    expect(p.coveWeight(cove.z0 + cove.halfWidth + COVE_END_BLEND)).toBe(0);
    expect(p.coveWeight(cove.z0 + 2000)).toBe(0);
    // At sea, past the road's corridor, the sim's cove mask is this window alone.
    const coveMask = activeTerrainVariant().coveMask!;
    for (let z = cove.z0 - cove.halfWidth - 40; z <= cove.z0 + cove.halfWidth + 40; z += 7.3) {
      expect(p.coveWeight(z)).toBeCloseTo(coveMask(SEED, p.coastlineX(z) - 50, z), 12);
    }
  });

  it("puts each headland's tip its reach out from the coastline at its z", () => {
    const cove = coveFor(SEED);
    expect(p.headlandTips).toHaveLength(2);
    cove.heads.forEach((head, i) => {
      expect(p.headlandTips[i]).toEqual([p.coastlineX(head.z) - head.reach, head.z]);
    });
  });
});

describe("deepWeight", () => {
  it("is 0 at the shelf break and shoreward, 1 a shelf width seaward of it, smootherstep between", () => {
    expect(deepWeight(-324, -324)).toBe(0);
    expect(deepWeight(-100, -324)).toBe(0);
    expect(deepWeight(-724, -324)).toBe(1);
    expect(deepWeight(-1000, -324)).toBe(1);
    expect(deepWeight(-524, -324)).toBeCloseTo(0.5, 12);
    expect(deepWeight(-424, -324)).toBeCloseTo(0.103515625, 12);
  });
});

describe("buildOceanTables", () => {
  it("is OCEAN_ATLAS_ROWS rows of at most OCEAN_TABLE_SAMPLES RGBA texels", () => {
    const { tables } = world(SEED);
    expect([OCEAN_D_MIN, OCEAN_D_STEP, OCEAN_TABLE_SAMPLES, OCEAN_ATLAS_ROWS]).toEqual([-1000, 1, 1040, 28]);
    expect(tables.width).toBeLessThanOrEqual(OCEAN_TABLE_SAMPLES);
    expect(tables.rows).toBe(28);
    expect(tables.data.length).toBe(28 * tables.width * 4);
  });

  it("writes the profile rows: depth, Weggel's a and b for the local slope, the deep weight", () => {
    const { profiles, tables } = world(SEED);
    for (const i of [0, 300, 600, 900, 975, 1000, 1039]) {
      const d = OCEAN_D_MIN + i * OCEAN_D_STEP;
      for (const [row, depth, sb] of [
        [OCEAN_ROW_BAY_PROFILE, profiles.bayDepth, profiles.shelfBreakD.bay],
        [OCEAN_ROW_COVE_PROFILE, profiles.coveDepth, profiles.shelfBreakD.cove],
      ] as const) {
        const wg = weggelCoefficients(depth(d).slope);
        expect(texel(tables, row, i, 0)).toBe(Math.fround(depth(d).depth));
        expect(texel(tables, row, i, 1)).toBe(Math.fround(wg.a));
        expect(texel(tables, row, i, 2)).toBe(Math.fround(wg.b));
        expect(texel(tables, row, i, 3)).toBe(Math.fround(deepWeight(d, sb)));
      }
    }
  });

  it("writes the components row: (k0x, k0z, ω, a0) then (q0, 0, 0, 0), zeros past the last", () => {
    const { components, tables } = world(SEED);
    components.forEach((c, i) => {
      expect([0, 1, 2, 3].map((ch) => texel(tables, OCEAN_ROW_COMPONENTS, 2 * i, ch))).toEqual(
        [c.k0x, c.k0z, c.omega, c.a0].map(Math.fround),
      );
      expect([0, 1, 2, 3].map((ch) => texel(tables, OCEAN_ROW_COMPONENTS, 2 * i + 1, ch))).toEqual([Math.fround(c.q0), 0, 0, 0]);
    });
    for (let i = 24; i < tables.width; i++) expect(texel(tables, OCEAN_ROW_COMPONENTS, i, 0)).toBe(0);
  });

  it("holds Ψ to a fine integral of kn (Simpson at 0.05 m) within 0.01 rad over the whole table", () => {
    const { profiles, components, tables } = world(SEED);
    let worst = 0;
    for (const [first, depth, sb] of [
      [OCEAN_ROW_BAY_FIRST, profiles.bayDepth, profiles.shelfBreakD.bay],
      [OCEAN_ROW_COVE_FIRST, profiles.coveDepth, profiles.shelfBreakD.cove],
    ] as const) {
      components.forEach((c, row) => {
        let psi = c.k0x * OCEAN_D_MIN;
        for (let i = 1; i < tables.width; i++) {
          const d = OCEAN_D_MIN + i * OCEAN_D_STEP;
          if (depth(d).depth <= OCEAN_DRY_DEPTH) break;
          let sum = knAt(c, depth, sb, d - 1) + knAt(c, depth, sb, d);
          for (let j = 1; j < 20; j++) sum += (j % 2 === 1 ? 4 : 2) * knAt(c, depth, sb, d - 1 + j * 0.05);
          psi += (sum * 0.05) / 3;
          worst = Math.max(worst, Math.abs(texel(tables, first + row, i, 0) - psi));
        }
      });
    }
    expect(worst).toBeLessThan(0.01);
  }, timeLimit(60_000));

  it("is the plane wave far out: Ψ = k0x·d exactly and kn = k0x, K = 1 wherever the deep weight is 1", () => {
    const { profiles, components, tables } = world(SEED);
    for (const [first, sb] of [
      [OCEAN_ROW_BAY_FIRST, profiles.shelfBreakD.bay],
      [OCEAN_ROW_COVE_FIRST, profiles.shelfBreakD.cove],
    ] as const) {
      components.forEach((c, row) => {
        let checked = 0;
        for (let i = 0; i < tables.width; i++) {
          const d = OCEAN_D_MIN + i * OCEAN_D_STEP;
          if (deepWeight(d, sb) !== 1) break;
          expect(texel(tables, first + row, i, 0)).toBe(Math.fround(c.k0x * d));
          expect(texel(tables, first + row, i, 1)).toBe(Math.fround(c.k0x));
          expect(texel(tables, first + row, i, 2)).toBe(1);
          checked++;
        }
        expect(checked).toBeGreaterThan(60);
      });
    }
  });

  it("steps Ψ by no more than the row's largest kn a sample: no seam at the shelf blend, the waterline or d = OCEAN_D_MIN", () => {
    const { tables } = world(SEED);
    let worst = 0;
    for (let row = OCEAN_ROW_BAY_FIRST; row < OCEAN_ROW_COVE_FIRST + 12; row++) {
      let knMax = 0;
      for (let i = 0; i < tables.width; i++) knMax = Math.max(knMax, texel(tables, row, i, 1));
      for (let i = 1; i < tables.width; i++) {
        worst = Math.max(worst, Math.abs(texel(tables, row, i, 0) - texel(tables, row, i - 1, 0)) / (knMax * OCEAN_D_STEP));
      }
    }
    expect(worst).toBeLessThan(1.01);
  });

  it("grows an 11 s swell 30° off the shore's normal by K_s·K_r at the cove's 8, 5 and 2 m depths, within 0.03", () => {
    const profiles = coastProfilesFor(SEED);
    const omega = (2 * Math.PI) / 11;
    const k0 = (omega * omega) / OCEAN_G;
    const c: SwellComponent = {
      k0x: k0 * Math.cos(Math.PI / 6), k0z: k0 * Math.sin(Math.PI / 6), omega, a0: 1, phase0: 0, q0: 1,
    };
    const tables = buildOceanTables(profiles, [c], 0);
    const factors: number[] = [];
    for (const h of [8, 5, 2]) {
      // Where the cove's bed is h deep, and the table read there by hand.
      let lo = OCEAN_D_MIN;
      let hi = 0;
      for (let n = 0; n < 60; n++) {
        const mid = (lo + hi) / 2;
        if (profiles.coveDepth(mid).depth > h) lo = mid;
        else hi = mid;
      }
      const column = (lo - OCEAN_D_MIN) / OCEAN_D_STEP;
      const i = Math.floor(column);
      const f = column - i;
      const read = texel(tables, OCEAN_ROW_COVE_FIRST, i, 2) * (1 - f) + texel(tables, OCEAN_ROW_COVE_FIRST, i + 1, 2) * f;
      const direct = shoalingFactor(omega, h) * refraction(k0, c.k0z, waveNumber(omega, h)).kr;
      expect(Math.abs(read - direct)).toBeLessThan(0.03);
      factors.push(read);
    }
    // Shoaling, less the turn's spreading: about 1.05, 1.15 and 1.42 square on, a few percent less at 30°.
    expect(factors[0]).toBeGreaterThan(0.95);
    expect(factors[0]).toBeLessThan(1.1);
    expect(factors[2]).toBeGreaterThan(1.3);
    expect(factors[2]).toBeLessThan(1.45);
  });

  it("holds every value finite over 50 worlds, land included", () => {
    // About 40 ms a world: the coast's hooks read the coastline's warp and the
    // cove's hashes, and build no bowl.
    for (const seed of LOBBY_SEEDS.slice(0, 50)) {
      const { tables } = world(seed);
      let bad = 0;
      for (const v of tables.data) if (!Number.isFinite(v)) bad++;
      expect(bad).toBe(0);
    }
  }, timeLimit(120_000));
});

describe("the coastline row", () => {
  it("starts half a row behind the centre snapped to its step", () => {
    const { profiles, tables } = world(SEED);
    expect([OCEAN_COAST_STEP, OCEAN_COAST_SAMPLES]).toEqual([4, 1040]);
    expect(tables.coastOriginZ).toBe(-2080);
    writeCoastRow(tables, profiles, 1001);
    expect(tables.coastOriginZ).toBe(-1080);
    writeCoastRow(tables, profiles, -3);
    expect(tables.coastOriginZ).toBe(-2084);
    writeCoastRow(tables, profiles, 5123);
    expect(tables.coastOriginZ).toBe(3044);
  });

  it("holds the coastline, its slope by central difference and the cove's weight at each z", () => {
    const { profiles, tables } = world(SEED);
    for (const j of [0, 1, 400, 520, 521, 1039]) {
      const z = tables.coastOriginZ + j * OCEAN_COAST_STEP;
      expect(texel(tables, OCEAN_ROW_COAST, j, 0)).toBe(Math.fround(profiles.coastlineX(z)));
      expect(texel(tables, OCEAN_ROW_COAST, j, 1)).toBeCloseTo(
        (profiles.coastlineX(z + 4) - profiles.coastlineX(z - 4)) / 8, 6,
      );
      expect(texel(tables, OCEAN_ROW_COAST, j, 2)).toBe(Math.fround(profiles.coveWeight(z)));
      expect(texel(tables, OCEAN_ROW_COAST, j, 3)).toBe(0);
    }
    expect(texel(tables, OCEAN_ROW_COAST, 520, 2)).toBe(1);
  });

  it("refills that row alone on a recentre", () => {
    const { profiles, tables } = world(SEED);
    const before = tables.data.slice();
    writeCoastRow(tables, profiles, 2500);
    const rowStart = OCEAN_ROW_COAST * tables.width * 4;
    expect(tables.data.subarray(0, rowStart)).toEqual(before.subarray(0, rowStart));
    expect(tables.data.subarray(rowStart)).not.toEqual(before.subarray(rowStart));
  });
});
