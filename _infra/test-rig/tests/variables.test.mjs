// terraform test pins every variable (tests/plan.tftest.hcl), and most of its
// runs test ../modules/aws-test-rig directly, which takes every input from
// those pins. This checks that the pins are exactly variables.tf's defaults
// and that main.tf passes each variable to the module unchanged, so that the
// runs still test the machine as this root makes it:
//
//   node --test _infra/test-rig/tests/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const dir = new URL('..', import.meta.url);
const variables = readFileSync(new URL('variables.tf', dir), 'utf8');
const main = readFileSync(new URL('main.tf', dir), 'utf8');
const plan = readFileSync(new URL('tests/plan.tftest.hcl', dir), 'utf8');
const moduleVariables = readFileSync(new URL('../modules/aws-test-rig/variables.tf', dir), 'utf8');

const defaults = Object.fromEntries([...variables.matchAll(/^variable "([^"]+)" \{([\s\S]*?)\n\}/gm)].map(([, name, body]) => {
  const m = /^ {2}default\s+=\s+(.+)$/m.exec(body);
  return [name, m ? m[1].trim() : undefined];
}));

// The file-level variables block: the first `variables {` at the start of a
// line, outside any run.
const pinned = Object.fromEntries([.../^variables \{\n([\s\S]*?)\n\}/m.exec(plan)[1].matchAll(/^ {2}(\w+)\s+=\s+(.+)$/gm)]
  .map(([, name, value]) => [name, value.trim()]));

// The one module call's arguments, `name = value` at its top level.
const call = /^module "test_rig" \{\n([\s\S]*?)\n\}/m.exec(main)[1];
const passed = Object.fromEntries([...call.matchAll(/^ {2}(\w+)\s+=\s+(.+)$/gm)].map(([, name, value]) => [name, value.trim()]));

// The module's input set from this root's locals rather than a variable.
const tags = /^locals \{\n {2}tags = (.+)\n\}/m.exec(main)[1];

test('every variable has a default, and terraform test pins every one to exactly it', () => {
  assert.ok(Object.keys(defaults).length >= 16);
  for (const [name, value] of Object.entries(defaults)) {
    assert.notEqual(value, undefined, `${name} has a default`);
    assert.equal(pinned[name], value, `${name} is pinned to its default`);
  }
  assert.deepEqual(Object.keys(pinned).sort(), [...Object.keys(defaults), 'tags'].sort());
  assert.equal(pinned.tags, tags, 'tags is pinned to what main.tf passes');
});

test('main.tf passes every variable to the module unchanged, and the module takes nothing else', () => {
  for (const name of Object.keys(defaults)) {
    assert.equal(passed[name], `var.${name}`, `${name} is passed as var.${name}`);
  }
  assert.equal(passed.tags, 'local.tags');
  assert.equal(passed.source, '"../modules/aws-test-rig"');
  const inputs = [...moduleVariables.matchAll(/^variable "([^"]+)"/gm)].map(([, name]) => name);
  assert.deepEqual(inputs.sort(), [...Object.keys(defaults), 'tags'].sort());
});
