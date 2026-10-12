import { describe, it, expect } from "vitest";
import {
  createTelemetry,
  FLUSH_AT_EVENTS,
  FLUSH_MS,
  installErrorCapture,
  MAX_QUEUE,
  MAX_TROUBLE,
  SWITCH_KEY,
  telemetryUrl,
  textOf,
  VISITOR_KEY,
  visitorId,
  worldVersionOf,
  type Fields,
  type TelemetryDeps,
} from "../../src/net/telemetry.js";

type Batch = { v: number; events: ({ n: string; t: number } & Fields)[] } & Fields;

/** Deterministic deps: a clock to step, timers to fire by hand, and every send recorded. */
function fakeDeps(options: { ok?: boolean | (() => boolean) } = {}) {
  let clock = 1000;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextTimer = 1;
  const sent: { url: string; batch: Batch; beacon: boolean }[] = [];
  const pending: ((ok: boolean) => void)[] = [];
  const deps: TelemetryDeps = {
    now: () => clock,
    send: (url, body) => {
      sent.push({ url, batch: JSON.parse(body) as Batch, beacon: false });
      const ok = options.ok;
      if (ok === undefined) return new Promise<boolean>((resolve) => pending.push(resolve));
      return Promise.resolve(typeof ok === "function" ? ok() : ok);
    },
    beacon: (url, body) => {
      sent.push({ url, batch: JSON.parse(body) as Batch, beacon: true });
      return true;
    },
    setTimer: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (handle) => void timers.delete(handle as number),
  };
  return {
    deps,
    sent,
    advance: (ms: number) => void (clock += ms),
    fire: () => {
      const [id, entry] = [...timers.entries()][0] ?? [];
      if (id === undefined || entry === undefined) throw new Error("no timer armed");
      timers.delete(id);
      clock += entry.ms;
      entry.fn();
    },
    timers,
    settle: async (ok: boolean) => {
      pending.shift()?.(ok);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const ENVELOPE = { sid: "s1", build: "abc1234", proto: 5, gen: 8 };

describe("createTelemetry", () => {
  it("is a no-op without a URL", () => {
    const f = fakeDeps();
    const t = createTelemetry(null, ENVELOPE, f.deps);
    expect(t.enabled).toBe(false);
    t.event("page");
    t.end("pagehide");
    expect(f.sent).toHaveLength(0);
    expect(f.timers.size).toBe(0);
  });

  it("queues events with their time and sends them on the timer under the envelope", async () => {
    const f = fakeDeps({ ok: true });
    const t = createTelemetry("https://t.example/t", ENVELOPE, f.deps);
    f.advance(250);
    t.event("page", { kind: "landing" });
    t.set({ world: "forest/8/a/1/2", seed: 42 });
    f.advance(100);
    t.event("play");
    expect(f.sent).toHaveLength(0);
    f.fire();
    expect(f.sent).toHaveLength(1);
    const { url, batch, beacon } = f.sent[0]!;
    expect(url).toBe("https://t.example/t");
    expect(beacon).toBe(false);
    expect(batch).toMatchObject({ v: 1, sid: "s1", build: "abc1234", proto: 5, gen: 8, world: "forest/8/a/1/2", seed: 42 });
    expect(batch.events).toEqual([
      { n: "page", t: 250, kind: "landing" },
      { n: "play", t: 350 },
    ]);
    // The timer is armed again for the next flush.
    expect(f.timers.size).toBe(1);
    expect([...f.timers.values()][0]?.ms).toBe(FLUSH_MS);
    await f.settle(true);
  });

  it("flushes at once when the queue is long", () => {
    const f = fakeDeps({ ok: true });
    const t = createTelemetry("u", ENVELOPE, f.deps);
    for (let i = 0; i < FLUSH_AT_EVENTS - 1; i++) t.event("pos", { x: i, z: 0 });
    expect(f.sent).toHaveLength(0);
    t.event("pos", { x: 99, z: 0 });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.batch.events).toHaveLength(FLUSH_AT_EVENTS);
  });

  it("puts a failed batch back for the next flush and sends one batch at a time", async () => {
    const f = fakeDeps();
    const t = createTelemetry("u", ENVELOPE, f.deps);
    t.event("a");
    t.flush();
    expect(f.sent).toHaveLength(1);
    t.event("b");
    // In flight: a second flush waits.
    t.flush();
    expect(f.sent).toHaveLength(1);
    await f.settle(false);
    t.flush();
    expect(f.sent).toHaveLength(2);
    expect(f.sent[1]!.batch.events.map((e) => e.n)).toEqual(["a", "b"]);
    await f.settle(true);
  });

  it("bounds the queue, counting what it drops, and reports the counts at the end", () => {
    const f = fakeDeps();
    const t = createTelemetry("u", ENVELOPE, f.deps);
    // The first flush goes in flight and never settles; everything after queues.
    for (let i = 0; i < MAX_QUEUE + FLUSH_AT_EVENTS + 10; i++) t.event("pos", { x: i });
    expect(f.sent).toHaveLength(1);
    f.advance(5000);
    t.end("pagehide");
    const beacons = f.sent.filter((s) => s.beacon);
    const events = beacons.flatMap((s) => s.batch.events);
    expect(beacons.every((s) => s.batch.events.length <= FLUSH_AT_EVENTS)).toBe(true);
    expect(events).toHaveLength(MAX_QUEUE);
    const end = events[events.length - 1]!;
    // The counts are taken before the end event itself pushes one more out.
    expect(end).toMatchObject({ n: "end", reason: "pagehide", dropped: 10, dur: 5000, failed: 0 });
    // The oldest were dropped: the first kept position is the twelfth queued after the flight.
    expect(events[0]).toMatchObject({ n: "pos", x: FLUSH_AT_EVENTS + 11 });
  });

  it("caps and deduplicates errors, attaching the breadcrumb and cutting the stack", () => {
    const f = fakeDeps({ ok: true });
    const t = createTelemetry("u", ENVELOPE, f.deps);
    t.mark("loading:models");
    t.error("console", "WebGPU: boom", "Error: boom\n" + "    at x\n".repeat(400));
    t.error("console", "WebGPU: boom", "a different stack");
    t.warn("console", "quality: slow");
    for (let i = 0; i < MAX_TROUBLE + 5; i++) t.error("uncaught", `distinct ${i}`);
    t.end("test");
    const events = f.sent.flatMap((s) => s.batch.events);
    const trouble = events.filter((e) => e.n === "error" || e.n === "warn");
    expect(trouble).toHaveLength(MAX_TROUBLE);
    expect(trouble[0]).toMatchObject({ n: "error", kind: "console", msg: "WebGPU: boom", where: "loading:models" });
    expect((trouble[0]!.stack as string).length).toBe(2000);
    expect(trouble[1]).toMatchObject({ n: "warn", msg: "quality: slow" });
    const end = events[events.length - 1]!;
    expect(end).toMatchObject({ n: "end", trouble: MAX_TROUBLE, suppressed: 1 + 5 + 2 });
  });

  it("heartbeats from the sampler while a match runs, and not between", () => {
    const f = fakeDeps({ ok: true });
    const t = createTelemetry("u", ENVELOPE, f.deps);
    f.fire();
    expect(f.sent).toHaveLength(0);
    t.sample(() => ({ fps: 59.5, worst: 41 }));
    f.fire();
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.batch.events[0]).toMatchObject({ n: "hb", fps: 59.5, worst: 41, dropped: 0, failed: 0 });
    t.sample(null);
    f.fire();
    expect(f.sent).toHaveLength(1);
  });

  it("sends by beacon on request, and nothing after dispose", () => {
    const f = fakeDeps();
    const t = createTelemetry("u", ENVELOPE, f.deps);
    t.event("a");
    t.flush({ beacon: true });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.beacon).toBe(true);
    t.dispose();
    expect(f.timers.size).toBe(0);
    t.event("b");
    t.flush();
    expect(f.sent).toHaveLength(1);
  });
});

