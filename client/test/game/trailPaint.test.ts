import { describe, expect, it } from "vitest";
import {
  TRAIL_PAINT_BUCKET, TRAIL_PAINT_BUCKET_MAX, TRAIL_PAINT_MAX_SEGMENTS, TRAIL_PAINT_GRID,
  TRAIL_PAINT_INDEX_ROW, TRAIL_PAINT_TABLE_ROWS,
  TRAIL_PAINT_EDGE, TRAIL_BANK_SLOPE,
  trailSegments, buildTrailTable, bucketOf, bucketTexel, trailNearest, trailBand, bankRise, trailBankBand,
  nodeWidths, trailPaintAt,
  type Segment,
} from "@csarkosh/engine/game/trailPaint";
import { TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, type TrailGraph } from "@csarkosh/engine/sim/trail";
import { homeDistances, forksOf } from "@csarkosh/engine/sim/trailRoute";
import {
  TRAIL_JUNCTION_W, TRAIL_CORE_HALF,
  TRAIL_CORE_GAIN, TRAIL_MARGIN_GAIN, TRAIL_BENCH_SHADE,
  TRAIL_WEAR_W0, TRAIL_WEAR_W1,
  TRAIL_BED_EARTH,
  TRAIL_WASH_DARK_OPEN, TRAIL_WASH_DARK_LITTER, TRAIL_BED_FLOOR,
  trailWear, trailEdgeNoise, trailPatches,
} from "@csarkosh/engine/game/trailBenchParams";

const BED = TRAIL_BED_HALF;
/** Two segments: one along x, one along z, meeting at (100, 0). */
const SEGS: Segment[] = [
  { ax: 0, az: 0, bx: 100, bz: 0, ua: 0, ub: 100, wa: 1, wb: 1 },
  { ax: 100, az: 0, bx: 100, bz: 80, ua: 100, ub: 180, wa: 1, wb: 1 },
];

