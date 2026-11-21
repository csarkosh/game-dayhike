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
      // places.sql reads csarko.sh's analytics instead, where the game's pages report their visits.
      expect(sql).toContain(name === 'places.sql' ? '`csarko-sh.csarko_visits._AllLogs`' : '`fps-csarko.global.dayhike-telemetry._AllLogs`');
      if (sql.includes("= 'telemetry'")) expect(sql).toContain("!= 'verify'");
    });
  }
});

// ---- who the two exclusions read ---------------------------------------------------
// No engine runs the files here, so the rows each CTE reads are worked out from its own
// text: its WHERE is a run of conditions of five forms, each read by a pattern below and
// applied to a row as BigQuery applies it. A condition of any other form throws, so a
// CTE rewritten in another shape fails here until this reader knows it.

/** The body of the CTE named `name`, from its `(` to its closing line. */
function cte(sql, name) {
  const from = sql.indexOf(`${name} AS (\n`);
  if (from < 0) return null;
  return sql.slice(from + `${name} AS (\n`.length, sql.indexOf('\n),\n', from));
}

/** The sessions of the stills shoot, as every exclusion asks for them. */
const SHOOT = `IFNULL(JSON_VALUE(json_payload.sid), '') NOT IN (
      SELECT DISTINCT JSON_VALUE(json_payload.sid)
      FROM \`fps-csarko.global.dayhike-telemetry._AllLogs\`
      WHERE JSON_VALUE(json_payload.n) = 'cmd'
        AND JSON_VALUE(json_payload.sid) IS NOT NULL
        AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
    )`;

/** Whether the CTE `body` reads `row`, among `all` the table's rows. */
function reads(body, row, all) {
  const where = body.slice(body.indexOf('  WHERE ') + '  WHERE '.length);
  const shot = new Set(all.filter((r) => r.n === 'cmd' && r.sid != null).map((r) => r.sid));
  const of = (field) => (row[field] == null ? null : String(row[field]));
  return where.replace(SHOOT, 'NOT IN SHOOT').split('\n    AND ').every((condition) => {
    let m;
    if (condition === 'NOT IN SHOOT') return !shot.has(of('sid') ?? '');
    if ((m = /^IFNULL\(JSON_VALUE\(json_payload\.(\w+)\), ''\) != '([^'%]*)'$/.exec(condition))) return (of(m[1]) ?? '') !== m[2];
    if ((m = /^IFNULL\(JSON_VALUE\(json_payload\.(\w+)\), ''\) NOT LIKE '%([^'%]*)%'$/.exec(condition))) return !(of(m[1]) ?? '').includes(m[2]);
    if ((m = /^IFNULL\(JSON_VALUE\(json_payload\.(\w+)\), ''\) LIKE '%([^'%]*)%'$/.exec(condition))) return (of(m[1]) ?? '').includes(m[2]);
    if ((m = /^JSON_VALUE\(json_payload\.(\w+)\) = '([^'%]*)'$/.exec(condition))) return of(m[1]) === m[2];
    throw new Error(`a condition this reader does not know: ${condition}`);
  });
}

