import { describe, expect, it } from 'vitest';
import { closedSet, referencesIn, rewrite, specifierFor } from '../lib/graph.mjs';
import { matcher, pathLiterals } from '../lib/paths.mjs';

const roots = { client: '/r/client/src', engine: '/r/engine/src' };

describe('the references a file writes', () => {
  it('finds each way a module is named, and tells a path on disk from a module', () => {
    const text = [
      'import { a } from "./a.js";',
      'import type { B } from "../sim/b.js";',
      'import "./register.js";',
      'export { c } from "./c.js";',
      'import shader from "./shaders/x.wgsl?raw";',
      'const w = new Worker(new URL("./x.worker.ts", import.meta.url), { type: "module" });',
      'const m = await import("./lazy.js");',
      'type T = typeof import("./types.js");',
      'vi.mock("../../src/game/d.js", () => ({}));',
    ].join('\n');
    expect(referencesIn(text).map((r) => [r.spec, r.kind])).toEqual([
      ['./a.js', 'module'],
      ['../sim/b.js', 'module'],
      ['./register.js', 'module'],
      ['./c.js', 'module'],
      ['./shaders/x.wgsl?raw', 'file'],
      ['./x.worker.ts', 'file'],
      ['./lazy.js', 'module'],
      ['./types.js', 'module'],
      ['../../src/game/d.js', 'module'],
    ]);
  });

  it('says where each specifier is written', () => {
    const text = 'import { a } from "./a.js";\nimport "./b.js";';
    expect(referencesIn(text).map((r) => text.slice(r.start, r.end))).toEqual(['./a.js', './b.js']);
  });
});

describe('the set that can move together', () => {
  const graph = (edges, asFile = []) => ({ edges: new Map(Object.entries(edges).map(([k, v]) => [k, new Set(v)])), asFile: new Set(asFile) });

  it('keeps a cycle whole and drops what reaches a file left behind, however far', () => {
    const g = graph({ a: ['b'], b: ['a'], c: ['game'], d: ['c'], e: [], game: [] });
    const { set, held } = closedSet(['a', 'b', 'c', 'd', 'e'], g);
    expect([...set].sort()).toEqual(['a', 'b', 'e']);
    expect(held.get('c').outside).toEqual(['game']);
    expect(held.get('d').outside).toEqual(['c']);
  });

  it('lets a file refer to what the engine already has', () => {
    const g = graph({ a: ['old'], old: [] });
    expect([...closedSet(['a'], g, new Set(['old'])).set]).toEqual(['a']);
  });

  it('leaves a shader, a worker or an asset behind while a file left behind still names it, and its other users with it', () => {
    const g = graph({ a: ['x.wgsl'], game: ['x.wgsl'], 'x.wgsl': [], b: ['y.wgsl'], 'y.wgsl': [] }, ['x.wgsl', 'y.wgsl']);
    const { set, held } = closedSet(['a', 'b', 'x.wgsl', 'y.wgsl'], g);
    expect([...set].sort()).toEqual(['b', 'y.wgsl']);
    expect(held.get('x.wgsl').stranded).toEqual(['game']);
  });
});

describe('a reference after a move', () => {
  it('names an engine module by the package from outside it, and by a relative path from inside', () => {
    expect(specifierFor('/r/client/src/app.ts', '/r/engine/src/sim/field.ts', 'module', '', roots)).toBe('@csarkosh/engine/sim/field');
    expect(specifierFor('/r/client/test/sim/a.test.ts', '/r/engine/src/sim/field.ts', 'module', '', roots)).toBe('@csarkosh/engine/sim/field');
    expect(specifierFor('/r/engine/src/game/sky.ts', '/r/engine/src/sim/field.ts', 'module', '', roots)).toBe('../sim/field.js');
    expect(specifierFor('/r/engine/src/game/sky.ts', '/r/engine/src/game/skyState.ts', 'module', '', roots)).toBe('./skyState.js');
  });

  it('names a path on disk by a relative path wherever it is read from, with its query', () => {
    expect(specifierFor('/r/engine/src/game/lite/post.ts', '/r/engine/src/game/shaders/post/a.wgsl', 'file', '?raw', roots)).toBe('../shaders/post/a.wgsl?raw');
    expect(specifierFor('/r/client/test/game/a.test.ts', '/r/engine/src/game/shaders/post/a.wgsl', 'file', '?raw', roots)).toBe(
      '../../../engine/src/game/shaders/post/a.wgsl?raw',
    );
    expect(specifierFor('/r/engine/src/game/skyWorker.ts', '/r/engine/src/game/sky.worker.ts', 'file', '', roots)).toBe('./sky.worker.ts');
  });

  it('refuses an engine file a reference to the game', () => {
    expect(() => specifierFor('/r/engine/src/game/sky.ts', '/r/client/src/game/hud.ts', 'module', '', roots)).toThrow(/is the engine's/);
  });

  it('rewrites only the references the move touches, to the letter otherwise', () => {
    const files = new Set(['/r/client/src/game/a.ts', '/r/client/src/game/b.ts', '/r/client/src/game/hud.ts', '/r/client/src/sim/c.ts']);
    const exists = (f) => files.has(f);
    const moved = new Map([
      ['/r/client/src/game/a.ts', '/r/engine/src/game/a.ts'],
      ['/r/client/src/sim/c.ts', '/r/engine/src/sim/c.ts'],
    ]);
    const hud = 'import { a } from "./a.js";\nimport { b } from "./b.js";\nimport type { C } from "../sim/c.js";\n';
    expect(rewrite(hud, '/r/client/src/game/hud.ts', '/r/client/src/game/hud.ts', moved, roots, exists)).toBe(
      'import { a } from "@csarkosh/engine/game/a";\nimport { b } from "./b.js";\nimport type { C } from "@csarkosh/engine/sim/c";\n',
    );
    const a = 'import { c } from "../sim/c.js";\nimport lite from "@babylonjs/lite";\n';
    expect(rewrite(a, '/r/client/src/game/a.ts', '/r/engine/src/game/a.ts', moved, roots, exists)).toBe(a);
  });
});

describe('the lists and the paths a test reads', () => {
  it('matches a pattern exactly, or by prefix where it ends in a star', () => {
    const is = matcher(['app.ts', 'game/way*', 'game/scene/*']);
    expect(['app.ts', 'game/wayHaze.ts', 'game/scene/intro.ts', 'game/water.ts', 'sim/app.ts'].map(is)).toEqual([true, true, true, false, false]);
  });

  it('rewrites the path of a moved file, read from the test or from the client folder, and no other string', () => {
    const moved = new Map([['/r/client/src/game/a.ts', '/r/engine/src/game/a.ts']]);
    const text = 'read("../../src/game/a.ts"); read("src/game/a.ts"); read("../../src/game/hud.ts"); const s = "game/a.ts";';
    expect(pathLiterals(text, '/r/client/test/game/x.test.ts', moved, '/r/client')).toBe(
      'read("../../../engine/src/game/a.ts"); read("../engine/src/game/a.ts"); read("../../src/game/hud.ts"); const s = "game/a.ts";',
    );
  });
});
