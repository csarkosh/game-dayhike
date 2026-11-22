import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";
import { emptyAtmosphereUniforms } from "@csarkosh/engine/game/atmosphereParams";
import { WAY_HAZE_DENSITY, WAY_HAZE_SHARE, wayHazeInto } from "../../src/game/wayHaze.js";

/** A night's clear air: thin, dark and blue. */
function air() {
  const a = emptyAtmosphereUniforms();
  a.atmOn[0] = 1;
  a.atmBaseDensity[0] = 0.001;
  a.atmFarColour[0] = 0.01; a.atmFarColour[1] = 0.02; a.atmFarColour[2] = 0.04;
  a.atmSunColour[0] = 0.02; a.atmSunColour[1] = 0.02; a.atmSunColour[2] = 0.03;
  return a;
}
const MIST: readonly [number, number, number] = [0.3, 0.2, 0.25];

describe("the chase's haze on the tiers with no post chain", () => {
  it("names its numbers", () => {
    expect([WAY_HAZE_DENSITY, WAY_HAZE_SHARE]).toEqual([0.012, 0.82]);
  });

  it("changes nothing while the way's mist is down", () => {
    const a = air(), before = JSON.stringify(a);
    expect(wayHazeInto(a, 0, MIST)).toBe(a);
    expect(JSON.stringify(a)).toBe(before);
  });

  it("at the whole mist the air is the haze: its density, and a share of the mist's colour in the gradient and the glow", () => {
    const a = wayHazeInto(air(), 1, MIST);
    expect(a.atmBaseDensity[0]).toBe(WAY_HAZE_DENSITY);
    for (let i = 0; i < 3; i++) {
      expect(a.atmFarColour[i]).toBeCloseTo(MIST[i]! * WAY_HAZE_SHARE, 9);
      expect(a.atmSunColour[i]).toBeCloseTo(MIST[i]! * WAY_HAZE_SHARE, 9);
    }
  });

  it("comes in with the mist's level, part way at part of it", () => {
    const a = wayHazeInto(air(), 0.5, MIST);
    expect(a.atmBaseDensity[0]).toBeCloseTo((0.001 + WAY_HAZE_DENSITY) / 2, 9);
    expect(a.atmFarColour[0]).toBeCloseTo((0.01 + MIST[0] * WAY_HAZE_SHARE) / 2, 9);
    expect(a.atmSunColour[2]).toBeCloseTo((0.03 + MIST[2] * WAY_HAZE_SHARE) / 2, 9);
  });

  it("never thins air the weather has made thicker than the haze", () => {
    const a = air();
    a.atmBaseDensity[0] = 0.03;
    expect(wayHazeInto(a, 1, MIST).atmBaseDensity[0]).toBe(0.03);
  });

  it("leaves the rest of the air's record alone", () => {
    const a = air();
    a.atmHeightDensity[0] = 0.4;
    a.atmGradientScale[0] = 0.002;
    wayHazeInto(a, 1, MIST);
    expect([a.atmOn[0], a.atmHeightDensity[0], a.atmGradientScale[0]]).toEqual([1, 0.4, 0.002]);
  });
});

describe("the renderer", () => {
  // Day Hike's side of the renderer (`lite/hikeParts.ts`), where what is this game's own in a frame is written; the engine's renderer is read by the engine's own suite.
  const renderer = sourceText("game/lite/hikeParts.ts");

  it("lays the haze on the frame's air only where no chain grades the frame, in the mist's own colour under the chase's cast", () => {
    expect(renderer).toContain('wayHazeInto(air, wayLevel, wayTint("material", cloudColourUnder(host.nearColour()), 1, look.cast, CHASE_TINT));');
    expect(renderer.match(/wayHazeInto\(/g)).toHaveLength(1);
  });
});