describe('the rows the funnel and the errors list read', () => {
  const sql = Object.fromEntries(queries.map((name) => [name, readFileSync(`${dir}${name}`, 'utf8')]));
  const real = cte(sql['funnel.sql'], 'real');
  const away = cte(sql['funnel.sql'], 'software_away');

  const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const HEADLESS = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36';
  const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
  const NVIDIA = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const row = (sid, n, more = {}) => ({ svc: 'telemetry', build: '9557492d', sid, n, ua: CHROME, gpu: NVIDIA, ...more });
  /** One session each: what a page sends of itself, then the load check's row where it turned the visitor away. */
  const table = [
    // A person with hardware acceleration off: the browser draws on SwiftShader, and says so on every row.
    row('person', 'page', { gpu: SWIFTSHADER }),
    row('person', 'turned_away', { gpu: SWIFTSHADER, reason: 'software' }),
    // The same, by a browser a driver steers.
    row('webdriver', 'page', { gpu: SWIFTSHADER, wd: true }),
    row('webdriver', 'turned_away', { gpu: SWIFTSHADER, wd: true, reason: 'software' }),
    // The same, by a headless Chrome.
    row('headless', 'page', { gpu: SWIFTSHADER, ua: HEADLESS }),
    row('headless', 'turned_away', { gpu: SWIFTSHADER, ua: HEADLESS, reason: 'software' }),
    // A browser with no WebGPU on a real graphics card.
    row('old-browser', 'page'),
    row('old-browser', 'turned_away', { reason: 'no-webgpu' }),
    // A player.
    row('player', 'page'),
    row('player', 'play'),
    // Those every exclusion leaves out, each on SwiftShader and turned away.
    row('tester', 'turned_away', { gpu: SWIFTSHADER, tester: 'true', owner: 'true' }),
    row('verification', 'turned_away', { gpu: SWIFTSHADER, build: 'verify' }),
    row('verification-room', 'turned_away', { gpu: SWIFTSHADER, verify: true }),
    row('shoot', 'cmd', { gpu: SWIFTSHADER }),
    row('shoot', 'turned_away', { gpu: SWIFTSHADER }),
  ];
  const read = (body) => table.filter((r) => reads(body, r, table)).map((r) => `${r.sid} ${r.n}`);

  it('finds both exclusions where the two queries keep them, and this reader knows every condition of each', () => {
    expect(real).not.toBeNull();
    expect(away).not.toBeNull();
    expect(real.split('\n    AND ').length).toBe(7);
    expect(away.split('\n    AND ').length).toBe(8);
    expect(() => reads('  WHERE JSON_VALUE(json_payload.n) IN (\'a\')', table[0], table)).toThrow('a condition this reader does not know');
  });

  it('counts a person with hardware acceleration off, by the row that says they were turned away', () => {
    // `real` drops every row of theirs for the GPU's name, as before.
    expect(read(real).filter((r) => r.startsWith('person'))).toEqual([]);
    // The one row that comes back, and no other of the session.
    expect(read(away)).toEqual(['person turned_away']);
  });

  it('does not count a browser a driver steers', () => {
    expect([...read(real), ...read(away)].filter((r) => r.startsWith('webdriver'))).toEqual([]);
    // `wd` is the page's navigator.webdriver, a JSON true: read as the word.
    expect(reads(away, row('x', 'turned_away', { gpu: SWIFTSHADER, wd: false }), table)).toBe(true);
    expect(reads(away, row('x', 'turned_away', { gpu: SWIFTSHADER, wd: 'true' }), table)).toBe(false);
  });

  it('does not count a headless Chrome', () => {
    expect([...read(real), ...read(away)].filter((r) => r.startsWith('headless'))).toEqual([]);
  });

  it('reads everyone else as before, and no row twice', () => {
    expect(read(real)).toEqual(['old-browser page', 'old-browser turned_away', 'player page', 'player play']);
    for (const r of table) expect(reads(real, r, table) && reads(away, r, table), `${r.sid} ${r.n}`).toBe(false);
    // The testers, the verification and the stills shoot stay out, on SwiftShader or not.
    for (const sid of ['tester', 'verification', 'verification-room', 'shoot']) {
      expect([...read(real), ...read(away)].filter((r) => r.startsWith(sid)), sid).toEqual([]);
    }
    // Only a `turned_away` row comes back: a hike's rows from a SwiftShader browser are an automated browser's.
    for (const n of ['page', 'play', 'match_start', 'error', 'load', 'end']) expect(reads(away, row('x', n, { gpu: SWIFTSHADER }), table), n).toBe(false);
  });

  it('keeps that exclusion as the same text in the two queries, and in no other', () => {
    expect(cte(sql['errors.sql'], 'software_away')).toBe(away);
    for (const name of queries) expect(sql[name].includes('software_away'), name).toBe(name === 'funnel.sql' || name === 'errors.sql');
    // `real` is one text wherever a query has it, and still drops the name.
    for (const name of queries) {
      const own = cte(sql[name], 'real');
      if (own !== null) expect(own, name).toBe(real);
    }
    expect(real).toContain("IFNULL(JSON_VALUE(json_payload.gpu), '') NOT LIKE '%SwiftShader%'");
    expect(readme).toContain('`software_away`');
  });

  it('has the funnel count such a session as landed and turned away, and the errors list it among the players', () => {
    const funnel = sql['funnel.sql'];
    expect(funnel).toContain('play AS (\n  SELECT timestamp, json_payload FROM real\n  UNION ALL\n  SELECT timestamp, json_payload FROM software_away\n),');
    expect(funnel).toMatch(/events AS \(\n(?:.*\n){5}  FROM play\n/);
    expect(funnel).not.toMatch(/\bFROM real\n  WHERE/);
    // The session has no `page` row among those read: its `turned_away` row says it landed.
    expect(funnel).toContain("    LOGICAL_OR(n IN ('page', 'turned_away')) AS landed,\n    LOGICAL_OR(n = 'turned_away') AS turned,");
    expect(funnel).toContain('    landed AND turned AS turned_away,');
    const errors = sql['errors.sql'];
    expect(errors).toContain("  SELECT timestamp, json_payload, 'players' AS whose FROM real\n  UNION ALL\n  SELECT timestamp, json_payload, 'players' AS whose FROM software_away\n  UNION ALL\n  SELECT timestamp, json_payload, 'you' AS whose FROM owner\n");
    expect(errors).toContain("IF(JSON_VALUE(json_payload.n) = 'turned_away', JSON_VALUE(json_payload.reason), JSON_VALUE(json_payload.kind)) AS kind,");
    // An owner's row is a tester's, so it is never read twice, as a player's and as the owner's.
    expect(reads(away, row('owner', 'turned_away', { gpu: SWIFTSHADER, tester: 'true', owner: 'true' }), table)).toBe(false);
  });
});
