import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { closeStrayPages } from "../lib/cdp.mjs";

/** A fake of Chrome's debugging endpoints: `/json/list` answers `targets`, `/json/close/<id>` is recorded. */
function fakeChrome(targets) {
  const closed = [];
  const fetchImpl = async (url) => {
    const close = url.match(/\/json\/close\/(.+)$/);
    if (close) {
      closed.push(close[1]);
      return { json: async () => ({}) };
    }
    if (url.endsWith("/json/list")) return { json: async () => targets };
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, closed };
}

describe("closeStrayPages", () => {
  it("closes every page an earlier run left open, and leaves the blank page and the browser's own targets", async () => {
    const { fetchImpl, closed } = fakeChrome([
      { id: "A", type: "page", url: "https://fps-csarko--tune-lod1.web.app/dayhike/game/x?cmd=seed%20atmo" },
      { id: "B", type: "page", url: "about:blank" },
      { id: "C", type: "browser_ui", url: "chrome://omnibox-popup.top-chrome/" },
      { id: "D", type: "page", url: "https://games.csarko.sh/dayhike/game/x?cmd=seed%20pine" },
      { id: "E", type: "service_worker", url: "https://games.csarko.sh/sw.js" },
    ]);
    const urls = await closeStrayPages(9333, fetchImpl);
    expect(closed).toEqual(["A", "D"]);
    expect(urls).toEqual([
      "https://fps-csarko--tune-lod1.web.app/dayhike/game/x?cmd=seed%20atmo",
      "https://games.csarko.sh/dayhike/game/x?cmd=seed%20pine",
    ]);
  });

  it("closes nothing on a Chrome with only its blank page", async () => {
    const { fetchImpl, closed } = fakeChrome([{ id: "B", type: "page", url: "about:blank" }]);
    expect(await closeStrayPages(9333, fetchImpl)).toEqual([]);
    expect(closed).toEqual([]);
  });

  it("is run by every remote measurement before its first page, after the machine check", () => {
    const src = readFileSync(new URL("../measure.mjs", import.meta.url), "utf8");
    const check = src.indexOf('if (!about.userAgent.includes("Windows NT"))');
    const strays = src.indexOf("const strays = await closeStrayPages(session.port);");
    const firstPage = src.indexOf("const taken = new Map();");
    expect(check).toBeGreaterThan(0);
    expect(strays).toBeGreaterThan(check);
    expect(strays).toBeLessThan(firstPage);
  });
});
