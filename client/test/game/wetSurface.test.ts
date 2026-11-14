import { afterEach, describe, expect, it } from "vitest";
import {
  WET_DRY_S, WET_LINE_ABOVE, WET_NO_COVE, WET_RADIUS_MAX, WET_SWASH_VECS,
  emptyWetUniforms, setWetCove, setWetSwash, setWetWeather, wetLineFor, wetUniforms, type WetBody, type WetSurface,
} from "../../src/game/wetSurface.js";
import { SWASH_COLUMNS, SWASH_STRIDE } from "../../src/game/swashTable.js";

/** A surface under no body, as a material starts: the terrain's, whose cap is 0. */
const NO_BODY: WetSurface = { line: -1e6, level: -1e6, centre: [0, 0], radius: 0, kd: [0, 0, 0], attenuate: true, cap: 0 };

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

  it("carry the page's cove and its swash table, the one array, refilled in place", () => {
    const before = wetUniforms(NO_BODY).wetSwash;
    setWetCove(37.25, 155, -24, 0.25);
    setWetSwash(tableOf(6, 5));
    const u = wetUniforms(NO_BODY);
    expect(u.wetCove).toEqual([37.25, 155, -24, 0.25]);
    expect(u.wetSwash).toBe(before);
    expect(Array.from(u.wetSwash.subarray(0, 4))).toEqual([6, 5, 6, 5]);
    // No cove when any of its numbers is not finite.
    setWetCove(37.25, Number.NaN, -24, 0.25);
    expect(wetUniforms(NO_BODY).wetCove).toEqual([0, WET_NO_COVE, 0, 0]);
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
