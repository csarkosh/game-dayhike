import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The hike's own half of the sky's wiring, read from its source: the engine's half, in `app.ts`, is read
 * by the engine's own suite (`engine/test/game/appSky.test.ts`).
 */
// The escalation's sync is the hike's own (`hike.ts`, where a variable of `app.ts` is written `h.<name>`); the swap's restore stays in `app.ts`.
const hikeSrc = readFileSync(fileURLToPath(new URL("../../src/hike.ts", import.meta.url)), "utf8");

describe("the hike's sky", () => {
  it("moves the hour and the weather in one apply, in the escalation's sync and in a swap's restore", () => {
    const sync = hikeSrc.slice(hikeSrc.indexOf("  function syncAtmosphere("), hikeSrc.indexOf("  let signs: HikeSigns | null = null;"));
    // The audio hears the settled weather; the view, the mist the end scene's road shot draws back.
    expect(sync).toContain("    h.renderer.setView(a.hour, a.weather);\n    h.ambient.setWeather(settled.weather);");
    expect(sync).not.toMatch(/h\.renderer\.set(?:Hour|Weather)\(/);
    // The sun's light alone, on every frame, ahead of the gate (2026-10-18).
    expect(sync.indexOf("    h.renderer.followHour(a.hour);\n")).toBeGreaterThan(sync.indexOf("    const a = mist === 1"));
    expect(sync.indexOf("    h.renderer.followHour(a.hour);\n")).toBeLessThan(sync.indexOf("    const hourMoved ="));
  });
});
