import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createMotes } from "../../src/game/motes.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { windRecordUnder } from "../../src/game/windParams.js";

let engine: NullEngine;
let scene: Scene;
beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterEach(() => { scene.dispose(); engine.dispose(); });

describe("createMotes", () => {
  it("is null on low and builds three systems otherwise", () => {
    expect(createMotes(scene, "low")).toBeNull();
    const motes = createMotes(scene, "high");
    expect(motes?.systems.length).toBe(3);
    const wind = windRecordUnder(WEATHER_PRESETS.clear, 0);
    motes?.update({ x: 0, y: 5, z: 0 }, WEATHER_PRESETS.clear, 12, { r: 0.5, g: 0.5, b: 0.5 }, wind);
    motes?.update({ x: 0, y: 5, z: 0 }, WEATHER_PRESETS.rain, 12, { r: 0.5, g: 0.5, b: 0.5 }, wind);
    motes?.dispose();
  });
});
