#!/usr/bin/env node
// Run a built Day Hike.app in smoke mode and relay its verdict.
// Usage: node desktop/test/smoke.mjs "/path/to/Day Hike.app" [--needs-hike]
// --needs-hike: this machine has a graphics card, so only a hike passes; without
// it the page the site shows a visitor who cannot play passes too.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const needsHike = args.includes('--needs-hike');
const appPath = args.find((arg) => !arg.startsWith('--'));
if (!appPath) {
  console.error('usage: smoke.mjs <path/to/Day Hike.app> [--needs-hike]');
  process.exit(2);
}
const binary = path.join(appPath, 'Contents', 'MacOS', 'Day Hike');
if (!existsSync(binary)) {
  console.error(`not an app bundle (no ${binary})`);
  process.exit(2);
}

const env = { ...process.env, DAYHIKE_SMOKE: '1' };
delete env.DAYHIKE_URL; // a release smoke is always against production, whatever the operator's shell exports
delete env.DAYHIKE_SMOKE_NEEDS_HIKE; // the flag decides, not the operator's shell
if (needsHike) env.DAYHIKE_SMOKE_NEEDS_HIKE = '1';

const child = spawn(binary, [], {
  env,
  // stderr inherited too: when the JSON lines never appear at all, Electron's
  // own stderr (dyld, GPU, "app is damaged") is the only thing that says why.
  stdio: ['ignore', 'inherit', 'inherit'],
});
const killer = setTimeout(() => {
  console.error('smoke: killed after 60 s');
  child.kill('SIGKILL');
}, 60000);
child.on('exit', (code, signal) => {
  clearTimeout(killer);
  process.exit(code ?? (signal ? 3 : 1));
});
