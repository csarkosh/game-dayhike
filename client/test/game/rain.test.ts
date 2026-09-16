import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createRain, RAIN_EMITTER_LIFT, RAIN_FALL_SPEED, RAIN_SLANT } from "../../src/game/rain.js";
import { RAIN_CAPACITY, WEATHER_PRESETS } from "../../src/game/weather.js";
import { windRecordUnder } from "../../src/game/windParams.js";

const STILL = windRecordUnder(WEATHER_PRESETS.clear, 0, 0);

let engine: NullEngine | null = null;
afterEach(() => { engine?.dispose(); engine = null; });
function scene(): Scene { engine = new NullEngine(); return new Scene(engine); }

describe("createRain", () => {
  it("sizes the system to the tier capacity and starts stopped", () => {
    const s = scene();
    const rain = createRain(s, "medium");
    expect(rain.system.getCapacity()).toBe(RAIN_CAPACITY.medium);
    expect(rain.system.isStarted()).toBe(false);
    rain.dispose();
  });

  it("rain weather starts the system at full rate; clear stops it again", () => {
    const s = scene();
    const rain = createRain(s, "high");
    const cam = { x: 10, y: 5, z: -20 };
    rain.update(cam, WEATHER_PRESETS.rain, STILL);
    expect(rain.system.isStarted()).toBe(true);
    expect(rain.system.emitRate).toBe(RAIN_CAPACITY.high);
    const emitter = rain.system.emitter as { x: number; y: number; z: number };
    expect(emitter.x).toBe(cam.x);
    expect(emitter.y).toBe(cam.y + RAIN_EMITTER_LIFT);
    expect(emitter.z).toBe(cam.z);

    // `ParticleSystem.isStarted()` is a one-way latch by Babylon's own design —
    // its JSDoc says outright "this will still be true after stop is called" —
    // and only clears once an `animate()` tick observes the particle pool fully
    // drained. Under NullEngine that tick never lands: `isReady()` gates the
    // body of `animate()`, and the particle effect never compiles here
    // (`XMLHttpRequest is not defined` — this repo's shader source loads over
    // an XHR that Node's `environment: "node"` vitest config does not shim),
    // so `isReady()` never returns true, in any number of render frames.
    // `stop()` is still the right, and only, call for `rain 0`; verified here
    // via the observable it fires synchronously, which does not depend on
    // render readiness the way `isStarted()` does.
    let stopped = false;
    rain.system.onStoppedObservable.addOnce(() => { stopped = true; });
    rain.update(cam, WEATHER_PRESETS.clear, STILL);
    expect(stopped).toBe(true);
    rain.dispose();
  });

  it("resumes emission on a rain -> clear -> rain flip inside the drain window", () => {
    const s = scene();
    const rain = createRain(s, "high");
    const cam = { x: 0, y: 0, z: 0 };

    // `onStartedObservable`/`onStoppedObservable` fire synchronously from
    // `start()`/`stop()` themselves, unlike `isStarted()` (see the comment on
    // the previous test) — so counting them is what actually proves `update`
    // called `start()` a second time, rather than merely reading a rate.
    let startCount = 0;
    let stopCount = 0;
    rain.system.onStartedObservable.add(() => { startCount++; });
    rain.system.onStoppedObservable.add(() => { stopCount++; });

    rain.update(cam, WEATHER_PRESETS.rain, STILL);
    expect(startCount).toBe(1);
    expect(rain.system.emitRate).toBe(RAIN_CAPACITY.high);

    rain.update(cam, WEATHER_PRESETS.clear, STILL);
    expect(stopCount).toBe(1);
    expect(rain.system.emitRate).toBe(0);
    // Babylon's one-way latch: still true here even though `stop()` was just
    // called — exactly why the fix cannot gate `start()` on this reading.
    expect(rain.system.isStarted()).toBe(true);

    rain.update(cam, WEATHER_PRESETS.rain, STILL);
    // The regression this guards: a `!system.isStarted()` gate would see
    // `isStarted() === true` left over from the first `start()` and never
    // call `start()` again here, so rain would silently stay off.
    expect(startCount).toBe(2);
    expect(rain.system.emitRate).toBe(RAIN_CAPACITY.high);

    rain.dispose();
  });

  it("slants downwind by RAIN_SLANT·speed", () => {
    const s = scene();
    const rain = createRain(s, "high");
    const wind = { ...windRecordUnder(WEATHER_PRESETS.rain, 0), dirX: 0, dirZ: 1 };
    rain.update({ x: 0, y: 0, z: 0 }, WEATHER_PRESETS.rain, wind);
    expect((rain.system.direction1.z + rain.system.direction2.z) / 2).toBeCloseTo(RAIN_SLANT * wind.speed, 6);
    expect(rain.system.direction1.y).toBe(-RAIN_FALL_SPEED);
    rain.dispose();
  });
});
