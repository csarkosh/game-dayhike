import { describe, expect, it } from "vitest";
import {
  EMPTY_BLACK_SHARE,
  GPU_DISTINCT_MAX,
  GPU_ERROR_ROWS,
  GPU_LABELS_MAX,
  GPU_MESSAGE_MAX,
  GPU_WINDOWS,
  GPU_WINDOW_MS,
  LOST_MESSAGE_MAX,
  PICTURE_HEIGHT,
  PICTURE_WAIT_MS,
  PICTURE_WIDTH,
  createGpuFaults,
  faultSourceOf,
  gpuErrorKind,
  gpuErrorText,
  gpuFaultKey,
  gpuLabelsIn,
  hearErrorScopes,
  pictureStats,
  pictureVerdict,
  readPictureSmall,
  type FaultListener,
  type FaultSource,
  type GpuFaultDeps,
  type PictureRead,
  type RendererFacts,
} from "../../src/game/gpuFaults.js";
import type { HeldCounts } from "../../src/game/deviceHeld.js";
import { createLossRecord } from "../../src/game/lossBound.js";
import type { Fields } from "../../src/net/telemetry.js";

// The browser's own classes, by the names it gives them.
class GPUValidationError { constructor(readonly message: string) {} }
class GPUOutOfMemoryError { constructor(readonly message: string) {} }
class GPUInternalError { constructor(readonly message: string) {} }

/** A validation error as Chrome words one: the objects it names in brackets, the pipeline last. */
const BAD_DRAW = "Vertex range (first: 0, count: 2616) requires a larger buffer (62784) than the bound buffer size (31392) of the vertex buffer at slot 2 with stride 12.\n - While encoding [RenderPassEncoder \"scene\"].Draw(2616, 1, 0, 0).\n - While finishing [CommandEncoder (unlabeled)].\n [RenderPipeline \"terrain-ground\"] [Device]";

const PIXELS = PICTURE_WIDTH * PICTURE_HEIGHT;
/** A picture of one colour, or of a ramp from black to `to`. */
function picture(to: [number, number, number], ramp = false, alpha = 255): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(PIXELS * 4);
  for (let i = 0; i < PIXELS; i++) {
    const f = ramp ? i / (PIXELS - 1) : 1;
    rgba.set([to[0] * f, to[1] * f, to[2] * f, alpha], i * 4);
  }
  return rgba;
}

/** A renderer's side: what it says of itself, set by the test, and a picture handed over when the test draws a frame. */
function fakeSource(over: Partial<RendererFacts> = {}) {
  const facts: RendererFacts = { tier: "medium", state: "standing", frames: 600, stoodMs: 20_000, scene: false, ending: false, dark: 0, rain: 0.25, wet: 0.5, night: 0.125, hour: 14.26, lakes: 1, sea: false, ...over };
  let listener: FaultListener | null = null;
  let waiting: ((read: PictureRead) => void) | null = null;
  let held: HeldCounts | null = { buffers: 1807, bufferBytes: 96 * 1_048_576, textures: 275, textureBytes: 540.26 * 1_048_576 };
  const source: FaultSource = {
    tell: (to) => void (listener = to),
    facts: () => ({ ...facts }),
    held: () => held,
    judge(done) {
      waiting = done;
      return () => void (waiting = null);
    },
  };
  return {
    source,
    renderer: { gpuFaults: source },
    facts,
    listener: () => listener,
    setHeld: (next: HeldCounts | null) => void (held = next),
    /** A frame drawn: the count moves, and a picture asked for is handed over. */
    frame(read: PictureRead = { rgba: picture([120, 140, 90], true), why: "" }) {
      facts.frames++;
      const done = waiting;
      waiting = null;
      done?.(read);
    },
    waits: () => waiting !== null,
  };
}

