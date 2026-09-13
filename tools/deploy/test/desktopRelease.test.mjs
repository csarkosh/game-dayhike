import { describe, it, expect } from 'vitest';
import {
  parseSemver,
  isGreater,
  dmgName,
  parseShasums,
  latestJson,
  validateLatest,
  frameworkPathIn,
  installerName,
  objectName,
  sitesMatch,
  verifyOrRefetch,
} from '../lib/desktopRelease.mjs';

describe('semver', () => {
  it('parses strict x.y.z only', () => {
    expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
    expect(parseSemver('v1.2.3')).toBeNull();
    expect(parseSemver('1.2')).toBeNull();
  });
  it('compares numerically', () => {
    expect(isGreater('1.10.0', '1.9.0')).toBe(true);
    expect(isGreater('1.2.3', '1.2.3')).toBe(false);
    expect(isGreater('0.1.0', '0.0.0')).toBe(true);
  });
});

describe('names and paths', () => {
  it('names the dmg the way electron-builder does', () => {
    expect(dmgName('1.2.0')).toBe('DayHike-1.2.0-arm64.dmg');
  });
  it('locates the framework binary inside an unpacked Electron', () => {
    expect(frameworkPathIn('/x/Electron.app')).toBe(
      '/x/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
    );
  });
});

describe('parseShasums', () => {
  const aa = 'a'.repeat(64);
  const bb = 'b'.repeat(64);
  it('reads the upstream/mirror format', () => {
    const m = parseShasums(`${aa} *electron-v44.1.1-darwin-arm64.zip\n${bb} *electron-v44.1.1-win32-x64.zip\n\n`);
    expect(m.get('electron-v44.1.1-darwin-arm64.zip')).toBe(aa);
    expect(m.get('electron-v44.1.1-win32-x64.zip')).toBe(bb);
    expect(m.size).toBe(2);
  });
  it('ignores a truncated digest and an uppercase digest', () => {
    const m = parseShasums(
      `${'a'.repeat(10)} *electron-v44.1.1-linux-x64.zip\n${'B'.repeat(64)} *electron-v44.1.1-win32-ia32.zip\n${aa} *electron-v44.1.1-darwin-arm64.zip\n`,
    );
    expect(m.size).toBe(1);
    expect(m.get('electron-v44.1.1-darwin-arm64.zip')).toBe(aa);
  });
});

const mac = { url: 'https://storage.googleapis.com/fps-csarko-downloads/desktop/DayHike-1.2.0-arm64.dmg', sha256: 'a'.repeat(64), size: 155000000 };
const win = { url: 'https://storage.googleapis.com/fps-csarko-downloads/desktop/DayHike-Setup-1.2.0-x64.exe', sha256: 'b'.repeat(64), size: 118000000 };
const fields = { version: '1.2.0', publishedAt: '2026-09-02T18:00:00.000Z', platforms: { 'darwin-arm64': mac, 'win32-x64': win } };

describe('installerName', () => {
  it('matches electron-builder artifactName for win', () => {
    expect(installerName('1.2.0')).toBe('DayHike-Setup-1.2.0-x64.exe');
  });
});

describe('objectName', () => {
  const sha = `abcdef01${'0'.repeat(56)}`;
  it('inserts the first 8 hex of the sha before the extension', () => {
    expect(objectName('DayHike-Setup-1.2.0-x64.exe', sha)).toBe('DayHike-Setup-1.2.0-x64-abcdef01.exe');
    expect(objectName('DayHike-1.2.0-arm64.dmg', sha)).toBe('DayHike-1.2.0-arm64-abcdef01.dmg');
  });
  it('splits on the last dot, and appends when there is no extension', () => {
    expect(objectName('a.b.c', sha)).toBe('a.b-abcdef01.c');
    expect(objectName('installer', sha)).toBe('installer-abcdef01');
    expect(objectName('.hidden', sha)).toBe('.hidden-abcdef01');
  });
  it('refuses anything that is not a lowercase sha256', () => {
    expect(() => objectName('x.exe', 'A'.repeat(64))).toThrow(/not a lowercase sha256/);
    expect(() => objectName('x.exe', 'a'.repeat(63))).toThrow(/not a lowercase sha256/);
    expect(() => objectName('x.exe', undefined)).toThrow(/not a lowercase sha256/);
    expect(() => objectName('', sha)).toThrow(/localName is required/);
  });
});

describe('latestJson', () => {
  it('serialises top-level mac fields plus the platforms map', () => {
    const doc = JSON.parse(latestJson(fields));
    expect(doc).toEqual({ version: '1.2.0', ...mac, publishedAt: fields.publishedAt, platforms: fields.platforms });
    expect(Object.keys(doc)).toEqual(['version', 'url', 'sha256', 'size', 'publishedAt', 'platforms']);
  });
  it('requires darwin-arm64 and refuses bad entries', () => {
    expect(() => latestJson({ ...fields, platforms: { 'win32-x64': win } })).toThrow(/darwin-arm64/);
    expect(() => latestJson({ ...fields, platforms: { ...fields.platforms, 'win32-x64': { ...win, size: 0 } } })).toThrow();
    expect(() => latestJson({ ...fields, platforms: { ...fields.platforms, 'win32-x64': { ...win, url: 'http://x' } } })).toThrow();
    expect(() => latestJson({ ...fields, version: '1.2' })).toThrow();
    expect(() => latestJson({ ...fields, platforms: { ...fields.platforms, 'linux-x64': win } })).toThrow(/linux-x64/);
  });
});

