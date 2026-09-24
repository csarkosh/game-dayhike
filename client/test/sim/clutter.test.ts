import { describe, expect, it } from "vitest";
import "../../src/sim/olympic.js";
import {
  CLUTTER_BOULDER, CLUTTER_BUSH, CLUTTER_DRIFTWOOD, CLUTTER_FUNGUS, CLUTTER_GRASS, CLUTTER_ROCK,
  CLUTTER_MEADOW, CLUTTER_FLOWER, CLUTTER_LITTER,
  grassTrailGate, CLUTTER_GRASS_TRAIL_NEAR, CLUTTER_GRASS_TRAIL_FAR,
  CLUTTER_LITTER_CORE, CLUTTER_LITTER_FADE, CLUTTER_LITTER_CELL, CLUTTER_LITTER_D, litterBand,
  CLUTTER_CLASS_COUNT,
  CLUTTER_GRASS_ALT_LO, CLUTTER_GRASS_ALT_LO_FADE,
  CLUTTER_GRASS_ALT_HI, CLUTTER_GRASS_ALT_HI_FADE,
  CLUTTER_GRASS_SLOPE_LO, CLUTTER_GRASS_SLOPE_HI,
  CLUTTER_GRASS_CANOPY_LO, CLUTTER_GRASS_CANOPY_HI,
  CLUTTER_GRASS_ROAD_FAR,
  CLUTTER_GRASS_CELL,
  groundCover, trailReach, grassTrailRamp, trailDriftNoise,
  CLUTTER_GRASS_CANOPY_FLOOR, CLUTTER_GRASS_PATCH_FLOOR, CLUTTER_GRASS_BOOST, CLUTTER_GRASS_BOOST_LO,
  CLUTTER_DUFF_OPEN, CLUTTER_DUFF_ROAD_CLEAR,
  CLUTTER_GRASS_TRAIL_CORE, CLUTTER_GRASS_TRAIL_REACH, CLUTTER_GRASS_TRAIL_REACH_WAVE,
  CLUTTER_DUFF_BED_MAX, CLUTTER_DUFF_BED_FADE, CLUTTER_DUFF_DRIFT_WAVE, CLUTTER_DUFF_DRIFT_BAND, CLUTTER_DUFF_DRIFT_LO,
  CLUTTER_BOULDER_SCALE_MIN, CLUTTER_BOULDER_SCALE_MAX, CLUTTER_BOULDER_ROAD_NEAR, CLUTTER_BOULDER_CELL,
  CLUTTER_ROCK_SCALE_MIN, CLUTTER_ROCK_SCALE_MAX, CLUTTER_ROCK_ROAD_NEAR, CLUTTER_ROCK_CELL,
  CLUTTER_GRASS_SCALE_MIN, CLUTTER_GRASS_SCALE_MAX,
  CLUTTER_DRIFT_SCALE_MIN, CLUTTER_DRIFT_SCALE_MAX,
  CLUTTER_DRIFT_ALT_HI, CLUTTER_DRIFT_ALT_HI_FADE, CLUTTER_DRIFT_CELL,
  CLUTTER_BUSH_SCALE_MIN, CLUTTER_BUSH_SCALE_MAX,
  CLUTTER_BUSH_ALT_LO, CLUTTER_BUSH_CELL, CLUTTER_BUSH_ROAD_NEAR,
  CLUTTER_BUSH_PATCH_WAVELENGTH, CLUTTER_BUSH_PATCH_OCTAVES, CLUTTER_PATCH_SALT,
  CLUTTER_MEADOW_SCALE_MIN, CLUTTER_MEADOW_SCALE_MAX,
  CLUTTER_FLOWER_SCALE_MIN, CLUTTER_FLOWER_SCALE_MAX,
  CLUTTER_JITTER,
  CLUTTER_TUNABLES,
  CLUTTER_FUNGUS_TRAIL_CLEAR, CLUTTER_FUNGUS_SLOPE_LO, CLUTTER_FUNGUS_SLOPE_HI,
  clutterCell, clutterDensity, clutterInCell, clutterInRect,
} from "../../src/sim/clutter.js";
import { SLOPE_HI, SLOPE_LO } from "../../src/sim/vegetation.js";
import { TRAIL_BED_HALF } from "../../src/sim/trail.js";
import { TRAIL_WEAR_W1, TRAIL_JUNCTION_W } from "../../src/game/trailBenchParams.js";
import { fbm2 } from "../../src/sim/field.js";
import { forestDensity } from "../../src/sim/vegetation.js";
import { ROAD_BED_HALF } from "../../src/sim/road.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { variantOrThrow, DERIV_SEED } from "./helpers/derivatives.js";
import { centerlineX } from "./helpers/roadLine.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, type TerrainSample } from "../../src/sim/terrain.js";
import { MEADOW_RIM } from "../../src/sim/features.js";

const SEED = DERIV_SEED; // 0x5eed — the roadLine/derivatives helpers are bound to it

describe("clutter density gates", () => {
  const flat = (h: number) => ({ h, dx: 0.01, dz: -0.02 });
  const steep = (h: number) => ({ h, dx: 0.9, dz: 0.4 });

  it("grows no grass below the sand fade or on steep ground", () => {
    for (let i = 0; i < 40; i++) {
      const x = 500 + i * 311.7;
      const z = i * -173.9;
      expect(clutterDensity(SEED, CLUTTER_GRASS, x, z, flat(CLUTTER_GRASS_ALT_LO - 1))).toBe(0);
      expect(clutterDensity(SEED, CLUTTER_GRASS, x, z, steep(60))).toBe(0);
    }
  });

  it("keeps every class off the road bed", () => {
    // Olympic's roadDistance is 0 on the centerline; sample points ON it.
    const v = variantOrThrow("olympic");
    for (const z of [-2000.5, 0.5, 3000.5]) {
      // centerlineX-free: walk x until roadDistance < 1 (the bed's middle).
      let cx = -300;
      let best = Infinity;
      for (let x = -700; x < 100; x += 2) {
        const d = v.roadDistance!(SEED, x, z);
        if (d < best) { best = d; cx = x; }
      }
      expect(best).toBeLessThan(2);
      for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
        expect(clutterDensity(SEED, cls, cx, z)).toBe(0);
      }
    }
  });

  it("keeps grass, meadow and flowers off the trail bed, and lets them back past the bank", () => {
    // The gate's shape, pure.
    expect(grassTrailGate(0)).toBe(0);
    expect(grassTrailGate(CLUTTER_GRASS_TRAIL_NEAR)).toBe(0);
    expect(grassTrailGate(CLUTTER_GRASS_TRAIL_FAR)).toBe(1);
    expect(grassTrailGate(Infinity)).toBe(1); // outside the bowl, and variants without a trail
    // Midway between the retuned NEAR (0.75) and FAR (2.5).
    expect(grassTrailGate(1.5)).toBeGreaterThan(0);
    expect(grassTrailGate(1.5)).toBeLessThan(1);
    // On the real graph: every class that shares the grass gate is 0 on the bed
    // of every edge, at the midpoint and at both quarter points.
    const v = variantOrThrow("olympic");
    const { graph } = bowlFor(SEED);
    for (const e of graph.edges) {
      const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
      for (const t of [0.25, 0.5, 0.75]) {
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        expect(v.trailDistance!(SEED, x, z)).toBeLessThan(1e-6);
        for (const cls of [CLUTTER_GRASS, CLUTTER_MEADOW, CLUTTER_FLOWER]) {
          expect(clutterDensity(SEED, cls, x, z), `${e.a}->${e.b} t=${t} cls=${cls}`).toBe(0);
        }
      }
    }
  });

  it("keeps fungus — the stump and the mushroom cluster — off the trail bed at the jittered instance", () => {
    // A stump standing in the gravel turned up on 2026-09-10. The
    // fungus cell is 6 m and jitter carries an instance up to
    // √2·(JITTER/2)·CELL ≈ 2.97 m off its centre, so a centre-evaluated gate
    // cannot keep the bed clear; the INSTANCE is rejected at its own position,
    // the way treeInCell rejects a tree. The floor is the widest the painted
    // bench itself gets — the bed half-width at full wear and a junction —
    // plus the largest stump's half-width (0.28 × 1.3) and a step of clear ground.
    expect(CLUTTER_FUNGUS_TRAIL_CLEAR).toBeGreaterThanOrEqual(TRAIL_BED_HALF * TRAIL_WEAR_W1 * TRAIL_JUNCTION_W + 0.28 * 1.3 + 0.5);
    const v = variantOrThrow("olympic");
    const { graph } = bowlFor(SEED);
    let seen = 0, near = 0;
    for (const e of graph.edges) {
      const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
      const minX = Math.min(a.x, b.x) - 8, maxX = Math.max(a.x, b.x) + 8;
      const minZ = Math.min(a.z, b.z) - 8, maxZ = Math.max(a.z, b.z) + 8;
      for (const f of clutterInRect(SEED, CLUTTER_FUNGUS, minX, minZ, maxX, maxZ)) {
        seen++;
        const d = v.trailDistance!(SEED, f.x, f.z);
        if (d < 8) near++;
        expect(d, `${e.a}->${e.b} fungus at (${f.x.toFixed(1)}, ${f.z.toFixed(1)})`).toBeGreaterThanOrEqual(CLUTTER_FUNGUS_TRAIL_CLEAR);
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(0); // the gate clears the bed, not the forest beside it
  });

  it("keeps fungus off ground the forest itself has given up: the trees' slope gate", () => {
    // Stumps and mushrooms are forest floor; a slope steep enough that no tree
    // stands on it (SLOPE_HI, sim/vegetation.ts) is rock, and the ground now
    // paints it as rock. Before 2026-09-10 fungus had no slope gate at all
    // and 18% of it stood on cobbles on a measured seed.
    // h 60: forest altitude (the canopy gate is what admits fungus at all).
    const steep = { h: 60, dx: SLOPE_HI, dz: 0 };
    const gentle = { h: 60, dx: 0.2, dz: 0 };
    let anyGentle = 0;
    for (let i = 0; i < 40; i++) {
      const x = i * 137.3, z = i * -91.7;
      expect(clutterDensity(SEED, CLUTTER_FUNGUS, x, z, steep), `steep at ${x},${z}`).toBe(0);
      anyGentle += clutterDensity(SEED, CLUTTER_FUNGUS, x, z, gentle);
    }
    expect(anyGentle).toBeGreaterThan(0); // the gate is slope, not the sample's altitude
    expect(CLUTTER_FUNGUS_SLOPE_LO).toBe(SLOPE_LO);
    expect(CLUTTER_FUNGUS_SLOPE_HI).toBe(SLOPE_HI);
  });

  it("keeps driftwood out of the interior", () => {
    // 2 km inland the coast gate is saturated shut whatever the altitude.
    for (let i = 0; i < 40; i++) {
      expect(clutterDensity(SEED, CLUTTER_DRIFTWOOD, 2000 + i * 97.3, i * 211.1, { h: 3, dx: 0, dz: 0 })).toBe(0);
    }
  });

  it("gates fungus on canopy: bare where the forest is bare", () => {
    // h = 250 is above TREELINE_HI (240): forestDensity is 0, so fungus is 0.
    for (let i = 0; i < 40; i++) {
      expect(clutterDensity(SEED, CLUTTER_FUNGUS, i * 137.3, i * -91.7, flat(250))).toBe(0);
    }
  });

  it("stays in [0, 1] for every class across a broad sweep, except the ground-cover boost", () => {
    // Grass, meadow and flower read the ground-cover field's `grass`, which
    // the interior boost carries up to CLUTTER_GRASS_BOOST — every other
    // class stays a gate product, so it never leaves [0, 1]. Meadow and
    // flower can climb further still, up to roughly 2 · CLUTTER_GRASS_BOOST
    // inside a made meadow's flat (the `(1 + fm.meadow)` term); none of this
    // sweep's points land in one, so CLUTTER_GRASS_BOOST is what these
    // specific points measure, not a hard ceiling on the two classes.
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const boosted = cls === CLUTTER_GRASS || cls === CLUTTER_MEADOW || cls === CLUTTER_FLOWER;
      for (let i = 0; i < 200; i++) {
        const d = clutterDensity(SEED, cls, i * 173.3 - 8000, i * 311.9 - 12000);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(boosted ? CLUTTER_GRASS_BOOST : 1);
      }
    }
  });
});

