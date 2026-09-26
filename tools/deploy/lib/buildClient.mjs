// The production client build, shared by the web deploy and the desktop
// release so the two can never be built against different addresses.
import { runLoud, tfOutput, requireLfsMaterialized } from './preconditions.mjs';

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
