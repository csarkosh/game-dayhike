// Every file under docs/ is named YYYY-MM-DD-<topic>.md, so the folder sorts by date and a doc's
// age reads straight off its name. AGENTS.md states the rule; this makes `npm test` hold it.
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DOCS = fileURLToPath(new URL('../../../docs/', import.meta.url));
const NAME = /^(\d{4})-(\d{2})-(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function isRealDate(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day);
}

function misnamed(files) {
  return files.filter((file) => {
    const match = NAME.exec(file.split('/').pop());
    return !match || !isRealDate(match[1], match[2], match[3]);
  });
}

describe('docs/ file names', () => {
  it('accepts a dated kebab-case markdown name and rejects everything else', () => {
    expect(misnamed([
      'rendering/2026-09-14-stylized-shader-looks.md',
      'rendering/stylized-shader-looks.md',
      'rendering/2026-9-14-looks.md',
      'rendering/2026-02-30-looks.md',
      'rendering/2026-09-14-Looks.md',
      'rendering/2026-09-14_looks.md',
      'rendering/2026-09-14-looks.html',
    ])).toEqual([
      'rendering/stylized-shader-looks.md',
      'rendering/2026-9-14-looks.md',
      'rendering/2026-02-30-looks.md',
      'rendering/2026-09-14-Looks.md',
      'rendering/2026-09-14_looks.md',
      'rendering/2026-09-14-looks.html',
    ]);
  });

  it('holds for every file in docs/', () => {
    const files = existsSync(DOCS) ? listFiles(DOCS).map((file) => relative(DOCS, file)) : [];
    expect(misnamed(files)).toEqual([]);
  });
});
