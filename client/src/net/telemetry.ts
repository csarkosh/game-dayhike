/**
 * What the page tells of itself, and how little it costs to tell.
 *
 * A page makes a handful of events as it goes — it landed, Play was pressed,
 * a lobby formed, the world was built, the night fell, the party won or died,
 * something threw — and every half minute, or on its way out, sends what it
 * has in one batch to the telemetry service (`server/src/telemetry.ts`), which
 * writes the events out as rows. Each batch carries an envelope naming the
 * page: its session, the build it runs, the protocol and generator versions,
 * and, once a world is built, which world (`worldVersionOf`). The server
 * flattens the envelope onto every row, so a row never needs a join to say
 * which version of the game produced it.
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
/** Events held at most: past it the oldest are dropped and counted. */
export const MAX_QUEUE = 500;
/** Errors and warnings one session reports in full; the rest are counted. */
export const MAX_TROUBLE = 20;
/** An error's text and stack are cut here. Two thousand characters of stack
 * is a dozen or more minified frames, which `tools/telemetry/symbolicate.mjs`
 * reads back against the build's source maps. */
export const MAX_MESSAGE_LENGTH = 300;
export const MAX_STACK_LENGTH = 2000;
/** The batch format the server reads (`BATCH_VERSION`). */
export const BATCH_VERSION = 1;
/** The route on the telemetry service (`TELEMETRY_PATH`). */
export const TELEMETRY_PATH = "/t";
/** The localStorage keys: the switch, and the visitor id. */
export const SWITCH_KEY = "dayhike.telemetry";
export const VISITOR_KEY = "dayhike.visitor";

export type FieldValue = string | number | boolean | readonly number[];
export type Fields = Record<string, FieldValue>;

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
  /** Adds to the envelope every later batch carries: the world, the lobby. */
  set(fields: Fields): void;
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

  function push(entry: Queued): void {
    if (queue.length >= MAX_QUEUE) {
      queue.shift();
      dropped += 1;
    }
    queue.push(entry);
    if (queue.length >= FLUSH_AT_EVENTS) flushNow(false);
  }

  function body(events: readonly Queued[]): string {
    return JSON.stringify({ v: BATCH_VERSION, ...fixed, events });
  }

  /**
   * One batch in flight at a time: a second would race the first for the
   * same events. A flush that finds one in flight leaves the queue for the
   * next; a send that fails puts its events back at the front, where the
   * queue's bound still holds.
   */
  function flushNow(viaBeacon: boolean): void {
    if (disposed || queue.length === 0) return;
    if (viaBeacon) {
      while (queue.length > 0) {
        const chunk = queue.splice(0, FLUSH_AT_EVENTS);
        if (deps.beacon(target, body(chunk))) sent += chunk.length;
        else failed += chunk.length;
      }
      return;
    }
    if (inFlight) return;
    const batch = queue.splice(0, MAX_BATCH_EVENTS);
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
 * forgets it. Storage that refuses reads as never switched.
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
    } catch {
      // The page is on either way.
    }
  } else {
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
 * Hears what the page would otherwise only print: uncaught throws, rejected
 * promises nobody awaited, and the game's own `console.error` and
 * `console.warn`, whose prefixes ("WebGPU:", "quality:") already bucket them.
 * The console keeps printing; the wrap only listens. Nothing here runs unless
 * something is wrong, so a clean session pays for a few closures and no more.
 */
export function installErrorCapture(telemetry: Telemetry, target: ErrorTarget, con: ConsoleLike, early?: EarlyCatch): () => void {
  if (!telemetry.enabled) return () => undefined;
  // What the HTML caught before this ran, then everything it catches after:
  // its listeners stay the page's listeners, so nothing is heard twice.
  if (early !== undefined) {
    for (const e of early.q) telemetry.error(e.kind, e.msg, e.stack);
    early.q.length = 0;
    early.on = (e) => telemetry.error(e.kind, e.msg, e.stack);
    const restore = con.error;
    const restoreWarn = con.warn;
    con.error = (...args: unknown[]) => {
      restore.apply(con, args);
      try {
        telemetry.error("console", textOf(args), stackOf(args));
      } catch {
        // A listener must never be the page's next error.
      }
    };
    con.warn = (...args: unknown[]) => {
      restoreWarn.apply(con, args);
      try {
        telemetry.warn("console", textOf(args), stackOf(args));
      } catch {
        // As above.
      }
    };
    return () => {
      early.on = null;
      con.error = restore;
      con.warn = restoreWarn;
    };
  }
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
  const error = con.error;
  const warn = con.warn;
  con.error = (...args: unknown[]) => {
    error.apply(con, args);
    try {
      telemetry.error("console", textOf(args), stackOf(args));
    } catch {
      // A listener must never be the page's next error.
    }
  };
  con.warn = (...args: unknown[]) => {
    warn.apply(con, args);
    try {
      telemetry.warn("console", textOf(args), stackOf(args));
    } catch {
      // As above.
    }
  };
  return () => {
    con.error = error;
    con.warn = warn;
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
