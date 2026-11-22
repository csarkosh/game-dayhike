#!/usr/bin/env node
// Moves into the engine package every file of client/src that can go: one that is not Day
// Hike's (dayhike.json) and refers to nothing left behind. Every reference to a moved file, in
// the client, the engine, the tests and the tools, is rewritten. `--dry` says what would move.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closedSet, graphOf, rewrite, walk } from './lib/graph.mjs';
import { matcher, pathLiterals } from './lib/paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolvePath(here, '../..');
const dry = process.argv.includes('--dry');
const why = process.argv.includes('--why');
const roots = { client: join(repo, 'client/src'), engine: join(repo, 'engine/src') };
const lists = JSON.parse(readFileSync(join(here, 'dayhike.json'), 'utf8'));
const isDayhike = matcher(lists.dayhike);
const isHeld = matcher(Object.keys(lists.hold));

const clientFiles = walk(roots.client);
const engineFiles = walk(roots.engine);
const others = [...walk(join(repo, 'client/test')), ...walk(join(repo, 'engine/test')), ...walk(join(repo, 'engine/testing')), ...walk(join(repo, 'tools')).filter((f) => !f.includes('node_modules'))].filter((f) =>
  /\.(ts|mts|mjs|js)$/.test(f),
);
const rel = (f) => relative(roots.client, f);
const candidates = clientFiles.filter((f) => !isDayhike(rel(f)) && !isHeld(rel(f)));
const graph = graphOf([...clientFiles, ...engineFiles], roots);
const { set, held } = closedSet(candidates, graph, new Set(engineFiles));
const moved = new Map([...set].map((f) => [f, join(roots.engine, rel(f))]));

const lines = (fs) => fs.filter((f) => f.endsWith('.ts')).reduce((n, f) => n + readFileSync(f, 'utf8').split('\n').length, 0);
console.log(`candidates ${candidates.length}, moving ${set.size} (${lines([...set])} lines of TypeScript), held back ${held.size}`);
if (why) {
  const blockers = new Map();
  for (const [, { outside, stranded }] of held) {
    for (const t of [...outside, ...stranded]) if (!candidates.includes(t)) blockers.set(t, (blockers.get(t) ?? 0) + 1);
  }
  for (const [t, n] of [...blockers].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), rel(t));
}
if (dry) {
  for (const f of [...set].sort()) console.log('  ' + rel(f));
  process.exit(0);
}
if (set.size === 0) process.exit(0);

// Every new text is worked out against the tree as it stands, then the files move, then the texts are written.
const texts = new Map();
for (const file of [...clientFiles, ...engineFiles, ...others]) {
  if (!/\.(ts|mts|mjs|js)$/.test(file)) continue;
  const now = moved.get(file) ?? file;
  const before = readFileSync(file, 'utf8');
  let after = rewrite(before, file, now, moved, roots);
  if (others.includes(file)) after = pathLiterals(after, file, moved, join(repo, 'client'));
  if (after !== before) texts.set(now, after);
}
for (const [from, to] of moved) {
  mkdirSync(dirname(to), { recursive: true });
  execFileSync('git', ['mv', from, to], { cwd: repo });
}
for (const [file, text] of texts) writeFileSync(file, text);
console.log(`moved ${moved.size} files, rewrote ${texts.size}`);

// What a move cannot rewrite by itself: a test that names a moved file by its path under src/.
const named = [];
const movedRel = new Set([...moved.keys()].map(rel));
for (const file of others) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, 'utf8');
  const hits = [...text.matchAll(/["'`]((?:game|sim|net)\/[\w./-]+\.(?:ts|wgsl))["'`]/g)].map((m) => m[1]).filter((p) => movedRel.has(p));
  if (hits.length > 0) named.push(`${relative(repo, file)}: ${[...new Set(hits)].join(' ')}`);
}
if (named.length > 0) console.log(`\nnamed by a path under src/, to fix by hand:\n${named.join('\n')}`);
