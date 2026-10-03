import { describe, it, expect } from "vitest";
import {
  WATER_ROWS, lakeWaterRow, lakeSkin, waterSkinOffset, CLEAR_LAKE_KD, WATER_F0, WATER_HORIZON, WATER_WIND_MAX, WATER_SKIN_DRIFT,
  fresnelSchlick, fresnelExact, transmission, meanKd, alphaFor,
  slopeVariance, roughnessFor, horizonSafeNormal,
  OCEAN_CAP_CYCLES, OCEAN_CAP_PERIOD, OCEAN_FOAM_FADE, OCEAN_INNER_COVER,
  capCycle, capCycleHash, capFires, foamCover, foamLookAge, foamShare, foamWhite, laceCover, laceLevel, oceanCapCells,
  oceanLace, waterSkinHash, waterSkinNoise,
} from "../../src/game/waterShading.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("Fresnel for water", () => {
  it("is F0 = 0.02 straight down and 1 at grazing", () => {
    expect(fresnelSchlick(1)).toBeCloseTo(WATER_F0, 6);
    expect(fresnelSchlick(0)).toBeCloseTo(1, 6);
  });
  it("stays within 6 % absolute of the exact unpolarised curve for n = 1.33 (the worst is 0.058 at 85°)", () => {
    for (const deg of [0, 45, 60, 70, 80, 85, 90]) {
      const c = Math.cos((deg * Math.PI) / 180);
      expect(Math.abs(fresnelSchlick(c) - fresnelExact(c))).toBeLessThan(0.06);
    }
  });
});

describe("transmission by depth", () => {
  it("gives the research doc's humic numbers at 0.3 m: half the red, two fifths of the green, an eighth of the blue", () => {
    const [r, g, b] = transmission(WATER_ROWS.lowlandLake.kd, 0.3);
    expect(r).toBeCloseTo(0.52, 1);
    expect(g).toBeCloseTo(0.41, 1);
    expect(b).toBeCloseTo(0.12, 1);
  });
  it("loses the bed by 10 m in every body", () => {
    for (const row of Object.values(WATER_ROWS)) {
      for (const t of transmission(row.kd, 10)) expect(t).toBeLessThan(0.1);
    }
  });
  it("is 1 at zero and negative depth", () => {
    expect(transmission(WATER_ROWS.sea.kd, 0)).toEqual([1, 1, 1]);
    expect(transmission(WATER_ROWS.sea.kd, -2)).toEqual([1, 1, 1]);
  });
  it("alpha is 1 - (1 - F) * T: the reflected share stays out of the transmission", () => {
    const kd = WATER_ROWS.sea.kd;
    expect(meanKd(kd)).toBeCloseTo((0.34 + 0.18 + 0.26) / 3, 6);
    expect(alphaFor(kd, 1)).toBeCloseTo(1 - (1 - WATER_F0) * Math.exp(-2 * meanKd(kd)), 6);
    expect(alphaFor(kd, 0)).toBeCloseTo(WATER_F0, 6);
    expect(alphaFor(kd, 100)).toBeCloseTo(1, 6);
    expect(alphaFor(kd, 0.5, 0)).toBeCloseTo(1, 6); // grazing
  });
});

describe("roughness from wind", () => {
  it("has Cox and Munk's floor in a dead calm on the open sea", () => {
    expect(slopeVariance(0, 1)).toBeCloseTo(0.003, 6);
    expect(roughnessFor(0, 1)).toBeGreaterThan(0.2);
  });
  it("shelter 0.1 in calm air is under 0.2; the sea in rain is at least 0.5", () => {
    expect(roughnessFor(0, 0.1)).toBeLessThan(0.2);
    expect(roughnessFor(1, 1)).toBeGreaterThanOrEqual(0.5);
  });
  it("is monotone in wind and maps 1 to 12 m/s", () => {
    let last = -1;
    for (let w = 0; w <= 1; w += 0.05) {
      const r = roughnessFor(w, 1);
      expect(r).toBeGreaterThan(last);
      last = r;
    }
    expect(WATER_WIND_MAX).toBe(12);
    expect(WATER_SKIN_DRIFT).toBe(0.04);
    expect(slopeVariance(1, 1)).toBeCloseTo(0.003 + 0.00512 * 12, 6);
  });
  it("clamps wind and shelter to [0, 1]", () => {
    expect(roughnessFor(3, 1)).toBeCloseTo(roughnessFor(1, 1), 6);
    expect(roughnessFor(-1, 1)).toBeCloseTo(roughnessFor(0, 1), 6);
    expect(roughnessFor(0.5, 7)).toBeCloseTo(roughnessFor(0.5, 1), 6);
  });
});

