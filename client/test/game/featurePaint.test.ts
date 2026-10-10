import { describe, expect, it } from "vitest";
import {
  FEATURE_PAINT_MAX, FEATURE_TEX_ROWS, FEATURE_TEX_WIDTH, featureTable, featurePaintWeights, featureWetInside, paintedLakes,
  FEATURE_FRAGMENT_PAINT, FEATURE_FRAGMENT_DEFS,
} from "../../src/game/featurePaint.js";
import { bakeShoreAtlas } from "../../src/game/shoreAtlas.js";
import { stadiumShape } from "../helpers/lakeShapes.js";
import { timeLimit } from "../helpers/timeLimit.js";
import {
  MEADOW_RIM, PEAK_CREST_RADIUS, PEAK_RIM_FADE, POND_SHORE, TREELINE_BAND, TREELINE_BELOW_CREST,
  featureMaskAt, type Feature,
} from "../../src/sim/features.js";

const fs: Feature[] = [
  { id: 0, kind: "peak", x: 10, z: 20, radius: 220, height: 75, crestH: 300 },
  { id: 1, kind: "meadow", x: 500, z: 0, radius: 90, height: 60 },
  {
    id: 2, kind: "pond", x: 0, z: 700, radius: 30, height: 40, murk: 1,
    shape: stadiumShape({ cx: 0, cz: 700, halfLen: 5, w: 30, level: 40, murk: 1 }),
  },
];
describe("the feature paint table", { timeout: timeLimit(30_000) }, () => {
  it("packs x, z, radius, kind per feature in row 0, a lake's centre and bound, the shared constants in row 1, and the shore atlas below", () => {
    const atlas = bakeShoreAtlas(paintedLakes(fs));
    const t = featureTable(fs, atlas);
    expect([FEATURE_PAINT_MAX, FEATURE_TEX_WIDTH, FEATURE_TEX_ROWS]).toEqual([8, 256, 258]);
    expect(t.length).toBe(256 * 258 * 4);
    expect(Array.from(t.slice(0, 4))).toEqual([10, 20, 220, 1]);
    expect(Array.from(t.slice(4, 8))).toEqual([500, 0, 90, 2]);
    // The lake: its shape's centre and bound, 5 + 30 + 47.
    expect(Array.from(t.slice(8, 12))).toEqual([0, 700, 82, 3]);
    expect(Array.from(t.slice(12, 32)).every((v) => v === 0)).toBe(true);
    expect(Array.from(t.slice(256 * 4, 256 * 4 + 4))).toEqual([300 - TREELINE_BELOW_CREST, TREELINE_BAND, 35, 4]);
    // Row 1's SECOND texel carries the peak's radial fade.
    expect(t[256 * 4 + 4]).toBe(PEAK_RIM_FADE);
    expect(Array.from(t.slice(256 * 4 + 5, 2 * 256 * 4)).every((v) => v === 0)).toBe(true);
    // Row 2 + v, texel u, red: the atlas's texel (u, v).
    expect(t[((2 + 64) * 256 + 64) * 4]).toBe(atlas.values[64 * 256 + 64]);
    expect(t[((2 + 64) * 256 + 64) * 4 + 1]).toBe(0);
    expect(paintedLakes(fs)).toEqual([fs[2]!.shape]);
  });
  it("leaves out a lake whose bound is infinite, a placement's shape, from the lakes and from the table", () => {
    const placed: Feature = {
      id: 3, kind: "pond", x: 0, z: 900, radius: 30, height: 40, murk: 1,
      shape: { ...stadiumShape({ cx: 0, cz: 900, halfLen: 5, w: 30, level: 40, murk: 1 }), bound: Number.POSITIVE_INFINITY },
    };
    const both = [...fs, placed];
    expect(paintedLakes(both)).toEqual([fs[2]!.shape]);
    const t = featureTable(both, bakeShoreAtlas(paintedLakes(both)));
    expect(Array.from(t.slice(12, 16))).toEqual([0, 0, 0, 0]);
    expect(Array.from({ length: 256 * 256 }, (_, k) => t[(2 * 256 + k) * 4]).some(Number.isNaN)).toBe(false);
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
  it("gates its paint on FEATUREPAINT and reads the table with a fixed loop bound, texel by texel", () => {
    expect(FEATURE_FRAGMENT_PAINT).toContain("#ifdef FEATUREPAINT");
    expect(FEATURE_FRAGMENT_PAINT).toContain("for (int fi = 0; fi < 8; fi++)");
    expect(FEATURE_FRAGMENT_PAINT).toContain("vec4 f = texelFetch(featureTex, ivec2(fi, 0), 0);");
    expect(FEATURE_FRAGMENT_PAINT).not.toContain("texture2D");
  });
  it("holds featureShoreAt whole, the text shoreAtlasRead transcribes, so no change to it passes unseen", () => {
    expect(FEATURE_FRAGMENT_DEFS).toContain(
      "float featureShoreTexel(int u, int v) {\n" +
        "  return texelFetch(featureTex, ivec2(u, v + 2), 0).r;\n" +
        "}\n",
    );
    expect(FEATURE_FRAGMENT_DEFS).toContain(
      "float featureShoreAt(float tile, vec2 c, float b, vec2 xz) {\n" +
        "  vec2 local = (xz - (c - vec2(b))) / (2.0 * b);\n" +
        "  vec2 p = clamp(local * 128.0, vec2(0.5), vec2(128.0 - 0.5)) - vec2(0.5)\n" +
        "    + vec2(mod(tile, 2.0), floor(tile / 2.0)) * 128.0;\n" +
        "  vec2 i0 = floor(p);\n" +
        "  vec2 f = p - i0;\n" +
        "  int u0 = int(i0.x);\n" +
        "  int v0 = int(i0.y);\n" +
        "  int u1 = min(u0 + 1, 255);\n" +
        "  int v1 = min(v0 + 1, 255);\n" +
        "  float nearRow = mix(featureShoreTexel(u0, v0), featureShoreTexel(u1, v0), f.x);\n" +
        "  float farRow = mix(featureShoreTexel(u0, v1), featureShoreTexel(u1, v1), f.x);\n" +
        "  float inside = step(0.0, local.x) * step(0.0, local.y) * step(local.x, 1.0) * step(local.y, 1.0);\n" +
        "  return mix(-1000.0, mix(nearRow, farRow, f.y), inside);\n" +
        "}\n",
    );
  });
  it("tints a lake's shore band by its shore distance, the lakes counted off the table in order", () => {
    expect(FEATURE_FRAGMENT_PAINT).toContain(
      "    } else if (f.w > 2.5) {\n" +
        "      float fShore = -featureShoreAt(fLake, f.xy, f.z, vPositionW.xz);\n" +
        "      fLake += 1.0;\n" +
        "      float shore = 1.0 - smoothstep(fMeta.w, fMeta.w + 2.0, fShore);\n" +
        "      // The bed under the water paints itself, so the shore's tint begins at the shore.\n" +
        "      shore *= smoothstep(-1.0, 0.0, fShore);\n" +
        "      surfaceAlbedo *= mix(vec3(1.0), vec3(0.85, 0.78, 0.70), shore * 0.8);\n",
    );
    expect(FEATURE_FRAGMENT_PAINT).toContain("  float fLake = 0.0;\n");
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
describe("the feature paint's weights", { timeout: timeLimit(30_000) }, () => {
  const peak: Feature = { id: 0, kind: "peak", x: 0, z: 0, radius: 300, height: 65, crestH: 134.5 };
  const meadow: Feature = { id: 1, kind: "meadow", x: 2000, z: 0, radius: 90, height: 60 };
  // A lake 30 m in half-width about a 10 m spine along z at (0, 2000): its
  // flank the line x = 30 for |z − 2000| ≤ 5, its cap's tip (0, 2035).
  const pond: Feature = {
    id: 2, kind: "pond", x: 0, z: 2000, radius: 30, height: 40, murk: 1,
    shape: stadiumShape({ cx: 0, cz: 2000, halfLen: 5, w: 30, level: 40, murk: 1 }),
  };
  const all = [peak, meadow, pond];
  const atlas = bakeShoreAtlas(paintedLakes(all));
  const treeline = (peak.crestH as number) - TREELINE_BELOW_CREST;

  it("fills a meadow's disc and ramps out over its rim", () => {
    expect(featurePaintWeights(all, atlas, meadow.x, meadow.z, 60).meadow).toBeCloseTo(1, 9);
    expect(featurePaintWeights(all, atlas, meadow.x + meadow.radius, meadow.z, 60).meadow).toBeCloseTo(1, 9);
    const mid = featurePaintWeights(all, atlas, meadow.x + meadow.radius + MEADOW_RIM / 2, meadow.z, 60).meadow;
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(featurePaintWeights(all, atlas, meadow.x + meadow.radius + MEADOW_RIM, meadow.z, 60).meadow).toBeCloseTo(0, 9);
    expect(featurePaintWeights(all, atlas, meadow.x + 400, meadow.z, 60).meadow).toBe(0);
    // The same interval `featureMaskAt` ramps its own meadow term over.
    expect(mid).toBeCloseTo(featureMaskAt(all, meadow.x + meadow.radius + MEADOW_RIM / 2, meadow.z).meadow, 9);
  });

  it("paints a lake's shore band by its shore distance and nothing past it", () => {
    // Out along the flank: x = 30 + t is t metres outside the shore.
    expect(featurePaintWeights(all, atlas, 30 + POND_SHORE, 2000, 40).shore).toBeCloseTo(1, 6);
    expect(featurePaintWeights(all, atlas, 30 + POND_SHORE + 2, 2000, 40).shore).toBeCloseTo(0, 6);
    expect(featurePaintWeights(all, atlas, 30 + 40, 2000, 40).shore).toBe(0);
    // the shore factor the shader has: nothing a metre in, the band from the shore
    expect(featurePaintWeights(all, atlas, pond.x, pond.z, 40).shore).toBe(0);
    expect(featurePaintWeights(all, atlas, 29, 2000, 40).shore).toBeCloseTo(0, 6);
    expect(featurePaintWeights(all, atlas, 29.5, 2000, 40).shore).toBeCloseTo(0.5, 6);
    expect(featurePaintWeights(all, atlas, 30.5, 2000, 40).shore).toBeCloseTo(1, 6);
  });

  it("holds the wet look's footprint to the lake's shore on the terrain, the disc for the sea", () => {
    expect(FEATURE_FRAGMENT_DEFS).toContain(
      "float featureWetInside(vec2 xz, vec2 centre, float radius, float count) {\n" +
        "  float inside = 1.0 - smoothstep(radius + 1.0, radius + 3.0, length(xz - centre));\n" +
        "  float fLake = 0.0;\n" +
        "  for (int fi = 0; fi < 8; fi++) {\n" +
        "    if (float(fi) >= count) break;\n" +
        "    vec4 f = texelFetch(featureTex, ivec2(fi, 0), 0);\n" +
        "    if (f.w > 2.5) {\n" +
        "      if (length(f.xy - centre) < 0.5) inside = 1.0 - smoothstep(1.0, 3.0, -featureShoreAt(fLake, f.xy, f.z, xz));\n" +
        "      fLake += 1.0;\n" +
        "    }\n" +
        "  }\n" +
        "  return inside;\n" +
        "}\n",
    );
    // The lake's wet body: its centre, and its disc the farthest shore point, 35 m.
    const wet = (x: number, z: number): number => featureWetInside(all, atlas, x, z, 0, 2000, 35);
    expect(wet(29, 2000)).toBeCloseTo(1, 6);
    expect(wet(32, 2000)).toBeCloseTo(0.5, 6);
    expect(wet(33.5, 2000)).toBeCloseTo(0, 6);
    // Where the disc of 35 m would reach (37, 2000) the shore has let go.
    expect(wet(37, 2000)).toBe(0);
    // The sea: no lake stands at its centre, so its disc.
    expect(featureWetInside(all, atlas, 5000, 5000, 0, 0, 1e6)).toBe(1);
  });

  it("follows the shore round the cap, not a disc about the centre", () => {
    // 4 m past the cap's tip, 39 m from the centre: the disc's band stopped at 36.
    expect(featurePaintWeights(all, atlas, 0, 2039, 40).shore).toBeCloseTo(1, 3);
  });

  it("paints rock above the treeline INSIDE the peak's disc and nothing below it", () => {
    // 200 m out — inside the disc, outside the rim fade.
    expect(featurePaintWeights(all, atlas, 200, 0, treeline).rock).toBeCloseTo(1, 9);
    expect(featurePaintWeights(all, atlas, 200, 0, treeline - TREELINE_BAND).rock).toBeCloseTo(0, 9);
    const half = featurePaintWeights(all, atlas, 200, 0, treeline - TREELINE_BAND / 2).rock;
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    // The bare crest platform is a distance test, live at any height.
    expect(featurePaintWeights(all, atlas, PEAK_CREST_RADIUS - 1, 0, 0).rock).toBeCloseTo(1, 9);
  });

  it("fades the rock out to nothing at the peak's rim (shared geometry with the mask)", () => {
    expect(featurePaintWeights(all, atlas, peak.radius - PEAK_RIM_FADE, 0, 1000).rock).toBeCloseTo(1, 9);
    expect(featurePaintWeights(all, atlas, peak.radius, 0, 1000).rock).toBeCloseTo(0, 9);
    expect(featurePaintWeights(all, atlas, peak.radius - 1, 0, 1000).rock).toBeLessThan(0.01);
    // Monotone out through the fade band.
    let prev = 2;
    for (let d = peak.radius - PEAK_RIM_FADE; d <= peak.radius; d += 1) {
      const w = featurePaintWeights(all, atlas, d, 0, 1000).rock;
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
      expect(featurePaintWeights(all, atlas, -d, 0, 135).rock, `${d} m from the peak`).toBe(0);
      expect(featureMaskAt(all, -d, 0, 135).tree, `${d} m from the peak`).toBe(1);
    }
  });

  it("paints no rock at all on a world with no peak", () => {
    const noPeak = [meadow, pond];
    expect(featurePaintWeights(noPeak, atlas, 0, 0, 1000).rock).toBe(0);
    expect(featurePaintWeights(noPeak, atlas, 0, 0, -1000).rock).toBe(0);
    expect(featureTable(noPeak, atlas)[FEATURE_TEX_WIDTH * 4]).toBe(0);
  });
});
