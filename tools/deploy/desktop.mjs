#!/usr/bin/env node
// Build, prove, package, smoke and publish the macOS and Windows desktop apps.
//
// Usage: npm run deploy:desktop -- --version 1.2.0 [--dry-run]
//
// The shell ships no copy of the game — it loads https://games.csarko.sh/dayhike
// — so a release is the Electron and ~300 lines of launcher, and it happens
// only when the mirror publishes a new Electron (`npm run desktop:outdated`
// says when). The one thing this script exists to guarantee is that the app a
// player downloads contains the pointer-lock patch. Electron is installed
// through the mirror in desktop/.npmrc, but a download cache can hand npm
// upstream's bytes for the same version without a word — the shared
// ~/Library/Caches/electron did exactly that once — so step 2 pins the install
// to a private desktop/.cache/electron that only this script writes to.
//
// Step 4 then proves the input, differently per platform. macOS: byte-compare
// the mirror's zip against the Electron npm installed. Windows: npm installs no
// Electron at all — electron-builder packages the mirror's unpacked zip
// directly — so the input proof is the freshly fetched checksum on that zip,
// and sitesMatch on what comes out of the installer. Step 6 byte-compares the
// framework actually inside the packaged dmg against the same mirror bytes,
// proving the artifact — electron-builder could in principle have packaged
// something else. The app is ad-hoc sealed in desktop/afterPack.cjs
// (without a seal Gatekeeper rejects the download as "damaged"), which
// rewrites the framework's signature: the hook runs the exact compare before
// sealing, and step 6 compares everything except the bytes codesign owns.
//
// Windows cannot be proven that way. electron-builder writes the asar-integrity
// resource into `Day Hike.exe` before the afterPack hook and edits the icon and
// version strings after it, so `.rsrc` is never comparable and no whole-file
// compare exists at any moment; step 6b proves every *other* PE section of the
// exe inside the finished NSIS installer against the mirror's electron.exe
// instead. And nothing on this Mac can run that installer, so the release
// dispatches .github/workflows/desktop-smoke-windows.yml on `main` — GitHub
// resolves a dispatch ref remotely, so the copy on main is the copy that runs,
// and step 6b refuses to release when this tree's copy differs — and waits: the
// Windows build is only ever advertised after a Windows runner has installed
// it and its own smoke has passed.
//
// Both platforms also get an independent content check. The mirror publishes
// electron-v<ver>-<platform>.patches.json — the file offset and replacement
// bytes of every patch site — and steps 6/6b read those bytes straight out of
// the packaged binary. That answers "is the patch there?" without relying on
// the checksum chain or the section compare, and would catch a mirror that
// published an unpatched zip under a correct checksum.
//
// latest.json is written last: a half-finished release must never advertise
// itself. It is also the only pointer at the artifacts, which is what lets each
// upload be named after its own bytes — `DayHike-Setup-<v>-x64-<sha8>.exe` —
// rather than after the version alone. Uploads are immutable and cached for a
// year, and builds are not deterministic, so a retried release of the same
// version under a fixed name would replace the object while the CDN kept
// serving the earlier, unsmoked bytes under the advertised URL. A per-attempt
// name cannot collide, so the URL in latest.json always names the exact bytes
// the Windows smoke passed.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  fail,
  run,
  runLoud,
  requireCommand,
  requireGcloudAuth,
  requireGhAuth,
  requireProjectMatchesTerraform,
  tfOutput,
} from './lib/preconditions.mjs';
import {
  dmgName,
  frameworkPathIn,
  installerName,
  isGreater,
  latestJson,
  objectName,
  parseSemver,
  parseShasums,
  sitesMatch,
  verifyOrRefetch,
} from './lib/desktopRelease.mjs';
import { equalOutsideSignature } from './lib/machoSignature.mjs';
import { equalOutsideResources } from './lib/peSections.mjs';

const MIRROR = 'https://github.com/csarkosh/electron-gamepatch/releases/download';
const DESKTOP = 'desktop';
const PKG = path.join(DESKTOP, 'package.json');
const CACHE = path.join(DESKTOP, '.cache');

