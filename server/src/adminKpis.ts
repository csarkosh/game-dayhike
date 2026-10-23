/**
 * The index card (`GET /admin/kpis`): what the shared admin host's front page
 * shows of this app beside every other app's card, in the shape its contract
 * asks for (csarko.sh, `docs/superpowers/specs/2026-10-12-admin-dashboard-design.md`
 * §2.3): four numbers, each with the week before it and a sparkline of weekly
 * values, and one health reading.
 *
 *   sessions   sessions with a `page` row, the last 7 calendar days against
 *              the 7 before
 *   matches    matches (a distinct game with a host's `match_start`), the
 *              same two windows
 *   clean      of the sessions that said goodbye (an `end` row), the share whose
 *              `trouble` was 0, as a percentage
 *   lobbies    rooms open now, from the live view; no history, so no trend
 *
 * The numbers come from one saved query (`tools/telemetry/queries/kpis.sql`),
 * which answers one row a period: an ISO week, by the day a session started,
 * the two seven-day windows, and the whole range (which the admin page's
 * Visitors card reads, with the visitor counts the rows also carry; the card
 * does not show them). Every day and week is the caller's zone's (the
 * route's `tz`, New York's when it names none), the query's and this
 * module's alike. This module only shapes those rows, so it is pure over
 * them, the clock and the zone, and tested with rows made in the test.
 */

import type { Row } from "./admin.js";
import { QUERY_ZONE } from "./adminQueries.js";

/** How many weekly values a trend holds, and so how many weeks the query reads. */
export const KPI_WEEKS = 12;

/** Above this share of sessions with an error, a doubling week over week reads as critical rather than a warning. */
const CRITICAL_SHARE = 0.05;

export type Kpi = {
  key: "sessions" | "matches" | "clean" | "lobbies";
  label: string;
  /** Null where there is nothing to measure yet (no session ended, so no clean share). */
  value: number | null;
  /** The value for the window before, or null where the measure has no history. */
  prev: number | null;
  unit: "" | "%";
  /** Weekly values, oldest first, one a week for `KPI_WEEKS` weeks; empty where the measure has no history. */
  trend: number[];
};

export type Health = {
  status: "good" | "warning" | "critical";
  note: string;
};

export type Kpis = {
  app: "game-dayhike";
  /** When the numbers were read, ISO 8601. */
  at: string;
  kpis: Kpi[];
  health: Health;
};

/** One period's counts, as the query answers them. */
type Period = { sessions: number; matches: number; ended: number; clean: number; erred: number };

const EMPTY: Period = { sessions: 0, matches: 0, ended: 0, clean: 0, erred: 0 };
const DAY_MS = 86_400_000;

function count(row: Row, key: string): number {
  const v = row[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "") return Number(v);
  return 0;
}

function periodOf(row: Row): Period {
  return { sessions: count(row, "sessions"), matches: count(row, "matches"), ended: count(row, "ended"), clean: count(row, "clean"), erred: count(row, "erred") };
}

/** A percentage to one decimal, or null where there is nothing to divide by. */
function percent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** Each zone's date format, made once a zone. */
const DATE_FORMATS = new Map<string, Intl.DateTimeFormat>();
/** The calendar date of a moment in a zone, as `[year, month, day]`, read the way the query labels its weeks. */
function zoneDate(ms: number, zone: string): [number, number, number] {
  let format = DATE_FORMATS.get(zone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" });
    DATE_FORMATS.set(zone, format);
  }
  const parts = format.formatToParts(new Date(ms));
  const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return [part("year"), part("month"), part("day")];
}

/** The Mondays of the last `weeks` ISO weeks by `zone`'s dates, oldest first, the current week last, as `YYYY-MM-DD`. */
export function weekStarts(nowMs: number, weeks: number = KPI_WEEKS, zone: string = QUERY_ZONE): string[] {
  const [year, month, day] = zoneDate(nowMs, zone);
  // The date's weekday is a property of the date, so the arithmetic runs on a
  // UTC midnight of that date. JavaScript counts Sunday as 0; an ISO week
  // starts on Monday.
  const today = Date.UTC(year, month - 1, day);
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const monday = today - sinceMonday * DAY_MS;
  return Array.from({ length: weeks }, (_, i) => new Date(monday - (weeks - 1 - i) * 7 * DAY_MS).toISOString().slice(0, 10));
}

/**
 * The health reading, from the share of sessions that hit an error this
 * window against the window before: critical when it more than doubled and
 * is past `CRITICAL_SHARE`, a warning when it merely rose, good otherwise.
 * The note carries the numbers, so the card can be read without the page.
 */
export function healthOf(current: Period, previous: Period): Health {
  const share = current.sessions > 0 ? current.erred / current.sessions : 0;
  const before = previous.sessions > 0 ? previous.erred / previous.sessions : 0;
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const note = `${current.erred} of ${current.sessions} sessions hit an error in the last 7 days (${pct(share)}), ${previous.erred} of ${previous.sessions} the week before (${pct(before)}).`;
  if (share > before * 2 && share > CRITICAL_SHARE) return { status: "critical", note };
  if (share > before) return { status: "warning", note };
  return { status: "good", note };
}

/**
 * The card, from the query's rows, the lobbies open now, the clock and the
 * zone the query read its weeks in. A week the rows do not name had nothing
 * in it and reads as zero, so a trend is always `KPI_WEEKS` long and in order
 * whatever the rows' order.
 */
export function shapeKpis(rows: readonly Row[], lobbies: number, nowMs: number, zone: string = QUERY_ZONE): Kpis {
  const weeks = new Map<string, Period>();
  let current = EMPTY;
  let previous = EMPTY;
  for (const row of rows) {
    if (row.kind === "week" && typeof row.week_start === "string") weeks.set(row.week_start, periodOf(row));
    else if (row.kind === "window" && row.period === "current") current = periodOf(row);
    else if (row.kind === "window" && row.period === "previous") previous = periodOf(row);
  }
  const trend = weekStarts(nowMs, KPI_WEEKS, zone).map((start) => weeks.get(start) ?? EMPTY);
  return {
    app: "game-dayhike",
    at: new Date(nowMs).toISOString(),
    kpis: [
      { key: "sessions", label: "Sessions, 7 days", value: current.sessions, prev: previous.sessions, unit: "", trend: trend.map((w) => w.sessions) },
      { key: "matches", label: "Matches started, 7 days", value: current.matches, prev: previous.matches, unit: "", trend: trend.map((w) => w.matches) },
      // A week in which no session ended has no share; the sparkline needs a
      // number, so it draws that week as zero.
      { key: "clean", label: "Clean sessions", value: percent(current.clean, current.ended), prev: percent(previous.clean, previous.ended), unit: "%", trend: trend.map((w) => percent(w.clean, w.ended) ?? 0) },
      { key: "lobbies", label: "Lobbies open now", value: lobbies, prev: null, unit: "", trend: [] },
    ],
    health: healthOf(current, previous),
  };
}
