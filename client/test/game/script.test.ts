import { describe, it, expect, beforeEach } from "vitest";
import {
  lastEntry,
  parseScript,
  serialiseScript,
  setEntry,
  splitEntries,
} from "../../src/game/script.js";
import { registerTerrainVariants } from "../../src/game/commands.js";

beforeEach(() => registerTerrainVariants(["montane"]));

describe("parseScript", () => {
  it("parses the worked example in order", () => {
    const { entries, errors } = parseScript("freecam;seed epic-panda-fun;time 5");
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { name: "freecam", args: [] },
      { name: "seed", args: ["epic-panda-fun"] },
      { name: "time", args: ["5"] },
    ]);
  });

  it("strips leading slashes, so both spellings are identical", () => {
    expect(parseScript("/freecam;/time 7").entries).toEqual(parseScript("freecam;time 7").entries);
  });

  it("skips empty entries rather than reporting them", () => {
    const { entries, errors } = parseScript("freecam;;time 7;");
    expect(entries).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it("trims entries, so surrounding spaces do not change the command", () => {
    expect(parseScript(" time 7 ; freecam ").entries).toEqual([
      { name: "time", args: ["7"] },
      { name: "freecam", args: [] },
    ]);
  });

  it("keeps the valid entries when one is invalid, and reports the bad one", () => {
    // Silently discarding would leave you believing a command took effect.
    const { entries, errors } = parseScript("freecam;bogus;wireframe");
    expect(entries.map((e) => e.name)).toEqual(["freecam", "wireframe"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("bogus");
  });

  it("rejects a registered name given bad arguments", () => {
    const { entries, errors } = parseScript("time 99");
    expect(entries).toEqual([]);
    expect(errors[0]).toContain("24");
  });

  it("accepts a terrain entry once registerTerrainVariants has run — the ordering app.ts depends on", () => {
    // Regression: app.ts originally called `registerTerrainVariants(...)`
    // fourteen lines after `parseScript`, not before it. `parseScript` calls
    // `validateCommand` on every entry as it parses (see above), so on a
    // genuinely cold page load — the only time a shared link's own `?cmd=`
    // is parsed with nothing having run yet — a `terrain` entry was rejected
    // before the registry held anything: it landed in `errors`, never
    // reached `entries`, and the world silently fell back to the default
    // with a stale "no terrain variants are registered" message in the bar.
    // This asserts the fix's precondition directly: register first, then a
    // `terrain` entry survives parsing with no error.
    registerTerrainVariants(["montane", "ridged"]);
    const { entries, errors } = parseScript("terrain ridged");
    expect(errors).toEqual([]);
    expect(entries).toEqual([{ name: "terrain", args: ["ridged"] }]);
  });
});

describe("splitEntries", () => {
  it("separates world entries from view entries", () => {
    const { entries } = parseScript("freecam;seed epic-panda-fun;time 5");
    const { world, view } = splitEntries(entries);
    expect(world.map((e) => e.name)).toEqual(["seed"]);
    expect(view.map((e) => e.name)).toEqual(["freecam", "time"]);
  });
});

describe("lastEntry", () => {
  it("resolves a repeated world entry to the last one, matching the URL", () => {
    // "seed a;seed b" must build b. Taking the first built a while the write-back
    // left the URL reading b, so the address bar described a world you were not
    // looking at.
    const { world } = splitEntries(parseScript("seed a;seed b").entries);
    expect(lastEntry(world, "seed")?.args).toEqual(["b"]);
  });

  it("is undefined when the name is absent", () => {
    const { entries } = parseScript("freecam");
    expect(lastEntry(entries, "seed")).toBeUndefined();
  });

  it("ignores entries of other names between the repeats", () => {
    const { entries } = parseScript("time 7;freecam;time 9");
    expect(lastEntry(entries, "time")?.args).toEqual(["9"]);
  });
});

describe("setEntry", () => {
  it("replaces an existing entry rather than appending it", () => {
    const { entries } = parseScript("seed one;freecam");
    const next = setEntry(entries, "seed", ["two"]);
    expect(next.filter((e) => e.name === "seed")).toHaveLength(1);
    expect(serialiseScript(next)).toBe("seed two;freecam");
  });

  it("appends an entry that is not present", () => {
    const { entries } = parseScript("freecam");
    expect(serialiseScript(setEntry(entries, "time", ["5"]))).toBe("freecam;time 5");
  });

  it("lets a later entry win over an earlier one", () => {
    // Applying in order is what makes "time 7;time 9" leave the sun at 9.
    const { entries } = parseScript("time 7;time 9");
    let folded: ReturnType<typeof setEntry> = [];
    for (const e of entries) folded = setEntry(folded, e.name, e.args);
    expect(serialiseScript(folded)).toBe("time 9");
  });

  it("removes an entry set back to its default, keeping URLs short", () => {
    const { entries } = parseScript("freecam;time 5");
    expect(serialiseScript(setEntry(entries, "freecam", ["off"]))).toBe("time 5");
  });
});

describe("weather default omission", () => {
  it("weather at its default is omitted from the URL; non-default persists", () => {
    expect(setEntry([], "weather", ["mist"])).toEqual([]);
    const kept = setEntry([], "weather", ["clear"]);
    expect(kept).toEqual([{ name: "weather", args: ["clear"] }]);
  });
});

describe("round trip", () => {
  it("survives parse, write back unchanged, and re-parse", () => {
    const raw = "freecam;seed epic-panda-fun;time 5";
    const { entries } = parseScript(raw);
    let out = entries;
    for (const e of entries) out = setEntry(out, e.name, e.args);
    expect(parseScript(serialiseScript(out)).entries).toEqual(entries);
  });

  it("applies the same script twice to the same result", () => {
    // Idempotence is what lets the script be re-applied on every
    // re-initialisation without inverting anything.
    const { entries } = parseScript("freecam;time 5");
    const once = setEntry(entries, "freecam", []);
    const twice = setEntry(once, "freecam", []);
    expect(serialiseScript(twice)).toBe(serialiseScript(once));
  });
});