function record(over: Partial<GpuFaultDeps> = {}) {
  const sent: { n: string; f: Fields }[] = [];
  const timers: { fn: () => void; at: number; live: boolean }[] = [];
  const clock = { now: 100_000 };
  const hike = { ready: true, busy: "", film: false, hidden: false, shownMs: 41_000, p: 0.312, tick: 4_810 };
  const losses = createLossRecord();
  const deps: GpuFaultDeps = {
    enabled: true,
    send: (n, f) => void sent.push({ n, f }),
    hike: () => ({ ...hike }),
    loss: () => losses.note(clock.now),
    heapMb: () => 311.04,
    now: () => clock.now,
    setTimer(fn, ms) {
      const timer = { fn, at: clock.now + ms, live: true };
      timers.push(timer);
      return () => void (timer.live = false);
    },
    ...over,
  };
  return {
    faults: createGpuFaults(deps),
    sent,
    hike,
    clock,
    /** Moves the clock on and fires what came due, in order. */
    pass(ms: number) {
      clock.now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.live && timer.at <= clock.now) {
          timer.live = false;
          timer.fn();
        }
      }
    },
    liveTimers: () => timers.filter((t) => t.live).length,
    rows: (n: string) => sent.filter((row) => row.n === n).map((row) => row.f),
  };
}

describe("what a GPU error is", () => {
  it("names its kind by the class the browser made it of", () => {
    expect(gpuErrorKind(new GPUValidationError("x"))).toBe("validation");
    expect(gpuErrorKind(new GPUOutOfMemoryError("x"))).toBe("out-of-memory");
    expect(gpuErrorKind(new GPUInternalError("x"))).toBe("internal");
    expect(gpuErrorKind(new Error("x"))).toBe("other");
    expect(gpuErrorKind(null)).toBe("other");
    expect(gpuErrorKind("a string")).toBe("other");
  });

  it("cuts its text, and takes anything thrown at it", () => {
    expect(gpuErrorText(new GPUValidationError("a".repeat(GPU_MESSAGE_MAX + 500)))).toHaveLength(GPU_MESSAGE_MAX);
    expect(gpuErrorText(new GPUValidationError("short"))).toBe("short");
    expect(gpuErrorText("just text")).toBe("just text");
    expect(gpuErrorText(undefined)).toBe("undefined");
  });

  it("lists the objects it names, each once, in order, the device left out", () => {
    expect(gpuLabelsIn(BAD_DRAW)).toBe('RenderPassEncoder "scene"; CommandEncoder (unlabeled); RenderPipeline "terrain-ground"');
    expect(gpuLabelsIn('[Texture "scene-color"] and [Texture "scene-color"] and [Buffer "plugin-block-hikeFrame"]')).toBe('Texture "scene-color"; Buffer "plugin-block-hikeFrame"');
    expect(gpuLabelsIn("Out of memory")).toBe("");
    // The queue and the device are named with no label: there is one of each.
    expect(gpuLabelsIn('Destroyed texture [Texture "scene-color"] used in a submit.\n - While calling [Queue].Submit([[CommandBuffer from CommandEncoder "frame"]])\n')).toBe('Texture "scene-color"');
    // Chrome writes a descriptor's label inside two pairs of quotes, and a size as a bracketed record of its own.
    expect(
      gpuLabelsIn('The texture size ([Extent3D width:0, height:0, depthOrArrayLayers:1]) or mipLevelCount (1) is empty.\n - While validating [TextureDescriptor ""forced-texture""].\n - While calling [Device].CreateTexture([TextureDescriptor ""forced-texture""]).\n'),
    ).toBe('TextureDescriptor "forced-texture"');
    // An index in brackets is no object.
    expect(gpuLabelsIn("binding [3] of group [0]")).toBe("");
    const many = Array.from({ length: 60 }, (_, i) => `[Buffer "ring-${i}-vertices"]`).join(" ");
    expect(gpuLabelsIn(many).length).toBe(GPU_LABELS_MAX);
  });

  it("is the same error whatever numbers it carries, and another for another kind or text", () => {
    const a = gpuFaultKey("validation", "Vertex range (first: 0, count: 2616) requires a larger buffer (62784)");
    expect(gpuFaultKey("validation", "Vertex range (first: 12, count: 96) requires a larger buffer (2304)")).toBe(a);
    expect(gpuFaultKey("internal", "Vertex range (first: 0, count: 2616) requires a larger buffer (62784)")).not.toBe(a);
    expect(gpuFaultKey("validation", "Index range requires a larger buffer")).not.toBe(a);
  });
});

