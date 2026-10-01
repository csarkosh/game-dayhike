import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'vite';
import { timeLimit } from '../../../client/test/helpers/timeLimit.ts';
import { mapFile } from '../lib/files.mjs';
import { WGSL_MAP_ID, wgslMapPlugin } from '../lib/mapPlugin.mjs';

const TIERS = ['low', 'medium', 'high'];
/** A map of one entry, its text naming `tier`, so the three can be told apart. */
const mapOf = (tier) => `{"format":"dayhike-wgsl-map/2","salt":"s","lines":["@vertex fn ${tier}() {}"],"entries":{"aa":[0,1]}}`;

/**
 * A page shaped as the game's: an entry that is the WebGL2 bundle, and a
 * module it imports dynamically, as `main.ts` imports `gpuEngine.ts`, which
 * names the maps. Built with Vite and the plugin as the page's config builds
 * it, under the page's base. `maps` is each tier's text, or null for a map
 * not made.
 */
async function buildPage(maps) {
  const root = mkdtempSync(join(tmpdir(), 'dayhike-wgsl-page-'));
  writeFileSync(join(root, 'main.js'), 'globalThis.webgpu = () => import("./gpu.js");\nconsole.log("webgl2");\n');
  writeFileSync(join(root, 'gpu.js'), `import urls from "${WGSL_MAP_ID}";\nconsole.log(urls.low, urls.medium, urls.high);\n`);
  const mapDir = join(root, 'map');
  mkdirSync(mapDir);
  for (const tier of TIERS) if (maps[tier] !== null) writeFileSync(mapFile(mapDir, tier), maps[tier]);
  const saved = process.env.VITEST;
  // The plugin names no map under the suite; this build is the page's.
  delete process.env.VITEST;
  try {
    await build({
      root,
      base: '/dayhike/',
      configFile: false,
      logLevel: 'silent',
      plugins: [wgslMapPlugin({ mapDir, tool: 'unused' })],
      build: { outDir: join(root, 'dist'), minify: false, rolldownOptions: { input: join(root, 'main.js') } },
    });
  } finally {
    if (saved !== undefined) process.env.VITEST = saved;
  }
  const assets = join(root, 'dist', 'assets');
  const files = readdirSync(assets);
  const read = (name) => readFileSync(join(assets, name), 'utf8');
  return {
    files,
    main: read(files.find((name) => name.startsWith('main-'))),
    gpu: read(files.find((name) => name.startsWith('gpu-'))),
    read,
  };
}

/** The maps the build emitted, by tier: `wgsl-map-<tier>-<hash>.json`. */
const emitted = (page) =>
  Object.fromEntries(TIERS.map((tier) => [tier, page.files.filter((name) => new RegExp(`^wgsl-map-${tier}-[A-Za-z0-9_-]{8}\\.json$`).test(name))]));

describe("the maps in the page's build", () => {
  it('are three content-hashed assets, one a tier, that only the WebGPU chunk names; the WebGL2 bundle neither holds nor names them', async () => {
    const page = await buildPage({ low: mapOf('low'), medium: mapOf('medium'), high: mapOf('high') });
    const maps = emitted(page);
    for (const tier of TIERS) {
      expect(maps[tier], tier).toHaveLength(1);
      expect(page.read(maps[tier][0])).toBe(mapOf(tier));
      expect(page.gpu).toContain(`/dayhike/assets/${maps[tier][0]}`);
    }
    expect(new Set(Object.values(maps).flat()).size).toBe(3);
    expect(page.main).not.toContain('wgsl-map');
    expect(page.main).not.toContain('@vertex');
  }, timeLimit(60_000));

  it('are never inlined, however small: an empty map is still a file of its own', async () => {
    const empty = (tier) => `{"format":"dayhike-wgsl-map/2","salt":"s","tier":"${tier}","lines":[],"entries":{}}`;
    const page = await buildPage({ low: empty('low'), medium: empty('medium'), high: empty('high') });
    const maps = emitted(page);
    for (const tier of TIERS) {
      expect(maps[tier], tier).toHaveLength(1);
      expect(page.gpu).toContain(`/dayhike/assets/${maps[tier][0]}`);
    }
    expect(page.gpu).not.toContain('data:');
  }, timeLimit(60_000));

  it('are folded into one file by the build where their bytes are the same: the tier the build writes into each map is what keeps them apart', async () => {
    const same = '{"format":"dayhike-wgsl-map/2","salt":"s","lines":[],"entries":{}}';
    const page = await buildPage({ low: same, medium: same, high: same });
    expect(Object.values(emitted(page)).flat()).toHaveLength(1);
  }, timeLimit(60_000));

  it("fails a build whose maps were not made, naming the tiers and the step that makes them", async () => {
    await expect(buildPage({ low: null, medium: null, high: null })).rejects.toThrow(
      'no WGSL map for the low, medium, high tiers under',
    );
    await expect(buildPage({ low: mapOf('low'), medium: null, high: mapOf('high') })).rejects.toThrow(
      'no WGSL map for the medium tier under',
    );
    await expect(buildPage({ low: mapOf('low'), medium: null, high: mapOf('high') })).rejects.toThrow(
      '`npm run build` makes them (node tools/wgsl/build-map.mjs) before Vite runs',
    );
  }, timeLimit(60_000));
});

