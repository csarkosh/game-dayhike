import { describe, it, expect } from "vitest";
import { funnelLine, matchEnd } from "../../src/admin/views.js";

const NOW = Date.parse("2026-10-15T02:00:00Z");
const iso = (ms: number): string => new Date(ms).toISOString();

describe("matchEnd", () => {
  it("names the outcome, and a death at the end", () => {
    expect(matchEnd({ result: "won", died: null }, NOW)).toEqual({ text: "won", tone: "won" });
    expect(matchEnd({ result: "lost", died: true, left_by: "match_end" }, NOW)).toEqual({ text: "lost, died", tone: "lost" });
    expect(matchEnd({ result: "won", died: false }, NOW)).toEqual({ text: "won", tone: "won" });
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

describe("funnelLine", () => {
  it("says the sessions and the builds, and how many of those that landed were turned away", () => {
    expect(funnelLine({ build: "all", sessions: 191, landed: 181, turned_away: 6 }, 2)).toBe(
      "191 sessions on 2 builds, each stage of the one before; 6 of those that landed could not play here and were turned away; every build in the table",
    );
    expect(funnelLine({ build: "all", sessions: 1, landed: 1, turned_away: 0 }, 1)).toBe(
      "1 sessions on 1 build, each stage of the one before; 0 of those that landed could not play here and were turned away; every build in the table",
    );
    // BigQuery hands a count back as a string.
    expect(funnelLine({ build: "all", sessions: "40", landed: "38", turned_away: "3" }, 1)).toContain("; 3 of those that landed");
  });

  it("says nothing of the turned away where the query has no such column", () => {
    expect(funnelLine({ build: "all", sessions: 191, landed: 181 }, 2)).toBe("191 sessions on 2 builds, each stage of the one before; every build in the table");
  });
});