// ---- 1. preconditions -------------------------------------------------------
const versionArg = process.argv.indexOf('--version');
const version = versionArg === -1 ? undefined : process.argv[versionArg + 1];
if (!version || !parseSemver(version)) fail('usage: npm run deploy:desktop -- --version X.Y.Z [--dry-run]');
// Everything up to and including the local proofs, and nothing that leaves this
// machine: no upload, no workflow dispatch, no commit, no tag. What it is for is
// exercising the expensive half of the release — the downloads, the pack, the
// compares — without publishing anything.
const dryRun = process.argv.includes('--dry-run');

requireCommand('npx', 'Install Node 22 or later.');
requireCommand('hdiutil', 'This script must run on macOS.');
requireCommand('unzip', 'unzip is part of macOS.');
requireCommand('7zz', 'brew install 7zip');
requireGcloudAuth();
requireGhAuth();
const project = requireProjectMatchesTerraform();

const pkgText = readFileSync(PKG, 'utf8');
const pkg = JSON.parse(pkgText);
if (!isGreater(version, pkg.version)) fail(`--version ${version} is not greater than desktop/package.json's ${pkg.version}`);
const electronVersion = pkg.devDependencies.electron;
if (!parseSemver(electronVersion)) fail(`desktop/package.json pins electron as ${electronVersion}; it must be an exact version`);
if (run('git', ['tag', '-l', `desktop-v${version}`]).trim() !== '') fail(`tag desktop-v${version} already exists; pick a higher --version`);

const dirty = run('git', ['status', '--porcelain', '--', DESKTOP]).trim();
if (dirty !== '') fail(`desktop/ has uncommitted changes — a release is a commit:\n${dirty}\nIf a previous release failed after packaging, the bump is the only change: git checkout desktop/package.json`);

// The pack below needs the real version in package.json (electron-builder reads
// it for the artifact names), so a dry run bumps it too — and puts it back on
// the way out, however it exits. `fail` calls process.exit, so this has to hang
// off 'exit' rather than a finally.
if (dryRun) process.on('exit', () => writeFileSync(PKG, pkgText));

const bucket = tfOutput('downloads_bucket');
const downloadsUrl = tfOutput('downloads_url');
console.log(`→ project   ${project}`);
console.log(`→ bucket    gs://${bucket}`);
console.log(`→ version   ${version} (electron ${electronVersion})`);
if (dryRun) console.log('→ dry run   stops after the local proofs; nothing is uploaded, dispatched, committed or tagged');

// ---- 2. install the shell, then fetch its Electron through the mirror ---------
// Into a cache of its own: the shared ~/Library/Caches/electron once handed a
// build upstream's zip for this same version, and only step 4 noticed.
const electronEnv = { ...process.env, electron_config_cache: path.resolve(CACHE, 'electron') };
runLoud('npm', ['ci'], { cwd: DESKTOP, env: electronEnv });
runLoud('npm', ['run', 'electron:fetch'], { cwd: DESKTOP, env: electronEnv });

