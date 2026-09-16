import { describe, expect, it } from "vitest";
import {
  TRAIL_PAINT_BUCKET, TRAIL_PAINT_BUCKET_MAX, TRAIL_PAINT_MAX_SEGMENTS, TRAIL_PAINT_GRID,
  TRAIL_PAINT_EDGE, TRAIL_BANK_SLOPE,
  trailSegments, buildTrailTable, bucketOf, trailNearest, trailBand, bankRise, trailBankBand,
  nodeWidths, trailPaintAt,
  TRAIL_FRAGMENT_DEFS, TRAIL_FRAGMENT_PAINT,
  type Segment,
} from "../../src/game/trailPaint.js";
import { TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, type TrailGraph } from "../../src/sim/trail.js";
import {
  TRAIL_JUNCTION_W, TRAIL_CORE_HALF, TRAIL_MARGIN_HALF, TRAIL_TRAMPLE_HALF,
  TRAIL_CORE_TINT, TRAIL_MARGIN_TINT, TRAIL_TRAMPLE_TINT, TRAIL_CORE_GAIN, TRAIL_MARGIN_GAIN,
  TRAIL_WET_DARK, TRAIL_WET_GLOSS, TRAIL_HEIGHT_SHIFT, TRAIL_EDGE_NOISE,
  TRAIL_WEAR_W0, TRAIL_WEAR_W1, TRAIL_WEAR_D0, TRAIL_WEAR_D1,
  TRAIL_PUDDLE_WET, TRAIL_PUDDLE_LOW, TRAIL_PUDDLE_WAVE, TRAIL_WEAR_WAVE, TRAIL_EDGE_WAVE,
  trailWear,
} from "../../src/game/trailBenchParams.js";

const BED = TRAIL_BED_HALF;
/** Two segments: one along x, one along z, meeting at (100, 0). */
const SEGS: Segment[] = [
  { ax: 0, az: 0, bx: 100, bz: 0, ua: 0, ub: 100, wa: 1, wb: 1 },
  { ax: 100, az: 0, bx: 100, bz: 80, ua: 100, ub: 180, wa: 1, wb: 1 },
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
    const many: Segment[] = Array.from({ length: TRAIL_PAINT_BUCKET_MAX + 1 }, (_, i) => ({ ax: 10, az: i, bx: 20, bz: i, ua: i, ub: i + 10, wa: 1, wb: 1 }));
    const o = buildTrailTable(many);
    expect(o.overflow).toBe(true);
    expect(o.bucketMax).toBe(TRAIL_PAINT_BUCKET_MAX);
    expect(o.list.length).toBe(TRAIL_PAINT_MAX_SEGMENTS * 4 * 2);
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
    expect(trailSegments(g)[3]).toEqual({ ax: 30, az: 0, bx: 40, bz: 0, ua: 30, ub: 40, wa: 1, wb: 1 });
  });
});

