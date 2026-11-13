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
    expect(renderer).toContain("clearEnding(liftS = 0) {");
    // The dark and the blur go over the seconds given, from what they were (ending.ts `liftShare`), not in one frame.
    expect(renderer).toMatch(/const share = liftShare\(seconds - lift\.since, lift\.forS\);\s*endClose = lift\.close \* share;\s*endBlur = lift\.blur \* share;/);
  });
});

describe("the hike's page, for a return", () => {
  const app = readFileSync(new URL("../../src/app.ts", import.meta.url), "utf8");

  it("clears every timer of the death before it lifts the dark, and replays the threshold with the cause's line", () => {
    const at = app.indexOf("function syncReturn(");
    expect(at).toBeGreaterThan(0);
    const body = app.slice(at, app.indexOf("\n  }\n", at));
    for (const piece of [
      "clearTimeout(deathFadeTimer)", "clearTimeout(deathSoundTimer)", "renderer.clearEnding(RETURN_LIFT_MS / 1000)", "hud.setEnding(null)", "hud.fade(false)",
      "ambient.restoreMaster(RETURN_LIFT_MS / 1000)", "sceneKind = \"return\"", "sceneUntil = performance.now() + (SHOTS[4] as number) * 1000",
      "THRESHOLD_AT_S)", "hud.setBars(true)", "returned = self.cause", "returnHollowAt(sim, self.pos)",
    ]) expect(body, piece).toContain(piece);
  });

  it("ends a scene's letterbox and its stilled controls when the match is decided, so neither outlives into the end scene", () => {
    const at = app.indexOf("function syncOutcome(");
    const body = app.slice(at, app.indexOf("\n  }\n", at));
    for (const piece of ["clearTimeout(barsTimer)", "sceneUntil = -1", "downLook = null"]) expect(body, piece).toContain(piece);
    // One timer for every scene's bars: a later scene's start takes the earlier one's off.
    expect(app).not.toContain("setTimeout(() => { hud.setBars(false); downLook = null; }, SUMMIT_SCENE_S * 1000);");
  });

  it("gives the voice the cause on the frame of the return, and reports the death's real cause", () => {
    expect(app).toContain("returned: returnedNow,");
    expect(app).not.toContain('cause: "hollow",');
  });
});