describe("horizon-safe normal", () => {
  const reflectY = (n: [number, number, number], v: [number, number, number]): number => {
    // reflect(-v, n).y with v the direction from the surface to the eye
    const d = -(v[0] * n[0] + v[1] * n[1] + v[2] * n[2]);
    return -v[1] - 2 * d * n[1];
  };
  it("leaves a normal alone when the reflection already clears the horizon", () => {
    const n: [number, number, number] = [0, 1, 0];
    const v: [number, number, number] = [0, 0.5, Math.sqrt(0.75)];
    expect(horizonSafeNormal(n, v)).toEqual(n);
  });
  it("tilts a ripple normal up until the reflection clears the horizon, for the eye above the water", () => {
    let fired = 0;
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      const tilt = 0.6;
      const n: [number, number, number] = [Math.sin(a) * tilt, 1, Math.cos(a) * tilt];
      const len = Math.hypot(...n);
      const nn: [number, number, number] = [n[0] / len, n[1] / len, n[2] / len];
      const v: [number, number, number] = [0, 0.05, Math.sqrt(1 - 0.0025)];
      const origReflectY = reflectY(nn, v);
      const safe = horizonSafeNormal(nn, v);
      expect(reflectY(safe, v)).toBeGreaterThanOrEqual(WATER_HORIZON - 1e-6);
      expect(Math.hypot(...safe)).toBeCloseTo(1, 6);
      if (origReflectY < WATER_HORIZON) {
        fired++;
        expect(reflectY(safe, v)).toBeCloseTo(WATER_HORIZON, 5);
      }
    }
    // the lift ran for at least one angle
    expect(fired).toBeGreaterThan(0);
  });
  it("lifts the reflected ray exactly to the horizon for ripple normals across all angles", () => {
    let fired = 0;
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      const tilt = 0.6;
      const n: [number, number, number] = [Math.sin(a) * tilt, 1, Math.cos(a) * tilt];
      const len = Math.hypot(...n);
      const nn: [number, number, number] = [n[0] / len, n[1] / len, n[2] / len];
      const v: [number, number, number] = [0, 0.05, Math.sqrt(1 - 0.0025)];
      const origReflectY = reflectY(nn, v);
      if (origReflectY < WATER_HORIZON) {
        fired++;
        const safe = horizonSafeNormal(nn, v);
        expect(reflectY(safe, v)).toBeCloseTo(WATER_HORIZON, 5);
      }
    }
    expect(fired).toBeGreaterThan(0);
  });
});

describe("lakeWaterRow", () => {
  it("is the very clear lake's row at murk 0 and the humic lake's at murk 1", () => {
    expect(lakeWaterRow(0)).toEqual(WATER_ROWS.highLake);
    expect(lakeWaterRow(1)).toEqual(WATER_ROWS.lowlandLake);
  });

  it("is the research's clear lake at murk 0.5", () => {
    const row = lakeWaterRow(0.5);
    expect(CLEAR_LAKE_KD).toEqual([0.75, 0.8, 1.6]);
    for (let c = 0; c < 3; c++) expect(row.kd[c]).toBeCloseTo(CLEAR_LAKE_KD[c]!, 12);
    expect(row.shelter).toBeCloseTo(0.2, 12);
    for (let c = 0; c < 3; c++) {
      expect(row.lInf[c]).toBeCloseTo((WATER_ROWS.highLake.lInf[c]! + WATER_ROWS.lowlandLake.lInf[c]!) / 2, 12);
    }
  });

  it("clamps murk outside [0, 1]", () => {
    expect(lakeWaterRow(-1)).toEqual(WATER_ROWS.highLake);
    expect(lakeWaterRow(2)).toEqual(WATER_ROWS.lowlandLake);
  });
});

describe("lakeSkin", () => {
  it("is off up to murk 0.5, full from 0.8", () => {
    expect(lakeSkin(0)).toBe(0);
    expect(lakeSkin(0.5)).toBe(0);
    expect(lakeSkin(0.8)).toBe(1);
    expect(lakeSkin(1)).toBe(1);
    expect(lakeSkin(0.65)).toBeCloseTo(0.5, 12);
  });
});

describe("waterSkinOffset", () => {
  it("is the same for a seed every time, and differs between seeds", () => {
    expect(waterSkinOffset(0x5eed)).toBe(waterSkinOffset(0x5eed));
    expect(waterSkinOffset(1)).not.toBe(waterSkinOffset(2));
    expect(waterSkinOffset(-1)).toBeGreaterThanOrEqual(0);
    expect(waterSkinOffset(-1)).toBeLessThan(4096);
  });
});

