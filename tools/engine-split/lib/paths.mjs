// Paths the engine split reads from its lists and rewrites in tests.
import { dirname, join, normalize, relative, sep } from 'node:path';

/** A test for a path against a list of patterns: one ending in `*` matches by prefix, any other exactly. */
export function matcher(patterns) {
  const exact = new Set(patterns.filter((p) => !p.endsWith('*')));
  const prefixes = patterns.filter((p) => p.endsWith('*')).map((p) => p.slice(0, -1));
  return (path) => {
    const p = path.split(sep).join('/');
    return exact.has(p) || prefixes.some((prefix) => p.startsWith(prefix));
  };
}

/**
 * `text` of `file` with every string that is the path of a moved file rewritten to where the
 * file went. A path is read from the file's own folder first, then from `base` (the folder a
 * test run starts in), and written back the same way.
 */
export function pathLiterals(text, file, moved, base) {
  return text.replace(/(["'`])((?:\.{1,2}\/)*(?:[\w.-]+\/)*src\/[\w./-]+\.\w+)\1/g, (whole, quote, path) => {
    for (const from of [dirname(file), base]) {
      const target = moved.get(normalize(join(from, path)));
      if (target === undefined) continue;
      let next = relative(from, target).split(sep).join('/');
      if (path.startsWith('./') || (from === dirname(file) && !next.startsWith('.'))) next = `./${next}`;
      return `${quote}${next}${quote}`;
    }
    return whole;
  });
}
