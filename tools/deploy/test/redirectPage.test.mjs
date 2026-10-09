import { describe, it, expect } from 'vitest';
import { GAMES_INDEX, redirectTarget, renderRedirectPage } from '../lib/redirectPage.mjs';

const opts = { legacyHost: 'game.csarko.sh', base: 'https://games.csarko.sh/dayhike', index: GAMES_INDEX };

describe('redirectTarget', () => {
  it('carries an old-host path and query across', () => {
    expect(redirectTarget({ host: 'game.csarko.sh', pathname: '/game/abc', search: '?cmd=seed%20x' }, opts)).toBe(
      'https://games.csarko.sh/dayhike/game/abc?cmd=seed%20x',
    );
    expect(redirectTarget({ host: 'game.csarko.sh', pathname: '/', search: '' }, opts)).toBe(
      'https://games.csarko.sh/dayhike/',
    );
  });
  it('sends any other path on the new and default hostnames to the list of games', () => {
    expect(redirectTarget({ host: 'games.csarko.sh', pathname: '/anything', search: '' }, opts)).toBe(
      'https://csarko.sh/games',
    );
    expect(redirectTarget({ host: 'fps-csarko.web.app', pathname: '/anything', search: '?x' }, opts)).toBe(
      'https://csarko.sh/games',
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
    expect(html).toContain('<meta http-equiv="refresh" content="0;url=https://csarko.sh/games">');
    expect(html).toContain('<a href="https://csarko.sh/games">');
  });
});
