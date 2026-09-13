import { describe, it, expect } from 'vitest';
import { findTextureUrls } from '../lib/modelUrls.mjs';

// A slice shaped like the real entry chunk: eighteen ground textures, six
// layers times albedo / normal / rah, as bare string literals inside
// minified code.
const BUNDLE =
  'const g={' +
  'grass:"/dayhike/assets/ground.grass-AAAAAAAA.webp",' +
  'grassN:"/dayhike/assets/ground.grass.normal-BBBBBBBB.webp",' +
  'grassR:"/dayhike/assets/ground.grass.rah-CCCCCCCC.webp",' +
  'asphalt:"/dayhike/assets/ground.asphalt-DDDDDDDD.webp",' +
  'asphaltR:"/dayhike/assets/ground.asphalt.rah-EEEEEEEE.webp"' +
  '};';

describe('findTextureUrls', () => {
  it('finds the hashed URL a bundle references for a ground texture id', () => {
    expect(findTextureUrls(BUNDLE, ['ground.grass'])).toEqual({
      'ground.grass': '/dayhike/assets/ground.grass-AAAAAAAA.webp',
    });
  });

  it('does not let a layer id match its own .normal or .rah sibling, or vice versa', () => {
    // `ground.grass` is a literal prefix of `ground.grass.rah`'s emitted name,
    // but the character right after the escaped id must be `-`; in
    // `ground.grass.rah-CCCCCCCC.webp` it is `.`, so the shorter id cannot
    // claim the longer one's URL, and the longer id cannot claim the
    // shorter one's — same trap `findModelUrls` guards against for a
    // hyphenated id, here for a dotted one.
    expect(findTextureUrls(BUNDLE, ['ground.grass', 'ground.grass.normal', 'ground.grass.rah'])).toEqual({
      'ground.grass': '/dayhike/assets/ground.grass-AAAAAAAA.webp',
      'ground.grass.normal': '/dayhike/assets/ground.grass.normal-BBBBBBBB.webp',
      'ground.grass.rah': '/dayhike/assets/ground.grass.rah-CCCCCCCC.webp',
    });
  });

  it('finds all eighteen ids a real bundle would carry, in one pass', () => {
    const layers = ['grass', 'forest_floor', 'rock', 'sand', 'pebble', 'asphalt'];
    const ids = layers.flatMap((id) => [`ground.${id}`, `ground.${id}.normal`, `ground.${id}.rah`]);
    const bundle = ids.map((id, i) => `"/dayhike/assets/${id}-${String(i).padStart(8, '0')}.webp"`).join(',');
    const found = findTextureUrls(bundle, ids);
    expect(Object.keys(found)).toHaveLength(18);
    for (const id of ids) expect(found[id]).toContain(`${id}-`);
  });

  it('omits an id the bundle does not reference, rather than guessing a URL', () => {
    expect(findTextureUrls(BUNDLE, ['ground.grass', 'ground.absent'])).toEqual({
      'ground.grass': '/dayhike/assets/ground.grass-AAAAAAAA.webp',
    });
  });

  it('does not accept a .glb URL for a texture id, or vice versa', () => {
    // findModelUrls and findTextureUrls share the matcher but not the
    // extension; a model id's .glb URL must not satisfy a texture lookup.
    expect(findTextureUrls('"/assets/ground.grass-AAAAAAAA.glb"', ['ground.grass'])).toEqual({});
  });

  it('still returns the bare path a base "/" build emits (the desktop build)', () => {
    const bundle = '"/assets/ground.asphalt.rah-FFFFFFFF.webp"';
    expect(findTextureUrls(bundle, ['ground.asphalt.rah'])).toEqual({
      'ground.asphalt.rah': '/assets/ground.asphalt.rah-FFFFFFFF.webp',
    });
  });
});
