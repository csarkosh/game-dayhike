/**
 * What the GPU says went wrong under a hike, told so it can be read back
 * from telemetry alone: was an error one harmless bad draw or a broken
 * picture, and why was a device lost.
 *
 * A renderer that makes its own engine is the only one that hears its
 * device (`lite/renderer.ts`). It offers a `FaultSource`: it tells whoever
 * the hike puts there of each GPU error (one nobody caught, or one an
 * error scope handed back) and of a loss it did not ask for, and it answers
 * what it knows of itself when asked. The hike keeps one `GpuFaults` for
 * its whole life, across every renderer it builds, and that is where the
 * bounds are: a storm of errors is a handful of rows.
 *
 * Three rows:
 *
 * - `gpu_error`, at once, for each distinct error up to `GPU_ERROR_ROWS` a
 *   hike: its kind, its text, the labels it names, and what was happening.
 * - `gpu_window`, once, `GPU_WINDOW_MS` after an error that opened one (a
 *   distinct error with no window open, up to `GPU_WINDOWS` a hike): how
 *   many errors followed and how many distinct, the frames drawn meanwhile,
 *   and the picture read small after a frame, with a verdict that never
 *   guesses (`pictureVerdict`). An error's row names the window it fell in
 *   (`w`), so each error is read by the picture that followed it.
 * - `device_lost`, for each loss: what the device said, how many the page
 *   has had and how close together (`lossBound.ts`), what was happening and
 *   what the device held (`deviceHeld.ts`).
 *
 * Nothing here runs on a frame with no error: no timer is set and nothing
 * is read until a renderer tells of one. With telemetry off the errors are
 * still counted and a loss still noted (the bound on rebuilds is the
 * hike's whatever is sent), and no row is made, no window opened and no
 * picture read.
 *
 * No engine: the renderer, the clock, the timer and the sender are handed
 * in, so every sequence runs under Node.
 */
import type { Fields } from "../net/telemetry.js";
import type { HeldCounts } from "./deviceHeld.js";
import type { LossNote } from "./lossBound.js";

/** Distinct GPU errors a hike tells of at once; the rest are counted in its windows. */
export const GPU_ERROR_ROWS = 6;
/** Windows a hike judges: each a row, and a read of the picture. */
export const GPU_WINDOWS = 3;
/** How long after the error that opened it a window is judged (ms). */
export const GPU_WINDOW_MS = 5_000;
/** How long a window's judgement waits for a frame to read the picture after (ms). */
export const PICTURE_WAIT_MS = 1_000;
/** An error's text is cut here: a validation error names its pipeline and its shader module only at its end. */
export const GPU_MESSAGE_MAX = 1_000;
/** The labels an error names, joined, are cut here. */
export const GPU_LABELS_MAX = 300;
/** A lost device's message is cut here. */
export const LOST_MESSAGE_MAX = 500;
/** Distinct errors a hike keeps apart; past it every new one is counted as one more of the rest. */
export const GPU_DISTINCT_MAX = 64;

/** The picture is read at this size: 576 pixels say whether it is black or flat. */
export const PICTURE_WIDTH = 32;
export const PICTURE_HEIGHT = 18;
/** A pixel is black where no channel of it is over this (of 255). */
export const BLACK_LEVEL = 2;
/** A picture this black, or this flat (the spread of its luminance, of 255), is an empty one. */
export const EMPTY_BLACK_SHARE = 0.98;
export const EMPTY_SPREAD = 0.5;

export type GpuErrorKind = "validation" | "out-of-memory" | "internal" | "other";

/** The kind of a GPU error, by the class the browser made it of. */
export function gpuErrorKind(error: unknown): GpuErrorKind {
  const name = (error as { constructor?: { name?: unknown } } | null | undefined)?.constructor?.name;
  if (name === "GPUValidationError") return "validation";
  if (name === "GPUOutOfMemoryError") return "out-of-memory";
  if (name === "GPUInternalError") return "internal";
  return "other";
}

/** A GPU error's text, cut to `GPU_MESSAGE_MAX`. */
export function gpuErrorText(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  const text = typeof message === "string" ? message : String(error);
  return text.length > GPU_MESSAGE_MAX ? text.slice(0, GPU_MESSAGE_MAX) : text;
}

