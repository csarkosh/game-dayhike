import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { createLocalJWKSet } from "jose";
import { createAdminAuth, parseAllowlist } from "../src/adminAuth.js";
import { forBigQuery, LOOKUP_NAMES, QUERY_NAMES, readQuery } from "../src/adminQueries.js";
import type { AdminData, LiveView } from "../src/admin.js";
import { plain } from "../src/adminData.js";
import { shapeKpis } from "../src/adminKpis.js";
import { createSignalingServer, type SignalingServer } from "../src/server.js";

/**
 * The project the tokens come from: the admin host's (`csarko-sh`), where the
 * page signs in, not the project this service runs in. The check trusts that
 * issuer alone.
 */
const AUTH_PROJECT = "csarko-sh";
/** The admin host's origin, which the routes answer; the game's own is not a caller any more but stays listed. */
const ORIGIN = "https://admin.csarko.sh";
const QUERIES = fileURLToPath(new URL("../../tools/telemetry/queries/", import.meta.url));

let privateKey: CryptoKey;
let jwk: JWK;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
});

/** A Firebase Auth ID token as Google would sign it for the admin host's project, with the claims given. */
async function token(claims: Record<string, unknown>, options: { iss?: string; aud?: string; expired?: boolean } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email_verified: true, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(options.iss ?? `https://securetoken.google.com/${AUTH_PROJECT}`)
    .setAudience(options.aud ?? AUTH_PROJECT)
    .setSubject("uid1")
    .setIssuedAt(now - 60)
    .setExpirationTime(options.expired ? now - 10 : now + 3600)
    .sign(privateKey);
}

describe("parseAllowlist", () => {
  it("reads a comma-separated list, trimmed and lower-cased, and ignores what is not an address", () => {
    expect(parseAllowlist(" Me@Example.com, other@example.org ,nope,")).toEqual(["me@example.com", "other@example.org"]);
    expect(parseAllowlist(undefined)).toEqual([]);
  });
});

describe("createAdminAuth", () => {
  const auth = () => createAdminAuth({ projectId: AUTH_PROJECT, allowed: ["me@example.com"], keys: createLocalJWKSet({ keys: [jwk] }) });

  it("admits a verified account on the list", async () => {
    expect(await auth().verify(`Bearer ${await token({ email: "Me@Example.com" })}`)).toEqual({ email: "me@example.com" });
  });

  it("refuses everyone else: not listed, unverified, wrong project, expired, malformed, absent", async () => {
    const a = auth();
    expect(await a.verify(`Bearer ${await token({ email: "other@example.com" })}`)).toBeNull();
    expect(await a.verify(`Bearer ${await token({ email: "me@example.com", email_verified: false })}`)).toBeNull();
    expect(await a.verify(`Bearer ${await token({ email: "me@example.com" }, { aud: "another" })}`)).toBeNull();
    expect(await a.verify(`Bearer ${await token({ email: "me@example.com" }, { iss: "https://securetoken.google.com/another" })}`)).toBeNull();
    // A token this service's own project issued is not the admin host's: the
    // sign-in moved, and only the host's issuer is trusted.
    expect(await a.verify(`Bearer ${await token({ email: "me@example.com" }, { iss: "https://securetoken.google.com/fps-csarko", aud: "fps-csarko" })}`)).toBeNull();
    expect(await a.verify(`Bearer ${await token({ email: "me@example.com" }, { expired: true })}`)).toBeNull();
    expect(await a.verify("Bearer not.a.token")).toBeNull();
    expect(await a.verify("Basic abc")).toBeNull();
    expect(await a.verify(undefined)).toBeNull();
  });
});

