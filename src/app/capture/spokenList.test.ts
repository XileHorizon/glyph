import { describe, expect, it } from 'vitest';
import { spokenListItems } from './spokenList.ts';

describe('spoken list items', () => {
  it('tells places apart by their state, with or without the commas Whisper writes', () => {
    const places = ['Parkersburg, West Virginia', 'Marietta, Ohio', 'Balitmore, Maryland', 'Detroit, Michigan'];
    expect(spokenListItems('parkersburg west virginia marietta ohio balitmore maryland and detroit michigan')).toEqual(places);
    expect(spokenListItems('Parkersburg, West Virginia, Marietta, Ohio, Balitmore, Maryland and Detroit, Michigan.')).toEqual(places);
  });

  it('keeps a city named like a state, and state abbreviations', () => {
    expect(spokenListItems('New York New York and Kansas City Missouri')).toEqual(['New York, New York', 'Kansas City, Missouri']);
    expect(spokenListItems('Austin TX, Columbus OH')).toEqual(['Austin, Texas', 'Columbus, Ohio']);
  });

  it('falls back to the ordinary split when the list is not places', () => {
    expect(spokenListItems('milk, eggs and Texas toast')).toEqual(['milk', 'eggs', 'Texas toast']);
    expect(spokenListItems('Georgia and Virginia')).toEqual(['Georgia', 'Virginia']);
    expect(spokenListItems('milk eggs bread')).toEqual(['milk', 'eggs', 'bread']);
    expect(spokenListItems('Paris, Texas; Lyon, France')).toEqual(['Paris, Texas', 'Lyon, France']);
  });
});
