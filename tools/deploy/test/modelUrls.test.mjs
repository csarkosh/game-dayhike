import { describe, it, expect } from 'vitest';
import { findModelUrls } from '../lib/modelUrls.mjs';

// A slice shaped like the real entry chunk: the model URLs appear as bare string
// literals inside minified code, which is all `findModelUrls` gets to work with.
const BUNDLE =
  'const e={nathan:"/assets/ranger.nathan-BCzVRFA1.glb",hollow:"/assets/hollow.antlered-m6YRToXT.glb"},' +
  't=["/assets/tree.giant_fir-Bwk1QSVv.glb","/assets/clutter.fungus_b-9_nsqWvr.glb"];';

describe('findModelUrls', () => {
  it('finds the hashed URL a bundle references for each id', () => {
    expect(findModelUrls(BUNDLE, ['ranger.nathan', 'hollow.antlered'])).toEqual({
      'ranger.nathan': '/assets/ranger.nathan-BCzVRFA1.glb',
      'hollow.antlered': '/assets/hollow.antlered-m6YRToXT.glb',
    });
  });

  it('accepts the full base64url hash alphabet Vite uses', () => {
    // `-` and `_` both appear in real hashes (`clutter.fungus_b-9_nsqWvr`). A
    // regex built for `[A-Za-z0-9]` alone would silently miss roughly a third of
    // the models, and the caller would report them as missing from the bundle.
    expect(findModelUrls(BUNDLE, ['clutter.fungus_b'])).toEqual({
      'clutter.fungus_b': '/assets/clutter.fungus_b-9_nsqWvr.glb',
    });
  });

  it('omits an id the bundle does not reference rather than guessing a URL', () => {
    // The caller turns an absent id into a loud failure. Returning a plausible
    // path here instead would send it fetching a 404 and blaming hosting.
    expect(findModelUrls(BUNDLE, ['ranger.nathan', 'ranger.absent'])).toEqual({
      'ranger.nathan': '/assets/ranger.nathan-BCzVRFA1.glb',
    });
    expect(findModelUrls('', ['ranger.nathan'])).toEqual({});
  });

  it('treats the dot in an id as a literal, not a wildcard', () => {
    // Catalog ids all contain a `.`. Unescaped it matches any character, so
    // `ranger.nathan` would happily claim a URL belonging to something else.
    expect(findModelUrls('"/assets/rangerXnathan-BCzVRFA1.glb"', ['ranger.nathan'])).toEqual({});
  });

  it('does not match an id that is only a prefix of the emitted name', () => {
    // `tree.conifer_a` must not claim `tree.conifer_ab`'s URL: the `-` before
    // the hash is what separates the name from it.
    expect(findModelUrls('"/assets/tree.conifer_ab-Xy1zzzzz.glb"', ['tree.conifer_a'])).toEqual({});
  });

  it('does not claim a sibling id whose extra segment is separated by a dash', () => {
    // The subtle one, and the reason the hash length is pinned. base64url hashes
    // contain `-`, so an open `+` quantifier lets `ranger.nathan` swallow the `v2-`
    // of `ranger.nathan-v2` and return that model's URL instead. `deploy:verify`
    // would fetch the sibling, find a real glTF, and pass the id it never
    // checked. Nothing about an id's shape rules out a `-`, so this is
    // reachable the day someone adds one.
    expect(findModelUrls('"/assets/ranger.nathan-v2-BCzVRFA1.glb"', ['ranger.nathan'])).toEqual({});
    expect(findModelUrls('"/assets/tree.conifer-a-b-Xy1zzzzz.glb"', ['tree.conifer-a'])).toEqual(
      {},
    );
  });

  it('still finds an id that does contain a dash, when it is the real one', () => {
    // The flip side: pinning the length must not make a hyphenated id
    // undiscoverable. `ranger.nathan-v2` finds its own URL in the same source that
    // `ranger.nathan` is correctly refused.
    expect(findModelUrls('"/assets/ranger.nathan-v2-BCzVRFA1.glb"', ['ranger.nathan-v2'])).toEqual({
      'ranger.nathan-v2': '/assets/ranger.nathan-v2-BCzVRFA1.glb',
    });
  });

  it('does not accept the unhashed dev path', () => {
    // `/assets/models/<id>.glb` is what Vite serves in development. Seeing it on
    // the live site would mean the deploy shipped something that is not a
    // production build — exactly the state this check exists to catch, so it must
    // read as "not found" rather than as a pass.
    expect(findModelUrls('"/assets/models/ranger.nathan.glb"', ['ranger.nathan'])).toEqual({});
  });

  it('captures the base-absolute prefix a non-root `base` build carries', () => {
    // Vite bakes `base` into every asset URL it emits. The web build's base is
    // "/dayhike/", so its URLs are `/dayhike/assets/<id>-<hash>.glb`, not the
    // bare `/assets/...` path. Returning the bare suffix here would send the
    // caller fetching against the site's origin, which Firebase's `**` rewrite
    // answers with the redirect page's HTML — a 200 that is not the model.
    const bundle = 'const e={nathan:"/dayhike/assets/ranger.nathan-BCzVRFA1.glb"};';
    expect(findModelUrls(bundle, ['ranger.nathan'])).toEqual({
      'ranger.nathan': '/dayhike/assets/ranger.nathan-BCzVRFA1.glb',
    });
  });

  it('accepts a backtick-delimited URL, which the minifier emits for plain strings', () => {
    // The first production verify after the site move failed here: every model
    // was in the bundle, delimited by backticks rather than quotes.
    const bundle = 'const e={nathan:`/dayhike/assets/ranger.nathan-BCzVRFA1.glb`};';
    expect(findModelUrls(bundle, ['ranger.nathan'])).toEqual({
      'ranger.nathan': '/dayhike/assets/ranger.nathan-BCzVRFA1.glb',
    });
  });

  it('still returns the bare path a base "/" build emits (the desktop build)', () => {
    expect(findModelUrls(BUNDLE, ['ranger.nathan'])).toEqual({
      'ranger.nathan': '/assets/ranger.nathan-BCzVRFA1.glb',
    });
  });

  it('keeps two ids’ prefixes separate rather than confusing one for the other', () => {
    // Each match's captured prefix has to come from its own quoted string. A
    // regex that reached backward past the opening quote could bleed one URL's
    // prefix into a neighboring URL for a different id.
    const bundle =
      '"/legacy/assets/ranger.nathan-AAAAAAAA.glb","/dayhike/assets/hollow.antlered-BBBBBBBB.glb"';
    expect(findModelUrls(bundle, ['ranger.nathan', 'hollow.antlered'])).toEqual({
      'ranger.nathan': '/legacy/assets/ranger.nathan-AAAAAAAA.glb',
      'hollow.antlered': '/dayhike/assets/hollow.antlered-BBBBBBBB.glb',
    });
  });

  it('does not let unrelated source before the opening quote leak into the prefix', () => {
    // `[^"']*` is bounded by the quote characters, so it cannot walk back past
    // where the current string literal opened — even when what precedes it is
    // full of `/`-shaped noise that a looser regex might have swallowed.
    const bundle = 'const x = a/b/c; const y="/dayhike/assets/ranger.nathan-BCzVRFA1.glb";';
    expect(findModelUrls(bundle, ['ranger.nathan'])).toEqual({
      'ranger.nathan': '/dayhike/assets/ranger.nathan-BCzVRFA1.glb',
    });
  });
});
