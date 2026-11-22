import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Day Hike's server is the engine's (`@csarkosh/engine-server`), run from its release. What is
// Day Hike's is its settings file, `server/game.json`, its saved queries and the image that runs
// the package; this holds each to its value, and to what the installed package expects of it.
import { parseGameSettings } from '../../../node_modules/@csarkosh/engine-server/dist/gameSettings.js';
import {
  forBigQuery,
  LOOKUP_NAMES,
  NOW_QUERY,
  OTHER_SOURCE_QUERIES,
  QUERY_NAMES,
  readQuery,
} from '../../../node_modules/@csarkosh/engine-server/dist/adminQueries.js';

const path = (relative) => fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
const SETTINGS_PATH = path('server/game.json');
const SETTINGS_TEXT = readFileSync(SETTINGS_PATH, 'utf8');
const QUERIES = path('tools/telemetry/queries/');
const DOCKERFILE = readFileSync(path('server/Dockerfile'), 'utf8');

describe("Day Hike's server settings (server/game.json)", () => {
  it('holds the app, dataset, bucket, the eight origins in order and the queries folder', () => {
    expect(JSON.parse(SETTINGS_TEXT)).toEqual({
      app: 'game-dayhike',
      telemetryDataset: 'dayhike_telemetry',
      telemetryBucket: 'dayhike-telemetry',
      allowedOrigins: [
        'https://games.csarko.sh',
        'https://game.csarko.sh',
        'https://fps-csarko.web.app',
        'https://fps-csarko.firebaseapp.com',
        'http://localhost:5173',
        'https://localhost:5173',
        'https://admin.csarko.sh',
        'http://localhost:8788',
      ],
      queries: '../tools/telemetry/queries',
    });
  });

  it("is accepted by the installed server's own parser", () => {
    const settings = parseGameSettings(SETTINGS_TEXT, SETTINGS_PATH);
    expect(settings.app).toBe('game-dayhike');
    expect(settings.allowedOrigins).toHaveLength(8);
    expect(settings.queries).toBe('../tools/telemetry/queries');
  });

  it("names a queries folder that holds a file for every query the installed server asks for", () => {
    const { queries } = JSON.parse(SETTINGS_TEXT);
    // Relative to the folder holding the settings file, as the server reads it.
    const folder = resolve(dirname(SETTINGS_PATH), queries);
    expect(existsSync(folder), folder).toBe(true);
    const files = readdirSync(folder).filter((name) => name.endsWith('.sql')).map((name) => name.slice(0, -4));
    const asked = [...QUERY_NAMES, ...LOOKUP_NAMES, NOW_QUERY];
    for (const name of asked) expect(files, `${name}.sql`).toContain(name);
    // The list the installed package's README gives is the list its code asks for.
    const readme = readFileSync(path('node_modules/@csarkosh/engine-server/README.md'), 'utf8');
    const listed = [...readme.match(/must include ([^.]*)\./s)[1].matchAll(/`(\w+)`/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...asked].sort());
  });
});

describe("the server's image (server/Dockerfile)", () => {
  it('copies the settings and the saved queries and runs the installed server', () => {
    expect(DOCKERFILE).toMatch(/^COPY server\/game\.json \.\/server\/game\.json$/m);
    expect(DOCKERFILE).toMatch(/^COPY tools\/telemetry\/queries \.\/tools\/telemetry\/queries$/m);
    expect(DOCKERFILE).toMatch(/^CMD \["node", "node_modules\/@csarkosh\/engine-server\/dist\/index\.js"\]$/m);
  });
});

// The saved queries are Day Hike's files, and the engine's server tests them only on its own copies
// of them; these read the real ones through the installed package's rewriting.
describe('the saved queries for BigQuery', () => {
  it('rename the table, parameterise the range and the zone, and turn each lookup placeholder into its parameter', () => {
    for (const name of QUERY_NAMES) {
      const out = forBigQuery(readQuery(name, QUERIES), 'fps-csarko', 'dayhike_telemetry', 'dayhike-telemetry');
      if (OTHER_SOURCE_QUERIES.includes(name)) expect(out.sql).toContain('`csarko-sh.csarko_visits._AllLogs`');
      else expect(out.sql).toContain('`fps-csarko.dayhike_telemetry._AllLogs`');
      expect(out.sql).not.toContain('global.dayhike-telemetry');
      expect(out.sql).toContain('INTERVAL @days DAY), @tz)');
      expect(out.sql).not.toContain('-- range');
      expect(out.sql, `${name}.sql keeps a New York date`).not.toContain('America/New_York');
      expect(out.params).toEqual(['days', 'tz']);
    }
    const placeholders = {
      session: ["'SID'", '@sid', 'sid'],
      visitor: ["'VID'", '@vid', 'vid'],
      match: ["'GAME'", '@game', 'game'],
    };
    for (const name of LOOKUP_NAMES) {
      const [literal, param, key] = placeholders[name];
      const out = forBigQuery(readQuery(name, QUERIES), 'fps-csarko', 'dayhike_telemetry', 'dayhike-telemetry');
      expect(out.sql).toContain(`= ${param}`);
      expect(out.sql).not.toContain(literal);
      expect(out.sql).not.toContain('global.dayhike-telemetry');
      expect(out.params).toEqual([key]);
    }
  });

  it('share one exclusion, the same text in every query over a range', () => {
    const block = (sql) => sql.slice(sql.indexOf('WITH real AS ('), sql.indexOf('\n),\n') + 4);
    const first = block(readQuery('funnel', QUERIES));
    expect(first).toContain("!= 'verify'");
    expect(first).toContain("IFNULL(JSON_VALUE(json_payload.tester), '') != 'true'");
    expect(first).toContain("IFNULL(JSON_VALUE(json_payload.verify), '') != 'true'");
    expect(first).toContain("NOT LIKE '%SwiftShader%'");
    expect(first).toContain("IFNULL(JSON_VALUE(json_payload.ua), '') NOT LIKE '%HeadlessChrome%'");
    expect(first).toContain("IFNULL(JSON_VALUE(json_payload.wd), '') != 'true'");
    expect(first).toContain("JSON_VALUE(json_payload.n) = 'cmd'");
    for (const name of QUERY_NAMES.filter((n) => !OTHER_SOURCE_QUERIES.includes(n))) {
      expect(block(readQuery(name, QUERIES)), `${name}.sql's exclusion differs`).toBe(first);
    }
  });

  it("are written in New York calendar days, so a pasted query's one day is today there", () => {
    for (const name of QUERY_NAMES) {
      expect(readQuery(name, QUERIES)).toContain(
        "TIMESTAMP(DATE_SUB(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), INTERVAL",
      );
    }
  });

  it('read twelve weeks for the kpis query, the length of its trends', () => {
    expect(readQuery('kpis', QUERIES)).toContain("INTERVAL 84 DAY), 'America/New_York') -- range");
  });
});