describe('validateLatest', () => {
  const doc = JSON.parse(latestJson(fields));
  it('accepts the new shape', () => {
    expect(validateLatest(doc)).toEqual(doc);
  });
  it('accepts the 0.1.x shape and synthesises platforms', () => {
    const old = { version: '1.2.0', ...mac, publishedAt: fields.publishedAt };
    expect(validateLatest(old)).toEqual({ ...old, platforms: { 'darwin-arm64': mac } });
  });
  it('rejects top-level fields that disagree with darwin-arm64', () => {
    expect(validateLatest({ ...doc, size: 1 })).toBeNull();
  });
  it('rejects a bad platform entry, an unknown platform, and the old failures', () => {
    expect(validateLatest({ ...doc, platforms: { ...doc.platforms, 'win32-x64': { ...win, sha256: 'zz' } } })).toBeNull();
    expect(validateLatest({ ...doc, platforms: { ...doc.platforms, 'linux-x64': win } })).toBeNull();
    expect(validateLatest({ ...doc, version: '1.2' })).toBeNull();
    expect(validateLatest({ ...doc, publishedAt: 'not a date' })).toBeNull();
    expect(validateLatest(null)).toBeNull();
    expect(validateLatest('nope')).toBeNull();
  });
});

describe('sitesMatch', () => {
  // The shape the mirror publishes as electron-v<ver>-<platform>.patches.json.
  const record = {
    version: '44.1.1',
    platform: 'win32-x64',
    patches: [
      {
        name: 'pointerlock-noeject',
        binary: 'electron.exe',
        sites: [
          { symbol: 'PointerLockController::HandleUserPressedEscape()', offset: 4, length: 3, old: '565753', new: '31c0c3' },
        ],
      },
    ],
  };
  const patched = Buffer.from('0000000031c0c30000', 'hex');

  it('passes when every site carries the patched bytes', () => {
    expect(sitesMatch(patched, record)).toEqual({ ok: true, checked: 1, mismatches: [] });
  });

  it('names the offset, the expected bytes and what it found when one byte is off', () => {
    const tampered = Buffer.from(patched);
    tampered[4] = 0x90;
    const result = sitesMatch(tampered, record);
    expect(result.ok).toBe(false);
    expect(result.checked).toBe(1);
    expect(result.mismatches).toEqual([
      {
        patch: 'pointerlock-noeject',
        symbol: 'PointerLockController::HandleUserPressedEscape()',
        offset: 4,
        expected: '31c0c3',
        found: '90c0c3',
      },
    ]);
  });

  it('reports a site past the end of the file rather than silently passing', () => {
    const result = sitesMatch(patched, {
      ...record,
      patches: [{ ...record.patches[0], sites: [{ ...record.patches[0].sites[0], offset: 9000 }] }],
    });
    expect(result.ok).toBe(false);
    expect(result.mismatches[0]).toMatchObject({ offset: 9000, expected: '31c0c3', found: '' });
  });

  it('is ok with zero sites checked when the record has no patches — the caller decides', () => {
    expect(sitesMatch(patched, { version: '44.1.1', platform: 'win32-x64', patches: [] })).toEqual({ ok: true, checked: 0, mismatches: [] });
  });

  it('refuses a record whose site has no usable bytes', () => {
    expect(() => sitesMatch(patched, { patches: [{ name: 'x', sites: [{ offset: 0, new: 'nothex' }] }] })).toThrow(/new/);
    expect(() => sitesMatch(patched, { patches: [{ name: 'x', sites: [{ offset: -1, new: '31c0c3' }] }] })).toThrow(/offset/);
    expect(() => sitesMatch(patched, { patches: 'not an array' })).toThrow(/patches/);
  });
});

describe('verifyOrRefetch', () => {
  function fakeIo({ present = null, served = [] }) {
    const io = { downloads: 0, removed: 0, file: present };
    return {
      io,
      exists: (p) => io.file !== null && p === 'zip',
      digest: () => io.file,
      remove: () => {
        io.removed++;
        io.file = null;
      },
      download: async () => {
        io.file = served[io.downloads] ?? served.at(-1);
        io.downloads++;
      },
    };
  }

  it('downloads when the file is missing, and says so', async () => {
    const f = fakeIo({ present: null, served: ['good'] });
    expect(await verifyOrRefetch('zip', 'good', f)).toEqual({ path: 'zip', downloaded: true, refetched: false });
    expect(f.io.downloads).toBe(1);
    expect(f.io.removed).toBe(0);
  });

  it('throws when the file was missing and what arrived is wrong', async () => {
    const f = fakeIo({ present: null, served: ['wrong'] });
    await expect(verifyOrRefetch('zip', 'good', f)).rejects.toThrow(/does not match the mirror's checksum \(expected good, got wrong\)/);
    expect(f.io.downloads).toBe(1);
    expect(f.io.removed).toBe(0);
  });

  it('keeps a cached file whose digest matches', async () => {
    const f = fakeIo({ present: 'good', served: ['good'] });
    expect(await verifyOrRefetch('zip', 'good', f)).toEqual({ path: 'zip', downloaded: false, refetched: false });
    expect(f.io.downloads).toBe(0);
  });

  it('deletes and re-downloads a cached file the mirror no longer publishes', async () => {
    const f = fakeIo({ present: 'stale', served: ['good'] });
    expect(await verifyOrRefetch('zip', 'good', f)).toEqual({ path: 'zip', downloaded: true, refetched: true });
    expect(f.io.removed).toBe(1);
    expect(f.io.downloads).toBe(1);
  });

  it('gives up after one re-download rather than looping', async () => {
    const f = fakeIo({ present: 'stale', served: ['still wrong'] });
    await expect(verifyOrRefetch('zip', 'good', f)).rejects.toThrow(/after re-downloading/);
    expect(f.io.downloads).toBe(1);
  });
});