describe("bush density gates", () => {
  const flat = (h: number) => ({ h, dx: 0.01, dz: -0.02 });
  const steep = (h: number) => ({ h, dx: 0.9, dz: 0.4 });

  it("keeps bushes off the beach, the road bed, and steep ground", () => {
    // Below the sand fade.
    expect(clutterDensity(SEED, CLUTTER_BUSH, 300.5, 40.5, flat(CLUTTER_BUSH_ALT_LO - 1))).toBe(0);
    // On the road bed (olympic centerline, like the road-bed test above).
    expect(clutterDensity(SEED, CLUTTER_BUSH, centerlineX(1000.5), 1000.5)).toBe(0);
    // Past the slope cap: steep()'s fixed (dx, dz) give slopeSq ≈ 0.97, past
    // SLOPE_HI² (0.49).
    expect(clutterDensity(SEED, CLUTTER_BUSH, 300.5, 40.5, steep(40))).toBe(0);
  });

  it("is nonzero in the open field, peaks at the forest edge, stays high under canopy", () => {
    // Pure-habitat probe points (measured by scanning gentle, low, road-far
    // ground: h in [15, 150], slopeSq < 0.05, roadDistance > 40, stepping
    // x/z across a wide span with SEED = DERIV_SEED):
    //   open:   x=20695.7,  z=8835.3   -> rho=0,      d=0.1
    //   edge:   x=9121.8,   z=-7527.8  -> rho=0.2517  (in [0.10, 0.40]), d=1
    //   canopy: x=601.6,    z=-19573.6 -> rho=1        (> 0.7),          d≈0.9295
    // All three sit on gentle, low ground far from the road (roadDistance
    // well past ROAD_FAR), so only the habitat term varies between them.
    const open = { x: 20695.7, z: 8835.3 };
    const edge = { x: 9121.800000000001, z: -7527.800000000001 };
    const canopy = { x: 601.6, z: -19573.6 };
    expect(forestDensity(SEED, open.x, open.z)).toBeCloseTo(0, 5);
    const edgeRho = forestDensity(SEED, edge.x, edge.z);
    expect(edgeRho).toBeGreaterThan(0.1);
    expect(edgeRho).toBeLessThan(0.4);
    expect(forestDensity(SEED, canopy.x, canopy.z)).toBeGreaterThan(0.7);

    const dOpen = clutterDensity(SEED, CLUTTER_BUSH, open.x, open.z);
    const dEdge = clutterDensity(SEED, CLUTTER_BUSH, edge.x, edge.z);
    const dCanopy = clutterDensity(SEED, CLUTTER_BUSH, canopy.x, canopy.z);
    expect(dOpen).toBeGreaterThan(0);
    expect(dEdge).toBeGreaterThan(dOpen);
    expect(dCanopy).toBeGreaterThan(dOpen);
  });

  it("extends the class-range sweep to the litter class (CLUTTER_CLASS_COUNT = 9)", () => {
    // The pre-existing "stays in [0, 1] for every class" sweep above loops
    // cls < CLUTTER_CLASS_COUNT, so it already covers class 5 (bush) — and,
    // now that the constant is 9, classes 6-8
    // (meadow, flower, litter) too — automatically; this assertion is the loop bound.
    // Same for the road-bed sweep in the domain census describe block below.
    expect(CLUTTER_CLASS_COUNT).toBe(9);
  });
});

describe("clutter instances", () => {
  it("is deterministic: identical draws for identical cells", () => {
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      for (let i = -20; i < 20; i++) {
        expect(clutterInCell(SEED, cls, i * 7, -i * 3)).toEqual(clutterInCell(SEED, cls, i * 7, -i * 3));
      }
    }
  });

  it("never leaves its own cell", () => {
    // Exhaustive nested scan over cx,cz in [-200,200), capped at 25 hits, not
    // a single-index pseudo-random walk: `((i*37)%400)-200`/`((i*101)%400)-200`
    // share the index i and modulus 400, so their JOINT range is only 400
    // distinct pairs no matter how many iterations run (period 400), and for
    // DRIFTWOOD — a real, narrow coastal band — none of those 400 pairs lands
    // on any of the (measured) 28 occupied cells in this range, so the floor
    // assertion below was permanently unsatisfiable regardless of the field's
    // correctness. The exhaustive scan has no such blind spot.
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const cell = clutterCell(cls);
      let seen = 0;
      scan:
      for (let cz = -200; cz < 200; cz++) {
        for (let cx = -200; cx < 200; cx++) {
          const inst = clutterInCell(SEED, cls, cx, cz);
          if (!inst) continue;
          seen++;
          expect(inst.x).toBeGreaterThanOrEqual(cx * cell);
          expect(inst.x).toBeLessThan((cx + 1) * cell);
          expect(inst.z).toBeGreaterThanOrEqual(cz * cell);
          expect(inst.z).toBeLessThan((cz + 1) * cell);
          expect(inst.scale).toBeGreaterThan(0);
          expect(inst.hash).toBeGreaterThanOrEqual(0);
          expect(inst.hash).toBeLessThan(1);
          if (seen >= 25) break scan;
        }
      }
      // Teeth: the scan must actually see instances for every class.
      // GRASS/ROCK are common; BOULDER/DRIFTWOOD/FUNGUS are sparse or banded,
      // so assert a lower floor for them.
      // measured (exhaustive scan, cx,cz in [-200,200), cap 25): GRASS 25,
      // ROCK 25, BOULDER 25, FUNGUS 25, DRIFTWOOD 25 of only 28 occupied
      // cells in the whole range — driftwood is genuinely the sparsest class
      // here, hence the floor of 1 rather than half of 25.
      expect(seen).toBeGreaterThanOrEqual(cls === CLUTTER_GRASS || cls === CLUTTER_ROCK ? 25 : 1);
    }
  });

  it("boulders never come out smaller than the collidable minimum", () => {
    let seen = 0;
    for (let i = 0; i < 20000 && seen < 30; i++) {
      const inst = clutterInCell(SEED, CLUTTER_BOULDER, ((i * 13) % 600) - 300, ((i * 29) % 600) - 300);
      if (!inst) continue;
      seen++;
      expect(inst.scale).toBeGreaterThanOrEqual(CLUTTER_BOULDER_SCALE_MIN);
    }
    expect(seen).toBeGreaterThanOrEqual(5); // measured: 30 (hit the cap) over this 20000-iteration sweep
  });

  it("scales every class into its real-world size band", () => {
    // Rendered size = mesh size x instance scale. The mesh sizes are the
    // shipped models' measured bounding boxes (recorded in each constant's
    // comment); this pins the SCALE range that turns them into their
    // real-world bands, so a future mesh swap that forgets to re-derive the
    // range fails here.
    const bands: Record<string, [number, number, number]> = {
      // class name: [meshSize, bandMin, bandMax] — meshSize from the shipped
      // model's LOD0 (see the CLUTTER_*_SCALE_MIN/MAX comments in clutter.ts).
      grass: [0.403, 0.3, 0.6],
      bush: [1.919, 0.8, 2.0],
      rock: [0.319, 0.3, 1.0],
      boulder: [2.516, 1.5, 3.5],
      drift: [0.571, 0.8, 2.5],
      meadow: [0.421, 0.25, 0.45],
      flower: [0.186, 0.15, 0.3],
    };
    const ranges: Record<string, [number, number]> = {
      grass: [CLUTTER_GRASS_SCALE_MIN, CLUTTER_GRASS_SCALE_MAX],
      bush: [CLUTTER_BUSH_SCALE_MIN, CLUTTER_BUSH_SCALE_MAX],
      rock: [CLUTTER_ROCK_SCALE_MIN, CLUTTER_ROCK_SCALE_MAX],
      boulder: [CLUTTER_BOULDER_SCALE_MIN, CLUTTER_BOULDER_SCALE_MAX],
      drift: [CLUTTER_DRIFT_SCALE_MIN, CLUTTER_DRIFT_SCALE_MAX],
      meadow: [CLUTTER_MEADOW_SCALE_MIN, CLUTTER_MEADOW_SCALE_MAX],
      flower: [CLUTTER_FLOWER_SCALE_MIN, CLUTTER_FLOWER_SCALE_MAX],
    };
    for (const [cls, [mesh, lo, hi]] of Object.entries(bands)) {
      const [sMin, sMax] = ranges[cls]!;
      expect(mesh * sMin).toBeGreaterThanOrEqual(lo * 0.9);
      expect(mesh * sMin).toBeLessThanOrEqual(lo * 1.15);
      expect(mesh * sMax).toBeGreaterThanOrEqual(hi * 0.85);
      expect(mesh * sMax).toBeLessThanOrEqual(hi * 1.1);
    }
  });

  it("clutterInRect emits exactly the instances whose jittered position is inside", () => {
    const r = clutterInRect(SEED, CLUTTER_ROCK, -180, -180, 180, 180);
    expect(r.length).toBeGreaterThan(0);
    for (const inst of r) {
      expect(inst.x).toBeGreaterThanOrEqual(-180);
      expect(inst.x).toBeLessThan(180);
      expect(inst.z).toBeGreaterThanOrEqual(-180);
      expect(inst.z).toBeLessThan(180);
    }
  });

  it("declares every exported CLUTTER_ constant in CLUTTER_TUNABLES", async () => {
    const mod = await import("../../src/sim/clutter.js");
    for (const [k, v] of Object.entries(mod)) {
      if (k.startsWith("CLUTTER_") && typeof v === "number" && k !== "CLUTTER_CLASS_COUNT"
        && !["CLUTTER_GRASS", "CLUTTER_ROCK", "CLUTTER_BOULDER", "CLUTTER_DRIFTWOOD", "CLUTTER_FUNGUS", "CLUTTER_BUSH", "CLUTTER_MEADOW", "CLUTTER_FLOWER", "CLUTTER_LITTER"].includes(k)) {
        expect(CLUTTER_TUNABLES[k], k).toBe(v);
      }
    }
  });
});

