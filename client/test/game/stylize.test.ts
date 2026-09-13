import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { createStylize, type Stylize } from "../../src/game/stylize.js";
import { VIGNETTE_WEIGHT_BASE, WEATHER_PRESETS } from "../../src/game/weather.js";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

function build(tier: "low" | "medium" | "high"): Stylize {
  const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
  return createStylize(scene, camera, tier);
}

describe("createStylize under NullEngine — the silent-degradation contract", () => {
  it("constructs, updates, and disposes cleanly on every tier", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      const stylize = build(tier);
      stylize.update(WEATHER_PRESETS.eerie);
      stylize.update(WEATHER_PRESETS.clear);
      stylize.dispose();
    }
  });

  it("skips the outline pass where float render targets are absent", () => {
    // NullEngine reports no float/half-float render-target support — the same
    // capability line that turns CascadedShadowGenerator off in lighting.ts.
    const stylize = build("high");
    expect(stylize.outline).toBeNull();
    stylize.dispose();
  });

  it("enables the vignette on the shared image processing config, even on low", () => {
    const stylize = build("low");
    expect(scene.imageProcessingConfiguration.vignetteEnabled).toBe(true);
    expect(scene.imageProcessingConfiguration.vignetteWeight).toBe(VIGNETTE_WEIGHT_BASE);
    stylize.dispose();
  });

  it("update follows the weather's dread", () => {
    const stylize = build("low");
    stylize.update(WEATHER_PRESETS.eerie);
    expect(scene.imageProcessingConfiguration.vignetteWeight).toBeGreaterThan(VIGNETTE_WEIGHT_BASE);
    stylize.update(WEATHER_PRESETS.clear);
    expect(scene.imageProcessingConfiguration.vignetteWeight).toBe(VIGNETTE_WEIGHT_BASE);
    stylize.dispose();
  });
});
