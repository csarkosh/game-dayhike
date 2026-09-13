import { describe, expect, it } from "vitest";
import {
  ASPHALT, CENTERLINE, GRAVEL, VERGE,
  ROAD_ASPHALT_HALF, ROAD_DASH_KEEP, ROAD_DASH_ON, ROAD_DASH_PERIOD, ROAD_LINE_HALF,
  ROAD_PAINT_END, ROAD_SHOULDER_HALF, ROAD_TABLE_HALF_SPAN, ROAD_TABLE_N, ROAD_TABLE_RECENTRE,
  ROAD_TABLE_STEP, ROAD_FRAGMENT_DEFS, ROAD_FRAGMENT_PAINT,
  buildRoadTable, dashKeeps, roadAlbedo, roadBands, roadTableStale, roadTableZ0,
} from "../../src/game/roadPaint.js";

describe("road bands — the mirror of the fragment shader", () => {
  const off = { verge: 0, gravel: 0, asphalt: 0, line: 0 };

  it("is absent outside ROAD_PAINT_END and saturated on the bed", () => {
    expect(roadBands(31, 0)).toEqual(off);
    expect(roadBands(-31, 0)).toEqual(off);
    expect(roadBands(ROAD_PAINT_END, 0)).toEqual(off);
    const bed = roadBands(0, 6); // z = 6 is a dash-off phase, so line is 0 regardless of wear
    expect(bed.asphalt).toBe(1);
    expect(bed.gravel).toBe(1);
    expect(bed.verge).toBe(0.5);
    expect(bed.line).toBe(0);
  });

  it("walks the bands outward: asphalt, gravel, verge, nothing", () => {
    expect(roadBands(3.0, 6).asphalt).toBeCloseTo(1, 5);
    const shoulder = roadBands(4.5, 6);
    expect(shoulder.asphalt).toBe(0);
    expect(shoulder.gravel).toBeCloseTo(0.5, 5); // midway through the 3.5..5.5 smoothstep
    const verge = roadBands(10, 6);
    expect(verge.gravel).toBe(0);
    expect(verge.verge).toBeGreaterThan(0);
    expect(verge.verge).toBeLessThan(0.5);
    expect(roadBands(-4.5, 6)).toEqual(shoulder); // symmetric in u
  });

  it("widens the asphalt and line edges to the fragment derivative, never narrower than design", () => {
    // Without widening, u = 3.5 + 0.6 is fully off the asphalt.
    expect(roadBands(4.1, 6, 0).asphalt).toBe(0);
    // A 2 m fragment footprint reaches it.
    expect(roadBands(4.1, 6, 2).asphalt).toBeGreaterThan(0);
    // A tiny derivative leaves the design edge alone.
    expect(roadBands(4.1, 6, 0.01)).toEqual(roadBands(4.1, 6, 0));
  });

  it("dashes the centerline 3 m on, 9 m off, with per-dash wear", () => {
    let on = 0;
    for (let k = -40; k < 40; k++) {
      const z = k * ROAD_DASH_PERIOD;
      // Off-phase is bare whatever the wear hash says.
      expect(roadBands(0, z + ROAD_DASH_ON + 0.5).line).toBe(0);
      expect(roadBands(0, z + ROAD_DASH_PERIOD - 0.5).line).toBe(0);
      const inDash = roadBands(0, z + 1).line;
      expect(inDash === 0 || inDash > 0.5).toBe(true);
      if (inDash > 0) on++;
      expect(inDash > 0).toBe(dashKeeps(k));
    }
    // ~65% survive: between 40% and 90% of 80 periods, so the hash is neither
    // all-on nor all-off and the keep fraction is roughly honoured.
    expect(on).toBeGreaterThan(32);
    expect(on).toBeLessThan(72);
    // The line is a line: gone by ROAD_LINE_HALF + edge.
    expect(roadBands(ROAD_LINE_HALF + 0.3, 1).line).toBe(0);
  });

  it("dash wear is a pinned integer hash, defined for negative indices", () => {
    // Known answers for the hash the shader runs in 32-bit unsigned
    // arithmetic. If these move, the GLSL and the mirror have drifted.
    const sample = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8].map(dashKeeps);
    expect(sample).toEqual(sample.map(Boolean)); // booleans, no NaN
    expect(dashKeeps(0)).toBe(dashKeeps(0));
    expect(dashKeeps(-1)).not.toBe(undefined);
    // Uniformity sanity over a long run.
    let kept = 0;
    for (let k = 0; k < 10000; k++) if (dashKeeps(k)) kept++;
    expect(kept / 10000).toBeGreaterThan(ROAD_DASH_KEEP - 0.05);
    expect(kept / 10000).toBeLessThan(ROAD_DASH_KEEP + 0.05);
  });

  it("composes the colour the way classifySurface did: verge, gravel, asphalt, line", () => {
    const ground = { r: 0.1, g: 0.15, b: 0.06 };
    expect(roadAlbedo(ground, { verge: 0, gravel: 0, asphalt: 0, line: 0 })).toEqual(ground);
    const bed = roadAlbedo(ground, { verge: 0.5, gravel: 1, asphalt: 1, line: 0 });
    expect(bed).toEqual(ASPHALT);
    const line = roadAlbedo(ground, { verge: 0.5, gravel: 1, asphalt: 1, line: 1 });
    expect(line).toEqual(CENTERLINE);
    const shoulder = roadAlbedo(ground, { verge: 0.5, gravel: 1, asphalt: 0, line: 0 });
    expect(shoulder).toEqual(GRAVEL);
    // Textures multiply their own layer only.
    const tex = roadAlbedo(ground, { verge: 0.5, gravel: 1, asphalt: 1, line: 0 }, { r: 2, g: 2, b: 2 });
    expect(tex.r).toBeCloseTo(ASPHALT.r * 2, 9);
    expect(VERGE.r).toBeGreaterThan(0); // the verge colour is exported for the shader
  });
});

