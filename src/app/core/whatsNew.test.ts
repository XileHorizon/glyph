import { describe, expect, it } from 'vitest';
import { releasesSince, type Release } from './changelog.ts';

const release = (build: string, version: string): Release => ({ build, version, at: '' });

describe('what is new after an update', () => {
  it('is every release after the build last run here, up to this one, newest first', () => {
    const all = [release('20260916212259', '1.4.3-1'), release('20260916210929', '1.4.2-17'), release('20260916190000', '1.4.2-16'), release('20260916100000', '1.4.2-15')];
    expect(releasesSince(all, '20260916190000', '20260916212259').map((r) => r.version)).toEqual(['1.4.3-1', '1.4.2-17']);
    // A release newer than the one running isn't installed yet, so it isn't news.
    expect(releasesSince(all, '20260916100000', '20260916210929').map((r) => r.version)).toEqual(['1.4.2-17', '1.4.2-16']);
    expect(releasesSince(all, '20260916212259', '20260916212259')).toEqual([]);
  });
});
