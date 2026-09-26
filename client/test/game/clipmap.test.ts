import { describe, it, expect, beforeAll, afterEach } from "vitest";
import "../../src/sim/passes/index.js";
import {
  elevationSampleAt,
  registerTerrainVariant,
  setActiveTerrainVariant,
} from "../../src/sim/terrain.js";
import {
  BASE_SPACING,
  blendWeight,
  coarseHeight,
  createRingSamples,
  HALF_SIDE,
  HOLE_CELLS,
  holeCellsFor,
  liftedHeight,
  RING_CELLS,
  RING_COUNT,
  ringGeometry,
  ringSpacing,
  snapOrigin,
  updateRingSamples,
  WEIGHTS2_STRIDE,
} from "../../src/game/clipmap.js";
import { classifySurface, GRASS_SLOPE, SCREE_SLOPE, snowLineAt, surfaceAlbedo } from "../../src/game/terrainSurface.js";
import { groundCover } from "../../src/sim/clutter.js";
import { forestDensity, treesInRect } from "../../src/sim/vegetation.js";

const SEED = 0x717e;
const SIDE = RING_CELLS + 1;

describe("snapOrigin", () => {
  it("snaps to twice the ring's own spacing and stays near the camera", () => {
    for (const spacing of [1, 2, 4, 8, 16, 32, 64]) {
      for (const cam of [0, 13.7, -211.4, 5081.2, -99871.6]) {
        const o = snapOrigin(cam, spacing);
        // Math.abs: a negative origin's modulo is -0, and toBe uses Object.is.
        expect(Math.abs(o % (2 * spacing))).toBe(0);
        // The ring [o, o + 128·s] must contain the camera comfortably.
        expect(cam - o).toBeGreaterThanOrEqual((RING_CELLS / 2 - 2) * spacing);
        expect(cam - o).toBeLessThanOrEqual((RING_CELLS / 2 + 2) * spacing);
      }
    }
  });
});

describe("createRingSamples", () => {
  it("stores the exact field at every vertex", () => {
    const ring = createRingSamples(SEED, 2, 37.1, -19.8);
    for (const [ix, iz] of [[0, 0], [7, 3], [128, 128], [64, 100]] as const) {
      const x = ring.originX + ix * ring.spacing;
      const z = ring.originZ + iz * ring.spacing;
      const s = elevationSampleAt(SEED, x, z);
      expect(ring.h[iz * SIDE + ix]).toBe(Math.fround(s.h));
    }
  });

  it("stores the exact field on the half-lattice, and the vertex sample in both arrays", () => {
    const ring = createRingSamples(SEED, 2, 37.1, -19.8);
    expect(ring.hh.length).toBe(HALF_SIDE * HALF_SIDE);
    const half = ring.spacing / 2;
    // Odd points are midpoints and cell centres: exact field there.
    for (const [jx, jz] of [[1, 0], [0, 1], [1, 1], [255, 254], [128, 129], [77, 201]] as const) {
      const s = elevationSampleAt(SEED, ring.originX + jx * half, ring.originZ + jz * half);
      expect(ring.hh[jz * HALF_SIDE + jx]).toBe(Math.fround(s.h));
    }
    // Even-even points ARE the vertices: one sample, two arrays, equal bits.
    for (const [ix, iz] of [[0, 0], [7, 3], [128, 128], [64, 100]] as const) {
      expect(ring.hh[2 * iz * HALF_SIDE + 2 * ix]).toBe(ring.h[iz * SIDE + ix]);
    }
  });
});

describe("updateRingSamples", () => {
  it("does nothing while the camera stays inside the snap cell", () => {
    const ring = createRingSamples(SEED, 0, 10, 10);
    expect(updateRingSamples(ring, SEED, 10.4, 10.9)).toBe(false);
  });

  it("scrolls to exactly what a fresh build at the new camera produces", () => {
    // THE clipmap test. The scroll path copies surviving samples by index and
    // fills only new strips; any off-by-one in the shift produces terrain that
    // is subtly wrong one column wide, invisible to every other assertion here.
    for (const [dx, dz] of [[7, 0], [0, -9], [23, 41], [-300, 2]] as const) {
      const scrolled = createRingSamples(SEED, 1, 100, -50);
      const changed = updateRingSamples(scrolled, SEED, 100 + dx, -50 + dz);
      const fresh = createRingSamples(SEED, 1, 100 + dx, -50 + dz);
      if (changed) {
        expect(scrolled.originX).toBe(fresh.originX);
        expect(scrolled.originZ).toBe(fresh.originZ);
        expect(scrolled.h).toEqual(fresh.h);
        expect(scrolled.dx).toEqual(fresh.dx);
        expect(scrolled.dz).toEqual(fresh.dz);
        expect(scrolled.colors).toEqual(fresh.colors);
        expect(scrolled.hh).toEqual(fresh.hh);
        expect(scrolled.weights).toEqual(fresh.weights);
        expect(scrolled.weights2).toEqual(fresh.weights2);
        expect(scrolled.cover).toEqual(fresh.cover);
      }
    }
  });
});

