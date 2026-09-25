import { describe, it, expect } from "vitest";
import type { Rgb } from "../../src/game/colour.js";
import {
  classifySurface,
  DUFF_FLOOR_MAX,
  GRASS_SLOPE,
  NEEDLE_BED,
  SCREE_SLOPE,
  SNOW_LINE,
  SNOW_LINE_VARIATION,
  snowLineAt,
  surfaceAlbedo,
  surfaceWeights,
} from "../../src/game/terrainSurface.js";
import { SLOPE_HI, SLOPE_LO } from "../../src/sim/vegetation.js";

const SEED = 0x7e44a1;

describe("snowLineAt", () => {
  it("stays within the declared variation of the nominal line", () => {
    for (let x = -2000; x < 2000; x += 37) {
      for (let z = -500; z < 500; z += 53) {
        const line = snowLineAt(SEED, x, z);
        expect(line).toBeGreaterThanOrEqual(SNOW_LINE - SNOW_LINE_VARIATION);
        expect(line).toBeLessThanOrEqual(SNOW_LINE + SNOW_LINE_VARIATION);
      }
    }
  });

  it("actually varies, rather than sitting at the nominal line", () => {
    const samples = [];
    for (let x = 0; x < 4000; x += 17) samples.push(snowLineAt(SEED, x, 0));
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(max - min).toBeGreaterThan(SNOW_LINE_VARIATION);
  });

  it("is deterministic", () => {
    expect(snowLineAt(SEED, 123.5, -77.25)).toBe(snowLineAt(SEED, 123.5, -77.25));
  });

  it("differs between seeds", () => {
    expect(snowLineAt(SEED, 100, 100)).not.toBe(snowLineAt(SEED + 1, 100, 100));
  });
});

