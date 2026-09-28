import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
