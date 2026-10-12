import { describe, it, expect } from 'vitest';
import { checkQueries, forBigQuery, QUERIES_DIR, savedQueries } from '../lib/checkQueries.mjs';

describe('checkQueries', () => {
  it('rewrites each saved query as the server does, and reports the ones the engine refuses', async () => {
    const queries = savedQueries(QUERIES_DIR);
    expect(queries.map((q) => q.name)).toContain('session');
    const seen = [];
    const problems = await checkQueries(queries, 'p', 'd', async (sql, params) => {
      seen.push({ sql, params });
      if (sql.includes('WITH events AS')) return;
      throw new Error(`Syntax error at [1:1]`);
    });
    for (const { sql } of seen) {
      expect(sql).toContain('`p.d._AllLogs`');
      expect(sql).not.toContain('global.dayhike-telemetry');
      expect(sql).not.toContain('-- range');
      expect(sql).not.toContain("'SID'");
    }
    expect(problems).toEqual(['lobbies.sql: Syntax error at [1:1]', 'paths.sql: Syntax error at [1:1]', 'session.sql: Syntax error at [1:1]']);
  });

  it('names no reserved word as a table alias in any saved query', () => {
    for (const { name, sql } of savedQueries(QUERIES_DIR)) {
      expect(sql, `${name}.sql names a CTE "rows"`).not.toMatch(/\bWITH rows AS\b|\bFROM rows\b|,\s*rows AS \(/);
    }
  });

  it('keeps the session placeholder as a parameter', () => {
    expect(forBigQuery("WHERE x = 'SID' -- session", 'p', 'd')).toEqual({ sql: 'WHERE x = @sid', params: { sid: 'x' } });
  });
});
