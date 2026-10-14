import { describe, expect, it } from 'vitest';
import { pathOf, siteOf } from '../core/linkPreview.ts';
import { provideMarkDetails, type MarkDetailsProvider } from '../core/markDetails.ts';
import { linkLine } from './linkCards.ts';

// As the Notion and GitHub plugins do when they are on: they read their own links, which have their own rows.
const reading = (host: string) => ({ reads: (url: string) => url.includes(host) }) as unknown as MarkDetailsProvider;
provideMarkDetails('notion', () => reading('notion.so'));
provideMarkDetails('github', () => reading('github.com'));

describe('link preview cards', () => {
  it('are for a line that is only a link, bare, bracketed or named, in a list or not', () => {
    expect(linkLine('https://www.airbnb.com/rooms/1234')).toEqual({ url: 'https://www.airbnb.com/rooms/1234', words: null });
    expect(linkLine('  <https://example.com/a>  ')?.url).toBe('https://example.com/a');
    expect(linkLine('- [The cabin](https://airbnb.com/rooms/1)')).toEqual({ url: 'https://airbnb.com/rooms/1', words: 'The cabin' });
    expect(linkLine('- [ ] https://example.com/read-this.')?.url).toBe('https://example.com/read-this');
    expect(linkLine('1. https://example.com')?.url).toBe('https://example.com');
  });

  it('are not for a link among words, a picture, another scheme, or a link a plugin reads', () => {
    expect(linkLine('see https://example.com for more')).toBeNull();
    expect(linkLine('![a cassette](https://example.com/tape.jpg)')).toBeNull();
    expect(linkLine('ftp://example.com/file')).toBeNull();
    expect(linkLine('- [ ] Buy milk [notion](https://www.notion.so/abc123)')).toBeNull();
    expect(linkLine('https://www.notion.so/Some-page-0123456789abcdef0123456789abcdef')).toBeNull();
    expect(linkLine('- [Fix it](https://github.com/o/r/issues/4)')).toBeNull();
  });

  it('say the site and a short path', () => {
    expect(siteOf('https://www.airbnb.com/rooms/1234?x=1')).toBe('airbnb.com');
    expect(pathOf('https://www.airbnb.com/rooms/1234?x=1')).toBe('/rooms/1234?x=1');
    expect(pathOf('https://example.com/')).toBe('');
    expect(pathOf(`https://example.com/${'a'.repeat(60)}`)).toHaveLength(32);
  });
});
