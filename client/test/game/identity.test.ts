import { afterEach, describe, expect, it } from "vitest";
import { gameIdentity, setGameIdentity, type GameIdentity } from "@csarkosh/engine/identity";
import { muteKey } from "@csarkosh/engine/game/muteButton";
import { autoKey, noticeKey, qualityKey } from "@csarkosh/engine/game/tierChoice";
import { switchKey, testerKey, visitorKey } from "@csarkosh/engine/net/telemetry";
import { HIKE_IDENTITY } from "../../src/hikeIdentity.js";
import { sourceText } from "../helpers/source.js";

const OTHER: GameIdentity = { title: "Other", session: "round", player: "Guest", storage: "other" };

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

  it("are made from the identity where they are used: the engine's source holds no key of Day Hike's", () => {
    for (const file of ["game/tierChoice.ts", "game/muteButton.ts", "net/telemetry.ts"]) {
      const literals = sourceText(file).match(/(["'`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [];
      expect(literals.filter((text) => text.includes("dayhike.")), file).toEqual([]);
    }
  });
});

describe("the shell's line for a last session ended by a graphics restart", () => {
  it("is made from the game's session word, and reads as Day Hike's always has", () => {
    expect(sourceText("shell.ts")).toContain("`The last ${page.identity.session} ended because the graphics could not be restarted.`");
    expect(`The last ${HIKE_IDENTITY.session} ended because the graphics could not be restarted.`).toBe("The last hike ended because the graphics could not be restarted.");
  });
});
