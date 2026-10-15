import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { createSignalingServer, parseRole, SIGNALING_PATH, type SignalingServer } from "../src/server.js";
import {
  cleanFields,
  MAX_ARRAY_LENGTH,
  MAX_BATCH_BYTES,
  MAX_EVENT_AGE_MS,
  MAX_EVENTS_PER_BATCH,
  MAX_FIELDS,
  MAX_STRING_LENGTH,
  parseBatch,
  PostLimiter,
  rowsOf,
  severityOf,
  TELEMETRY_PATH,
} from "../src/telemetry.js";
import { parseIpRanges } from "../src/admission.js";
import { row, type LogRow } from "../src/log.js";

const ORIGIN = "https://games.csarko.sh";

function batch(events: unknown[], envelope: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, sid: "s1", build: "abc1234", proto: 5, gen: 8, ...envelope, events });
}

describe("parseBatch", () => {
  it("reads the envelope and the events, flattening nothing it does not understand", () => {
    const parsed = parseBatch(
      batch(
        [
          { n: "page", t: 12, kind: "landing", nested: { dropped: true }, flags: [1, "a", true, null, {}] },
          { n: "Bad Name", t: 1 },
          { n: "no_time" },
          "not an event",
        ],
        { desktop: false, os: "darwin-arm64", deep: { no: 1 }, bad: Number.NaN },
      ),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.batch.envelope).toEqual({ sid: "s1", build: "abc1234", proto: 5, gen: 8, desktop: false, os: "darwin-arm64" });
    expect(parsed.batch.events).toEqual([{ n: "page", t: 12, fields: { kind: "landing", flags: [1, "a", true] } }]);
  });

  it("refuses what is not a batch, naming why", () => {
    expect(parseBatch("{")).toEqual({ ok: false, problem: "not_json" });
    expect(parseBatch("[]")).toEqual({ ok: false, problem: "not_object" });
    expect(parseBatch(JSON.stringify({ v: 2, sid: "s", events: [] }))).toEqual({ ok: false, problem: "bad_version" });
    expect(parseBatch(JSON.stringify({ v: 1, sid: "s" }))).toEqual({ ok: false, problem: "no_events" });
    expect(parseBatch(JSON.stringify({ v: 1, events: [] }))).toEqual({ ok: false, problem: "no_session" });
    expect(parseBatch(JSON.stringify({ v: 1, sid: "x".repeat(65), events: [] }))).toEqual({ ok: false, problem: "no_session" });
    const many = new Array<unknown>(MAX_EVENTS_PER_BATCH + 1).fill({ n: "a", t: 0 });
    expect(parseBatch(batch(many))).toEqual({ ok: false, problem: "too_many_events" });
  });

  it("reads the batch's own time off the envelope, and drops one that is not a time", () => {
    const sent = parseBatch(batch([{ n: "hb", t: 1 }], { st: 1500 }));
    if (!sent.ok) throw new Error(sent.problem);
    expect(sent.batch.sentAt).toBe(1500);
    expect(sent.batch.envelope).not.toHaveProperty("st");
    for (const st of ["1500", -1, Number.NaN, null]) {
      const parsed = parseBatch(batch([{ n: "hb", t: 1 }], { st }));
      if (!parsed.ok) throw new Error(parsed.problem);
      expect(parsed.batch).not.toHaveProperty("sentAt");
      expect(parsed.batch.envelope).not.toHaveProperty("st");
    }
  });

  it("bounds every field", () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < MAX_FIELDS + 10; i++) wide[`k${i}`] = i;
    const cleaned = cleanFields({
      ...wide,
      long: "y".repeat(MAX_STRING_LENGTH + 5),
      list: new Array<number>(MAX_ARRAY_LENGTH + 5).fill(1),
      "bad key": 1,
    });
    expect(Object.keys(cleaned)).toHaveLength(MAX_FIELDS);
    const bounded = cleanFields({ long: "y".repeat(MAX_STRING_LENGTH + 5), list: new Array<number>(MAX_ARRAY_LENGTH + 5).fill(1), "bad key": 1 });
    expect((bounded.long as string).length).toBe(MAX_STRING_LENGTH);
    expect((bounded.list as number[]).length).toBe(MAX_ARRAY_LENGTH);
    expect(bounded["bad key"]).toBeUndefined();
  });
});

