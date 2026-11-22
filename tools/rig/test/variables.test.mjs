import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the rig session script\'s engine-named variable', () => {
  it('reads ENGINE_LAB, then DAYHIKE_LAB, with the same default path as before', () => {
    const script = readFileSync(new URL('../session.sh', import.meta.url), 'utf8');
    expect(script).toContain('lab="${ENGINE_LAB:-${DAYHIKE_LAB:-/Volumes/CyrusExtSSD/dayhike-lab}}"');
    expect(script).toContain('DAYHIKE_LAB is read for now; set ENGINE_LAB instead');
    expect(script).toContain('or set ENGINE_LAB');
  });
});
