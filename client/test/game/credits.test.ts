import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
  it("credits only ids the catalog ships, and at least one", () => {
    const shipped = new Set([...catalog.assets, ...catalog.textures, ...catalog.audio].map((a) => a.id));
    const entries = creditsModel(REAL);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(shipped.has(e.id), `${e.id} is credited but not in the catalog`).toBe(true);
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
    // And the required ones are the top of the list, which is the half of the
    // box that is on screen at 1080p.
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
