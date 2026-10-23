import { afterEach, describe, it, expect, vi } from "vitest";

// The host's token module (`/auth.js`) is the browser's to resolve; here the
// request is recorded instead of sent.
const asked: string[] = [];
vi.mock("../../src/admin/auth.js", () => ({
  fetchWithAuth: (url: string) => {
    asked.push(url);
    return Promise.resolve(new Response(JSON.stringify({ rows: [], at: 0, instances: [] }), { status: 200 }));
  },
}));

const { remoteSource, zonedPath } = await import("../../src/admin/source.js");
const { browserZone, useZone } = await import("../../src/admin/timeline.js");

describe("the admin routes' source", () => {
  afterEach(() => {
    useZone(browserZone());
    asked.length = 0;
  });

  it("names the viewer's zone on every request, so every day a query reads is theirs", async () => {
    useZone("America/Los_Angeles");
    const source = remoteSource("https://telemetry.example");
    await source.query("lobbies", 1);
    await source.live();
    await source.session("s-1");
    await source.visitor("v-1");
    await source.match("g-1");
    expect(asked).toEqual([
      "https://telemetry.example/admin/query/lobbies?days=1&tz=America%2FLos_Angeles",
      "https://telemetry.example/admin/live?tz=America%2FLos_Angeles",
      "https://telemetry.example/admin/session/s-1?tz=America%2FLos_Angeles",
      "https://telemetry.example/admin/visitor/v-1?tz=America%2FLos_Angeles",
      "https://telemetry.example/admin/match/g-1?tz=America%2FLos_Angeles",
    ]);
  });

  it("adds the zone to an address with or without a query string", () => {
    expect(zonedPath("/admin/kpis", "Asia/Tokyo")).toBe("/admin/kpis?tz=Asia%2FTokyo");
    expect(zonedPath("/admin/query/funnel?days=7", "UTC")).toBe("/admin/query/funnel?days=7&tz=UTC");
  });
});
