import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'vite';
import { timeLimit } from '../../../client/test/helpers/timeLimit.ts';
import { WGSL_MAP_ID, wgslMapPlugin } from '../lib/mapPlugin.mjs';

/**
 * A page shaped as the game's: an entry that is the WebGL2 bundle, and a
 * module it imports dynamically, as `main.ts` imports `gpuEngine.ts`, which
 * names the map. Built with Vite and the plugin as the page's config builds
 * it, under the page's base.
 */
async function buildPage(map) {
  const root = mkdtempSync(join(tmpdir(), 'dayhike-wgsl-page-'));
  writeFileSync(join(root, 'main.js'), 'globalThis.webgpu = () => import("./gpu.js");\nconsole.log("webgl2");\n');
  writeFileSync(join(root, 'gpu.js'), `import mapUrl from "${WGSL_MAP_ID}";\nconsole.log(mapUrl);\n`);
  const mapFile = join(root, 'wgsl-map.json');
  if (map !== null) writeFileSync(mapFile, map);
  const saved = process.env.VITEST;
  // The plugin names no map under the suite; this build is the page's.
  delete process.env.VITEST;
  try {
    await build({
      root,
      base: '/dayhike/',
      configFile: false,
      logLevel: 'silent',
      plugins: [wgslMapPlugin({ mapFile, tool: 'unused' })],
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

describe('the map in the page\'s build', () => {
  it('is a content-hashed asset that only the WebGPU chunk names; the WebGL2 bundle neither holds nor names it', async () => {
    const map = '{"format":"dayhike-wgsl-map/1","salt":"s","entries":{"aa":"@vertex fn main() {}"}}';
    const page = await buildPage(map);
    const emitted = page.files.filter((name) => /^wgsl-map-[A-Za-z0-9_-]{8}\.json$/.test(name));
    expect(emitted).toHaveLength(1);
    expect(page.read(emitted[0])).toBe(map);
    expect(page.gpu).toContain(`/dayhike/assets/${emitted[0]}`);
    expect(page.main).not.toContain('wgsl-map');
    expect(page.main).not.toContain('@vertex');
  }, timeLimit(60_000));

  it('is never inlined, however small: an empty map is still a file of its own', async () => {
    const map = '{"format":"dayhike-wgsl-map/1","salt":"s","entries":{}}';
    const page = await buildPage(map);
    const emitted = page.files.filter((name) => /^wgsl-map-[A-Za-z0-9_-]{8}\.json$/.test(name));
    expect(emitted).toHaveLength(1);
    expect(page.gpu).toContain(`/dayhike/assets/${emitted[0]}`);
    expect(page.gpu).not.toContain('data:');
  }, timeLimit(60_000));

  it('fails a build whose map was not made, naming the step that makes it', async () => {
    await expect(buildPage(null)).rejects.toThrow('`npm run build` makes it (node tools/wgsl/build-map.mjs) before Vite runs');
  }, timeLimit(60_000));
});

/**
 * The plugin on a dev server, as Vite's calls it: resolved for `serve` under
 * the page's base, its hook given the server's middleware stack, then one
 * request for the map. The tool it runs is a stand-in that writes a map where
 * it is told to. `env` is set while the hook runs.
 */
async function devRequest(env = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dayhike-wgsl-dev-'));
  const mapFile = join(root, 'map', 'wgsl-map.json');
  const tool = join(root, 'tool.mjs');
  writeFileSync(
    tool,
    "import { mkdirSync, writeFileSync } from 'node:fs';\nimport { dirname } from 'node:path';\n" +
      "const out = process.argv[process.argv.indexOf('--out') + 1];\n" +
      "mkdirSync(dirname(out), { recursive: true });\nwriteFileSync(out, '{\"made\":true}');\n",
  );
  const plugin = wgslMapPlugin({ mapFile, tool });
  plugin.configResolved({ command: 'serve', base: '/dayhike/' });
  let handler = null;
  const saved = { ...process.env };
  delete process.env.VITEST;
  Object.assign(process.env, env);
  let url;
  try {
    plugin.configureServer({ middlewares: { use: (fn) => (handler = fn) } });
    url = plugin.load(plugin.resolveId(WGSL_MAP_ID));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
  const res = new PassThrough();
  const headers = {};
  res.statusCode = 200;
  res.setHeader = (name, value) => (headers[name] = value);
  const body = [];
  res.on('data', (chunk) => body.push(chunk));
  const ended = new Promise((resolve) => res.on('end', resolve));
  let passedOn = false;
  handler({ url: '/dayhike/wgsl-map.json' }, res, () => (passedOn = true));
  await ended;
  const other = { passed: false };
  handler({ url: '/dayhike/index.html' }, res, () => (other.passed = true));
  return { url, status: res.statusCode, type: headers['content-type'], body: Buffer.concat(body).toString(), made: existsSync(mapFile), passedOn, other };
}

describe('the map on the dev server', () => {
  it('is made by the tool as the server starts and served at <base>wgsl-map.json', async () => {
    const served = await devRequest();
    expect(served.url).toBe('export default "/dayhike/wgsl-map.json";');
    expect([served.status, served.type, served.body, served.made, served.passedOn]).toEqual([200, 'application/json', '{"made":true}', true, false]);
    expect(served.other.passed).toBe(true);
  }, timeLimit(30_000));

  it('with DAYHIKE_SKIP_WGSL_MAP set, is not made, and its request is answered 404', async () => {
    const served = await devRequest({ DAYHIKE_SKIP_WGSL_MAP: '1' });
    expect([served.status, served.body, served.made]).toEqual([404, '', false]);
  }, timeLimit(30_000));
});
