import { describe, it, expect } from "vitest";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import {
  lampUnder, lampFlicker, LAMP_DREAD_DIM, LAMP_DREAD_TINT, LAMP_FLICKER_DEPTH, LAMP_COLOUR, LAMP_INTENSITY,
} from "../../src/game/lampParams.js";

const CLEAR = WEATHER_PRESETS.clear;
const EERIE = WEATHER_PRESETS.eerie;

describe("the lamp misbehaves", () => {
  it("is exactly the tuned lamp at clear, at every time", () => {
    for (const t of [0, 0.37, 4.2, 99.9]) {
      const lamp = lampUnder(CLEAR, t);
      expect(lamp.intensity).toBe(LAMP_INTENSITY);
      expect(lamp.colour).toEqual({ r: LAMP_COLOUR[0], g: LAMP_COLOUR[1], b: LAMP_COLOUR[2] });
    }
  });

  it("dims and warms on the top plateau", () => {
    const lamp = lampUnder({ ...EERIE, dread: 1 }, 0.05);
    expect(lamp.intensity).toBeLessThanOrEqual(LAMP_INTENSITY * (1 - LAMP_DREAD_DIM) + 1e-9);
    expect(lamp.colour.b).toBeLessThan(LAMP_COLOUR[2]);
    expect(lamp.colour).toEqual(LAMP_DREAD_TINT);
  });

  it("flickers only under dread, in bounded bursts, and fires within ten seconds at full dread", () => {
    let fired = false;
    for (let t = 0; t < 10; t += 0.05) {
      expect(lampFlicker(t, 0)).toBe(1);
      const f = lampFlicker(t, 1);
      expect(f).toBeGreaterThanOrEqual(1 - LAMP_FLICKER_DEPTH);
      expect(f).toBeLessThanOrEqual(1);
      if (f < 1) fired = true;
    }
    expect(fired).toBe(true);
  });

  it("holds still most of the time so a flicker stays an event", () => {
    let dips = 0;
    const n = 400;
    for (let i = 0; i < n; i++) if (lampFlicker(i * 0.05, 1) < 1) dips += 1;
    expect(dips / n).toBeLessThan(0.3);
  });
});
