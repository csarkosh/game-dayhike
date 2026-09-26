import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { MEADOW_NAMES, NAMES_SALT, POND_NAMES, placeNames, signSites } from "../../src/sim/placeNames.js";
import { FIRST_NAMES, hikerNames } from "../../src/sim/hikerNames.js";
import type { Feature } from "../../src/sim/features.js";
import { createWorld } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { seedFromToken } from "../../src/game/seed.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

const feature = (id: number, kind: Feature["kind"], x = 0, z = 0): Feature => ({ id, kind, x, z, radius: 40, height: 0 });

describe("placeNames", () => {
  it("draws from its own stream", () => {
    expect(NAMES_SALT).toBe(0x504c4143);
    expect(POND_NAMES).toHaveLength(6);
    expect(MEADOW_NAMES).toHaveLength(6);
  });

  it("names the ponds and meadows of the hollow world and another, and nothing else", () => {
    const hollow = seedFromToken("hollow");
    const h = bowlFor(hollow);
    expect(hikerNames(hollow, 1)[0]!.split(" ")[0]).toBe("Hugh");
    expect([...placeNames(hollow, h.features, "Hugh")]).toEqual([[1, "Old Lake"]]);
    const other = bowlFor(12345);
    expect(other.features.map((f) => f.kind)).toEqual(["peak", "pond", "meadow"]);
    expect([...placeNames(12345, other.features, "Abel")]).toEqual([[1, "Old Lake"], [2, "Felix's Meadow"]]);
  });

  it("never repeats a name and never gives a place the missing hiker's first name", () => {
    const features = [
      feature(0, "peak"),
      ...[1, 2, 3, 4, 5, 6].map((id) => feature(id, "pond")),
      ...[7, 8, 9, 10, 11, 12].map((id) => feature(id, "meadow")),
    ];
    for (let seed = 0; seed < 200; seed++) {
      const hiker = FIRST_NAMES[seed % FIRST_NAMES.length]!;
      const names = [...placeNames(seed, features, hiker).values()];
      // Every pool is used up, so both "<First>'s" names are drawn every time.
      expect(names, `seed ${seed}`).toHaveLength(12);
      expect(new Set(names).size, `seed ${seed}`).toBe(12);
      for (const n of names) {
        expect(n.startsWith(`${hiker}'s`), `seed ${seed}: ${n}`).toBe(false);
        expect(n.includes("<First>"), `seed ${seed}: ${n}`).toBe(false);
      }
    }
  });

  it("moves no other draw: the hiker's name and a fresh world's stream read the same with or without naming", () => {
    const flat = parseLevel({
      id: "flat",
      brushes: [{ min: [-60, -1, -60], max: [60, 0, 60], material: "concrete" }],
      playerSpawns: [[0, 0.9, 0]],
      enemySpawns: [],
    });
    const hollow = seedFromToken("hollow");
    const hikerBefore = hikerNames(hollow, 1);
    const streamBefore = createWorld(flat, hollow).state.rngSeed;
    placeNames(hollow, bowlFor(hollow).features, "Hugh");
    expect(hikerNames(hollow, 1)).toEqual(hikerBefore);
    expect(createWorld(flat, hollow).state.rngSeed).toBe(streamBefore);
  });
});

describe("signSites", () => {
  it("puts Summit at the body and every named pond and meadow at its centre", () => {
    const features = [feature(0, "peak", 500, 0), feature(1, "pond", 120, 60), feature(2, "meadow", 150, -80)];
    const sites = signSites(12345, features, "Abel", { x: 510, z: 4 });
    expect(sites).toEqual([
      { name: "Summit", x: 510, z: 4 },
      { name: "Old Lake", x: 120, z: 60 },
      { name: "Felix's Meadow", x: 150, z: -80 },
    ]);
  });
});