describe("the litter class", () => {
  it("pins the density constant, declared in CLUTTER_TUNABLES", () => {
    expect(CLUTTER_LITTER_D).toBe(0.9);
    expect(CLUTTER_TUNABLES.CLUTTER_LITTER_D).toBe(0.9);
  });

  it("follows its band of the trail distance", () => {
    expect(litterBand(0)).toBe(CLUTTER_LITTER_CORE);
    expect(litterBand(0.44)).toBe(CLUTTER_LITTER_CORE);
    expect(litterBand(0.5)).toBe(1);
    expect(litterBand(0.89)).toBe(1);
    expect(litterBand(1.25)).toBeGreaterThan(0);
    expect(litterBand(1.25)).toBeLessThan(1);
    expect(litterBand(CLUTTER_LITTER_FADE)).toBe(0);
    expect(litterBand(Infinity)).toBe(0);
  });

  it("is the ninth class with three variants and no instance farther than the fade", () => {
    expect(CLUTTER_LITTER).toBe(8);
    expect(CLUTTER_CLASS_COUNT).toBe(9);
    const seed = SEED;
    // A "no instance farther than the fade" scan over a 1200 m square of 1 m
    // cells would be far too slow. Scan a 100 x 100 m window
    // centred on the midpoint of the stem's second edge instead: small enough
    // to run fast, real enough to hold litter instances.
    const g = activeTerrainVariant().trailGraph!(seed);
    const edge = g.edges[g.stem[1]!]!;
    const a = g.nodes[edge.a]!, b = g.nodes[edge.b]!;
    const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
    const insts = clutterInRect(seed, CLUTTER_LITTER, midX - 50, midZ - 50, midX + 50, midZ + 50);
    expect(insts.length).toBeGreaterThan(0);
    const rt = (x: number, z: number) => activeTerrainVariant().trailDistance!(seed, x, z);
    // litterBand — and so density — is evaluated at the CELL CENTRE, not the
    // jittered instance; litter has no trailClear rejection (a stray pebble
    // reads as ground litter wherever it lands), so an instance whose centre
    // sits just inside the fade can jitter up to
    // √2·(CLUTTER_JITTER/2)·CLUTTER_LITTER_CELL past it — the same derived-
    // margin idiom the ROCK/BUSH road-bed tests use for their own NEAR floors.
    const fadeCeiling = CLUTTER_LITTER_FADE + Math.SQRT2 * (CLUTTER_JITTER / 2) * CLUTTER_LITTER_CELL;
    for (const i of insts) {
      expect(rt(i.x, i.z)).toBeLessThan(fadeCeiling);
      expect(i.variant).toBeGreaterThanOrEqual(0);
      expect(i.variant).toBeLessThan(3);
    }
  });

  it("stands nowhere above the snow line, and its density gate closes there", () => {
    const seed = SEED;
    // Same 100 x 100 m window the ninth-class scan above uses.
    const g = activeTerrainVariant().trailGraph!(seed);
    const edge = g.edges[g.stem[1]!]!;
    const a = g.nodes[edge.a]!, b = g.nodes[edge.b]!;
    const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
    const insts = clutterInRect(seed, CLUTTER_LITTER, midX - 50, midZ - 50, midX + 50, midZ + 50);
    expect(insts.length).toBeGreaterThan(0);
    const snowLine = CLUTTER_GRASS_ALT_HI + CLUTTER_GRASS_ALT_HI_FADE;
    for (const i of insts) expect(i.groundH).toBeLessThan(snowLine);
    const above: TerrainSample = { h: snowLine + 10, dx: 0, dz: 0 };
    expect(clutterDensity(seed, CLUTTER_LITTER, midX, midZ, above)).toBe(0);
  });

  it("tightens the grass gate to the bench edge", () => {
    expect(CLUTTER_GRASS_TRAIL_NEAR).toBe(0.75);
    expect(CLUTTER_GRASS_TRAIL_FAR).toBe(2.5);
    expect(grassTrailGate(0.75)).toBe(0);
    expect(grassTrailGate(2.5)).toBe(1);
  });
});

