import { describe, it, expect } from "vitest";
import { matchEnd } from "../../src/admin/views.js";

const NOW = Date.parse("2026-10-15T02:00:00Z");
const iso = (ms: number): string => new Date(ms).toISOString();

describe("matchEnd", () => {
  it("names the outcome, and a death at the end", () => {
    expect(matchEnd({ result: "won", self_at_end: "alive" }, NOW)).toEqual({ text: "won", tone: "won" });
    expect(matchEnd({ result: "lost", self_at_end: "dead", left_by: "match_end" }, NOW)).toEqual({ text: "lost, died", tone: "lost" });
  });

  it("names the way out when there was no outcome", () => {
    expect(matchEnd({ result: null, left_by: "end", last_seen: iso(NOW - 60_000) }, NOW)).toEqual({ text: "end", tone: "" });
  });

  it("calls a match still playing only while its heartbeat is recent", () => {
    expect(matchEnd({ result: null, left_by: null, last_seen: iso(NOW - 45_000) }, NOW)).toEqual({ text: "still playing", tone: "" });
  });

  it("calls a match that went quiet with no way out ended silently, however long ago it started", () => {
    expect(matchEnd({ result: null, left_by: null, last_seen: iso(NOW - 27 * 3_600_000) }, NOW)).toEqual({ text: "ended silently", tone: "warn" });
    expect(matchEnd({ result: null, left_by: null, last_seen: iso(NOW - 5 * 60_000) }, NOW)).toEqual({ text: "ended silently", tone: "warn" });
  });

  it("falls back on the start when a row has no last_seen", () => {
    expect(matchEnd({ result: null, left_by: null, started_at: iso(NOW - 3_600_000) }, NOW)).toEqual({ text: "ended silently", tone: "warn" });
  });
});
