import { describe, expect, it } from "vitest";
import {
  TRAIL_PAINT_BUCKET, TRAIL_PAINT_BUCKET_MAX, TRAIL_PAINT_MAX_SEGMENTS, TRAIL_PAINT_GRID,
  TRAIL_PAINT_EDGE, TRAIL_BANK_SLOPE,
  trailSegments, buildTrailTable, bucketOf, trailNearest, trailBand, bankRise, trailBankBand,
  nodeWidths, trailPaintAt, glslFloat,
  TRAIL_FRAGMENT_DEFS, TRAIL_FRAGMENT_PAINT,
  type Segment,
} from "../../src/game/trailPaint.js";
import { TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, type TrailGraph } from "../../src/sim/trail.js";
import { homeDistances, forksOf } from "../../src/sim/trailRoute.js";
import {
  TRAIL_JUNCTION_W, TRAIL_CORE_HALF, TRAIL_MARGIN_HALF, TRAIL_TRAMPLE_HALF,
  TRAIL_CORE_TINT, TRAIL_MARGIN_TINT, TRAIL_TRAMPLE_TINT, TRAIL_CORE_GAIN, TRAIL_MARGIN_GAIN, TRAIL_BENCH_SHADE,
  TRAIL_WET_DARK, TRAIL_WET_GLOSS, TRAIL_HEIGHT_SHIFT, TRAIL_EDGE_NOISE,
  TRAIL_WEAR_W0, TRAIL_WEAR_W1, TRAIL_WEAR_D0, TRAIL_WEAR_D1,
  TRAIL_PUDDLE_WET, TRAIL_PUDDLE_LOW, TRAIL_PUDDLE_WAVE, TRAIL_WEAR_WAVE, TRAIL_EDGE_WAVE,
  TRAIL_DRIFT_BAND, TRAIL_WASH_WAVE, TRAIL_WASH_BAND, TRAIL_WASH_ROUGH, TRAIL_BED_EARTH, TRAIL_WASH_DARK,
  trailWear, trailEdgeNoise, trailPatches,
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
    // The gate that actually carries tGravel into the normal and roughness mixes.
    expect(TRAIL_FRAGMENT_PAINT).toContain("mix(tLipN, tBenchN, tGravel * tk)");
    expect(TRAIL_FRAGMENT_PAINT).toContain("mix(terrainRough, tRoughBench, tGravel)");
  });
});