describe("rowsOf", () => {
  it("flattens the envelope onto every event, the event's own fields winning, and stamps the receipt", () => {
    const parsed = parseBatch(batch([{ n: "match_start", t: 5, world: "forest/8/x/1/2", role: "host" }, { n: "error", t: 9, msg: "boom", dh: 0 }], { world: "unset" }));
    if (!parsed.ok) throw new Error(parsed.problem);
    const rows = rowsOf(parsed.batch, { serverBuild: "srv1", receivedAt: 1000 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ dh: 1, severity: "INFO", message: "match_start", n: "match_start", sid: "s1", build: "abc1234", world: "forest/8/x/1/2", role: "host", t: 5, at: 1000, sbuild: "srv1", svc: "telemetry" });
    expect(rows[1]).toMatchObject({ severity: "ERROR", n: "error", world: "unset", message: "error: boom", dh: 1 });
  });

  it("dates each row at its event when the batch says when it was sent", () => {
    const receivedAt = Date.UTC(2026, 9, 15, 12, 0, 0, 500);
    const parsed = parseBatch(batch([{ n: "page", t: 1000 }, { n: "play", t: 30_250 }, { n: "hb", t: 31_000 }], { st: 31_000 }));
    if (!parsed.ok) throw new Error(parsed.problem);
    const rows = rowsOf(parsed.batch, { serverBuild: "srv1", receivedAt });
    expect(rows.map((r) => r.timestamp)).toEqual(["2026-10-15T11:59:30.500Z", "2026-10-15T11:59:59.750Z", "2026-10-15T12:00:00.500Z"]);
    expect(rows.map((r) => r.at)).toEqual([receivedAt, receivedAt, receivedAt]);
    expect(rows.map((r) => r.t)).toEqual([1000, 30_250, 31_000]);
  });

  it("dates a row at its arrival when the batch carries no time", () => {
    const receivedAt = Date.UTC(2026, 9, 15, 12, 0, 0, 500);
    const parsed = parseBatch(batch([{ n: "page", t: 1000 }, { n: "play", t: 30_250 }]));
    if (!parsed.ok) throw new Error(parsed.problem);
    const rows = rowsOf(parsed.batch, { serverBuild: "srv1", receivedAt });
    expect(rows.map((r) => r.timestamp)).toEqual(["2026-10-15T12:00:00.500Z", "2026-10-15T12:00:00.500Z"]);
  });

  it("falls back to arrival for an event older than a day or dated after its batch", () => {
    const receivedAt = Date.UTC(2026, 9, 15, 12, 0, 0, 0);
    const arrival = "2026-10-15T12:00:00.000Z";
    const parsed = parseBatch(
      batch([{ n: "old", t: 0 }, { n: "edge", t: 1000 }, { n: "future", t: MAX_EVENT_AGE_MS + 2000 }, { n: "now", t: MAX_EVENT_AGE_MS + 1000 }], {
        st: MAX_EVENT_AGE_MS + 1000,
      }),
    );
    if (!parsed.ok) throw new Error(parsed.problem);
    const rows = rowsOf(parsed.batch, { serverBuild: "srv1", receivedAt });
    expect(rows.map((r) => r.timestamp)).toEqual([arrival, "2026-10-14T12:00:00.000Z", arrival, arrival]);
  });

  it("lets no page field date, mark or grade its own row", () => {
    const parsed = parseBatch(batch([{ n: "hb", t: 1, timestamp: "1999-01-01T00:00:00.000Z", severity: "ERROR", message: "no", dh: 0 }], { st: 1 }));
    if (!parsed.ok) throw new Error(parsed.problem);
    const [only] = rowsOf(parsed.batch, { serverBuild: "srv1", receivedAt: Date.UTC(2026, 9, 15) });
    expect(only).toMatchObject({ timestamp: "2026-10-15T00:00:00.000Z", severity: "INFO", message: "hb", dh: 1 });
    // A row with no time of its own, as signaling's are, drops one rather than carry a stranger's.
    expect(row("INFO", "x", { timestamp: "1999-01-01T00:00:00.000Z", a: 1 })).toEqual({ a: 1, dh: 1, severity: "INFO", message: "x", n: "x" });
  });

  it("gives errors and warnings their severity", () => {
    expect(severityOf("error")).toBe("ERROR");
    expect(severityOf("warn")).toBe("WARNING");
    expect(severityOf("hb")).toBe("INFO");
  });
});

