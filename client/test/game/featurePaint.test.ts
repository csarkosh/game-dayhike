import { describe, expect, it } from "vitest";
import {
  FEATURE_PAINT_MAX, featureTable, featurePaintWeights, FEATURE_FRAGMENT_PAINT, FEATURE_FRAGMENT_DEFS,
} from "../../src/game/featurePaint.js";
import {
  MEADOW_RIM, PEAK_CREST_RADIUS, PEAK_RIM_FADE, POND_SHORE, TREELINE_BAND, TREELINE_BELOW_CREST,
  featureMaskAt, type Feature,
} from "../../src/sim/features.js";

const fs: Feature[] = [
  { id: 0, kind: "peak", x: 10, z: 20, radius: 220, height: 75, crestH: 300 },
  { id: 1, kind: "meadow", x: 500, z: 0, radius: 90, height: 60 },
  { id: 2, kind: "pond", x: 0, z: 700, radius: 30, height: 40 },
];
describe("the feature paint table", () => {
  it("packs x, z, radius, kind per feature and the shared constants in the second row, padded to FEATURE_PAINT_MAX", () => {
    const t = featureTable(fs);
    expect(t.length).toBe(FEATURE_PAINT_MAX * 4 * 2);
    expect(Array.from(t.slice(0, 4))).toEqual([10, 20, 220, 1]);
    expect(Array.from(t.slice(4, 8))).toEqual([500, 0, 90, 2]);
    expect(Array.from(t.slice(8, 12))).toEqual([0, 700, 30, 3]);
    expect(Array.from(t.slice(12, 16))).toEqual([0, 0, 0, 0]);
    expect(Array.from(t.slice(FEATURE_PAINT_MAX * 4, FEATURE_PAINT_MAX * 4 + 4)))
      .toEqual([300 - TREELINE_BELOW_CREST, TREELINE_BAND, 35, 4]);
    // Row 1's SECOND texel carries the peak's radial fade — texel 0 was
    // full. The rest of the row stays zero.
    expect(t[FEATURE_PAINT_MAX * 4 + 4]).toBe(PEAK_RIM_FADE);
    expect(Array.from(t.slice(FEATURE_PAINT_MAX * 4 + 5)).every((v) => v === 0)).toBe(true);
  });
  it("carries no hashed keyword inside a comment, and every line comment is free of semicolons", () => {
    for (const src of [FEATURE_FRAGMENT_DEFS, FEATURE_FRAGMENT_PAINT]) {
      for (const line of src.split("\n")) {
        const c = line.indexOf("//");
        if (c < 0) continue;
        const comment = line.slice(c);
        expect(comment).not.toMatch(/#\s*(if|ifdef|ifndef|else|elif|endif|define)/);
        expect(comment).not.toContain(";");
      }
    }
  });
  it("gates its paint on FEATUREPAINT and reads the table with a fixed loop bound", () => {
    expect(FEATURE_FRAGMENT_PAINT).toContain("#ifdef FEATUREPAINT");
    expect(FEATURE_FRAGMENT_PAINT).toContain(`for (int fi = 0; fi < ${FEATURE_PAINT_MAX}; fi++)`);
  });
  it("ramps rock UP TO the treeline height and stays full above it", () => {
    // fMeta.x is the treeline height (crestH - TREELINE_BELOW_CREST), fMeta.y
    // the treeline band: features.ts's own tree-cover mask reaches zero trees
    // (full bare) exactly AT the treeline height and stays bare above it, so
    // the rock term must ramp from 0 at (fMeta.x - fMeta.y) to 1 AT fMeta.x —
    // the mirror of the inverted, shifted-upward band the first cut shipped.
    expect(FEATURE_FRAGMENT_PAINT).toContain("smoothstep(fMeta.x - fMeta.y, fMeta.x, vPositionW.y)");
  });
  it("gates the rock term on the peak's own disc, with the mask's radial fade", () => {
    // `above` reads only vPositionW.y, so without this the whole inland range
    // above the treeline painted rock under a full forest. `near` is the same
    // 1 - smoothstep(R - PEAK_RIM_FADE, R, d) `featureMaskAt` multiplies its
    // tree thinning by. The numeric case is `featurePaintWeights` below.
    expect(FEATURE_FRAGMENT_PAINT).toContain("float near = 1.0 - smoothstep(f.z - fRim.x, f.z, fd)");
    expect(FEATURE_FRAGMENT_PAINT).toContain("float rock = max(above * near, crest)");
  });
  it("tints the ground it finds and never replaces it with an absolute colour", () => {
    // The first cut mixed toward absolute colours scaled by vAlbedoColor —
    // the material's constant white, not the vertex colour — so a meadow
    // read brighter and greener than the palette's own ground and looked
    // like a sheen from below ("why is the trail shiny at the top?").
    expect(FEATURE_FRAGMENT_PAINT).not.toContain("vAlbedoColor");
    expect(FEATURE_FRAGMENT_PAINT).not.toContain("vec3(0.36, 0.46, 0.20)");
    expect(FEATURE_FRAGMENT_PAINT).toContain("surfaceAlbedo *= mix(vec3(1.0), vec3(0.92, 1.06, 0.82), meadow * 0.5);");
    expect(FEATURE_FRAGMENT_PAINT).toContain("surfaceAlbedo *= mix(vec3(1.0), vec3(0.85, 0.78, 0.70), shore * 0.8);");
    // Rock desaturates toward the ground's own luminance: snow stays snow.
    expect(FEATURE_FRAGMENT_PAINT).toContain("float fLum = dot(surfaceAlbedo, vec3(0.299, 0.587, 0.114));");
    expect(FEATURE_FRAGMENT_PAINT).toContain("mix(surfaceAlbedo, vec3(fLum) * 1.1, rock * 0.85)");
  });
});

/**
 * WHAT THE PAINT ACTUALLY PAINTS.
 *
 * The geometry below is a representative world: a 300 m dome whose crest
 * stands at 134.5 m (treeline 119.5 m), a 90 m meadow and a 30 m pond, each
 * far enough from the others that only one term is live at a time — the
 * real feature builder's own FEATURE_SPACING is 180 m.
 */
describe("the feature paint's weights", () => {
  const peak: Feature = { id: 0, kind: "peak", x: 0, z: 0, radius: 300, height: 65, crestH: 134.5 };
  const meadow: Feature = { id: 1, kind: "meadow", x: 2000, z: 0, radius: 90, height: 60 };
  const pond: Feature = { id: 2, kind: "pond", x: 0, z: 2000, radius: 30, height: 40 };
  const all = [peak, meadow, pond];
  const treeline = (peak.crestH as number) - TREELINE_BELOW_CREST;

  it("fills a meadow's disc and ramps out over its rim", () => {
    expect(featurePaintWeights(all, meadow.x, meadow.z, 60).meadow).toBeCloseTo(1, 9);
    expect(featurePaintWeights(all, meadow.x + meadow.radius, meadow.z, 60).meadow).toBeCloseTo(1, 9);
    const mid = featurePaintWeights(all, meadow.x + meadow.radius + MEADOW_RIM / 2, meadow.z, 60).meadow;
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(featurePaintWeights(all, meadow.x + meadow.radius + MEADOW_RIM, meadow.z, 60).meadow).toBeCloseTo(0, 9);
    expect(featurePaintWeights(all, meadow.x + 400, meadow.z, 60).meadow).toBe(0);
    // The same interval `featureMaskAt` ramps its own meadow term over.
    expect(mid).toBeCloseTo(featureMaskAt(all, meadow.x + meadow.radius + MEADOW_RIM / 2, meadow.z).meadow, 9);
  });

  it("paints a pond's shore band and nothing past it", () => {
    expect(featurePaintWeights(all, pond.x, pond.z + pond.radius + POND_SHORE, 40).shore).toBeCloseTo(1, 9);
    expect(featurePaintWeights(all, pond.x, pond.z + pond.radius + POND_SHORE + 2, 40).shore).toBeCloseTo(0, 9);
    expect(featurePaintWeights(all, pond.x, pond.z + pond.radius + 40, 40).shore).toBe(0);
  });

  it("paints rock above the treeline INSIDE the peak's disc and nothing below it", () => {
    // 200 m out — inside the disc, outside the rim fade.
    expect(featurePaintWeights(all, 200, 0, treeline).rock).toBeCloseTo(1, 9);
    expect(featurePaintWeights(all, 200, 0, treeline - TREELINE_BAND).rock).toBeCloseTo(0, 9);
    const half = featurePaintWeights(all, 200, 0, treeline - TREELINE_BAND / 2).rock;
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    // The bare crest platform is a distance test, live at any height.
    expect(featurePaintWeights(all, PEAK_CREST_RADIUS - 1, 0, 0).rock).toBeCloseTo(1, 9);
  });

  it("fades the rock out to nothing at the peak's rim (shared geometry with the mask)", () => {
    expect(featurePaintWeights(all, peak.radius - PEAK_RIM_FADE, 0, 1000).rock).toBeCloseTo(1, 9);
    expect(featurePaintWeights(all, peak.radius, 0, 1000).rock).toBeCloseTo(0, 9);
    expect(featurePaintWeights(all, peak.radius - 1, 0, 1000).rock).toBeLessThan(0.01);
    // Monotone out through the fade band.
    let prev = 2;
    for (let d = peak.radius - PEAK_RIM_FADE; d <= peak.radius; d += 1) {
      const w = featurePaintWeights(all, d, 0, 1000).rock;
      expect(w, `d = ${d}`).toBeLessThanOrEqual(prev + 1e-12);
      prev = w;
    }
  });

  it("paints NO rock 570 m from the peak at crest height", () => {
    // Measured on a representative world (seed -1048259771, crest 134.5 m,
    // treeline 119.5 m): at u = 400, 570 m from the peak and in plain view
    // of the lower stem, the ground is 135 m — so the old height-only term
    // painted FULL rock there while `featureMask.tree` read 1.00. Several
    // kilometres of grey-painted full forest, on most worlds.
    for (const d of [570, 1000, 2000, 3000, 4000]) {
      // Sampled away from the meadow and the pond (both 2 km out on the
      // other axes) so the only term that could be live is the peak's.
      expect(featurePaintWeights(all, -d, 0, 135).rock, `${d} m from the peak`).toBe(0);
      expect(featureMaskAt(all, -d, 0, 135).tree, `${d} m from the peak`).toBe(1);
    }
  });

  it("paints no rock at all on a world with no peak", () => {
    const noPeak = [meadow, pond];
    expect(featurePaintWeights(noPeak, 0, 0, 1000).rock).toBe(0);
    expect(featurePaintWeights(noPeak, 0, 0, -1000).rock).toBe(0);
    expect(featureTable(noPeak)[FEATURE_PAINT_MAX * 4]).toBe(0);
  });
});
