import { describe, expect, it } from 'vitest';
import { grounded, plainText, readPlan, readSort, wordsOf } from './voicePlan.ts';
import { clearVoiceLog, settleRecording, traceRecording, voiceLog, voiceLogText } from './voiceLog.ts';

const notes = [{ id: 'movies', title: 'Movies' }, { id: 'go', title: 'Go' }];

describe('checking what the model says against what was said', () => {
  const said = wordsOf('okay spider man batman and the fantastic four, parkersburg west virginia');

  it('accepts tidied forms of words that were said', () => {
    for (const item of ['Spider-Man', 'Spiderman', 'Batman', 'The Fantastic Four', 'Parkersburg, West Virginia']) expect(grounded(item, said), item).toBe(true);
  });

  it('refuses words that were never said', () => {
    for (const item of ['Superman', 'Green Lantern', 'Spider-Man 2099', 'Batman 3']) expect(grounded(item, said), item).toBe(false);
  });

  it('counts a number said as a word', () => {
    expect(grounded('Back to the Future Part 2', wordsOf('back to the future part two'))).toBe(true);
    expect(grounded('Part two', wordsOf('part 2'))).toBe(true);
  });

  it('keeps model text literal', () => {
    expect(plainText('# Heading')).toBe('\\# Heading');
    expect(plainText('- not a bullet')).toBe('\\- not a bullet');
    expect(plainText('[link](x) <b>')).toBe('\\[link\\](x) \\<b\\>');
    expect(plainText('St. Louis, Spider-Man')).toBe('St. Louis, Spider-Man');
  });

  it('reads the sort, and only the four kinds', () => {
    expect(readSort({ kind: 'mixed' })).toBe('mixed');
    expect(readSort({ kind: 'delete' })).toBeNull();
    expect(readSort('add')).toBeNull();
  });

  it('reads a plan into checked actions and reports what it set aside', () => {
    const read = readPlan(
      {
        actions: [
          { do: 'append', note: 'movies', items: ['Heat', 'Alien 3'], text: null, as: 'list' },
          { do: 'create', title: 'Comic Books', items: ['Batman'], as: 'tasks' },
          { do: 'append', note: 'Camping', items: ['tent'], text: null, as: 'list' },
        ],
        note: 'I watched Heat.',
      },
      'I watched Heat and Alien, add them to movies, and make comic books with batman, and a tent for camping',
      notes,
    );
    expect(read?.actions).toEqual([
      { do: 'append', note: notes[0], text: 'Heat', placement: { how: 'item', task: false, many: false, target: null, items: ['Heat'] } },
      { do: 'create', title: 'Comic Books', items: ['Batman'], tasks: true },
    ]);
    expect(read?.note).toBe('I watched Heat.');
    expect(read?.problems).toEqual(['dropped “Alien 3”: not something you said', 'no note called “Camping”']);
  });

  it('refuses a plan of the wrong shape', () => {
    expect(readPlan({ actions: 'Heat' }, 'Heat', notes)).toBeNull();
    expect(readPlan({ actions: [1, 2, 3, 4] }, 'Heat', notes)).toBeNull();
    expect(readPlan(null, 'Heat', notes)).toBeNull();
  });
});

describe('the voice log', () => {
  it('keeps each recording with its steps and what was chosen, newest first', () => {
    clearVoiceLog();
    const first = traceRecording('add Heat to movies', 1_000);
    first.step('rules: add to Movies');
    first.decide('offer: add to Movies');
    settleRecording(1_000, 'confirmed');
    const second = traceRecording('it was a long day', 2_000);
    second.decide('note');
    expect(voiceLog().map((entry) => entry.at)).toEqual([2_000, 1_000]);
    expect(voiceLogText()).toMatch(/Said: add Heat to movies\n- rules: add to Movies\nResult: offer: add to Movies → confirmed/);
    clearVoiceLog();
    expect(voiceLog()).toEqual([]);
  });
});