// ---- 4. prove the patch is in the bits ----------------------------------------
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Straight to memory, so there is no cached copy anything could later trust. */
async function fetchFresh(url) {
  console.log(`→ fetching  ${url}`);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) fail(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function fetchTo(url, dest) {
  writeFileSync(dest, await fetchFresh(url));
}

mkdirSync(CACHE, { recursive: true });

// Never cached, and never written next to the zips: a cached SHASUMS256.txt and
// a cached zip verify each other happily while the mirror has re-cut the tag
// underneath both. This list is the only thing that decides whether a zip on
// disk is still the mirror's, so it is fetched every run.
const expectedShas = parseShasums((await fetchFresh(`${MIRROR}/v${electronVersion}/SHASUMS256.txt`)).toString('utf8'));

async function mirrorZip(platform) {
  const name = `electron-v${electronVersion}-${platform}.zip`;
  const expected = expectedShas.get(name);
  if (!expected) fail(`${name} is not in the mirror's SHASUMS256.txt for v${electronVersion} — the mirror has no ${platform} asset for that version`);
  const zip = path.join(CACHE, name);
  const url = `${MIRROR}/v${electronVersion}/${name}`;
  let downloaded = false;
  let refetched = false;
  try {
    ({ downloaded, refetched } = await verifyOrRefetch(zip, expected, {
      exists: existsSync,
      digest: sha256,
      remove: (p) => rmSync(p, { force: true }),
      download: (p) => fetchTo(url, p),
    }));
  } catch (error) {
    fail(error.message);
  }
  if (refetched) console.log(`! ${name} on disk was not the mirror's any more (re-cut tag?) — deleted and re-downloaded`);

  const unpacked = path.join(CACHE, `unpacked-${platform}-v${electronVersion}`);
  const marker = platform === 'darwin-arm64' ? frameworkPathIn(path.join(unpacked, 'Electron.app')) : path.join(unpacked, 'electron.exe');
  // Any fresh download invalidates whatever was unpacked from the previous
  // file, so the marker existing is not enough on its own. Not only a re-cut:
  // a hand-deleted zip beside a leftover unpacked directory is the same trap,
  // and the one case where fresh bytes land on disk and a stale tree is used.
  if (downloaded || !existsSync(marker)) {
    rmSync(unpacked, { recursive: true, force: true });
    mkdirSync(unpacked, { recursive: true });
    run('unzip', ['-q', '-o', zip, '-d', unpacked]);
    console.log(`→ unpacked  ${name} → ${path.basename(unpacked)}`);
  }
  if (!existsSync(marker)) fail(`${name} unpacked without ${path.basename(marker)} — is that really an Electron ${platform} zip?`);
  return { unpacked, marker };
}

/**
 * The mirror's own record of what it patched, fetched fresh for the same reason
 * the checksums are. An empty record would make every `sitesMatch` below pass
 * vacuously, so a record with no sites is a failure here rather than a green
 * release that proves nothing.
 */
async function patchRecord(platform) {
  const url = `${MIRROR}/v${electronVersion}/electron-v${electronVersion}-${platform}.patches.json`;
  let record;
  try {
    record = JSON.parse((await fetchFresh(url)).toString('utf8'));
  } catch (error) {
    fail(`${url} is not valid JSON: ${error.message}`);
  }
  // Shape-checked before it is counted: a malformed record has to come out as a
  // named failure, not a TypeError from inside a reduce.
  if (!record || typeof record !== 'object' || !Array.isArray(record.patches)) {
    fail(`${url} is not a patch record: \`patches\` must be an array`);
  }
  for (const patch of record.patches) {
    if (!patch || typeof patch !== 'object' || !Array.isArray(patch.sites)) {
      fail(`${url} is not a patch record: patch ${JSON.stringify(patch?.name)} has no \`sites\` array`);
    }
  }
  const sites = record.patches.reduce((n, patch) => n + patch.sites.length, 0);
  if (sites === 0) fail(`${url} records no patch sites — there would be nothing to prove`);
  return record;
}

/** Fails unless every site in `record` carries its patched bytes in `file`. */
function requirePatched(file, record, what) {
  const result = sitesMatch(readFileSync(file), record);
  if (!result.ok) {
    const detail = result.mismatches
      .map((m) => `  ${m.patch} @ ${m.offset} (${m.symbol}): expected ${m.expected}, found ${m.found || '(past end of file)'}`)
      .join('\n');
    fail(`${what} does not carry the mirror's patch bytes:\n${detail}`);
  }
  console.log(`✓ ${what} carries all ${result.checked} of the mirror's patch site(s)`);
}

const mac = await mirrorZip('darwin-arm64');
const win = await mirrorZip('win32-x64');
const macPatches = await patchRecord('darwin-arm64');
const winPatches = await patchRecord('win32-x64');
const mirrorFramework = mac.marker;
const mirrorElectronExe = win.marker;

const installedFramework = frameworkPathIn(path.join(DESKTOP, 'node_modules', 'electron', 'dist', 'Electron.app'));
if (!existsSync(installedFramework)) {
  fail(
    `desktop/node_modules/electron/dist is missing — \`npm run electron:fetch\` in desktop/ did not download Electron (check desktop/.npmrc and network)`,
  );
}
if (!readFileSync(mirrorFramework).equals(readFileSync(installedFramework))) {
  fail(
    `desktop/node_modules/electron is NOT the mirror's build — the packaged app would lack the pointer-lock patch. ` +
      `A stale cached zip is the usual cause, and step 2 pins the cache to desktop/.cache/electron: delete that and re-run.`,
  );
}
console.log('✓ installed Electron Framework is byte-identical to the mirror\'s (patch present)');

// ---- 5. package ----------------------------------------------------------------
writeFileSync(PKG, `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
// So the artifacts below are provably from this run, not stale ones
// electron-builder left behind.
rmSync(path.join(DESKTOP, 'dist'), { recursive: true, force: true });

// afterPack.cjs compares the packaged Electron against the first two of these,
// and electron-builder packages the third as the Windows Electron. Asserted
// here rather than left to the builder: electron-builder catches and *swallows*
// a throw from the electronDist hook and falls back to downloading upstream
// Electron, so a missing DAYHIKE_WIN32_DIST has to be caught before it runs.
const packEnv = {
  DAYHIKE_MIRROR_FRAMEWORK: path.resolve(mirrorFramework),
  DAYHIKE_MIRROR_ELECTRON_EXE: path.resolve(mirrorElectronExe),
  DAYHIKE_WIN32_DIST: path.resolve(win.unpacked),
};
for (const [name, value] of Object.entries(packEnv)) {
  if (!value || !existsSync(value)) fail(`${name} would be ${value || '(unset)'}, which does not exist — refusing to run electron-builder with an unproven Electron`);
}
runLoud('npm', ['run', 'pack'], { cwd: DESKTOP, env: { ...process.env, ...packEnv } });

const dmg = path.join(DESKTOP, 'dist', dmgName(version));
if (!existsSync(dmg)) fail(`electron-builder did not produce ${dmg}`);
const installer = path.join(DESKTOP, 'dist', installerName(version));
if (!existsSync(installer)) fail(`electron-builder did not produce ${installer}`);

// ---- 6. smoke the artifact -------------------------------------------------------
const mount = mkdtempSync(path.join(tmpdir(), 'dayhike-dmg-'));
let mounted = false;
try {
  run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, dmg]);
  mounted = true;

  // Prove the artifact, not just the input: electron-builder is told to
  // package desktop/node_modules/electron/dist (step 4 proved that carries
  // the patch), but nothing short of opening the dmg confirms it actually did.
  // The seal rewrote the framework's signature, so equality here is "every
  // byte except the ones codesign owns".
  const app = path.join(mount, 'Day Hike.app');
  const packagedFramework = frameworkPathIn(app);
  if (!existsSync(packagedFramework)) fail(`the mounted dmg has no Electron Framework at ${packagedFramework}`);
  if (!equalOutsideSignature(readFileSync(packagedFramework), readFileSync(mirrorFramework))) {
    fail(`the packaged ${dmgName(version)} does not carry the mirror's Electron Framework code — electron-builder packaged something other than desktop/node_modules/electron/dist`);
  }
  console.log('✓ packaged dmg carries the mirror\'s Electron Framework code (patch present in the artifact)');
  requirePatched(packagedFramework, macPatches, `the Electron Framework inside ${dmgName(version)}`);

  runLoud('node', [path.join(DESKTOP, 'test', 'gatekeeper.mjs'), app]);
  runLoud('node', [path.join(DESKTOP, 'test', 'smoke.mjs'), app]);
} finally {
  if (mounted) run('hdiutil', ['detach', mount, '-force']);
  rmSync(mount, { recursive: true, force: true });
}

