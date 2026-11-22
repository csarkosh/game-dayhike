import { afterEach, describe, expect, it } from "vitest";
import { gameIdentity, setGameIdentity, type GameIdentity } from "@csarkosh/engine/identity";
import { desktopVersion } from "@csarkosh/engine/game/platform";
import { muteKey } from "@csarkosh/engine/game/muteButton";
import { autoKey, noticeKey, qualityKey } from "@csarkosh/engine/game/tierChoice";
import { switchKey, testerKey, visitorKey } from "@csarkosh/engine/net/telemetry";
import { HIKE_IDENTITY } from "../../src/hikeIdentity.js";

const OTHER: GameIdentity = { title: "Other", session: "round", player: "Guest", storage: "other", desktop: "Other" };

function keys(): string[] {
  return [autoKey(), qualityKey(), noticeKey(), muteKey(), switchKey(), testerKey(), visitorKey()];
}

describe("the keys the page keeps in the browser", () => {
  afterEach(() => setGameIdentity(HIKE_IDENTITY));

  it("are Day Hike's, as they have always been, under Day Hike's identity", () => {
    expect(gameIdentity()).toBe(HIKE_IDENTITY);
    expect(keys()).toEqual([
      "dayhike.quality.auto",
      "dayhike.quality",
      "dayhike.notice",
      "dayhike.muted",
      "dayhike.telemetry",
      "dayhike.tester",
      "dayhike.visitor",
    ]);
  });

  it("begin with another game's prefix once that game's identity is set", () => {
    setGameIdentity(OTHER);
    expect(keys()).toEqual(["other.quality.auto", "other.quality", "other.notice", "other.muted", "other.telemetry", "other.tester", "other.visitor"]);
  });
});

describe("the shell's line for a last session ended by a graphics restart", () => {
  it("is made from the game's session word, and reads as Day Hike's always has", () => {
    expect(`The last ${HIKE_IDENTITY.session} ended because the graphics could not be restarted.`).toBe("The last hike ended because the graphics could not be restarted.");
  });
});

describe("the desktop app's token in its user agent", () => {
  afterEach(() => setGameIdentity(HIKE_IDENTITY));

  it("is Day Hike's under Day Hike's identity, and another game's under its own", () => {
    expect(desktopVersion("Mozilla/5.0 Chrome/132.0 DayHike/0.3.0")).toBe("0.3.0");
    expect(desktopVersion("Mozilla/5.0 Chrome/132.0 Other/0.3.0")).toBeUndefined();
    setGameIdentity(OTHER);
    expect(desktopVersion("Mozilla/5.0 Chrome/132.0 DayHike/0.3.0")).toBeUndefined();
    expect(desktopVersion("Mozilla/5.0 Chrome/132.0 Other/0.3.0")).toBe("0.3.0");
  });
});