// The lace's distribution, measured the way the fit was: 2^20 points of a square kilometre at one time.
const LACE_POINTS = 1 << 20;
let laceSample: Float32Array | null = null;
function laceRidges(): Float32Array {
  if (laceSample !== null) return laceSample;
  const ridges = new Float32Array(LACE_POINTS);
  // A low-discrepancy sequence (the plastic number's), so the points tile the square evenly.
  for (let n = 0; n < LACE_POINTS; n++) {
    const x = 1000 * (0.5 + (n + 1) * 0.7548776662466927 - Math.floor(0.5 + (n + 1) * 0.7548776662466927));
    const z = 1000 * (0.5 + (n + 1) * 0.5698402909980532 - Math.floor(0.5 + (n + 1) * 0.5698402909980532));
    ridges[n] = oceanLace(x, z, 0.731, 0.8, 0.6, 123.4);
  }
  laceSample = ridges;
  return ridges;
}
function meanOver(ridges: Float32Array, f: (ridge: number) => number): number {
  let sum = 0;
  for (let i = 0; i < ridges.length; i++) sum += f(ridges[i] as number);
  return sum / ridges.length;
}

describe("the white water's hash and noise", () => {
  it("are the water's sine-free hash and value noise, in doubles", () => {
    expect(waterSkinHash(0, 0)).toBe(0);
    expect(waterSkinHash(1, 0)).toBeCloseTo(0.8985930026147315, 12);
    expect(waterSkinHash(3, 7)).toBeCloseTo(0.5719091971150192, 12);
    expect(waterSkinHash(101, 250)).toBeCloseTo(0.3412801855629368, 12);
    expect(waterSkinHash(511, 0)).toBeCloseTo(0.9256653240991, 12);
    expect(waterSkinHash(12.5, 3.25)).toBeCloseTo(0.17377900379210587, 12);
    expect(waterSkinNoise(0, 0)).toBe(0);
    expect(waterSkinNoise(2.5, 3.25)).toBeCloseTo(0.38941598411964407, 12);
    expect(waterSkinNoise(100.1, -37.9)).toBeCloseTo(0.330381180402622, 12);
  });
});

