// The import graph the engine split works from: every file under a source tree, what each
// refers to, and where in its text each reference is written, so a move can rewrite it.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';

export const ENGINE_PACKAGE = '@csarkosh/engine';

/**
 * The ways a file names another: `module` references are resolved by the bundler and may cross
 * a package by its name; `file` references (a worker's entry, a shader's text, an asset's
 * address, a path a test reads) are paths on disk and cannot.
 */
const REFERENCES = [
  { kind: 'module', re: /\bfrom\s*(["'])([^"'\n]+)\1/g },
  { kind: 'module', re: /(?:^|[\n;])\s*import\s*(["'])([^"'\n]+)\1/g },
  { kind: 'module', re: /\bimport\s*\(\s*(["'])([^"'\n]+)\1/g },
  { kind: 'module', re: /\bvi\.(?:mock|doMock|unmock|doUnmock|importActual|importMock)\(\s*(["'])([^"'\n]+)\1/g },
  { kind: 'file', re: /\bnew URL\(\s*(["'])([^"'\n]+)\1\s*,\s*import\.meta\.url/g },
];

/** Every reference written in `text`: its specifier, its kind and where the specifier's text starts and ends. */
export function referencesIn(text) {
  const found = [];
  for (const { kind, re } of REFERENCES) {
    for (const m of text.matchAll(re)) {
      const spec = m[2];
      const start = m.index + m[0].lastIndexOf(spec);
      found.push({ spec, kind: spec.includes('?') ? 'file' : kind, start, end: start + spec.length });
    }
  }
  found.sort((a, b) => a.start - b.start);
  return found.filter((r, i) => i === 0 || r.start !== found[i - 1].start);
}

export function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const posix = (p) => p.split(sep).join('/');

/**
 * The file a specifier written in `from` names, as an absolute path, or null where it names a
 * package or nothing on disk. `roots.engine` is where the engine package's modules are.
 */
export function resolve(from, spec, roots, exists = existsSync) {
  const bare = spec.replace(/[?#].*$/, '');
  let base;
  if (bare.startsWith('.')) base = normalize(join(dirname(from), bare));
  else if (bare.startsWith(`${ENGINE_PACKAGE}/`)) base = join(roots.engine, bare.slice(ENGINE_PACKAGE.length + 1));
  else return null;
  const tries = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`];
  for (const t of tries) if (exists(t) && !isDirectory(t)) return t;
  return null;
}

function isDirectory(path) {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The graph of `files` (absolute paths): for each, the files it refers to. A file that is not
 * TypeScript refers to nothing. `asFile` holds every file some reference names by a path on
 * disk (a worker's entry, a shader, an asset).
 */
export function graphOf(files, roots, read = (f) => readFileSync(f, 'utf8')) {
  const edges = new Map();
  const asFile = new Set();
  for (const file of files) {
    const targets = new Set();
    if (/\.(ts|mts|mjs|js)$/.test(file)) {
      for (const ref of referencesIn(read(file))) {
        const target = resolve(file, ref.spec, roots);
        if (target === null) continue;
        targets.add(target);
        if (ref.kind === 'file' || !target.endsWith('.ts')) asFile.add(target);
      }
    }
    edges.set(file, targets);
  }
  return { edges, asFile };
}

/**
 * The largest set of `candidates` that can move together: a file in it refers only to files in
 * it or files already in the engine, and a file named by a path on disk is in it only if every
 * file that names it is too. Returns the set and, for each candidate left out, what held it.
 */
export function closedSet(candidates, graph, alreadyEngine = new Set()) {
  const set = new Set(candidates);
  const held = new Map();
  const namedBy = new Map();
  for (const [file, targets] of graph.edges) {
    for (const t of targets) {
      if (!namedBy.has(t)) namedBy.set(t, []);
      namedBy.get(t).push(file);
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const file of [...set]) {
      const outside = [...(graph.edges.get(file) ?? [])].filter((t) => !set.has(t) && !alreadyEngine.has(t));
      const stranded = graph.asFile.has(file) ? (namedBy.get(file) ?? []).filter((f) => !set.has(f) && !alreadyEngine.has(f)) : [];
      if (outside.length > 0 || stranded.length > 0) {
        set.delete(file);
        held.set(file, { outside, stranded });
        changed = true;
      }
    }
  }
  return { set, held };
}

/** The specifier `from` should write to name `to`, given which package each is in. */
export function specifierFor(from, to, kind, query, roots) {
  const fromEngine = posix(from).startsWith(`${posix(roots.engine)}/`);
  const toEngine = posix(to).startsWith(`${posix(roots.engine)}/`);
  if (fromEngine && !toEngine) throw new Error(`${from} is the engine's and would refer to ${to}, which is not`);
  if (!fromEngine && toEngine && kind === 'module' && to.endsWith('.ts')) {
    return `${ENGINE_PACKAGE}/${posix(relative(roots.engine, to)).replace(/\.ts$/, '')}${query}`;
  }
  let rel = posix(relative(dirname(from), to));
  if (!rel.startsWith('.')) rel = `./${rel}`;
  if (kind === 'module' && rel.endsWith('.ts')) rel = rel.replace(/\.ts$/, '.js');
  return `${rel}${query}`;
}

/**
 * `text` of the file that was at `was` and is now at `now`, with every reference rewritten for
 * a move: `moved` maps a file's old path to its new one. A reference the move does not touch
 * keeps its text to the letter.
 */
export function rewrite(text, was, now, moved, roots, exists = existsSync) {
  let out = '';
  let at = 0;
  for (const ref of referencesIn(text)) {
    const target = resolve(was, ref.spec, roots, exists);
    if (target === null) continue;
    const targetNow = moved.get(target) ?? target;
    if (targetNow === target && now === was) continue;
    const query = ref.spec.match(/[?#].*$/)?.[0] ?? '';
    const kind = ref.kind === 'file' ? 'file' : 'module';
    const next = specifierFor(now, targetNow, kind, query, roots);
    if (next === ref.spec) continue;
    out += text.slice(at, ref.start) + next;
    at = ref.end;
  }
  return out + text.slice(at);
}