describe("meadow & flower censuses", () => {
  it("meadow density IS the grass gate product — shared gates, exactly", () => {
    // Shared constants, not copies — the two classes cannot drift.
    for (let i = 0; i < 400; i++) {
      const x = i * 173.3 - 8000;
      const z = i * 311.9 - 12000;
      expect(clutterDensity(SEED, CLUTTER_MEADOW, x, z)).toBe(clutterDensity(SEED, CLUTTER_GRASS, x, z));
    }
  });

  it("flower density never exceeds the grass gate product, and only drifts bloom", () => {
    let inDrift = 0;
    let openGround = 0;
    for (let i = 0; i < 4000; i++) {
      const x = i * 97.3 - 20000;
      const z = i * 61.7 - 15000;
      const grass = clutterDensity(SEED, CLUTTER_GRASS, x, z);
      const flower = clutterDensity(SEED, CLUTTER_FLOWER, x, z);
      expect(flower).toBeLessThanOrEqual(grass + 1e-12);
      if (grass > 0.5) {
        openGround++;
        if (flower > 0) inDrift++;
      }
    }
    expect(openGround).toBeGreaterThan(500); // the sweep must actually cover open ground
    const fraction = inDrift / openGround;
    // CLUTTER_FLOWER_PATCH_LO/HI were calibrated against the MEASURED
    // n01 distribution (see the constants' own comment in clutter.ts) —
    // measured on this exact sweep: openGround = 772, inDrift = 216,
    // fraction = 0.27979 (216/772), squarely inside the target ("roughly a
    // quarter to a third" ≈ [0.25, 0.333]). Test bounds bracket that target
    // with real margin — [0.15, 0.45] extends beyond [0.25, 0.333] to avoid
    // fitting — never fitted to 0.27979 itself.
    expect(fraction).toBeGreaterThan(0.15);
    expect(fraction).toBeLessThan(0.45);

    // Mutation-4: swapping
    // CLUTTER_FLOWER_PATCH_SALT for CLUTTER_PATCH_SALT in the flower case
    // still does NOT move the aggregate fraction enough to fail the bounds
    // above even after re-calibration (measured under the swapped salt:
    // 202/772 = 0.26166 — still inside [0.15, 0.45]; the marginal
    // distribution of fbm2 is salt-independent, so a different salt
    // reshuffles WHICH points bloom, not how many, in aggregate). A measured
    // drift-interior/exterior point pair pins the salt instead: interior
    // (grass 1, flower 0.491892 with the real salt) sits inside a drift;
    // exterior (grass 1, flower 0 with the real salt) sits just outside one
    // — under the mutated salt the INTERIOR point's own drift value drops
    // from > 0 to exactly 0 (n01 there falls from 0.85946 to 0.63945, below
    // the re-calibrated LO = 0.81), which the "never exceeds grass" bound
    // above does NOT catch (flower ≤ grass still holds), so this exact-value
    // pin is the assertion that actually fails.
    const interior = { x: -248.10000000000218, z: -2474.8999999999996 };
    const exterior = { x: -150.79999999999927, z: -2413.199999999999 };
    expect(clutterDensity(SEED, CLUTTER_GRASS, interior.x, interior.z)).toBeGreaterThan(0.5);
    expect(clutterDensity(SEED, CLUTTER_FLOWER, interior.x, interior.z)).toBeGreaterThan(0);
    expect(clutterDensity(SEED, CLUTTER_GRASS, exterior.x, exterior.z)).toBeGreaterThan(0.5);
    expect(clutterDensity(SEED, CLUTTER_FLOWER, exterior.x, exterior.z)).toBe(0);
  });

  it("meadow occupancy saturates on open field ground", () => {
    // Instance-occupancy census: scan a measured open-field
    // patch; with D above the one-per-cell cap, occupancy tracks the mean gate.
    // Patch found by scanning for a region where the (shared) grass gate is ≈ 1
    // over a wide neighbourhood (the bush-census technique at clutter.test.ts's
    // "is nonzero in the open field..." test): world coords x ∈ [0.35, 70],
    // z ∈ [21300, 21370] — gentle, low ground (h ≈ 118-125 m), far from the
    // road (roadDistance ≈ 310-360 m). Full-resolution scan of this exact
    // window's grass density: min 0.8716, max 1, mean 0.99998 (10000 cells).
    const X0 = 0, Z0 = 30428; // cell indices (CLUTTER_MEADOW_CELL = 0.7 m/cell)
    let occupied = 0;
    let scanned = 0;
    for (let cx = X0; cx < X0 + 100; cx++) {
      for (let cz = Z0; cz < Z0 + 100; cz++) {
        scanned++;
        if (clutterInCell(SEED, CLUTTER_MEADOW, cx, cz)) occupied++;
      }
    }
    // Measured: occupied/scanned = 1 (10000/10000) — the window's gate is so
    // close to saturated (mean 0.99998) and CLUTTER_MEADOW_D (2.05) so far
    // above the one-per-cell cap (1/0.49 ≈ 2.04) that presence rounds up to
    // certain nearly everywhere. Floor set well below the measured 1.0.
    expect(occupied / scanned).toBeGreaterThan(0.9);
  });
});