describe("the bucketed segment table", () => {
  const t = buildTrailTable(SEGS);
  it("is one texture, 512 wide by 18 high: the list's two rows, then the grid's sixteen", () => {
    expect(TRAIL_PAINT_MAX_SEGMENTS).toBe(512);
    expect(TRAIL_PAINT_GRID).toBe(16);
    expect(TRAIL_PAINT_INDEX_ROW).toBe(2);
    expect(TRAIL_PAINT_TABLE_ROWS).toBe(18);
    // 512 × 18 texels of RGBA.
    expect(t.data.length).toBe(36864);
    // A row is 512 × 4 floats: bucket (x, z) sits on texture row 2 + z, column x.
    expect(bucketTexel(0)).toBe(4096);
    expect(bucketTexel(1)).toBe(4100);
    expect(bucketTexel(16)).toBe(6144);
    expect(bucketTexel(16 * 3 + 5)).toBe(10260);
    expect(bucketTexel(255)).toBe(34876);
    // Past the grid's sixteen columns, every grid row is zero.
    for (let row = 2; row < 18; row++) {
      expect(t.data.subarray(row * 2048 + 64, (row + 1) * 2048).every((v) => v === 0), `row ${row}`).toBe(true);
    }
  });
  it("leaves an empty ring of buckets around the segments' bounding box", () => {
    // One bucket (100 m) and the corridor's half-width (7 m) before the first segment.
    expect(TRAIL_PAINT_BUCKET).toBe(100);
    expect(t.x0).toBe(-107);
    expect(t.z0).toBe(-107);
    expect(t.overflow).toBe(false);
    // The bucket seaward of the first segment (in the ring) is empty: bucket
    // (0, 0), the first texel of texture row 2.
    const ring = bucketOf(t, t.x0 + 1, t.z0 + 1);
    expect(ring).toBe(0);
    expect(t.data[4096 + 1]).toBe(0);
  });
  it("lists a segment in every bucket its corridor-grown box touches, and only those", () => {
    // Segment 0 spans x ∈ [−7, 107] after growing: buckets 1 and 2 of grid
    // row 1 (texture row 3), the ring's column 0 untouched.
    const b1 = bucketOf(t, 50, 0), b2 = bucketOf(t, 101, 0);
    expect([b1, b2]).toEqual([17, 18]);
    expect([bucketTexel(b1), bucketTexel(b2)]).toEqual([6148, 6152]);
    expect(t.data[6148 + 1]).toBe(1);
    expect(t.data[6152 + 1]).toBe(2); // both segments meet here
    const far = bucketOf(t, 50, 300);
    expect(far).toBe(65);
    expect(t.data[12292 + 1]).toBe(0);
    // The list entries, on texture row 0, are the segments themselves.
    const s0 = t.data[6148]!;
    expect(s0).toBe(0);
    expect([t.data[s0 * 4], t.data[s0 * 4 + 1], t.data[s0 * 4 + 2], t.data[s0 * 4 + 3]]).toEqual([0, 0, 100, 0]);
    // The grid's counts add up to the entries written.
    let counted = 0;
    for (let b = 0; b < 256; b++) counted += t.data[bucketTexel(b) + 1]!;
    expect(counted).toBe(t.count);
    expect(t.count).toBe(3);
  });
  it("reports bucketMax and flags an overflow instead of overrunning", () => {
    expect(t.bucketMax).toBe(2);
    const many: Segment[] = Array.from({ length: TRAIL_PAINT_BUCKET_MAX + 1 }, (_, i) => ({ ax: 10, az: i, bx: 20, bz: i, ua: i, ub: i + 10, wa: 1, wb: 1 }));
    const o = buildTrailTable(many);
    expect(o.overflow).toBe(true);
    expect(o.bucketMax).toBe(32);
    expect(o.data.length).toBe(36864);
  });
  it("bucketOf clamps to the ring outside the box, so a far fragment reads an empty bucket", () => {
    const b = bucketOf(t, -5000, 9000);
    expect(b).toBe(240);
    expect(bucketTexel(b)).toBe(34816);
    expect(t.data[34816 + 1]).toBe(0);
  });
  it("builds an empty table from an empty graph: the box at the origin, every texel zero", () => {
    const empty = buildTrailTable([]);
    expect(empty.x0).toBe(-107);
    expect(empty.z0).toBe(-107);
    expect(empty.overflow).toBe(false);
    expect(empty.count).toBe(0);
    expect(empty.bucketMax).toBe(0);
    expect(empty.data.length).toBe(36864);
    expect(empty.data.every((v) => v === 0)).toBe(true);
  });
  it("takes every edge of a graph, uncapped", () => {
    // u is garbage on every node: the paint reads arc length, computed from
    // the stem walk, never the route builder's road-relative u.
    const nodes = Array.from({ length: 70 }, (_, i) => ({ x: i * 10, z: 0, h: i * 2, u: 999 }));
    const edges = nodes.slice(1).map((_, i) => ({
      a: i, b: i + 1, kind: "stem" as const, profile: new Float64Array([i * 2, i * 2 + 2]), progress0: i / 69, progress1: (i + 1) / 69,
    }));
    const g: TrailGraph = {
      nodes, edges, trailhead: { x: 0, z: 0, u: 0 }, summit: 69, stem: edges.map((_, i) => i), loops: [], features: [], stemLen: 690, fallbacks: 0,
      forks: forksOf(nodes.length, edges), homeDist: homeDistances(nodes, edges), shortestHome: 690,
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
  it("is symmetric across the centreline, on a single straight edge", () => {
    const single = buildTrailTable([SEGS[0]!]);
    for (const d of [0.2, 0.75, 0.9, 1.5]) {
      expect(trailBand(50, d, single)).toBeCloseTo(trailBand(50, -d, single), 12);
    }
  });
});

describe("the table's second row", () => {
  // A Y whose spur closes into a loop: trailhead 0 → 1 → 2 (degree 3 at 1),
  // with a meadow loop 1 → 3 → 4 → 2 rejoining the stem at 2. u is garbage on
  // every node — the paint reads arc length, never the route builder's u.
  const graph = {
    nodes: [
      { x: 0, z: 0, h: 0, u: 999 }, { x: 100, z: 0, h: 0, u: 999 }, { x: 200, z: 0, h: 0, u: 999 },
      { x: 100, z: 80, h: 0, u: 999 }, { x: 200, z: 80, h: 0, u: 999 },
    ],
    edges: [
      { a: 0, b: 1, kind: "stem", profile: new Float64Array(2), progress0: 0, progress1: 0.5 },
      { a: 1, b: 2, kind: "stem", profile: new Float64Array(2), progress0: 0.5, progress1: 1 },
      { a: 1, b: 3, kind: "loop", profile: new Float64Array(2), progress0: 0.5, progress1: 0.5 },
      { a: 3, b: 4, kind: "loop", profile: new Float64Array(2), progress0: 0.5, progress1: 0.5 },
      { a: 4, b: 2, kind: "loop", profile: new Float64Array(2), progress0: 0.5, progress1: 0.5 },
    ],
    trailhead: { x: 0, z: 0, u: 0 }, summit: 2, stem: [0, 1],
    loops: [{ kind: "meadow", featureId: 0, edges: [2, 3, 4], junctionA: 1, junctionB: 2 }],
    features: [], stemLen: 200, fallbacks: 0,
  } as unknown as TrailGraph;
  it("widens degree-3 nodes and the trailhead, and carries each edge's arc length", () => {
    expect(nodeWidths(graph)).toEqual([TRAIL_JUNCTION_W, TRAIL_JUNCTION_W, 1, 1, 1]);
    const segs = trailSegments(graph);
    expect(segs[0]).toMatchObject({ ua: 0, ub: 100, wa: TRAIL_JUNCTION_W, wb: TRAIL_JUNCTION_W });
    // The stem's own edge into the summit keeps ub = 200 — the loop rejoins
    // it without disturbing the stem's own arc length.
    expect(segs[1]).toMatchObject({ ua: 100, ub: 200, wa: TRAIL_JUNCTION_W, wb: 1 });
    // The loop: junctionA (node 1, arc 100) → node 3 (+80) → node 4 (+100) →
    // junctionB (node 2, +80 = 360) — one seam, at node 2, where the loop's
    // own arc (360) meets the stem's (200).
    expect(segs[2]).toMatchObject({ ua: 100, ub: 180, wa: TRAIL_JUNCTION_W, wb: 1 });
    expect(segs[3]).toMatchObject({ ua: 180 });
    expect(segs[4]).toMatchObject({ ub: 360 });
  });
  it("never leaves an edge unwalked", () => {
    for (const s of trailSegments(graph)) expect(s.ua !== 0 || s.ub !== 0).toBe(true);
  });
  it("writes row 1 behind row 0 in the one buffer the grid follows, so the texture is 512 by 18", () => {
    const t = buildTrailTable(trailSegments(graph));
    expect(t.data.length).toBe(36864);
    // Past x = 193 (a bucket boundary given this graph's corridor-grown bounding
    // box), only edge 1 → 2 reaches: the corridor growth off edge 0 → 1 stops
    // at x = 107, so a query here lands in a bucket the earlier edge never touches.
    const b = bucketOf(t, 250, 0);
    const s = t.data[bucketTexel(b)]!;
    const row1 = 2048;
    expect([t.data[s * 4], t.data[s * 4 + 2]]).toEqual([100, 200]);
    // TRAIL_JUNCTION_W round-trips through the Float32Array, so the
    // expected value here is its own float32 rounding, not the float64 constant.
    expect([t.data[row1 + s * 4], t.data[row1 + s * 4 + 1], t.data[row1 + s * 4 + 2], t.data[row1 + s * 4 + 3]]).toEqual([100, 200, Math.fround(TRAIL_JUNCTION_W), 1]);
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
  it("defaults opts to the shader's own edge noise and a level pebble", () => {
    for (const [x, z] of [[50, 0], [30, 0.3]] as const) {
      expect(trailPaintAt(x, z, t)).toEqual(trailPaintAt(x, z, t, { edgeNoise: trailEdgeNoise(x, z), height: 0.5 }));
    }
  });
  it("leaves the core band's own weight above its floor along 300 centreline points, and untouched by the drift patch", () => {
    // The centreline test above pins core to 1 there; that pinned value is
    // the floor the design's "the path reads" gate implies — a painted drift
    // darkens the bed's colour but must never erase the core's own weight.
    const CORE_FLOOR = 1;
    const opts = { edgeNoise: 0, height: 0.5 };
    for (let i = 0; i < 300; i++) {
      const x = 1 + (i / 299) * 98; // stays on the single stem edge, off both ends
      const before = trailPaintAt(x, 0, t, opts).core;
      expect(before).toBeGreaterThanOrEqual(CORE_FLOOR);
      // trailPatches takes duff as an explicit input; trailPaintAt does not.
      // Feeding it full duff (the strongest possible drift) must leave the
      // core mirror's next read bit-for-bit identical — the assertion a
      // future edit routing a patch into the band weight would fail.
      trailPatches(1, x, 0);
      const after = trailPaintAt(x, 0, t, opts).core;
      expect(after).toBe(before);
    }
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
  });
});

describe("the bed's constants", () => {
  it("lays the bed as earth, seven tenths of the forest floor over the pebbles, at the gains and the shade its brightness was set by", () => {
    // The bed is the forest-floor texture at TRAIL_BED_EARTH over the pebble
    // texture, so the trail is packed earth with grit in it rather than a
    // pale gravel band.
    expect(TRAIL_BED_EARTH).toBe(0.7);
    // The bed's brightness: gains down to where the bed / beside ratio
    // lands in 0.9–1.3, and the bed takes 80 % of the bank's shade.
    expect(TRAIL_CORE_GAIN).toBe(0.24);
    expect(TRAIL_MARGIN_GAIN).toBe(0.47);
    expect(TRAIL_BENCH_SHADE).toBe(0.8);
  });

  it("lifts the bed toward the litter floor under the canopy, and darkens a wash-out by the canopy it lies under", () => {
    expect(TRAIL_BED_FLOOR).toBe(0.75);
    // Bare earth in the open, the litter floor's earth under the trees.
    expect(TRAIL_WASH_DARK_OPEN).toBe(0.4);
    expect(TRAIL_WASH_DARK_LITTER).toBe(0.75);
  });
});
