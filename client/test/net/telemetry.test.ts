import { describe, it, expect } from "vitest";
import {
  createTelemetry,
  FLUSH_AT_EVENTS,
  FLUSH_MS,
  installErrorCapture,
  MAX_QUEUE,
  MAX_REFERRER_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_TROUBLE,
  referrerOf,
  SWITCH_KEY,
  telemetryUrl,
  TESTER_KEY,
  testerMark,
  textOf,
  VISITOR_KEY,
  visitorId,
  worldVersionOf,
  type Fields,
  type TelemetryDeps,
} from "../../src/net/telemetry.js";

type Batch = { v: number; st: number; events: ({ n: string; t: number } & Fields)[] } & Fields;

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
    t.set({ gpu: "Apple M1", cores: 8 });
    f.advance(100);
    t.event("play");
    expect(f.sent).toHaveLength(0);
    f.fire();
    expect(f.sent).toHaveLength(1);
    const { url, batch, beacon } = f.sent[0]!;
    expect(url).toBe("https://t.example/t");
    expect(beacon).toBe(false);
    expect(batch).toMatchObject({ v: 1, sid: "s1", build: "abc1234", proto: 5, gen: 8, gpu: "Apple M1", cores: 8 });
    // The page's clock as the batch was made: the timer fired FLUSH_MS after the last step.
    expect(batch.st).toBe(350 + FLUSH_MS);
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

  it("splits a batch of long errors so no body passes what the server takes", () => {
    const f = fakeDeps({ ok: true });
    const t = createTelemetry("u", ENVELOPE, f.deps);
    for (let i = 0; i < MAX_TROUBLE; i++) t.error("uncaught", `${i} ${"m".repeat(MAX_MESSAGE_LENGTH)}`, "s".repeat(4000));
    t.end("test");
    const beacons = f.sent.filter((s) => s.beacon);
    expect(beacons.length).toBeGreaterThan(1);
    for (const { batch } of beacons) expect(JSON.stringify(batch).length).toBeLessThan(64 * 1024);
    const events = beacons.flatMap((s) => s.batch.events);
    expect(events.filter((e) => e.n === "error")).toHaveLength(MAX_TROUBLE);
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

  it("says its clock on every batch, by the sender and by beacon", async () => {
    const f = fakeDeps({ ok: true });
    const t = createTelemetry("u", ENVELOPE, f.deps);
    t.event("a");
    f.advance(1200);
    t.flush();
    await f.settle(true);
    t.event("b");
    f.advance(300);
    t.flush({ beacon: true });
    for (let i = 0; i < FLUSH_AT_EVENTS; i++) t.event("pos", { x: i });
    expect(f.sent.map((s) => [s.beacon, s.batch.st])).toEqual([
      [false, 1200],
      [true, 1500],
      [false, 1500],
    ]);
    // The batch's own events are dated before it, never after.
    for (const s of f.sent) for (const e of s.batch.events) expect(e.t).toBeLessThanOrEqual(s.batch.st);
  });

  it("copies the context onto each event as it is queued, and a null clears a key", async () => {
    const f = fakeDeps({ ok: true });
    const t = createTelemetry("u", ENVELOPE, f.deps);
    t.event("page", { kind: "landing" });
    t.context({ lobby: "L1" });
    t.event("lobby_joined", { members: 2 });
    t.context({ game: "G1", world: "forest/8/a/1/2", seed: 42 });
    t.event("match_start", { role: "host" });
    t.sample(() => ({ fps: 60 }));
    t.mark("game");
    t.error("console", "boom");
    f.fire();
    await f.settle(true);
    t.sample(null);
    t.event("match_end");
    t.context({ game: null, world: null, seed: null });
    t.event("page", { kind: "landing" });
    t.context({ lobby: null });
    t.event("exit");
    t.flush();
    const events = f.sent.flatMap((s) => s.batch.events);
    expect(events.map((e) => [e.n, e.lobby, e.game, e.world, e.seed])).toEqual([
      ["page", undefined, undefined, undefined, undefined],
      ["lobby_joined", "L1", undefined, undefined, undefined],
      ["match_start", "L1", "G1", "forest/8/a/1/2", 42],
      ["error", "L1", "G1", "forest/8/a/1/2", 42],
      ["hb", "L1", "G1", "forest/8/a/1/2", 42],
      ["match_end", "L1", "G1", "forest/8/a/1/2", 42],
      ["page", "L1", undefined, undefined, undefined],
      ["exit", undefined, undefined, undefined, undefined],
    ]);
    // The context never reaches the envelope.
    for (const s of f.sent) expect(s.batch).not.toHaveProperty("game");
  });

  it("lets an event's own field win over the context's", () => {
    const f = fakeDeps({ ok: true });
    const t = createTelemetry("u", ENVELOPE, f.deps);
    t.context({ lobby: "L1" });
    t.event("match_start", { lobby: "" });
    t.flush();
    expect(f.sent[0]!.batch.events[0]).toMatchObject({ n: "match_start", lobby: "" });
  });

  it("gives the end row the context of its moment", async () => {
    const f = fakeDeps({ ok: true });
    const t = createTelemetry("u", ENVELOPE, f.deps);
    t.context({ lobby: "L1", game: "G1" });
    t.event("match_start");
    t.flush();
    await f.settle(true);
    t.context({ game: null });
    f.advance(900);
    t.end("pagehide");
    const beacons = f.sent.filter((s) => s.beacon);
    expect(beacons).toHaveLength(1);
    expect(beacons[0]!.batch.st).toBe(900);
    expect(beacons[0]!.batch.events).toEqual([{ n: "end", t: 900, reason: "pagehide", lobby: "L1", dropped: 0, trouble: 0, suppressed: 0, sent: 1, failed: 0, dur: 900 }]);
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
    expect(telemetryUrl(PROD_ENV, { ...DEV, search: "?telemetry=tester" }, memoryStorage({}, true))).toBe(PROD_ENV.VITE_TELEMETRY_URL);
    expect(testerMark(memoryStorage({}, true))).toBe(false);
    expect(testerMark(null)).toBe(false);
  });

  it("?telemetry=tester marks the browser, still sends, and ?telemetry=on forgets the mark", () => {
    const storage = memoryStorage();
    expect(testerMark(storage)).toBe(false);
    expect(telemetryUrl(PROD_ENV, { ...DEV, search: "?telemetry=tester" }, storage)).toBe(PROD_ENV.VITE_TELEMETRY_URL);
    expect(storage.getItem(TESTER_KEY)).toBe("1");
    expect(testerMark(storage)).toBe(true);
    // A later visit without the parameter is still the tester's.
    expect(telemetryUrl(PROD_ENV, DEV, storage)).toBe(PROD_ENV.VITE_TELEMETRY_URL);
    expect(testerMark(storage)).toBe(true);
    // Off is a switch, tester a mark: off still silences a marked browser.
    expect(telemetryUrl(PROD_ENV, { ...DEV, search: "?telemetry=off" }, storage)).toBeNull();
    expect(testerMark(storage)).toBe(true);
    expect(telemetryUrl(PROD_ENV, { ...DEV, search: "?telemetry=on" }, storage)).toBe(PROD_ENV.VITE_TELEMETRY_URL);
    expect(storage.getItem(TESTER_KEY)).toBeNull();
    expect(storage.getItem(SWITCH_KEY)).toBeNull();
    expect(testerMark(storage)).toBe(false);
  });
});

