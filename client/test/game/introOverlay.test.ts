import { afterEach, describe, expect, it, vi } from "vitest";
import { createIntroOverlay, type Caption, type CutReason } from "../../src/game/introOverlay.js";
import { StandInElement, asHtml, installStandInDom, type StandInDocument } from "@csarkosh/engine/testing/standInDom";

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

function rig(over: { captions?: Caption[]; muted?: boolean; sound?: () => boolean; warmed?: string; prepare?: (video: StandInVideo) => void } = {}) {
  const doc = installStandInDom();
  const container = doc.createElement("div");
  doc.body.append(container);
  const video = new StandInVideo(doc);
  over.prepare?.(video);
  // A film handed over already loading (`filmHead.ts`): it has its file before the overlay is made.
  if (over.warmed !== undefined) video.setAttribute("src", over.warmed);
  let srcSets = 0;
  const set = video.setAttribute.bind(video);
  video.setAttribute = (name: string, value: string): void => {
    if (name === "src") srcSets++;
    set(name, value);
  };
  let t = 0;
  const cuts: CutReason[] = [];
  const overlay = createIntroOverlay(
    asHtml(container),
    { src: "/x.mp4", captions: over.captions ?? captions, muted: over.muted, sound: over.sound, onCut: (reason) => void cuts.push(reason) },
    { video: () => video as unknown as HTMLVideoElement, now: () => t },
  );
  return { doc, container, video, overlay, cuts, srcSets: () => srcSets, at: (ms: number) => { t = ms; } };
}

afterEach(() => vi.unstubAllGlobals());

