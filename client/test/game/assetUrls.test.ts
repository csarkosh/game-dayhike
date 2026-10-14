import { describe, it, expect } from "vitest";
import { MODEL_COUNT, audioUrl, modelUrl } from "../../src/game/assetUrls.js";
import catalog from "../../assets/catalog.json" with { type: "json" };

/** Every model the catalog declares, by the `output` key callers pass. */
const OUTPUTS = catalog.assets.map((a) => a.output);

describe("modelUrl", () => {
  it("resolves every `output` the shipped catalog declares", () => {
    // The whole point of the indirection: the catalog is the list of models,
    // and each entry's `output` is the key. A catalog entry that `modelUrl`
    // cannot resolve is a model that will not load in the game.
    expect(OUTPUTS.length).toBe(44);
    for (const output of OUTPUTS) {
      expect(typeof modelUrl(output)).toBe("string");
      expect(modelUrl(output).length).toBeGreaterThan(0);
    }
  });

  it("counts toward a hike only the models a hike loads: the film's own are left out", () => {
    const filmOnly = (catalog.assets as Array<{ id: string; scene?: string }>).filter((a) => a.scene !== undefined).map((a) => a.id);
    expect(filmOnly).toEqual(["intro.car", "intro.ranger"]);
    expect(MODEL_COUNT).toBe(42);
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
    // `resolveCharacterAssets` admits any non-empty string as an `output`, so a
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

import { assetBytes, textureUrl } from "../../src/game/assetUrls.js";

describe("textureUrl", () => {
  /** The bark sets the catalog declares: four sets, two sizes, three maps. */
  const BARK = catalog.textures.map((t) => t.output).filter((output) => output.endsWith(".ktx2"));

  it("resolves every bark map the shipped catalog declares, each to its own url with the file's own name", () => {
    expect(BARK.length).toBe(24);
    expect(BARK).toContain("textures/bark.pine.2k.ktx2");
    expect(new Set(BARK.map(textureUrl)).size).toBe(24);
    for (const output of BARK) {
      const name = output.slice("textures/".length, -".ktx2".length).replace(/\./g, "\\.");
      expect(textureUrl(output)).toMatch(new RegExp(`^/assets/(textures/)?${name}[^/]*\\.ktx2$`));
      expect(textureUrl(output).startsWith("data:")).toBe(false);
    }
  });

  it("throws on a map it does not ship, the ground textures' among them, naming both places it must exist", () => {
    expect(() => textureUrl("textures/bark.oak.2k.ktx2")).toThrow(/unknown texture "textures\/bark\.oak\.2k\.ktx2"/);
    expect(() => textureUrl("textures/bark.oak.2k.ktx2")).toThrow(/client\/assets\//);
    expect(() => textureUrl("textures/bark.oak.2k.ktx2")).toThrow(/catalog\.json/);
    // The ground layers go through their own imports, not this map.
    expect(() => textureUrl("textures/ground.grass.webp")).toThrow(/unknown texture/);
    for (const key of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(() => textureUrl(key)).toThrow(/unknown texture/);
    }
  });
});

describe("assetBytes", () => {
  it("reads the catalog's bytes where the export wrote them, and nothing where it did not", () => {
    // The catalog's first model: the export writes `bytes` from this work on.
    const known = assetBytes("models/ranger.nathan.glb");
    expect(known === undefined || known > 100_000).toBe(true);
    expect(assetBytes("models/no-such-model.glb")).toBeUndefined();
  });
});

import { titleStillUrl, titleVideoUrl, videoUrl } from "../../src/game/assetUrls.js";

describe("the intro's files", () => {
  it("gives the film's url when it ships, and null when it does not", () => {
    const v = videoUrl();
    expect(v === null || v.startsWith("/")).toBe(true);
  });

  it("gives the title film and its still as urls, or null before they ship", () => {
    for (const url of [titleVideoUrl(), titleStillUrl()]) expect(url === null || url.startsWith("/")).toBe(true);
    expect(titleVideoUrl() === null).toBe(titleStillUrl() === null);
  });
});
