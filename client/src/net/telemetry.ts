/**
 * What the page tells of itself, and how little it costs to tell.
 *
 * A page makes a handful of events as it goes — it landed, Play was pressed,
 * a lobby formed, the world was built, the night fell, the party won or died,
 * something threw — and every half minute, or on its way out, sends what it
 * has in one batch to the telemetry service (`server/src/telemetry.ts`), which
 * writes the events out as rows. Each batch carries an envelope naming the
 * page: its session, the build it runs, the protocol and generator versions,
 * the page's own facts (where it came from, its viewport, its zone). The
 * server flattens the envelope onto every row, so a row never needs a join to
 * say which version of the game produced it. What changes within a page, the
 * match and the lobby (`context`), is copied onto each event as it is queued,
 * so a row names a match only while one was running. Each batch also says
 * the page's clock as it was serialised (`st`), from which the server works
 * out when each event happened with no trust in the page's wall clock.
 *
 * Nothing here runs a frame. An event is one small object pushed on an array
 * at a transition the game already branches on; the serialisation and the
 * send happen in a timer, once per flush, and the browser carries the request
 * off the main thread. The queue is bounded, errors are capped and
 * deduplicated, and a flush that fails puts its events back for the next one.
 * `sim/` knows nothing of this and the game only reads from it.
 *
 * Pure over its dependencies — the clock, the timers, the sender — so the
 * whole behaviour is tested under Node without a page.
 */

/** How often a page flushes, and the heartbeat's period while a match runs. */
export const FLUSH_MS = 30_000;
/** A queue this long flushes at once rather than waiting for the timer. */
export const FLUSH_AT_EVENTS = 50;
/** Events one batch carries at most; the server refuses more (`MAX_EVENTS_PER_BATCH`). */
export const MAX_BATCH_EVENTS = 200;
/** The most JSON one batch's events come to: the server refuses a body over
 * 64 KiB (`MAX_BATCH_BYTES`), and a refused batch is put back and sent again,
 * so a batch of long errors over it would block every later one. Room is left
 * for the envelope and for text that is more than a byte a character. */
export const MAX_BATCH_CHARS = 40_000;
/** Events held at most: past it the oldest are dropped and counted. */
export const MAX_QUEUE = 500;
/** Errors and warnings one session reports in full; the rest are counted. */
export const MAX_TROUBLE = 20;
/** An error's text and stack are cut here. A GPU validation error runs to six
 * or eight hundred characters and names the shader module and the pipeline
 * only at its end, so the text keeps a thousand. Two thousand characters of
 * stack is a dozen or more minified frames, which
 * `tools/telemetry/symbolicate.mjs` reads back against the build's source
 * maps. The server keeps two thousand of any string (`MAX_STRING_LENGTH`). */
export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_STACK_LENGTH = 2000;
/** The batch format the server reads (`BATCH_VERSION`). */
export const BATCH_VERSION = 1;
/** The route on the telemetry service (`TELEMETRY_PATH`). */
export const TELEMETRY_PATH = "/t";
/** The localStorage keys: the switch, the tester mark, and the visitor id. */
export const SWITCH_KEY = "dayhike.telemetry";
export const TESTER_KEY = "dayhike.tester";
export const VISITOR_KEY = "dayhike.visitor";
/** The referrer is kept to its origin and path, and this many characters. */
export const MAX_REFERRER_LENGTH = 200;

export type FieldValue = string | number | boolean | readonly number[];
export type Fields = Record<string, FieldValue>;
/** What `context` takes: a field, or null to clear one. */
export type ContextFields = Record<string, FieldValue | null>;

export type TelemetryDeps = {
  /** A monotonic clock in milliseconds (`performance.now`). */
  now(): number;
  /** Sends a batch, resolving whether the server took it. A failed send is retried on the next flush. */
  send(url: string, body: string): Promise<boolean>;
  /** Sends a batch as the page leaves, fire and forget (`navigator.sendBeacon`). */
  beacon(url: string, body: string): boolean;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
};