describe("the intro overlay", () => {
  it("gives a film made for it its file", () => {
    const r = rig();
    expect(r.srcSets()).toBe(1);
  });
  it("does not restart a film that was already loading its file", () => {
    const r = rig({ warmed: "/x.mp4" });
    expect(r.srcSets()).toBe(0);
    expect(r.container.querySelector("video")?.getAttribute("src")).toBe("/x.mp4");
  });
  it("gives a film warmed for another file the file it was asked for", () => {
    const r = rig({ warmed: "/other.mp4" });
    expect(r.srcSets()).toBe(1);
    expect(r.container.querySelector("video")?.getAttribute("src")).toBe("/x.mp4");
  });
  it("starts a warmed film muted for a page with no gesture of its own", () => {
    const r = rig({ warmed: "/x.mp4", muted: true });
    expect(r.video.muted).toBe(true);
  });
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

  it("offers the film to no other screen and no picture-in-picture window: a browser draws no cast button over it", () => {
    const r = rig();
    const video = r.container.querySelector("video");
    expect(video?.getAttribute("disableremoteplayback")).toBe("");
    expect(video?.getAttribute("disablepictureinpicture")).toBe("");
    // Safari's name for the same.
    expect(video?.getAttribute("x-webkit-airplay")).toBe("deny");
    r.overlay.dispose();
  });

  it("opens no menu on a long press: the press is a hold and nothing else", () => {
    const r = rig();
    // A phone's long press on the film asks for the browser's menu for a video (download, copy frame, picture in picture).
    const onFilm = r.container.querySelector("video")!.dispatch("contextmenu");
    expect(onFilm.defaultPrevented).toBe(true);
    const onBand = r.container.querySelector("div.intro-caption")!.dispatch("contextmenu");
    expect(onBand.defaultPrevented).toBe(true);
    // The film takes no press of its own (the overlay does), nothing in the overlay is selected or
    // called out by a press, and a finger that drifts is not the browser's to pan or zoom with.
    const style = r.container.querySelector("style")?.textContent ?? "";
    expect(style).toMatch(/\.intro video \{[^}]*pointer-events: none;/);
    expect(style).toMatch(/\.intro \{[^}]*touch-action: none;/);
    expect(style).toMatch(/\.intro \{[^}]*-webkit-touch-callout: none;/);
    expect(style).toMatch(/\.intro \{[^}]*-webkit-user-select: none;/);
    r.overlay.dispose();
    // Once the overlay is gone the page's menus are its own again.
    expect(r.container.dispatch("contextmenu").defaultPrevented).toBe(false);
  });

  it("cuts on a full hold of a finger, and reads a press the browser took away as a release", () => {
    const r = rig();
    r.overlay.ready();
    r.overlay.render(10);
    const root = r.container.querySelector("div.intro")!;
    // A press the browser cancels before the ring is full is a hold let go: no cut, and no hold left running.
    r.at(100);
    root.dispatch("pointerdown");
    r.overlay.render(400);
    r.at(450);
    root.dispatch("pointercancel");
    r.overlay.render(2000);
    r.at(2100);
    root.dispatch("pointerup");
    expect(r.cuts).toEqual([]);
    // A full hold, then the finger lifted: the cut.
    r.at(3000);
    root.dispatch("pointerdown");
    r.overlay.render(4000);
    expect(r.cuts).toEqual([]);
    r.at(4100);
    root.dispatch("pointerup");
    expect(r.cuts).toEqual(["hold"]);
    r.overlay.dispose();
  });

  it("cuts when a full hold ends by the browser taking the press", () => {
    const r = rig();
    r.overlay.ready();
    r.overlay.render(10);
    const root = r.container.querySelector("div.intro")!;
    r.at(100);
    root.dispatch("pointerdown");
    r.overlay.render(1000);
    r.at(1100);
    root.dispatch("pointercancel");
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

  it("starts muted when told to, and the page's first gesture, a press or a key, turns the track on", () => {
    const r = rig({ muted: true });
    expect(r.video.muted).toBe(true);
    r.overlay.render(0);
    r.video.dispatch("pointerdown");
    expect(r.overlay.playback.state()).toBe("playing");
    r.overlay.render(16);
    expect(r.video.muted).toBe(false);
    expect(r.container.querySelector("button.intro-sound")).toBeNull();
    r.overlay.dispose();
  });

  it("starts with sound by default, and follows the page's mute: off under it, on again when it lifts, a gesture or not", () => {
    const r = rig();
    r.overlay.render(0);
    expect(r.video.muted).toBe(false);
    let sound = false;
    const muted = rig({ sound: () => sound });
    expect(muted.video.muted).toBe(true);
    muted.video.dispatch("pointerdown");
    expect(muted.video.muted).toBe(true);
    sound = true;
    muted.overlay.setSound();
    expect(muted.video.muted).toBe(false);
    sound = false;
    muted.overlay.setSound();
    expect(muted.video.muted).toBe(true);
    r.overlay.dispose();
    muted.overlay.dispose();
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

  it("tells the hike's downloads the film plays only while it plays and could still use the link", () => {
    const playing = rig();
    const video = playing.video as unknown as { duration: number; error: unknown; networkState: number };
    video.duration = 72;
    video.networkState = 2;
    playing.video.ranges = [[0, 8.5]];
    playing.video.currentTime = 2;
    expect(playing.overlay.film()).toEqual({ playing: true, ahead: 6.5 });
    // Buffered to its end while its last bytes still arrive: it plays.
    playing.video.ranges = [[0, 71.9]];
    expect(playing.overlay.film().playing).toBe(true);
    // Wholly buffered, its fetch idle: it needs nothing more of the link.
    video.networkState = 1;
    expect(playing.overlay.film().playing).toBe(false);
    video.networkState = 2;
    playing.video.ranges = [[0, 8.5]];
    video.error = { code: 2 };
    expect(playing.overlay.film().playing).toBe(false);
    video.error = null;
    playing.video.ended = true;
    expect(playing.overlay.film().playing).toBe(false);
    playing.video.ended = false;
    playing.video.pause();
    expect(playing.overlay.film().playing).toBe(false);
    playing.overlay.dispose();
    const stopped = rig();
    expect(stopped.overlay.film().playing).toBe(true);
    stopped.overlay.stop();
    expect(stopped.overlay.film().playing).toBe(false);
    stopped.overlay.dispose();
  });

  it("counts the film's frames the screen never got, for the hike's load under it to be paced by", () => {
    // A browser that tells nothing of a film's frames: null, and the load under it keeps to its floor.
    const untold = rig();
    expect(untold.overlay.frames()).toBeNull();
    untold.overlay.dispose();
    // One that calls back for each frame it presents: the frames the film's time moved past unshown are counted.
    let call: ((now: number, frame: { mediaTime: number; presentedFrames: number }) => void) | null = null;
    let cancelled = 0;
    const watched = rig({
      prepare: (video) =>
        void Object.assign(video, {
          requestVideoFrameCallback: (next: typeof call) => {
            call = next;
            return 1;
          },
          cancelVideoFrameCallback: () => {
            cancelled++;
          },
        }),
    });
    const present = (time: number, presented: number): void => {
      watched.video.currentTime = time;
      const next = call;
      call = null;
      next?.(0, { mediaTime: time, presentedFrames: presented });
    };
    // Nothing is known of a film no frame of which has been called back for.
    expect(watched.overlay.frames()).toBeNull();
    watched.video.ranges = [[0, 12]];
    for (let n = 0; n < 12; n++) present(n / 24, n + 1);
    expect(watched.overlay.frames()).toEqual({ playing: true, missed: 0, clock: 11 / 24, fed: true });
    // Four frames of the film's time, one frame presented: three were never shown.
    present(15 / 24, 13);
    expect(watched.overlay.frames()?.missed).toBe(3);
    // The watch ends with the film, and what it last read is still told: the `intro` row reads it once the film has stopped.
    const last = watched.overlay.frames();
    watched.overlay.stop();
    expect(cancelled).toBe(1);
    expect(last?.missed).toBe(3);
    expect(watched.overlay.frames()).toEqual(last);
    watched.overlay.dispose();
  });

});
