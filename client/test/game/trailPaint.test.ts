import { describe, expect, it } from "vitest";
import {
  TRAIL_PAINT_BUCKET, TRAIL_PAINT_BUCKET_MAX, TRAIL_PAINT_MAX_SEGMENTS, TRAIL_PAINT_GRID,
  TRAIL_PAINT_MARGIN, TRAIL_PAINT_EDGE, TRAIL_DIRT_TINT, TRAIL_GRAVEL_GAIN, TRAIL_BANK_SLOPE,
  trailSegments, buildTrailTable, bucketOf, trailNearest, trailBand, bankRise, trailBankBand,
  TRAIL_FRAGMENT_DEFS, TRAIL_FRAGMENT_PAINT, glslFloat,
  type Segment,
} from "../../src/game/trailPaint.js";
import { TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, type TrailGraph } from "../../src/sim/trail.js";

const BED = TRAIL_BED_HALF + TRAIL_PAINT_MARGIN;
/** Two segments: one along x, one along z, meeting at (100, 0). */
const SEGS: Segment[] = [
  { ax: 0, az: 0, bx: 100, bz: 0 },
  { ax: 100, az: 0, bx: 100, bz: 80 },
];

describe("the bucketed segment table", () => {
  const t = buildTrailTable(SEGS);
  it("leaves an empty ring of buckets around the segments' bounding box", () => {
    expect(t.x0).toBe(0 - TRAIL_CORRIDOR_HALF - TRAIL_PAINT_BUCKET);
    expect(t.z0).toBe(0 - TRAIL_CORRIDOR_HALF - TRAIL_PAINT_BUCKET);
    expect(t.overflow).toBe(false);
    // The bucket seaward of the first segment (in the ring) is empty.
    const ring = bucketOf(t, t.x0 + 1, t.z0 + 1);
    expect(t.index[ring * 4 + 1]).toBe(0);
  });
  it("lists a segment in every bucket its corridor-grown box touches, and only those", () => {
    // Segment 0 spans x ∈ [−4, 104] after growing: buckets 0 (ring), 1 and 2 of its row.
    const b1 = bucketOf(t, 50, 0), b2 = bucketOf(t, 101, 0);
    expect(t.index[b1 * 4 + 1]).toBe(1);
    expect(t.index[b2 * 4 + 1]).toBe(2); // both segments meet here
    const far = bucketOf(t, 50, 300);
    expect(t.index[far * 4 + 1]).toBe(0);
    // The list entries are the segments themselves.
    const s0 = t.index[b1 * 4]!;
    expect([t.list[s0 * 4], t.list[s0 * 4 + 1], t.list[s0 * 4 + 2], t.list[s0 * 4 + 3]]).toEqual([0, 0, 100, 0]);
  });
  it("reports bucketMax and flags an overflow instead of overrunning", () => {
    expect(t.bucketMax).toBe(2);
    const many: Segment[] = Array.from({ length: TRAIL_PAINT_BUCKET_MAX + 1 }, (_, i) => ({ ax: 10, az: i, bx: 20, bz: i }));
    const o = buildTrailTable(many);
    expect(o.overflow).toBe(true);
    expect(o.bucketMax).toBe(TRAIL_PAINT_BUCKET_MAX);
    expect(o.list.length).toBe(TRAIL_PAINT_MAX_SEGMENTS * 4);
    expect(o.index.length).toBe(TRAIL_PAINT_GRID * TRAIL_PAINT_GRID * 4);
  });
  it("bucketOf clamps to the ring outside the box, so a far fragment reads an empty bucket", () => {
    const b = bucketOf(t, -5000, 9000);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(t.index[b * 4 + 1]).toBe(0);
  });
  it("takes every edge of a graph, uncapped", () => {
    const nodes = Array.from({ length: 70 }, (_, i) => ({ x: i * 10, z: 0, h: i * 2, u: i * 10 }));
    const edges = nodes.slice(1).map((_, i) => ({
      a: i, b: i + 1, kind: "stem" as const, profile: new Float64Array([i * 2, i * 2 + 2]), progress0: i / 69, progress1: (i + 1) / 69,
    }));
    const g: TrailGraph = {
      nodes, edges, trailhead: { x: 0, z: 0, u: 0 }, summit: 69, stem: edges.map((_, i) => i), loops: [], features: [], stemLen: 690, fallbacks: 0,
    };
    expect(trailSegments(g).length).toBe(69);
    expect(trailSegments(g)[3]).toEqual({ ax: 30, az: 0, bx: 40, bz: 0 });
  });
});

