import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { liteVersion } from '../../../engine/vite/liteVersion.mjs';
import { enginePreset, enginePublic } from '../../../engine/vite/preset.mjs';

const ENGINE = new URL('../../../engine/', import.meta.url);
const PUBLIC = fileURLToPath(new URL('public/', ENGINE));

/** Every file under `dir` as a path relative to it, `/`-separated, sorted. */
function filesUnder(dir) {
  const found = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(dir, path).split(sep).join(posix.sep));
    }
  };
  walk(dir);
  return found.sort();
}

/** The plugin after Vite has resolved a config whose base is `base`, and the dev middleware it installed. */
function served(base) {
  const plugin = enginePublic();
  plugin.configResolved({ base });
  let middleware;
  plugin.configureServer({ middlewares: { use: (fn) => (middleware = fn) } });
  return (url) => {
    const out = { next: false, headers: {}, status: undefined, body: undefined };
    middleware(
      { url },
      {
        statusCode: 0,
        setHeader(name, value) {
          out.headers[name.toLowerCase()] = value;
        },
        end(body) {
          out.status = this.statusCode;
          out.body = body;
        },
      },
      () => {
        out.next = true;
      },
    );
    return out;
  };
}

describe("the engine's Vite preset", () => {
  it("defines __LITE_VERSION__ as the JSON string of the tag the engine's package pins", () => {
    const tag = liteVersion(readFileSync(new URL('package.json', ENGINE), 'utf8'));
    expect(enginePreset().define.__LITE_VERSION__).toBe(JSON.stringify(tag));
  });

  it('never inlines a model or a ground texture, and leaves every other asset on the default limit', () => {
    const limit = enginePreset().build.assetsInlineLimit;
    expect(limit('a.glb')).toBe(false);
    expect(limit('/x/textures/ground.a.webp')).toBe(false);
    expect(limit('a.png')).toBeUndefined();
    expect(limit('/x/textures/board.a.webp')).toBeUndefined();
  });

  it('carries the engine public plugin', () => {
    expect(enginePreset().plugins.map((p) => p.name)).toEqual(['engine-public']);
  });
});

describe("the engine's public files", () => {
  it('are emitted in a build at their own paths, unhashed, with the bytes on disk', () => {
    const emitted = [];
    enginePublic().generateBundle.call({ emitFile: (file) => emitted.push(file) });
    const names = filesUnder(PUBLIC);
    expect(names.length).toBeGreaterThan(0);
    expect(emitted.map((file) => file.fileName)).toEqual(names);
    for (const file of emitted) {
      expect(file.type).toBe('asset');
      expect(Buffer.compare(Buffer.from(file.source), readFileSync(join(PUBLIC, ...file.fileName.split('/'))))).toBe(0);
    }
    expect(names).toContain('libs/ktx2/babylon.ktx2Decoder.js');
  });

  it('are answered by the dev server under the game base, with the type of the file', () => {
    const get = served('/dayhike/');
    const js = get('/dayhike/libs/ktx2/babylon.ktx2Decoder.js?v=1');
    expect(js.next).toBe(false);
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript');
    expect(Buffer.compare(js.body, readFileSync(join(PUBLIC, 'libs/ktx2/babylon.ktx2Decoder.js')))).toBe(0);
    const wasm = get('/dayhike/libs/ktx2/msc_basis_transcoder.wasm');
    expect(wasm.status).toBe(200);
    expect(wasm.headers['content-type']).toBe('application/wasm');
    expect(Buffer.compare(wasm.body, readFileSync(join(PUBLIC, 'libs/ktx2/msc_basis_transcoder.wasm')))).toBe(0);
  });

  it('leave every other request to the next handler, and never leave their folder', () => {
    const get = served('/dayhike/');
    expect(get('/dayhike/libs/ktx2/nothing.js').next).toBe(true);
    expect(get('/dayhike/favicon.ico').next).toBe(true);
    expect(get('/libs/ktx2/babylon.ktx2Decoder.js').next).toBe(true);
    expect(get('/dayhike/libs/ktx2/../../../package.json').next).toBe(true);
    expect(get('/dayhike/libs/ktx2/%2e%2e/%2e%2e/%2e%2e/package.json').next).toBe(true);
    expect(get('/dayhike/libs/ktx2/..%2f..%2f..%2fpackage.json').next).toBe(true);
    expect(get('/dayhike/libs/ktx2/').next).toBe(true);
  });
  it("has a game's dev server and its tests treat the engine as source, installed or not", async () => {
    const { enginePreset } = await import('../../../engine/vite/preset.mjs');
    const preset = enginePreset();
    expect(preset.optimizeDeps).toEqual({ exclude: ['@csarkosh/engine'] });
    const inline = preset.test.server.deps.inline;
    expect(inline).toHaveLength(1);
    expect(inline[0].test('/x/node_modules/@csarkosh/engine/src/shell.ts')).toBe(true);
    expect(inline[0].test('/x/node_modules/vitest/dist/index.js')).toBe(false);
  });

  it("is plain JavaScript a config can load from an installed package, the time limit's helper with it", async () => {
    const { readdirSync } = await import('node:fs');
    const names = readdirSync(new URL('../../../engine/vite/', import.meta.url));
    expect(names.filter((name) => name.endsWith('.ts') && !name.endsWith('.d.mts'))).toEqual([]);
    expect(names).toContain('timeLimit.mjs');
    const helper = await import('../../../engine/vite/timeLimit.mjs');
    expect(helper.parseTimeScale(undefined)).toBe(1);
    expect(helper.parseTimeScale('3')).toBe(3);
    expect(() => helper.parseTimeScale('0')).toThrow(/TEST_TIME_SCALE/);
  });
});