// ---- 6b. prove the Windows artifact ------------------------------------------
// electron-builder's NSIS installer is a 7-Zip SFX wrapping $PLUGINSDIR/app-64.7z,
// which holds the packaged app. Two nested extractions get at the exe a player
// will actually run.
const extract = mkdtempSync(path.join(tmpdir(), 'dayhike-nsis-'));
try {
  run('7zz', ['x', `-o${extract}`, installer]);
  const inner = path.join(extract, '$PLUGINSDIR', 'app-64.7z');
  if (!existsSync(inner)) fail(`${installerName(version)} does not contain $PLUGINSDIR/app-64.7z — not an electron-builder NSIS installer?`);
  run('7zz', ['x', `-o${path.join(extract, 'app')}`, inner]);
  const packagedExe = path.join(extract, 'app', 'Day Hike.exe');
  if (!existsSync(packagedExe)) fail(`no Day Hike.exe inside ${installerName(version)}`);
  if (!equalOutsideResources(readFileSync(packagedExe), readFileSync(mirrorElectronExe))) {
    fail(`the packaged ${installerName(version)} does not carry the mirror's electron.exe code — electron-builder packaged something other than the mirror's win32-x64`);
  }
  console.log('✓ packaged installer carries the mirror\'s electron.exe code (patch present in the artifact)');
  requirePatched(packagedExe, winPatches, `Day Hike.exe inside ${installerName(version)}`);
} finally {
  rmSync(extract, { recursive: true, force: true });
}