/**
 * The plugin on a dev server, as Vite's calls it: resolved for `serve` under
 * the page's base, its hook given the server's middleware stack, then one
 * request for each tier's map and one for another path. The tool it runs is
 * a stand-in that writes a map a tier where it is told to. `env` is set
 * while the hook runs.
 */
async function devRequests(env = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dayhike-wgsl-dev-'));
  const mapDir = join(root, 'map');
  const tool = join(root, 'tool.mjs');
  writeFileSync(
    tool,
    "import { mkdirSync, writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\n" +
      "const out = process.argv[process.argv.indexOf('--out') + 1];\n" +
      'mkdirSync(out, { recursive: true });\n' +
      "for (const tier of ['low', 'medium', 'high']) writeFileSync(join(out, `wgsl-map-${tier}.json`), `{\"made\":\"${tier}\"}`);\n",
  );
  const plugin = wgslMapPlugin({ mapDir, tool });
  plugin.configResolved({ command: 'serve', base: '/dayhike/' });
  let handler = null;
  const saved = { ...process.env };
  delete process.env.VITEST;
  Object.assign(process.env, env);
  let urls;
  try {
    plugin.configureServer({ middlewares: { use: (fn) => (handler = fn) } });
    urls = plugin.load(plugin.resolveId(WGSL_MAP_ID));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
  const request = async (url) => {
    const res = new PassThrough();
    const headers = {};
    res.statusCode = 200;
    res.setHeader = (name, value) => (headers[name] = value);
    const body = [];
    res.on('data', (chunk) => body.push(chunk));
    const ended = new Promise((resolve) => res.on('end', resolve));
    let passedOn = false;
    handler({ url }, res, () => (passedOn = true));
    if (passedOn) return { passedOn };
    await ended;
    return { status: res.statusCode, type: headers['content-type'], body: Buffer.concat(body).toString(), passedOn };
  };
  const served = {};
  for (const tier of TIERS) served[tier] = await request(`/dayhike/wgsl-map-${tier}.json`);
  const other = await request('/dayhike/index.html');
  return { urls, served, made: TIERS.map((tier) => existsSync(mapFile(mapDir, tier))), other };
}

describe('the maps on the dev server', () => {
  it('are made by the tool as the server starts and served at <base>wgsl-map-<tier>.json each', async () => {
    const dev = await devRequests();
    expect(dev.urls).toBe('export default {low:"/dayhike/wgsl-map-low.json",medium:"/dayhike/wgsl-map-medium.json",high:"/dayhike/wgsl-map-high.json"};');
    for (const tier of TIERS) {
      expect(dev.served[tier], tier).toEqual({ status: 200, type: 'application/json', body: `{"made":"${tier}"}`, passedOn: false });
    }
    expect(dev.made).toEqual([true, true, true]);
    expect(dev.other).toEqual({ passedOn: true });
  }, timeLimit(30_000));

  it('with DAYHIKE_SKIP_WGSL_MAP set, are not made, and each request is answered 404', async () => {
    const dev = await devRequests({ DAYHIKE_SKIP_WGSL_MAP: '1' });
    for (const tier of TIERS) expect([dev.served[tier].status, dev.served[tier].body], tier).toEqual([404, '']);
    expect(dev.made).toEqual([false, false, false]);
  }, timeLimit(30_000));

  it('under the suite, names no map: every URL is empty', () => {
    const plugin = wgslMapPlugin({ mapDir: '/nowhere', tool: 'unused' });
    expect(process.env.VITEST).toBeDefined();
    expect(plugin.load(plugin.resolveId(WGSL_MAP_ID))).toBe('export default {low:"",medium:"",high:""};');
    expect(plugin.load('something else')).toBe(null);
  });
});