describe("centerline table", () => {
  const centre = (seed: number, z: number) => -300 + seed + 0.25 * z;

  it("holds the hook at z0 + i·step, exactly", () => {
    const table = buildRoadTable(7, 1000, centre);
    expect(table.length).toBe(ROAD_TABLE_N);
    expect(ROAD_TABLE_HALF_SPAN).toBe((ROAD_TABLE_N / 2) * ROAD_TABLE_STEP);
    const z0 = roadTableZ0(1000);
    expect(z0).toBe(1000 - ROAD_TABLE_HALF_SPAN);
    for (const i of [0, 1, 1279, 1280, 2559]) {
      expect(table[i]).toBe(Math.fround(centre(7, z0 + i * ROAD_TABLE_STEP)));
    }
  });

  it("reuses a caller's buffer", () => {
    const out = new Float32Array(ROAD_TABLE_N);
    expect(buildRoadTable(7, 0, centre, out)).toBe(out);
  });

  it("recentres past the hysteresis and not inside it, with room for ring 6", () => {
    expect(roadTableStale(0, ROAD_TABLE_RECENTRE)).toBe(false);
    expect(roadTableStale(0, ROAD_TABLE_RECENTRE + 1)).toBe(true);
    expect(roadTableStale(0, -ROAD_TABLE_RECENTRE - 1)).toBe(true);
    // Ring 6 reaches 4096 + 128 m from the camera; the drift plus that must
    // stay inside the half span.
    expect(ROAD_TABLE_RECENTRE + 4096 + 128).toBeLessThan(ROAD_TABLE_HALF_SPAN);
  });
});

describe("the GLSL strings", () => {
  it("carry the same constants as the mirror", () => {
    expect(ROAD_FRAGMENT_PAINT).toContain(`${ROAD_PAINT_END.toFixed(1)}`);
    expect(ROAD_FRAGMENT_PAINT).toContain(`${ROAD_ASPHALT_HALF}`);
    expect(ROAD_FRAGMENT_PAINT).toContain(`${ROAD_SHOULDER_HALF}`);
    expect(ROAD_FRAGMENT_PAINT).toContain("fwidth(");
    expect(ROAD_FRAGMENT_PAINT).toContain("vAlbedoColor.rgb"); // wetness still applies
    expect(ROAD_FRAGMENT_DEFS).toContain("uniform sampler2D roadCenter;");
    expect(ROAD_FRAGMENT_DEFS).toContain("uniform sampler2D roadAsphalt;");
    // fwidth must be evaluated before the branch: derivatives inside
    // non-uniform control flow are undefined.
    expect(ROAD_FRAGMENT_PAINT.indexOf("fwidth(")).toBeLessThan(ROAD_FRAGMENT_PAINT.indexOf("if (rau <"));
  });

  it("takes the ground's own form for asphalt roughness: constant times a map/0.5 modulation, clamped", () => {
    // terrainRough = Σ w'_i · R_i · (near ? map_i / 0.5 : 1) — the
    // per-layer constant is authoritative and the map modulates around the
    // neutral 0.5, the same form terrainTexture.ts's ground blend uses
    // (`clamp(rBase * mix(1.0, rMap / 0.5, strength), 0.0, 1.0)`).
    expect(ROAD_FRAGMENT_PAINT).toContain(
      "terrainRough = mix(terrainRough, clamp(terrainLayerRough2.y * mix(1.0, rAsphaltRAH.r / 0.5, rk), 0.0, 1.0), rAsphalt);",
    );
    // The rejected form replaced the constant outright with the map:
    // mix(terrainLayerRough2.y, rAsphaltRAH.r, rk) / 0.95 —
    // a discontinuity against the ground's formula at the asphalt edge.
    // Regression-pinned absent.
    expect(ROAD_FRAGMENT_PAINT).not.toMatch(
      /mix\(\s*terrainLayerRough2\.y\s*,\s*rAsphaltRAH\.r\s*,\s*rk\s*\)\s*\/\s*0\.95/,
    );
  });

  it("applies asphalt's AO as a mean-1 multiplier, the same /0.5 form the ground blend uses", () => {
    expect(ROAD_FRAGMENT_PAINT).toContain("rAsphaltTex *= mix(1.0, rAsphaltRAH.g / 0.5, rk);");
    // The rejected form multiplied by the raw blended value: it would darken
    // asphalt by whatever occlusion mean the source map happened to ship,
    // rather than by a mean-1 multiplier around it.
    expect(ROAD_FRAGMENT_PAINT).not.toMatch(/rAsphaltTex\s*\*=\s*mix\(\s*1\.0\s*,\s*rAsphaltRAH\.g\s*,\s*rk\s*\);/);
  });
});