describe("ring nesting", () => {
  it("the finer ring's footprint is whole cells of the coarser, strictly interior", () => {
    // holeCellsFor reads only origins and spacing, so stub rings with real
    // snapped origins test the same property without 36 × 16.6k field samples.
    const stub = (level: number, cx: number, cz: number) => ({
      level,
      spacing: ringSpacing(level),
      originX: snapOrigin(cx, ringSpacing(level)),
      originZ: snapOrigin(cz, ringSpacing(level)),
      h: new Float32Array(0),
      hh: new Float32Array(0),
      dx: new Float32Array(0),
      dz: new Float32Array(0),
      colors: new Float32Array(0),
      weights: new Float32Array(0),
      weights2: new Float32Array(0),
      cover: new Float32Array(0),
    });
    for (let level = 1; level < RING_COUNT; level++) {
      for (const [cx, cz] of [[0, 0], [777.3, -412.9], [-6001.2, 3987.4]] as const) {
        const ring = stub(level, cx, cz);
        const finer = stub(level - 1, cx, cz);
        const hole = holeCellsFor(ring, finer);
        expect(Number.isInteger(hole.x0)).toBe(true);
        expect(Number.isInteger(hole.z0)).toBe(true);
        expect(hole.x0).toBeGreaterThan(0);
        expect(hole.z0).toBeGreaterThan(0);
        expect(hole.x0 + HOLE_CELLS).toBeLessThan(RING_CELLS);
        expect(hole.z0 + HOLE_CELLS).toBeLessThan(RING_CELLS);
      }
    }
  });
});