describe("an error scope's errors, heard", () => {
  it("hears each error a scope hands back, hands the device's own answer on, and comes off", async () => {
    const answers: unknown[] = [null, new GPUValidationError("refused"), null];
    const proto = { popErrorScope(this: unknown) { return Promise.resolve(answers.shift()); } };
    const device = Object.create(proto) as { popErrorScope(): Promise<unknown> };
    const heard: unknown[] = [];
    const off = hearErrorScopes(device, (error) => heard.push(error));
    expect(await device.popErrorScope()).toBeNull();
    const refused = await device.popErrorScope();
    expect(refused).toBeInstanceOf(GPUValidationError);
    await Promise.resolve();
    expect(heard).toEqual([refused]);
    off();
    expect(Object.hasOwn(device, "popErrorScope")).toBe(false);
    expect(await device.popErrorScope()).toBeNull();
    expect(heard).toHaveLength(1);
  });

  it("leaves a pop that rejects to whoever popped it", async () => {
    const device = Object.create({ popErrorScope: () => Promise.reject(new Error("no scope")) }) as { popErrorScope(): Promise<unknown> };
    const heard: unknown[] = [];
    hearErrorScopes(device, (error) => heard.push(error));
    await expect(device.popErrorScope()).rejects.toThrow("no scope");
    expect(heard).toEqual([]);
  });
});

describe("the picture, read small", () => {
  it("is a mean luminance, a share of black and a spread", () => {
    const flat = pictureStats(picture([100, 100, 100]));
    expect(flat).toEqual({ luma: expect.closeTo(100, 5), black: 0, spread: expect.closeTo(0, 5) });
    const black = pictureStats(picture([0, 0, 0]));
    expect(black).toEqual({ luma: 0, black: 1, spread: 0 });
    const ramp = pictureStats(picture([200, 200, 200], true)) as { luma: number; black: number; spread: number };
    expect(ramp.luma).toBeGreaterThan(90);
    expect(ramp.luma).toBeLessThan(110);
    expect(ramp.spread).toBeGreaterThan(50);
    expect(ramp.black).toBeGreaterThan(0);
    expect(ramp.black).toBeLessThan(0.05);
    // Green weighs most, blue least.
    expect((pictureStats(picture([0, 255, 0])) as { luma: number }).luma).toBeCloseTo(182.376, 3);
    expect((pictureStats(picture([0, 0, 255])) as { luma: number }).luma).toBeCloseTo(18.411, 3);
  });

  it("is no picture where there is no pixel, or every pixel is clear", () => {
    expect(pictureStats(new Uint8ClampedArray(0))).toBeNull();
    expect(pictureStats(picture([0, 0, 0], false, 0))).toBeNull();
  });

  it("is judged without guessing", () => {
    const whole = pictureStats(picture([120, 140, 90], true));
    const blackStats = pictureStats(picture([0, 0, 0]));
    const flat = pictureStats(picture([92, 110, 131]));
    const base = { frames: 300, hidden: false, darkened: false };
    expect(pictureVerdict({ ...base, stats: whole })).toBe("held");
    // Black, or one flat colour (a cleared frame with nothing drawn on it), is broken.
    expect(pictureVerdict({ ...base, stats: blackStats })).toBe("broke");
    expect(pictureVerdict({ ...base, stats: flat })).toBe("broke");
    // Unless the hike itself darkens the frame: then it cannot be said.
    expect(pictureVerdict({ ...base, darkened: true, stats: blackStats })).toBe("unknown");
    // A picture that could not be read says nothing.
    expect(pictureVerdict({ ...base, stats: null })).toBe("unknown");
    // No frame drawn in the window is broken, unless the page was hidden, where none is drawn.
    expect(pictureVerdict({ frames: 0, hidden: false, darkened: false, stats: null })).toBe("broke");
    expect(pictureVerdict({ frames: 0, hidden: true, darkened: false, stats: null })).toBe("unknown");
    // Nearly black is not black: a night with a lamp in it holds.
    const night = picture([0, 0, 0]);
    for (let i = 0; i < PIXELS * (1 - EMPTY_BLACK_SHARE) + 4; i++) night.set([60, 50, 30, 255], i * 4);
    expect(pictureVerdict({ ...base, stats: pictureStats(night) })).toBe("held");
  });

  it("reads a canvas through a 2D one of 32 by 18, and says why it could not", () => {
    const drawn: unknown[][] = [];
    const data = picture([10, 20, 30]);
    const small = { width: 0, height: 0, getContext: () => ({ drawImage: (...a: unknown[]) => void drawn.push(a), getImageData: () => ({ data }) }) };
    const canvas = { the: "hike's canvas" };
    expect(readPictureSmall(canvas, () => small)).toEqual({ rgba: data, why: "" });
    expect([small.width, small.height]).toEqual([PICTURE_WIDTH, PICTURE_HEIGHT]);
    expect(drawn).toEqual([[canvas, 0, 0, PICTURE_WIDTH, PICTURE_HEIGHT]]);
    expect(readPictureSmall(canvas, () => ({ width: 0, height: 0, getContext: () => null }))).toEqual({ rgba: null, why: "no 2d canvas" });
    const refused = readPictureSmall(canvas, () => ({ width: 0, height: 0, getContext: () => ({ drawImage: () => { throw new Error("SecurityError: tainted"); }, getImageData: () => ({ data }) }) }));
    expect(refused.rgba).toBeNull();
    expect(refused.why).toContain("SecurityError: tainted");
    expect(readPictureSmall(canvas, () => { throw new Error("no document"); }).why).toContain("no document");
  });
});

