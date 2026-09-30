import { afterEach, describe, expect, it, vi } from "vitest";
import { createIntroOverlay, type Caption, type CutReason } from "../../src/game/introOverlay.js";
import { StandInElement, asHtml, installStandInDom, type StandInDocument } from "./helpers/standInDom.js";

const captions: Caption[] = [{ from: 1, to: 3, text: "Four-one, dispatch.", radio: true }];

/** A stand-in video: the element's surface the overlay reads and drives. */
class StandInVideo extends StandInElement {
  currentTime = 0;
  ended = false;
  muted = false;
  played = 0;
  paused = 0;
  loaded = 0;
  ranges: [number, number][] = [];
  constructor(doc: StandInDocument) {
    super(doc, "video");
  }
  get buffered() {
    const r = this.ranges;
    return { length: r.length, start: (i: number) => r[i]![0], end: (i: number) => r[i]![1] };
  }
  play(): Promise<void> {
    this.played++;
    return Promise.resolve();
  }
  pause(): void {
    this.paused++;
  }
  load(): void {
    this.loaded++;
  }
}

function rig(over: { captions?: Caption[]; muted?: boolean } = {}) {
  const doc = installStandInDom();
  const container = doc.createElement("div");
  doc.body.append(container);
  const video = new StandInVideo(doc);
  let t = 0;
  const cuts: CutReason[] = [];
  const overlay = createIntroOverlay(
    asHtml(container),
    { src: "/x.mp4", captions: over.captions ?? captions, muted: over.muted, onCut: (reason) => void cuts.push(reason) },
    { video: () => video as unknown as HTMLVideoElement, now: () => t },
  );
  return { doc, container, video, overlay, cuts, at: (ms: number) => { t = ms; } };
}

afterEach(() => vi.unstubAllGlobals());

describe("the intro overlay", () => {
  it("draws the video, the caption at the video's time, and the bar's line", () => {
    const r = rig();
    expect(r.container.querySelector("video")?.getAttribute("src")).toBe("/x.mp4");
    r.overlay.progress.total("models", 45);
    r.overlay.progress.start("models", "a");
    r.video.currentTime = 2;
    r.overlay.render(0);
    expect(r.container.querySelector("div.intro-caption")?.textContent).toBe("Four-one, dispatch.");
    expect(r.container.querySelector("div.intro-caption")?.classList.contains("radio")).toBe(true);
    expect(r.container.querySelector("div.intro-line")?.textContent).toBe("downloading models 0 of 45");
    expect(r.container.querySelector("div.intro-bar-fill")?.style["width"]).toBe("0%");
    r.video.currentTime = 4;
    r.overlay.render(16);
    expect(r.container.querySelector("div.intro-caption")?.textContent).toBe("");
    expect(r.container.querySelector("div.intro-caption")?.classList.contains("radio")).toBe(false);
    r.overlay.dispose();
  });

  it("shows hold to skip once ready, and cuts on a full hold of a key", () => {
    const r = rig();
    r.overlay.render(0);
    expect(r.container.querySelector("div.intro-skip")?.classList.contains("shown")).toBe(false);
    r.overlay.ready();
    r.overlay.render(10);
    expect(r.container.querySelector("div.intro-skip")?.classList.contains("shown")).toBe(true);
    r.at(100);
    r.container.dispatch("keydown", { code: "Space" });
    r.overlay.render(500);
    expect(r.cuts).toEqual([]);
    r.overlay.render(1000);
    // Held past the ring: the cut waits for the release, in its own event.
    expect(r.cuts).toEqual([]);
    r.at(1100);
    r.container.dispatch("keyup", { code: "Space" });
    expect(r.cuts).toEqual(["hold"]);
    r.overlay.render(1200);
    expect(r.cuts).toEqual(["hold"]);
    r.overlay.dispose();
  });

  it("holds the last frame, shows the title card, then steps out on a click in the click's own task", () => {
    const r = rig();
    r.overlay.ready();
    r.video.ended = true;
    r.overlay.render(1000);
    expect(r.container.querySelector("div.intro-title")?.classList.contains("shown")).toBe(true);
    expect(r.container.querySelector("div.intro-stepout")?.classList.contains("shown")).toBe(false);
    r.overlay.render(4000);
    expect(r.container.querySelector("div.intro-title")?.classList.contains("shown")).toBe(false);
    expect(r.container.querySelector("div.intro-stepout")?.classList.contains("shown")).toBe(true);
    r.at(4100);
    r.container.querySelector("div.intro")?.dispatch("pointerdown");
    expect(r.cuts).toEqual(["stepOut"]);
    r.overlay.dispose();
  });

  it("starts the game when the video errors, and stops the video", () => {
    const r = rig();
    r.video.dispatch("error");
    expect(r.cuts).toEqual(["error"]);
    expect(r.container.querySelector("video")).toBeNull();
    expect(r.video.paused).toBe(1);
    expect(r.video.loaded).toBe(1);
    r.overlay.dispose();
    expect(r.video.paused).toBe(1);
  });

  it("starts muted when told to, shows the sound button plainly while muted, and a click on it unmutes", () => {
    const r = rig({ muted: true });
    expect(r.video.muted).toBe(true);
    r.overlay.render(0);
    const button = r.container.querySelector("button.intro-sound");
    expect(button?.classList.contains("muted")).toBe(true);
    expect(button?.textContent).toBe("sound off");
    button?.dispatch("pointerdown");
    expect(r.overlay.playback.state()).toBe("playing");
    button?.click();
    r.overlay.render(16);
    expect(r.video.muted).toBe(false);
    expect(button?.classList.contains("muted")).toBe(false);
    expect(button?.textContent).toBe("sound on");
    button?.click();
    r.overlay.render(32);
    expect(r.video.muted).toBe(true);
    r.overlay.dispose();
  });

  it("starts with sound by default, the button faded", () => {
    const r = rig();
    r.overlay.render(0);
    expect(r.video.muted).toBe(false);
    expect(r.container.querySelector("button.intro-sound")?.classList.contains("muted")).toBe(false);
    r.overlay.dispose();
  });

  it("reads the seconds buffered ahead of the video's time", () => {
    const r = rig();
    r.video.ranges = [[0, 8.5]];
    r.video.currentTime = 2;
    expect(r.overlay.bufferedAhead()).toBe(6.5);
    r.video.currentTime = 9;
    expect(r.overlay.bufferedAhead()).toBe(0);
    r.overlay.dispose();
  });

});
