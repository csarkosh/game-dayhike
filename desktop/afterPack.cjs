'use strict';
// electron-builder afterPack hook: prove the packaged Electron on both
// platforms, then (macOS) seal the app so Gatekeeper will open it.
//
// Windows: `Day Hike.exe` is the mirror's `electron.exe`, renamed, with its
// `.rsrc` rewritten — electron-builder writes the asar integrity resource into
// it before this hook (ElectronFramework's beforeCopyExtraFiles) and edits the
// icon and version strings after it (winPackager's signAndEditResources), so
// there is no moment at which an exact whole-file compare is possible. What is
// provable, here and on the finished installer alike, is that every section
// outside `.rsrc` — `.text` with the patched instructions above all — is
// byte-identical to the mirror's, which is what equalOutsideResources checks
// (tools/deploy/lib/peSections.mjs; tools/deploy/desktop.mjs repeats it on the
// extracted installer).
//
// macOS: the compare proves the Electron Framework, then the bundle is ad-hoc
// sealed. Electron's official zips are only linker-signed — no bundle seal, no
// CodeResources — and electron-builder with `identity: null` signs nothing, so
// a packaged app inherits a signature that says "resources sealed" over a
// bundle that seals none. macOS reports that as "damaged and can't be opened",
// a dead end with no Open Anyway. An ad-hoc seal of the whole bundle turns it
// into the recoverable "Apple could not verify" prompt (System Settings →
// Privacy & Security → Open Anyway) until a Developer ID exists.
//
// Sealing rewrites the Electron Framework's signature, so the exact
// byte-compare against the mirror runs here, before the seal — this is the
// last moment the framework is untouched. tools/deploy/desktop.mjs repeats the
// comparison on the mounted dmg, ignoring only the bytes codesign owns.
//
// Runs before electron-builder's own (skipped) signing step and before any
// fuse flip; electronFuses is not configured, and must not be — flipping fuses
// after this hook would invalidate the seal.
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ESM, so it is imported dynamically; build-time only, never packaged.
const PE_SECTIONS = path.join(__dirname, '..', 'tools', 'deploy', 'lib', 'peSections.mjs');

const FRAMEWORK = path.join(
  'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework',
);

module.exports = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') {
    const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
    if (!existsSync(exe)) throw new Error(`afterPack: no ${exe}`);
    const reference = process.env.DAYHIKE_MIRROR_ELECTRON_EXE;
    if (reference) {
      const { equalOutsideResources } = await import(pathToFileURL(PE_SECTIONS).href);
      if (!equalOutsideResources(readFileSync(exe), readFileSync(reference))) {
        throw new Error(
          `afterPack: the packaged ${path.basename(exe)} differs from ${reference} outside its resources — ` +
            'the app would lack the pointer-lock patch',
        );
      }
      console.log(`  • afterPack: packaged ${path.basename(exe)} matches the mirror's electron.exe outside .rsrc`);
    } else if (process.env.DAYHIKE_UNPROVEN_PACK === '1') {
      console.log('  • afterPack: DAYHIKE_UNPROVEN_PACK=1 — packaged electron.exe NOT proven against the mirror');
    } else {
      throw new Error(
        'afterPack: DAYHIKE_MIRROR_ELECTRON_EXE is unset. ' +
          'Release through `npm run deploy:desktop`; for a throwaway local build set DAYHIKE_UNPROVEN_PACK=1.',
      );
    }
    return;
  }
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const framework = path.join(app, FRAMEWORK);
  if (!existsSync(framework)) throw new Error(`afterPack: no Electron Framework at ${framework}`);

  const reference = process.env.DAYHIKE_MIRROR_FRAMEWORK;
  if (reference) {
    if (!readFileSync(framework).equals(readFileSync(reference))) {
      throw new Error(
        `afterPack: the packaged Electron Framework is not byte-identical to ${reference} — ` +
          'electron-builder packaged something other than the mirror\'s Electron; the app would lack the pointer-lock patch',
      );
    }
    console.log('  • afterPack: packaged Electron Framework is byte-identical to the mirror\'s (before sealing)');
  } else if (process.env.DAYHIKE_UNPROVEN_PACK === '1') {
    console.log('  • afterPack: DAYHIKE_UNPROVEN_PACK=1 — packaged Electron NOT proven against the mirror');
  } else {
    throw new Error(
      'afterPack: DAYHIKE_MIRROR_FRAMEWORK is unset, so the packaged Electron cannot be proven to carry the patch. ' +
        'Release through `npm run deploy:desktop`; for a throwaway local build set DAYHIKE_UNPROVEN_PACK=1.',
    );
  }

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('  • afterPack: ad-hoc sealed the bundle; codesign --verify --deep --strict passes');
};