/**
 * The objects a GPU error names, as the browser writes them in brackets
 * (`[RenderPipeline "scene"]`, `[Buffer (unlabeled)]`; Chrome writes a
 * descriptor's label inside two pairs of quotes): each once, in the order
 * named, joined and cut to `GPU_LABELS_MAX`. What is named with no label
 * and no word that it has none (`[Device]`, `[Queue]`) is the one there is
 * of it, and is left out.
 * The game labels its own passes, pipelines, textures and buffers, so this
 * is which of them the error was about.
 */
export function gpuLabelsIn(message: string): string {
  const seen: string[] = [];
  for (const match of message.matchAll(/\[([A-Z][A-Za-z0-9]+)(?: "+([^"\]]*)"+| (\(unlabeled\)))\]/g)) {
    const type = match[1] as string;
    const named = match[3] !== undefined ? `${type} (unlabeled)` : `${type} "${match[2] as string}"`;
    if (!seen.includes(named)) seen.push(named);
  }
  const joined = seen.join("; ");
  return joined.length > GPU_LABELS_MAX ? joined.slice(0, GPU_LABELS_MAX) : joined;
}

/**
 * What makes two errors the same one: the kind and the head of the text
 * with every number struck out, so one broken draw reported every frame
 * with a different offset or size is one error.
 */
export function gpuFaultKey(kind: GpuErrorKind, text: string): string {
  return `${kind}|${text.slice(0, 300).replace(/\d+/g, "#")}`;
}

/** A picture's numbers: its mean luminance (of 255), the share of its pixels that are black, and the spread of its luminance (of 255). */
export type PictureStats = { luma: number; black: number; spread: number };

/**
 * The numbers of a picture given as RGBA bytes, or null where there is no
 * picture in them: no pixel, or every pixel fully clear, which is what a
 * canvas with no frame to hand over reads as.
 */
export function pictureStats(rgba: ArrayLike<number>): PictureStats | null {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return null;
  let sum = 0;
  let squares = 0;
  let black = 0;
  let alpha = 0;
  for (let i = 0; i < pixels; i++) {
    const r = rgba[i * 4] as number;
    const g = rgba[i * 4 + 1] as number;
    const b = rgba[i * 4 + 2] as number;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += luma;
    squares += luma * luma;
    if (r <= BLACK_LEVEL && g <= BLACK_LEVEL && b <= BLACK_LEVEL) black++;
    alpha += rgba[i * 4 + 3] as number;
  }
  if (alpha === 0) return null;
  const mean = sum / pixels;
  return { luma: mean, black: black / pixels, spread: Math.sqrt(Math.max(0, squares / pixels - mean * mean)) };
}

export type PictureVerdict = "held" | "broke" | "unknown";

/**
 * Whether the picture held through a window of errors. `broke`: no frame
 * was drawn while the page was shown, or the picture read is empty (black,
 * or one flat colour) with nothing in the hike that darkens it. `held`: a
 * frame was drawn and the picture read has something in it. `unknown`
 * wherever neither can be said: the picture could not be read, the page
 * was hidden (a hidden page draws no frame), or an empty picture came while
 * a scene, an ending or a death's dark had the frame.
 */
export function pictureVerdict(window: { frames: number; hidden: boolean; stats: PictureStats | null; darkened: boolean }): PictureVerdict {
  if (window.frames === 0) return window.hidden ? "unknown" : "broke";
  if (window.stats === null) return "unknown";
  const empty = window.stats.black >= EMPTY_BLACK_SHARE || window.stats.spread < EMPTY_SPREAD;
  if (!empty) return "held";
  return window.darkened ? "unknown" : "broke";
}

/** A canvas's picture read small: its bytes, or why there are none. */
export type PictureRead = { rgba: ArrayLike<number> | null; why: string };

/** A 2D canvas, as much of one as the read needs. */
type SmallCanvas = {
  width: number;
  height: number;
  getContext(kind: "2d", options?: { willReadFrequently?: boolean }): {
    drawImage(image: never, x: number, y: number, width: number, height: number): void;
    getImageData(x: number, y: number, width: number, height: number): { data: ArrayLike<number> };
  } | null;
};