describe("the band (the mirror of the fragment shader)", () => {
  const t = buildTrailTable(SEGS);
  it("is 1 on the bed plus its margin, 0 past the edge, symmetric", () => {
    expect(trailBand(50, 0, t)).toBe(1);
    expect(trailBand(50, BED - 0.01, t)).toBe(1);
    expect(trailBand(50, BED + TRAIL_PAINT_EDGE + 0.01, t)).toBe(0);
    expect(trailBand(50, 1.6, t)).toBeCloseTo(trailBand(50, -1.6, t), 12);
    expect(trailBand(100, 40, t)).toBe(1);
  });
  it("widens the edge to the fragment footprint, never narrower", () => {
    const far = BED + TRAIL_PAINT_EDGE + 0.5;
    expect(trailBand(50, far, t, 0)).toBe(0);
    expect(trailBand(50, far, t, 2)).toBeGreaterThan(0);
  });
  it("finds the nearest segment only among the fragment's own bucket", () => {
    const n = trailNearest(t, 50, 3);
    expect(n.d).toBeCloseTo(3, 9);
    expect([n.ex, n.ez]).toEqual([0, 1]); // away from the bed, unit
    expect(trailNearest(t, 50, 300).d).toBe(Infinity);
  });
});

describe("the bank", () => {
  it("rises where the ground climbs away from the bed and not where it falls", () => {
    // Ground rising in +z at 0.5; a fragment on the +z side of an x-running bed.
    expect(bankRise(0, 0.5, 0, 1)).toBeCloseTo(0.5, 12);
    expect(bankRise(0, 0.5, 0, -1)).toBeCloseTo(-0.5, 12);
    expect(trailBankBand(2.5, 0.5)).toBeGreaterThan(0);
    expect(trailBankBand(2.5, -0.5)).toBe(0);
    expect(trailBankBand(TRAIL_CORRIDOR_HALF + 0.01, 0.5)).toBe(0);
    expect(trailBankBand(BED, TRAIL_BANK_SLOPE)).toBe(1);
    expect(trailBankBand(2.5, TRAIL_BANK_SLOPE / 2)).toBeLessThan(trailBankBand(2.5, TRAIL_BANK_SLOPE));
  });
  it("paints only where the ground is soil: nothing on rock, sand or snow, in proportion between", () => {
    // A cut through rock exposes rock — the base albedo already — and a beach
    // has no floor to expose; the band scales with the grass + forest-floor
    // weight of the vertex it stands on.
    expect(trailBankBand(BED, TRAIL_BANK_SLOPE, 1)).toBe(1);
    expect(trailBankBand(BED, TRAIL_BANK_SLOPE, 0)).toBe(0);
    expect(trailBankBand(2.5, 0.5, 0)).toBe(0);
    expect(trailBankBand(BED, TRAIL_BANK_SLOPE, 0.25)).toBeCloseTo(0.25, 12);
    // The shader forms the same factor from the class weights it already carries.
    expect(TRAIL_FRAGMENT_PAINT).toContain("vTerrainW.x + vTerrainW.y");
  });
  it("is the ground's own vertex colour under the floor texture, not the material's white albedo", () => {
    // vAlbedoColor is the PBR material's constant albedo; the ground's darkness
    // and canopy tint live in the VERTEX colour. A bank lit by the constant
    // alone painted the floor texture at full brightness beside the bed.
    const bank = TRAIL_FRAGMENT_PAINT.split("\n").find((l) => l.includes("tFloorTex *") && l.includes("tBank)"))!;
    expect(bank).toBeDefined();
    expect(TRAIL_FRAGMENT_PAINT).toContain("vec3 tBankBase = vColor.rgb;");
    expect(bank).toContain("tBankBase");
    expect(bank).not.toContain("vAlbedoColor");
  });
  it("is packed snow, not dirt, above the snow line", () => {
    // vTerrainW2.y is the ground blend's detail weight: 1 on bare ground, 0
    // under full snow, and snow is the only thing that lowers it. The bed
    // blends from its dirt-gravel colour to a darkened, bluer copy of the
    // ground the blend produced, the gravel's normal/roughness/F0 swap fades
    // with it, and the bare-floor bank goes with the soil it exposes.
    expect(TRAIL_FRAGMENT_PAINT).toContain("float tSnow = 1.0 - clamp(vTerrainW2.y, 0.0, 1.0);");
    expect(TRAIL_FRAGMENT_PAINT).toContain("* tSoil * (1.0 - tSnow);");
    expect(TRAIL_FRAGMENT_PAINT).toContain("vec3 tPacked = surfaceAlbedo * vec3(0.86, 0.88, 0.94);");
    expect(TRAIL_FRAGMENT_PAINT).toContain("mix(tDirt, tPacked, tSnow), tBed)");
    expect(TRAIL_FRAGMENT_PAINT).toContain("float tGravel = tBed * (1.0 - tSnow);");
    const gravelSwaps = TRAIL_FRAGMENT_PAINT.split("\n").filter((l) => l.includes("tGravelN.x") || l.includes("terrainLayerRough2.x") || l.includes("terrainLayerF02.x"));
    expect(gravelSwaps).toHaveLength(3);
    for (const l of gravelSwaps) expect(l).toContain("tGravel");
  });
});

