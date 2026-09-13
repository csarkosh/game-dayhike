import { describe, it, expect } from 'vitest';
import { redirectTarget, renderRedirectPage } from '../lib/redirectPage.mjs';

const opts = { legacyHost: 'game.csarko.sh', base: 'https://games.csarko.sh/dayhike' };

describe('redirectTarget', () => {
  it('carries an old-host path and query across', () => {
    expect(redirectTarget({ host: 'game.csarko.sh', pathname: '/game/abc', search: '?cmd=seed%20x' }, opts)).toBe(
      'https://games.csarko.sh/dayhike/game/abc?cmd=seed%20x',
    );
    expect(redirectTarget({ host: 'game.csarko.sh', pathname: '/', search: '' }, opts)).toBe(
      'https://games.csarko.sh/dayhike/',
    );
  });
  it('sends the new root and the default hostnames to the game', () => {
    expect(redirectTarget({ host: 'games.csarko.sh', pathname: '/', search: '' }, opts)).toBe(
      'https://games.csarko.sh/dayhike/',
    );
    expect(redirectTarget({ host: 'fps-csarko.web.app', pathname: '/anything', search: '?x' }, opts)).toBe(
      'https://games.csarko.sh/dayhike/',
    );
  });
});

describe('renderRedirectPage', () => {
  const html = renderRedirectPage(opts);
  it('embeds the same function the tests above exercised', () => {
    expect(html).toContain('function redirectTarget');
    expect(html).toContain(JSON.stringify(opts));
  });
  it('has a meta refresh and a link as fallbacks', () => {
    expect(html).toMatch(/<meta http-equiv="refresh" content="0;url=https:\/\/games\.csarko\.sh\/dayhike\/">/);
    expect(html).toContain('<a href="https://games.csarko.sh/dayhike/">');
  });
});
