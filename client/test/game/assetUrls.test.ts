import { describe, it, expect } from "vitest";
import { audioUrl, modelUrl } from "../../src/game/assetUrls.js";
import catalog from "../../assets/catalog.json" with { type: "json" };

/** Every model the catalog declares, by the `output` key callers pass. */
const OUTPUTS = catalog.assets.map((a) => a.output);

describe("modelUrl", () => {
  it("resolves every `output` the shipped catalog declares", () => {
    // The whole point of the indirection: the catalog is the list of models,
    // and each entry's `output` is the key. A catalog entry that `modelUrl`
    // cannot resolve is a model that will not load in the game.
    expect(OUTPUTS.length).toBe(33);
    for (const output of OUTPUTS) {
      expect(typeof modelUrl(output)).toBe("string");
      expect(modelUrl(output).length).toBeGreaterThan(0);
    }
  });

  it("gives every model its own URL", () => {
    // Two models sharing a URL would mean the glob's keys collapsed — every
    // enemy or clutter variant would silently wear the same mesh.
    expect(new Set(OUTPUTS.map(modelUrl)).size).toBe(OUTPUTS.length);
  });

  it("returns a real URL, never an inlined data: URI", () => {
    // `vite.config.ts` opts .glb out of `assetsInlineLimit` precisely so this
    // holds; an inlined model has no cacheable URL, which is the thing this
    // whole mechanism exists to give it.
    for (const output of OUTPUTS) expect(modelUrl(output).startsWith("data:")).toBe(false);
  });

  it("keeps each file's own name in its URL", () => {
    // The two shapes differ: in dev and under vitest Vite serves the source path
    // unchanged (`/assets/models/<id>.glb`), while a build flattens it into
    // `assetsDir` and inserts a content hash (`/assets/<id>-<hash>.glb`). What
    // both keep is the file's own name, which is what makes a network log or a
    // deploy check readable — `tools/deploy/lib/modelUrls.mjs` finds the hashed
    // URLs on the live site by matching exactly that.
    for (const output of OUTPUTS) {
      const name = output.slice("models/".length, -".glb".length).replace(/\./g, "\\.");
      expect(modelUrl(output)).toMatch(new RegExp(`^/assets/(models/)?${name}[^/]*\\.glb$`));
    }
  });

  it("throws on an output it does not know, naming both places it must exist", () => {
    // A typo must fail at startup. Returning the key unresolved would make it a
    // 404, and Babylon answers a failed load by leaving the mesh out — enemies
    // fall back to capsules and clutter disappears, with nothing in the console
    // pointing at the cause.
    expect(() => modelUrl("models/enemy.nonexistent.glb")).toThrow(
      /models\/enemy\.nonexistent\.glb/,
    );
    expect(() => modelUrl("models/enemy.nonexistent.glb")).toThrow(/client\/assets\//);
    expect(() => modelUrl("models/enemy.nonexistent.glb")).toThrow(/catalog\.json/);
  });

  it("throws on an inherited Object.prototype key instead of returning a function", () => {
    // `resolveEnemyAssets` admits any non-empty string as an `output`, so a
    // malformed catalog can reach here with "toString". On a plain object that
    // resolves to an inherited FUNCTION typed as a string, which Babylon would be
    // handed as a URL — the exact silent failure the throw exists to prevent.
    for (const key of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(() => modelUrl(key)).toThrow(/unknown model/);
    }
  });

  it("keys on the catalog's `output` verbatim, not on a path relative to game/", () => {
    // The glob's own keys are `../../assets/models/<id>.glb`; the prefix is
    // stripped so callers never have to know where this file sits.
    expect(() => modelUrl("../../assets/models/enemy.grunt.glb")).toThrow();
    expect(() => modelUrl("/assets/models/enemy.grunt.glb")).toThrow();
  });
});

describe("audioUrl", () => {
  /** The `audio` section is optional and empty until the first clip is added. */
  const CLIPS = catalog.audio.map((c) => c.output);

  it("resolves every clip the shipped catalog declares", () => {
    for (const output of CLIPS) {
      expect(typeof audioUrl(output)).toBe("string");
      expect(audioUrl(output).startsWith("data:")).toBe(false);
    }
  });

  it("throws on a clip the catalog does not know, naming both places it must exist", () => {
    // Every call is shipped and in the catalog, so this uses a made-up clip as its
    // "unshipped" example.
    expect(() => audioUrl("audio/call.nonexistent.mp3")).toThrow(/unknown audio clip/);
    expect(() => audioUrl("audio/call.nonexistent.mp3")).toThrow(/client\/assets\//);
    expect(() => audioUrl("audio/call.nonexistent.mp3")).toThrow(/catalog\.json/);
  });

  it("throws on an inherited Object.prototype key instead of returning a function", () => {
    for (const key of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(() => audioUrl(key)).toThrow(/unknown audio clip/);
    }
  });
});