describe("domain census — 90 km, both signs of z", () => {
  const zs: number[] = [];
  for (let z = -45000; z <= 45000; z += 487) zs.push(z + 0.5);

  it("keeps the road bed bare of every class", () => {
    for (const z of zs) {
      const x = centerlineX(z);
      for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
        // The narrowest gate is ROCK's NEAR (10 m) > ROAD_BED_HALF (5.5):
        // density is identically 0 on the whole bed for every class.
        expect(clutterDensity(SEED, cls, x, z)).toBe(0);
      }
    }
  });

  it("suppresses boulders across the whole corridor", () => {
    // A fixed ±29 m box held across a 487 m z-bracket can't track the
    // warped centerline (COAST_WARP_AMPLITUDE 220 over WAVELENGTH 1100) —
    // measured drift up to ~178 m per bracket. Widen the scan to ±250 m
    // (well past any plausible drift) and assert two things: the gate's
    // own contract at the CELL CENTRE (a density statement), and a derived
    // hard floor at the jittered instance itself — NEAR − √2·(JITTER/2)·CELL
    // ≈ 6.24 m, which exceeds ROAD_BED_HALF (5.5): the asphalt is
    // boulder-free by construction, not by measurement.
    const v = variantOrThrow("olympic");
    const instanceFloor =
      CLUTTER_BOULDER_ROAD_NEAR - Math.SQRT2 * (CLUTTER_JITTER / 2) * CLUTTER_BOULDER_CELL;
    let seen = 0;
    for (const z of zs) {
      const cx = centerlineX(z);
      for (const b of clutterInRect(SEED, CLUTTER_BOULDER, cx - 250, z, cx + 250, z + 487)) {
        seen++;
        const ccx = (Math.floor(b.x / CLUTTER_BOULDER_CELL) + 0.5) * CLUTTER_BOULDER_CELL;
        const ccz = (Math.floor(b.z / CLUTTER_BOULDER_CELL) + 0.5) * CLUTTER_BOULDER_CELL;
        expect(v.roadDistance!(SEED, ccx, ccz)).toBeGreaterThanOrEqual(CLUTTER_BOULDER_ROAD_NEAR - 1e-9);
        expect(v.roadDistance!(SEED, b.x, b.z)).toBeGreaterThanOrEqual(instanceFloor);
      }
    }
    expect(seen).toBeGreaterThan(500); // measured: 1028; floor ~half
  });

  it("keeps rocks off the road bed at the jittered instance, not just the cell centre", () => {
    // Same shape as the boulder corridor test above, but ROCK's road gate
    // (NEAR/FAR 10/13) is far narrower than BOULDER's corridor exclusion
    // (30/60), so a ±60 m band per 487 m z-bracket comfortably covers every
    // rock cell that could conceivably reach the bed — no need for
    // BOULDER's ±250 m centerline-drift margin. Assert both: the gate's own
    // contract at the CELL CENTRE (a density statement), and the derived
    // hard floor at the jittered instance — NEAR − √2·(JITTER/2)·CELL ≈
    // 5.545 m, which exceeds ROAD_BED_HALF (5.5): the asphalt is
    // rock-free by construction, not by measurement.
    const v = variantOrThrow("olympic");
    const instanceFloor =
      CLUTTER_ROCK_ROAD_NEAR - Math.SQRT2 * (CLUTTER_JITTER / 2) * CLUTTER_ROCK_CELL;
    let seen = 0;
    for (const z of zs) {
      const cx = centerlineX(z);
      for (const rck of clutterInRect(SEED, CLUTTER_ROCK, cx - 60, z, cx + 60, z + 487)) {
        seen++;
        const ccx = (Math.floor(rck.x / CLUTTER_ROCK_CELL) + 0.5) * CLUTTER_ROCK_CELL;
        const ccz = (Math.floor(rck.z / CLUTTER_ROCK_CELL) + 0.5) * CLUTTER_ROCK_CELL;
        expect(v.roadDistance!(SEED, ccx, ccz)).toBeGreaterThanOrEqual(CLUTTER_ROCK_ROAD_NEAR - 1e-9);
        expect(v.roadDistance!(SEED, rck.x, rck.z)).toBeGreaterThanOrEqual(instanceFloor);
      }
    }
    expect(seen).toBeGreaterThan(27000); // measured: 55088; floor ~half
  });

  it("keeps fields full of grass — and forest floors, steeps and summits bare", () => {
    let total = 0;
    let open = 0;
    let grassy = 0;
    const openPoints: { x: number; z: number }[] = [];
    for (const z of zs) {
      for (const xo of [300, 700, 1100]) {
        const x = xo + 0.318;
        total++;
        // Classify by the same cell-centre ρ gate grass's own canopy term
        // reads (clutter.ts: CLUTTER_GRASS_CANOPY_LO/HI on forestDensity).
        // OPEN means the forest retune's canopy gate hasn't shut grass out.
        const rho = forestDensity(SEED, x, z);
        if (rho >= CLUTTER_GRASS_CANOPY_LO) continue; // canopy-closed: not open ground
        open++;
        openPoints.push({ x, z });
        if (clutterDensity(SEED, CLUTTER_GRASS, x, z) > 0.15) grassy++;
      }
    }
    expect(total).toBeGreaterThan(400);
    expect(open).toBeGreaterThan(50); // vacuity guard: conditioning must not empty the sweep
    // The RAW (unconditioned) fraction fell from 0.4937 to 0.2775 purely
    // because the forest retune (TREE_CELL 12→10, D 0.006→0.01, RAG
    // 0.25/0.75→0.15/0.6) pushed more of this sweep's fixed x offsets under
    // canopy dense enough for grass's own CANOPY_LO/HI gate to thin it —
    // that collateral effect is the forest census's job to guard (it does),
    // not this one's. Conditioning on OPEN ground (cell-centre ρ <
    // CLUTTER_GRASS_CANOPY_LO) restores the fields-always-full guard on
    // ground the forest retune didn't touch, instead of lowering the floor
    // below the pre-retune measurement. Pre-retune context: the raw sweep
    // measured 0.4937 (274/555). Measured now, conditioned on open ground:
    // 0.4438 (79/178 open of 555 total).
    const frac = grassy / open;
    expect(frac).toBeGreaterThan(0.35);  // ~21% under measured — fields read full on open ground
    expect(frac).toBeLessThan(0.7);      // still catches a runaway gate carpeting everything

    // The density-threshold assertion above is structurally blind to
    // CLUTTER_GRASS_D — D only enters via cfg.density in clutterInCell's
    // presence probability, never in clutterDensity's gate product, so a
    // regression to launch's D = 0.08 cannot fail it. This sibling assertion
    // measures actual INSTANCE occupancy (cells holding a grass tuft / cells
    // scanned) over 30 representative 54 m × 54 m regions (18×18 = 324
    // CLUTTER_GRASS_CELL cells each, stride-6 sampled from the open points
    // above — 9720 cells total), giving the fields-always-full guard real
    // teeth against the D knob.
    const REGION_CELLS = 18;
    const REGION_SPAN = REGION_CELLS * CLUTTER_GRASS_CELL; // 54 m
    let cellsScanned = 0;
    let cellsOccupied = 0;
    for (let i = 0; i < openPoints.length; i += 6) {
      const { x, z } = openPoints[i]!;
      const cx0 = Math.floor(x / CLUTTER_GRASS_CELL) - REGION_CELLS / 2;
      const cz0 = Math.floor(z / CLUTTER_GRASS_CELL) - REGION_CELLS / 2;
      const minX = cx0 * CLUTTER_GRASS_CELL;
      const minZ = cz0 * CLUTTER_GRASS_CELL;
      cellsOccupied += clutterInRect(SEED, CLUTTER_GRASS, minX, minZ, minX + REGION_SPAN, minZ + REGION_SPAN).length;
      cellsScanned += REGION_CELLS * REGION_CELLS;
    }
    expect(cellsScanned).toBeGreaterThan(2000); // vacuity guard: enough regions swept
    // Measured: occupancy = 0.5386 (5235/9720 cells)
    // over the 30 regions above. With D = CLUTTER_GRASS_D = 0.12 above the
    // 1/CELL² = 1/9 one-per-cell cap, presence p = min(1, gate·9·0.12) ≈
    // min(1, 1.08·gate) — occupancy tracks the mean gate product on open
    // ground, mostly saturated. Reverting D to launch's 0.08 (p ≈
    // 0.72·gate, sub-saturated) measured 0.3854 (3746/9720) — well below
    // this floor, as it must. Floor set ~16% under measurement.
    const occupancy = cellsOccupied / cellsScanned;
    expect(occupancy).toBeGreaterThan(0.45);
  });

  it("keeps boulders sparse and off the corridor, present on steep high ground", () => {
    let hits = 0;
    for (const z of zs) {
      const insts = clutterInRect(SEED, CLUTTER_BOULDER, 1200, z, 4200, z + 487);
      hits += insts.length;
      for (const b of insts) expect(b.scale).toBeGreaterThanOrEqual(CLUTTER_BOULDER_SCALE_MIN);
    }
    // 3 km × 90 km at D 0.0002 with gates would be ~54k fully open; the
    // slope+altitude gates should keep it to a small fraction. Wide band:
    expect(hits).toBeGreaterThan(40);     // they exist at scale — measured: 7994
    expect(hits).toBeLessThan(20000);     // and are rare
  });

  it("keeps driftwood on the shore band only", () => {
    // The gate is evaluated at the cell centre, not the jittered instance
    // position (client/src/sim/clutter.ts's clutterInCell): assert the
    // exact bound the gate itself promises, at the cell centre, rather
    // than at the instance's own (jittered, up to 2.1 m off-centre) spot.
    // Exhaustive over the 90 km × 4 km shore band (no early exit expected):
    // measured 9-25 s solo, up to ~38 s under full-suite worker contention —
    // past vitest's 5000 ms default; a generous explicit timeout.
    const v = variantOrThrow("olympic");
    for (const z of zs) {
      for (const d of clutterInRect(SEED, CLUTTER_DRIFTWOOD, -2000, z, 2000, z + 487)) {
        const ccx = (Math.floor(d.x / CLUTTER_DRIFT_CELL) + 0.5) * CLUTTER_DRIFT_CELL;
        const ccz = (Math.floor(d.z / CLUTTER_DRIFT_CELL) + 0.5) * CLUTTER_DRIFT_CELL;
        expect(v.sample(SEED, ccx, ccz).h).toBeLessThanOrEqual(CLUTTER_DRIFT_ALT_HI + CLUTTER_DRIFT_ALT_HI_FADE + 1e-9);
      }
    }
  }, 60000);

  it("is deterministic at large and negative coordinates", () => {
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const a = clutterInRect(SEED, cls, -90000, 88000, -89800, 88200);
      const b = clutterInRect(SEED, cls, -90000, 88000, -89800, 88200);
      expect(a).toEqual(b);
    }
  });

  it("keeps bushes off the road bed at the jittered instance, not just the cell centre", () => {
    // BUSH road gate NEAR/FAR 8.5/14 — a ±60 m band per 487 m z-bracket covers
    // every bush cell that could reach the bed (the ROCK precedent). Derived
    // instance floor: NEAR − √2·(JITTER/2)·CELL = 8.5 − 1.98 ≈ 6.52 m >
    // ROAD_BED_HALF (5.5): asphalt is bush-free by construction.
    // The two relative checks below
    // (`instanceFloor` and the cell-centre bound) are both recomputed FROM
    // CLUTTER_BUSH_ROAD_NEAR itself, so they stay self-consistent by
    // construction regardless of its value (the same property holds for the
    // pre-existing ROCK corridor test above under the identical mutation) —
    // they catch a MISMATCH between the road gate and the jitter-derived
    // floor, not an absolute regression in NEAR. The ABSOLUTE floor below
    // (against ROAD_BED_HALF, imported from road.ts — not a derived value)
    // is what actually pins bushes off the asphalt regardless of how NEAR is
    // tuned; see the mutation check recorded after this test.
    const v = variantOrThrow("olympic");
    const instanceFloor =
      CLUTTER_BUSH_ROAD_NEAR - Math.SQRT2 * (CLUTTER_JITTER / 2) * CLUTTER_BUSH_CELL;
    let seen = 0;
    for (const z of zs) {
      const cx = centerlineX(z);
      for (const b of clutterInRect(SEED, CLUTTER_BUSH, cx - 60, z, cx + 60, z + 487)) {
        seen++;
        const ccx = (Math.floor(b.x / CLUTTER_BUSH_CELL) + 0.5) * CLUTTER_BUSH_CELL;
        const ccz = (Math.floor(b.z / CLUTTER_BUSH_CELL) + 0.5) * CLUTTER_BUSH_CELL;
        expect(v.roadDistance!(SEED, ccx, ccz)).toBeGreaterThanOrEqual(CLUTTER_BUSH_ROAD_NEAR - 1e-9);
        expect(v.roadDistance!(SEED, b.x, b.z)).toBeGreaterThanOrEqual(instanceFloor);
        // Absolute floor: the actual asphalt half-width, not a value derived
        // from the (possibly regressed) tunable under test.
        expect(v.roadDistance!(SEED, b.x, b.z)).toBeGreaterThan(ROAD_BED_HALF);
      }
    }
    // measured 2026-08-27: 66957; floor ~half.
    expect(seen).toBeGreaterThan(33000);
  });

  it("puts bushes everywhere, densest at forest edges and under canopy", () => {
    // Whole-domain sweep, classified by the SAME cell-centre ρ the gate reads
    // (the gate-contract convention): open (ρ < 0.03), edge (0.10 ≤ ρ ≤ 0.40),
    // canopy (ρ > 0.7). Only count points that pass the other gates' preconditions
    // (h in [11, 200], slopeSq below the LO edge, road far) so the census
    // measures the HABITAT curve, not the unrelated gates.
    // xo widened past the original [300, 700, 1100] (open population was 11,
    // under the intended 30 floor) to 12 offsets spanning 300–2500 —
    // re-measured everything below accordingly.
    const v = variantOrThrow("olympic");
    let open = 0, openHit = 0, edge = 0, edgeHit = 0, canopy = 0, canopyHit = 0;
    let sumOpenD = 0, sumEdgeD = 0, canopyMinD = Infinity;
    for (const z of zs) {
      for (const xo of [300, 500, 700, 900, 1100, 1300, 1500, 1700, 1900, 2100, 2300, 2500]) {
        const x = xo + 0.318;
        const s = v.sample(SEED, x, z);
        const slopeSq = s.dx * s.dx + s.dz * s.dz;
        const r = v.roadDistance!(SEED, x, z);
        if (s.h < 11 || s.h > 200 || slopeSq > 0.5 * 0.5 || r < 14) continue;
        const rho = forestDensity(SEED, x, z, s);
        const d = clutterDensity(SEED, CLUTTER_BUSH, x, z, s);
        if (rho < 0.03) { open++; sumOpenD += d; if (d > 0.02) openHit++; }
        else if (rho >= 0.1 && rho <= 0.4) { edge++; sumEdgeD += d; if (d > 0.3) edgeHit++; }
        else if (rho > 0.7) { canopy++; canopyMinD = Math.min(canopyMinD, d); if (d > 0.3) canopyHit++; }
      }
    }
    // Population floors first — the census must have seen real ground of all
    // three kinds. Measured 2026-08-27 (zs 90 km/487 m stride, 12 xo offsets
    // 300–2500): open 34, edge 185, canopy 1138. Floors at ~half.
    expect(open).toBeGreaterThan(17);
    expect(edge).toBeGreaterThan(92);
    expect(canopy).toBeGreaterThan(569);
    // Habitat fractions. Measured: openHit/open = 1 (34/34), edgeHit/edge = 1
    // (185/185), canopyHit/canopy = 1 (1138/1138) — all saturated. This
    // preconditioned population's slope cap (slopeSq > 0.5*0.5) coincides
    // exactly with CLUTTER_BUSH_SLOPE_LO (0.5), so every counted point has
    // grade ≡ 1 (the bush slope term never engages below its own LO edge);
    // combined with alt ≡ 1 (h comfortably inside [ALT_LO+FADE, ALT_HI]) and
    // road ≡ 1 (r ≥ ROAD_FAR), only PATCH (∈ [PATCH_FLOOR, 1] = [0.5, 1]) and
    // the habitat term vary in this sample — both comfortably clear their
    // thresholds (0.1·0.5 = 0.05 > 0.02 for open; ≈1·0.5 = 0.5 > 0.3 for
    // edge/canopy once the habitat term itself saturates near 1 across
    // [0.1, 0.4] and beyond 0.7). Floored at 0.8 per the near-1.0 fill rule.
    // Mutation check (2026-08-27): CANOPY_W → 0 drops canopyHit to 0/1138,
    // failing the canopy floor above (the teeth this census exists for).
    expect(openHit / open).toBeGreaterThan(0.8);     // field floor is alive
    expect(edgeHit / edge).toBeGreaterThan(0.8);     // the belt is dense
    expect(canopyHit / canopy).toBeGreaterThan(0.8); // thickets under canopy

    // Ordering, restored as a MEAN
    // comparison so it cannot saturate the way the per-point hit-fractions
    // above do (both pinned at exactly 1.0 by the slope-cap coincidence
    // documented above). Measured: meanOpen = 0.09956, meanEdge = 0.99889 —
    // open-field bush cover really is far sparser than the forest-edge
    // belt, at scale, not just "nonzero vs. nonzero".
    const meanOpen = sumOpenD / open;
    const meanEdge = sumEdgeD / edge;
    expect(meanOpen).toBeGreaterThan(0.03);  // field floor is alive, at scale
    expect(meanOpen).toBeLessThan(meanEdge); // the belt really is denser, at scale

    // Patch-floor guard. This originally called for a specific canopy point
    // with LOW patch noise (n01 < PATCH_LO = 0.35) to isolate PATCH_FLOOR's
    // effect from CANOPY_W's. No such point exists ANYWHERE in the domain:
    // field.ts's fbm2 is documented and
    // implemented as a convex combination of valueNoise2 taps, each in
    // [0, 1) — so fbm2 itself is provably confined to [0, 1), which pins
    // n01 = 0.5 + 0.5·fbm2(...) to [0.5, 1) for every (x, z), not just this
    // sample. An exhaustive scan of every canopy-qualifying point across
    // x ∈ [200, 3000] (step 20) × the full 90 km z sweep (13493 points)
    // measured minN01 = 0.5177 — consistent with, not just short of, the
    // 0.5 theoretical floor. CLUTTER_BUSH_PATCH_LO (0.35) is therefore
    // unreachable by construction, not by under-sampling.
    // Substitute with equivalent teeth: since alt ≡ grade ≡ road ≡ 1 and
    // habitat ≡ FIELD_W + CANOPY_W = 0.95 for every counted canopy point
    // (CANOPY_HI = 0.7 exactly matches this band's rho > 0.7 boundary, so
    // the canopy term is always fully saturated), d = 0.95 · patch exactly
    // here — the population minimum IS a direct, monotonic probe of
    // PATCH_FLOOR. Measured over this exact (deterministic, seed-fixed)
    // population: canopyMinD = 0.79491 at PATCH_FLOOR = 0.5 (theoretical
    // floor 0.95 · (0.5 + 0.5 · 0.5) = 0.7125); mutating PATCH_FLOOR → 0
    // drops it to canopyMinD = 0.63982 (theoretical floor 0.95 · 0.5 =
    // 0.475). 0.75 sits strictly between both measured values.
    expect(canopyMinD).toBeGreaterThan(0.75);
  });

  it("confirms the patch noise floor: fbm2 never drives n01 below 0.5", () => {
    // Backs the substitute canopyMinD
    // assertion above. field.ts's `fbm2` is documented as "normalized to
    // [0, 1)" — a weighted average of `valueNoise2` taps that are each
    // provably in [0, 1) themselves, so the whole convex combination is
    // provably confined to [0, 1) too, for every (x, z). That pins
    // n01 = 0.5 + 0.5·fbm2(...) to [0.5, 1), which makes
    // CLUTTER_BUSH_PATCH_LO (0.35) unreachable by construction — no point
    // in the domain can ever hit a requested n01 < 0.35 probe.
    // Exhaustive over every canopy-qualifying point (same preconditions as
    // the habitat census) across x ∈ [200, 3000] m (step 20) × the full
    // 90 km z sweep: 13493 points, measured minN01 = 0.5177.
    const v = variantOrThrow("olympic");
    let scanned = 0;
    let minN01 = Infinity;
    for (const z of zs) {
      for (let xo = 200; xo <= 3000; xo += 20) {
        const x = xo + 0.318;
        const s = v.sample(SEED, x, z);
        const slopeSq = s.dx * s.dx + s.dz * s.dz;
        const r = v.roadDistance!(SEED, x, z);
        if (s.h < 11 || s.h > 200 || slopeSq > 0.5 * 0.5 || r < 14) continue;
        const rho = forestDensity(SEED, x, z, s);
        if (rho <= 0.7) continue;
        scanned++;
        const n01 = 0.5 + 0.5 * fbm2(x / CLUTTER_BUSH_PATCH_WAVELENGTH, z / CLUTTER_BUSH_PATCH_WAVELENGTH, SEED ^ CLUTTER_PATCH_SALT, CLUTTER_BUSH_PATCH_OCTAVES);
        minN01 = Math.min(minN01, n01);
      }
    }
    expect(scanned).toBeGreaterThan(10000); // vacuity guard: enough canopy ground was actually scanned
    expect(minN01).toBeGreaterThanOrEqual(0.5 - 1e-9); // the fbm2 [0, 1) bound, empirically
  });
});

