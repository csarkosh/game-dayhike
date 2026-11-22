// What the engine needs of a game's Vite build, so that a game names it once: the Babylon Lite
// version the page's telemetry carries, the rule for which assets are never inlined, and the
// engine's own public files (`engine/public`, the KTX2 decoder the forest's textures are read
// with). A game's config merges it with its own lines:
//
//   export default mergeConfig(enginePreset(), defineConfig({ ... }));
//
// Plain JavaScript with JSDoc types, not TypeScript: a Vite config loads it from the installed
// package, where Node does not strip types.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liteVersion } from './liteVersion.mjs';

/** The engine's package folder. */
const ENGINE = new URL('../', import.meta.url);
/** The engine's public files, served and built at their paths under this folder. */
const PUBLIC = fileURLToPath(new URL('public/', ENGINE));

/** Content types of the files the engine's public folder holds, by extension. */
const TYPES = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.css': 'text/css',
  '.html': 'text/html',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/**
 * Never inline a model, and never inline a ground texture. `game/assetUrls.ts`
 * imports every shipped .glb with `?url`, and `groundLayers.ts`
 * imports every `assets/textures/ground.*.webp` of a game the same way, so Vite
 * content-hashes them — but Vite turns a `?url` asset under `assetsInlineLimit`
 * (4096 bytes by default) into a base64 `data:` URI instead, no separate
 * request and no cacheable URL either. That is not a hypothetical margin on
 * either side: `clutter.fungus_b.glb` is 4,236 bytes, only 140 over the limit;
 * and centring the RAH texture's AO channel on its own mean (groundMaps.mjs's
 * `packRAH`) — needed so a near-white, low-
 * variance source AO like asphalt's stops darkening the ground unequally per
 * layer — shrank `ground.asphalt.rah.webp` from ~6.5 KB to 2,784 bytes,
 * UNDER the limit, where it would otherwise silently drop out of the hashed,
 * cached set the same way a model would (`tools/deploy/verify.mjs`'s texture
 * check exists to catch exactly this in production). Returning `false` for
 * both opts them out; `undefined` leaves every other asset on the default
 * limit.
 *
 * @param {string} file
 * @returns {false | undefined}
 */
function assetsInlineLimit(file) {
  return file.endsWith('.glb') || (file.endsWith('.webp') && file.includes('/textures/ground.')) ? false : undefined;
}

/** Every file under `dir`, as paths relative to it with `/` separators, sorted. @param {string} dir @returns {string[]} */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const found = [];
  /** @param {string} d */
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.push(relative(dir, path).split(sep).join(posix.sep));
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * Makes every file under `engine/public/` part of the game's site at the same path under the
 * game's `base`: in a build each is emitted as it is, its name unhashed and its bytes untouched;
 * the dev server and `vite preview` answer a request for it. The game's own `publicDir` is not
 * touched.
 *
 * @returns {import("vite").Plugin}
 */
export function enginePublic() {
  /** The game's base, as the config resolved it. */
  let base = '/';
  /** @type {import("vite").Connect.NextHandleFunction} */
  const middleware = (req, res, next) => {
    let path;
    try {
      path = decodeURIComponent((req.url ?? '').split(/[?#]/)[0] ?? '');
    } catch {
      return next();
    }
    if (!path.startsWith(base)) return next();
    const name = path.slice(base.length);
    if (name === '' || name.split(/[/\\]/).includes('..')) return next();
    const file = join(PUBLIC, ...name.split('/'));
    if (relative(PUBLIC, file).startsWith('..') || !existsSync(file) || !statSync(file).isFile()) return next();
    res.statusCode = 200;
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  };
  return {
    name: 'engine-public',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    generateBundle() {
      for (const name of filesUnder(PUBLIC)) {
        this.emitFile({ type: 'asset', fileName: name, source: readFileSync(join(PUBLIC, ...name.split('/'))) });
      }
    },
  };
}

/**
 * The engine's part of a game's Vite config.
 *
 * @returns {import("vite").UserConfig}
 */
export function enginePreset() {
  return {
    define: {
      // The version of Babylon Lite the page is drawn with, as the engine pins it: the fork's tag,
      // which names its patches, where the installed package's own version says only which
      // release they stand on. Every telemetry row carries it (`shell.ts`).
      __LITE_VERSION__: JSON.stringify(liteVersion(readFileSync(new URL('package.json', ENGINE), 'utf8'))),
    },
    build: { assetsInlineLimit },
    plugins: [enginePublic()],
  };
}
