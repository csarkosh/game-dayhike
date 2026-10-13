import { describe, it, expect } from "vitest";
import type { Row } from "../src/admin.js";
import { healthOf, KPI_WEEKS, shapeKpis, weekStarts } from "../src/adminKpis.js";

/** A Monday, 2026-10-12, at noon UTC: the current week is the one that starts that day. */
const NOW = Date.UTC(2026, 9, 12, 12);

const week = (week_start: string, sessions: number, matches: number, ended: number, clean: number, erred: number): Row => ({ kind: "week", period: "", week_start, sessions, matches, ended, clean, erred });
const window = (period: "current" | "previous", sessions: number, matches: number, ended: number, clean: number, erred: number): Row => ({ kind: "window", period, week_start: null, sessions, matches, ended, clean, erred });

describe("weekStarts", () => {
  it("names the Mondays of the last twelve ISO weeks, oldest first, the current week last", () => {
    const starts = weekStarts(NOW);
    expect(starts).toHaveLength(KPI_WEEKS);
    expect(starts.at(-1)).toBe("2026-10-12");
    expect(starts.at(-2)).toBe("2026-10-05");
    expect(starts[0]).toBe("2026-07-27");
  });

  it("finds the Monday from any day of the week, Sunday included", () => {
    expect(weekStarts(Date.UTC(2026, 9, 18, 23), 1)).toEqual(["2026-10-12"]);
    expect(weekStarts(Date.UTC(2026, 9, 14), 1)).toEqual(["2026-10-12"]);
    expect(weekStarts(Date.UTC(2026, 9, 19), 1)).toEqual(["2026-10-19"]);
  });
});

describe("healthOf", () => {
  const period = (sessions: number, erred: number) => ({ sessions, matches: 0, ended: 0, clean: 0, erred });

  it("is good when errors did not rise, a warning when they rose, critical when they more than doubled past five percent", () => {
    expect(healthOf(period(100, 2), period(100, 2)).status).toBe("good");
    expect(healthOf(period(100, 1), period(100, 2)).status).toBe("good");
    expect(healthOf(period(100, 3), period(100, 2)).status).toBe("warning");
    // Doubled, but still under five percent: a warning, not an alarm.
    expect(healthOf(period(100, 4), period(100, 1)).status).toBe("warning");
    expect(healthOf(period(100, 6), period(100, 2)).status).toBe("critical");
    // Nothing the week before and errors now is a rise from zero.
    expect(healthOf(period(20, 2), period(0, 0)).status).toBe("critical");
    expect(healthOf(period(0, 0), period(0, 0)).status).toBe("good");
  });

  it("puts the numbers in the note", () => {
    expect(healthOf(period(94, 3), period(88, 1)).note).toBe("3 of 94 sessions hit an error in the last 7 days (3.2%), 1 of 88 the week before (1.1%).");
  });
});

describe("shapeKpis", () => {
  it("lays the four numbers out in the card's shape, with trends in week order and zeros for weeks with nothing", () => {
    const rows: Row[] = [
      week("2026-10-12", 5, 3, 4, 3, 1),
      week("2026-09-28", 8, 6, 8, 8, 0),
      // Out of order and outside the twelve weeks: ignored.
      week("2026-10-05", 2, 1, 0, 0, 0),
      week("2025-01-06", 99, 99, 99, 99, 99),
      window("current", 7, 4, 4, 3, 1),
      window("previous", 9, 6, 8, 8, 0),
    ];
    const out = shapeKpis(rows, 2, NOW);
    expect(out.app).toBe("game-dayhike");
    expect(out.at).toBe("2026-10-12T12:00:00.000Z");
    const [sessions, matches, clean, lobbies] = out.kpis;
    expect(sessions).toEqual({ key: "sessions", label: "Sessions, 7 days", value: 7, prev: 9, unit: "", trend: [0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 2, 5] });
    expect(matches).toEqual({ key: "matches", label: "Matches started, 7 days", value: 4, prev: 6, unit: "", trend: [0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 1, 3] });
    expect(clean).toEqual({ key: "clean", label: "Clean sessions", value: 75, prev: 100, unit: "%", trend: [0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 75] });
    expect(lobbies).toEqual({ key: "lobbies", label: "Lobbies open now", value: 2, prev: null, unit: "", trend: [] });
    expect(out.health).toEqual({ status: "critical", note: "1 of 7 sessions hit an error in the last 7 days (14.3%), 0 of 9 the week before (0%)." });
  });

  it("reads counts BigQuery hands back as strings, and answers an empty range with zeros and no clean share", () => {
    const out = shapeKpis([window("current", "3" as unknown as number, "2" as unknown as number, "0" as unknown as number, "0" as unknown as number, "0" as unknown as number)], 0, NOW);
    expect(out.kpis[0]?.value).toBe(3);
    expect(out.kpis[1]?.value).toBe(2);
    expect(out.kpis[2]?.value).toBeNull();
    expect(out.kpis[2]?.prev).toBeNull();
    const empty = shapeKpis([], 0, NOW);
    expect(empty.kpis.map((k) => k.value)).toEqual([0, 0, null, 0]);
    expect(empty.kpis[0]?.trend).toEqual(new Array(KPI_WEEKS).fill(0));
    expect(empty.health.status).toBe("good");
  });
});
