// The WGSL maps in the page's build and on its dev server (`client/vite.config.ts`).
//
// The WebGPU module (`client/src/game/gpuEngine.ts`) imports the maps' URLs,
// one a quality tier, from `virtual:dayhike-wgsl-map`, so only the chunk that
// module is split into names them, and the WebGL2 bundle neither grows nor
// refers to them:
//
// - `vite build`: each map `tools/wgsl/build-map.mjs` wrote before Vite
//   (`npm run build` runs it first) is emitted as a content-hashed asset,
//   `assets/wgsl-map-<tier>-<hash>.json`, and never inlined, however small:
//   the host serves `/assets/**` immutable, and a map inlined into the chunk
//   would be parsed with it by every page, WebGPU or not. A build without
//   every map fails, naming the step that makes them.
// - the dev server: the tool is run as the server starts (maps made from
//   the same corpus under the same salt are kept), and each map is served at
//   `<base>wgsl-map-<tier>.json` once it is made, so a measurement on the
//   dev server sees what production will. A request made before it is ready
//   waits for it; one the tool failed to make is a 404, which the page reads
//   as no map. Making them translates the whole corpus once: the 421
//   recorded stages took about 35 s on an Apple M4 and 54 s on a GitHub
//   build runner, beside what the dev server may be measuring, on every
//   start of a checkout that has no maps made yet. With
//   `DAYHIKE_SKIP_WGSL_MAP` set, the dev server translates nothing and
//   answers each map's request with a 404. The build always translates.
// - the suite: every URL is empty, and the page asks for no map.

import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mapFile, mapName } from './files.mjs';

/** The module the WebGPU chunk imports the maps' URLs from. */
export const WGSL_MAP_ID = 'virtual:dayhike-wgsl-map';
const RESOLVED = `\0${WGSL_MAP_ID}`;
/** Set, the dev server makes no map. */
export const SKIP_ENV = 'DAYHIKE_SKIP_WGSL_MAP';
/** The tiers a map is made for, as the page's `TIERS` lists them. */
const TIERS = ['low', 'medium', 'high'];

/**
 * The plugin, for the maps under `mapDir` (`wgsl-map-<tier>.json` each),
 * made by the tool at `tool` (the dev server runs it; the build expects its
 * maps made).
 */
export function wgslMapPlugin({ mapDir, tool }) {
  let command = 'serve';
  let base = '/';
  return {
    name: 'dayhike-wgsl-map',
    configResolved(config) {
      command = config.command;
      base = config.base;
    },
    resolveId(id) {
      return id === WGSL_MAP_ID ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      const urls = (url) => `export default {${TIERS.map((tier) => `${tier}:${url(tier)}`).join(',')}};`;
      if (process.env.VITEST) return urls(() => '""');
      if (command === 'build') {
        const missing = TIERS.filter((tier) => !existsSync(mapFile(mapDir, tier)));
        if (missing.length > 0) {
          this.error(
            `no WGSL map for the ${missing.join(', ')} tier${missing.length === 1 ? '' : 's'} under ${mapDir}: ` +
              '`npm run build` makes them (node tools/wgsl/build-map.mjs) before Vite runs',
          );
        }
        return TIERS.map((tier) => `import ${tier} from ${JSON.stringify(`${mapFile(mapDir, tier)}?url&no-inline`)};`).join('\n') + `\n${urls((tier) => tier)}`;
      }
      return urls((tier) => JSON.stringify(`${base}${mapName(tier)}`));
    },
    configureServer(server) {
      if (process.env.VITEST) return;
      const made = process.env[SKIP_ENV] ? Promise.resolve(false) : new Promise((resolve) => {
        const child = spawn(process.execPath, [tool, '--reuse', '--out', mapDir], { stdio: 'inherit' });
        child.on('exit', (code) => resolve(code === 0));
        child.on('error', () => resolve(false));
      });
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const tier = TIERS.find((name) => path === `${base}${mapName(name)}`);
        if (tier === undefined) return next();
        const file = mapFile(mapDir, tier);
        void made.then((ok) => {
          if (!ok || !existsSync(file)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader('content-type', 'application/json');
          res.setHeader('cache-control', 'no-cache');
          createReadStream(file).pipe(res);
        });
      });
    },
  };
}
