import { describe, it, expect } from "vitest";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import {
  lampUnder, lampFlicker, lampPlace, DARK_LAMP_PLACE, LAMP_DREAD_DIM, LAMP_DREAD_TINT, LAMP_FLICKER_DEPTH, LAMP_COLOUR, LAMP_INTENSITY, LAMP_ANGLE, LAMP_EXPONENT, LAMP_RANGE,
} from "../../src/game/lampParams.js";
import { babylonValues } from "../helpers/babylonFixture.js";

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

describe("the lamp's cone", () => {
  it("is a 1.5 rad spot reaching 25 m, named once and handed on by the Babylon shell as it is", () => {
    expect([LAMP_ANGLE, LAMP_RANGE, LAMP_EXPONENT]).toEqual([1.5, 25, 8]);
    // What the shell on Babylon.js handed on (`headlamp.ts`), recorded.
    const headlamp = babylonValues<{ lamp: { angle: number; range: number; exponent: number; intensity: number; colour: number[] } }>("stages/declared.json").lamp;
    expect([headlamp.angle, headlamp.range, headlamp.exponent, headlamp.intensity, headlamp.colour]).toEqual([
      LAMP_ANGLE, LAMP_RANGE, LAMP_EXPONENT, LAMP_INTENSITY, LAMP_COLOUR,
    ]);
  });
});

describe("a dark lamp", () => {
  it("stands where the frame has it while lit, and overhead while dark", () => {
    const at = { x: -262, y: 9.6, z: -1 };
    expect(lampPlace(true, at)).toBe(at);
    expect(lampPlace(false, at)).toBe(DARK_LAMP_PLACE);
  });

  it("is within a hundredth of a radian of straight up from anywhere within five kilometres of the world's middle", () => {
    for (const [x, y, z] of [[0, 0, 0], [5000, 300, 0], [-3500, 1200, 3500], [0, -40, -5000]] as const) {
      const dx = DARK_LAMP_PLACE.x - x, dy = DARK_LAMP_PLACE.y - y, dz = DARK_LAMP_PLACE.z - z;
      expect(Math.acos(dy / Math.hypot(dx, dy, dz))).toBeLessThan(0.01);
    }
  });
});
