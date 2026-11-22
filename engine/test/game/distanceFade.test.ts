import { describe, expect, it } from "vitest";
import { WIDEN_NONE, emptyFadeUniforms, fadeUniforms } from "../../src/game/distanceFade.js";

describe("the distance fade's uniforms", () => {
  it("are the eye and the widening's band with its growth past one", () => {
    const u = fadeUniforms({ x: 3, y: 4, z: 5 }, { band: [40, 100], factor: 2 }, emptyFadeUniforms());
    expect(u).toEqual({ fadeEye: [3, 4, 5], fadeWiden: [40, 100, 1] });
  });

  it("widen nothing by default, and measure from the origin with no eye", () => {
    const u = fadeUniforms(null, WIDEN_NONE, emptyFadeUniforms());
    expect(u.fadeEye).toEqual([0, 0, 0]);
    expect(u.fadeWiden[2]).toBe(0);
    expect(u.fadeWiden[0]).toBeLessThan(u.fadeWiden[1]);
  });

  it("fill one record again in place", () => {
    const out = emptyFadeUniforms();
    expect(fadeUniforms({ x: 1, y: 2, z: 3 }, WIDEN_NONE, out)).toBe(out);
    expect(fadeUniforms(undefined, WIDEN_NONE, out).fadeEye).toEqual([0, 0, 0]);
  });
});
