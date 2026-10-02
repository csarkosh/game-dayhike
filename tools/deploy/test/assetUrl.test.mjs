import { describe, it, expect } from 'vitest';
import { filmUrls, findAssetUrl } from '../lib/modelUrls.mjs';

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

describe('filmUrls', () => {
  it('reads the films and the title still from the entry and the chunks it names, read together', () => {
    const built = 'import("./engineChoice-A1.js")\nx="/dayhike/assets/title-Ab12Cd34.mp4";y="/dayhike/assets/title.still-Zz99Yy88.webp";z="/dayhike/assets/intro-Qq11Ww22.mp4"';
    expect(filmUrls(built)).toEqual({
      introFilm: '/dayhike/assets/intro-Qq11Ww22.mp4',
      titleFilm: '/dayhike/assets/title-Ab12Cd34.mp4',
      titleStill: '/dayhike/assets/title.still-Zz99Yy88.webp',
    });
    expect(filmUrls('import("./engineChoice-A1.js")')).toEqual({ introFilm: null, titleFilm: null, titleStill: null });
  });
});
