import { afterEach, describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import {
  createForest,
  GEN_VERSION,
  passHash,
  probeDigest,
  registryDigest,
} from "../../src/sim/forest.js";
import { registerPass, registeredPasses, type Pass } from "../../src/sim/chunk.js";

const PRE_BENCH_LEVEL_ID_1234 = "forest/5/olympic/1234/1586030448/-1513056523";

describe("createForest", () => {
  it("derives a stable levelId", () => {
    expect(createForest(1234).levelId).toBe(createForest(1234).levelId);
  });

  it("moved its level id with the trail bench release", () => {
    // The id before the bench: TRAIL_BED_HALF 1, no sink, eight clutter classes.
    // Pinned so a future retune cannot slide back to it unnoticed.
    expect(createForest(1234).levelId).not.toBe(PRE_BENCH_LEVEL_ID_1234);
  });

  it("gives different seeds different levelIds", () => {
    expect(createForest(1).levelId).not.toBe(createForest(2).levelId);
  });

  it("fits the Welcome event's 255-byte levelId slot", () => {
    // The slot is uint8 length-prefixed, so anything longer is silently
    // truncated by the codec and the agreement check becomes meaningless.
    for (const seed of [0, -2147483648, 2147483647, 1234567]) {
      const id = createForest(seed).levelId;
      expect(new TextEncoder().encode(id).length).toBeLessThan(255);
    }
  });

  it("names the generator version, so version skew is detectable", () => {
    // The realistic desync is not float divergence, it is one peer on a bundle
    // cached from before a deploy generating a different forest.
    expect(createForest(7).levelId.startsWith(`forest/${GEN_VERSION}/`)).toBe(true);
  });

  it("changes the field hash when the field changes", () => {
    const a = createForest(11).fieldHash;
    const b = createForest(12).fieldHash;
    expect(a).not.toBe(b);
    expect(Number.isInteger(a)).toBe(true);
  });

  it("exposes a grid that has generated nothing yet", () => {
    expect(createForest(3).grid.generatedCount()).toBe(0);
  });

  it("carries the pass hash in the levelId", () => {
    // Split from the field hash rather than folded into it, so a mismatch report
    // says which half differs: the fields, or the passes built on them.
    expect(createForest(7).levelId.endsWith(`/${passHash()}`)).toBe(true);
  });
});

describe("terrain variants in the level id", () => {
  afterEach(() => setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT));

  it("names the active variant", () => {
    // The default is olympic, so a fresh world's id says so on the wire…
    expect(createForest(1).levelId).toContain("/olympic/");
    // …and switching back to montane restores the previous id shape.
    setActiveTerrainVariant("montane");
    expect(createForest(7).levelId).toContain("/montane/");
  });

  it("changes the id — and the pass hash — when the variant changes", () => {
    const olympicId = createForest(7).levelId;
    const olympicPasses = createForest(7).passHash;
    setActiveTerrainVariant("plain");
    const plainForest = createForest(7);
    expect(plainForest.levelId).not.toBe(olympicId);
    expect(plainForest.levelId).toContain("/plain/");
    // The passHash cache is keyed on the variant name; a stale cache would
    // return olympic's digest here and desync peers silently.
    expect(plainForest.passHash).not.toBe(olympicPasses);
  });
});

/**
 * `fieldHash` samples the elevation field at fixed coordinates, so on its own it
 * cannot see a change to anything a pass builds on top of it. Two peers on
 * bundles that differ only in a feature pass would advertise the same levelId and
 * then disagree about the world — silently, because nothing checks geometry again
 * after the handshake.
 *
 * `passHash` closes that by digesting what the passes actually emit over a fixed
 * probe. The probe is fixed rather than taken at the player's own seed so the
 * digest is a property of the build, not of where anybody started.
 *
 * The coverage check below is what makes the probe trustworthy instead of merely
 * assumed. Today it is easy to satisfy: one field-sampling pass writes every cell
 * of every probe chunk, so removing it must move the digest unless the field is
 * identically zero there. It stays because it stops being easy the moment feature
 * passes return at id 6 and above — those fire at sites, not everywhere, and
 * whether this window contains one of their sites is exactly what this asks.
 */
