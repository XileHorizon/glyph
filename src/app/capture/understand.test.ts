import { describe, expect, it } from 'vitest';
import { commandMessage, commandModelOf, readCommandAnswer } from './understand.ts';

const notes = [
  { id: 'g', title: 'Groceries' },
  { id: 'h', title: 'HelloTrade' },
  { id: 'b', title: 'AttackFM Bugbash' },
];

describe('the command model’s answer', () => {
  it('becomes a plan on one of the person’s notes', () => {
    expect(readCommandAnswer('{"action":"add","note":"Groceries","text":"oat milk.","item":true,"task":false}', notes)).toEqual({
      kind: 'place',
      note: notes[0],
      text: 'oat milk',
      how: 'item',
      task: false,
      many: false,
      target: null,
    });
    expect(readCommandAnswer('{"action":"switch","note":"HelloTrade"}', notes)).toEqual({ kind: 'move', note: notes[1] });
    expect(readCommandAnswer('{"action":"new"}', notes)).toEqual({ kind: 'new' });
    expect(readCommandAnswer('{"action":"table","note":"","columns":["bug","owner"]}', notes)).toEqual({
      kind: 'table',
      note: null,
      columns: ['bug', 'owner'],
    });
  });

  it('a task is an item, and a plain add leaves the words where they fit', () => {
    expect(readCommandAnswer('{"action":"add","note":"HelloTrade","text":"ship the page","item":false,"task":true}', notes)).toMatchObject({
      how: 'item',
      task: true,
    });
    expect(readCommandAnswer('{"action":"add","note":"HelloTrade","text":"ship the page"}', notes)).toMatchObject({ how: 'leave', task: false });
  });

  it('finds the note again by title, forgiving a slip and refusing one made up', () => {
    expect(readCommandAnswer('{"action":"add","note":"groceries","text":"eggs"}', notes)?.kind).toBe('place');
    expect(readCommandAnswer('{"action":"add","note":"Attack FM bug bash","text":"eggs"}', notes)).toMatchObject({ note: notes[2] });
    expect(readCommandAnswer('{"action":"add","note":"Holiday plans","text":"eggs"}', notes)).toBeNull();
    expect(readCommandAnswer('{"action":"switch","note":""}', notes)).toBeNull();
    expect(readCommandAnswer('{"action":"table","note":"Nowhere","columns":[]}', notes)).toBeNull();
  });

  it('is no plan when it is not a command or not JSON', () => {
    expect(readCommandAnswer('{"action":"none"}', notes)).toBeNull();
    expect(readCommandAnswer('{"action":"add","note":"Groceries","text":""}', notes)).toBeNull();
    expect(readCommandAnswer('Sure! I will add that.', notes)).toBeNull();
    expect(readCommandAnswer('{"action": "add", "note": "Groceries"', notes)).toBeNull();
  });

  it('reads past a fence, thinking, or words around the object', () => {
    expect(readCommandAnswer('```json\n{"action":"new"}\n```', notes)).toEqual({ kind: 'new' });
    expect(readCommandAnswer('<think>they want a new one {maybe}</think>\n{"action":"new"}', notes)).toEqual({ kind: 'new' });
    expect(readCommandAnswer('Here: {"action":"add","note":"Groceries","text":"a {braced} thing"} done', notes)).toMatchObject({ text: 'a {braced} thing' });
  });
});

describe('the question and the model', () => {
  it('lists the titles, then what was said', () => {
    expect(commandMessage(' add eggs to groceries ', ['Groceries', 'HelloTrade'])).toBe('Notes:\n- Groceries\n- HelloTrade\n\nCommand: add eggs to groceries');
    expect(commandMessage('new note', [])).toContain('(none)');
  });

  it('runs on 4B when it is there, else 2B, the big ones last', () => {
    const model = (id: string, present: boolean) => ({ id, bytes: 1, present, file: '', path: '' });
    expect(commandModelOf([model('qwen3.5-9b', true), model('qwen3.5-4b', true), model('qwen3.5-2b', true)])).toBe('qwen3.5-4b');
    expect(commandModelOf([model('qwen3.5-9b', true), model('qwen3.5-4b', false), model('qwen3.5-2b', true)])).toBe('qwen3.5-2b');
    expect(commandModelOf([model('qwen3.5-9b', true), model('gemma-4-e4b', true)])).toBe('gemma-4-e4b');
    expect(commandModelOf([model('qwen3.5-4b', false)])).toBeNull();
  });
});
