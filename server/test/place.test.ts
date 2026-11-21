import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { AddressInfo } from "node:net";
import { createSignalingServer, type SignalingServer } from "../src/server.js";
import { createPlacer, PlacedSessions, placeOf, type Placer } from "../src/place.js";
import { TELEMETRY_PATH } from "../src/telemetry.js";
import type { LogRow } from "../src/log.js";

describe("placeOf", () => {
  it("keeps the country, region and city where each is a short string, and nothing else", () => {
    expect(placeOf({ cc: "US", rg: "Washington", ct: "Seattle", ip: "203.0.113.9" })).toEqual({ cc: "US", rg: "Washington", ct: "Seattle" });
    expect(placeOf({ cc: "US", ct: 4, rg: "x".repeat(65) })).toEqual({ cc: "US" });
    expect(placeOf({ cc: "GB", ct: "London", la: 51.51, lo: -0.13 })).toEqual({ cc: "GB", ct: "London", la: 51.5, lo: -0.1 });
    expect(placeOf({ cc: "GB", la: 91, lo: 0 })).toEqual({ cc: "GB" });
    expect(placeOf({})).toBeNull();
    expect(placeOf(null)).toBeNull();
  });
});

describe("createPlacer", () => {
  it("posts the address with the token and reads the place", async () => {
    const asked: { url: string; init: RequestInit }[] = [];
    const placer = createPlacer({
      url: "https://visits.example/place",
      token: "t0k",
      fetch: (async (url: string, init: RequestInit) => {
        asked.push({ url, init });
        return new Response(JSON.stringify({ cc: "US", rg: "Illinois", ct: "Chicago" }), { status: 200 });
      }) as typeof fetch,
    });
    expect(await placer("24.24.24.24")).toEqual({ cc: "US", rg: "Illinois", ct: "Chicago" });
    expect(asked[0]?.url).toBe("https://visits.example/place");
    expect(asked[0]?.init.body).toBe("24.24.24.24");
    expect((asked[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer t0k");
  });

  it("places nothing when the collector refuses or fails", async () => {
    const refused = createPlacer({ url: "u", token: "t", fetch: (async () => new Response("no", { status: 401 })) as typeof fetch });
    const failed = createPlacer({ url: "u", token: "t", fetch: (async () => { throw new Error("down"); }) as typeof fetch });
    expect(await refused("1.2.3.4")).toBeNull();
    expect(await failed("1.2.3.4")).toBeNull();
  });
});

describe("PlacedSessions", () => {
  it("says first once a session, and forgets the oldest past its capacity", () => {
    const seen = new PlacedSessions(2);
    expect([seen.first("a"), seen.first("a"), seen.first("b"), seen.first("c"), seen.first("a")]).toEqual([true, false, true, true, true]);
  });
});

describe("the telemetry route's geo row", () => {
  let server: SignalingServer;
  let base: string;
  const rows: LogRow[] = [];
  const asked: string[] = [];
  const placer: Placer = async (ip) => {
    asked.push(ip);
    return { cc: "US", rg: "Washington", ct: "Port Angeles" };
  };

  beforeAll(async () => {
    server = createSignalingServer(0, { role: "telemetry", log: (r) => rows.push(r), serverBuild: "srv1", placer });
    await new Promise<void>((resolve) => server.http.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await server.close();
  });

  const post = (sid: string) =>
    fetch(`${base}${TELEMETRY_PATH}`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-forwarded-for": "198.51.100.7" },
      body: JSON.stringify({ v: 1, sid, vid: "v1", build: "abc1234", gpu: "Apple M2", events: [{ n: "page", t: 1 }] }),
    });

  it("follows a session's first batch with one place row, its envelope and place, and no address", async () => {
    expect((await post("s-place")).status).toBe(204);
    expect((await post("s-place")).status).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const places = rows.filter((r) => r.n === "geo");
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ sid: "s-place", vid: "v1", build: "abc1234", gpu: "Apple M2", cc: "US", rg: "Washington", ct: "Port Angeles", svc: "telemetry", dh: 1 });
    expect(JSON.stringify(places[0])).not.toContain("198.51.100.7");
    expect(asked).toEqual(["198.51.100.7"]);
  });
});
