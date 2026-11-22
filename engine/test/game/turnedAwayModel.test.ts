import { describe, expect, it } from "vitest";
import * as words from "../../src/game/turnedAwayWords.js";
import { sourceText } from "../helpers/source.js";

describe("the page for those turned away, as data", () => {
  it("keeps the credits within reach, in a browser and in the app, under the landing page's own word: the engine's half", () => {
    // The page takes the works themselves from the credits' own list, each written by the Credits screen's own hand.
    const page = sourceText("game/turnedAway.ts");
    expect(page).toContain("options: { still: string | null; credits: readonly CreditEntry[]; onDownload?(platform: Platform): void },");
    expect(page).toContain("  for (const e of options.credits) creditsList.append(creditItem(e));");
    const screen = sourceText("game/credits.ts");
    expect(screen).toContain("  for (const e of entries) list.append(creditItem(e));");
    // Day Hike's definition hands them over (`hikePageGame.ts`), and the shell asks for them as it draws the page.
    expect(sourceText("shell.ts")).toContain("      credits: page.away.credits(),");
  });
});

describe("the words a visitor turned away reads", () => {
  /** Every sentence of the module, by the constant it stands in. */
  const sentences: [string, string][] = Object.entries(words)
    .filter(([name]) => name.startsWith("TURNED_AWAY_"))
    .flatMap(([name, value]) =>
    typeof value === "string"
      ? [[name, value] as [string, string]]
      : Object.entries(value as Record<string, string | readonly string[]>).flatMap(([key, v]) => (typeof v === "string" ? [v] : [...v]).map((text) => [`${name}.${key}`, text] as [string, string])),
  );

  it("stand in one module, a constant a sentence: the page and its model write none of their own", () => {
    expect(sentences.length).toBeGreaterThan(20);
    for (const file of ["turnedAway.ts", "turnedAwayModel.ts"]) {
      const code = sourceText(`game/${file}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      // A string of the code with a space in it would be words: the DOM's class names and the checks' patterns have none but these.
      const worded = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1] as string).filter((text) => /[A-Za-z] [A-Za-z]/.test(text));
      expect(worded, file).toEqual(file === "turnedAway.ts" ? ["caption note"] : []);
    }
  });
});

describe("the game the words name", () => {
  it("is none in the engine's own words: a sentence says where the name goes, and nothing else of a game's", () => {
    const text = sourceText("game/turnedAwayWords.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text).not.toMatch(/Day Hike|\bhike/i);
    expect(words.GAME).toBe("{game}");
    expect(text.split(words.GAME).length - 1).toBe(20);
    // The sentences a browser's advice and its list are made of name no game, so the model hands them on as they stand.
    for (const table of [words.TURNED_AWAY_ADVICE, words.TURNED_AWAY_ADVICE_PHONE, words.TURNED_AWAY_BROWSERS]) {
      expect(JSON.stringify(table)).not.toContain(words.GAME);
    }
    expect(words.TURNED_AWAY_CREDITS).not.toContain(words.GAME);
  });

  it("is Day Hike on Day Hike's page, word for word as it has read: the engine's half", () => {
    // The name Day Hike's definition hands the shell, which the shell hands the page's model.
    expect(sourceText("shell.ts")).toContain("    return turnedAwayModel({\n      title: page.identity.title,\n");
  });
});
