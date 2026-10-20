import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pageUrl } from '../record.mjs';

const PAGES = JSON.parse(readFileSync(new URL('../record-pages.json', import.meta.url), 'utf8'));

describe('the recorded pages', () => {
  it('names each page once, each a held scene or commands in the game', () => {
    const names = PAGES.pages.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of PAGES.pages) {
      expect(p.name).toMatch(/^[a-z][a-z-]*$/);
      expect((p.route === undefined) !== (p.cmd === undefined), p.name).toBe(true);
    }
    expect(PAGES.seconds).toBeGreaterThan(0);
  });

  it('opens each on the WebGPU path, on the tier given, recording, with no telemetry', () => {
    const [title, start] = [PAGES.pages.find((p) => p.name === 'title'), PAGES.pages.find((p) => p.name === 'start')];
    expect(pageUrl('http://localhost:5173/dayhike/', PAGES.game, title, 'medium')).toBe(
      'http://localhost:5173/dayhike/scene/title?step=760&engine=webgpu&tier=medium&wgsl=record&telemetry=off',
    );
    expect(pageUrl('http://localhost:5173/dayhike', PAGES.game, start, 'high')).toBe(
      `http://localhost:5173/dayhike/game/${PAGES.game}?cmd=seed%20atmo;escalation%200;unsettle%200&engine=webgpu&tier=high&wgsl=record&telemetry=off`,
    );
  });
});
