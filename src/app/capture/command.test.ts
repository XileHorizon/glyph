import { describe, expect, it } from 'vitest';
import { actionable, findKeyword, findSoundAlike, planCommand, reply } from './command.ts';

const notes = [
  { id: 'b', title: 'AttackFM Bugbash' },
  { id: 'h', title: 'HelloTrade' },
  { id: 'g', title: 'Ghost Notes' },
  { id: 'p', title: 'Places to Go' },
  { id: 'w', title: 'Work' },
];
const plan = (words: string, targets: string[] = []) => planCommand(words, { notes, targets });
const at = (id: string) => notes.find((n) => n.id === id)!;

describe('hearing the keyword', () => {
  it('finds "hey Ghost" and splits the words around it', () => {
    expect(findKeyword('Hey Ghost, add buy milk to hello trade.')).toEqual({ before: '', after: 'add buy milk to hello trade.' });
    expect(findKeyword('Pick up the parcel. Hey Ghost add that to work')).toEqual({ before: 'Pick up the parcel.', after: 'add that to work' });
    expect(findKeyword('Okay, glyph.')).toEqual({ before: '', after: '' });
  });

  it('takes the spellings speech recognition writes for it', () => {
    expect(findKeyword('Glif, new note.')?.after).toBe('new note.');
    expect(findKeyword('Gliff add eggs to work')?.after).toBe('add eggs to work');
  });

  it('takes "ghost" only after hey, hi, OK or so - a common word - and "glyph" as it always did', () => {
    // A note that begins with the word is a note, not a command with nothing in it (Matt: "require hey Ghost").
    expect(findKeyword('Ghost, add buy milk to hello trade.')).toBeNull();
    expect(findKeyword('Ghost stories at the cabin. Bring a torch.')).toBeNull();
    expect(findKeyword('OK Ghost, add buy milk to hello trade.')?.after).toBe('add buy milk to hello trade.');
    expect(findKeyword('so ghost add eggs to the list')?.after).toBe('add eggs to the list');
    expect(findKeyword('Glyph, add buy milk to hello trade.')?.after).toBe('add buy milk to hello trade.');
    expect(findKeyword('Hey glyph, new note')?.after).toBe('new note');
  });

  it('knows the word as a note’s name when a preposition leads and "note" follows', () => {
    // No keyword said: the phrase is words, and nothing is lost.
    expect(findKeyword('add a note to the Ghost note saying testing if this works')).toBeNull();
    expect(findKeyword('put that on the glyph page')).toBeNull();
    // Said first, it is the keyword, and the note called Glyph can still be named after it.
    expect(findKeyword('OK Ghost, add a note to the Ghost note saying testing if this works')).toEqual({
      before: '',
      after: 'add a note to the Ghost note saying testing if this works',
    });
    // Later in the phrase, on its own, it is the keyword.
    expect(findKeyword('call the dentist. Hey Ghost, add that to the Ghost note')?.after).toBe('add that to the Ghost note');
  });

  it('takes the other spellings base.en wrote for it across voices', () => {
    for (const heard of ['Gliv. Add eggs to work.', 'Glive, new note.', 'Glit. Add eggs to work.', 'Clith. Add a table to work.', 'Hey Bliff. Put call Sam on work.', 'Glyth, new note.']) {
      expect(findKeyword(heard), heard).not.toBeNull();
    }
  });

  it('takes a sound-alike word at the start only when a command follows', () => {
    const reads = (words: string) => actionable(plan(words));
    expect(findSoundAlike('Life. Add eggs to work.', reads)).toEqual({ before: '', after: 'Add eggs to work.' });
    expect(findSoundAlike('Live, new notes.', reads)?.after).toBe('new notes.');
    expect(findSoundAlike('Head life. Put call Sam on the work list.', reads)?.after).toBe('Put call Sam on the work list.');
    expect(findSoundAlike('Add life, add eggs to work.', reads)?.after).toBe('add eggs to work.');
    // Words, not a command.
    expect(findSoundAlike('Life is short.', reads)).toBeNull();
    expect(findSoundAlike('Live. Laugh. Love.', reads)).toBeNull();
    expect(findSoundAlike('We climbed the cliff. Add it to the story.', reads)).toBeNull();
    expect(findSoundAlike('Cliff, add eggs to the moon list.', reads)).toBeNull();
  });

  it('is not fooled by words that contain it or sound near it', () => {
    expect(findKeyword('The hieroglyphs were beautiful.')).toBeNull();
    expect(findKeyword('We climbed the cliff at dawn.')).toBeNull();
  });
});