describe("referrerOf", () => {
  it("keeps the origin and the path, drops the query and the fragment, and cuts long ones", () => {
    expect(referrerOf("")).toBe("");
    expect(referrerOf("https://news.ycombinator.com/item?id=123#c4")).toBe("https://news.ycombinator.com/item");
    expect(referrerOf("https://games.csarko.sh/")).toBe("https://games.csarko.sh/");
    expect(referrerOf("not a url")).toBe("");
    const long = referrerOf(`https://x.example/${"a".repeat(400)}`);
    expect(long.length).toBe(MAX_REFERRER_LENGTH);
    expect(long.startsWith("https://x.example/aaa")).toBe(true);
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

  it("hears Babylon's logger at its warning and error levels, without its clock, and puts them back", () => {
    const f = fakeDeps({ ok: true });
    const t = createTelemetry("u", ENVELOPE, f.deps);
    const printed: string[] = [];
    const levels = [
      {},
      { name: "Log", logFunc: (...a: unknown[]) => void printed.push(`L ${textOf(a)}`) },
      { name: "Warn", logFunc: (...a: unknown[]) => void printed.push(`W ${textOf(a)}`) },
      {},
      { name: "Error", logFunc: (...a: unknown[]) => void printed.push(`E ${textOf(a)}`) },
    ];
    const originalWarn = levels[2]!.logFunc;
    const con = { error: () => undefined, warn: () => undefined };
    const uninstall = installErrorCapture(t, { addEventListener: () => undefined }, con, undefined, levels);
    levels[1]!.logFunc!("BJS - [10:58:23]: a log line");
    levels[2]!.logFunc!("BJS - [10:58:23]: [Frame 2707] WebGPU uncaptured error (1): [object GPUValidationError] - Binding type");
    levels[4]!.logFunc!("BJS - [10:58:24]: Unable to compile effect:");
    t.flush();
    expect(f.sent[0]!.batch.events.map((e) => [e.n, e.kind, e.msg])).toEqual([
      ["warn", "babylon", "[Frame 2707] WebGPU uncaptured error (1): [object GPUValidationError] - Binding type"],
      ["error", "babylon", "Unable to compile effect:"],
    ]);
    expect(printed).toHaveLength(3);
    uninstall();
    expect(levels[2]!.logFunc).toBe(originalWarn);
  });

  it("keeps a GPU error's text to its end, where it names the shader module", () => {
    const f = fakeDeps({ ok: true });
    const t = createTelemetry("u", ENVELOPE, f.deps);
    const long = "Binding type in the shader (buffer) doesn't match the type in the layout (texture). " + "x".repeat(600) + ' [ShaderModule "vertex"]';
    t.error("babylon", long);
    t.flush();
    expect(f.sent[0]!.batch.events[0]!.msg).toBe(long);
    expect(long.length).toBeLessThan(MAX_MESSAGE_LENGTH);
  });

  it("installs nothing when telemetry is off", () => {
    const con = { error: () => undefined, warn: () => undefined };
    const original = con.error;
    installErrorCapture(createTelemetry(null, ENVELOPE, fakeDeps().deps), { addEventListener: () => undefined }, con);
    expect(con.error).toBe(original);
  });
});
