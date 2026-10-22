import { describe, expect, it } from "vitest";
import { channelDeployArgs, channelUrlFrom, checkChannelName, parseChannelArgs } from "../lib/channel.mjs";

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
describe("channelDeployArgs", () => {
  it("is the firebase command, non-interactive, on the project", () => {
    expect(channelDeployArgs("no-paint", "7d", "fps-csarko")).toEqual([
      "firebase-tools", "hosting:channel:deploy", "no-paint", "--expires", "7d", "--project", "fps-csarko", "--non-interactive",
    ]);
  });
});
describe("channelUrlFrom", () => {
  it("reads the channel's address from the CLI's line and adds the site path", () => {
    const out = "- Use build.rolldownOptions…\nChannel URL (fps-csarko): https://fps-csarko--no-paint-euuw6887.web.app [expires 2026-10-27 20:58:56] [version 9e00b7c957e15c64]\n";
    expect(channelUrlFrom(out, "/dayhike")).toBe("https://fps-csarko--no-paint-euuw6887.web.app/dayhike/");
    expect(() => channelUrlFrom("nothing here", "/dayhike")).toThrow(/Channel URL/);
  });
});
