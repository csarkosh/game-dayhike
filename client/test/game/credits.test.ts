import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { creditsModel, creditsRows, requiresAttribution, safeHref } from "../../src/game/credits.js";
import catalog from "../../assets/catalog.json" with { type: "json" };

const SAMPLE = `# Credits

Everything not listed below is original work by the author.

## clutter.boulder_a

- **Source:** Stone Library: Boulder 01
- **Author:** Jo Example
- **Licence:** CC0-1.0
- **URL:** https://example.com/boulder_01

## enemy.grunt

- **Source:** Grunt
- **Author:** The Author
- **Licence:** UNLICENSED
- **URL:** https://example.invalid
`;

const REAL = readFileSync(new URL("../../../CREDITS.md", import.meta.url), "utf8");

/** The code of others the game carries, credited beside the catalog's assets: the id of each credit. */
const CODE = ["render.agx_tone_map", "render.babylon_lite", "render.environment_brdf"];

describe("creditsModel", () => {
  it("parses one entry per section with the four fields", () => {
    expect(creditsModel(SAMPLE)).toEqual([
      {
        id: "clutter.boulder_a",
        source: "Stone Library: Boulder 01",
        author: "Jo Example",
        license: "CC0-1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        url: "https://example.com/boulder_01",
        modified: true,
      },
    ]);
  });
  it("drops UNLICENSED (own-authored) entries", () => {
    expect(creditsModel(SAMPLE).some((e) => e.id === "enemy.grunt")).toBe(false);
  });
  it("links CC-BY-4.0 to its deed", () => {
    const entries = creditsModel(SAMPLE.replace("CC0-1.0", "CC-BY-4.0"));
    expect(entries[0]!.licenseUrl).toBe("https://creativecommons.org/licenses/by/4.0/");
  });
  it("links a public-domain work to the Public Domain Mark, and asks for no credit", () => {
    const entries = creditsModel(SAMPLE.replace("CC0-1.0", "Public domain"));
    expect(entries[0]!.licenseUrl).toBe("https://creativecommons.org/publicdomain/mark/1.0/");
    expect(requiresAttribution("Public domain")).toBe(false);
  });
  it("credits the surf's bed to its Oregon recording and its five one-shots to the Park Service's, as two rows", () => {
    const surf = creditsModel(REAL).filter((e) => e.id === "ambience.surf_cove" || e.id.startsWith("call.surf_"));
    expect(surf.map((e) => e.id)).toEqual([
      "ambience.surf_cove", "call.surf_backwash_a", "call.surf_backwash_b",
      "call.surf_plunge_a", "call.surf_plunge_b", "call.surf_plunge_c",
    ]);
    // The bed's source and page are read past the platform's name, which only CREDITS.md spells.
    const rows = creditsRows(surf);
    const bed = rows[0]!;
    expect([bed.source.slice(bed.source.indexOf(": ") + 2), bed.author, bed.license, bed.licenseUrl, new URL(bed.url).pathname]).toEqual([
      "Short Sand Beach: Waves 3", "ghosttropic", "CC0-1.0",
      "https://creativecommons.org/publicdomain/zero/1.0/", "/people/ghosttropic/sounds/717146/",
    ]);
    expect(rows.slice(1).map((e) => [e.source, e.author, e.license, e.licenseUrl, e.url])).toEqual([
      [
        "NPS Sound Gallery: Ocean, Olympic National Park", "National Park Service", "Public domain",
        "https://creativecommons.org/publicdomain/mark/1.0/", "https://www.nps.gov/subjects/sound/sounds-ocean.htm",
      ],
    ]);
  });
  it("links Apache-2.0 and MIT to their texts, and asks for the credit of both", () => {
    const apache = creditsModel(SAMPLE.replace("CC0-1.0", "Apache-2.0"));
    expect(apache[0]!.licenseUrl).toBe("https://www.apache.org/licenses/LICENSE-2.0");
    const mit = creditsModel(SAMPLE.replace("CC0-1.0", "MIT"));
    expect(mit[0]!.licenseUrl).toBe("https://opensource.org/license/mit");
    expect([requiresAttribution("Apache-2.0"), requiresAttribution("MIT")]).toEqual([true, true]);
  });
  it("credits only ids the catalog ships and the code of others the game carries, and at least one", () => {
    const shipped = new Set([...catalog.assets, ...catalog.textures, ...catalog.audio].map((a) => a.id));
    const entries = creditsModel(REAL);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(shipped.has(e.id) || CODE.includes(e.id), `${e.id} is credited but neither in the catalog nor code the game carries`).toBe(true);
    for (const id of CODE) expect(shipped.has(id), id).toBe(false);
  });
  it("credits the library the game is drawn with, its environment BRDF table and its tone map, each under its licence and each for something the tree holds", () => {
    const code = creditsModel(REAL).filter((e) => CODE.includes(e.id));
    expect(code.map((e) => [e.id, e.source, e.author, e.license, e.url])).toEqual([
      ["render.agx_tone_map", "three.js: AgX tone mapping", "three.js authors", "MIT", "https://github.com/mrdoob/three.js"],
      ["render.babylon_lite", "Babylon Lite (a patched build), which the game is drawn with", "BabylonJS", "Apache-2.0", "https://github.com/csarkosh/babylon-lite"],
      ["render.environment_brdf", "Babylon.js 9.18.0: environment BRDF table", "The Babylon.js team", "Apache-2.0", "https://github.com/BabylonJS/Babylon.js"],
    ]);
    // The screen shows all three among the rows a licence asks for, above the CC0 ones.
    const rows = creditsRows(creditsModel(REAL));
    const firstOptional = rows.findIndex((r) => !requiresAttribution(r.license));
    for (const id of CODE) expect(rows.findIndex((r) => r.id === id), id).toBeLessThan(firstOptional);
    // What each names: the dependency pinned to that source, the table as a file of the game's, and the tone map's notice beside its numbers.
    const client = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    expect(client.dependencies["@babylonjs/lite"]).toMatch(/^github:csarkosh\/babylon-lite#/);
    expect(existsSync(new URL("../../src/game/lite/environmentBrdf.png", import.meta.url))).toBe(true);
    expect(readFileSync(new URL("../../src/game/gradeParams.ts", import.meta.url), "utf8")).toContain("ported from three.js, MIT License, Copyright 2010-2024 three.js authors");
  });
  // LICENSE_URLS is a hand-kept map, so a licence it has never seen resolves to "" and would ship an
  // unlinked deed. This fails the moment a new licence appears in CREDITS.md.
  it("knows a deed URL for every licence in the real credits file", () => {
    for (const entry of creditsModel(REAL)) {
      expect(entry.licenseUrl, `no deed URL mapped for ${entry.license} (${entry.id})`).not.toBe("");
    }
  });
});

/** What the screen shows, as opposed to what the file says: `creditsModel` stays the faithful parse and this is the display pass on top of it. */
describe("creditsRows", () => {
  const entry = (over: Partial<ReturnType<typeof creditsModel>[number]>) => ({
    id: "x", source: "S", author: "A", license: "CC0-1.0",
    licenseUrl: "", url: "https://example.com/s", modified: true,
    ...over,
  });
  it("floats every attribution-required licence above every CC0 one", () => {
    const rows = creditsRows([
      entry({ id: "a", source: "Zero A" }),
      entry({ id: "b", source: "By B", license: "CC-BY-4.0" }),
      entry({ id: "c", source: "Zero C" }),
      entry({ id: "d", source: "By D", license: "CC-BY-4.0" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
    // Stated as the property, not just the one ordering above: no CC0 row may
    // precede a row whose licence requires the credit.
    const lastRequired = rows.map((r) => requiresAttribution(r.license)).lastIndexOf(true);
    const firstOptional = rows.map((r) => requiresAttribution(r.license)).indexOf(false);
    expect(lastRequired).toBeLessThan(firstOptional);
  });
  it("keeps file order inside each group", () => {
    const rows = creditsRows([
      entry({ id: "a", source: "Zero A" }),
      entry({ id: "b", source: "Zero B" }),
      entry({ id: "c", source: "Zero C" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("collapses two ids that render the identical row into one", () => {
    // Two catalog entries cut from one third-party work: same work, same author,
    // same licence, same URL — one credit.
    const rows = creditsRows([
      entry({ id: "clutter.shrub_a", source: "Plant Library: Searsia Lucida" }),
      entry({ id: "clutter.shrub_b", source: "Plant Library: Searsia Lucida" }),
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe("clutter.shrub_a");
  });
  it("keeps two different works by the same author apart", () => {
    const rows = creditsRows([
      entry({ id: "a", source: "Boulder 01", author: "Rico Cilliers", url: "https://example.com/boulder_01" }),
      entry({ id: "b", source: "Boulder 02", author: "Rico Cilliers", url: "https://example.com/boulder_02" }),
    ]);
    expect(rows.length).toBe(2);
  });
  it("shows every distinct credit in the real credits file, CC-BY first", () => {
    const parsed = creditsModel(REAL);
    const rows = creditsRows(parsed);
    // Nothing a licence requires may be lost to the dedupe: every distinct
    // (work, author, licence, URL) in the file still has exactly one row.
    const key = (e: (typeof parsed)[number]) => JSON.stringify([e.source, e.author, e.url, e.license]);
    expect(rows.map(key).sort()).toEqual([...new Set(parsed.map(key))].sort());
    // And the required ones (CC-BY, Apache-2.0, MIT) are the top of the list, which is
    // the half of the box that is on screen at 1080p.
    const required = rows.filter((r) => requiresAttribution(r.license));
    expect(required.length).toBeGreaterThan(0);
    expect(rows.slice(0, required.length)).toEqual(required);
  });
});

// renderCredits itself is not covered here: vitest runs this project under the
// node environment, with no DOM and no jsdom dependency to add for one test.
// safeHref is the whole of its href decision, so it is tested directly — an
// entry it rejects is rendered as plain text rather than as an <a>.
describe("safeHref", () => {
  it("passes http and https URLs through unchanged", () => {
    expect(safeHref("https://example.com/boulder_01")).toBe("https://example.com/boulder_01");
    expect(safeHref("http://example.com/x")).toBe("http://example.com/x");
  });
  it("rejects a javascript: URL", () => {
    expect(safeHref("javascript:alert(1)")).toBe(null);
    expect(safeHref("JavaScript:alert(1)")).toBe(null);
  });
  it("rejects other schemes and unparseable text", () => {
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBe(null);
    expect(safeHref("file:///etc/passwd")).toBe(null);
    expect(safeHref("not a url")).toBe(null);
    expect(safeHref("")).toBe(null);
  });
});
