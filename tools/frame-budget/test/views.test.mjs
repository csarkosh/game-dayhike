import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TIER_SIZES, resolveViews, viewScript, viewUrl } from "../lib/views.mjs";

const stills = JSON.parse(readFileSync(new URL("../../previews/stills.json", import.meta.url), "utf8"));
const config = JSON.parse(readFileSync(new URL("../views.json", import.meta.url), "utf8"));

describe("views", () => {
  it("resolves every budget view to a still, and the check views only by name", () => {
    const all = resolveViews(config, stills);
    expect(all.map((v) => v.view.name)).toEqual(["trailhead", "forest", "tarn", "meadow", "crest", "beach", "forest-night"]);
    expect(resolveViews(config, stills, ["chase"])[0].view.check).toBe(true);
    expect(resolveViews(config, stills, ["chase"])[0].still).toBeUndefined();
    expect(() => resolveViews(config, stills, ["lake"])).toThrow(/no view named lake/);
    expect(() => resolveViews({ ...config, views: [{ name: "x", still: "nowhere" }] }, stills)).toThrow(/nowhere/);
  });
  it("writes the scripts the design fixes", () => {
    const forest = stills.stills.find((s) => s.name === "forest");
    expect(viewScript({ name: "forest", still: "forest" }, forest)).toBe("seed atmo;freecam 250 -500 1.09;escalation 0;unsettle 0");
    expect(viewScript({ name: "forest-night", still: "forest", firstPerson: true, escalation: 1, lamp: true }, forest)).toBe("seed atmo;stand 250 -500 1.09;escalation 1;unsettle 0;lamp");
    expect(viewScript({ name: "chase", seed: "atmo", look: "summit" }, undefined)).toBe("seed atmo;summit");
  });
  it("links the view on the stills' world, the tier, telemetry off, and the readout when asked", () => {
    const forest = stills.stills.find((s) => s.name === "forest");
    expect(viewUrl("https://games.csarko.sh/dayhike/", stills.game, "medium", { name: "forest", still: "forest" }, forest, { gpuTime: true })).toBe(
      "https://games.csarko.sh/dayhike/game/0f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b?cmd=seed%20atmo;freecam%20250%20-500%201.09;escalation%200;unsettle%200&tier=medium&telemetry=off&gpuTime",
    );
  });
  it("holds the two standards' sizes", () => {
    expect(TIER_SIZES).toEqual({ medium: { width: 1470, height: 956 }, high: { width: 1512, height: 982 } });
  });
});
