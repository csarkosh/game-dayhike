import { describe, expect, it } from "vitest";
import { FIRST_NAMES, LAST_NAMES, hikerNames } from "../../src/sim/hikerNames.js";

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

  it("draws only from the tables", () => {
    for (const name of hikerNames(77, 4)) {
      const [first, last] = name.split(" ");
      expect(FIRST_NAMES).toContain(first);
      expect(LAST_NAMES).toContain(last);
    }
  });
});
