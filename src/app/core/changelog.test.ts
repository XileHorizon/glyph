import { beforeEach, describe, expect, it } from 'vitest';
import { changelogUrl, keptReleases, readReleases, releaseWhen } from './changelog.ts';

const one = { version: '1.4.1-4', build: '20260916003621', at: '2026-09-16T00:36:21.000Z', notes: 'Smoke at the edges.' };
const two = { version: '1.4.1-3', build: '20260916002336', at: '2026-09-16T00:23:36.000Z' };

describe('the changelog', () => {
  beforeEach(() => localStorage.clear());

  it('reads releases newest first, and drops what is not one', () => {
    const releases = readReleases([two, one, { version: '', build: '20260916003621' }, { version: '1.0.0', build: 'nope' }, 'x', null]);
    expect(releases.map((r) => r.version)).toEqual(['1.4.1-4', '1.4.1-3']);
    expect(releases[0]?.notes).toBe('Smoke at the edges.');
    expect(releases[1]).not.toHaveProperty('notes');
  });

  it('keeps one entry per build', () => {
    expect(readReleases([one, { ...one, notes: 'again' }, two])).toHaveLength(2);
  });

  it('carries the APK version when one went out with it', () => {
    expect(readReleases([{ ...one, apk: '1.4.1' }])[0]?.apk).toBe('1.4.1');
    expect(readReleases([{ ...one, apk: '   ' }])[0]).not.toHaveProperty('apk');
  });

  it('is read from wherever the app takes its updates', () => {
    expect(changelogUrl(undefined, true)).toBe('https://attack.fm/glyph/changelog.json');
    expect(changelogUrl(['https://glyph.example/x/'], true)).toBe('https://glyph.example/x/changelog.json');
    expect(changelogUrl(['not a url', 'https://elsewhere.test/g'], true)).toBe('https://elsewhere.test/g/changelog.json');
  });

  it('is the file next door on the web, where the page and the changelog are served together', () => {
    expect(changelogUrl(undefined, false)).toBe('./changelog.json');
    expect(changelogUrl(['https://elsewhere.test/g'], false)).toBe('./changelog.json');
  });

  it('answers with nothing when nothing was ever read', () => {
    expect(keptReleases()).toEqual([]);
    localStorage.setItem('glyph-changelog', 'not json');
    expect(keptReleases()).toEqual([]);
  });

  it('says when a release went out, falling back to its build', () => {
    expect(releaseWhen(one)).toMatch(/\d/);
    expect(releaseWhen({ version: '1.0.0', build: '20260916003621', at: '' })).toMatch(/Sep/);
  });
});
