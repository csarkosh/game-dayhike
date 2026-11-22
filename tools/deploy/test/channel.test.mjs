import { describe, expect, it } from "vitest";
import { channelPublishedText, channelUrlFrom, checkChannelName, expiresDays, parseChannelArgs } from "../lib/channel.mjs";

describe("parseChannelArgs", () => {
  it("takes the name, an expiry and a dry run", () => {
    expect(parseChannelArgs(["no-paint"])).toEqual({ name: "no-paint", expires: "7d", dryRun: false });
    expect(parseChannelArgs(["--expires", "2d", "--dry-run", "x1"])).toEqual({ name: "x1", expires: "2d", dryRun: true });
    expect(() => parseChannelArgs([])).toThrow(/needs a name/);
    expect(() => parseChannelArgs(["a", "b"])).toThrow(/one name/);
    expect(() => parseChannelArgs(["x1", "--expires", "--dry-run"])).toThrow(/needs a duration/);
    expect(() => parseChannelArgs(["x1", "--expires"])).toThrow(/needs a duration/);
  });
});
describe("checkChannelName", () => {
  it("allows lowercase letters, digits and hyphens between them", () => {
    for (const ok of ["a", "no-paint", "frame-budget-2", "x".repeat(36)]) expect(() => checkChannelName(ok)).not.toThrow();
    for (const bad of ["", "No-Paint", "a b", "-a", "a-", "x".repeat(37), "a/b"]) expect(() => checkChannelName(bad)).toThrow(/lowercase/);
  });
});
describe("expiresDays", () => {
  it("reads 7d style values as the site tool's whole days, 1 to 30", () => {
    expect(expiresDays("7d")).toBe(7);
    expect(expiresDays("1d")).toBe(1);
    expect(expiresDays("30d")).toBe(30);
    for (const bad of ["0d", "31d", "36h", "90m", "7", "d", "1.5d", "-2d", "2d "]) expect(() => expiresDays(bad)).toThrow(/whole days from 1d to 30d/);
  });
});
// What the engine's site tool prints for a channel: the plan, the counts, and the address last.
const TOOL_OUTPUT = [
  "live version sites/fps-csarko/versions/8f3a",
  "dryrun",
  "cloning sites/fps-csarko/versions/8f3a without ^/dayhike/.*$ and ^/[^/]+$",
  "files 1-84 of 84: 3 to upload",
  "released sites/fps-csarko/versions/c41d to channel no-paint",
  "3 new, 5 changed, 76 unchanged, 0 removed; 12 files of others kept",
  "https://fps-csarko--no-paint-euuw6887.web.app/dayhike",
  "",
].join("\n");
describe("channelUrlFrom", () => {
  it("reads the channel's address from the tool's last line, with a trailing slash", () => {
    expect(channelUrlFrom(TOOL_OUTPUT, "/dayhike")).toBe("https://fps-csarko--no-paint-euuw6887.web.app/dayhike/");
    expect(channelUrlFrom("https://fps-csarko--x1-abc123.web.app/dayhike/\n", "/dayhike")).toBe("https://fps-csarko--x1-abc123.web.app/dayhike/");
  });
  it("refuses output that does not end with an address of the site path", () => {
    expect(() => channelUrlFrom("nothing here", "/dayhike")).toThrow(/last line/);
    expect(() => channelUrlFrom("", "/dayhike")).toThrow(/last line/);
    expect(() => channelUrlFrom("dry run: nothing was written\n", "/dayhike")).toThrow(/last line/);
    expect(() => channelUrlFrom("https://fps-csarko--x1-abc123.web.app/capesorrow\n", "/dayhike")).toThrow(/last line/);
    // An address in the middle is not the answer: only the last line is read.
    expect(() => channelUrlFrom("https://a--b-c.web.app/dayhike\nreleased\n", "/dayhike")).toThrow(/last line/);
  });
});
describe("channelPublishedText", () => {
  it("ends with the address alone, which tools/rig/session.sh shows as `tail -1`", () => {
    const url = channelUrlFrom(TOOL_OUTPUT, "/dayhike");
    const lines = channelPublishedText(url).split("\n");
    expect(lines.at(-1)).toBe(url);
    expect(lines.at(-2)).toBe("✓ channel published");
  });
});
