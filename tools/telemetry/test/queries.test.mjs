// The saved telemetry queries (tools/telemetry/queries/): each is listed in
// the README, names the bucket's view, and leaves the deploy's verification
// rows out where it reads the pages' rows.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../queries/', import.meta.url));
const queries = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
const readme = readFileSync(`${dir}README.md`, 'utf8');

describe('telemetry queries', () => {
  it('exist and are each listed in the README', () => {
    expect(queries.length).toBeGreaterThan(0);
    for (const name of queries) expect(readme, `${name} is not in the README`).toContain(`\`${name}\``);
  });

  for (const name of queries) {
    it(`${name} reads the bucket's view and explains itself`, () => {
      const sql = readFileSync(`${dir}${name}`, 'utf8');
      expect(sql.startsWith('--')).toBe(true);
      expect(sql).toContain('`fps-csarko.global.dayhike-telemetry._AllLogs`');
      if (sql.includes("= 'telemetry'")) expect(sql).toContain("!= 'verify'");
    });
  }
});
