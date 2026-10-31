#!/usr/bin/env node
// The push gate (`npm run gate`): typecheck, lint, the client, server and tools suites, and the
// WGSL maps built from the corpus with their ceiling, run where load cannot fail them. The
// development machine is never quiet (Cyrus, 2026-10-31: other work always runs on it), so the
// load-sensitive part, the client suite with its time limits and its wall-clock tests, is never
// gated on it except when asked for by name (`--local`).
//
//   npm run gate                               the plan for what this branch changes (gate/plan.mjs):
//                                                light: only tooling, docs, branding or agent files:
//                                                       lint and the tools suite, here
//                                                cloud: anything else: the `test` workflow on GitHub's
//                                                       runners for this branch, followed to its end
//   npm run gate -- --plan                     only say which plan, and why
//   npm run gate -- test/sim/a.test.ts ...     only these client test files, here, as the runners run
//                                              them: time limits scaled by 3, wall-clock tests left out
//   npm run gate -- --local                    the whole gate here: an extraordinary case, by name only
//
// The cloud plan runs what is pushed, not this working tree: the branch must be pushed (a work
// branch, never main) and nothing the game ships left uncommitted, or the gate says so and stops.
// Where `DAYHIKE_GATE` names a runner, this checkout and the arguments are handed to it instead and
// its exit is the gate's: a Node script (run with this Node) or an executable, given `--game <this
// checkout>` and the arguments, that runs the same commands, and the client's build as the deploy
// builds it, on other machines and prints one report; it may take options of its own.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gatePlan } from './gate/plan.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const WORKFLOW = 'test.yml';
const args = process.argv.slice(2);
const runner = process.env.DAYHIKE_GATE;
const run = (command, argv, env = process.env) => spawnSync(command, argv, { cwd: REPO, stdio: 'inherit', env }).status ?? 1;
const read = (command, argv) => {
  const r = spawnSync(command, argv, { cwd: REPO, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};
const lines = (text) => (text ? text.split('\n').filter((l) => l.length > 0) : []);
const say = (text) => process.stderr.write(`gate: ${text}\n`);

if (runner) {
  const argv = ['--game', REPO, ...args];
  process.exit(/\.[cm]?js$/.test(runner) ? run(process.execPath, [runner, ...argv]) : run(runner, argv));
}

const OPTIONS = new Set(['--local', '--plan']);
const options = args.filter((a) => a.startsWith('-'));
const unknown = options.filter((o) => !OPTIONS.has(o));
if (unknown.length > 0) {
  say(`${unknown.join(' ')} is the runner's (DAYHIKE_GATE), and none is set; here the gate takes --plan, --local or client test files`);
  process.exit(2);
}
const files = args.filter((a) => !a.startsWith('-'));

/** The whole gate, here: the maps, then typecheck, lint and every suite. */
function local() {
  say('--local: the whole gate on this machine. Its time limits and wall-clock tests assume a quiet machine, which this one rarely is; a timing failure here says nothing about the change.');
  const maps = run(process.execPath, ['tools/wgsl/build-map.mjs', '--reuse']);
  if (maps !== 0) return maps;
  for (const script of ['typecheck', 'lint', 'test']) {
    const code = run('npm', ['run', script]);
    if (code !== 0) return code;
  }
  return 0;
}

if (options.includes('--local')) {
  if (files.length > 0) {
    say('--local runs the whole gate; name client test files without it');
    process.exit(2);
  }
  process.exit(local());
}

if (files.length > 0) {
  // The files as the workflow's runners run them: limits scaled, the bars on elapsed time left out.
  const env = { ...process.env, TEST_TIME_SCALE: process.env.TEST_TIME_SCALE ?? '3' };
  process.exit(run('npx', ['vitest', 'run', '--root', 'client', '--tags-filter=!wall-clock', ...files.map((f) => f.replace(/^client\//, ''))], env));
}

/** Every path this branch changes against main: committed, staged, unstaged and untracked. */
function changedPaths() {
  spawnSync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: REPO, stdio: 'ignore' });
  const base = read('git', ['merge-base', 'HEAD', 'origin/main']);
  if (base === null) {
    say('cannot find where this branch left origin/main');
    process.exit(2);
  }
  return [...lines(read('git', ['diff', '--name-only', base])), ...lines(read('git', ['ls-files', '--others', '--exclude-standard']))];
}

const plan = gatePlan(changedPaths());
const why = plan.kind === 'cloud' ? `, for ${plan.heavy.slice(0, 5).join(', ')}${plan.heavy.length > 5 ? ` and ${plan.heavy.length - 5} more` : ''}` : '';
say(`plan: ${plan.kind}${why}`);
if (options.includes('--plan')) process.exit(0);

if (plan.kind === 'none') process.exit(0);

if (plan.kind === 'light') {
  // Neither has a time limit or a bar on elapsed time: load slows them and cannot fail them.
  const lint = run('npm', ['run', 'lint']);
  if (lint !== 0) process.exit(lint);
  process.exit(run('npx', ['vitest', 'run', '--root', 'tools']));
}

// cloud: the workflow on what is pushed of this branch.
const branch = read('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const head = read('git', ['rev-parse', 'HEAD']);
if (branch === null || branch === 'HEAD' || branch === 'main') {
  say(`the cloud gate runs a pushed work branch, and this is ${branch === 'main' ? 'main' : 'no branch'}: git switch -c <name>, then git push -u origin HEAD`);
  process.exit(3);
}
const dirty = gatePlan([...lines(read('git', ['diff', '--name-only', 'HEAD'])), ...lines(read('git', ['ls-files', '--others', '--exclude-standard']))]).heavy;
if (dirty.length > 0) {
  say(`the cloud gate runs what is pushed, and ${dirty.slice(0, 5).join(', ')} ${dirty.length === 1 ? 'is' : 'are'} not committed: commit, push, and gate again`);
  process.exit(3);
}
spawnSync('git', ['fetch', '--quiet', 'origin', branch], { cwd: REPO, stdio: 'ignore' });
const pushed = read('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
if (pushed !== head) {
  say(`the cloud gate runs what is pushed, and origin/${branch} ${pushed === null ? 'does not exist' : 'is not this commit'}: git push -u origin ${branch}, and gate again`);
  process.exit(3);
}
if (run('gh', ['workflow', 'run', WORKFLOW, '--ref', branch]) !== 0) process.exit(1);
// The run just dispatched: the newest on this branch for this commit, once GitHub lists it.
let id = null;
for (let i = 0; i < 30 && id === null; i++) {
  spawnSync('sleep', ['2']);
  const listed = read('gh', ['run', 'list', '--workflow', WORKFLOW, '--branch', branch, '--event', 'workflow_dispatch', '--limit', '1', '--json', 'databaseId,headSha,status']);
  const [latest] = listed ? JSON.parse(listed) : [];
  if (latest && latest.headSha === head && latest.status !== 'completed') id = String(latest.databaseId);
}
if (id === null) {
  say(`dispatched ${WORKFLOW} on ${branch}, but GitHub has not listed the run: gh run list --workflow ${WORKFLOW} --branch ${branch}`);
  process.exit(1);
}
say(`following run ${id} (gh run view ${id} --web); its \`gates\` job is the result`);
const code = run('gh', ['run', 'watch', id, '--exit-status', '--interval', '30']);
if (code !== 0) say(`run ${id} failed: gh run view ${id} --log-failed`);
process.exit(code);
