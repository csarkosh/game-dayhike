import { describe, it, expect } from "vitest";
import {
  parseVersion,
  isNewer,
  parseLatest,
  formatSize,
} from "../../src/net/desktopRelease.js";

const LATEST = {
  version: "1.2.0",
  url: "https://storage.googleapis.com/fps-csarko-downloads/desktop/DayHike-1.2.0-arm64.dmg",
  sha256: "a".repeat(64),
  size: 155_000_000,
  publishedAt: "2026-09-02T18:00:00Z",
};

describe("parseVersion", () => {
  it("parses strict semver", () => {
    expect(parseVersion("1.2.10")).toEqual([1, 2, 10]);
  });
  it("rejects anything else", () => {
    for (const bad of ["v1.2.0", "1.2", "1.2.0-beta.1", "", "1.2.0.1", "a.b.c"]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe("isNewer", () => {
  it("compares numerically, not lexically", () => {
    expect(isNewer("1.10.0", "1.9.9")).toBe(true);
    expect(isNewer("1.9.9", "1.10.0")).toBe(false);
  });
  it("is false for equal versions and for anything unparsable", () => {
    expect(isNewer("1.2.0", "1.2.0")).toBe(false);
    expect(isNewer("garbage", "1.2.0")).toBe(false);
    expect(isNewer("1.2.0", "garbage")).toBe(false);
  });
});

const MAC = { url: LATEST.url, sha256: LATEST.sha256, size: LATEST.size };
const WIN = { url: "https://storage.googleapis.com/fps-csarko-downloads/desktop/DayHike-Setup-1.2.0-x64.exe", sha256: "b".repeat(64), size: 118_000_000 };

describe("parseLatest", () => {
  it("accepts the 0.1.x shape as a darwin-arm64-only release", () => {
    expect(parseLatest(LATEST)).toEqual({ version: "1.2.0", platforms: { "darwin-arm64": MAC } });
  });
  it("accepts the platforms map", () => {
    expect(parseLatest({ ...LATEST, platforms: { "darwin-arm64": MAC, "win32-x64": WIN } })).toEqual({
      version: "1.2.0",
      platforms: { "darwin-arm64": MAC, "win32-x64": WIN },
    });
  });
  it("drops an unknown platform and rejects a malformed entry", () => {
    expect(parseLatest({ ...LATEST, platforms: { "darwin-arm64": MAC, "linux-x64": WIN } })).toEqual({
      version: "1.2.0",
      platforms: { "darwin-arm64": MAC },
    });
    expect(parseLatest({ ...LATEST, platforms: { "darwin-arm64": MAC, "win32-x64": { ...WIN, sha256: "zz" } } })).toBeNull();
  });
  it("rejects a non-https url, a bad digest, a non-integer size, a bad version", () => {
    expect(parseLatest({ ...LATEST, url: "http://example.com/x.dmg" })).toBeNull();
    expect(parseLatest({ ...LATEST, sha256: "xyz" })).toBeNull();
    expect(parseLatest({ ...LATEST, size: 1.5 })).toBeNull();
    expect(parseLatest({ ...LATEST, size: 0 })).toBeNull();
    expect(parseLatest({ ...LATEST, version: "1.2" })).toBeNull();
  });
  it("rejects non-objects", () => {
    expect(parseLatest(null)).toBeNull();
    expect(parseLatest("1.2.0")).toBeNull();
    expect(parseLatest([])).toBeNull();
  });
});

describe("formatSize", () => {
  it("rounds to whole megabytes (SI)", () => {
    expect(formatSize(155_000_000)).toBe("155 MB");
    expect(formatSize(148_400_000)).toBe("148 MB");
    expect(formatSize(999_999)).toBe("1 MB");
  });
});
