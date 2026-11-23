import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleSite } from "../lib/site.mjs";

// assembleSite works in the current folder, as the deploy scripts run it: a temp folder stands in for the repository.
describe("assembleSite", () => {
  const before = process.cwd();
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dayhike-site-"));
    mkdirSync(join(dir, "client/dist/assets"), { recursive: true });
    writeFileSync(join(dir, "client/dist/index.html"), "<html>game</html>");
    writeFileSync(join(dir, "client/dist/favicon.ico"), "icon");
    writeFileSync(join(dir, "client/dist/assets/app-1.js"), "js");
    writeFileSync(join(dir, "client/dist/assets/app-1.js.map"), "{}");
    // A leftover of an earlier layout must not ride along.
    mkdirSync(join(dir, "site"), { recursive: true });
    writeFileSync(join(dir, "site/stale.txt"), "old");
    process.chdir(dir);
  });
  afterEach(() => process.chdir(before));

  const list = (folder) => readdirSync(join(dir, folder), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath.slice(dir.length + 1), e.name)).sort();

  it("lays out the client under the site path without source maps, and the root's two files apart", () => {
    const sitePath = assembleSite({ siteUrl: "https://games.csarko.sh/dayhike", legacyHost: "game.csarko.sh" });
    expect(sitePath).toBe("/dayhike");
    expect(readdirSync(join(dir, "site")).sort()).toEqual(["dayhike", "root"]);
    expect(list("site/dayhike")).toEqual(["site/dayhike/assets/app-1.js", "site/dayhike/favicon.ico", "site/dayhike/index.html", "site/dayhike/sitemap.xml"]);
    expect(readdirSync(join(dir, "site/root")).sort()).toEqual(["favicon.ico", "index.html", "robots.txt"]);
    expect(readFileSync(join(dir, "site/root/favicon.ico"), "utf8")).toBe("icon");
    expect(readFileSync(join(dir, "site/root/index.html"), "utf8")).toContain("csarko.sh/games");
  });

  it("names the game's sitemap in the root's robots.txt and keeps the sitemap under the game's path", () => {
    // Not at /sitemap.xml: csarko.sh's admin judges a host's visited paths against that file, and the
    // party and game routes, and the other games, would all read as 404s.
    assembleSite({ siteUrl: "https://games.csarko.sh/dayhike", legacyHost: "game.csarko.sh" });
    expect(readFileSync(join(dir, "site/root/robots.txt"), "utf8")).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://games.csarko.sh/dayhike/sitemap.xml\n",
    );
    const sitemap = readFileSync(join(dir, "site/dayhike/sitemap.xml"), "utf8");
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(sitemap.match(/<loc>/g)).toHaveLength(1);
    expect(sitemap).toContain("<loc>https://games.csarko.sh/dayhike/</loc>");
  });

  it("writes one slash before the sitemap whether or not the site URL ends in one", () => {
    assembleSite({ siteUrl: "https://games.csarko.sh/dayhike/", legacyHost: "game.csarko.sh" });
    expect(readFileSync(join(dir, "site/root/robots.txt"), "utf8")).toContain("Sitemap: https://games.csarko.sh/dayhike/sitemap.xml\n");
    expect(readFileSync(join(dir, "site/dayhike/sitemap.xml"), "utf8")).toContain("<loc>https://games.csarko.sh/dayhike/</loc>");
  });
});
