import { describe, expect, it } from "vitest";
import { calmShare } from "../../src/game/lakeCalm.js";
import { PAW_COVER_SHELTER, createCalmFade, fadedCalmShare, lakeCalmUnder, type LakeCalmFrame } from "../../src/game/lakeCalmFrame.js";
import { DEFAULT_WEATHER, WEATHER_PRESETS } from "../../src/game/weather.js";
import { GAME_FOV } from "../../src/game/gameLens.js";

describe("the lakes' calm through a weather fade", () => {
  it("stands at the default weather with no fade running", () => {
    const fade = createCalmFade();
    expect(fade.from).toBe(DEFAULT_WEATHER);
    expect(fade.to).toBe(DEFAULT_WEATHER);
    expect(fade.progress).toBe(1);
    fade.step(5);
    expect(fade.progress).toBe(1);
  });

  it("takes a preset at once where the fade is no time at all", () => {
    const fade = createCalmFade();
    fade.name("rain", 0, 6);
    expect([fade.from, fade.to, fade.progress]).toEqual(["rain", "rain", 1]);
    fade.name("mist", -1, 6);
    expect([fade.from, fade.to, fade.progress]).toEqual(["mist", "mist", 1]);
  });

  it("fades from the preset it stood at, by the seconds stepped, and ends on the new one", () => {
    const fade = createCalmFade();
    fade.name("clear", 0, 6);
    fade.name("overcast", 4, 6);
    expect([fade.from, fade.to, fade.progress]).toEqual(["clear", "overcast", 0]);
    fade.step(1);
    expect(fade.progress).toBe(0.25);
    fade.step(2);
    expect(fade.progress).toBe(0.75);
    fade.step(1);
    expect([fade.from, fade.to, fade.progress]).toEqual(["overcast", "overcast", 1]);
  });

  it("starts a fade taken over mid-way from the share the old one had reached at the hour", () => {
    const fade = createCalmFade();
    fade.name("clear", 0, 6);
    fade.name("overcast", 4, 6);
    fade.step(2);
    fade.name("rain", 3, 6);
    expect(fade.from).toBe(fadedCalmShare(6, "clear", "overcast", 0.5));
    expect(fade.from).toBe((calmShare(6, "clear") + calmShare(6, "overcast")) / 2);
    expect([fade.to, fade.progress]).toEqual(["rain", 0]);
  });

  it("gives the frame's calm the fade's ends and progress", () => {
    const fade = createCalmFade();
    fade.name("clear", 0, 6);
    fade.name("overcast", 4, 6);
    fade.step(2);
    const out: LakeCalmFrame = { share: -1, rough: true, roughShare: -1, cover: -1, smearPx: -1 };
    const c = lakeCalmUnder(6, fade.from, fade.to, fade.progress, WEATHER_PRESETS.clear, 0.25, 0.1, 900, GAME_FOV, out);
    expect(c.share).toBe(0.65);
    expect(c.rough).toBe(false);
    expect(c.cover).toBeCloseTo(((1 - 0.65) * 0.1) / PAW_COVER_SHELTER, 12);
  });
});