/** A storage that remembers, or one that throws on every call. */
function memoryStorage(initial: Record<string, string> = {}, refuse = false): Storage {
  const map = new Map(Object.entries(initial));
  const fail = (): never => {
    throw new Error("refused");
  };
  return {
    getItem: (k) => (refuse ? fail() : (map.get(k) ?? null)),
    setItem: (k, v) => (refuse ? fail() : void map.set(k, v)),
    removeItem: (k) => (refuse ? fail() : void map.delete(k)),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

const DEV = { protocol: "http:", host: "localhost:5173", search: "" };
const PROD_ENV = { VITE_TELEMETRY_URL: "https://fps-telemetry-x-uw.a.run.app/t" };

describe("telemetryUrl", () => {
  it("is the build's URL in production and nothing in development", () => {
    expect(telemetryUrl(PROD_ENV, DEV, memoryStorage())).toBe(PROD_ENV.VITE_TELEMETRY_URL);
    expect(telemetryUrl({}, DEV, memoryStorage())).toBeNull();
    expect(telemetryUrl({ VITE_TELEMETRY_URL: "" }, DEV, memoryStorage())).toBeNull();
  });

  it("?telemetry=on reaches the dev server's own origin, which proxies the route", () => {
    expect(telemetryUrl({}, { ...DEV, search: "?telemetry=on" }, memoryStorage())).toBe("http://localhost:5173/t");
  });

  it("?telemetry=off is remembered and ?telemetry=on forgets it", () => {
    const storage = memoryStorage();
    expect(telemetryUrl(PROD_ENV, { ...DEV, search: "?telemetry=off" }, storage)).toBeNull();
    expect(storage.getItem(SWITCH_KEY)).toBe("off");
    expect(telemetryUrl(PROD_ENV, DEV, storage)).toBeNull();
    expect(telemetryUrl(PROD_ENV, { ...DEV, search: "?telemetry=on" }, storage)).toBe(PROD_ENV.VITE_TELEMETRY_URL);
    expect(storage.getItem(SWITCH_KEY)).toBeNull();
    expect(telemetryUrl(PROD_ENV, DEV, storage)).toBe(PROD_ENV.VITE_TELEMETRY_URL);
  });

  it("survives storage that refuses", () => {
    expect(telemetryUrl(PROD_ENV, { ...DEV, search: "?telemetry=off" }, memoryStorage({}, true))).toBeNull();
    expect(telemetryUrl(PROD_ENV, DEV, memoryStorage({}, true))).toBe(PROD_ENV.VITE_TELEMETRY_URL);
    expect(telemetryUrl(PROD_ENV, DEV, null)).toBe(PROD_ENV.VITE_TELEMETRY_URL);
  });
});

describe("worldVersionOf", () => {
  it("drops the seed from a forest id and keeps the rest as the version", () => {
    expect(worldVersionOf("forest/8/peninsula/123456/-1771299565/88812")).toEqual({ world: "forest/8/peninsula/-1771299565/88812", seed: 123456 });
  });

  it("keeps an id of another shape whole", () => {
    expect(worldVersionOf("sandbox01")).toEqual({ world: "sandbox01", seed: null });
  });
});

describe("visitorId", () => {
  it("makes one id a browser and keeps it", () => {
    const storage = memoryStorage();
    let n = 0;
    const first = visitorId(storage, () => `id${++n}`);
    expect(first).toBe("id1");
    expect(visitorId(storage, () => `id${++n}`)).toBe("id1");
    expect(storage.getItem(VISITOR_KEY)).toBe("id1");
  });

  it("is null where storage refuses or is absent", () => {
    expect(visitorId(memoryStorage({}, true), () => "x")).toBeNull();
    expect(visitorId(null, () => "x")).toBeNull();
  });
});

describe("installErrorCapture", () => {
  it("hears uncaught errors, unhandled rejections and the console, and keeps printing", () => {
    const f = fakeDeps({ ok: true });
    const t = createTelemetry("u", ENVELOPE, f.deps);
    const listeners = new Map<string, (event: never) => void>();
    const printed: string[] = [];
    const con = { error: (...a: unknown[]) => void printed.push(`E ${textOf(a)}`), warn: (...a: unknown[]) => void printed.push(`W ${textOf(a)}`) };
    const uninstall = installErrorCapture(
      t,
      { addEventListener: (type: string, listener: (event: never) => void) => void listeners.set(type, listener) },
      con,
    );
    const boom = new Error("boom");
    listeners.get("error")?.({ message: "Uncaught Error: boom", filename: "https://x/assets/index-abc.js", lineno: 12, error: boom } as never);
    listeners.get("unhandledrejection")?.({ reason: new TypeError("nope") } as never);
    con.error("WebGPU: the renderer could not be built", boom);
    con.warn("quality:", { tier: "low" });
    t.flush();
    const events = f.sent[0]!.batch.events;
    expect(events.map((e) => [e.n, e.kind, e.msg])).toEqual([
      ["error", "uncaught", "Uncaught Error: boom (index-abc.js:12)"],
      ["error", "unhandled", "TypeError: nope"],
      ["error", "console", "WebGPU: the renderer could not be built Error: boom"],
      ["warn", "console", 'quality: {"tier":"low"}'],
    ]);
    expect(events[0]!.stack).toBe(boom.stack?.slice(0, 2000));
    expect(events[2]!.stack).toBe(boom.stack?.slice(0, 2000));
    expect(printed).toEqual(["E WebGPU: the renderer could not be built Error: boom", 'W quality: {"tier":"low"}']);
    uninstall();
    con.error("after");
    expect(printed).toHaveLength(3);
    t.flush();
    expect(f.sent).toHaveLength(1);
  });

  it("installs nothing when telemetry is off", () => {
    const con = { error: () => undefined, warn: () => undefined };
    const original = con.error;
    installErrorCapture(createTelemetry(null, ENVELOPE, fakeDeps().deps), { addEventListener: () => undefined }, con);
    expect(con.error).toBe(original);
  });
});
