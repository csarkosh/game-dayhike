#!/usr/bin/env node
// The push gate (`npm run gate`): typecheck, lint, and the client, server and tools suites.
//
//   npm run gate                               the whole gate
//   npm run gate -- test/sim/a.test.ts ...     only these client test files
//
// Where `DAYHIKE_GATE` names a runner, this checkout and the arguments are handed to it and its
// exit is the gate's: a Node script (run with this Node) or an executable, given `--game <this
// checkout>` and the arguments, that runs the same commands, and the client's build as the deploy
// builds it, on other machines and prints one report; it may take options of its own. Without
// one, the gates run here, one after another: `npm run typecheck && npm run lint && npm test`, or
// only the client test files named.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const runner = process.env.DAYHIKE_GATE;
const run = (command, argv) => spawnSync(command, argv, { cwd: REPO, stdio: 'inherit' }).status ?? 1;

if (runner) {
  const argv = ['--game', REPO, ...args];
  process.exit(/\.[cm]?js$/.test(runner) ? run(process.execPath, [runner, ...argv]) : run(runner, argv));
}
const options = args.filter((a) => a.startsWith('-'));
if (options.length > 0) {
  console.error(`gate: ${options.join(' ')} is the runner's (DAYHIKE_GATE), and none is set; here the gate takes only client test files`);
  process.exit(2);
}
if (args.length > 0) process.exit(run('npx', ['vitest', 'run', '--root', 'client', ...args.map((f) => f.replace(/^client\//, ''))]));
for (const script of ['typecheck', 'lint', 'test']) {
  const code = run('npm', ['run', script]);
  if (code !== 0) process.exit(code);
}