describe("the foam's lace", () => {
  it("is nothing without a share, and a sheet when the share is all", () => {
    for (const ridge of [0, 0.5, 0.9, 1]) expect(laceCover(ridge, 0)).toBe(0);
    expect(laceCover(0.3, 0.5)).toBe(0);
    expect(laceCover(0.95, 0.5)).toBe(1);
    expect(laceCover(0.2, 0.05)).toBe(0);
    expect(laceCover(1, 0.05)).toBe(1);
    // A full share lies below every ridge but the noise's very lowest.
    expect(laceCover(0.05, 1)).toBe(1);
    expect(laceCover(0.5, 1)).toBe(1);
  });

  it("whitens fresh foam to 0.4 and fades it to 0.1 at ten seconds, toward 0.06, by a factor e every 4.7 s", () => {
    expect(OCEAN_FOAM_FADE).toBe(4.7);
    expect(foamWhite(0)).toBeCloseTo(0.4, 12);
    expect(Math.abs(foamWhite(10) - 0.1)).toBeLessThan(0.005);
    expect(foamWhite(4.7)).toBeCloseTo(0.18507901, 7);
    expect(foamWhite(1000)).toBeCloseTo(0.06, 9);
  });

  it("covers the foam's amount of the surface, or the inner surf's 0.6 of it weighted by how broken the swell is, whichever is the more", () => {
    expect(OCEAN_INNER_COVER).toBe(0.6);
    // The roll is a sheet, and the trail thins with the foam's amount toward the floor.
    expect(foamShare(1, 1)).toBe(1);
    expect(foamShare(0.8, 0)).toBe(0.8);
    expect(foamShare(0.2, 0)).toBe(0.2);
    expect(foamShare(0, 0)).toBe(0);
    // The inner surf's floor does not thin: the foam's own floor, 0.5, is under it at full weight.
    expect(foamShare(0.5, 1)).toBeCloseTo(0.6, 12);
    expect(foamShare(0.2, 0.5)).toBeCloseTo(0.3, 12);
    // A lone bore's trailing foam ten seconds on: its amount 0.6065 stands over the floor, narrowly.
    expect(foamShare(0.6065306597126334, 1)).toBe(0.6065306597126334);
  });

  it("holds the quantile the shader fits to the lace's measured values, within 0.003 across the shares from none to all", () => {
    const sorted = Float32Array.from(laceRidges()).sort();
    for (const share of [0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99]) {
      const measured = sorted[Math.floor((1 - share) * sorted.length)] as number;
      expect(Math.abs(laceLevel(share) - measured), String(share)).toBeLessThan(0.003);
    }
    expect(laceLevel(0)).toBe(1);
    expect(laceLevel(1)).toBeCloseTo(-0.0007, 4);
  }, timeLimit(30_000));

  it("covers the share it is asked for, within 0.01 at 0.05, 0.1, 0.25, 0.5, 0.6, 0.8, 0.95 and 1", () => {
    const ridges = laceRidges();
    for (const share of [0.05, 0.1, 0.25, 0.5, 0.6, 0.8, 0.95, 1]) {
      expect(Math.abs(meanOver(ridges, (r) => laceCover(r, share)) - share), String(share)).toBeLessThan(0.01);
    }
  }, timeLimit(30_000));

  it("reflects 0.40 of the light, within 0.02, at the roll: fresh, full foam, its albedo times its mean cover", () => {
    // Foam 1 and breaking weight 1, a sheet: the albedo is the reflectance.
    const cover = meanOver(laceRidges(), (r) => foamCover(r, 1, 1, 0));
    expect(Math.abs(foamWhite(0) * cover - 0.4)).toBeLessThan(0.02);
  }, timeLimit(30_000));

  it("reflects 0.061, inside 0.03 to 0.10, ten seconds after a lone bore's crest, its amount over the floor", () => {
    // The trailing foam's amount there is exp(-10 / OCEAN_FOAM_LIFE), 0.6065306597126334, over the floor's 0.6: the
    // foam's amount stands. Its albedo is 0.1005 at 10 s, its cover 0.6065.
    const cover = meanOver(laceRidges(), (r) => foamCover(r, 0.6065306597126334, 1, 0));
    const reflectance = foamWhite(10) * cover;
    expect(Math.abs(reflectance - 0.061)).toBeLessThan(0.002);
    expect(reflectance).toBeGreaterThan(0.03);
    expect(reflectance).toBeLessThan(0.1);
  }, timeLimit(30_000));

  it("covers 0.60 of the inner surf, within 0.02, and reflects 0.03 to 0.10 of the light when its foam is old", () => {
    const ridges = laceRidges();
    // Full breaking weight, the foam's amount the inner surf's floor (0.5), ten seconds on.
    const near = meanOver(ridges, (r) => foamCover(r, 0.5, 1, 0));
    expect(Math.abs(near - 0.6)).toBeLessThan(0.02);
    const reflectance = foamWhite(10) * near;
    expect(reflectance).toBeGreaterThan(0.03);
    expect(reflectance).toBeLessThan(0.1);
    // Near and far agree: the far value is the same share.
    const far = meanOver(ridges, (r) => foamCover(r, 0.5, 1, 3));
    expect(Math.abs(near - far)).toBeLessThan(0.02);
    expect(far).toBeCloseTo(0.6, 9);
  }, timeLimit(30_000));

  it("keeps the surf's brightness across the level-of-detail band: the near mean and the far value within 0.02", () => {
    const ridges = laceRidges();
    for (const breaking of [0, 1]) {
      for (const foam of [0.5, 1]) {
        const share = foamShare(foam, breaking);
        // A pixel from nothing to the cell's tenth (the band's start, 0.3 m), through the band, to two fifths (1.2 m) and beyond.
        for (const pixel of [0, 0.3, 0.6, 0.9, 1.2, 3]) {
          const gap = Math.abs(meanOver(ridges, (r) => foamCover(r, foam, breaking, pixel)) - share);
          expect(gap, `weight ${breaking} foam ${foam} pixel ${pixel}`).toBeLessThan(0.02);
        }
        // Past the band the cover is the share itself.
        expect(foamCover(0.5, foam, breaking, 1.2)).toBeCloseTo(share, 12);
      }
    }
  }, timeLimit(60_000));

  it("takes the swell's age as the foam's, except on the roll at the crest's front, where it is fresh", () => {
    expect(foamLookAge(0, 12)).toBe(0);
    expect(foamLookAge(5, 12)).toBeCloseTo(5, 12);
    expect(foamLookAge(10.9, 12)).toBeCloseTo(10.848901995803457, 9);
    expect(foamLookAge(11.9, 12)).toBeCloseTo(0.25605423078037204, 9);
    expect(foamLookAge(12, 12)).toBeCloseTo(0, 12);
  });
});

