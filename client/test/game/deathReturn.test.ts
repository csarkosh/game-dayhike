import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { RETURN_LIFT_MS, createDeathReturn } from "../../src/game/deathReturn.js";

describe("a screen's death and return", () => {
  it("dies once, on the frame its player's health first reads nothing", () => {
    const d = createDeathReturn();
    expect(d.step(100)).toBeNull();
    expect(d.step(40)).toBeNull();
    expect(d.dead()).toBe(false);
    expect(d.step(0)).toBe("died");
    expect(d.dead()).toBe(true);
    expect(d.step(0)).toBeNull();
    expect(d.step(0)).toBeNull();
    expect(d.returns()).toBe(0);
  });

  it("returns once, on the frame the health is back, and can die and return again", () => {
    const d = createDeathReturn();
    d.step(100);
    d.step(0);
    expect(d.step(100)).toBe("returned");
    expect(d.dead()).toBe(false);
    expect(d.returns()).toBe(1);
    expect(d.step(100)).toBeNull();
    expect(d.step(0)).toBe("died");
    expect(d.step(100)).toBe("returned");
    expect(d.returns()).toBe(2);
  });

  it("is not returned by a player it never saw die, nor by one with no health to read", () => {
    const d = createDeathReturn();
    expect(d.step(100)).toBeNull();
    expect(d.step(undefined)).toBeNull();
    expect(d.dead()).toBe(false);
    d.step(0);
    // The player's record gone for a frame (a snapshot between): still under the death.
    expect(d.step(undefined)).toBeNull();
    expect(d.dead()).toBe(true);
  });

  it("lifts the dark over a little more than a second", () => {
    expect(RETURN_LIFT_MS).toBe(1200);
  });
});

describe("the renderer, for a return", () => {
  const renderer = readFileSync(new URL("../../src/game/renderer.ts", import.meta.url), "utf8");

  it("begins a scene part-way: the threshold alone, from its seventeenth second", () => {
    expect(renderer).toContain("setScene(kind, at, more, fromS = 0) {");
    expect(renderer).toContain("summitScene = { kind, since: clock() / 1000 - fromS, base: null,");
  });

  it("undoes a death's ending, so a scene's camera runs again, and leaves the won scene alone", () => {
    expect(renderer).toMatch(/clearEnding\(\) \{\s*ending = \{ kind: "died", since: -1, base: null \};\s*endBlur = 0;\s*endClose = 0;\s*\}/);
  });
});

describe("the hike's page, for a return", () => {
  const app = readFileSync(new URL("../../src/app.ts", import.meta.url), "utf8");

  it("clears every timer of the death before it lifts the dark, and replays the threshold with the cause's line", () => {
    const at = app.indexOf("function syncReturn(");
    expect(at).toBeGreaterThan(0);
    const body = app.slice(at, app.indexOf("\n  }\n", at));
    for (const piece of [
      "clearTimeout(deathFadeTimer)", "clearTimeout(deathSoundTimer)", "renderer.clearEnding()", "hud.setEnding(null)", "hud.fade(false)",
      "ambient.restoreMaster(RETURN_LIFT_MS / 1000)", "sceneKind = \"return\"", "sceneUntil = performance.now() + (SHOTS[4] as number) * 1000",
      "THRESHOLD_AT_S)", "hud.setBars(true)", "returned = self.cause",
    ]) expect(body, piece).toContain(piece);
  });

  it("gives the voice the cause on the frame of the return, and reports the death's real cause", () => {
    expect(app).toContain("returned: returnedNow,");
    expect(app).not.toContain('cause: "hollow",');
  });
});