/**
 * `canvas` drawn into a 2D canvas of `PICTURE_WIDTH` by `PICTURE_HEIGHT`
 * and read back. Called in the task that drew a frame, where the canvas
 * still holds it in every browser; a browser that will not draw a WebGPU
 * canvas into a 2D one, or reads it as nothing, is said, not guessed
 * (`pictureStats` reads a fully clear picture as none).
 */
export function readPictureSmall(canvas: unknown, make: () => unknown): PictureRead {
  try {
    const small = make() as SmallCanvas;
    small.width = PICTURE_WIDTH;
    small.height = PICTURE_HEIGHT;
    const context = small.getContext("2d", { willReadFrequently: true });
    if (context === null) return { rgba: null, why: "no 2d canvas" };
    context.drawImage(canvas as never, 0, 0, PICTURE_WIDTH, PICTURE_HEIGHT);
    return { rgba: context.getImageData(0, 0, PICTURE_WIDTH, PICTURE_HEIGHT).data, why: "" };
  } catch (error) {
    return { rgba: null, why: `the canvas could not be read: ${String(error).slice(0, 120)}` };
  }
}

/**
 * Hears every error an error scope of `device` hands back: a function of
 * the same name stood on the device in front of `popErrorScope`, as
 * `deviceMakes.ts` stands its own, which hands the device's own answer on
 * untouched. Nothing runs where no scope is popped. The function returned
 * takes it off.
 */
export function hearErrorScopes(device: unknown, hear: (error: unknown) => void): () => void {
  const own = device as Record<string, unknown>;
  const pop = own.popErrorScope as (this: unknown) => Promise<unknown>;
  own.popErrorScope = (): Promise<unknown> => {
    const popped = pop.call(device);
    popped.then(
      (error) => {
        if (error !== null && error !== undefined) hear(error);
      },
      () => undefined,
    );
    return popped;
  };
  return () => void delete own.popErrorScope;
}

/** What a renderer knows of itself when a row is made; read then, kept by no frame. */
export type RendererFacts = {
  tier: string;
  /** `making` until it stands, `standing` while it draws, `lost` once its device is, `failed` where it could not be made, `gone` once let go. */
  state: "making" | "standing" | "lost" | "failed" | "gone";
  /** Frames it has drawn. */
  frames: number;
  /** How long it has stood (ms); null before it does. */
  stoodMs: number | null;
  /** A scene's shot has the lens; the end's scene or a death's ending plays; how far a death's dark has closed, 0 to 1. */
  scene: boolean;
  ending: boolean;
  dark: number;
  /** The weather and the hour as the frame is lit: rain and wetness 0 to 1, the night 0 to 1, the hour of the day. */
  rain: number;
  wet: number;
  night: number;
  hour: number;
  /** Lakes shown by the last frame, and whether the sea was. */
  lakes: number;
  sea: boolean;
};

/** A renderer's side of the telling: what it offers the hike. */
export type FaultSource = {
  /** Tells `listener` of this renderer's GPU errors and of a loss it did not ask for, from now on; null stops it. One listener: the hike's. */
  tell(listener: FaultListener | null): void;
  facts(): RendererFacts;
  /** What its device holds; null where it is not counted. */
  held(): HeldCounts | null;
  /** Reads the picture in the task of the next frame it draws, and calls `done` once; the function returned gives the wait up. */
  judge(done: (read: PictureRead) => void): () => void;
};

/** Who a renderer tells. */
export type FaultListener = {
  /** Whether what the device holds is worth counting: rows are sent. */
  readonly counting: boolean;
  error(source: FaultSource, error: unknown, from: "uncaptured" | "scope"): void;
  lost(source: FaultSource, info: { reason?: unknown; message?: unknown }): void;
};

/** `renderer`'s fault source, where it is one that hears its own device; null for any other. */
export function faultSourceOf(renderer: object): FaultSource | null {
  return "gpuFaults" in renderer ? (renderer as { gpuFaults: FaultSource }).gpuFaults : null;
}