describe("the band (the mirror of the fragment shader)", () => {
  const t = buildTrailTable(SEGS);
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

describe("the table's second row", () => {
  // A Y: trailhead 0 → 1 → 2 (degree 3 at 1) with a spur 1 → 3.
  const graph = {
    nodes: [{ x: 0, z: 0, h: 0, u: 0 }, { x: 100, z: 0, h: 0, u: 100 }, { x: 200, z: 0, h: 0, u: 200 }, { x: 100, z: 80, h: 0, u: 180 }],
    edges: [
      { a: 0, b: 1, kind: "stem", profile: new Float64Array(2), progress0: 0, progress1: 0.5 },
      { a: 1, b: 2, kind: "stem", profile: new Float64Array(2), progress0: 0.5, progress1: 1 },
      { a: 1, b: 3, kind: "loop", profile: new Float64Array(2), progress0: 0.5, progress1: 0.5 },
    ],
    trailhead: { x: 0, z: 0, u: 0 }, summit: 2, stem: [0, 1], loops: [], features: [], stemLen: 200, fallbacks: 0,
  } as unknown as TrailGraph;
  it("widens degree-3 nodes and the trailhead, and carries each node's u", () => {
    expect(nodeWidths(graph)).toEqual([TRAIL_JUNCTION_W, TRAIL_JUNCTION_W, 1, 1]);
    const segs = trailSegments(graph);
    expect(segs[0]).toMatchObject({ ua: 0, ub: 100, wa: TRAIL_JUNCTION_W, wb: TRAIL_JUNCTION_W });
    expect(segs[1]).toMatchObject({ ua: 100, ub: 200, wa: TRAIL_JUNCTION_W, wb: 1 });
    expect(segs[2]).toMatchObject({ ua: 100, ub: 180, wa: TRAIL_JUNCTION_W, wb: 1 });
  });
  it("writes row 1 behind row 0 in one buffer, so the texture is 512 by 2", () => {
    const t = buildTrailTable(trailSegments(graph));
    expect(t.list.length).toBe(TRAIL_PAINT_MAX_SEGMENTS * 4 * 2);
    // Past x = 193 (a bucket boundary given this graph's corridor-grown bounding
    // box), only edge 1 → 2 reaches: the corridor growth off edge 0 → 1 stops
    // at x = 107, so a query here lands in a bucket the earlier edge never touches.
    const b = bucketOf(t, 250, 0);
    const s = t.index[b * 4]!;
    const row1 = TRAIL_PAINT_MAX_SEGMENTS * 4;
    expect([t.list[s * 4], t.list[s * 4 + 2]]).toEqual([100, 200]);
    // TRAIL_JUNCTION_W round-trips through the Float32Array list, so the
    // expected value here is its own float32 rounding, not the float64 constant.
    expect([t.list[row1 + s * 4], t.list[row1 + s * 4 + 1], t.list[row1 + s * 4 + 2], t.list[row1 + s * 4 + 3]]).toEqual([100, 200, Math.fround(TRAIL_JUNCTION_W), 1]);
  });
});

describe("the mirror of the band selection", () => {
  const t = buildTrailTable(trailSegments({
    nodes: [{ x: 0, z: 0, h: 0, u: 0 }, { x: 100, z: 0, h: 0, u: 100 }],
    edges: [{ a: 0, b: 1, kind: "stem", profile: new Float64Array(2), progress0: 0, progress1: 1 }],
    trailhead: { x: 0, z: 0, u: 0 }, summit: 1, stem: [0], loops: [], features: [], stemLen: 100, fallbacks: 0,
  } as unknown as TrailGraph));
  it("reads u along the segment and the width factor between its ends", () => {
    const p = trailPaintAt(50, 0, t, { edgeNoise: 0, height: 0.5 });
    expect(p.u).toBeCloseTo(50, 9);
    // wa/wb round-trip through the table's Float32Array, so the expected
    // width factor uses TRAIL_JUNCTION_W's own float32 rounding.
    const wj = Math.fround(TRAIL_JUNCTION_W);
    expect(p.widthK).toBeCloseTo((TRAIL_WEAR_W0 + (TRAIL_WEAR_W1 - TRAIL_WEAR_W0) * trailWear(50)) * (wj + (1 - wj) * 0.5), 9);
  });
  it("is core on the centreline, margin at the bench edge, trampled beyond, ground past 1.35 × width", () => {
    const o = { edgeNoise: 0, height: 0.5 };
    const c = trailPaintAt(50, 0, t, o);
    expect(c.core).toBe(1);
    const k = c.widthK;
    expect(trailPaintAt(50, 0.6 * k, t, o).margin).toBe(1);
    expect(trailPaintAt(50, 1.0 * k, t, o).trample).toBeGreaterThan(0.4);
    const far = trailPaintAt(50, 1.5 * k, t, o);
    expect(far).toMatchObject({ core: 0, margin: 0, trample: 0 });
  });
  it("shifts every boundary by the pebble height and the edge noise", () => {
    const k = trailPaintAt(50, 0, t, { edgeNoise: 0, height: 0.5 }).widthK;
    const d = TRAIL_CORE_HALF * k + 0.02;
    expect(trailPaintAt(50, d, t, { edgeNoise: 0, height: 0.5 }).core).toBeLessThan(1);
    expect(trailPaintAt(50, d, t, { edgeNoise: 0, height: 1.0 }).core).toBe(1);
    expect(trailPaintAt(50, d, t, { edgeNoise: -0.2, height: 0.5 }).core).toBe(1);
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
    expect(TRAIL_FRAGMENT_PAINT).toContain("tPacked, tSnow), tOnBench);");
    expect(TRAIL_FRAGMENT_PAINT).toContain("float tGravel = tOnBench * (1.0 - tSnow);");
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
});

describe("the GLSL", () => {
  it("prints the mirror's constants, reads row 1 once for the best segment, and carries every term", () => {
    const g = TRAIL_FRAGMENT_PAINT;
    for (const v of [TRAIL_CORE_HALF, TRAIL_MARGIN_HALF, TRAIL_TRAMPLE_HALF, TRAIL_PAINT_EDGE, TRAIL_CORE_GAIN, TRAIL_MARGIN_GAIN, TRAIL_WET_DARK, TRAIL_WET_GLOSS, TRAIL_HEIGHT_SHIFT, TRAIL_EDGE_NOISE, TRAIL_WEAR_W0, TRAIL_WEAR_W1, TRAIL_WEAR_D0, TRAIL_WEAR_D1, TRAIL_PUDDLE_WAVE, ...TRAIL_WEAR_WAVE, ...TRAIL_EDGE_WAVE, ...TRAIL_PUDDLE_WET, ...TRAIL_PUDDLE_LOW]) {
      expect(g).toContain(Number.isInteger(v) ? v.toFixed(1) : String(v));
    }
    for (const c of [TRAIL_CORE_TINT, TRAIL_MARGIN_TINT, TRAIL_TRAMPLE_TINT]) expect(g).toContain(`vec3(${c.r}, ${c.g}, ${c.b})`);
    expect(g).toContain("texture2D(trailSegs, vec2(tu, 0.25))");
    expect(g.split("texture2D(trailSegs, vec2(tuBest, 0.75))").length).toBe(2);
    for (const term of ["trailValueNoise1(", "macroValueNoise(", "terrainWet", "tPuddle", "tLip", "tWidthK", "tDarkK", "tdN"]) expect(g).toContain(term);
    expect(g).not.toContain("TRAIL_DIRT_TINT");
    expect(g.indexOf("fwidth(tdBest)")).toBeLessThan(g.indexOf("if (tdBest <"));
  });
});
