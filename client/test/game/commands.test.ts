// client/test/game/commands.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  parseCommandLine,
  resolveTypedArgs,
  validateCommand,
  findCommand,
  registerTerrainVariants,
  RETIRED_COMMANDS,
} from "../../src/game/commands.js";
import { parseScript } from "../../src/game/script.js";

describe("parseCommandLine", () => {
  it("splits a name from its arguments", () => {
    expect(parseCommandLine("/seed epic-panda-fun")).toEqual({
      name: "seed",
      args: ["epic-panda-fun"],
    });
  });

  it("treats the leading slash as optional", () => {
    expect(parseCommandLine("freecam")).toEqual({ name: "freecam", args: [] });
  });

  it("normalises whitespace", () => {
    expect(parseCommandLine("  /time   7  ")).toEqual({ name: "time", args: ["7"] });
  });

  it("returns null for a bare slash", () => {
    expect(parseCommandLine("/")).toBeNull();
    expect(parseCommandLine("   ")).toBeNull();
  });
});

describe("validateCommand", () => {
  beforeEach(() => registerTerrainVariants([]));

  it("rejects an unregistered name and says which", () => {
    const err = validateCommand({ name: "bogus", args: [] });
    expect(err).toContain("bogus");
  });

  it("accepts seed tokens that are words, not numbers", () => {
    expect(validateCommand({ name: "seed", args: ["epic-panda-fun"] })).toBeNull();
    expect(validateCommand({ name: "seed", args: ["42asf134"] })).toBeNull();
  });

  it("rejects a seed with no argument, or an over-long one", () => {
    expect(validateCommand({ name: "seed", args: [] })).not.toBeNull();
    expect(validateCommand({ name: "seed", args: ["x".repeat(65)] })).not.toBeNull();
  });

  it("rejects a seed token containing the entry delimiter", () => {
    // A `;` would split into two entries on the next parse, silently changing
    // the script rather than failing.
    expect(validateCommand({ name: "seed", args: ["a;b"] })).not.toBeNull();
  });

  it("bounds the hour to a day", () => {
    expect(validateCommand({ name: "time", args: ["5"] })).toBeNull();
    expect(validateCommand({ name: "time", args: ["23.99"] })).toBeNull();
    expect(validateCommand({ name: "time", args: ["24"] })).not.toBeNull();
    expect(validateCommand({ name: "time", args: ["-1"] })).not.toBeNull();
    expect(validateCommand({ name: "time", args: ["noon"] })).not.toBeNull();
  });

  it("accepts a toggle bare or with on/off, and nothing else", () => {
    expect(validateCommand({ name: "freecam", args: [] })).toBeNull();
    expect(validateCommand({ name: "freecam", args: ["on"] })).toBeNull();
    expect(validateCommand({ name: "freecam", args: ["off"] })).toBeNull();
    expect(validateCommand({ name: "freecam", args: ["yes"] })).not.toBeNull();
  });

  it("rejects any terrain variant while none are registered, and lists them once they are", () => {
    expect(validateCommand({ name: "terrain", args: ["montane"] })).not.toBeNull();
    registerTerrainVariants(["montane", "ridged"]);
    expect(validateCommand({ name: "terrain", args: ["montane"] })).toBeNull();
    expect(validateCommand({ name: "terrain", args: ["nope"] })).toContain("montane");
  });
});

describe("command kinds", () => {
  it("classifies world entries, which are resolved rather than dispatched", () => {
    expect(findCommand("seed")?.kind).toBe("world");
    expect(findCommand("terrain")?.kind).toBe("world");
    expect(findCommand("debug")?.kind).toBe("world");
    expect(findCommand("freecam")?.kind).toBe("view");
    expect(findCommand("wireframe")?.kind).toBe("view");
    expect(findCommand("time")?.kind).toBe("view");
  });

  it("declares debug as a world entry that takes no argument", () => {
    const spec = findCommand("debug");
    expect(spec?.kind).toBe("world");
    expect(spec?.validate([])).toBeNull();
    expect(spec?.validate(["on"])).not.toBeNull();
  });
});

describe("script values", () => {
  it("treats a bare toggle in a script as enable, not flip", () => {
    // The rule that makes a shared link describe a state rather than invert it.
    expect(findCommand("freecam")?.scriptValue?.([])).toBe(true);
    expect(findCommand("freecam")?.scriptValue?.(["off"])).toBe(false);
  });

  it("reports the default at which an entry is dropped from the URL", () => {
    expect(findCommand("freecam")?.defaultValue).toBe(false);
    expect(findCommand("time")?.scriptValue?.(["7.5"])).toBe(7.5);
  });
});