export type GpuFaultDeps = {
  /** Whether rows are sent: false with telemetry off, when nothing is read or timed either. */
  enabled: boolean;
  send(name: "gpu_error" | "gpu_window" | "device_lost", fields: Fields): void;
  /** What was happening in the session, read when a row is made. `hidden` (the page is not shown) is read for the verdict. */
  session(): Fields & { hidden: boolean };
  /** Notes a loss on the page's record and says what the bound makes of it (`lossBound.ts`). */
  loss(): LossNote;
  /** The page's JS heap (MB) where the browser says; null elsewhere. */
  heapMb?(): number | null;
  now(): number;
  /** A timer; the function returned clears it. Set only once an error has come. */
  setTimer(fn: () => void, ms: number): () => void;
};

export type GpuFaults = FaultListener & {
  /** Listens to `renderer` where it offers a source, as the renderer this hike now draws with; a renderer that offers none is left alone. */
  attach(renderer: object): void;
  /** The renderer last attached: which one of the hike's (1 the first), and what it says of itself; null where it offers no source. */
  current(): { r: number; facts: RendererFacts } | null;
  /** What the bound made of the hike's last lost device; null before any. */
  readonly lastLoss: LossNote | null;
  /** GPU errors heard, and distinct ones. */
  readonly errors: number;
  readonly distinct: number;
  /** Stops every timer and wait, and listens to nothing more. */
  dispose(): void;
};

const round = (value: number, places: number): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** A renderer's facts as a row's fields. */
function factFields(facts: RendererFacts): Fields {
  const fields: Fields = {
    tier: facts.tier,
    state: facts.state,
    frames: facts.frames,
    scene: facts.scene,
    ending: facts.ending,
    dark: round(facts.dark, 2),
    rain: round(facts.rain, 2),
    wet: round(facts.wet, 2),
    night: round(facts.night, 2),
    hour: round(facts.hour, 1),
    lakes: facts.lakes,
    sea: facts.sea,
  };
  if (facts.stoodMs !== null) fields.stoodMs = Math.round(facts.stoodMs);
  return fields;
}

type Window = {
  /** Which of the hike's windows it is, 1 the first: the errors that fell in it name it. */
  w: number;
  source: FaultSource;
  r: number;
  /** Which of the hike's distinct errors opened it. */
  nth: number;
  openedAt: number;
  framesAt: number;
  errors: number;
  keys: Set<string>;
  clear(): void;
};

