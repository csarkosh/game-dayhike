// The WGSL map in the page's build and on its dev server (`client/vite.config.ts`).
//
// The WebGPU module (`client/src/game/gpuEngine.ts`) imports the map's URL
// from `virtual:dayhike-wgsl-map`, so only the chunk that module is split
// into names it, and the WebGL2 bundle neither grows nor refers to it:
//
// - `vite build`: the map `tools/wgsl/build-map.mjs` wrote before Vite
//   (`npm run build` runs it first) is emitted as a content-hashed asset,
//   `assets/wgsl-map-<hash>.json`, and never inlined, however small: the
//   host serves `/assets/**` immutable, and a map inlined into the chunk
//   would be parsed with it by every page, WebGPU or not. A build without a
//   map fails, naming the step that makes it.
// - the dev server: the tool is run as the server starts (a map made from
//   the same corpus under the same salt is kept), and the map is served at
//   `<base>wgsl-map.json` once it is made, so a measurement on the dev server
//   sees what production will. A request made before it is ready waits for
//   it; one the tool failed to make is a 404, which the page reads as no map.
//   Making it translates the whole corpus: the 421 recorded stages took
//   about 35 s on an Apple M4 and 54 s on a GitHub build runner, beside what
//   the dev server may be measuring, on every start of a checkout that has
//   no map made yet. With `DAYHIKE_SKIP_WGSL_MAP` set, the dev server
//   translates nothing and answers the map's request with a 404. The build
//   always translates.
// - the suite: the URL is empty, and the page asks for no map.

import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';

/** The module the WebGPU chunk imports the map's URL from. */
export const WGSL_MAP_ID = 'virtual:dayhike-wgsl-map';
const RESOLVED = `\0${WGSL_MAP_ID}`;
/** Where the dev server serves the map, under the base. */
const DEV_PATH = 'wgsl-map.json';
/** Set, the dev server makes no map. */
export const SKIP_ENV = 'DAYHIKE_SKIP_WGSL_MAP';

/**
 * The plugin, for the map at `mapFile`, made by the tool at `tool` (the dev
 * server runs it; the build expects its map made).
 */
export function wgslMapPlugin({ mapFile, tool }) {
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
      if (process.env.VITEST) return 'export default "";';
      if (command === 'build') {
        if (!existsSync(mapFile)) {
          this.error(`no WGSL map at ${mapFile}: \`npm run build\` makes it (node tools/wgsl/build-map.mjs) before Vite runs`);
        }
        return `export { default } from ${JSON.stringify(`${mapFile}?url&no-inline`)};`;
      }
      return `export default ${JSON.stringify(`${base}${DEV_PATH}`)};`;
    },
    configureServer(server) {
      if (process.env.VITEST) return;
      const made = process.env[SKIP_ENV] ? Promise.resolve(false) : new Promise((resolve) => {
        const child = spawn(process.execPath, [tool, '--reuse', '--out', mapFile], { stdio: 'inherit' });
        child.on('exit', (code) => resolve(code === 0));
        child.on('error', () => resolve(false));
      });
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== `${base}${DEV_PATH}`) return next();
        void made.then((ok) => {
          if (!ok || !existsSync(mapFile)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader('content-type', 'application/json');
          res.setHeader('cache-control', 'no-cache');
          createReadStream(mapFile).pipe(res);
        });
      });
    },
  };
}
