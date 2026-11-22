import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGameSettings, parseGameSettings } from "../src/gameSettings.js";

const GOOD = {
  app: "game-dayhike",
  telemetryDataset: "dayhike_telemetry",
  telemetryBucket: "dayhike-telemetry",
  allowedOrigins: ["https://games.csarko.sh"],
};
const parse = (value: unknown) => parseGameSettings(JSON.stringify(value), "test.json");

describe("Day Hike's settings file", () => {
  const settings = loadGameSettings();
  it("names the app, dataset and bucket", () => {
    expect(settings.app).toBe("game-dayhike");
    expect(settings.telemetryDataset).toBe("dayhike_telemetry");
    expect(settings.telemetryBucket).toBe("dayhike-telemetry");
  });
  it("lists the origins, in order", () => {
    expect(settings.allowedOrigins).toEqual([
      "https://games.csarko.sh",
      "https://game.csarko.sh",
      "https://fps-csarko.web.app",
      "https://fps-csarko.firebaseapp.com",
      "http://localhost:5173",
      "https://localhost:5173",
      "https://admin.csarko.sh",
      "http://localhost:8788",
    ]);
  });
});

describe("parseGameSettings", () => {
  it("accepts a good file", () => {
    expect(parse(GOOD)).toEqual(GOOD);
  });
  for (const field of ["app", "telemetryDataset", "telemetryBucket", "allowedOrigins"]) {
    it(`refuses a file short of ${field}`, () => {
      const short: Record<string, unknown> = { ...GOOD };
      delete short[field];
      expect(() => parse(short)).toThrow(field);
    });
  }
  it("refuses an empty origins list", () => {
    expect(() => parse({ ...GOOD, allowedOrigins: [] })).toThrow("allowedOrigins");
  });
  it("refuses an origin that is not an origin", () => {
    expect(() => parse({ ...GOOD, allowedOrigins: ["https://games.csarko.sh/"] })).toThrow("allowedOrigins");
    expect(() => parse({ ...GOOD, allowedOrigins: ["games.csarko.sh"] })).toThrow("allowedOrigins");
  });
  it("refuses a bucket or dataset holding a character outside the set", () => {
    expect(() => parse({ ...GOOD, telemetryBucket: "day.hike" })).toThrow("telemetryBucket");
    expect(() => parse({ ...GOOD, telemetryBucket: "a`b" })).toThrow("telemetryBucket");
    expect(() => parse({ ...GOOD, telemetryDataset: "a b" })).toThrow("telemetryDataset");
  });
  it("refuses what is not an object, naming the file", () => {
    expect(() => parseGameSettings("[]", "x.json")).toThrow("x.json");
    expect(() => parseGameSettings("{", "x.json")).toThrow("x.json");
  });
});

describe("loadGameSettings", () => {
  const saved = process.env.GAME_SETTINGS;
  afterEach(() => {
    if (saved === undefined) delete process.env.GAME_SETTINGS;
    else process.env.GAME_SETTINGS = saved;
  });

  it("throws naming a path that is not there", () => {
    expect(() => loadGameSettings("/nonexistent/game.json")).toThrow("/nonexistent/game.json");
  });
  it("honours GAME_SETTINGS", () => {
    const file = join(mkdtempSync(join(tmpdir(), "game-settings-")), "other.json");
    writeFileSync(file, JSON.stringify({ ...GOOD, app: "other-game" }));
    process.env.GAME_SETTINGS = file;
    expect(loadGameSettings().app).toBe("other-game");
    process.env.GAME_SETTINGS = "/nonexistent/env.json";
    expect(() => loadGameSettings()).toThrow("/nonexistent/env.json");
  });
});