export type Telemetry = {
  /** False with no URL: every call is then a no-op. */
  readonly enabled: boolean;
  /** Records an event. `fields` are flat: primitives, or arrays of numbers. */
  event(name: string, fields?: Fields): void;
  /** Records an error, capped and deduplicated; `kind` says who caught it. */
  error(kind: string, message: string, stack?: string): void;
  /** As `error`, at warning severity. */
  warn(kind: string, message: string, stack?: string): void;
  /** Adds to the envelope every later batch carries: the GPU's signals, once read. */
  set(fields: Fields): void;
  /**
   * What every event queued from here carries until it changes: the match
   * (`game`, `world`, `seed`) and the lobby. A null clears a key, so a row
   * names a match or a lobby only while one is running.
   */
  context(fields: ContextFields): void;
  /** Where the page is, attached to every error after: a breadcrumb. */
  mark(where: string): void;
  /** The heartbeat's sampler while a match runs, or null between matches. */
  sample(sampler: (() => Fields) | null): void;
  /** Sends what is queued now, by the sender; `beacon` sends it fire and forget instead. */
  flush(options?: { beacon?: boolean }): void;
  /** The page is leaving: an `end` event with the session's counts, and everything sent by beacon. */
  end(reason: string): void;
  dispose(): void;
};

type Queued = { n: string; t: number } & Fields;

const DISABLED: Telemetry = {
  enabled: false,
  event: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  set: () => undefined,
  context: () => undefined,
  mark: () => undefined,
  sample: () => undefined,
  flush: () => undefined,
  end: () => undefined,
  dispose: () => undefined,
};

/**
 * The page's telemetry, or the no-op when `url` is null. `envelope` is what
 * every batch says of the page from the start: the session id and the
 * versions at least (`baseEnvelope`).
 */
