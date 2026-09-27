// Checks of probe.mjs's judgements, on sample reports; no Windows, no Chrome:
//
//   node --test _infra/test-rig/tests/probe.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dcvConnectionCount, lastFailure, licenceState, verdict, warnings } from '../probe.mjs';

const vws = licenceState('    vGPU Software Licensed Product\n        Product Name : NVIDIA RTX Virtual Workstation\n        License Status : Licensed (Expiry: N/A)\n');
// What Chrome 154 reported on an Apple M4 (SystemInfo.getInfo): the feature
// names and values the rule reads.
const chrome154 = {
  '2d_canvas': 'enabled', direct_rendering_display_compositor: 'disabled_off_ok', gpu_compositing: 'enabled',
  multiple_raster_threads: 'enabled_on', opengl: 'enabled_on', rasterization: 'enabled', raw_draw: 'disabled_off_ok',
  skia_graphite: 'enabled_on', trees_in_viz: 'disabled_off', video_decode: 'enabled', video_encode: 'enabled',
  webgl: 'enabled', webgpu: 'enabled', webnn: 'disabled_off',
};
const good = (over = {}) => ({
  webgl: 'ANGLE (NVIDIA, NVIDIA Tesla T4 (0x00001EB8) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  webgpu: { vendor: 'nvidia', architecture: 'turing', fallback: false },
  featureStatus: chrome154,
  imdsReachable: false,
  browserImds: { reachable: false, detail: 'net::ERR_NETWORK_ACCESS_DENIED' },
  dcvConnections: { before: 0, during: 0, after: 0 },
  session: { name: 'Console', id: 1 },
  runs: [],
  nvidia: { gpuName: 'Tesla T4', chromeSamples: 5, licence: vws },
  ...over,
});
const fails = (over) => verdict(good(over));

test('a correct T4 and a correct L4 pass', () => {
  assert.deepEqual(fails({}), []);
  assert.deepEqual(fails({
    webgl: 'ANGLE (NVIDIA, NVIDIA L4 (0x000027B8) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    nvidia: { gpuName: 'NVIDIA L4', chromeSamples: 3, licence: vws },
  }), []);
});

test('a renderer that is not this machine\'s NVIDIA GPU fails', () => {
  for (const webgl of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA L4 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'no WebGL2',
  ]) assert.equal(fails({ webgl }).length, 1, webgl);
});

test('the licence must be a licensed Virtual Workstation', () => {
  assert.equal(fails({ nvidia: { gpuName: 'Tesla T4', chromeSamples: 5, licence: licenceState('vGPU Software Licensed Product\n Product Name : NVIDIA Virtual Applications\n License Status : Licensed (Expiry: N/A)') } }).length, 1);
  assert.equal(fails({ nvidia: { gpuName: 'Tesla T4', chromeSamples: 5, licence: licenceState('vGPU Software Licensed Product\n Product Name : NVIDIA RTX Virtual Workstation\n License Status : Unlicensed (Restricted)') } }).length, 1);
  assert.equal(licenceState('GPU 00000000:00:1E.0\n    Product Name : Tesla T4\n').product, '');
});

test('nvidia-smi must list chrome.exe, in the console session', () => {
  assert.equal(fails({ nvidia: { gpuName: 'Tesla T4', chromeSamples: 0, licence: vws } }).length, 1);
  assert.equal(fails({ session: { name: 'Services', id: 0 } }).length, 1);
  assert.equal(fails({ session: { name: '', id: Number.NaN } }).length, 1);
});

test('Chrome\'s own feature status must say hardware for WebGL, compositing and rasterization', () => {
  assert.equal(fails({ featureStatus: { ...chrome154, gpu_compositing: 'disabled_software' } }).length, 1);
  assert.equal(fails({ featureStatus: { ...chrome154, webgl: 'unavailable_software' } }).length, 1);
  assert.equal(fails({ featureStatus: { ...chrome154, rasterization: 'disabled_software' } }).length, 1);
  assert.equal(fails({ featureStatus: { ...chrome154, rasterization: 'enabled_on' } }).length, 0);
  assert.equal(fails({ featureStatus: undefined }).length, 3);
});

test('a fallback WebGPU adapter fails; none, or another vendor, only warns', () => {
  assert.equal(fails({ webgpu: { vendor: 'google', fallback: true } }).length, 1);
  assert.equal(fails({ webgpu: 'no adapter' }).length, 0);
  assert.equal(warnings(good({ webgpu: 'no adapter' })).length, 1);
  assert.equal(warnings(good({ webgpu: { vendor: 'microsoft', fallback: false } })).length, 1);
});

test('any DCV client, or a count that cannot be read, fails', () => {
  for (const dcvConnections of [
    { before: 0, during: 1, after: 0 }, { before: 0, during: 0, after: 1 },
    { before: 0, during: null, after: 0 }, { before: 0, during: 0, after: null }, undefined,
  ]) assert.equal(fails({ dcvConnections }).length, 1, JSON.stringify(dcvConnections));
  assert.equal(dcvConnectionCount('{"id":"console","num-of-connections":0}\r\n'), 0);
  assert.equal(dcvConnectionCount('{"num-of-connections":2}'), 2);
  assert.throws(() => dcvConnectionCount('{"id":"console"}'));
  assert.throws(() => dcvConnectionCount('Session console not found'));
  assert.throws(() => dcvConnectionCount('﻿{"num-of-connections":0}'));
});

test('the metadata service must be unreachable from Node and from Chrome', () => {
  assert.equal(fails({ imdsReachable: true }).length, 1);
  assert.equal(fails({ imdsReachable: undefined }).length, 1);
  assert.equal(fails({ browserImds: { reachable: true, detail: 'answered' } }).length, 1);
  assert.equal(fails({ browserImds: undefined }).length, 1);
});

test('every run must load and draw', () => {
  assert.equal(fails({ runs: [{ loaded: false, error: 'net::ERR_NAME_NOT_RESOLVED' }] }).length, 1);
  assert.equal(fails({ runs: [{ loaded: true, frames: 0 }] }).length, 1);
  assert.equal(fails({ runs: [{ loaded: true, frames: 3600 }] }).length, 0);
});

test('a 60 Hz cap warns; the set-up log\'s last failure is found', () => {
  assert.ok(warnings(good({ refreshHz: 60, display: { cappedAt60OrLower: true } })).some((w) => w.includes('60 Hz')));
  assert.equal(lastFailure('a\r\nx FAILED: one\r\nb\r\ny FAILED: two\r\nc'), 'y FAILED: two');
  assert.equal(lastFailure('all fine\n'), null);
});
