import { describe, it, expect } from 'vitest';
import { findAssetUrl } from '../lib/modelUrls.mjs';

const BUNDLE = 'x="/dayhike/assets/intro-Ab12Cd34.mp4";y=`/dayhike/assets/intro.still-Zz99Yy88.webp`';

describe('findAssetUrl', () => {
  it("finds the video's and the still's hashed urls in the bundle", () => {
    expect(findAssetUrl(BUNDLE, 'intro', 'mp4')).toBe('/dayhike/assets/intro-Ab12Cd34.mp4');
    expect(findAssetUrl(BUNDLE, 'intro.still', 'webp')).toBe('/dayhike/assets/intro.still-Zz99Yy88.webp');
  });

  it('gives null for a file the bundle does not reference, rather than a guess', () => {
    expect(findAssetUrl(BUNDLE, 'nothing', 'mp4')).toBeNull();
    expect(findAssetUrl(BUNDLE, 'intro', 'webp')).toBeNull();
  });
});
