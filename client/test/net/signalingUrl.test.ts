import { describe, it, expect } from "vitest";
import { signalingUrl } from "../../src/net/signalingUrl.js";

describe("signalingUrl", () => {
  it("prefers the configured override", () => {
    expect(
      signalingUrl(
        { VITE_SIGNALING_URL: "wss://fps-signaling-abc-uw.a.run.app/ws" },
        { protocol: "https:", host: "game.csarko.sh" },
      ),
    ).toBe("wss://fps-signaling-abc-uw.a.run.app/ws");
  });

  it("falls back to same-origin wss under https", () => {
    expect(signalingUrl({}, { protocol: "https:", host: "game.csarko.sh" })).toBe(
      "wss://game.csarko.sh/ws",
    );
  });

  it("falls back to same-origin ws under http, so dev keeps working", () => {
    expect(signalingUrl({}, { protocol: "http:", host: "localhost:5173" })).toBe(
      "ws://localhost:5173/ws",
    );
  });

  it("treats an empty override as unset", () => {
    // An unsubstituted build variable must not become new WebSocket("").
    expect(
      signalingUrl({ VITE_SIGNALING_URL: "" }, { protocol: "http:", host: "localhost:5173" }),
    ).toBe("ws://localhost:5173/ws");
  });
});
