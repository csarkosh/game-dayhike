// terraform test pins every variable (tests/plan.tftest.hcl) so that a
// person's terraform.tfvars cannot change a run's result. This checks that
// the pins are exactly variables.tf's defaults, so that the runs still test
// the module as it is used:
//
//   node --test _infra/test-rig-gcp/tests/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const dir = new URL('..', import.meta.url);
const variables = readFileSync(new URL('variables.tf', dir), 'utf8');
const plan = readFileSync(new URL('tests/plan.tftest.hcl', dir), 'utf8');

const defaults = Object.fromEntries([...variables.matchAll(/^variable "([^"]+)" \{([\s\S]*?)\n\}/gm)].map(([, name, body]) => {
  const m = /^ {2}default\s+=\s+(.+)$/m.exec(body);
  return [name, m ? m[1].trim() : undefined];
}));

// The file-level variables block: the first `variables {` at the start of a
// line, outside any run.
const pinned = Object.fromEntries([.../^variables \{\n([\s\S]*?)\n\}/m.exec(plan)[1].matchAll(/^ {2}(\w+)\s+=\s+(.+)$/gm)]
  .map(([, name, value]) => [name, value.trim()]));

test('every variable has a default, and terraform test pins every one to exactly it', () => {
  assert.ok(Object.keys(defaults).length >= 20);
  for (const [name, value] of Object.entries(defaults)) {
    assert.notEqual(value, undefined, `${name} has a default`);
    assert.equal(pinned[name], value, `${name} is pinned to its default`);
  }
  assert.deepEqual(Object.keys(pinned).sort(), Object.keys(defaults).sort());
});

test('the default zone is us-west1-a, where the machine was made', () => {
  assert.equal(defaults.zone, '"us-west1-a"');
});
