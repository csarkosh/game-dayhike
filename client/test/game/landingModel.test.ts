import { describe, it, expect } from "vitest";
import {
  DOWNLOADS_UNAVAILABLE,
  FIRST_OPEN_NOTE,
  FIRST_RUN_NOTE_WINDOWS,
  TOUCH_DOWNLOADS_NOTE,
  WAITING_FOR_HOST,
  landingModel,
} from "../../src/game/landingModel.js";

const MAC = {
  url: "https://storage.googleapis.com/fps-csarko-downloads/desktop/DayHike-1.2.0-arm64.dmg",
  sha256: "a".repeat(64),
  size: 148_400_000,
};
const WIN = {
  url: "https://storage.googleapis.com/fps-csarko-downloads/desktop/DayHike-Setup-1.2.0-x64.exe",
  sha256: "b".repeat(64),
  size: 118_000_000,
};
const latest = { version: "1.2.0", platforms: { "darwin-arm64": MAC, "win32-x64": WIN } };

describe("landingModel on the web", () => {
  it("always offers Play, Downloads and Credits, in that order of concern", () => {
    const view = landingModel({ desktop: false, host: "darwin-arm64", latest: null });
    expect(view.play).toEqual({ label: "Play" });
    expect(view.waiting).toBeUndefined();
    expect(view.downloadsPage).toEqual({ label: "Downloads", cards: [], empty: DOWNLOADS_UNAVAILABLE });
    expect(view.credits).toEqual({ label: "Credits" });
    expect(view.join).toBeUndefined();
    expect(view.versionLabel).toBeUndefined();
    expect(view.update).toBeUndefined();
  });
  it("fills the downloads page with both builds, the visitor's first", () => {
    const view = landingModel({ desktop: false, host: "win32-x64", latest });
    expect(view.downloadsPage?.empty).toBeUndefined();
    expect(view.downloadsPage?.cards).toEqual([
      {
        platform: "win32-x64",
        url: WIN.url,
        label: "Download for Windows (x64)",
        caption: "v1.2.0 · 118 MB",
        note: FIRST_RUN_NOTE_WINDOWS,
      },
      {
        platform: "darwin-arm64",
        url: MAC.url,
        label: "Download for Mac (Apple silicon)",
        caption: "v1.2.0 · 148 MB",
        note: FIRST_OPEN_NOTE,
      },
    ]);
    expect(FIRST_OPEN_NOTE).toMatch(/Open Anyway/);
    expect(FIRST_RUN_NOTE_WINDOWS).toMatch(/Run anyway/);
    const order = (host: "darwin-arm64" | "other") =>
      landingModel({ desktop: false, host, latest }).downloadsPage?.cards.map((d) => d.platform);
    expect(order("darwin-arm64")).toEqual(["darwin-arm64", "win32-x64"]);
    expect(order("other")).toEqual(["darwin-arm64", "win32-x64"]);
  });
  it("lists only the builds the document carries", () => {
    const macOnly = { version: "1.2.0", platforms: { "darwin-arm64": MAC } };
    const view = landingModel({ desktop: false, host: "win32-x64", latest: macOnly });
    expect(view.downloadsPage?.cards.map((d) => d.platform)).toEqual(["darwin-arm64"]);
  });
  it("replaces Play with a waiting line for a lobby follower", () => {
    const view = landingModel({ desktop: false, host: "other", latest: null, follower: true });
    expect(view.play).toBeUndefined();
    expect(view.waiting).toBe(WAITING_FOR_HOST);
  });
});

describe("landingModel on desktop", () => {
  it("shows the join field and version, never the downloads page", () => {
    const view = landingModel({ desktop: true, host: "darwin-arm64", appVersion: "1.2.0", latest });
    expect(view.play).toEqual({ label: "Play" });
    expect(view.credits).toEqual({ label: "Credits" });
    expect(view.downloadsPage).toBeUndefined();
    expect(view.join).toEqual({ placeholder: "Paste an invite link or lobby id", error: undefined });
    expect(view.versionLabel).toBe("v1.2.0");
  });
  it("offers an update for its own platform only when latest is strictly newer", () => {
    expect(landingModel({ desktop: true, host: "darwin-arm64", appVersion: "1.2.0", latest }).update).toBeUndefined();
    expect(landingModel({ desktop: true, host: "win32-x64", appVersion: "1.1.9", latest }).update).toEqual({
      url: WIN.url,
      label: "Day Hike v1.2.0 is available — Download",
    });
    expect(landingModel({ desktop: true, host: "darwin-arm64", appVersion: "1.1.9", latest }).update?.url).toBe(MAC.url);
    const macOnly = { version: "1.2.0", platforms: { "darwin-arm64": MAC } };
    expect(landingModel({ desktop: true, host: "win32-x64", appVersion: "1.1.9", latest: macOnly }).update).toBeUndefined();
    expect(landingModel({ desktop: true, host: "darwin-arm64", appVersion: "1.1.9", latest: null }).update).toBeUndefined();
    expect(landingModel({ desktop: true, host: "darwin-arm64", latest }).update).toBeUndefined();
  });
  it("reports a join error inline", () => {
    const view = landingModel({
      desktop: true,
      host: "darwin-arm64",
      appVersion: "1.2.0",
      latest: null,
      joinError: "Not an invite.",
    });
    expect(view.join?.error).toBe("Not an invite.");
  });
  it("hides the join field and Play from a follower", () => {
    const view = landingModel({ desktop: true, host: "darwin-arm64", appVersion: "1.2.0", latest: null, follower: true });
    expect(view.play).toBeUndefined();
    expect(view.join).toBeUndefined();
    expect(view.waiting).toBe(WAITING_FOR_HOST);
  });
});

describe("landingModel on a touch device", () => {
  it("replaces the desktop download cards with a one-line note", () => {
    const view = landingModel({ desktop: false, host: "other", latest, touch: true });
    expect(view.downloadsPage).toEqual({ label: "Downloads", cards: [], empty: TOUCH_DOWNLOADS_NOTE });
    expect(view.play).toEqual({ label: "Play" });
  });
  it("leaves the desktop shell's view alone", () => {
    const view = landingModel({ desktop: true, host: "darwin-arm64", latest, appVersion: "1.2.0", touch: true });
    expect(view.downloadsPage).toBeUndefined();
  });
});
