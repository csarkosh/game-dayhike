import { describe, it, expect } from "vitest";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, terrainVariant } from "../../src/sim/terrain.js";
import { bowlFor, roadFrameAt } from "../../src/sim/olympic.js";
import {
  landmarkMaskAt, LANDMARK_TUNABLES, LANDMARK_DISC_RADIUS, LANDMARK_DISC_FADE,
  LANDMARK_BOWL_MARGIN, LANDMARK_ORDER, LANDMARK_SPACING,
  type Landmark,
} from "../../src/sim/landmarks.js";
import { forestDensity } from "../../src/sim/vegetation.js";
import { clutterDensity, CLUTTER_BOULDER } from "../../src/sim/clutter.js";
import { segmentDistance, TRAIL_CORRIDOR_HALF } from "../../src/sim/trail.js";
import { BOWL_U_MIN, BOWL_U_MAX, BOWL_Z_HALF, TRAIL_Z_ANCHOR } from "../../src/sim/bowl.js";

const SEEDS = [0x5eed, 1, 12345, 777, 4242];

describe("landmarks on reachable ground, five seeds", () => {
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  const v = terrainVariant("olympic")!;

  /**
   * Fraction of a 30 m disc's samples passing `pred`, EXCLUDING the trail
   * corridor. Scenery sits clear of the stem by construction, but its own
   * disc can still graze a corridor at the margin, and the bed is meant to be
   * flat, treeless and boulder-free — that is what a trail is. Corridor
   * samples are not counted either way rather than counted as failures.
   */
  function fill(seed: number, x: number, z: number, pred: (px: number, pz: number) => boolean): number {
    let n = 0, ok = 0;
    for (let dz = -LANDMARK_DISC_RADIUS; dz <= LANDMARK_DISC_RADIUS; dz += 10) {
      for (let dx = -LANDMARK_DISC_RADIUS; dx <= LANDMARK_DISC_RADIUS; dx += 10) {
        if (dx * dx + dz * dz > LANDMARK_DISC_RADIUS * LANDMARK_DISC_RADIUS) continue;
        if (v.trailDistance!(seed, x + dx, z + dz) < TRAIL_CORRIDOR_HALF) continue;
        n++;
        if (pred(x + dx, z + dz)) ok++;
      }
    }
    expect(n, "the corridor must not swallow the whole disc").toBeGreaterThan(0);
    return ok / n;
  }

  it("places one of each type in LANDMARK_ORDER, clear of every graph node and edge", () => {
    const clearance = LANDMARK_DISC_RADIUS + TRAIL_CORRIDOR_HALF;
    for (const seed of SEEDS) {
      const { graph, landmarks } = bowlFor(seed);
      expect(landmarks.map((l) => l.type), `seed ${seed}`).toEqual([...LANDMARK_ORDER]);
      for (const lm of landmarks) {
        for (const n of graph.nodes) {
          expect(Math.hypot(n.x - lm.x, n.z - lm.z), `seed ${seed} ${lm.type} vs node`).toBeGreaterThanOrEqual(clearance - 1e-6);
        }
        for (const e of graph.edges) {
          const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
          expect(segmentDistance(a.x, a.z, b.x, b.z, lm.x, lm.z), `seed ${seed} ${lm.type} vs edge`).toBeGreaterThanOrEqual(clearance - 1e-6);
        }
      }
    }
    // An explicit timeout: these
    // five worlds are built here, and `bowlFor` costs ~460 ms a seed now that
    // loops route — over vitest's 5 s default once the whole suite competes for
    // the CPU, and this assertion also walks every node and edge of each graph,
    // which the loops have made bigger.
  }, 30000);

  it("satisfies its predicate at every endpoint, found or carved", () => {
    // Measured on the MASKED, composed world — the thing the player sees — so
    // a carved one has to have been really carved and a found one really
    // found.
    for (const seed of SEEDS) {
      const { landmarks } = bowlFor(seed);
      for (const lm of landmarks) {
        switch (lm.type) {
          case "stand":
            expect(fill(seed, lm.x, lm.z, (x, z) => forestDensity(seed, x, z) >= 0.9), `seed ${seed} stand`).toBeGreaterThanOrEqual(LANDMARK_TUNABLES.LANDMARK_FILL!);
            break;
          case "talus":
            // A FOUND talus is scored a disc radius from where it sits
            // (`discX/discZ`); a CARVED one is scored, and carved, at (x, z)
            // itself. Measure the predicate where it was scored.
            expect(fill(seed, lm.carved ? lm.x : lm.discX, lm.carved ? lm.z : lm.discZ, (x, z) => clutterDensity(seed, CLUTTER_BOULDER, x, z) >= 0.5), `seed ${seed} talus`).toBeGreaterThanOrEqual(LANDMARK_TUNABLES.LANDMARK_FILL!);
            break;
        }
      }
    }
  });

  it("finds a talus at the foot of a real boulder field, not only carved ones", () => {
    // The talus's own predicate needs ground the trail may not stand on
    // (`boulderDensityUnmasked` ramps in from a 0.35 grade and wants 0.5,
    // which needs ~0.6; TRAIL_GRID_CAP is 0.6), so a naive scoring carves on
    // nearly every world. It is scored a disc radius to one side instead
    // (landmarks.ts), so the scenery sits at the FOOT of a field the seed
    // really has.
    //
    // Re-derived 2026-09-11: an earlier re-scan (0…60, before
    // the platform fix below) named [0, 1, 2, 6]. That scan predates two
    // changes — the peak's summit platform (`peakD`) and the
    // reverted `PEAK_LOWER_TRIES` — either of which could have moved which
    // cells the stem's search marks reachable near the pad, and hence which
    // candidate the (now clearance-based, not routed) scenery search picks.
    // Re-scanned 0…3000 on the real field after both changes: the first four
    // sequential seeds that find one are unchanged, still [0, 1, 2, 6] (the
    // next four in the scan are 7, 13, 20, 24) — the stand and talus are
    // scenery placed independently of the stem's own path now, so neither
    // change touched them here.
    const namedSeeds = [0, 1, 2, 6];
    const found = namedSeeds.map((seed) => bowlFor(seed).landmarks.find((l) => l.type === "talus")!)
      .filter((l) => !l.carved);
    expect(found.length, "the named seeds no longer find a talus — re-scan").toBe(4);
    for (const lm of found) {
      // The disc it was scored on sits a disc radius away, and its own fill is
      // what made it found — measured here on the composed, masked world.
      expect(Math.hypot(lm.discX - lm.x, lm.discZ - lm.z)).toBeCloseTo(LANDMARK_DISC_RADIUS, 6);
    }
    // The predicate that made each one FOUND is scored at the disc, not the
    // foot: assert it actually holds there on the real, composed field.
    // Measured: fill 0.724 (seeds 0, 2), 0.759 (seeds 1, 6), all >= LANDMARK_FILL.
    for (let i = 0; i < namedSeeds.length; i++) {
      const seed = namedSeeds[i]!;
      const lm = found[i]!;
      expect(lm.carved, `seed ${seed} found talus is carved`).toBe(false);
      expect(fill(seed, lm.discX, lm.discZ, (x, z) => clutterDensity(seed, CLUTTER_BOULDER, x, z) >= 0.5), `seed ${seed} talus disc fill`)
        .toBeGreaterThanOrEqual(LANDMARK_TUNABLES.LANDMARK_FILL!);
    }
  });

  it("keeps every landmark LANDMARK_SPACING apart and LANDMARK_BOWL_MARGIN inside the region", () => {
    expect(LANDMARK_BOWL_MARGIN).toBeGreaterThanOrEqual(LANDMARK_DISC_RADIUS + LANDMARK_DISC_FADE);
    for (const seed of SEEDS) {
      const { landmarks } = bowlFor(seed);
      for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i]!;
        // The margin is STRUCTURAL — `rankCandidates` never scores a cell
        // outside it, at any spacing tier — so the whole footprint (the
        // 30 + 10 m disc) lies inside `inBowl`, the only gate the composer
        // applies.
        const { u } = roadFrameAt(seed, lm.x, lm.z);
        expect(u - BOWL_U_MIN, `seed ${seed} ${lm.type} u-min`).toBeGreaterThanOrEqual(LANDMARK_BOWL_MARGIN - 1e-6);
        expect(BOWL_U_MAX - u, `seed ${seed} ${lm.type} u-max`).toBeGreaterThanOrEqual(LANDMARK_BOWL_MARGIN - 1e-6);
        expect(BOWL_Z_HALF - Math.abs(lm.z - TRAIL_Z_ANCHOR), `seed ${seed} ${lm.type} z`).toBeGreaterThanOrEqual(LANDMARK_BOWL_MARGIN - 1e-6);
        // The spacing is a PREFERENCE, not a structural rule: where a seed's
        // reachable, far-enough, inside-the-margin cells run out, the builder
        // halves it and then drops it rather than fail to build the world
        // (trailBuild.ts). It holds outright on all five of these seeds.
        for (let j = i + 1; j < landmarks.length; j++) {
          expect(Math.hypot(lm.x - landmarks[j]!.x, lm.z - landmarks[j]!.z), `seed ${seed} ${lm.type} vs ${landmarks[j]!.type}`)
            .toBeGreaterThanOrEqual(LANDMARK_SPACING - 1e-6);
        }
      }
    }
  });

  it("declares its tunables, exhaustively", () => {
    // Exhaustive, like trail.test.ts's and bowl.test.ts's: every number that
    // moves a landmark moves the carved field, hence the level id.
    //
    // 2026-09-11: FORK_COUNT/OVERLOOK/CLEARING removed,
    // FEATURE_TUNABLES folded (into olympic.ts's own tunables record, not
    // here — the peak's own tunables live in features.ts), LANDMARK_MIN_PATH
    // -> LANDMARK_SCENERY_MIN_PATH (a landmark is scenery now, not a trail
    // end). The list drops from 20 keys to 15: OVERLOOK_RISE,
    // OVERLOOK_DOME_RADIUS, OVERLOOK_DOME_HEIGHT, CLEARING_TREE_MAX and
    // CLEARING_H_MIN go with the overlook and the clearing.
    const keys = [
      "LANDMARK_DISC_RADIUS", "LANDMARK_DISC_FADE", "LANDMARK_FILL",
      "STAND_BOOST", "TALUS_BOOST", "LANDMARK_SCAN_STEP",
      "STAND_TREE_MIN", "TALUS_BOULDER_MIN",
      "STAND_CARVED_DENSITY", "TALUS_CARVED_DENSITY", "LANDMARK_BOWL_MARGIN",
      "LANDMARK_SCENERY_MIN_PATH", "LANDMARK_SPACING", "LANDMARK_CANDIDATE_STRIDE", "LANDMARK_TRIES",
    ];
    for (const k of keys) expect(LANDMARK_TUNABLES[k], k).toBeTypeOf("number");
    expect(Object.keys(LANDMARK_TUNABLES).sort()).toEqual([...keys].sort());
    expect(Object.keys(LANDMARK_TUNABLES).length).toBe(15);
  });
});

describe("mask primitives", () => {
  const carvedTalus: Landmark = { type: "talus", x: 500, z: 0, carved: true, discX: 530, discZ: 0 };
  const carvedStand: Landmark = { type: "stand", x: 0, z: 900, carved: true, discX: 0, discZ: 900 };
  const found: Landmark = { type: "stand", x: 900, z: 900, carved: false, discX: 900, discZ: 900 };

  it("boosts boulders inside a carved talus and trees inside a carved stand, and leaves a found one alone", () => {
    expect(landmarkMaskAt([carvedTalus], 500, 0).boulder).toBeGreaterThan(1);
    expect(landmarkMaskAt([carvedTalus], 500, 0).boulderFloor).toBeGreaterThanOrEqual(0.5);
    expect(landmarkMaskAt([carvedStand], 0, 900).treeFloor).toBeGreaterThanOrEqual(0.9);
    expect(landmarkMaskAt([carvedStand], 0, 900).tree).toBeGreaterThan(1);
    expect(landmarkMaskAt([carvedStand], 200, 900).treeFloor).toBe(0);
    expect(landmarkMaskAt([found], 900, 900)).toEqual({ tree: 1, boulder: 1, treeFloor: 0, boulderFloor: 0 });
  });
});