describe('a yes or a no', () => {
  it('hears short replies either way', () => {
    expect(reply('Yes.')).toBe('yes');
    expect(reply('Yeah, do it')).toBe('yes');
    expect(reply('Um, okay.')).toBe('yes');
    expect(reply('No.')).toBe('no');
    expect(reply('Cancel that')).toBe('no');
    expect(reply('Never mind.')).toBe('no');
  });

  it('leaves sentences alone', () => {
    expect(reply('No problem with the invoice from last week.')).toBeNull();
    expect(reply('Buy milk.')).toBeNull();
  });
});

describe('what a command asks for', () => {
  it('adds a thing to a note named after it, the way people say it', () => {
    expect(plan('add buy milk to the hello trade.')).toEqual({ kind: 'place', note: at('h'), text: 'buy milk', how: 'leave', task: false, many: false, target: null });
    expect(plan('put call Sam on the work list')).toMatchObject({ kind: 'place', note: at('w'), text: 'call Sam' });
    expect(plan('add to work: call Sam')).toMatchObject({ kind: 'place', note: at('w'), text: 'call Sam' });
  });

  it('uses an actual titled prefix for labeled, called, and short bare targets', () => {
    const go = [{ id: 'go', title: 'Go', note: { body: 'Go' } }];
    for (const words of ['add to the note labeled Go pack the charger', 'add to the note called go: pack the charger', 'add to GO, pack the charger']) {
      expect(planCommand(words, { notes: go })).toMatchObject({ kind: 'place', note: { id: 'go' }, text: 'pack the charger' });
    }
  });

  it('adds a list item when one is asked for, and waits for it when it is not said yet', () => {
    expect(plan('add a list item to the hello trade')).toEqual({ kind: 'await', note: at('h'), how: 'item', task: false, many: false, target: null });
    expect(plan('add a task buy stamps to work')).toMatchObject({ kind: 'place', note: at('w'), text: 'buy stamps', how: 'item', task: true });
    expect(plan('new item for hello trade, fix the login')).toMatchObject({ kind: 'place', note: at('h'), text: 'fix the login', how: 'item' });
  });

  it('waits for what to add when a note is named alone', () => {
    expect(plan('add a note to hello trade')).toMatchObject({ kind: 'await', note: at('h'), how: 'leave' });
    expect(plan('leave a note for places to go that says the lake by the cabin')).toMatchObject({ kind: 'place', note: at('p'), text: 'the lake by the cabin' });
  });

  it('moves the take, or starts a new note', () => {
    expect(plan('switch to work')).toEqual({ kind: 'move', note: at('w') });
    expect(plan('move this to the hello trade note')).toEqual({ kind: 'move', note: at('h') });
    expect(plan('new note')).toEqual({ kind: 'new' });
  });

  it('carries a plugin’s word after the note’s name', () => {
    expect(plan('new task for hello trade in Notion, ship it', ['notion'])).toMatchObject({ kind: 'place', note: at('h'), target: 'notion', how: 'item', task: true });
  });

  it('says so when the note named does not exist, and waits when nothing is a command yet', () => {
    expect(plan('add eggs to the shopping list')).toBeNull();
    expect(plan('new item for groceries, eggs')).toEqual({ kind: 'no-note', name: 'groceries' });
    expect(plan('add')).toBeNull();
    expect(plan('')).toBeNull();
  });
});

describe('asking for a table', () => {
  it('names the note, or means this one', () => {
    expect(plan('add a table to the attackfm bugbash note')).toEqual({ kind: 'table', note: at('b'), columns: [] });
    expect(plan('make a new table.')).toEqual({ kind: 'table', note: null, columns: [] });
  });

  it('takes column labels said up front', () => {
    expect(plan('add a table to hello trade with columns bug, owner and status')).toEqual({ kind: 'table', note: at('h'), columns: ['Bug', 'Owner', 'Status'] });
  });

  it('says so for a note that is not there, and is not fooled by other tables', () => {
    expect(plan('add a table to the groceries note')).toEqual({ kind: 'no-note', name: 'groceries' });
    expect(plan('add a table of contents')).toBeNull();
  });
});
