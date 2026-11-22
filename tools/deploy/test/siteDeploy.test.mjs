import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { siteDeployArgs } from "../lib/siteDeploy.mjs";

// The engine's own site tool, installed from its release: the rules file is held to what IT accepts.
const engineLib = (name) => import(pathToFileURL(resolve(import.meta.dirname, "../../../node_modules/@csarkosh/engine/tools/site/lib", name)).href);
const { loadRules } = await engineLib("rules.mjs");
const { mergeConfig } = await engineLib("config.mjs");
const { ownsRule } = await engineLib("owns.mjs");

const RULES_FILE = resolve(import.meta.dirname, "../site.rules.json");
const OWNER = { path: "/dayhike", root: true };

describe("siteDeployArgs", () => {
  const base = { project: "fps-csarko", site: "fps-csarko", sitePath: "/dayhike" };
  it("is the engine's tool for the live site: the path, its folder, the root's folder, the rules, the message", () => {
    expect(siteDeployArgs({ ...base, message: "dayhike abc1234" })).toEqual([
      "node_modules/@csarkosh/engine/tools/site/deploy.mjs",
      "--project", "fps-csarko",
      "--site", "fps-csarko",
      "--path", "/dayhike",
      "--dir", "site/dayhike",
      "--root-dir", "site/root",
      "--rules", "tools/deploy/site.rules.json",
      "--message", "dayhike abc1234",
    ]);
  });
  it("releases to a channel for its days, and gives a channel no message", () => {
    const args = siteDeployArgs({ ...base, channel: "no-paint", expiresDays: 2, message: "ignored" });
    expect(args.slice(-4)).toEqual(["--channel", "no-paint", "--expires", "2"]);
    expect(args).not.toContain("--message");
    expect(args).not.toContain("--dry-run");
  });
  it("passes the tool's own dry run", () => {
    expect(siteDeployArgs({ ...base, channel: "x1", expiresDays: 7, dryRun: true }).at(-1)).toBe("--dry-run");
    expect(siteDeployArgs({ ...base, dryRun: true })).toContain("--dry-run");
    expect(siteDeployArgs({ ...base })).not.toContain("--dry-run");
  });
});

describe("site.rules.json", () => {
  it("parses, and holds the three redirects, two rewrites and two headers the site had", () => {
    const rules = JSON.parse(readFileSync(RULES_FILE, "utf8"));
    expect(Object.keys(rules).sort()).toEqual(["headers", "redirects", "rewrites"]);
    expect(rules.redirects).toHaveLength(3);
    expect(rules.rewrites).toHaveLength(2);
    expect(rules.headers).toHaveLength(2);
  });

  it("is accepted by the engine's reader for the owner of /dayhike and the root, and not without the root", () => {
    const loaded = loadRules(RULES_FILE, OWNER);
    for (const list of ["redirects", "rewrites", "headers"]) for (const rule of loaded[list]) expect(ownsRule(OWNER, rule)).toBe(true);
    expect(() => loadRules(RULES_FILE, { path: "/dayhike", root: false })).toThrow(/root/);
    expect(() => loadRules(RULES_FILE, { path: "/capesorrow", root: true })).toThrow(/not of \/capesorrow/);
  });

  // The site's live config as it is before this change, in the API's form.
  const LIVE = {
    headers: [
      { glob: "**", headers: { "Cache-Control": "no-cache" } },
      { glob: "/dayhike/assets/**", headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
    ],
    redirects: [
      { glob: "/", statusCode: 301, location: "https://csarko.sh/games" },
      { glob: "/dayhike/admin", statusCode: 301, location: "https://admin.csarko.sh/game-dayhike/" },
      { glob: "/dayhike/admin/**", statusCode: 301, location: "https://admin.csarko.sh/game-dayhike/" },
    ],
    rewrites: [
      { glob: "/dayhike/**", path: "/dayhike/index.html" },
      { glob: "**", path: "/index.html" },
    ],
  };

  it("merged into the present live config gives the same seven rules back (redirects: the path's two, then the root's)", () => {
    const merged = mergeConfig(LIVE, loadRules(RULES_FILE, OWNER), OWNER);
    expect(merged.headers).toEqual(LIVE.headers);
    expect(merged.rewrites).toEqual(LIVE.rewrites);
    // The paths' rules come before the root's: `/` moves from first to last, the only difference from live.
    expect(merged.redirects).toEqual([LIVE.redirects[1], LIVE.redirects[2], LIVE.redirects[0]]);
    expect(merged.headers.length + merged.rewrites.length + merged.redirects.length).toBe(7);
    // Deploying the same rules twice gives the same config.
    expect(mergeConfig(merged, loadRules(RULES_FILE, OWNER), OWNER)).toEqual(merged);
  });

  it("leaves a second game's rules in place, with the catch-all rewrite last", () => {
    const cape = {
      rewrites: [{ glob: "/capesorrow/**", path: "/capesorrow/index.html" }],
      headers: [{ glob: "/capesorrow/assets/**", headers: { "Cache-Control": "public, max-age=31536000, immutable" } }],
    };
    const live = {
      ...LIVE,
      rewrites: [LIVE.rewrites[0], cape.rewrites[0], LIVE.rewrites[1]],
      headers: [...LIVE.headers, cape.headers[0]],
    };
    const merged = mergeConfig(live, loadRules(RULES_FILE, OWNER), OWNER);
    expect(merged.rewrites).toContainEqual(cape.rewrites[0]);
    expect(merged.headers).toContainEqual(cape.headers[0]);
    // Kept rules first, then Day Hike's own in the file's order: the other game's, Day Hike's, the catch-all.
    expect(merged.rewrites).toEqual([cape.rewrites[0], LIVE.rewrites[0], LIVE.rewrites[1]]);
    expect(merged.rewrites.at(-1)).toEqual({ glob: "**", path: "/index.html" });
    // A path's header comes after the root's `**`, so it overrides it.
    expect(merged.headers).toEqual([LIVE.headers[0], cape.headers[0], LIVE.headers[1]]);
  });
});
