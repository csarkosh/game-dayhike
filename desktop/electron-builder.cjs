'use strict';
// electron-builder configuration. JavaScript rather than YAML so `electronDist`
// can choose per platform: the Mac build packages the Electron npm installed
// through .npmrc's mirror; the Windows build packages the mirror's win32-x64
// zip that tools/deploy/desktop.mjs downloaded, verified and unpacked. That
// neither is ever a fresh upstream download — which would silently drop the
// patch — is enforced twice outside this file: the release script asserts both
// env vars point at real paths before it spawns the builder, and afterPack.cjs
// compares what was actually packaged against the mirror's bytes.
const path = require('node:path');

// Not a throw. electron-builder wraps the electronDist hook in a try/catch that
// swallows the error ("Failed to resolve electronDist, using default unpack
// logic") and then downloads upstream Electron — the exact outcome this check
// exists to prevent. Returning a path that cannot exist routes the failure
// through electron-builder's own "electronDist does not exist" check instead,
// which does abort the build.
const WIN32_DIST_UNSET = path.join(__dirname, '.cache', 'DAYHIKE_WIN32_DIST-unset');

function win32Dist() {
  const dist = process.env.DAYHIKE_WIN32_DIST;
  if (dist) return dist;
  if (process.env.DAYHIKE_UNPROVEN_PACK === '1') return undefined; // electron-builder downloads upstream: throwaway builds only
  console.error(
    'DAYHIKE_WIN32_DIST is unset: the Windows build would package an Electron of unknown provenance. ' +
      'Release through `npm run deploy:desktop`; for a throwaway local build set DAYHIKE_UNPROVEN_PACK=1.',
  );
  return WIN32_DIST_UNSET;
}

module.exports = {
  appId: 'sh.csarko.dayhike',
  productName: 'Day Hike',
  electronDist: ({ platformName }) => (platformName === 'win32' ? win32Dist() : path.join(__dirname, 'node_modules', 'electron', 'dist')),
  npmRebuild: false,
  directories: { output: 'dist' },
  // Proves the packaged Electron against the mirror, then (macOS) ad-hoc seals
  // the bundle. Without the seal Gatekeeper calls the download "damaged".
  afterPack: './afterPack.cjs',
  files: ['main.cjs', 'offline.html', 'package.json'],
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
    // No Developer ID yet, so electron-builder signs nothing; afterPack.cjs
    // applies the ad-hoc seal instead. Revisit once one is available.
    identity: null,
    category: 'public.app-category.games',
    artifactName: 'DayHike-${version}-arm64.${ext}',
  },
  dmg: { sign: false },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'DayHike-Setup-${version}-x64.${ext}',
  },
  nsis: { oneClick: true, perMachine: false, deleteAppDataOnUninstall: false },
};
