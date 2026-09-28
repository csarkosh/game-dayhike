// Checks of probe.mjs's judgements, on sample reports; no Windows, no Chrome:
//
//   node --test _infra/test-rig-gcp/tests/*.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeRemoteSessions, lastFailure, licenceState, sessions, verdict, warnings } from '../probe.mjs';

// `nvidia-smi -q` as Google documents it for a properly licensed RTX Virtual
// Workstation, and for a GPU attached without the licence.
const licensed = (product, status) => licenceState([
  'Driver Version                            : 582.53',
  'GPU 00000000:00:03.0',
  '    Product Name                          : NVIDIA L4',
  '    vGPU Software Licensed Product',
  `        Product Name                      : ${product}`,
  `        License Status                    : ${status}`,
].join('\r\n'));
const vws = licensed('NVIDIA RTX Virtual Workstation', 'Licensed (Expiry: Permanent)');

// What Chrome 154 reported on an Apple M4 (SystemInfo.getInfo): the feature
// names and values the rule reads.
const chrome154 = {
  '2d_canvas': 'enabled', direct_rendering_display_compositor: 'disabled_off_ok', gpu_compositing: 'enabled',
  multiple_raster_threads: 'enabled_on', opengl: 'enabled_on', rasterization: 'enabled', raw_draw: 'disabled_off_ok',
  skia_graphite: 'enabled_on', trees_in_viz: 'disabled_off', video_decode: 'enabled', video_encode: 'enabled',
  webgl: 'enabled', webgpu: 'enabled', webnn: 'disabled_off',
};
const good = (over = {}) => ({
  webgl: 'ANGLE (NVIDIA, NVIDIA L4 (0x000027B8) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  webgpu: { vendor: 'nvidia', architecture: 'lovelace', fallback: false },
  featureStatus: chrome154,
  metadataReachable: false,
  browserMetadata: { reachable: false, detail: 'net::ERR_CONNECTION_REFUSED' },
  remoteSessions: { before: 0, during: 0, after: 0 },
  session: { name: 'Console', id: 1 },
  runs: [],
  nvidia: { gpuName: 'NVIDIA L4', chromeSamples: 5, licence: vws },
  ...over,
});
const fails = (over) => verdict(good(over));

test('a correct L4 and a correct T4 pass', () => {
  assert.deepEqual(fails({}), []);
  assert.deepEqual(fails({
    webgl: 'ANGLE (NVIDIA, NVIDIA Tesla T4 (0x00001EB8) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    nvidia: { gpuName: 'Tesla T4', chromeSamples: 3, licence: vws },
  }), []);
});

test('the licence must be exactly a licensed NVIDIA RTX Virtual Workstation', () => {
  assert.equal(vws.ok, true);
  assert.equal(vws.driver, '582.53');
  // Google's example of a GPU attached without the workstation licence: it
  // reads "Licensed", and Google says it gives no GPU acceleration.
  const vapps = licensed('NVIDIA Virtual Applications', 'Licensed (Expiry: N/A)');
  assert.equal(vapps.ok, false);
  assert.equal(fails({ nvidia: { gpuName: 'NVIDIA L4', chromeSamples: 5, licence: vapps } }).length, 1);
  assert.equal(licensed('NVIDIA RTX Virtual Workstation', 'Unlicensed (Restricted)').ok, false);
  assert.equal(licensed('NVIDIA Cloud Gaming', 'Licensed (Expiry: N/A)').ok, false);
  assert.equal(licensed('NVIDIA RTX Virtual Workstation Something Else', 'Licensed').ok, false);
  // The GPU's own product name, with no licence section, is not taken.
  const none = licenceState('GPU 00000000:00:03.0\n    Product Name : NVIDIA L4\n');
  assert.equal(none.product, '');
  assert.equal(none.ok, false);
});

test('a renderer that is not this machine\'s NVIDIA GPU fails', () => {
  for (const webgl of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA Tesla T4 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'no WebGL2',
  ]) assert.equal(fails({ webgl }).length, 1, webgl);
});

