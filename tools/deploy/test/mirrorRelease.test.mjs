import { describe, it, expect } from 'vitest';
import { latestMirrorVersion, outdatedVerdict } from '../lib/mirrorRelease.mjs';

describe('latestMirrorVersion', () => {
  it('picks the highest stable v-tag, ignoring drafts, prereleases and odd tags', () => {
    expect(
      latestMirrorVersion([
        { tagName: 'v44.1.1' },
        { tagName: 'v44.2.0', isDraft: true },
        { tagName: 'v45.0.0-beta.1', isPrerelease: true },
        { tagName: 'v44.1.9' },
        { tagName: 'nightly' },
      ]),
    ).toBe('44.1.9');
  });
  it('is null when nothing usable is published', () => {
    expect(latestMirrorVersion([])).toBeNull();
    expect(latestMirrorVersion([{ tagName: 'v1.0.0', isDraft: true }])).toBeNull();
  });
});

describe('outdatedVerdict', () => {
  it('is current when the pin matches the mirror', () => {
    const v = outdatedVerdict('44.1.1', '44.1.1');
    expect(v.outdated).toBe(false);
    expect(v.message).toBe("desktop is current: electron 44.1.1 is the mirror's latest (v44.1.1)");
  });
  it('is outdated when the mirror is ahead', () => {
    const v = outdatedVerdict('44.1.1', '44.2.0');
    expect(v.outdated).toBe(true);
    expect(v.message).toBe('desktop is outdated: pinned 44.1.1, mirror has v44.2.0 → bump desktop/package.json and run deploy:desktop');
  });
  it('is current (with a note) when the pin is ahead of the mirror or the mirror is empty', () => {
    expect(outdatedVerdict('44.3.0', '44.2.0').outdated).toBe(false);
    expect(outdatedVerdict('44.1.1', null)).toEqual({
      outdated: false,
      message: 'desktop is current: the mirror has no stable release to compare with (pinned 44.1.1)',
    });
  });
});