describe("the whitecap cells", () => {
  it("fire only while their hash is under the chance, so none fires at a chance of none", () => {
    expect(capFires(0, 0)).toBe(0);
    expect(capFires(0.5, 0.5)).toBe(0);
    expect(capFires(0.49, 0.5)).toBe(1);
    expect(capFires(0, 1e-9)).toBe(1);
    // Nowhere, at no coverage, whatever the cell, the hour or the pixel.
    for (let i = 0; i < 2000; i++) {
      const x = i * 7.31;
      expect(oceanCapCells(x, -x * 0.37, i * 1.7, 3, 4, 0.731, () => 0, 0)).toBe(0);
    }
  });

  it("cover the coverage by construction, within 0.003 at 0.02, 0.05 and 0.1, and are the coverage itself past a few pixels", () => {
    for (const coverage of [0.02, 0.05, 0.1]) {
      let sum = 0;
      const n = 1 << 19;
      for (let i = 0; i < n; i++) {
        const x = 1000 * ((0.5 + (i + 1) * 0.7548776662466927) % 1);
        const z = 1000 * ((0.5 + (i + 1) * 0.5698402909980532) % 1);
        const t = 3000 * ((0.3 + i * 0.618033988749895) % 1);
        sum += oceanCapCells(x, z, t, 10, 5, 0.731, () => coverage, 0);
      }
      expect(Math.abs(sum / n - coverage), String(coverage)).toBeLessThan(0.003);
      expect(oceanCapCells(12.3, 45.6, 78.9, 10, 5, 0.731, () => coverage, 1.2)).toBe(coverage);
    }
  }, timeLimit(60_000));

  it("draw a hash fresh every cycle: a cap is not followed by one on the next cycle a cell away", () => {
    const chance = 0.3;
    let fired = 0;
    const joint = [0, 0, 0, 0];
    const offsets: [number, number][] = [[-3, 0], [3, 0], [0, -3], [1, 0]];
    let cells = 0;
    for (let hx = 8; hx < 136; hx++) {
      for (let hz = 8; hz < 136; hz++) {
        for (let n = 0; n < OCEAN_CAP_CYCLES - 1; n++) {
          const f = capFires(capCycleHash(hx, hz, n), chance);
          fired += f;
          cells++;
          offsets.forEach(([dx, dz], j) => {
            joint[j] = (joint[j] as number) + f * capFires(capCycleHash(hx + dx, hz + dz, n + 1), chance);
          });
        }
      }
    }
    expect(Math.abs(fired / cells - chance)).toBeLessThan(0.005);
    // Independent cycles would fire together a chance squared, 0.09, of the time. The cell-stepping hash did a whole chance.
    joint.forEach((j, i) => expect(Math.abs(j / cells - 0.09), `offset ${i}`).toBeLessThan(0.01));
  }, timeLimit(60_000));

  it("keep each cycle whole across the hour and every fold: the clock folds by the pattern's repeat", () => {
    expect(OCEAN_CAP_CYCLES * OCEAN_CAP_PERIOD).toBe(485);
    for (const phase of [0, 0.123, 0.5, 0.97]) {
      for (const time of [0.3, 484.9, 485.2, 3599.9, 3600.1, 7199.95, 7200.05, 100000.3]) {
        // The cycle with no fold at all: its index counted from the start, its place in it.
        const cycle = time / OCEAN_CAP_PERIOD + phase;
        const { n, frac } = capCycle(time, phase);
        expect(n, `${phase} at ${time}`).toBe(Math.floor(cycle) % OCEAN_CAP_CYCLES);
        expect(frac, `${phase} at ${time}`).toBeCloseTo(cycle - Math.floor(cycle), 6);
      }
    }
  });

  it("decide whether a cap fires by the coverage at its centre, so a lee's gradient never cuts it", () => {
    // Two points of one cell ask for the coverage first at the same place, the cap's centre, however they differ.
    const asked: [number, number][][] = [[], []];
    [[12.3, 45.6], [13.1, 47.9]].forEach(([x, z], i) => {
      oceanCapCells(x as number, z as number, 78.9, 0, 0, 0, (px, pz) => {
        (asked[i] as [number, number][]).push([px, pz]);
        return 0.05;
      }, 0);
    });
    expect((asked[0] as [number, number][])[0]).toEqual((asked[1] as [number, number][])[0]);
    const [cx, cz] = (asked[0] as [number, number][])[0] as [number, number];
    expect(Math.floor(cx / 5)).toBe(2);
    expect(Math.floor(cz / 5)).toBe(9);
  });
});