test('nvidia-smi must list chrome.exe, in the console session', () => {
  assert.equal(fails({ nvidia: { gpuName: 'NVIDIA L4', chromeSamples: 0, licence: vws } }).length, 1);
  assert.equal(fails({ session: { name: 'Services', id: 0 } }).length, 1);
  assert.equal(fails({ session: { name: 'RDP-Tcp#0', id: 2 } }).length, 1);
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

test('any active Remote Desktop session, or a count that cannot be read, fails', () => {
  for (const remoteSessions of [
    { before: 0, during: 1, after: 0 }, { before: 0, during: 0, after: 1 },
    { before: 0, during: null, after: 0 }, { before: 0, during: 0, after: null }, undefined,
  ]) assert.equal(fails({ remoteSessions }).length, 1, JSON.stringify(remoteSessions));
});

test('qwinsta: an active Remote Desktop session counts; the console, a listener and a disconnected session do not', () => {
  const nobody = [
    ' SESSIONNAME       USERNAME                 ID  STATE   TYPE        DEVICE',
    ' services                                    0  Disc',
    ' console           hiker                     1  Active',
    ' rdp-tcp#3         rdp-admin                 3  Disc',
    ' rdp-tcp                                 65536  Listen',
  ].join('\r\n');
  assert.equal(activeRemoteSessions(nobody).length, 0);
  assert.deepEqual(sessions(nobody).find((s) => s.name === 'console'), { name: 'console', user: 'hiker', id: 1, state: 'Active' });
  assert.deepEqual(sessions(nobody).find((s) => s.name === 'services'), { name: 'services', user: '', id: 0, state: 'Disc' });
  assert.equal(sessions(nobody).length, 4);
  const connected = `${nobody}\r\n>rdp-tcp#4         rdp-admin                 4  Active`;
  assert.deepEqual(activeRemoteSessions(connected), [{ name: 'rdp-tcp#4', user: 'rdp-admin', id: 4, state: 'Active' }]);
  // The desktop user signed in over Remote Desktop: its session has left the
  // console.
  const moved = ' services  0  Disc\r\n console  1  Conn\r\n rdp-tcp#0  hiker  2  Active';
  assert.equal(activeRemoteSessions(moved).length, 1);
  assert.equal(sessions(moved).some((s) => s.name === 'console' && s.user === 'hiker'), false);
});

test('the metadata server must be unreachable from Node and from Chrome', () => {
  assert.equal(fails({ metadataReachable: true }).length, 1);
  assert.equal(fails({ metadataReachable: undefined }).length, 1);
  assert.equal(fails({ browserMetadata: { reachable: true, detail: 'answered' } }).length, 1);
  assert.equal(fails({ browserMetadata: undefined }).length, 1);
});

test('every run must load and draw', () => {
  assert.equal(fails({ runs: [{ loaded: false, error: 'net::ERR_NAME_NOT_RESOLVED' }] }).length, 1);
  assert.equal(fails({ runs: [{ loaded: true, frames: 0 }] }).length, 1);
  assert.equal(fails({ runs: [{ loaded: true, frames: 3600 }] }).length, 0);
});

test('a 60 Hz cap and a second display adapter warn; the set-up log\'s last failure is found', () => {
  assert.ok(warnings(good({ refreshHz: 60, display: { cappedAt60OrLower: true } })).some((w) => w.includes('60 Hz')));
  assert.ok(warnings(good({ display: { adapters: ['NVIDIA L4: 1920x1080 at 60 Hz', 'Google Virtual Display: 1024x768 at 60 Hz'] } })).some((w) => w.includes('2 display adapters')));
  assert.equal(lastFailure('a\r\nx FAILED: one\r\nb\r\ny FAILED: two\r\nc'), 'y FAILED: two');
  assert.equal(lastFailure('all fine\n'), null);
});
