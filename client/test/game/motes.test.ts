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
  it("is null on low and builds two systems otherwise, the pollen's and the frost's, a third of the capacity each", () => {
    expect(createMotes(scene, "low")).toBeNull();
    const motes = createMotes(scene, "high");
    expect(motes?.systems.map((s) => [s.name, s.getCapacity()])).toEqual([["motes_pollen", 500], ["motes_frost", 500]]);
    const wind = windRecordUnder(WEATHER_PRESETS.clear, 0);
    motes?.update({ x: 0, y: 5, z: 0 }, WEATHER_PRESETS.clear, 12, { r: 0.5, g: 0.5, b: 0.5 }, wind);
    motes?.update({ x: 0, y: 5, z: 0 }, WEATHER_PRESETS.rain, 12, { r: 0.5, g: 0.5, b: 0.5 }, wind);
    motes?.dispose();
    const medium = createMotes(scene, "medium");
    expect(medium?.systems.map((s) => [s.name, s.getCapacity()])).toEqual([["motes_pollen", 200], ["motes_frost", 200]]);
    medium?.dispose();
  });

  it("emits no midge at dusk: the pollen's and the frost's rates are the only ones set", () => {
    const motes = createMotes(scene, "high")!;
    const wind = windRecordUnder(WEATHER_PRESETS.clear, 0);
    motes.update({ x: 0, y: 5, z: 0 }, WEATHER_PRESETS.clear, 18.3, { r: 0.5, g: 0.5, b: 0.5 }, wind);
    expect(motes.systems.map((s) => [s.name, s.emitRate])).toEqual([["motes_pollen", 0], ["motes_frost", 53.281552301987624]]);
    expect(scene.particleSystems.map((s) => s.name)).toEqual(["motes_pollen", "motes_frost"]);
    motes.dispose();
  });
});
