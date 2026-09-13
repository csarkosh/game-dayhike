#!/usr/bin/env node
// Prove a built Day Hike.app survives Gatekeeper the way a player meets it:
// downloaded by a browser, quarantined, double-clicked.
// Usage: node desktop/test/gatekeeper.mjs "/path/to/Day Hike.app"
//
// Two layers, because the first alone was not enough. `syspolicy_check`
// cleared a bundle that macOS 26 still rejected as "damaged" at launch — the
// only oracle that matches the player's experience is the launch itself.
//
//  1. Static: `codesign --verify --deep --strict` — the exact check whose
//     failure text Gatekeeper's "damaged" dialog quotes — plus a bundle-level
//     seal on the outer app (a linker-signed executable has none).
//  2. Live: copy the app, mark it quarantined as a browser download would,
//     `open` it and read what macOS says. "damaged" fails. "Apple could not
//     verify" passes — that is the ad-hoc verdict, recoverable through
//     Privacy & Security → Open Anyway, until a Developer ID exists. A launch
//     with no dialog passes too (a notarized future). No verdict within the
//     timeout fails: the test could not observe anything.
//
// Layer 2 drives System Events, so the terminal needs Accessibility access;
// without it the test fails closed with the reason.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const appPath = process.argv[2];
if (!appPath || !existsSync(path.join(appPath, 'Contents', 'MacOS'))) {
  console.error('usage: gatekeeper.mjs <path/to/Day Hike.app>');
  process.exit(2);
}

const fail = (msg) => {
  console.error(`gatekeeper: FAIL — ${msg}`);
  process.exit(1);
};
const codesign = (args) => spawnSync('codesign', args, { encoding: 'utf8' });

// ---- 1. static ----------------------------------------------------------------
const verify = codesign(['--verify', '--deep', '--strict', '--verbose=2', appPath]);
if (verify.status !== 0) fail(`codesign --verify --deep --strict:\n${verify.stderr.trim()}`);
const info = codesign(['-dv', '--verbose=2', appPath]).stderr;
if (!/^Sealed Resources version=\d+/m.test(info)) fail(`the app bundle has no resource seal:\n${info.trim()}`);
if (/linker-signed/.test(info)) fail(`the app executable is only linker-signed:\n${info.trim()}`);
console.log('gatekeeper: static — signature verifies deep and strict, bundle is sealed');

// ---- 2. live ------------------------------------------------------------------
const osa = (script) => spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
const probe = osa('tell application "System Events" to get name of every process');
if (probe.status !== 0) {
  fail(`cannot drive System Events (grant this terminal Accessibility access in System Settings):\n${probe.stderr.trim()}`);
}

const dir = mkdtempSync(path.join(tmpdir(), 'dayhike-gatekeeper-'));
const copy = path.join(dir, path.basename(appPath));
const dismiss = () => {
  osa('tell application "System Events" to tell process "CoreServicesUIAgent" to click (first button of window 1 whose name is "Done" or name is "Cancel")');
};
const dialogText = () => {
  const r = osa('tell application "System Events" to tell process "CoreServicesUIAgent" to get value of every static text of window 1');
  return r.status === 0 ? r.stdout.trim() : '';
};
const running = () => spawnSync('pgrep', ['-f', copy]).status === 0;

try {
  cpSync(appPath, copy, { recursive: true });
  // Flags 0081 / agent Chrome: what a browser download carries.
  const stamp = Math.floor(Date.now() / 1000).toString(16);
  execFileSync('xattr', ['-w', 'com.apple.quarantine', `0081;${stamp};Chrome;${crypto.randomUUID().toUpperCase()}`, copy]);
  execFileSync('open', [copy]);

  const deadline = Date.now() + 30_000;
  let verdict = null;
  while (Date.now() < deadline && verdict === null) {
    const text = dialogText();
    if (text !== '') verdict = { kind: 'dialog', text };
    else if (running()) verdict = { kind: 'launched' };
    else execFileSync('sleep', ['1']);
  }
  if (verdict === null) fail('no Gatekeeper verdict observed within 30 s (no dialog, app not running)');
  if (verdict.kind === 'launched') {
    console.log('gatekeeper: live — the quarantined app launched with no dialog');
  } else {
    console.log(`gatekeeper: live — macOS said: ${verdict.text}`);
    dismiss();
    if (/damaged/i.test(verdict.text)) fail('Gatekeeper reports the app as damaged — the bundle seal is invalid');
    if (!/could not verify/i.test(verdict.text)) {
      console.log('gatekeeper: (unfamiliar dialog text; not "damaged", so accepted — read it)');
    }
  }
} finally {
  dismiss();
  spawnSync('pkill', ['-f', copy]);
  rmSync(dir, { recursive: true, force: true });
}
console.log('gatekeeper: PASS');