export function createGpuFaults(deps: GpuFaultDeps): GpuFaults {
  /** The hike's renderers by the order they were attached, 1 the first. */
  const serials = new WeakMap<FaultSource, number>();
  let attached = 0;
  let current: FaultSource | null = null;
  /** Each distinct error: which it was, and how many times it came. */
  const known = new Map<string, { nth: number; times: number }>();
  let errors = 0;
  /** Errors past `GPU_DISTINCT_MAX` distinct ones: counted, not kept apart. */
  let uncounted = 0;
  let windows = 0;
  let open: Window | null = null;
  /** GPU errors each renderer has told of. */
  const errorsOf = new WeakMap<FaultSource, number>();
  let lastLoss: LossNote | null = null;
  let disposed = false;

  const serialOf = (source: FaultSource): number => serials.get(source) ?? 0;

  /** The window's row, once its picture is read or cannot be. */
  function close(window: Window, read: PictureRead | null, why: string): void {
    if (open === window) open = null;
    if (disposed) return;
    const facts = window.source.facts();
    const session = deps.session();
    const frames = Math.max(0, facts.frames - window.framesAt);
    const stats = read === null || read.rgba === null ? null : pictureStats(read.rgba);
    const darkened = facts.scene || facts.ending || facts.dark > 0;
    const fields: Fields = {
      ...session,
      w: window.w,
      r: window.r,
      nth: window.nth,
      tier: facts.tier,
      state: facts.state,
      ms: Math.round(deps.now() - window.openedAt),
      errors: window.errors,
      distinct: window.keys.size,
      total: errors,
      totalDistinct: known.size + (uncounted > 0 ? 1 : 0),
      frames,
      picture: pictureVerdict({ frames, hidden: session.hidden, stats, darkened }),
      read: stats !== null,
      scene: facts.scene,
      ending: facts.ending,
      dark: round(facts.dark, 2),
    };
    if (stats !== null) {
      fields.luma = round(stats.luma, 1);
      fields.black = round(stats.black, 3);
      fields.spread = round(stats.spread, 1);
    } else {
      fields.unread = why !== "" ? why : read !== null && read.why !== "" ? read.why : "the canvas read as nothing";
    }
    deps.send("gpu_window", fields);
  }

  /** The window's time is up: the picture is read after the next frame, where frames are drawn at all. */
  function judge(window: Window): void {
    if (disposed) return;
    const facts = window.source.facts();
    if (facts.state !== "standing") {
      close(window, null, `the renderer is ${facts.state}`);
      return;
    }
    if (facts.frames === window.framesAt) {
      close(window, null, "no frame was drawn");
      return;
    }
    let done = false;
    const giveUp = window.source.judge((read) => {
      if (done) return;
      done = true;
      window.clear();
      close(window, read, "");
    });
    window.clear = deps.setTimer(() => {
      if (done) return;
      done = true;
      giveUp();
      close(window, null, "no frame was drawn after the window");
    }, PICTURE_WAIT_MS);
  }

  const faults: GpuFaults = {
    counting: deps.enabled,
    get lastLoss() {
      return lastLoss;
    },
    get errors() {
      return errors;
    },
    get distinct() {
      return known.size + (uncounted > 0 ? 1 : 0);
    },
    attach(renderer) {
      if (disposed) return;
      const source = faultSourceOf(renderer);
      if (current !== null && current !== source) current.tell(null);
      current = source;
      if (source === null) return;
      serials.set(source, ++attached);
      source.tell(faults);
    },
    current() {
      return current === null ? null : { r: serialOf(current), facts: current.facts() };
    },
    error(source, error, from) {
      if (disposed) return;
      errors++;
      errorsOf.set(source, (errorsOf.get(source) ?? 0) + 1);
      const kind = gpuErrorKind(error);
      const text = gpuErrorText(error);
      const key = gpuFaultKey(kind, text);
      if (open !== null) {
        open.errors++;
        open.keys.add(key);
      }
      const seen = known.get(key);
      if (seen !== undefined) {
        seen.times++;
        return;
      }
      if (known.size >= GPU_DISTINCT_MAX) {
        uncounted++;
        return;
      }
      const nth = known.size + 1;
      known.set(key, { nth, times: 1 });
      if (!deps.enabled) return;
      const facts = source.facts();
      if (open === null && windows < GPU_WINDOWS) {
        const window: Window = { w: ++windows, source, r: serialOf(source), nth, openedAt: deps.now(), framesAt: facts.frames, errors: 1, keys: new Set([key]), clear: () => undefined };
        open = window;
        window.clear = deps.setTimer(() => judge(window), GPU_WINDOW_MS);
      }
      if (nth <= GPU_ERROR_ROWS) {
        const fields: Fields = { ...deps.session(), ...factFields(facts), r: serialOf(source), nth, kind, src: from, msg: text, labels: gpuLabelsIn(text) };
        // The window it fell in, where one is open: the picture that followed it is that window's.
        if (open !== null) fields.w = open.w;
        deps.send("gpu_error", fields);
      }
    },
    lost(source, info) {
      if (disposed) return;
      const note = deps.loss();
      lastLoss = note;
      if (!deps.enabled) return;
      const facts = source.facts();
      const message = typeof info.message === "string" ? info.message : "";
      const fields: Fields = {
        ...deps.session(),
        ...factFields(facts),
        r: serialOf(source),
        reason: typeof info.reason === "string" ? info.reason : "",
        msg: message.length > LOST_MESSAGE_MAX ? message.slice(0, LOST_MESSAGE_MAX) : message,
        losses: note.losses,
        recent: note.recent,
        verdict: note.end ? "end" : "rebuild",
        errors: errorsOf.get(source) ?? 0,
      };
      if (note.sinceMs !== null) fields.sinceMs = Math.round(note.sinceMs);
      const held = source.held();
      if (held !== null) {
        fields.bufs = held.buffers;
        fields.bufMB = round(held.bufferBytes / 1_048_576, 1);
        fields.texs = held.textures;
        fields.texMB = round(held.textureBytes / 1_048_576, 1);
      }
      const heap = deps.heapMb?.() ?? null;
      if (heap !== null) fields.heapMB = round(heap, 1);
      deps.send("device_lost", fields);
    },
    dispose() {
      disposed = true;
      open?.clear();
      open = null;
      current?.tell(null);
      current = null;
    },
  };
  return faults;
}
