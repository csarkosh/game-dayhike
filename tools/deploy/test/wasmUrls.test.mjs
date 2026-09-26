import { describe, it, expect } from 'vitest';
import { findChunkName, findWasmUrls, isWasm } from '../lib/modelUrls.mjs';

// Slices shaped like the real build: the entry chunk names the WebGPU chunk
// twice (the dynamic import and Vite's preload map), and that chunk names the
// two translators as base-absolute template literals.
const ENTRY =
  'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/sceneLoader-os_RrmwX.js",' +
  '"assets/gpuEngine-Dkfp_V_x.js","assets/engineChoice-D0AmugX4.js"])))=>i.map(i=>d[i]);' +
  'async function pU(e,t){let n;try{n=await W(()=>import(`./gpuEngine-Dkfp_V_x.js`),__vite__mapDeps([1,2]))}catch{}}';
const CHUNK =
  'var dr=`/dayhike/assets/glslang-DqqdIFnr.js`,fr=`/dayhike/assets/glslang-G7Yt_-32.wasm`,' +
  'pr=`/dayhike/assets/twgsl-DqdFeK3J.js`,mr=`/dayhike/assets/twgsl-CB--yrSG.wasm`;';

describe('findChunkName', () => {
  it('finds the WebGPU chunk the entry splits out, as a bare file name', () => {
    expect(findChunkName(ENTRY, 'gpuEngine')).toBe('gpuEngine-Dkfp_V_x.js');
  });

  it('resolves against the entry chunk to the sibling file, from either spelling', () => {
    const entryUrl = 'https://games.csarko.sh/dayhike/assets/index-BMM3ei2z.js';
    expect(new URL(findChunkName(ENTRY, 'gpuEngine'), entryUrl).href).toBe(
      'https://games.csarko.sh/dayhike/assets/gpuEngine-Dkfp_V_x.js',
    );
  });

  it('does not match inside a longer chunk name, and finds nothing where there is none', () => {
    expect(findChunkName('"assets/xgpuEngine-Dkfp_V_x.js"', 'gpuEngine')).toBeNull();
    expect(findChunkName('"assets/gpuEngine.pure-Dkfp_V_x.js"', 'gpuEngine')).toBeNull();
    expect(findChunkName('', 'gpuEngine')).toBeNull();
  });
});

describe('findWasmUrls', () => {
  it('finds both translators, and not their JavaScript loaders', () => {
    expect(findWasmUrls(CHUNK, ['glslang', 'twgsl'])).toEqual({
      glslang: '/dayhike/assets/glslang-G7Yt_-32.wasm',
      twgsl: '/dayhike/assets/twgsl-CB--yrSG.wasm',
    });
  });

  it('omits a translator the chunk does not name', () => {
    expect(findWasmUrls('`/dayhike/assets/glslang-G7Yt_-32.wasm`', ['glslang', 'twgsl'])).toEqual({
      glslang: '/dayhike/assets/glslang-G7Yt_-32.wasm',
    });
  });
});

describe('isWasm', () => {
  it('knows the WebAssembly magic', () => {
    expect(isWasm(Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]))).toBe(true);
    // An LFS pointer, and the SPA rewrite's HTML, are what a broken deploy serves.
    expect(isWasm(Buffer.from('version https://git-lfs.github.com/spec/v1'))).toBe(false);
    expect(isWasm(Buffer.from('<!doctype html>'))).toBe(false);
    expect(isWasm(Buffer.from([0x00, 0x61]))).toBe(false);
  });
});