describe("a hike's record of GPU errors", () => {
  it("hears the renderer it is given, numbers the hike's renderers, and leaves one with no source alone", () => {
    const { faults } = record();
    const first = fakeSource();
    expect(faultSourceOf(first.renderer)).toBe(first.source);
    expect(faultSourceOf({ engineName: "webgl2" })).toBeNull();
    faults.attach({ engineName: "webgl2" });
    expect(faults.current()).toBeNull();
    faults.attach(first.renderer);
    expect(first.listener()).toBe(faults);
    expect(faults.current()).toEqual({ r: 1, facts: first.facts });
    const second = fakeSource({ tier: "low" });
    faults.attach(second.renderer);
    // The one before is told to no one.
    expect(first.listener()).toBeNull();
    expect(faults.current()?.r).toBe(2);
  });

  it("sends one row at once for an error: its kind, text and labels, the renderer's facts and the hike's", () => {
    const { faults, sent } = record();
    const r = fakeSource();
    faults.attach(r.renderer);
    faults.error(r.source, new GPUValidationError(BAD_DRAW), "uncaptured");
    expect(sent).toEqual([
      {
        n: "gpu_error",
        f: {
          ready: true, busy: "", film: false, hidden: false, shownMs: 41_000, p: 0.312, tick: 4_810,
          tier: "medium", state: "standing", frames: 600, stoodMs: 20_000, scene: false, ending: false, dark: 0, rain: 0.25, wet: 0.5, night: 0.13, hour: 14.3, lakes: 1, sea: false,
          r: 1, nth: 1, kind: "validation", src: "uncaptured", msg: BAD_DRAW, labels: 'RenderPassEncoder "scene"; CommandEncoder (unlabeled); RenderPipeline "terrain-ground"',
          w: 1,
        },
      },
    ]);
    expect(faults.errors).toBe(1);
    expect(faults.distinct).toBe(1);
  });

  it("says a renderer still being made has stood for no time, and an error a scope handed back is a scope's", () => {
    const { faults, rows } = record();
    const r = fakeSource({ state: "making", stoodMs: null, frames: 0 });
    faults.attach(r.renderer);
    faults.error(r.source, new GPUOutOfMemoryError("Out of memory"), "scope");
    const row = rows("gpu_error")[0] as Fields;
    expect(row).toMatchObject({ state: "making", frames: 0, kind: "out-of-memory", src: "scope", labels: "" });
    expect("stoodMs" in row).toBe(false);
  });

  it("sends a storm of fifty of one error as one row, and its window says fifty", () => {
    const { faults, rows, pass } = record();
    const r = fakeSource();
    faults.attach(r.renderer);
    for (let i = 0; i < 50; i++) {
      faults.error(r.source, new GPUValidationError(`Vertex range (first: 0, count: ${2616 + i}) requires a larger buffer [RenderPipeline "terrain-ground"]`), "uncaptured");
      r.frame();
    }
    expect(rows("gpu_error")).toHaveLength(1);
    pass(GPU_WINDOW_MS);
    // The picture is read in the task of the next frame drawn.
    expect(rows("gpu_window")).toHaveLength(0);
    expect(r.waits()).toBe(true);
    r.frame();
    expect(rows("gpu_window")).toEqual([
      {
        ready: true, busy: "", film: false, hidden: false, shownMs: 41_000, p: 0.312, tick: 4_810,
        w: 1, r: 1, nth: 1, tier: "medium", state: "standing", ms: GPU_WINDOW_MS, errors: 50, distinct: 1, total: 50, totalDistinct: 1, frames: 51,
        picture: "held", read: true, scene: false, ending: false, dark: 0, luma: expect.any(Number), black: expect.any(Number), spread: expect.any(Number),
      },
    ]);
    expect(faults.errors).toBe(50);
  });

  it("sends five distinct errors as five rows and one window", () => {
    const { faults, rows, pass } = record();
    const r = fakeSource();
    faults.attach(r.renderer);
    const texts = ["bad draw", "bad bind group", "bad texture view", "bad buffer", "bad pipeline"];
    for (let round = 0; round < 3; round++) for (const text of texts) faults.error(r.source, new GPUValidationError(text), "uncaptured");
    expect(rows("gpu_error").map((row) => [row.nth, row.msg, row.w])).toEqual(texts.map((text, i) => [i + 1, text, 1]));
    r.frame();
    pass(GPU_WINDOW_MS);
    r.frame();
    expect(rows("gpu_window")).toHaveLength(1);
    expect(rows("gpu_window")[0]).toMatchObject({ w: 1, nth: 1, errors: 15, distinct: 5, total: 15, totalDistinct: 5, frames: 2, picture: "held" });
  });

  it("bounds a hike's rows: six distinct errors at once, three windows, and the rest counted", () => {
    const { faults, rows, pass, liveTimers } = record();
    const r = fakeSource();
    faults.attach(r.renderer);
    for (let i = 0; i < 40; i++) {
      faults.error(r.source, new GPUValidationError(`kind ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? "x" : ""} of error`), "uncaptured");
      r.frame();
      // A window closed, and the next distinct error opens the next.
      if (i % 4 === 3) {
        pass(GPU_WINDOW_MS);
        r.frame();
      }
    }
    expect(rows("gpu_error")).toHaveLength(GPU_ERROR_ROWS);
    expect(rows("gpu_error").map((row) => row.nth)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows("gpu_window")).toHaveLength(GPU_WINDOWS);
    // Each error's row names the window it fell in: the first four the first, the next two the second.
    expect(rows("gpu_error").map((row) => row.w)).toEqual([1, 1, 1, 1, 2, 2]);
    // The third window was opened by an error whose own row was past the bound.
    expect(rows("gpu_window").map((row) => [row.w, row.nth])).toEqual([[1, 1], [2, 5], [3, 9]]);
    expect(faults.errors).toBe(40);
    expect(faults.distinct).toBe(40);
    expect(liveTimers()).toBe(0);
    // Past the distinct errors it keeps apart, every new one is one more of the rest.
    for (let i = 0; i < 200; i++) faults.error(r.source, new GPUValidationError(`another ${"z".repeat(i)}`), "uncaptured");
    expect(faults.errors).toBe(240);
    expect(faults.distinct).toBe(GPU_DISTINCT_MAX + 1);
    expect(rows("gpu_error")).toHaveLength(GPU_ERROR_ROWS);
  });

  it("names no window on an error that came when the hike's windows were spent", () => {
    const { faults, rows, pass } = record();
    const r = fakeSource();
    faults.attach(r.renderer);
    for (const text of ["first", "second", "third"]) {
      faults.error(r.source, new GPUValidationError(text), "uncaptured");
      r.frame();
      pass(GPU_WINDOW_MS);
      r.frame();
    }
    faults.error(r.source, new GPUValidationError("fourth"), "uncaptured");
    expect(rows("gpu_window")).toHaveLength(GPU_WINDOWS);
    const last = rows("gpu_error")[3] as Fields;
    expect(last.nth).toBe(4);
    expect("w" in last).toBe(false);
  });

  it("says the picture broke where the frame read black, and where no frame was drawn at all", () => {
    const black = record();
    const a = fakeSource();
    black.faults.attach(a.renderer);
    black.faults.error(a.source, new GPUValidationError("the grade's pipeline is invalid"), "uncaptured");
    a.frame();
    black.pass(GPU_WINDOW_MS);
    a.frame({ rgba: picture([0, 0, 0]), why: "" });
    expect(black.rows("gpu_window")[0]).toMatchObject({ picture: "broke", read: true, luma: 0, black: 1, spread: 0, frames: 2 });

    const still = record();
    const b = fakeSource();
    still.faults.attach(b.renderer);
    still.faults.error(b.source, new GPUInternalError("device hung"), "uncaptured");
    still.pass(GPU_WINDOW_MS);
    const row = still.rows("gpu_window")[0] as Fields;
    expect(row).toMatchObject({ picture: "broke", read: false, frames: 0, unread: "no frame was drawn" });
    expect("luma" in row).toBe(false);
  });

  it("says it does not know where the page was hidden, a death's dark had the frame, or the canvas would not be read", () => {
    const hidden = record();
    const a = fakeSource();
    hidden.faults.attach(a.renderer);
    hidden.faults.error(a.source, new GPUValidationError("x"), "uncaptured");
    hidden.hike.hidden = true;
    hidden.pass(GPU_WINDOW_MS);
    expect(hidden.rows("gpu_window")[0]).toMatchObject({ picture: "unknown", frames: 0, hidden: true });

    const dark = record();
    const b = fakeSource();
    dark.faults.attach(b.renderer);
    dark.faults.error(b.source, new GPUValidationError("x"), "uncaptured");
    b.frame();
    b.facts.ending = true;
    b.facts.dark = 0.999;
    dark.pass(GPU_WINDOW_MS);
    b.frame({ rgba: picture([0, 0, 0]), why: "" });
    expect(dark.rows("gpu_window")[0]).toMatchObject({ picture: "unknown", read: true, black: 1, ending: true, dark: 1 });

    const unread = record();
    const c = fakeSource();
    unread.faults.attach(c.renderer);
    unread.faults.error(c.source, new GPUValidationError("x"), "uncaptured");
    c.frame();
    unread.pass(GPU_WINDOW_MS);
    c.frame({ rgba: null, why: "no 2d canvas" });
    expect(unread.rows("gpu_window")[0]).toMatchObject({ picture: "unknown", read: false, unread: "no 2d canvas", frames: 2 });

    // A canvas that reads as fully clear has no frame to hand over: said, not judged.
    const clear = record();
    const d = fakeSource();
    clear.faults.attach(d.renderer);
    clear.faults.error(d.source, new GPUValidationError("x"), "uncaptured");
    d.frame();
    clear.pass(GPU_WINDOW_MS);
    d.frame({ rgba: picture([0, 0, 0], false, 0), why: "" });
    expect(clear.rows("gpu_window")[0]).toMatchObject({ picture: "unknown", read: false, unread: "the canvas read as nothing" });
  });

  it("closes a window whose renderer is gone or lost, or draws no frame after it, without waiting on it", () => {
    const gone = record();
    const a = fakeSource();
    gone.faults.attach(a.renderer);
    gone.faults.error(a.source, new GPUValidationError("x"), "uncaptured");
    a.frame();
    a.facts.state = "gone";
    gone.pass(GPU_WINDOW_MS);
    expect(gone.rows("gpu_window")[0]).toMatchObject({ picture: "unknown", read: false, unread: "the renderer is gone", state: "gone" });

    const stalled = record();
    const b = fakeSource();
    stalled.faults.attach(b.renderer);
    stalled.faults.error(b.source, new GPUValidationError("x"), "uncaptured");
    b.frame();
    stalled.pass(GPU_WINDOW_MS);
    expect(stalled.rows("gpu_window")).toHaveLength(0);
    stalled.pass(PICTURE_WAIT_MS);
    expect(stalled.rows("gpu_window")[0]).toMatchObject({ picture: "unknown", read: false, unread: "no frame was drawn after the window", frames: 1 });
    expect(b.waits()).toBe(false);
    // A frame that comes after all changes nothing.
    b.frame();
    expect(stalled.rows("gpu_window")).toHaveLength(1);
  });

  it("with telemetry off counts the errors, and sends, times and reads nothing", () => {
    const { faults, sent, liveTimers } = record({ enabled: false });
    const r = fakeSource();
    faults.attach(r.renderer);
    expect(faults.counting).toBe(false);
    for (let i = 0; i < 20; i++) faults.error(r.source, new GPUValidationError(`error ${String.fromCharCode(65 + i)}`), "uncaptured");
    expect(faults.errors).toBe(20);
    expect(faults.distinct).toBe(20);
    expect(sent).toEqual([]);
    expect(liveTimers()).toBe(0);
    expect(r.waits()).toBe(false);
  });

  it("hears nothing more once the hike is gone, and clears the window it had open", () => {
    const { faults, sent, pass, liveTimers } = record();
    const r = fakeSource();
    faults.attach(r.renderer);
    faults.error(r.source, new GPUValidationError("x"), "uncaptured");
    expect(liveTimers()).toBe(1);
    faults.dispose();
    expect(liveTimers()).toBe(0);
    expect(r.listener()).toBeNull();
    faults.error(r.source, new GPUValidationError("y"), "uncaptured");
    faults.lost(r.source, { reason: "unknown", message: "gone" });
    pass(GPU_WINDOW_MS * 2);
    expect(sent).toHaveLength(1);
    expect(faults.lastLoss).toBeNull();
  });
});