describe("ringGeometry", () => {
  it("cuts the hole out of the index buffer and nothing else", () => {
    const ring = createRingSamples(SEED, 3, 0, 0);
    const finer = createRingSamples(SEED, 2, 0, 0);
    const hole = holeCellsFor(ring, finer);
    const g = ringGeometry(ring, hole, null);
    expect(g.indices.length).toBe((RING_CELLS * RING_CELLS - HOLE_CELLS * HOLE_CELLS) * 6);
    const full = ringGeometry(createRingSamples(SEED, 0, 0, 0), null, null);
    expect(full.indices.length).toBe(RING_CELLS * RING_CELLS * 6);
  });

  it("winds every triangle so Babylon's computed normal faces upward", () => {
    // Babylon is LEFT-handed: reversed winding back-face culls the whole
    // terrain while everything else still draws — it renders as nothing at
    // all. The sign convention below was verified against Babylon's own
    // createNormals in the forest work; an upward face has NEGATIVE
    // right-handed cross-product y. Do not re-derive it on paper.
    const g = ringGeometry(createRingSamples(SEED, 2, 50, 50), null, null);
    const at = (i: number): [number, number, number] => [
      g.positions[i * 3] as number,
      g.positions[i * 3 + 1] as number,
      g.positions[i * 3 + 2] as number,
    ];
    let upward = 0;
    for (let t = 0; t < g.indices.length; t += 3) {
      const p0 = at(g.indices[t] as number);
      const p1 = at(g.indices[t + 1] as number);
      const p2 = at(g.indices[t + 2] as number);
      const ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
      if (ny < 0) upward++;
    }
    expect(upward).toBe(g.indices.length / 3);
  });

  it("derives unit normals from the exact analytic gradient", () => {
    const ring = createRingSamples(SEED, 0, -12.3, 44.1);
    const g = ringGeometry(ring, null, null);
    let steep = 0;
    for (let i = 0; i < SIDE * SIDE; i++) {
      const nx = g.normals[i * 3] as number;
      const ny = g.normals[i * 3 + 1] as number;
      const nz = g.normals[i * 3 + 2] as number;
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
      expect(ny).toBeGreaterThan(0);
      // Recover the gradient the normal encodes and compare to the stored one.
      expect(-nx / ny).toBeCloseTo(ring.dx[i] as number, 4);
      expect(-nz / ny).toBeCloseTo(ring.dz[i] as number, 4);
      if (Math.abs(ring.dx[i] as number) > 0.3) steep++;
    }
    // Teeth: (0,1,0) everywhere would pass the recovery check vacuously.
    expect(steep).toBeGreaterThan(0);
  });

  it("carries RGBA colours that vary across the ring", () => {
    const g = ringGeometry(createRingSamples(SEED, 4, 0, 0), null, null);
    expect(g.colors.length).toBe(SIDE * SIDE * 4);
    const seen = new Set<string>();
    for (let i = 0; i < g.colors.length; i += 4) {
      expect(g.colors[i + 3]).toBe(1);
      seen.add(`${(g.colors[i] as number).toFixed(3)},${(g.colors[i + 1] as number).toFixed(3)}`);
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it("does not swap altitude and slope when calling surfaceAlbedo", () => {
    // Ported from the deleted terrainMesh.test.ts, whose subject — the
    // `surfaceAlbedo(seed, x, z, s.h, hypot(s.dx, s.dz))` call — moved verbatim
    // into clipmap.ts and kept its capacity to be silently wrong. The test
    // above cannot stand in for this one: a swap still yields hundreds of
    // distinct colours and alpha 1, so it passes unchanged.
    //
    // Blue is the tell. FOREST_FLOOR and GRASS share blue exactly (0.06), so
    // the ground mottle never moves it; only rock (0.15), scree (0.21) or snow
    // (0.84) can. Swap the two arguments at a vertex like the one below and the
    // real altitude, 86 m, arrives as a "slope" of 86 — past ROCK_SLOPE and
    // SCREE_SLOPE by two orders of magnitude, saturating the mix to pure SCREE
    // — while the real slope, 0.012, arrives as an "altitude" 236 m below the
    // snow line. Measured: correct (0.1035, 0.1095, 0.0600) vs swapped
    // (0.2400, 0.2300, 0.2100).
    // The canopy tint moved this ring off the origin: the tint's blue (0.05)
    // differs from FOREST_FLOOR/GRASS blue (0.06), so the chosen vertex must
    // be provably bare of forest for b = 0.06 to survive. One natural guard
    // — altitude above TREELINE_HI (190 m), where forestDensity is zero by
    // construction — is unreachable here: ring 0 at the origin tops out at
    // 103.9 m, and its old anchor (103.85 m, slope 0.041) carries density
    // 0.654. The new anchor keys on the raggedness threshold instead:
    // RAG_LO/HI narrowing to 0.15/0.6 shrank the density-zero band around the
    // old camera (-100, 150) to nothing (0 qualifying vertices, was 627), so
    // camera (-600, -2000) replaces it — 130 vertices there are flat, low,
    // AND density-zero — and the search still demands density zero, with the
    // vacuity guard below re-proving it at runtime.
    const ring = createRingSamples(SEED, 0, -600, -2000);
    // Highest vertex that is too flat to earn rock, too low to earn snow, and
    // bare of forest, so any blue departure has to come from the argument
    // order.
    let at = -1;
    let altitude = -Infinity;
    for (let i = 0; i < SIDE * SIDE; i++) {
      const ix = i % SIDE;
      const iz = (i / SIDE) | 0;
      const x = ring.originX + ix * ring.spacing;
      const z = ring.originZ + iz * ring.spacing;
      const h = ring.h[i] as number;
      const slope = Math.hypot(ring.dx[i] as number, ring.dz[i] as number);
      if (
        slope < GRASS_SLOPE / 5 &&
        h < snowLineAt(SEED, x, z) - 60 &&
        forestDensity(SEED, x, z) === 0 &&
        h > altitude
      ) {
        altitude = h;
        at = i;
      }
    }
    const slope = Math.hypot(ring.dx[at] as number, ring.dz[at] as number);

    // Vacuity guards, re-measured for this ring. Measured at the chosen
    // vertex on olympic: (-603, -2024), altitude 28.84 m, slope 0.01128.
    expect(slope).toBeLessThan(GRASS_SLOPE / 5); // no rock can be legitimate
    expect(altitude).toBeGreaterThan(SCREE_SLOPE + 1); // a swap saturates it
    expect(altitude).toBeGreaterThan(9); // above COAST_FADE_END — the coastal bands would move blue below it

    const ix = at % SIDE;
    const iz = (at / SIDE) | 0;
    const x = ring.originX + ix * ring.spacing;
    const z = ring.originZ + iz * ring.spacing;
    // The canopy tint's blue (0.05) would otherwise pull the baked blue below
    // 0.06 — the same role the coastal-fade guard above plays for the shore.
    expect(forestDensity(SEED, x, z)).toBe(0);

    expect(ring.colors[at * 4 + 2]).toBeCloseTo(0.06, 5);
    // Teeth, so this cannot pass by the palette going flat: the swapped call is
    // what the assertion above must be able to reject.
    expect(surfaceAlbedo(SEED, x, z, slope, altitude).b).toBeCloseTo(0.21, 5);
  });

  it("bakes the canopy tint into forest-zone vertex colours", () => {
    // The densest vertex of ring 0 at the origin — measured: (-39, -64),
    // ρ = 1, altitude 89.6 m. The guard below keeps the pick honest.
    const ring = createRingSamples(SEED, 0, 0, 0);
    let at = -1;
    let densest = 0;
    for (let i = 0; i < SIDE * SIDE; i++) {
      const ix = i % SIDE;
      const iz = (i / SIDE) | 0;
      const rho = forestDensity(SEED, ring.originX + ix * ring.spacing, ring.originZ + iz * ring.spacing);
      if (rho > densest) {
        densest = rho;
        at = i;
      }
    }
    expect(densest).toBeGreaterThan(0.9); // vacuity guard: real forest exists here

    const ix = at % SIDE;
    const iz = (at / SIDE) | 0;
    const x = ring.originX + ix * ring.spacing;
    const z = ring.originZ + iz * ring.spacing;
    const s = elevationSampleAt(SEED, x, z);
    const slope = Math.hypot(s.dx, s.dz);
    // The baked colour is the TINTED albedo, not the bare palette: it must
    // match classifySurface fed the vertex's density and duff bit-for-bit
    // (modulo the Float32Array's rounding) and differ from the canopy-less,
    // duff-less call.
    const duff = groundCover(SEED, x, z, s).duff;
    const tinted = classifySurface(SEED, x, z, s.h, slope, densest, duff).albedo;
    const bare = surfaceAlbedo(SEED, x, z, s.h, slope);
    for (const [channel, key] of [[0, "r"], [1, "g"], [2, "b"]] as const) {
      expect(ring.colors[at * 4 + channel]).toBe(Math.fround(tinted[key]));
    }
    // Teeth: the tint genuinely moves this vertex — a sampleInto that dropped
    // the density argument would bake `bare` instead.
    expect(Math.fround(bare.g)).not.toBe(Math.fround(tinted.g));
  });
});

describe("budget", () => {
  it("stays at 7 rings totalling ~90k quads however far the view reaches", () => {
    expect(RING_COUNT).toBe(7);
    for (let level = 1; level < RING_COUNT; level++) {
      expect(ringSpacing(level)).toBe(2 * ringSpacing(level - 1));
    }
    expect(ringSpacing(0)).toBe(BASE_SPACING);
    expect(ringSpacing(RING_COUNT - 1)).toBe(64);
    const quads = RING_CELLS * RING_CELLS + (RING_COUNT - 1) * (RING_CELLS * RING_CELLS - HOLE_CELLS * HOLE_CELLS);
    expect(quads).toBeLessThan(100_000);
    // Outermost extent ~8.2 km across.
    expect(RING_CELLS * ringSpacing(RING_COUNT - 1)).toBe(8192);
  });
});

describe("terrain weight attributes", () => {
  const SEED = 0x5eed;
  const SIDE = RING_CELLS + 1;

  it("fills one weight entry per vertex, summing to 1", () => {
    const ring = createRingSamples(SEED, 0, 0, 0);
    expect(ring.weights.length).toBe(SIDE * SIDE * 4);
    expect(ring.weights2.length).toBe(SIDE * SIDE * WEIGHTS2_STRIDE);
    for (let at = 0; at < SIDE * SIDE; at += 37) {
      const sum =
        (ring.weights[at * 4] as number) +
        (ring.weights[at * 4 + 1] as number) +
        (ring.weights[at * 4 + 2] as number) +
        (ring.weights[at * 4 + 3] as number) +
        (ring.weights2[at * WEIGHTS2_STRIDE] as number);
      expect(sum, `vertex ${at}`).toBeCloseTo(1, 4);
    }
  });

  it("carries weights through a scroll instead of resampling them", () => {
    const ring = createRingSamples(SEED, 0, 0, 0);
    const before = Array.from(ring.weights.slice(0, 4));
    const beforeColors = Array.from(ring.colors.slice(0, 4));
    // Move far enough to snap the origin but keep most of the ring resident.
    const moved = updateRingSamples(ring, SEED, ring.spacing * 8, 0);
    expect(moved).toBe(true);
    // The weights buffer must be reallocated and refilled to the same length,
    // in step with colors — a scroll that forgets weights would leave stale or
    // zeroed material at the trailing edge.
    expect(ring.weights.length).toBe(SIDE * SIDE * 4);
    expect(ring.weights2.length).toBe(SIDE * SIDE * WEIGHTS2_STRIDE);
    for (let at = 0; at < SIDE * SIDE; at += 53) {
      const sum =
        (ring.weights[at * 4] as number) +
        (ring.weights[at * 4 + 1] as number) +
        (ring.weights[at * 4 + 2] as number) +
        (ring.weights[at * 4 + 3] as number) +
        (ring.weights2[at * WEIGHTS2_STRIDE] as number);
      expect(sum, `vertex ${at} after scroll`).toBeCloseTo(1, 4);
    }
    expect(before.length).toBe(4);
    expect(beforeColors.length).toBe(4);
  });

  it("emits weights from ringGeometry in the same vertex order as colors", () => {
    const ring = createRingSamples(SEED, 0, 0, 0);
    const geo = ringGeometry(ring, null, null);
    expect(geo.weights.length).toBe(SIDE * SIDE * 4);
    expect(geo.weights2.length).toBe(SIDE * SIDE * WEIGHTS2_STRIDE);
    // Vertex 0's geometry weights are vertex 0's ring weights.
    expect(geo.weights[0]).toBe(ring.weights[0]);
    expect(geo.weights2[0]).toBe(ring.weights2[0]);
    expect(geo.weights2[2]).toBe(ring.weights2[2]);
    expect(geo.weights2[3]).toBe(ring.weights2[3]);
    expect(geo.cover.length).toBe(16641);
    expect(geo.cover[102 + 4 * 129]).toBe(ring.cover[102 + 4 * 129]);
  });

  it("agrees with classifySurface, fed the ring's own canopy and duff, at the ring's own sample positions", () => {
    // Tied to classifySurface fed groundCover's own duff, rather than to a
    // captured number, so the paint and the litter pieces cannot drift apart.
    const ring = createRingSamples(SEED, 0, 0, 0);
    const ix = 40, iz = 61, at = iz * SIDE + ix;
    const x = ring.originX + ix * ring.spacing;
    const z = ring.originZ + iz * ring.spacing;
    const s = elevationSampleAt(SEED, x, z);
    const slope = Math.hypot(s.dx, s.dz);
    const canopy = forestDensity(SEED, x, z, s);
    const duff = groundCover(SEED, x, z, s).duff;
    const w = classifySurface(SEED, x, z, s.h, slope, canopy, duff).weights;
    expect(ring.weights[at * 4]).toBeCloseTo(w.grass, 6);
    expect(ring.weights[at * 4 + 1]).toBeCloseTo(w.forestFloor, 6);
    expect(ring.weights[at * 4 + 2]).toBeCloseTo(w.rock, 6);
    expect(ring.weights[at * 4 + 3]).toBeCloseTo(w.sand, 6);
    expect(ring.weights2[at * WEIGHTS2_STRIDE]).toBeCloseTo(w.pebble, 6);
    expect(ring.weights2[at * WEIGHTS2_STRIDE + 1]).toBeCloseTo(w.detail, 6);
  });

  it("carries the ground-cover duff as the third weight of every ring vertex", () => {
    const ring = createRingSamples(SEED, 0, 0, 0);
    for (let at = 0; at < SIDE * SIDE; at += 41) {
      const ix = at % SIDE;
      const iz = (at / SIDE) | 0;
      const x = ring.originX + ix * ring.spacing;
      const z = ring.originZ + iz * ring.spacing;
      const s = elevationSampleAt(SEED, x, z);
      const want = groundCover(SEED, x, z, s).duff;
      expect(ring.weights2[at * WEIGHTS2_STRIDE + 2]).toBeCloseTo(want, 6);
      expect(ring.weights2[at * WEIGHTS2_STRIDE + 1]).toBeGreaterThanOrEqual(0); // detail still second
    }
    expect(WEIGHTS2_STRIDE).toBe(4);
  });

  it("carries the canopy density the classification was fed as the fourth weight", () => {
    // The trail paint keys its canopy-only mixes on this component, so it must
    // be forestDensity at the vertex itself: 1 under full canopy, 0 in the
    // open, and the partial value at a forest edge.
    expect(WEIGHTS2_STRIDE).toBe(4);
    const ring = createRingSamples(SEED, 0, 0, 0);
    const cases: [number, number, number][] = [
      [40, 61, 1],
      [102, 4, 0],
      [77, 3, 0.6708885941871319],
    ];
    for (const [ix, iz, want] of cases) {
      const at = iz * SIDE + ix;
      const x = ring.originX + ix * ring.spacing;
      const z = ring.originZ + iz * ring.spacing;
      expect(forestDensity(SEED, x, z, elevationSampleAt(SEED, x, z)), `vertex ${ix},${iz}`).toBeCloseTo(want, 12);
      expect(ring.weights2[at * WEIGHTS2_STRIDE + 3], `vertex ${ix},${iz}`).toBeCloseTo(want, 6);
    }
  });
});

// The file's own SEED, not the weight block's: the cases below are vertices of
// that seed's ring 0 at the origin.
describe("terrain cover channel", () => {
  it("carries the ground cover's grass, clamped to 1, as the cover channel", () => {
    // The blade field's own strength, min(1, grass): the terrain's sward
    // floor keys on it, not on the grass texture weight, because half a
    // sward stands on floor-textured ground.
    const ring = createRingSamples(SEED, 0, 0, 0);
    expect(ring.cover.length).toBe(16641);
    const cases: [number, number, number][] = [
      [40, 61, 0],
      [102, 4, 0.5],
      [60, 0, 0.3087129490878816],
    ];
    for (const [ix, iz, want] of cases) {
      expect(ring.cover[iz * SIDE + ix], `vertex ${ix},${iz}`).toBeCloseTo(want, 6);
    }
    for (let at = 0; at < SIDE * SIDE; at += 97) {
      const x = ring.originX + (at % SIDE) * ring.spacing;
      const z = ring.originZ + ((at / SIDE) | 0) * ring.spacing;
      const s = elevationSampleAt(SEED, x, z);
      expect(ring.cover[at]).toBeCloseTo(Math.min(1, groundCover(SEED, x, z, s).grass), 6);
    }
  });

  it("clamps the cover at 1 where the field boosts the grass past it", () => {
    // Seed atmo (627994160), an open meadow at (369, -855) where the grass
    // reads 1.5.
    const ring = createRingSamples(627994160, 0, 369, -855);
    const ix = 369 - ring.originX, iz = -855 - ring.originZ;
    expect(ring.cover[iz * SIDE + ix]).toBe(1);
  });
});

describe("chord-excess ridge lift", () => {
  const SEED = 0x5eed1;

  beforeAll(() => {
    // Synthetic fields with a known answer. Registered here, in a file vitest
    // isolates from every other, and never activated outside these tests.
    registerTerrainVariant({
      name: "test-plane",
      tunables: {},
      sample: (_seed, x, z) => ({ h: 0.3 * x + 0.1 * z, dx: 0.3, dz: 0.1 }),
    });
    registerTerrainVariant({
      name: "test-bowl",
      tunables: {},
      // A genuine basin (convex: h grows with distance from the origin), not
      // a dome — h = -(x²+z²)/1000 would be a crest, on which the lift DOES
      // fire ("positive only on crests"). The chord between two
      // points on a convex field sits above the field (mid < chord average),
      // so the excess is negative and the max(0, …) clamp in liftedHeight
      // holds throughout — which is what this test pins.
      sample: (_seed, x, z) => ({ h: (x * x + z * z) / 1000, dx: x / 500, dz: z / 500 }),
    });
  });
  afterEach(() => setActiveTerrainVariant("olympic"));

  const yOf = (g: { positions: Float32Array }, ix: number, iz: number) => g.positions[(iz * SIDE + ix) * 3 + 1] as number;

  it("lifts nothing on a plane: exact alone, and within a millimetre when blended", () => {
    setActiveTerrainVariant("test-plane");
    const finer = createRingSamples(1, 1, 37, -19);
    const ring = createRingSamples(1, 2, 37, -19);
    const coarse = createRingSamples(1, 3, 37, -19);
    const hole = holeCellsFor(ring, finer);

    const own = ringGeometry(ring, hole, null);
    for (let iz = 0; iz <= RING_CELLS; iz++) {
      for (let ix = 0; ix <= RING_CELLS; ix++) {
        const x = ring.originX + ix * ring.spacing;
        const z = ring.originZ + iz * ring.spacing;
        // Exact: the stored sample IS fround(plane), and a zero lift keeps it.
        expect(yOf(own, ix, iz), `vertex ${ix},${iz}`).toBe(Math.fround(0.3 * x + 0.1 * z));
      }
    }

    const blended = ringGeometry(ring, hole, coarse);
    for (let iz = 0; iz <= RING_CELLS; iz++) {
      for (let ix = 0; ix <= RING_CELLS; ix++) {
        const x = ring.originX + ix * ring.spacing;
        const z = ring.originZ + iz * ring.spacing;
        // Blended: odd vertices carry the coarse ring's chord, which differs
        // from fround(plane) by float32 rounding alone — invisible, not zero.
        expect(yOf(blended, ix, iz), `vertex ${ix},${iz}`).toBeCloseTo(0.3 * x + 0.1 * z, 3);
      }
    }
  });

  it("lifts nothing in a bowl (concave chords sit above the field; the clamp holds)", () => {
    setActiveTerrainVariant("test-bowl");
    const ring = createRingSamples(1, 2, 0, 0);
    const g = ringGeometry(ring, null, null);
    for (let iz = 0; iz <= RING_CELLS; iz++) {
      for (let ix = 0; ix <= RING_CELLS; ix++) {
        const x = ring.originX + ix * ring.spacing;
        const z = ring.originZ + iz * ring.spacing;
        expect(yOf(g, ix, iz), `vertex ${ix},${iz}`).toBe(Math.fround((x * x + z * z) / 1000));
      }
    }
  });

  it("draws at or above the exact field at every interior half-lattice point", () => {
    const ring = createRingSamples(SEED, 3, 700, -300);
    const g = ringGeometry(ring, null, null); // pure own lift, as the outermost ring draws
    let below = 0;
    let lifted = 0;
    for (let jz = 1; jz < HALF_SIDE - 1; jz++) {
      for (let jx = 1; jx < HALF_SIDE - 1; jx++) {
        const ix = jx >> 1;
        const iz = jz >> 1;
        let drawn: number;
        if ((jx & 1) === 0 && (jz & 1) === 0) drawn = yOf(g, ix, iz);
        else if ((jz & 1) === 0) drawn = (yOf(g, ix, iz) + yOf(g, ix + 1, iz)) / 2;
        else if ((jx & 1) === 0) drawn = (yOf(g, ix, iz) + yOf(g, ix, iz + 1)) / 2;
        // Cell centre: on the drawn diagonal from b = (ix+1, iz) to c = (ix, iz+1).
        else drawn = (yOf(g, ix + 1, iz) + yOf(g, ix, iz + 1)) / 2;
        const exact = ring.hh[jz * HALF_SIDE + jx] as number;
        // 1 mm dead-band plus float32 rounding of the stored samples.
        if (drawn < exact - 2e-3) below++;
        if (drawn > exact + 1e-2) lifted++;
      }
    }
    expect(below).toBe(0);
    // Teeth: the lift fires on this terrain, so the check is not vacuous.
    expect(lifted).toBeGreaterThan(100);
  });

  it("blends from 0 at the hole boundary to 1 at the border, by Chebyshev cell distance", () => {
    const hole = { x0: 32, z0: 33 };
    expect(blendWeight(hole, 32, 50)).toBe(0);
    expect(blendWeight(hole, 50, 33)).toBe(0);
    expect(blendWeight(hole, 96, 50)).toBe(0); // x0 + HOLE_CELLS is still the boundary
    expect(blendWeight(hole, 0, 50)).toBe(1);
    expect(blendWeight(hole, 50, RING_CELLS)).toBe(1);
    expect(blendWeight(hole, 16, 50)).toBe(0.5); // 16 in from the hole, 16 out from the border
    expect(blendWeight(null, RING_CELLS / 2, RING_CELLS / 2)).toBe(0);
    expect(blendWeight(null, 0, 7)).toBe(1);
    expect(blendWeight(null, 32, 40)).toBe(0.5);
  });

  it("coarseHeight is the coarser ring's own lifted vertex or its chord", () => {
    const fine = createRingSamples(SEED, 1, 3.2, -8.9);
    const coarse = createRingSamples(SEED, 2, 3.2, -8.9);
    const { x0, z0 } = holeCellsFor(coarse, fine);
    expect(coarseHeight(coarse, x0, z0, 40, 60)).toBe(liftedHeight(coarse, x0 + 20, z0 + 30));
    expect(coarseHeight(coarse, x0, z0, 41, 60)).toBe(
      (liftedHeight(coarse, x0 + 20, z0 + 30) + liftedHeight(coarse, x0 + 21, z0 + 30)) / 2,
    );
    expect(coarseHeight(coarse, x0, z0, 40, 61)).toBe(
      (liftedHeight(coarse, x0 + 20, z0 + 30) + liftedHeight(coarse, x0 + 20, z0 + 31)) / 2,
    );
    // Cell centre lies on the coarse cell's drawn diagonal b–c, not a–d.
    expect(coarseHeight(coarse, x0, z0, 41, 61)).toBe(
      (liftedHeight(coarse, x0 + 21, z0 + 30) + liftedHeight(coarse, x0 + 20, z0 + 31)) / 2,
    );
  });

  it("meets its coarser neighbour watertight along all four borders, lifted", () => {
    const finer = createRingSamples(SEED, 0, 3.2, -8.9);
    const fine = createRingSamples(SEED, 1, 3.2, -8.9);
    const coarse = createRingSamples(SEED, 2, 3.2, -8.9);
    const coarser = createRingSamples(SEED, 3, 3.2, -8.9);
    const g = ringGeometry(fine, holeCellsFor(fine, finer), coarse);
    const gc = ringGeometry(coarse, holeCellsFor(coarse, fine), coarser);
    const { x0, z0 } = holeCellsFor(coarse, fine);
    let checked = 0;
    for (let iz = 0; iz <= RING_CELLS; iz++) {
      for (let ix = 0; ix <= RING_CELLS; ix++) {
        if (ix !== 0 && ix !== RING_CELLS && iz !== 0 && iz !== RING_CELLS) continue;
        const cx = x0 + (ix >> 1);
        const cz = z0 + (iz >> 1);
        const y = yOf(g, ix, iz);
        if (ix % 2 === 0 && iz % 2 === 0) {
          // Shared position: the coarse ring's EMITTED height, bit for bit.
          expect(y, `even ${ix},${iz}`).toBe(yOf(gc, cx, cz));
        } else if (iz % 2 === 0) {
          expect(y, `odd-x ${ix},${iz}`).toBe(Math.fround((liftedHeight(coarse, cx, cz) + liftedHeight(coarse, cx + 1, cz)) / 2));
        } else {
          expect(y, `odd-z ${ix},${iz}`).toBe(Math.fround((liftedHeight(coarse, cx, cz) + liftedHeight(coarse, cx, cz + 1)) / 2));
        }
        checked++;
      }
    }
    expect(checked).toBe(4 * RING_CELLS);
  });

  it("closes the far-field float tail at real tree positions, rings 3-6", () => {
    // Share of trees floating more than 2 px at each ring's inner edge, own
    // sampler. Measured 0.0-0.1% lifted vs 2.3-4.1% exact.
    // That 2.3-4.1% figure is over the larger rect used elsewhere (x ∈
    // [-200, 1400], z ∈ [-1600, 1600], all rings combined); this test's own
    // "inside" filter is a different, narrower subset (per ring, trees
    // strictly inside that ring's band), and measures about 1.4% at ring 3
    // against the 0.01 floor below — do not tighten that floor toward the
    // larger-rect number.
    const PX = (0.05 * Math.PI) / 180;
    const trees: { x: number; z: number; h: number }[] = [];
    let i = 0;
    for (let z0 = -1600; z0 < 1600; z0 += 400) {
      for (let x0 = -200; x0 < 1400; x0 += 400) {
        for (const t of treesInRect(SEED, x0, z0, x0 + 400, z0 + 400)) {
          if (i++ % 5 === 0) trees.push({ x: t.x, z: t.z, h: t.groundH });
        }
      }
    }
    const drawnAt = (vh: (ix: number, iz: number) => number, s: number, ox: number, oz: number, x: number, z: number) => {
      const fx = (x - ox) / s, fz = (z - oz) / s;
      const ix = Math.floor(fx), iz = Math.floor(fz);
      const tx = fx - ix, tz = fz - iz;
      const ha = vh(ix, iz), hb = vh(ix + 1, iz), hc = vh(ix, iz + 1), hd = vh(ix + 1, iz + 1);
      if (tx + tz <= 1) return ha + (hb - ha) * tx + (hc - ha) * tz;
      return hd + (hc - hd) * (1 - tx) + (hb - hd) * (1 - tz);
    };
    for (let level = 3; level <= 6; level++) {
      const ring = createRingSamples(SEED, level, 600, 0);
      const s = ring.spacing;
      const threshold = Math.tan(2 * PX) * (RING_CELLS / 4) * s; // 2 px at the inner edge, 32·2^L m
      let inside = 0, lifted = 0, exact = 0;
      for (const t of trees) {
        const ix = Math.floor((t.x - ring.originX) / s);
        const iz = Math.floor((t.z - ring.originZ) / s);
        if (ix < 1 || ix >= RING_CELLS - 1 || iz < 1 || iz >= RING_CELLS - 1) continue;
        inside++;
        const withLift = drawnAt((a, b) => liftedHeight(ring, a, b), s, ring.originX, ring.originZ, t.x, t.z);
        const withoutLift = drawnAt((a, b) => ring.h[b * SIDE + a] as number, s, ring.originX, ring.originZ, t.x, t.z);
        if (t.h - withLift > threshold) lifted++;
        if (t.h - withoutLift > threshold) exact++;
      }
      expect(inside, `ring ${level}`).toBeGreaterThan(500);
      expect(lifted / inside, `ring ${level} lifted`).toBeLessThan(0.002);
      // Teeth: the exact sampler fails this by an order of magnitude.
      // 0.01 -> 0.008. Loop features build now, and a meadow or a pond
      // LEVELS a disc of ground —
      // levelled ground has no teeth for the exact sampler to fail on. Ring 3's
      // own margin over this floor was always the thinnest (its band is the
      // smallest and holds the fewest trees, 1023 here): measured after the
      // change, ring 3 reads 0.00978 and rings 4-6 read 0.02384 / 0.03452 /
      // 0.04038, against a lifted sampler at 0.00000-0.00054. The control still
      // separates the two samplers by two orders of magnitude; only ring 3's
      // absolute count moved, and it moved because the field did.
      expect(exact / inside, `ring ${level} exact`).toBeGreaterThan(0.008);
    }
  }, 60000);
});
