import { describe, expect, it } from 'vitest';
import { gatePlan, isLight } from '../plan.mjs';

describe('isLight', () => {
  it('takes the tooling, docs, branding and agent files as outside the game', () => {
    for (const path of ['tools/previews/shoot.mjs', 'docs/rendering/2026-10-01-x.md', 'branding/cover/landscape.png', '.agents/skills/github-push/SKILL.md', 'README.md', 'AGENTS.md']) {
      expect(isLight(path)).toBe(true);
    }
  });
  it('takes the WGSL tools as the game, since they make the maps the build ships', () => {
    expect(isLight('tools/wgsl/build-map.mjs')).toBe(false);
  });
  it('takes the game, the server, the build, dependencies, CI and the credits the game renders as the game', () => {
    for (const path of ['client/src/game/app.ts', 'server/src/index.ts', 'package.json', 'package-lock.json', '.github/workflows/test.yml', 'CREDITS.md', 'client/shaders/corpus/ab/1.vertex.glsl', 'eslint.config.js']) {
      expect(isLight(path)).toBe(false);
    }
  });
  it('matches a file by its whole name, not a prefix of it', () => {
    expect(isLight('README.md.bak')).toBe(false);
    expect(isLight('toolsmith/x.mjs')).toBe(false);
  });
});

describe('gatePlan', () => {
  it('gates nothing when nothing changed', () => {
    expect(gatePlan([])).toEqual({ kind: 'none', heavy: [] });
  });
  it('gates a change outside the game lightly, here', () => {
    expect(gatePlan(['tools/previews/lib/cover.mjs', 'branding/cover/portrait.png', 'README.md'])).toEqual({ kind: 'light', heavy: [] });
  });
  it('sends a change that touches the game to the cloud, naming what made it heavy once each', () => {
    expect(gatePlan(['README.md', 'client/src/sim/haunt.ts', 'client/src/sim/haunt.ts', 'package.json'])).toEqual({
      kind: 'cloud',
      heavy: ['client/src/sim/haunt.ts', 'package.json'],
    });
  });
});