export function createTelemetry(url: string | null, envelope: Fields, deps: TelemetryDeps): Telemetry {
  if (url === null) return DISABLED;
  const target: string = url;
  const start = deps.now();
  const queue: Queued[] = [];
  let fixed: Fields = { ...envelope };
  let context: Fields = {};
  let where = "";
  let sampler: (() => Fields) | null = null;
  let timer: unknown = null;
  let inFlight = false;
  let disposed = false;
  // The session's counts, reported in the heartbeat and at the end.
  let dropped = 0;
  let trouble = 0;
  let suppressed = 0;
  let sent = 0;
  let failed = 0;
  const seen = new Set<string>();

  const t = (): number => Math.round(deps.now() - start);

  /** Queues an entry under the context of the moment; the entry's own fields win. */
  function push(entry: Queued): void {
    if (queue.length >= MAX_QUEUE) {
      queue.shift();
      dropped += 1;
    }
    queue.push({ ...context, ...entry });
    if (queue.length >= FLUSH_AT_EVENTS) flushNow(false);
  }

  /** `st` is the page's clock as the batch is serialised: the server dates each event by `st - t`. */
  function body(events: readonly Queued[]): string {
    return JSON.stringify({ v: BATCH_VERSION, ...fixed, st: t(), events });
  }

  /**
   * One batch in flight at a time: a second would race the first for the
   * same events. A flush that finds one in flight leaves the queue for the
   * next; a send that fails puts its events back at the front, where the
   * queue's bound still holds.
   */
  /** The oldest events, at most `count` of them and `MAX_BATCH_CHARS` of JSON
   * (always one at least), taken off the queue. */
  function take(count: number): Queued[] {
    let chars = 0;
    let n = 0;
    while (n < queue.length && n < count) {
      const size = JSON.stringify(queue[n]).length + 1;
      if (n > 0 && chars + size > MAX_BATCH_CHARS) break;
      chars += size;
      n += 1;
    }
    return queue.splice(0, n);
  }

  function flushNow(viaBeacon: boolean): void {
    if (disposed || queue.length === 0) return;
    if (viaBeacon) {
      while (queue.length > 0) {
        const chunk = take(FLUSH_AT_EVENTS);
        if (deps.beacon(target, body(chunk))) sent += chunk.length;
        else failed += chunk.length;
      }
      return;
    }
    if (inFlight) return;
    const batch = take(MAX_BATCH_EVENTS);
    inFlight = true;
    deps.send(target, body(batch)).then(
      (ok) => {
        inFlight = false;
        if (ok) {
          sent += batch.length;
          return;
        }
        failed += batch.length;
        requeue(batch);
      },
      () => {
        inFlight = false;
        failed += batch.length;
        requeue(batch);
      },
    );
  }

  function requeue(batch: Queued[]): void {
    const room = MAX_QUEUE - queue.length;
    const kept = batch.slice(Math.max(0, batch.length - room));
    dropped += batch.length - kept.length;
    queue.unshift(...kept);
  }

  function counts(): Fields {
    return { dropped, trouble, suppressed, sent, failed, dur: t() };
  }

  function tick(): void {
    timer = null;
    if (disposed) return;
    if (sampler !== null) push({ n: "hb", t: t(), ...sampler(), dropped, failed });
    flushNow(false);
    schedule();
  }

  function schedule(): void {
    if (disposed || timer !== null) return;
    timer = deps.setTimer(tick, FLUSH_MS);
  }

  function record(level: "error" | "warn", kind: string, message: string, stack: string | undefined): void {
    const text = message.length > MAX_MESSAGE_LENGTH ? message.slice(0, MAX_MESSAGE_LENGTH) : message;
    // The first hundred characters identify a repeat: a stack's line numbers
    // and a message's variable tail would otherwise make every repeat new.
    const key = `${kind}|${text.slice(0, 100)}`;
    if (seen.has(key) || trouble >= MAX_TROUBLE) {
      suppressed += 1;
      return;
    }
    seen.add(key);
    trouble += 1;
    const entry: Queued = { n: level, t: t(), kind, msg: text, where };
    if (stack !== undefined && stack !== "") entry.stack = stack.length > MAX_STACK_LENGTH ? stack.slice(0, MAX_STACK_LENGTH) : stack;
    push(entry);
  }

  schedule();

  return {
    enabled: true,
    event(name, fields = {}) {
      if (disposed) return;
      push({ ...fields, n: name, t: t() });
    },
    error: (kind, message, stack) => record("error", kind, message, stack),
    warn: (kind, message, stack) => record("warn", kind, message, stack),
    set(fields) {
      fixed = { ...fixed, ...fields };
    },
    context(fields) {
      const next: Fields = { ...context };
      for (const [key, value] of Object.entries(fields)) {
        if (value === null) delete next[key];
        else next[key] = value;
      }
      context = next;
    },
    mark(next) {
      where = next;
    },
    sample(next) {
      sampler = next;
    },
    flush(options = {}) {
      flushNow(options.beacon === true);
    },
    end(reason) {
      if (disposed) return;
      push({ n: "end", t: t(), reason, ...counts() });
      flushNow(true);
    },
    dispose() {
      disposed = true;
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
    },
  };
}

/**
 * Where the page sends its batches, or null for none.
 *
 * Production bakes the service's URL into the build (`VITE_TELEMETRY_URL`,
 * from Terraform as the signaling URL is). Development has none, so a dev
 * page sends nothing unless asked with `?telemetry=on`, which goes to the dev
 * server's own origin, where Vite proxies `/t` to the local server.
 * `?telemetry=off` turns a production page silent and is remembered in
 * storage, so a developer's own machine stays out of the numbers; `on`
 * forgets it. `?telemetry=tester` marks the browser as a tester's, which the
 * envelope then says (`testerMark`) so the queries can leave its sessions
 * out; the page sends as usual, and `on` forgets that mark too. Storage that
 * refuses reads as never switched and never marked.
 */
export function telemetryUrl(
  env: { VITE_TELEMETRY_URL?: string | undefined },
  loc: { protocol: string; host: string; search: string },
  storage: Storage | null,
): string | null {
  const wanted = new URLSearchParams(loc.search).get("telemetry");
  if (wanted === "off") {
    try {
      storage?.setItem(SWITCH_KEY, "off");
    } catch {
      // Held for this page only, then.
    }
    return null;
  }
  if (wanted === "on") {
    try {
      storage?.removeItem(SWITCH_KEY);
      storage?.removeItem(TESTER_KEY);
    } catch {
      // The page is on either way.
    }
  } else {
    if (wanted === "tester") {
      try {
        storage?.setItem(TESTER_KEY, "1");
      } catch {
        // Marked for nothing, then: the session reads as anyone's.
      }
    }
    let off = false;
    try {
      off = storage?.getItem(SWITCH_KEY) === "off";
    } catch {
      off = false;
    }
    if (off) return null;
  }
  if (env.VITE_TELEMETRY_URL) return env.VITE_TELEMETRY_URL;
  return wanted === "on" ? `${loc.protocol}//${loc.host}${TELEMETRY_PATH}` : null;
}