import { landmarkMaskAt } from "../../src/sim/landmarks.js";
describe("boulders honour the landmark mask", () => {
  it("exposes a boulder multiplier the density applies (unit: mask primitive)", () => {
    const m = landmarkMaskAt([{ type: "talus", x: 0, z: 0, carved: true, discX: 0, discZ: 0 }], 0, 0);
    expect(m.boulder).toBeGreaterThan(1);
    expect(m.boulderFloor).toBeGreaterThanOrEqual(0.5);
  });
});

describe("the terrain feature mask", () => {
  // Seed 12345 is a PROBE_SEED whose world carries BOTH a meadow and a pond
  // loop feature (found by a quick scan of PROBE_SEEDS, 2026-09-11): meadow
  // centre (495.52, 84) radius 84.36, pond centre (207.33, 316) radius 25.80.
  const MASK_SEED = 12345;

  it("carries a denser carpet inside a made meadow than 60 m outside it", () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const { features } = bowlFor(MASK_SEED);
    const meadow = features.find((f) => f.kind === "meadow")!;
    const inside = clutterDensity(MASK_SEED, CLUTTER_MEADOW, meadow.x, meadow.z);
    const outsideX = meadow.x + meadow.radius + MEADOW_RIM + 60;
    const outside = clutterDensity(MASK_SEED, CLUTTER_MEADOW, outsideX, meadow.z);
    expect(inside).toBeGreaterThanOrEqual(outside);
  });

  it("carries no grass on a pond's shore band", () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const { features } = bowlFor(MASK_SEED);
    const pond = features.find((f) => f.kind === "pond")!;
    // 1 m onto the shore band: fm.clutter is 0 there regardless of the
    // underlying grass gate product (see vegetation.test.ts's matching case).
    const x = pond.x + pond.radius + 1;
    expect(clutterDensity(MASK_SEED, CLUTTER_GRASS, x, pond.z)).toBe(0);
  });

  // The bug this guards: `groundCover` (unlike `clutterDensity`) used to
  // skip the feature mask entirely, so a caller reading it directly — the
  // blade field, since it stopped going through `clutterDensity` — grew
  // grass, and stood clumps, on ground the mask marks bare (a pond's shore,
  // the peak's crest). Both fields now apply `fm.clutter` inside
  // `groundCoverAt`, so this must be true of `groundCover` itself, not only
  // of the class this repo happened to already gate correctly.
  it("zeroes grass AND duff at a real masked point, through groundCover directly", () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const { features } = bowlFor(MASK_SEED);
    const pond = features.find((f) => f.kind === "pond")!;
    const x = pond.x + pond.radius + 1, z = pond.z;
    const v = activeTerrainVariant();
    const h = v.sample(MASK_SEED, x, z).h;
    expect(v.featureMask?.(MASK_SEED, x, z, h).clutter).toBe(0); // the point really is masked
    const cover = groundCover(MASK_SEED, x, z);
    expect(cover.grass).toBe(0);
    expect(cover.duff).toBe(0);
  });

  // The fix moves fm.clutter INSIDE the shared field (groundCoverAt) so that
  // `groundCover` picks it up too, rather than leaving it as something only
  // `clutterDensity`'s own call sites remembered to multiply by. This test
  // mixes two different jobs, called out below as they occur: assertions
  // that GUARD the fix (they fail if it is reverted, because they check
  // something that only became true by moving the mask inside the field),
  // and assertions that PIN pre-existing behaviour against future drift
  // (they held before this fix too, so a revert would not trip them — they
  // exist to catch some later, unrelated change instead).
  it("agrees with groundCover's own grass across the mask's fade, and leaves meadow and flower composing it the same way", () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const { features } = bowlFor(MASK_SEED);
    const pond = features.find((f) => f.kind === "pond")!;
    const v = activeTerrainVariant();
    let fractional = 0;
    for (let d = 0; d <= 8; d += 0.25) {
      const x = pond.x + pond.radius + d, z = pond.z;
      const h = v.sample(MASK_SEED, x, z).h;
      const fm = v.featureMask?.(MASK_SEED, x, z, h);
      if (fm === undefined) continue;
      if (fm.clutter > 0 && fm.clutter < 1) fractional++;
      const grass = clutterDensity(MASK_SEED, CLUTTER_GRASS, x, z);
      const meadow = clutterDensity(MASK_SEED, CLUTTER_MEADOW, x, z);
      // PIN, not a guard on this fix: fm.meadow is 0 this far from the made
      // meadow, so meadow's own "(1 + fm.meadow)" is an exact no-op here
      // regardless of the mask fix, and this would equal grass either way.
      expect(meadow).toBe(grass);
      // GUARD: this is the assertion the fix is for. Before it, `grass`
      // (through clutterDensity's own `* fm.clutter`) and `groundCover`'s
      // own value (which skipped the mask entirely) disagreed at every
      // point in this fade band; only moving fm.clutter inside the shared
      // field makes them equal everywhere, not just away from every feature.
      expect(grass).toBe(groundCover(MASK_SEED, x, z).grass);
    }
    // A vacuity guard: the walk actually crossed the fade, not just its ends.
    expect(fractional).toBeGreaterThan(3);
    // PIN, not a guard on this fix: flower's own arithmetic never changed
    // (it keeps applying fm.clutter itself — see the CLUTTER_FLOWER case),
    // so this constant would hold whether or not the fix above landed. It
    // exists to catch a future change to flower's own composition, found at
    // a flower-bearing point inside the same fade (a quick scan, 2026-09-23:
    // its own drift happens to clear the patch gate here, so this is a
    // genuine, non-vacuous flower value, not 0 === 0).
    const a = (204 * Math.PI) / 180;
    const fx = pond.x + (pond.radius + 4.25) * Math.cos(a);
    const fz = pond.z + (pond.radius + 4.25) * Math.sin(a);
    const fh = v.sample(MASK_SEED, fx, fz).h;
    const ffm = v.featureMask?.(MASK_SEED, fx, fz, fh);
    expect(ffm?.clutter).toBeGreaterThan(0);
    expect(ffm?.clutter).toBeLessThan(1);
    const flower = clutterDensity(MASK_SEED, CLUTTER_FLOWER, fx, fz);
    expect(flower).toBeGreaterThan(0);
    expect(flower).toBe(0.0004611562793366643);
  });
});