if (dryRun) {
  console.log(`\n✓ dry run complete — ${dmgName(version)} and ${installerName(version)} both built and proven locally`);
  console.log('  nothing was uploaded, dispatched, committed or tagged; desktop/package.json restored');
  process.exit(0);
}

// Uploaded under a name carrying its own sha8, never the bare artifact name:
// the objects are immutable and cached for a year, so a retried release of the
// same version must not overwrite the previous attempt's bytes (see
// `objectName`). latest.json is the only pointer, so nothing else needs to know
// the name.
const installerSha = sha256(installer);
const installerObjectName = objectName(installerName(version), installerSha);
const installerObject = `gs://${bucket}/desktop/${installerObjectName}`;
const installerUrl = `${downloadsUrl}/desktop/${installerObjectName}`;

// Resolved before anything is uploaded: step 8 commits and tags the release,
// and a detached HEAD has nowhere to put either. Better to stop here than after
// the installer is in the bucket.
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
if (branch === 'HEAD') {
  fail('HEAD is detached, so there is nowhere to commit and tag the release. Release from a branch: git switch <branch>');
}

// `gh workflow run --ref` is resolved by GitHub on the *remote*: the workflow
// that runs is whatever that ref's remote tip carries, not what is in this
// tree. Dispatching against the release branch once ran a stale
// origin/<branch> whose workflow predated the run-name the latch below matches
// on, so the latch could not fire at all and a fully proven release aborted.
// Dispatch against `main` — the only ref a workflow_dispatch workflow is ever
// registered on — and refuse to release unless the file about to run is
// byte-identical to the one in this tree.
const WORKFLOW = '.github/workflows/desktop-smoke-windows.yml';
run('git', ['fetch', 'origin']);
let remoteWorkflow;
try {
  remoteWorkflow = run('git', ['show', `origin/main:${WORKFLOW}`], { encoding: 'buffer' });
} catch {
  fail(`origin/main has no ${WORKFLOW}. Merge the workflow to main before releasing — GitHub runs the copy on the ref, not the one in this tree.`);
}
if (Buffer.compare(readFileSync(WORKFLOW), remoteWorkflow) !== 0) {
  fail(`${WORKFLOW} differs from origin/main's copy, and the Windows smoke would run main's. Merge the workflow change to main first, then release.`);
}

runLoud('gcloud', ['storage', 'cp', '--cache-control=public, max-age=31536000, immutable', installer, installerObject]);

// The only thing that runs the installer before a player does. latest.json is
// not written until this passes, so a failed run leaves an unreferenced object.
//
// `gh workflow run` prints no run id, so the run has to be found afterwards —
// and "the newest run created around now" is not a safe way to find it. A
// concurrent push, a human dispatch, or an overlapping release would be latched
// instead, and the release would then advertise an installer that nothing
// smoked. The workflow's run-name carries the sha256 of the installer it was
// given, which is unique to this artifact, so the match is on that plus the
// dispatch event plus a createdAt no earlier than *this* dispatch, less an
// allowance for clock skew between this Mac and GitHub. The allowance is
// generous (30s) on purpose: uniqueness comes from the sha in the run name, not
// from a tight window, so the only thing a narrow floor buys is a release that
// aborts because the two clocks disagreed by a few seconds. It stays far below
// the minutes a smoke takes, so the re-dispatch below — whose run carries the
// identical title — is still told apart from the first by its own floor. Oldest
// match wins: re-releasing the identical installer waits on the run already in
// flight.
async function smokeOnWindows() {
  const dispatchedAt = new Date();
  runLoud('gh', ['workflow', 'run', 'desktop-smoke-windows.yml', '--ref', 'main', '-f', `url=${installerUrl}`, '-f', `sha256=${installerSha}`]);
  let runId = null;
  let runUrl = '';
  for (let i = 0; i < 30 && runId === null; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    let list;
    try {
      list = JSON.parse(run('gh', ['run', 'list', '--workflow', 'desktop-smoke-windows.yml', '--limit', '10', '--json', 'databaseId,createdAt,event,displayTitle,url']));
      if (!Array.isArray(list)) throw new Error(`gh run list returned ${typeof list}, not an array`);
    } catch (error) {
      // One flaky `gh` call must not abandon a release that has already uploaded.
      console.log(`! gh run list failed (${String(error.message).split('\n')[0]}); retrying`);
      continue;
    }
    const floor = new Date(dispatchedAt.getTime() - 30_000);
    const mine = list
      .filter((r) => r.event === 'workflow_dispatch' && String(r.displayTitle ?? '').includes(installerSha) && new Date(r.createdAt) >= floor)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
    if (mine) {
      runId = String(mine.databaseId);
      runUrl = typeof mine.url === 'string' ? mine.url : '';
    }
  }
  if (runId === null) fail(`no desktop-smoke-windows run named for ${installerSha} appeared within 150s of the dispatch`);
  console.log(`→ windows smoke run ${runId}`);
  const watched = spawnSync('gh', ['run', 'watch', runId, '--exit-status'], { stdio: 'inherit' });
  return { runId, runUrl, ok: watched.status === 0 };
}

