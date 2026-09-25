import { describe, expect, it } from 'vitest';
import { backFrom, canGoBack, canGoOn, FIRST, MOST_PLACES, notePlace, noteIdOf, onFrom, placeAt, went } from './visited.ts';

/** Everything is there: the usual case, where no note has been deleted. */
const all = () => true;

describe('the trail', () => {
  it('starts on the list with nowhere to go', () => {
    expect(canGoBack(FIRST, all)).toBe(false);
    expect(canGoOn(FIRST, all)).toBe(false);
  });

  it('remembers where you have been, in order', () => {
    const trail = went(went(FIRST, notePlace('a')), notePlace('b'));
    expect(trail.places).toEqual(['list', 'note:a', 'note:b']);
    expect(trail.at).toBe(2);
  });

  it('does not record arriving where you already are', () => {
    const once = went(FIRST, notePlace('a'));
    expect(went(once, notePlace('a'))).toBe(once);
  });

  it('goes back and forward over the same places', () => {
    const trail = went(went(FIRST, notePlace('a')), notePlace('b'));
    const back = backFrom(trail, all)!;
    expect(placeAt(back)).toBe('note:a');
    const on = onFrom(back, all)!;
    expect(placeAt(on)).toBe('note:b');
  });

  it('forgets what was ahead once you go somewhere new from back there', () => {
    const trail = went(went(FIRST, notePlace('a')), notePlace('b'));
    const back = backFrom(trail, all)!;
    const elsewhere = went(back, notePlace('c'));
    expect(elsewhere.places).toEqual(['list', 'note:a', 'note:c']);
    expect(canGoOn(elsewhere, all)).toBe(false);
  });

  it('steps over a note that has been deleted', () => {
    const trail = went(went(went(FIRST, notePlace('a')), notePlace('gone')), notePlace('b'));
    const there = (place: string) => noteIdOf(place) !== 'gone';
    const back = backFrom(trail, there)!;
    expect(placeAt(back)).toBe('note:a');
  });

  it('says there is nowhere to go when everything behind is deleted', () => {
    const trail = went(FIRST, notePlace('gone'));
    const onlyNotes = (place: string) => noteIdOf(place) !== null;
    expect(canGoBack(trail, onlyNotes)).toBe(false);
  });

  it('keeps the last places and no more', () => {
    let trail = FIRST;
    for (let i = 0; i < MOST_PLACES + 10; i += 1) trail = went(trail, notePlace(`n${i}`));
    expect(trail.places).toHaveLength(MOST_PLACES);
    expect(placeAt(trail)).toBe(notePlace(`n${MOST_PLACES + 9}`));
    expect(trail.places).not.toContain('list');
  });
});