describe("surfaceAlbedo", () => {
  it("keeps every channel in [0, 1] across the whole domain", () => {
    for (let x = -600; x < 600; x += 61) {
      for (const altitude of [-20, 0, 60, 200, 220, 400, 2000]) {
        for (const slope of [0, 0.1, 0.3, 0.6, 1, 2, 8]) {
          const c = surfaceAlbedo(SEED, x, x * 0.7, altitude, slope);
          for (const v of [c.r, c.g, c.b]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("puts vegetation on gentle low ground", () => {
    // Vegetation is the one part of the palette where green leads. Asserting the
    // relationship rather than a literal colour keeps the palette tunable.
    // Sampled at 20 m: below the coastal fade end (9 m) sand bands own the
    // ground, and in the montane palette altitude only ever
    // affected snow, so 20 m asserts exactly what 5 m used to.
    let greenest = -Infinity;
    for (let x = 0; x < 400; x += 7) {
      const c = surfaceAlbedo(SEED, x, 0, 20, 0);
      greenest = Math.max(greenest, c.g - c.r);
    }
    expect(greenest).toBeGreaterThan(0.02);
  });

  it("selects rock over vegetation on steep faces", () => {
    // Rock is achromatic: red and green converge. On grass they do not.
    for (let x = 0; x < 400; x += 7) {
      const steep = surfaceAlbedo(SEED, x, 0, 5, SCREE_SLOPE);
      expect(Math.abs(steep.g - steep.r)).toBeLessThan(0.02);
      expect(steep.r).toBeGreaterThan(0.12);
    }
  });

  it("moves continuously from vegetation to rock as slope rises", () => {
    // A hard threshold reads as a painted line across the hillside. Sampled at
    // 20 m for the same reason as above: below 9 m the coastal sand bands
    // apply, and the brighter sand-to-rock span widens the per-step jumps.
    let previous = surfaceAlbedo(SEED, 40, 40, 20, 0);
    for (let slope = 0.02; slope <= 1.2; slope += 0.02) {
      const c = surfaceAlbedo(SEED, 40, 40, 20, slope);
      const jump = Math.max(
        Math.abs(c.r - previous.r),
        Math.abs(c.g - previous.g),
        Math.abs(c.b - previous.b),
      );
      expect(jump).toBeLessThan(0.02);
      previous = c;
    }
  });

  it("selects snow well above the snow line on gentle ground", () => {
    const c = surfaceAlbedo(SEED, 250, -130, SNOW_LINE + SNOW_LINE_VARIATION + 200, 0.05);
    expect(c.r).toBeGreaterThan(0.5);
    expect(c.g).toBeGreaterThan(0.5);
    expect(c.b).toBeGreaterThan(0.5);
  });

  it("keeps snow off cliffs at the same altitude", () => {
    const high = SNOW_LINE + SNOW_LINE_VARIATION + 200;
    const flat = surfaceAlbedo(SEED, 250, -130, high, 0.05);
    const cliff = surfaceAlbedo(SEED, 250, -130, high, 4);
    expect(cliff.r).toBeLessThan(flat.r - 0.2);
  });

  it("crosses the snow line more than once along a level traverse", () => {
    // The property that stops the snow line reading as a contour drawn across
    // the mountain: at one fixed altitude, walking horizontally must enter and
    // leave the snow repeatedly, not switch exactly once.
    const altitude = SNOW_LINE;
    let crossings = 0;
    let previous = altitude > snowLineAt(SEED, 0, 0);
    for (let x = 8; x < 6000; x += 8) {
      const snowy = altitude > snowLineAt(SEED, x, 0);
      if (snowy !== previous) crossings++;
      previous = snowy;
    }
    expect(crossings).toBeGreaterThan(1);
  });

  it("crosses the snow line more than once through surfaceAlbedo itself", () => {
    // The test above proves snowLineAt is perturbed, but it never calls
    // surfaceAlbedo, so it cannot tell whether surfaceAlbedo's own
    // `altitude - snowLineAt(seed, x, z)` calculation actually uses the
    // perturbed line rather than, say, the bare SNOW_LINE constant. Walk the
    // same fixed-altitude traverse, this time reading the returned colour and
    // classifying it as snowy from brightness. 0.5 is picked from the palette,
    // not measured: SNOW's channels sit around 0.78-0.84, while every other
    // palette entry (scree, the brightest of the rest) tops out near 0.24, so
    // 0.5 falls cleanly between them regardless of the noise mottling.
    const altitude = SNOW_LINE;
    const lowSlope = GRASS_SLOPE * 0.5; // Gentle ground, no rock/scree confound.
    let crossings = 0;
    let previous = surfaceAlbedo(SEED, 0, 0, altitude, lowSlope).r > 0.5;
    for (let x = 8; x < 6000; x += 8) {
      const snowy = surfaceAlbedo(SEED, x, 0, altitude, lowSlope).r > 0.5;
      if (snowy !== previous) crossings++;
      previous = snowy;
    }
    expect(crossings).toBeGreaterThan(1);
  });

  it("is deterministic", () => {
    const a = surfaceAlbedo(SEED, 11.5, -3.25, 42, 0.3);
    const b = surfaceAlbedo(SEED, 11.5, -3.25, 42, 0.3);
    expect(a).toEqual(b);
  });

  it("varies across a traverse rather than returning one flat colour", () => {
    // Guards the wiring: a palette that ignores its inputs would satisfy the
    // range checks above without ever producing two different colours.
    const seen = new Set<string>();
    for (let x = 0; x < 300; x += 3) {
      const c = surfaceAlbedo(SEED, x, 0, 5, GRASS_SLOPE * 0.5);
      seen.add(`${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)}`);
    }
    expect(seen.size).toBeGreaterThan(50);
  });
});

describe("coastal albedo bands", () => {
  const at = (altitude: number) => surfaceAlbedo(0x5eed, 10, 10, altitude, 0.05);

  // Captured from the pre-change implementation at surfaceAlbedo(0x5eed, 10, 10, 20, 0.05).
  const surfaceAlbedoReference20 = { r: 0.10740020273260542, g: 0.09779939180218372, b: 0.06 };

  it("is dark sediment under water", () => {
    const c = at(-6);
    expect(c.r).toBeLessThan(0.2);
    expect(c.g).toBeLessThan(0.2);
  });
  it("is wet sand just above the waterline", () => {
    const c = at(0.3);
    expect(c.r).toBeGreaterThan(c.b); // tan, not green
    expect(c.r).toBeLessThan(0.45); // wet = dark
  });
  it("is pale dry sand at berm height", () => {
    expect(at(2.5).r).toBeGreaterThan(0.4);
  });
  it("leaves everything from 9 m up exactly as before", () => {
    // Captured from the pre-change implementation at these inputs; the coastal
    // blend weight must be exactly 1 there, so equality is bitwise.
    const c = at(20);
    expect(c).toEqual(surfaceAlbedoReference20);
  });
});

describe("canopy tint", () => {
  // Captured from the pre-canopy implementation at three inputs
  // spanning the palette — gentle low ground, saturated scree, and snow.
  // `canopy = 0` (default or explicit) must reproduce these bitwise: mixRgb
  // returns the untouched endpoint at t = 0, so no float drift is tolerable.
  const references: Array<[[number, number, number, number], Rgb]> = [
    [[32, -18, 20, 0.05], { r: 0.09321664097284825, g: 0.14035007708145525, b: 0.06 }],
    [[250, -130, 120, 1.1], { r: 0.24, g: 0.23, b: 0.21 }],
    [[40, 40, 460, 0.05], { r: 0.78, g: 0.8, b: 0.84 }],
  ];

  it("changes nothing at canopy 0, default or explicit — bitwise", () => {
    for (const [[x, z, altitude, slope], reference] of references) {
      expect(surfaceAlbedo(SEED, x, z, altitude, slope)).toEqual(reference);
      expect(surfaceAlbedo(SEED, x, z, altitude, slope, 0)).toEqual(reference);
    }
  });

  it("darkens and greens gentle low ground at full canopy", () => {
    // Under a closed canopy the ground reads as the trees' crowns from the
    // fog's point of view: dark, green-led, but never pure CANOPY — the 0.85
    // weight keeps a floor-litter remnant.
    const luminance = (c: Rgb) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    for (let x = 0; x < 400; x += 7) {
      const open = surfaceAlbedo(SEED, x, 0, 20, 0.05);
      const closed = surfaceAlbedo(SEED, x, 0, 20, 0.05, 1);
      expect(closed.g).toBeGreaterThan(closed.r); // green leads
      expect(closed.g).toBeGreaterThan(closed.b);
      expect(luminance(closed)).toBeLessThan(0.1); // dark
      expect(luminance(closed)).toBeLessThan(luminance(open)); // darker than bare
    }
  });

  it("still turns to rock on steep ground at full canopy", () => {
    // The tint lands BEFORE the slope overlays, so a cliff through a forest
    // stays a cliff. At SCREE_SLOPE both overlay smoothsteps saturate to 1 and
    // mixRgb returns the endpoint exactly, so equality is bitwise.
    for (let x = 0; x < 400; x += 7) {
      const bare = surfaceAlbedo(SEED, x, 0, 20, SCREE_SLOPE);
      const forested = surfaceAlbedo(SEED, x, 0, 20, SCREE_SLOPE, 1);
      expect(forested).toEqual(bare);
      expect(Math.abs(forested.g - forested.r)).toBeLessThan(0.02); // achromatic rock
    }
  });
});

describe("duff", () => {
  it("pulls the floor weight and colour toward leaf litter with duff, and leaves duff = 0 bitwise identical", () => {
    const [x, z, altitude, slope, canopy] = [35, 21335, 40, 0.1, 0.7];
    const base = classifySurface(SEED, x, z, altitude, slope, canopy);
    const same = classifySurface(SEED, x, z, altitude, slope, canopy, 0);
    expect(same).toEqual(base);
    let prev = base.weights.forestFloor;
    for (let d = 0.1; d <= 1; d += 0.1) {
      const cur = classifySurface(SEED, x, z, altitude, slope, canopy, d);
      expect(cur.weights.forestFloor).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(cur.weights.forestFloor).toBeLessThanOrEqual(1);
      prev = cur.weights.forestFloor;
    }
    const full = classifySurface(SEED, x, z, altitude, slope, canopy, 1);
    expect(full.weights.forestFloor).toBeGreaterThan(base.weights.forestFloor);
    expect(full.weights.forestFloor - base.weights.forestFloor).toBeLessThanOrEqual(DUFF_FLOOR_MAX + 1e-12);
    // Under canopy the duff colour leans toward the needle bed: darker and browner than the base.
    expect(full.albedo.g).toBeLessThan(base.albedo.g);
  });

  it("paints the canopy litter as a mid-brown floor, not a black one", () => {
    // The reference floor is a tan/brown carpet at linear ≈ (0.15, 0.10,
    // 0.06); the previous NEEDLE_BED (0.10, 0.07, 0.04) was 1.5× darker
    // and read as black under the canopy. Same hue, 1.5× the luminance.
    expect(NEEDLE_BED).toEqual({ r: 0.15, g: 0.105, b: 0.06 });
    const lum = (c: Rgb) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    // Under full canopy at full duff the litter paint carries the bed, but a
    // quarter of the colour is still the pre-litter (canopy-tinted) ground, so
    // this measures a hair under the pure bed's own 1.5× (measured 0.1036):
    // luminance in [0.10, 0.13], well above the previous bed's 0.0742.
    const full = classifySurface(SEED, 35, 21335, 40, 0.1, 1, 1);
    expect(lum(full.albedo)).toBeGreaterThanOrEqual(0.10);
    expect(lum(full.albedo)).toBeLessThanOrEqual(0.13);
  });
});

describe("surfaceWeights", () => {
  const SEED = 0x5eed;

  it("returns non-negative material weights summing to 1 across a broad sweep", () => {
    for (let i = 0; i < 400; i++) {
      const x = i * 173.3 - 8000;
      const z = i * 311.9 - 12000;
      const altitude = -8 + (i % 60) * 5;
      const slope = (i % 13) * 0.09;
      const w = surfaceWeights(SEED, x, z, altitude, slope, (i % 7) / 6);
      for (const [k, v] of Object.entries(w)) {
        expect(v, `${k} at i=${i}`).toBeGreaterThanOrEqual(0);
        expect(v, `${k} at i=${i}`).toBeLessThanOrEqual(1);
      }
      const sum = w.grass + w.forestFloor + w.rock + w.sand + w.pebble;
      expect(sum, `sum at i=${i}`).toBeCloseTo(1, 4);
    }
  });

  it("hands steep ground to rock and gentle low ground to grass or forest floor", () => {
    const steep = surfaceWeights(SEED, 1200.5, -800.5, 90, SCREE_SLOPE, 0);
    expect(steep.rock).toBeGreaterThan(0.9);
    const gentle = surfaceWeights(SEED, 1200.5, -800.5, 90, 0.02, 0);
    expect(gentle.grass + gentle.forestFloor).toBeGreaterThan(0.9);
    expect(gentle.rock).toBeLessThan(0.05);
  });

  it("grows the rock weight with slope through the rock band alone, not just at SCREE_SLOPE", () => {
    // At SCREE_SLOPE the scree overlay's own smoothstep saturates to 1 and
    // fully replaces the weight vector (mixW(w, W_ROCK, 1) === W_ROCK
    // regardless of w), which would mask a broken GRASS_SLOPE->ROCK_SLOPE
    // step in the "steep ground" assertion above. The band is the forest's
    // own gate (SLOPE_LO..SLOPE_HI, 0.55..0.75 today); its midpoint is where
    // the scree overlay has not engaged yet (its own smoothstep is exactly 0
    // there) and the rock step is exactly half, so this isolates the
    // rock-vs-slope step on its own whatever the gate's values.
    const midSlope = surfaceWeights(SEED, 300.5, -50.5, 90, (SLOPE_LO + SLOPE_HI) / 2, 0);
    expect(midSlope.rock).toBeGreaterThan(0.45);
    expect(midSlope.rock).toBeLessThan(0.55);
  });

  it("hands the beach to sand and pebble, not to grass", () => {
    // Altitude 0.4 m is inside the coastal band (below SAND_TOP), gentle ground.
    const beach = surfaceWeights(SEED, 400.5, 120.5, 0.4, 0.03, 0);
    expect(beach.sand + beach.pebble).toBeGreaterThan(0.85);
    expect(beach.grass).toBeLessThan(0.1);
  });

  it("hands submerged ground to pebble over sand", () => {
    // Altitude -6 m is well below the -0.4 m submerged/sand crossover, so the
    // coastal blend picks the submerged branch (wSub) outright. Both seabed
    // colours (SEABED, SEABED_ROCK) are the pebble layer, so pebble must lead
    // sand here — this is the one point in the sweep where a wSub mistake
    // (e.g. handing the submerged branch to sand instead of pebble) would not
    // otherwise be caught: the "beach" test above samples altitude 0.4, which
    // the -0.4..0.1 m smoothstep already resolves to the sand branch (t = 1),
    // never touching wSub at all.
    const submerged = surfaceWeights(SEED, 50.5, -20.5, -6, 0.03, 0);
    expect(submerged.pebble).toBeGreaterThan(submerged.sand);
  });

  it("suppresses detail under settled snow", () => {
    // High and flat is snow-covered: detail off. SNOW_LINE is 220, +45 variation.
    expect(surfaceWeights(SEED, 900.5, -300.5, 400, 0.05, 0).detail).toBeLessThan(0.05);
  });

  it("agrees with surfaceAlbedo: classifySurface returns the same colour", () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 97.7 - 5000, z = i * 141.3 - 7000;
      const altitude = -5 + (i % 50) * 6, slope = (i % 11) * 0.1;
      const canopy = (i % 5) / 4;
      const both = classifySurface(SEED, x, z, altitude, slope, canopy);
      const alone = surfaceAlbedo(SEED, x, z, altitude, slope, canopy);
      expect(both.albedo.r).toBe(alone.r);
      expect(both.albedo.g).toBe(alone.g);
      expect(both.albedo.b).toBe(alone.b);
    }
  });
});

describe("the ground agrees with the forest about where soil ends", () => {
  // Trees stand at full density until SLOPE_LO and are gone by SLOPE_HI
  // (sim/vegetation.ts). Ground that a forest can hold is soil, so the rock
  // class must not take over before the trees give up: a slope the tree gate
  // still calls open is majority grass/floor, and the rock class is complete
  // only where the forest has closed. Before 2026-09-10 rock began at 0.25 and
  // was complete at 0.6, so 17% of the trees on a seed stood on cobbles.
  it("keeps majority soil under any slope a tree can stand on", () => {
    for (const x of [0, 137, 301, 555]) {
      const w = surfaceWeights(SEED, x, 0, 60, SLOPE_LO);
      expect(w.rock, `slope ${SLOPE_LO} at x=${x}`).toBeLessThan(0.5);
      expect(w.grass + w.forestFloor, `soil at x=${x}`).toBeGreaterThan(0.5);
    }
  });
  it("is fully rock exactly where the tree gate has closed", () => {
    const w = surfaceWeights(SEED, 42, 0, 60, SLOPE_HI);
    expect(w.rock).toBeCloseTo(1, 6);
  });
});

