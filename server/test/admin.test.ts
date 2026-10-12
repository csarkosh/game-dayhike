import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { createLocalJWKSet } from "jose";
import { createAdminAuth, parseAllowlist } from "../src/adminAuth.js";
import { forBigQuery, QUERY_NAMES, readQuery } from "../src/adminQueries.js";
import type { AdminData, LiveView } from "../src/admin.js";
import { plain } from "../src/adminData.js";
import { createSignalingServer, type SignalingServer } from "../src/server.js";

const PROJECT = "fps-test";
const ORIGIN = "https://games.csarko.sh";
const QUERIES = fileURLToPath(new URL("../../tools/telemetry/queries/", import.meta.url));

let privateKey: CryptoKey;
let jwk: JWK;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
});

/** A Firebase Auth ID token as Google would sign it, with the claims given. */
async function token(claims: Record<string, unknown>, options: { iss?: string; aud?: string; expired?: boolean } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email_verified: true, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(options.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(options.aud ?? PROJECT)
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
  const auth = () => createAdminAuth({ projectId: PROJECT, allowed: ["me@example.com"], keys: createLocalJWKSet({ keys: [jwk] }) });

  it("admits a verified account on the list", async () => {
    expect(await auth().verify(`Bearer ${await token({ email: "Me@Example.com" })}`)).toEqual({ email: "me@example.com" });
  });

  it("refuses everyone else: not listed, unverified, wrong project, expired, malformed, absent", async () => {
    const a = auth();
    expect(await a.verify(`Bearer ${await token({ email: "other@example.com" })}`)).toBeNull();
    expect(await a.verify(`Bearer ${await token({ email: "me@example.com", email_verified: false })}`)).toBeNull();
    expect(await a.verify(`Bearer ${await token({ email: "me@example.com" }, { aud: "another" })}`)).toBeNull();
    expect(await a.verify(`Bearer ${await token({ email: "me@example.com" }, { iss: "https://securetoken.google.com/another" })}`)).toBeNull();
    expect(await a.verify(`Bearer ${await token({ email: "me@example.com" }, { expired: true })}`)).toBeNull();
    expect(await a.verify("Bearer not.a.token")).toBeNull();
    expect(await a.verify("Basic abc")).toBeNull();
    expect(await a.verify(undefined)).toBeNull();
  });
});

describe("the saved queries for BigQuery", () => {
  it("rename the table, parameterise the range, and keep the session's placeholder for the session query", () => {
    for (const name of QUERY_NAMES) {
      const out = forBigQuery(readQuery(name, QUERIES), "fps-csarko", "dayhike_telemetry");
      expect(out.sql).toContain("`fps-csarko.dayhike_telemetry._AllLogs`");
      expect(out.sql).not.toContain("global.dayhike-telemetry");
      expect(out.sql).toContain("INTERVAL @days DAY");
      expect(out.params).toEqual(["days"]);
    }
    const session = forBigQuery(readQuery("session", QUERIES), "fps-csarko", "dayhike_telemetry");
    expect(session.sql).toContain("= @sid");
    expect(session.sql).not.toContain("'SID'");
    expect(session.params).toEqual(["sid"]);
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
  const data: AdminData = {
    live: () => Promise.resolve(live),
    query: (name, days) => {
      asked.push(`${name}:${days}`);
      return Promise.resolve([{ build: "abc", n: 1 }]);
    },
    session: (sid) => {
      asked.push(`session:${sid}`);
      return Promise.resolve([{ n: "page", t: 0 }]);
    },
  };

  beforeAll(async () => {
    server = createSignalingServer(0, {
      role: "all",
      log: () => undefined,
      admin: { auth: createAdminAuth({ projectId: PROJECT, allowed: ["me@example.com"], keys: createLocalJWKSet({ keys: [jwk] }) }), data },
      postLimits: { capacity: 100, refillPerSecond: 100 },
    });
    await new Promise<void>((resolve) => server.http.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await server.close();
  });

  const get = async (path: string, auth?: string) =>
    fetch(`${base}${path}`, { headers: { origin: ORIGIN, ...(auth === undefined ? {} : { authorization: auth }) } });

  it("answers the signed-in account with JSON and CORS", async () => {
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
    expect(asked).toEqual(["funnel:30", "errors:7", "session:s-1"]);
  });

  it("refuses without a token, with a stranger's, from another origin, and names what does not exist", async () => {
    expect((await get("/admin/live")).status).toBe(401);
    expect((await get("/admin/live", `Bearer ${await token({ email: "x@example.com" })}`)).status).toBe(401);
    const stranger = await fetch(`${base}/admin/live`, { headers: { origin: "https://evil.example" } });
    expect(stranger.status).toBe(403);
    const bearer = `Bearer ${await token({ email: "me@example.com" })}`;
    expect((await get("/admin/query/nope", bearer)).status).toBe(404);
    expect((await get("/admin/session/not%20ok", bearer)).status).toBe(404);
    expect((await get("/admin/other", bearer)).status).toBe(404);
  });

  it("answers the preflight the bearer token causes", async () => {
    const res = await fetch(`${base}/admin/live`, { method: "OPTIONS", headers: { origin: ORIGIN } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toBe("authorization");
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