describe("the saved queries for BigQuery", () => {
  it("rename the table, parameterise the range, and turn each lookup's placeholder into its parameter", () => {
    for (const name of QUERY_NAMES) {
      const out = forBigQuery(readQuery(name, QUERIES), "fps-csarko", "dayhike_telemetry");
      expect(out.sql).toContain("`fps-csarko.dayhike_telemetry._AllLogs`");
      expect(out.sql).not.toContain("global.dayhike-telemetry");
      expect(out.sql).toContain("INTERVAL @days DAY");
      expect(out.sql).not.toContain("-- range");
      expect(out.params).toEqual(["days"]);
    }
    const placeholders = { session: ["'SID'", "@sid", "sid"], visitor: ["'VID'", "@vid", "vid"], match: ["'GAME'", "@game", "game"] } as const;
    for (const name of LOOKUP_NAMES) {
      const [literal, param, key] = placeholders[name];
      const out = forBigQuery(readQuery(name, QUERIES), "fps-csarko", "dayhike_telemetry");
      expect(out.sql).toContain(`= ${param}`);
      expect(out.sql).not.toContain(literal);
      expect(out.sql).not.toContain("global.dayhike-telemetry");
      // The placeholder stands twice in each file (the span, then the rows); the parameter is named once.
      expect(out.params).toEqual([key]);
    }
  });

  it("share one exclusion, the same text in every query over a range", () => {
    const block = (sql: string): string => sql.slice(sql.indexOf("WITH real AS ("), sql.indexOf("\n),\n") + 4);
    const first = block(readQuery("funnel", QUERIES));
    expect(first).toContain("!= 'verify'");
    expect(first).toContain("IFNULL(JSON_VALUE(json_payload.tester), '') != 'true'");
    expect(first).toContain("IFNULL(JSON_VALUE(json_payload.verify), '') != 'true'");
    expect(first).toContain("NOT LIKE '%SwiftShader%'");
    expect(first).toContain("JSON_VALUE(json_payload.n) = 'cmd'");
    for (const name of QUERY_NAMES) expect(block(readQuery(name, QUERIES)), `${name}.sql's exclusion differs`).toBe(first);
  });

  it("scope a range to New York calendar days, so one day is today there", () => {
    for (const name of QUERY_NAMES) {
      expect(readQuery(name, QUERIES)).toContain("TIMESTAMP(DATE_SUB(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), INTERVAL");
    }
  });

  it("take the range line's days whatever the file reads when pasted", () => {
    const seven = forBigQuery("INTERVAL 7 DAY), 'America/New_York') -- range", "p", "d");
    const twelveWeeks = forBigQuery("INTERVAL 84 DAY), 'America/New_York') -- range", "p", "d");
    expect(seven.sql).toBe("INTERVAL @days DAY), 'America/New_York')");
    expect(twelveWeeks.sql).toBe("INTERVAL @days DAY), 'America/New_York')");
    expect(twelveWeeks.params).toEqual(["days"]);
    // The kpis query reads twelve weeks when pasted, the length of its trends.
    expect(readQuery("kpis", QUERIES)).toContain("INTERVAL 84 DAY), 'America/New_York') -- range");
  });
});

describe("plain", () => {
  it("unwraps BigQuery's typed values", () => {
    expect(plain({ value: "2026-10-12T00:00:00.000Z" })).toBe("2026-10-12T00:00:00.000Z");
    expect(plain({ value: 7 })).toBe(7);
    expect(plain([1, { value: "x" }, null])).toEqual([1, "x", null]);
    expect(plain({ a: { value: 1 }, b: "s" })).toEqual({ a: 1, b: "s" });
    expect(plain(undefined)).toBeNull();
  });
});

