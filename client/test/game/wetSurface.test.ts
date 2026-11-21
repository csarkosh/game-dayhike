import { afterEach, describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import {
  WET_BAND, WET_COVE_END, WET_DRY_S, WET_LINE_ABOVE, WET_NO_COVE, WET_RADIUS_MAX, WET_SPECKLE, WET_SPECKLE_S, WET_SWASH_VECS,
  emptyWetUniforms, setWetCove, setWetSwash, setWetWeather, wetBelowLine, wetBodyIsSea, wetLineFor, wetLookAt, wetUniforms,
  type WetBody, type WetLook, type WetSurface,
} from "@csarkosh/engine/game/wetSurface";
import { SWASH_COLUMNS, SWASH_STRIDE } from "@csarkosh/engine/game/swashTable";

/** A surface under no body, as a material starts: the terrain's, whose cap is 0. */
const NO_BODY: WetSurface = { line: -1e6, level: -1e6, centre: [0, 0], radius: 0, kd: [0, 0, 0], attenuate: true, cap: 0 };

/** The sea at level 0, as the renderer lists it: the body with no bound. */
const SEA = { level: 0, kd: [0.2, 0.1, 0.05], x: 0, z: 0, radius: Number.POSITIVE_INFINITY, bound: Number.POSITIVE_INFINITY } as WetBody;
/** A lake 80 m up and far inland, its z inside the cove's span of z. */
const LAKE = { level: 80, kd: [0.3, 0.1, 0.05], x: 250, z: 70, radius: 60, bound: 115 } as WetBody;
/** A surface under the wet line the two bodies give at (x, z). */
const under = (x: number, z: number): WetSurface => ({ ...wetLineFor([SEA, LAKE], x, z), attenuate: true, cap: 0 });
/** A cove 360 m wide about z = 0, its face at 1:12. */
const COVE = [0, 180, -24, 1 / 12] as const;

/** The swash's table with every column at one reach and age, as `SwashTable.data` holds them. */
function tableOf(reach: number, age: number): Float32Array {
  const data = new Float32Array(SWASH_COLUMNS * SWASH_STRIDE);
  for (let c = 0; c < SWASH_COLUMNS; c++) {
    data[c * SWASH_STRIDE + 2] = reach;
    data[c * SWASH_STRIDE + 3] = age;
  }
  return data;
}

// The wetness, the cove and the table are the page's: put them back as they start.
afterEach(() => {
  setWetWeather(0);
  setWetCove(Number.NaN, 0, 0, 0);
  setWetSwash(tableOf(0, WET_DRY_S));
});

describe("the wet look's uniforms", () => {
  it("are, with no body, no cove and dry weather, a line far below everything and a table long dry", () => {
    const u = wetUniforms(NO_BODY);
    expect({ ...u, wetSwash: null }).toEqual({
      wetLine: [-1e6], wetLevel: [-1e6], wetCentre: [0, 0], wetRadius: [0], wetKd: [0, 0, 0],
      wetAttenuate: [1], wetWeather: [0], wetCap: [0], wetCove: [0, WET_NO_COVE, 0, 0], wetSwash: null,
    });
    expect(Object.keys(u)).toEqual([
      "wetLine", "wetLevel", "wetCentre", "wetRadius", "wetKd", "wetAttenuate", "wetWeather", "wetCap", "wetCove", "wetSwash",
    ]);
    expect(u.wetSwash).toHaveLength(WET_SWASH_VECS * 4);
    // (reach, age) a column: no reach, the age the ground is dry by.
    expect(Array.from(u.wetSwash.subarray(0, 4))).toEqual([0, WET_DRY_S, 0, WET_DRY_S]);
  });

  it("carry the wet line of the nearest body, as wetLineFor finds it, and the surface's own cap", () => {
    const lake: WetBody = { level: 40, kd: [0.3, 0.1, 0.05], x: 100, z: -50, radius: 30, bound: 35 } as WetBody;
    const line = wetLineFor([lake], 110, -40);
    const u = wetUniforms({ ...line, attenuate: false, cap: 0.5 });
    expect(u.wetLine).toEqual([40 + WET_LINE_ABOVE]);
    expect(u.wetLevel).toEqual([40]);
    expect(u.wetCentre).toEqual([100, -50]);
    expect(u.wetRadius).toEqual([30]);
    expect(u.wetKd).toEqual([0.3, 0.1, 0.05]);
    expect(u.wetAttenuate).toEqual([0]);
    expect(u.wetCap).toEqual([0.5]);
  });

  it("hold the sea's radius to one whose rim the fragment stage can still blend over", () => {
    expect(wetUniforms({ ...NO_BODY, radius: Number.POSITIVE_INFINITY }).wetRadius).toEqual([WET_RADIUS_MAX]);
  });

  it("carry the page's wetness, held to [0, 1]", () => {
    setWetWeather(0.75);
    expect(wetUniforms(NO_BODY).wetWeather).toEqual([0.75]);
    setWetWeather(3);
    expect(wetUniforms(NO_BODY).wetWeather).toEqual([1]);
    setWetWeather(-2);
    expect(wetUniforms(NO_BODY).wetWeather).toEqual([0]);
  });

  it("carry, under the sea's wet line, the page's cove, and its swash table, the one array, refilled in place", () => {
    const before = wetUniforms(NO_BODY).wetSwash;
    setWetCove(37.25, 155, -24, 0.25);
    setWetSwash(tableOf(6, 5));
    const u = wetUniforms(under(-380, 0));
    expect(u.wetRadius).toEqual([WET_RADIUS_MAX]);
    expect(u.wetCove).toEqual([37.25, 155, -24, 0.25]);
    expect(u.wetSwash).toBe(before);
    expect(Array.from(u.wetSwash.subarray(0, 4))).toEqual([6, 5, 6, 5]);
    // No cove when any of its numbers is not finite.
    setWetCove(37.25, Number.NaN, -24, 0.25);
    expect(wetUniforms(under(-380, 0)).wetCove).toEqual([0, WET_NO_COVE, 0, 0]);
  });

  it("carry no cove under a lake's wet line, nor under no body: the cove is the sea's", () => {
    setWetCove(...COVE);
    setWetSwash(tableOf(12, 0));
    // The sea is the body with no bound; a lake's radius is its farthest shore point.
    expect([Number.POSITIVE_INFINITY, WET_RADIUS_MAX, LAKE.radius, 0].map(wetBodyIsSea)).toEqual([true, true, false, false]);
    // On the lake, on its bank, and as far past its bound as its wet line reaches, the line is the lake's: no cove.
    for (const [x, z] of [[250, 70], [250 + 115, 70], [250 + 115 + 39, 70], [250, 70 - 115 - 39]] as const) {
      const u = wetUniforms(under(x, z));
      expect(u.wetLevel, `${x} ${z}`).toEqual([80]);
      expect(u.wetCove, `${x} ${z}`).toEqual([0, WET_NO_COVE, 0, 0]);
    }
    // Past that the line is the sea's again, and the cove with it.
    expect(wetUniforms(under(250 + 115 + 41, 70)).wetLevel).toEqual([0]);
    expect(wetUniforms(under(250 + 115 + 41, 70)).wetCove).toEqual([...COVE]);
    expect(wetUniforms(NO_BODY).wetCove).toEqual([0, WET_NO_COVE, 0, 0]);
    // The table is the page's one array whichever the body: the cove alone tells a lake's surface from the sea's.
    expect(wetUniforms(under(250, 70)).wetSwash).toBe(wetUniforms(under(-380, 0)).wetSwash);
  });

  it("fill the record handed in", () => {
    const out = emptyWetUniforms();
    const centre = out.wetCentre;
    expect(wetUniforms({ ...NO_BODY, centre: [3, 4], cap: 1 }, out)).toBe(out);
    expect(out.wetCentre).toBe(centre);
    expect([out.wetCentre, out.wetCap]).toEqual([[3, 4], [1]]);
    wetUniforms(NO_BODY, out);
    expect({ ...out, wetSwash: null }).toEqual({ ...wetUniforms(NO_BODY), wetSwash: null });
  });
});

describe("the swash's band on the wet ground", () => {
  /** The look at height y and world z of a surface, from the surface's uniforms as the fragment stage reads them. */
  const lookOn = (surface: WetSurface, y: number, z: number): WetLook => {
    const u = wetUniforms(surface);
    return wetLookAt(y, z, u.wetLine[0], u.wetLevel[0], 1, u.wetCove, u.wetSwash, { wet: 0, damp: 0, speckle: 0 });
  };

  it("soaks, dampens and speckles the cove's face under the sea's wet line", () => {
    setWetCove(...COVE);
    // A sheet at its farthest reach this instant, 12 m of face: the ground is soaked up to a metre above the level.
    setWetSwash(tableOf(12, 0));
    expect(lookOn(under(-380, 0), 0.6, 0)).toEqual({ wet: 1, damp: 0, speckle: WET_SPECKLE });
    expect(lookOn(under(-380, 0), 1 + WET_BAND, 0)).toEqual({ wet: 0, damp: 0, speckle: 0 });
    // Twenty seconds on, the same ground is damp; within the speckle's life it is speckled.
    setWetSwash(tableOf(12, 20));
    expect(lookOn(under(-380, 0), 0.6, 0)).toEqual({ wet: 0, damp: 1, speckle: 0 });
    setWetSwash(tableOf(12, WET_SPECKLE_S / 2));
    expect(lookOn(under(-380, 0), 0.6, 0).speckle).toBeCloseTo(WET_SPECKLE / 2, 12);
    // Past the cove's end and its blend there is none of it.
    setWetSwash(tableOf(12, 0));
    expect(lookOn(under(-380, 180 + WET_COVE_END), 0.6, 180 + WET_COVE_END)).toEqual({ wet: 0, damp: 0, speckle: 0 });
  });

  it("is never on a lake's bank: under a lake's wet line the look is the still line's alone, whatever the table holds", () => {
    setWetCove(...COVE);
    const bank = under(LAKE.x + 50, LAKE.z);
    // Every state a column takes: a sheet at its reach, speckled ground, damp ground, ground just dry and long dry.
    for (const age of [0, WET_SPECKLE_S / 2, 20, WET_DRY_S, 600]) {
      setWetSwash(tableOf(12, age));
      // The bank from under the lake's level to above the highest the band could lie on it, at z across the cove's span.
      for (let z = -220; z <= 220; z += 10) {
        for (let k = -10; k <= 30; k++) {
          const y = LAKE.level + k * 0.05;
          const look = lookOn(bank, y, z);
          expect(look.wet, `age ${age} z ${z} y ${y}`).toBe(wetBelowLine(y, LAKE.level + WET_LINE_ABOVE));
          expect([look.damp, look.speckle], `age ${age} z ${z} y ${y}`).toEqual([0, 0]);
        }
      }
    }
    // The table was not empty: a metre above the SEA's level, under the sea's line, the same table soaks the face.
    setWetSwash(tableOf(12, 0));
    expect(lookOn(under(-380, 0), 0.6, 70).wet).toBe(1);
  });

  it("has a share of exactly nothing with no cove, in the fragment stage's 32-bit floats", () => {
    // `wetCoveShare`: 1 - smoothstep(half - end, half + end, |z - z0|), with no cove's half-width and centre.
    const e0 = Math.fround(WET_NO_COVE - WET_COVE_END);
    const e1 = Math.fround(WET_NO_COVE + WET_COVE_END);
    expect(e1).toBeGreaterThan(e0);
    for (const z of [0, 0.5, 72, 220, 5000, 1e5]) {
      const t = Math.min(1, Math.max(0, Math.fround(Math.fround(Math.abs(z) - e0) / Math.fround(e1 - e0))));
      expect(Math.fround(1 - Math.fround(t * t * Math.fround(3 - 2 * t))), `z ${z}`).toBe(0);
    }
  });
});