/** Whether this browser was ever marked a tester's (`?telemetry=tester`). */
export function testerMark(storage: Storage | null): boolean {
  try {
    return storage?.getItem(TESTER_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The referrer as the envelope says it: its origin and path, no query or
 * fragment (a referrer may carry a token), cut to `MAX_REFERRER_LENGTH`; ""
 * for none, or for one that is not a URL.
 */
export function referrerOf(referrer: string): string {
  if (referrer === "") return "";
  try {
    const url = new URL(referrer);
    return `${url.origin}${url.pathname}`.slice(0, MAX_REFERRER_LENGTH);
  } catch {
    return "";
  }
}

/**
 * The world's version and its seed, from a forest level id. An id reads
 * `forest/<generation>/<variant>/<seed>/<fieldHash>/<passHash>`
 * (`sim/forest.ts`): the seed picks the world and everything else digests the
 * code that builds it, so the id without its seed is the version of the
 * generator the match ran on — which moves when the generator's code or its
 * tunables move, whether or not anyone bumped the constant. An id of another
 * shape is kept whole, as its own version.
 */
export function worldVersionOf(levelId: string): { world: string; seed: number | null } {
  const parts = levelId.split("/");
  if (parts.length === 6 && parts[0] === "forest") {
    const seed = Number(parts[3]);
    return { world: [parts[0], parts[1], parts[2], parts[4], parts[5]].join("/"), seed: Number.isFinite(seed) ? seed : null };
  }
  return { world: levelId, seed: null };
}

/**
 * The visitor's id, one a browser, so a returning player counts once: read
 * from storage, or made by `newId` and stored. Null where storage refuses,
 * which leaves the session id alone to count by.
 */
export function visitorId(storage: Storage | null, newId: () => string): string | null {
  if (storage === null) return null;
  try {
    const held = storage.getItem(VISITOR_KEY);
    if (held !== null && held !== "") return held;
    const made = newId();
    storage.setItem(VISITOR_KEY, made);
    return made;
  } catch {
    return null;
  }
}

/** What an error event's text is made from: the page's own `console` calls take anything. */
export function textOf(args: readonly unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      if (typeof arg === "string") return arg;
      if (arg === undefined) return "undefined";
      try {
        return JSON.stringify(arg) ?? String(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

/** The first stack among `args`, for an error logged by the page's own code. */
export function stackOf(args: readonly unknown[]): string | undefined {
  for (const arg of args) if (arg instanceof Error && typeof arg.stack === "string") return arg.stack;
  return undefined;
}

export type ErrorTarget = {
  addEventListener(type: "error", listener: (event: { message: string; filename?: string; lineno?: number; error?: unknown }) => void): void;
  addEventListener(type: "unhandledrejection", listener: (event: { reason: unknown }) => void): void;
};

export type ConsoleLike = {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};

/** An error the page's HTML caught before this module ran (`client/index.html`). */
export type EarlyError = { kind: string; msg: string; stack?: string; at?: number };

/**
 * The page's early catch: a queue the HTML's own listeners fill until the
 * bundle is up, then a handler they call instead. `window.__dh`, made by the
 * inline script in `client/index.html`, which also beacons the queue itself
 * if nothing ever takes it over — the "it never loaded" case.
 */
export type EarlyCatch = { q: EarlyError[]; on: ((error: EarlyError) => void) | null };

/**
 * Babylon's logger's levels (`Logger._Levels`). Babylon takes `console.warn`
 * and `console.error` into them when its module loads, before the page's
 * wrap of the console exists, so its warnings and errors (a GPU validation
 * error, an effect that would not compile) never pass through that wrap; the
 * levels' own functions are wrapped instead.
 */
export type LoggerLevels = ReadonlyArray<{ name?: string; logFunc?: (...args: unknown[]) => void }>;

/** What Babylon puts before every line it logs: its name and the wall clock,
 * which would make every repeat of a line a new one. */
const BABYLON_PREFIX = /^BJS - \[\d{2}:\d{2}:\d{2}\]: /;

/** `con[key]` replaced by one that prints as before, then tells `hear`; returns what puts it back. */
function listenTo<K extends "error" | "warn">(con: ConsoleLike, key: K, hear: (args: unknown[]) => void): () => void {
  const original = con[key];
  con[key] = (...args: unknown[]) => {
    original.apply(con, args);
    try {
      hear(args);
    } catch {
      // A listener must never be the page's next error.
    }
  };
  return () => {
    con[key] = original;
  };
}

/**
 * Hears what the page would otherwise only print: uncaught throws, rejected
 * promises nobody awaited, the game's own `console.error` and `console.warn`,
 * whose prefixes ("WebGPU:", "quality:") already bucket them, and Babylon's
 * own warnings and errors (`babylon`, its logger's levels; kind `babylon`).
 * What prints keeps printing; the wraps only listen. Nothing here runs unless
 * something is wrong, so a clean session pays for a few closures and no more.
 */
export function installErrorCapture(
  telemetry: Telemetry,
  target: ErrorTarget,
  con: ConsoleLike,
  early?: EarlyCatch,
  babylon?: LoggerLevels,
): () => void {
  if (!telemetry.enabled) return () => undefined;
  const undo: Array<() => void> = [];
  if (early !== undefined) {
    // What the HTML caught before this ran, then everything it catches after:
    // its listeners stay the page's listeners, so nothing is heard twice.
    for (const e of early.q) telemetry.error(e.kind, e.msg, e.stack);
    early.q.length = 0;
    early.on = (e) => telemetry.error(e.kind, e.msg, e.stack);
    undo.push(() => {
      early.on = null;
    });
  } else {
    target.addEventListener("error", (event) => {
      const error = event.error;
      const stack = error instanceof Error ? error.stack : undefined;
      const at = event.filename ? ` (${event.filename.split("/").pop() ?? ""}:${event.lineno ?? 0})` : "";
      telemetry.error("uncaught", `${event.message}${at}`, stack);
    });
    target.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      telemetry.error("unhandled", textOf([reason]), reason instanceof Error ? reason.stack : undefined);
    });
  }
  undo.push(listenTo(con, "error", (args) => telemetry.error("console", textOf(args), stackOf(args))));
  undo.push(listenTo(con, "warn", (args) => telemetry.warn("console", textOf(args), stackOf(args))));
  for (const level of babylon ?? []) {
    const original = level.logFunc;
    const severity = level.name === "Error" ? "error" : level.name === "Warn" ? "warn" : null;
    if (original === undefined || severity === null) continue;
    const mutable = level as { logFunc?: (...args: unknown[]) => void };
    mutable.logFunc = (...args: unknown[]) => {
      original(...args);
      try {
        telemetry[severity]("babylon", textOf(args).replace(BABYLON_PREFIX, ""), stackOf(args));
      } catch {
        // As above.
      }
    };
    undo.push(() => {
      mutable.logFunc = original;
    });
  }
  return () => {
    for (const step of undo.reverse()) step();
  };
}

/** The browser's dependencies for `createTelemetry`: keepalive fetches between flushes, a beacon on the way out. */
export function browserDeps(): TelemetryDeps {
  return {
    now: () => performance.now(),
    send: (url, body) =>
      fetch(url, {
        method: "POST",
        body,
        // text/plain keeps the request simple (no preflight), and keepalive
        // lets it finish after the page that sent it is gone.
        headers: { "content-type": "text/plain" },
        keepalive: true,
        credentials: "omit",
        mode: "cors",
      }).then(
        (res) => res.ok,
        () => false,
      ),
    beacon: (url, body) => {
      try {
        return navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
      } catch {
        return false;
      }
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}
