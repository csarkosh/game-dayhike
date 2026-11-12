import { afterEach, describe, expect, it, vi } from "vitest";
import { createFilmHead, filmHeadWanted, warmWhenLoaded } from "../../src/game/filmHead.js";
import { installStandInDom, type StandInVideo } from "./helpers/standInDom.js";

afterEach(() => vi.unstubAllGlobals());
function rig() {
  const doc = installStandInDom();
  const made: StandInVideo[] = [];
  const head = createFilmHead({
    video: () => {
      const v = doc.createElement("video") as StandInVideo;
      made.push(v);
      return v as unknown as HTMLVideoElement;
    },
  });
  return { head, made };
}

describe("the film's head start", () => {
  it("makes one silent, inline element that preloads the film", () => {
    const { head, made } = rig();
    head.warm("/intro.mp4");
    head.warm("/intro.mp4");
    expect(made).toHaveLength(1);
    expect([made[0]!.getAttribute("src"), made[0]!.getAttribute("preload"), made[0]!.hasAttribute("playsinline"), made[0]!.muted]).toEqual(["/intro.mp4", "auto", true, true]);
  });
  it("hands the element over once, for the film it warmed", () => {
    const { head, made } = rig();
    head.warm("/intro.mp4");
    expect(head.take("/other.mp4")).toBeNull();
    expect(head.take("/intro.mp4")).toBe(made[0]);
    expect(head.take("/intro.mp4")).toBeNull();
  });
  it("makes no second element after the first was taken: a later hike makes its own", () => {
    const { head, made } = rig();
    head.warm("/intro.mp4");
    head.take("/intro.mp4");
    head.warm("/intro.mp4");
    expect(made).toHaveLength(1);
    expect(head.take("/intro.mp4")).toBeNull();
  });
  it("hands nothing over before it has warmed, or for an element that failed", () => {
    const { head, made } = rig();
    expect(head.take("/intro.mp4")).toBeNull();
    head.warm("/intro.mp4");
    (made[0] as unknown as { error: unknown }).error = { code: 4 };
    expect(head.take("/intro.mp4")).toBeNull();
    expect(made[0]!.getAttribute("src")).toBeNull();
    expect(made[0]!.loads).toBe(1);
  });
  it("ends the download when dropped", () => {
    const { head, made } = rig();
    head.warm("/intro.mp4");
    head.drop();
    expect(made[0]!.getAttribute("src")).toBeNull();
    expect(made[0]!.loads).toBe(1);
    expect(head.take("/intro.mp4")).toBeNull();
  });
  it("is wanted for a film on a connection the title loop would use", () => {
    expect(filmHeadWanted({ saveData: false, effectiveType: "4g" }, "/intro.mp4")).toBe(true);
    expect(filmHeadWanted({ saveData: false, effectiveType: null }, "/intro.mp4")).toBe(true);
    expect(filmHeadWanted({ saveData: true, effectiveType: "4g" }, "/intro.mp4")).toBe(false);
    expect(filmHeadWanted({ saveData: false, effectiveType: "3g" }, "/intro.mp4")).toBe(false);
    expect(filmHeadWanted({ saveData: false, effectiveType: "4g" }, null)).toBe(false);
  });
});

describe("the head start's moment", () => {
  it("warms at once on a page that has loaded", () => {
    let warmed = 0;
    warmWhenLoaded({ loaded: () => true, onLoad: () => { throw new Error("no listener is needed"); }, still: () => false }, () => { warmed++; });
    expect(warmed).toBe(1);
  });
  it("waits for the page's load, and warms then if the title page is still up", () => {
    let warmed = 0;
    let fire: () => void = () => undefined;
    warmWhenLoaded({ loaded: () => false, onLoad: (run) => { fire = run; }, still: () => true }, () => { warmed++; });
    expect(warmed).toBe(0);
    fire();
    expect(warmed).toBe(1);
  });
  it("does not warm at the page's load when Play was tapped first: the film is already playing from an element of its own", () => {
    let warmed = 0;
    let fire: () => void = () => undefined;
    warmWhenLoaded({ loaded: () => false, onLoad: (run) => { fire = run; }, still: () => false }, () => { warmed++; });
    fire();
    expect(warmed).toBe(0);
  });
});
