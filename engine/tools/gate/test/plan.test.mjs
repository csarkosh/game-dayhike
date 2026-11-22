import { describe, expect, it } from 'vitest';
import { gatePlan, isLight } from '../plan.mjs';

describe('isLight', () => {
  it('takes the tooling, docs, branding and agent files as outside the game', () => {
    for (const path of ['tools/previews/shoot.mjs', 'docs/rendering/2026-10-01-x.md', 'branding/cover/landscape.png', '.agents/skills/github-push/SKILL.md', 'README.md', 'AGENTS.md']) {
      expect(isLight(path)).toBe(true);
    }
  });
  it('takes the kernel\'s tools as the game, since they make the module the build ships', () => {
    expect(isLight('engine/tools/rust/build.mjs')).toBe(false);
    expect(isLight('engine/tools/rust/lib/stamp.mjs')).toBe(false);
  });
  it('takes the game, the server, the build, dependencies, CI and the credits the game renders as the game', () => {
    for (const path of ['client/src/game/app.ts', 'server/src/index.ts', 'package.json', 'package-lock.json', '.github/workflows/test.yml', 'CREDITS.md', 'client/vite.config.ts', 'eslint.config.js']) {
      expect(isLight(path)).toBe(false);
    }
  });
  it('takes the engine\'s tools as tooling, as tools/ was, and the rest of the engine as the game', () => {
    for (const path of ['engine/tools/gate.mjs', 'engine/tools/gate/plan.mjs', 'engine/tools/frame-budget/measure.mjs', 'engine/tools/previews/shoot.mjs', 'engine/tools/compare/lib/score.mjs', 'engine/tools/vendor-ktx2.mjs', 'engine/tools/vite/test/preset.test.mjs', 'engine/tools/vitest.config.mjs']) {
      expect(isLight(path)).toBe(true);
    }
    for (const path of ['engine/src/shell.ts', 'engine/test/shell.test.ts', 'engine/assets/x.png', 'engine/vite/preset.mjs', 'engine/package.json', 'engine/rust/field/src/lib.rs', 'engine/toolsmith/x.mjs']) {
      expect(isLight(path)).toBe(false);
    }
  });
  it('keeps Day Hike\'s own tools, the deploy scripts among them, as tooling', () => {
    for (const path of ['tools/deploy/client.mjs', 'tools/rig/session.sh', 'tools/frame-budget/views.json', 'tools/previews/stills.json']) {
      expect(isLight(path)).toBe(true);
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
  it('gates a change to the engine\'s tools lightly, and one to its kernel\'s build or its source as the game', () => {
    expect(gatePlan(['engine/tools/gate.mjs', 'engine/tools/frame-budget/README.md'])).toEqual({ kind: 'light', heavy: [] });
    expect(gatePlan(['engine/tools/gate.mjs', 'engine/tools/rust/build.mjs', 'engine/src/shell.ts'])).toEqual({
      kind: 'cloud',
      heavy: ['engine/src/shell.ts', 'engine/tools/rust/build.mjs'],
    });
  });
  it('sends a change that touches the game to the cloud, naming what made it heavy once each', () => {
    expect(gatePlan(['README.md', 'client/src/sim/haunt.ts', 'client/src/sim/haunt.ts', 'package.json'])).toEqual({
      kind: 'cloud',
      heavy: ['client/src/sim/haunt.ts', 'package.json'],
    });
  });
});