describe("passHash", () => {
  it("is stable and does not depend on the world seed", () => {
    expect(createForest(11).passHash).toBe(createForest(9999).passHash);
    expect(Number.isInteger(passHash())).toBe(true);
  });

  // The load-bearing assertion. If the probe stopped containing a pass's output,
  // that pass could be changed without changing any levelId, which is the exact
  // failure this hash exists to prevent.
  it.each(registeredPasses().map((p) => [p.name, p] as const))(
    "would change if pass %s emitted something different",
    (_name, pass) => {
      const all = registeredPasses();
      const without = all.filter((p) => p !== pass);
      expect(probeDigest(without)).not.toBe(probeDigest(all));
    },
  );

  // The wiring guard. `it.each` above is built from `registeredPasses()` at
  // collection time, so a pass whose `passes/index.ts` import was dropped
  // just silently disappears from that list instead of failing it — proven
  // by mutation-testing pass 7's index.ts import while implementing it.
  // This list is the wiring manifest: adding a pass
  // legitimately means extending it here, and that prompt is the point.
  it("registers exactly the wired passes — an index.ts import cannot be dropped silently", () => {
    expect(registeredPasses().map((p) => [p.id, p.name])).toEqual([
      [1, "elevation"],
      [6, "trees"],
      [7, "clutter"],
      [8, "trailhead"],
      [9, "signs"],
    ]);
  });

  it("digests pass output only, so the coverage check above cannot pass vacuously", () => {
    // If probeDigest mixed in pass ids or names, omitting a pass would change it
    // whether or not that pass emitted anything into the probe, and every case
    // above would pass while proving nothing.
    const all = registeredPasses();
    const renamed = all.map((p) => ({ ...p, name: `${p.name}-renamed`, id: p.id + 100 }));
    expect(probeDigest(renamed)).toBe(probeDigest(all));
  });
});

/**
 * Why declared tunables exist, on top of the output digest.
 *
 * A digest over emitted geometry can only see a constant it changes something
 * about. Measured on the retired ramp pass: raising RAMP_CHANCE from 0.16 to 0.17
 * moved nothing in the digest, and enlarging the probe from 4 chunks to 36 did not
 * fix it. The gate rolled once per plateau-edge cell, and plateau edges were rare —
 * 93 rolls across the 4-chunk probe, 335 across 36 — so a one-point change in the
 * threshold was expected to flip well under one of them. That is a floor set by the
 * feature's rarity, not by probe size, and no affordable probe clears it.
 *
 * Declaring the constants sidesteps the sampling problem: their values are hashed
 * directly, so tuning one is caught exactly. The two mechanisms cover each other —
 * the digest catches logic changes and constants nobody declared, the declaration
 * catches thresholds too rare to sample.
 */
describe("registryDigest", () => {
  const base: Pass[] = [
    { id: 1, name: "a", tunables: { X: 1 }, run: () => undefined },
    { id: 2, name: "b", tunables: { Y: 2, Z: 3 }, run: () => undefined },
  ];

  it("distinguishes an added pass", () => {
    expect(
      registryDigest([...base, { id: 3, name: "c", tunables: { W: 4 }, run: () => undefined }]),
    ).not.toBe(registryDigest(base));
  });

  it("distinguishes a renamed pass", () => {
    expect(
      registryDigest([
        base[0] as Pass,
        { id: 2, name: "b2", tunables: { Y: 2, Z: 3 }, run: () => undefined },
      ]),
    ).not.toBe(registryDigest(base));
  });

  it("distinguishes a renumbered pass", () => {
    expect(
      registryDigest([
        base[0] as Pass,
        { id: 9, name: "b", tunables: { Y: 2, Z: 3 }, run: () => undefined },
      ]),
    ).not.toBe(registryDigest(base));
  });

  it("distinguishes a retuned constant, however small the change", () => {
    // The case the output digest provably cannot see.
    expect(
      registryDigest([
        base[0] as Pass,
        { id: 2, name: "b", tunables: { Y: 2.0001, Z: 3 }, run: () => undefined },
      ]),
    ).not.toBe(registryDigest(base));
  });

  it("distinguishes a renamed constant", () => {
    expect(
      registryDigest([
        base[0] as Pass,
        { id: 2, name: "b", tunables: { Y2: 2, Z: 3 }, run: () => undefined },
      ]),
    ).not.toBe(registryDigest(base));
  });

  it("ignores the order constants are declared in", () => {
    // Reordering a literal is not a behaviour change, and refusing peers over one
    // would train people to distrust the check.
    expect(
      registryDigest([
        base[0] as Pass,
        { id: 2, name: "b", tunables: { Z: 3, Y: 2 }, run: () => undefined },
      ]),
    ).toBe(registryDigest(base));
  });
});

describe("passHash caching", () => {
  // Registered last so it cannot disturb the coverage cases above, which are
  // collected before any test body runs.
  it("notices a pass registered after the hash was first taken", () => {
    const before = passHash();
    registerPass({ id: 9998, name: "late", tunables: { LATE: 1 }, run: () => undefined });
    // The cost of computing this is why it is cached at all; caching it without a
    // key would make a late registration silently invisible, which is the failure
    // the hash exists to prevent.
    expect(passHash()).not.toBe(before);
  });
});

describe("declared tunables", () => {
  it.each(registeredPasses().map((p) => [p.name, p] as const))(
    "pass %s declares the constants that steer it",
    (_name, pass) => {
      // Not provable — nothing can enumerate a module's private constants from
      // outside. It forces the question to be answered when a pass is written,
      // which is the only point at which the answer is known.
      expect(Object.keys(pass.tunables).length).toBeGreaterThan(0);
      for (const v of Object.values(pass.tunables)) expect(Number.isFinite(v)).toBe(true);
    },
  );
});