describe("PostLimiter", () => {
  it("allows a burst per address, refills with time, and forgets idle addresses", () => {
    let clock = 0;
    const limiter = new PostLimiter({ capacity: 2, refillPerSecond: 1, idleMs: 1000, now: () => clock });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    expect(limiter.allow("b")).toBe(true);
    clock = 1000;
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.tracked).toBe(2);
    clock = 2500;
    limiter.prune();
    expect(limiter.tracked).toBe(0);
  });

  it("admits untracked once the table is full rather than allocating", () => {
    const limiter = new PostLimiter({ capacity: 1, maxTrackedIps: 1 });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.tracked).toBe(1);
  });
});

describe("parseRole", () => {
  it("reads the two services and defaults to both", () => {
    expect(parseRole("signaling")).toBe("signaling");
    expect(parseRole("telemetry")).toBe("telemetry");
    expect(parseRole(undefined)).toBe("all");
    expect(parseRole("bogus")).toBe("all");
  });
});

describe("the telemetry route", () => {
  let server: SignalingServer;
  let base: string;
  const rows: LogRow[] = [];

  beforeAll(async () => {
    server = createSignalingServer(0, {
      role: "all",
      log: (r) => rows.push(r),
      serverBuild: "srv1",
      postLimits: { capacity: 3, refillPerSecond: 0 },
      ignoreIps: parseIpRanges("203.0.113.0/24, 2001:db8:1::/48"),
    });
    await new Promise<void>((resolve) => server.http.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  const post = (body: string, headers: Record<string, string> = {}, ip = "198.51.100.1") =>
    fetch(`${base}${TELEMETRY_PATH}`, { method: "POST", body, headers: { "content-type": "text/plain", "x-forwarded-for": ip, ...headers } });

  it("writes one row an event and answers 204 with CORS for an allowed origin", async () => {
    rows.length = 0;
    const res = await post(batch([{ n: "page", t: 1, kind: "landing" }, { n: "play", t: 2 }]), { origin: ORIGIN });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("vary")).toBe("origin");
    expect(rows.map((r) => r.n)).toEqual(["page", "play"]);
    expect(rows[0]).toMatchObject({ dh: 1, sid: "s1", build: "abc1234", sbuild: "srv1", svc: "telemetry", kind: "landing" });
    expect(typeof rows[0]?.at).toBe("number");
  });

  it("accepts a batch with no origin, as a probe sends it", async () => {
    rows.length = 0;
    const res = await post(batch([{ n: "probe", t: 0 }]), {}, "198.51.100.2");
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it("refuses an unlisted origin and writes nothing", async () => {
    rows.length = 0;
    const res = await post(batch([{ n: "page", t: 1 }]), { origin: "https://evil.example" }, "198.51.100.3");
    expect(res.status).toBe(403);
    expect(rows).toHaveLength(0);
  });

  it("answers a preflight", async () => {
    const res = await fetch(`${base}${TELEMETRY_PATH}`, { method: "OPTIONS", headers: { origin: ORIGIN } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toBe("POST");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("refuses other methods on the path", async () => {
    const res = await fetch(`${base}${TELEMETRY_PATH}`);
    expect(res.status).toBe(405);
  });

  it("names a malformed batch and writes nothing", async () => {
    rows.length = 0;
    const res = await post("{not json", {}, "198.51.100.4");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("not_json");
    expect(rows).toHaveLength(0);
  });

  it("refuses a body over the cap and stays up", async () => {
    rows.length = 0;
    const res = await post(batch([{ n: "big", t: 0, blob: "x".repeat(MAX_BATCH_BYTES) }]), {}, "198.51.100.5").catch(() => null);
    // The request is destroyed at the cap: the answer is 413 where the
    // response gets out before the socket goes, or a failed fetch otherwise.
    if (res !== null) expect(res.status).toBe(413);
    expect(rows).toHaveLength(0);
    const health = await fetch(`${base}/healthcheck`);
    expect(health.status).toBe(200);
  });

  it("rate-limits an address by batches, not by events", async () => {
    rows.length = 0;
    const ip = "198.51.100.6";
    for (let i = 0; i < 3; i++) expect((await post(batch([{ n: "hb", t: i }]), {}, ip)).status).toBe(204);
    expect((await post(batch([{ n: "hb", t: 3 }]), {}, ip)).status).toBe(429);
    expect(rows).toHaveLength(3);
  });

  it("answers an ignored address 204, with CORS, and writes nothing; a bad batch from it is still refused", async () => {
    rows.length = 0;
    for (const ip of ["203.0.113.7", "::ffff:203.0.113.8", "2001:db8:1:2::3"]) {
      for (let i = 0; i < 3; i++) {
        const res = await post(batch([{ n: "hb", t: i }]), { origin: ORIGIN }, ip);
        expect(res.status).toBe(204);
        expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
      }
    }
    expect(rows).toHaveLength(0);
    // The batch is read and checked as any other, so a deploy verified from the owner's machine still sees the 400.
    expect((await post("{", { origin: ORIGIN }, "203.0.113.9")).status).toBe(400);
    // Still the origin check first: an ignored address on another site's page is refused, not humoured.
    expect((await post(batch([{ n: "hb", t: 0 }]), { origin: "https://evil.example" }, "203.0.113.7")).status).toBe(403);
    // And a neighbour outside the prefix is written as ever.
    expect((await post(batch([{ n: "hb", t: 0 }]), { origin: ORIGIN }, "203.0.114.7")).status).toBe(204);
    expect(rows).toHaveLength(1);
  });
});

describe("the roles", () => {
  it("a telemetry-only process refuses the socket and a signaling-only one refuses the route", async () => {
    const telemetryOnly = createSignalingServer(0, { role: "telemetry", log: () => undefined });
    const signalingOnly = createSignalingServer(0, { role: "signaling", log: () => undefined });
    await Promise.all(
      [telemetryOnly, signalingOnly].map((s) => new Promise<void>((resolve) => s.http.once("listening", () => resolve()))),
    );
    const tPort = (telemetryOnly.http.address() as AddressInfo).port;
    const sPort = (signalingOnly.http.address() as AddressInfo).port;
    try {
      const refused = new WebSocket(`ws://127.0.0.1:${tPort}${SIGNALING_PATH}`);
      const err = await new Promise<Error>((resolve) => {
        refused.once("error", resolve);
        refused.once("open", () => resolve(new Error("unexpectedly opened")));
      });
      expect(err.message).not.toBe("unexpectedly opened");

      const noRoute = await fetch(`http://127.0.0.1:${sPort}${TELEMETRY_PATH}`, { method: "POST", body: batch([{ n: "x", t: 0 }]) });
      expect(noRoute.status).toBe(404);
      const route = await fetch(`http://127.0.0.1:${tPort}${TELEMETRY_PATH}`, { method: "POST", body: batch([{ n: "x", t: 0 }]) });
      expect(route.status).toBe(204);
    } finally {
      await Promise.all([telemetryOnly.close(), signalingOnly.close()]);
    }
  });
});

describe("room rows", () => {
  const open = async (url: string): Promise<WebSocket> => {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return socket;
  };
  const next = (socket: WebSocket): Promise<unknown> => new Promise((resolve) => socket.once("message", (raw) => resolve(JSON.parse(raw.toString()))));
  const until = async (predicate: () => boolean): Promise<void> => {
    for (let i = 0; i < 200 && !predicate(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(predicate()).toBe(true);
  };
  const start = async (now: () => number): Promise<{ server: SignalingServer; rows: LogRow[]; url: string }> => {
    const rows: LogRow[] = [];
    const server = createSignalingServer(0, { role: "signaling", log: (r) => rows.push(r), serverBuild: "srv1", now });
    await new Promise<void>((resolve) => server.http.once("listening", () => resolve()));
    return { server, rows, url: `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}${SIGNALING_PATH}` };
  };

  it("records a lobby's life: create, join, leave, and its end with a lifetime", async () => {
    let clock = 1_000;
    const { server, rows, url } = await start(() => clock);
    const room = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    try {
      const host = await open(url);
      host.send(JSON.stringify({ t: "create", room, peerId: "h" }));
      await next(host);
      const guest = await open(url);
      guest.send(JSON.stringify({ t: "join", room, peerId: "g" }));
      await next(guest);
      const stranger = await open(url);
      stranger.send(JSON.stringify({ t: "join", room: "3f2504e0-4f89-41d3-9a0c-0305e82c3302", peerId: "s" }));
      await next(stranger);
      guest.send(JSON.stringify({ t: "leave" }));
      await until(() => rows.some((r) => r.n === "room_leave"));
      clock = 6_000;
      host.send(JSON.stringify({ t: "leave" }));
      await until(() => rows.some((r) => r.n === "room_end"));

      expect(rows.map((r) => r.n)).toEqual(["room_create", "room_join", "room_refused", "room_leave", "room_leave", "room_end"]);
      expect(rows[0]).toMatchObject({ dh: 1, svc: "signaling", sbuild: "srv1", room, peers: 1, role: "host" });
      expect(rows[1]).toMatchObject({ room, peers: 2, role: "client" });
      expect(rows[2]).toMatchObject({ verb: "join", code: "no_such_lobby" });
      expect(rows[3]).toMatchObject({ room, peers: 1, host: false });
      expect(rows[4]).toMatchObject({ room, peers: 0, host: true });
      expect(rows[5]).toMatchObject({ room, reason: "host_left", lifeMs: 5_000 });
      // A player's room is nobody's verification.
      for (const r of rows) expect(r).not.toHaveProperty("verify");
      stranger.close();
    } finally {
      await server.close();
    }
  });

  it("marks a deploy verification's room on every row of its life", async () => {
    const { server, rows, url } = await start(() => 1_000);
    const room = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
    try {
      // As `tools/deploy/verify.mjs` does: a room of its own, then straight out.
      const probe = await open(url);
      probe.send(JSON.stringify({ t: "create", room, peerId: `verify-${Date.now()}` }));
      await next(probe);
      const guest = await open(url);
      guest.send(JSON.stringify({ t: "join", room, peerId: "g" }));
      await next(guest);
      probe.send(JSON.stringify({ t: "leave" }));
      await until(() => rows.some((r) => r.n === "room_end"));

      expect(rows.map((r) => r.n)).toEqual(["room_create", "room_join", "room_leave", "room_end"]);
      for (const r of rows) expect(r).toMatchObject({ room, verify: true });
      guest.close();
    } finally {
      await server.close();
    }
  });
});