// The smoke installs and drives a real GUI on a shared runner. It has been made
// as deterministic as a launch smoke can be, but a single infrastructure hiccup
// must not cost a release that is otherwise fully proven — so one failure buys
// one re-dispatch, and a second failure is the artifact's, not the runner's.
let smoke = await smokeOnWindows();
let reDispatched = false;
if (!smoke.ok) {
  console.log(`! windows smoke failed (run ${smoke.runId}); re-dispatching once`);
  const first = smoke.runId;
  reDispatched = true;
  smoke = await smokeOnWindows();
  if (!smoke.ok) fail(`the Windows launch smoke failed twice (runs ${first} and ${smoke.runId}); nothing was advertised`);
}
console.log('✓ Windows installer installed and launched on a Windows runner');

// ---- 7. publish: artifacts first, latest.json last -------------------------------
const dmgSha = sha256(dmg);
const dmgObjectName = objectName(dmgName(version), dmgSha);
const dmgUrl = `${downloadsUrl}/desktop/${dmgObjectName}`;
runLoud('gcloud', ['storage', 'cp', '--cache-control=public, max-age=31536000, immutable', dmg, `gs://${bucket}/desktop/${dmgObjectName}`]);
const doc = latestJson({
  version,
  publishedAt: new Date().toISOString(),
  platforms: {
    'darwin-arm64': { url: dmgUrl, sha256: dmgSha, size: statSync(dmg).size },
    'win32-x64': { url: installerUrl, sha256: installerSha, size: statSync(installer).size },
  },
});
const latestPath = path.join(CACHE, 'latest.json');
writeFileSync(latestPath, doc);
runLoud('gcloud', ['storage', 'cp', '--cache-control=no-cache', latestPath, `gs://${bucket}/desktop/latest.json`]);

// ---- 8. record -------------------------------------------------------------------
// What the body is for: the re-dispatch above hides a flaky Windows smoke from
// everything except this line. A release whose first run failed looks identical
// to one that passed first time unless the history says so — and the sha8s and
// the run URL are what tie this commit to the exact objects in the bucket and
// the run that installed them. Trailers are the caller's business, not the
// script's: DAYHIKE_COMMIT_TRAILERS is appended verbatim when set.
const trailers = process.env.DAYHIKE_COMMIT_TRAILERS?.trim();
const message = [
  `chore(desktop): release ${version}`,
  '',
  `artifacts: ${installerObjectName}, ${dmgObjectName}`,
  `windows-smoke: run ${smoke.runId}, re-dispatched: ${reDispatched ? 'yes' : 'no'}`,
  smoke.runUrl || `(no run url; gh run view ${smoke.runId})`,
  ...(trailers ? ['', trailers] : []),
].join('\n');
run('git', ['add', PKG]);
run('git', ['commit', '-m', `${message}\n`, '--', PKG]);
run('git', ['tag', `desktop-v${version}`]);
console.log(`\n✓ desktop ${version} published:`);
console.log(`  macOS   ${dmgUrl}`);
console.log(`  Windows ${installerUrl}`);
console.log(`  tagged desktop-v${version} (not pushed)`);
