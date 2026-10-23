import { describe, it, expect } from 'vitest';
import { CHECK_ZONE, checkQueries, forBigQuery, QUERIES_DIR, savedQueries } from '../lib/checkQueries.mjs';

describe('checkQueries', () => {
  it('rewrites each saved query as the server does, and reports the ones the engine refuses', async () => {
    const queries = savedQueries(QUERIES_DIR);
    expect(queries.map((q) => q.name)).toContain('session');
    const seen = [];
    const problems = await checkQueries(queries, 'p', 'd', async (sql, params) => {
      seen.push({ sql, params });
      if (sql.includes('WITH real AS')) return;
      throw new Error(`Syntax error at [1:1]`);
    });
    for (const { sql } of seen) {
      expect(sql).toContain('`p.d._AllLogs`');
      expect(sql).not.toContain('global.dayhike-telemetry');
      expect(sql).not.toContain('-- range');
      expect(sql).not.toContain('America/New_York');
      expect(sql).not.toContain("'SID'");
      expect(sql).not.toContain("'VID'");
      expect(sql).not.toContain("'GAME'");
    }
    expect(problems).toEqual(['match.sql: Syntax error at [1:1]', 'session.sql: Syntax error at [1:1]', 'visitor.sql: Syntax error at [1:1]']);
    // Every query over a range reads its days in the zone given, not New York.
    expect(seen.filter((q) => q.params.days !== undefined).every((q) => q.params.tz === CHECK_ZONE)).toBe(true);
  });

  it('names no reserved word as a table alias in any saved query', () => {
    for (const { name, sql } of savedQueries(QUERIES_DIR)) {
      expect(sql, `${name}.sql names a CTE "rows"`).not.toMatch(/\bWITH rows AS\b|\bFROM rows\b|,\s*rows AS \(/);
    }
  });

  it('turns every New York date into the zone parameter', () => {
    expect(forBigQuery("DATE(timestamp, 'America/New_York'), CURRENT_DATE('America/New_York')", 'p', 'd')).toEqual({ sql: 'DATE(timestamp, @tz), CURRENT_DATE(@tz)', params: { tz: CHECK_ZONE } });
  });

  it('keeps the session placeholder as a parameter', () => {
    expect(forBigQuery("WHERE x = 'SID' -- session", 'p', 'd')).toEqual({ sql: 'WHERE x = @sid', params: { sid: 'x' } });
  });

  it('takes the range line whatever days the file reads when pasted', () => {
    expect(forBigQuery("INTERVAL 7 DAY), 'America/New_York') -- range", 'p', 'd')).toEqual({ sql: 'INTERVAL @days DAY), @tz)', params: { days: 7, tz: CHECK_ZONE } });
    expect(forBigQuery("INTERVAL 84 DAY), 'America/New_York') -- range", 'p', 'd')).toEqual({ sql: 'INTERVAL @days DAY), @tz)', params: { days: 7, tz: CHECK_ZONE } });
    expect(savedQueries(QUERIES_DIR).map((q) => q.name)).toContain('kpis');
  });
});
