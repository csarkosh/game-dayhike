// The production client build, shared by the web deploy and the desktop
// release so the two can never be built against different addresses; and the
// admin page's build, against the same addresses, for the shared admin host.
import { fileURLToPath } from 'node:url';
import { buildTag, runLoud, tfOutput, requireLfsMaterialized } from './preconditions.mjs';

// Checked before the build, not after: vite build would happily emit pointer
// files into dist under a content hash and report success.
export const LFS_MODELS = [
  'client/assets/models/ranger.nathan.glb',
  'client/assets/models/hollow.antlered.glb',
];

/** Every address the bundle bakes in, read from Terraform (or production.json). */
export function productionEnv() {
  const signalingUrl = tfOutput('signaling_url');
  const siteUrl = tfOutput('site_url'); // https://games.csarko.sh/dayhike
  return {
    // The Cloud Run output is https; the client needs the WebSocket scheme and
    // the path the server binds.
    VITE_SIGNALING_URL: `${signalingUrl.replace(/^https:/, 'wss:')}/ws`,
    VITE_WEB_BASE: siteUrl,
    VITE_DOWNLOADS_URL: `${tfOutput('downloads_url')}/desktop/latest.json`,
    // The telemetry route on its own service (`server/src/telemetry.ts`),
    // and the commit this build is of, which every row the page sends names.
    VITE_TELEMETRY_URL: `${tfOutput('telemetry_url')}/t`,
    VITE_BUILD_SHA: buildTag(),
    // Vite's `base`: the site URL's path with a trailing slash. The desktop
    // shell loads the site itself, so there is one build and one base.
    DAYHIKE_BASE: `${new URL(siteUrl).pathname.replace(/\/+$/, '')}/`,
  };
}

export function buildClient(extraEnv = {}) {
  requireLfsMaterialized(LFS_MODELS);
  const env = { ...productionEnv(), ...extraEnv };
  for (const [k, v] of Object.entries(env)) console.log(`→ ${k.padEnd(22)} ${v}`);
  runLoud('npm', ['run', 'build'], { env: { ...process.env, ...env } });
  return env;
}

/** Where the admin page's build lands (`client/vite.admin.config.ts`). */
export const ADMIN_DIST = fileURLToPath(new URL('../../../client/dist-admin/', import.meta.url)).replace(/\/$/, '');

/**
 * The admin page's build, for the shared admin host (`tools/deploy/admin.mjs`):
 * the page reads the admin routes on the telemetry service, whose address it
 * takes from the same output the game's build does, and names the build it is
 * of. Its base is the host's path for this app, which the config sets; no
 * model or texture is in it, so there is nothing of LFS to check.
 */
export function buildAdmin() {
  const production = productionEnv();
  const env = { VITE_TELEMETRY_URL: production.VITE_TELEMETRY_URL, VITE_BUILD_SHA: production.VITE_BUILD_SHA };
  for (const [k, v] of Object.entries(env)) console.log(`→ ${k.padEnd(22)} ${v}`);
  runLoud('npm', ['run', 'build:admin'], { env: { ...process.env, ...env } });
  return env;
}
