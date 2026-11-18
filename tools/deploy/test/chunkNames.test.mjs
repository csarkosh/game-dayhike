import { describe, it, expect } from 'vitest';
import { findChunkNames } from '../lib/modelUrls.mjs';

// The entry names a static chunk as `./runtime-<hash>.js` in an import,
// a dynamic one as `./renderer-<hash>.js` and again as `assets/renderer-<hash>.js`
// in Vite's preload map; each chunk once, whatever it is called.
const ENTRY =
  'import{a}from"./runtime-C-SPe7lC.js";import{b}from`./logger-CuBYPcDK.js`;' +
  'const m=["assets/renderer-Ab12Cd34.js","assets/runtime-C-SPe7lC.js"];' +
  'import("./renderer-Ab12Cd34.js");x="/dayhike/assets/ranger.nathan-CMRxslGv.glb"';

describe('findChunkNames', () => {
  it('lists every chunk file the entry names, once each, in order of first mention', () => {
    expect(findChunkNames(ENTRY)).toEqual(['runtime-C-SPe7lC.js', 'logger-CuBYPcDK.js', 'renderer-Ab12Cd34.js']);
  });

  it('lists a chunk whose own name holds hyphens, by the eight characters before .js', () => {
    const entry = 'import{a}from"./pbr-renderable-bKjoH0NY.js";import("./gltf-feature-interactivity-CWPDPR0s.js");import{b}from"./runtime-C-SPe7lC.js"';
    expect(findChunkNames(entry)).toEqual(['pbr-renderable-bKjoH0NY.js', 'gltf-feature-interactivity-CWPDPR0s.js', 'runtime-C-SPe7lC.js']);
  });

  it('names no chunk in an entry that imports none, and never a model', () => {
    expect(findChunkNames('x="/dayhike/assets/ranger.nathan-CMRxslGv.glb"')).toEqual([]);
  });
});