describe("the admin routes", () => {
  let server: SignalingServer;
  let base: string;
  const live: LiveView = { at: 1, instances: [{ id: "i1", seenAt: 1 }], rooms: [{ id: "r1", hostId: "h", createdAt: 0, hostDroppedAt: null, peers: 2 }] };
  const asked: string[] = [];
  const kpis = shapeKpis([{ kind: "window", period: "current", week_start: null, sessions: 3, matches: 2, ended: 2, clean: 2, erred: 0 }], 1, Date.UTC(2026, 9, 12));
  const data: AdminData = {
    live: () => Promise.resolve(live),
    query: (name, days) => {
      asked.push(`${name}:${days}`);
      return Promise.resolve([{ build: "abc", n: 1 }]);
    },
    lookup: (name, id) => {
      asked.push(`${name}:${id}`);
      return Promise.resolve([{ n: "page", t: 0 }]);
    },
    kpis: () => {
      asked.push("kpis");
      return Promise.resolve(kpis);
    },
  };

  beforeAll(async () => {
    server = createSignalingServer(0, {
      role: "all",
      log: () => undefined,
      admin: { auth: createAdminAuth({ projectId: AUTH_PROJECT, allowed: ["me@example.com"], keys: createLocalJWKSet({ keys: [jwk] }) }), data },
      postLimits: { capacity: 100, refillPerSecond: 100 },
    });
    await new Promise<void>((resolve) => server.http.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await server.close();
  });

  const get = async (path: string, auth?: string, origin = ORIGIN) =>
    fetch(`${base}${path}`, { headers: { origin, ...(auth === undefined ? {} : { authorization: auth }) } });

  it("answers the signed-in account with JSON and CORS for the admin host", async () => {
    const bearer = `Bearer ${await token({ email: "me@example.com" })}`;
    const liveRes = await get("/admin/live", bearer);
    expect(liveRes.status).toBe(200);
    expect(liveRes.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(await liveRes.json()).toEqual(live);
    const q = await get("/admin/query/funnel?days=30", bearer);
    expect(await q.json()).toEqual({ rows: [{ build: "abc", n: 1 }] });
    const bad = await get("/admin/query/errors?days=12", bearer);
    expect(bad.status).toBe(200);
    const s = await get("/admin/session/s-1", bearer);
    expect(await s.json()).toEqual({ rows: [{ n: "page", t: 0 }] });
    const v = await get("/admin/visitor/v-1", bearer);
    expect(await v.json()).toEqual({ rows: [{ n: "page", t: 0 }] });
    const m = await get("/admin/match/g-1", bearer);
    expect(await m.json()).toEqual({ rows: [{ n: "page", t: 0 }] });
    const k = await get("/admin/kpis", bearer);
    expect(k.status).toBe(200);
    expect(await k.json()).toEqual(kpis);
    expect(asked).toEqual(["funnel:30", "errors:7", "session:s-1", "visitor:v-1", "match:g-1", "kpis"]);
  });

  it("answers the shell's local preview too, with its own origin echoed", async () => {
    const res = await get("/admin/live", `Bearer ${await token({ email: "me@example.com" })}`, "http://localhost:8788");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:8788");
  });

  it("refuses without a token, with a stranger's, from another origin, and names what does not exist", async () => {
    expect((await get("/admin/live")).status).toBe(401);
    expect((await get("/admin/kpis")).status).toBe(401);
    expect((await get("/admin/live", `Bearer ${await token({ email: "x@example.com" })}`)).status).toBe(401);
    const stranger = await fetch(`${base}/admin/live`, { headers: { origin: "https://evil.example" } });
    expect(stranger.status).toBe(403);
    const bearer = `Bearer ${await token({ email: "me@example.com" })}`;
    expect((await get("/admin/query/nope", bearer)).status).toBe(404);
    expect((await get("/admin/session/not%20ok", bearer)).status).toBe(404);
    expect((await get("/admin/visitor/not%20ok", bearer)).status).toBe(404);
    expect((await get("/admin/match/x%2Fy", bearer)).status).toBe(404);
    expect((await get("/admin/player/p-1", bearer)).status).toBe(404);
    expect((await get("/admin/other", bearer)).status).toBe(404);
  });

  it("answers the preflight the bearer token causes", async () => {
    const res = await fetch(`${base}/admin/live`, { method: "OPTIONS", headers: { origin: ORIGIN } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toBe("authorization");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("is not served without the option", async () => {
    const bare = createSignalingServer(0, { role: "all", log: () => undefined });
    await new Promise<void>((resolve) => bare.http.once("listening", () => resolve()));
    try {
      const res = await fetch(`http://127.0.0.1:${(bare.http.address() as AddressInfo).port}/admin/live`);
      expect(res.status).toBe(404);
    } finally {
      await bare.close();
    }
  });
});
