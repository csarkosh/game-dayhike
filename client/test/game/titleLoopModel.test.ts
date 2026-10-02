import { describe, expect, it } from "vitest";
import { titleLoopNext, titleLoopStart, titleLoopView, type TitleLoopEnv, type TitleLoopEvent } from "../../src/game/titleLoopModel.js";

const fast: TitleLoopEnv = { saveData: false, effectiveType: "4g", reducedMotion: false, hasFilm: true };
const run = (env: TitleLoopEnv, events: TitleLoopEvent[]) => titleLoopView(events.reduce(titleLoopNext, titleLoopStart(env)));
const STILL = { src: false, playing: false, still: true };

describe("the title loop's model", () => {
  it("keeps the still when data is saved, the connection is slow, motion is to be reduced, or no film ships", () => {
    for (const env of [
      { ...fast, saveData: true }, { ...fast, effectiveType: "3g" }, { ...fast, effectiveType: "2g" },
      { ...fast, effectiveType: "slow-2g" }, { ...fast, reducedMotion: true }, { ...fast, hasFilm: false },
    ]) expect(run(env, ["load", "canplaythrough"])).toEqual(STILL);
  });

  it("counts a browser that does not say its connection as fast", () => {
    expect(run({ ...fast, effectiveType: null }, ["load", "canplaythrough"])).toEqual({ src: true, playing: true, still: false });
  });

  it("downloads after the page's load and shows the loop once it can play through", () => {
    expect(run(fast, [])).toEqual(STILL);
    expect(run(fast, ["canplaythrough"])).toEqual(STILL);
    expect(run(fast, ["load"])).toEqual({ src: true, playing: false, still: true });
    expect(run(fast, ["load", "canplaythrough"])).toEqual({ src: true, playing: true, still: false });
  });

  it("goes back to the still for good on an error or a refused play", () => {
    for (const e of ["error", "refused"] as const) expect(run(fast, ["load", "canplaythrough", e, "load", "canplaythrough"])).toEqual(STILL);
  });

  it("stops for good on Play, whatever it was doing", () => {
    for (const before of [[], ["load"], ["load", "canplaythrough"]] as TitleLoopEvent[][]) {
      expect(run(fast, [...before, "play", "load", "canplaythrough"])).toEqual(STILL);
    }
  });

  it("pauses while hidden and plays again when shown, from whenever it was hidden", () => {
    expect(run(fast, ["load", "canplaythrough", "hidden"])).toEqual({ src: true, playing: false, still: false });
    expect(run(fast, ["hidden", "load", "canplaythrough"])).toEqual({ src: true, playing: false, still: false });
    expect(run(fast, ["hidden", "load", "canplaythrough", "visible"])).toEqual({ src: true, playing: true, still: false });
  });
});