describe("shader strings", () => {
  it("declare both samplers and paint under TRAILPAINT, with no hashed keyword inside a comment", () => {
    expect(TRAIL_FRAGMENT_DEFS).toContain("uniform sampler2D trailSegs;");
    expect(TRAIL_FRAGMENT_DEFS).toContain("uniform sampler2D trailIndex;");
    expect(TRAIL_FRAGMENT_PAINT).toContain("trailInfo");
    for (const src of [TRAIL_FRAGMENT_DEFS, TRAIL_FRAGMENT_PAINT]) {
      for (const line of src.split("\n")) {
        const c = line.indexOf("//");
        if (c >= 0) expect(line.slice(c)).not.toMatch(/#\s*(if|ifdef|ifndef|else|endif|define|undef)/);
      }
    }
  });
  it("carries the mirror's constants, reads the bucket then the list, and runs fwidth before the branch", () => {
    expect(TRAIL_FRAGMENT_PAINT).toContain(glslFloat(BED));
    expect(TRAIL_FRAGMENT_PAINT).toContain(glslFloat(TRAIL_PAINT_EDGE));
    expect(TRAIL_FRAGMENT_PAINT).toContain(glslFloat(TRAIL_CORRIDOR_HALF));
    expect(TRAIL_FRAGMENT_PAINT).toContain(glslFloat(TRAIL_BANK_SLOPE));
    expect(TRAIL_FRAGMENT_PAINT).toContain(glslFloat(TRAIL_DIRT_TINT.r));
    expect(TRAIL_FRAGMENT_PAINT).toContain(glslFloat(TRAIL_GRAVEL_GAIN));
    expect(TRAIL_FRAGMENT_PAINT).toContain(`${TRAIL_PAINT_BUCKET_MAX}`);
    expect(TRAIL_FRAGMENT_PAINT).toContain(`${TRAIL_PAINT_MAX_SEGMENTS}.0`);
    expect(TRAIL_FRAGMENT_PAINT).toContain("vNormalW");
    expect(TRAIL_FRAGMENT_PAINT).toContain("terrainPebble");
    expect(TRAIL_FRAGMENT_PAINT).toContain("terrainFloor");
    expect(TRAIL_FRAGMENT_PAINT.indexOf("trailIndex")).toBeLessThan(TRAIL_FRAGMENT_PAINT.indexOf("trailSegs"));
    expect(TRAIL_FRAGMENT_PAINT).toContain("fwidth(");
    expect(TRAIL_FRAGMENT_PAINT.indexOf("fwidth(")).toBeLessThan(TRAIL_FRAGMENT_PAINT.indexOf("if (tdBest"));
    expect(TRAIL_FRAGMENT_PAINT).not.toContain("vPositionW.y -"); // the cut-depth model is gone
  });
});
