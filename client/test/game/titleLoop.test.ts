import { afterEach, describe, expect, it, vi } from "vitest";
import { createTitleLoop } from "../../src/game/titleLoop.js";
import { asHtml, installStandInDom, type StandInVideo } from "./helpers/standInDom.js";

afterEach(() => vi.unstubAllGlobals());
const fast = { saveData: false, effectiveType: "4g", reducedMotion: false };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the title loop on the page", () => {
  it("lays the still over a silent, inline, looping video with nothing to download until the page has loaded", () => {
    const doc = installStandInDom();
    doc.readyState = "loading";
    const container = doc.createElement("div");
    const loop = createTitleLoop(asHtml(container), "/s.webp", "/v.mp4", fast);
    const video = container.children[0] as StandInVideo;
    const still = container.children[1]!;
    expect([video.tagName, still.tagName]).toEqual(["VIDEO", "IMG"]);
    for (const a of ["muted", "playsinline", "loop", "disablepictureinpicture", "disableremoteplayback"]) expect(video.hasAttribute(a)).toBe(true);
    expect([video.muted, video.getAttribute("preload"), video.getAttribute("aria-hidden"), video.getAttribute("src")]).toEqual([true, "none", "true", null]);
    expect([still.className, still.getAttribute("src"), still.getAttribute("alt")]).toEqual(["landing-bg ready", "/s.webp", ""]);
    doc.finishLoading();
    expect([video.getAttribute("src"), video.getAttribute("preload")]).toEqual(["/v.mp4", "auto"]);
    loop.dispose();
  });

  it("starts at once when the page has already loaded, plays and fades the still when it can play through", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    const loop = createTitleLoop(asHtml(container), "/s.webp", "/v.mp4", fast);
    const video = container.children[0] as StandInVideo;
    expect(video.getAttribute("src")).toBe("/v.mp4");
    video.dispatch("canplaythrough");
    expect([video.paused, container.children[1]?.className]).toEqual([false, "landing-bg ready gone"]);
    loop.dispose();
  });

  it("goes back to the still for good, and drops the download, when the browser refuses to play", async () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    const loop = createTitleLoop(asHtml(container), "/s.webp", "/v.mp4", fast);
    const video = container.children[0] as StandInVideo;
    video.refusePlay = true;
    video.dispatch("canplaythrough");
    await tick();
    expect([video.getAttribute("src"), video.loads, container.children[1]?.className]).toEqual([null, 1, "landing-bg ready"]);
    loop.dispose();
  });

  it("drops the download on stop, and leaves nothing behind on dispose", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    const loop = createTitleLoop(asHtml(container), "/s.webp", "/v.mp4", fast);
    const video = container.children[0] as StandInVideo;
    loop.stop();
    expect([video.getAttribute("src"), video.loads]).toEqual([null, 1]);
    loop.dispose();
    expect(container.children.length).toBe(0);
  });

  it("pauses while hidden and plays when shown, and a page opened in a background tab does not play until shown", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    const loop = createTitleLoop(asHtml(container), "/s.webp", "/v.mp4", fast);
    const video = container.children[0] as StandInVideo;
    video.dispatch("canplaythrough");
    doc.setVisibility("hidden");
    expect(video.paused).toBe(true);
    doc.setVisibility("visible");
    expect(video.paused).toBe(false);
    loop.dispose();

    const back = installStandInDom();
    back.visibilityState = "hidden";
    const c2 = back.createElement("div");
    const l2 = createTitleLoop(asHtml(c2), "/s.webp", "/v.mp4", fast);
    const v2 = c2.children[0] as StandInVideo;
    v2.dispatch("canplaythrough");
    expect(v2.paused).toBe(true);
    back.setVisibility("visible");
    expect(v2.paused).toBe(false);
    l2.dispose();
  });

  it("draws only what has shipped, and keeps the still where the visitor's settings say so", () => {
    const doc = installStandInDom();
    const none = doc.createElement("div");
    createTitleLoop(asHtml(none), null, null, fast).dispose();
    expect(none.children.length).toBe(0);
    const stillOnly = doc.createElement("div");
    const l1 = createTitleLoop(asHtml(stillOnly), "/s.webp", null, fast);
    expect(stillOnly.children.map((c) => c.tagName)).toEqual(["IMG"]);
    l1.dispose();
    const reduced = doc.createElement("div");
    const l2 = createTitleLoop(asHtml(reduced), "/s.webp", "/v.mp4", { ...fast, reducedMotion: true });
    expect(reduced.children[0]?.getAttribute("src")).toBeNull();
    l2.dispose();
  });
});
