import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the endless highway", () => {
  it("keeps duneD out of olympicBaseFrom (guards the road grade spline from dune noise)", () => {
    // A numeric "roadGradeAt(SEED, z).h === olympicBaseSample(SEED, x, z).h"
    // comparison (the guard's originally-specified form) cannot work on this
    // codebase: road.ts's own doc comment says gradeSplineD "APPROXIMATES
    // rather than interpolates — deliberate" (a uniform cubic B-spline over
    // 4 lattice points, exact at a knot only when the 3 surrounding lattice
    // heights are collinear). Measured at the required i·ROAD_LATTICE sweep
    // (SEED = DERIV_SEED, i = −4..4): the spline-vs-point gap is already
    // 0.14–4.47 m from terrain curvature ALONE, no dunes involved — past
    // both a 1e-9 tolerance and the ~0.6 m of dune noise this guard exists
    // to catch, by orders of magnitude either way. No tolerance threads that
    // needle: loose enough to absorb the curvature gap is loose enough to
    // absorb the dune signal too.
    //
    // Independently, AT THOSE NINE POINTS the road's own pre-dune elevation
    // is 10.41–27.04 m — above DUNE_ALT_OUT_HI = 8 — so duneD is a
    // structural no-op there even under the exact mutation this guard is
    // meant to catch (verified by performing that mutation: the 9 measured
    // diffs above did not change at all). That is a fact about these nine
    // points and nothing more. It does NOT generalise along the coast:
    // sampling the pre-dune centerline height every 10 m over 30 km gives
    // min 5.07 m, p10 7.85 m, and 10.5% of it below DUNE_ALT_OUT_HI, so on
    // roughly a tenth of the coastline the altitude window IS open at the
    // centerline. What keeps duneD off the grade spline everywhere, not
    // just here, is the ROAD window: DUNE_ROAD_NEAR == ROAD_CORRIDOR_HALF,
    // so road.v is 0 at u = 0 whatever the elevation (see the duneD call
    // site's comment in olympic.ts). A numeric guard sited at points where
    // the altitude window is open would therefore still measure nothing —
    // but the reason is the road window, not the terrain being tall.
    //
    // So the guard here is structural: it reads olympic.ts's own source and
    // asserts olympicBaseFrom's body never calls duneD. That is exactly the
    // textual shape of the feared regression ("if someone later moves the
    // duneD call from olympicSample into olympicBaseFrom") — only
    // olympicSample may call duneD, gated by the true road-offset u/uDz, not
    // olympicBaseFrom gated by d/dDz. Verified to go RED under that precise
    // mutation.
    const src = sourceText("sim/olympic.ts");
    const start = src.indexOf("function olympicBaseFrom(");
    const end = src.indexOf("function coastFrame(", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).not.toContain("duneD(");
  });
});
