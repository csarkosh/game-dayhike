import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('the engine-named variables', () => {
  it('has the gate read ENGINE_GATE before the old DAYHIKE_GATE, with a notice for the old one', () => {
    const gate = source('../../gate.mjs');
    expect(gate).toContain('process.env.ENGINE_GATE || process.env.DAYHIKE_GATE');
    expect(gate).toContain('DAYHIKE_GATE is read for now; set ENGINE_GATE instead');
  });

  it.each(['../../rig/session.sh', '../../frame-budget/rig/round.sh'])('has %s read ENGINE_LAB, then DAYHIKE_LAB, with the same default path', (path) => {
    const script = source(path);
    expect(script).toContain('lab="${ENGINE_LAB:-${DAYHIKE_LAB:-/Volumes/CyrusExtSSD/dayhike-lab}}"');
    expect(script).toContain('DAYHIKE_LAB is read for now; set ENGINE_LAB instead');
    expect(script).toContain('or set ENGINE_LAB');
  });
});
