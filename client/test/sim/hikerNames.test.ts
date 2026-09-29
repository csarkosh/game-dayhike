import { describe, expect, it } from "vitest";
import { FIRST_NAMES, HIKER_FIRST_NAMES, LAST_NAMES, hikerNames } from "../../src/sim/hikerNames.js";
import { seedFromToken } from "../../src/game/seed.js";

describe("hikerNames", () => {
  it("draws the same names for the same seed and different ones for another", () => {
    const a = hikerNames(1234, 4);
    const b = hikerNames(1234, 4);
    const c = hikerNames(4321, 4);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(4);
  });

  it("never repeats a surname within one book", () => {
    for (let seed = 0; seed < 200; seed++) {
      const names = hikerNames(seed, 4);
      const surnames = names.map((n) => n.split(" ")[1]);
      expect(new Set(surnames).size).toBe(4);
    }
  });

  it("draws first names from the sixteen and surnames from the table", () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const name of hikerNames(seed, 4)) {
        const [first, last] = name.split(" ");
        expect(HIKER_FIRST_NAMES).toContain(first);
        expect(LAST_NAMES).toContain(last);
      }
    }
  });

  it("keeps the sixteen in the order the full table has them", () => {
    expect(HIKER_FIRST_NAMES).toEqual([
      "Owen", "Miles", "Elias", "Theo", "Hugh", "Silas", "Reuben", "Abel",
      "Cyrus", "Jonah", "Felix", "Amos", "Rafe", "Boyd", "Callum", "Ansel",
    ]);
    expect(FIRST_NAMES.filter((n) => HIKER_FIRST_NAMES.includes(n))).toEqual([...HIKER_FIRST_NAMES]);
    expect(FIRST_NAMES).toHaveLength(32);
  });

  it("names the hikers of known worlds", () => {
    expect(hikerNames(seedFromToken("hollow"), 1)).toEqual(["Hugh Kowalski"]);
    expect(hikerNames(1234, 1)).toEqual(["Silas Brandt"]);
    expect(hikerNames(77, 4)).toEqual(["Hugh Brandt", "Callum Okafor", "Hugh Lindqvist", "Felix Mbeki"]);
    expect(hikerNames(12345, 1)).toEqual(["Abel Quennell"]);
  });
});
