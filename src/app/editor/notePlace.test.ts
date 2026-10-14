import { beforeEach, describe, expect, it } from 'vitest';
import { caretPlace, readPlace, writePlace } from './notePlace.ts';

describe('where a note was left', () => {
  beforeEach(() => localStorage.clear());

  it('is kept per note, and forgotten when the note is left at the top', () => {
    writePlace('a', { pos: 3124, offset: 51.5 });
    writePlace('b', { pos: 10, offset: 0 });
    expect(readPlace('a')).toEqual({ pos: 3124, offset: 51.5 });
    expect(readPlace('b')).toEqual({ pos: 10, offset: 0 });
    writePlace('a', null);
    expect(readPlace('a')).toBeNull();
    expect(readPlace('missing')).toBeNull();
  });

  it('keeps the most recently read notes, not every note ever opened', () => {
    for (let i = 0; i < 205; i += 1) writePlace(`n${i}`, { pos: i, offset: 0 }, i);
    expect(readPlace('n0')).toBeNull();
    expect(readPlace('n4')).toBeNull();
    expect(readPlace('n5')).toEqual({ pos: 5, offset: 0 });
    expect(readPlace('n204')).toEqual({ pos: 204, offset: 0 });
  });

  it('opens at the top when what is stored is not a place', () => {
    localStorage.setItem('glyph-note-places', '{"a":{"pos":"x"}}');
    expect(readPlace('a')).toBeNull();
    localStorage.setItem('glyph-note-places', 'not json');
    expect(readPlace('a')).toBeNull();
  });
});

describe('the bookmark the button puts in', () => {
  /** A view and a page with just enough of them to place a caret: line blocks 20px tall, a 200px window. */
  const shown = (caret: number, scrollTop: number) => {
    const view = {
      // The document's top in the window moves up as the page scrolls, the way a real scroller reports it.
      documentTop: -scrollTop,
      state: { doc: { length: 1000 }, selection: { main: { head: caret } } },
      lineBlockAt: (pos: number) => ({ from: Math.floor(pos / 40) * 40, top: Math.floor(pos / 40) * 20, height: 20 }),
    } as unknown as Parameters<typeof caretPlace>[0];
    const page = { scrollTop, clientHeight: 200, getBoundingClientRect: () => ({ top: 0 }) } as unknown as HTMLElement;
    return caretPlace(view, page);
  };

  it('is the line the caret is on, from that line’s top', () => {
    // The caret is in the fourth line block (position 130 → line at 120), 60px down, and the page shows 0-200.
    expect(shown(130, 0)).toEqual({ pos: 120, offset: 0 });
  });

  it('is nothing when the caret’s line is not on screen, so the page itself is used instead', () => {
    // The same caret with the page scrolled well past it.
    expect(shown(130, 400)).toBeNull();
    // And a caret on a line that starts below the window's foot.
    expect(shown(400, 0)).toBeNull();
  });

  it('takes a caret on the first line the window shows, and one on the last', () => {
    // Scrolled to 100, the window is 100-300: the line at 100 is its first, and the line at 280 its last.
    expect(shown(200, 100)).toEqual({ pos: 200, offset: 0 });
    expect(shown(570, 100)).toEqual({ pos: 560, offset: 0 });
  });
});