describe("a hike's record of lost devices", () => {
  it("sends each loss with what the device said, the page's count, what was happening and what the device held", () => {
    const { faults, rows, clock } = record();
    const r = fakeSource();
    faults.attach(r.renderer);
    faults.error(r.source, new GPUOutOfMemoryError("Out of memory"), "uncaptured");
    faults.lost(r.source, { reason: "unknown", message: "The GPU process crashed." });
    expect(rows("device_lost")).toEqual([
      {
        ready: true, busy: "", film: false, hidden: false, shownMs: 41_000, p: 0.312, tick: 4_810,
        tier: "medium", state: "standing", frames: 600, stoodMs: 20_000, scene: false, ending: false, dark: 0, rain: 0.25, wet: 0.5, night: 0.13, hour: 14.3, lakes: 1, sea: false,
        r: 1, reason: "unknown", msg: "The GPU process crashed.", losses: 1, recent: 1, verdict: "rebuild", errors: 1,
        bufs: 1807, bufMB: 96, texs: 275, texMB: 540.3, heapMB: 311,
      },
    ]);
    expect(faults.lastLoss).toEqual({ losses: 1, recent: 1, sinceMs: null, end: false });
    // The second, on the renderer built after it, says how long since the first.
    const next = fakeSource({ state: "making", stoodMs: null, frames: 0 });
    faults.attach(next.renderer);
    clock.now += 4_250;
    faults.lost(next.source, { reason: "destroyed", message: "" });
    expect(rows("device_lost")[1]).toMatchObject({ r: 2, state: "making", reason: "destroyed", msg: "", losses: 2, recent: 2, sinceMs: 4_250, verdict: "rebuild", errors: 0 });
    // The third inside the window is the one the bound ends the hike at.
    clock.now += 60_000;
    faults.lost(next.source, { reason: "unknown", message: "x" });
    expect(rows("device_lost")[2]).toMatchObject({ losses: 3, recent: 3, sinceMs: 60_000, verdict: "end" });
    expect(faults.lastLoss?.end).toBe(true);
  });

  it("keeps a loss's row within what a row may carry beside its match: forty fields less the context's four", () => {
    const { faults, rows, clock } = record();
    const r = fakeSource();
    faults.attach(r.renderer);
    faults.lost(r.source, { reason: "unknown", message: "x" });
    clock.now += 10;
    faults.lost(r.source, { reason: "unknown", message: "m".repeat(LOST_MESSAGE_MAX + 100) });
    const row = rows("device_lost")[1] as Fields;
    expect(Object.keys(row).length).toBeLessThanOrEqual(36);
    expect((row.msg as string).length).toBe(LOST_MESSAGE_MAX);
    for (const value of Object.values(row)) expect(["string", "number", "boolean"]).toContain(typeof value);
  });

  it("leaves out what it cannot say: a device not counted, a browser with no heap to read, a loss with no reason", () => {
    const { faults, rows } = record({ heapMb: () => null });
    const r = fakeSource();
    r.setHeld(null);
    faults.attach(r.renderer);
    faults.lost(r.source, {});
    const row = rows("device_lost")[0] as Fields;
    expect(row).toMatchObject({ reason: "", msg: "" });
    for (const key of ["bufs", "bufMB", "texs", "texMB", "heapMB", "sinceMs"]) expect(key in row, key).toBe(false);
  });

  it("with telemetry off still notes the loss for the bound, and sends nothing", () => {
    const { faults, sent, clock } = record({ enabled: false });
    const r = fakeSource();
    faults.attach(r.renderer);
    for (let i = 0; i < 3; i++) {
      clock.now += 1_000;
      faults.lost(r.source, { reason: "unknown", message: "x" });
    }
    expect(sent).toEqual([]);
    expect(faults.lastLoss).toEqual({ losses: 3, recent: 3, sinceMs: 1_000, end: true });
  });
});