describe("groundCover", () => {
  const SEED = 1;
  const variant = () => activeTerrainVariant();
  // A point whose ground is grass (altitude and slope gates open) but far
  // from any road or trail, so the only edge in play is the canopy.
  function openGround(seed: number, x: number, z: number): boolean {
    const v = variant();
    const s = v.sample(seed, x, z);
    const alt = s.h > CLUTTER_GRASS_ALT_LO + CLUTTER_GRASS_ALT_LO_FADE && s.h < CLUTTER_GRASS_ALT_HI;
    const gentle = s.dx * s.dx + s.dz * s.dz < CLUTTER_GRASS_SLOPE_LO * CLUTTER_GRASS_SLOPE_LO * 0.5;
    const r = v.roadDistance?.(seed, x, z) ?? Infinity;
    const rt = v.trailDistance?.(seed, x, z) ?? Infinity;
    return alt && gentle && r > CLUTTER_GRASS_ROAD_FAR + 5 && rt > CLUTTER_GRASS_TRAIL_FAR + 5;
  }

  it("exports the spec's constants and joins them to the level id", () => {
    expect(CLUTTER_GRASS_CANOPY_FLOOR).toBe(0.15);
    expect(CLUTTER_GRASS_PATCH_FLOOR).toBe(0.6);
    expect(CLUTTER_GRASS_BOOST).toBe(1.5);
    expect(CLUTTER_GRASS_BOOST_LO).toBe(0.5);
    expect(CLUTTER_DUFF_OPEN).toBe(0.15);
    expect(CLUTTER_DUFF_ROAD_CLEAR).toBe(2);
    expect(CLUTTER_GRASS_TRAIL_CORE).toBe(0.35);
    expect(CLUTTER_GRASS_TRAIL_REACH).toEqual([0.35, 1.3]);
    expect(CLUTTER_GRASS_TRAIL_REACH_WAVE).toBe(9);
    expect(CLUTTER_DUFF_BED_MAX).toBe(0.8);
    expect(CLUTTER_DUFF_BED_FADE).toBe(0.5);
    expect(CLUTTER_DUFF_DRIFT_WAVE).toBe(6);
    expect(CLUTTER_DUFF_DRIFT_BAND).toEqual([0.35, 0.65]);
    for (const key of [
      "CLUTTER_GRASS_CANOPY_FLOOR", "CLUTTER_GRASS_PATCH_FLOOR", "CLUTTER_GRASS_BOOST", "CLUTTER_GRASS_BOOST_LO", "CLUTTER_DUFF_OPEN", "CLUTTER_DUFF_ROAD_CLEAR",
      "CLUTTER_GRASS_TRAIL_CORE", "CLUTTER_GRASS_TRAIL_REACH_LO", "CLUTTER_GRASS_TRAIL_REACH_HI", "CLUTTER_GRASS_TRAIL_REACH_WAVE",
      "CLUTTER_DUFF_BED_MAX", "CLUTTER_DUFF_BED_FADE", "CLUTTER_DUFF_DRIFT_WAVE", "CLUTTER_DUFF_DRIFT_LO", "CLUTTER_DUFF_DRIFT_HI",
    ]) {
      expect(CLUTTER_TUNABLES[key]).toBeTypeOf("number");
    }
  });

  it("keeps the path readable: no grass inside the bed's core, and the ramp's reach varies along the trail", () => {
    // A 200 m square around the trailside pose, scanned at 1 m; the bed's
    // core (rt < CORE) is a few hundred points of it. Measured on seed 1
    // over this exact window: 247 core points.
    const v = variant();
    let core = 0, near = 0, nearGrass = 0;
    const reaches = new Set<number>();
    for (let x = 164; x <= 364; x += 1) {
      for (let z = 18; z <= 218; z += 1) {
        const rt = v.trailDistance?.(SEED, x, z) ?? Infinity;
        if (rt < CLUTTER_GRASS_TRAIL_CORE) { expect(groundCover(SEED, x, z).grass).toBe(0); core++; }
        if (rt >= CLUTTER_GRASS_TRAIL_CORE && rt < 0.75) { near++; if (groundCover(SEED, x, z).grass > 0) nearGrass++; }
        if (rt < 3) reaches.add(Math.round(trailReach(SEED, x, z) * 20) / 20);
      }
    }
    expect(core).toBeGreaterThan(200);
    // Where the default ramp would still be closed (rt < 0.75), the modulated
    // one opens in places: encroachment exists, and is not everywhere.
    expect(nearGrass).toBeGreaterThan(0);
    expect(nearGrass).toBeLessThan(near);
    expect(reaches.size).toBeGreaterThan(6);
    for (const k of reaches) { expect(k).toBeGreaterThanOrEqual(0.35 - 1e-9); expect(k).toBeLessThanOrEqual(1.3 + 1e-9); }
    // The old gate is the ramp at k = 1.
    expect(grassTrailGate(1.5)).toBe(grassTrailRamp(1.5, 1));
  });

  it("gathers duff on the bed in drifts, and only there inside the core", () => {
    // Inside the core the canopy floor is shut (only the drift shows), so
    // the drift's own BED_MAX cap holds there. On the loose margin the
    // floor has started ramping in alongside the still-live bed drift —
    // deliberately, so nothing reads as a bare gap beside the tread — so
    // only the field's general [0, 1] duff contract holds there, not
    // BED_MAX specifically.
    const v = variant();
    let core = 0, margin = 0, drifted = 0;
    for (let x = 164; x <= 364; x += 1) {
      for (let z = 18; z <= 218; z += 1) {
        const rt = v.trailDistance?.(SEED, x, z) ?? Infinity;
        if (rt > 0.75) continue;
        const d = groundCover(SEED, x, z).duff;
        const drift = trailDriftNoise(SEED, x, z);
        expect(drift).toBeGreaterThanOrEqual(0);
        expect(drift).toBeLessThanOrEqual(1);
        if (rt < CLUTTER_GRASS_TRAIL_CORE) {
          core++;
          expect(d).toBeLessThanOrEqual(CLUTTER_DUFF_BED_MAX + 1e-9);
          if (drift < CLUTTER_DUFF_DRIFT_BAND[0]) expect(d).toBeLessThan(0.2);
        } else {
          margin++;
          expect(d).toBeLessThanOrEqual(1 + 1e-9);
        }
        if (drift > CLUTTER_DUFF_DRIFT_BAND[1]) { expect(d).toBeGreaterThan(0.5 * CLUTTER_DUFF_BED_MAX); drifted++; }
      }
    }
    expect(core).toBeGreaterThan(200);
    expect(margin).toBeGreaterThan(0);
    expect(drifted).toBeGreaterThan(30);
  });

  it("leaves no bare band beside the tread: past the core, grass and duff are never both poor", () => {
    // The bug this guards: floorDuff used to clear only inside the core, so
    // the loose margin (rt just past CORE, out to the bed's near edge) could
    // sit with the trail ramp still shut (grass near 0) AND the canopy floor
    // not yet engaged (duff near 0) — a visible bare strip beside the path.
    // Walk real grass ground (alt · grade the domain census's own gate)
    // outward from the core in fine steps and check the width of any
    // "both poor" run stays a sliver, not the old gap's real width.
    const v = variant();
    const POOR = 0.05;
    let maxPoorRun = 0;
    for (let z = 18; z <= 218; z += 5) {
      let run = 0;
      for (let xi = 1640; xi <= 3640; xi++) {
        const x = xi / 10;
        const s = v.sample(SEED, x, z);
        const alt = smoothstepT(CLUTTER_GRASS_ALT_LO, CLUTTER_GRASS_ALT_LO + CLUTTER_GRASS_ALT_LO_FADE, s.h) *
          (1 - smoothstepT(CLUTTER_GRASS_ALT_HI, CLUTTER_GRASS_ALT_HI + CLUTTER_GRASS_ALT_HI_FADE, s.h));
        const grade = 1 - smoothstepT(CLUTTER_GRASS_SLOPE_LO ** 2, CLUTTER_GRASS_SLOPE_HI ** 2, s.dx * s.dx + s.dz * s.dz);
        const rt = v.trailDistance?.(SEED, x, z) ?? Infinity;
        // Only real, unconfounded grass ground past the tread itself: the
        // core is deliberately bare (the path stays readable), so it is
        // excluded, not part of the bug this guards.
        if (alt * grade < 0.95 || rt < CLUTTER_GRASS_TRAIL_CORE) { run = 0; continue; }
        const { grass, duff } = groundCover(SEED, x, z);
        run = (grass < POOR && duff < POOR) ? run + 0.1 : 0;
        maxPoorRun = Math.max(maxPoorRun, run);
      }
    }
    // Measured on seed 1 over this exact walk: 0.2 m (a sliver right at the
    // core's own edge, where a continuous ramp must start near zero) —
    // nothing like the old gap's real width (rt 0.35 to 0.75, ~0.4 m of
    // flat zero before the old formula's sudden duff wall).
    expect(maxPoorRun).toBeLessThan(0.3);
  });

  it("is the grass gate: the grass class and the meadow class read it", () => {
    const points: [number, number][] = [[35, 21335], [-216, 414], [160, -234], [264, 118]];
    for (const [x, z] of points) {
      const cover = groundCover(SEED, x, z);
      expect(cover.grass).toBeGreaterThanOrEqual(0);
      expect(cover.grass).toBeLessThanOrEqual(CLUTTER_GRASS_BOOST);
      expect(cover.duff).toBeGreaterThanOrEqual(0);
      expect(cover.duff).toBeLessThanOrEqual(1);
      // The class and the field both apply the feature mask now (see "the
      // terrain feature mask" above for the masked case), so they agree
      // exactly everywhere, not only away from every feature.
      const g = clutterDensity(SEED, CLUTTER_GRASS, x, z);
      expect(g).toBe(cover.grass);
    }
  });

  it("is continuous: no step larger than the bound along lines that cross every edge kind", () => {
    // Lines found by scanning seed 1 for gentle, valid-altitude ground that
    // actually crosses each named edge (a fixed offset can miss its target
    // entirely on this terrain's own hills and ridges, which the slope gate
    // — unrelated to this field — reads at metre scale): a canopy edge (the
    // forestDensity rho band, verified genuinely crossing CANOPY_LO to
    // CANOPY_HI, not just brushing one of them), an open interior with none
    // of the field's edges in play, the trail's bed, a road verge, and the
    // coast's altitude fade. Sampled at a true fixed 0.25 m step along each
    // line's own span (not span / 240, which was as fine as 0.083 m on the
    // trail and road lines — the two that actually constrain anything).
    const lines: [number, number, number, number][] = [
      [1030, -200, 1150, -200],     // a canopy edge (rho: 0.31 -> 0.92, crossing both LO and HI)
      [2375, -700, 2435, -700],     // open interior, no edge in play
      [-349, 16, -329, 16],         // across the trail
      [-306, 1000.5, -276, 1000.5], // across a road verge
      [-260, 380, -180, 440],       // toward the coast fade
    ];
    const STEP = 0.25;
    let maxGrassStep = 0, maxDuffStep = 0;
    for (const [x0, z0, x1, z1] of lines) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.floor(len / STEP);
      let prev = groundCover(SEED, x0, z0);
      for (let i = 1; i <= n; i++) {
        const t = (i * STEP) / len;
        const cur = groundCover(SEED, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
        maxGrassStep = Math.max(maxGrassStep, Math.abs(cur.grass - prev.grass));
        maxDuffStep = Math.max(maxDuffStep, Math.abs(cur.duff - prev.duff));
        prev = cur;
      }
    }
    // Measured on seed 1 at the true 0.25 m step: maxGrassStep ~ 0.131 (the
    // road line), maxDuffStep ~ 0.024 — real margin under the bound, not the
    // inflated one the finer, span/240 sampling used to report.
    expect(maxGrassStep).toBeLessThan(0.15);
    expect(maxDuffStep).toBeLessThan(0.15);
  });

  it("is continuous across the slope gate itself, stepping synthetic ground from flat to past SLOPE_HI", () => {
    // No real hillside on seed 1 offers a long, gentle run all the way
    // through the slope band untouched by its own local roughness (see the
    // comment above) — so the field's steepest legitimate transition, the
    // grade ramp, goes untested by the lines above. Test it directly: fix
    // an open, canopy-clear position (verified above) and sweep only the
    // sample's slope, at the same 0.25 m-equivalent resolution and the same
    // bound as the position-based lines.
    const [x, z] = [2375, -700];
    const STEP = 0.25, SPAN = 60;
    const n = Math.floor(SPAN / STEP);
    const slopeSpan = CLUTTER_GRASS_SLOPE_HI + 0.15;
    let maxGrassStep = 0, maxDuffStep = 0;
    let prev = groundCover(SEED, x, z, { h: 100, dx: 0, dz: 0 });
    for (let i = 1; i <= n; i++) {
      const slope = (i / n) * slopeSpan;
      const cur = groundCover(SEED, x, z, { h: 100, dx: slope, dz: 0 });
      maxGrassStep = Math.max(maxGrassStep, Math.abs(cur.grass - prev.grass));
      maxDuffStep = Math.max(maxDuffStep, Math.abs(cur.duff - prev.duff));
      prev = cur;
    }
    expect(maxGrassStep).toBeLessThan(0.15);
    expect(maxDuffStep).toBeLessThan(0.15);
  });

  it("keeps the floor full: grass/BOOST + duff stays in band wherever the only edge is the canopy", () => {
    let checked = 0;
    for (let x = -600; x <= 600; x += 12) {
      for (let z = 21000; z <= 22200; z += 12) {
        if (!openGround(SEED, x, z)) continue;
        const { grass, duff } = groundCover(SEED, x, z);
        const fullness = grass / CLUTTER_GRASS_BOOST + duff;
        expect(fullness).toBeGreaterThan(0.55);
        expect(fullness).toBeLessThan(1.05);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("boosts only inside: never above edge · patch where the edge product is under the boost start", () => {
    // Under dense canopy the edge product is small, so no boost may apply.
    let checked = 0;
    for (let x = -600; x <= 600; x += 12) {
      for (let z = 21000; z <= 22200; z += 12) {
        if (!openGround(SEED, x, z)) continue;
        const s = variant().sample(SEED, x, z);
        const rho = forestDensity(SEED, x, z, s);
        if (rho < CLUTTER_GRASS_CANOPY_HI) continue; // dense canopy only
        const { grass } = groundCover(SEED, x, z);
        // canopy ramp is at its floor, patch is at most 1
        expect(grass).toBeLessThanOrEqual(CLUTTER_GRASS_CANOPY_FLOOR + 1e-9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("puts no duff on sand or rock, and on the bed's core only the drifts", () => {
    const v = variant();
    let sandChecked = 0, coreChecked = 0;
    for (let x = -600; x <= 600; x += 6) {
      for (let z = -600; z <= 600; z += 6) {
        const s = v.sample(SEED, x, z);
        if (s.h < CLUTTER_GRASS_ALT_LO) { expect(groundCover(SEED, x, z, s).duff).toBe(0); sandChecked++; }
        const rt = v.trailDistance?.(SEED, x, z) ?? Infinity;
        if (rt < 0.1) {
          // Inside the core the floor duff is closed; whatever remains is the bed drift.
          const d = groundCover(SEED, x, z, s).duff;
          expect(d).toBeLessThanOrEqual(CLUTTER_DUFF_BED_MAX + 1e-9);
          if (trailDriftNoise(SEED, x, z) < CLUTTER_DUFF_DRIFT_LO) expect(d).toBe(0);
          coreChecked++;
        }
      }
    }
    expect(sandChecked).toBeGreaterThan(100);
    expect(coreChecked).toBeGreaterThan(0);
  });

  it("grows grass wherever the floor is grass: the census share tracks the grass-ground share", () => {
    // Ground whose altitude and slope gates are open (alt · grade ≥ 0.9) is
    // grass ground; the field must clear the blade floor on nearly all of it.
    const v = variant();
    let onGrass = 0, covered = 0;
    for (let x = -600; x <= 600; x += 6) {
      for (let z = -600; z <= 600; z += 6) {
        const s = v.sample(SEED, x, z);
        const alt = smoothstepT(CLUTTER_GRASS_ALT_LO, CLUTTER_GRASS_ALT_LO + CLUTTER_GRASS_ALT_LO_FADE, s.h) *
          (1 - smoothstepT(CLUTTER_GRASS_ALT_HI, CLUTTER_GRASS_ALT_HI + CLUTTER_GRASS_ALT_HI_FADE, s.h));
        const grade = 1 - smoothstepT(CLUTTER_GRASS_SLOPE_LO ** 2, CLUTTER_GRASS_SLOPE_HI ** 2, s.dx * s.dx + s.dz * s.dz);
        if (alt * grade < 0.9) continue;
        onGrass++;
        if (groundCover(SEED, x, z, s).grass >= 0.05) covered++;
      }
    }
    expect(onGrass).toBeGreaterThan(5000);
    expect(covered / onGrass).toBeGreaterThan(0.85);
  });

  it("is deterministic", () => {
    const a = groundCover(SEED, 35, 21335);
    const b = groundCover(SEED, 35, 21335);
    expect(a).toEqual(b);
  });
});

function smoothstepT(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