describe("resolveTypedArgs", () => {
  it("flips a bare toggle typed into the bar", () => {
    // The half that was missing: typing "/wireframe" twice used to leave it on,
    // because a bare entry means enable and the typed path reused that reading.
    expect(resolveTypedArgs("wireframe", [], false)).toEqual([]);
    expect(resolveTypedArgs("wireframe", [], true)).toEqual(["off"]);
  });

  it("returns the flip in the script's own dialect, so the URL stays canonical", () => {
    // Enable is the bare spelling rather than "on", which is what keeps the URL
    // reading "?cmd=freecam" and keeps re-applying it idempotent.
    const enable = resolveTypedArgs("freecam", [], false);
    expect(findCommand("freecam")?.scriptValue?.(enable)).toBe(true);
    const disable = resolveTypedArgs("freecam", [], true);
    expect(findCommand("freecam")?.scriptValue?.(disable)).toBe(false);
  });

  it("leaves an explicit on or off absolute, whatever the current state", () => {
    expect(resolveTypedArgs("freecam", ["on"], true)).toEqual(["on"]);
    expect(resolveTypedArgs("freecam", ["off"], false)).toEqual(["off"]);
  });

  it("passes non-toggle commands through untouched", () => {
    expect(resolveTypedArgs("time", ["7"], true)).toEqual(["7"]);
    expect(resolveTypedArgs("seed", ["epic-panda-fun"], true)).toEqual(["epic-panda-fun"]);
  });
});

describe("/weather", () => {
  it("accepts each preset name and bare (which reports state)", () => {
    for (const name of ["clear", "overcast", "mist", "rain"]) {
      expect(validateCommand({ name: "weather", args: [name] })).toBeNull();
    }
    expect(validateCommand({ name: "weather", args: [] })).toBeNull();
  });
  it("rejects unknown states and extra arguments", () => {
    expect(validateCommand({ name: "weather", args: ["sunny"] })).not.toBeNull();
    expect(validateCommand({ name: "weather", args: ["mist", "rain"] })).not.toBeNull();
  });
});

describe("retired commands", () => {
  it("style is retired and an old URL carrying it parses without an error", () => {
    expect(RETIRED_COMMANDS).toContain("style");
    expect(findCommand("style")).toBeUndefined();
    const { entries, errors } = parseScript("time 17;style cel;weather mist");
    expect(errors).toEqual([]);
    expect(entries.map((e) => e.name)).toEqual(["time", "weather"]);
  });
});

describe("/volume", () => {
  it("accepts levels in [0, 1] and rejects everything else", () => {
    expect(validateCommand({ name: "volume", args: ["0.5"] })).toBeNull();
    expect(validateCommand({ name: "volume", args: ["0"] })).toBeNull();
    expect(validateCommand({ name: "volume", args: ["1"] })).toBeNull();
    expect(validateCommand({ name: "volume", args: ["1.5"] })).not.toBeNull();
    expect(validateCommand({ name: "volume", args: [] })).not.toBeNull();
    expect(validateCommand({ name: "volume", args: ["loud"] })).not.toBeNull();
  });

  it("has no scriptValue or defaultValue, so it is never URL-representable", () => {
    // "Not persisted": app.ts skips persist() for volume and this is
    // the machinery that must never let it back in — setEntry() only omits or
    // writes an entry by consulting these two, and a script/URL round trip
    // should never come to depend on a volume value it never had.
    const spec = findCommand("volume");
    expect(spec?.scriptValue).toBeUndefined();
    expect(spec?.defaultValue).toBeUndefined();
  });
});

describe("time command", () => {
  it("keeps its default in step with the renderer's", async () => {
    // Two defaults that must agree: `commands.ts` omits `time` from the URL at
    // this value, and `lighting.ts` starts there. If they drift, a fresh URL and
    // an explicit `time 12` produce different scenes.
    const { DEFAULT_HOUR } = await import("../../src/game/lighting.js");
    expect(findCommand("time")?.defaultValue).toBe(DEFAULT_HOUR);
  });

  it("accepts the ends of its range and rejects outside it", () => {
    expect(validateCommand({ name: "time", args: ["0"] })).toBeNull();
    expect(validateCommand({ name: "time", args: ["23.99"] })).toBeNull();
    expect(validateCommand({ name: "time", args: ["24"] })).not.toBeNull();
    expect(validateCommand({ name: "time", args: ["-1"] })).not.toBeNull();
    expect(validateCommand({ name: "time", args: [] })).not.toBeNull();
  });

  it("does not flip when typed bare, because it is not a toggle", () => {
    // resolveTypedArgs only rewrites commands whose defaultValue is boolean.
    expect(resolveTypedArgs("time", ["5"], false)).toEqual(["5"]);
  });
});

describe("/skin", () => {
  it("is a view toggle that defaults ON", () => {
    const spec = findCommand("skin");
    expect(spec?.kind).toBe("view");
    expect(spec?.validate([])).toBeNull();
    expect(spec?.validate(["off"])).toBeNull();
    expect(spec?.validate(["maybe"])).toMatch(/on|off/);
    expect(spec?.scriptValue?.([])).toBe(true);
    expect(spec?.scriptValue?.(["off"])).toBe(false);
    expect(spec?.defaultValue).toBe(true);
  });

  it("a bare typed /skin flips: on → off, off → on", () => {
    expect(resolveTypedArgs("skin", [], true)).toEqual(["off"]);
    expect(resolveTypedArgs("skin", [], false)).toEqual([]);
  });
});