describe("the neglect patches", () => {
  it("paints drifts from the vertex's duff and wash-outs from its own noise, and keeps the core readable", () => {
    expect(TRAIL_FRAGMENT_PAINT).toContain(`float tDrift = smoothstep(${glslFloat(TRAIL_DRIFT_BAND[0])}, ${glslFloat(TRAIL_DRIFT_BAND[1])}, clamp(vTerrainW2.z, 0.0, 1.0));`);
    expect(TRAIL_FRAGMENT_PAINT).toContain(`float tWash = smoothstep(${glslFloat(TRAIL_WASH_BAND[0])}, ${glslFloat(TRAIL_WASH_BAND[1])}, macroValueNoise(vPositionW.xz, ${glslFloat(TRAIL_WASH_WAVE)}));`);
    expect(TRAIL_FRAGMENT_PAINT).toContain("tDrift *= 1.0 - tWash;");
    expect(TRAIL_FRAGMENT_PAINT).toContain(`* ${glslFloat(TRAIL_CORE_GAIN)} *`);
    // The patches tint and re-normal the bench but never zero the band weights:
    // tOnBench and tInCore are formed before the patches and are not multiplied by them.
    const onBench = TRAIL_FRAGMENT_PAINT.split("\n").find((l) => l.includes("float tOnBench = "))!;
    expect(onBench).not.toContain("tDrift"); expect(onBench).not.toContain("tWash");
  });

  it("keeps the drift and wash-out paint, normal and roughness folds in the shader", () => {
    expect(TRAIL_FRAGMENT_PAINT).toContain("tCoreCol = mix(mix(tCoreCol, tDriftCol, tDrift), tWashCol, tWash);");
    expect(TRAIL_FRAGMENT_PAINT).toContain("tMarginCol = mix(mix(tMarginCol, tDriftCol, tDrift), tWashCol, tWash);");
    expect(TRAIL_FRAGMENT_PAINT).toContain("vec3 tBenchN = normalize(normalW + vec3(tGravelN.x, 0.0, tGravelN.y) * mix(1.0, 0.5, tInCore) * (1.0 - tDrift) * (1.0 - tWash) + vec3(tFloorN.x, 0.0, tFloorN.y) * tDrift);");
    expect(TRAIL_FRAGMENT_PAINT).toContain("tRoughBench = mix(tRoughBench, clamp(terrainLayerRough.y * mix(1.0, tFloorRAH.r / 0.5, tk), 0.0, 1.0), tDrift);");
    expect(TRAIL_FRAGMENT_PAINT).toContain(`tRoughBench = mix(tRoughBench, clamp(tRoughBench * ${glslFloat(TRAIL_WASH_ROUGH)}, 0.0, 1.0), tWash);`);
  });

  it("lays the bed as earth: the floor texture over the pebbles, and the bed wears the bank's shade", () => {
    // The bed texture is the forest-floor texture at TRAIL_BED_EARTH over
    // the pebble texture, so the trail is packed earth with grit in it
    // rather than a pale gravel band. Both textures were already sampled
    // for the bank and the drifts; this is one mix, inside the trail only.
    expect(TRAIL_BED_EARTH).toBe(0.7);
    expect(TRAIL_FRAGMENT_PAINT).toContain("vec3 tBedTex = mix(tGravelTex, tFloorTex, 0.7);");
    // The core and margin colours are built on the earth, not the gravel.
    const core = TRAIL_FRAGMENT_PAINT.match(/vec3 tCoreCol = [^\n]*/)![0];
    const margin = TRAIL_FRAGMENT_PAINT.match(/vec3 tMarginCol = [^\n]*/)![0];
    expect(core).toContain("* tBedTex *");
    expect(margin).toContain("* tBedTex *");
    expect(core).not.toContain("tGravelTex");
    expect(margin).not.toContain("tGravelTex");
    // The bed's brightness: gains down to where the bed / beside ratio
    // lands in 0.9–1.3, and the bed takes 80 % of the bank's shade.
    expect(TRAIL_CORE_GAIN).toBe(0.32);
    expect(TRAIL_MARGIN_GAIN).toBe(0.55);
    expect(TRAIL_BENCH_SHADE).toBe(0.8);
    expect(TRAIL_WASH_DARK).toBe(0.55);
    expect(TRAIL_FRAGMENT_PAINT).toContain(`vec3 tBenchBase = mix(vec3(1.0), tBankBase, ${glslFloat(0.8)});`);
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
    for (const v of [TRAIL_CORE_HALF, TRAIL_MARGIN_HALF, TRAIL_TRAMPLE_HALF, TRAIL_PAINT_EDGE, TRAIL_CORE_GAIN, TRAIL_MARGIN_GAIN, TRAIL_BENCH_SHADE, TRAIL_BED_EARTH, TRAIL_WET_DARK, TRAIL_WET_GLOSS, TRAIL_HEIGHT_SHIFT, TRAIL_EDGE_NOISE, TRAIL_WEAR_W0, TRAIL_WEAR_W1, TRAIL_WEAR_D0, TRAIL_WEAR_D1, TRAIL_PUDDLE_WAVE, ...TRAIL_WEAR_WAVE, ...TRAIL_EDGE_WAVE, ...TRAIL_PUDDLE_WET, ...TRAIL_PUDDLE_LOW]) {
      expect(g).toContain(glslFloat(v));
    }
    for (const c of [TRAIL_CORE_TINT, TRAIL_MARGIN_TINT, TRAIL_TRAMPLE_TINT]) expect(g).toContain(`vec3(${c.r}, ${c.g}, ${c.b})`);
    // The wave literals above collide across terms (0.4, 12.0, 3.0, 6.0 each
    // print once but feed several calls), so pin each call shape too.
    expect(g).toContain("macroValueNoise(vPositionW.xz, 1.5)");
    expect(g).toContain("macroValueNoise(vPositionW.xz, 0.4)");
    expect(g).toContain("trailValueNoise1(tU, 12.0)");
    expect(g).toContain("trailValueNoise1(tU, 3.0)");
    expect(g).toContain("macroValueNoise(vPositionW.xz, 6.0)");
    expect(g).toContain("mix(vec3(1.0), tBankBase, 0.8)");
    expect(g).toContain("texture2D(trailSegs, vec2(tu, 0.25))");
    expect(g.split("texture2D(trailSegs, vec2(tuBest, 0.75))").length).toBe(2);
    for (const term of ["trailValueNoise1(", "macroValueNoise(", "terrainWet", "tPuddle", "tLip", "tWidthK", "tDarkK", "tdN"]) expect(g).toContain(term);
    expect(g.indexOf("fwidth(tdBest)")).toBeLessThan(g.indexOf("if (tdBest <"));
  });
});
